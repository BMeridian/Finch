import { Address } from "@graphprotocol/graph-ts"
import { Transfer as TransferEvent } from "../generated/NVDA/ERC20"
import { Transfer, Wallet } from "../generated/schema"
import { labelFor } from "./constants"

// One shared handler for every watched stock token (NVDA, AAPL, TSLA, AMZN,
// WETH, USDG) — see the data source list in subgraph.yaml. Nothing here is
// token-specific: ev.address is whichever token contract emitted the Transfer.
// FeeEscrow / distributor activity surfaces as from/to on these transfers and is
// tagged via labelFor. Multicall3 batch decoding is Phase 2 (see DOC_prompt.md).

function touchWallet(a: Address, ev: TransferEvent): void {
  let id = a.toHexString()
  if (Wallet.load(id) != null) return
  let w = new Wallet(id)
  w.firstSeenBlock     = ev.block.number
  w.firstSeenTimestamp = ev.block.timestamp
  w.save()
}

export function handleTransfer(ev: TransferEvent): void {
  let t = new Transfer(ev.transaction.hash.toHexString() + "-" + ev.logIndex.toString())
  t.token     = ev.address
  t.from      = ev.params.from
  t.to        = ev.params.to
  t.amount    = ev.params.value
  t.fromLabel = labelFor(ev.params.from)
  t.toLabel   = labelFor(ev.params.to)
  t.txHash    = ev.transaction.hash
  t.block     = ev.block.number
  t.timestamp = ev.block.timestamp
  t.save()

  touchWallet(ev.params.from, ev)
  touchWallet(ev.params.to, ev)
}
