-- Adiciona coluna user_id às radio_stations se não existir
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'radio_stations' AND COLUMN_NAME = 'user_id') THEN
        ALTER TABLE public.radio_stations ADD COLUMN user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();
    END IF;
END $$;

-- Habilita RLS se não estiver habilitado
ALTER TABLE public.radio_stations ENABLE ROW LEVEL SECURITY;

-- Remove políticas antigas se existirem para evitar duplicatas
DROP POLICY IF EXISTS "Users can view their own stations" ON public.radio_stations;
DROP POLICY IF EXISTS "Users can insert their own stations" ON public.radio_stations;
DROP POLICY IF EXISTS "Users can update their own stations" ON public.radio_stations;
DROP POLICY IF EXISTS "Users can delete their own stations" ON public.radio_stations;

-- Cria políticas de isolamento por usuário
CREATE POLICY "Users can view their own stations" 
ON public.radio_stations FOR SELECT 
USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can insert their own stations" 
ON public.radio_stations FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own stations" 
ON public.radio_stations FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own stations" 
ON public.radio_stations FOR DELETE 
USING (auth.uid() = user_id);

-- Atualiza a tabela scraped_songs para também ter user_id (para isolar os dados capturados)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'scraped_songs' AND COLUMN_NAME = 'user_id') THEN
        ALTER TABLE public.scraped_songs ADD COLUMN user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();
    END IF;
END $$;

ALTER TABLE public.scraped_songs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own scraped songs" 
ON public.scraped_songs FOR SELECT 
USING (auth.uid() = user_id OR user_id IS NULL);
