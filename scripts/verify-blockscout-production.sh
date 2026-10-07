#!/usr/bin/env bash
set -Eeuo pipefail

EXPLORER_URL="${EXPLORER_URL:-https://evm-explorer-testnet.xitchain.com}"
RPC_URL="${RPC_URL:-https://evm-rpc-testnet.xitchain.com}"
EXPECTED_CHAIN_ID="0x18ae1"
REFERENCE_TX="0x68a63b7033d911c768ea3717f2678813c018d4aaddbcf4746ac42f23c62b2597"

fail() {
  echo "[FAIL] $*" >&2
  exit 1
}

rpc_response="$(
  curl -fsS --max-time 20 \
    -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
    "$RPC_URL"
)"
chain_id="$(jq -er '.result' <<<"$rpc_response")"
test "$chain_id" = "$EXPECTED_CHAIN_ID" ||
  fail "unexpected EVM chain ID: $chain_id"

indexing_status="$(
  curl -fsS --max-time 20 \
    "$EXPLORER_URL/api/v2/main-page/indexing-status"
)"
jq -e '
  .finished_indexing == true and
  .finished_indexing_blocks == true and
  ((.indexed_blocks_ratio | tonumber) == 1)
' >/dev/null <<<"$indexing_status" ||
  fail "Blockscout block indexing is incomplete"

blocks="$(
  curl -fsS --max-time 20 \
    "$EXPLORER_URL/api/v2/blocks?type=block"
)"
indexed_height="$(jq -er '.items[0].height | tonumber' <<<"$blocks")"
test "$indexed_height" -gt 0 || fail "invalid indexed height"

transaction="$(
  curl -fsS --max-time 20 \
    "$EXPLORER_URL/api/v2/transactions/$REFERENCE_TX"
)"
jq -e --arg hash "$REFERENCE_TX" '
  (.hash | ascii_downcase) == ($hash | ascii_downcase) and
  .status == "ok" and
  (.block_number | tonumber) > 0
' >/dev/null <<<"$transaction" ||
  fail "reference EVM transaction is unavailable"

echo "chain_id=$chain_id"
echo "indexed_height=$indexed_height"
echo "$indexing_status" | jq .
echo "reference_tx=$REFERENCE_TX"
echo "[OK] BLOCKSCOUT PUBLIC VERIFICATION PASSED"
echo "[OK] READ-ONLY CHECK; NO TRANSACTION SUBMITTED"
