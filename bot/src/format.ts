import { chat, llmAvailable } from "./llm.js"
import { gql, gqlOn } from "./subgraph.js"
import { human, tokenMeta, TOKENS, KNOWN_SYMBOLS } from "./tokens.js"
import { candidatesFor } from "./candidates.js"
import { PONS25 } from "./pons25.js"
import type { Parsed } from "./extract.js"
import type { QueryResult, TransferRow, LaunchRow } from "./query.js"

const FEE_ESCROW = "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e"
const shortAddr = (h: string) => `${h.slice(0, 6)}...${h.slice(-4)}`
const shortTx = (h: string) => `${h.slice(0, 10)}...${h.slice(-5)}`
const isFeeSettlement = (r: TransferRow) => /fee claim|fee settlement|feeescrow/i.test(r.fromLabel ?? "")

const TRACKED = KNOWN_SYMBOLS.join(", ")

const P25_BY_ADDR = new Map(PONS25.map(r => [r.address.toLowerCase(), r.symbol]))
function pairLabel(addr: string): string {
  const a = addr.toLowerCase()
  if (a === "0x0000000000000000000000000000000000000000") return "ETH"
  if (a === "0x5fc5360d0400a0fd4f2af552add042d716f1d168") return "USDG"
  if (a === "0x0bd7d308f8e1639fab988df18a8011f41eacad73") return "WETH"
  return TOKENS[a]?.symbol ?? P25_BY_ADDR.get(a) ?? shortAddr(a)
}

export async function format(p: Parsed, q: QueryResult): Promise<string> {
  if (q.kind === "wallet") return formatWallet(p, q)
  if (q.kind === "launches") return formatLaunches(p, q.launches)
  if (q.kind === "graduated") return formatGraduated(q.launch)
  return "I can answer: why a wallet received a token (give me the address), what launched on Pons recently, or whether a token has graduated (give me its address)."
}

async function formatWallet(p: Parsed, q: Extract<QueryResult, { kind: "wallet" }>): Promise<string> {
  if (q.transfers.length === 0) {
    if (p.tokenSymbol) {
      return q.walletIndexed
        ? `That wallet hasn't received any ${p.tokenSymbol} in the indexed range.`
        : `I don't see any ${p.tokenSymbol} received by that wallet in the indexed range.`
    }
    return q.walletIndexed
      ? `That wallet is in the index but hasn't received any of the tracked tokens (${TRACKED}).`
      : `I don't see any activity for that wallet in the indexed range (Pons launches + ${TRACKED} transfers). It may have received tokens outside that window or tokens Finch doesn't track.`
  }

  // Finch exists to explain classified transfers — surface the most recent
  // labeled one if present, else the most recent transfer of any kind.
  const r = q.transfers.find(isFeeSettlement)
    ?? q.transfers.find(t => t.fromLabel)
    ?? q.transfers[0]
  const { symbol } = tokenMeta(r.token)
  const amt = human(r.amount, r.token)

  if (isFeeSettlement(r)) {
    if (!p.wantsTrace) {
      // Candidate list — the answer to "which token", shown compact, no hedging.
      const cands = await candidatesFor(r.to, r.token).catch(() => [] as { symbol: string; address: string }[])
      if (cands.length) {
        const lines = cands.slice(0, 5).map(c => {
          const label = c.symbol !== "tokens" ? c.symbol : "token"
          return `  ${label}  ${c.address}`
        })
        return `This wallet received ${amt} ${symbol} from a Pons fee settlement.\nThis could be from activity in:\n${lines.join("\n")}`
      }
      return `This wallet received ${amt} ${symbol}. Where from: Pons fee settlement. Why: FeeEscrow ` +
             `settles accrued Pons trading-fee revenue from Pons-launched tokens.`
    }

    // recipient count comes from whichever subgraph the payout was found in
    const { count } = await gqlOn<{ count: { id: string }[] }>(q.via,
      `query ($tx: Bytes!, $from: Bytes!) { count: transfers(where: { txHash: $tx, from: $from }, first: 1000) { id } }`,
      { tx: r.txHash, from: r.from },
    ).then(d => ({ count: d.count })).catch(() => ({ count: [] as { id: string }[] }))
    const n = count.length || "many"
    return `This wallet received ${amt} ${symbol}. Where from: Pons fee settlement. Why: FeeEscrow ` +
      `settles accrued Pons trading-fee revenue from Pons-launched tokens.\n\n` +
      `This was a batched payout — not a transfer or swap the wallet initiated. A distributor ` +
      `paid it to the wallet along with many others in one transaction. This is the most recent ` +
      `${symbol} transfer to this wallet.\n\n` +
      `Tx: ${r.txHash}\n` +
      `Route (as indexed):\n` +
      `    FeeEscrow    ${FEE_ESCROW.toLowerCase()}\n` +
      `    -> distributor  ${r.from}\n` +
      `    -> wallet       ${r.to}\n` +
      `(1 of ${n} recipients paid in this same tx)\n` +
      `Upstream: FeeEscrow accrues Pons trading fees; graduated Pons pools run on Uniswap V4 behind the Meme Hook.\n` +
      `Source: Goldsky-hosted subgraph (Pons factory + Uniswap V4 PoolManager), Robinhood Chain 4663.`
  }

  // Non-canonical category — deterministic base; LLM only rephrases if configured.
  const src = r.fromLabel ? r.fromLabel : "another wallet"
  const base = `This wallet received ${amt} ${symbol} from ${src}${p.wantsTrace ? `\n\nTx: ${r.txHash}\nFrom: ${r.from}` : ""}.`
  if (!llmAvailable() || p.wantsTrace) return base
  try {
    return await chat(
      "Rewrite the fact as one plain sentence for a non-technical user. Refer to the address " +
      "as \"the wallet\", never \"you\". Do not add advice, speculation, or any value not " +
      "present. Keep the token amount and symbol exactly.",
      base,
    )
  } catch { return base }
}

