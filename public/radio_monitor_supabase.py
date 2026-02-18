#!/usr/bin/env python3
"""
╔═══════════════════════════════════════════════════════════════════════════════╗
║                     MONITOR DE RÁDIOS - TEMPO REAL                            ║
║                          INTEGRADO COM SUPABASE                               ║
║                                                                               ║
║  Monitora "Tocando Agora" e "Últimas Tocadas" de múltiplas rádios            ║
║  com atualização automática e envio para banco de dados Supabase             ║
║                                                                               ║
║  CONFIGURAÇÃO: As emissoras são carregadas automaticamente do Supabase!      ║
║                                                                               ║
║  Autor: Audio Solutions | Data: Janeiro 2026                                  ║
╚═══════════════════════════════════════════════════════════════════════════════╝
"""

import subprocess
import sys
import os

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
import socket
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any

try:
    from playwright.async_api import async_playwright, Page
    PLAYWRIGHT_OK = True
except ImportError:
    PLAYWRIGHT_OK = False

import requests as http_requests

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
    """Testa conexão com Supabase (pode ser chamado a qualquer momento)"""
    try:
        resp = http_requests.get(
            f"{SUPABASE_URL}/rest/v1/radio_stations?select=id&limit=1",
            headers=SUPABASE_HEADERS,
            timeout=10
        )
        return resp.status_code == 200
    except:
        return False

# Verificar conexão inicial com diagnóstico detalhado
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
    print("     Verifique sua internet e se o firewall permite acesso a supabase.co")
except http_requests.exceptions.Timeout:
    print("  ❌ Timeout ao conectar ao Supabase (>10s)")
    print("     Sua conexão pode estar lenta ou bloqueada")
except Exception as e:
    print(f"  ❌ Erro inesperado: {type(e).__name__}: {str(e)[:100]}")

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURAÇÃO LOCAL (FALLBACK) - Usa pasta do usuário para evitar Errno 13
# ═══════════════════════════════════════════════════════════════════════════════

# Determinar pasta de dados do usuário
if os.name == 'nt':
    _DATA_DIR = os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), 'AudioSolutions', 'RadioMonitor')
else:
    _DATA_DIR = os.path.join(os.path.expanduser('~'), '.radio-monitor')

os.makedirs(_DATA_DIR, exist_ok=True)
print(f"  📁 Pasta de dados: {_DATA_DIR}")

ARQUIVO_CONFIG = "radios_config.json"

CONFIG_PADRAO = {
    "configuracao": {
        "intervalo_minutos": 5,
        "mostrar_navegador": False,
        "arquivo_historico": os.path.join(_DATA_DIR, "radio_historico.json"),
        "arquivo_relatorio": os.path.join(_DATA_DIR, "radio_relatorio.txt")
    },
    "radios": []
}

def carregar_configuracao():
    """Carrega configuração do arquivo JSON ou cria arquivo padrão"""
    # Tentar na pasta atual primeiro, depois na pasta de dados
    for config_path in [ARQUIVO_CONFIG, os.path.join(_DATA_DIR, ARQUIVO_CONFIG)]:
        if Path(config_path).exists():
            try:
                with open(config_path, 'r', encoding='utf-8') as f:
                    config = json.load(f)
                    # Corrigir caminhos de arquivos para pasta de dados
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

# Habilitar cores no Windows
if os.name == 'nt':
    os.system('')

def cor(c: str, texto: str) -> str:
    return f"{c}{texto}{Cores.RESET}"

# ═══════════════════════════════════════════════════════════════════════════════
# FUNÇÕES AUXILIARES
# ═══════════════════════════════════════════════════════════════════════════════

def parse_song_text(text: str) -> Dict[str, str]:
    """Extrai título e artista de um texto de música (suporta formato MyTuner multilinhas)"""
    if not text:
        return {"title": "", "artist": ""}
    
    text = text.strip()
    
    # Remover sufixos de tempo do MyTuner (LIVE, "X min ago", "Xh ago", etc)
    import re
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
        # Primeira linha = título, segunda = artista
        title = lines[0].strip()
        artist = lines[1].strip()
        # Ignorar se artista parece ser timestamp ou lixo
        if artist and len(artist) > 1 and not re.match(r'^\d{2}:\d{2}$', artist):
            return {"title": title, "artist": artist}
    
    # Formato "Artista - Título"
    separators = [" - ", " – ", " — ", " | "]
    for sep in separators:
        if sep in cleaned:
            parts = cleaned.split(sep, 1)
            if len(parts) == 2 and len(parts[0].strip()) > 1 and len(parts[1].strip()) > 1:
                return {"artist": parts[0].strip(), "title": parts[1].strip()}
    
    # Fallback: texto inteiro como título
    if lines:
        return {"title": lines[0], "artist": "Desconhecido"}
    return {"title": text, "artist": "Desconhecido"}

