-- Add machine_id column to tables
ALTER TABLE public.radio_stations ADD COLUMN IF NOT EXISTS machine_id TEXT;
ALTER TABLE public.scraped_songs ADD COLUMN IF NOT EXISTS machine_id TEXT;
ALTER TABLE public.radio_historico ADD COLUMN IF NOT EXISTS machine_id TEXT;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_radio_stations_machine_id ON public.radio_stations(machine_id);
CREATE INDEX IF NOT EXISTS idx_scraped_songs_machine_id ON public.scraped_songs(machine_id);
CREATE INDEX IF NOT EXISTS idx_radio_historico_machine_id ON public.radio_historico(machine_id);

-- Update RLS policies to include machine_id where applicable
-- Note: Assuming existing policies might need adjustment if they were too restrictive
-- or if we want to ensure only the same machine can see its own data.
-- For now, we add the column and we will update the frontend to filter by it.
