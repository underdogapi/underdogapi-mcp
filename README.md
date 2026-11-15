# underdog-api-mcp

An MCP server (stdio) for [Underdog API](https://underdogapi.com): Underdog Fantasy pick'em lines with separate Higher
and Lower payout multipliers, recorded line moves, the board at past instants, graded results and hit rates, as tools
for Claude, ChatGPT, Cursor, VS Code and any MCP client. No dependencies; Node 18+.

A hosted server with the same data runs at `https://underdogapi.com/api/mcp` (Streamable HTTP, bearer key). Use this
package when your client only speaks stdio or you want the key kept in a local environment variable.

Underdog API is an independent data service operated by Stunning Couches LLC. It is not affiliated with, endorsed by
or operated by Underdog Fantasy.

## Use it

Claude Code:

```bash
claude mcp add underdog -e UNDERDOG_API_KEY=ud_... -- npx -y underdog-api-mcp
```

Claude Desktop, Cursor, Windsurf and other JSON-configured clients:

```json
{
  "mcpServers": {
    "underdog": {
      "command": "npx",
      "args": ["-y", "underdog-api-mcp"],
      "env": { "UNDERDOG_API_KEY": "ud_..." }
    }
  }
}
```

No key yet? `demo_board`, `demo_changes` and `credit_costs` work without one, so an agent can learn the response shape
first. A free key (100 credits a month, no card) is at https://underdogapi.com/sign-up.

## Tools

| Tool | What it returns | Key |
|---|---|---|
| demo_board | Fictional board in the live shape | No |
| demo_changes | Fictional change events | No |
| credit_costs | Credit policy, or the cost of one request path | No |
| get_coverage | Leagues and stats on the board, first recorded date per league | Yes |
| get_board | Current lines, both side multipliers, filters for league, stat, player, tier | Yes |
| get_odds | Each side as an odds entry (5 minutes behind on Free) | Yes |
| get_changes | Line moves, multiplier changes, suspensions, closes | Yes |
| get_line_history | Every recorded change of one market | Yes |
| get_board_as_of | The board at a past instant | Yes |
| get_results | Graded lines (paid plans) | Yes |
| get_hit_rates | How often a player went Higher or Lower (paid plans) | Yes |
| get_multipliers, get_payouts, get_training_set | Multipliers, payout tables, model training rows | Yes |

A tool the plan does not include answers with the API's 402 body: what is missing, the upgrade link and a few
labelled sample rows. No credits are charged for it. Ask your user before upgrading.

## Example prompts

- "Which NBA lines are discounted on the Higher side right now?"
- "How has this player's points line moved today?"
- "Rebuild the NHL board as of 7 pm Eastern yesterday and list shots lines."

## Test

```bash
npm test                     # offline, against a local fake API
UNDERDOG_LIVE=1 npm test     # also calls the real keyless demo
```

## Registry

`server.json` describes this package and the hosted remote for the official MCP registry
(name `com.underdogapi/underdog`, verified through the underdogapi.com domain).
