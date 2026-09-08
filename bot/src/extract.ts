import { chat, llmAvailable } from "./llm.js"
import { addressForSymbol, KNOWN_SYMBOLS } from "./tokens.js"
import { PONS25 } from "./pons25.js"

export type Intent = "wallet" | "launches" | "graduated" | "unknown"
export type Mode = "wallet" | "launches"
export interface Parsed {
  intent: Intent
  wallet?: string
  token?: string            // token address the question is about
  tokenSymbol?: string
  sinceHours?: number
  wantsTrace: boolean
  pairFilter?: string       // launches: filter by this pairing-token address
  pairGroup?: "pons25" | "finchtop"  // launches: filter to any pairing token in that set
  onlyGraduated?: boolean   // launches: only tokens that reached a Uniswap V4 pool
  unknownSymbol?: string    // a ticker-like word the user meant as a filter but Finch doesn't know
}

// symbols recognised for launch filtering = watch list + Pons25
const P25 = new Map(PONS25.map(r => [r.symbol.toUpperCase(), r.address]))
const ALL_SYMBOLS = [...new Set([...KNOWN_SYMBOLS, ...PONS25.map(r => r.symbol)])]
const SYMBOL_RE = new RegExp(`\\b(${ALL_SYMBOLS.join("|")})\\b`, "i")
function symbolToAddress(sym: string): string | undefined {
  return addressForSymbol(sym) ?? P25.get(sym.toUpperCase())
}

const ADDR = /0x[0-9a-fA-F]{40}/g
const TRACE = /\b(trace|technical trace|show me the trace|show addresses|show the addresses|raw trace|full trace|show hex|route|the tx|show tx)\b/i
const PONS25_RE = /\bpons\s*25\b/i
const FINCHTOP_RE = /\bfinch\s*top\b/i

function windowHours(t: string): number | undefined {
  const m = t.match(/last\s+(\d+)\s*(hour|hr|day|week)s?/i) || t.match(/past\s+(\d+)\s*(hour|hr|day|week)s?/i)
  if (!m) return undefined
  const n = parseInt(m[1], 10)
  const unit = m[2].toLowerCase()
  return unit.startsWith("hour") || unit === "hr" ? n : unit.startsWith("day") ? n * 24 : n * 168
}

export async function extract(text: string, savedWallet?: string, mode: Mode = "wallet"): Promise<Parsed> {
  const addrs = text.match(ADDR) ?? []
  const wantsTrace = TRACE.test(text)
  const sinceHours = windowHours(text)
  const t = text.toLowerCase()
  const selfRef = /\b(i|me|my|mine|my wallet|my account|myself)\b/i.test(t)
  const symMatch = text.match(SYMBOL_RE)
  const symbol = symMatch ? symMatch[1].toUpperCase() : undefined
  const pons25 = PONS25_RE.test(text)
  const finchtop = FINCHTOP_RE.test(text)
  const pairGroupWord = pons25 || finchtop

  // a ticker-like word the user typed that Finch does NOT recognise — flag it
  // rather than silently dropping the filter.
  const STOP = new Set(["ETH", "WETH", "USD", "USDG", "USDC", "THE", "AND", "FOR", "NEW", "TX", "NFT", "LP", "V4", "AI"])
  const tickerLike = (text.match(/\b[A-Z]{2,5}\b/g) ?? []).map(s => s.toUpperCase())
    .filter(s => !STOP.has(s) && !ALL_SYMBOLS.includes(s))
  const unknownSymbol = !symbol && tickerLike.length ? tickerLike[0] : undefined
  const launchWords = /(launch|\bnew\b|deployed|newly created|just dropped|newly|recent|latest)/i.test(t)

  const graduatedWord = /graduat/i.test(t)
  const curveWord = /\b(on curve|bonding curve|pre-?grad|all|every|any)\b/i.test(t)

  let intent: Intent = "unknown"
  if (graduatedWord && addrs.length) intent = "graduated"
  else if (graduatedWord && !addrs.length) intent = "launches"     // "graduated" alone -> the graduated list
  else if (launchWords && !/\bwhy\b/i.test(t) && !addrs.length) intent = "launches"
  else if (addrs.length && /(why|receiv|got|sent me|where.*from|airdrop|claim|dust|distribut)/i.test(t)) intent = "wallet"
  else if (addrs.length) intent = "wallet"
  // A saved wallet + a bare known symbol (no launch/graduated/pons25/window words)
  // is the two-step provenance flow ("/account" then "NVDA") — it wins over a
  // stale "launches" mode so the chat is never trapped there.
  else if (savedWallet && symbol && !launchWords && !graduatedWord && !pairGroupWord && !sinceHours) intent = "wallet"
  else if (mode === "launches" && (symbol || pairGroupWord || graduatedWord)) intent = "launches"   // launches-mode follow-up
  else if (savedWallet && (selfRef || symbol || wantsTrace || /(why|receiv|got|where.*from|airdrop|claim|dust|distribut|which token|what token|caused this|where.*came from)/i.test(t))) intent = "wallet"
  else if (launchWords || pairGroupWord) intent = "launches"

  if (intent === "unknown" && llmAvailable()) {
    try {
      const r = await chat(
        "Classify into exactly one of: wallet, launches, graduated, unknown. Reply only that word.",
        text,
      )
      const w = r.toLowerCase().trim()
      if (w === "wallet" || w === "launches" || w === "graduated") intent = w
    } catch { /* unknown */ }
  }

  const symAddr = symbol ? symbolToAddress(symbol) : undefined
  return {
    intent,
    wallet: intent === "wallet" ? (addrs[0]?.toLowerCase() ?? savedWallet) : undefined,
    token: intent === "graduated" ? addrs[0]?.toLowerCase()
         : intent === "wallet" ? (symAddr ?? addrs[1]?.toLowerCase())
         : undefined,
    tokenSymbol: symbol,
    sinceHours,
    wantsTrace,
    pairFilter: intent === "launches" ? (symAddr ?? addrs[0]?.toLowerCase()) : undefined,
    pairGroup: intent === "launches" ? (pons25 ? "pons25" : finchtop ? "finchtop" : undefined) : undefined,
    // Filtering launches by Pons25 / FinchTop defaults to the graduated ones
    // (the live Uniswap V4 pools) — the curve list is huge and short-lived.
    onlyGraduated: intent === "launches" && (graduatedWord || (pairGroupWord && !curveWord)) ? true : undefined,
    unknownSymbol,
  }
}
