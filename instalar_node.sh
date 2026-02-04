#!/usr/bin/env bash
set -euo pipefail

NODE_VERSION=20

echo "==> Atualizando sistema..."
sudo apt update

echo "==> Instalando dependências..."
sudo apt install -y curl ca-certificates gnupg

echo "==> Adicionando repositório NodeSource (Node.js $NODE_VERSION)..."
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -

echo "==> Instalando Node.js e npm..."
sudo apt install -y nodejs

echo "==> Verificando instalação..."
node -v
npm -v

echo "✅ Node.js e npm instalados com sucesso!"
