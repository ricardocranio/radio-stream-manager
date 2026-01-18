@echo off
echo ========================================
echo   Programador Radio - Build Script
echo   (Versao Portatil - Sem Instalador)
echo ========================================
echo.

echo [1/4] Limpando pasta release anterior...
if exist release rmdir /s /q release
echo OK!
echo.

echo [2/4] Instalando dependencias...
call npm install
echo OK!
echo.

echo [3/4] Gerando build do Vite...
call npm run build
if errorlevel 1 (
    echo ERRO: Falha no build do Vite!
    pause
    exit /b 1
)
echo OK!
echo.

echo [4/4] Empacotando com Electron Builder (Portatil)...
call npx electron-builder --win --x64 --dir
if errorlevel 1 (
    echo ERRO: Falha no Electron Builder!
    pause
    exit /b 1
)
echo OK!
echo.

echo ========================================
echo   BUILD CONCLUIDO COM SUCESSO!
echo ========================================
echo.
echo A aplicacao portatil esta em:
echo release\win-unpacked\
echo.
echo Execute: Programador Radio.exe
echo.
pause
