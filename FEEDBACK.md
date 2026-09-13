Hackathon Feedback — Finch

Submitted for: ETHOnline 2026, Uniswap Foundation track.

What we built

Finch — a wallet-provenance service for Robinhood Chain. It answers "why did I receive this token" by reconstructing the route a stock-token payout actually took: Pons launch → Uniswap V4 pool → creator-fee cut → FeeEscrow → per-token holder-fee distributor → epoch batch payout.

Did you successfully integrate Uniswap?

Yes.

Is this an agentic/AI-powered project?

Finch is not itself an agent, and does not execute on-chain actions. It is a data/provenance service that agents (via MCP, or via the Bazantic gateway) consume as an input to their own decisions. Every response carries confidence: "signal only - not a recommendation" — Finch supplies data, it does not decide or act.

Time to first successful integration

1–4 hours.

Biggest blocker

Uniswap V4's singleton architecture makes pools invisible to standard indexing.

Unlike V2/V3, where each pool is its own contract (so a block explorer or subgraph can watch a known pool address), V4 routes every pool through one shared PoolManager contract. There's no per-pool address to watch — you have to decode the Initialize event to learn a pool's id, then correlate every subsequent Swap event back to that id yourself. Generic indexers and block explorers (Blockscout, Robinscan) have no way to show "which pool" a swap belongs to without doing this decoding ourselves.

On top of that:

Hooks make it worse. V4 pools can attach custom hook contracts that alter pool behavior, and Pons routes its token fees through one specific hook (the "Meme Hook"). It's not enough to decode Initialize events — you have to filter by hook address to find only the pools that matter, out of everything multiplexed through the same PoolManager.
Currency ordering isn't semantic. currency0/currency1 are sorted by address, not "token vs. quote asset" — figuring out which side of a pool is the actual traded token required checking against a known pairing-asset set (WETH/USDG/stock tokens), not something readable directly off the event.
The real payoff was reconstructing intent, not just data. Once pools were decoded, the actual problem was chaining that to why a wallet received a payout: a stock token's creator-fee cut is taken in whatever asset its V4 pool is paired against, flows through a Pons FeeEscrow, into a per-token holder-fee distributor, and out to an epoch batch of wallets — a wallet's own transaction history never mentions any of this. Confirming it required cross-referencing the pool's currency pair against the PonsHolderFeeManager registry on-chain (distributorOf()), not just reading logs.

That combination — no addressable pools, hook-gated relevance, and needing on-chain contract reads (not just event decoding) to confirm the route — is the specific thing Finch solves that a generic indexer or block explorer can't.

How helpful was the documentation (1–5)

4

How would you rate Uniswap's support overall (1–5)

4

Support used

Technical docs, code examples/templates, other.

What support was missing or could be better

Early QA session beyond the Zoom call.

Plan to continue building this project

Yes.

Additional feedback

None.
