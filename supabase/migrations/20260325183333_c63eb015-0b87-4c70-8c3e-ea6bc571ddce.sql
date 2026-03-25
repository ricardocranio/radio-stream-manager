
CREATE OR REPLACE FUNCTION public.normalize_feat_conjunctions(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          input,
          '\m(feat\.?|ft\.?|Feat\.?|Ft\.?|featuring|part\.?)\M', 'feat', 'gi'
        ),
        '\s*&\s*', ' feat ', 'g'
      ),
      '\s+e\s+', ' feat ', 'gi'
    ),
    '\s+', ' ', 'g'
  );
$$;

CREATE OR REPLACE FUNCTION public.prevent_duplicate_songs()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS(
    SELECT 1 FROM scraped_songs
    WHERE station_name = NEW.station_name
      AND lower(trim(normalize_feat_conjunctions(artist))) = lower(trim(normalize_feat_conjunctions(NEW.artist)))
      AND lower(trim(normalize_feat_conjunctions(title))) = lower(trim(normalize_feat_conjunctions(NEW.title)))
      AND scraped_at > (NOW() - INTERVAL '5 minutes')
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_duplicate_historico()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS(
    SELECT 1 FROM radio_historico
    WHERE station_name = NEW.station_name
      AND LOWER(TRIM(normalize_feat_conjunctions(artist))) = LOWER(TRIM(normalize_feat_conjunctions(NEW.artist)))
      AND LOWER(TRIM(normalize_feat_conjunctions(title))) = LOWER(TRIM(normalize_feat_conjunctions(NEW.title)))
      AND captured_at > (NOW() - INTERVAL '10 minutes')
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$;
