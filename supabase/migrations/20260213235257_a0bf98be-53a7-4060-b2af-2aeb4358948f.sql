
CREATE OR REPLACE FUNCTION public.trigger_cleanup_excess_songs()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  station_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO station_count
  FROM scraped_songs
  WHERE station_name = NEW.station_name;

  IF station_count > 150 THEN
    DELETE FROM scraped_songs
    WHERE id IN (
      SELECT id
      FROM scraped_songs
      WHERE station_name = NEW.station_name
      ORDER BY scraped_at ASC
      LIMIT (station_count - 150)
    );
  END IF;
  
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_excess_scraped_songs()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  station RECORD;
  excess_count INTEGER;
BEGIN
  FOR station IN
    SELECT station_name, COUNT(*) as total
    FROM scraped_songs
    GROUP BY station_name
    HAVING COUNT(*) > 150
  LOOP
    excess_count := station.total - 150;
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
$function$;
