import { headBlock } from "./subgraph.js"

// /health reports the LIVE subgraph's freshness — that is what tells a caller
// "Finch is caught up to the chain". The history subgraph's block is reported
// too (secondary), but it is EXPECTED to lag and does not gate `fresh`.
const RPC = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com"
const BLOCK_MS = 100

export interface Freshness {
  subgraph_block: number      // LIVE
  chain_block: number
  lag_blocks: number
  lag_seconds: number
  fresh: boolean              // LIVE within ~2 min of chain head
  history_block: number       // deep index — expected to lag, informational
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
  const [live, history, chain] = await Promise.all([
    headBlock("live"),
    headBlock("history").catch(() => 0),
    chainHead(),
  ])
  const lag = Math.max(0, chain - live)
  return {
    subgraph_block: live,
    chain_block: chain,
    lag_blocks: lag,
    lag_seconds: Math.round((lag * BLOCK_MS) / 1000),
    fresh: (lag * BLOCK_MS) / 1000 <= 120,
    history_block: history,
    history_lag_blocks: Math.max(0, chain - history),
  }
}
