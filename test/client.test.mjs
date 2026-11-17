import { test } from 'node:test';
import assert from 'node:assert/strict';

test('client module exposes the three DSH slot registrations and cleans up', async () => {
  let captured = null;
  globalThis.window = {
    __ModuleLoader__: {
      load(definition) {
        captured = definition;
      },
    },
  };
  globalThis.document = {
    head: { appendChild() {} },
    createElement() {
      return { dataset: {}, textContent: '', remove() {} };
    },
  };
  const noop = () => {};
  const React = {
    createElement: (...args) => args,
    createContext: (value) => ({ Provider: function Provider() {}, Consumer: function Consumer() {}, value }),
    useCallback: (fn) => fn,
    useContext: () => null,
    useEffect: noop,
    useMemo: (fn) => fn(),
    useReducer: (_reducer, initial) => [initial, noop],
    useRef: (value) => ({ current: value }),
    useState: (value) => [value, noop],
  };
  await import(`../client.js?smoke=${Date.now()}`);
  assert.ok(captured, 'module loader captured');
  assert.equal(captured.id, 'dsh-fnos-music');
  const exported = captured.factory((name) => {
    assert.equal(name, 'react');
    return React;
  });
  assert.deepEqual(exported.inject, ['slots', 'locale']);

  const registrations = [];
  const disposers = [];
  let dictionaries = null;
  const locale = {
    bind: () => (key) => key,
    register: (_ns, dicts) => {
      dictionaries = dicts;
      return () => {};
    },
  };
  const slots = {
    inject(_key, callback) {
      return callback();
    },
    register(options, component) {
      registrations.push({ options, component });
      return () => {};
    },
  };
  const ctx = {
    locale,
    slots,
    effect(callback) {
      const disposer = callback();
      if (typeof disposer === 'function') disposers.push(disposer);
      return () => {};
    },
    inject(names, callback) {
      if (names.includes('layout')) callback({ layout: { selectPanel() {} } });
    },
    get() {
      return undefined;
    },
  };
  exported.apply(ctx);
  assert.equal(registrations.length, 4);
  const byName = new Map(registrations.map((entry) => [entry.options.name, entry]));
  assert.equal(byName.get('sidebar.panellist').options.id, 'fnos-music');
  assert.equal(byName.get('main').options.key, 'fnos-music');
  assert.equal(byName.get('sidebar.footer.action').options.id, 'fnos-music');
  assert.equal(byName.get('shell.overlay').options.id, 'fnos-music-mini');
  for (const entry of registrations) assert.equal(typeof entry.component, 'function');
  assert.ok(dictionaries, 'locale dictionaries registered');
  const zhKeys = Object.keys(dictionaries.zh).sort();
  const enKeys = Object.keys(dictionaries.en).sort();
  assert.deepEqual(zhKeys, enKeys, 'zh and en dictionaries must have the same keys');
  for (const key of zhKeys) {
    assert.equal(typeof dictionaries.zh[key], 'string', `zh.${key}`);
    assert.equal(typeof dictionaries.en[key], 'string', `en.${key}`);
    assert.notEqual(dictionaries.zh[key], '', `zh.${key} is empty`);
    assert.notEqual(dictionaries.en[key], '', `en.${key} is empty`);
  }
  for (const dispose of disposers.reverse()) dispose();
});