function formatLaunches(p: Parsed, rows: LaunchRow[]): string {
  const pairScope = p.pairGroup === "pons25" ? " paired vs a Pons25 stock token"
    : p.pairFilter ? ` paired vs ${pairLabel(p.pairFilter)}`
    : ""
  const noun = p.onlyGraduated ? "graduated Pons tokens (now on Uniswap V4)" : "recent Pons launches"
  if (rows.length === 0) {
    return (p.pairFilter || p.pairGroup || p.onlyGraduated)
      ? `No ${noun}${pairScope} in the indexed range.`
      : "No Pons launches in that window (in the indexed range)."
  }
  const shown = rows.slice(0, 10)
  const mixed = !p.onlyGraduated && shown.some(l => l.graduated) && shown.some(l => !l.graduated)
  const lines = shown.map(l => {
    const ts = Number(p.onlyGraduated ? (l.graduationTimestamp ?? l.timestamp) : l.timestamp)
    const when = new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 16)
    const pair = l.pairToken ? ` · vs ${pairLabel(l.pairToken)}` : ""
    const stage = mixed ? (l.graduated ? " · Uniswap V4" : " · Pons curve") : ""
    return `• ${l.token}${pair}${stage} · ${when}Z`
  })
  const legend = mixed
    ? "\nPons curve = pre-graduation bonding curve (not Uniswap). Uniswap V4 = graduated into a V4 pool behind Pons's Meme Hook."
    : ""
  const hint = (p.pairFilter || p.pairGroup || p.onlyGraduated) ? "" :
    "\nSend a token symbol or \"Pons25\" to filter by pairing token, or \"graduated\" for Uniswap V4 pools only."
  const stageTag = mixed ? "" : " · all on the Pons bonding curve (pre-graduation, not Uniswap)"
  const head = p.onlyGraduated
    ? `Graduated Pons tokens${pairScope} (now trading on Uniswap V4):`
    : `Recent Pons launches${pairScope}${stageTag}:`
  return `${head}\n${lines.join("\n")}${legend}${hint}`
}

function formatGraduated(l: LaunchRow | null): string {
  if (!l) return "I don't have a Pons launch record for that token in the indexed range."
  if (!l.graduated) return `That token launched on Pons and is still on the bonding curve — not graduated, so it has no Uniswap V4 pool yet.`
  const when = l.graduationTimestamp
    ? new Date(Number(l.graduationTimestamp) * 1000).toISOString().replace("T", " ").slice(0, 16) + "Z"
    : "an unknown time"
  return `Yes — that token graduated to a Uniswap V4 pool at ${when}.`
}
