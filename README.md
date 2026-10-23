# Sample Hardhat 3 Project (`node:test` and `viem`)

This project showcases a Hardhat 3 project using the native Node.js test runner (`node:test`) and the `viem` library for Ethereum interactions.

To learn more about Hardhat 3, please visit the [Getting Started guide](https://hardhat.org/docs/getting-started#getting-started-with-hardhat-3). To share your feedback, join our [Hardhat 3](https://hardhat.org/hardhat3-telegram-group) Telegram group or [open an issue](https://github.com/NomicFoundation/hardhat/issues/new) in our GitHub issue tracker.

## Project Overview

This example project includes:

- A simple Hardhat configuration file.
- Foundry-compatible Solidity unit tests.
- TypeScript integration tests using [`node:test`](https://nodejs.org/api/test.html), the new Node.js native test runner, and [`viem`](https://viem.sh/).
- Examples demonstrating how to connect to different types of networks, including locally simulating OP mainnet.

## Usage

### Running Tests

To run all the tests in the project, execute the following command:

```shell
npx hardhat test
```

You can also selectively run the Solidity or `node:test` tests:

```shell
npx hardhat test solidity
npx hardhat test nodejs
```

### Generate genesis JSON

Compile the contracts first, then provide one or more validator mappings and account
roles. Every validator's mapped account is automatically added as a `Trustee`.
Accounts provided with `--account` cannot also be validator addresses or validator
accounts.

```shell
npx hardhat build
npx indy-besu-generate-genesis \
  --validator 0x93917cadbace5dfce132b991732c6cda9bcc5b8a:0xed9d02e382b34818e88b88a309c7fe71e65f419d \
  --validator 0x27a97c9aaf04f18f3014c32e036dd0ac76da5f18:0xb30f304642de3fee4365ed5cd06ea2e69d3fd0ca \
  --account 0x0000000000000000000000000000000000000001:Endorser \
  --account 0x0000000000000000000000000000000000000002:Steward \
  --output ./ContractsGenesis.json
```

`--validator` and `--account` can be repeated. Roles are `Trustee`, `Endorser`,
and `Steward`. Use `--help` to see the command syntax.

### Make a deployment to Sepolia

This project includes an example Ignition module to deploy the contract. You can deploy this module to a locally simulated chain or to Sepolia.

To run the deployment to a local chain:

```shell
npx hardhat ignition deploy ignition/modules/Counter.ts
```

To run the deployment to Sepolia, you need an account with funds to send the transaction. The provided Hardhat configuration includes a Configuration Variable called `SEPOLIA_PRIVATE_KEY`, which you can use to set the private key of the account you want to use.

You can set the `SEPOLIA_PRIVATE_KEY` variable using the `hardhat-keystore` plugin or by setting it as an environment variable.

To set the `SEPOLIA_PRIVATE_KEY` config variable using `hardhat-keystore`:

```shell
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
```

After setting the variable, you can run the deployment with the Sepolia network:

```shell
npx hardhat ignition deploy --network sepolia ignition/modules/Counter.ts
```
