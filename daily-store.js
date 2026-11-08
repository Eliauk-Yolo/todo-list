const STORAGE_VERSION = 1;
const MAX_TEXT_LENGTH = 120;
const MIN_MINUTES = 1;
const MAX_MINUTES = 999;

const DEFAULT_ITEMS = [
  { id: 'routine-douyin-chart', text: '看抖音创意中心榜单', minutes: 10 },
  { id: 'routine-xhs-keywords', text: '小红书站内关键词搜索', minutes: 10 },
  { id: 'routine-xhs-low-score', text: '小红书站内低分爆款', minutes: 20 },
  { id: 'routine-account-monitor', text: '对标账号每天上品监测', minutes: 10 },
];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validationFailure(reason, message) {
  return { valid: false, reason, message };
}

function isValidDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function cloneState(state) {
  return {
    version: STORAGE_VERSION,
    items: state.items.map((item) => ({ ...item })),
    completions: Object.fromEntries(
      Object.entries(state.completions).map(([date, ids]) => [date, [...ids]]),
    ),
  };
}

function validateItemValues(text, minutes) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('事项内容不能为空');
  }
  const normalizedText = text.trim();
  if (normalizedText.length > MAX_TEXT_LENGTH) {
    throw new Error('事项内容最多 120 个字符');
  }
  if (!Number.isInteger(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
    throw new Error('预计时长必须为 1 到 999 的整数');
  }
  return { text: normalizedText, minutes };
}

function requireItem(state, id) {
  const index = state.items.findIndex((item) => item.id === id);
  if (index < 0) throw new Error('每日必做事项不存在');
  return index;
}

export function createDefaultDailyState() {
  return {
    version: STORAGE_VERSION,
    items: DEFAULT_ITEMS.map((item) => ({ ...item })),
    completions: {},
  };
}

export function getLocalDateKey(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('日期必须是有效的 Date 对象');
  }
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getNextLocalMidnight(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('日期必须是有效的 Date 对象');
  }
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

export function validateDailyState(value) {
  let state = value;
  if (typeof value === 'string') {
    try {
      state = JSON.parse(value);
    } catch {
      return validationFailure('invalid-json', '每日必做数据无法读取，原始内容已保留。');
    }
  }
  if (!isPlainObject(state)) {
    return validationFailure('invalid-shape', '每日必做数据格式无效，原始内容已保留。');
  }
  if (Number.isInteger(state.version) && state.version > STORAGE_VERSION) {
    return validationFailure('unsupported-version', '每日必做数据来自较新版本，已停止写入以保护数据。');
  }
  if (state.version !== STORAGE_VERSION) {
    return validationFailure('invalid-version', '每日必做数据版本无效，原始内容已保留。');
  }
  if (!Array.isArray(state.items) || !isPlainObject(state.completions)) {
    return validationFailure('invalid-shape', '每日必做数据结构无效，原始内容已保留。');
  }

  const ids = new Set();
  for (const item of state.items) {
    if (!isPlainObject(item)
      || typeof item.id !== 'string'
      || !item.id.trim()
      || item.id.length > 200
      || ids.has(item.id)
      || typeof item.text !== 'string'
      || !item.text.trim()
      || item.text !== item.text.trim()
      || item.text.length > MAX_TEXT_LENGTH
      || !Number.isInteger(item.minutes)
      || item.minutes < MIN_MINUTES
      || item.minutes > MAX_MINUTES) {
      return validationFailure('invalid-item', '每日必做中有无效事项，原始内容已保留。');
    }
    ids.add(item.id);
  }

  for (const [date, completedIds] of Object.entries(state.completions)) {
    if (!isValidDateKey(date)
      || !Array.isArray(completedIds)
      || completedIds.some((id) => typeof id !== 'string' || !id)
      || new Set(completedIds).size !== completedIds.length) {
      return validationFailure('invalid-completions', '每日必做打卡记录无效，原始内容已保留。');
    }
  }
  return { valid: true, state };
}

export function addDaily(state, text, minutes, options = {}) {
  const value = validateItemValues(text, minutes);
  const id = options.id ?? globalThis.crypto?.randomUUID?.();
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error('无法生成事项编号');
  }
  if (state.items.some((item) => item.id === id)) {
    throw new Error('事项编号重复');
  }
  return {
    ...cloneState(state),
    items: [...state.items.map((item) => ({ ...item })), { id, ...value }],
  };
}

export function editDaily(state, id, text, minutes) {
  const index = requireItem(state, id);
  const value = validateItemValues(text, minutes);
  const items = state.items.map((item) => ({ ...item }));
  items[index] = { id, ...value };
  return { ...cloneState(state), items };
}

export function removeDaily(state, id) {
  const index = requireItem(state, id);
  return {
    ...cloneState(state),
    items: state.items.filter((item) => item.id !== id).map((item) => ({ ...item })),
  };
}

export function toggleDailyForDate(state, id, dateKey) {
  requireItem(state, id);
  if (!isValidDateKey(dateKey)) throw new Error('打卡日期无效');
  const next = cloneState(state);
  const ids = next.completions[dateKey] ?? [];
  if (ids.includes(id)) {
    const remaining = ids.filter((completedId) => completedId !== id);
    if (remaining.length) next.completions[dateKey] = remaining;
    else delete next.completions[dateKey];
  } else {
    next.completions[dateKey] = [...ids, id];
  }
  return next;
}

export function getDailySummary(state, dateKey) {
  const completedIds = new Set(state.completions[dateKey] ?? []);
  return {
    completedCount: state.items.filter((item) => completedIds.has(item.id)).length,
    totalCount: state.items.length,
    totalMinutes: state.items.reduce((total, item) => total + item.minutes, 0),
  };
}

export function pruneDailyHistory(state, today = new Date(), options = {}) {
  const todayDate = typeof today === 'string' ? localDateFromKey(today) : today;
  const cutoff = new Date(
    todayDate.getFullYear(),
    todayDate.getMonth(),
    todayDate.getDate() - 89,
    12,
  );
  const cutoffKey = getLocalDateKey(cutoff);
  const activeIds = new Set([
    ...state.items.map((item) => item.id),
    ...(options.preserveIds ?? []),
  ]);
  const completions = {};
  for (const [date, ids] of Object.entries(state.completions)) {
    if (date < cutoffKey) continue;
    const remaining = ids.filter((id) => activeIds.has(id));
    if (remaining.length) completions[date] = remaining;
  }
  return { ...cloneState(state), completions };
}

function localDateFromKey(value) {
  if (!isValidDateKey(value)) throw new Error('清理日期无效');
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

export function restoreDaily(state, item, index, completedDates = {}) {
  if (state.items.some((entry) => entry.id === item.id)) {
    throw new Error('事项编号重复');
  }
  const value = validateItemValues(item.text, item.minutes);
  if (typeof item.id !== 'string' || !item.id.trim()) {
    throw new Error('事项编号无效');
  }
  const next = cloneState(state);
  const position = Math.max(0, Math.min(Number.isInteger(index) ? index : next.items.length, next.items.length));
  next.items.splice(position, 0, { id: item.id, ...value });
  for (const [date, ids] of Object.entries(completedDates)) {
    if (!isValidDateKey(date) || !Array.isArray(ids) || !ids.includes(item.id)) continue;
    const current = next.completions[date] ?? [];
    next.completions[date] = current.includes(item.id) ? current : [...current, item.id];
  }
  return next;
}