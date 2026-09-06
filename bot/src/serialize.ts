import { gql, gqlOn } from "./subgraph.js"
import { human, tokenMeta } from "./tokens.js"
import { candidatesFor } from "./candidates.js"
import type { Parsed } from "./extract.js"
import type { QueryResult, TransferRow } from "./query.js"

// JSON serialization for the Bazantic Gateway. Same query results as the prose
// path — this is a second serializer, not a second computation. An agent
// consuming this must not be able to mistake a correlational lead for a cause,
// hence the fixed `caveat` and `confidence` fields.

const CONFIDENCE = "signal only - not a recommendation"
const CAVEAT =
  "Candidate tokens reflect trading-history overlap with NVDA-paired pools; no LP " +
  "or deployer activity found linking this wallet to them. Not a confirmed causal mechanism."
const DATA_SOURCE = "Goldsky-hosted subgraph (Graph protocol), Robinhood Chain 4663"

const isFeeSettlement = (r: TransferRow) => /fee claim|fee settlement|feeescrow/i.test(r.fromLabel ?? "")

export async function toJson(p: Parsed, q: QueryResult): Promise<Record<string, unknown>> {
  if (q.kind === "launches") {
    return {
      query: "pons_launches",
      pair_filter: p.pairFilter ?? (p.pairGroup === "pons25" ? "pons25" : null),
      since_hours: p.sinceHours ?? null,
      launches: q.launches.map(l => ({
        token: l.token, pair_token: l.pairToken, creator: l.creator,
        graduated: l.graduated, launched_at: Number(l.timestamp), tx: l.txHash,
      })),
      data_source: DATA_SOURCE + " (live window)",
      confidence: CONFIDENCE,
    }
  }
  if (q.kind === "graduated") {
    return {
      query: "token_graduation",
      token: p.token ?? null,
      launched: !!q.launch,
      graduated: q.launch?.graduated ?? false,
      graduated_at: q.launch?.graduationTimestamp ? Number(q.launch.graduationTimestamp) : null,
      graduation_tx: q.launch?.graduationTx ?? null,
      data_source: DATA_SOURCE,
      confidence: CONFIDENCE,
    }
  }
  if (q.kind !== "wallet" || !p.wallet) {
    return { error: "Provide a wallet address, or ask about Pons launches / graduations.", confidence: CONFIDENCE }
  }
  if (q.transfers.length === 0) {
    return {
      wallet: p.wallet, event: null, recurring: null, candidate_tokens: [],
      caveat: null, data_source: DATA_SOURCE, confidence: CONFIDENCE,
      note: q.walletIndexed
        ? `Wallet indexed but no ${p.tokenSymbol ?? "tracked-token"} transfers to it.`
        : "No indexed activity for this wallet in range.",
    }
  }

  const r = q.transfers.find(isFeeSettlement) ?? q.transfers.find(t => t.fromLabel) ?? q.transfers[0]
  const { symbol } = tokenMeta(r.token)

  // recurring: prior payouts to this wallet from the same source contract.
  // Always HISTORY — a "standing entitlement" count is inherently backward-looking
  // and the live window is too short to count against.
  const rec = await gql<{ t: { block: string }[] }>(
    `query ($w: String!, $src: Bytes!) {
      t: transfers(where: { to: $w, from: $src }, orderBy: block, orderDirection: asc, first: 1000) { block }
    }`, { w: p.wallet, src: r.from },
  ).then(d => d.t).catch(() => [] as { block: string }[])
  const blocks = rec.map(x => parseInt(x.block, 10)).sort((a, b) => a - b)

  // mechanism: recipient count of this exact payout tx — from whichever subgraph
  // the payout was found in.
  const rc = await gqlOn<{ c: { id: string }[] }>(q.via,
    `query ($tx: Bytes!, $src: Bytes!) { c: transfers(where: { txHash: $tx, from: $src }, first: 1000) { id } }`,
    { tx: r.txHash, src: r.from },
  ).then(d => d.c.length).catch(() => 0)

  const cands = await candidatesFor(r.to, r.token).catch(() => [] as { symbol: string; address: string }[])
  const candidate_tokens = cands.map(c => ({ symbol: c.symbol, address: c.address, confidence: "correlational only" }))

  return {
    wallet: p.wallet,
    event: {
      token_received: symbol,
      amount: human(r.amount, r.token),
      tx: r.txHash,
      source_label: r.fromLabel ?? null,
      mechanism: isFeeSettlement(r)
        ? `batched Multicall3 payout, 1 of ${rc || "?"} recipients`
        : "direct transfer",
    },
    recurring: {
      count: Math.max(1, blocks.length),
      first_seen_block: blocks[0] ?? parseInt(r.block, 10),
      most_recent_block: blocks[blocks.length - 1] ?? parseInt(r.block, 10),
    },
    candidate_tokens,
    caveat: candidate_tokens.length ? CAVEAT : null,
    data_source: DATA_SOURCE,
    confidence: CONFIDENCE,
  }
}
