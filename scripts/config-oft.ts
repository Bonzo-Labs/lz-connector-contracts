import hre from 'hardhat'
import { EndpointId } from '@layerzerolabs/lz-definitions'
import { Options } from '@layerzerolabs/lz-v2-utilities'
import * as fs from 'fs'
import * as path from 'path'
import { ethers } from 'hardhat'
import config from '../layerzero.config'
import type { OmniEdgeHardhat } from '@layerzerolabs/toolbox-hardhat'

// Configuration types
const EXECUTOR_CONFIG_TYPE = 1
const ULN_CONFIG_TYPE = 2

// ABI definitions for encoding/decoding configs
const executorConfigStruct = 'tuple(uint32 maxMessageSize, address executorAddress)'
const ulnConfigStruct =
    'tuple(uint64 confirmations, uint8 requiredDVNCount, uint8 optionalDVNCount, uint8 optionalDVNThreshold, address[] requiredDVNs, address[] optionalDVNs)'

// Endpoint ABI for getConfig and other functions
const endpointABI = [
    'function getConfig(address _oapp, address _lib, uint32 _eid, uint32 _configType) external view returns (bytes memory config)',
    'function defaultSendLibrary(uint32 _eid) external view returns (address)',
    'function defaultReceiveLibrary(uint32 _eid) external view returns (address)',
    'function getSendLibrary(address _oapp, uint32 _eid) external view returns (address)',
    'function getReceiveLibrary(address _oapp, uint32 _eid) external view returns (tuple(address lib, bool isDefault))',
    'function setSendLibrary(address _oapp, uint32 _eid, address _lib) external',
    'function setReceiveLibrary(address _oapp, uint32 _eid, address _lib, uint64 _timeout) external',
    'function setReceiveLibraryTimeout(address _oapp, uint32 _eid, address _lib, uint64 _timeout) external',
    'function setConfig(address _oapp, address _lib, tuple(uint32 eid, uint32 configType, bytes config)[] calldata _config) external',
]

// Map of endpoint addresses
const endpointAddresses = {
    [EndpointId.ARBSEP_V2_TESTNET]: '0x6EDCE65403992e310A62460808c4b910D972f10f',
    [EndpointId.AVALANCHE_V2_TESTNET]: '0x6EDCE65403992e310A62460808c4b910D972f10f',
}

// Network-specific configurations
const networkConfigs = {
    [EndpointId.AVALANCHE_V2_TESTNET]: {
        executorConfig: {
            maxMessageSize: 10000,
            executorAddress: '0xa7bfa9d51032f82d649a501b6a1f922fc2f7d4e3',
        },
        ulnConfig: {
            confirmations: 1,
            requiredDVNCount: 1,
            optionalDVNCount: 0,
            optionalDVNThreshold: 0,
            requiredDVNs: ['0x9f0e79aeb198750f963b6f30b99d87c6ee5a0467'],
            optionalDVNs: [],
        },
    },
    [EndpointId.ARBSEP_V2_TESTNET]: {
        executorConfig: {
            maxMessageSize: 40138,
            executorAddress: '0x53f488e93b4f1b60e8e83aa374dbe1780a1ee8a8',
        },
        ulnConfig: {
            confirmations: 1,
            requiredDVNCount: 1,
            optionalDVNCount: 0,
            optionalDVNThreshold: 0,
            requiredDVNs: ['0x53f488e93b4f1b60e8e83aa374dbe1780a1ee8a8'],
            optionalDVNs: [],
        },
    },
}

// Default ULN config (you may want to adjust these values)
const defaultUlnConfig = {
    confirmations: 15,
    requiredDVNCount: 1,
    optionalDVNCount: 0,
    optionalDVNThreshold: 0,
    requiredDVNs: [],
    optionalDVNs: [],
}

// Constants for enforced options
const SOLANA_EID_1 = 30168
const SOLANA_EID_2 = 40168
const ENFORCED_OPTIONS_MSG_TYPE = 1

// Enforced options for EVM chains
const EVM_ENFORCED_OPTIONS = '0x00030100110100000000000000000000000000013880' // 60_000, 0

