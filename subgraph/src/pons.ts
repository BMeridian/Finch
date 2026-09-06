import { TokenLaunched } from "../generated/PonsV2Factory/PonsFactory"
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
  l.launchpad  = lp.id
  l.token      = ev.params.token
  l.curve      = ev.params.curve
  l.creator    = ev.params.creator
  l.name       = ev.params.name
  l.symbol     = ev.params.symbol
  l.block      = ev.block.number
  l.timestamp  = ev.block.timestamp
  l.txHash     = ev.transaction.hash
  l.graduated  = false
  l.save()
}
