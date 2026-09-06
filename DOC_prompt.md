# Prompt for Claude Code — Finch subgraph, Phase 1 POC (rewrite)

Paste this into Claude Code. This supersedes any earlier version of this
prompt — use this one. Scope is `/subgraph` only: no bot, no NLI layer, no
Bazantic, no alerting, nothing proactive. Just get the subgraph deployed
and returning correct, real data.

## Success condition — the only thing that matters for Phase 1

A GraphQL query against the deployed subgraph, filtered to tx
`0x022e94a3a3670b6f0dfdbfa50ffad5a6d48a970e39fc26915ea0b62e051b53b9`,
returns a `Transfer` record showing:
- `to`: `0x2a58fb44f78d7b600aec945ba8cb253896793ed3`
- `amount`: `0.007371` NVDA (raw `7370695524996258`, adjust for decimals)
- `toLabel`: null or "you" (this is a plain wallet, no special label)
- `fromLabel`: `"Pons fee claim contract"` (this is the distributor,
  `0xe25e9bc31d24bb652fb6e2e466d7c9c89701173e` — must resolve to this
  label, not raw hex)

Do not consider Phase 1 done until this exact query has actually been run
and the result pasted back for review.

## Deploy target — do this first, before writing any mapping code

**Subgraph Studio does NOT support Robinhood Chain** — confirmed against
The Graph's own networks registry (chain eip155:4663 has an empty
`subgraphs` list). Do not attempt `graph deploy --studio`. Use one of:
- **Pinax** — registry-listed Substreams/Firehose/RPC provider for this
  chain specifically; the stronger-documented path for the Graph prize
  tracks, since it's closer to "official" than a generic third party
- **Goldsky** — confirmed Graph-protocol-compatible, supports arbitrary
  EVM chains via RPC. When setting the network in Goldsky's dashboard, use
  the interactive network dropdown/typeahead — do not hardcode a guessed
  slug like `robinhood-mainnet`

Pick one, get authenticated, and confirm you can actually deploy before
writing more mapping code — this was the step that broke earlier.

## Chain details

- Chain ID: 4663 (0x1237)
- RPC: `https://rpc.mainnet.chain.robinhood.com`
- Explorer: `https://robinhoodchain.blockscout.com`
- Mainnet launch: July 1, 2026 — set `startBlock` to a real recent block
  in every data source, not 0

## Contract addresses

Verified:
- Pons V2 Launch Factory: `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`
- Pons V2 Meme Hook: `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044`

Unverified — confirm each on Blockscout before hardcoding:
- Uniswap V4 PoolManager: `0x8366a39CC670B4001A1121B8F6A443A643e40951`
- Pons V2 FeeEscrow: `0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e`
- Distributor/claim contract: `0xe25e9bc31d24bb652fb6e2e466d7c9c89701173e`
- Stock tokens: NVDA `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC`, AAPL
  `0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9`, TSLA
  `0x322F0929c4625eD5bAd873c95208D54E1c003b2d`, AMZN
  `0x12f190a9F9d7D37a250758b26824B97CE941bF54`, WETH
  `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`, USDG
  `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`

## Canonical demo case — verified, non-personal, use exactly this

Wallet `0x2a58fb44f78d7b600aec945ba8cb253896793ed3` (a plain EOA) received
0.007371 NVDA in tx `0x022e94a3…b53b9` — one of **100 recipients** paid in a
single Multicall3 `aggregate3` transaction sent by the distributor contract
(`0xe25e…173e`). The distributor itself was funded by a separate, earlier
claim against FeeEscrow (different tx, not needed for Phase 1).

This wallet is a **recurring** recipient: full on-chain history shows NVDA
received 11× (~9.72 NVDA total), 10 of them from `0xe25e…173e`, back to
block ~15.8M. The current subgraph (startBlock 53,480,000) already sees two:
this tx and a later one at block 53,599,582 (`0xaa0ff1fb…`). That makes it a
clean "standing fee entitlement" demo without widening the window.

NEVER use a personal wallet as a fixture. This one is unclaimed and non-personal.

