#!/usr/bin/env python3
"""
╔═══════════════════════════════════════════════════════════════════════════════╗
║                     MONITOR DE RÁDIOS - TEMPO REAL v3.5                      ║
║                          INTEGRADO COM SUPABASE                               ║
║                                                                               ║
║  MELHORIAS v3.5:                                                              ║
║  - Buffer de frescor em memória (janela 15 min, histórico 60 min)            ║
║  - Build pool ponderado: rádios ativas ganham mais slots de scraping         ║
║  - Envio em batch ao Supabase (após ciclo completo, menos latência)          ║
║  - Resumo de frescor por rádio ao final de cada ciclo                        ║
║                                                                               ║
║  v3.0:                                                                        ║
║  - HTTP-first: OnlineRadioBox + Triton API antes de Playwright               ║
║  - Triton Digital Now Playing API para emissoras StreamTheWorld               ║
║  - ICY metadata com resolução de redirect                                     ║
║  - Playwright apenas como último recurso (MyTuner)                            ║
║  - Respeita horários de monitoramento por emissora                           ║
║  - Reutiliza browser entre ciclos (menos CPU/RAM)                            ║
║  - Timeout por emissora (evita travamento total)                             ║
║  - Suporta tabela special_monitoring                                          ║
║  - Scraping semi-paralelo (batches de 3)                                     ║
║  - Signal handling para shutdown limpo                                        ║
║                                                                               ║
║  Autor: Audio Solutions | Data: Março 2026                                    ║
╚═══════════════════════════════════════════════════════════════════════════════╝
"""

import subprocess
import sys
import os
import signal

# ═══════════════════════════════════════════════════════════════════════════════
# AUTO-INSTALAÇÃO DE DEPENDÊNCIAS
# ═══════════════════════════════════════════════════════════════════════════════

def instalar_pacote(pacote):
    """Instala um pacote pip"""
    try:
        subprocess.check_call(
            [sys.executable, '-m', 'pip', 'install', pacote, '-q', '--upgrade'],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        return True
    except:
        try:
            subprocess.check_call(
                [sys.executable, '-m', 'pip', 'install', pacote, '-q', '--upgrade', '--user'],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            return True
        except:
            return False

def verificar_e_instalar_dependencias():
    """Verifica e instala automaticamente todas as dependências"""
    
    print("╔" + "═" * 60 + "╗")
    print("║" + " 🔧 VERIFICANDO DEPENDÊNCIAS ".center(60) + "║")
    print("╚" + "═" * 60 + "╝")
    print()
    
    dependencias = {
        'playwright': 'playwright',
        'requests': 'requests',
        'beautifulsoup4': 'bs4',
    }
    
    todas_instaladas = True
    
    for pacote, modulo in dependencias.items():
        try:
            __import__(modulo)
            print(f"  ✅ {pacote} - OK")
        except ImportError:
            print(f"  📦 Instalando {pacote}...")
            if instalar_pacote(pacote):
                print(f"  ✅ {pacote} - Instalado")
            else:
                print(f"  ❌ {pacote} - Falha (tente: pip install {pacote})")
                todas_instaladas = False
    
    # Verificar Chromium
    print()
    print("  🌐 Verificando navegador Chromium...")
    
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            try:
                browser = p.chromium.launch(headless=True)
                browser.close()
                print("  ✅ Chromium - OK")
            except:
                print("  📦 Instalando Chromium...")
                try:
                    subprocess.run(
                        [sys.executable, '-m', 'playwright', 'install', 'chromium'],
                        capture_output=True
                    )
                    print("  ✅ Chromium - Instalado")
                except:
                    print("  ⚠️  Execute: playwright install chromium")
    except:
        pass
    
    print()
    return todas_instaladas

# Verificar dependências
verificar_e_instalar_dependencias()

# ═══════════════════════════════════════════════════════════════════════════════
# IMPORTS
# ═══════════════════════════════════════════════════════════════════════════════

import asyncio
import json
import re
import socket
import struct
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional
from xml.etree import ElementTree

try:
    from playwright.async_api import async_playwright, Page, Browser
    PLAYWRIGHT_OK = True
except ImportError:
    PLAYWRIGHT_OK = False

import requests as http_requests
from bs4 import BeautifulSoup

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURAÇÃO DO SUPABASE (REST API DIRETO - sem SDK)
# ═══════════════════════════════════════════════════════════════════════════════

SUPABASE_URL = "https://liuyuvxbdmowtidjhfnc.supabase.co"
SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpdXl1dnhiZG1vd3RpZGpoZm5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg3NTMzOTIsImV4cCI6MjA4NDMyOTM5Mn0.S-dt-yzcHn9g3u3K6fTGJbNNPPX-K0wMQFEwh3s7eTc"

SUPABASE_HEADERS = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': f'Bearer {SUPABASE_ANON_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
}

def supabase_insert(table: str, data: dict) -> bool:
    """Insere dados no Supabase via REST API"""
    try:
        url = f"{SUPABASE_URL}/rest/v1/{table}"
        resp = http_requests.post(url, json=data, headers=SUPABASE_HEADERS, timeout=10)
        if resp.status_code in (200, 201, 204):
            return True
        else:
            print(f"     ⚠️  Supabase HTTP {resp.status_code}: {resp.text[:80]}")
            return False
    except Exception as e:
        print(f"     ⚠️  Erro REST: {str(e)[:60]}")
        return False

def supabase_select(table: str, params: dict = None) -> list:
    """Busca dados do Supabase via REST API"""
    try:
        url = f"{SUPABASE_URL}/rest/v1/{table}"
        headers = {**SUPABASE_HEADERS, 'Prefer': 'return=representation'}
        resp = http_requests.get(url, params=params or {}, headers=headers, timeout=10)
        if resp.status_code == 200:
            return resp.json()
        return []
    except:
        return []

def verificar_conexao_supabase() -> bool:
    """Testa conexão com Supabase"""
    try:
        resp = http_requests.get(
            f"{SUPABASE_URL}/rest/v1/radio_stations?select=id&limit=1",
            headers=SUPABASE_HEADERS,
            timeout=10
        )
        return resp.status_code == 200
    except:
        return False

# Verificar conexão inicial
SUPABASE_OK = False
try:
    print("  🔍 Testando conexão com Supabase...")
    print(f"     URL: {SUPABASE_URL[:40]}...")
    _test = http_requests.get(
        f"{SUPABASE_URL}/rest/v1/radio_stations?select=id&limit=1",
        headers=SUPABASE_HEADERS,
        timeout=10
    )
    print(f"     HTTP Status: {_test.status_code}")
    if _test.status_code == 200:
        SUPABASE_OK = True
        print("  ✅ Supabase conectado (REST API)!")
    else:
        print(f"  ⚠️  Supabase retornou HTTP {_test.status_code}")
        print(f"     Response: {_test.text[:200]}")
except http_requests.exceptions.ConnectionError as e:
    print(f"  ❌ Erro de conexão: {str(e)[:100]}")
except http_requests.exceptions.Timeout:
    print("  ❌ Timeout ao conectar ao Supabase (>10s)")
except Exception as e:
    print(f"  ❌ Erro inesperado: {type(e).__name__}: {str(e)[:100]}")

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURAÇÃO LOCAL
# ═══════════════════════════════════════════════════════════════════════════════

if os.name == 'nt':
    _DATA_DIR = os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), 'Programador de Radio', 'RadioMonitor')
