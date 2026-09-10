// Neon free tier is 512 MB. Two things blow it: map_raw emits EVERY Uniswap V4
// swap (poolswap ~200 MB, poolmodifyliquidity ~14 MB) which the bot never reads,
// and transfer volume is ~85 MB/day. So: truncate the pool_* churn every run,
// and keep transfer to a rolling block window. Launches / graduations /
// poolinitialize are small and kept in full.
//
//   node --env-file=../.env scripts/prune-neon.mjs
// Run hourly via deploy/finch-prune.timer.

import { Pool } from "pg"

const DSN = process.env.DATABASE_URL
const WINDOW = Number(process.env.PRUNE_WINDOW_BLOCKS || 250000) // ~3 days at ~10 blk/s
if (!DSN) { console.error("DATABASE_URL missing"); process.exit(1) }

const pool = new Pool({ connectionString: DSN })
await pool.query(`truncate poolswap, poolmodifyliquidity`)
const r = await pool.query(
  `delete from transfer
    where block::bigint < (select coalesce(max(block::bigint),0) - $1 from transfer)`,
  [WINDOW],
)
await pool.query(`vacuum transfer`)   // reclaim the deleted rows' space (Neon bills on size)
console.log(`pruned ${r.rowCount} transfer rows (window ${WINDOW}) + truncated pool churn at ${new Date().toISOString()}`)
await pool.end()
