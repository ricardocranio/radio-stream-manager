-- Add monitoring schedule columns to radio_stations
ALTER TABLE public.radio_stations
ADD COLUMN monitoring_start_hour integer DEFAULT NULL,
ADD COLUMN monitoring_start_minute integer DEFAULT 0,
ADD COLUMN monitoring_end_hour integer DEFAULT NULL,
ADD COLUMN monitoring_end_minute integer DEFAULT 0,
ADD COLUMN monitoring_week_days text[] DEFAULT ARRAY['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

-- Add comment explaining the columns
COMMENT ON COLUMN public.radio_stations.monitoring_start_hour IS 'Hour when monitoring starts (0-23). NULL means 24/7 monitoring.';
COMMENT ON COLUMN public.radio_stations.monitoring_end_hour IS 'Hour when monitoring ends (0-23). NULL means 24/7 monitoring.';