else:
    _DATA_DIR = os.path.join(os.path.expanduser('~'), '.radio-monitor')

os.makedirs(_DATA_DIR, exist_ok=True)
print(f"  📁 Pasta de dados: {_DATA_DIR}")

# ═══════════════════════════════════════════════════════════════════════════════
# PALAVRAS PROIBIDAS E ARTISTAS BLOQUEADOS
# ═══════════════════════════════════════════════════════════════════════════════

FORBIDDEN_WORDS = [
    '1.fm', 'love classics', 'solitaire', 'mahjong', 'dayspedia', 'games', 'online',
    'metropolitana - sp', 'band fm', 'globo fm', 'mix fm', 'jovem pan', 'transamérica',
    'nativa fm', 'antena 1', 'alpha fm', '89 fm', 'kiss fm', 'energia 97', 'rádio disney',
    'rede aleluia', '105 fm', 'cidade fm', 'tupi fm', 'capital fm', 'nova brasil fm',
    'rádio bandeirantes', 'hino do', 'mengão', 'timão', 'verdão', 'tricolor', 'peixe',
    'cruzmaltino', 'circus music', 'the hit crew kids', 'farroupilha',
    'comercial', 'vinheta', 'institucional', 'propaganda', 'libretime',
]

BLOCKED_ARTISTS = [
    'xuxa', 'padre marcelo rossi', 'circus music', 'the hit crew kids', 'eurides nunes',
    'libretime',
]

def is_forbidden(artist: str, title: str) -> bool:
    """Verifica se a música deve ser bloqueada"""
    combined = f"{artist} - {title}".lower()
    for word in FORBIDDEN_WORDS:
        if word in combined:
            return True
    artist_lower = artist.lower().strip()
    for blocked in BLOCKED_ARTISTS:
        if blocked in artist_lower:
            return True
    return False

# ═══════════════════════════════════════════════════════════════════════════════
# MAPEAMENTO DE DIAS DA SEMANA
# ═══════════════════════════════════════════════════════════════════════════════

WEEKDAY_MAP = {
    0: 'seg', 1: 'ter', 2: 'qua', 3: 'qui', 4: 'sex', 5: 'sab', 6: 'dom'
}

def is_within_schedule(station: dict) -> bool:
    """Verifica se a emissora deve ser monitorada agora (horário + dia da semana)"""
    now = datetime.now()
    current_day = WEEKDAY_MAP[now.weekday()]
    current_minutes = now.hour * 60 + now.minute
    
    week_days = station.get('monitoring_week_days') or station.get('week_days')
    if week_days and current_day not in week_days:
        return False
    
    start_hour = station.get('monitoring_start_hour') or station.get('start_hour')
    end_hour = station.get('monitoring_end_hour') or station.get('end_hour')
    
    if start_hour is not None and end_hour is not None:
        start_min = station.get('monitoring_start_minute') or station.get('start_minute') or 0
        end_min = station.get('monitoring_end_minute') or station.get('end_minute') or 0
        
        start_total = start_hour * 60 + start_min
        end_total = end_hour * 60 + end_min
        
        if start_total <= end_total:
            if not (start_total <= current_minutes <= end_total):
                return False
        else:
            if end_total < current_minutes < start_total:
                return False
    
    return True

# ═══════════════════════════════════════════════════════════════════════════════
# MAPEAMENTO OnlineRadioBox
# ═══════════════════════════════════════════════════════════════════════════════

ORB_SLUG_MAP = {
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
}

def get_orb_url(scrape_url: str, station_name: str) -> Optional[str]:
    """Converte URL de scraping para OnlineRadioBox playlist URL"""
    if 'onlineradiobox.com' in scrape_url:
        if '/playlist' in scrape_url:
            return scrape_url
        return scrape_url.rstrip('/') + '/playlist/'
    
    for pattern, slug in ORB_SLUG_MAP.items():
        if pattern in scrape_url:
            return f"https://onlineradiobox.com/br/{slug}/playlist/"
    
    normalized = re.sub(r'\s*(fm|am)\s*', '', station_name, flags=re.IGNORECASE)
    normalized = re.sub(r'rádio\s*', '', normalized, flags=re.IGNORECASE)
    normalized = re.sub(r'[^a-z0-9]', '', normalized.lower()).strip()
    if normalized:
        return f"https://onlineradiobox.com/br/{normalized}/playlist/"
    return None

def get_mount_name(stream_url: str) -> Optional[str]:
    """Extrai mount name de URL StreamTheWorld"""
    if not stream_url:
        return None
    match = re.search(r'livestream-redirect/([A-Z0-9_]+)', stream_url, re.IGNORECASE)
    if match:
        return re.sub(r'\.(mp3|aac|ogg)$', '', match.group(1), flags=re.IGNORECASE)
    return None

# ═══════════════════════════════════════════════════════════════════════════════
# CORES DO TERMINAL
# ═══════════════════════════════════════════════════════════════════════════════

