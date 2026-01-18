import { supabase } from '@/integrations/supabase/client';

export interface RecognizedSong {
  title: string;
  artist: string;
  album?: string;
  spotifyId?: string;
  deezerId?: number;
}

export interface AudioRecognitionResult {
  success: boolean;
  stationName: string;
  song?: RecognizedSong;
  error?: string;
  source: 'audd' | 'acrcloud';
  needsConfig?: boolean;
}

export interface StreamMonitorResult {
  success: boolean;
  stationName: string;
  streamId?: string;
  message?: string;
  error?: string;
}

// Stream URLs for Brazilian radio stations (direct audio streams)
export const radioStreamUrls: Record<string, string> = {
  'BH FM': 'https://stream.zeno.fm/efd8ysn7qzzuv', // Example - may need actual stream URL
  'Clube FM': 'https://stream.zeno.fm/2pq2h3v9qzzuv', // Example
  'Band FM': 'https://stream.zeno.fm/9q7s4mfyfzzuv', // Example
  'Show FM 101.1': 'https://stream.zeno.fm/showfm101', // Example - needs real URL
};

export const audioRecognitionApi = {
  /**
   * Identify the currently playing song from a radio stream URL
   */
  async identifySong(streamUrl: string, stationName: string): Promise<AudioRecognitionResult> {
    try {
      const { data, error } = await supabase.functions.invoke('audio-recognition', {
        body: {
          streamUrl,
          stationName,
          mode: 'single',
        },
      });

      if (error) {
        console.error('Error calling audio-recognition:', error);
        return {
          success: false,
          stationName,
          error: error.message,
          source: 'audd',
        };
      }

      return data as AudioRecognitionResult;
    } catch (error) {
      console.error('Error in identifySong:', error);
      return {
        success: false,
        stationName,
        error: error instanceof Error ? error.message : 'Unknown error',
        source: 'audd',
      };
    }
  },

  /**
   * Add a stream for continuous monitoring (AudD paid feature)
   */
  async addStreamMonitoring(streamUrl: string, stationName: string): Promise<StreamMonitorResult> {
    try {
      const { data, error } = await supabase.functions.invoke('audio-recognition', {
        body: {
          streamUrl,
          stationName,
          mode: 'stream',
        },
      });

      if (error) {
        console.error('Error adding stream for monitoring:', error);
        return {
          success: false,
          stationName,
          error: error.message,
        };
      }

      return data as StreamMonitorResult;
    } catch (error) {
      console.error('Error in addStreamMonitoring:', error);
      return {
        success: false,
        stationName,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },

  /**
   * Get known stream URL for a station
   */
  getStreamUrl(stationName: string): string | undefined {
    return radioStreamUrls[stationName];
  },

  /**
   * List stations with known stream URLs
   */
  getAvailableStations(): string[] {
    return Object.keys(radioStreamUrls);
  },
};
