import { sql } from "./db.js"
import type { Parsed } from "./extract.js"
import { PONS25 } from "./pons25.js"
import { TOKENS } from "./tokens.js"

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
  | { kind: "wallet"; walletIndexed: boolean; transfers: TransferRow[]; via: "substreams" }
  | { kind: "launches"; launches: LaunchRow[] }
  | { kind: "graduated"; launch: LaunchRow | null }
  | { kind: "unknown" }

const TRANSFER_COLS =
  `token, "from", "to", amount, from_label as "fromLabel", to_label as "toLabel", ` +
  `tx_hash as "txHash", block::text as block, timestamp::text as timestamp`

const LAUNCH_SELECT = `
  select l.token,
         l.deployer as creator,
         l.pair_token as "pairToken",
         (g.token is not null) as graduated,
         g.tx_hash as "graduationTx",
         g.timestamp::text as "graduationTimestamp",
         l.timestamp::text as timestamp,
         l.tx_hash as "txHash"
  from tokenlaunch l
  left join lateral (
    select gg.token as token, gg.tx_hash, gg.timestamp from graduation gg
    where lower(gg.token) = lower(l.token)
    order by (gg.kind = 'PoolGraduated') desc, gg.block asc
    limit 1
  ) g on true`

export async function runQuery(p: Parsed): Promise<QueryResult> {
  if (p.intent === "wallet" && p.wallet) {
    const w = p.wallet.toLowerCase()
    const params: unknown[] = [w]
    let where = `lower("to") = $1`
    if (p.token) { params.push(p.token.toLowerCase()); where += ` and lower(token) = $2` }
    const transfers = await sql<TransferRow>(
      `select ${TRANSFER_COLS} from transfer where ${where} order by block desc limit 25`, params,
    )
    if (transfers.length) return { kind: "wallet", walletIndexed: true, transfers, via: "substreams" }
    const [{ e }] = await sql<{ e: boolean }>(
      `select exists(select 1 from transfer where lower("to") = $1 or lower("from") = $1) as e`, [w],
    )
    return { kind: "wallet", walletIndexed: e, transfers: [], via: "substreams" }
  }

  if (p.intent === "launches") {
    const since = p.sinceHours ? Math.floor(Date.now() / 1000) - p.sinceHours * 3600 : 0
    const groupSet = p.pairGroup === "pons25" ? PONS25.map(r => r.address.toLowerCase())
      : p.pairGroup === "finchtop" ? Object.keys(TOKENS).map(a => a.toLowerCase())
      : null
    const params: unknown[] = [since.toString()]
    const conds = [`l.timestamp >= $1`]
    if (p.pairFilter) { params.push(p.pairFilter.toLowerCase()); conds.push(`lower(l.pair_token) = $${params.length}`) }
    if (groupSet) { params.push(groupSet); conds.push(`lower(l.pair_token) = any($${params.length})`) }
    if (p.onlyGraduated) conds.push(`g.token is not null`)
    const rows = await sql<LaunchRow>(
      `${LAUNCH_SELECT} where ${conds.join(" and ")} order by l.timestamp desc limit 12`, params,
    )
    return { kind: "launches", launches: rows }
  }

  if (p.intent === "graduated" && p.token) {
    const rows = await sql<LaunchRow>(
      `${LAUNCH_SELECT} where lower(l.token) = lower($1) limit 1`, [p.token],
    )
    return { kind: "graduated", launch: rows[0] ?? null }
  }

  return { kind: "unknown" }
}
