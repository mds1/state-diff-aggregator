import { exists, mkdir, readFile, writeFile } from "node:fs/promises";
/**
 * Given a series of executed transaction hashes and/or Tenderly transaction simulation results,
 * this script will get the state diffs of each and output the net state state diff across all
 * transactions. For example, if transaction A has the following state diff:
 *   "address1": { "key1": "from value0 to value1", "key2": "from value2 to value3" }
 *   "address2": { "key3": "from value4 to value5" }
 * and transaction B has the following state diff:
 *   "address1": { "key1": "from value1 to value6" }
 * The net state diff that is output will be:
 *   "address1": { "key1": "from value0 to value6", "key2": "from value2 to value3" }
 *   "address2": { "key3": "from value4 to value5"}
 *
 * Since we use the Tenderly API to get the state diffs, the state diffs of a transaction can be
 * found in the `.state_diff[]` key of the JSON and have the type definitions given below.
 *
 * Usage:
 *   1. Install bun: https://bun.sh/docs/installation
 *   2. Install dependencies: `bun install`
 *   3. Run the script, passing a file path as input: `bun index.ts <path-to-file>`
 *
 * The file should contain one transaction hash or Tenderly transaction simulation filepath per
 * line. An example file looks like this:
 *   ```
 *   0x3f7c36a1d636cdb23bf4f9171c27ebe58b73f4c0e6a33dbaac2c2f3c142faf50 # Comments allowed.
 *   0x29bb617fac8f49f5c934cc776b22d47e187ab482e86f21e4502a23ba1c9ad0da
 *   ./data/sim-upgrade6.json # This is the path from the repo root.
 *   ```
 */
import { basename, extname } from "node:path";

type Address = `0x${string}`;
type Slot = `0x${string}`; // Slot key or value.

interface StateDiff {
	address: Address; // Address where state change occurred.
	raw: Raw[]; // Raw state diff. This will always have length of exactly 1.
	// The next 3 fields are the decoded state diff information. Tenderly currently has a bug around
	// decoding for proxies so our state diffs are not decoded and we ignore these fields.
	soltype: null;
	original: null;
	dirty: null;
}

interface Raw {
	address: Address;
	key: Slot;
	original: Slot;
	dirty: Slot;
}

// Used when computing the net state diff.
interface StorageValues {
	original: Slot;
	dirty: Slot;
}

interface TxData {
	stateDiff: StateDiff[];
	blockNumber: number;
}

async function getStateDiff(transactionHashOrFilePath: string): Promise<TxData> {
	if (transactionHashOrFilePath.startsWith("0x")) {
		console.log("Fetching state diff for transaction hash:", transactionHashOrFilePath);
		// Fetch state diff from Tenderly API using transaction hash.
		const url = `https://api.tenderly.co/api/v1/public-contract/1/trace/${transactionHashOrFilePath}`;
		const response = await fetch(url);

		if (!response.ok) {
			const msg = `Failed to simulate ${transactionHashOrFilePath}: ${response.status} ${response.statusText}`;
			throw new Error(msg);
		}

		const data = await response.json();
		return { stateDiff: data.state_diff, blockNumber: data.block_number };
	}

	// Read state diff from file
	console.log("Reading state diff from file:", transactionHashOrFilePath);
	const fileContent = await readFile(transactionHashOrFilePath, "utf-8");
	const data = JSON.parse(fileContent);
	return {
		stateDiff: data.transaction.transaction_info.state_diff,
		blockNumber: data.block_number,
	};
}

function computeNetStateDiff(stateDiffs: StateDiff[]): StateDiff[] {
	// Mapping from address to storage key to storage values.
	const netStateDiff: Record<Address, Record<Slot, StorageValues>> = {};

	for (const stateDiff of stateDiffs) {
		if (stateDiff.raw.length !== 1) {
			// I'm unsure when this can happen, so let's throw to investigate and understand.
			throw new Error(`Unexpected number of raw state diffs: ${JSON.stringify(stateDiff)}`);
		}
		for (const raw of stateDiff.raw) {
			// If we have not yet come across this address, initialize it.
			if (!netStateDiff[raw.address]) {
				netStateDiff[raw.address] = {};
			}
			// If we have not yet come across this storage key for this address, initialize it.
			if (!netStateDiff[raw.address][raw.key]) {
				const { original, dirty } = raw;
				netStateDiff[raw.address][raw.key] = { original, dirty };
			}
			// Always overwrite the dirty key with the latest.
			netStateDiff[raw.address][raw.key].dirty = raw.dirty;
		}
	}

	// Now we have our net state diff, we can convert it back to the original tenderly format.
	const result: StateDiff[] = [];
	for (const [address, keyAndStorage] of Object.entries(netStateDiff)) {
		for (const [key, { original, dirty }] of Object.entries(keyAndStorage)) {
			const raw: Raw[] = [
				{
					address: address as Address,
					key: key as Slot,
					original,
					dirty,
				},
			];
			result.push({
				address: address as Address,
				raw,
				soltype: null,
				original: null,
				dirty: null,
			});
		}
	}

	return result;
}

async function main() {
	const filePath = process.argv[2];
	if (!filePath) throw new Error("Please provide a file path as an argument.");

	const fileContent = await readFile(filePath, "utf-8");
	const lines = fileContent.split("\n").filter(Boolean);

	// Get data for each transaction.
	const txData: TxData[] = [];
	for (const line of lines) {
		// Skip lines that start with a hash or double slashes.
		if (line.startsWith("#") || line.startsWith("//")) continue;
		const [transactionHashOrFilePath] = line.split(" ");
		const sim = await getStateDiff(transactionHashOrFilePath);
		txData.push(sim);
	}

	// Assert that all state diffs are ordered by block number.
	for (let i = 1; i < txData.length; i++) {
		if (txData[i].blockNumber < txData[i - 1].blockNumber) {
			const block1 = txData[i - 1].blockNumber;
			const block2 = txData[i].blockNumber;
			const msg = `State diffs are not ordered by block number: ${block1} > ${block2}`;
			throw new Error(msg);
		}
	}

	// Flatten into a single array of state diffs, preserving order, and compute the net state diff.
	const stateDiffs = txData.flatMap((data) => data.stateDiff);
	const netStateDiff = computeNetStateDiff(stateDiffs);

	// Write the net state diff to a file.
	const outDir = "out";
	if (!(await exists(outDir))) await mkdir(outDir);
	const filename = basename(filePath).replace(extname(filePath), "");
	const outfile = `${outDir}/net-state-diff-${filename}.json`;
	await writeFile(outfile, JSON.stringify(netStateDiff, null, 2));
	console.log(`Net state diff written to ${outfile}`);
}

main().catch((error) => {
	console.error("An error occurred:", error);
	process.exit(1);
});
