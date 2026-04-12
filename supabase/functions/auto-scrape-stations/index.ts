import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ScrapedSong {
  title: string;
  artist: string;
  timestamp: string;
}

interface RadioStation {
  id: string;
  name: string;
  scrape_url: string;
  styles: string[];
  enabled: boolean;
  monitoring_start_hour: number | null;
  monitoring_start_minute: number;
  monitoring_end_hour: number | null;
  monitoring_end_minute: number;
  monitoring_week_days: string[];
  stream_url: string | null;
}

interface SpecialMonitoring {
  id: string;
  station_name: string;
  scrape_url: string;
  start_hour: number;
  start_minute: number;
  end_hour: number;
  end_minute: number;
  week_days: string[];
  label: string | null;
  enabled: boolean;
}

// ===== Schedule Helpers =====

function getBrazilTime(now: Date): { hour: number; minute: number; dayIndex: number } {
  const brStr = now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' });
  const br = new Date(brStr);
  return { hour: br.getHours(), minute: br.getMinutes(), dayIndex: br.getDay() };
}

const dayMap: Record<number, string> = { 0: 'dom', 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sab' };

function isWithinSchedule(schedule: SpecialMonitoring, now: Date): boolean {
  const { hour, minute, dayIndex } = getBrazilTime(now);
  if (schedule.week_days?.length > 0 && !schedule.week_days.includes(dayMap[dayIndex])) return false;
  const currentMins = hour * 60 + minute;
  const startMins = schedule.start_hour * 60 + schedule.start_minute;
  const endMins = schedule.end_hour * 60 + schedule.end_minute;
  if (startMins <= endMins) return currentMins >= startMins && currentMins <= endMins;
  return currentMins >= startMins || currentMins <= endMins;
}

function isStationActiveNow(station: RadioStation, now: Date): boolean {
  if (station.monitoring_start_hour === null || station.monitoring_end_hour === null) return true;
  const { hour, minute, dayIndex } = getBrazilTime(now);
  if (station.monitoring_week_days?.length > 0 && !station.monitoring_week_days.includes(dayMap[dayIndex])) return false;
  const currentMins = hour * 60 + minute;
  const startMins = station.monitoring_start_hour * 60 + station.monitoring_start_minute;
  const endMins = station.monitoring_end_hour * 60 + station.monitoring_end_minute;
  if (startMins <= endMins) return currentMins >= startMins && currentMins <= endMins;
  return currentMins >= startMins || currentMins <= endMins;
}

const BATCH_SIZE = 4;

// ===== Triton Digital Now Playing API =====
// This works for ALL StreamTheWorld stations (BH FM, Band FM, Clube FM, Mix FM, Globo RJ, etc.)

const STREAM_TO_MOUNT: Record<string, string> = {
  'BHFMAAC': 'BHFMAAC',
  'BANDFM_SP': 'BANDFM_SP',
  'CLUBEFM_BRASILIA': 'CLUBEFM_BRASILIA',
  'METROFM': 'METROFM',
  'MIXFM_SAOPAULOAAC': 'MIXFM_SAOPAULOAAC',
  'RADIOGLOBO_RJ': 'RADIOGLOBO_RJ',
  'ENERGIA97FM': 'ENERGIA97FM',
};

function getMountName(streamUrl: string | null): string | null {
  if (!streamUrl) return null;
  // Extract mount name from StreamTheWorld URL
  const match = streamUrl.match(/livestream-redirect\/([A-Z0-9_]+)/i);
  if (match) {
    // Remove file extension
    return match[1].replace(/\.(mp3|aac|ogg)$/i, '');
  }
  return null;
}

async function fetchTritonNowPlaying(mountName: string, stationName: string): Promise<{ artist: string; title: string } | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    
    const url = `https://np.tritondigital.com/public/nowplaying?mountName=${mountName}&numberToFetch=5&eventType=track`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/xml, text/xml',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.warn(`[${stationName}] Triton API HTTP ${response.status}`);
      return null;
    }
    
    const xml = await response.text();
    
    // Parse XML for nowplaying-info
    // Format: <nowplaying-info><property name="track_artist_name">ARTIST</property><property name="cue_title">TITLE</property></nowplaying-info>
    const artistMatch = xml.match(/<property\s+name="track_artist_name"[^>]*>([^<]+)<\/property>/i);
    const titleMatch = xml.match(/<property\s+name="cue_title"[^>]*>([^<]+)<\/property>/i);
    
    if (!artistMatch?.[1] || !titleMatch?.[1]) {
      // Try alternate XML format
      const altArtist = xml.match(/<property\s+name="cue_title"[^>]*>([^<]+)<\/property>/i);
      const fullTitle = altArtist?.[1] || '';
      if (fullTitle.includes(' - ')) {
        const [a, t] = fullTitle.split(' - ', 2);
        if (a.trim().length >= 2 && t.trim().length >= 2) {
          console.log(`[${stationName}] Triton (alt): ${a.trim()} - ${t.trim()}`);
          return { artist: a.trim(), title: t.trim() };
        }
      }
      console.warn(`[${stationName}] Triton: no track data in XML`);
      return null;
    }
    
    const artist = artistMatch[1].trim();
    const title = titleMatch[1].trim();
    
    if (artist.length < 2 || title.length < 2) return null;
    
    // Reject non-song entries
    const rejectPatterns = [
      /COMERCIAL|VINHETA|INSTITUCIONAL|PROPAGANDA|SPOT|BREAK/i,
      /^(RÁDIO|RADIO)\s/i,
      /^(BH FM|BAND FM|CLUBE FM|MIX FM|GLOBO|METROPOLITANA)/i,
    ];
    if (rejectPatterns.some(p => p.test(artist) || p.test(title))) return null;
    
    console.log(`[${stationName}] Triton: ${artist} - ${title}`);
    return { artist, title };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      console.warn(`[${stationName}] Triton timeout`);
    } else {
      console.warn(`[${stationName}] Triton error:`, e instanceof Error ? e.message : 'Unknown');
    }
    return null;
  }
}

