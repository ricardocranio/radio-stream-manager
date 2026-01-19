-- Create table for special monitoring schedules
CREATE TABLE public.special_monitoring (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  station_name TEXT NOT NULL,
  scrape_url TEXT NOT NULL,
  start_hour INTEGER NOT NULL CHECK (start_hour >= 0 AND start_hour <= 23),
  start_minute INTEGER NOT NULL CHECK (start_minute >= 0 AND start_minute <= 59),
  end_hour INTEGER NOT NULL CHECK (end_hour >= 0 AND end_hour <= 23),
  end_minute INTEGER NOT NULL CHECK (end_minute >= 0 AND end_minute <= 59),
  week_days TEXT[] NOT NULL DEFAULT ARRAY['seg', 'ter', 'qua', 'qui', 'sex'],
  label TEXT,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security (public access for now)
ALTER TABLE public.special_monitoring ENABLE ROW LEVEL SECURITY;

-- Allow public read access
CREATE POLICY "Public can read special monitoring" 
ON public.special_monitoring 
FOR SELECT 
USING (true);

-- Allow public insert
CREATE POLICY "Public can insert special monitoring" 
ON public.special_monitoring 
FOR INSERT 
WITH CHECK (true);

-- Allow public update
CREATE POLICY "Public can update special monitoring" 
ON public.special_monitoring 
FOR UPDATE 
USING (true);

-- Allow public delete
CREATE POLICY "Public can delete special monitoring" 
ON public.special_monitoring 
FOR DELETE 
USING (true);

-- Add trigger for updated_at
CREATE TRIGGER update_special_monitoring_updated_at
BEFORE UPDATE ON public.special_monitoring
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for special monitoring
ALTER PUBLICATION supabase_realtime ADD TABLE public.special_monitoring;