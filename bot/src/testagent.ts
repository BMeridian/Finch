// Minimal "consuming agent" — proves the full round trip without an MCP client:
// discover via SKILL.md, call /query, reason over the structured response, and
// confirm it landed in Finch's call log.
//
//   npm run testagent -- 0x2a58fb44f78d7b600aec945ba8cb253896793ed3

export {}

const BASE = process.env.FINCH_HTTP_BASE || `http://localhost:${process.env.FINCH_HTTP_PORT || 8787}`
const wallet = process.argv[2] || "0x2a58fb44f78d7b600aec945ba8cb253896793ed3"
const AGENT = "testagent://finch-demo"

const j = (x: unknown) => console.log(JSON.stringify(x, null, 2))

async function get(path: string) {
  const r = await fetch(`${BASE}${path}`, { headers: { "x-payer": AGENT } })
  return { status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text() }
}

console.log(`\n[1] discover — GET ${BASE}/SKILL.md`)
const skill = await get("/SKILL.md")
console.log(`    ${skill.status} · ${String(skill.body).split("\n")[0]}`)

console.log(`\n[2] query — POST ${BASE}/query  (wallet=${wallet}, format=json)`)
const r = await fetch(`${BASE}/query`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-payer": AGENT },
  body: JSON.stringify({ wallet, format: "json" }),
})
const data = await r.json() as any
j(data)

console.log(`\n[3] reason over the response`)
const checks: [string, boolean][] = [
  ["has event.token_received", !!data?.event?.token_received],
  ["has event.tx (0x hash)", /^0x[0-9a-f]{64}$/i.test(data?.event?.tx ?? "")],
  ["recurring.count >= 1", (data?.recurring?.count ?? 0) >= 1],
  ["candidate_tokens is an array", Array.isArray(data?.candidate_tokens)],
  ["caveat present when candidates non-empty", data.candidate_tokens?.length ? !!data.caveat : true],
  ['confidence == "signal only - not a recommendation"', data?.confidence === "signal only - not a recommendation"],
]
for (const [name, ok] of checks) console.log(`    ${ok ? "PASS" : "FAIL"}  ${name}`)
const agentDecision = data.candidate_tokens?.length
  ? `agent note: ${data.candidate_tokens.length} correlational candidates (${data.candidate_tokens.map((c: any) => c.symbol).join(", ")}) — NOT treating as cause per caveat`
  : `agent note: no candidates — payout source is ${data.event?.source_label ?? "unknown"}`
console.log(`\n    ${agentDecision}`)

console.log(`\n[4] confirm Finch logged the call — GET ${BASE}/calls`)
const calls = await get("/calls")
const mine = (calls.body as any)?.recent?.filter((c: any) => c.caller === AGENT) ?? []
console.log(`    logging mode: ${(calls.body as any)?.call_logging}`)
console.log(`    calls from ${AGENT}: ${mine.length}`)
if (mine[0]) j(mine[0])
console.log(mine.length ? "\n✓ round trip verified: agent -> Finch -> logged" : "\n(no log — mode may be 'off'; run /seeAgent)")
