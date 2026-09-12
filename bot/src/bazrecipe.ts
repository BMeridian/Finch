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
// unshortened addresses, and a different ad-hoc key name for the same field
// almost every run (output/answer/result/line_1, route_addresses/route_details,
// other_ens_names/other_recipients — the last sometimes an array, sometimes a
// plain "none found" string). Rather than chase the exact key names every time
// they drift, parse defensively by field ROLE: pick the first key present from
// a list of names known to have held that role, for whichever shape shows up.
function pick(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined) return o[k]
  return undefined
}

function fromJsonShape(s: string): string | null {
  const m = s.match(/\{[\s\S]*\}/)
  if (!m) return null
  let j: Record<string, unknown>
  try { j = JSON.parse(m[0]) } catch { return null }
  if (typeof j !== "object" || j === null) return null

  const intro = pick(j, ["line_1", "result", "output", "answer", "summary"])
  const routeArr = pick(j, ["route_addresses", "route_details", "addresses"])

  // No structured route array — the whole prose answer is nested one level
  // under a single key, sometimes with a stray ```json fence around it.
  if (!Array.isArray(routeArr)) return typeof intro === "string" ? shortenAddrs(intro) : null

  const lines: string[] = []
  if (typeof intro === "string") lines.push(shortenAddrs(intro))
  for (const r of routeArr) {
    if (typeof r !== "object" || r === null) continue
    const addr = pick(r as Record<string, unknown>, ["address", "addr"])
    const ens = pick(r as Record<string, unknown>, ["ens", "name", "names"])
    if (typeof addr !== "string") continue
    const ensStr = Array.isArray(ens) ? ens.join(", ") : (ens || "no ENS name")
    lines.push(`${shortAddr(addr)}: ${ensStr}`)
  }

  const others = pick(j, ["other_ens_names", "other_recipients", "other_names"])
  if (Array.isArray(others) && others.length) {
    const byAddr = new Map<string, string[]>()
    for (const o of others) {
      if (typeof o !== "object" || o === null) continue
      const addr = pick(o as Record<string, unknown>, ["address", "addr"])
      const name = pick(o as Record<string, unknown>, ["name", "names"])
      if (typeof addr === "string" && typeof name === "string") (byAddr.get(addr) ?? byAddr.set(addr, []).get(addr)!).push(name)
    }
    if (byAddr.size) {
      lines.push("")
      lines.push("ENS names found in the batch:")
      lines.push([...byAddr].map(([a, names]) => `${names.join(", ")} → ${shortAddr(a)}`).join(", "))
    }
  }
  // `others` as a plain string ("None found with ENS names") carries nothing
  // to render — the per-address "no ENS name" lines above already say that.
  return lines.length ? lines.join("\n") : null
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
