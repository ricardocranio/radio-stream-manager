ALTER TABLE public.special_monitoring ADD COLUMN IF NOT EXISTS machine_id TEXT;
CREATE INDEX IF NOT EXISTS idx_special_monitoring_machine_id ON public.special_monitoring(machine_id);
