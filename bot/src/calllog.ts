import { appendFileSync, readFileSync, writeFileSync } from "node:fs"

// So Finch can SEE agent calls. Every Gateway request lands here: an in-memory
// ring for /calls, plus an append-only JSONL file that survives restarts.

const FILE = new URL("../.calls.jsonl", import.meta.url).pathname
const RING_MAX = 200

export interface CallRecord {
  ts: string
  caller: string        // x402 payer / x-caller header, else "anonymous"
  ua: string
  route: string
  format: "json" | "prose"
  wallet: string | null
  question: string
  took_ms: number
  ok: boolean
}

const ring: CallRecord[] = []

// Runtime-switchable call visibility:
//   off  — do not log agent calls
//   min  — timestamp + caller + ok only
//   full — the whole record
export type SeeMode = "off" | "min" | "full"
const MODE_FILE = new URL("../.seemode", import.meta.url).pathname
function readMode(): SeeMode {
  try { const m = readFileSync(MODE_FILE, "utf8").trim(); if (m === "off" || m === "min" || m === "full") return m } catch { /* default */ }
  return "min"
}
export function setSeeMode(m: SeeMode) { try { writeFileSync(MODE_FILE, m, "utf8") } catch { /* ignore */ } }
export function seeMode(): SeeMode { return readMode() }

export function logCall(rec: CallRecord) {
  const mode = readMode()
  if (mode === "off") return
  const stored: CallRecord = mode === "min"
    ? { ...rec, ua: "", route: rec.route, question: "", wallet: null, took_ms: 0 }
    : rec
  ring.push(stored)
  if (ring.length > RING_MAX) ring.shift()
  try { appendFileSync(FILE, JSON.stringify(stored) + "\n", "utf8") } catch { /* best effort */ }
  console.log(mode === "min"
    ? `call: ${stored.ts}  ${stored.caller}  ${stored.ok ? "ok" : "err"}`
    : `call: ${rec.caller}  ${rec.format}  wallet=${rec.wallet ?? "-"}  ${rec.took_ms}ms  ${rec.ok ? "ok" : "err"}`)
}

export function recentCalls(limit = 50): CallRecord[] {
  return ring.slice(-limit).reverse()
}

export function callStats() {
  let all: CallRecord[] = ring
  try {
    all = readFileSync(FILE, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l))
  } catch { /* ring only */ }
  const byCaller: Record<string, number> = {}
  for (const c of all) byCaller[c.caller] = (byCaller[c.caller] || 0) + 1
  return { total: all.length, by_caller: byCaller, last: all[all.length - 1] ?? null }
}
