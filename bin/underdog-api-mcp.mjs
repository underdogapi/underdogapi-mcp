#!/usr/bin/env node
// Underdog API MCP server over stdio (newline-delimited JSON-RPC 2.0). No dependencies.
// Wraps the public REST API at https://underdogapi.com. Keyless tools work without UNDERDOG_API_KEY; the rest need a
// free key from https://underdogapi.com/sign-up. Underdog API is operated by Stunning Couches LLC and is not affiliated
// with Underdog Fantasy.
import {createInterface} from 'node:readline';

const VERSION = '0.1.0';
const BASE = (process.env.UNDERDOG_BASE_URL || 'https://underdogapi.com').replace(/\/$/, '');
const KEY = process.env.UNDERDOG_API_KEY || '';
const MAX_TEXT = 60_000;

const s = (description, extra = {}) => ({type: 'string', description, ...extra});
const n = (description, extra = {}) => ({type: 'integer', description, ...extra});
const league = s('Sport code in upper case from get_coverage, for example NBA, NFL, NHL, CBB, CFB, TENNIS, CS; comma-separate several. Omit for all.');
const limit = n('Rows per page, 1 to 200.', {minimum: 1, maximum: 200});
const cursor = s('meta.next_cursor from the previous page, sent with the same filters. Omit for the first page.');
const stat = s('Exact machine stat slug, for example points, rebounds or passing_yards (get_coverage lists them).');
const search = s('Part of a player or team name, case-insensitive.');
const payoutTier = s('Only sides with this payout tier: standard, boosted (pays more than standard) or discounted (pays less).', {enum: ['standard', 'boosted', 'discounted']});
const result = s('Only this outcome: higher, lower or void.', {enum: ['higher', 'lower', 'void']});
const player = s('Player name, case-insensitive.');
const date = s('Game date YYYY-MM-DD, US Eastern.');
const KEYED = ' Needs UNDERDOG_API_KEY (free key, no card, at https://underdogapi.com/sign-up); without one it returns the sign-up link and spends nothing.';
const PAID = ' Paid plans; a Free key gets a labelled sample and the upgrade link (HTTP 402).';
const DEMO = ' No key, no credits. The rows are fictional: never present them as real lines.';

/** name, title, description, REST path, input schema, keyless. Every path and parameter is documented at /docs. */
export const TOOLS = [
  ['demo_board', 'Demo board (keyless)', 'Fictional Underdog-style board rows in the exact live shape of get_board, to learn the fields before the user has a key.' + DEMO, '/api/v1/demo/projections', {league, limit}, true],
  ['demo_changes', 'Demo change feed (keyless)', 'Fictional change events (line.opened, line.moved and so on) in the exact live shape of get_changes, to build a polling loop before the user has a key.' + DEMO, '/api/v1/demo/changes', {limit}, true],
  ['credit_costs', 'Credit costs (keyless)', 'The credit policy, or the credits one request would cost before you run it. Use it before a large keyed read. No key, no credits.', '/api/v1/credit-costs', {path: s('Request path with its query string, for example /api/v1/projections?limit=200. Omit for the whole policy.')}, true],
  ['get_coverage', 'Coverage', 'Which leagues and stat slugs are on the board now, with line counts and the first recorded date per league. Call it first to pick valid league and stat values and avoid empty queries.' + KEYED, '/api/v1/coverage', {}, false],
  ['get_board', 'Current board', 'The live Underdog Fantasy pick\'em board: player, stat, line, and separate Higher and Lower payout multipliers per side with their tier, plus start time and observed_at. Use it for "what are the lines now"; get_board_as_of for a past instant, get_changes to poll only what moved, get_odds for sportsbook prices at the same line.' + KEYED, '/api/v1/projections', {league, stat, search, payout_tier: payoutTier, view: s('compact (flat, smaller rows) or full (default, nested, with matched sportsbook prices).', {enum: ['compact', 'full']}), limit, cursor}, false],
  ['get_odds', 'Lines with sportsbook prices', 'Each current line as Higher and Lower odds entries, next to FanDuel, DraftKings and Novig prices and the no-vig fair probability at the same line where a book prices it. Use it to judge whether a pick\'em side is good value; get_board has the lines alone. Five minutes behind on the free plan.' + KEYED, '/api/v1/odds', {league, market: s('Stat slug, for example points.'), player: s('Player name or pl_ id.'), limit, cursor}, false],
  ['get_changes', 'Change feed', 'Ordered feed of board changes: line.opened, line.moved, line.repriced (multiplier), line.suspended, line.closed, line.restored, alternates.changed, each with before and after values. Store meta.next_cursor and pass it back to get only newer changes. For one market use get_line_history.' + KEYED, '/api/v1/changes', {league, stat, event_type: s('Only one event type.', {enum: ['line.opened', 'line.moved', 'line.repriced', 'line.suspended', 'line.closed', 'line.restored', 'alternates.changed']}), since: s('Only changes observed at or after this ISO 8601 time.'), limit, cursor}, false],
  ['get_line_history', 'Line history of one market', 'Every recorded change of one market, oldest to newest: line and multiplier moves with times. Use it for "how has this line moved"; take the udm_ id from get_board.' + KEYED, '/api/v1/projections/{projection_id}/history', {projection_id: s('Market id from get_board, for example udm_... (required).')}, false],
  ['get_board_as_of', 'Board at a past instant', 'The board as it stood at a past instant, rebuilt from recorded history, for backtests and "what was the line at tip-off". Free keys read the last 24 hours. For now use get_board.' + KEYED, '/api/v1/board', {as_of: s('ISO 8601 time with a time zone, for example 2026-11-14T23:00:00Z (required).'), league, stat, search, limit, cursor}, false],
  ['get_results', 'Graded results', 'Reviewed lines graded against the final box score: closing line, actual stat, and Higher, Lower or void (ties void). Use it to check how lines settled; get_hit_rates summarises one player.' + PAID + KEYED, '/api/v1/results', {league, player, player_id: s('Public player id from a previous row.'), stat, date, result, limit, cursor}, false],
  ['get_hit_rates', 'Player hit rates', 'How often one player went Higher or Lower across recent graded games, per stat, voids excluded. Send player or player_id. For the graded rows themselves use get_results.' + PAID + KEYED, '/api/v1/hit-rates', {player, player_id: s('Public player id from a previous row.'), stat, league, last: n('Most recent graded games to count, 1 to 100.', {minimum: 1, maximum: 100})}, false],
  ['get_multipliers', 'Boosted and discounted sides', 'Only the sides on the current board whose payout multiplier differs from standard (boosted or discounted), with the multiplier. Use it to find boosted picks; get_board has every side.' + KEYED, '/api/v1/multipliers', {league, stat, payout_tier: payoutTier}, false],
  ['get_payouts', 'Payout tables', 'Dated Underdog base payout tables for Standard, Flex and Streaks entries by pick count, to compute break-even probabilities. Reference data; takes no arguments.' + KEYED, '/api/v1/payouts', {}, false],
  ['get_training_set', 'Training set', 'One labelled row per graded line (line, multipliers, closing side tier, outcome) for model training, as JSON or CSV. For browsing results use get_results.' + PAID + KEYED, '/api/v1/training-set', {league, stat, player, date, include_void: {type: 'boolean', description: 'true also returns void rows.'}, format: s('json (default) or csv.', {enum: ['json', 'csv']}), limit, cursor}, false],
].map(([name, title, description, path, properties, keyless]) => ({
  name, title, description, path, keyless,
  inputSchema: {type: 'object', properties, required: name === 'get_line_history' ? ['projection_id'] : name === 'get_board_as_of' ? ['as_of'] : [], additionalProperties: false},
}));

