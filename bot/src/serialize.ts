import { gql, gqlOn } from "./subgraph.js"
import { human, tokenMeta } from "./tokens.js"
import { candidatesFor } from "./candidates.js"
import { resolveDistributors, describeMany, verifyProRata } from "./distributor.js"
import type { Parsed } from "./extract.js"
import type { QueryResult, TransferRow } from "./query.js"

// JSON serialization for the Bazantic Gateway. Same query results as the prose
// path — this is a second serializer, not a second computation. An agent
// consuming this must not be able to mistake a correlational lead for a cause,
// hence the fixed `caveat` and `confidence` fields.

const CONFIDENCE = "signal only - not a recommendation"
const DATA_SOURCE = "The Graph-derived Goldsky subgraph (Pons launch factory + Uniswap V4 PoolManager), Robinhood Chain 4663; this API is also live on the Bazantic gateway"

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

  // The payer of this token IS the distributor — resolve it on-chain.
  const D = r.from
  const payers = [...new Set(q.transfers.filter(t => t.token === r.token).map(t => t.from))]
  const resolved = await resolveDistributors(payers, r.token, p.wallet).catch(() => [])
  const c = resolved.find(x => x.distributor === D.toLowerCase()) ?? resolved[0]

  // batch of this same tx from D → pro-rata test
  const batch = await gqlOn<{ t: { to: string; amount: string }[] }>(q.via,
    `query ($tx: Bytes!, $from: Bytes!) { t: transfers(where: { txHash: $tx, from: $from }, first: 1000) { to amount } }`,
    { tx: r.txHash, from: D },
  ).then(d => d.t).catch(() => [] as { to: string; amount: string }[])

  let pr = null as Awaited<ReturnType<typeof verifyProRata>> | null
  if (c && c.quoteToken === r.token && batch.length >= 3) {
    pr = await verifyProRata(c.token, p.wallet,
      batch.map(b => ({ addr: b.to, amount: BigInt(b.amount) }))).catch(() => null)
  }

  const corr = (await candidatesFor(r.to, r.token).catch(() => [] as { symbol: string; address: string }[]))
    .filter(x => !c || x.address.toLowerCase() !== c.token)
  const cdescs = corr.length ? await describeMany(corr.map(x => x.address)).catch(() => new Map<string, string>()) : new Map<string, string>()

  const mechanism = pr?.proRata && c ? {
    type: "pro_rata_holder_distribution",
    distributes: symbol,
    to_holders_of: { symbol: c.symbol, address: c.token, description: c.description || null },
    rate_per_million: Number(pr.perMillion!.toFixed(6)),
    rate_unit: `${symbol} per 1,000,000 ${c.symbol} per round`,
    wallet_holds: pr.walletBalance ? human(pr.walletBalance, c.token) : null,
    verified_across_recipients: pr.samples,
    payer_contract: D,
    references_v4_pool_manager: c.refsPoolManager,
    contract_holds_distributed_asset: c.distributorHolds ? human(c.distributorHolds, r.token) : null,
    confidence: "on-chain confirmed — received÷held is flat across sampled recipients in this tx",
  } : null

  return {
    wallet: p.wallet,
    event: {
      token_received: symbol,
      amount: human(r.amount, r.token),
      tx: r.txHash,
      paid_by_contract: D,
      recipients_in_tx: batch.length || rc || null,
      source_label: r.fromLabel ?? null,
    },
    recurring: {
      count: Math.max(1, blocks.length),
      first_seen_block: blocks[0] ?? parseInt(r.block, 10),
      most_recent_block: blocks[blocks.length - 1] ?? parseInt(r.block, 10),
    },
    mechanism,
    candidates: mechanism ? [] : corr.map(x => ({
      symbol: x.symbol, address: x.address,
      description: cdescs.get(x.address.toLowerCase()) ?? null,
      basis: `${symbol}-paired Uniswap V4 pool; this wallet has transferred it`,
      confidence: "correlational only",
    })),
    note: mechanism
      ? "Mechanism verified on-chain: the payer distributes the received asset pro-rata to holders of the named token."
      : `Contract ${D}${c ? ` has token()=${c.symbol}, quoteToken()=${symbol}` : ""} but the payouts in this tx are not pro-rata to holdings. Why this wallet is a recipient is not on-chain-readable. Candidates below are correlational only.`,
    data_source: DATA_SOURCE + " + on-chain reads (token/quoteToken/balanceOf)",
    confidence: CONFIDENCE,
  }
}
