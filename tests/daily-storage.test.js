import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultDailyState, removeDaily } from '../daily-store.js';
import { createDailyStorage, DAILY_STORAGE_KEY, DAILY_BACKUP_KEY } from '../daily-storage.js';

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    failOn: new Set(),
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      if (this.failOn.has(key)) throw new Error('quota exceeded');
      values.set(key, String(value));
    },
  };
}

test('a missing key initializes the four default routines exactly once', () => {
  const storage = createMemoryStorage();
  const first = createDailyStorage(storage).load();
  assert.equal(first.ok, true);
  assert.equal(first.initialized, true);
  assert.deepEqual(first.state, createDefaultDailyState());

  const second = createDailyStorage(storage).load();
  assert.equal(second.ok, true);
  assert.equal(second.initialized, false);
  assert.deepEqual(second.state, first.state);
  assert.equal(storage.values.size, 1);
});

test('an existing empty routine list remains empty when reloaded', () => {
  const storage = createMemoryStorage({
    [DAILY_STORAGE_KEY]: JSON.stringify({ version: 1, items: [], completions: {} }),
  });
  const result = createDailyStorage(storage).load();
  assert.equal(result.ok, true);
  assert.equal(result.initialized, false);
  assert.deepEqual(result.state.items, []);
});

test('corrupt JSON and unknown future versions remain untouched until explicit recovery', () => {
  for (const raw of ['{bad json', JSON.stringify({ version: 99, items: [], completions: {} })]) {
    const storage = createMemoryStorage({ [DAILY_STORAGE_KEY]: raw });
    const result = createDailyStorage(storage).load();
    assert.equal(result.ok, false);
    assert.equal(result.kind, 'corrupt');
    assert.equal(result.raw, raw);
    assert.equal(storage.getItem(DAILY_STORAGE_KEY), raw);
  }
});

test('a failed save reports an error and leaves the previous stored value intact', () => {
  const original = JSON.stringify(createDefaultDailyState());
  const storage = createMemoryStorage({ [DAILY_STORAGE_KEY]: original });
  storage.failOn.add(DAILY_STORAGE_KEY);
  const state = removeDaily(createDefaultDailyState(), 'routine-douyin-chart');
  const result = createDailyStorage(storage).save(state);
  assert.equal(result.ok, false);
  assert.match(result.message, /quota exceeded/);
  assert.equal(storage.getItem(DAILY_STORAGE_KEY), original);
});

test('explicit recovery backs up the original value before writing defaults', () => {
  const raw = '{corrupt user data';
  const storage = createMemoryStorage({ [DAILY_STORAGE_KEY]: raw });
  const result = createDailyStorage(storage).restoreDefaults(raw);
  assert.equal(result.ok, true);
  assert.equal(storage.getItem(DAILY_BACKUP_KEY), raw);
  assert.deepEqual(JSON.parse(storage.getItem(DAILY_STORAGE_KEY)), createDefaultDailyState());
});

test('failed recovery keeps the original value even after backup succeeds', () => {
  const raw = '{corrupt user data';
  const storage = createMemoryStorage({ [DAILY_STORAGE_KEY]: raw });
  storage.failOn.add(DAILY_STORAGE_KEY);
  const result = createDailyStorage(storage).restoreDefaults(raw);
  assert.equal(result.ok, false);
  assert.equal(storage.getItem(DAILY_BACKUP_KEY), raw);
  assert.equal(storage.getItem(DAILY_STORAGE_KEY), raw);
});

test('storage access errors are returned without attempting a reset', () => {
  const blockedStorage = {
    getItem() { throw new Error('access denied'); },
    setItem() { throw new Error('write should not run'); },
  };
  const result = createDailyStorage(blockedStorage).load();
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'read-error');
  assert.match(result.message, /access denied/);
});