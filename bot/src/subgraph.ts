// Two subgraphs:
//   HISTORY (SUBGRAPH_QUERY_URL)  — deep index from block 53.48M. Provenance,
//     recurring counts, candidate overlap. Expected to lag the chain tip.
//   LIVE (SUBGRAPH_LIVE_URL)      — short recent window, kept fresh. Recent
//     launches, graduation-just-now, a payout that just landed.
// Same schema + mappings; they differ only in startBlock.

const HISTORY = process.env.SUBGRAPH_QUERY_URL
const LIVE = process.env.SUBGRAPH_LIVE_URL || HISTORY
if (!HISTORY) { console.error("SUBGRAPH_QUERY_URL missing (expected in ../.env)"); process.exit(1) }

export type Which = "history" | "live"
const urlFor = (w: Which) => (w === "live" ? LIVE! : HISTORY!)

async function run<T>(w: Which, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(urlFor(w), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`subgraph(${w}) HTTP ${res.status}`)
  const body = await res.json() as { data?: T; errors?: { message: string }[] }
  if (body.errors?.length) throw new Error(`subgraph(${w}) GraphQL: ${body.errors.map(e => e.message).join("; ")}`)
  if (!body.data) throw new Error(`subgraph(${w}) returned no data`)
  return body.data
}

// Default binding = history (provenance is the common case).
export const gql = <T = any>(q: string, v: Record<string, unknown> = {}) => run<T>("history", q, v)
export const gqlLive = <T = any>(q: string, v: Record<string, unknown> = {}) => run<T>("live", q, v)
export const gqlOn = <T = any>(w: Which, q: string, v: Record<string, unknown> = {}) => run<T>(w, q, v)

export async function headBlock(w: Which = "history"): Promise<number> {
  const d = await run<{ _meta: { block: { number: number } } }>(w, `{ _meta { block { number } } }`, {})
  return d._meta.block.number
}
