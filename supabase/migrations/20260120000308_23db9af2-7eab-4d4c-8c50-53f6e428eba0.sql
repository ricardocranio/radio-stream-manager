-- Drop existing overly permissive policies on radio_stations
DROP POLICY IF EXISTS "Service can manage stations" ON public.radio_stations;

-- Drop existing overly permissive policies on scraped_songs  
DROP POLICY IF EXISTS "Service can manage songs" ON public.scraped_songs;

-- Drop existing overly permissive policies on special_monitoring
DROP POLICY IF EXISTS "Public can insert special monitoring" ON public.special_monitoring;
DROP POLICY IF EXISTS "Public can update special monitoring" ON public.special_monitoring;
DROP POLICY IF EXISTS "Public can delete special monitoring" ON public.special_monitoring;

-- Create secure policies for radio_stations (service role only for writes)
CREATE POLICY "Service role can insert stations" 
ON public.radio_stations 
FOR INSERT 
WITH CHECK (
  (SELECT current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "Service role can update stations" 
ON public.radio_stations 
FOR UPDATE 
USING (
  (SELECT current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "Service role can delete stations" 
ON public.radio_stations 
FOR DELETE 
USING (
  (SELECT current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

-- Create secure policies for scraped_songs (service role only for writes)
CREATE POLICY "Service role can insert songs" 
ON public.scraped_songs 
FOR INSERT 
WITH CHECK (
  (SELECT current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "Service role can update songs" 
ON public.scraped_songs 
FOR UPDATE 
USING (
  (SELECT current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "Service role can delete songs" 
ON public.scraped_songs 
FOR DELETE 
USING (
  (SELECT current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

-- Create secure policies for special_monitoring (service role only for writes)
CREATE POLICY "Service role can insert special monitoring" 
ON public.special_monitoring 
FOR INSERT 
WITH CHECK (
  (SELECT current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "Service role can update special monitoring" 
ON public.special_monitoring 
FOR UPDATE 
USING (
  (SELECT current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "Service role can delete special monitoring" 
ON public.special_monitoring 
FOR DELETE 
USING (
  (SELECT current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);