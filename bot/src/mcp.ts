import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

// MCP server exposing Finch as a native tool for any MCP client (Claude Code,
// Claude Desktop, Cursor, …). It calls Finch's HTTP API (not the backend
// directly) with an x-agent-id header, so every invocation shows up in
// GET /calls — that is the proof "an agent actually called Finch".

const BASE = process.env.FINCH_HTTP_BASE || `http://localhost:${process.env.FINCH_HTTP_PORT || 8787}`

async function finchQuery(wallet: string | undefined, question: string, format: "json" | "prose") {
  const res = await fetch(`${BASE}/query`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-agent-id": "mcp" },
    body: JSON.stringify({ wallet, q: question, format }),
  })
  if (!res.ok) throw new Error(`Finch HTTP ${res.status}: ${await res.text()}`)
  return res.json()
}

const server = new McpServer({ name: "finch", version: "0.1.0" })

server.tool(
  "finch_wallet_provenance",
  "Ask Finch where a Robinhood Chain (EVM 4663) wallet's tokens came from — fee " +
  "settlement, batched payout, recurring entitlement — plus correlational candidate " +
  "tokens. Backed by a Substreams pipeline (Pinax → Postgres: Pons launch factory + Uniswap V4 " +
  "PoolManager + token transfers). Read-only data; every response carries confidence: " +
  "'signal only - not a recommendation'. Finch supplies data, you decide.",
  {
    wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe("wallet address to look up"),
    question: z.string().optional().describe("natural-language question; defaults to 'why did I get NVDA'"),
    format: z.enum(["json", "prose"]).default("json"),
  },
  async ({ wallet, question, format }) => {
    const out = await finchQuery(wallet, question || "why did I get NVDA", format)
    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] }
  },
)

server.tool(
  "finch_pons_activity",
  "Ask Finch about Pons launchpad activity on Robinhood Chain — recent token " +
  "launches, or whether a specific token graduated to a Uniswap V4 pool.",
  {
    question: z.string().describe('e.g. "what launched on Pons recently" or "has 0x… graduated"'),
  },
  async ({ question }) => {
    const out = await finchQuery(undefined, question, "prose")
    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] }
  },
)

server.tool(
  "finch_health",
  "Check Finch's subgraph freshness — indexed block vs chain head.",
  {},
  async () => {
    const res = await fetch(`${BASE}/health`, { headers: { "x-agent-id": "mcp" } })
    return { content: [{ type: "text", text: await res.text() }] }
  },
)

await server.connect(new StdioServerTransport())
console.error(`finch MCP server ready (upstream ${BASE})`)