# ═══════════════════════════════════════════════════════════════════════════════
# CLASSE PRINCIPAL
# ═══════════════════════════════════════════════════════════════════════════════

class RadioMonitor:
    def __init__(self, config: Dict):
        self.config = config.get('configuracao', {})
        self.radios = []  # Será carregado do Supabase
        self.intervalo = self.config.get('intervalo_minutos', 5) * 60
        self.mostrar_navegador = self.config.get('mostrar_navegador', False)
        self.historico = {}
        self.online = True
        self.supabase_stations = {}  # Mapa nome -> id
        
        # SEMPRE forçar caminhos absolutos na pasta de dados do usuário
        self.arquivo_historico = os.path.join(_DATA_DIR, "radio_historico.json")
        self.arquivo_relatorio = os.path.join(_DATA_DIR, "radio_relatorio.txt")
        
        print(f"  📁 Histórico: {self.arquivo_historico}")
        print(f"  📁 Relatório: {self.arquivo_relatorio}")
        
        self.historico = self._carregar_historico()
        
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
            with open(self.arquivo_historico, 'w', encoding='utf-8') as f:
                json.dump(self.historico, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"  ⚠️  Erro ao salvar histórico: {e}")
    
    def _salvar_relatorio(self):
        try:
            with open(self.arquivo_relatorio, 'w', encoding='utf-8') as f:
                f.write("═" * 80 + "\n")
                f.write("           RELATÓRIO DE MONITORAMENTO DE RÁDIOS\n")
                f.write("═" * 80 + "\n\n")
                f.write(f"📅 Gerado em: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}\n")
                f.write(f"📊 Total de rádios: {len(self.radios)}\n\n")
                
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
    
    def _limpar_tela(self):
        os.system('cls' if os.name == 'nt' else 'clear')
    
    def _exibir_cabecalho(self):
        self._limpar_tela()
        print(cor(Cores.CYAN, "╔" + "═" * 70 + "╗"))
        print(cor(Cores.CYAN, "║") + cor(Cores.BOLD + Cores.WHITE, "     🎵 MONITOR DE RÁDIOS - SUPABASE EDITION 🎵".center(70)) + cor(Cores.CYAN, "║"))
        print(cor(Cores.CYAN, "╚" + "═" * 70 + "╝"))
        print()
        
        status = cor(Cores.GREEN, "● ONLINE") if self.online else cor(Cores.RED, "● OFFLINE")
        supabase_status = cor(Cores.GREEN, "● CONECTADO") if SUPABASE_OK else cor(Cores.RED, "● DESCONECTADO")
        print(f"  Internet: {status}")
        print(f"  Supabase: {supabase_status}")
        print(f"  Última atualização: {self.historico.get('ultima_atualizacao', 'Nunca')}")
        print(f"  Intervalo: {self.config.get('intervalo_minutos', 5)} minutos")
        print(f"  Rádios ativas: {len(self.radios)}")
        print(f"  📁 Dados: {_DATA_DIR}")
        print()
        print(cor(Cores.YELLOW, "─" * 72))
        print()
        print(cor(Cores.YELLOW, "─" * 72))
    
    def _carregar_radios_supabase(self) -> List[Dict]:
        """Carrega as rádios ativas do Supabase via REST API"""
        if not SUPABASE_OK:
            print(cor(Cores.YELLOW, "  ⚠️  Supabase não conectado, usando config local"))
            config = carregar_configuracao()
            return [r for r in config.get('radios', []) if r.get('ativo', True)]
        
        try:
            stations = supabase_select('radio_stations', {
                'select': '*',
                'enabled': 'eq.true'
            })
            
            radios = []
            for station in stations:
                url = station.get('scrape_url', '')
                if 'clubefm' in url.lower():
                    tipo = 'clubefm'
                else:
                    tipo = 'mytuner'
                
                radios.append({
                    'nome': station.get('name'),
                    'url': url,
                    'tipo': tipo,
                    'id': station.get('id')
                })
                
                self.supabase_stations[station.get('name')] = station.get('id')
            
            print(cor(Cores.GREEN, f"  ✅ {len(radios)} rádios carregadas do Supabase"))
            return radios
            
        except Exception as e:
            print(cor(Cores.RED, f"  ❌ Erro ao carregar rádios: {e}"))
            config = carregar_configuracao()
            return [r for r in config.get('radios', []) if r.get('ativo', True)]
    
    async def _enviar_para_supabase(self, dados: Dict, radio: Dict):
        """Envia dados capturados para o Supabase via REST API"""
        global SUPABASE_OK
        if not SUPABASE_OK:
            print(cor(Cores.YELLOW, f"     ⚠️  Supabase não conectado, pulando envio"))
            return
        
        try:
            station_id = radio.get('id') or self.supabase_stations.get(dados['nome'])
            station_name = dados['nome']
            
            raw_text = dados.get('tocando_agora')
            print(cor(Cores.BLUE, f"     🔍 Raw tocando_agora: {repr(raw_text)[:100]}"))
            
            if not raw_text:
                print(cor(Cores.YELLOW, f"     ⚠️  Sem dados de 'tocando agora' para {station_name}"))
                return
            
            song_info = parse_song_text(raw_text)
            title = song_info['title'] or raw_text.strip()
            artist = song_info['artist'] or 'Desconhecido'
            
            print(cor(Cores.BLUE, f"     🔍 Parsed: artist='{artist}' title='{title}'"))
            
            # Ignorar entradas que parecem ser timestamps ou lixo
            import re
            if re.match(r'^\d{2}:\d{2}$', title) or len(title) < 2:
                print(cor(Cores.YELLOW, f"     ⚠️  Ignorado (timestamp/lixo): '{title}'"))
                return
            
            # Ignorar se artista é "Desconhecido" e título parece lixo
            if artist == 'Desconhecido' and len(title) < 4:
                print(cor(Cores.YELLOW, f"     ⚠️  Ignorado (dados insuficientes): '{title}'"))
                return
            
            # Inserir em scraped_songs (sem station_id se None para evitar FK error)
            song_data = {
                'station_name': station_name,
                'title': title,
                'artist': artist,
                'is_now_playing': True,
                'source': 'python_monitor'
            }
            if station_id:
                song_data['station_id'] = station_id
            
            print(cor(Cores.BLUE, f"     📤 Enviando para scraped_songs..."))
            ok = supabase_insert('scraped_songs', song_data)
            if ok:
                print(cor(Cores.GREEN, f"     ☁️  scraped_songs: {artist} - {title}"))
            else:
                print(cor(Cores.RED, f"     ❌ Falha ao inserir em scraped_songs"))
            
            # Inserir também em radio_historico
            hist_data = {
                'station_name': station_name,
                'artist': artist,
                'title': title,
                'source': 'python_monitor'
            }
            print(cor(Cores.BLUE, f"     📤 Enviando para radio_historico..."))
            ok2 = supabase_insert('radio_historico', hist_data)
            if ok2:
                print(cor(Cores.CYAN, f"     📜  radio_historico: {artist} - {title}"))
            else:
                print(cor(Cores.RED, f"     ❌ Falha ao inserir em radio_historico"))
            
            # Enviar também últimas tocadas
            for song_text in (dados.get('ultimas_tocadas') or [])[:5]:
                s = parse_song_text(song_text)
                t = s['title']
                a = s['artist']
                if t and len(t) >= 3 and not re.match(r'^\d{2}:\d{2}$', t) and a != 'Desconhecido':
                    hist2 = {
                        'station_name': station_name,
                        'artist': a,
                        'title': t,
                        'source': 'python_monitor'
                    }
                    supabase_insert('radio_historico', hist2)
            
        except Exception as e:
            import traceback
            print(cor(Cores.RED, f"     ❌ Erro Supabase: {str(e)}"))
            traceback.print_exc()
    
    async def _extrair_mytuner(self, page: Page, url: str, nome: str) -> Dict:
        dados = {
            "url": url, "nome": nome, "tocando_agora": None,
            "ultimas_tocadas": [], "timestamp": datetime.now().isoformat(), "erro": None
        }
        
        try:
            await page.goto(url, wait_until='networkidle', timeout=30000)
            await asyncio.sleep(3)
            
            # Extrair tocando agora
            resultado = await page.evaluate('''() => {
                const seletores = ['.latest-song', '.current-song', '.now-playing'];
                for (const sel of seletores) {
                    const el = document.querySelector(sel);
                    if (el && el.innerText.trim()) return el.innerText.trim();
                }
                const np = document.querySelector('#now-playing');
                if (np && np.nextElementSibling) return np.nextElementSibling.innerText.trim();
                return null;
            }''')
            if resultado:
                dados["tocando_agora"] = resultado
            
            # Extrair últimas tocadas
            resultado = await page.evaluate('''() => {
                const songs = [];
                document.querySelectorAll('a[href*="song"]').forEach(link => {
                    const text = link.innerText.trim();
                    if (text.length > 5 && !songs.includes(text)) songs.push(text);
                });
                if (songs.length === 0) {
                    const hist = document.querySelector('#song-history, .song-history');
                    if (hist) {
                        hist.querySelectorAll('div').forEach(item => {
                            const text = item.innerText.trim();
                            if (text.length > 5 && !songs.includes(text)) songs.push(text);
                        });
                    }
                }
                return songs.slice(0, 10);
            }''')
            if resultado:
                dados["ultimas_tocadas"] = resultado
                
        except Exception as e:
            dados["erro"] = str(e)
        
        return dados
    
    async def _extrair_clubefm(self, page: Page, url: str, nome: str) -> Dict:
        dados = {
            "url": url, "nome": nome, "tocando_agora": None,
            "ultimas_tocadas": [], "timestamp": datetime.now().isoformat(), "erro": None
        }
        
        try:
            await page.goto(url, wait_until='networkidle', timeout=30000)
            await asyncio.sleep(3)
            
            resultado = await page.evaluate('''() => {
                const songs = [];
                const containers = document.querySelectorAll('.song-item, .track-item, article');
                containers.forEach(c => {
                    const artista = c.querySelector('h3, .artist');
                    const musica = c.querySelector('h4, .song');
                    if (artista && musica) {
                        songs.push(`${musica.innerText.trim()} - ${artista.innerText.trim()}`);
                    }
                });
                if (songs.length === 0) {
                    document.body.innerText.split('\\n').forEach(l => {
                        if (l.match(/\\d{2}:\\d{2}/) && l.length < 100) songs.push(l.trim());
                    });
                }
                return songs.slice(0, 15);
            }''')
            
            if resultado and len(resultado) > 0:
                dados["tocando_agora"] = resultado[0]
                dados["ultimas_tocadas"] = resultado
                
        except Exception as e:
            dados["erro"] = str(e)
        
        return dados
    
    def _exibir_radio(self, dados: Dict):
        print()
        print(cor(Cores.BOLD + Cores.MAGENTA, f"  📻 {dados['nome']}"))
        print(cor(Cores.BLUE, f"     {dados['url']}"))
        print()
        
        if dados["tocando_agora"]:
            print(cor(Cores.GREEN, "     🎵 TOCANDO AGORA:"))
            print(cor(Cores.WHITE + Cores.BOLD, f"        {dados['tocando_agora']}"))
        else:
            print(cor(Cores.YELLOW, "     🎵 TOCANDO AGORA: (não disponível)"))
        
        print()
        
        if dados["ultimas_tocadas"]:
            print(cor(Cores.CYAN, "     📜 ÚLTIMAS TOCADAS:"))
            for i, m in enumerate(dados["ultimas_tocadas"][:5], 1):
                print(f"        {i}. {m}")
        
        if dados.get("erro"):
            print(cor(Cores.RED, f"\n     ⚠️  {dados['erro']}"))
        
        print()
        print(cor(Cores.YELLOW, "─" * 72))
    
    async def _atualizar_todas(self):
        global SUPABASE_OK
        
        if not PLAYWRIGHT_OK:
            print(cor(Cores.RED, "❌ Playwright não disponível"))
            return
        
        # Re-verificar conexão Supabase a cada ciclo
        if not SUPABASE_OK:
            print(cor(Cores.YELLOW, "  🔄 Tentando reconectar ao Supabase..."))
            SUPABASE_OK = verificar_conexao_supabase()
            if SUPABASE_OK:
                print(cor(Cores.GREEN, "  ✅ Supabase reconectado!"))
            else:
                print(cor(Cores.RED, "  ❌ Supabase ainda indisponível, continuando com modo local"))
        
        # Recarregar rádios do Supabase a cada atualização
        self.radios = self._carregar_radios_supabase()
        
        if not self.radios:
            print(cor(Cores.YELLOW, "  ⚠️  Nenhuma rádio configurada!"))
            return
        
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=not self.mostrar_navegador)
            page = await browser.new_page()
            await page.set_extra_http_headers({
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            })
            
            self._exibir_cabecalho()
            
            for i, radio in enumerate(self.radios):
                print(cor(Cores.YELLOW, f"  🔄 Atualizando {radio['nome']} ({i+1}/{len(self.radios)})..."))
                
                if radio['tipo'] == 'clubefm':
                    dados = await self._extrair_clubefm(page, radio['url'], radio['nome'])
                else:
                    dados = await self._extrair_mytuner(page, radio['url'], radio['nome'])
                
                # Enviar para Supabase
                await self._enviar_para_supabase(dados, radio)
                
                radio_id = radio['nome'].lower().replace(' ', '_')
                if radio_id not in self.historico["radios"]:
                    self.historico["radios"][radio_id] = {
                        "nome": radio['nome'], "url": radio['url'], "historico_completo": []
                    }
                
                if dados["tocando_agora"]:
                    hist = self.historico["radios"][radio_id].get("historico_completo", [])
                    if not hist or hist[-1].get("musica") != dados["tocando_agora"]:
                        hist.append({"musica": dados["tocando_agora"], "timestamp": dados["timestamp"]})
                        self.historico["radios"][radio_id]["historico_completo"] = hist[-1000:]
                
                self.historico["radios"][radio_id]["ultimo_dado"] = dados
                self._exibir_radio(dados)
            
            await browser.close()
            
            self.historico["ultima_atualizacao"] = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
            self._salvar_historico()
            self._salvar_relatorio()
            
            print(cor(Cores.GREEN, f"\n  💾 Histórico local: {self.arquivo_historico}"))
            print(cor(Cores.GREEN, f"  📄 Relatório: {self.arquivo_relatorio}"))
            if SUPABASE_OK:
                print(cor(Cores.CYAN, f"  ☁️  Dados sincronizados com Supabase!"))
    
    async def _aguardar_reconexao(self):
        tentativas = 0
        while not self._verificar_internet():
            tentativas += 1
            self._exibir_cabecalho()
            print(cor(Cores.RED, f"  ⚠️  SEM CONEXÃO - Tentativa {tentativas}"))
            print(f"  Verificando novamente em 30 segundos...")
            print(cor(Cores.YELLOW, "\n  💡 Histórico salvo localmente."))
            await asyncio.sleep(30)
        
        self.online = True
        print(cor(Cores.GREEN, "\n  ✅ CONEXÃO RESTABELECIDA!\n"))
        await asyncio.sleep(2)
    
    async def iniciar(self):
        print(cor(Cores.CYAN, "\n🚀 Iniciando Monitor de Rádios com Supabase...\n"))
        
        # Carregar rádios iniciais
        self.radios = self._carregar_radios_supabase()
        
        print(f"  📻 Rádios ativas: {len(self.radios)}")
        print()
        
        while True:
            try:
                if not self._verificar_internet():
                    self.online = False
                    await self._aguardar_reconexao()
                
                self.online = True
                await self._atualizar_todas()
                
                for seg in range(self.intervalo, 0, -1):
                    m, s = divmod(seg, 60)
                    sys.stdout.write(f"\r  ⏱️  Próxima atualização em: {m:02d}:{s:02d}  ")
                    sys.stdout.flush()
                    await asyncio.sleep(1)
                    
                    if seg % 30 == 0 and not self._verificar_internet():
                        self.online = False
                        break
                
            except KeyboardInterrupt:
                print(cor(Cores.YELLOW, "\n\n👋 Monitoramento encerrado."))
                print(f"   Histórico: {self.arquivo_historico}")
                print(f"   Relatório: {self.arquivo_relatorio}")
                break
            except Exception as e:
                print(cor(Cores.RED, f"\n❌ Erro: {e}"))
                print("   Tentando novamente em 30 segundos...")
                await asyncio.sleep(30)


# ═══════════════════════════════════════════════════════════════════════════════
# EXECUÇÃO - INICIA AUTOMATICAMENTE O MONITORAMENTO
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print()
    print(cor(Cores.CYAN, "╔" + "═" * 60 + "╗"))
    print(cor(Cores.CYAN, "║") + cor(Cores.BOLD, " 🎵 MONITOR DE RÁDIOS - SUPABASE EDITION ".center(60)) + cor(Cores.CYAN, "║"))
    print(cor(Cores.CYAN, "╚" + "═" * 60 + "╝"))
    print()
    
    # Carregar configuração local (para intervalo, etc)
    config = carregar_configuracao()
    
    print()
    if SUPABASE_OK:
        print(cor(Cores.GREEN, "  ✅ Modo Supabase ativo (REST API)!"))
        print(cor(Cores.CYAN, "  📻 As emissoras serão carregadas automaticamente do banco de dados"))
    else:
        print(cor(Cores.YELLOW, "  ⚠️  Supabase não conectado - usando modo local"))
    print()
    print(cor(Cores.CYAN, "  Pressione Ctrl+C a qualquer momento para encerrar."))
    print()
    
    # Iniciar monitoramento automaticamente
    asyncio.run(RadioMonitor(config).iniciar())
