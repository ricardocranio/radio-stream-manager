-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
NEW.updated_at = now();
RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create table to store monitored radio stations
CREATE TABLE public.radio_stations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  scrape_url TEXT NOT NULL,
  styles TEXT[] DEFAULT '{}',
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create table to store scraped songs
CREATE TABLE public.scraped_songs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  station_id UUID REFERENCES public.radio_stations(id) ON DELETE CASCADE,
  station_name TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  scraped_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  is_now_playing BOOLEAN DEFAULT false,
  source TEXT
);

-- Create index for faster queries
CREATE INDEX idx_scraped_songs_station ON public.scraped_songs(station_id);
CREATE INDEX idx_scraped_songs_scraped_at ON public.scraped_songs(scraped_at DESC);
CREATE INDEX idx_scraped_songs_artist_title ON public.scraped_songs(artist, title);

-- Enable RLS but allow public read (no auth required for radio monitoring)
ALTER TABLE public.radio_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scraped_songs ENABLE ROW LEVEL SECURITY;

-- Public read access for radio data
CREATE POLICY "Anyone can read stations" ON public.radio_stations FOR SELECT USING (true);
CREATE POLICY "Anyone can read scraped songs" ON public.scraped_songs FOR SELECT USING (true);

-- Service role can manage (for edge functions)
CREATE POLICY "Service can manage stations" ON public.radio_stations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service can manage songs" ON public.scraped_songs FOR ALL USING (true) WITH CHECK (true);

-- Insert default Brazilian radio stations
INSERT INTO public.radio_stations (name, scrape_url, styles) VALUES
  ('BH FM', 'https://mytuner-radio.com/pt/radio/radio-bh-fm-ao-vivo-402270/', ARRAY['SERTANEJO']),
  ('Band FM', 'https://mytuner-radio.com/pt/radio/band-fm-sao-paulo-485671/', ARRAY['POP/VARIADO']),
  ('Jovem Pan', 'https://mytuner-radio.com/pt/radio/radio-jovem-pan-fm-sao-paulo-485604/', ARRAY['POP/VARIADO']),
  ('Mix FM', 'https://mytuner-radio.com/pt/radio/mix-fm-sao-paulo-485616/', ARRAY['HITS']),
  ('Transamérica', 'https://mytuner-radio.com/pt/radio/radio-transamerica-sao-paulo-485686/', ARRAY['POP/VARIADO']),
  ('Nativa FM', 'https://mytuner-radio.com/pt/radio/nativa-fm-sao-paulo-485623/', ARRAY['SERTANEJO']),
  ('Alpha FM', 'https://mytuner-radio.com/pt/radio/alpha-fm-sao-paulo-485598/', ARRAY['POP/VARIADO']),
  ('Kiss FM', 'https://mytuner-radio.com/pt/radio/kiss-fm-sao-paulo-485610/', ARRAY['DANCE']),
  ('89 FM', 'https://mytuner-radio.com/pt/radio/89-fm-a-radio-rock-485596/', ARRAY['HITS']);

-- Trigger for updated_at
CREATE TRIGGER update_radio_stations_updated_at
BEFORE UPDATE ON public.radio_stations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();