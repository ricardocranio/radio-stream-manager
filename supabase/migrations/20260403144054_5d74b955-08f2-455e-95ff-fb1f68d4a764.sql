CREATE OR REPLACE FUNCTION public.trigger_cleanup_excess_songs()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Delete songs older than 12 minutes (matches monitor cycle interval)
  DELETE FROM scraped_songs
  WHERE scraped_at < (NOW() - INTERVAL '12 minutes');

  -- Cap per station at 10 most recent (tight limit per user request)
  IF random() < 0.3 THEN
    DELETE FROM scraped_songs
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY station_name ORDER BY scraped_at DESC) as rn
        FROM scraped_songs
        WHERE station_name = NEW.station_name
      ) ranked
      WHERE rn > 10
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- Also update the manual cleanup function
CREATE OR REPLACE FUNCTION public.cleanup_excess_scraped_songs()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Delete all songs older than 12 minutes
  DELETE FROM public.scraped_songs
  WHERE scraped_at < (NOW() - INTERVAL '12 minutes');

  -- Keep only 10 most recent per station
  DELETE FROM public.scraped_songs
  WHERE id NOT IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY station_name ORDER BY scraped_at DESC) as rn
      FROM public.scraped_songs
    ) ranked
    WHERE rn <= 10
  );
END;
$function$;