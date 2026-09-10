// Verify an x402 settlement on Base. `baz curl --json` returns paid.transaction;
// this reads that tx off Base and decodes the USDC Transfer — so Finch can
// confirm, on-chain, that the $0.00001 metered call was actually paid.

const BASE_RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org"
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"          // USDC on Base
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" // Transfer(address,address,uint256)
// The gateway's x402 payTo (from the 402 `accepts` block). Bazantic settles the
// metered call here on Base; this is how the Telegram feed surfaces the payment.
const PAY_TO = (process.env.X402_PAY_TO || "0xDE05E390e48c7a88B22dFE6B0005F70164F262aF").toLowerCase()

const rpc = async (method: string, params: unknown[]) => {
  const r = await fetch(BASE_RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  const j = await r.json() as { result?: any; error?: { message: string } }
  if (j.error) throw new Error(`base rpc: ${j.error.message}`)
  return j.result
}

const topicAddr = (t: string) => "0x" + t.slice(26).toLowerCase()

export interface X402Verify {
  verified: boolean
  base_tx: string
  network: "base"
  asset: "USDC"
  amount_usdc: string | null
  from: string | null
  to: string | null
  block: number | null
  status: "success" | "reverted" | "pending" | "not_found"
  explorer: string
  note: string
}

// Most recent USDC settlement to the gateway payTo on Base — used by the
// Telegram feed to annotate a `bazantic:` call with what it paid. At demo pace
// (one call at a time) this is that call's payment.
export async function latestSettlement(): Promise<{ amount_usdc: string; tx: string; block: number } | null> {
  const head = parseInt(await rpc("eth_blockNumber", []), 16)
  const logs = await rpc("eth_getLogs", [{
    fromBlock: "0x" + Math.max(0, head - 300).toString(16),   // ~10 min of Base
    toBlock: "latest",
    address: USDC,
    topics: [TRANSFER_TOPIC, null, "0x000000000000000000000000" + PAY_TO.slice(2)],
  }]).catch(() => null)
  if (!logs?.length) return null
  const l = logs[logs.length - 1]
  return {
    amount_usdc: (Number(BigInt(l.data)) / 1e6).toFixed(6),
    tx: l.transactionHash,
    block: parseInt(l.blockNumber, 16),
  }
}

export async function verifyPayment(txHash: string): Promise<X402Verify> {
  const tx = String(txHash).trim().toLowerCase()
  const base = {
    base_tx: tx, network: "base" as const, asset: "USDC" as const,
    explorer: `https://basescan.org/tx/${tx}`,
  }
  if (!/^0x[0-9a-f]{64}$/.test(tx)) {
    return { ...base, verified: false, amount_usdc: null, from: null, to: null, block: null, status: "not_found", note: "not a tx hash" }
  }

  const receipt = await rpc("eth_getTransactionReceipt", [tx]).catch(() => null)
  if (!receipt) return { ...base, verified: false, amount_usdc: null, from: null, to: null, block: null, status: "pending", note: "tx not yet on Base (or wrong hash)" }
  if (receipt.status !== "0x1") return { ...base, verified: false, amount_usdc: null, from: null, to: null, block: parseInt(receipt.blockNumber, 16), status: "reverted", note: "tx reverted" }

  const log = (receipt.logs || []).find((l: any) =>
    l.address?.toLowerCase() === USDC && l.topics?.[0] === TRANSFER_TOPIC)
  if (!log) return { ...base, verified: false, amount_usdc: null, from: null, to: null, block: parseInt(receipt.blockNumber, 16), status: "success", note: "no USDC Transfer in this tx" }

  const raw = BigInt(log.data)                       // USDC has 6 decimals
  const amount = (Number(raw) / 1e6).toFixed(6)
  return {
    ...base, verified: true,
    amount_usdc: amount,
    from: topicAddr(log.topics[1]),
    to: topicAddr(log.topics[2]),
    block: parseInt(receipt.blockNumber, 16),
    status: "success",
    note: `USDC ${amount} settled on Base — the x402 payment for a Finch /query call`,
  }
}
