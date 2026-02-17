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

import requests as http_requests

try:
    from playwright.async_api import async_playwright, Page
    PLAYWRIGHT_OK = True
except ImportError:
    PLAYWRIGHT_OK = False

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURAÇÃO DO SUPABASE (via HTTP requests - sem SDK)
# ═══════════════════════════════════════════════════════════════════════════════

SUPABASE_URL = "https://liuyuvxbdmowtidjhfnc.supabase.co"
SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpdXl1dnhiZG1vd3RpZGpoZm5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg3NTMzOTIsImV4cCI6MjA4NDMyOTM5Mn0.S-dt-yzcHn9g3u3K6fTGJbNNPPX-K0wMQFEwh3s7eTc"

SUPABASE_HEADERS = {
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
}

supabase_connected = False

def supabase_get(table, params=None):
    """GET request to Supabase REST API"""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    r = http_requests.get(url, headers=SUPABASE_HEADERS, params=params, timeout=15)
    r.raise_for_status()
    return r.json()

def supabase_insert(table, data):
    """POST (insert) to Supabase REST API"""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    r = http_requests.post(url, headers=SUPABASE_HEADERS, json=data, timeout=15)
    # 201 = created, 409 = conflict (duplicate), both ok
    if r.status_code not in (200, 201, 409):
        r.raise_for_status()

def inicializar_supabase(max_tentativas=3):
    """Testa conexão com Supabase via HTTP"""
    global supabase_connected
    
    for tentativa in range(1, max_tentativas + 1):
        try:
            print(f"  🔄 Conectando ao Supabase (tentativa {tentativa}/{max_tentativas})...")
            data = supabase_get("radio_stations", {"select": "id", "limit": "1"})
            supabase_connected = True
            print(f"  ✅ Supabase conectado via HTTP!")
            return True
        except Exception as e:
            erro_str = str(e)
            print(f"  ⚠️  Tentativa {tentativa} falhou: {erro_str[:120]}")
            supabase_connected = False
            if tentativa < max_tentativas:
                import time
                time.sleep(tentativa * 5)
    
    print("  ❌ Não foi possível conectar ao Supabase")
    return False

# Executar inicialização
inicializar_supabase()

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURAÇÃO LOCAL (FALLBACK)
# ═══════════════════════════════════════════════════════════════════════════════

ARQUIVO_CONFIG = "radios_config.json"

CONFIG_PADRAO = {
    "configuracao": {
        "intervalo_minutos": 5,
        "mostrar_navegador": False
    },
    "radios": []
}

