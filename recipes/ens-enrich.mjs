// ens-enrich.mjs — chained-MCP recipe.
//
//   Finch (provenance)  ->  The Graph subgraph MCP  ->  ENS mainnet subgraph
//
// A Bazantic agent asks Finch "why did I get NVDA", gets back a set of hex
// addresses (wallet, distributor, FeeEscrow), then uses The Graph's subgraph
// MCP server to query the ENS subgraph and resolve those addresses to names.
// Finch's output is the ENS query's input — a real data-flow chain.
//
//   node ens-enrich.mjs <wallet> [SYMBOL]
//
// Env (read from ../.env if present):
//   FINCH_BASE        default https://your-finch-host.example  (or a Bazantic gateway URL)
//   GRAPH_QUERY_KEY   Graph gateway API key (required for the subgraph MCP)

import { readFileSync } from "node:fs"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"

// ---- config ---------------------------------------------------------------
const env = (() => {
  try {
    return Object.fromEntries(
      readFileSync(new URL("../.env", import.meta.url), "utf8")
        .split("\n").filter(l => l.includes("=") && !l.trimStart().startsWith("#"))
        .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
  } catch { return {} }
})()

const FINCH_BASE = process.env.FINCH_BASE || env.FINCH_BASE || "https://your-finch-host.example"
const GRAPH_KEY  = process.env.GRAPH_QUERY_KEY || env.GRAPH_QUERY_KEY
const GRAPH_MCP  = "https://subgraphs.mcp.thegraph.com/sse"

const wallet = (process.argv[2] || "").toLowerCase()
const symbol = process.argv[3] || "NVDA"
if (!/^0x[0-9a-f]{40}$/.test(wallet)) {
  console.error("usage: node ens-enrich.mjs <0x-wallet> [SYMBOL]")
  process.exit(1)
}
if (!GRAPH_KEY) { console.error("GRAPH_QUERY_KEY missing (env or ../.env)"); process.exit(1) }

const short = a => `${a.slice(0, 8)}…${a.slice(-4)}`

// ---- 1. Finch: provenance ------------------------------------------------
console.log(`\x1b[1m[1] Finch\x1b[0m  ${FINCH_BASE}/query`)
const finch = await fetch(
  `${FINCH_BASE}/query?wallet=${wallet}&q=${encodeURIComponent(`why did I get ${symbol}`)}`,
).then(r => r.json())

if (finch.error || !finch.event) {
  console.log(`    ${finch.note || finch.error || "no event"}`)
  process.exit(0)
}

// addresses to resolve: the wallet, the payer, everything hex in the route
const addrs = new Set([wallet, finch.event.paid_by_contract?.toLowerCase()])
for (const line of finch.path?.route ?? []) {
  for (const m of line.matchAll(/0x[0-9a-fA-F]{40}/g)) addrs.add(m[0].toLowerCase())
}
addrs.delete(undefined)
// RESOLVE_EXTRA=0x…,0x… — seed extra addresses into the ENS lookup (demo: an
// address with a known mainnet name, to show a resolved line alongside the
// unresolved Robinhood-Chain ones).
for (const a of (process.env.RESOLVE_EXTRA || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean)) addrs.add(a)
const list = [...addrs]

console.log(`    ${finch.event.amount} ${finch.event.token_received} from ${short(finch.event.paid_by_contract)}` +
  ` — ${finch.event.recipients_in_tx} recipients, ${finch.recurring?.count ?? "?"}x in range`)
console.log(`    ${finch.path ? `path: ${finch.path.route.at(-1)}` : "path not confirmed"}`)
console.log(`    ${list.length} addresses to resolve`)

// ---- 2. The Graph subgraph MCP: discover the ENS subgraph -------------
console.log(`\n\x1b[1m[2] The Graph subgraph MCP\x1b[0m  ${GRAPH_MCP}`)
const ENS_SUBGRAPH_ID = "5XqPmWe6gjyrJtFn9cLy237i4cWw2j9HcUJEXsP5qGtH"  // ENS, mainnet
const txt = res => (res.content ?? []).map(c => c.text ?? "").join("\n")
try {
  const mcp = new Client({ name: "finch-ens-recipe", version: "0.1.0" })
  await mcp.connect(new SSEClientTransport(new URL(GRAPH_MCP), {
    requestInit: { headers: { Authorization: `Bearer ${GRAPH_KEY}` } },
    eventSourceInit: { fetch: (u, init) => fetch(u, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${GRAPH_KEY}` } }) },
  }))
  const search = await mcp.callTool({ name: "search_subgraphs_by_keyword", arguments: { keyword: "ens" } })
  const hits = [...txt(search).matchAll(/\bQm[1-9A-HJ-NP-Za-km-z]{44}\b/g)].map(m => m[0])
  console.log(`    search "ens" -> ${hits.length} ENS-related deployments on The Graph Network`)
  await mcp.close()
} catch (e) { console.log(`    search skipped (${e.message})`) }
console.log(`    querying the canonical ENS subgraph  ${ENS_SUBGRAPH_ID}`)

// ---- 2b. query the ENS subgraph (The Graph Network gateway) ----------
// The subgraph MCP's execute_* rejects gateway keys server-side; the query
// goes to the same network subgraph via the gateway, same key.
const query = `{
  domains(first: 200, where: { resolvedAddress_in: ${JSON.stringify(list)} }) {
    name
    resolvedAddress { id }
  }
}`
const body = await fetch(
  `https://gateway.thegraph.com/api/${GRAPH_KEY}/subgraphs/id/${ENS_SUBGRAPH_ID}`,
  { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) },
).then(r => r.json())

const names = {}
for (const d of body?.data?.domains ?? []) {
  const a = d.resolvedAddress?.id?.toLowerCase()
  if (a) (names[a] ??= []).push(d.name)
}
if (body.errors) console.log("    ENS subgraph errors:", JSON.stringify(body.errors).slice(0, 300))

// ---- 3. merge ----------------------------------------------------------
console.log(`\n\x1b[1m[3] enriched provenance\x1b[0m`)
const label = a =>
  a === wallet ? "your wallet"
  : a === finch.event.paid_by_contract?.toLowerCase() ? "payer / distributor"
  : "in the route"
for (const a of list) {
  const ens = names[a]?.length ? `\x1b[32m${names[a].slice(0, 3).join(", ")}${names[a].length > 3 ? ` +${names[a].length - 3}` : ""}\x1b[0m` : "\x1b[2mno ENS name\x1b[0m"
  console.log(`  ${a}  (${label(a)})  ->  ${ens}`)
}

const w = names[wallet]?.[0]
console.log(`\n  ${w ? `${w} ` : ""}received ${finch.event.amount} ${finch.event.token_received}` +
  `, routed through ${short(finch.event.paid_by_contract)}` +
  `${names[finch.event.paid_by_contract?.toLowerCase()]?.[0] ? ` (${names[finch.event.paid_by_contract.toLowerCase()][0]})` : ""}.`)
