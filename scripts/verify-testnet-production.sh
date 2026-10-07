#!/usr/bin/env bash
set -Eeuo pipefail

COSMOS_EXPLORER="${COSMOS_EXPLORER:-https://explorer-testnet.xitchain.com}"
COSMOS_RPC="${COSMOS_RPC:-https://rpc-testnet.xitchain.com}"
EXPECTED_COSMOS_CHAIN_ID="xitcoin-testnet-v2-1"
FAUCET_TX="2ECF5641183254FC6734A13E2C51E78C22DD4F7BEDEAF861448F08C6897D3AC7"

fail() {
  echo "[FAIL] $*" >&2
  exit 1
}

routes=(
  /
  /xitcoin-testnet
  /xitcoin-testnet/block
  /xitcoin-testnet/tx
  /xitcoin-testnet/staking
  /xitcoin-testnet/gov
  /xitcoin-testnet/supply
  /xitcoin-testnet/params
  /xitcoin-testnet/consensus
  /xitcoin-testnet/faucet
  /wallet/accounts
  /wallet/portfolio
  /wallet/suggest
)

for route in "${routes[@]}"; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 \
    "$COSMOS_EXPLORER$route")"
  test "$code" = "200" || fail "$route returned HTTP $code"
done

status="$(curl -fsS --max-time 20 "$COSMOS_RPC/status")"
chain_id="$(jq -er '.result.node_info.network' <<<"$status")"
height="$(jq -er '.result.sync_info.latest_block_height | tonumber' <<<"$status")"
catching_up="$(jq -r '.result.sync_info.catching_up' <<<"$status")"
test "$chain_id" = "$EXPECTED_COSMOS_CHAIN_ID" ||
  fail "unexpected Cosmos chain ID: $chain_id"
test "$height" -gt 0 || fail "invalid Cosmos height"
test "$catching_up" = "false" || fail "Cosmos RPC is catching up"

faucet="$(curl -fsS --max-time 20 "$COSMOS_EXPLORER/faucet-api/healthz")"
jq -e --arg chain "$EXPECTED_COSMOS_CHAIN_ID" '
  .status == "ok" and
  .chain_id == $chain and
  .claim_amount_xtc == "10" and
  .funded == true
' >/dev/null <<<"$faucet" || fail "faucet health check failed"

tx="$(curl -fsS --max-time 20 "$COSMOS_RPC/tx?hash=0x$FAUCET_TX")"
jq -e '
  (.result.height | tonumber) > 0 and
  ((.result.tx_result.code // 0) == 0)
' >/dev/null <<<"$tx" || fail "reference faucet transaction is unavailable"

"$(dirname "$0")/verify-blockscout-production.sh"

echo "cosmos_chain_id=$chain_id"
echo "cosmos_height=$height"
echo "catching_up=$catching_up"
echo "faucet_tx=$FAUCET_TX"
echo "[OK] XITCOIN PUBLIC TESTNET ACCEPTANCE CHECK PASSED"
echo "[OK] READ-ONLY CHECK; NO TRANSACTION SUBMITTED"
