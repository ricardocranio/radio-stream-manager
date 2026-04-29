-- Inserir emissoras globais (System Stations) usando subquery para evitar duplicatas
INSERT INTO public.radio_stations (name, scrape_url, styles, enabled, user_id)
SELECT name, scrape_url, styles, enabled, user_id
FROM (
  VALUES 
    ('Jovem Pan FM', 'https://mytuner-radio.com/pt/radio/jovem-pan-fm-sao-paulo-408792/', ARRAY['POP', 'JOVEM'], true, null::uuid),
    ('Alpha FM', 'https://mytuner-radio.com/pt/radio/alpha-fm-408796/', ARRAY['ADULTO CONTEMPORANEO', 'FLASHBACK'], true, null::uuid),
    ('Antena 1', 'https://mytuner-radio.com/pt/radio/antena-1-sao-paulo-408797/', ARRAY['ADULTO CONTEMPORANEO', 'POP'], true, null::uuid),
    ('Massa FM', 'https://mytuner-radio.com/pt/radio/massa-fm-curitiba-422179/', ARRAY['SERTANEJO', 'POP/VARIADO'], true, null::uuid),
    ('Transamerica', 'https://mytuner-radio.com/pt/radio/transamerica-sao-paulo-408794/', ARRAY['POP', 'ROCK'], true, null::uuid),
    ('89 FM A Rádio Rock', 'https://mytuner-radio.com/pt/radio/89-fm-a-radio-rock-408795/', ARRAY['ROCK'], true, null::uuid),
    ('Kiss FM', 'https://mytuner-radio.com/pt/radio/kiss-fm-brazil-395846/', ARRAY['ROCK', 'CLASSIC ROCK'], true, null::uuid)
) AS t(name, scrape_url, styles, enabled, user_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.radio_stations rs 
  WHERE rs.name = t.name AND (rs.user_id = t.user_id OR (rs.user_id IS NULL AND t.user_id IS NULL))
);

-- Criar índices de performance
CREATE INDEX IF NOT EXISTS idx_scraped_songs_station_name ON public.scraped_songs(station_name);
CREATE INDEX IF NOT EXISTS idx_scraped_songs_scraped_at ON public.scraped_songs(scraped_at DESC);
