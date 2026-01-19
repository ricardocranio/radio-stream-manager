#!/usr/bin/env python3
"""
╔═══════════════════════════════════════════════════════════════════════════════╗
║             MONITOR DE RÁDIOS - COM ENVIO PARA SUPABASE                       ║
║                                                                               ║
║  Monitora "Tocando Agora" e "Últimas Tocadas" de múltiplas rádios            ║
║  e envia os dados para o banco de dados Supabase automaticamente             ║
║                                                                               ║
║  Baseado no script original de Manus AI                                       ║
╚═══════════════════════════════════════════════════════════════════════════════╝

USO:
    python radio_monitor_supabase.py

CONFIGURAÇÃO:
    - Configure SUPABASE_URL e SUPABASE_ANON_KEY abaixo
    - Edite a lista RADIOS_URLS para adicionar/remover rádios
    - Ajuste INTERVALO_MINUTOS para alterar a frequência
"""

import subprocess
import sys
import os

# ═══════════════════════════════════════════════════════════════════════════════
# AUTO-INSTALAÇÃO DE DEPENDÊNCIAS
# ═══════════════════════════════════════════════════════════════════════════════

def instalar_dependencias():
    """Instala automaticamente todas as dependências necessárias"""
    
    dependencias = [
        'playwright',
        'requests',
        'supabase',
    ]
    
    print("🔧 Verificando e instalando dependências...")
    print()
    
    for dep in dependencias:
        try:
            __import__(dep.replace('-', '_'))
            print(f"  ✅ {dep} já instalado")
        except ImportError:
            print(f"  📦 Instalando {dep}...")
            try:
                subprocess.check_call(
                    [sys.executable, '-m', 'pip', 'install', dep, '-q'],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
                print(f"  ✅ {dep} instalado com sucesso")
            except subprocess.CalledProcessError:
                print(f"  ❌ Erro ao instalar {dep}")
                print(f"     Tente manualmente: pip install {dep}")
                sys.exit(1)
    
    # Verificar se o Playwright tem o navegador instalado
    print()
    print("🌐 Verificando navegador Chromium...")
    
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            try:
                browser = p.chromium.launch(headless=True)
                browser.close()
                print("  ✅ Chromium já instalado")
            except Exception:
                print("  📦 Instalando Chromium (pode demorar alguns minutos)...")
                subprocess.check_call(
                    [sys.executable, '-m', 'playwright', 'install', 'chromium'],
                    stdout=subprocess.DEVNULL if os.name != 'nt' else None,
                    stderr=subprocess.DEVNULL if os.name != 'nt' else None
                )
                print("  ✅ Chromium instalado com sucesso")
    except Exception as e:
        print(f"  ⚠️  Erro ao verificar Chromium: {e}")
        print("     Executando instalação do Chromium...")
        try:
            subprocess.check_call([sys.executable, '-m', 'playwright', 'install', 'chromium'])
            print("  ✅ Chromium instalado")
        except:
            print("  ❌ Falha ao instalar Chromium")
            print("     Tente manualmente: playwright install chromium")
    
    print()
    print("✅ Todas as dependências estão prontas!")
    print()

# Executar instalação de dependências antes de importar
instalar_dependencias()

# ═══════════════════════════════════════════════════════════════════════════════
# IMPORTS (após instalação das dependências)
# ═══════════════════════════════════════════════════════════════════════════════

import asyncio
import json
import socket
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, List, Any
import time

from playwright.async_api import async_playwright, Browser, Page
from supabase import create_client, Client

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURAÇÃO SUPABASE - EDITE AQUI
# ═══════════════════════════════════════════════════════════════════════════════

SUPABASE_URL = "https://liuyuvxbdmowtidjhfnc.supabase.co"
SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpdXl1dnhiZG1vd3RpZGpoZm5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg3NTMzOTIsImV4cCI6MjA4NDMyOTM5Mn0.S-dt-yzcHn9g3u3K6fTGJbNNPPX-K0wMQFEwh3s7eTc"

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURAÇÃO - EDITE AQUI
# ═══════════════════════════════════════════════════════════════════════════════

# Lista de URLs das rádios para monitorar
RADIOS_URLS = [
    "https://mytuner-radio.com/pt/radio/radio-bh-fm-402270",
    # Adicione mais rádios aqui:
    # "https://mytuner-radio.com/pt/radio/band-fm-sao-paulo-485671",
    # "https://mytuner-radio.com/pt/radio/radio-jovem-pan-fm-sao-paulo-485604",
]

# Intervalo de atualização em minutos
INTERVALO_MINUTOS = 5

# Mostrar navegador (True) ou rodar em background (False)
MOSTRAR_NAVEGADOR = False

# ═══════════════════════════════════════════════════════════════════════════════
# CLIENTE SUPABASE
# ═══════════════════════════════════════════════════════════════════════════════

supabase: Client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)

