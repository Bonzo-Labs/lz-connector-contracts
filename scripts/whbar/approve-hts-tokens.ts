import { AccountId, TokenId, AccountAllowanceApproveTransaction, Client, Status, PrivateKey } from "@hashgraph/sdk";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

async function main() {
	// Get the BaseHTSConnector address from deployments folder
	const deploymentsDir = path.join(__dirname, "..", "..", "deployments");
	const hederaDeployment = JSON.parse(fs.readFileSync(path.join(deploymentsDir, "hedera-testnet", "BaseHTSConnector.json"), "utf8"));
	const connectorContractId = hederaDeployment.contractId;
	console.log("BaseHTSConnector address:", connectorContractId);

	const operatorId = AccountId.fromString(process.env.ACCOUNT_ID_HEDERA || "");
	const operatorKey = PrivateKey.fromStringECDSA(process.env.PRIVATE_KEY_HEDERA || "");

	// Initialize Hedera client
	const client = Client.forTestnet();
	client.setOperator(operatorId, operatorKey);

	// Get token ID
	const tokenId = TokenId.fromString("0.0.5946509");
	console.log("Token ID:", tokenId.toString());

	try {
		const amount = 9; // Amount to approve (in smallest units)

		const approveTx = new AccountAllowanceApproveTransaction().approveTokenAllowance(tokenId, operatorId, connectorContractId, amount);

		const approveTxResponse = await approveTx.execute(client);
		const approveReceipt = await approveTxResponse.getReceipt(client);
		console.log("Approval status:", approveReceipt.status.toString());
	} catch (error: any) {
		console.error("Error during token operations:", error);
		console.error("Error message:", error.message);
		// Display more detailed error information if available
		if (error.status) {
			console.error("Error status:", error.status.toString());
		}
	}
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});

