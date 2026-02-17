
-- Update the cleanup function to keep only 1 song per station
CREATE OR REPLACE FUNCTION public.cleanup_excess_scraped_songs()
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Delete all but the most recent song per station
  DELETE FROM public.scraped_songs
  WHERE id NOT IN (
    SELECT DISTINCT ON (station_name) id
    FROM public.scraped_songs
    ORDER BY station_name, scraped_at DESC
  );
END;
$$;
