
-- 1. ÍNDICE COMPOSTO OTIMIZADO
-- As queries mais frequentes filtram por station_name e ordenam por scraped_at
CREATE INDEX IF NOT EXISTS idx_scraped_songs_station_name_scraped_at 
ON public.scraped_songs (station_name, scraped_at DESC);

-- 2. TRIGGER DE LIMPEZA AUTOMÁTICA APÓS INSERT
-- Roda a função cleanup_excess_scraped_songs automaticamente após cada INSERT
-- Isso elimina a necessidade do cleanup no lado do app
CREATE OR REPLACE FUNCTION public.trigger_cleanup_excess_songs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  station_count INTEGER;
BEGIN
  -- Only cleanup if the inserting station exceeds the limit
  SELECT COUNT(*) INTO station_count
  FROM scraped_songs
  WHERE station_name = NEW.station_name;

  IF station_count > 40 THEN
    -- Delete oldest songs for this specific station only
    DELETE FROM scraped_songs
    WHERE id IN (
      SELECT id
      FROM scraped_songs
      WHERE station_name = NEW.station_name
      ORDER BY scraped_at ASC
      LIMIT (station_count - 40)
    );
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cleanup_after_insert
AFTER INSERT ON public.scraped_songs
FOR EACH ROW
EXECUTE FUNCTION public.trigger_cleanup_excess_songs();

-- 3. PREVENÇÃO DE DUPLICATAS
-- Função que verifica se já existe uma música idêntica nos últimos 5 minutos
-- Se existir, cancela o INSERT silenciosamente
CREATE OR REPLACE FUNCTION public.prevent_duplicate_songs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  duplicate_exists BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM scraped_songs
    WHERE station_name = NEW.station_name
      AND LOWER(TRIM(artist)) = LOWER(TRIM(NEW.artist))
      AND LOWER(TRIM(title)) = LOWER(TRIM(NEW.title))
      AND scraped_at > (NOW() - INTERVAL '5 minutes')
  ) INTO duplicate_exists;

  IF duplicate_exists THEN
    -- Silently skip the duplicate
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_duplicate_songs
BEFORE INSERT ON public.scraped_songs
FOR EACH ROW
EXECUTE FUNCTION public.prevent_duplicate_songs();
