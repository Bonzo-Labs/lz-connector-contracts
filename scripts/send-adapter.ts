import { ethers, deployments } from "hardhat";
import { getNetworkNameForEid, types } from "@layerzerolabs/devtools-evm-hardhat";
import { EndpointId } from "@layerzerolabs/lz-definitions";
import { addressToBytes32 } from "@layerzerolabs/lz-v2-utilities";
import { Options } from "@layerzerolabs/lz-v2-utilities";
import { BigNumberish, BytesLike, Signer } from "ethers";
import fs from "fs";
import path from "path";

interface Args {
	amount: string;
	to: string;
	fromNetwork: "avalanche" | "arbitrum" | "hedera";
}

interface SendParam {
	dstEid: EndpointId;
	to: BytesLike;
	amountLD: BigNumberish;
	minAmountLD: BigNumberish;
	extraOptions: BytesLike;
	composeMsg: BytesLike;
	oftCmd: BytesLike;
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
	// Example parameters - modify these as needed
	const fromNetwork = "avalanche" as const;
	const amount = "18.56"; // Amount to send

	// Validate fromNetwork
	if (!["avalanche", "arbitrum", "hedera"].includes(fromNetwork)) {
		throw new Error('fromNetwork must be either "avalanche", "arbitrum", or "hedera"');
	}

	// Determine destination network and endpoint ID
	let toEid: EndpointId;
	let toNetwork: string;
	if (fromNetwork === "avalanche") {
		// toEid = NETWORK_EIDS.arbitrum
		// toNetwork = 'arbitrum'
		toEid = NETWORK_EIDS.hedera;
		toNetwork = "hedera";
	} else if (fromNetwork === "arbitrum") {
		toEid = NETWORK_EIDS.avalanche;
		toNetwork = "avalanche";
	} else {
		toEid = NETWORK_EIDS.avalanche;
		toNetwork = "avalanche";
	}

	// Get deployed addresses
	const deployedAddresses = getDeployedAddresses();
	console.log("Deployed addresses:", deployedAddresses);

	// Get the contract deployment
	const adapterDeployment = await deployments.get("BaseOFTAdapter");
	const [signer] = (await ethers.getSigners()) as unknown as Signer[];
	// const toAddress = "0x1e17A29D259fF4f78f02e97c7DECCc7EC3aea103";
	const toAddress = "0xbe058ee0884696653e01cfc6f34678f2762d84db";

	// Create contract instance
	const adapterContract = new ethers.Contract(adapterDeployment.address, adapterDeployment.abi, signer);

	const decimals = 18;
	const amountInDecimals = ethers.utils.parseUnits(amount, decimals);

	// Handle decimal conversion for cross-chain transfers
	let adjustedAmount = amountInDecimals;

	// Set up options with gas limit from layerzero.config.ts
	let options = Options.newOptions().addExecutorLzReceiveOption(80000, 0).toBytes();

	const sendParam: SendParam = {
		dstEid: toEid,
		to: addressToBytes32(toAddress),
		amountLD: adjustedAmount,
		minAmountLD: adjustedAmount,
		extraOptions: options,
		composeMsg: ethers.utils.arrayify("0x"), // Send action code 1 (donate 10 tinybar)
		oftCmd: ethers.utils.arrayify("0x"),
	};

	// Get the quote for the send operation
	const feeQuote = await adapterContract.quoteSend(sendParam, false);
	const nativeFee = feeQuote.nativeFee;

	console.log(`Sending ${amount} token(s) from ${fromNetwork} to ${toNetwork} (${toEid})`);
	console.log(`Recipient: ${toAddress}`);
	console.log(`Estimated native fee: ${ethers.utils.formatEther(nativeFee)} ETH`);

	// Execute the send operation
	const tx = await adapterContract.send(sendParam, { nativeFee: nativeFee, lzTokenFee: 0 }, await signer.getAddress(), {
		value: nativeFee,
	});

	console.log(`Send transaction initiated. See: https://layerzeroscan.com/tx/${tx.hash}`);
	await tx.wait();
	console.log("Transaction confirmed!");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});

