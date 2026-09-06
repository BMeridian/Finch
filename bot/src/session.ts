import { readFileSync, writeFileSync } from "node:fs"

// Minimal per-chat state: a saved wallet so the user can set it once and then
// ask follow-up questions without re-pasting. Not conversation memory — each
// message is still answered independently; this is just a default address.

const FILE = new URL("../.session.json", import.meta.url).pathname
type Store = Record<string, { wallet?: string }>

let store: Store = {}
try { store = JSON.parse(readFileSync(FILE, "utf8")) } catch { store = {} }

function persist() {
  try { writeFileSync(FILE, JSON.stringify(store), "utf8") } catch { /* best effort */ }
}

export function getWallet(chatId: number | string): string | undefined {
  return store[String(chatId)]?.wallet
}
export function setWallet(chatId: number | string, wallet: string) {
  store[String(chatId)] = { wallet: wallet.toLowerCase() }
  persist()
}
export function clearWallet(chatId: number | string) {
  delete store[String(chatId)]
  persist()
}
