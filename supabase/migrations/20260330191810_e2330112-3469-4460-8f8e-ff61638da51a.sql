
-- Update the cleanup trigger to delete songs older than 15 minutes
CREATE OR REPLACE FUNCTION public.trigger_cleanup_excess_songs()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Always delete songs older than 15 minutes (hard freshness cutoff)
  DELETE FROM scraped_songs
  WHERE scraped_at < (NOW() - INTERVAL '15 minutes');

  -- Also cap per station at 50 most recent (safety net)
  IF random() < 0.2 THEN
    DELETE FROM scraped_songs
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY station_name ORDER BY scraped_at DESC) as rn
        FROM scraped_songs
        WHERE station_name = NEW.station_name
      ) ranked
      WHERE rn > 50
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- Update the standalone cleanup function too
CREATE OR REPLACE FUNCTION public.cleanup_excess_scraped_songs()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Delete all songs older than 15 minutes
  DELETE FROM public.scraped_songs
  WHERE scraped_at < (NOW() - INTERVAL '15 minutes');

  -- Then keep only the most recent per station (safety)
  DELETE FROM public.scraped_songs
  WHERE id NOT IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY station_name ORDER BY scraped_at DESC) as rn
      FROM public.scraped_songs
    ) ranked
    WHERE rn <= 50
  );
END;
$function$;
