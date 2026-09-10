// One-time: seed the Neon Postgres (Substreams sink target) with historical
// rows from the Goldsky subgraph, for breadth the pure-Substreams live path
// will not backfill. Live indexing stays 100% Substreams; this only fills the
// window before the sink's start block.
//
//   cd bot && node --env-file=../.env scripts/seed-from-goldsky.mjs
//
// Clean block split, no dupes: this imports Goldsky rows for blocks < SEED_MAX_BLOCK
// only; the Substreams sink owns everything >= SEED_MAX_BLOCK. The sink tables have
// no PKs, so this TRUNCATEs the 4 data tables first (NOT the sink's _cursor_ /
// _blocks_ / _segments_). Run the Substreams sink from SEED_MAX_BLOCK afterwards.

import { Client } from "pg"

const HISTORY = process.env.SUBGRAPH_QUERY_URL
const LIVE    = process.env.SUBGRAPH_LIVE_URL || HISTORY
const DSN     = process.env.DATABASE_URL
const SEED_MAX_BLOCK = Number(process.env.SEED_MAX_BLOCK || 53505176)
if (!HISTORY || !DSN) { console.error("need SUBGRAPH_QUERY_URL + DATABASE_URL in ../.env"); process.exit(1) }

const gql = async (url, query, variables) => {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables }) })
  const j = await r.json()
  if (j.errors) throw new Error(JSON.stringify(j.errors))
  return j.data
}

// page an entity by id_gt (stable cursor), merging history + live, blocks < max
async function pageAll(field, selection, blockField = "block") {
  const seen = new Map()
  for (const url of [HISTORY, LIVE]) {
    let after = ""
    for (;;) {
      const q = `query ($after: ID!, $mb: BigInt!) { rows: ${field}(first: 1000, orderBy: id, where: { id_gt: $after, ${blockField}_lt: $mb }) { ${selection} } }`
      const d = await gql(url, q, { after, mb: String(SEED_MAX_BLOCK) }).catch(() => ({ rows: [] }))
      const rows = d.rows ?? []
      if (!rows.length) break
      for (const row of rows) seen.set(row.id, row)
      after = rows[rows.length - 1].id
      if (rows.length < 1000) break
    }
  }
  return [...seen.values()]
}

const n = x => (x === null || x === undefined ? null : String(x))
const lc = x => (x ? String(x).toLowerCase() : x)

async function main() {
  const db = new Client({ connectionString: DSN })
  await db.connect()

  console.log("fetching from Goldsky…")
  const [transfers, launches, pools] = await Promise.all([
    pageAll("transfers", "id token from to amount fromLabel toLabel txHash block timestamp"),
    pageAll("tokenLaunches", "id token curve creator pairToken graduationThreshold block timestamp txHash graduated graduationTx graduationTimestamp"),
    pageAll("pools", "id token currency0 currency1 hook fee tickSpacing createdAtBlock", "createdAtBlock"),
  ])
  console.log(`  transfers=${transfers.length} launches=${launches.length} pools=${pools.length}`)

  await db.query("truncate transfer, tokenlaunch, graduation, poolinitialize")

  // transfer
  for (let i = 0; i < transfers.length; i += 500) {
    const chunk = transfers.slice(i, i + 500)
    const vals = [], ph = []
    chunk.forEach((t, k) => {
      const b = k * 11
      ph.push(`($${b+1},to_timestamp($${b+2}),$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11})`)
      vals.push(Number(t.block), Number(t.timestamp), lc(t.token), lc(t.from), lc(t.to), n(t.amount), t.fromLabel ?? null, t.toLabel ?? null, n(t.block), n(t.timestamp), lc(t.txHash))
    })
    await db.query(
      `insert into transfer (_block_number_,_block_timestamp_,token,"from","to",amount,from_label,to_label,block,timestamp,tx_hash) values ${ph.join(",")}`, vals)
  }

  // tokenlaunch + graduation
  for (const l of launches) {
    await db.query(
      `insert into tokenlaunch (_block_number_,_block_timestamp_,token,curve,deployer,pair_token,graduation_threshold,block,timestamp,tx_hash)
       values ($1,to_timestamp($2),$3,$4,$5,$6,$7,$8,$9,$10)`,
      [Number(l.block), Number(l.timestamp), lc(l.token), lc(l.curve), lc(l.creator), lc(l.pairToken), n(l.graduationThreshold), n(l.block), n(l.timestamp), lc(l.txHash)])
    if (l.graduated) {
      await db.query(
        `insert into graduation (_block_number_,_block_timestamp_,token,kind,amount,block,timestamp,tx_hash)
         values ($1,to_timestamp($2),$3,'PoolGraduated',null,$4,$5,$6)`,
        [Number(l.graduationTimestamp ?? l.block), Number(l.graduationTimestamp ?? l.timestamp), lc(l.token), n(l.graduationTimestamp ?? l.block), n(l.graduationTimestamp ?? l.timestamp), lc(l.graduationTx ?? l.txHash)])
    }
  }

  // pool -> poolinitialize
  for (const p of pools) {
    await db.query(
      `insert into poolinitialize (_block_number_,_block_timestamp_,pool_id,currency0,currency1,token,hook,fee,tick_spacing,block,timestamp,tx_hash)
       values ($1,to_timestamp(0),$2,$3,$4,$5,$6,$7,$8,$9,null,null)`,
      [Number(p.createdAtBlock), lc(p.id), lc(p.currency0), lc(p.currency1), lc(p.token), lc(p.hook), p.fee ?? null, p.tickSpacing ?? null, n(p.createdAtBlock)])
  }

  const c = await db.query("select (select count(*) from transfer) t, (select count(*) from tokenlaunch) l, (select count(*) from graduation) g, (select count(*) from poolinitialize) p")
  console.log("seeded:", c.rows[0])
  await db.end()
}
main().catch(e => { console.error(e); process.exit(1) })