const NO_KEY = 'This tool needs an Underdog API key. Get a free one (no card) at https://underdogapi.com/sign-up and set UNDERDOG_API_KEY in this server\'s environment, or start an agent signup with POST https://underdogapi.com/api/v1/agent/signup. The demo_board and demo_changes tools work without a key.';

export async function callTool(name, args = {}, {fetchImpl = fetch, key = KEY, base = BASE} = {}) {
  const tool = TOOLS.find(t => t.name === name);
  if (!tool) return {isError: true, content: [{type: 'text', text: `Unknown tool ${name}.`}]};
  if (!tool.keyless && !key) return {isError: true, content: [{type: 'text', text: NO_KEY}]};
  let path = tool.path;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(args ?? {})) {
    if (v === undefined || v === null || v === '') continue;
    if (!(k in tool.inputSchema.properties)) continue;
    if (path.includes(`{${k}}`)) path = path.replace(`{${k}}`, encodeURIComponent(String(v)));
    else qs.set(k, String(v));
  }
  const url = `${base}${path}${[...qs].length ? `?${qs}` : ''}`;
  const headers = {Accept: 'application/json', 'User-Agent': `underdog-api-mcp/${VERSION}`};
  if (key && !tool.keyless) headers.Authorization = `Bearer ${key}`;
  let res, text;
  try { res = await fetchImpl(url, {headers}); text = await res.text(); }
  catch (e) { return {isError: true, content: [{type: 'text', text: `Request failed: ${e?.message ?? e}`}]}; }
  const clipped = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n[truncated: ${text.length} characters; ask for a smaller limit or follow meta.next_cursor]` : text;
  // 402 UPGRADE_REQUIRED carries the plan limit, an upgrade link and labelled sample rows: pass it on as is.
  return {isError: !res.ok, content: [{type: 'text', text: clipped}]};
}

function reply(id, result) { process.stdout.write(JSON.stringify({jsonrpc: '2.0', id, result}) + '\n'); }
function fail(id, code, message) { process.stdout.write(JSON.stringify({jsonrpc: '2.0', id, error: {code, message}}) + '\n'); }

export async function handle(msg) {
  const {id, method, params} = msg;
  if (method === 'initialize') return reply(id, {protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: {tools: {}}, serverInfo: {name: 'underdog-api', version: VERSION},
    instructions: 'Underdog Fantasy pick\'em data from underdogapi.com (independent, not affiliated with Underdog Fantasy). Call get_coverage first. Every row has observed_at; quote it. A 402 means the plan lacks the data: tell the user what it lacks and show upgrade_url; never work around it.'});
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') return reply(id, {tools: TOOLS.map(({name, title, description, inputSchema}) => ({name, title, description, inputSchema,
    annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true}}))});
  if (method === 'tools/call') return reply(id, await callTool(params?.name, params?.arguments));
  if (id === undefined || id === null) return; // notifications (notifications/initialized and others)
  return fail(id, -32601, `Method not found: ${method}`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('underdog-api-mcp')) {
  const rl = createInterface({input: process.stdin});
  rl.on('line', line => {
    if (!line.trim()) return;
    let msg; try { msg = JSON.parse(line); } catch { return fail(null, -32700, 'Parse error'); }
    handle(msg).catch(e => fail(msg.id ?? null, -32603, String(e?.message ?? e)));
  });
}
