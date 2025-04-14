import { ethers, deployments } from 'hardhat'
import fs from 'fs'
import path from 'path'

async function main() {
    console.log('Funding MyOFT contract on Hedera testnet with 0.5 HBAR...')

    // Get the Hedera deployment address from the deployments folder
    const deploymentsDir = path.join(__dirname, '..', 'deployments')
    const hederaDeployment = JSON.parse(
        fs.readFileSync(path.join(deploymentsDir, 'hedera-testnet', 'MyOFT.json'), 'utf8')
    )
    const hederaContractAddress = hederaDeployment.address

    console.log(`Target contract address: ${hederaContractAddress}`)

    // Get the signer (your wallet with HBAR)
    const [signer] = await ethers.getSigners()
    const signerAddress = await signer.getAddress()

    // Check the signer's balance before sending
    const balanceBefore = await ethers.provider.getBalance(signerAddress)
    console.log(`Your balance before: ${ethers.utils.formatEther(balanceBefore)} HBAR`)

    const amountToSend = ethers.utils.parseEther('0.5')
    console.log(`Sending ${ethers.utils.formatEther(amountToSend)} HBAR to contract...`)

    // Send the transaction
    const tx = await signer.sendTransaction({
        to: hederaContractAddress,
        value: amountToSend,
        gasLimit: 100000, // Set a reasonable gas limit
    })

    console.log(`Transaction submitted: ${tx.hash}`)
    console.log('Waiting for confirmation...')

    // Wait for the transaction to be mined
    const receipt = await tx.wait()
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`)

    // Check the contract's balance after sending
    const contractBalance = await ethers.provider.getBalance(hederaContractAddress)
    console.log(`Contract balance after: ${ethers.utils.formatEther(contractBalance)} HBAR`)

    // Check the signer's balance after sending
    const balanceAfter = await ethers.provider.getBalance(signerAddress)
    console.log(`Your balance after: ${ethers.utils.formatEther(balanceAfter)} HBAR (includes gas cost)`)

    console.log('Funding completed successfully!')
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
