import { ethers, deployments, network } from 'hardhat'
import { getNetworkNameForEid } from '@layerzerolabs/devtools-evm-hardhat'
import fs from 'fs'
import path from 'path'

async function main() {
    // Get the network from hardhat arguments
    const networkName = network.name
    console.log(`Deploying to network: ${networkName}`)

    // Deploy MockERC20
    const MockERC20 = await ethers.getContractFactory('MockERC20')
    const mockERC20 = await MockERC20.deploy('Wrapped Bitcoin', 'WBTC', 18)
    await mockERC20.deployed()

    console.log(`MockERC20 deployed to: ${mockERC20.address}`)

    // Create the deployment artifact
    const deployment = {
        address: mockERC20.address,
        abi: MockERC20.interface.format(),
        args: ['Mock Token', 'MTK', 18],
    }

    // Create the deployment directory if it doesn't exist
    const deploymentDir = path.join(__dirname, '..', 'deployments', networkName)
    if (!fs.existsSync(deploymentDir)) {
        fs.mkdirSync(deploymentDir, { recursive: true })
    }

    // Save the deployment artifact
    const deploymentPath = path.join(deploymentDir, 'MockERC20.json')
    fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2))

    // Copy the solcInputs if they don't exist
    const solcInputsDir = path.join(deploymentDir, 'solcInputs')
    if (!fs.existsSync(solcInputsDir)) {
        fs.mkdirSync(solcInputsDir, { recursive: true })
    }

    // Copy the MockERC20.sol file to solcInputs
    const sourceFile = path.join(__dirname, '..', 'contracts', 'mocks', 'MockERC20.sol')
    const targetFile = path.join(solcInputsDir, 'MockERC20.sol')
    fs.copyFileSync(sourceFile, targetFile)

    console.log('Deployment artifacts saved successfully')
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
