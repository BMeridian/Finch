# Finch

**Finch snitches on where your tokens really came from.**

A wallet-provenance and launchpad-activity service for Robinhood Chain — built for
ETHGlobal Online 2026, targeting **The Graph** (Best AI Tooling/Use Case),
**Uniswap Foundation** (Best Uniswap Stack Contribution), and **Bazantic**
(Agentify a New API).

## What Finch does

Finch traces where an unexpected token transfer on Robinhood Chain actually came
from. The motivating case: a wallet receives a stock token (e.g. NVDA) with no
direct swap, no claim of its own, no obvious cause — Finch explains the real
mechanism: Pons launchpad trading fees, settled through a fee-escrow/distributor
pipeline, paid out in a stock token unrelated to whatever generated the fee.

Finch surfaces this as:

- **The immediate event** — what happened, labeled plainly (not raw hex addresses)
- **The recurring pattern** — is this a one-off or a standing entitlement
- **Candidate tokens** — which Pons-launched tokens this wallet's history
  correlates with, honestly hedged as correlational, not causal (see Limitations
  below)

## Why this uses Uniswap V4 — not just "reads some events"

Finch indexes Uniswap V4's `PoolManager` singleton (bytecode-verified against the
canonical `IPoolManager` interface — all core selectors present), filtered to
pools using Pons's custom **Meme Hook** — a genuine V4-specific integration (hooks
are V4's defining architectural feature; this pattern doesn't exist in V2/V3).
Finch captures `Initialize` / `Swap` / `ModifyLiquidity` for those pools.

Where a token graduates, its pool *is* a V4 Meme-Hook pool. Fee payouts to holders
flow `FeeEscrow → per-token distributor → holders`; Finch traces that route from
its indexed data. The step Finch does **not** trace transaction-by-transaction is
which specific swaps funded a given `FeeEscrow` balance — it reports the route and
the mechanism, not a swap-level audit.

Exact integration points:

- **PoolManager address**: `0x8366a39CC670B4001A1121B8F6A443A643e40951`
  — wired at `subgraph/subgraph.yaml:40-63`, referenced in `subgraph/src/constants.ts:8`
- **Meme Hook address**: `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044`
  — `subgraph/src/constants.ts:5`; hook-filter guard at `subgraph/src/poolManager.ts:10`
- **Initialize / Swap / ModifyLiquidity handlers**: `subgraph/src/poolManager.ts:9`,
  `subgraph/src/poolManager.ts:36`, `subgraph/src/poolManager.ts:50`
  (event bindings: `subgraph/subgraph.yaml:56-61`)
- **Pairing-asset / pool-token derivation logic**: `subgraph/src/poolManager.ts:18-27`
  (the launched token is the pool side that is *not* a known pairing asset);
  `isPairingAsset` defined at `subgraph/src/constants.ts:46-51`

## Architecture

```
                    -> Telegram bot (@FinchRH_bot)
                    -> MCP server (finch_wallet_provenance, finch_pons_activity, finch_health)
Two subgraphs   ---|
(see below)         -> HTTP API (/query, /health, /calls, /SKILL.md)
                    -> Bazantic x402/MPP Gateway (metered, wraps /query)
```

Finch is a **peer, not a gatekeeper**: the Telegram bot, MCP server, direct HTTP
calls, and the Bazantic gateway are independent consumers of the identical
backend. No consumer is privileged over another.

### Two subgraphs, split by freshness need

- **`finch-live`** — narrow recent window, `fresh: true`, near-zero lag. Serves
  time-sensitive queries: recent launches, just-landed payouts,
  graduation-just-now.
- **`finch-rpc` (history)** — deep index from Robinhood Chain's mainnet launch
  block, serves provenance/recurring-pattern/candidate-token queries.
  Backward-looking by nature, so lag (currently ~2.35M blocks / ~2 days, closing
  on its own) doesn't degrade the answers it serves.

`/health` reports both freshness states honestly and separately — an agent
calling Finch is never guessing which half of an answer is current versus
historical.

### Why Goldsky/Pinax, not Subgraph Studio directly

Robinhood Chain (`eip155:4663`) is not yet in Subgraph Studio's supported
networks — confirmed directly against The Graph's own networks registry (empty
`subgraphs` list for this chain). This is not unusual: Solana went through the
identical pattern (Substreams support well ahead of native Subgraph Studio
integration). Finch's subgraphs run on Goldsky (Graph-protocol-compatible,
standard GraphQL schema/query language) as the pragmatic path given this
constraint. Migrating to native Subgraph Studio support, whenever The Graph adds
this chain, is a one-line config change (swap the `network:` field) — the mapping
code was deliberately kept provider-agnostic throughout.

### Substreams (Track B) — built, partially blocked, documented honestly

A parameterized Rust Substreams module (`/substreams`) is built, compiles clean,
and is verified against live Pinax data for the canonical demo transaction. All
filter addresses (factory, hook, fee escrow, distributor, token watch list) are
module parameters, not hardcoded constants — built this way specifically to be
reusable/composable, not a one-off connection.

**What's blocked**: the final sink step (`graph_out` → a queryable Subgraph)
requires either self-hosted `graph-node` or Pinax-hosted serving — Goldsky does
not support sinking Substreams-powered subgraphs. This piece is incomplete. The
plain RPC-based subgraphs (`finch-live` / history) carry the live product; the
Substreams module stands as verified, reusable infrastructure not yet wired to a
public query endpoint.

