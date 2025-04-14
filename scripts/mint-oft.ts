import { ethers, deployments } from 'hardhat'
import { getNetworkNameForEid } from '@layerzerolabs/devtools-evm-hardhat'
import { Signer } from 'ethers'
import fs from 'fs'
import path from 'path'

interface Args {
    amount: string
    to: string
    network: 'avalanche' | 'arbitrum'
}

// Read deployed addresses from deployments folder
function getDeployedAddresses() {
    const deploymentsDir = path.join(__dirname, '..', 'deployments')
    const avalancheDeployment = JSON.parse(
        fs.readFileSync(path.join(deploymentsDir, 'avalanche-testnet', 'MyOFT.json'), 'utf8')
    )
    const arbitrumDeployment = JSON.parse(
        fs.readFileSync(path.join(deploymentsDir, 'arbitrum-testnet', 'MyOFT.json'), 'utf8')
    )

    return {
        avalanche: avalancheDeployment.address,
        arbitrum: arbitrumDeployment.address,
    }
}

async function main() {
    // Example parameters - modify these as needed
    const network = 'avalanche' as const
    const amount = '10000' // Amount to mint

    // Validate network
    if (!['avalanche', 'arbitrum'].includes(network)) {
        throw new Error('network must be either "avalanche" or "arbitrum"')
    }

    // Get deployed addresses
    const deployedAddresses = getDeployedAddresses()
    console.log('Deployed addresses:', deployedAddresses)

    // Get the contract deployment
    const oftDeployment = await deployments.get('MyOFT')
    const [signer] = (await ethers.getSigners()) as unknown as Signer[]

    // Create contract instance
    const oftContract = new ethers.Contract(oftDeployment.address, oftDeployment.abi, signer)

    const decimals = await oftContract.decimals()
    const amountInDecimals = ethers.utils.parseUnits(amount, decimals)

    // Get the signer's address
    const signerAddress = await signer.getAddress()

    console.log(`Minting ${amount} tokens on ${network}`)
    console.log(`Recipient: ${signerAddress}`)

    // Execute the mint operation
    const tx = await oftContract.mint(signerAddress, amountInDecimals)

    console.log(`Mint transaction initiated. Hash: ${tx.hash}`)
    await tx.wait()
    console.log('Transaction confirmed!')

    // Get the new balance
    const balance = await oftContract.balanceOf(signerAddress)
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
