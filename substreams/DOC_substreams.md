# /substreams — Track B: Substreams via Pinax → Goldsky subgraph

Same data model as `/subgraph` (Track A). Re-sourced through a Substreams pipeline
instead of AssemblyScript event handlers. `graph/schema.graphql` is a copy of
`../subgraph/schema.graphql` — the source of truth; do not diverge it.

## Pipeline

```
sf.ethereum.type.v2.Block
  └─ map_raw (params: factory,hook,fee_escrow,distributor,tokens)  → finch.v1.Events
       ├─ store_meme_pools (set_if_not_exists)  ← pool ids from Initialize@hook
       └─ map_events (map_raw + store)          → finch.v1.Events (pool activity filtered to Meme-Hook pools)
            └─ graph_out                        → sf.substreams.sink.entity.v1.EntityChanges
```

Filter addresses are **module params, not constants** (`params:` block in
`substreams.yaml`) — reusable for another hook / token list.

## Verified on-chain (RPC + `ponsdotdev/ponsfamily` source), 2026-09-05

Real Pons V2 event (the guessed ABI in Track A was wrong — no name/symbol):

```
TokenLaunched(address indexed token, address indexed curve, address indexed deployer,
              address pairToken, uint256 launchConfigId, uint256 graduationThreshold)
  topic0 0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607
```

Other topic0s confirmed against factory logs: `PoolGraduated` `0x0a44ef75…`,
`GraduationTokensPermanentlyLocked` `0xa0a18f5b…`. Uniswap V4: `Initialize`
`0xdd466e67…`, `Swap` `0x40e9cecb…`, `ModifyLiquidity` `0xf208f491…`.

## Pinax connection — CONFIRMED WORKING

```
export SUBSTREAMS_API_TOKEN=<PINAX JWT from .env>
substreams run -e robinhood.substreams.pinax.network:443 \
  https://spkg.io/v1/packages/ethereum-common/v0.3.3 filtered_events \
  -s 53505176 -t +1 -p 'filtered_events=evt_addr:0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec' -o jsonl
# → streamed block 53505176, NVDA Transfer events returned, "Completed successfully"
```

- Endpoint: `robinhood.substreams.pinax.network:443`
- Auth: the Pinax JWT as `SUBSTREAMS_API_TOKEN` (NOT `SUBSTREAMS_API_KEY` — the
  CLI's key-exchange endpoint is StreamingFast's, not Pinax's, so a bare key
  won't exchange). `.env` has both `SUBSTREAMS_API_KEY` and `SUBSTREAMS_API_TOKEN`.
- `network: robinhood` (registry id; aliases `robinhood-mainnet`, `evm-4663`).

## Build / run

```
cd substreams
cargo build --target wasm32-unknown-unknown --release
substreams pack substreams.yaml                       # -> finch_substreams-v0.1.0.spkg
export SUBSTREAMS_API_TOKEN=$(grep '^SUBSTREAMS_API_TOKEN=' ../.env | cut -d= -f2)
substreams run -e robinhood.substreams.pinax.network:443 substreams.yaml graph_out -s 53489000 -t 53506000 -o jsonl
```

## Toolchain (installed)

substreams 1.22.0 · rustc 1.93.1 + wasm32-unknown-unknown · buf 1.72.0 · protoc

## Sink — Goldsky (BLOCKED: account)

`graph/subgraph.yaml` is a `kind: substreams` subgraph pointing at `graph_out`.
Deploy path once a Goldsky account exists:

```
goldsky login                                         # needs GOLDSKY_API_KEY / account
cd substreams && substreams pack substreams.yaml
goldsky subgraph deploy finch-substreams/0.1.0 --path ./graph
```

Then run the Track A success query against the Goldsky GraphQL endpoint:
`Transfer` where `txHash = 0x022e94a3…b53b9` and `to = 0x2a466c3edd…63e9` →
expect `amount 4459483197045479`, `fromLabel "Pons fee claim contract"`.

## Verified against the canonical fixture (live Pinax data, 2026-09-06)

```
substreams run -e robinhood.substreams.pinax.network:443 substreams.yaml graph_out \
  -s 53505176 -t +1 -o json --limit-processed-blocks 0
```

`graph_out` emits, for the demo tx, an `EntityChange` on `Transfer`:

| field | value |
|---|---|
| to | `0x2a466c3edd210d59ee530c93c3fd8d1b819463e9` |
| amount | `4459483197045479` (0.004459 NVDA) |
| fromLabel | `Pons fee claim contract` |
| toLabel | `` (plain wallet — correct) |
| txHash | `0x022e94a3…b53b9` |

`map_raw` @ that block: 128 transfers (102 NVDA), 7 Meme-Hook swaps. This is the
Step 5 result — but produced directly from the module, not yet through Goldsky.

> Same-block caveat: `map_events` filters Swap/ModifyLiquidity by the
> `store_meme_pools` store, which only sees `Initialize` from *prior* blocks. A
> full backfill from `initialBlock: 53480000` populates it; a run starting at
> 53505176 shows 0 filtered swaps. Not a bug — store semantics.

## Status

| Step | State |
|---|---|
| 1 read tooling | done |
| toolchain setup | done |
| Pinax auth + `substreams run` | **confirmed** |
| 2 scaffold module | done (this dir) |
| module `cargo build` + `substreams pack` | **pass, no warnings** — `finch-substreams-v0.1.0.spkg` |
| 3 parameterized | done — `params:` block, no hardcoded filter addrs |
| module output vs canonical fixture | **verified** (table above) |
| 4 sink to Goldsky subgraph | **blocked — needs Goldsky account** |
| 5 success query on live Goldsky endpoint | blocked on step 4 |
