import { readFileSync, writeFileSync } from "node:fs"

// Minimal per-chat state so a user can set context once, then send short
// follow-ups. Each message is still answered independently.
//   wallet — default address for "why did I get NVDA"
//   mode   — "wallet" (default) or "launches"; in "launches" a bare symbol
//            filters recent launches by pairing token

const FILE = new URL("../.session.json", import.meta.url).pathname
type Mode = "wallet" | "launches"
type Entry = { wallet?: string; mode?: Mode }
type Store = Record<string, Entry>

let store: Store = {}
try { store = JSON.parse(readFileSync(FILE, "utf8")) } catch { store = {} }
function persist() { try { writeFileSync(FILE, JSON.stringify(store), "utf8") } catch { /* best effort */ } }
function entry(id: number | string): Entry { return (store[String(id)] ||= {}) }

export function getWallet(id: number | string): string | undefined { return store[String(id)]?.wallet }
export function setWallet(id: number | string, wallet: string) { entry(id).wallet = wallet.toLowerCase(); entry(id).mode = "wallet"; persist() }
export function clearWallet(id: number | string) { delete store[String(id)]; persist() }

export function getMode(id: number | string): Mode { return store[String(id)]?.mode ?? "wallet" }
export function setMode(id: number | string, mode: Mode) { entry(id).mode = mode; persist() }
