import { createServer } from "node:http"
import { readFileSync } from "node:fs"
import { answerJson, answer } from "./answer.js"
import { logCall, recentCalls, callStats, setSeeMode, seeMode } from "./calllog.js"
import { freshness } from "./freshness.js"

// Finch's HTTP API — the thing the Bazantic x402/MPP Gateway wraps. Any agent
// calls this directly too (Finch is a peer, not a gatekeeper). Every request is
// logged so Finch can SEE who called it.

const PORT = Number(process.env.FINCH_HTTP_PORT || 8787)
const SKILL = process.env.FINCH_SKILL_PATH || new URL("../../SKILL.md", import.meta.url).pathname
const SPEC = process.env.FINCH_SPEC_PATH || new URL("../../bazantic/openapi.json", import.meta.url).pathname

function callerOf(req: any): string {
  const h = req.headers
  // A direct caller can name itself with any of these.
  const named = h["x-payer"] || h["x-caller"] || h["x-agent-id"]
  if (named) return String(named)
  // A call routed through the Bazantic gateway arrives from its Fly infra and
  // carries a per-request trace id. Bazantic does not forward the paying agent's
  // identity to the upstream (by design) — so the honest label is "via Bazantic"
  // plus that request id, which is distinct per call and traceable in Bazantic's
  // own provider analytics.
  const via = String(h["via"] || "")
  const flyId = h["fly-request-id"]
  if (flyId && /fly\.io/i.test(via)) return `bazantic:${String(flyId).split("-")[0]}`
  return String(h["cf-connecting-ip"] || req.socket?.remoteAddress || "anonymous")
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`)
  const send = (code: number, body: unknown, type = "application/json") => {
    res.writeHead(code, { "content-type": type, "access-control-allow-origin": "*" })
    res.end(typeof body === "string" ? body : JSON.stringify(body, null, 2))
  }

  if (req.method === "OPTIONS") return send(204, "")

  if (url.pathname === "/seeAgent" || url.pathname === "/seeAgentFull") { setSeeMode("full"); return send(200, { call_logging: seeMode() }) }
  if (url.pathname === "/seeAgentMin")  { setSeeMode("min");  return send(200, { call_logging: seeMode() }) }
  if (url.pathname === "/agentOff")     { setSeeMode("off");  return send(200, { call_logging: seeMode() }) }

  if (url.pathname === "/health") return send(200, await freshness().catch(e => ({ error: String(e) })))
  if (url.pathname === "/SKILL.md" || url.pathname === "/skill") {
    try { return send(200, readFileSync(SKILL, "utf8"), "text/markdown") } catch { return send(404, { error: "SKILL.md not found" }) }
  }
  if (url.pathname === "/spec" || url.pathname === "/openapi.json") {
    try {
      const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() || url.protocol.replace(":", "")
      const spec = readFileSync(SPEC, "utf8").replace("https://REPLACE_WITH_DEPLOYED_URL", `${proto}://${req.headers.host}`)
      return send(200, spec, "application/json")
    } catch { return send(404, { error: "openapi.json not found" }) }
  }
  if (url.pathname === "/calls") return send(200, { call_logging: seeMode(), stats: callStats(), recent: recentCalls(Number(url.searchParams.get("limit") || 50)) })

  if (url.pathname === "/query") {
    let question = url.searchParams.get("q") || ""
    let wallet = url.searchParams.get("wallet") || undefined
    let fmt = (url.searchParams.get("format") || "json").toLowerCase()
    if (req.method === "POST") {
      const raw = await new Promise<string>(ok => { let b = ""; req.on("data", c => b += c); req.on("end", () => ok(b)) })
      try { const j = JSON.parse(raw || "{}"); question = j.q ?? j.question ?? question; wallet = j.wallet ?? wallet; fmt = (j.format ?? fmt).toLowerCase() } catch { /* keep query params */ }
    }
    // A bare wallet with no question = "why did I get NVDA" for that wallet.
    if (!question && wallet) question = "why did I get NVDA"

    const caller = callerOf(req)
    const t0 = Date.now()
    try {
      const result = fmt === "prose"
        ? { answer: await answer(question, wallet) }
        : await answerJson(question, wallet)
      const answerText = typeof (result as { answer?: unknown }).answer === "string"
        ? (result as { answer: string }).answer
        : JSON.stringify(result)
      logCall({ ts: new Date().toISOString(), caller, ua: String(req.headers["user-agent"] || ""), route: "/query",
                format: fmt === "prose" ? "prose" : "json", wallet: wallet ?? null, question, answer: answerText, took_ms: Date.now() - t0, ok: true })
      return send(200, result)
    } catch (e) {
      logCall({ ts: new Date().toISOString(), caller, ua: String(req.headers["user-agent"] || ""), route: "/query",
                format: fmt === "prose" ? "prose" : "json", wallet: wallet ?? null, question, took_ms: Date.now() - t0, ok: false })
      return send(502, { error: String(e), confidence: "signal only - not a recommendation" })
    }
  }

  send(404, { error: "not found", routes: ["/query", "/health", "/calls", "/SKILL.md", "/spec", "/seeAgent", "/seeAgentFull", "/agentOff"] })
})

server.listen(PORT, () => console.log(`Finch HTTP API on :${PORT}  (/query /health /calls /SKILL.md)`))
