import { readFileSync, writeFileSync } from "node:fs"

// Minimal per-chat state so a user can set context once, then send short
// follow-ups. Each message is still answered independently.
//   wallet — default address for "why did I get NVDA"
//   mode   — "wallet" (default) or "launches"; in "launches" a bare symbol
//            filters recent launches by pairing token

const FILE = new URL("../.session.json", import.meta.url).pathname
type Mode = "wallet" | "launches"
type Bazrep = { step: "wallet" | "symbol"; wallet?: string }
type Awaiting = "trace" | "traceens" | "symbol" | "launches" | "grads"
type Category = "humans" | "lists" | "agents"
type Entry = { wallet?: string; mode?: Mode; bazrep?: Bazrep; awaiting?: Awaiting; symbol?: string; category?: Category }
type Store = Record<string, Entry>

let store: Store = {}
try { store = JSON.parse(readFileSync(FILE, "utf8")) } catch { store = {} }
function persist() { try { writeFileSync(FILE, JSON.stringify(store), "utf8") } catch { /* best effort */ } }
function entry(id: number | string): Entry { return (store[String(id)] ||= {}) }

export function getWallet(id: number | string): string | undefined { return store[String(id)]?.wallet }
export function setWallet(id: number | string, wallet: string) { entry(id).wallet = wallet.toLowerCase(); entry(id).mode = "wallet"; persist() }
export function clearWallet(id: number | string) { delete store[String(id)]; persist() }

// Wallet + symbol reset, but keep which menu category the user is browsing —
// used by the "Set Wallet" button so it doesn't bounce them out of Humans/etc.
export function resetWalletAndSymbol(id: number | string) {
  const e = entry(id)
  delete e.wallet; delete e.symbol; delete e.bazrep; delete e.awaiting
  persist()
}

export function getMode(id: number | string): Mode { return store[String(id)]?.mode ?? "wallet" }
export function setMode(id: number | string, mode: Mode) { entry(id).mode = mode; persist() }

// which menu category (humans/lists/agents) the user is currently browsing —
// so a "back to menu" tap after an action lands on that category, not the top
export function getCategory(id: number | string): Category | undefined { return store[String(id)]?.category }
export function setCategory(id: number | string, c: Category | undefined) {
  if (c) entry(id).category = c; else delete entry(id).category
  persist()
}

// last token symbol the user asked/traced — once set, Trace/TraceENS buttons
// reuse it instead of asking again
export function getSymbol(id: number | string): string | undefined { return store[String(id)]?.symbol }
export function setSymbol(id: number | string, symbol: string) { entry(id).symbol = symbol.toUpperCase(); persist() }

// button-triggered "send me a symbol next" prompts — /trace and /traceENS
export function getAwaiting(id: number | string): Awaiting | undefined { return store[String(id)]?.awaiting }
export function setAwaiting(id: number | string, a: Awaiting | undefined) {
  if (a) entry(id).awaiting = a; else delete entry(id).awaiting
  persist()
}

// /bazrep guided flow — collect the recipe's inputs one at a time
export function getBazrep(id: number | string): Bazrep | undefined { return store[String(id)]?.bazrep }
export function setBazrep(id: number | string, b: Bazrep | undefined) {
  if (b) entry(id).bazrep = b; else delete entry(id).bazrep
  persist()
}
