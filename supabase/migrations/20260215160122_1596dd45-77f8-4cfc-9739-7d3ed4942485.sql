
-- Fix scraped_songs policies: drop restrictive, recreate as permissive
DROP POLICY IF EXISTS "Anyone can read scraped songs" ON public.scraped_songs;
DROP POLICY IF EXISTS "Service role can insert scraped songs" ON public.scraped_songs;
DROP POLICY IF EXISTS "Service role can update scraped songs" ON public.scraped_songs;
DROP POLICY IF EXISTS "Service role can delete scraped songs" ON public.scraped_songs;
DROP POLICY IF EXISTS "Anon can insert scraped songs" ON public.scraped_songs;
DROP POLICY IF EXISTS "Anon can delete scraped songs" ON public.scraped_songs;

CREATE POLICY "Anyone can read scraped songs" ON public.scraped_songs FOR SELECT USING (true);
CREATE POLICY "Anyone can insert scraped songs" ON public.scraped_songs FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update scraped songs" ON public.scraped_songs FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete scraped songs" ON public.scraped_songs FOR DELETE USING (true);

-- Fix radio_stations policies
DROP POLICY IF EXISTS "Anyone can read stations" ON public.radio_stations;
DROP POLICY IF EXISTS "Service role can insert stations" ON public.radio_stations;
DROP POLICY IF EXISTS "Service role can update stations" ON public.radio_stations;
DROP POLICY IF EXISTS "Service role can delete stations" ON public.radio_stations;
DROP POLICY IF EXISTS "Anon can insert stations" ON public.radio_stations;
DROP POLICY IF EXISTS "Anon can update stations" ON public.radio_stations;
DROP POLICY IF EXISTS "Anon can delete stations" ON public.radio_stations;

CREATE POLICY "Anyone can read stations" ON public.radio_stations FOR SELECT USING (true);
CREATE POLICY "Anyone can insert stations" ON public.radio_stations FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update stations" ON public.radio_stations FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete stations" ON public.radio_stations FOR DELETE USING (true);

-- Fix special_monitoring policies
DROP POLICY IF EXISTS "Anyone can read special monitoring" ON public.special_monitoring;
DROP POLICY IF EXISTS "Service role can insert special monitoring" ON public.special_monitoring;
DROP POLICY IF EXISTS "Service role can update special monitoring" ON public.special_monitoring;
DROP POLICY IF EXISTS "Service role can delete special monitoring" ON public.special_monitoring;
DROP POLICY IF EXISTS "Anon can insert special monitoring" ON public.special_monitoring;
DROP POLICY IF EXISTS "Anon can update special monitoring" ON public.special_monitoring;
DROP POLICY IF EXISTS "Anon can delete special monitoring" ON public.special_monitoring;

CREATE POLICY "Anyone can read special monitoring" ON public.special_monitoring FOR SELECT USING (true);
CREATE POLICY "Anyone can insert special monitoring" ON public.special_monitoring FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update special monitoring" ON public.special_monitoring FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete special monitoring" ON public.special_monitoring FOR DELETE USING (true);
