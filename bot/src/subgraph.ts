const URL = process.env.SUBGRAPH_QUERY_URL
if (!URL) { console.error("SUBGRAPH_QUERY_URL missing (expected in ../.env)"); process.exit(1) }

export async function gql<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(URL!, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`subgraph HTTP ${res.status}`)
  const body = await res.json() as { data?: T; errors?: { message: string }[] }
  if (body.errors?.length) throw new Error(`subgraph GraphQL: ${body.errors.map(e => e.message).join("; ")}`)
  if (!body.data) throw new Error("subgraph returned no data")
  return body.data
}

export async function headBlock(): Promise<number> {
  const d = await gql<{ _meta: { block: { number: number } } }>(`{ _meta { block { number } } }`)
  return d._meta.block.number
}
