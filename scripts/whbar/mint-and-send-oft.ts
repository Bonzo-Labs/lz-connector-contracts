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

	// Amount to mint and send
	const amountToMint = "100"; // amount to mint
	const amountToSend = "5"; // amount to send to Avalanche

	// Get the contract instance using ethers
	const [signer] = await ethers.getSigners();
	console.log("👤 Using signer account:", await signer.getAddress());

	// Get the connector ABI from the deployment
	const connectorAbi = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "deployments", "hedera-testnet", "BaseHTSConnector.json"), "utf8")).abi;

	// Create contract instance
	const connectorAddress = deployedAddresses.hedera;
	const connectorContract = new ethers.Contract(connectorAddress, connectorAbi, signer);

	try {
		// Get the token address
		const tokenAddress = await connectorContract.token();
		console.log("\n🔑 Token address:", tokenAddress);

		// Create ERC20 token contract instance
		const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);

		// Get token info
		const tokenSymbol = await tokenContract.symbol();
		const tokenDecimals = await tokenContract.decimals();
		console.log(`💎 Token: ${tokenSymbol} (${tokenDecimals} decimals)`);

		// Check if the account is the owner of the connector contract
		const contractOwner = await connectorContract.owner();
		console.log("\n👑 Contract owner:", contractOwner);
		console.log("👤 Signer address:", await signer.getAddress());

		if (contractOwner.toLowerCase() !== (await signer.getAddress()).toLowerCase()) {
			console.warn("\n⚠️ WARNING: Signer is not the owner of the contract. The mint function may fail due to onlyOwner restriction.");
		} else {
			console.log("\n✅ Signer is the owner of the contract. Proceeding with mint...");
		}

		// Calculate the function selector for "mint(address,uint256)"
		const functionSelector = ethers.utils.id("mint(address,uint256)").slice(0, 10);
		console.log("\n🔍 Function selector for mint(address,uint256):", functionSelector);
		console.log("🔍 Expected selector: 0x40c10f19");

		// Check initial token balance using ERC20 contract
		try {
			const initialBalance = await tokenContract.balanceOf(await signer.getAddress());
			console.log(`\n💰 Initial ${tokenSymbol} balance:`, ethers.utils.formatUnits(initialBalance, tokenDecimals), `${tokenSymbol}`);
		} catch (error: any) {
			console.error("\n❌ Error checking balance:", error);
		}

		// Step 1: Mint tokens using the ethers contract instance
		console.log(`\n🪙 Minting ${amountToMint} ${tokenSymbol}...`);

		// Convert amount to the proper format with correct decimals
		const mintAmountWithDecimals = ethers.utils.parseUnits(amountToMint, tokenDecimals);

		console.log("🔢 Mint amount in smallest units:", mintAmountWithDecimals.toString());

		// Call the mint function
		const mintTx = await connectorContract.mint(
			await signer.getAddress(), // recipient
			mintAmountWithDecimals, // amount
			{ gasLimit: 1000000 } // gas limit
		);

		console.log("\n📝 Mint transaction submitted:", mintTx.hash);
		console.log(`🔍 See: https://hashscan.io/testnet/transaction/${mintTx.hash}`);

		// Wait for the transaction to be confirmed
		const mintReceipt = await mintTx.wait();
		console.log("✅ Mint transaction confirmed! Gas used:", mintReceipt.gasUsed.toString());

		// Check balance after minting using ERC20 contract
		try {
			const balanceAfterMint = await tokenContract.balanceOf(await signer.getAddress());
			console.log(`\n💰 Balance after minting:`, ethers.utils.formatUnits(balanceAfterMint, tokenDecimals), `${tokenSymbol}`);
		} catch (error: any) {
			console.error("\n❌ Error checking balance:", error);
		}

		// Step 2: Send tokens to Avalanche
		console.log(`\n🚀 Sending ${amountToSend} ${tokenSymbol} to Avalanche...`);

		// Get the recipient address on Avalanche
		const avalancheRecipient = process.env.AVALANCHE_RECIPIENT_ADDRESS || (await signer.getAddress());
		console.log("👤 Recipient on Avalanche:", avalancheRecipient);

		// Convert amount to send to the proper format with correct decimals
		const sendAmountWithDecimals = ethers.utils.parseUnits(amountToSend, tokenDecimals);

		// First approve the connector contract to spend our tokens using ethers.js
		console.log(`\n🔐 Approving connector contract to spend ${amountToSend} ${tokenSymbol}...`);
		const approveTx = await tokenContract.approve(connectorAddress, sendAmountWithDecimals, { gasLimit: 1000000 });
		console.log("📝 Approve transaction submitted:", approveTx.hash);
		console.log(`🔍 See: https://hashscan.io/testnet/transaction/${approveTx.hash}`);

		// Wait for approval transaction to be confirmed
		const approveReceipt = await approveTx.wait();
		console.log("✅ Approve transaction confirmed! Gas used:", approveReceipt.gasUsed.toString());

		// Prepare LZ options
		const lzOptions = Options.newOptions().addExecutorLzReceiveOption(80000, 0).toBytes();

		// Convert recipient to bytes32
		const recipientBytes = addressToBytes32(avalancheRecipient);

		// Prepare send parameters
		const sendParam: SendParam = {
			dstEid: NETWORK_EIDS.avalanche,
			to: recipientBytes,
			amountLD: sendAmountWithDecimals,
			minAmountLD: sendAmountWithDecimals,
			extraOptions: lzOptions,
			composeMsg: "0x",
			oftCmd: "0x",
		};

		// Get the quote for the cross-chain operation
		const feeQuote = await connectorContract.quoteSend(sendParam, false);
		console.log("\n💵 Raw fee quote (nativeFee):", feeQuote.nativeFee.toString());
		console.log("💵 Fee quote (nativeFee from quoteSend):", ethers.utils.formatUnits(feeQuote.nativeFee, 8), "HBAR");

		// IMPORTANT: Hedera uses 8 decimals for HBAR, but ethers.js expects 18 decimals for 'wei' values
		// We need to convert between these decimal systems

		// Get the native fee in HBAR units (with 8 decimals)
		const nativeFeeHbar = ethers.utils.formatUnits(feeQuote.nativeFee, 8);
		console.log("\n💵 Native fee in HBAR units:", nativeFeeHbar, "HBAR");

		// Convert HBAR to wei (18 decimals) for ethers.js transaction value
		// This adds 10 more decimal places (18 - 8 = 10)
		const transactionValue = ethers.utils.parseUnits(nativeFeeHbar, 18);
		console.log("💵 Transaction value in wei (18 decimals):", transactionValue.toString());

		// Prepare adapterParams with simplified parameters
		const adapterParams = {
			nativeFee: feeQuote.nativeFee, // Original fee quote from contract (8 decimals)
			lzTokenFee: 0, // Hardcode tokenFee as 0 as requested
		};

		// Execute the send operation with properly scaled value
		console.log("\n🚀 Sending transaction with value:", ethers.utils.formatEther(transactionValue), "ETH equivalent");
		const sendTx = await connectorContract.send(sendParam, adapterParams, await signer.getAddress(), {
			value: transactionValue, // Properly scaled for ethers.js (18 decimals)
			gasLimit: 3000000,
		});

		console.log("\n📝 Send transaction submitted:", sendTx.hash);
		console.log(`🔍 See: https://hashscan.io/testnet/transaction/${sendTx.hash}`);
		console.log(`🌐 LayerZero transaction: https://layerzeroscan.com/tx/${sendTx.hash}`);

		// Wait for the transaction to be confirmed
		const sendReceipt = await sendTx.wait();
		console.log("\n✅ Send transaction confirmed! Gas used:", sendReceipt.gasUsed.toString());
		console.log(`🚀 Successfully sent ${amountToSend} ${tokenSymbol} to Avalanche!`);

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

