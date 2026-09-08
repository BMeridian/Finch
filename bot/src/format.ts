import { chat, llmAvailable } from "./llm.js"
import { gql, gqlLive, gqlOn } from "./subgraph.js"
import { human, tokenMeta, TOKENS, KNOWN_SYMBOLS } from "./tokens.js"
import { candidatesFor } from "./candidates.js"
import { resolveDistributors, describeMany, verifyProRata, txCall } from "./distributor.js"
import { PONS25 } from "./pons25.js"
import type { Parsed } from "./extract.js"
import type { QueryResult, TransferRow, LaunchRow } from "./query.js"

const FEE_ESCROW = "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e"
const POOL_MANAGER = "0x8366a39CC670B4001A1121B8F6A443A643e40951"  // Uniswap V4 (bytecode-verified)
const shortAddr = (h: string) => `${h.slice(0, 6)}...${h.slice(-4)}`
const shortTx = (h: string) => `${h.slice(0, 10)}...${h.slice(-5)}`
// answers render with Telegram parse_mode "HTML" — escape any dynamic text
// (launcher-controlled descriptions especially) and bold only via <b>.
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
// human-readable big token balance: "24.3M", "1,240", "0.42"
const compact = (raw: string, addr: string) => {
  const n = Number(human(raw, addr, 4))
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return Math.round(n).toLocaleString("en-US")
  return String(n)
}
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

const tsET = (t?: string) => {
  if (!t) return "?"
  return new Date(Number(t) * 1000).toLocaleString("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short",
  })
}

// The span the subgraphs actually cover, as timestamps — for "nothing found" replies.
async function indexedRange(): Promise<string> {
  const oldest = "{ t: transfers(first: 1, orderBy: block, orderDirection: asc) { timestamp } }"
  const newest = "{ t: transfers(first: 1, orderBy: block, orderDirection: desc) { timestamp } }"
  const [h, live] = await Promise.all([
    gql<{ t: { timestamp: string }[] }>(oldest).catch(() => null),
    gqlLive<{ t: { timestamp: string }[] }>(newest).catch(() => null),
  ])
  const from = h?.t[0]?.timestamp
  const to = live?.t[0]?.timestamp
  if (!from) return ""
  return `Indexed range: ${tsET(from)} – ${tsET(to)}.`
}

