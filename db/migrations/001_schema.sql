-- Shoulder rehab after breast cancer surgery: core schema (plain Postgres).
-- 002_timescale.sql turns the time-series tables into hypertables on Tiger Data.
-- Safety-relevant values (limits, flags) are plain data computed by deterministic code;
-- the LLM only reads aggregates and writes prose into `reports`.

create type side as enum ('left', 'right');
create type affected_side as enum ('left', 'right', 'both');
create type angle_source as enum ('camera', 'imu');
create type session_kind as enum ('exercise', 'assessment');
-- Reference hierarchy for progress: pre-op on the same arm > healthy arm > general goal.
-- first_session is the post-op starting point, used for "gained X° since you started".
create type baseline_source as enum ('pre_op', 'contralateral', 'first_session', 'normative');
create type flag_severity as enum ('info', 'warn', 'urgent');
create type user_role as enum ('patient', 'clinician');

create table patients (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  affected_side affected_side not null,
  surgery_type text,
  surgery_date date,
  current_phase smallint not null default 1 check (current_phase between 1 and 3),
  created_at timestamptz not null default now()
);

-- Auth0 identities mapped to roles. Patients see only their own record.
create table app_users (
  auth0_sub text primary key,
  email text,
  role user_role not null,
  patient_id uuid references patients on delete set null,
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

-- Hypertable on Tiger. patient/exercise/side/kind are copied from the parent rows so the
-- continuous aggregate can roll reps up without joins.
create table reps (
  set_id uuid not null references sets on delete cascade,
  patient_id uuid not null references patients on delete cascade,
  exercise_id text not null references exercises,
  side side not null,
  kind session_kind not null,
  performed_at timestamptz not null,
  rep_index smallint not null,
  peak_deg real not null,
  duration_ms integer not null,
  source angle_source not null,
  over_ceiling boolean not null default false,
  shoulder_hike boolean not null default false,
  trunk_lean boolean not null default false,
  elbow_bend boolean not null default false,
  -- Band's peak for the same rep, mapped into the camera's frame; |peak_deg - imu_peak_deg|
  -- is the live camera-vs-band agreement.
  imu_peak_deg real
);
create index reps_set on reps (set_id);
create index reps_patient_time on reps (patient_id, performed_at desc);

-- Hypertable on Tiger: the band's raw 20 Hz stream recorded during sessions.
create table band_samples (
  patient_id uuid not null references patients on delete cascade,
  session_id uuid references sessions on delete cascade,
  t timestamptz not null,
  elevation_deg real not null,
  rate_dps real
);
create index band_samples_patient_time on band_samples (patient_id, t desc);
create index band_samples_session on band_samples (session_id, t);

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

-- Hypertable on Tiger: summaries from the band's daily-use mode. The band logs 1-minute
-- buckets; seed data uses hourly ones.
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
  -- Numbers in the model's prose that don't appear in `stats`; empty when the check passed.
  unverified_numbers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- Per-session pain and symptoms, for the dashboard and the rules engine.
create view session_summary with (security_invoker = true) as
select
  s.patient_id,
  s.id as session_id,
  s.kind,
  s.phase,
  s.started_at,
  (select max(pain) from sets where sets.session_id = s.id) as max_pain,
  bool_or(l.arm_heaviness) as arm_heaviness,
  bool_or(l.armpit_cord) as armpit_cord,
  string_agg(l.note, ' / ') as notes
from sessions s
left join symptom_logs l on l.session_id = s.id
group by s.patient_id, s.id, s.kind, s.phase, s.started_at;

-- Daily rollups the dashboard reads. Plain views here; 002_timescale.sql replaces them with
-- continuous aggregates of the same name and columns, so queries work on either.
create view rom_daily as
select
  patient_id,
  exercise_id,
  side,
  date_trunc('day', performed_at at time zone 'America/New_York') at time zone 'America/New_York' as day,
  max(peak_deg) as best_peak_deg,
  avg(peak_deg) as mean_peak_deg,
  count(*) as reps,
  sum(case when over_ceiling then 1 else 0 end) as reps_over_ceiling,
  sum(case when shoulder_hike or trunk_lean or elbow_bend then 1 else 0 end) as reps_with_compensation,
  avg(abs(peak_deg - imu_peak_deg)) as camera_band_gap_deg
from reps
where kind = 'exercise'
group by 1, 2, 3, 4;

create view daily_use_daily as
select
  patient_id,
  date_trunc('day', bucket_start at time zone 'America/New_York') at time zone 'America/New_York' as day,
  sum(active_minutes) as active_minutes,
  sum(raises_over_90) as raises_over_90,
  max(max_elev_deg) as max_elev_deg
from daily_use
group by 1, 2;

insert into exercises (id, name, camera_view, instructions) values
  ('side_raise', 'Side raise', 'front', 'Raise your arm out to the side with your thumb up, then lower slowly.'),
  ('scaption', 'Scaption raise', 'front', 'Raise your arm slightly in front of your body, thumb up, then lower slowly.'),
  ('forward_raise', 'Forward raise', 'side', 'Turn side-on. Raise your arm straight in front of you, then lower slowly.');
