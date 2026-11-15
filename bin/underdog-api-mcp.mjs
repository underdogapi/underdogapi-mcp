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
const league = s('League code from get_coverage, for example NBA, NFL, NHL, CBB, CFB, TENNIS, CS');
const limit = n('Rows per page', {minimum: 1, maximum: 200});
const cursor = s('meta.next_cursor from the previous page, with the same filters');

/** name, description, REST path, input schema, keyless. Every path and parameter is documented at /docs. */
export const TOOLS = [
  ['demo_board', 'Fictional Underdog-style board in the live response shape. No key needed; use it to learn the schema.', '/api/v1/demo/projections', {league, limit}, true],
  ['demo_changes', 'Fictional change events in the live shape. No key needed.', '/api/v1/demo/changes', {limit}, true],
  ['credit_costs', 'The credit policy, or the credits one request path would cost (path, for example /api/v1/projections?limit=200). No key needed.', '/api/v1/credit-costs', {path: s('Request path with query string')}, true],
  ['get_coverage', 'Leagues and stats on the board now, and the first recorded date per league. Call first.', '/api/v1/coverage', {}, false],
  ['get_board', 'Current Underdog Fantasy pick\'em lines with separate Higher and Lower payout multipliers per side.', '/api/v1/projections', {league, stat: s('Stat slug, for example points'), search: s('Player or team'), payout_tier: s('standard, boosted or discounted'), view: s('compact for smaller rows'), limit, cursor}, false],
  ['get_odds', 'Each current line with its Higher and Lower side as odds entries. 5 minutes behind on the free plan.', '/api/v1/odds', {league, stat: s('Stat slug'), player: s('Player name or pl_ id'), limit, cursor}, false],
  ['get_changes', 'Recorded change events (line.moved, multiplier changes, suspensions, closes) across the board.', '/api/v1/changes', {league, event_type: s('For example line.moved'), since: s('ISO timestamp'), limit, cursor}, false],
  ['get_line_history', 'Every recorded change of one market, from get_board ids (udm_...).', '/api/v1/projections/{projection_id}/history', {projection_id: s('Market id udm_...')}, false],
  ['get_board_as_of', 'The board as it stood at a past instant (as_of ISO timestamp). Free reads the last 24 hours.', '/api/v1/board', {as_of: s('ISO timestamp, for example 2026-11-14T23:00:00Z'), league, limit, cursor}, false],
  ['get_results', 'Graded lines: Higher, Lower or void against the final box score. Paid plans; Free answers with a labelled sample.', '/api/v1/results', {league, player: s('Player name'), stat: s('Stat slug'), date: s('US Eastern date YYYY-MM-DD'), result: s('higher, lower or void'), limit, cursor}, false],
  ['get_hit_rates', 'How often one player went Higher or Lower over recent graded games. Paid plans.', '/api/v1/hit-rates', {player: s('Player name'), stat: s('Stat slug'), league, last: n('Games', {minimum: 1, maximum: 100})}, false],
  ['get_multipliers', 'Payout multipliers per side on the current board.', '/api/v1/multipliers', {league}, false],
  ['get_payouts', 'Standard, Flex and Streaks payout reference tables.', '/api/v1/payouts', {}, false],
  ['get_training_set', 'One labelled row per graded line for model training. Paid plans.', '/api/v1/training-set', {league, stat: s('Stat slug'), limit, cursor}, false],
].map(([name, description, path, properties, keyless]) => ({
  name, description, path, keyless,
  inputSchema: {type: 'object', properties, required: name === 'get_line_history' ? ['projection_id'] : name === 'get_board_as_of' ? ['as_of'] : name === 'get_hit_rates' ? ['player'] : [], additionalProperties: false},
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
  if (method === 'tools/list') return reply(id, {tools: TOOLS.map(({name, description, inputSchema}) => ({name, description, inputSchema}))});
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