class Cores:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    RED = "\033[91m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    MAGENTA = "\033[95m"
    CYAN = "\033[96m"
    WHITE = "\033[97m"

if os.name == 'nt':
    os.system('')

def cor(c: str, texto: str) -> str:
    return f"{c}{texto}{Cores.RESET}"

# ═══════════════════════════════════════════════════════════════════════════════
# FUNÇÕES AUXILIARES
# ═══════════════════════════════════════════════════════════════════════════════

def parse_song_text(text: str) -> Dict[str, str]:
    """Extrai título e artista de um texto de música"""
    if not text:
        return {"title": "", "artist": ""}
    
    text = text.strip()
    
    # Remover sufixos de tempo do MyTuner
    time_patterns = [
        r'\n?LIVE\s*$',
        r'\n?\d+\s*(min|sec|h)\s*ago\s*$',
        r'\n?\d+h\d+m\s*ago\s*$',
    ]
    cleaned = text
    for pat in time_patterns:
        cleaned = re.sub(pat, '', cleaned, flags=re.IGNORECASE).strip()
    
    # Formato MyTuner multilinhas: "Título\n\nArtista" ou "Título\nArtista"
    lines = [l.strip() for l in cleaned.split('\n') if l.strip()]
    
    if len(lines) >= 2:
        title = lines[0].strip()
        artist = lines[1].strip()
        if artist and len(artist) > 1 and not re.match(r'^\d{2}:\d{2}$', artist):
            return {"title": title, "artist": artist}
    
    # Formato "Artista - Título"
    separators = [" - ", " – ", " — ", " | "]
    for sep in separators:
        if sep in cleaned:
            parts = cleaned.split(sep, 1)
            if len(parts) == 2 and len(parts[0].strip()) > 1 and len(parts[1].strip()) > 1:
                return {"artist": parts[0].strip(), "title": parts[1].strip()}
    
    if lines:
        return {"title": lines[0], "artist": "Desconhecido"}
    return {"title": text, "artist": "Desconhecido"}

CONFIG_PADRAO = {
    "configuracao": {
        "intervalo_minutos": 6,
        "mostrar_navegador": False,
        "arquivo_historico": os.path.join(_DATA_DIR, "radio_historico.json"),
        "arquivo_relatorio": os.path.join(_DATA_DIR, "radio_relatorio.txt")
    },
    "radios": []
}

def carregar_configuracao():
    """Carrega configuração do arquivo JSON"""
    ARQUIVO_CONFIG = "radios_config.json"
    for config_path in [ARQUIVO_CONFIG, os.path.join(_DATA_DIR, ARQUIVO_CONFIG)]:
        if Path(config_path).exists():
            try:
                with open(config_path, 'r', encoding='utf-8') as f:
                    config = json.load(f)
                    cfg = config.get('configuracao', {})
                    if 'arquivo_historico' in cfg and not os.path.isabs(cfg['arquivo_historico']):
                        cfg['arquivo_historico'] = os.path.join(_DATA_DIR, cfg['arquivo_historico'])
                    if 'arquivo_relatorio' in cfg and not os.path.isabs(cfg['arquivo_relatorio']):
                        cfg['arquivo_relatorio'] = os.path.join(_DATA_DIR, cfg['arquivo_relatorio'])
                    return config
            except Exception as e:
                print(f"  ⚠️  Erro ao carregar {config_path}: {e}")
    return CONFIG_PADRAO


# ═══════════════════════════════════════════════════════════════════════════════
# FONTES DE DADOS HTTP (sem Playwright)
# ═══════════════════════════════════════════════════════════════════════════════

def scrape_onlineradiobox(url: str, station_name: str) -> Optional[Dict]:
    """Scrape OnlineRadioBox via HTTP puro (sem browser)"""
    try:
        resp = http_requests.get(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.7',
        }, timeout=12)
        
        if resp.status_code != 200:
            return None
        
        html = resp.text
        
        if 'did not provide a playlist' in html:
            print(cor(Cores.YELLOW, f"     ⚠️  ORB: {station_name} sem playlist disponível"))
            return None
        
        if 'track_history_item' not in html:
            return None
        
        soup = BeautifulSoup(html, 'html.parser')
        tracks = soup.find_all('td', class_='track_history_item')
        
        now_playing = None
        recent = []
        
        for td in tracks:
            # Get text from <a> tag or directly
            a_tag = td.find('a')
            raw_text = (a_tag.get_text(strip=True) if a_tag else td.get_text(strip=True))
            
            if not raw_text or len(raw_text) < 5 or ' - ' not in raw_text:
                continue
            
            # Skip station name entries
            if re.match(r'^(METROPOLITANA|BH FM|BAND FM|CLUBE FM|GLOBO|MIX FM)\s*-\s*', raw_text, re.IGNORECASE):
                continue
            
            parts = raw_text.split(' - ', 1)
            artist = parts[0].strip()
            title = parts[1].strip()
            
            if len(artist) < 2 or len(title) < 2:
                continue
            
            if not now_playing:
                now_playing = f"{artist} - {title}"
                print(cor(Cores.GREEN, f"     🌐 ORB: {artist} - {title}"))
            elif len(recent) < 5 and f"{artist} - {title}" not in recent:
                recent.append(f"{artist} - {title}")
        
        if now_playing:
            return {
                "tocando_agora": now_playing,
                "ultimas_tocadas": recent,
                "source": "onlineradiobox"
            }
        return None
    except Exception as e:
        print(cor(Cores.YELLOW, f"     ⚠️  ORB erro: {str(e)[:50]}"))
        return None


def scrape_triton_api(mount_name: str, station_name: str) -> Optional[Dict]:
    """Busca Now Playing via Triton Digital API (para emissoras StreamTheWorld)"""
    try:
        url = f"https://np.tritondigital.com/public/nowplaying?mountName={mount_name}&numberToFetch=10&eventType=track"
        resp = http_requests.get(url, headers={
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/xml, text/xml',
        }, timeout=8)
        
        if resp.status_code != 200:
            return None
        
        root = ElementTree.fromstring(resp.text)
        
        now_playing = None
        recent = []
        
        for item in root.findall('.//nowplaying-info'):
            artist = None
            title = None
            
            for prop in item.findall('property'):
                name = prop.get('name', '')
                value = prop.text or ''
                if name == 'track_artist_name':
                    artist = value.strip()
                elif name == 'cue_title':
                    title = value.strip()
            
            if not artist or not title or len(artist) < 2 or len(title) < 2:
                continue
            
            # Skip non-song entries
            if is_forbidden(artist, title):
                continue
            
            song_str = f"{artist} - {title}"
            
            if not now_playing:
                now_playing = song_str
                print(cor(Cores.GREEN, f"     📡 Triton: {artist} - {title}"))
            elif len(recent) < 5 and song_str not in recent:
                recent.append(song_str)
        
        if now_playing:
            return {
                "tocando_agora": now_playing,
                "ultimas_tocadas": recent,
                "source": "triton-api"
            }
        return None
    except Exception as e:
        print(cor(Cores.YELLOW, f"     ⚠️  Triton erro: {str(e)[:50]}"))
        return None


def scrape_icy_metadata(stream_url: str, station_name: str) -> Optional[Dict]:
    """Extrai metadados ICY do stream de áudio, lendo múltiplos blocos."""
    try:
        head_resp = http_requests.head(stream_url, allow_redirects=True, timeout=5)
        resolved_url = head_resp.url

        resp = http_requests.get(resolved_url, headers={
            'Icy-MetaData': '1',
            'User-Agent': 'WinampMPEG/5.0',
        }, stream=True, timeout=10)

        meta_int = int(resp.headers.get('icy-metaint', 0))
        if not meta_int:
            resp.close()
            return None

        try:
            for _ in range(8):
                audio_chunk = resp.raw.read(meta_int)
                if len(audio_chunk) < meta_int:
                    break

                meta_length_byte = resp.raw.read(1)
                if not meta_length_byte:
                    break

                meta_length = meta_length_byte[0] * 16
                if meta_length == 0:
                    continue

                metadata_bytes = resp.raw.read(meta_length)
                if len(metadata_bytes) < meta_length:
                    break

                meta_string = metadata_bytes.decode('utf-8', errors='ignore')
                match = re.search(r"StreamTitle='(.+?)';", meta_string)
                if not match:
                    continue

                stream_title = match.group(1).strip()
                if ' - ' not in stream_title:
                    continue

                artist, title = [part.strip() for part in stream_title.split(' - ', 1)]
                if len(artist) < 2 or len(title) < 2:
                    continue

                if is_forbidden(artist, title):
                    return None

                print(cor(Cores.GREEN, f"     🎵 ICY: {artist} - {title}"))
                return {
                    "tocando_agora": f"{artist} - {title}",
                    "ultimas_tocadas": [],
                    "source": "icy-stream"
                }
        finally:
            resp.close()

        return None
    except Exception as e:
        print(cor(Cores.YELLOW, f"     ⚠️  ICY erro: {str(e)[:50]}"))
        return None


