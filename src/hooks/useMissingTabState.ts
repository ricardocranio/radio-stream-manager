/**
 * useMissingTabState - Manages filtering, grouping, selection and export for missing songs tab
 */
import { useState, useMemo, useCallback } from 'react';
import { useRadioStore, MissingSong } from '@/store/radioStore';
import { useToast } from '@/hooks/use-toast';
import { normalizeArtistForDedup, normalizeTitleForDedup } from '@/lib/normalizeForDedup';

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

// Demo missing songs for display when no real data
const demoMissing: MissingSong[] = [
  { id: '1', title: 'Bohemian Rhapsody', artist: 'Queen', station: 'BH FM', timestamp: new Date(), status: 'missing' },
  { id: '2', title: 'Shallow', artist: 'Lady Gaga', station: 'Band FM', timestamp: new Date(), status: 'missing' },
  { id: '3', title: 'Blinding Lights', artist: 'The Weeknd', station: 'Clube FM', timestamp: new Date(), status: 'missing' },
  { id: '4', title: 'Dance Monkey', artist: 'Tones and I', station: 'Band FM', timestamp: new Date(), status: 'missing' },
  { id: '5', title: 'Watermelon Sugar', artist: 'Harry Styles', station: 'BH FM', timestamp: new Date(), status: 'missing' },
];

export function useMissingTabState() {
  const { missingSongs } = useRadioStore();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');

  const displaySongs = missingSongs.length > 0 ? missingSongs : demoMissing;

  const filteredSongs = useMemo(() => {
    if (!searchTerm) return displaySongs;
    const normalizedSearch = normalizeArtistForDedup(searchTerm).toLowerCase();
    return displaySongs.filter(
      (song) =>
        normalizeTitleForDedup(song.title).toLowerCase().includes(normalizedSearch) ||
        normalizeArtistForDedup(song.artist).toLowerCase().includes(normalizedSearch)
    );
  }, [displaySongs, searchTerm]);

  const groupedByStation = useMemo(() =>
    filteredSongs.reduce((acc, song) => {
      if (!acc[song.station]) acc[song.station] = [];
      acc[song.station].push(song);
      return acc;
    }, {} as Record<string, MissingSong[]>),
    [filteredSongs]
  );

  const handleExportMissing = useCallback((format: 'txt' | 'csv') => {
    if (filteredSongs.length === 0) {
      toast({ title: 'Lista vazia', description: 'Não há músicas faltando para exportar.', variant: 'destructive' });
      return;
    }

    let content = '';
    const filename = `musicas_faltando_${new Date().toISOString().split('T')[0]}`;

    if (format === 'txt') {
      content = `MÚSICAS FALTANDO - Exportado em ${new Date().toLocaleString('pt-BR')}\n`;
      content += `Total: ${filteredSongs.length} músicas\n`;
      content += '='.repeat(60) + '\n\n';
      Object.entries(groupedByStation).forEach(([station, songs]) => {
        content += `\n[${station}] - ${songs.length} músicas\n`;
        content += '-'.repeat(40) + '\n';
        songs.forEach(song => { content += `${song.artist} - ${song.title}\n`; });
      });
    } else {
      content = '\uFEFF' + 'Artista;Música;Emissora;Data;Urgência\n';
      filteredSongs.forEach(song => {
        const date = new Date(song.timestamp).toLocaleString('pt-BR');
        content += `"${song.artist}";"${song.title}";"${song.station}";"${date}";"${song.urgency || 'normal'}"\n`;
      });
    }

    const blob = new Blob([content], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({ title: '📥 Lista exportada!', description: `${filteredSongs.length} músicas exportadas para ${filename}.${format}` });
  }, [filteredSongs, groupedByStation, toast]);

  const getSearchUrl = useCallback((artist: string, title: string, service: 'deezer' | 'youtube') => {
    const query = encodeURIComponent(`${artist} ${title}`);
    return service === 'deezer'
      ? `https://www.deezer.com/search/${query}`
      : `https://www.youtube.com/results?search_query=${query}`;
  }, []);

  const openExternalLink = useCallback((url: string) => {
    if (isElectron && window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  }, []);

  return {
    searchTerm, setSearchTerm,
    filteredSongs, groupedByStation, displaySongs,
    handleExportMissing, getSearchUrl, openExternalLink,
    isDemo: missingSongs.length === 0,
  };
}
