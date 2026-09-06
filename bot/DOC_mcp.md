# Finch MCP server

`src/mcp.ts` — a stdio MCP server that exposes Finch as native tools for any MCP
client. It calls Finch's HTTP API (`bot/src/http.ts`) with `x-agent-id: mcp`, so
every tool invocation is visible in `GET /calls`.

## Tools

| tool | args | returns |
|---|---|---|
| `finch_wallet_provenance` | `wallet`, `question?`, `format?` | structured provenance JSON (or prose) |
| `finch_pons_activity` | `question` | recent launches / graduation status |
| `finch_health` | — | subgraph freshness vs chain head |

## Run

Finch's HTTP API must be up first (`npm run serve`), then:

```
npm run mcp        # stdio server
```

## Wire into Claude Code

`.claude/settings.json` (or `claude mcp add`):

```json
{
  "mcpServers": {
    "finch": {
      "command": "node",
      "args": ["--env-file=/ABS/PATH/_Finch/.env", "--import", "tsx",
               "/ABS/PATH/_Finch/bot/src/mcp.ts"]
    }
  }
}
```

Then ask the model: *"use finch to check why 0x2a58fb44f78d7b600aec945ba8cb253896793ed3
received NVDA"* — it calls `finch_wallet_provenance`, and `curl localhost:8787/calls`
shows the hit with `caller: mcp`.

## Wire into Claude Desktop / Cursor

Same shape in their MCP config (`claude_desktop_config.json` /
`.cursor/mcp.json`).
