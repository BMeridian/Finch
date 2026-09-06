import { ethereum } from "@graphprotocol/graph-ts"
import { TokenLaunched, PoolGraduated, GraduationTokensPermanentlyLocked } from "../generated/PonsV2Factory/PonsFactory"
import { Launchpad, TokenLaunch } from "../generated/schema"
import { PONS_V2_FACTORY } from "./constants"

function launchpad(): Launchpad {
  let id = PONS_V2_FACTORY.toHexString()
  let lp = Launchpad.load(id)
  if (lp == null) { lp = new Launchpad(id); lp.name = "Pons"; lp.save() }
  return lp as Launchpad
}

export function handleTokenLaunched(ev: TokenLaunched): void {
  let lp = launchpad()
  let l  = new TokenLaunch(ev.params.token.toHexString())
  l.launchpad           = lp.id
  l.token               = ev.params.token
  l.curve               = ev.params.curve
  l.creator             = ev.params.deployer
  l.pairToken           = ev.params.pairToken
  l.graduationThreshold = ev.params.graduationThreshold
  l.block               = ev.block.number
  l.timestamp           = ev.block.timestamp
  l.txHash              = ev.transaction.hash
  l.graduated           = false
  l.save()
}

function markGraduated(token: string, ev: ethereum.Event): void {
  let l = TokenLaunch.load(token)
  if (l == null) return
  l.graduated            = true
  l.graduationTx         = ev.transaction.hash
  l.graduationTimestamp  = ev.block.timestamp
  l.save()
}

export function handlePoolGraduated(ev: PoolGraduated): void {
  markGraduated(ev.params.token.toHexString(), ev)
}

export function handleGraduationTokensPermanentlyLocked(ev: GraduationTokensPermanentlyLocked): void {
  markGraduated(ev.params.token.toHexString(), ev)
}
