# Xitcoin EVM explorer operations

The public EVM explorer is <https://evm-explorer-testnet.xitchain.com> on EVM chain
`101089` (`0x18ae1`), using XTC with 18 decimals.

On 13 September 2026, backend **11.2.8**, the corrected frontend and Stats passed
targeted public acceptance. The active project is
`xitcoin-upgrade-20260913t114659z`; backend/frontend/Stats use loopback
15100/15101/15002 behind the existing HTTPS origin. Stats is exposed through
`/stats-service/`. See the authoritative
[deployment inventory and recovery procedure](https://github.com/xitcoin-org/explorer-evm-testnet/blob/d33eb171032137008299bf00b63db63efb4bdc2e/docs/DEPLOYMENT.md)
and [Stats timing](https://github.com/xitcoin-org/explorer-evm-testnet/blob/d33eb171032137008299bf00b63db63efb4bdc2e/docs/STATS.md).

The old `xitcoin-blockscout-canonical` project and the checked-in override are
historical configuration references. Do not recreate the old backend or replay
its deployment commands over the active installation. Preserve new public
writes, all recovery dumps, archives and volumes. Recovery after exposure needs
a plan based on the current DB and Redis, not a blind return to the old dump.

The three accepted indexed heights matched RPC and advanced; the backend
reported block/internal indexing ratios 1.00/1. A reported completion flag is
not proof that every historical internal trace is supported by the RPC.
No new trace capability is inferred from that flag.

The home-page daily chart uses transaction counts, not XTC. The existing native
0.01 XTC self-transfer has no ERC-20 transfers or contract logs; empty tabs for
that transaction remain expected. No new transaction was used for this update.

The [2 September acceptance record](testnet-acceptance.md) remains dated history.
Explorer acceptance does not establish five-host agreement, cryptographic trust
anchoring, public recovery guarantees or a bridge launch.
