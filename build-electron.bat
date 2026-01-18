@echo off
echo ========================================
echo   Programador Radio - Build Script
echo   (Instalador + Versao Portatil)
echo ========================================
echo.

echo [1/5] Limpando pasta release anterior...
if exist release rmdir /s /q release
echo OK!
echo.

echo [2/5] Instalando dependencias...
call npm install
echo OK!
echo.

echo [3/5] Gerando build do Vite...
call npm run build
if errorlevel 1 (
    echo ERRO: Falha no build do Vite!
    pause
    exit /b 1
)
echo OK!
echo.

echo [4/5] Empacotando com Electron Builder...
call npx electron-builder --win --x64
if errorlevel 1 (
    echo ERRO: Falha no Electron Builder!
    pause
    exit /b 1
)
echo OK!
echo.

echo [5/5] Criando arquivo ZIP para distribuicao...
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
