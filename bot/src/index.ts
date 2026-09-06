import { Bot } from "grammy"
import { answer } from "./answer.js"
import { getWallet, setWallet, clearWallet } from "./session.js"
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
  "• \"what launched on Pons recently\"\n" +
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

bot.command("pons25", (ctx) => ctx.reply(pons25Text(), { link_preview_options: { is_disabled: true } }))
bot.command("finchtop", (ctx) => ctx.reply(finchTopText()))

const PONS25_RE = /^\s*pons\s*25\s*$/i
const FINCHTOP_RE = /^\s*finch\s*top\s*$/i
const COVERAGE_RE = /(pons\s*25.*finch\s*top|finch\s*top.*pons\s*25|coverage|what does finch (see|track|cover))/i

bot.on("message:text", async (ctx) => {
  const q = ctx.message.text
  console.log(`msg from @${ctx.from?.username ?? ctx.from?.id}: ${q}`)

  // A message that is ONLY an address just sets the wallet — same as /account.
  const bare = q.trim()
  if (ADDR.test(bare)) {
    setWallet(ctx.chat.id, bare)
    return ctx.reply(`Wallet set to ${bare.toLowerCase()}.\nNow send a token symbol (NVDA, SPY, GME, …) or "why did I get NVDA?"`)
  }

  if (COVERAGE_RE.test(q)) return ctx.reply(coverageText(), { link_preview_options: { is_disabled: true } })
  if (PONS25_RE.test(q))   return ctx.reply(pons25Text(), { link_preview_options: { is_disabled: true } })
  if (FINCHTOP_RE.test(q)) return ctx.reply(finchTopText())

  await ctx.replyWithChatAction("typing")
  try {
    const a = await answer(q, getWallet(ctx.chat.id))
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
