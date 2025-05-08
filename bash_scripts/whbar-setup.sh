#!/bin/bash

# Set the script to exit immediately if any command fails
set -e

echo "=== Step 0: Compiling contracts ==="
npm run compile

echo "=== Step 1: Deploying Base OFT adapter to Hedera Testnet ==="
npx hardhat run deploy/whbar/hedera-adapter.ts --network hedera-testnet

echo "=== Step 2: Deploying MyOFT to Avalanche Testnet ==="
npx hardhat run deploy/whbar/avalanche-oft.ts --network avalanche-testnet

echo "=== Step 3: Wiring OApp with LayerZero ==="
# Using 'yes' to automatically answer 'y' to prompts
yes y | npx hardhat lz:oapp:wire --oapp-config layerzero.config.ts

echo "=== Step 4: Sending tokens from Hedera to Avalanche ==="
npx hardhat run scripts/whbar/send-whbar.ts --network hedera-testnet

echo "=== All steps completed successfully! ===" 