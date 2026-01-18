@echo off
echo ========================================
echo   Programador Radio - Build Script
echo   (Versao Portatil - Sem Instalador)
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

echo [4/5] Empacotando com Electron Builder (Portatil)...
call npx electron-builder --win --x64 --dir
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
    echo AVISO: Falha ao criar ZIP, mas a pasta portatil esta disponivel.
) else (
    echo OK!
)
echo.

echo ========================================
echo   BUILD CONCLUIDO COM SUCESSO!
echo ========================================
echo.
echo Arquivos gerados:
echo.
echo   [PASTA] release\win-unpacked\
echo           Execute: Programador Radio.exe
echo.
echo   [ZIP]   release\Programador-Radio-Portable.zip
echo           Pronto para distribuicao!
echo.
pause
