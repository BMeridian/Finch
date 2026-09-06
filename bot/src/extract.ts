import { chat, llmAvailable } from "./llm.js"
import { addressForSymbol, KNOWN_SYMBOLS } from "./tokens.js"

export type Intent = "wallet" | "launches" | "graduated" | "unknown"
export interface Parsed {
  intent: Intent
  wallet?: string
  token?: string          // token address the question is about (from a symbol or 0x addr)
  tokenSymbol?: string
  sinceHours?: number
  wantsTrace: boolean
}

const SYMBOL_RE = new RegExp(`\\b(${KNOWN_SYMBOLS.join("|")})\\b`, "i")

const ADDR = /0x[0-9a-fA-F]{40}/g
const TRACE = /\b(trace|technical trace|show me the trace|show addresses|show the addresses|raw trace|full trace|show hex|route|the tx|show tx)\b/i

function windowHours(t: string): number | undefined {
  const m = t.match(/last\s+(\d+)\s*(hour|hr|day|week)s?/i) || t.match(/past\s+(\d+)\s*(hour|hr|day|week)s?/i)
  if (!m) return undefined   // "recently" with no number = show latest, don't filter
  const n = parseInt(m[1], 10)
  const unit = m[2].toLowerCase()
  return unit.startsWith("hour") || unit === "hr" ? n : unit.startsWith("day") ? n * 24 : n * 168
}

// Deterministic first. LLM only disambiguates intent when the regex is unsure
// AND a key is configured — it never supplies an address or a number itself.
// `savedWallet` is the chat's set account: used only when the message itself
// carries no address.
export async function extract(text: string, savedWallet?: string): Promise<Parsed> {
  const addrs = text.match(ADDR) ?? []
  const wantsTrace = TRACE.test(text)
  const sinceHours = windowHours(text)
  const t = text.toLowerCase()
  const selfRef = /\b(i|me|my|mine|my wallet|my account|myself)\b/i.test(t)
  const symMatch = text.match(SYMBOL_RE)
  const symbol = symMatch ? symMatch[1].toUpperCase() : undefined

  let intent: Intent = "unknown"
  if (/graduat/i.test(t) && addrs.length) intent = "graduated"
  else if (/(launch|\bnew\b|deployed|newly created|just dropped)/i.test(t) && !/\bwhy\b/i.test(t) && !addrs.length) intent = "launches"
  else if (addrs.length && /(why|receiv|got|sent me|where.*from|airdrop|claim|dust)/i.test(t)) intent = "wallet"
  else if (addrs.length) intent = "wallet"
  else if (savedWallet && (selfRef || symbol || wantsTrace || /(why|receiv|got|where.*from|airdrop|claim|dust|which token|what token|caused this|where.*came from)/i.test(t))) intent = "wallet"
  else if (/(launch|newly|recent|latest|\bnew\b)/i.test(t)) intent = "launches"

  if (intent === "unknown" && llmAvailable()) {
    try {
      const r = await chat(
        "Classify the user's question into exactly one of: wallet, launches, graduated, unknown. " +
        "Reply with only that word. 'wallet' = why did an address receive a token / what did a wallet get. " +
        "'launches' = what tokens launched recently. 'graduated' = did a specific token graduate.",
        text,
      )
      const w = r.toLowerCase().trim()
      if (w === "wallet" || w === "launches" || w === "graduated") intent = w
    } catch { /* fall through as unknown */ }
  }

  const symAddr = symbol ? addressForSymbol(symbol) : undefined
  return {
    intent,
    wallet: intent === "wallet" ? (addrs[0]?.toLowerCase() ?? savedWallet) : undefined,
    token: intent === "graduated" ? addrs[0]?.toLowerCase()
         : intent === "wallet" ? (symAddr ?? addrs[1]?.toLowerCase())
         : undefined,
    tokenSymbol: symbol,
    sinceHours,
    wantsTrace,
  }
}
