// One-time: seed the Neon Postgres (Substreams sink target) with historical
// rows from the Goldsky subgraph, for the window the pure-Substreams live path
// has not backfilled yet. Live indexing stays Substreams; this fills the gap
// while Pinax is degraded.
//
//   cd bot && SEED_MAX_BLOCK=58436370 node --env-file=../.env scripts/seed-from-goldsky.mjs
//
// Streams page-by-page (fetch a page -> insert it -> next), short-lived queries
// via a Pool, so no long transaction for Neon to time out.
//
// Writes to the *_s tables, NOT the sink's tables: `substreams sink postgres`
// WIPES its tables on any cursorless start, so seed + sink must not share tables.
// db.ts reads the `q_*` views (sink table UNION ALL *_s). The sink owns blocks
// >= SEED_MAX_BLOCK (finch-sink.service --start-block); this owns blocks below.

import { Pool } from "pg"

const HISTORY = process.env.SUBGRAPH_QUERY_URL
const DSN     = process.env.DATABASE_URL
const SEED_MAX_BLOCK = Number(process.env.SEED_MAX_BLOCK || 53505176)
// SEED_WALLETS set -> scoped transfer seed (Neon free tier is 512MB; a full
// transfer index does not fit). All launches/pools/graduations are still seeded
// (small); transfers are limited to these wallets + the full recipient set of
// every tx that paid them. Unset -> full transfer seed.
const SEED_WALLETS = (process.env.SEED_WALLETS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
if (!HISTORY || !DSN) { console.error("need SUBGRAPH_QUERY_URL + DATABASE_URL in ../.env"); process.exit(1) }

const pool = new Pool({ connectionString: DSN, max: 4, keepAlive: true, idleTimeoutMillis: 0 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const retry = async (fn, label) => {
  for (let i = 1; ; i++) {
    try { return await fn() }
    catch (e) { if (i >= 6) throw e; console.error(`\n  retry ${label} (${i}): ${e.message || e}`); await sleep(1000 * i) }
  }
}
const q = (text, params) => retry(() => pool.query(text, params), "pg")

const gql = (query, variables) => retry(async () => {
  const r = await fetch(HISTORY, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables }) })
  const j = await r.json()
  if (j.errors) throw new Error(JSON.stringify(j.errors))
  if (!j.data) throw new Error(`no data: ${JSON.stringify(j).slice(0, 200)}`)
  return j.data
}, "gql")

const n  = x => (x === null || x === undefined ? null : String(x))
const lc = x => (x ? String(x).toLowerCase() : x)

// page an entity by id_gt, blocks < max; hand each page to `onPage`
async function stream(field, selection, onPage, blockField = "block") {
  let after = "", total = 0
  for (;;) {
    const d = await gql(
      `query ($after: ID!, $mb: BigInt!) { rows: ${field}(first: 1000, orderBy: id, where: { id_gt: $after, ${blockField}_lt: $mb }) { ${selection} } }`,
      { after, mb: String(SEED_MAX_BLOCK) })
    const rows = d.rows ?? []
    if (!rows.length) break
    await onPage(rows)
    total += rows.length
    process.stdout.write(`\r  ${field}: ${total}`)
    after = rows[rows.length - 1].id
    if (rows.length < 1000) break
  }
  process.stdout.write(`\r  ${field}: ${total}\n`)
  return total
}

// multi-row insert helper: cols[], rows[][] -> one INSERT
async function insertMany(table, cols, rows) {
  if (!rows.length) return
  const ph = rows.map((_, i) => `(${cols.map((__, k) => `$${i * cols.length + k + 1}`).join(",")})`).join(",")
  await q(`insert into ${table} (${cols.join(",")}) values ${ph}`, rows.flat())
}

const TCOLS = ["_block_number_", "_block_timestamp_", "token", '"from"', '"to"', "amount", "from_label", "to_label", "block", "timestamp", "tx_hash"]
const trow = t => [Number(t.block), new Date(Number(t.timestamp) * 1000), lc(t.token), lc(t.from), lc(t.to), n(t.amount), t.fromLabel ?? null, t.toLabel ?? null, n(t.block), n(t.timestamp), lc(t.txHash)]
const insTransfers = async rows => { for (let i = 0; i < rows.length; i += 500) await insertMany("transfer_s", TCOLS, rows.slice(i, i + 500).map(trow)) }

