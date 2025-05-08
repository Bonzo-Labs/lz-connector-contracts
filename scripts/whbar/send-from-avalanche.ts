import { ethers } from "hardhat";
import { EndpointId } from "@layerzerolabs/lz-definitions";
import { addressToBytes32 } from "@layerzerolabs/lz-v2-utilities";
import { Options } from "@layerzerolabs/lz-v2-utilities";
import { BigNumber } from "ethers";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

// ERC20 ABI - Only the functions we need
const ERC20_ABI = [
	"function balanceOf(address owner) view returns (uint256)",
	"function decimals() view returns (uint8)",
	"function symbol() view returns (string)",
	"function transfer(address to, uint amount) returns (bool)",
	"function approve(address spender, uint256 amount) returns (bool)",
];

// Network endpoint IDs
const NETWORK_EIDS = {
	avalanche: EndpointId.AVALANCHE_V2_TESTNET,
	hedera: EndpointId.HEDERA_V2_TESTNET,
};

// Read deployed addresses from deployments folder
function getDeployedAddresses() {
	const deploymentsDir = path.join(__dirname, "..", "..", "deployments");
	const avalancheDeployment = JSON.parse(fs.readFileSync(path.join(deploymentsDir, "avalanche-testnet", "MyOFT.json"), "utf8"));
	const hederaDeployment = JSON.parse(fs.readFileSync(path.join(deploymentsDir, "hedera-testnet", "BaseHTSConnector.json"), "utf8"));

	return {
		avalanche: avalancheDeployment.address,
		hedera: hederaDeployment.address,
	};
}

interface SendParam {
	dstEid: EndpointId;
	to: Uint8Array | string;
	amountLD: BigNumber;
	minAmountLD: BigNumber;
	extraOptions: Uint8Array | string;
	composeMsg: Uint8Array | string;
	oftCmd: Uint8Array | string;
}

async function main() {
	// Get deployed addresses
	const deployedAddresses = getDeployedAddresses();
	console.log("\n📋 Deployed addresses:", deployedAddresses);

	// Amount to send to Hedera
	const amountToSend = "5"; // amount to send to Hedera

	// Get the contract instance using ethers
	const [signer] = await ethers.getSigners();
	console.log("👤 Using signer account:", await signer.getAddress());

	// Get the OFT ABI from the deployment
	const oftAbi = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "deployments", "avalanche-testnet", "MyOFT.json"), "utf8")).abi;

	// Create contract instance
	const oftAddress = deployedAddresses.avalanche;
	const oftContract = new ethers.Contract(oftAddress, oftAbi, signer);

	try {
		// Create ERC20 token contract instance
		const tokenContract = new ethers.Contract(oftAddress, ERC20_ABI, signer);

		// Get token info
		const tokenSymbol = await tokenContract.symbol();
		const tokenDecimals = await tokenContract.decimals();
		console.log(`💎 Token: ${tokenSymbol} (${tokenDecimals} decimals)`);

		// Check initial token balance using ERC20 contract
		try {
			const initialBalance = await tokenContract.balanceOf(await signer.getAddress());
			console.log(`\n💰 Initial ${tokenSymbol} balance:`, ethers.utils.formatUnits(initialBalance, tokenDecimals), `${tokenSymbol}`);
		} catch (error: any) {
			console.error("\n❌ Error checking balance:", error);
		}

		// Get the recipient address on Hedera
		const hederaRecipient = process.env.HEDERA_RECIPIENT_ADDRESS || (await signer.getAddress());
		console.log("👤 Recipient on Hedera:", hederaRecipient);

		// Convert amount to send to the proper format with correct decimals
		const sendAmountWithDecimals = ethers.utils.parseUnits(amountToSend, tokenDecimals);

		// First approve the OFT contract to spend our tokens
		console.log(`\n🔐 Approving OFT contract to spend ${amountToSend} ${tokenSymbol}...`);
		const approveTx = await tokenContract.approve(oftAddress, sendAmountWithDecimals, { gasLimit: 1000000 });
		console.log("📝 Approve transaction submitted:", approveTx.hash);
		console.log(`🔍 See: https://testnet.snowtrace.io/tx/${approveTx.hash}`);

		// Wait for approval transaction to be confirmed
		const approveReceipt = await approveTx.wait();
		console.log("✅ Approve transaction confirmed! Gas used:", approveReceipt.gasUsed.toString());

		// Prepare LZ options
		const lzOptions = Options.newOptions().addExecutorLzReceiveOption(80000, 0).toBytes();

		// Convert recipient to bytes32
		const recipientBytes = addressToBytes32(hederaRecipient);

		// Prepare send parameters
		const sendParam: SendParam = {
			dstEid: NETWORK_EIDS.hedera,
			to: recipientBytes,
			amountLD: sendAmountWithDecimals,
			minAmountLD: sendAmountWithDecimals,
			extraOptions: lzOptions,
			composeMsg: "0x",
			oftCmd: "0x",
		};

		// Get the quote for the cross-chain operation
		const feeQuote = await oftContract.quoteSend(sendParam, false);
		console.log("\n💵 Raw fee quote (nativeFee):", feeQuote.nativeFee.toString());
		console.log("💵 Fee quote (nativeFee from quoteSend):", ethers.utils.formatEther(feeQuote.nativeFee), "AVAX");

		// Prepare adapterParams with simplified parameters
		const adapterParams = {
			nativeFee: feeQuote.nativeFee,
			lzTokenFee: 0,
		};

		// Execute the send operation
		console.log("\n🚀 Sending transaction with value:", ethers.utils.formatEther(feeQuote.nativeFee), "AVAX");
		const sendTx = await oftContract.send(sendParam, adapterParams, await signer.getAddress(), {
			value: feeQuote.nativeFee,
			gasLimit: 3000000,
		});

		console.log("\n📝 Send transaction submitted:", sendTx.hash);
		console.log(`🔍 See: https://testnet.snowtrace.io/tx/${sendTx.hash}`);
		console.log(`🌐 LayerZero transaction: https://layerzeroscan.com/tx/${sendTx.hash}`);

		// Wait for the transaction to be confirmed
		const sendReceipt = await sendTx.wait();
		console.log("\n✅ Send transaction confirmed! Gas used:", sendReceipt.gasUsed.toString());
		console.log(`🚀 Successfully sent ${amountToSend} ${tokenSymbol} to Hedera!`);

		// Check final balance using ERC20 contract
		try {
			const finalBalance = await tokenContract.balanceOf(await signer.getAddress());
			console.log(`\n💰 Final ${tokenSymbol} balance:`, ethers.utils.formatUnits(finalBalance, tokenDecimals), `${tokenSymbol}`);
		} catch (error: any) {
			console.error("\n❌ Error checking balance:", error);
		}
	} catch (error: any) {
		console.error("\n❌ Error:", error);
	}
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});

