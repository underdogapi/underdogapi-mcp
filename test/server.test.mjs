import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';

const BIN = fileURLToPath(new URL('../bin/underdog-api-mcp.mjs', import.meta.url));

/** A local stand-in for the API so the tests never touch the network. */
function fakeApi() {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({url: req.url, auth: req.headers.authorization});
    const body = req.url.startsWith('/api/v1/results')
      ? [402, {error: {code: 'UPGRADE_REQUIRED', message: 'Free does not include graded results.', upgrade_url: 'https://underdogapi.com/upgrade?plan=developer', sample: [{result: 'higher'}]}}]
      : [200, {data: [{id: 'udm_1', league: 'NBA'}], meta: {next_cursor: null, observed_at: '2026-11-15T06:00:00Z'}}];
    res.writeHead(body[0], {'content-type': 'application/json'}); res.end(JSON.stringify(body[1]));
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({server, seen, base: `http://127.0.0.1:${server.address().port}`})));
}

function session(env) {
  const p = spawn(process.execPath, [BIN], {env: {...process.env, ...env}, stdio: ['pipe', 'pipe', 'inherit']});
  let buf = ''; const waiting = new Map();
  p.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiting.get(m.id)?.(m); } });
  let next = 1;
  const rpc = (method, params) => new Promise(r => { const id = next++; waiting.set(id, r); p.stdin.write(JSON.stringify({jsonrpc: '2.0', id, method, params}) + '\n'); });
  return {rpc, close: () => p.kill()};
}

test('initialize, list tools, keyless demo, keyed tools and plan limits over stdio', async () => {
  const api = await fakeApi();
  const anon = session({UNDERDOG_BASE_URL: api.base, UNDERDOG_API_KEY: ''});
  const init = await anon.rpc('initialize', {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 't', version: '1'}});
  assert.equal(init.result.serverInfo.name, 'underdog-api');
  const list = await anon.rpc('tools/list', {});
  const names = list.result.tools.map(t => t.name);
  for (const n of ['demo_board', 'get_board', 'get_changes', 'get_line_history', 'get_results', 'credit_costs']) assert.ok(names.includes(n), n);
  const demo = await anon.rpc('tools/call', {name: 'demo_board', arguments: {league: 'NBA', limit: 1}});
  assert.equal(demo.result.isError, false);
  assert.equal(api.seen.at(-1).url, '/api/v1/demo/projections?league=NBA&limit=1');
  assert.equal(api.seen.at(-1).auth, undefined);
  const noKey = await anon.rpc('tools/call', {name: 'get_board', arguments: {league: 'NBA'}});
  assert.equal(noKey.result.isError, true);
  assert.match(noKey.result.content[0].text, /sign-up/);
  anon.close();

  const keyed = session({UNDERDOG_BASE_URL: api.base, UNDERDOG_API_KEY: 'ud_test'});
  const board = await keyed.rpc('tools/call', {name: 'get_board', arguments: {league: 'NBA', view: 'compact', ignored: 'x'}});
  assert.equal(board.result.isError, false);
  assert.equal(api.seen.at(-1).url, '/api/v1/projections?league=NBA&view=compact');
  assert.equal(api.seen.at(-1).auth, 'Bearer ud_test');
  const hist = await keyed.rpc('tools/call', {name: 'get_line_history', arguments: {projection_id: 'udm_00000000-0000-4000-8000-000000000001'}});
  assert.equal(api.seen.at(-1).url, '/api/v1/projections/udm_00000000-0000-4000-8000-000000000001/history');
  assert.equal(hist.result.isError, false);
  const limited = await keyed.rpc('tools/call', {name: 'get_results', arguments: {league: 'NBA'}});
  assert.equal(limited.result.isError, true);
  assert.match(limited.result.content[0].text, /upgrade_url/);
  const unknown = await keyed.rpc('nope/method', {});
  assert.equal(unknown.error.code, -32601);
  keyed.close();
  api.server.close();
});

test('live keyless demo against underdogapi.com (UNDERDOG_LIVE=1)', {skip: process.env.UNDERDOG_LIVE !== '1'}, async () => {
  const s = session({UNDERDOG_API_KEY: ''});
  await s.rpc('initialize', {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 't', version: '1'}});
  const r = await s.rpc('tools/call', {name: 'demo_board', arguments: {league: 'NBA', limit: 1}});
  assert.equal(r.result.isError, false);
  assert.match(r.result.content[0].text, /"data"/);
  s.close();
});
