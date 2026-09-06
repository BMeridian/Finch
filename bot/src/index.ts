import { Bot } from "grammy"
import { answer } from "./answer.js"
import { getWallet, setWallet, clearWallet, getMode, setMode } from "./session.js"
import { setSeeMode, seeMode, callStats } from "./calllog.js"
import { freshness } from "./freshness.js"
import { pons25Text } from "./pons25.js"
import { finchTopText, coverageText } from "./lists.js"

const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) { console.error("TELEGRAM_BOT_TOKEN missing (expected in ../.env)"); process.exit(1) }

const bot = new Bot(token)
const ADDR = /^0x[0-9a-fA-F]{40}$/

const HELP =
  "Finch traces where Robinhood Chain tokens came from.\n\n" +
  "Two-step:\n" +
  "1) /account 0x…   set your wallet once\n" +
  "   demo: /account 0x2a58fb44f78d7b600aec945ba8cb253896793ed3\n" +
  "2) send a token symbol (NVDA, SPY, GME, GOOGL, cbBTC, …) — or \"why did I get NVDA?\"\n\n" +
  "One-shot also works: paste an address + a symbol in one message. Also:\n" +
  "• /launchesPons — recent Pons launches (then a symbol or \"Pons25\" filters by pairing token)\n" +
  "• paste a token address + \"has it graduated?\"\n" +
  "Add \"show the technical trace\" for addresses + tx.\n\n" +
  "Pons25 — top 25 tokenized stocks by on-chain market cap\n" +
  "FinchTop — the tokens Finch actually tracks"

bot.command(["start", "help"], (ctx) => ctx.reply(HELP))
bot.command("ping", (ctx) => ctx.reply("pong"))

bot.command("account", (ctx) => {
  const arg = ctx.match.trim()
  if (!arg) {
    const w = getWallet(ctx.chat.id)
    return ctx.reply(w ? `Your wallet is set to ${w}. Ask me why you received a token, or /forget to clear it.`
                       : "No wallet set. Use /account 0x… to set one.")
  }
  if (!ADDR.test(arg)) return ctx.reply("That doesn't look like a wallet address. Use /account 0x… (40 hex chars).")
  setWallet(ctx.chat.id, arg)
  return ctx.reply(`Wallet set to ${arg.toLowerCase()}.\nNow send a token symbol (NVDA, SPY, GME, …) or "why did I get NVDA?"`)
})

bot.command(["forget", "clear"], (ctx) => { clearWallet(ctx.chat.id); return ctx.reply("Wallet cleared.") })

bot.command(["health", "status"], async (ctx) => {
  try {
    const f = await freshness()
    const s = callStats()
    return ctx.reply(
      `Subgraph: block ${f.subgraph_block} · chain ${f.chain_block}\n` +
      `Lag: ${f.lag_blocks.toLocaleString()} blocks (~${Math.round(f.lag_seconds / 60)} min) · ${f.fresh ? "fresh" : "backfilling"}\n` +
      `Agent calls: ${s.total} logged · logging ${seeMode()}`)
  } catch (e) {
    return ctx.reply(`Health check failed: ${e}`)
  }
})

bot.command("pons25", (ctx) => ctx.reply(pons25Text(), { link_preview_options: { is_disabled: true } }))
bot.command("finchtop", (ctx) => ctx.reply(finchTopText()))

async function replyLaunches(ctx: any) {
  setMode(ctx.chat.id, "launches")
  await ctx.replyWithChatAction("typing")
  const a = await answer("what launched on pons recently", undefined, "launches")
  return ctx.reply(a, { link_preview_options: { is_disabled: true } })
}
bot.command(["launchespons", "launches", "pons", "recent"], replyLaunches)
bot.command("graduated", async (ctx) => {
  setMode(ctx.chat.id, "launches")
  await ctx.replyWithChatAction("typing")
  return ctx.reply(await answer("graduated pons tokens", undefined, "launches"), { link_preview_options: { is_disabled: true } })
})

// Call-visibility toggles (affect the HTTP API's agent-call log; shared via file).
bot.command("seeagent",     (ctx) => { setSeeMode("min");  return ctx.reply("Agent call logging: min (timestamp + caller).") })
bot.command("seeagentfull", (ctx) => { setSeeMode("full"); return ctx.reply("Agent call logging: full (wallet, question, latency, UA).") })
bot.command("agentoff",     (ctx) => { setSeeMode("off");  return ctx.reply("Agent call logging: off.") })

const PONS25_RE = /^\s*pons\s*25\s*$/i
const FINCHTOP_RE = /^\s*finch\s*top\s*$/i
const COVERAGE_RE = /(pons\s*25.*finch\s*top|finch\s*top.*pons\s*25|coverage|what does finch (see|track|cover))/i

bot.on("message:text", async (ctx) => {
  const q = ctx.message.text
  console.log(`msg from @${ctx.from?.username ?? ctx.from?.id}: ${q}`)

  // Call-log toggles — accept any casing, with or without the slash
  // (Telegram commands are case-sensitive, so /agentOff misses bot.command).
  const bt = q.trim().replace(/^\//, "")
  if (/^seeagentfull$/i.test(bt)) { setSeeMode("full"); return ctx.reply("Agent call logging: full (wallet, question, latency, UA).") }
  if (/^seeagent$/i.test(bt))     { setSeeMode("min");  return ctx.reply("Agent call logging: min (timestamp + caller).") }
  if (/^agentoff$/i.test(bt))     { setSeeMode("off");  return ctx.reply("Agent call logging: off.") }

  // A message that is ONLY an address just sets the wallet — same as /account.
  const bare = q.trim()
  if (ADDR.test(bare)) {
    setWallet(ctx.chat.id, bare)
    return ctx.reply(`Wallet set to ${bare.toLowerCase()}.\nNow send a token symbol (NVDA, SPY, GME, …) or "why did I get NVDA?"`)
  }

  if (COVERAGE_RE.test(q)) return ctx.reply(coverageText(), { link_preview_options: { is_disabled: true } })
  if (FINCHTOP_RE.test(q)) return ctx.reply(finchTopText())
  // bare "pons25" only shows the reference list when NOT in launches mode
  if (PONS25_RE.test(q) && getMode(ctx.chat.id) !== "launches" && !/launch/i.test(q))
    return ctx.reply(pons25Text(), { link_preview_options: { is_disabled: true } })

  // short text form, any casing
  if (/^\/?(launchespons|launches|recent launches)$/i.test(bare)) return replyLaunches(ctx)

  // switch context: a launch-y ask puts the chat in "launches" mode so a
  // follow-up bare symbol filters by pairing token.
  if (/(launch|what.*pons|newly|just dropped|new (token|coin))/i.test(q)) setMode(ctx.chat.id, "launches")

  await ctx.replyWithChatAction("typing")
  try {
    const a = await answer(q, getWallet(ctx.chat.id), getMode(ctx.chat.id))
    await ctx.reply(a, { link_preview_options: { is_disabled: true } })
    console.log("replied ok")
  } catch (e) {
    console.error("answer failed:", e)
    await ctx.reply("Something went wrong reaching the index. Try again in a moment.")
  }
})

bot.catch((err) => console.error("bot error:", err))

async function main() {
  const me = await bot.api.getMe()
  console.log(`@${me.username} starting (long-polling)…`)
  await bot.start({
    onStart: (i) => console.log(`polling as @${i.username}, id ${i.id}`),
    drop_pending_updates: true,
  })
}

main()
