import { ethers, deployments } from "hardhat";
import { getNetworkNameForEid } from "@layerzerolabs/devtools-evm-hardhat";
import { Signer } from "ethers";
import fs from "fs";
import path from "path";
import { Client, ContractExecuteTransaction, Hbar, PrivateKey, AccountId } from "@hashgraph/sdk";

interface Args {
	amount: string;
	to: string;
	network: "avalanche" | "arbitrum";
}

function getDeployedAddresses() {
	const deploymentsDir = path.join(__dirname, "..", "deployments");
	const hederaDeployment = JSON.parse(fs.readFileSync(path.join(deploymentsDir, "hedera-testnet", "WHBAR.json"), "utf8"));

	return {
		hedera: hederaDeployment,
	};
}

async function main() {
	const amount = "10.1"; // Amount to mint in HBAR

	// Initialize Hedera client
	const client = Client.forTestnet();

	// Get operator info from environment variables
	const operatorId = AccountId.fromString(process.env.ACCOUNT_ID_HEDERA || "");
	const operatorKey = PrivateKey.fromStringECDSA(process.env.PRIVATE_KEY_HEDERA || "");

	if (!operatorId || !operatorKey) {
		throw new Error("OPERATOR_ID and OPERATOR_KEY must be set in environment");
	}

	client.setOperator(operatorId, operatorKey);

	const deployedAddresses = getDeployedAddresses();
	const whbarDeployment = await deployments.get("WHBAR");
	const whbarAddress = whbarDeployment.address;
	const whbarContractId = "0.0.5816542";

	// Convert amount to tinybars (1 HBAR = 100,000,000 tinybars)
	const amountInTinybars = Math.floor(parseFloat(amount) * 100000000);

	// Ensure minimum deposit of 1 tinybar
	if (amountInTinybars < 1) {
		throw new Error("Deposit amount must be at least 1 tinybar");
	}

	console.log(`Minting ${amount} HBAR (${amountInTinybars} tinybars)`);
	console.log(`WHBAR Contract: ${whbarAddress}`);

	// Create contract execute transaction
	const contractExecuteTx = new ContractExecuteTransaction().setContractId(whbarContractId).setGas(100000).setPayableAmount(Hbar.fromTinybars(amountInTinybars)).setFunction("deposit");

	// Sign and execute the transaction
	const txResponse = await contractExecuteTx.execute(client);
	const receipt = await txResponse.getReceipt(client);

	console.log(`Transaction status: ${receipt.status}`);
	console.log(`Transaction hash: ${txResponse.transactionHash.toString()}`);

	// Using ethersjs, create a contract instance and get the balance of the operator
	const signer = await ethers.getSigner();
	const contract = new ethers.Contract(whbarAddress, whbarDeployment.abi, signer);
	const balance = await contract.balanceOf(signer.address);
	console.log(`Balance: ${balance}`);
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});

