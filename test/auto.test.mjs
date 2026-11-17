import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AutoTransport } from '../lib/transport/auto.js';

function layers(ok, code) {
  return {
    gateway: { ok, latencyMs: 1, ...(code ? { code } : {}) },
    device: { ok, latencyMs: 1, ...(code ? { code } : {}) },
    service: { ok, latencyMs: 1, ...(code ? { code } : {}) },
  };
}
function fake(kind, options = {}) {
  const calls = { request: 0, stream: 0, login: 0, dispose: 0, probe: 0 };
  return {
    kind, via: kind, base: `http://${kind}`, relay: kind === 'fnid',
    calls,
    async probe() { calls.probe += 1; return options.layers ?? layers(true); },
    async request(path) { calls.request += 1; return options.request ?? { ok: true, data: path }; },
    async stream(path) { calls.stream += 1; return options.stream ?? { ok: true, data: path }; },
    async login() { calls.login += 1; return options.login ?? { ok: true, data: { token: 't', user: 'u' } }; },
    setToken() {},
    dispose() { calls.dispose += 1; },
  };
}

test('auto chooses direct when it answers, otherwise fnid', async () => {
  const direct = fake('direct');
  const fnid = fake('fnid');
  const auto = new AutoTransport({}, direct, fnid);
  const result = await auto.probe();
  assert.equal(result.service.ok, true);
  assert.equal(auto.via, 'direct');

  const directDown = fake('direct', { layers: layers(false, 'refused') });
  const fnidUp = fake('fnid');
  const auto2 = new AutoTransport({}, directDown, fnidUp);
  await auto2.probe();
  assert.equal(auto2.via, 'fnid');
});

test('network request failure fails over once; auth does not', async () => {
  const direct = fake('direct', { layers: layers(false, 'refused'), request: { ok: false, error: { code: 'refused', message: 'no' } } });
  const fnid = fake('fnid');
  const auto = new AutoTransport({}, direct, fnid);
  const ok = await auto.request('/x');
  assert.equal(ok.ok, true);
  assert.equal(auto.via, 'fnid');

  const directAuth = fake('direct', { layers: layers(true), request: { ok: false, error: { code: 'auth', message: 'bad token' } } });
  const fnid2 = fake('fnid');
  const auto2 = new AutoTransport({}, directAuth, fnid2);
  const bad = await auto2.request('/x');
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'auth');
  assert.equal(fnid2.calls.request, 0);
});

test('POST requests are not replayed on the other path', async () => {
  const direct = fake('direct', { layers: layers(true), request: { ok: false, error: { code: 'refused', message: 'lost response' } } });
  const fnid = fake('fnid');
  const auto = new AutoTransport({}, direct, fnid);
  const bad = await auto.request('/playlist/create', { method: 'POST', body: { name: 'x' } });
  assert.equal(bad.ok, false);
  assert.equal(fnid.calls.request, 0);
});

test('login falls back on network errors only; dispose releases both', async () => {
  const direct = fake('direct', { login: { ok: false, error: { code: 'network', message: 'down' } } });
  const fnid = fake('fnid');
  const auto = new AutoTransport({}, direct, fnid);
  const login = await auto.login('u', 'p');
  assert.equal(login.ok, true);
  assert.equal(fnid.calls.login, 1);
  auto.dispose();
  assert.equal(direct.calls.dispose, 1);
  assert.equal(fnid.calls.dispose, 1);
});
