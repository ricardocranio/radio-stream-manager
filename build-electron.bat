@echo off
chcp 65001 >nul
echo ========================================
echo   Programador Radio - Build Script
echo   (Instalador + Versao Portatil)
echo ========================================
echo.

echo [1/6] Limpando pasta release anterior...
if exist release rmdir /s /q release
echo OK!
echo.

echo [2/6] Criando .env (sem espacos extras)...
>".env" (
    echo|set /p="VITE_SUPABASE_URL=https://liuyuvxbdmowtidjhfnc.supabase.co"
    echo.
    echo|set /p="VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpdXl1dnhiZG1vd3RpZGpoZm5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg3NTMzOTIsImV4cCI6MjA4NDMyOTM5Mn0.S-dt-yzcHn9g3u3K6fTGJbNNPPX-K0wMQFEwh3s7eTc"
    echo.
)
echo Verificando .env:
type .env
echo.
echo OK!
echo.

echo [3/6] Instalando dependencias...
call npm install
call npm install --save-dev electron@latest electron-builder@latest
echo OK!
echo.

echo [4/6] Gerando build do Vite...
call npm run build
if errorlevel 1 (
    echo ERRO: Falha no build do Vite!
    pause
    exit /b 1
)
echo OK!
echo.

echo [5/6] Empacotando com Electron Builder...
call npx electron-builder --win --x64
if errorlevel 1 (
    echo ERRO: Falha no Electron Builder!
    pause
    exit /b 1
)
echo OK!
echo.

echo [6/6] Criando arquivo ZIP para distribuicao...
if exist "release\Programador-Radio-Portable.zip" del "release\Programador-Radio-Portable.zip"
powershell -Command "Compress-Archive -Path 'release\win-unpacked\*' -DestinationPath 'release\Programador-Radio-Portable.zip' -Force"
if errorlevel 1 (
    echo AVISO: Falha ao criar ZIP, mas os arquivos estao disponiveis.
) else (
    echo OK!
)
echo.

echo ========================================
echo   BUILD CONCLUIDO COM SUCESSO!
echo ========================================
echo.
echo Arquivos gerados em release\:
echo.
echo   [INSTALADOR] Programador Radio-Setup-X.X.X.exe
echo                Para distribuicao oficial
echo.
echo   [PASTA]      win-unpacked\
echo                Versao portatil (sem instalacao)
echo.
echo   [ZIP]        Programador-Radio-Portable.zip
echo                Versao portatil compactada
echo.
pause
