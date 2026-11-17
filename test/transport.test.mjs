import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  buildAuthCookie,
  normalizeDirectAddress,
  normalizeFnid,
  relayCandidates,
  isPrivateHost,
  readStreamBuffer,
  tcpProbe,
} from '../lib/transport/http.js';
import { createDirectTransport } from '../lib/transport/direct.js';
import { createFnidTransport, FnidTransport } from '../lib/transport/fnid.js';
import { startMockNas, mockTarget, TOKEN } from './mock-nas.mjs';

test('normalizeDirectAddress adds fnOS ports, strips /music, and handles unix sockets', () => {
  assert.deepEqual(normalizeDirectAddress('192.168.1.10'), {
    ok: true,
    data: { base: 'http://192.168.1.10:5666', kind: 'direct', relay: false },
  });
  assert.deepEqual(normalizeDirectAddress('https://nas.example.com/music/'), {
    ok: true,
    data: { base: 'https://nas.example.com:5667', kind: 'direct', relay: false },
  });
  assert.deepEqual(normalizeDirectAddress('http://nas:8000/prefix/music/'), {
    ok: true,
    data: { base: 'http://nas:8000/prefix', kind: 'direct', relay: false },
  });
  const unix = normalizeDirectAddress('unix:///tmp/trim.music.sock');
  assert.equal(unix.ok, true);
  assert.equal(unix.data.socketPath, '/tmp/trim.music.sock');
  assert.equal(unix.data.kind, 'unix');
  assert.equal(normalizeDirectAddress('ftp://nas').ok, false);
  assert.equal(normalizeDirectAddress('http://user:pass@nas').ok, false);
});

test('FNID validation and relay candidates', () => {
  assert.equal(normalizeFnid('MyNas').data, 'mynas');
  assert.equal(normalizeFnid('my nas').ok, false);
  assert.equal(normalizeFnid('localhost').ok, false);
  assert.deepEqual(relayCandidates('mynas'), ['https://mynas.fnos.net', 'https://mynas.5ddd.com']);
  assert.equal(isPrivateHost('192.168.1.2'), true);
  assert.equal(isPrivateHost('10.1.2.3'), true);
  assert.equal(isPrivateHost('8.8.8.8'), false);
});

test('auth cookie encodes the token and adds the relay marker', () => {
  assert.equal(buildAuthCookie('a b', true), 'music-token=a%20b; mode=relay');
  assert.equal(buildAuthCookie('', true), 'mode=relay');
  assert.equal(buildAuthCookie('', false), null);
});

test('direct transport reads /user/me, probes, and streams Range audio', async () => {
  const mock = await startMockNas();
  const created = createDirectTransport(mockTarget(mock.base));
  assert.equal(created.ok, true);
  const transport = created.data;
  try {
    const me = await transport.request('/user/me');
    assert.equal(me.ok, true);
    assert.equal(me.data.user.username, 'test');

    const probe = await transport.probe();
    assert.equal(probe.gateway.ok, true, JSON.stringify(probe));
    assert.equal(probe.device.ok, true, JSON.stringify(probe));
    assert.equal(probe.service.ok, true, JSON.stringify(probe));

    const stream = await transport.stream('/track/stream', {
      query: { guid: 'track-1' },
      headers: { range: 'bytes=0-9' },
    });
    assert.equal(stream.ok, true, stream.ok ? '' : JSON.stringify(stream.error));
    assert.equal(stream.data.status, 206);
    const buffer = await readStreamBuffer(stream.data.stream, 1024);
    assert.equal(buffer.ok, true);
    assert.equal(buffer.data.length, 10);
  } finally {
    transport.dispose();
    await mock.close();
  }
});

test('direct transport logs in with the native password endpoint', async () => {
  const mock = await startMockNas();
  const created = createDirectTransport({ ...mockTarget(mock.base), token: '' });
  assert.equal(created.ok, true);
  const transport = created.data;
  try {
    const login = await transport.login('test', 'secret');
    assert.equal(login.ok, true, JSON.stringify(login));
    assert.equal(login.data.token, TOKEN);
    const me = await transport.request('/user/me');
    assert.equal(me.ok, true);
  } finally {
    transport.dispose();
    await mock.close();
  }
});

