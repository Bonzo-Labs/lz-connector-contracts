import hre from "hardhat";
import { EndpointId } from "@layerzerolabs/lz-definitions";
import * as fs from "fs";
import * as path from "path";
import { HttpNetworkConfig } from "hardhat/types";

interface CustomNetworkConfig extends HttpNetworkConfig {
	eid?: number;
	oapp?: string;
}

// WHBAR token address on Hedera testnet
const WHBAR_TOKEN_ADDRESS = "0xb1f616b8134f602c3bb465fb5b5e6565ccad37ed";

// Map of endpoint addresses
const endpointAddresses: Record<number, string> = {
	[EndpointId.HEDERA_V2_TESTNET]: "0xbD672D1562Dd32C23B563C989d8140122483631d",
};

async function getContractAddress(networkName: string, contractName: string): Promise<string> {
	const deploymentDir = path.join("deployments", networkName);
	const contractPath = path.join(deploymentDir, `${contractName}.json`);

	if (!fs.existsSync(contractPath)) {
		throw new Error(`${contractName} deployment file not found for network ${networkName}. Please deploy ${contractName} first.`);
	}

	const contractData = JSON.parse(fs.readFileSync(contractPath, "utf8"));
	if (!contractData.address) {
		throw new Error(`${contractName} address not found in deployment file for network ${networkName}`);
	}

	return contractData.address;
}

async function updateNetworkConfig(networkName: string, networkConfig: CustomNetworkConfig, myOFTAddress: string, baseOFTAdapterAddress: string) {
	const configPath = path.join("hardhat.config.ts");
	let configContent = fs.readFileSync(configPath, "utf8");

	// Create the network configuration string
	const networkConfigStr = `networks: {
        ${networkName}: {
            url: "${networkConfig.url}",
            eid: ${networkConfig.eid},
            oapp: "${myOFTAddress}",
            oftAdapter: "${baseOFTAdapterAddress}"
        }
    }`;

	// Replace the existing network configuration
	const networkRegex = new RegExp(`networks:\\s*{[^}]*${networkName}[^}]*}`);
	configContent = configContent.replace(networkRegex, networkConfigStr);

	// Write the updated configuration back to the file
	fs.writeFileSync(configPath, configContent);
	console.log(`Updated network configuration for ${networkName}`);
}

async function main() {
	const { ethers, network, config } = hre;
	const [signer] = await ethers.getSigners();
	const signerAddress = await signer.getAddress();
	console.log("Deploying with account:", signerAddress);

	// Get current network name
	const currentNetworkName = network.name;
	console.log(`\nDeploying to network: ${currentNetworkName}`);

	const networkConfig = config.networks?.[currentNetworkName] as CustomNetworkConfig;
	const endpointId = networkConfig?.eid;

	if (!endpointId) {
		console.error(`No EID configured for network ${currentNetworkName}`);
		process.exit(1);
	}

	console.log(`Network EID: ${endpointId}`);

	const endpointAddress = endpointAddresses[endpointId];
	if (!endpointAddress) {
		console.error(`No endpoint address found for EID ${endpointId}`);
		process.exit(1);
	}

	const delegate = "0xbe058ee0884696653e01cfc6f34678f2762d84db";

	try {
		const BaseOFTAdapter = await ethers.getContractFactory("BaseOFTAdapter");
		const baseOFTAdapter = await BaseOFTAdapter.deploy(WHBAR_TOKEN_ADDRESS, endpointAddress, delegate);

		console.log("Transaction hash:", baseOFTAdapter.deployTransaction.hash);
		await baseOFTAdapter.deployed();

		console.log("BaseOFTAdapter deployed to:", baseOFTAdapter.address);
		console.log("WHBAR Token Address:", WHBAR_TOKEN_ADDRESS);
		console.log("Token:", await baseOFTAdapter.token());
		console.log("Endpoint Address:", endpointAddress);

		// Create deployment artifacts
		const deploymentDir = path.join("deployments", currentNetworkName);
		if (!fs.existsSync(deploymentDir)) {
			fs.mkdirSync(deploymentDir, { recursive: true });
		}

		// Get the contract artifact to access ABI and other metadata
		const artifact = await hre.artifacts.readArtifact("BaseOFTAdapter");

		// Save contract address and ABI
		const contractArtifact = {
			address: baseOFTAdapter.address,
			abi: artifact.abi,
		};
		fs.writeFileSync(path.join(deploymentDir, "BaseOFTAdapter.json"), JSON.stringify(contractArtifact, null, 2));

		// Save chain ID
		const chainId = (await ethers.provider.getNetwork()).chainId;
		fs.writeFileSync(path.join(deploymentDir, ".chainId"), chainId.toString());

		// Save solc inputs
		const solcInputsDir = path.join(deploymentDir, "solcInputs");
		if (!fs.existsSync(solcInputsDir)) {
			fs.mkdirSync(solcInputsDir, { recursive: true });
		}

		// Save the full artifact in solcInputs
		fs.writeFileSync(path.join(solcInputsDir, "BaseOFTAdapter.json"), JSON.stringify(artifact, null, 2));

		// Get MyOFT address and update network config
		try {
			const myOFTAddress = await getContractAddress(currentNetworkName, "MyOFT");
			console.log(`Found MyOFT address for ${currentNetworkName}: ${myOFTAddress}`);

			// Update network config with both MyOFT and BaseOFTAdapter addresses
			await updateNetworkConfig(currentNetworkName, networkConfig, myOFTAddress, baseOFTAdapter.address);
		} catch (error: any) {
			console.error("Error updating network configuration:", error.message);
			process.exit(1);
		}

		console.log(`Deployment completed successfully for network ${currentNetworkName}!`);
	} catch (error) {
		console.error(`Error deploying BaseOFTAdapter on network ${currentNetworkName}:`, error);
		process.exit(1);
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});

