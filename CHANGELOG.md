# Changelog

All notable changes to this package. Dates are UTC.

## Unreleased

- Fix: `get_odds` sent the stat filter as `stat`, which `/api/v1/odds` ignores; it is now `market`, the name the API reads.
- Every tool has a title, says when to use it instead of its siblings and what the rows contain, and every argument has a
  description; enums where the API has them (`payout_tier`, `result`, `event_type`, `view`, `format`). Added the filters the
  API already accepts: `stat`/`search` on `get_board_as_of`, `player_id` on results and hit rates, `include_void`/`format`
  on the training set. `get_hit_rates` accepts `player_id` instead of `player`.
- Tools now carry read-only annotations.

## 0.1.0 - 2026-11-15

- First release: stdio MCP server for the Underdog API at https://underdogapi.com. Keyless tools work with no key; set
  `UNDERDOG_API_KEY` for the rest. Published to npm as `underdog-api-mcp`.
