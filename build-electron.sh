#!/bin/bash

echo "========================================"
echo "  Programador Radio - Build Script"
echo "========================================"
echo ""

echo "[1/4] Limpando pasta release anterior..."
rm -rf release
echo "OK!"
echo ""

echo "[2/4] Instalando dependencias..."
npm install
echo "OK!"
echo ""

echo "[3/4] Gerando build do Vite..."
npm run build
if [ $? -ne 0 ]; then
    echo "ERRO: Falha no build do Vite!"
    exit 1
fi
echo "OK!"
echo ""

echo "[4/4] Empacotando com Electron Builder..."
npx electron-builder --win --x64
if [ $? -ne 0 ]; then
    echo "ERRO: Falha no Electron Builder!"
    exit 1
fi
echo "OK!"
echo ""

echo "========================================"
echo "  BUILD CONCLUIDO COM SUCESSO!"
echo "========================================"
echo ""
echo "O instalador esta em: release/"
