import { ethers, deployments } from 'hardhat'
import { getNetworkNameForEid, types } from '@layerzerolabs/devtools-evm-hardhat'
import { EndpointId } from '@layerzerolabs/lz-definitions'
import { addressToBytes32 } from '@layerzerolabs/lz-v2-utilities'
import { Options } from '@layerzerolabs/lz-v2-utilities'
import { BigNumberish, BytesLike, Signer } from 'ethers'
import fs from 'fs'
import path from 'path'

interface Args {
    amount: string
    to: string
    fromNetwork: 'avalanche' | 'arbitrum' | 'hedera'
}

interface SendParam {
    dstEid: EndpointId
    to: BytesLike
    amountLD: BigNumberish
    minAmountLD: BigNumberish
    extraOptions: BytesLike
    composeMsg: BytesLike
    oftCmd: BytesLike
}

// Network endpoint IDs
const NETWORK_EIDS = {
    avalanche: EndpointId.AVALANCHE_V2_TESTNET,
    arbitrum: EndpointId.ARBSEP_V2_TESTNET,
    hedera: EndpointId.HEDERA_V2_TESTNET,
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
    const hederaDeployment = JSON.parse(
        fs.readFileSync(path.join(deploymentsDir, 'hedera-testnet', 'MyOFT.json'), 'utf8')
    )

    return {
        avalanche: avalancheDeployment.address,
        arbitrum: arbitrumDeployment.address,
        hedera: hederaDeployment.address,
    }
}

async function main() {
    // Example parameters - modify these as needed
    const fromNetwork = 'avalanche' as const
    const amount = '1.0' // Amount to send

    // Validate fromNetwork
    if (!['avalanche', 'arbitrum', 'hedera'].includes(fromNetwork)) {
        throw new Error('fromNetwork must be either "avalanche", "arbitrum", or "hedera"')
    }

    // Determine destination network and endpoint ID
    let toEid: EndpointId
    let toNetwork: string
    if (fromNetwork === 'avalanche') {
        toEid = NETWORK_EIDS.arbitrum
        toNetwork = 'arbitrum'
    } else if (fromNetwork === 'arbitrum') {
        toEid = NETWORK_EIDS.avalanche
        toNetwork = 'avalanche'
    } else {
        toEid = NETWORK_EIDS.avalanche
        toNetwork = 'avalanche'
    }

    // Get deployed addresses
    const deployedAddresses = getDeployedAddresses()
    console.log('Deployed addresses:', deployedAddresses)

    // Get the contract deployment
    const oftDeployment = await deployments.get('MyOFT')
    const [signer] = (await ethers.getSigners()) as unknown as Signer[]
    const toAddress = await signer.getAddress()

    // Create contract instance
    const oftContract = new ethers.Contract(oftDeployment.address, oftDeployment.abi, signer)

    const decimals = await oftContract.decimals()
    const amountInDecimals = ethers.utils.parseUnits(amount, decimals)

    // Set up options with gas limit from layerzero.config.ts
    let options = Options.newOptions().addExecutorLzReceiveOption(80000, 0).toBytes()

    const sendParam: SendParam = {
        dstEid: toEid,
        to: addressToBytes32(toAddress),
        amountLD: amountInDecimals,
        minAmountLD: amountInDecimals,
        extraOptions: options,
        composeMsg: ethers.utils.arrayify('0x'),
        oftCmd: ethers.utils.arrayify('0x'),
    }

    // Get the quote for the send operation
    const feeQuote = await oftContract.quoteSend(sendParam, false)
    const nativeFee = feeQuote.nativeFee

    console.log(`Sending ${amount} token(s) from ${fromNetwork} to ${toNetwork} (${toEid})`)
    console.log(`Recipient: ${toAddress}`)
    console.log(`Estimated native fee: ${ethers.utils.formatEther(nativeFee)} ETH`)

    // Execute the send operation
    const tx = await oftContract.send(sendParam, { nativeFee: nativeFee, lzTokenFee: 0 }, await signer.getAddress(), {
        value: nativeFee,
    })

    console.log(`Send transaction initiated. See: https://layerzeroscan.com/tx/${tx.hash}`)
    await tx.wait()
    console.log('Transaction confirmed!')
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
