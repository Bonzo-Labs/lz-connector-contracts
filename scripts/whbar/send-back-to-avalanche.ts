import { ethers, deployments } from "hardhat";
import { EndpointId } from "@layerzerolabs/lz-definitions";
import { addressToBytes32 } from "@layerzerolabs/lz-v2-utilities";
import { Options } from "@layerzerolabs/lz-v2-utilities";
import { BigNumberish, BytesLike, Signer } from "ethers";
import fs from "fs";
import path from "path";

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
	hedera: EndpointId.HEDERA_V2_TESTNET,
};

// Read deployed addresses from deployments folder
function getDeployedAddresses() {
	const deploymentsDir = path.join(__dirname, "..", "deployments");
	const avalancheDeployment = JSON.parse(fs.readFileSync(path.join(deploymentsDir, "avalanche-testnet", "MyOFT.json"), "utf8"));
	const hederaDeployment = JSON.parse(fs.readFileSync(path.join(deploymentsDir, "hedera-testnet", "BaseHTSConnector.json"), "utf8"));

	return {
		avalanche: avalancheDeployment.address,
		hedera: hederaDeployment.address,
	};
}

async function main() {
	// Parameters
	const amount = "9.0"; // Amount to send back to Avalanche
	const fromNetwork = "hedera";
	const toNetwork = "avalanche";

	// Get deployed addresses
	const deployedAddresses = getDeployedAddresses();
	console.log("Deployed addresses:", deployedAddresses);

	// Get the contract deployment
	const connectorDeployment = await deployments.get("BaseHTSConnector");
	const [signer] = (await ethers.getSigners()) as unknown as Signer[];
	const toAddress = "0x2429EB38cB9b456160937e11aefc80879a2d2712";

	// Create contract instance
	const connectorContract = new ethers.Contract(connectorDeployment.address, connectorDeployment.abi, signer);

	// Set up parameters for the send operation
	const decimals = 8; // Hedera tokens typically use 8 decimals
	const amountInDecimals = ethers.utils.parseUnits(amount, decimals);

	// Set up options with gas limit
	let options = Options.newOptions().addExecutorLzReceiveOption(80000, 0).toBytes();

	const sendParam: SendParam = {
		dstEid: NETWORK_EIDS.avalanche,
		to: addressToBytes32(toAddress),
		amountLD: amountInDecimals,
		minAmountLD: amountInDecimals,
		extraOptions: options,
		composeMsg: ethers.utils.arrayify("0x"),
		oftCmd: ethers.utils.arrayify("0x"),
	};

	// Get the quote for the send operation
	const feeQuote = await connectorContract.quoteSend(sendParam, false);
	const nativeFee = feeQuote.nativeFee;

	console.log(`Sending ${amount} token(s) from ${fromNetwork} to ${toNetwork} (${NETWORK_EIDS.avalanche})`);
	console.log(`Recipient: ${toAddress}`);
	console.log(`Estimated native fee: ${ethers.utils.formatEther(nativeFee)} HBAR`);

	// Execute the send operation
	const tx = await connectorContract.send(sendParam, { nativeFee: nativeFee, lzTokenFee: 0 }, await signer.getAddress(), {
		value: nativeFee,
	});

	console.log(`Send transaction initiated. See: https://layerzeroscan.com/tx/${tx.hash}`);
	await tx.wait();
	console.log("Transaction confirmed!");
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});

