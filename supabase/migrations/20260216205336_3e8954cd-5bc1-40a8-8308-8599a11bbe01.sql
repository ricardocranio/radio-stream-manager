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

  IF station_count > 60 THEN
    DELETE FROM radio_historico
    WHERE id IN (
      SELECT id FROM radio_historico
      WHERE station_name = NEW.station_name
      ORDER BY captured_at ASC
      LIMIT (station_count - 60)
    );
  END IF;
  
  RETURN NEW;
END;
$function$;