# Recipe: ENS enrichment (chained MCP)

**One agent, two sponsor MCP servers, output feeds input.**

```
Finch  ──(hex addresses)──▶  The Graph subgraph MCP  ──▶  ENS mainnet subgraph  ──▶  names
```

An agent asks Finch "why did I get NVDA", gets back a set of addresses (the
wallet, the holder-fee distributor, the Pons FeeEscrow), then uses The Graph's
subgraph MCP to find and query the ENS subgraph and resolve those addresses to
`.eth` names. Finch's output is literally the ENS query's input.

## Why it fits the tracks

- **Bazantic / recipes** — genuine chained MCP: step 2's input is step 1's
  output, not a thematic pairing.
- **The Graph** — uses the subgraph MCP (`search_subgraphs_by_keyword`) and the
  **ENS subgraph**, a canonical composable/standardized subgraph on The Graph
  Network. (The ENS subgraph is on the network, so the MCP can reach it —
  unlike Finch's own Goldsky-hosted subgraph.)

## Run it

```
cd recipes
npm install
FINCH_BASE=https://<your-finch-host> GRAPH_QUERY_KEY=<graph gateway key> \
  node ens-enrich.mjs <0x-wallet> [SYMBOL]
```

`GRAPH_QUERY_KEY` and `FINCH_BASE` are read from `../.env` if not passed. Point
`FINCH_BASE` at the Finch HTTP API, or at a Bazantic gateway URL to run the
Finch call through x402.

### Demo wallets — real, end-to-end (no seeding)

Wallets that received NVDA on Robinhood Chain *and* have a mainnet ENS name —
so the query wallet resolves for real:

```
node ens-enrich.mjs 0x36de68e810781dd7699d8fc7fe7def8aae51cec2 NVDA   # -> daio.eth
node ens-enrich.mjs 0xd31081829132c25ca4e8625b5b264c4948bc4248 NVDA   # -> nightspark.eth
node ens-enrich.mjs 0x60d19f2c7c5302dc5cad462524f49ab2545d2cfe NVDA   # -> guti.eth
```

Found by cross-referencing Finch's NVDA recipient list against the ENS subgraph
(8 of 226 recipients had a forward record). `0x711281c1b26aaed86e40e4caaf76c1962b45e161`
has 9 names pointing at it if you want a busier line.

`RESOLVE_EXTRA=0x…,0x…` seeds extra addresses into the ENS lookup if you need a
resolved line without a naturally-named wallet.

## Output

```
[1] Finch  https://…/query
    0.0105 NVDA from 0xe25e9b…173e — 22 recipients, 3x in range
    path: epoch batch → this wallet + 22 others
    3 addresses to resolve

[2] The Graph subgraph MCP  https://subgraphs.mcp.thegraph.com/sse
    search "ens" -> 14 ENS-related deployments on The Graph Network
    querying the canonical ENS subgraph  5XqPmWe6…

[3] enriched provenance
  0x36de68e8…  (your wallet)         ->  daio.eth
  0xe25e9bc3…  (payer / distributor) ->  no ENS name
  0xd3afeb2a…  (in the route)        ->  no ENS name

  daio.eth received 0.0105 NVDA, routed through 0xe25e9b…173e.
```

## Implementation notes

- **Discovery** goes through the subgraph MCP (`search_subgraphs_by_keyword`),
  connected over SSE with the gateway key.
- **Query execution** goes to the Graph gateway directly
  (`gateway.thegraph.com/api/<key>/subgraphs/id/<ENS_ID>`). The subgraph MCP's
  `execute_query_*` tools currently reject gateway query keys server-side
  ("malformed API key") even though the same key works against the gateway — so
  the recipe discovers via the MCP and executes against the same network
  subgraph via the gateway. Swap back to `execute_query_by_subgraph_id` once
  that's fixed upstream.
- **ENS resolution** is forward-record: `domains(where: { resolvedAddress_in:
  [...] })` — names that *point at* the address. The canonical primary
  (reverse) name would be an `eth_call` to the mainnet Universal Resolver;
  forward records are enough to demo the join.
- **Hit rate** on Robinhood-Chain addresses is ~0 (ENS is mainnet; RH-chain
  contracts have no `.eth`). The payoff is the query wallet when it carries a
  mainnet primary name. `RESOLVE_EXTRA` seeds a known-named address for the
  demo.

## `.mcp.json`

`recipes/.mcp.json` registers both servers for an MCP-capable agent (Claude
Code / Desktop / Cursor) so the chaining can also be driven conversationally,
not just by the script.
