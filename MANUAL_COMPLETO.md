# 📻 Programador Rádio - Manual Completo

## 📋 Índice
1. [Requisitos do Sistema](#requisitos-do-sistema)
2. [Instalação e Build](#instalação-e-build)
3. [Primeiro Uso](#primeiro-uso)
4. [Funcionalidades Principais](#funcionalidades-principais)
5. [Modo Serviço (Híbrido)](#modo-serviço-híbrido)
6. [Configurações](#configurações)
7. [Solução de Problemas](#solução-de-problemas)

---

## 🖥️ Requisitos do Sistema

### Mínimos
- **Sistema Operacional:** Windows 10/11 (64-bit)
- **RAM:** 4 GB
- **Espaço em Disco:** 500 MB
- **Node.js:** 18 ou superior
- **Git:** Instalado

### Recomendados
- **RAM:** 8 GB
- **Conexão:** Internet estável para scraping de rádios
- **Python:** 3.8+ (para downloads do Deezer via deemix)

---

## 🔧 Instalação e Build

### Passo 1: Clonar o Repositório

```bash
cd C:\Users\Ricardo\Downloads
git clone https://github.com/ricardocranio/radio-stream-manager.git programador
cd programador
```

### Passo 2: Instalar Dependências

```bash
npm install
```

### Passo 3: Build Rápido (Windows)

**Opção A - Script Automático (Recomendado):**
```bash
build-electron.bat
```

**Opção B - Comandos Manuais:**
```bash
# 1. Gerar build do Vite
npm run build

# 2. Empacotar com Electron Builder
npx electron-builder --win --x64
```

### Passo 4: Localizar o Instalador

Após o build, os arquivos estarão em:
```
programador/release/
├── Programador Rádio-Setup-X.X.X.exe  ← Instalador oficial
├── win-unpacked/                       ← Versão portátil (sem instalação)
└── Programador-Radio-Portable.zip      ← Versão portátil compactada
```

### Build Limpo (Se Houver Erros)

```bash
# Limpar tudo
rmdir /s /q node_modules
rmdir /s /q dist
rmdir /s /q release

# Reinstalar
npm install
npm install electron --save-dev

# Build
npm run build
npx electron-builder --win --x64
```

---

## 🚀 Primeiro Uso

### Inicialização
1. Execute o instalador ou a versão portátil
2. O app criará automaticamente as pastas:
   - `C:\Playlist\pgm\Grades` - Grades de programação
   - `C:\Playlist\Downloads` - Downloads do Deezer
   - `C:\Playlist\A Voz do Brasil` - Arquivos da Voz do Brasil
   - `C:\Playlist\Músicas` - Biblioteca musical

### Configuração Inicial
1. Vá em **Configurações** (ícone de engrenagem)
2. Configure as **Pastas** do sistema
3. Configure o **ARL do Deezer** (opcional, para downloads)
4. Ative as **Emissoras** que deseja monitorar

---

## 📡 Funcionalidades Principais

### 1. Dashboard
- Visão geral do sistema
- Status do monitoramento em tempo real
- Próximas grades agendadas
- Estatísticas da biblioteca musical

### 2. Emissoras
- Lista de rádios monitoradas
- Ativar/desativar emissoras
- Adicionar novas emissoras
- Ver músicas capturadas por emissora

### 3. Músicas Capturadas
- Lista de todas as músicas detectadas nas rádios
- Filtros por emissora, data, status
- Verificação na biblioteca local
- Download direto do Deezer

### 4. Ranking
- Top músicas mais tocadas
- Filtros por período e emissora
- Exportação de relatórios

### 5. Construtor de Grade
- Criação automática de grades
- Baseado no ranking de músicas
- Configuração de horários e blocos
- Exportação em formato TXT

### 6. Agendamento
- Agenda de geração automática de grades
- Configuração por dia da semana
- Horários personalizados

### 7. Exportar
- Exportação manual de grades
- Formatos: TXT, CSV
- Seleção de dias específicos

### 8. Voz do Brasil
- Download automático às 20:35 (Seg-Sex)
- Gestão de arquivos baixados
- Limpeza automática de arquivos antigos

### 9. Monitoramento Especial
- Horários específicos de monitoramento
- Configuração por dia da semana
- Emissoras específicas por período

### 10. Pastas
- Configuração das pastas do sistema
- Visualização da estrutura de diretórios

### 11. Logs
- Histórico de atividades
- Erros e avisos do sistema
- Filtros por tipo e data

---

## 🔄 Modo Serviço (Híbrido)

### O que é?
O Modo Serviço permite que o app rode em background consumindo menos memória (~50MB vs ~200MB), enquanto você acessa a interface pelo navegador.

### Como Ativar
1. Clique no botão **"Modo Serviço"** no Header
2. Ou clique com botão direito no ícone da bandeja → "Ativar Modo Serviço"

### Configurações do Modo Serviço
Acesse **Configurações** → **Modo Serviço**:

- **Porta do Localhost:** Escolha entre 3000, 5173, 8080, 8000 ou 9000
- **Auto-iniciar:** O app inicia minimizado e abre o navegador automaticamente

### Indicadores
- **Header:** Mostra `localhost:PORTA` quando o servidor está ativo
- **Bandeja:** Ícone indica se está em modo janela ou serviço

### Alternar Modos
- **Modo Serviço → Janela:** Duplo clique no ícone da bandeja
- **Modo Janela → Serviço:** Botão no Header ou menu da bandeja

---

## ⚙️ Configurações

### Pastas do Sistema
| Pasta | Descrição | Padrão |
|-------|-----------|--------|
| Grades | Arquivos TXT das grades | `C:\Playlist\pgm\Grades` |
| Downloads | Músicas baixadas | `C:\Playlist\Downloads` |
| Voz do Brasil | Arquivos da Voz do Brasil | `C:\Playlist\A Voz do Brasil` |
| Biblioteca | Músicas existentes | `C:\Playlist\Músicas` |

### Deezer (ARL)
1. Obtenha seu ARL do Deezer (cookie de autenticação)
2. Cole em **Configurações** → **Deezer ARL**
3. Clique em **Validar** para testar

### Agendamentos
- **Grade Automática:** Horário para gerar grades automaticamente
- **Scraping:** Intervalo de captura das emissoras
- **Voz do Brasil:** Fixo às 20:35 (Seg-Sex)

### Modo Serviço
- **Porta:** 3000, 5173, 8080, 8000 ou 9000
- **Auto-iniciar:** Inicia minimizado na bandeja

---

## 🛠️ Solução de Problemas

### App não inicia
```bash
# Verifique se o Node.js está instalado
node --version

# Reinstale as dependências
npm install
```

### Build falha
```bash
# Build limpo
rmdir /s /q node_modules dist release
npm install
npm install electron --save-dev
npm run build
npx electron-builder --win --x64
```

### Erro "Cannot find module 'electron'"
```bash
npm install --save-dev electron
```

### Scraping não funciona
1. Verifique sua conexão com a internet
2. Algumas rádios podem ter proteção anti-scraping
3. O sistema usa Firecrawl como fallback

### Deemix não encontrado
1. Instale Python 3.8+
2. O app tentará instalar o deemix automaticamente
3. Ou instale manualmente: `pip install deemix`

### Modo Serviço não abre navegador
1. Verifique se a porta não está em uso
2. Tente outra porta nas configurações
3. Acesse manualmente: `http://localhost:PORTA`

### Grades não salvam
1. Verifique se a pasta existe
2. Verifique permissões de escrita
3. Caminho padrão: `C:\Playlist\pgm\Grades`

---

## 📁 Estrutura de Arquivos

```
C:\Playlist\
├── pgm\
│   └── Grades\
│       ├── SEG.txt
│       ├── TER.txt
│       ├── QUA.txt
│       ├── QUI.txt
│       ├── SEX.txt
│       ├── SÁB.txt
│       └── DOM.txt
├── Downloads\
│   └── [músicas baixadas]
├── A Voz do Brasil\
│   └── [arquivos da voz do brasil]
└── Músicas\
    └── [biblioteca musical]
```

---

## ⌨️ Atalhos

| Atalho | Ação |
|--------|------|
| Duplo clique na bandeja | Abrir/restaurar janela |
| Fechar janela (X) | Minimizar para bandeja |
| Menu bandeja | Opções do sistema |

---

## 📞 Suporte

- **GitHub:** [Issues](https://github.com/ricardocranio/radio-stream-manager/issues)
- **Versão:** Verificar em Ajuda → Sobre

---

## 📝 Changelog

### v5.1.0
- ✅ Modo Serviço Híbrido (localhost)
- ✅ Porta configurável (3000-9000)
- ✅ Auto-iniciar minimizado
- ✅ Indicador de status no Header
- ✅ Persistência de configurações
- ✅ Correção nome arquivo SÁB.txt

---

**Desenvolvido com ❤️ para rádios FM brasileiras**
