import 'dotenv/config';
import { ethers } from 'ethers';

const abi = [
	"event Claimed(address indexed receiver, bytes32 secret)",
	"function claim(bytes32 secret)",
	"function hashlock() view returns (bytes32)"
];

async function main() {
	const { RPC_URL, HTLC_ADDRESS } = process.env;
	if (!RPC_URL || !HTLC_ADDRESS) {
		console.error("Missing RPC_URL or HTLC_ADDRESS env vars");
		process.exit(1);
	}
	const provider = new ethers.JsonRpcProvider(RPC_URL);
	const contract = new ethers.Contract(HTLC_ADDRESS, abi, provider);

	console.log(`Watching Claimed events on ${HTLC_ADDRESS}...`);
	contract.on('Claimed', async (receiver, secret) => {
		console.log(`Claimed by ${receiver}, secret: ${secret}`);
		// In a real relayer, submit claim(secret) on the other chain here.
	});
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
