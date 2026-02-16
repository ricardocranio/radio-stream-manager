
-- Tabela para histórico de músicas por rádio (acervo para montagem de grade)
CREATE TABLE public.radio_historico (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  station_name TEXT NOT NULL,
  artist TEXT NOT NULL,
  title TEXT NOT NULL,
  captured_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  source TEXT DEFAULT 'python_monitor'
);

-- Índice para buscas rápidas por estação + ordem cronológica
CREATE INDEX idx_radio_historico_station_captured 
  ON public.radio_historico (station_name, captured_at DESC);

-- Índice para evitar duplicatas
CREATE INDEX idx_radio_historico_dedup 
  ON public.radio_historico (station_name, LOWER(TRIM(artist)), LOWER(TRIM(title)));

-- RLS aberto (mesmo padrão das outras tabelas)
ALTER TABLE public.radio_historico ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read radio_historico" ON public.radio_historico FOR SELECT USING (true);
CREATE POLICY "Anyone can insert radio_historico" ON public.radio_historico FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update radio_historico" ON public.radio_historico FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete radio_historico" ON public.radio_historico FOR DELETE USING (true);

-- Trigger: impedir duplicatas (mesma rádio, artista, título) em janela de 10 minutos
CREATE OR REPLACE FUNCTION public.prevent_duplicate_historico()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF EXISTS(
    SELECT 1 FROM radio_historico
    WHERE station_name = NEW.station_name
      AND LOWER(TRIM(artist)) = LOWER(TRIM(NEW.artist))
      AND LOWER(TRIM(title)) = LOWER(TRIM(NEW.title))
      AND captured_at > (NOW() - INTERVAL '10 minutes')
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_duplicate_historico
  BEFORE INSERT ON public.radio_historico
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_duplicate_historico();

-- Trigger: manter no máximo 30 músicas por rádio (limpa as mais antigas)
CREATE OR REPLACE FUNCTION public.cleanup_radio_historico()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  station_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO station_count
  FROM radio_historico
  WHERE station_name = NEW.station_name;

  IF station_count > 30 THEN
    DELETE FROM radio_historico
    WHERE id IN (
      SELECT id FROM radio_historico
      WHERE station_name = NEW.station_name
      ORDER BY captured_at ASC
      LIMIT (station_count - 30)
    );
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cleanup_radio_historico
  AFTER INSERT ON public.radio_historico
  FOR EACH ROW
  EXECUTE FUNCTION public.cleanup_radio_historico();

-- Habilitar Realtime para a tabela
ALTER PUBLICATION supabase_realtime ADD TABLE public.radio_historico;
