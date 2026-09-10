import { Pool } from "pg"

// Substreams -> Postgres. `substreams sink postgres` (relational mode on
// finch.v1.Events) owns the schema: tables transfer, tokenlaunch, graduation,
// poolinitialize, poolswap, poolmodifyliquidity — each with the proto fields
// plus _block_number_ / _block_timestamp_. Column names are the proto field
// names (snake_case), "from"/"to" are quoted (reserved words).

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://finch@127.0.0.1:5433/finch",
  max: 4,
})

export async function sql<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(text, params)
  return r.rows as T[]
}

// Freshness: highest block the sink has written across the event tables.
export async function headBlock(): Promise<number> {
  const r = await sql<{ b: string | null }>(
    `select greatest(
       coalesce((select max(block) from transfer), 0),
       coalesce((select max(block) from tokenlaunch), 0)
     )::text as b`,
  )
  return r[0]?.b ? parseInt(r[0].b, 10) : 0
}
