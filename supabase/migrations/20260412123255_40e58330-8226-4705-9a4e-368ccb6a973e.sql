UPDATE public.radio_stations 
SET monitoring_week_days = ARRAY['dom','seg','ter','qua','qui','sex','sab']
WHERE name = 'BH FM';