-- Tiger Data (TimescaleDB 2.18+) layer. Run after 001_schema.sql on a Tiger Cloud service.
-- Not run in local tests: plain Postgres has no TimescaleDB.

create extension if not exists timescaledb;

-- Time-series tables become hypertables, partitioned by time into chunks.
select create_hypertable('reps', by_range('performed_at', interval '7 days'));
select create_hypertable('daily_use', by_range('bucket_start', interval '7 days'));
select create_hypertable('band_samples', by_range('t', interval '1 day'));

-- The raw band stream is the bulk of the data: 20 rows a second per patient. Older chunks
-- move to the columnstore, segmented by patient so one patient's history stays contiguous.
alter table band_samples set (
  timescaledb.enable_columnstore = true,
  timescaledb.segmentby = 'patient_id',
  timescaledb.orderby = 't desc'
);
call add_columnstore_policy('band_samples', after => interval '1 day');

-- Every primary-key column is a segmentby or orderby column, as the columnstore expects.
alter table daily_use set (
  timescaledb.enable_columnstore = true,
  timescaledb.segmentby = 'patient_id',
  timescaledb.orderby = 'bucket_start desc, bucket_minutes'
);
call add_columnstore_policy('daily_use', after => interval '7 days');

-- Swap the plain rollup views for continuous aggregates with the same columns. Real-time
-- mode (materialized_only = false) merges in rows newer than the last refresh, so a session
-- shows up on the dashboard the moment it is saved.
drop view rom_daily;
create materialized view rom_daily
with (timescaledb.continuous, timescaledb.materialized_only = false) as
select
  patient_id,
  exercise_id,
  side,
  time_bucket(interval '1 day', performed_at, 'America/New_York') as day,
  max(peak_deg) as best_peak_deg,
  avg(peak_deg) as mean_peak_deg,
  count(*) as reps,
  sum(case when over_ceiling then 1 else 0 end) as reps_over_ceiling,
  sum(case when shoulder_hike or trunk_lean or elbow_bend then 1 else 0 end) as reps_with_compensation,
  avg(abs(peak_deg - imu_peak_deg)) as camera_band_gap_deg
from reps
where kind = 'exercise'
group by patient_id, exercise_id, side, time_bucket(interval '1 day', performed_at, 'America/New_York')
with no data;

select add_continuous_aggregate_policy('rom_daily',
  start_offset => interval '90 days',
  end_offset => interval '1 hour',
  schedule_interval => interval '15 minutes');

drop view daily_use_daily;
create materialized view daily_use_daily
with (timescaledb.continuous, timescaledb.materialized_only = false) as
select
  patient_id,
  time_bucket(interval '1 day', bucket_start, 'America/New_York') as day,
  sum(active_minutes) as active_minutes,
  sum(raises_over_90) as raises_over_90,
  max(max_elev_deg) as max_elev_deg
from daily_use
group by patient_id, time_bucket(interval '1 day', bucket_start, 'America/New_York')
with no data;

select add_continuous_aggregate_policy('daily_use_daily',
  start_offset => interval '90 days',
  end_offset => interval '1 hour',
  schedule_interval => interval '15 minutes');