test('a closed port is reported as a refused/gateway failure, not a hang', async () => {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const created = createDirectTransport({ ...mockTarget(`http://127.0.0.1:${port}`), token: TOKEN });
  assert.equal(created.ok, true);
  const transport = created.data;
  try {
    const probe = await transport.probe();
    assert.equal(probe.gateway.ok, false);
    assert.equal(['refused', 'gateway_unreachable', 'gateway_timeout'].includes(probe.gateway.code), true, String(probe.gateway.code));
  } finally {
    transport.dispose();
  }
});

test('unix socket transport reaches an HTTP server on the socket', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fnos-sock-'));
  const socketPath = path.join(dir, 'music.sock');
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ code: 0, data: { user: { username: 'test' } } }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  const created = createDirectTransport({ ...mockTarget('unix:///unused'), address: `unix://${socketPath}`, token: TOKEN });
  assert.equal(created.ok, true);
  const transport = created.data;
  try {
    const me = await transport.request('/user/me');
    assert.equal(me.ok, true);
    assert.equal(me.data.user.username, 'test');
  } finally {
    transport.dispose();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('tcpProbe reports an open and a closed socket', async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const open = await tcpProbe(`http://127.0.0.1:${port}`, undefined, 1000);
  assert.equal(open.ok, true);
  await new Promise((resolve) => server.close(resolve));
  const closed = await tcpProbe(`http://127.0.0.1:${port}`, undefined, 1000);
  assert.equal(closed.ok, false);
});

test('FNID transport selects the cluster that answers and reports device offline', async () => {
  const target = { ...mockTarget('https://mynas.fnos.net'), mode: 'fnid', fnid: 'mynas', address: undefined };
  const okBody = Buffer.from(JSON.stringify({ code: 0, data: { user: { username: 'test' } } }));
  const headers = { 'content-type': 'application/json' };
  const answers = {
    'https://mynas.fnos.net': { status: 404, headers: { 'content-type': 'text/html' }, body: Buffer.from('<html>not here</html>'), ms: 3 },
    'https://mynas.5ddd.com': { status: 200, headers, body: okBody, ms: 7 },
  };
  class FakeFnid extends FnidTransport {
    constructor() {
      super(target, 'mynas');
    }
    async rawAt(base) {
      return this.answers[base] ?? { status: 404, headers: {}, body: Buffer.from(''), ms: 1 };
    }
    get answers() {
      return answers;
    }
  }
  const transport = new FakeFnid();
  try {
    assert.equal(transport.base, 'https://mynas.fnos.net');
    const probe = await transport.probe();
    assert.equal(probe.gateway.ok, true, JSON.stringify(probe));
    assert.equal(probe.device.ok, true, JSON.stringify(probe));
    assert.equal(probe.service.ok, true, JSON.stringify(probe));
    assert.equal(transport.base, 'https://mynas.5ddd.com');
  } finally {
    transport.dispose();
  }

  const offlineAnswers = {
    'https://mynas.fnos.net': { status: 502, headers: { 'content-type': 'text/html' }, body: Buffer.from('bad gateway'), ms: 3 },
    'https://mynas.5ddd.com': { status: 404, headers: { 'content-type': 'text/html' }, body: Buffer.from('not here'), ms: 7 },
  };
  class OfflineFnid extends FnidTransport {
    constructor() {
      super(target, 'mynas');
    }
    async rawAt(base) {
      return offlineAnswers[base] ?? { status: 404, headers: {}, body: Buffer.from(''), ms: 1 };
    }
  }
  const offline = new OfflineFnid();
  try {
    const probe = await offline.probe();
    assert.equal(probe.device.ok, false);
    assert.equal(probe.device.code, 'device_offline');
  } finally {
    offline.dispose();
  }
});

test('FNID factory rejects malformed ids', () => {
  const result = createFnidTransport({ ...mockTarget('unused'), mode: 'fnid', fnid: 'bad id', address: undefined });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'bad_request');
});
