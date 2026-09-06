import { extract, type Mode } from "./extract.js"
import { runQuery } from "./query.js"
import { format } from "./format.js"
import { toJson } from "./serialize.js"
import { KNOWN_SYMBOLS } from "./tokens.js"

const unknownSymbolMsg = (sym: string) =>
  `${sym} isn't a token Finch recognizes as a filter — its watch list and Pons25 are: ${KNOWN_SYMBOLS.join(", ")} (+ the rest of Pons25). ` +
  `Paste ${sym}'s 0x address to filter by it anyway, or see /pons25.`

// parse -> query -> serialize. `mode` is per-chat context ("wallet" default,
// "launches" so a bare symbol filters recent launches). Each message is still
// answered independently.
export async function answer(text: string, savedWallet?: string, mode: Mode = "wallet"): Promise<string> {
  const parsed = await extract(text, savedWallet, mode)
  if (parsed.unknownSymbol && !parsed.wallet && !parsed.token) return unknownSymbolMsg(parsed.unknownSymbol)
  if (parsed.intent === "unknown" && !parsed.wallet) {
    return savedWallet
      ? "Send a token symbol (NVDA, SPY, GME, GOOGL, cbBTC, …) to see why you received it, ask what launched on Pons recently, or check if a token graduated (paste its 0x address)."
      : "Set your wallet with /account 0x… then send a token symbol — or ask \"what launched on Pons recently\". I also cover graduations."
  }
  const result = await runQuery(parsed)
  return format(parsed, result)
}

export async function answerJson(text: string, savedWallet?: string, mode: Mode = "wallet"): Promise<Record<string, unknown>> {
  const parsed = await extract(text, savedWallet, mode)
  if (parsed.intent === "unknown" && !parsed.wallet) {
    return { error: "No wallet or token in the request.", confidence: "signal only - not a recommendation" }
  }
  const result = await runQuery(parsed)
  return toJson(parsed, result)
}
