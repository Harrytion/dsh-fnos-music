import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeviceProbeScheduler } from '../lib/state/probe.js';

const settings = { backgroundProbe: true, backgroundProbeIntervalSec: 120 };
const devices = [
  { id: 'active', name: 'Active' },
  { id: 'auth', name: 'Auth' },
  { id: 'lan', name: 'LAN' },
];

test('background probe skips active/auth, requires clients, and reports once', async () => {
  const probed = [];
  let clients = false;
  let rounds = 0;
  const scheduler = new DeviceProbeScheduler({
    devices: () => devices,
    activeId: () => 'active',
    settings: () => settings,
    hasClients: () => clients,
    skip: (device) => device.id === 'auth',
    probe: async (device) => { probed.push(device.id); },
    onRound: () => { rounds += 1; },
  });
  await scheduler.runOnce();
  assert.deepEqual(probed, []);
  clients = true;
  await scheduler.runOnce();
  assert.deepEqual(probed, ['lan']);
  assert.equal(rounds, 1);
  scheduler.dispose();
});

test('background probe is disabled when the setting is off', async () => {
  const probed = [];
  const scheduler = new DeviceProbeScheduler({
    devices: () => devices,
    activeId: () => 'active',
    settings: () => ({ ...settings, backgroundProbe: false }),
    hasClients: () => true,
    probe: async (device) => { probed.push(device.id); },
  });
  await scheduler.runOnce();
  assert.deepEqual(probed, []);
  scheduler.dispose();
});