async function formatWallet(p: Parsed, q: Extract<QueryResult, { kind: "wallet" }>): Promise<string> {
  if (q.transfers.length === 0) {
    const range = ` ${await indexedRange()}`
    if (p.tokenSymbol) {
      return q.walletIndexed
        ? `That wallet hasn't received any ${p.tokenSymbol}.${range}`
        : `I don't see any ${p.tokenSymbol} received by that wallet.${range}`
    }
    return q.walletIndexed
      ? `That wallet is in the index but hasn't received any of the tracked tokens (${TRACKED}).${range}`
      : `I don't see any activity for that wallet (Pons launches + ${TRACKED} transfers).${range} It may have received tokens outside that window or tokens Finch doesn't track.`
  }

  // No specific token asked → summarise every tokenized-stock distribution
  // this wallet has received (one line per token × distributor).
  if (!p.tokenSymbol && !p.wantsTrace) {
    const settles = q.transfers.filter(isFeeSettlement)
    if (settles.length) {
      const seen = new Map<string, { sym: string; amt: string; from: string; ts: string; n: number }>()
      for (const t of settles) {
        const k = `${t.token}|${t.from}`
        const e = seen.get(k)
        if (e) { e.n++ }
        else seen.set(k, { sym: tokenMeta(t.token).symbol, amt: human(t.amount, t.token), from: t.from, ts: t.timestamp, n: 1 })
      }
      const lines = [...seen.values()]
        .sort((a, b) => Number(b.ts) - Number(a.ts))
        .map(e => `- ${esc(e.sym)}  latest ${e.amt}  ·  from ${shortAddr(e.from)}  ·  ${e.n}× in range`)
      const firstSym = lines[0].split("  ")[0].slice(2)
      return `This wallet has received tokenized-stock distributions:\n\n${lines.join("\n")}\n\n` +
        `Ask about a symbol (e.g. ${firstSym}) or "trace ${firstSym}" for the evidence.\n` +
        await indexedRange()
    }
    const anyTracked = q.transfers.length
    return anyTracked
      ? `This wallet has tracked-token transfers, but none look like distributions ` +
        `(all appear to be ordinary transfers or swaps). ${await indexedRange()}`
      : `No tokenized-stock distributions to this wallet. ${await indexedRange()}`
  }

  // Finch exists to explain classified transfers — surface the most recent
  // labeled one if present, else the most recent transfer of any kind.
  const r = q.transfers.find(isFeeSettlement)
    ?? q.transfers.find(t => t.fromLabel)
    ?? q.transfers[0]
  const { symbol } = tokenMeta(r.token)
  const amt = human(r.amount, r.token)

  if (isFeeSettlement(r)) {
    const D = r.from                       // the contract that paid the token in
    const payers = [...new Set(q.transfers.filter(t => t.token === r.token).map(t => t.from))]
    const resolved = await resolveDistributors(payers, r.token, r.to).catch(() => [])
    const c = resolved.find(x => x.distributor === D.toLowerCase()) ?? resolved[0]

    // recipients + amounts paid by D in THIS tx — used to test pro-rata
    const batch = await gqlOn<{ t: { to: string; amount: string }[] }>(q.via,
      `query ($tx: Bytes!, $from: Bytes!) {
        t: transfers(where: { txHash: $tx, from: $from }, first: 1000) { to amount }
      }`, { tx: r.txHash, from: D },
    ).then(d => d.t).catch(() => [] as { to: string; amount: string }[])
    const n = batch.length || "many"

    // recurrence (within the indexed range)
    const recTx = await gql<{ t: { block: string }[] }>(
      `query ($w: String!, $src: Bytes!) {
        t: transfers(where: { to: $w, from: $src }, orderBy: block, orderDirection: asc, first: 1000) { block }
      }`, { w: r.to, src: D },
    ).then(d => d.t).catch(() => [] as { block: string }[])
    const recN = recTx.length
    const recStr = `${recN}× in the indexed range`

    // The pro-rata check reads *current* balances. If it PASSES, that's proof
    // regardless of age. If it FAILS on an old payout, recipients have likely
    // just traded since — so we soften the "not pro-rata" wording for old txs.
    const ageSec = Math.max(0, Math.floor(Date.now() / 1000) - Number(r.timestamp))
    const stale = ageSec > 24 * 3600

    // is D distributing `symbol` pro-rata to holders of some token T?
    // (c.token is D's token() getter; verify it against the batch.)
    let pr = null as Awaited<ReturnType<typeof verifyProRata>> | null
    if (c && c.quoteToken === r.token && batch.length >= 3) {
      pr = await verifyProRata(c.token, r.to,
        batch.map(b => ({ addr: b.to, amount: BigInt(b.amount) }))).catch(() => null)
    }
    const heldT = pr?.walletBalance && pr.walletBalance !== "0"
      ? compact(pr.walletBalance, c!.token) : null

    // correlational candidates (only surfaced when we have no confirmed mechanism)
    const cands = (await candidatesFor(r.to, r.token).catch(() => [] as { symbol: string; address: string }[]))
      .filter(x => !c || x.address.toLowerCase() !== c.token)

    // ---- non-trace ----
    if (!p.wantsTrace) {
      if (pr?.proRata && c) {
        return `This wallet received ${amt} ${symbol} — its pro-rata share of ${esc(c.symbol)} fee ` +
          `distributions${heldT ? `, from holding ${heldT} ${esc(c.symbol)}` : ""}.\n\n` +
          `Contract ${shortAddr(D)} pays ${symbol} to ${esc(c.symbol)} holders each round, ` +
          `~${pr.perMillion!.toFixed(4)} ${symbol} per 1M ${esc(c.symbol)} ` +
          `(verified across ${pr.samples} recipients in this tx). ` +
          `Received ${recStr} from it.\n\nSend "trace" for the full route.`
      }
      const tk = c ? ` (its token() returns ${esc(c.symbol)})` : ""
      const why = stale
        ? `\n\nThis payout is from ${tsET(r.timestamp)} — Finch indexes from ~Sep 3, so earlier receipts aren't shown.`
        : cands.length
          ? `\n\nNot pro-rata to current ${c ? esc(c.symbol) : symbol} holdings. ${symbol}-paired tokens this wallet has touched: ` +
            cands.slice(0, 5).map(x => esc(x.symbol)).join(", ") + `.`
          : `\n\nNot pro-rata to current holdings; why this wallet is a recipient isn't on-chain-readable.`
      return `This wallet received ${amt} ${symbol} from contract ${shortAddr(D)}${tk}, ` +
        `1 of ${n} recipients in tx ${shortTx(r.txHash)}.${recN > 1 ? ` Received ${recStr} from it.` : ""}${why}` +
        `\n\nSend "trace" for the route.`
    }

    // ---- trace ----
    const kw = await txCall(r.txHash).catch(() => null)
    const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11"
    const via = kw
      ? kw.to === MULTICALL3 ? `keeper ${shortAddr(kw.from)} → Multicall3 → ` : `${shortAddr(kw.from)} → `
      : ""

    let body: string
    if (pr?.proRata && c) {
      // sample rows: wallet + up to 3 co-recipients, with held/received
      const sampleRows = batch
        .filter(b => b.to.toLowerCase() !== r.to.toLowerCase())
        .slice(0, 3)
      const lines = [
        `  ${shortAddr(r.to)}  got ${amt} ${symbol}${heldT ? `  ·  holds ${heldT} ${esc(c.symbol)}` : ""}`,
        ...sampleRows.map(b => `  ${shortAddr(b.to)}  got ${human(b.amount, r.token)} ${symbol}`),
      ].join("\n")
      body =
        `<b>MECHANISM</b> — ${esc(c.symbol)} pays ${symbol} to holders, pro-rata\n\n` +
        `  ${via}${shortAddr(D)}  (contract with token()=${esc(c.symbol)}, quoteToken()=${symbol})\n` +
        (c.refsPoolManager
          ? `    its logic references the Uniswap V4 PoolManager (${shortAddr(POOL_MANAGER)}) — where ${esc(c.symbol)}'s pool fees accrue in ${symbol}\n`
          : "") +
        `    → ${symbol} to ${n} ${esc(c.symbol)} holders this round\n` +
        `    rate: ~${pr.perMillion!.toFixed(4)} ${symbol} per 1M ${esc(c.symbol)} · verified across ${pr.samples} recipients\n` +
        `    contract holds ${c.distributorHolds ? human(c.distributorHolds, r.token, 2) : "0"} ${symbol}` +
        (c.functions.length ? ` · exposes ${[...new Set(c.functions.map(f => f.split("(")[0] + "()"))].join(", ")}` : "") + `\n\n` +
        lines + `\n\n` +
        (c.description ? `${esc(c.symbol)} About (on-chain, immutable): "${esc(c.description)}"\n\n` : "") +
        `Recurring — ${recStr}` + (recTx.length ? `, first at block ${parseInt(recTx[0].block, 10)}` : "") + `.`
    } else {
      const list = cands.slice(0, 5).map(x => `  ${esc(x.symbol)}  ${x.address}`).join("\n")
      const reason = stale
        ? `This payout is from ${tsET(r.timestamp)} — Finch indexes from ~Sep 3, so any earlier receipts aren't shown.`
        : `Payouts in this tx are not pro-rata to current ${c ? esc(c.symbol) : "token"} holdings` +
          (pr ? ` (checked ${pr.samples} recipients)` : "") +
          `. Why this wallet is a recipient is not on-chain-readable.`
      body =
        `<b>NOT CONFIRMED</b>\n\n` +
        `Contract ${D}${c ? ` has token()=${esc(c.symbol)}, quoteToken()=${symbol}` : ""}. ${reason}\n\n` +
        (cands.length ? `${symbol}-paired tokens this wallet has touched (correlation only):\n${list}\n\n` : "") +
        `Recurring — ${recStr}.`
    }

    return `<b>FACT</b>\n` +
      `  ${amt} ${symbol} received — 1 of ${n} recipients in one tx\n` +
      `  from  ${D}\n` +
      `  tx    ${r.txHash}\n\n` +
      body + `\n\n` +
      `data: The Graph-derived Goldsky subgraph (Pons factory + Uniswap V4 PoolManager) + on-chain reads · Robinhood Chain 4663 · this endpoint is live on the Bazantic gateway`
  }

  // Non-canonical category — deterministic base; LLM only rephrases if configured.
  const src = r.fromLabel ? esc(r.fromLabel) : "another wallet"
  const base = `This wallet received ${amt} ${symbol} from ${src}${p.wantsTrace ? `\n\nTx: ${r.txHash}\nFrom: ${r.from}` : ""}.`
  if (!llmAvailable() || p.wantsTrace) return base
  try {
    return esc(await chat(
      "Rewrite the fact as one plain sentence for a non-technical user. Refer to the address " +
      "as \"the wallet\", never \"you\". Do not add advice, speculation, or any value not " +
      "present. Keep the token amount and symbol exactly.",
      base,
    ))
  } catch { return base }
}

function formatLaunches(p: Parsed, rows: LaunchRow[]): string {
  const pairScope = p.pairGroup === "pons25" ? " paired vs a Pons25 stock token"
    : p.pairGroup === "finchtop" ? " paired vs a token Finch tracks"
    : p.pairFilter ? ` paired vs ${pairLabel(p.pairFilter)}`
    : ""
  const noun = p.onlyGraduated ? "graduated Pons tokens (now on Uniswap V4)" : "recent Pons launches"
  if (rows.length === 0) {
    return (p.pairFilter || p.pairGroup || p.onlyGraduated)
      ? `No ${noun}${pairScope} in the indexed range.`
      : "No Pons launches in that window (in the indexed range)."
  }
  // single-symbol filter → tight list (5); broad views → 10
  const shown = rows.slice(0, p.pairFilter ? 5 : 10)
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
    "\nFilter: a token symbol, \"Pons25\", or \"FinchTop\" (tokens Finch tracks). Add \"graduated\" for Uniswap V4 pools only."
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