def get_db_fallback(station_name: str, machine_id: str = None) -> Optional[Dict]:
    """Busca a música mais recente já conhecida no backend para evitar ciclos vazios."""
    try:
        query_params = {
            'select': 'artist,title,source,scraped_at',
            'station_name': f'eq.{station_name}',
            'order': 'scraped_at.desc',
            'limit': 5,
        }
        if machine_id:
            query_params['machine_id'] = f'eq.{machine_id}'
            
        scraped_rows = supabase_select('scraped_songs', query_params)

        fresh_rows = []
        now_ts = datetime.now().timestamp()
        for row in scraped_rows:
            scraped_at = row.get('scraped_at')
            if not scraped_at:
                continue
            try:
                ts = datetime.fromisoformat(scraped_at.replace('Z', '+00:00')).timestamp()
                if now_ts - ts <= 60 * 15:
                    fresh_rows.append(row)
            except Exception:
                continue

        if fresh_rows:
            songs = []
            for row in fresh_rows:
                artist = (row.get('artist') or '').strip()
                title = (row.get('title') or '').strip()
                if not artist or not title:
                    continue
                song = f"{artist} - {title}"
                if song not in songs:
                    songs.append(song)

            if songs:
                print(cor(Cores.GREEN, f"     ☁️  Fallback DB(scraped): {songs[0]}"))
                return {
                    "tocando_agora": songs[0],
                    "ultimas_tocadas": songs[1:6],
                    "source": "db-fallback(scraped)"
                }

        historico_rows = supabase_select('radio_historico', {
            'select': 'artist,title,source,captured_at',
            'station_name': f'eq.{station_name}',
            'order': 'captured_at.desc',
            'limit': 5,
        })

        songs = []
        for row in historico_rows:
            artist = (row.get('artist') or '').strip()
            title = (row.get('title') or '').strip()
            if not artist or not title:
                continue
            song = f"{artist} - {title}"
            if song not in songs:
                songs.append(song)

        if songs:
            print(cor(Cores.GREEN, f"     ☁️  Fallback DB(histórico): {songs[0]}"))
            return {
                "tocando_agora": songs[0],
                "ultimas_tocadas": songs[1:6],
                "source": "db-historico"
            }
    except Exception as e:
        print(cor(Cores.YELLOW, f"     ⚠️  DB fallback erro: {str(e)[:50]}"))

    return None


# ═══════════════════════════════════════════════════════════════════════════════
# CLASSE PRINCIPAL
# ═══════════════════════════════════════════════════════════════════════════════