// ===== Triton: fetch recent tracks =====

async function fetchTritonRecent(mountName: string, stationName: string): Promise<ScrapedSong[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    
    const url = `https://np.tritondigital.com/public/nowplaying?mountName=${mountName}&numberToFetch=10&eventType=track`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/xml, text/xml' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) return [];
    const xml = await response.text();
    
    const songs: ScrapedSong[] = [];
    const blocks = xml.split('</nowplaying-info>');
    
    for (const block of blocks) {
      const artistMatch = block.match(/<property\s+name="track_artist_name"[^>]*>([^<]+)<\/property>/i);
      const titleMatch = block.match(/<property\s+name="cue_title"[^>]*>([^<]+)<\/property>/i);
      if (artistMatch?.[1] && titleMatch?.[1]) {
        const artist = artistMatch[1].trim();
        const title = titleMatch[1].trim();
        if (artist.length >= 2 && title.length >= 2) {
          if (!songs.some(s => s.artist === artist && s.title === title)) {
            songs.push({ artist, title, timestamp: new Date().toISOString() });
          }
        }
      }
    }
    
    return songs.slice(1); // Skip first (now playing), return rest as recent
  } catch {
    return [];
  }
}

// ===== ICY Metadata Fallback (improved with redirect following) =====

async function resolveStreamUrl(streamUrl: string): Promise<string> {
  try {
    // Follow redirects to get final stream URL
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(streamUrl, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return resp.url || streamUrl;
  } catch {
    return streamUrl;
  }
}

async function fetchIcyMetadata(streamUrl: string, stationName: string): Promise<{ artist: string; title: string } | null> {
  // Try both original and resolved URLs
  const urlsToTry = [streamUrl];
  try {
    const resolved = await resolveStreamUrl(streamUrl);
    console.log(`[${stationName}] ICY resolved: ${resolved.substring(0, 80)}`);
    if (resolved !== streamUrl) urlsToTry.push(resolved);
  } catch { /* continue */ }

  for (const url of urlsToTry) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 18000);

      const response = await fetch(url, {
        headers: { 'Icy-MetaData': '1', 'User-Agent': 'WinampMPEG/5.0', 'Accept': '*/*', 'Connection': 'close' },
        signal: controller.signal,
      });

      const metaInt = parseInt(response.headers.get('icy-metaint') || '0', 10);
      if (!metaInt || !response.body) {
        clearTimeout(timeoutId);
        await response.body?.cancel();
        console.warn(`[${stationName}] No ICY metadata support (metaint=${metaInt})`);
        continue;
      }

      const reader = response.body.getReader();
      let buffer = new Uint8Array(0);
      const MAX_BLOCKS = 8;

      const appendBuffer = (existing: Uint8Array, chunk: Uint8Array): Uint8Array => {
        const result = new Uint8Array(existing.length + chunk.length);
        result.set(existing, 0);
        result.set(chunk, existing.length);
        return result;
      };

      const targetBytes = (metaInt + 256) * MAX_BLOCKS;
      while (buffer.length < targetBytes) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        buffer = appendBuffer(buffer, value);
      }

      clearTimeout(timeoutId);
      await reader.cancel();

      let pos = 0;
      for (let block = 0; block < MAX_BLOCKS; block++) {
        if (pos + metaInt >= buffer.length) break;
        pos += metaInt;
        if (pos >= buffer.length) break;
        const metaLength = buffer[pos] * 16;
        pos += 1;
        if (metaLength === 0) continue;
        if (pos + metaLength > buffer.length) break;

        const metaBytes = buffer.slice(pos, pos + metaLength);
        pos += metaLength;

        const metaString = new TextDecoder('utf-8', { fatal: false }).decode(metaBytes);
        // Handle apostrophes in titles (e.g. "GUNS N' ROSES - DON'T CRY")
        const titleMatch = metaString.match(/StreamTitle='(.+?)';/) || metaString.match(/StreamTitle='(.+)'/);
        if (!titleMatch?.[1]) continue;

        const streamTitle = titleMatch[1].trim();
        if (!streamTitle || streamTitle.length < 3) continue;

        const dashIdx = streamTitle.indexOf(' - ');
        if (dashIdx === -1) {
          console.log(`[${stationName}] ICY block ${block} no dash: "${streamTitle}"`);
          continue;
        }

        const artist = streamTitle.substring(0, dashIdx).trim();
        const title = streamTitle.substring(dashIdx + 3).trim();
        if (artist.length < 2 || title.length < 2) continue;

        const rejectPatterns = [
          /COMERCIAL|VINHETA|INSTITUCIONAL|PROPAGANDA|SPOT|BREAK/i,
          /^(RÁDIO|RADIO)\s/i,
        ];
        if (rejectPatterns.some(p => p.test(artist) || p.test(title))) continue;

        console.log(`[${stationName}] ICY metadata (block ${block}): ${artist} - ${title}`);
        return { artist, title };
      }

      console.log(`[${stationName}] ICY: ${MAX_BLOCKS} blocks read, no valid metadata found`);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        console.warn(`[${stationName}] ICY timeout`);
      } else {
        console.warn(`[${stationName}] ICY error:`, e instanceof Error ? e.message : 'Unknown');
      }
    }
  }

  return null;
}

