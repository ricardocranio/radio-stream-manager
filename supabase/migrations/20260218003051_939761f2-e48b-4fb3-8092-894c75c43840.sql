
-- 1. Índice de desduplicação para scraped_songs (alinhado com o trigger)
CREATE INDEX IF NOT EXISTS idx_scraped_songs_dedup 
ON public.scraped_songs (station_name, lower(trim(artist)), lower(trim(title)));

-- 2. Índice único no nome da estação para evitar duplicatas futuras
CREATE UNIQUE INDEX IF NOT EXISTS idx_radio_stations_name_unique 
ON public.radio_stations (lower(trim(name)));

-- 3. Índice para special_monitoring consultas por horário
CREATE INDEX IF NOT EXISTS idx_special_monitoring_schedule 
ON public.special_monitoring (enabled, start_hour, end_hour);

-- 4. Índice para special_monitoring por nome da estação
CREATE INDEX IF NOT EXISTS idx_special_monitoring_station 
ON public.special_monitoring (station_name);

-- 5. Melhorar trigger de desduplicação do scraped_songs para usar o índice
CREATE OR REPLACE FUNCTION public.prevent_duplicate_songs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS(
    SELECT 1 FROM scraped_songs
    WHERE station_name = NEW.station_name
      AND lower(trim(artist)) = lower(trim(NEW.artist))
      AND lower(trim(title)) = lower(trim(NEW.title))
      AND scraped_at > (NOW() - INTERVAL '5 minutes')
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- 6. Cleanup probabilístico para scraped_songs (reduz overhead)
CREATE OR REPLACE FUNCTION public.trigger_cleanup_excess_songs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF random() < 0.1 THEN
    DELETE FROM scraped_songs
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY station_name ORDER BY scraped_at DESC) as rn
        FROM scraped_songs
        WHERE station_name = NEW.station_name
      ) ranked
      WHERE rn > 300
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- 7. Cleanup probabilístico para radio_historico
CREATE OR REPLACE FUNCTION public.cleanup_radio_historico()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF random() < 0.1 THEN
    DELETE FROM radio_historico
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY station_name ORDER BY captured_at DESC) as rn
        FROM radio_historico
        WHERE station_name = NEW.station_name
      ) ranked
      WHERE rn > 150
    );
  END IF;
  RETURN NEW;
END;
$function$;