### Live data, not mocked

Both subgraphs consume real Robinhood Chain state via Goldsky, sourced from the
chain's public RPC (`rpc.mainnet.chain.robinhood.com`). No synthetic or static
datasets are used anywhere in this project.

## Canonical example

Wallet `0x2a58fb44f78d7b600aec945ba8cb253896793ed3` — a public, non-personal
address — received NVDA as 1 of 105 recipients in a single Multicall3 batch
transaction
(`0xaa0ff1fb2008f24742ab131e86505c2565a721db499227b2b1a7617797cc3848`), paid out
by a per-token Pons fee distributor (`0xe25e9bc31d24bb652fb6e2e466d7c9c89701173e`).
Reading that contract on-chain: `token()` = microduck, `quoteToken()` = NVDA,
`escrow()` = Pons's `FeeEscrow` (`0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e`). The
wallet holds ~150,564 microduck and is not on the distributor's exclude list — so
this is its share of microduck's accrued Pons trading fees, paid in NVDA. It has
received NVDA from this distributor more than once — a recurring entitlement, not
a one-off. (microduck's pool is a graduated Uniswap V4 Meme-Hook pool; Finch does
not trace which individual swaps funded this specific payout.)

## Limitations — stated honestly, not hidden

- **Candidate-token correlation is not causation.** Finch surfaces tokens a
  wallet has traded that happen to have pools paired against a given stock token.
  Statistical testing (base-rate comparison against ~50 tokens in a wallet's
  typical history and a ~3.6% NVDA-pairing rate across all Pons pools) shows this
  level of overlap occurs by chance alone in similar magnitude to what's observed
  for tested wallets. Finch reports these as "could be," never "because of."
- **The candidate-list feature works live only for indexed wallets with cached
  full-history scans** (the canonical demo wallet). For an arbitrary wallet,
  Finch currently only sees transfers among its explicit 14-token watch list
  (`subgraph/src/constants.ts:16-30`), not arbitrary Pons-launched tokens — full
  generalization requires either a dynamic per-launch data-source template or the
  Substreams-powered full-token-scan path (see Track B above).
- **Why a specific wallet is on Pons's payout list cannot be determined from
  swap, LP, or launch activity** in the indexed data — it is most likely a
  designated fee-recipient/treasury address maintained directly by Pons, not
  something derivable from on-chain behavior signals alone.

## Setup / run

Requires Node 22.x. Copy `.env.example` to `.env` and fill in:

- `RPC_URL` — `https://rpc.mainnet.chain.robinhood.com` (default is fine)
- `SUBGRAPH_QUERY_URL` — deployed history subgraph GraphQL endpoint
- `SUBGRAPH_LIVE_URL` — deployed fresh-window subgraph GraphQL endpoint
- `OPENROUTER_API_KEY` — optional; only used to rephrase non-canonical prose answers
- `TELEGRAM_BOT_TOKEN` — from @BotFather; only needed to run the Telegram bot
- `FINCH_HTTP_PORT` — HTTP API port (default `8787`)

**Subgraph** (from `subgraph/`, and identically from `subgraph-live/` with its
own start block):

```bash
npm install
npm run codegen
npm run build
npx goldsky subgraph deploy finch-rpc/0.4.0 --path .     # history
# in subgraph-live/:  npx goldsky subgraph deploy finch-live/0.1.0 --path .
```

**Bot + API** (from `bot/`):

```bash
npm install
npm start          # Telegram bot (long-polling)
npm run serve      # HTTP API on FINCH_HTTP_PORT
npm run mcp        # MCP stdio server
npm run testagent  # consuming-agent smoke test against a running API
```

The Telegram bot and HTTP API are independent processes over the same
`answer()` / `answerJson()` backend.

**Single-box deploy**: `deploy/` contains systemd units + a Caddy config +
`setup.sh` (see `bot/DOC_deploy.md`). **Bazantic gateway**: see
`bazantic/DOC_recipe.md`.

## Repo structure

```
/subgraph       - The Graph subgraph — deep history index (Goldsky, finch-rpc)
                    schema.graphql, subgraph.yaml, src/ (AssemblyScript mappings)
/subgraph-live  - same mappings, later start block — fresh recent window (finch-live)
/substreams     - Track B: parameterized Rust Substreams module (Pinax source), sink open
/bot            - Telegram bot (@FinchRH_bot) + NLI backend + HTTP API + MCP server
                    src/answer.ts    - answer() prose / answerJson() structured
                    src/extract.ts   - regex-first NL intent/value extraction
                    src/query.ts     - two-subgraph routing (live-first, history fallback)
                    src/format.ts    - canonical prose answers
                    src/serialize.ts - locked JSON response shape
                    src/http.ts      - HTTP API (/query /health /calls /SKILL.md /spec)
                    src/mcp.ts       - MCP stdio server
                    src/calllog.ts   - per-caller agent-call log + visibility toggles
                    src/freshness.ts - subgraph-head vs chain-head staleness gate
/bazantic       - openapi.json (gateway spec) + DOC_recipe.md
/deploy         - systemd units, Caddyfile, setup.sh, env template
SKILL.md        - machine-readable agent manifest, also served at /SKILL.md
```

## License

MIT
