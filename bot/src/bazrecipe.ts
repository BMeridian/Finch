// Run the published Bazantic Recipe `finch-graph-ens` and return its text output.
//
// A Recipe is a Bazantic-hosted LLM workflow exposed as one MCP tool. It chains
// two of Finch's own paid gateway tools — finchQuery (Substreams provenance) ->
// ensResolve (The Graph's ENS subgraph) — and composes the answer. Bazantic runs
// the model and settles the underlying tool calls; the caller just invokes it.
//
//   api.bazantic.com/mcp `initialize` -> _meta gateway_mcp_url (the paid path)
//   {gateway_mcp_url} `tools/call` finch-graph-ens { Wallet, Symbol }

const CATALOG_MCP = "https://api.bazantic.com/mcp"
const RECIPE_HANDLE = "finch-graph-ens"

const rpc = async (url: string, body: unknown, ms = 120_000, tries = 3): Promise<any> => {
  let last: unknown
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(ms),
      })
      const raw = await r.text()
      // Streamable-HTTP MCP may frame the JSON as an SSE `data:` line.
      const line = raw.includes("data:") ? raw.split("\n").find(l => l.startsWith("data:"))?.slice(5) ?? raw : raw
      return JSON.parse(line.trim())
    } catch (e) {
      last = e   // recipe runs are read-only — the gateway's upstream timeout is transient
      await new Promise(r => setTimeout(r, 2000))
    }
  }
  throw last
}

export interface BazRecipeResult { output: string; gateway: string }

export async function runFinchGraphEns(wallet: string, symbol?: string): Promise<BazRecipeResult> {
  const init = await rpc(CATALOG_MCP, {
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "finch-bot", version: "0.1.0" } },
  }, 20_000)
  const gw = init?.result?._meta?.["com.bazantic/recipe"]?.gateway_mcp_url
  if (!gw) throw new Error("no recipe gateway from Bazantic")

  const call = await rpc(gw, {
    jsonrpc: "2.0", id: 2, method: "tools/call",
    params: { name: RECIPE_HANDLE, arguments: { Wallet: wallet, ...(symbol ? { Symbol: symbol } : {}) } },
  })
  if (call?.error) throw new Error(call.error.message || "recipe error")
  const sc = call?.result?.structuredContent?.output
  let out: string
  if (typeof sc === "string") out = sc
  else {
    const txt = call?.result?.content?.[0]?.text
    try { out = JSON.parse(txt).output ?? txt } catch { out = String(txt ?? "(no output)") }
  }
  return { output: tidy(out), gateway: gw }
}

// The recipe LLM adds chatter despite the prompt — a "Perfect! …" preamble, a
// trailing confidence paragraph, `---` rules. Strip all of it.
function tidy(s: string): string {
  let t = s
  const cut = t.search(/\n[ \t]*[*_#>-]*[ \t]*(important[ :_*]*note|note[ :]|confidence|disclaimer|caveat|signal only|not a recommendation)/i)
  if (cut > 0) t = t.slice(0, cut)
  t = t
    .replace(/^\s*(perfect|great|got it|here('?s| are| is)|now i (have|can)|the (results?|answer)|summary)\b[^\n]*\n+/im, "")
    .replace(/^[-*_\s]*\n+/, "")           // leading rule / blank
    .replace(/\n[-*_\s]*$/g, "")           // trailing rule
    .trim()
  return t || s.trim()
}
