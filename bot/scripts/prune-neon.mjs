// Managed PG is tight for this chain: map_raw emits EVERY Uniswap V4 swap
// (poolswap ~200 MB, poolmodifyliquidity ~14 MB, both unused by the bot) and
// transfer is ~1.5 MB / 1000 blocks (fee-settlement multicalls). So each run:
// TRUNCATE the pool churn, keep transfer to a rolling PRUNE_WINDOW_BLOCKS window,
// vacuum. Launches / graduations / poolinitialize are small, kept in full.
//
//   node --env-file=../.env scripts/prune-neon.mjs
// Run hourly via deploy/finch-prune.timer (name kept though the DB is now Aiven).

import { Pool } from "pg"

const RAW = process.env.DATABASE_URL
const WINDOW = Number(process.env.PRUNE_WINDOW_BLOCKS || 250000) // ~2.8 days at ~10 blk/s
if (!RAW) { console.error("DATABASE_URL missing"); process.exit(1) }

const local = RAW.includes("localhost") || RAW.includes("127.0.0.1")
const DSN = RAW.replace(/[?&]sslmode=[^&]*/g, "").replace(/\?&/, "?").replace(/[?&]$/, "")
const pool = new Pool({ connectionString: DSN, ssl: local ? undefined : { rejectUnauthorized: false } })

await pool.query(`truncate poolswap, poolmodifyliquidity`)
const r = await pool.query(
  `delete from transfer
    where block::bigint < (select coalesce(max(block::bigint),0) - $1 from transfer)`,
  [WINDOW],
)
await pool.query(`vacuum transfer`)
console.log(`pruned ${r.rowCount} transfer rows (window ${WINDOW}) + truncated pool churn at ${new Date().toISOString()}`)
await pool.end()