// ===== OnlineRadioBox Parsing =====

function getOnlineRadioBoxUrl(scrapeUrl: string, stationName: string): string | null {
  if (scrapeUrl.includes('onlineradiobox.com')) {
    if (scrapeUrl.includes('/playlist')) return scrapeUrl;
    return scrapeUrl.replace(/\/?$/, '/playlist/');
  }

  const slugMap: Record<string, string> = {
    'band-fm': 'bandfm',
    'radio-bh-fm': 'bh',
    'radio-clube-fm-brasilia': 'clubefm',
    'radio-metropolitana-fm': 'metropolitana',
    'radio-globo-rj': 'globo',
    'mix-fm-sao-paulo': 'mixfm',
    'jovem-pan-fm-florianopolis': 'jovempan',
    'energia-97-fm': 'energia97',
    'positividade-fm': 'positividade',
    'positiva-fm': 'positiva',
    'radio-liberdade-fm': 'liberdade',
    'radio-blink-102-fm': 'blink102',
  };

  for (const [pattern, slug] of Object.entries(slugMap)) {
    if (scrapeUrl.includes(pattern)) {
      return `https://onlineradiobox.com/br/${slug}/playlist/`;
    }
  }

  const normalized = stationName
    .toLowerCase()
    .replace(/\s*(fm|am)\s*/gi, '')
    .replace(/rádio\s*/gi, '')
    .replace(/[^a-z0-9]/gi, '')
    .trim();
  if (normalized) return `https://onlineradiobox.com/br/${normalized}/playlist/`;
  return null;
}

