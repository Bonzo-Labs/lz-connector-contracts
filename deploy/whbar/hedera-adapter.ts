import { Client, AccountId, PrivateKey, ContractFunctionParameters, Hbar, ContractCreateFlow, ContractId } from "@hashgraph/sdk";
import { EndpointId } from "@layerzerolabs/lz-definitions";
import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import "dotenv/config";

// WHBAR token address on Hedera testnet
const WHBAR_TOKEN_ADDRESS = "0xb1f616b8134f602c3bb465fb5b5e6565ccad37ed"; // TODO: Replace with actual WHBAR token address

// Map of endpoint addresses
const endpointAddresses: Record<number, string> = {
	[EndpointId.HEDERA_V2_TESTNET]: "0xbD672D1562Dd32C23B563C989d8140122483631d",
};

async function main() {
	console.log("🚀 Deploying BaseOFTAdapter to Hedera Testnet...");

	// Get operator info from environment variables
	const operatorId = AccountId.fromString(process.env.ACCOUNT_ID_HEDERA || "");
	const operatorKey = PrivateKey.fromStringECDSA(process.env.PRIVATE_KEY_HEDERA || "");

	// Initialize Hedera client
	const client = Client.forTestnet();
	client.setOperator(operatorId, operatorKey);

	// Read contract bytecode and ABI from artifacts
	const artifactPath = path.join("artifacts", "contracts", "BaseOFTAdapter.sol", "BaseOFTAdapter.json");
	const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
	const bytecode = artifact.bytecode;
	const abi = artifact.abi;

	// Convert bytecode string to Uint8Array
	const bytecodeBytes = new Uint8Array(Buffer.from(bytecode.slice(2), "hex"));

	console.log(`📦 Contract bytecode size: ${bytecodeBytes.length} bytes`);

	// LayerZero parameters
	const endpointId = EndpointId.HEDERA_V2_TESTNET;
	const endpointAddress = endpointAddresses[endpointId];
	const delegate = "0xbe058ee0884696653e01cfc6f34678f2762d84db";

	console.log(`\n--- 🌟 Deployment Parameters ---`);
	console.log(`🔗 LayerZero Endpoint ID: ${endpointId}`);
	console.log(`🌐 LayerZero Endpoint Address: ${endpointAddress}`);
	console.log(`👤 Delegate Address: ${delegate}`);
	console.log(`💰 WHBAR Token Address: ${WHBAR_TOKEN_ADDRESS}`);
	console.log(`-----------------------------\n`);

	try {
		// Deploy the contract
		console.log("🔨 Deploying contract...");
		const contractCreate = new ContractCreateFlow()
			.setGas(4000000)
			.setBytecode(bytecode)
			.setConstructorParameters(new ContractFunctionParameters().addAddress(WHBAR_TOKEN_ADDRESS).addAddress(endpointAddress).addAddress(delegate))
			.setInitialBalance(new Hbar(20));

		// Sign the transaction with the client operator key and submit to a Hedera network
		const txResponse = await contractCreate.execute(client);

		// Get the receipt of the transaction
		const receipt = await txResponse.getReceipt(client);

		// Get the new contract ID
		const newContractId = receipt.contractId;

		console.log("✅ Deployment successful!");
		console.log(`📜 Contract ID: ${newContractId}`);

		// Convert to EVM address format
		const contractAddress = newContractId?.toSolidityAddress();
		console.log(`🏗️ Contract EVM Address: ${contractAddress}`);

		// Create ethers provider and contract instance
		const provider = new ethers.providers.JsonRpcProvider("https://testnet.hashio.io/api");
		const contract = new ethers.Contract(contractAddress!, abi, provider);

		// Verify contract deployment
		console.log("🔍 Verifying contract deployment...");
		const tokenAddress = await contract.token();
		console.log(`🔑 Token Address: ${tokenAddress}`);

		// Save deployment information in the standard format
		const deploymentInfo = {
			address: "0x" + contractAddress,
			contractId: newContractId?.toString(),
			abi: abi,
			args: [WHBAR_TOKEN_ADDRESS, endpointAddress, delegate],
		};

		// Create deployment artifacts directory if it doesn't exist
		const deploymentDir = path.join("deployments", "hedera-testnet");
		if (!fs.existsSync(deploymentDir)) {
			fs.mkdirSync(deploymentDir, { recursive: true });
		}

		// Save deployment information to a JSON file
		fs.writeFileSync(path.join(deploymentDir, "BaseOFTAdapter.json"), JSON.stringify(deploymentInfo, null, 2));

		console.log(`📂 Deployment information saved to ${path.join(deploymentDir, "BaseOFTAdapter.json")}`);
	} catch (error) {
		console.error("❌ Error deploying BaseOFTAdapter contract:", error);
		process.exit(1);
	}
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error("❌ Deployment failed:", error);
		process.exit(1);
	});

