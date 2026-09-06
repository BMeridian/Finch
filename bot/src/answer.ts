import { extract } from "./extract.js"
import { runQuery } from "./query.js"
import { format } from "./format.js"

// parse -> query -> format. Each message handled independently; the only state
// is an optional saved wallet passed in by the caller.
export async function answer(text: string, savedWallet?: string): Promise<string> {
  const parsed = await extract(text, savedWallet)
  if (parsed.intent === "unknown" && !parsed.wallet) {
    return savedWallet
      ? "Send a token symbol (NVDA, SPY, GME, GOOGL, cbBTC, …) to see why you received it, ask about Pons launches, or check if a token graduated (paste its 0x address)."
      : "Set your wallet with /account 0x… then send a token symbol — or paste any 0x address. I also cover Pons launches and graduations."
  }
  const result = await runQuery(parsed)
  return format(parsed, result)
}
