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

  // tries=1: a single slow recipe run already costs ~30s; the caller
  // (runBazrep) retries the whole recipe once, visibly, rather than this
  // silently repeating the identical slow call 3x before ever reporting back.
  const call = await rpc(gw, {
    jsonrpc: "2.0", id: 2, method: "tools/call",
    params: { name: RECIPE_HANDLE, arguments: { Wallet: wallet, ...(symbol ? { Symbol: symbol } : {}) } },
  }, 35_000, 1)
  if (call?.error) throw new Error(call.error.message || "recipe error")
  const sc = call?.result?.structuredContent?.output
  let out: string
  if (typeof sc === "string") out = sc
  else {
    const txt = call?.result?.content?.[0]?.text
    try { out = JSON.parse(txt).output ?? txt } catch { out = String(txt ?? "(no output)") }
  }
  return { output: reshape(out), gateway: gw }
}

const shortAddr = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a) ? `${a.slice(0, 6)}…${a.slice(-4)}` : a
// Shorten every full 0x address appearing anywhere in a string, in place.
const shortenAddrs = (s: string) => s.replace(/0x[0-9a-fA-F]{40}/g, shortAddr)

// The recipe LLM doesn't reliably follow the prompt's output format — seen: a
// "Perfect! …" preamble, a trailing confidence paragraph, full JSON dumps with
// unshortened addresses instead of the plain-text lines asked for. Rather than
// chase prompt wording every time it drifts, parse defensively: if the model
// handed back its own ad-hoc JSON shape, rebuild the canonical short form from
// it; otherwise fall back to text-cleaning + shortening any raw addresses left
// in prose output.
interface RecipeJson {
  line_1?: string
  route_addresses?: { address: string; ens?: string | string[] }[]
  other_ens_names?: { name: string; address: string }[]
}

function fromJsonShape(s: string): string | null {
  const m = s.match(/\{[\s\S]*\}/)
  if (!m) return null
  let j: RecipeJson
  try { j = JSON.parse(m[0]) } catch { return null }
  if (!j.line_1 && !j.route_addresses) return null

  const lines: string[] = []
  if (j.line_1) lines.push(shortenAddrs(j.line_1))
  for (const r of j.route_addresses ?? []) {
    const ens = Array.isArray(r.ens) ? r.ens.join(", ") : (r.ens || "no ENS name")
    lines.push(`${shortAddr(r.address)}: ${ens}`)
  }
  const others = j.other_ens_names ?? []
  if (others.length) {
    const byAddr = new Map<string, string[]>()
    for (const o of others) (byAddr.get(o.address) ?? byAddr.set(o.address, []).get(o.address)!).push(o.name)
    lines.push("")
    lines.push("ENS names found in the batch:")
    lines.push([...byAddr].map(([a, names]) => `${names.join(", ")} → ${shortAddr(a)}`).join(", "))
  }
  return lines.join("\n")
}

function reshape(s: string): string {
  const fromJson = fromJsonShape(s)
  if (fromJson) return fromJson

  let t = s
  const cut = t.search(/\n[ \t]*[*_#>-]*[ \t]*(important[ :_*]*note|note[ :]|confidence|disclaimer|caveat|signal only|not a recommendation)/i)
  if (cut > 0) t = t.slice(0, cut)
  t = t
    .replace(/^\s*(perfect|great|got it|here('?s| are| is)|now i('| a)?ll?\b|now i (have|can|will)|the (results?|answer)|summary)\b[^\n]*\n+/im, "")
    .replace(/^[-*_\s]*\n+/, "")           // leading rule / blank
    .replace(/\n[-*_\s]*$/g, "")           // trailing rule
    .trim()
  t = shortenAddrs(t)
  return t || shortenAddrs(s.trim())
}
