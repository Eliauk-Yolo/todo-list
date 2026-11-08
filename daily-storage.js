import { createDefaultDailyState, validateDailyState } from './daily-store.js';

export const DAILY_STORAGE_KEY = 'daily-focus-routines-v1';
export const DAILY_BACKUP_KEY = 'daily-focus-routines-v1-backup';

function storageError(error) {
  return error instanceof Error ? error.message : '浏览器本地存储不可用';
}

export function createDailyStorage(storage) {
  function getStorage() { return storage ?? globalThis.localStorage; }
  function load() {
    let raw;
    try {
      raw = getStorage().getItem(DAILY_STORAGE_KEY);
    } catch (error) {
      return { ok: false, kind: 'read-error', message: storageError(error) };
    }

    if (raw === null) {
      const state = createDefaultDailyState();
      const saved = save(state);
      if (!saved.ok) {
        return {
          ok: false,
          kind: 'write-error',
          message: saved.message,
          state,
        };
      }
      return { ok: true, state, initialized: true };
    }

    const result = validateDailyState(raw);
    if (!result.valid) {
      return {
        ok: false,
        kind: 'corrupt',
        message: result.message,
        reason: result.reason,
        raw,
      };
    }
    return { ok: true, state: result.state, initialized: false };
  }

  function save(state) {
    const result = validateDailyState(state);
    if (!result.valid) {
      return { ok: false, kind: 'invalid-state', message: result.message };
    }
    try {
      getStorage().setItem(DAILY_STORAGE_KEY, JSON.stringify(state));
      return { ok: true };
    } catch (error) {
      return { ok: false, kind: 'write-error', message: storageError(error) };
    }
  }

  function restoreDefaults(rawValue) {
    let current;
    try {
      current = getStorage().getItem(DAILY_STORAGE_KEY);
    } catch (error) {
      return { ok: false, kind: 'read-error', message: storageError(error) };
    }
    if (current !== rawValue) {
      return { ok: false, kind: 'stale-data', message: '存储内容已变化，请重新载入后再恢复。' };
    }
    try {
      getStorage().setItem(DAILY_BACKUP_KEY, rawValue);
    } catch (error) {
      return { ok: false, kind: 'backup-error', message: `无法备份原始数据：${storageError(error)}` };
    }

    const state = createDefaultDailyState();
    try {
      getStorage().setItem(DAILY_STORAGE_KEY, JSON.stringify(state));
      return { ok: true, state };
    } catch (error) {
      return { ok: false, kind: 'write-error', message: storageError(error) };
    }
  }

  return { load, save, restoreDefaults };
}
