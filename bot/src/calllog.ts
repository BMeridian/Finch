import { appendFileSync, readFileSync, writeFileSync, statSync } from "node:fs"

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
  answer?: string
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
    ? { ...rec, ua: "", route: rec.route, question: "", answer: "", wallet: null, took_ms: 0 }
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

// Cross-process tail of the JSONL file — the bot reads what the HTTP API wrote.
// Returns records appended since `offset` bytes, and the new offset.
export function callLogSize(): number {
  try { return statSync(FILE).size } catch { return 0 }
}
export function tailCalls(offset: number): { records: CallRecord[]; offset: number } {
  let buf: Buffer
  try { buf = readFileSync(FILE) } catch { return { records: [], offset } }
  if (offset > buf.length) offset = 0           // file rotated/truncated
  const slice = buf.subarray(offset).toString("utf8")
  const lastNl = slice.lastIndexOf("\n")
  if (lastNl < 0) return { records: [], offset }
  const consumed = Buffer.byteLength(slice.slice(0, lastNl + 1), "utf8")
  const records = slice.slice(0, lastNl).split("\n").filter(Boolean)
    .map(l => { try { return JSON.parse(l) as CallRecord } catch { return null } })
    .filter((r): r is CallRecord => r !== null)
  return { records, offset: offset + consumed }
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
