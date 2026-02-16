-- Add stream_url column to radio_stations for ICY metadata scraping
ALTER TABLE public.radio_stations ADD COLUMN IF NOT EXISTS stream_url TEXT;

-- Add comment explaining the column
COMMENT ON COLUMN public.radio_stations.stream_url IS 'Direct audio stream URL for ICY metadata extraction (e.g., Icecast/SHOUTcast URL)';