#!/bin/bash

# Set the script to exit immediately if any command fails
set -e

echo "=== Step 0: Compiling contracts ==="
npm run compile

echo "=== Step 1: Deploying HTS connector to Hedera Testnet ==="
ts-node deploy/HTSConnector.ts

echo "=== Step 2: Wiring OApp with LayerZero ==="
# Using 'yes' to automatically answer 'y' to prompts
yes y | npx hardhat lz:oapp:wire --oapp-config layerzero.config.ts

echo "=== Step 3: Sending tokens from Avalanche to Hedera ==="
npx hardhat run scripts/send-adapter.ts --network avalanche-testnet


echo "=== All steps completed successfully! ===" 