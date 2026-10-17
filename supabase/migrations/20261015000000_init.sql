-- Shoulder rehab after breast cancer surgery: core schema.
-- Safety-relevant values (limits, flags) are stored as plain data so deterministic code can
-- compute and audit them; the LLM only ever reads aggregates and writes prose into `reports`.

create type side as enum ('left', 'right');
create type affected_side as enum ('left', 'right', 'both');
create type angle_source as enum ('camera', 'imu');
create type session_kind as enum ('exercise', 'assessment');
-- Reference hierarchy for progress: pre-op on the same arm > healthy arm > general goal.
-- first_session is the post-op starting point, used for "gained X° since you started".
create type baseline_source as enum ('pre_op', 'contralateral', 'first_session', 'normative');
create type flag_severity as enum ('info', 'warn', 'urgent');

create table patients (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  affected_side affected_side not null,
  surgery_type text,
  surgery_date date,
  current_phase smallint not null default 1 check (current_phase between 1 and 3),
  created_at timestamptz not null default now()
);

create table exercises (
  id text primary key,
  name text not null,
  camera_view text not null check (camera_view in ('front', 'side')),
  instructions text
);

-- What the clinician assigned for each phase. A null ceiling means "as tolerated".
create table prescriptions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients on delete cascade,
  phase smallint not null check (phase between 1 and 3),
  exercise_id text not null references exercises,
  ceiling_deg real check (ceiling_deg between 0 and 180),
  goal_deg real check (goal_deg between 0 and 180),
  reps_target smallint not null default 10,
  sets_target smallint not null default 2,
  set_by text,
  updated_at timestamptz not null default now(),
  unique (patient_id, phase, exercise_id)
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients on delete cascade,
  kind session_kind not null default 'exercise',
  phase smallint not null,
  started_at timestamptz not null,
  ended_at timestamptz
);
create index sessions_patient_started on sessions (patient_id, started_at);

create table sets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions on delete cascade,
  exercise_id text not null references exercises,
  side side not null,
  set_index smallint not null,
  -- Snapshot of the limit in force, so changing a prescription never rewrites history.
  ceiling_deg real,
  reps_target smallint,
  pain smallint check (pain between 0 and 10)
);
create index sets_session on sets (session_id);

create table reps (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references sets on delete cascade,
  rep_index smallint not null,
  peak_deg real not null,
  duration_ms integer not null,
  source angle_source not null,
  over_ceiling boolean not null default false,
  shoulder_hike boolean not null default false,
  trunk_lean boolean not null default false,
  elbow_bend boolean not null default false,
  -- Band's peak for the same rep, already mapped into the camera's frame; |peak_deg - imu_peak_deg|
  -- is the live camera-vs-band agreement.
  imu_peak_deg real
);
create index reps_set on reps (set_id);

create table symptom_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions on delete cascade,
  logged_at timestamptz not null default now(),
  arm_heaviness boolean not null default false, -- possible lymphedema sign
  armpit_cord boolean not null default false,   -- possible axillary web syndrome
  note text
);
create index symptom_logs_session on symptom_logs (session_id);

create table baselines (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients on delete cascade,
  exercise_id text not null references exercises,
  side side not null,
  source baseline_source not null,
  peak_deg real not null,
  measured_at timestamptz not null default now()
);
create index baselines_patient on baselines (patient_id, exercise_id, side);

-- Summaries from the armband's daily-use mode. The band logs 1-minute buckets; seed data uses hourly ones.
create table daily_use (
  patient_id uuid not null references patients on delete cascade,
  bucket_start timestamptz not null,
  bucket_minutes smallint not null default 1,
  max_elev_deg real not null,
  raises_over_90 smallint not null default 0,
  active_minutes real not null default 0,
  primary key (patient_id, bucket_start, bucket_minutes)
);

-- Written by the deterministic rules engine only.
create table flags (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients on delete cascade,
  rule text not null,
  severity flag_severity not null,
  detected_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb,
  acknowledged_at timestamptz
);
create index flags_patient on flags (patient_id, detected_at desc);

create table reports (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients on delete cascade,
  period_start date not null,
  period_end date not null,
  -- The exact aggregates and flags the model was given, so every sentence can be traced to data.
  stats jsonb not null,
  patient_summary text,
  clinician_report jsonb,
  model text,
  created_at timestamptz not null default now()
);

-- One row per session × exercise × arm: the shape the dashboard charts.
create view session_exercise_stats with (security_invoker = true) as
select
  s.patient_id,
  s.id as session_id,
  s.kind,
  s.phase,
  s.started_at,
  st.exercise_id,
  st.side,
  max(r.peak_deg) as best_peak_deg,
  avg(r.peak_deg) as mean_peak_deg,
  count(r.id) as reps,
  count(r.id) filter (where r.over_ceiling) as reps_over_ceiling,
  count(r.id) filter (where r.shoulder_hike or r.trunk_lean or r.elbow_bend) as reps_with_compensation,
  max(st.pain) as max_pain,
  avg(abs(r.peak_deg - r.imu_peak_deg)) filter (where r.source = 'camera') as camera_band_gap_deg
from sessions s
join sets st on st.session_id = s.id
left join reps r on r.set_id = st.id
group by s.patient_id, s.id, s.kind, s.phase, s.started_at, st.exercise_id, st.side;

create view daily_use_by_day with (security_invoker = true) as
select
  patient_id,
  (bucket_start at time zone 'America/New_York')::date as day,
  sum(active_minutes) as active_minutes,
  sum(raises_over_90) as raises_over_90,
  max(max_elev_deg) as max_elev_deg
from daily_use
group by patient_id, (bucket_start at time zone 'America/New_York')::date;

-- DEMO ONLY: the hackathon app uses the anon key with no login, so every table is open.
-- Before any real patient data goes in, replace these with policies scoped to auth.uid()
-- (patient sees own rows, clinician sees assigned patients).
do $$
declare t text;
begin
  foreach t in array array['patients', 'exercises', 'prescriptions', 'sessions', 'sets', 'reps',
                           'symptom_logs', 'baselines', 'daily_use', 'flags', 'reports'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy demo_open on %I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

insert into exercises (id, name, camera_view, instructions) values
  ('side_raise', 'Side raise', 'front', 'Raise your arm out to the side with your thumb up, then lower slowly.'),
  ('scaption', 'Scaption raise', 'front', 'Raise your arm slightly in front of your body, thumb up, then lower slowly.'),
  ('forward_raise', 'Forward raise', 'side', 'Turn side-on. Raise your arm straight in front of you, then lower slowly.');
