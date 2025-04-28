import hre from "hardhat";
import { EndpointId } from "@layerzerolabs/lz-definitions";
import * as fs from "fs";
import * as path from "path";
import { HttpNetworkConfig } from "hardhat/types";

interface CustomNetworkConfig extends HttpNetworkConfig {
	eid?: number;
	oapp?: string;
}

// Map of endpoint addresses
const endpointAddresses: Record<number, string> = {
	[EndpointId.AVALANCHE_V2_TESTNET]: "0x6EDCE65403992e310A62460808c4b910D972f10f",
};

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

	const name = "Wrapped HBAR";
	const symbol = "WHBAR";
	const delegate = signerAddress;

	try {
		const MyOFT = await ethers.getContractFactory("MyOFT");
		const myOFT = await MyOFT.deploy(name, symbol, endpointAddress, delegate);

		console.log("Transaction hash:", myOFT.deployTransaction.hash);
		await myOFT.deployed();

		console.log("MyOFT deployed to:", myOFT.address);
		console.log("Token Name:", await myOFT.name());
		console.log("Token Symbol:", await myOFT.symbol());
		console.log("Delegate:", await myOFT.owner());
		console.log("Endpoint Address:", endpointAddress);

		// Create deployment artifacts
		const deploymentDir = path.join("deployments", currentNetworkName);
		if (!fs.existsSync(deploymentDir)) {
			fs.mkdirSync(deploymentDir, { recursive: true });
		}

		// Get the contract artifact to access ABI and other metadata
		const artifact = await hre.artifacts.readArtifact("MyOFT");

		// Save contract address and ABI
		const contractArtifact = {
			address: myOFT.address,
			abi: artifact.abi,
		};
		fs.writeFileSync(path.join(deploymentDir, "MyOFT.json"), JSON.stringify(contractArtifact, null, 2));

		// Save chain ID
		const chainId = (await ethers.provider.getNetwork()).chainId;
		fs.writeFileSync(path.join(deploymentDir, ".chainId"), chainId.toString());

		// Save solc inputs
		const solcInputsDir = path.join(deploymentDir, "solcInputs");
		if (!fs.existsSync(solcInputsDir)) {
			fs.mkdirSync(solcInputsDir, { recursive: true });
		}

		// Save the full artifact in solcInputs
		fs.writeFileSync(path.join(solcInputsDir, "MyOFT.json"), JSON.stringify(artifact, null, 2));

		// Update network config with deployed address
		if (networkConfig) {
			networkConfig.oapp = myOFT.address;
			// Save the updated config
			const configPath = path.join("hardhat.config.ts");
			let configContent = fs.readFileSync(configPath, "utf8");
			const networkRegex = new RegExp(`networks:\\s*{[^}]*${currentNetworkName}[^}]*}`);
			const updatedNetworkConfig = `networks: {
                ${currentNetworkName}: {
                    url: "${networkConfig.url}",
                    eid: ${endpointId},
                    oapp: "${myOFT.address}"
                }
            }`;
			configContent = configContent.replace(networkRegex, updatedNetworkConfig);
			fs.writeFileSync(configPath, configContent);
		}

		console.log(`Deployment completed successfully for network ${currentNetworkName}!`);
	} catch (error) {
		console.error(`Error deploying MyOFT on network ${currentNetworkName}:`, error);
		process.exit(1);
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});

