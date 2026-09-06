import { gql } from "./subgraph.js"
import type { Parsed } from "./extract.js"

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
  | { kind: "wallet"; walletIndexed: boolean; transfers: TransferRow[] }
  | { kind: "launches"; launches: LaunchRow[] }
  | { kind: "graduated"; launch: LaunchRow | null }
  | { kind: "unknown" }

export async function runQuery(p: Parsed): Promise<QueryResult> {
  if (p.intent === "wallet" && p.wallet) {
    const where = p.token ? `{ to: $w, token: $tok }` : `{ to: $w }`
    const d = await gql<{ wallet: { id: string } | null; transfers: TransferRow[] }>(
      `query ($w: String!, $tok: Bytes) {
        wallet(id: $w) { id }
        transfers(where: ${where}, orderBy: block, orderDirection: desc, first: 25) {
          token from to amount fromLabel toLabel txHash block timestamp
        }
      }`, p.token ? { w: p.wallet, tok: p.token } : { w: p.wallet })
    return { kind: "wallet", walletIndexed: !!d.wallet, transfers: d.transfers }
  }

  if (p.intent === "launches") {
    const since = p.sinceHours ? Math.floor(Date.now() / 1000) - p.sinceHours * 3600 : 0
    const d = await gql<{ tokenLaunches: LaunchRow[] }>(
      `query ($since: BigInt!) {
        tokenLaunches(where: { timestamp_gte: $since }, orderBy: timestamp, orderDirection: desc, first: 10) {
          token creator pairToken graduated graduationTimestamp timestamp txHash
        }
      }`, { since: since.toString() })
    return { kind: "launches", launches: d.tokenLaunches }
  }

  if (p.intent === "graduated" && p.token) {
    const d = await gql<{ tokenLaunch: LaunchRow | null }>(
      `query ($t: ID!) {
        tokenLaunch(id: $t) {
          token creator pairToken graduated graduationTx graduationTimestamp timestamp txHash
        }
      }`, { t: p.token })
    return { kind: "graduated", launch: d.tokenLaunch }
  }

  return { kind: "unknown" }
}