# ═══════════════════════════════════════════════════════════════════════════════
# CLASSES E FUNÇÕES
# ═══════════════════════════════════════════════════════════════════════════════

class Cores:
    """Cores ANSI para terminal"""
    RESET = "\033[0m"
    BOLD = "\033[1m"
    RED = "\033[91m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    MAGENTA = "\033[95m"
    CYAN = "\033[96m"
    WHITE = "\033[97m"


def parse_song_text(text: str) -> Dict[str, str]:
    """Extrai título e artista de uma string de música"""
    lines = [l.strip() for l in text.strip().split('\n') if l.strip()]
    
    if len(lines) >= 2:
        title = lines[0]
        artist = lines[1]
        return {"title": title, "artist": artist}
    elif len(lines) == 1:
        # Tentar separar por " - "
        if " - " in lines[0]:
            parts = lines[0].split(" - ", 1)
            return {"title": parts[1], "artist": parts[0]}
        return {"title": lines[0], "artist": "Desconhecido"}
    
    return {"title": "Desconhecido", "artist": "Desconhecido"}


class RadioMonitor:
    """Classe principal para monitoramento de rádios"""
    
    def __init__(self, urls: List[str], intervalo_minutos: int = 5):
        self.urls = urls
        self.intervalo = intervalo_minutos * 60
        self.browser: Optional[Browser] = None
        self.online = True
        
    def _cor(self, cor: str, texto: str) -> str:
        """Aplica cor ao texto"""
        return f"{cor}{texto}{Cores.RESET}"
    
    def _verificar_internet(self) -> bool:
        """Verifica se há conexão com a internet"""
        try:
            socket.create_connection(("8.8.8.8", 53), timeout=3)
            return True
        except OSError:
            return False
    
    def _limpar_tela(self):
        """Limpa a tela do terminal"""
        os.system('cls' if os.name == 'nt' else 'clear')
    
    def _exibir_cabecalho(self):
        """Exibe o cabeçalho do monitor"""
        self._limpar_tela()
        print(self._cor(Cores.CYAN, "╔" + "═" * 70 + "╗"))
        print(self._cor(Cores.CYAN, "║") + self._cor(Cores.BOLD + Cores.WHITE, "     🎵 MONITOR DE RÁDIOS - SUPABASE SYNC 🎵".center(70)) + self._cor(Cores.CYAN, "║"))
        print(self._cor(Cores.CYAN, "╚" + "═" * 70 + "╝"))
        print()
        
        if self.online:
            status = self._cor(Cores.GREEN, "● ONLINE - Enviando para Supabase")
        else:
            status = self._cor(Cores.RED, "● OFFLINE - Aguardando reconexão...")
        
        print(f"  Status: {status}")
        print(f"  Rádios monitoradas: {len(self.urls)}")
        print()
        print(self._cor(Cores.YELLOW, "─" * 72))
    
    async def _extrair_dados_radio(self, page: Page, url: str) -> Dict[str, Any]:
        """Extrai dados de uma rádio específica"""
        dados = {
            "url": url,
            "nome": "Desconhecido",
            "tocando_agora": None,
            "ultimas_tocadas": [],
            "timestamp": datetime.now().isoformat(),
            "erro": None
        }
        
        try:
            await page.goto(url, wait_until='networkidle', timeout=30000)
            await asyncio.sleep(3)
            
            # Extrair nome da rádio
            try:
                titulo = await page.query_selector('h1')
                if titulo:
                    dados["nome"] = (await titulo.inner_text()).replace("Rádio ", "").strip()
            except:
                pass
            
            # Extrair "Tocando Agora"
            try:
                seletores_now = [
                    '.latest-song', 
                    '#now-playing + .latest-song', 
                    '.now-playing-song', 
                    '.current-song',
                    '.slogan-metadata .latest-song',
                ]
                for seletor in seletores_now:
                    elemento = await page.query_selector(seletor)
                    if elemento:
                        texto = await elemento.inner_text()
                        if texto.strip() and len(texto.strip()) > 2:
                            dados["tocando_agora"] = texto.strip()
                            break
                
                if not dados["tocando_agora"]:
                    resultado = await page.evaluate('''() => {
                        const seletores = ['.latest-song', '.current-song', '.now-playing'];
                        for (const sel of seletores) {
                            const el = document.querySelector(sel);
                            if (el && el.innerText.trim()) return el.innerText.trim();
                        }
                        const nowPlaying = document.querySelector('#now-playing');
                        if (nowPlaying && nowPlaying.nextElementSibling) {
                            return nowPlaying.nextElementSibling.innerText.trim();
                        }
                        return null;
                    }''')
                    if resultado:
                        dados["tocando_agora"] = resultado
                        
            except Exception as e:
                dados["erro"] = f"Erro ao extrair tocando agora: {str(e)}"
            
            # Extrair "Últimas Tocadas"
            try:
                seletores_hist = [
                    '#song-history', 
                    '.song-history', 
                    '.playlist-history', 
                ]
                for seletor in seletores_hist:
                    elemento = await page.query_selector(seletor)
                    if elemento:
                        itens = await elemento.query_selector_all('.song-item, .history-item, .track-item, > div')
                        for item in itens[:15]:
                            texto = await item.inner_text()
                            texto = texto.strip()
                            if texto and len(texto) > 3 and texto not in dados["ultimas_tocadas"]:
                                dados["ultimas_tocadas"].append(texto)
                        
                        if not dados["ultimas_tocadas"]:
                            texto_completo = await elemento.inner_text()
                            linhas = [l.strip() for l in texto_completo.split('\n') if l.strip() and len(l.strip()) > 3]
                            dados["ultimas_tocadas"] = list(dict.fromkeys(linhas))[:15]
                        
                        if dados["ultimas_tocadas"]:
                            break
                        
            except Exception as e:
                if not dados["erro"]:
                    dados["erro"] = f"Erro ao extrair histórico: {str(e)}"
                    
        except Exception as e:
            dados["erro"] = f"Erro ao acessar página: {str(e)}"
        
        return dados
    
    def _enviar_para_supabase(self, station_name: str, tocando_agora: str, ultimas: List[str], station_url: str):
        """Envia os dados capturados para o Supabase"""
        try:
            # Primeiro, verificar/criar a estação no banco
            result = supabase.table('radio_stations').select('id').eq('name', station_name).execute()
            
            if result.data and len(result.data) > 0:
                station_id = result.data[0]['id']
            else:
                # Criar estação
                insert_result = supabase.table('radio_stations').insert({
                    'name': station_name,
                    'scrape_url': station_url,
                    'styles': ['SERTANEJO'],
                    'enabled': True
                }).execute()
                station_id = insert_result.data[0]['id']
            
            # Enviar música tocando agora
            if tocando_agora:
                song = parse_song_text(tocando_agora)
                
                # Verificar se já existe recentemente
                check = supabase.table('scraped_songs').select('id').eq('station_id', station_id).eq('title', song['title']).eq('artist', song['artist']).gte('scraped_at', (datetime.now().replace(second=0, microsecond=0)).isoformat()).execute()
                
                if not check.data:
                    supabase.table('scraped_songs').insert({
                        'station_id': station_id,
                        'station_name': station_name,
                        'title': song['title'],
                        'artist': song['artist'],
                        'is_now_playing': True,
                        'source': station_url
                    }).execute()
                    print(self._cor(Cores.GREEN, f"     ✓ Enviado: {song['artist']} - {song['title']}"))
            
            # Enviar últimas tocadas
            for musica_texto in ultimas[:5]:
                song = parse_song_text(musica_texto)
                
                # Verificar duplicatas (última hora)
                from datetime import timedelta
                one_hour_ago = (datetime.now() - timedelta(hours=1)).isoformat()
                check = supabase.table('scraped_songs').select('id').eq('station_id', station_id).eq('title', song['title']).eq('artist', song['artist']).gte('scraped_at', one_hour_ago).execute()
                
                if not check.data:
                    supabase.table('scraped_songs').insert({
                        'station_id': station_id,
                        'station_name': station_name,
                        'title': song['title'],
                        'artist': song['artist'],
                        'is_now_playing': False,
                        'source': station_url
                    }).execute()
                    
        except Exception as e:
            print(self._cor(Cores.RED, f"     ✗ Erro Supabase: {e}"))
    
    def _exibir_radio(self, dados: Dict[str, Any], indice: int):
        """Exibe os dados de uma rádio no terminal"""
        print()
        print(self._cor(Cores.BOLD + Cores.MAGENTA, f"  📻 {dados['nome']}"))
        print(self._cor(Cores.BLUE, f"     {dados['url']}"))
        print()
        
        if dados["tocando_agora"]:
            print(self._cor(Cores.GREEN, "     🎵 TOCANDO AGORA:"))
            print(self._cor(Cores.WHITE + Cores.BOLD, f"        {dados['tocando_agora'][:50]}..."))
        else:
            print(self._cor(Cores.YELLOW, "     🎵 TOCANDO AGORA: (não disponível)"))
        
        print()
        
        if dados["ultimas_tocadas"]:
            print(self._cor(Cores.CYAN, f"     📜 ÚLTIMAS TOCADAS: {len(dados['ultimas_tocadas'])} músicas"))
        else:
            print(self._cor(Cores.YELLOW, "     📜 ÚLTIMAS TOCADAS: (não disponível)"))
        
        if dados["erro"]:
            print()
            print(self._cor(Cores.RED, f"     ⚠️  {dados['erro']}"))
        
        print()
        print(self._cor(Cores.YELLOW, "─" * 72))
    
    async def _atualizar_todas_radios(self):
        """Atualiza dados de todas as rádios"""
        async with async_playwright() as p:
            self.browser = await p.chromium.launch(headless=not MOSTRAR_NAVEGADOR)
            page = await self.browser.new_page()
            
            await page.set_extra_http_headers({
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            })
            
            self._exibir_cabecalho()
            
            for i, url in enumerate(self.urls):
                print(self._cor(Cores.YELLOW, f"  🔄 Atualizando rádio {i+1}/{len(self.urls)}..."))
                
                dados = await self._extrair_dados_radio(page, url)
                self._exibir_radio(dados, i)
                
                # Enviar para Supabase
                print(self._cor(Cores.CYAN, "     📤 Enviando para Supabase..."))
                self._enviar_para_supabase(
                    dados["nome"],
                    dados["tocando_agora"],
                    dados["ultimas_tocadas"],
                    url
                )
            
            await self.browser.close()
            
            print(self._cor(Cores.GREEN, f"\n  ✅ Dados enviados para Supabase com sucesso!"))
    
    async def _aguardar_reconexao(self):
        """Aguarda a reconexão com a internet"""
        while not self._verificar_internet():
            print(self._cor(Cores.RED, f"  ⚠️  SEM CONEXÃO - Aguardando..."))
            await asyncio.sleep(30)
        
        self.online = True
        print(self._cor(Cores.GREEN, "\n  ✅ CONEXÃO RESTABELECIDA!\n"))
        await asyncio.sleep(2)
    
    async def iniciar(self):
        """Inicia o loop de monitoramento"""
        print(self._cor(Cores.CYAN, "\n🚀 Iniciando Monitor de Rádios com Supabase...\n"))
        
        while True:
            try:
                if not self._verificar_internet():
                    self.online = False
                    await self._aguardar_reconexao()
                
                self.online = True
                await self._atualizar_todas_radios()
                
                # Countdown
                for segundos in range(self.intervalo, 0, -1):
                    minutos = segundos // 60
                    segs = segundos % 60
                    sys.stdout.write(f"\r  ⏱️  Próxima atualização em: {minutos:02d}:{segs:02d}  ")
                    sys.stdout.flush()
                    await asyncio.sleep(1)
                    
                    if segundos % 30 == 0 and not self._verificar_internet():
                        self.online = False
                        break
                
            except KeyboardInterrupt:
                print(self._cor(Cores.YELLOW, "\n\n👋 Monitoramento encerrado."))
                break
            except Exception as e:
                print(self._cor(Cores.RED, f"\n❌ Erro: {e}"))
                print("   Tentando novamente em 30 segundos...")
                await asyncio.sleep(30)


# ═══════════════════════════════════════════════════════════════════════════════
# EXECUÇÃO PRINCIPAL
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("""
╔═══════════════════════════════════════════════════════════════════════════════╗
║             MONITOR DE RÁDIOS - SINCRONIZADO COM SUPABASE                     ║
╚═══════════════════════════════════════════════════════════════════════════════╝

Este script captura as músicas das rádios e envia automaticamente para o banco
de dados Supabase. Os dados ficam disponíveis no aplicativo web em tempo real.

Pressione Ctrl+C para parar.
""")
    
    asyncio.run(RadioMonitor(RADIOS_URLS, INTERVALO_MINUTOS).iniciar())
