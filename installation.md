# Installation and deployment

This repository contains the official explorer configuration for the
**Xitcoin Public Testnet**:

- a Ping-based Cosmos explorer;
- a separately operated Blockscout EVM explorer.

## Requirements

- Node.js 24.19.0 (see `.nvmrc`)
- Corepack
- Yarn 1.22.22
- Git

## Local development

```bash
corepack enable
yarn install --frozen-lockfile --ignore-scripts --non-interactive
yarn serve
```

The development server uses the public Xitcoin testnet endpoints configured in
`chains/testnet/xitcoin-testnet.json`.

## Production build

```bash
corepack enable
yarn install --frozen-lockfile --ignore-scripts --non-interactive
yarn build
```

`yarn build` runs the TypeScript check and the production Vite build. The
output is written to `dist/`.

Before publishing a build, verify:

- public network name: `Xitcoin Public Testnet`;
- Cosmos chain ID: `xitcoin-testnet-v2-1`;
- EVM chain ID: `101089` (`0x18ae1`);
- native asset: XTC, base denomination `axtc`, 18 decimals;
- faucet amount: exactly 10 XTC per accepted request;
- faucet endpoint: `/faucet-api`.

## Cosmos explorer deployment

Production releases are installed with `scripts/deploy-production.sh`. The
script requires `EXPECTED_COMMIT` to identify the exact Git commit being
deployed.

The deployment workflow:

1. downloads and checks out the expected source commit;
2. installs locked dependencies;
3. runs type-checking and the production build;
4. validates the faucet health and live Cosmos chain ID;
5. installs a timestamped release;
6. validates all public explorer routes;
7. switches the active Nginx symlink atomically.

If a validation fails after activation begins, the script restores the previous
release and Nginx configuration automatically.

## EVM explorer deployment

Blockscout is deployed independently from the Ping frontend. Its canonical
Xitcoin-specific Compose values live in
`blockscout/xitcoin-compose.override.yml`. Operational deployment, rollback and
verification are documented in [docs/blockscout.md](docs/blockscout.md).

The important invariants are:

- the Blockscout index starts at EVM block 1;
- block indexing reports complete with a ratio equal to 1;
- unsupported internal transaction tracing is disabled;
- the advertising provider is disabled;
- PostgreSQL and Redis volumes are always preserved.

Neither explorer deployment restarts blockchain services or submits
transactions.

## Public verification

After deployment, verify:

- <https://explorer-testnet.xitchain.com/>
- <https://explorer-testnet.xitchain.com/xitcoin-testnet>
- <https://explorer-testnet.xitchain.com/xitcoin-testnet/faucet>
- <https://explorer-testnet.xitchain.com/faucet-api/healthz>
- <https://evm-explorer-testnet.xitchain.com/>
- <https://rpc-testnet.xitchain.com/status>
- <https://api-testnet.xitchain.com/cosmos/base/tendermint/v1beta1/node_info>
- <https://evm-rpc-testnet.xitchain.com>

Run the Blockscout read-only verification:

```bash
./scripts/verify-blockscout-production.sh
```

A healthy deployment reports `xitcoin-testnet-v2-1`, EVM chain ID `0x18ae1`,
advancing block heights, `catching_up: false`, complete Blockscout indexing and
a funded faucet claim amount of 10 XTC.

## Security

Never commit secrets, recovery phrases, private keys, passwords, keyring data,
database credentials or production environment files. Use only public
configuration values required by the explorers.
