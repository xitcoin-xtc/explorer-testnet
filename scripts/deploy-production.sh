#!/usr/bin/env bash
set -Eeuo pipefail

REPO='https://github.com/xitcoin-org/explorer-testnet.git'
EXPECTED_COMMIT="${EXPECTED_COMMIT:-}"
RELEASES='/var/www/xitcoin-testnet-explorer-releases'
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE="$RELEASES/${STAMP}-ping-standard"
WORK="$(mktemp -d /var/tmp/xitcoin-explorer-build.XXXXXX)"
BACKUP_DIR="/var/backups/xitcoin-explorer/$STAMP"
CONF='/etc/nginx/conf.d/xitcoin-explorer-testnet.conf'
ACTIVE='/var/www/xitcoin-testnet-explorer'
FAUCET_ENV='/etc/xitcoin-testnet/faucet-v2.env'
ACTIVATED=0
NGINX_CHANGED=0

cleanup() {
  rm -rf -- "$WORK"
}
trap cleanup EXIT

fail() {
  echo "[FAIL] $*" >&2
  exit 1
}

[[ "$EXPECTED_COMMIT" =~ ^[0-9a-f]{40}$ ]] ||
  fail 'EXPECTED_COMMIT IS MISSING OR INVALID'

test -f "$CONF" || fail "NGINX CONFIGURATION IS MISSING: $CONF"
grep -Eq 'server_name[[:space:]]+explorer-testnet\.xitcoin\.org;' "$CONF" ||
  fail "DOMAIN IS MISSING FROM THE NGINX CONFIGURATION"
grep -Eq 'root[[:space:]]+/var/www/xitcoin-testnet-explorer;' "$CONF" ||
  fail "UNEXPECTED NGINX ROOT"
test -L "$ACTIVE" || fail "ACTIVE SYMLINK IS MISSING: $ACTIVE"
OLD_TARGET="$(readlink -f "$ACTIVE")"
test -d "$OLD_TARGET" || fail "ACTIVE RELEASE WAS NOT FOUND: $OLD_TARGET"

mkdir -p "$BACKUP_DIR" "$RELEASES"
cp -a "$CONF" "$BACKUP_DIR/nginx.conf.before"

rollback() {
  status=$?
  line="${1:-unknown}"
  command="${2:-unknown}"
  trap - ERR

  echo "[FAIL] line=$line command=$command status=$status" >&2

  if test "$ACTIVATED" -eq 1; then
    ln -s "$OLD_TARGET" "${ACTIVE}.rollback"
    mv -Tf "${ACTIVE}.rollback" "$ACTIVE"
  fi

  if test "$NGINX_CHANGED" -eq 1; then
    cp -a "$BACKUP_DIR/nginx.conf.before" "$CONF"
    nginx -t
    systemctl reload nginx
  fi

  echo '[ROLLBACK COMPLETED]'
  exit "$status"
}
trap 'rollback "$LINENO" "$BASH_COMMAND"' ERR

echo '============================================================'
echo '=== STANDARD PING EXPLORER BUILD ==='
echo '============================================================'

git clone --filter=blob:none --no-checkout "$REPO" "$WORK/source"
git -C "$WORK/source" fetch --depth 1 origin "$EXPECTED_COMMIT"
git -C "$WORK/source" checkout --detach "$EXPECTED_COMMIT"
cd "$WORK/source"

COMMIT="$(git rev-parse HEAD)"
test "$COMMIT" = "$EXPECTED_COMMIT"

jq -e '
  .chain_name == "xitcoin-testnet" and
  .sdk_version == "0.54.4" and
  .addr_prefix == "xtc" and
  .assets[0].base == "axtc" and
  .assets[0].exponent == "18" and
  .faucet.amount == "10000000000000000000axtc" and
  .faucet.endpoint == "/faucet-api"
' chains/testnet/xitcoin-testnet.json >/dev/null

! grep -RInE \
  '100 XTC|xitcoin-testnet-1|transaction-layout|v2-final|dbf43315|51776667' \
  chains src public \
  --exclude='yarn.lock'

corepack yarn install --frozen-lockfile --ignore-engines
corepack yarn build

test -s dist/index.html
test -d dist/assets
test -s dist/assets/xitcoin-logo.png

mkdir -p "$RELEASE"
cp -a dist/. "$RELEASE/"

# Preserve previously published hashed assets so browsers opened before the
# atomic symlink switch can still finish loading their lazy JavaScript chunks.
if test -d "$OLD_TARGET/assets"; then
  cp -an "$OLD_TARGET/assets/." "$RELEASE/assets/"
fi

chmod -R a=rX "$RELEASE"

if ! grep -q 'XITCOIN_FAUCET_PROXY' "$CONF"; then
  python3 - "$CONF" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
needle = "location / {"
if text.count(needle) != 1:
    raise SystemExit("[FAIL] location / BLOCK IS NOT UNIQUE")