async function main() {
    const { ethers } = hre
    const [signer] = await ethers.getSigners()
    const signerAddress = await signer.getAddress()
    console.log('Configuring with account:', signerAddress)

    // Get all networks from hardhat config
    const networks = Object.keys(hre.config.networks)
    console.log('Found networks:', networks)

    for (const networkName of networks) {
        const network = hre.config.networks[networkName]
        if (!network.eid) {
            // console.log(`Skipping network ${networkName} - no EID configured`)
            continue
        }

        console.log(`\nConfiguring network: ${networkName} (EID: ${network.eid})`)

        // Read deployment artifacts
        const deploymentDir = path.join('deployments', networkName)
        const deploymentFile = path.join(deploymentDir, 'MyOFT.json')
        if (!fs.existsSync(deploymentFile)) {
            console.error(`No deployment artifacts found for network ${networkName}`)
            continue
        }

        const deploymentArtifact = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'))
        const myOFTAddress = deploymentArtifact.address
        console.log('Using deployed OFT address:', myOFTAddress)

        const endpointAddress = endpointAddresses[network.eid]
        if (!endpointAddress) {
            console.error(`No endpoint address found for EID ${network.eid}`)
            continue
        }

        try {
            // Get the endpoint contract instance
            const endpointContract = await ethers.getContractAt('ILayerZeroEndpointV2', endpointAddress)

            // For each other network, configure the connection
            for (const peerNetworkName of networks) {
                if (peerNetworkName === networkName) continue

                const peerNetwork = hre.config.networks[peerNetworkName]
                if (!peerNetwork.eid) {
                    // console.log(`Skipping peer network ${peerNetworkName} - no EID configured`)
                    continue
                }

                const peerEid = peerNetwork.eid
                console.log(`\nConfiguring peer connection to EID ${peerEid}`)

                // Get peer contract address
                const peerDeploymentFile = path.join('deployments', peerNetworkName, 'MyOFT.json')
                if (!fs.existsSync(peerDeploymentFile)) {
                    console.error(`No deployment artifacts found for peer network ${peerNetworkName}`)
                    continue
                }

                const peerDeploymentArtifact = JSON.parse(fs.readFileSync(peerDeploymentFile, 'utf8'))
                const peerAddress = peerDeploymentArtifact.address
                console.log('Peer Address:', peerAddress)

                // Get MyOFT contract instance
                const MyOFT = await ethers.getContractFactory('MyOFT')
                const myOFT = MyOFT.attach(myOFTAddress)

                // 1. Set peer (convert address to bytes32)
                const peerBytes32 = ethers.utils.hexZeroPad(peerAddress, 32)
                const setPeerTx = await myOFT.setPeer(peerEid, peerBytes32)
                await setPeerTx.wait()
                console.log('Peer set successfully')

                // Get default libraries
                const sendLib = await endpointContract.defaultSendLibrary(peerEid)
                const receiveLib = await endpointContract.defaultReceiveLibrary(peerEid)

                // 2. Set send library if different from current
                const currentSendLib = await endpointContract.getSendLibrary(myOFTAddress, peerEid)
                if (currentSendLib !== sendLib) {
                    console.log('Setting send library:', sendLib)
                    const setSendLibTx = await endpointContract.setSendLibrary(myOFTAddress, peerEid, sendLib)
                    await setSendLibTx.wait()
                    console.log('Send library set successfully')
                } else {
                    console.log('Send library is already set')
                }

                // 3. Set receive library if different from current
                const [currentReceiveLib, isDefault] = await endpointContract.getReceiveLibrary(myOFTAddress, peerEid)
                if (currentReceiveLib !== receiveLib) {
                    console.log('Setting receive library:', receiveLib)
                    const setReceiveLibTx = await endpointContract.setReceiveLibrary(
                        myOFTAddress,
                        peerEid,
                        receiveLib,
                        0
                    )
                    await setReceiveLibTx.wait()
                    console.log('Receive library set successfully')
                } else {
                    console.log('Receive library is already set')
                }

                // 4. Set receive library timeout if not default
                if (!isDefault) {
                    const timeout = 0 // You can adjust this value as needed
                    console.log('Setting receive library timeout:', timeout)
                    const setTimeoutTx = await endpointContract.setReceiveLibraryTimeout(
                        myOFTAddress,
                        peerEid,
                        receiveLib,
                        timeout
                    )
                    await setTimeoutTx.wait()
                    console.log('Receive library timeout set successfully')
                } else {
                    console.log('Receive library timeout is already set')
                }

                // 5. Set ULN config for both send and receive libraries
                const networkConfig = networkConfigs[peerEid]
                if (!networkConfig) {
                    console.error(`No configuration found for EID ${peerEid}`)
                    continue
                }

                // Send library config (both executor and ULN)
                const sendConfigParams = [
                    {
                        eid: peerEid,
                        configType: EXECUTOR_CONFIG_TYPE,
                        config: ethers.utils.defaultAbiCoder.encode(
                            [executorConfigStruct],
                            [networkConfig.executorConfig]
                        ),
                    },
                    {
                        eid: peerEid,
                        configType: ULN_CONFIG_TYPE,
                        config: ethers.utils.defaultAbiCoder.encode([ulnConfigStruct], [networkConfig.ulnConfig]),
                    },
                ]

                // Receive library config (only ULN)
                const receiveConfigParams = [
                    {
                        eid: peerEid,
                        configType: ULN_CONFIG_TYPE,
                        config: ethers.utils.defaultAbiCoder.encode([ulnConfigStruct], [networkConfig.ulnConfig]),
                    },
                ]

                // Set config for send lib
                console.log('Setting send library config:', myOFTAddress, sendLib, sendConfigParams)
                const setSendLibConfigTx = await endpointContract.setConfig(myOFTAddress, sendLib, sendConfigParams)
                await setSendLibConfigTx.wait()
                console.log('Send library config set successfully')

                // Set config for receive lib
                console.log('Setting receive library config:', myOFTAddress, receiveLib, receiveConfigParams)
                const setReceiveLibConfigTx = await endpointContract.setConfig(
                    myOFTAddress,
                    receiveLib,
                    receiveConfigParams
                )
                await setReceiveLibConfigTx.wait()
                console.log('Receive library config set successfully')

                // 6. Set enforced options for EVM chains
                const enforcedOptions = [
                    {
                        eid: peerEid,
                        msgType: ENFORCED_OPTIONS_MSG_TYPE,
                        options: EVM_ENFORCED_OPTIONS,
                    },
                ]
                const setEnforcedOptionsTx = await myOFT.setEnforcedOptions(enforcedOptions)
                await setEnforcedOptionsTx.wait()
                console.log('Enforced options set successfully')

                console.log(`Peer configuration for EID ${peerEid} completed successfully!`)
            }
        } catch (error) {
            console.error(`Error configuring contract on network ${networkName}:`, error)
        }
    }

    console.log('\nAll contracts configured successfully!')
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
