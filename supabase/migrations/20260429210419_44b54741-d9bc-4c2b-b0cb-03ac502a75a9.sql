-- Update the function with explicit search_path for security
CREATE OR REPLACE FUNCTION public.prevent_scraped_songs_duplicates()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if the same song was already inserted for this station in the last 15 minutes
  IF EXISTS (
    SELECT 1 
    FROM public.scraped_songs 
    WHERE station_name = NEW.station_name 
      AND lower(trim(artist)) = lower(trim(NEW.artist))
      AND lower(trim(title)) = lower(trim(NEW.title))
      AND scraped_at > (NEW.scraped_at - INTERVAL '15 minutes')
    LIMIT 1
  ) THEN
    -- If duplicate found, skip the insertion
    RETURN NULL;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
