import { ethers, network } from "hardhat";
import { BigNumber } from "ethers";
import fs from "fs";
import path from "path";

// Read deployed addresses from deployments folder
function getDeployedAddresses() {
	const deploymentsDir = path.join(__dirname, "..", "deployments");
	const avalancheAdapter = JSON.parse(fs.readFileSync(path.join(deploymentsDir, "avalanche-testnet", "baseOFTAdapter.json"), "utf8"));
	const avalancheERC20 = JSON.parse(fs.readFileSync(path.join(deploymentsDir, "avalanche-testnet", "MockERC20.json"), "utf8"));

	return {
		adapter: avalancheAdapter.address,
		erc20: avalancheERC20.address,
	};
}

async function main() {
	// Get the network from hardhat arguments
	const networkName = network.name;
	console.log(`Running on network: ${networkName}`);

	// Validate network
	if (networkName !== "avalanche-testnet") {
		throw new Error("This script should only be run on avalanche-testnet");
	}

	// Get the signer
	const [signer] = await ethers.getSigners();
	console.log("Approving with account:", await signer.getAddress());

	// Get deployed addresses
	const deployedAddresses = getDeployedAddresses();
	console.log("Using addresses:", deployedAddresses);

	// Get the deployed contracts
	const mockERC20 = await ethers.getContractAt("MockERC20", deployedAddresses.erc20);
	const oftAdapter = await ethers.getContractAt("BaseOFTAdapter", deployedAddresses.adapter);

	// Get the balance
	const balance = await mockERC20.balanceOf(await signer.getAddress());
	console.log("Current balance:", ethers.utils.formatEther(balance));

	// Approve the OFT adapter to spend the entire balance
	const approveTx = await mockERC20.approve(deployedAddresses.adapter, balance);
	await approveTx.wait();
	console.log("Approved OFT adapter to spend tokens");
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});

