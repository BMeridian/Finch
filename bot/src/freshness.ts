import { headBlock } from "./db.js"

// /health reports how far the Substreams sink has indexed vs the chain head —
// that is what tells a caller "Finch is caught up to the chain".
const RPC = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com"
const BLOCK_MS = 100

export interface Freshness {
  subgraph_block: number      // sink head
  chain_block: number
  lag_blocks: number
  lag_seconds: number
  fresh: boolean              // sink keeping pace with chain head (<= ~10 min)
  history_block: number       // kept for API compatibility — same as sink head
  history_lag_blocks: number
}

async function chainHead(): Promise<number> {
  const j = await fetch(RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
  }).then(r => r.json()) as any
  return parseInt(j.result, 16)
}

export async function freshness(): Promise<Freshness> {
  const [sink, chain] = await Promise.all([
    headBlock().catch(() => 0),
    chainHead(),
  ])
  const lag = Math.max(0, chain - sink)
  return {
    subgraph_block: sink,
    chain_block: chain,
    lag_blocks: lag,
    lag_seconds: Math.round((lag * BLOCK_MS) / 1000),
    // Aiven free-tier write throughput leaves a small persistent offset (~a few
    // thousand blocks) even when the sink is tailing live — "fresh" means the
    // sink is keeping pace, not zero lag.
    fresh: (lag * BLOCK_MS) / 1000 <= 600,
    history_block: sink,
    history_lag_blocks: lag,
  }
}
