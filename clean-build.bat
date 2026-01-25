@echo off
echo ============================================
echo    PROGRAMADOR RADIO - BUILD LIMPO COMPLETO
echo ============================================
echo.

cd /d C:\Users\Ricardo\Downloads\programador

echo [1/7] Atualizando codigo do repositorio...
git pull origin main
if errorlevel 1 (
    echo ERRO: Falha ao atualizar repositorio
    pause
    exit /b 1
)
echo.

echo [2/7] Limpando pastas de build anteriores...
if exist "dist" rmdir /s /q "dist"
if exist "release" rmdir /s /q "release"
if exist ".vite" rmdir /s /q ".vite"
echo    Pastas dist, release e .vite removidas.
echo.

echo [3/7] Limpando node_modules (instalacao limpa)...
if exist "node_modules" rmdir /s /q "node_modules"
echo    node_modules removido.
echo.

echo [4/7] Limpando cache do npm...
call npm cache clean --force
echo.

echo [5/7] Instalando dependencias...
call npm install
if errorlevel 1 (
    echo ERRO: Falha ao instalar dependencias
    pause
    exit /b 1
)
echo.

echo [6/7] Instalando Electron como dependencia dev...
call npm install electron electron-builder --save-dev
echo.

echo [7/7] Executando build completo...
call npm run build
if errorlevel 1 (
    echo ERRO: Falha no build do Vite
    pause
    exit /b 1
)

echo.
echo Gerando instalador Electron...
call npx electron-builder --win
if errorlevel 1 (
    echo ERRO: Falha no electron-builder
    pause
    exit /b 1
)

echo.
echo ============================================
echo    BUILD COMPLETO COM SUCESSO!
echo ============================================
echo.
echo O instalador esta em: release\
echo.
echo Para testar sem reinstalar:
echo   1. Feche o app atual (tray tambem)
echo   2. Execute: npx electron .
echo.
pause
