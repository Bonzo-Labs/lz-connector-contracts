import { ethers, deployments } from "hardhat";
import { getNetworkNameForEid } from "@layerzerolabs/devtools-evm-hardhat";
import { EndpointId } from "@layerzerolabs/lz-definitions";
import fs from "fs";
import path from "path";

interface Args {
	userAddress: string;
	lzMsgId?: string;
	network: "avalanche" | "arbitrum" | "hedera";
}

// Network endpoint IDs
const NETWORK_EIDS = {
	avalanche: EndpointId.AVALANCHE_V2_TESTNET,
	arbitrum: EndpointId.ARBSEP_V2_TESTNET,
	hedera: EndpointId.HEDERA_V2_TESTNET,
};

// Read deployed addresses from deployments folder
function getDeployedAddresses() {
	const deploymentsDir = path.join(__dirname, "..", "deployments");
	const avalancheDeployment = JSON.parse(fs.readFileSync(path.join(deploymentsDir, "avalanche-testnet", "BaseOFTAdapter.json"), "utf8"));
	const arbitrumDeployment = JSON.parse(fs.readFileSync(path.join(deploymentsDir, "arbitrum-testnet", "MyOFT.json"), "utf8"));
	const hederaDeployment = JSON.parse(fs.readFileSync(path.join(deploymentsDir, "hedera-testnet", "BaseHTSConnector.json"), "utf8"));

	return {
		avalanche: avalancheDeployment.address,
		arbitrum: arbitrumDeployment.address,
		hedera: hederaDeployment.address,
	};
}

async function main() {
	const args: Args = {
		userAddress: "0x2429EB38cB9b456160937e11aefc80879a2d2712",
		lzMsgId: undefined,
		network: "avalanche" as const,
	};

	// Get deployed addresses
	const deployedAddresses = getDeployedAddresses();
	console.log("Deployed addresses:", deployedAddresses);

	// Get the contract deployment
	const adapterDeployment = await deployments.get("BaseOFTAdapter");
	const [signer] = await ethers.getSigners();

	// Create contract instance
	const adapterContract = new ethers.Contract(adapterDeployment.address, adapterDeployment.abi, signer);

	try {
		// Check if user has any locked transfers
		console.log(`\nQuerying locked transfers for address: ${args.userAddress}`);
		const transferIds = await adapterContract.getTransfersByUser(args.userAddress);

		if (transferIds.length === 0) {
			console.log("No locked transfers found for this address");
			process.exit(0);
		}

		console.log(`Found ${transferIds.length} transfers for this address`);

		// Get active transfers
		const [activeIds, amounts] = await adapterContract.getActiveTransfersByUser(args.userAddress);
		console.log(`\nActive (non-refunded) transfers: ${activeIds.length}`);

		for (let i = 0; i < activeIds.length; i++) {
			const transfer = await adapterContract.lockedTransfers(activeIds[i]);
			console.log(`[${i + 1}] Message ID: ${activeIds[i]}`);
			console.log(`    Amount: ${ethers.utils.formatEther(amounts[i])} tokens`);
			console.log(`    Sender: ${transfer.sender}`);
			console.log(`    Refunded: ${transfer.refunded ? "Yes" : "No"}`);
		}

		// If no active transfers, exit
		if (activeIds.length === 0) {
			console.log("No active transfers to refund");
			process.exit(0);
		}

		// Process refund
		let tx;

		if (args.lzMsgId) {
			// Refund by message ID if provided
			console.log(`\nRefunding by message ID: ${args.lzMsgId}`);
			const lzMsgIdBytes32 = ethers.utils.hexZeroPad(args.lzMsgId, 32);
			tx = await adapterContract.refundTransfer(lzMsgIdBytes32);
		} else {
			// If no message ID provided, refund the first active transfer
			console.log(`\nRefunding first active transfer with message ID: ${activeIds[0]}`);
			tx = await adapterContract.refundTransfer(activeIds[0]);
		}

		console.log(`Refund transaction hash: ${tx.hash}`);

		// Wait for transaction confirmation
		const receipt = await tx.wait();
		console.log("Transaction confirmed in block:", receipt.blockNumber);

		// Check remaining active transfers after refund
		const [remainingActiveIds, remainingAmounts] = await adapterContract.getActiveTransfersByUser(args.userAddress);
		console.log(`\nRemaining active transfers after refund: ${remainingActiveIds.length}`);

		console.log("Refund completed successfully!");
	} catch (error) {
		console.error("Error during refund:", error);
		process.exit(1);
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