async function fetchPageHtml(url: string, stationName: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) { console.warn(`[${stationName}] ORB HTTP ${response.status}`); return null; }
    return await response.text();
  } catch (e) {
    console.error(`[${stationName}] ORB fetch error:`, e instanceof Error ? e.message : 'Unknown');
    return null;
  }
}

function isValidSongText(text: string): boolean {
  if (!text || text.length < 3 || text.length > 150) return false;
  if (!text.includes(' - ')) return false;
  const rejectPatterns = [
    /^(METROPOLITANA|BH FM|BAND FM|CLUBE FM|GLOBO|MIX FM|ENERGIA|JOVEM PAN)/i,
    /^(RÁDIO|RADIO)\s/i,
    /COMERCIAL|VINHETA|INSTITUCIONAL|PROPAGANDA/i,
    /unfortunately.*did not provide/i,
  ];
  return !rejectPatterns.some(p => p.test(text));
}

function parseOnlineRadioBoxHtml(html: string, stationName: string): { nowPlaying?: ScrapedSong; recentSongs: ScrapedSong[] } {
  const songs: ScrapedSong[] = [];
  let nowPlaying: ScrapedSong | undefined;

  // Check if page has "did not provide a playlist" message
  if (html.includes('did not provide a playlist')) {
    console.warn(`[${stationName}] ORB: station did not provide playlist`);
    return { recentSongs: [] };
  }

  // Pattern 1: track_history_item with or without <a> tag
  const trackMatches = html.matchAll(/class="track_history_item"[^>]*>(?:\s*<a[^>]*>)?([^<]+)(?:<\/a>)?/gi);

  for (const match of trackMatches) {
    const rawText = match[1].trim();
    if (!isValidSongText(rawText)) continue;

    const dashIndex = rawText.indexOf(' - ');
    if (dashIndex === -1) continue;

    const artist = rawText.substring(0, dashIndex).trim();
    const title = rawText.substring(dashIndex + 3).trim();
    if (artist.length < 2 || title.length < 2) continue;

    // Skip station name entries (e.g. "METROPOLITANA - SP")
    if (/^(METROPOLITANA|BH FM|BAND FM|CLUBE FM|GLOBO|MIX FM) - /i.test(rawText)) continue;

    const song: ScrapedSong = { artist, title, timestamp: new Date().toISOString() };

    if (!nowPlaying) {
      nowPlaying = song;
      console.log(`[${stationName}] ORB now playing: ${artist} - ${title}`);
    } else if (!songs.some(s => s.title === title && s.artist === artist)) {
      songs.push(song);
    }
    if (songs.length >= 5) break;
  }

  return { nowPlaying, recentSongs: songs };
}

// ===== Station Processing =====

