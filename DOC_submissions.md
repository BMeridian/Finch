# ETHOnline 2026 submissions — Finch

### Why this, why now

Robinhood Chain is growing fast. Pons, its dominant launchpad, is growing
fast. Tokenized stocks on top of both are growing fast. None of that growth
comes with visibility into where a wallet's tokens actually came from — a
gap that gets wider, not smaller, as activity scales up. Finch is a finch to
Robinhood('s)hood: a small bird that watches the chain and reports back what
it sees.

### The problem

On Robinhood Chain, wallets receive tokenized stocks — NVDA, COST, GLD — they
never bought.

Here's how it happens. Someone launches a memecoin on Pons. It graduates to a
Uniswap V4 pool paired against a stock. The creator redirects their fee cut —
paid in that stock — to a holder-fee distributor. The distributor pays it out
to holders.

Your wallet just sees "+0.09 NVDA from 0xe25e…". No block explorer tells you
which memecoin that came from, or why you. Finch reconstructs the route.

**Try it live, right now:** [`@FinchRH_bot`](https://t.me/FinchRH_bot) on
Telegram — this is the running product. The Telegram bot and its HTTP API run
as a live service on AWS box.

Four bounty submissions, one project: The Graph, Uniswap Foundation, and two
Bazantic tracks. Shared account/gateway details below; each track's specific
write-up follows.

**Bazantic account:** `mluber@proton.me`
**Bazantic gateway:** `Finch` — `https://e7jqymrep5gujnmbn4d6pxa6ga.bazgateway.com`
**Bazantic recipe:** `FINCH_GRAPH_ENS` — `bazantic.com/dashboard/recipes/finch-graph-ens`
**Live product:** [`@FinchRH_bot`](https://t.me/FinchRH_bot) on Telegram

---

## Track 1 — Best AI Tooling / AI Use Case with The Graph (From Scratch)

**Pool:** Start Fresh (net-new) — the entire project (Substreams pipeline,
Postgres sink, bot, HTTP API, MCP server, Bazantic gateway) was built during
this event. An earlier subgraph-only approach was tried first and then fully
superseded by the pure-Substreams pipeline described below — see
`DOC_build.md`'s changelog for the pivot, all done during the hackathon.

### The Graph is load-bearing, not decorative

Finch has **no other data source**. Every answer it gives — wallet
provenance, Pons launches, graduations — comes from one pipeline:

**Substreams → Postgres**, live:

- Module: `substreams/` (`finch.proto`, published `finch-substreams@v0.1.1`
  on substreams.dev). Runs the `map_bot` module.
- Data source: **StreamingFast's Robinhood Chain endpoint**
  (`mainnet.robinhood.streamingfast.io:443`), authenticated with a
  **thegraph.market** Substreams token — a live Graph provider, not a mock.
- Sink: `substreams sink postgres` (relational mode) → Postgres (Aiven),
  running continuously (`finch-sink.service`, `Restart=always`, no stop
  block) — this is a live stream, not a one-time snapshot.

This wasn't the easy path — Robinhood Chain isn't in Subgraph Studio's
supported-network list, and a Goldsky-hosted subgraph or Goldsky-seeded data
was confirmed by The Graph's own dev-rel **not** to satisfy this track. Pure
Substreams via a Graph provider is the only route that does, so that's what
Finch runs.

**A second, separate Graph product is also live in the project**: `ensResolve`
queries **The Graph's canonical ENS subgraph** (`gateway.thegraph.com`) to
reverse-resolve addresses to `.eth` names — a genuinely different Graph
service (hosted Subgraph, not Substreams) used for a different purpose
(identity enrichment) than the primary pipeline (provenance data).

### Meaningful work with the data, not a raw query dump

Finch doesn't print subgraph/Substreams output — it reasons over it:

- **On-chain cross-checks, not inference.** A payer contract's `token()` /
  `quoteToken()` returning a value is not treated as proof; Finch
  cross-checks it against the official `PonsHolderFeeManager` registry
  (`distributorOf(token) == payer`) before calling a route confirmed.
- **Route reconstruction.** Pons launch → Uniswap V4 pool (behind the Meme
  Hook) → creator-fee cut → `FeeEscrow` → holder-fee distributor → epoch
  batch — assembled from indexed events plus live contract reads, not a
  single query.
- **Natural-language interface.** The Telegram bot (`@FinchRH_bot`) answers
  free-text questions ("why did I get NVDA?"), not just parameterized
  lookups — `bot/src/extract.ts` handles NL intent extraction, `bot/src/
  answer.ts` composes the final prose.
- **Honest uncertainty.** Every response carries
  `confidence: "signal only - not a recommendation"`; when a route can't be
  confirmed on-chain, Finch says so explicitly and returns correlational
  candidates instead of a false-confident answer.

### AI-environment tooling

- **MCP server** (`bot/src/mcp.ts`, stdio) — `finch_wallet_provenance`,
  `finch_pons_activity`, `finch_health` — callable directly from Claude
  Code/Desktop, Cursor, or any MCP client.
- **x402 payment tooling** — Finch's HTTP API is a live Bazantic x402/MPP
  gateway; any agent can pay-per-call with no Finch API key
  (`bazantic/DOC_recipe.md`), and Finch independently verifies its own
  settlements on-chain (`/x402/verify?tx=…`) rather than trusting the
  gateway's word for it.
- **Reusable Substreams module** — the Substreams module's filter addresses
  (factory, hook, fee escrow, distributor, token watch list) are parameters,
  not hardcoded constants, so the same module is reusable for another
  Pons-style launchpad or hook without a rewrite.

### Open source

`README.md` documents the architecture, the exact Uniswap V4 integration
points (contract addresses + line numbers), and setup/run instructions.
`SKILL.md` is the machine-readable agent manifest, also served live at
`/SKILL.md`.

### How to verify, directly

- **Live on Telegram right now**: [`@FinchRH_bot`](https://t.me/FinchRH_bot)
  — judges can message it directly, tap through the button menu, and ask a
  real question (e.g. `/account 0x2408ce75d217e3a70d6ca370c78c1b34d706f5a0`
  then `NVDA`) to get a live answer sourced end-to-end from the pipeline
  above. This isn't a recording or a staged demo — it's the running product.
- `substreams/` — inspect the module, its published package on substreams.dev,
  and the parameterized filter config in `substreams.yaml`.
- `GET /health` — live index freshness (sink block vs. chain head), proving
  the pipeline is actively streaming, not static.
- `GET /query?wallet=0x2408ce75d217e3a70d6ca370c78c1b34d706f5a0&q=why+did+I+get+NVDA`
  — a live, real answer, sourced end-to-end from the pipeline above.
- `bot/src/ens.ts` — the second Graph product (ENS subgraph) in use,
  independent of the Substreams pipeline.

---

## Track 2 — Uniswap Foundation: Best Uniswap Stack Contribution

Hackathon feedback for this track is in [`FEEDBACK.md`](FEEDBACK.md) —
submitted via `developers.uniswap.org/hackathon-feedback`.

### Uniswap V4 integration — exact contracts and code

Robinhood Chain **Uniswap V4 `PoolManager`** (singleton):
`0x8366a39CC670B4001A1121B8F6A443A643e40951`

Pons's **Meme Hook** (the hook every Pons-graduated pool is initialized with):
`0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044`

V4 has no per-pool contract to watch — every pool multiplexes through the one
`PoolManager`, so Finch decodes its `Initialize` event directly and filters to
pools using Pons's hook:

- **Substreams decode + hook filter**:
  [`substreams/src/lib.rs:99-110`](substreams/src/lib.rs#L99-L110) — matches
  `PoolManager.Initialize`, discards anything not using the Meme Hook, and
  records `currency0`/`currency1` (sorted by address, not "token vs. quote" —
  the launched-token side is derived by checking against a known pairing-asset
  set, not read directly off the event).
- **On-chain PoolManager reference check**:
  [`bot/src/distributor.ts:59`](bot/src/distributor.ts#L59) (`POOL_MANAGER`
  constant) and [`bot/src/distributor.ts:82`](bot/src/distributor.ts#L82) —
  reads a distributor's own logic bytecode and confirms it references the V4
  `PoolManager`, rather than trusting an interface match.
- **Route confirmation** (the actual payoff — chaining "which V4 pool" to "why
  did this wallet get paid"):
  [`bot/src/distributor.ts:135-176`](bot/src/distributor.ts#L135-L176)
  (`resolveDistributors`) — reads `token()` / `quoteToken()` on the payer, and
  cross-checks it against the official `PonsHolderFeeManager` registry on-chain
  (`distributorOf(token) == payer`,
  [`bot/src/distributor.ts:160`](bot/src/distributor.ts#L160)) rather than
  inferring anything from a getter alone.

### Why this was the hard part

Unlike V2/V3, where each pool is its own contract, V4 routes every pool
through one shared `PoolManager` — there's no per-pool address to watch, and
hooks (Pons's Meme Hook) mean not every pool multiplexed through it is even
relevant. Generic indexers and block explorers (Blockscout, Robinscan) can't
show "which pool" a swap belongs to without doing this decoding themselves.
Full detail in `FEEDBACK.md`.

---

## Track 3 — Bazantic: Best Recipe using EthGlobal Sponsor APIs

### What the recipe does, in order

1. **`finchQuery`** — the actual product. Finch traces where a stock-token
   payout on **Robinhood Chain** really came from: a Pons launch → its
   Uniswap V4 pool → the creator-fee cut → the holder-fee distributor → the
   wallet. This is Finch's own Substreams-indexed data; nothing here touches
   Ethereum.
2. **`ensResolve`** — a second, independent service, needed because ENS names
   don't exist on Robinhood Chain at all. The addresses `finchQuery` surfaces
   are looked up against **The Graph's canonical ENS subgraph on Ethereum
   mainnet** — a different chain entirely. Where a name resolves, a random
   hex address becomes a **confirmed, identifiable ID** — something that can
   be checked against, referenced, and analyzed further, instead of an opaque
   string that terminates the trace.

### How to verify, directly

- `baz gateway list --json` → confirms the `Finch` gateway is active, x402/MPP.
- The recipe's two tool calls are both logged and payable on Bazantic's
  dashboard for this account.
- Each call settles a real x402 payment on Base, independently checkable on
  Basescan or via Finch's own `/x402/verify?tx=…`.

---

## Track 4 — Bazantic: Agentify a New API

### Section 1 — The new service

`finchQuery` is the new service brought onto Bazantic. No sponsor offers this
— sponsors provide raw infrastructure (chain RPC, subgraph hosting); "why did
this wallet receive this token" is Finch's own original logic:

- Finds the transfer of a token into a wallet (Substreams-indexed).
- Resolves the payer on-chain: `token()` / `quoteToken()`, cross-checked
  against the official `PonsHolderFeeManager` registry (`distributorOf()`) —
  never inferred from a getter alone.
- Confirms the creator-fee route: Pons launch → Uniswap V4 pool → `FeeEscrow`
  → holder-fee distributor → epoch-batch payout.

This is a genuinely reusable capability — any agent can call `finchQuery` for
any wallet/token pair on Robinhood Chain, not just the one used in the demo.

The same `finchQuery` route also surfaces **Pons launchpad activity directly**
— not just wallet-side payouts — so an agent doesn't need a separate service
for market awareness versus provenance:

- **Recent launches** — new Pons tokens as they launch, optionally filtered
  by pairing asset.
- **Graduations** — which tokens have graduated to a live Uniswap V4 pool
  (behind Pons's Meme Hook), i.e. which are actually tradeable now versus
  still on the bonding curve.

**How other builders/agents could reuse it:** any agent that needs to explain
an unexpected token transfer on Robinhood Chain — a wallet, a portfolio
tracker, a tax tool — can call `finchQuery` directly (or through Bazantic)
with just a wallet address and a token symbol. It requires no
Robinhood-Chain-specific knowledge from the caller: no ABI, no RPC endpoint,
no understanding of Pons's fee-distribution mechanics. An agent tracking the
Pons ecosystem itself — not a specific wallet — can call the same route for
launches/graduations instead, with no separate integration. The recipe below
demonstrates one downstream use (ENS enrichment on a provenance trace); the
same tool composes with any other agent workflow that needs "why did this
wallet get this token," "what just launched," or "what just graduated" as an
input.

### Section 2 — The recipe

`FINCH_GRAPH_ENS` chains the new service with a second, already-used one:

1. **`finchQuery`** (new) — the provenance trace above.
2. **`ensResolve`** (already used elsewhere in the project) — resolves the
   addresses `finchQuery` surfaces against The Graph's ENS subgraph on
   Ethereum mainnet, since ENS names don't exist on Robinhood Chain at all.

The final answer depends on both: without `finchQuery` there's no route or
addresses to resolve; without `ensResolve` those addresses stay opaque hex.

**How to verify, directly:**

- `baz gateway list --json` → confirms the `Finch` gateway is active, x402/MPP.
- The recipe's two tool calls are both logged and payable on Bazantic's
  dashboard for this account.
- Each call settles a real x402 payment on Base, independently checkable on
  Basescan or via Finch's own `/x402/verify?tx=…`.
