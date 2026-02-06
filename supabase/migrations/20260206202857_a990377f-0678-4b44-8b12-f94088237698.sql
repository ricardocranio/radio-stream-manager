
-- Fix: Drop existing triggers first, then recreate
DROP TRIGGER IF EXISTS update_radio_stations_updated_at ON public.radio_stations;
DROP TRIGGER IF EXISTS update_special_monitoring_updated_at ON public.special_monitoring;

-- Recreate triggers for updated_at
CREATE TRIGGER update_radio_stations_updated_at
BEFORE UPDATE ON public.radio_stations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_special_monitoring_updated_at
BEFORE UPDATE ON public.special_monitoring
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
