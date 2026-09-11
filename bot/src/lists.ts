import { KNOWN_SYMBOLS } from "./tokens.js"
import { PONS25, pons25Text } from "./pons25.js"

// FinchTop — reflect the actual WATCHED list (bot/src/tokens.ts mirrors
// substreams/substreams.yaml's tokens= param). No lookup, no new data.
export function finchTopText(): string {
  const s = KNOWN_SYMBOLS
  const wrapped: string[] = []
  for (let i = 0; i < s.length; i += 8) wrapped.push(s.slice(i, i + 8).join(", "))
  return `FinchTop — currently tracked (${s.length}):\n${wrapped.join("\n")}`
}

// The gap between "what's out there" (Pons25) and "what Finch sees" (FinchTop).
export function coverageText(): string {
  const watched = new Set(KNOWN_SYMBOLS)
  const inBoth = PONS25.filter(r => watched.has(r.symbol)).map(r => r.symbol)
  const missing = PONS25.filter(r => !watched.has(r.symbol)).map(r => r.symbol)
  return (
    `${pons25Text()}\n\n` +
    `${finchTopText()}\n\n` +
    `Coverage: Finch tracks ${inBoth.length} of the top 25 (${inBoth.join(", ")}).\n` +
    `Not tracked: ${missing.join(", ")}.`
  )
}
