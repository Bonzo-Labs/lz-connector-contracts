import { ethers, deployments, network } from 'hardhat'
import { Signer } from 'ethers'
import fs from 'fs'
import path from 'path'

interface DeploymentData {
    address: string
    abi: any[]
    args: any[]
}

// Read deployed addresses from deployments folder
function getDeploymentData(): DeploymentData {
    const networkName = network.name
    const deploymentPath = path.join(__dirname, '..', 'deployments', networkName, 'MockERC20.json')

    if (!fs.existsSync(deploymentPath)) {
        throw new Error(`No deployment found for network: ${networkName}`)
    }

    return JSON.parse(fs.readFileSync(deploymentPath, 'utf8'))
}

async function main() {
    // Get deployment data
    const deploymentData = getDeploymentData()
    console.log(`Using MockERC20 at: ${deploymentData.address}`)

    // Get the contract deployment
    const [signer] = (await ethers.getSigners()) as unknown as Signer[]

    // Create contract instance
    const mockERC20 = new ethers.Contract(deploymentData.address, deploymentData.abi, signer)

    const decimals = await mockERC20.decimals()
    const amount = '100000' // 100k tokens
    const amountInDecimals = ethers.utils.parseUnits(amount, decimals)

    // Get the signer's address
    const signerAddress = await signer.getAddress()

    console.log(`Minting ${amount} tokens`)
    console.log(`Recipient: ${signerAddress}`)

    // Execute the mint operation
    const tx = await mockERC20.mint(signerAddress, amountInDecimals)

    console.log(`Mint transaction initiated. Hash: ${tx.hash}`)
    await tx.wait()
    console.log('Transaction confirmed!')

    // Get the new balance
    const balance = await mockERC20.balanceOf(signerAddress)
    console.log(`New balance: ${ethers.utils.formatUnits(balance, decimals)} tokens`)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
