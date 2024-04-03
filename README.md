# State Diff Aggregator

Generates the net state diff across a series of executed transaction hashes and/or Tenderly
transaction simulation results.

## Overview

Given a series of executed transaction hashes and/or Tenderly transaction simulation results,
this script will get the state diffs of each and output the net state state diff across all
transactions.

For example, if transaction A has the following state diff:

```json
"address1": { "key1": "from value0 to value1", "key2": "from value2 to value3" }
"address2": { "key3": "from value4 to value5" }
```

and transaction B has the following state diff:

```json
"address1": { "key1": "from value1 to value6" }
```

The net state diff that is output will be:

```json
"address1": { "key1": "from value0 to value6", "key2": "from value2 to value3" }
"address2": { "key3": "from value4 to value5"}
```


Since the Tenderly API to get the state diffs, the state diffs of a transaction can be
found in the `state_diff` key of the JSON and have the type definitions shown in `index.ts`.

This state diffs live in the root `state_diff` key of the JSON for transactions that were executed
on a live chain, or in the `transaction.transaction_info.state_diff` for responses from the
Tenderly Simulation API.

## Usage

1. [Install bun](https://bun.sh/docs/installation).
2. Install dependencies with `bun install`.
3. Run the script, passing a file path as input: `bun index.ts data/{filename}.txt`. For example, `bun index.ts data/op-mainnet-upgrade4to6.txt`.

The file should contain one transaction hash or Tenderly transaction simulation response filepath
per line. An example file looks like this:

```bash
# Data is from github.com/ethereum-optimism/superchain-ops
0x3f7c36a1d636cdb23bf4f9171c27ebe58b73f4c0e6a33dbaac2c2f3c142faf50 # tasks/eth/004-add-superchainConfig
0x29bb617fac8f49f5c934cc776b22d47e187ab482e86f21e4502a23ba1c9ad0da # tasks/eth/005-protocol-versions-ecotone
0xac827d7a1238dfd6f3cc81dba09f0a3e1d9dc685bcc6b22466d76bb2335db38b # tasks/eth/005-2-ecotone-set-gas-config
./data/sim-upgrade6.json # Simulation from tasks/eth/006-MCP-L1
```

As implied by the above, both input text files and Tenderly simulation response files are intended
to live in the `data/` folder and may be committed for easy replication.

The output is a `out/net-state-diff-{filename}.json` file matching the Tenderly state diff format.

## Development

- `bun check` to lint and format.
- `bun fmt` to format.
- `bun lint` to lint.
