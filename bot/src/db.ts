import { Pool } from "pg"

// Substreams -> Postgres. `substreams sink postgres` (relational mode on
// finch.v1.Events) owns the schema: tables transfer, tokenlaunch, graduation,
// poolinitialize, poolswap, poolmodifyliquidity — each with the proto fields
// plus _block_number_ / _block_timestamp_. Column names are the proto field
// names (snake_case), "from"/"to" are quoted (reserved words).

const RAW = process.env.DATABASE_URL || "postgres://finch@127.0.0.1:5433/finch"
const local = RAW.includes("localhost") || RAW.includes("127.0.0.1")
// Strip sslmode from the URL and set ssl explicitly — pg's sslmode=require now
// means verify-full, which fails against Aiven's private CA. Connection stays
// TLS-encrypted; we just don't verify the chain.
const DSN = RAW.replace(/[?&]sslmode=[^&]*/g, "").replace(/\?&/, "?").replace(/[?&]$/, "")

const pool = new Pool({
  connectionString: DSN,
  max: 4,
  ssl: local ? undefined : { rejectUnauthorized: false },
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
