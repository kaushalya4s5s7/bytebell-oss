#!/bin/bash
set -e

echo "Cloning ByteBell..."
git clone https://github.com/ByteBell/bytebell-oss
cd bytebell-oss

echo "Installing dependencies..."
bun install

echo "Linking binary..."
bun link

echo ""
read -p "Enter your OpenRouter API key: " KEY
read -p "Enter the repo URL to index: " URL
read -p "Enter model (press Enter for default): " MODEL
MODEL=${MODEL:-"anthropic/claude-sonnet-4-6"}

echo ""
echo "Configuring..."
bytebell set openrouter-api-key "$KEY"
bytebell set openrouter-model "$MODEL"

echo "Booting server..."
bytebell boot &

echo "Indexing $URL..."
bytebell index "$URL"

echo "Done!"