Dead-end backup (do not use — single receipt only):
`0x2a888c0a8ec1853fffb74e72fb17bc401f7e751d`

**On Multicall3 — do not over-build this for Phase 1.** Each of the 100
transfers inside that batch still emits its own normal ERC-20 `Transfer`
event. A plain `Transfer` handler on the NVDA token contract catches this
wallet's transfer correctly with zero Multicall3-specific decoding. Do NOT
spend Phase 1 time writing an `aggregate3` calldata decoder — that's only
needed later if you want the NLI layer to state "1 of 100" as a verified
on-chain fact rather than documented context. Skip it for now.

## Required fix: Pool.token derivation

If the `Initialize` handler picks "the token" side of a pool by checking
only for the zero address (native ETH), that's wrong — Pons pools pair
against stock tokens and USDG, not just ETH. Fix: maintain a list of known
pairing assets (zero address + WETH + USDG + every stock token above), and
derive `token` as whichever side is NOT in that list. If neither or both
sides match, leave `token` null rather than guessing.

## Required: promiscuous token watch list

Watch `Transfer` events on ALL the stock tokens listed above (not just
NVDA) — one shared handler function, multiple data source entries in
`subgraph.yaml` reusing it. NVDA stays the demo fixture; the handler
itself must not be NVDA-specific.

## Schema

```graphql
type Launchpad @entity {
  id: ID!
  name: String!
  launches: [TokenLaunch!]! @derivedFrom(field: "launchpad")
}

type TokenLaunch @entity {
  id: ID!
  launchpad: Launchpad!
  token: Bytes!
  curve: Bytes
  creator: Bytes!
  name: String
  symbol: String
  block: BigInt!
  timestamp: BigInt!
  txHash: Bytes!
  graduated: Boolean!
  graduationTx: Bytes
  graduationTimestamp: BigInt
}

type Pool @entity {
  id: ID!
  token: Bytes            # nullable - see Pool.token fix above
  currency0: Bytes!
  currency1: Bytes!
  hook: Bytes!
  fee: Int!
  tickSpacing: Int!
  createdAtBlock: BigInt!
}

type LiquidityEvent @entity {
  id: ID!
  pool: Pool!
  provider: Bytes!
  liquidityDelta: BigInt!
  tickLower: Int!
  tickUpper: Int!
  timestamp: BigInt!
}

type SwapEvent @entity {
  id: ID!
  pool: Pool!
  sender: Bytes!
  amount0: BigInt!
  amount1: BigInt!
  sqrtPriceX96: BigInt!
  liquidity: BigInt!
  timestamp: BigInt!
}

type Transfer @entity {
  id: ID!
  token: Bytes!
  from: Bytes!
  to: Bytes!
  amount: BigInt!
  fromLabel: String
  toLabel: String
  txHash: Bytes!
  block: BigInt!
  timestamp: BigInt!
}

type Wallet @entity {
  id: ID!
  firstSeenBlock: BigInt!
  firstSeenTimestamp: BigInt!
}
```

## Classification layer

Known addresses (FeeEscrow, the distributor, the Pons factory, the Meme
Hook) map to plain labels (`labelFor()`-style lookup) before anything
reaches the query result — a plain wallet like the demo recipient gets no
label (null), not a fabricated one. Deterministic lookup function, not
LLM-decided — no LLM exists in Phase 1 anyway, but keep this structured so
Phase 2 can reuse it directly.

## Explicitly NOT in Phase 1

Multicall3 calldata decoding, curve trades (buy/sell), graduation events,
non-Pons launchpads, Substreams, alerting/proactive notifications, any NLI
or bot code. Schema types can exist for future entities; no handlers
required yet.

## Before considering Phase 1 done — checklist

1. All UNVERIFIED addresses confirmed on Blockscout
2. Real recent `startBlock` set (not 0) for every data source
3. `Pool.token` fix applied
4. Deployed to Pinax or Goldsky (not Subgraph Studio), confirmed working
5. The exact test query above run and pasted back for review
