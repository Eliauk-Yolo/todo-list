import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addDaily,
  createDefaultDailyState,
  editDaily,
  getDailySummary,
  getLocalDateKey,
  getNextLocalMidnight,
  pruneDailyHistory,
  removeDaily,
  restoreDaily,
  toggleDailyForDate,
  validateDailyState,
} from '../daily-store.js';

const expectedItems = [
  { id: 'routine-douyin-chart', text: '看抖音创意中心榜单', minutes: 10 },
  { id: 'routine-xhs-keywords', text: '小红书站内关键词搜索', minutes: 10 },
  { id: 'routine-xhs-low-score', text: '小红书站内低分爆款', minutes: 20 },
  { id: 'routine-account-monitor', text: '对标账号每天上品监测', minutes: 10 },
];

test('default daily routines preserve the requested wording, order, and 50-minute total', () => {
  const state = createDefaultDailyState();
  assert.deepEqual(state, { version: 1, items: expectedItems, completions: {} });
  assert.deepEqual(getDailySummary(state, '2026-11-08'), {
    completedCount: 0,
    totalCount: 4,
    totalMinutes: 50,
  });
  assert.notEqual(createDefaultDailyState(), state);
});

test('local date keys use local calendar fields instead of the UTC date', () => {
  const previousTimeZone = process.env.TZ;
  try {
    process.env.TZ = 'Asia/Shanghai';
    const justAfterLocalMidnight = new Date('2026-11-07T16:30:00.000Z');
    assert.equal(justAfterLocalMidnight.toISOString().slice(0, 10), '2026-11-07');
    assert.equal(getLocalDateKey(justAfterLocalMidnight), '2026-11-08');
  } finally {
    if (previousTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimeZone;
  }
});

test('validateDailyState accepts the supported version and rejects malformed or future data without fallback', () => {
  const state = createDefaultDailyState();
  assert.deepEqual(validateDailyState(state), { valid: true, state });
  assert.equal(validateDailyState({ ...state, version: 2 }).reason, 'unsupported-version');
  assert.equal(validateDailyState('{broken').valid, false);
  assert.equal(validateDailyState({ ...state, items: [], completions: [] }).valid, false);
  assert.equal(validateDailyState({
    ...state,
    items: [...state.items, { ...state.items[0] }],
  }).valid, false);
  assert.equal(validateDailyState({
    ...state,
    items: [{ id: 'bad', text: '  ', minutes: 10 }],
  }).valid, false);
  assert.equal(validateDailyState({
    ...state,
    items: [{ id: 'bad', text: '有效事项', minutes: 0 }],
  }).valid, false);
  assert.equal(validateDailyState({
    ...state,
    items: [{ id: 'bad', text: '有效事项', minutes: 1000 }],
  }).valid, false);
});

test('addDaily trims valid content, appends in order, and validates text and minutes', () => {
  const state = createDefaultDailyState();
  const next = addDaily(state, '  新增的中文事项  ', 1, { id: 'new-routine' });
  assert.deepEqual(next.items.at(-1), {
    id: 'new-routine',
    text: '新增的中文事项',
    minutes: 1,
  });
  assert.equal(next.items.length, 5);
  assert.equal(addDaily(state, '事项', 999, { id: 'max-minutes' }).items.at(-1).minutes, 999);
  assert.throws(() => addDaily(state, '   ', 10, { id: 'blank' }), /不能为空/);
  assert.throws(() => addDaily(state, 'x'.repeat(121), 10, { id: 'too-long' }), /120/);
  for (const minutes of [0, -1, 1.5, '10', 1000]) {
    assert.throws(() => addDaily(state, '事项', minutes, { id: 'invalid-duration' }), /1 到 999/);
  }
});

test('editDaily changes text and duration while retaining identity and daily completions', () => {
  const completed = toggleDailyForDate(createDefaultDailyState(), expectedItems[0].id, '2026-11-08');
  const next = editDaily(completed, expectedItems[0].id, '  新文案  ', 35);
  assert.deepEqual(next.items[0], {
    id: expectedItems[0].id,
    text: '新文案',
    minutes: 35,
  });
  assert.deepEqual(next.completions, completed.completions);
  assert.throws(() => editDaily(next, expectedItems[0].id, ' ', 10), /不能为空/);
  assert.throws(() => editDaily(next, expectedItems[0].id, '有效', 0), /1 到 999/);
});

test('removeDaily removes only the selected item and keeps its completion for same-session undo', () => {
  const checked = toggleDailyForDate(createDefaultDailyState(), expectedItems[1].id, '2026-11-08');
  const next = removeDaily(checked, expectedItems[1].id);
  assert.deepEqual(next.items, [expectedItems[0], expectedItems[2], expectedItems[3]]);
  assert.deepEqual(next.completions['2026-11-08'], [expectedItems[1].id]);
  assert.equal(checked.items.length, 4);
});

test('toggleDailyForDate changes only the requested item and date', () => {
  const state = createDefaultDailyState();
  const yesterday = toggleDailyForDate(state, expectedItems[0].id, '2026-11-07');
  const today = toggleDailyForDate(yesterday, expectedItems[0].id, '2026-11-08');
  assert.deepEqual(today.completions, {
    '2026-11-07': [expectedItems[0].id],
    '2026-11-08': [expectedItems[0].id],
  });
  assert.deepEqual(toggleDailyForDate(today, expectedItems[0].id, '2026-11-08').completions, {
    '2026-11-07': [expectedItems[0].id],
  });
  assert.throws(() => toggleDailyForDate(today, 'missing-id', '2026-11-08'), /不存在/);
});

test('getDailySummary counts only today while total minutes include completed and pending items', () => {
  const state = toggleDailyForDate(
    toggleDailyForDate(createDefaultDailyState(), expectedItems[0].id, '2026-11-07'),
    expectedItems[1].id,
    '2026-11-08',
  );
  assert.deepEqual(getDailySummary(state, '2026-11-08'), {
    completedCount: 1,
    totalCount: 4,
    totalMinutes: 50,
  });
  assert.deepEqual(getDailySummary(state, '2026-11-09'), {
    completedCount: 0,
    totalCount: 4,
    totalMinutes: 50,
  });
});

test('pruneDailyHistory keeps the latest 90 local dates and current template IDs', () => {
  const today = new Date(2026, 2, 31, 12);
  const cutoff = new Date(2026, 2, 31 - 89, 12);
  const older = new Date(cutoff.getFullYear(), cutoff.getMonth(), cutoff.getDate() - 1, 12);
  const dateKey = (date) => getLocalDateKey(date);
  const state = createDefaultDailyState();
  state.completions = {
    [dateKey(older)]: [expectedItems[0].id],
    [dateKey(cutoff)]: [expectedItems[0].id, 'deleted-routine'],
    [dateKey(today)]: [expectedItems[1].id],
  };
  const next = pruneDailyHistory(state, today);
  assert.deepEqual(next.completions, {
    [dateKey(cutoff)]: [expectedItems[0].id],
    [dateKey(today)]: [expectedItems[1].id],
  });
  assert.equal(Object.keys(state.completions).length, 3);
});

test('restoring a removed routine keeps its original position and completed dates', () => {
  const state = removeDaily(
    toggleDailyForDate(createDefaultDailyState(), expectedItems[1].id, '2026-11-08'),
    expectedItems[1].id,
  );
  const restored = restoreDaily(state, expectedItems[1], 1, {
    '2026-11-08': [expectedItems[1].id],
  });
  assert.deepEqual(restored.items, expectedItems);
  assert.deepEqual(restored.completions['2026-11-08'], [expectedItems[1].id]);
});
test('next midnight follows local calendar dates across daylight saving time', () => {
  const previousTimeZone = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    const beforeSpringForward = new Date('2026-03-08T06:30:00.000Z');
    const midnight = getNextLocalMidnight(beforeSpringForward);
    assert.equal(getLocalDateKey(midnight), '2026-03-09');
    assert.equal(midnight.getHours(), 0);
    assert.notEqual(midnight.getTime() - beforeSpringForward.getTime(), 24 * 60 * 60 * 1000);
  } finally {
    if (previousTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimeZone;
  }
});