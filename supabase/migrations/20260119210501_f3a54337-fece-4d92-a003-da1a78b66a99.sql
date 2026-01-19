-- Enable realtime for scraped_songs table to receive live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.scraped_songs;

-- Also enable for radio_stations for consistency
ALTER PUBLICATION supabase_realtime ADD TABLE public.radio_stations;