async function processStation(
  station: RadioStation,
  supabase: any,
  now: Date
): Promise<{ station: string; success: boolean; songs: number; error?: string; skipped?: boolean; source?: string }> {
  if (!isStationActiveNow(station, now)) {
    return { station: station.name, success: true, songs: 0, skipped: true };
  }

  let parsed: { nowPlaying?: ScrapedSong; recentSongs: ScrapedSong[] } = { recentSongs: [] };
  let sourceUsed = '';

  // === Source 1: OnlineRadioBox ===
  const orbUrl = getOnlineRadioBoxUrl(station.scrape_url, station.name);
  if (orbUrl) {
    console.log(`[${station.name}] Fetching ORB: ${orbUrl}`);
    const html = await fetchPageHtml(orbUrl, station.name);
    if (html && html.includes('track_history_item') && !html.includes('did not provide a playlist')) {
      parsed = parseOnlineRadioBoxHtml(html, station.name);
      if (parsed.nowPlaying) sourceUsed = 'onlineradiobox';
    } else {
      console.warn(`[${station.name}] ORB: no playlist data available`);
    }
  }

  // === Source 2: Triton Digital Now Playing API (for StreamTheWorld stations) ===
  if (!parsed.nowPlaying && station.stream_url) {
    const mountName = getMountName(station.stream_url);
    if (mountName) {
      console.log(`[${station.name}] Trying Triton API (mount: ${mountName})`);
      const tritonResult = await fetchTritonNowPlaying(mountName, station.name);
      if (tritonResult) {
        parsed.nowPlaying = { ...tritonResult, timestamp: new Date().toISOString() };
        sourceUsed = 'triton-api';
        
        const recentSongs = await fetchTritonRecent(mountName, station.name);
        if (recentSongs.length > 0) {
          parsed.recentSongs = recentSongs;
        }
      } else {
        // Try Triton without eventType filter (some stations use different event types)
        try {
          const altUrl = `https://np.tritondigital.com/public/nowplaying?mountName=${mountName}&numberToFetch=5`;
          const controller = new AbortController();
          const tid = setTimeout(() => controller.abort(), 6000);
          const resp = await fetch(altUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/xml, text/xml' },
            signal: controller.signal,
          });
          clearTimeout(tid);
          if (resp.ok) {
            const xml = await resp.text();
            if (!xml.includes('<nowplaying-info-list/>')) {
              const artistM = xml.match(/<property\s+name="track_artist_name"[^>]*>([^<]+)<\/property>/i);
              const titleM = xml.match(/<property\s+name="cue_title"[^>]*>([^<]+)<\/property>/i);
              if (artistM?.[1] && titleM?.[1] && artistM[1].trim().length >= 2 && titleM[1].trim().length >= 2) {
                parsed.nowPlaying = { artist: artistM[1].trim(), title: titleM[1].trim(), timestamp: new Date().toISOString() };
                sourceUsed = 'triton-api-alt';
                console.log(`[${station.name}] Triton (alt): ${artistM[1].trim()} - ${titleM[1].trim()}`);
              }
            }
          }
        } catch { /* ignore alt attempt */ }
      }
    }
  }

  // === Source 3: ICY Metadata (with redirect resolution) ===
  if (!parsed.nowPlaying && station.stream_url) {
    console.log(`[${station.name}] Trying ICY metadata from stream`);
    const icyResult = await fetchIcyMetadata(station.stream_url, station.name);
    if (icyResult) {
      parsed.nowPlaying = { ...icyResult, timestamp: new Date().toISOString() };
      sourceUsed = 'icy-stream';
    }
  }

  // === Source 4: Database fallback (Python monitor / previous scrapes) ===
  if (!parsed.nowPlaying && parsed.recentSongs.length === 0) {
    try {
      // Check radio_historico first (fed by Python monitor)
      const { data: historico } = await supabase
        .from('radio_historico')
        .select('artist, title, captured_at, source')
        .eq('station_name', station.name)
        .gte('captured_at', new Date(Date.now() - 60 * 60 * 1000).toISOString()) // last hour
        .order('captured_at', { ascending: false })
        .limit(6);

      if (historico && historico.length > 0) {
        parsed.nowPlaying = { artist: historico[0].artist, title: historico[0].title, timestamp: historico[0].captured_at };
        parsed.recentSongs = historico.slice(1).map(s => ({ artist: s.artist, title: s.title, timestamp: s.captured_at }));
        sourceUsed = `db-historico(${historico[0].source || 'monitor'})`;
        console.log(`[${station.name}] DB fallback: ${historico[0].artist} - ${historico[0].title}`);
      } else {
        // Try scraped_songs (previous edge function scrapes)
        const { data: scraped } = await supabase
          .from('scraped_songs')
          .select('artist, title, scraped_at, source')
          .eq('station_name', station.name)
          .gte('scraped_at', new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()) // last 6h
          .order('scraped_at', { ascending: false })
          .limit(6);

        if (scraped && scraped.length > 0) {
          parsed.nowPlaying = { artist: scraped[0].artist, title: scraped[0].title, timestamp: scraped[0].scraped_at };
          parsed.recentSongs = scraped.slice(1).map(s => ({ artist: s.artist, title: s.title, timestamp: s.scraped_at }));
          sourceUsed = `db-cache(${scraped[0].source || 'unknown'})`;
          console.log(`[${station.name}] DB cache fallback: ${scraped[0].artist} - ${scraped[0].title}`);
        }
      }
    } catch (dbErr) {
      console.warn(`[${station.name}] DB fallback error:`, dbErr instanceof Error ? dbErr.message : 'Unknown');
    }
  }

  if (!parsed.nowPlaying && parsed.recentSongs.length === 0) {
    return { station: station.name, success: false, songs: 0, error: 'No song data from any source (ORB/Triton/ICY/DB)' };
  }

  let songsInserted = 0;

  if (parsed.nowPlaying) {
    const { data: existing } = await supabase
      .from('scraped_songs').select('id')
      .eq('station_id', station.id)
      .ilike('title', parsed.nowPlaying.title)
      .ilike('artist', parsed.nowPlaying.artist)
      .gte('scraped_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
      .limit(1);

    if (!existing || existing.length === 0) {
      const { error: insertError } = await supabase.from('scraped_songs').insert({
        station_id: station.id,
        station_name: station.name,
        title: parsed.nowPlaying.title,
        artist: parsed.nowPlaying.artist,
        is_now_playing: true,
        source: sourceUsed,
      });
      if (!insertError) {
        songsInserted++;
        console.log(`[${station.name}] ✅ Inserted: ${parsed.nowPlaying.artist} - ${parsed.nowPlaying.title} (${sourceUsed})`);
      }
    }
  }

  for (const song of parsed.recentSongs) {
    const { data: existing } = await supabase
      .from('scraped_songs').select('id')
      .eq('station_id', station.id)
      .ilike('title', song.title).ilike('artist', song.artist)
      .gte('scraped_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .limit(1);
    if (!existing || existing.length === 0) {
      const { error: insertError } = await supabase.from('scraped_songs').insert({
        station_id: station.id, station_name: station.name,
        title: song.title, artist: song.artist,
        is_now_playing: false, source: sourceUsed,
      });
      if (!insertError) songsInserted++;
    }
  }

  return { station: station.name, success: true, songs: songsInserted, source: sourceUsed };
}

async function processSpecialMonitoring(
  schedule: SpecialMonitoring,
  supabase: any
): Promise<{ station: string; success: boolean; songs: number; error?: string }> {
  const orbUrl = getOnlineRadioBoxUrl(schedule.scrape_url, schedule.station_name);
  if (!orbUrl) {
    return { station: `[ESPECIAL] ${schedule.station_name}`, success: false, songs: 0, error: 'No ORB URL' };
  }

  console.log(`[ESPECIAL ${schedule.station_name}] Fetching: ${orbUrl}`);
  const html = await fetchPageHtml(orbUrl, schedule.station_name);

  if (!html || html.includes('did not provide a playlist') || (!html.includes('track_history_item') && !html.includes('tablelist-schedule'))) {
    return { station: `[ESPECIAL] ${schedule.station_name}`, success: false, songs: 0, error: 'No playlist data' };
  }

  const parsed = parseOnlineRadioBoxHtml(html, schedule.station_name);
  let songsInserted = 0;

  if (parsed.nowPlaying) {
    const { data: existing } = await supabase
      .from('scraped_songs').select('id')
      .eq('station_name', schedule.station_name)
      .ilike('title', parsed.nowPlaying.title).ilike('artist', parsed.nowPlaying.artist)
      .gte('scraped_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
      .limit(1);
    if (!existing || existing.length === 0) {
      const { error: insertError } = await supabase.from('scraped_songs').insert({
        station_name: schedule.station_name,
        title: parsed.nowPlaying.title, artist: parsed.nowPlaying.artist,
        is_now_playing: true, source: 'onlineradiobox',
      });
      if (!insertError) {
        songsInserted++;
        console.log(`[ESPECIAL ${schedule.station_name}] ✅ Inserted: ${parsed.nowPlaying.artist} - ${parsed.nowPlaying.title}`);
      }
    }
  }

  return { station: `[ESPECIAL] ${schedule.station_name}`, success: true, songs: songsInserted };
}

// ===== Main Handler =====

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log('=== AUTO-SCRAPE v3.0 (ORB + Triton + ICY) ===');

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: stations, error: stationsError } = await supabase
      .from('radio_stations').select('*').eq('enabled', true);

    if (stationsError) {
      return new Response(
        JSON.stringify({ success: false, error: stationsError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${stations?.length || 0} enabled stations`);

    const results: any[] = [];
    const now = new Date();
    const stationList = (stations || []) as RadioStation[];

    for (let i = 0; i < stationList.length; i += BATCH_SIZE) {
      const batch = stationList.slice(i, i + BATCH_SIZE);
      console.log(`\n--- Batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.map(s => s.name).join(', ')}) ---`);
      const batchResults = await Promise.all(
        batch.map(station => processStation(station, supabase, now))
      );
      results.push(...batchResults);
      if (i + BATCH_SIZE < stationList.length) await new Promise(r => setTimeout(r, 200));
    }

    // Special monitoring
    console.log('\n=== Processing Special Monitoring ===');
    const { data: specialMonitoring } = await supabase
      .from('special_monitoring').select('*').eq('enabled', true);

    if (specialMonitoring && specialMonitoring.length > 0) {
      const activeSchedules = (specialMonitoring as SpecialMonitoring[]).filter(s => isWithinSchedule(s, now));
      if (activeSchedules.length > 0) {
        console.log(`Active special schedules: ${activeSchedules.map(s => s.station_name).join(', ')}`);
        const specialResults = await Promise.all(
          activeSchedules.map(s => processSpecialMonitoring(s, supabase))
        );
        results.push(...specialResults);
      } else {
        console.log('No active special monitoring schedules');
      }
    }

    const successCount = results.filter(r => r.success && !r.skipped).length;
    const failedCount = results.filter(r => !r.success).length;
    const totalSongs = results.reduce((sum, r) => sum + (r.songs || 0), 0);
    const elapsed = Date.now() - startTime;

    console.log(`\n=== COMPLETED in ${elapsed}ms ===`);
    console.log(`Success: ${successCount}, Failed: ${failedCount}, Songs: ${totalSongs}`);
    
    // Log sources used
    const sources = results.filter(r => r.source).map(r => `${r.station}:${r.source}`);
    if (sources.length > 0) console.log(`Sources: ${sources.join(', ')}`);

    return new Response(
      JSON.stringify({
        success: true,
        results,
        summary: { success: successCount, failed: failedCount, songs: totalSongs, elapsed },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Fatal error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
