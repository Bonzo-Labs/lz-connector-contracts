import { ethers } from "hardhat";
import { EndpointId } from "@layerzerolabs/lz-definitions";
import { addressToBytes32, Options } from "@layerzerolabs/lz-v2-utilities";
import { BigNumberish, BytesLike } from "ethers";
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";

interface Args {
	amount: string;
	to: string;
}

// Define SendParam interface to match send-adapter.ts
interface SendParam {
	dstEid: EndpointId;
	to: BytesLike;
	amountLD: BigNumberish;
	minAmountLD: BigNumberish;
	extraOptions: BytesLike;
	composeMsg: BytesLike;
	oftCmd: BytesLike;
}

// Map of endpoint addresses
const endpointAddresses: Record<number, string> = {
	[EndpointId.AVALANCHE_V2_TESTNET]: "0x6EDCE65403992e310A62460808c4b910D972f10f",
};

async function main() {
	// Example parameters - modify these as needed
	const args: Args = {
		amount: "1.0", // Amount to send in WHBAR
		to: "0x2429EB38cB9b456160937e11aefc80879a2d2712", // Recipient address on Avalanche
	};

	console.log("🚀 Initiating WHBAR transfer from Hedera to Avalanche...");

	// Read contract deployment info
	const deploymentDir = path.join("deployments", "hedera-testnet");
	const deploymentInfo = JSON.parse(fs.readFileSync(path.join(deploymentDir, "BaseOFTAdapter.json"), "utf8"));
	const contractAddress = deploymentInfo.address;

	// WHBAR token address
	const whbarAddress = "0xb1f616b8134f602c3bb465fb5b5e6565ccad37ed";

	console.log(`🏗️ BaseOFTAdapter Address: ${contractAddress}`);
	console.log(`💰 WHBAR Token Address: ${whbarAddress}`);

	try {
		// Get signer
		const [signer] = await ethers.getSigners();
		console.log("Using account:", await signer.getAddress());

		// Convert amount to wei (1 HBAR = 100,000,000 tinybars)
		// WHBAR uses 8 decimals like native HBAR
		const amountInWei = ethers.utils.parseUnits(args.amount, 8);
		console.log(`💰 Amount to send: ${args.amount} HBAR (${amountInWei.toString()} tinybars)`);

		// Create contract instances
		// Load the full ABI from the deployment file instead of using minimal ABI
		const adapterContract = new ethers.Contract(contractAddress, deploymentInfo.abi, signer);

		// WHBAR contract
		const whbarAbi = ["function approve(address spender, uint256 amount) returns (bool)", "function allowance(address owner, address spender) view returns (uint256)"];
		const whbarContract = new ethers.Contract(whbarAddress, whbarAbi, signer);

		// Check allowance first
		const currentAllowance = await whbarContract.allowance(await signer.getAddress(), contractAddress);
		console.log(`Current allowance: ${ethers.utils.formatUnits(currentAllowance, 8)} WHBAR`);

		// Approve WHBAR tokens to BaseOFTAdapter if needed
		if (currentAllowance.lt(amountInWei)) {
			console.log("🔒 Approving WHBAR tokens to BaseOFTAdapter...");
			const approveTx = await whbarContract.approve(contractAddress, amountInWei);
			console.log(`Approval transaction hash: ${approveTx.hash}`);
			await approveTx.wait();
			console.log("✅ WHBAR tokens approved successfully!");
		} else {
			console.log("✅ Sufficient allowance already exists. No need to approve.");
		}

		// Prepare LayerZero options - match the pattern in send-adapter.ts
		const options = Options.newOptions().addExecutorLzReceiveOption(80000, 0).toBytes();

		// Use the utility function to convert address to bytes32
		const toAddressBytes = args.to;

		// Prepare the send parameters as in send-adapter.ts
		const sendParam: SendParam = {
			dstEid: EndpointId.AVALANCHE_V2_TESTNET,
			to: addressToBytes32(toAddressBytes),
			amountLD: amountInWei,
			minAmountLD: amountInWei,
			extraOptions: options,
			composeMsg: ethers.utils.arrayify("0x"), // Empty bytes
			oftCmd: ethers.utils.arrayify("0x"), // Empty bytes
		};

		// Get the quote for the send operation - match pattern in send-adapter.ts
		console.log("📊 Getting fee quote...");
		const feeQuote = await adapterContract.quoteSend(sendParam, false);
		const nativeFee = feeQuote.nativeFee;

		console.log("Native fee unformatted:", nativeFee);
		console.log(`💸 Estimated native fee: ${ethers.utils.formatUnits(nativeFee, 8)} HBAR`);

		// Convert HBAR to wei (18 decimals) for ethers.js transaction value
		// This adds 10 more decimal places (18 - 8 = 10)
		const nativeFeeHbar = ethers.utils.formatUnits(nativeFee, 8);
		const transactionValue = ethers.utils.parseUnits(nativeFeeHbar, 18);
		console.log("💵 Transaction value in wei (18 decimals):", transactionValue.toString());

		// Log details for debugging
		console.log(`Sending ${args.amount} WHBAR to Avalanche (${EndpointId.AVALANCHE_V2_TESTNET})`);
		console.log(`Recipient: ${args.to}`);
		console.log(`Send parameters:`, {
			dstEid: sendParam.dstEid,
			to: sendParam.to,
			amountLD: sendParam.amountLD.toString(),
			minAmountLD: sendParam.minAmountLD.toString(),
		});

		// Execute the send operation - match pattern in send-adapter.ts
		console.log("📤 Sending WHBAR...");
		const tx = await adapterContract.send(sendParam, { nativeFee: nativeFee, lzTokenFee: 0 }, await signer.getAddress(), {
			value: transactionValue, // Use properly scaled value for ethers.js (18 decimals)
			gasLimit: 5000000, // Increase gas limit to prevent out of gas errors
		});

		console.log(`Send transaction hash: ${tx.hash}`);
		console.log(`Track the transaction: https://layerzeroscan.com/tx/${tx.hash}`);

		await tx.wait();
		console.log("✅ Send transaction confirmed successfully!");
	} catch (error) {
		console.error("❌ Error during WHBAR transfer:", error);
		process.exit(1);
	}
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error("❌ Transfer failed:", error);
		process.exit(1);
	});

