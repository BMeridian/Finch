import { gqlOn } from "./subgraph.js"
import type { Parsed } from "./extract.js"
import { PONS25 } from "./pons25.js"

export interface TransferRow {
  token: string; from: string; to: string; amount: string
  fromLabel: string | null; toLabel: string | null
  txHash: string; block: string; timestamp: string
}
export interface LaunchRow {
  token: string; creator: string; pairToken: string | null
  graduated: boolean; graduationTx: string | null; graduationTimestamp: string | null
  timestamp: string; txHash: string
}

export type QueryResult =
  | { kind: "wallet"; walletIndexed: boolean; transfers: TransferRow[]; via: "history" | "live" }
  | { kind: "launches"; launches: LaunchRow[] }
  | { kind: "graduated"; launch: LaunchRow | null }
  | { kind: "unknown" }

const WALLET_Q = (where: string) => `query ($w: String!, $tok: Bytes) {
  wallet(id: $w) { id }
  transfers(where: ${where}, orderBy: block, orderDirection: desc, first: 25) {
    token from to amount fromLabel toLabel txHash block timestamp
  }
}`

export async function runQuery(p: Parsed): Promise<QueryResult> {
  if (p.intent === "wallet" && p.wallet) {
    const where = p.token ? `{ to: $w, token: $tok }` : `{ to: $w }`
    const vars = p.token ? { w: p.wallet, tok: p.token } : { w: p.wallet }
    // LIVE first — a just-landed payout is fresh there. Fall back to HISTORY
    // for wallets whose only activity predates the live window (the demo case).
    const live = await gqlOn<{ wallet: { id: string } | null; transfers: TransferRow[] }>("live", WALLET_Q(where), vars).catch(() => null)
    if (live && live.transfers.length) return { kind: "wallet", walletIndexed: true, transfers: live.transfers, via: "live" }
    const hist = await gqlOn<{ wallet: { id: string } | null; transfers: TransferRow[] }>("history", WALLET_Q(where), vars)
    return { kind: "wallet", walletIndexed: !!hist.wallet || !!live?.wallet, transfers: hist.transfers, via: "history" }
  }

  if (p.intent === "launches") {
    const since = p.sinceHours ? Math.floor(Date.now() / 1000) - p.sinceHours * 3600 : 0
    const pons25Set = p.pairGroup === "pons25" ? PONS25.map(r => r.address) : null
    const filter = [
      `timestamp_gte: $since`,
      p.pairFilter ? `pairToken: $pf` : "",
      pons25Set ? `pairToken_in: $p25` : "",
      p.onlyGraduated ? `graduated: true` : "",
    ].filter(Boolean).join(", ")
    const q = `query ($since: BigInt!, $pf: Bytes, $p25: [Bytes!]) {
      tokenLaunches(where: { ${filter} }, orderBy: timestamp, orderDirection: desc, first: 12) {
        token creator pairToken graduated graduationTimestamp timestamp txHash
      }
    }`
    const vars: Record<string, unknown> = { since: since.toString() }
    if (p.pairFilter) vars.pf = p.pairFilter
    if (pons25Set) vars.p25 = pons25Set

    // Graduations are rare historical events — the deep index has the full set,
    // so query BOTH and merge (live catches the newest, history the rest).
    if (p.onlyGraduated) {
      const [live, hist] = await Promise.all([
        gqlOn<{ tokenLaunches: LaunchRow[] }>("live", q, vars).catch(() => ({ tokenLaunches: [] as LaunchRow[] })),
        gqlOn<{ tokenLaunches: LaunchRow[] }>("history", q, { ...vars, since: "0" }).catch(() => ({ tokenLaunches: [] as LaunchRow[] })),
      ])
      const seen = new Set<string>()
      const merged = [...live.tokenLaunches, ...hist.tokenLaunches]
        .filter(l => !seen.has(l.token) && seen.add(l.token))
        .sort((a, b) => Number(b.graduationTimestamp ?? b.timestamp) - Number(a.graduationTimestamp ?? a.timestamp))
      return { kind: "launches", launches: merged.slice(0, 12) }
    }

    const live = await gqlOn<{ tokenLaunches: LaunchRow[] }>("live", q, vars).catch(() => ({ tokenLaunches: [] as LaunchRow[] }))
    const filtered = !!(p.pairFilter || pons25Set)
    if (live.tokenLaunches.length >= (filtered ? 1 : 3) || since > 0) return { kind: "launches", launches: live.tokenLaunches }
    const hist = await gqlOn<{ tokenLaunches: LaunchRow[] }>("history", q, { ...vars, since: "0" })
    const seen = new Set(live.tokenLaunches.map(l => l.token))
    return { kind: "launches", launches: [...live.tokenLaunches, ...hist.tokenLaunches.filter(l => !seen.has(l.token))].slice(0, 12) }
  }

  if (p.intent === "graduated" && p.token) {
    const q = `query ($t: ID!) {
      tokenLaunch(id: $t) { token creator pairToken graduated graduationTx graduationTimestamp timestamp txHash }
    }`
    const live = await gqlOn<{ tokenLaunch: LaunchRow | null }>("live", q, { t: p.token }).catch(() => ({ tokenLaunch: null }))
    if (live.tokenLaunch) return { kind: "graduated", launch: live.tokenLaunch }
    const hist = await gqlOn<{ tokenLaunch: LaunchRow | null }>("history", q, { t: p.token })
    return { kind: "graduated", launch: hist.tokenLaunch }
  }

  return { kind: "unknown" }
}