class RadioMonitor:
    def __init__(self, config: Dict):
        self.config = config.get('configuracao', {})
        self.radios: List[Dict] = []
        self.special_radios: List[Dict] = []
        self.intervalo = self.config.get('intervalo_minutos', 12) * 60
        self.mostrar_navegador = self.config.get('mostrar_navegador', False)
        self.historico: Dict = {}
        self.online = True
        self.supabase_stations: Dict[str, str] = {}
        self.browser: Optional[Any] = None
        self.running = True
        self.cycle_count = 0
        self.total_captures = 0
        self.total_blocked = 0
        self.total_errors = 0
        self.source_stats: Dict[str, int] = {}
        self.machine_id: Optional[str] = None
        
        # ── Buffer de frescor ──────────────────────────────────────────
        # Formato: {'BH FM': [{'song': 'Artista - Música', 'ts': datetime}, ...]}
        self.recentes: Dict[str, List[Dict]] = {}
        self.janela_frescor_minutos = 15
        
        self.arquivo_historico = os.path.join(_DATA_DIR, "radio_historico.json")
        self.arquivo_relatorio = os.path.join(_DATA_DIR, "radio_relatorio.txt")
        
        self.historico = self._carregar_historico()
        
        signal.signal(signal.SIGTERM, self._handle_signal)
        signal.signal(signal.SIGINT, self._handle_signal)
        if os.name == 'nt':
            try:
                signal.signal(signal.SIGBREAK, self._handle_signal)
            except:
                pass
    
    def _handle_signal(self, signum, frame):
        sig_name = signal.Signals(signum).name if hasattr(signal, 'Signals') else str(signum)
        print(cor(Cores.YELLOW, f"\n  🛑 Sinal recebido ({sig_name}), encerrando graciosamente..."))
        self.running = False
    
    # ── Buffer de frescor: métodos ───────────────────────────────────
    
    def atualizar_recentes(self, radio_nome: str, songs: List[str]):
        """
        Chamado após cada scraping.
        Registra as músicas com timestamp estimado no buffer em memória.
        A primeira música = tocando agora (timestamp = agora).
        As seguintes = estimativa: cada uma ~3 min antes.
        """
        from datetime import timedelta
        agora = datetime.now()
        
        if radio_nome not in self.recentes:
            self.recentes[radio_nome] = []
        
        for i, song in enumerate(songs):
            ts_estimado = agora - timedelta(minutes=i * 3)
            
            # Normalizar para comparação (lowercase, sem espaços extras)
            song_norm = song.strip().lower()
            
            # Evitar duplicatas no buffer
            ja_existe = any(r['song'].strip().lower() == song_norm 
                           for r in self.recentes[radio_nome])
            if not ja_existe:
                self.recentes[radio_nome].append({
                    'song': song.strip(),
                    'ts': ts_estimado
                })
        
        # Manter só os últimos 60 minutos no buffer (janela ampla para histórico)
        self.recentes[radio_nome] = [
            r for r in self.recentes[radio_nome]
            if (agora - r['ts']).total_seconds() <= 3600
        ]
    
    def get_songs_frescas(self, radio_nome: str) -> List[str]:
        """
        Retorna só as músicas tocadas nos últimos N minutos (janela_frescor_minutos)
        para uma rádio específica, ordenadas por frescor (mais recente primeiro).
        """
        from datetime import timedelta
        agora = datetime.now()
        limite = timedelta(minutes=self.janela_frescor_minutos)
        
        frescas = [
            r for r in self.recentes.get(radio_nome, [])
            if (agora - r['ts']) <= limite
        ]
        
        # Ordenar por timestamp descendente (mais fresca primeiro)
        frescas.sort(key=lambda r: r['ts'], reverse=True)
        
        return [r['song'] for r in frescas]
    
    def get_all_recentes_stats(self) -> Dict[str, int]:
        """Retorna contagem de músicas frescas por rádio (para build_pool)"""
        stats = {}
        for radio_nome in self.recentes:
            stats[radio_nome] = len(self.get_songs_frescas(radio_nome))
        return stats
    
    def _build_pool(self, radios: List[Dict], slots: int = 10) -> List[str]:
        """
        Distribui slots de scraping entre rádios ativas com peso por atividade recente.
        - Cada rádio ativa recebe pelo menos 1 slot (garantia mínima)
        - Slots restantes são distribuídos proporcionalmente ao volume de frescas
        """
        if not radios:
            return []
        
        nomes = [r.get('nome', r.get('name', '')) for r in radios]
        
        # Se temos menos rádios que slots, cada uma aparece 1x
        if len(nomes) >= slots:
            return nomes[:slots]
        
        # 1 slot garantido por rádio
        pool = list(nomes)
        remaining = slots - len(pool)
        
        if remaining <= 0:
            return pool
        
        # Pesos baseados no volume de músicas frescas
        weights = {}
        for nome in nomes:
            frescas = self.get_songs_frescas(nome)
            weights[nome] = len(frescas) + 1  # +1 para nunca ser zero
        
        total_weight = sum(weights.values())
        
        # Distribuir slots restantes proporcionalmente
        for nome in nomes:
            extra = int(round((weights[nome] / total_weight) * remaining))
            pool.extend([nome] * extra)
        
        # Garantir que temos exatamente 'slots' entradas
        while len(pool) < slots:
            # Adicionar a rádio com mais peso
            best = max(nomes, key=lambda n: weights.get(n, 0))
            pool.append(best)
        
        return pool[:slots]
    
    # ── Métodos existentes ─────────────────────────────────────────────
    
    def _carregar_historico(self) -> Dict:
        if Path(self.arquivo_historico).exists():
            try:
                with open(self.arquivo_historico, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except:
                pass
        return {"radios": {}, "ultima_atualizacao": None}
    
    def _salvar_historico(self):
        try:
            for radio_id, dados in self.historico.get('radios', {}).items():
                if 'historico_completo' in dados and len(dados['historico_completo']) > 200:
                    dados['historico_completo'] = dados['historico_completo'][-200:]
            
            with open(self.arquivo_historico, 'w', encoding='utf-8') as f:
                json.dump(self.historico, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"  ⚠️  Erro ao salvar histórico: {e}")
    
    def _salvar_relatorio(self):
        try:
            with open(self.arquivo_relatorio, 'w', encoding='utf-8') as f:
                f.write("═" * 80 + "\n")
                f.write("           RELATÓRIO DE MONITORAMENTO DE RÁDIOS v3.5\n")
                f.write("═" * 80 + "\n\n")
                f.write(f"📅 Gerado em: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}\n")
                f.write(f"📊 Rádios normais: {len(self.radios)} | Especiais: {len(self.special_radios)}\n")
                f.write(f"📈 Capturas: {self.total_captures} | Bloqueadas: {self.total_blocked} | Erros: {self.total_errors}\n")
                f.write(f"📡 Fontes: {json.dumps(self.source_stats)}\n\n")
                
                for radio_id, dados in self.historico.get('radios', {}).items():
                    f.write("─" * 80 + "\n")
                    f.write(f"📻 {dados.get('nome', radio_id)}\n")
                    f.write(f"   URL: {dados.get('url', 'N/A')}\n")
                    f.write("─" * 80 + "\n\n")
                    
                    ultimo = dados.get('ultimo_dado', {})
                    if ultimo.get('tocando_agora'):
                        f.write(f"🎵 TOCANDO AGORA:\n   {ultimo['tocando_agora']}\n\n")
                    
                    if ultimo.get('ultimas_tocadas'):
                        f.write(f"📜 ÚLTIMAS TOCADAS:\n")
                        for i, m in enumerate(ultimo['ultimas_tocadas'][:10], 1):
                            f.write(f"   {i}. {m}\n")
                        f.write("\n")
                
                f.write("═" * 80 + "\nFim do relatório\n")
        except Exception as e:
            print(f"  ⚠️  Erro ao salvar relatório: {e}")
    
    def _verificar_internet(self) -> bool:
        try:
            socket.create_connection(("8.8.8.8", 53), timeout=3)
            return True
        except:
            return False
    
    def _exibir_cabecalho(self):
        print()
        print(cor(Cores.CYAN, "╔" + "═" * 70 + "╗"))
        print(cor(Cores.CYAN, "║") + cor(Cores.BOLD + Cores.WHITE, "  🎵 MONITOR DE RÁDIOS v3.5 - FRESCOR + POOL EDITION 🎵".center(70)) + cor(Cores.CYAN, "║"))
        print(cor(Cores.CYAN, "╚" + "═" * 70 + "╝"))
        print()
        
        status = cor(Cores.GREEN, "● ONLINE") if self.online else cor(Cores.RED, "● OFFLINE")
        supabase_status = cor(Cores.GREEN, "● CONECTADO") if SUPABASE_OK else cor(Cores.RED, "● DESCONECTADO")
        print(f"  Internet: {status}")
        print(f"  Supabase: {supabase_status}")
        print(f"  Ciclo: #{self.cycle_count} | Capturas: {self.total_captures} | Bloqueadas: {self.total_blocked}")
        print(f"  Fontes: {json.dumps(self.source_stats)}")
        print(f"  Última atualização: {self.historico.get('ultima_atualizacao', 'Nunca')}")
        print(f"  Intervalo: {self.config.get('intervalo_minutos', 12)} minutos")
        print(f"  Rádios: {len(self.radios)} normais + {len(self.special_radios)} especiais")
        print()
        print(cor(Cores.YELLOW, "─" * 72))
    
    def _carregar_radios_supabase(self) -> List[Dict]:
        """Carrega rádios ativas do Supabase, filtrando por horário/dia"""
        if not SUPABASE_OK:
            config = carregar_configuracao()
            return [r for r in config.get('radios', []) if r.get('ativo', True)]
        
        try:
            query_params = {
                'select': '*',
                'enabled': 'eq.true'
            }
            if self.machine_id:
                query_params['machine_id'] = f'eq.{self.machine_id}'
                
            stations = supabase_select('radio_stations', query_params)
            
            radios = []
            skipped = 0
            for station in stations:
                if not is_within_schedule(station):
                    skipped += 1
                    continue
                
                url = station.get('scrape_url', '')
                
                radios.append({
                    'nome': station.get('name'),
                    'url': url,
                    'stream_url': station.get('stream_url', ''),
                    'tipo': 'mytuner',
                    'id': station.get('id')
                })
                
                self.supabase_stations[station.get('name')] = station.get('id')
            
            if skipped:
                print(cor(Cores.YELLOW, f"  ⏰ {skipped} rádios fora do horário de monitoramento"))
            print(cor(Cores.GREEN, f"  ✅ {len(radios)} rádios ativas para este ciclo"))
            return radios
            
        except Exception as e:
            print(cor(Cores.RED, f"  ❌ Erro ao carregar rádios: {e}"))
            config = carregar_configuracao()
            return [r for r in config.get('radios', []) if r.get('ativo', True)]
    
    def _carregar_special_monitoring(self) -> List[Dict]:
        """Carrega emissoras de monitoramento especial do Supabase"""
        if not SUPABASE_OK:
            return []
        
        try:
            specials = supabase_select('special_monitoring', {
                'select': '*',
                'enabled': 'eq.true'
            })
            
            radios = []
            for sp in specials:
                if not is_within_schedule(sp):
                    continue
                
                url = sp.get('scrape_url', '')
                
                radios.append({
                    'nome': sp.get('station_name'),
                    'url': url,
                    'stream_url': '',
                    'tipo': 'mytuner',
                    'id': sp.get('id'),
                    'label': sp.get('label', ''),
                    'is_special': True,
                })
            
            if radios:
                print(cor(Cores.MAGENTA, f"  🔮 {len(radios)} monitoramentos especiais ativos"))
            return radios
            
        except Exception as e:
            print(cor(Cores.RED, f"  ❌ Erro ao carregar special_monitoring: {e}"))
            return []
    
    async def _enviar_para_supabase(self, dados: Dict, radio: Dict):
        """Envia dados capturados para o Supabase via REST API"""
        global SUPABASE_OK
        if not SUPABASE_OK:
            return
        
        try:
            station_id = radio.get('id') or self.supabase_stations.get(dados['nome'])
            station_name = dados['nome']
            
            raw_text = dados.get('tocando_agora')
            if not raw_text:
                return
            
            song_info = parse_song_text(raw_text)
            title = song_info['title'] or raw_text.strip()
            artist = song_info['artist'] or 'Desconhecido'
            
            print(cor(Cores.BLUE, f"     🔍 Parsed: artist='{artist}' title='{title}'"))
            
            if re.match(r'^\d{2}:\d{2}$', title) or len(title) < 2:
                return
            if artist == 'Desconhecido' and len(title) < 4:
                return
            
            if is_forbidden(artist, title):
                print(cor(Cores.RED, f"     🚫 BLOQUEADO: {artist} - {title}"))
                self.total_blocked += 1
                return
            
            source = dados.get('source', 'python_monitor')
            
            song_data = {
                'station_name': station_name,
                'title': title,
                'artist': artist,
                'is_now_playing': True,
                'source': source,
                'machine_id': self.machine_id
            }
            if station_id and not radio.get('is_special'):
                song_data['station_id'] = station_id
            
            ok = supabase_insert('scraped_songs', song_data)
            if ok:
                print(cor(Cores.GREEN, f"     ☁️  scraped_songs: {artist} - {title} ({source})"))
                self.total_captures += 1
                self.source_stats[source] = self.source_stats.get(source, 0) + 1
            
            hist_data = {
                'station_name': station_name,
                'artist': artist,
                'title': title,
                'source': source,
                'machine_id': self.machine_id
            }
            ok2 = supabase_insert('radio_historico', hist_data)
            if ok2:
                print(cor(Cores.CYAN, f"     📜  radio_historico: {artist} - {title}"))
            
            for song_text in (dados.get('ultimas_tocadas') or [])[:5]:
                s = parse_song_text(song_text)
                t = s['title']
                a = s['artist']
                if t and len(t) >= 3 and not re.match(r'^\d{2}:\d{2}$', t) and a != 'Desconhecido':
                    if is_forbidden(a, t):
                        self.total_blocked += 1
                        continue
                    supabase_insert('radio_historico', {
                        'station_name': station_name,
                        'artist': a,
                        'title': t,
                        'source': source,
                        'machine_id': self.machine_id
                    })
            
        except Exception as e:
            import traceback
            print(cor(Cores.RED, f"     ❌ Erro Supabase: {str(e)}"))
            traceback.print_exc()
            self.total_errors += 1
    
    async def _extrair_mytuner(self, page: Page, url: str, nome: str) -> Dict:
        dados = {
            "url": url, "nome": nome, "tocando_agora": None,
            "ultimas_tocadas": [], "timestamp": datetime.now().isoformat(), "erro": None,
            "source": "mytuner"
        }
        
        try:
            await page.goto(url, wait_until='domcontentloaded', timeout=30000)
            await page.wait_for_selector('.main-content[data-radio-id]', timeout=15000)
            await asyncio.sleep(2)
            
            resultado = await page.evaluate(r'''async () => {
                const normalizeSongText = (value) => {
                    if (!value) return null;
                    const text = String(value).replace(/\s+/g, ' ').trim();
                    return text.length >= 3 ? text : null;
                };

                const parseDomHistory = () => {
                    const songs = [];
                    const pushSong = (text) => {
                        const cleaned = normalizeSongText(text);
                        if (cleaned && !songs.includes(cleaned)) songs.push(cleaned);
                    };

                    document.querySelectorAll('#song-history a[href*="song"], #song-history .song, #song-history .song-title, #song-history .track, #song-history div').forEach((el) => {
                        pushSong(el.textContent);
                    });

                    return songs.slice(0, 10);
                };

                const parseDomNowPlaying = () => {
                    const selectors = ['.latest-song', '.current-song', '.now-playing', '#metadata-container .song-name p', '#metadata-container .artist-name'];
                    for (const sel of selectors) {
                        const el = document.querySelector(sel);
                        const text = normalizeSongText(el?.textContent);
                        if (text) return text;
                    }

                    const label = document.querySelector('#now-playing');
                    const siblingText = normalizeSongText(label?.nextElementSibling?.textContent);
                    if (siblingText) return siblingText;
                    return null;
                };

                const root = document.querySelector('.main-content[data-radio-id]');
                const radioId = root?.getAttribute('data-radio-id');
                const appCode = location.hostname.includes('staging') ? 'mytuner_website_staging' : 'mytuner_website';

                const formatMetadata = (metadata) => normalizeSongText(metadata);
                const history = [];
                let nowPlaying = null;
                let source = null;

                if (radioId && typeof DG === 'function') {
                    const dg = new DG(radioId);
                    const fetchJson = async (kind, endpoint) => {
                        const timestamp = Date.now();
                        const resp = await fetch(`${endpoint}?app_codename=${appCode}&radio_id=${radioId}&time=${timestamp}`, {
                            method: 'GET',
                            headers: {
                                'Authorization': dg.execute(timestamp, kind),
                                'Content-Type': 'application/json',
                            },
                        });
                        if (!resp.ok) throw new Error(`MyTuner ${kind} HTTP ${resp.status}`);
                        return resp.json();
                    };

                    try {
                        const [historyData, metadataData] = await Promise.allSettled([
                            fetchJson('song-history', 'https://metadata-api.mytuner.mobi/api/v1/metadata-api/web/song-history'),
                            fetchJson('metadata', 'https://metadata-api.mytuner.mobi/api/v1/metadata-api/web/metadata'),
                        ]);

                        if (historyData.status === 'fulfilled') {
                            const apiHistory = historyData.value?.song_history || [];
                            for (const item of apiHistory.slice(-10).reverse()) {
                                const text = formatMetadata(item?.metadata);
                                if (text && !history.includes(text)) history.push(text);
                            }
                        }

                        if (metadataData.status === 'fulfilled') {
                            const metadata = formatMetadata(metadataData.value?.radio_metadata?.metadata);
                            if (metadata) {
                                nowPlaying = metadata;
                                source = 'mytuner-api';
                            }
                        }

                        if (!nowPlaying && history.length > 0) {
                            nowPlaying = history[0];
                            source = source || 'mytuner-api-history';
                        }
                    } catch (error) {
                        console.warn('MyTuner API fallback failed:', error);
                    }
                }

                if (!nowPlaying) {
                    const playButton = document.querySelector('#play-button');
                    if (playButton instanceof HTMLElement) {
                        playButton.click();
                        await new Promise((resolve) => setTimeout(resolve, 5000));
                    } else {
                        await new Promise((resolve) => setTimeout(resolve, 3000));
                    }

                    nowPlaying = parseDomNowPlaying();
                    const domHistory = parseDomHistory();
                    domHistory.forEach((song) => {
                        if (!history.includes(song)) history.push(song);
                    });

                    if (nowPlaying) {
                        source = source || 'mytuner-dom';
                    }
                }

                return {
                    tocando_agora: nowPlaying,
                    ultimas_tocadas: history.slice(0, 10),
                    source: source || 'mytuner',
                };
            }''')

            dados["tocando_agora"] = resultado.get("tocando_agora")
            dados["ultimas_tocadas"] = resultado.get("ultimas_tocadas", [])
            dados["source"] = resultado.get("source", "mytuner")

            if not dados["tocando_agora"] and not dados["ultimas_tocadas"]:
                dados["erro"] = "MyTuner não retornou metadata"
                self.total_errors += 1
                
        except Exception as e:
            dados["erro"] = str(e)[:100]
            self.total_errors += 1
        
        return dados
    
    def _exibir_radio(self, dados: Dict, is_special: bool = False):
        prefix = "🔮" if is_special else "📻"
        source = dados.get('source', '?')
        print()
        print(cor(Cores.BOLD + Cores.MAGENTA, f"  {prefix} {dados['nome']} [{source}]"))
        print(cor(Cores.BLUE, f"     {dados['url'][:60]}"))
        
        if dados["tocando_agora"]:
            print(cor(Cores.GREEN, "     🎵 TOCANDO AGORA:"))
            print(cor(Cores.WHITE + Cores.BOLD, f"        {dados['tocando_agora'][:80]}"))
        else:
            print(cor(Cores.YELLOW, "     🎵 TOCANDO AGORA: (não disponível)"))
        
        if dados["ultimas_tocadas"]:
            print(cor(Cores.CYAN, f"     📜 ÚLTIMAS TOCADAS: {len(dados['ultimas_tocadas'])} músicas"))
        
        if dados.get("erro"):
            print(cor(Cores.RED, f"     ⚠️  {dados['erro'][:60]}"))
        
        print(cor(Cores.YELLOW, "  " + "─" * 68))
    
    async def _scrape_station_multisource(self, radio: Dict, page: Optional[Page] = None) -> Dict:
        """Tenta múltiplas fontes em cascata: ORB → Triton → ICY → Playwright"""
        nome = radio['nome']
        url = radio['url']
        stream_url = radio.get('stream_url', '')
        
        dados_base = {
            "url": url, "nome": nome, "tocando_agora": None,
            "ultimas_tocadas": [], "timestamp": datetime.now().isoformat(),
            "erro": None, "source": "none"
        }
        
        # === Fonte 1: OnlineRadioBox (HTTP puro) ===
        orb_url = get_orb_url(url, nome)
        if orb_url:
            print(cor(Cores.BLUE, f"     📋 Tentando ORB..."))
            result = scrape_onlineradiobox(orb_url, nome)
            if result and result.get('tocando_agora'):
                return {**dados_base, **result}
        
        # === Fonte 2: Triton Digital API ===
        if stream_url:
            mount_name = get_mount_name(stream_url)
            if mount_name:
                print(cor(Cores.BLUE, f"     📡 Tentando Triton (mount: {mount_name})..."))
                result = scrape_triton_api(mount_name, nome)
                if result and result.get('tocando_agora'):
                    return {**dados_base, **result}
        
        # === Fonte 3: ICY Metadata ===
        if stream_url:
            print(cor(Cores.BLUE, f"     🎵 Tentando ICY metadata..."))
            result = scrape_icy_metadata(stream_url, nome)
            if result and result.get('tocando_agora'):
                return {**dados_base, **result}
        
        # === Fonte 4: Playwright (MyTuner) - último recurso ===
        if page and PLAYWRIGHT_OK:
            print(cor(Cores.BLUE, f"     🌐 Fallback: Playwright/MyTuner..."))
            try:
                result = await asyncio.wait_for(
                    self._extrair_mytuner(page, url, nome),
                    timeout=40
                )
                if result and result.get('tocando_agora'):
                    return result
            except asyncio.TimeoutError:
                print(cor(Cores.RED, f"     ⏰ TIMEOUT Playwright: {nome} (>40s)"))
                self.total_errors += 1
        
        # === Fonte 5: Fallback no backend ===
        if SUPABASE_OK:
            print(cor(Cores.BLUE, f"     ☁️  Tentando fallback no histórico..."))
            result = get_db_fallback(nome)
            if result and result.get('tocando_agora'):
                return {**dados_base, **result}

        dados_base["erro"] = "Nenhuma fonte retornou dados"
        return dados_base

    async def _atualizar_todas(self):
        """Ciclo principal de scraping com multi-source + buffer de frescor"""
        global SUPABASE_OK
        
        # Re-verificar conexão Supabase
        if not SUPABASE_OK:
            print(cor(Cores.YELLOW, "  🔄 Tentando reconectar ao Supabase..."))
            SUPABASE_OK = verificar_conexao_supabase()
            if SUPABASE_OK:
                print(cor(Cores.GREEN, "  ✅ Supabase reconectado!"))
            else:
                print(cor(Cores.RED, "  ❌ Supabase indisponível"))
        
        self.radios = self._carregar_radios_supabase()
        self.special_radios = self._carregar_special_monitoring()
        
        all_radios = self.radios + self.special_radios
        
        if not all_radios:
            print(cor(Cores.YELLOW, "  ⚠️  Nenhuma rádio ativa para este horário!"))
            return
        
        # ── Build pool ponderado ─────────────────────────────────────
        pool_names = self._build_pool(all_radios, slots=max(len(all_radios), 10))
        frescor_stats = self.get_all_recentes_stats()
        if frescor_stats:
            print(cor(Cores.CYAN, f"  🧊 Buffer de frescor: {json.dumps(frescor_stats)}"))
        print(cor(Cores.CYAN, f"  🎯 Pool ({len(pool_names)} slots): {', '.join(dict.fromkeys(pool_names))}"))
        
        # Start browser only if needed (for MyTuner fallback)
        pw = None
        page = None
        try:
            if PLAYWRIGHT_OK:
                if not self.browser:
                    pw = await async_playwright().start()
                    self.browser = await pw.chromium.launch(headless=not self.mostrar_navegador)
                    print(cor(Cores.GREEN, "  🌐 Browser Chromium iniciado (fallback)"))
                
                page = await self.browser.new_page()
                await page.set_extra_http_headers({
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                })
        except Exception as e:
            print(cor(Cores.YELLOW, f"  ⚠️  Browser indisponível: {str(e)[:50]} (usando apenas HTTP)"))
            page = None
        
        self._exibir_cabecalho()
        
        # ── Scrape + alimentar buffer + envio em batch ───────────────
        batch_envio = []  # Acumula dados para envio em batch ao Supabase
        
        # Deduplicate pool to avoid scraping same station twice in same cycle
        seen_stations = set()
        unique_radios = []
        for nome in pool_names:
            if nome not in seen_stations:
                seen_stations.add(nome)
                radio = next((r for r in all_radios if r.get('nome') == nome), None)
                if radio:
                    unique_radios.append(radio)
        
        # Process in batches of 3
        BATCH_SIZE = 3
        for batch_start in range(0, len(unique_radios), BATCH_SIZE):
            if not self.running:
                break
                
            batch = unique_radios[batch_start:batch_start + BATCH_SIZE]
            
            for radio in batch:
                if not self.running:
                    break
                
                is_special = radio.get('is_special', False)
                label = f" [{radio.get('label', '')}]" if radio.get('label') else ""
                idx = unique_radios.index(radio) + 1
                print(cor(Cores.YELLOW, f"  🔄 [{idx}/{len(unique_radios)}] {radio['nome']}{label}..."))
                
                dados = await self._scrape_station_multisource(radio, page)
                
                # ── Alimentar buffer de frescor (máx 2 músicas por ciclo) ──
                songs_para_buffer = []
                if dados.get("tocando_agora"):
                    songs_para_buffer.append(dados["tocando_agora"])
                if len(songs_para_buffer) < 2:
                    for s in (dados.get("ultimas_tocadas") or []):
                        if s and len(s) > 5:
                            songs_para_buffer.append(s)
                            if len(songs_para_buffer) >= 2:
                                break
                
                if songs_para_buffer:
                    self.atualizar_recentes(radio['nome'], songs_para_buffer)
                    frescas_count = len(self.get_songs_frescas(radio['nome']))
                    print(cor(Cores.CYAN, f"     🧊 Buffer: +{len(songs_para_buffer)} músicas → {frescas_count} frescas"))
                
                # Acumular para envio em batch
                batch_envio.append((dados, radio))
                
                # Atualizar histórico local
                radio_id = radio['nome'].lower().replace(' ', '_')
                if radio_id not in self.historico["radios"]:
                    self.historico["radios"][radio_id] = {
                        "nome": radio['nome'], "url": radio['url'], "historico_completo": []
                    }
                
                if dados["tocando_agora"]:
                    hist = self.historico["radios"][radio_id].get("historico_completo", [])
                    if not hist or hist[-1].get("musica") != dados["tocando_agora"]:
                        hist.append({"musica": dados["tocando_agora"], "timestamp": dados["timestamp"]})
                        self.historico["radios"][radio_id]["historico_completo"] = hist[-200:]
                
                self.historico["radios"][radio_id]["ultimo_dado"] = dados
                self._exibir_radio(dados, is_special)
        
        # ── Envio em batch ao Supabase (após todos os scrapings) ─────
        if batch_envio:
            print(cor(Cores.BLUE, f"\n  ☁️  Enviando {len(batch_envio)} capturas em batch ao Supabase..."))
            for dados, radio in batch_envio:
                await self._enviar_para_supabase(dados, radio)
        
        if page:
            try:
                await page.close()
            except:
                pass
        
        self.historico["ultima_atualizacao"] = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
        self._salvar_historico()
        self._salvar_relatorio()
        
        # ── Resumo do ciclo com stats de frescor ─────────────────────
        print()
        print(cor(Cores.GREEN, f"  💾 Ciclo #{self.cycle_count} completo — {self.total_captures} capturas totais"))
        print(cor(Cores.CYAN, f"  📡 Fontes: {json.dumps(self.source_stats)}"))
        
        frescor_final = self.get_all_recentes_stats()
        total_frescas = sum(frescor_final.values())
        print(cor(Cores.CYAN, f"  🧊 Buffer total: {total_frescas} músicas frescas em {len(frescor_final)} rádios"))
        
        if SUPABASE_OK:
            print(cor(Cores.CYAN, f"  ☁️  Dados sincronizados com Supabase!"))
    
    async def _aguardar_reconexao(self):
        tentativas = 0
        while not self._verificar_internet() and self.running:
            tentativas += 1
            print(cor(Cores.RED, f"  ⚠️  SEM CONEXÃO - Tentativa {tentativas}"))
            print(f"  Verificando novamente em 30 segundos...")
            await asyncio.sleep(30)
        
        if self.running:
            self.online = True
            print(cor(Cores.GREEN, "\n  ✅ CONEXÃO RESTABELECIDA!\n"))
            await asyncio.sleep(2)
    
    async def _cleanup(self):
        print(cor(Cores.YELLOW, "  🧹 Limpando recursos..."))
        try:
            if self.browser:
                await self.browser.close()
                self.browser = None
                print(cor(Cores.GREEN, "  ✅ Browser encerrado"))
        except:
            pass
        self._salvar_historico()
        self._salvar_relatorio()
        print(cor(Cores.GREEN, "  ✅ Histórico e relatório salvos"))
    
    async def iniciar(self):
        print(cor(Cores.CYAN, "\n🚀 Iniciando Monitor de Rádios v3.5 (Frescor + Pool)...\n"))
        
        self.radios = self._carregar_radios_supabase()
        self.special_radios = self._carregar_special_monitoring()
        
        print(f"  📻 Rádios: {len(self.radios)} normais + {len(self.special_radios)} especiais")
        print(f"  📡 Fontes disponíveis: ORB, Triton API, ICY, Playwright")
        print()
        
        while self.running:
            try:
                self.cycle_count += 1
                
                if not self._verificar_internet():
                    self.online = False
                    await self._aguardar_reconexao()
                    if not self.running:
                        break
                
                self.online = True
                await self._atualizar_todas()
                
                for seg in range(self.intervalo, 0, -1):
                    if not self.running:
                        break
                    m, s = divmod(seg, 60)
                    sys.stdout.write(f"\r  ⏱️  Próxima atualização em: {m:02d}:{s:02d}  ")
                    sys.stdout.flush()
                    await asyncio.sleep(1)
                    
                    if seg % 30 == 0 and not self._verificar_internet():
                        self.online = False
                        break
                
                print()
                
            except KeyboardInterrupt:
                break
            except Exception as e:
                print(cor(Cores.RED, f"\n❌ Erro no ciclo: {e}"))
                self.total_errors += 1
                print("   Tentando novamente em 30 segundos...")
                for i in range(30):
                    if not self.running:
                        break
                    await asyncio.sleep(1)
        
        await self._cleanup()
        print(cor(Cores.YELLOW, "\n👋 Monitor encerrado graciosamente."))
        print(f"   Ciclos: {self.cycle_count} | Capturas: {self.total_captures} | Bloqueadas: {self.total_blocked} | Erros: {self.total_errors}")
        print(f"   Fontes: {json.dumps(self.source_stats)}")


# ═══════════════════════════════════════════════════════════════════════════════
# EXECUÇÃO
# ═══════════════════════════════════════════════════════════════════════════════

def parse_arguments():
    import argparse
    parser = argparse.ArgumentParser(description='Monitor de Rádios - Tempo Real')
    parser.add_argument('--machine-id', type=str, help='ID único desta instalação')
    return parser.parse_args()

if __name__ == "__main__":
    args = parse_arguments()
    machine_id = args.machine_id
    
    print()
    print(cor(Cores.CYAN, "╔" + "═" * 60 + "╗"))
    print(cor(Cores.CYAN, "║") + cor(Cores.BOLD, " 🎵 MONITOR DE RÁDIOS v3.5 - FRESCOR + POOL EDITION ".center(60)) + cor(Cores.CYAN, "║"))
    print(cor(Cores.CYAN, "╚" + "═" * 60 + "╝"))
    print()
    
    if machine_id:
        print(cor(Cores.MAGENTA, f"  💻 ID da Instalação: {machine_id}"))
    
    config = carregar_configuracao()
    
    if SUPABASE_OK:
        print(cor(Cores.GREEN, "  ✅ Modo Supabase ativo (REST API)!"))
        print(cor(Cores.CYAN, "  📻 Emissoras carregadas do banco (radio_stations + special_monitoring)"))
        print(cor(Cores.CYAN, "  📡 Fontes: OnlineRadioBox → Triton API → ICY → Playwright"))
        print(cor(Cores.CYAN, "  🧊 Buffer de frescor: janela de 15 min, histórico de 60 min"))
        print(cor(Cores.CYAN, "  🎯 Build pool: slots ponderados por atividade recente"))
        print(cor(Cores.CYAN, "  📦 Envio em batch: dados acumulados e enviados após cada ciclo"))
    else:
        print(cor(Cores.YELLOW, "  ⚠️  Supabase não conectado - usando modo local"))
    print()
    print(cor(Cores.CYAN, "  Pressione Ctrl+C a qualquer momento para encerrar."))
    print()
    
    monitor = RadioMonitor(config)
    monitor.machine_id = machine_id
    asyncio.run(monitor.iniciar())
