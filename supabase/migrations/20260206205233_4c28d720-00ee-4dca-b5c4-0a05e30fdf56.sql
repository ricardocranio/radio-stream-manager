-- Update the server-side cleanup function to use 40 songs per station limit
CREATE OR REPLACE FUNCTION public.cleanup_excess_scraped_songs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  station RECORD;
  excess_count INTEGER;
BEGIN
  FOR station IN
    SELECT station_name, COUNT(*) as total
    FROM scraped_songs
    GROUP BY station_name
    HAVING COUNT(*) > 40
  LOOP
    excess_count := station.total - 40;
    DELETE FROM scraped_songs
    WHERE id IN (
      SELECT id
      FROM scraped_songs
      WHERE station_name = station.station_name
      ORDER BY scraped_at ASC
      LIMIT excess_count
    );
    RAISE LOG 'Cleaned % excess songs for station %', excess_count, station.station_name;
  END LOOP;
END;
$$;