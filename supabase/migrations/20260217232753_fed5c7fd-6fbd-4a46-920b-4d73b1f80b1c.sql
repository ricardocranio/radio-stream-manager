-- Increase scraped_songs limit from 150 to 300 per station
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

  IF station_count > 300 THEN
    DELETE FROM scraped_songs
    WHERE id IN (
      SELECT id
      FROM scraped_songs
      WHERE station_name = NEW.station_name
      ORDER BY scraped_at ASC
      LIMIT (station_count - 300)
    );
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Increase radio_historico limit from 60 to 150 per station
CREATE OR REPLACE FUNCTION public.cleanup_radio_historico()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  station_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO station_count
  FROM radio_historico
  WHERE station_name = NEW.station_name;

  IF station_count > 150 THEN
    DELETE FROM radio_historico
    WHERE id IN (
      SELECT id FROM radio_historico
      WHERE station_name = NEW.station_name
      ORDER BY captured_at ASC
      LIMIT (station_count - 150)
    );
  END IF;
  
  RETURN NEW;
END;
$function$;
