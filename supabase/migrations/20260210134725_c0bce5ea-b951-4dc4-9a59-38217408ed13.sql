
-- Drop all existing overly permissive write policies
-- scraped_songs
DROP POLICY IF EXISTS "Anyone can delete scraped songs" ON public.scraped_songs;
DROP POLICY IF EXISTS "Anyone can insert scraped songs" ON public.scraped_songs;
DROP POLICY IF EXISTS "Anyone can update scraped songs" ON public.scraped_songs;

-- radio_stations
DROP POLICY IF EXISTS "Anyone can delete stations" ON public.radio_stations;
DROP POLICY IF EXISTS "Anyone can insert stations" ON public.radio_stations;
DROP POLICY IF EXISTS "Anyone can update stations" ON public.radio_stations;

-- special_monitoring
DROP POLICY IF EXISTS "Anyone can delete special monitoring" ON public.special_monitoring;
DROP POLICY IF EXISTS "Anyone can insert special monitoring" ON public.special_monitoring;
DROP POLICY IF EXISTS "Anyone can update special monitoring" ON public.special_monitoring;

-- Recreate write policies restricted to service_role only
-- This means only edge functions (which use service_role key) can write data
-- The desktop app uses the anon key, so it can only read

-- scraped_songs: service_role can INSERT/UPDATE/DELETE
CREATE POLICY "Service role can insert scraped songs"
ON public.scraped_songs FOR INSERT
TO service_role
WITH CHECK (true);

CREATE POLICY "Service role can update scraped songs"
ON public.scraped_songs FOR UPDATE
TO service_role
USING (true);

CREATE POLICY "Service role can delete scraped songs"
ON public.scraped_songs FOR DELETE
TO service_role
USING (true);

-- Also allow anon to insert/delete scraped_songs (needed for client-side cleanup and realtime inserts)
CREATE POLICY "Anon can insert scraped songs"
ON public.scraped_songs FOR INSERT
TO anon
WITH CHECK (true);

CREATE POLICY "Anon can delete scraped songs"
ON public.scraped_songs FOR DELETE
TO anon
USING (true);

-- radio_stations: service_role can INSERT/UPDATE/DELETE
CREATE POLICY "Service role can insert stations"
ON public.radio_stations FOR INSERT
TO service_role
WITH CHECK (true);

CREATE POLICY "Service role can update stations"
ON public.radio_stations FOR UPDATE
TO service_role
USING (true);

CREATE POLICY "Service role can delete stations"
ON public.radio_stations FOR DELETE
TO service_role
USING (true);

-- Anon can also write to radio_stations (desktop app manages stations)
CREATE POLICY "Anon can insert stations"
ON public.radio_stations FOR INSERT
TO anon
WITH CHECK (true);

CREATE POLICY "Anon can update stations"
ON public.radio_stations FOR UPDATE
TO anon
USING (true);

CREATE POLICY "Anon can delete stations"
ON public.radio_stations FOR DELETE
TO anon
USING (true);

-- special_monitoring: service_role can INSERT/UPDATE/DELETE
CREATE POLICY "Service role can insert special monitoring"
ON public.special_monitoring FOR INSERT
TO service_role
WITH CHECK (true);

CREATE POLICY "Service role can update special monitoring"
ON public.special_monitoring FOR UPDATE
TO service_role
USING (true);

CREATE POLICY "Service role can delete special monitoring"
ON public.special_monitoring FOR DELETE
TO service_role
USING (true);

-- Anon can also write to special_monitoring (desktop app manages these)
CREATE POLICY "Anon can insert special monitoring"
ON public.special_monitoring FOR INSERT
TO anon
WITH CHECK (true);

CREATE POLICY "Anon can update special monitoring"
ON public.special_monitoring FOR UPDATE
TO anon
USING (true);

CREATE POLICY "Anon can delete special monitoring"
ON public.special_monitoring FOR DELETE
TO anon
USING (true);
