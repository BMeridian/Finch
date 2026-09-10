import { sql } from "./db.js"
import type { QueryResult, TransferRow } from "./query.js"
import type { Parsed } from "./extract.js"

// ENS enrichment — opt-in drill-down on a wallet answer (parsed.wantsEns).
//
// Takes every wallet that appears in the trace — the query wallet plus the
// co-recipients in the same epoch batch — and looks them up against the
// canonical mainnet ENS subgraph on The Graph Network (forward records: names
// that point AT an address). Same subgraph recipes/ens-enrich.mjs reaches by
// chaining the subgraph MCP; the bot queries the gateway directly for latency.
//
// Only addresses that resolve are returned — name + shortened hex. Unnamed
// addresses are dropped (the distributor / FeeEscrow are Robinhood Chain
// contracts and never carry a .eth).

const ENS_SUBGRAPH_ID = "5XqPmWe6gjyrJtFn9cLy237i4cWw2j9HcUJEXsP5qGtH"
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const shortHex = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`
const isFeeSettlement = (r: TransferRow) => /fee claim|fee settlement|feeescrow/i.test(r.fromLabel ?? "")

export async function resolveEns(addrs: string[]): Promise<Record<string, string[]>> {
  const key  = process.env.GRAPH_QUERY_KEY
  const list = [...new Set(addrs.map(a => a.toLowerCase()))].filter(a => /^0x[0-9a-f]{40}$/.test(a)).slice(0, 200)
  if (!key || !list.length) return {}
  const query = `{ domains(first: 500, where: { resolvedAddress_in: ${JSON.stringify(list)} }) { name resolvedAddress { id } } }`
  try {
    const body = await fetch(`https://gateway.thegraph.com/api/${key}/subgraphs/id/${ENS_SUBGRAPH_ID}`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) },
    ).then(r => r.json())
    const names: Record<string, string[]> = {}
    for (const d of body?.data?.domains ?? []) {
      const a = d.resolvedAddress?.id?.toLowerCase()
      if (a && d.name) (names[a] ??= []).push(d.name)
    }
    return names
  } catch { return {} }
}

export async function ensBlock(p: Parsed, q: Extract<QueryResult, { kind: "wallet" }>): Promise<string> {
  if (!p.wallet || !q.transfers.length) return ""
  const wallet = p.wallet.toLowerCase()

  const r = q.transfers.find(isFeeSettlement) ?? q.transfers.find(t => t.fromLabel) ?? q.transfers[0]
  const froms = [...new Set(q.transfers.map(t => t.from.toLowerCase()))]

  // the epoch batch: everyone paid by the same distributor in the same tx
  const batch = isFeeSettlement(r)
    ? await sql<{ to: string }>(
        `select "to" from q_transfer where lower(tx_hash) = lower($1) and lower("from") = lower($2) limit 1000`,
        [r.txHash, r.from],
      ).then(d => d.map(x => x.to.toLowerCase())).catch(() => [] as string[])
    : []

  const names = await resolveEns([wallet, ...froms, ...batch])
  const fmt = (list: string[]) => esc(list.slice(0, 3).join(", ") + (list.length > 3 ? ` +${list.length - 3}` : ""))

  const rows: string[] = []
  if (names[wallet]) rows.push(`  ${fmt(names[wallet])}  ${shortHex(wallet)}  (this wallet)`)
  for (const a of batch) {
    if (a !== wallet && names[a]) rows.push(`  ${fmt(names[a])}  ${shortHex(a)}  (in the batch)`)
  }
  for (const a of froms) {
    if (a !== wallet && names[a]) rows.push(`  ${fmt(names[a])}  ${shortHex(a)}  (payer)`)
  }

  if (!rows.length) {
    return `\n\n<b>ENS</b>: no wallet in this trace has a mainnet name` +
      (batch.length ? ` (checked ${batch.length + 1})` : "") + `.`
  }
  const scope = batch.length ? `${batch.length + froms.length + 1} addresses` : `${froms.length + 1} addresses`
  return `\n\n<b>ENS NAMES FOUND</b> (${scope} checked against The Graph's ENS subgraph):\n${rows.join("\n")}`
}
