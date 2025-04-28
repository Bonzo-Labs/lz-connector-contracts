#!/bin/bash

# Set the script to exit immediately if any command fails
set -e

echo "=== Step 0: Compiling contracts ==="
npm run compile

echo "=== Step 1: Deploying OFT adapter on avalanche-testnet ==="
npx hardhat run deploy/NewOFTAdapter.ts --network avalanche-testnet

echo "=== Step 2: Approving mock ERC20 to OFT adapter ==="
npx hardhat run scripts/approve-oftadapter.ts --network avalanche-testnet

echo "=== All steps completed successfully! ===" 