import { log } from "@graphprotocol/graph-ts"
import { Initialize, Swap, ModifyLiquidity } from "../generated/PoolManager/PoolManager"
import { Pool, SwapEvent, LiquidityEvent } from "../generated/schema"
import { PONS_V2_MEME_HOOK, isPairingAsset } from "./constants"

// Phase 1: only pools behind the Pons Meme Hook are indexed. Swap / ModifyLiquidity
// on any other pool are ignored (Pool entity absent => early return).

export function handleInitialize(ev: Initialize): void {
  if (!ev.params.hooks.equals(PONS_V2_MEME_HOOK)) return

  let p = new Pool(ev.params.id.toHexString())
  let c0 = ev.params.currency0
  let c1 = ev.params.currency1
  p.currency0 = c0
  p.currency1 = c1

  // launched token = the side that is NOT a known pairing asset.
  let c0Pair = isPairingAsset(c0)
  let c1Pair = isPairingAsset(c1)
  if (c0Pair && !c1Pair)       p.token = c1
  else if (c1Pair && !c0Pair)  p.token = c0
  else {
    p.token = null
    log.warning("Pool {}: cannot derive launched token — currency0={} currency1={} (both/neither are pairing assets)",
      [p.id, c0.toHexString(), c1.toHexString()])
  }

  p.hook           = ev.params.hooks
  p.fee            = ev.params.fee
  p.tickSpacing    = ev.params.tickSpacing
  p.createdAtBlock = ev.block.number
  p.save()
}

export function handleSwap(ev: Swap): void {
  let poolId = ev.params.id.toHexString()
  if (Pool.load(poolId) == null) return
  let s = new SwapEvent(ev.transaction.hash.toHexString() + "-" + ev.logIndex.toString())
  s.pool         = poolId
  s.sender       = ev.params.sender
  s.amount0      = ev.params.amount0
  s.amount1      = ev.params.amount1
  s.sqrtPriceX96 = ev.params.sqrtPriceX96
  s.liquidity    = ev.params.liquidity
  s.timestamp    = ev.block.timestamp
  s.save()
}

export function handleModifyLiquidity(ev: ModifyLiquidity): void {
  let poolId = ev.params.id.toHexString()
  if (Pool.load(poolId) == null) return
  let e = new LiquidityEvent(ev.transaction.hash.toHexString() + "-" + ev.logIndex.toString())
  e.pool           = poolId
  e.provider       = ev.params.sender
  e.liquidityDelta = ev.params.liquidityDelta
  e.tickLower      = ev.params.tickLower
  e.tickUpper      = ev.params.tickUpper
  e.timestamp      = ev.block.timestamp
  e.save()
}