def carregar_configuracao():
    """Carrega configuração do arquivo JSON ou cria arquivo padrão"""
    if Path(ARQUIVO_CONFIG).exists():
        try:
            with open(ARQUIVO_CONFIG, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"  ⚠️  Erro ao carregar {ARQUIVO_CONFIG}: {e}")
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
    """Extrai título e artista de um texto de música"""
    if not text:
        return {"title": "", "artist": ""}
    
    text = text.strip()
    
    # MyTuner format: lines separated by newlines (Title\nArtist\nTime ago)
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    if len(lines) >= 2:
        # Filter out time indicators (e.g. "30 min ago", "LIVE", "2 hours ago")
        time_words = ['min ago', 'hour ago', 'hours ago', 'sec ago', 'LIVE', 'just now', 'min atrás', 'hora atrás']
        clean_lines = [l for l in lines if not any(tw.lower() in l.lower() for tw in time_words)]
        if len(clean_lines) >= 2:
            return {"title": clean_lines[0], "artist": clean_lines[1]}
        elif len(clean_lines) == 1:
            # Only one meaningful line, try separator parsing below
            text = clean_lines[0]
    
    # Standard formats: "Artista - Título" or "Título - Artista"
    separators = [" - ", " – ", " — ", " | "]
    
    for sep in separators:
        if sep in text:
            parts = text.split(sep, 1)
            if len(parts) == 2:
                return {"artist": parts[0].strip(), "title": parts[1].strip()}
    
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
        self.historico = {"radios": {}, "ultima_atualizacao": None}
        self.online = True
        self.supabase_stations = {}  # Mapa nome -> id
        
    def _salvar_historico(self):
        pass  # Histórico salvo apenas no banco de dados
    
    def _salvar_relatorio(self):
        pass  # Relatório salvo apenas no banco de dados
    
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
        supabase_status = cor(Cores.GREEN, "● CONECTADO") if supabase_connected else cor(Cores.RED, "● DESCONECTADO")
        print(f"  Internet: {status}")
        print(f"  Supabase: {supabase_status}")
        print(f"  Última atualização: {self.historico.get('ultima_atualizacao', 'Nunca')}")
        print(f"  Intervalo: {self.config.get('intervalo_minutos', 5)} minutos")
        print(f"  Rádios ativas: {len(self.radios)}")
        print()
        print(cor(Cores.YELLOW, "─" * 72))
    
    def _carregar_radios_supabase(self) -> List[Dict]:
        """Carrega as rádios ativas do Supabase via HTTP"""
        if not supabase_connected:
            print(cor(Cores.YELLOW, "  ⚠️  Supabase não conectado, usando config local"))
            config = carregar_configuracao()
            return [r for r in config.get('radios', []) if r.get('ativo', True)]
        
        try:
            stations = supabase_get("radio_stations", {"select": "*", "enabled": "eq.true"})
            
            radios = []
            for station in stations:
                url = station.get('scrape_url', '')
                tipo = 'clubefm' if 'clubefm' in url.lower() else 'mytuner'
                
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
        """Envia dados capturados para o Supabase via HTTP"""
        if not supabase_connected:
            return
        
        try:
            station_id = radio.get('id') or self.supabase_stations.get(dados['nome'])
            station_name = dados['nome']
            
            if dados.get('tocando_agora'):
                song_info = parse_song_text(dados['tocando_agora'])
                
                song_data = {
                    'station_name': station_name,
                    'station_id': station_id,
                    'title': song_info['title'] or dados['tocando_agora'],
                    'artist': song_info['artist'] or 'Desconhecido',
                    'is_now_playing': True,
                    'source': 'python_monitor'
                }
                supabase_insert('scraped_songs', song_data)
                
                historico_data = {
                    'station_name': station_name,
                    'title': song_info['title'] or dados['tocando_agora'],
                    'artist': song_info['artist'] or 'Desconhecido',
                    'source': 'python_monitor'
                }
                try:
                    supabase_insert('radio_historico', historico_data)
                except:
                    pass
                
                print(cor(Cores.GREEN, f"     ☁️  Enviado para Supabase: {song_info['title']}"))
            
            for song_text in dados.get('ultimas_tocadas', [])[:5]:
                song_info = parse_song_text(song_text)
                
                song_data = {
                    'station_name': station_name,
                    'station_id': station_id,
                    'title': song_info['title'] or song_text,
                    'artist': song_info['artist'] or 'Desconhecido',
                    'is_now_playing': False,
                    'source': 'python_monitor'
                }
                supabase_insert('scraped_songs', song_data)
                
                try:
                    supabase_insert('radio_historico', {
                        'station_name': station_name,
                        'title': song_info['title'] or song_text,
                        'artist': song_info['artist'] or 'Desconhecido',
                        'source': 'python_monitor'
                    })
                except:
                    pass
                
        except Exception as e:
            print(cor(Cores.YELLOW, f"     ⚠️  Erro Supabase: {str(e)[:80]}"))
    
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
    
    def _verificar_supabase(self):
        """Verifica conexão Supabase e reconecta se necessário"""
        global supabase_connected
        if supabase_connected:
            try:
                supabase_get("radio_stations", {"select": "id", "limit": "1"})
                return True
            except:
                print(cor(Cores.YELLOW, "  ⚠️  Conexão Supabase perdida, reconectando..."))
                supabase_connected = False
        
        return inicializar_supabase(max_tentativas=2)
    
    async def _atualizar_todas(self):
        if not PLAYWRIGHT_OK:
            print(cor(Cores.RED, "❌ Playwright não disponível"))
            return
        
        # Verificar/reconectar Supabase antes de cada ciclo
        self._verificar_supabase()
        
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
            
            if supabase_connected:
                print(cor(Cores.CYAN, f"\n  ☁️  Dados sincronizados com Supabase!"))
    
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
    if supabase_connected:
        print(cor(Cores.GREEN, "  ✅ Modo Supabase ativo!"))
        print(cor(Cores.CYAN, "  📻 As emissoras serão carregadas automaticamente do banco de dados"))
    else:
        print(cor(Cores.YELLOW, "  ⚠️  Supabase não conectado - usando modo local"))
    print()
    print(cor(Cores.CYAN, "  Pressione Ctrl+C a qualquer momento para encerrar."))
    print()
    
    # Iniciar monitoramento automaticamente
    asyncio.run(RadioMonitor(config).iniciar())