// scoped: transfers TO/FROM the wallets, then the full recipient set of every
// tx+payer that paid them (so "1 of N recipients" and batch queries are correct)
async function seedScopedTransfers() {
  const TSEL = "id token from to amount fromLabel toLabel txHash block timestamp"
  const pairs = new Set(), seenIds = new Set()
  for (const w of SEED_WALLETS) {
    for (const dir of ["to", "from"]) {
      let after = ""
      for (;;) {
        const d = await gql(`query ($a: ID!, $w: Bytes!) { rows: transfers(first: 1000, orderBy: id, where: { id_gt: $a, ${dir}: $w }) { ${TSEL} } }`, { a: after, w })
        const rows = d.rows ?? []
        if (!rows.length) break
        const fresh = rows.filter(r => !seenIds.has(r.id))
        fresh.forEach(r => { seenIds.add(r.id); pairs.add(`${r.txHash}|${lc(r.from)}`) })
        await insTransfers(fresh)
        after = rows[rows.length - 1].id
        if (rows.length < 1000) break
      }
    }
  }
  process.stdout.write(`  wallet transfers: ${seenIds.size}, expanding ${pairs.size} tx/payer batches\n`)
  // batch by txHash_in (100 at a time) to keep round-trips low — a long loop of
  // tiny queries lets Neon's free-tier compute autosuspend mid-run
  const txs = [...new Set([...pairs].map(p => p.split("|")[0]))]
  for (let i = 0; i < txs.length; i += 100) {
    const chunk = txs.slice(i, i + 100)
    let after = ""
    for (;;) {
      const d = await gql(`query ($a: ID!, $txs: [Bytes!]) { rows: transfers(first: 1000, orderBy: id, where: { id_gt: $a, txHash_in: $txs }) { ${TSEL} } }`, { a: after, txs: chunk })
      const all = d.rows ?? []
      const rows = all.filter(r => !seenIds.has(r.id))
      rows.forEach(r => seenIds.add(r.id))
      await insTransfers(rows)
      if (all.length < 1000) break
      after = all[all.length - 1].id
    }
  }
  process.stdout.write(`  transfers total: ${seenIds.size}\n`)
}

async function main() {
  await q("truncate transfer_s, tokenlaunch_s, graduation_s, poolinitialize_s")
  console.log(`seeding from Goldsky, blocks < ${SEED_MAX_BLOCK}${SEED_WALLETS.length ? ` (scoped to ${SEED_WALLETS.length} wallets)` : ""}…`)

  if (SEED_WALLETS.length) await seedScopedTransfers()
  else await stream("transfers", "id token from to amount fromLabel toLabel txHash block timestamp", insTransfers)

  await stream("tokenLaunches", "id token curve creator pairToken graduationThreshold block timestamp txHash graduated graduationTx graduationTimestamp", async rows => {
    await insertMany("tokenlaunch_s",
      ["_block_number_", "_block_timestamp_", "token", "curve", "deployer", "pair_token", "graduation_threshold", "block", "timestamp", "tx_hash"],
      rows.map(l => [Number(l.block), new Date(Number(l.timestamp) * 1000), lc(l.token), lc(l.curve), lc(l.creator), lc(l.pairToken), n(l.graduationThreshold), n(l.block), n(l.timestamp), lc(l.txHash)]))
    const grads = rows.filter(l => l.graduated)
    await insertMany("graduation_s",
      ["_block_number_", "_block_timestamp_", "token", "kind", "amount", "block", "timestamp", "tx_hash"],
      grads.map(l => {
        // Goldsky gives graduationTimestamp (unix s) but no graduation block —
        // use the launch block for _block_number_/block (bounded, keeps ordering)
        const gt = l.graduationTimestamp ?? l.timestamp
        return [Number(l.block), new Date(Number(gt) * 1000), lc(l.token), "PoolGraduated", null, n(l.block), n(gt), lc(l.graduationTx ?? l.txHash)]
      }))
  })

  await stream("pools", "id token currency0 currency1 hook fee tickSpacing createdAtBlock", async rows => {
    await insertMany("poolinitialize_s",
      ["_block_number_", "_block_timestamp_", "pool_id", "currency0", "currency1", "token", "hook", "fee", "tick_spacing", "block", "timestamp", "tx_hash"],
      rows.map(p => [Number(p.createdAtBlock), new Date(0), lc(p.id), lc(p.currency0), lc(p.currency1), lc(p.token), lc(p.hook), p.fee ?? null, p.tickSpacing ?? null, n(p.createdAtBlock), null, null]))
  }, "createdAtBlock")

  const c = await q("select (select count(*) from transfer_s) t, (select count(*) from tokenlaunch_s) l, (select count(*) from graduation_s) g, (select count(*) from poolinitialize_s) p")
  console.log("seeded:", c.rows[0])
  await pool.end()
}
main().catch(async e => { console.error("\n", e.message || e); await pool.end().catch(() => {}); process.exit(1) })
