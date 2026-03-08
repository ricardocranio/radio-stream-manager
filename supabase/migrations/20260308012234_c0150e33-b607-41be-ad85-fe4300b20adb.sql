
-- 1) Tabela de estatísticas agregadas para compressão de histórico
CREATE TABLE IF NOT EXISTS public.radio_historico_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_name text NOT NULL,
  artist text NOT NULL,
  title text NOT NULL,
  play_count integer NOT NULL DEFAULT 1,
  first_seen timestamp with time zone NOT NULL,
  last_seen timestamp with time zone NOT NULL,
  source text DEFAULT 'aggregated',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Índice para busca rápida
CREATE INDEX idx_historico_stats_station ON public.radio_historico_stats(station_name);
CREATE INDEX idx_historico_stats_artist ON public.radio_historico_stats(artist);
CREATE UNIQUE INDEX idx_historico_stats_unique ON public.radio_historico_stats(station_name, lower(trim(artist)), lower(trim(title)));

-- RLS
ALTER TABLE public.radio_historico_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read historico stats" ON public.radio_historico_stats FOR SELECT USING (true);
CREATE POLICY "Anyone can insert historico stats" ON public.radio_historico_stats FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update historico stats" ON public.radio_historico_stats FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete historico stats" ON public.radio_historico_stats FOR DELETE USING (true);

-- 2) Coluna de classificação IA na scraped_songs
ALTER TABLE public.scraped_songs ADD COLUMN IF NOT EXISTS ai_genre text;
ALTER TABLE public.scraped_songs ADD COLUMN IF NOT EXISTS ai_energy text;

-- 3) Função de compressão de histórico (arquiva registros >3 dias)
CREATE OR REPLACE FUNCTION public.compress_radio_historico()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  archived_count integer := 0;
  deleted_count integer := 0;
BEGIN
  -- Upsert agregados a partir de registros antigos
  INSERT INTO radio_historico_stats (station_name, artist, title, play_count, first_seen, last_seen, source)
  SELECT 
    station_name,
    lower(trim(artist)),
    lower(trim(title)),
    count(*),
    min(captured_at),
    max(captured_at),
    'aggregated'
  FROM radio_historico
  WHERE captured_at < (NOW() - INTERVAL '3 days')
  GROUP BY station_name, lower(trim(artist)), lower(trim(title))
  ON CONFLICT (station_name, lower(trim(artist)), lower(trim(title)))
  DO UPDATE SET
    play_count = radio_historico_stats.play_count + EXCLUDED.play_count,
    last_seen = GREATEST(radio_historico_stats.last_seen, EXCLUDED.last_seen),
    first_seen = LEAST(radio_historico_stats.first_seen, EXCLUDED.first_seen);

  GET DIAGNOSTICS archived_count = ROW_COUNT;

  -- Deletar registros antigos já arquivados
  DELETE FROM radio_historico WHERE captured_at < (NOW() - INTERVAL '3 days');
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RETURN json_build_object(
    'archived', archived_count,
    'deleted', deleted_count,
    'timestamp', now()
  );
END;
$$;
