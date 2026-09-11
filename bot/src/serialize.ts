import { sql } from "./db.js"
import { human, tokenMeta } from "./tokens.js"
import { candidatesFor } from "./candidates.js"
import { resolveDistributors } from "./distributor.js"
import type { Parsed } from "./extract.js"
import type { QueryResult, TransferRow } from "./query.js"

// JSON serialization for the Bazantic Gateway. Same query results as the prose
// path — this is a second serializer, not a second computation. An agent
// consuming this must not be able to mistake a correlational lead for a cause,
// hence the fixed `caveat` and `confidence` fields.

const CONFIDENCE = "signal only - not a recommendation"
const DATA_SOURCE = "Substreams pipeline (StreamingFast endpoint, Robinhood Chain 4663) → Postgres: Pons launch factory + Uniswap V4 PoolManager + stock-token transfers; this API is also live on the Bazantic gateway"

const isFeeSettlement = (r: TransferRow) => /fee claim|fee settlement|feeescrow/i.test(r.fromLabel ?? "")

export async function toJson(p: Parsed, q: QueryResult): Promise<Record<string, unknown>> {
  if (q.kind === "launches") {
    return {
      query: "pons_launches",
      pair_filter: p.pairFilter ?? p.pairGroup ?? null,
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
  const rec = await sql<{ block: string }>(
    `select block::text as block from transfer where lower("to") = lower($1) and lower("from") = lower($2) order by block asc limit 1000`,
    [p.wallet, r.from],
  ).catch(() => [] as { block: string }[])
  const blocks = rec.map(x => parseInt(x.block, 10)).sort((a, b) => a - b)

  // mechanism: recipient count of this exact payout tx.
  const rc = await sql<{ id: string }>(
    `select tx_hash as id from transfer where lower(tx_hash) = lower($1) and lower("from") = lower($2) limit 1000`,
    [r.txHash, r.from],
  ).then(d => d.length).catch(() => 0)

  // The payer of this token IS the distributor — resolve it on-chain.
  const D = r.from
  const payers = [...new Set(q.transfers.filter(t => t.token === r.token).map(t => t.from))]
  const resolved = await resolveDistributors(payers, r.token, p.wallet).catch(() => [])
  const c = resolved.find(x => x.distributor === D.toLowerCase()) ?? resolved[0]

  // recipients of this same tx from D
  const batch = await sql<{ to: string; amount: string }>(
    `select "to", amount from transfer where lower(tx_hash) = lower($1) and lower("from") = lower($2) limit 1000`,
    [r.txHash, D],
  ).catch(() => [] as { to: string; amount: string }[])

  const corr = (await candidatesFor(r.to, r.token).catch(() => [] as { symbol: string; address: string }[]))
    .filter(x => !c || x.address.toLowerCase() !== c.token)

  // Path is confirmed when D's quoteToken() is the asset it paid — D distributes
  // the fee currency of c.token's Uniswap V4 pool. Route only; recipient
  // selection each epoch is claim-gated and D's logic contract is unverified.
  const onPath = !!(c && c.quoteToken === r.token)
  const path = onPath && c ? {
    type: "pons_holder_fee_distribution",
    distributes: symbol,
    fee_pool_token: { symbol: c.symbol, address: c.token, description: c.description || null },
    distributor_registered_in_manager: c.managerRegistered,
    route: [
      `${c.symbol} / ${symbol} Uniswap V4 pool (Pons Meme Hook) — ${c.symbol}'s creator-fee cut is taken in ${symbol}`,
      `Pons FeeEscrow 0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e`,
      c.managerRegistered
        ? `Pons holder-fee distributor ${D} (PonsHolderFeeManager.distributorOf(${c.symbol}) == this; quoteToken()=${symbol}${c.epochs ? `, epochCount()=${c.epochs}` : ""})`
        : `per-token fee distributor ${D} (token()=${c.symbol}, quoteToken()=${symbol}${c.epochs ? `, epochCount()=${c.epochs}` : ""})`,
      `epoch batch → this wallet + ${batch.length || "many"} others`,
    ],
    epoch_count: c.epochs ?? null,
    distributor_functions: c.functions,
    references_v4_pool_manager: c.refsPoolManager,
    recipient_selection: "not on-chain-readable — claim-gated, per epoch; distributor's distribution logic is unverified source",
  } : null

  return {
    wallet: p.wallet,
    event: {
      token_received: symbol,
      amount: human(r.amount, r.token),
      tx: r.txHash,
      block: parseInt(r.block, 10),
      received_at: new Date(Number(r.timestamp) * 1000).toISOString(),
      age_seconds: Math.max(0, Math.floor(Date.now() / 1000) - Number(r.timestamp)),
      paid_by_contract: D,
      recipients_in_tx: batch.length || rc || null,
      batch_recipients: batch.length ? batch.map(x => x.to) : null,
      source_label: r.fromLabel ?? null,
    },
    recurring: {
      count: Math.max(1, blocks.length),
      first_seen_block: blocks[0] ?? parseInt(r.block, 10),
      most_recent_block: blocks[blocks.length - 1] ?? parseInt(r.block, 10),
    },
    path,
    candidates: path ? [] : corr.map(x => ({
      symbol: x.symbol, address: x.address,
      basis: `${symbol}-paired Uniswap V4 pool; this wallet has transferred it`,
      confidence: "correlational only",
    })),
    note: path
      ? "Route confirmed on-chain: the payer distributes the received asset, which is the fee currency of the named token's Uniswap V4 pool. Why this wallet is in this epoch's batch is not on-chain-readable."
      : `Contract ${D}${c ? ` has token()=${c.symbol}, quoteToken()=${c.quoteToken}` : ""}; its quoteToken() is not ${symbol}, so the fee-pool path can't be confirmed. Why this wallet is a recipient is not on-chain-readable. Candidates below are correlational only.`,
    data_source: DATA_SOURCE + " + on-chain reads (token/quoteToken/epochCount)",
    confidence: CONFIDENCE,
  }
}
