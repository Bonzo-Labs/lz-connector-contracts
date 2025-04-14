import { ethers } from "ethers";
import { EndpointId } from "@layerzerolabs/lz-definitions";
import { addressToBytes32 } from "@layerzerolabs/lz-v2-utilities";
import { Options } from "@layerzerolabs/lz-v2-utilities";
import fs from "fs";
import path from "path";
import { Client, PrivateKey, AccountId } from "@hashgraph/sdk";

// Network endpoint IDs
const NETWORK_EIDS = {
	avalanche: EndpointId.AVALANCHE_V2_TESTNET,
	arbitrum: EndpointId.ARBSEP_V2_TESTNET,
	hedera: EndpointId.HEDERA_V2_TESTNET,
};

// Read deployed addresses from deployments folder
function getDeployedAddresses() {
	const deploymentsDir = path.join(__dirname, "..", "deployments");
	const hederaDeployment = JSON.parse(fs.readFileSync(path.join(deploymentsDir, "hedera-testnet", "BaseHTSConnector.json"), "utf8"));
	return {
		hedera: hederaDeployment.address,
	};
}

async function main() {
	// Hedera testnet configuration
	const hederaRpcUrl = "https://testnet.hashio.io/api";

	// Create ethers provider and signer
	const provider = new ethers.providers.JsonRpcProvider(hederaRpcUrl);
	const signer = new ethers.Wallet(process.env.PRIVATE_KEY_HEDERA!, provider);

	// Get deployed addresses
	const deployedAddresses = getDeployedAddresses();
	console.log("Deployed addresses:", deployedAddresses);

	// Load the contract ABI
	const hederaDeployment = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "hedera-testnet", "BaseHTSConnector.json"), "utf8"));
	const contractABI = hederaDeployment.abi;

	// Create contract instance with signer
	const contract = new ethers.Contract(deployedAddresses.hedera, contractABI, signer);

	try {
		console.log("Executing testTransfer...");
		const amount = 1700000000;
		const recipient = "0x1e17a29d259ff4f78f02e97c7deccc7ec3aea103";
		const txn = await contract.testTransfer(recipient, amount, { gasLimit: 3000000 });

		console.log(`Send transaction initiated. Hash: ${txn.hash}`);
		await txn.wait();
		console.log("Transaction confirmed!");
	} catch (error) {
		console.error("Error during transfer:", error);
	}
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});