proxy = """# XITCOIN_FAUCET_PROXY
    location ^~ /faucet-api/ {
        proxy_pass http://127.0.0.1:18090/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
    }

    """
path.write_text(text.replace(needle, proxy + needle, 1))
PY
  NGINX_CHANGED=1
fi

nginx -t

ln -s "$RELEASE" "${ACTIVE}.next"
mv -Tf "${ACTIVE}.next" "$ACTIVE"
ACTIVATED=1

systemctl reload nginx
sleep 3

HTML="$(
  curl -kfsS --max-time 15 \
    --resolve explorer-testnet.xitchain.com:443:127.0.0.1 \
    https://explorer-testnet.xitchain.com/
)"
printf '%s' "$HTML" | grep -q '/assets/'
test "$(readlink -f "$ACTIVE")" = "$RELEASE"

HEALTH="$(
  curl -kfsS --max-time 15 \
    --resolve explorer-testnet.xitchain.com:443:127.0.0.1 \
    https://explorer-testnet.xitchain.com/faucet-api/healthz
)"

jq -e '
  .status == "ok" and
  .chain_id == "xitcoin-testnet-v2-1" and
  .claim_amount_xtc == "10" and
  .funded == true
' <<<"$HEALTH" >/dev/null

for route in \
  / \
  /xitcoin-testnet \
  /xitcoin-testnet/block \
  /xitcoin-testnet/tx \
  /xitcoin-testnet/staking \
  /xitcoin-testnet/gov \
  /xitcoin-testnet/supply \
  /xitcoin-testnet/params \
  /xitcoin-testnet/consensus \
  /xitcoin-testnet/faucet
do
  code="$(
    curl -kso /dev/null -w '%{http_code}' --max-time 15 \
      --resolve explorer-testnet.xitchain.com:443:127.0.0.1 \
      "https://explorer-testnet.xitchain.com$route"
  )"
  test "$code" = '200'
  echo "[OK] HTTP 200: $route"
done

test -r "$FAUCET_ENV" || fail "FAUCET CONFIGURATION IS MISSING: $FAUCET_ENV"
RPC_NODE="$(sed -n 's/^RPC_NODE=//p' "$FAUCET_ENV" | tail -n 1)"
test -n "$RPC_NODE" || fail "RPC_NODE IS MISSING FROM THE FAUCET CONFIGURATION"
RPC_STATUS_URL="${RPC_NODE/tcp:\/\//http://}/status"

RPC_BEFORE="$(curl -fsS --max-time 10 "$RPC_STATUS_URL")"
HEIGHT_BEFORE="$(jq -er '.result.sync_info.latest_block_height | tonumber' <<<"$RPC_BEFORE")"
HEIGHT_AFTER="$HEIGHT_BEFORE"
CHAIN_ID=''
CATCHING_UP=''

for attempt in {1..12}; do
  sleep 5
  RPC_AFTER="$(curl -fsS --max-time 10 "$RPC_STATUS_URL")"
  CHAIN_ID="$(jq -er '.result.node_info.network' <<<"$RPC_AFTER")"
  HEIGHT_AFTER="$(jq -er '.result.sync_info.latest_block_height | tonumber' <<<"$RPC_AFTER")"
  CATCHING_UP="$(jq -r '.result.sync_info.catching_up' <<<"$RPC_AFTER")"

  test "$CHAIN_ID" = 'xitcoin-testnet-v2-1' ||
    fail "UNEXPECTED CHAIN ID: $CHAIN_ID"
  test "$CATCHING_UP" = 'false' ||
    fail "PUBLIC NODE IS CATCHING UP"

  if test "$HEIGHT_BEFORE" -lt "$HEIGHT_AFTER"; then
    break
  fi

  echo "[WAITING] BLOCK PROGRESS ($attempt/12): $HEIGHT_AFTER"
done

test "$HEIGHT_BEFORE" -lt "$HEIGHT_AFTER" ||
  fail "NO NEW BLOCK AFTER 60 SECONDS: $HEIGHT_BEFORE"

trap - ERR

echo
echo '============================================================'
echo '=== STANDARD PING EXPLORER ACTIVATED ==='
echo '============================================================'
echo "commit=$COMMIT"
echo "previous_release=$OLD_TARGET"
echo "active_release=$(readlink -f "$ACTIVE")"
echo "chain_id=$CHAIN_ID"
echo "height_before=$HEIGHT_BEFORE"
echo "height_after=$HEIGHT_AFTER"
echo "catching_up=$CATCHING_UP"
echo "$HEALTH" | jq .
echo '[OK] FRESH GITHUB SOURCE]'
echo '[OK] BUILD AND TYPE CHECK PASSED]'
echo '[OK] 10 XTC FAUCET]'
echo '[OK] SAME-ORIGIN FAUCET PROXY]'
echo '[OK] NO BLOCKCHAIN SERVICE RESTARTED]'
echo '[OK] NO TRANSACTION SUBMITTED]'
