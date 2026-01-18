# Guia de Build - Programador Rádio (Electron)

## Pré-requisitos

- Node.js 18+ instalado
- Git instalado
- Windows 10/11 (para build Windows)

## Passos para Gerar o Instalador

### 1. Clone o Repositório

```bash
cd C:\Users\Ricardo\Downloads
git clone https://github.com/ricardocranio/radio-stream-manager.git programador
cd programador
```

### 2. Instale as Dependências

```bash
npm install
```

### 3. Instale Dependências do Electron

```bash
npm install --save-dev electron electron-builder
```

### 4. Adicione Scripts ao package.json

Abra o arquivo `package.json` e adicione/modifique:

```json
{
  "name": "programador-radio",
  "version": "5.1.0",
  "main": "electron/main.js",
  "author": "PGM-FM",
  "description": "Sistema de geração automática de grades para rádios FM",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "electron": "electron .",
    "electron:dev": "concurrently \"npm run dev\" \"wait-on http://localhost:5173 && electron .\"",
    "electron:build": "npm run build && electron-builder --win --x64",
    "electron:build:all": "npm run build && electron-builder -mwl"
  }
}
```

### 5. Build do Projeto Web

```bash
npm run build
```

### 6. Gere o Instalador Windows

```bash
npx electron-builder --win --x64
```

Ou se você adicionou os scripts:

```bash
npm run electron:build
```

### 7. Encontre o Instalador

O instalador será gerado em:
```
programador/release/Programador Rádio-Setup-5.1.0.exe
```

## Estrutura de Arquivos Electron

```
programador/
├── electron/
│   ├── main.js          # Processo principal do Electron
│   └── preload.js       # Script de preload (bridge seguro)
├── build/
│   └── installer.nsh    # Scripts customizados NSIS (opcional)
├── electron-builder.json # Configuração do builder
├── dist/                 # Build do Vite (gerado)
└── release/             # Instaladores (gerado)
```

## Comandos Úteis

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Inicia servidor de desenvolvimento |
| `npm run build` | Gera build de produção |
| `npm run electron` | Executa Electron (após build) |
| `npm run electron:build` | Gera instalador Windows |

## Solução de Problemas

### Erro: "Cannot find module 'electron'"
```bash
npm install --save-dev electron
```

### Erro: "electron-builder not found"
```bash
npm install --save-dev electron-builder
```

### Erro de ícone
Certifique-se que `public/favicon.ico` existe e é um arquivo .ico válido (256x256px recomendado).

### Build muito lento
É normal que o primeiro build demore (download de binários). Builds subsequentes são mais rápidos.

## Personalização

### Alterar Ícone
Substitua `public/favicon.ico` por seu ícone personalizado.

### Alterar Nome do App
Edite `electron-builder.json`:
```json
{
  "productName": "Seu Nome Aqui"
}
```

### Alterar Versão
Edite `package.json`:
```json
{
  "version": "5.2.0"
}
```

## Auto-Update (Atualização Automática)

O aplicativo possui sistema de atualização automática integrado usando `electron-updater`.

### Configuração do GitHub Releases

1. **Configure o repositório em `electron-builder.json`:**
```json
{
  "publish": {
    "provider": "github",
    "owner": "SEU_USUARIO_GITHUB",
    "repo": "programador-radio",
    "releaseType": "release"
  }
}
```

2. **Crie um Personal Access Token no GitHub:**
   - Vá em Settings → Developer settings → Personal access tokens
   - Crie um token com permissão `repo`
   - Defina a variável de ambiente: `GH_TOKEN=seu_token`

3. **Para publicar uma nova versão:**
```bash
# Atualize a versão no package.json
# Então execute:
npm run build
npx electron-builder --win --x64 --publish always
```

4. **Criar release manual:**
   - Faça upload dos arquivos em GitHub Releases
   - Inclua: `Programador Radio-Setup-X.X.X.exe` e `latest.yml`

### Como Funciona

- O app verifica atualizações 5 segundos após iniciar
- Menu: Ajuda → Verificar Atualizações (verificação manual)
- Notificação Windows quando há atualização disponível
- Barra de progresso na taskbar durante download
- Diálogo para reiniciar e instalar após download

## Notas

- O app minimiza para a bandeja do sistema ao fechar
- Duplo clique no ícone da bandeja abre o app
- Apenas uma instância pode rodar por vez
- Dados são salvos em `%APPDATA%/programador-radio`
- Atualizações automáticas via GitHub Releases
