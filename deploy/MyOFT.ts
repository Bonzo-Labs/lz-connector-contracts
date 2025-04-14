import assert from 'assert'
import { type DeployFunction } from 'hardhat-deploy/types'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import hre from 'hardhat'

const contractName = 'MyOFT'

const deploy: DeployFunction = async (hre) => {
    const { getNamedAccounts, deployments } = hre

    const { deploy } = deployments
    const { deployer } = await getNamedAccounts()

    assert(deployer, 'Missing named deployer account')

    console.log(`Network: ${hre.network.name}`)
    console.log(`Deployer: ${deployer}`)

    const endpointV2Deployment = await hre.deployments.get('EndpointV2')

    const { address } = await deploy(contractName, {
        from: deployer,
        args: [
            'MyOFT', // name
            'MOFT', // symbol
            endpointV2Deployment.address, // LayerZero's EndpointV2 address
            deployer, // owner
        ],
        log: true,
        skipIfAlreadyDeployed: false,
    })

    console.log(`Deployed contract: ${contractName}, network: ${hre.network.name}, address: ${address}`)
}

deploy.tags = [contractName]

export default deploy

// Auto-run the deploy function when this file is executed directly
const main = async () => {
    try {
        // Initialize HRE properly
        await hre.run('compile')
        await deploy(hre as unknown as HardhatRuntimeEnvironment)
        process.exit(0)
    } catch (error) {
        console.error(error)
        process.exit(1)
    }
}

if (require.main === module) {
    main()
}
