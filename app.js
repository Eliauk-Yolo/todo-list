import {
  addTodo,
  clearCompleted,
  editTodo,
  filterTodos,
  removeTodo,
  toggleTodo,
} from './todo-store.js';
import {
  addDaily,
  editDaily,
  getDailySummary,
  getLocalDateKey,
  getNextLocalMidnight,
  pruneDailyHistory,
  removeDaily,
  restoreDaily,
  toggleDailyForDate,
} from './daily-store.js';
import { createDailyStorage, DAILY_STORAGE_KEY } from './daily-storage.js';

const STORAGE_KEY = 'daily-focus-todos-v1';
const list = document.querySelector('#todo-list');
const form = document.querySelector('#todo-form');
const input = document.querySelector('#todo-input');
const error = document.querySelector('#form-error');
const emptyState = document.querySelector('#empty-state');
const progressRing = document.querySelector('#progress-ring');
const circumference = 2 * Math.PI * 30;

let todos = loadTodos();
let currentFilter = 'all';

document.querySelector('#today').textContent = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
}).format(new Date());

form.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    todos = addTodo(todos, input.value);
    input.value = '';
    error.textContent = '';
    commit();
  } catch (caught) {
    error.textContent = caught.message;
    input.focus();
  }
});

document.querySelector('.filters').addEventListener('click', (event) => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  currentFilter = button.dataset.filter;
  document.querySelectorAll('.filter').forEach((item) => {
    const selected = item === button;
    item.classList.toggle('active', selected);
    item.setAttribute('aria-pressed', selected);
  });
  render();
});

document.querySelector('#clear-completed').addEventListener('click', () => {
  todos = clearCompleted(todos);
  commit();
});

list.addEventListener('click', (event) => {
  const item = event.target.closest('.todo-item');
  if (!item) return;
  if (event.target.closest('.edit-button')) {
    startEditing(item);
    return;
  }
  if (event.target.closest('.toggle')) todos = toggleTodo(todos, item.dataset.id);
  if (event.target.closest('.delete-button')) todos = removeTodo(todos, item.dataset.id);
  commit();
});

function startEditing(item) {
  const id = item.dataset.id;
  const todo = todos.find((entry) => entry.id === id);
  const label = item.querySelector('.todo-text');
  const editor = document.createElement('input');
  editor.className = 'edit-input';
  editor.value = todo.text;
  editor.maxLength = 120;
  label.replaceWith(editor);
  editor.focus();
  editor.select();

  let cancelled = false;
  const finish = () => {
    if (cancelled) return;
    try {
      todos = editTodo(todos, id, editor.value);
      commit();
    } catch {
      editor.focus();
    }
  };
  editor.addEventListener('blur', finish);
  editor.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') editor.blur();
    if (event.key === 'Escape') {
      cancelled = true;
      render();
    }
  });
}

function commit() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
  render();
}

function loadTodos() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function render() {
  const visibleTodos = filterTodos(todos, currentFilter);
  list.replaceChildren(...visibleTodos.map(createTodoItem));
  emptyState.hidden = visibleTodos.length > 0;

  const completed = todos.filter((todo) => todo.completed).length;
  const remaining = todos.length - completed;
  const percentage = todos.length ? Math.round((completed / todos.length) * 100) : 0;
  document.querySelector('#remaining-count').textContent = `${remaining} 项待完成`;
  document.querySelector('#completed-count').textContent = `已完成 ${completed} 项`;
  document.querySelector('#progress-value').textContent = `${percentage}%`;
  document.querySelector('#clear-completed').disabled = completed === 0;
  progressRing.style.strokeDasharray = circumference;
  progressRing.style.strokeDashoffset = circumference * (1 - percentage / 100);
}

function formatCreatedDate(createdAt) {
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return {
    short: `${month}.${day}`,
    full: `${year}-${month}-${day}`,
    spoken: `创建于${year}年${date.getMonth() + 1}月${date.getDate()}日`,
  };
}

function createTodoItem(todo) {
  const item = document.createElement('li');
  item.className = `todo-item${todo.completed ? ' completed' : ''}`;
  item.dataset.id = todo.id;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'toggle';
  toggle.setAttribute('aria-label', todo.completed ? '标记为待完成' : '标记为已完成');
  toggle.innerHTML = '<span aria-hidden="true">✓</span>';

  const content = document.createElement('span');
  content.className = 'todo-content';

  const createdDate = formatCreatedDate(todo.createdAt);
  if (createdDate) {
    const date = document.createElement('time');
    date.className = 'todo-date';
    date.textContent = createdDate.short;
    date.setAttribute('datetime', createdDate.full);
    date.setAttribute('aria-label', createdDate.spoken);
    content.append(date);
  }

  const text = document.createElement('span');
  text.className = 'todo-text';
  text.textContent = todo.text;
  content.append(text);

  const actions = document.createElement('div');
  actions.className = 'todo-actions';
  actions.innerHTML = `
    <button type="button" class="icon-button edit-button" aria-label="编辑任务">编辑</button>
    <button type="button" class="icon-button delete-button" aria-label="删除任务">删除</button>`;
  item.append(toggle, content, actions);
  return item;
}

const dailyList = document.querySelector('#daily-list');
const dailyStorage = createDailyStorage();
let dailyLoad = dailyStorage.load();
let dailyState = dailyLoad.ok ? dailyLoad.state : (dailyLoad.state ?? null);
let dailyLoadFailure = dailyLoad.ok ? null : dailyLoad;
let dailySaveError = '';
let dailyNotice = '';
let dailyUndo = null;
let dailyEditor = null;
let dailyEditorError = '';
let dailyDateKey = getLocalDateKey(new Date());
let dailyMidnightTimer = null;

function commitDaily(nextState, preserveIds) {
  if (!dailyState) return false;
  const idsToPreserve = preserveIds
    ?? (dailyUndo ? [dailyUndo.item.id] : []);
  let pruned;
  try {
    pruned = pruneDailyHistory(nextState, new Date(), { preserveIds: idsToPreserve });
  } catch (caught) {
    dailySaveError = `保存失败：${caught.message}`;
    return false;
  }
  const result = dailyStorage.save(pruned);
  if (!result.ok) {
    dailySaveError = `保存失败：${result.message}`;
    return false;
  }
  dailyState = pruned;
  dailyLoadFailure = null;
  dailySaveError = '';
  return true;
}

function renderDaily() {
  if (!dailyList) return;
  const items = dailyState?.items ?? [];
  dailyList.replaceChildren(...items.map(createDailyItem));

  const summary = dailyState
    ? getDailySummary(dailyState, dailyDateKey)
    : { completedCount: 0, totalCount: 0, totalMinutes: 0 };
  document.querySelector('#daily-count').textContent =
    `${summary.completedCount} / ${summary.totalCount}`;
  document.querySelector('#daily-minutes').textContent =
    `预计 ${summary.totalMinutes} 分钟`;
  document.querySelector('#daily-empty').hidden = !dailyState || items.length > 0;
  document.querySelector('#daily-new-button').disabled = !dailyState;

  const errorBox = document.querySelector('#daily-storage-error');
  const errorMessage = document.querySelector('#daily-storage-error-message');
  const restoreButton = document.querySelector('#daily-restore-button');
  const messages = [
    dailyLoadFailure?.message,
    dailySaveError,
  ].filter(Boolean);
  errorBox.hidden = messages.length === 0;
  if (errorMessage) errorMessage.textContent = messages.join(' ');
  restoreButton.hidden = dailyLoadFailure?.kind !== 'corrupt';

  const editorForm = document.querySelector('#daily-editor-form');
  editorForm.hidden = !dailyEditor;
  if (dailyEditor) {
    document.querySelector('#daily-editor-heading').textContent =
      dailyEditor.mode === 'edit' ? '编辑事项' : '新增事项';
    document.querySelector('#daily-editor-text').value = dailyEditor.text;
    document.querySelector('#daily-editor-minutes').value = String(dailyEditor.minutes);
    document.querySelector('#daily-editor-error').textContent = dailyEditorError;
  } else {
    document.querySelector('#daily-editor-error').textContent = '';
  }

  const undoMessage = document.querySelector('#daily-undo-message');
  undoMessage.hidden = !dailyUndo;
  document.querySelector('#daily-undo-button').disabled = !dailyUndo;
  document.querySelector('#daily-status').textContent = dailyNotice;
}

function createDailyItem(item) {
  const completed = (dailyState.completions[dailyDateKey] ?? []).includes(item.id);
  const row = document.createElement('li');
  row.className = `daily-item${completed ? ' completed' : ''}`;
  row.dataset.id = item.id;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'daily-toggle';
  toggle.setAttribute('aria-label', completed ? '标记为待完成' : '标记为已完成');
  toggle.setAttribute('aria-pressed', String(completed));
  toggle.innerHTML = '<span aria-hidden="true">✓</span>';

  const content = document.createElement('div');
  content.className = 'daily-content';
  const text = document.createElement('span');
  text.className = 'daily-text';
  text.textContent = item.text;
  const duration = document.createElement('span');
  duration.className = 'daily-duration';
  duration.textContent = `预计 ${item.minutes} 分钟`;
  content.append(text, duration);

  const actions = document.createElement('div');
  actions.className = 'daily-actions';
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'daily-edit-button';
  edit.textContent = '编辑';
  edit.setAttribute('aria-label', `编辑：${item.text}`);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'daily-delete-button';
  remove.textContent = '删除';
  remove.setAttribute('aria-label', `删除：${item.text}`);
  actions.append(edit, remove);
  row.append(toggle, content, actions);
  return row;
}

function openDailyEditor(mode, item) {
  if (!dailyState) return;
  dailyEditor = mode === 'edit'
    ? { mode, id: item.id, text: item.text, minutes: item.minutes }
    : { mode, id: null, text: '', minutes: 10 };
  dailyEditorError = '';
  renderDaily();
  const textInput = document.querySelector('#daily-editor-text');
  textInput.focus();
  if (mode === 'edit') textInput.select();
}

function closeDailyEditor() {
  const restoreId = dailyEditor?.mode === 'edit' ? dailyEditor.id : null;
  dailyEditor = null;
  dailyEditorError = '';
  renderDaily();
  focusDailyEditButton(restoreId);
}

function focusDailyEditButton(id) {
  const row = id && [...dailyList.children].find((item) => item.dataset.id === id);
  const target = row?.querySelector('.daily-edit-button')
    ?? document.querySelector('#daily-new-button');
  target?.focus();
}

function focusDailyToggle(id) {
  const row = [...dailyList.children].find((item) => item.dataset.id === id);
  row?.querySelector('.daily-toggle')?.focus();
}
function saveDailyEditor(event) {
  event.preventDefault();
  if (!dailyEditor || !dailyState) return;
  const textInput = document.querySelector('#daily-editor-text');
  const minutesInput = document.querySelector('#daily-editor-minutes');
  let next;
  try {
    next = dailyEditor.mode === 'edit'
      ? editDaily(dailyState, dailyEditor.id, textInput.value, Number(minutesInput.value))
      : addDaily(dailyState, textInput.value, Number(minutesInput.value));
  } catch (caught) {
    dailyEditorError = caught.message;
    document.querySelector('#daily-editor-error').textContent = dailyEditorError;
    (caught.message.includes('预计时长') ? minutesInput : textInput).focus();
    return;
  }

  const restoreId = dailyEditor.mode === 'edit' ? dailyEditor.id : null;
  if (!commitDaily(next)) {
    document.querySelector('#daily-editor-error').textContent = dailySaveError;
    return;
  }
  dailyEditor = null;
  dailyEditorError = '';
  dailyNotice = restoreId ? '每日必做已更新' : '已新增每日必做';
  renderDaily();
  focusDailyEditButton(restoreId);
}

function deleteDailyItem(id) {
  if (!dailyState) return;
  const index = dailyState.items.findIndex((item) => item.id === id);
  if (index < 0) return;
  const item = dailyState.items[index];
  const completionDates = Object.fromEntries(
    Object.entries(dailyState.completions)
      .filter(([, ids]) => ids.includes(id))
      .map(([date, ids]) => [date, ids.filter((entry) => entry === id)]),
  );
  const next = removeDaily(dailyState, id);
  if (!commitDaily(next, [id])) {
    renderDaily();
    return;
  }
  dailyUndo = { item: { ...item }, index, completionDates };
  if (dailyEditor?.id === id) {
    dailyEditor = null;
    dailyEditorError = '';
  }
  dailyNotice = `已删除：${item.text}`;
  renderDaily();
  const focusId = dailyState.items[Math.min(index, dailyState.items.length - 1)]?.id;
  focusDailyEditButton(focusId);
}

function undoDailyDelete() {
  if (!dailyState || !dailyUndo) return;
  const restored = dailyUndo;
  let next;
  try {
    next = restoreDaily(
      dailyState,
      restored.item,
      restored.index,
      restored.completionDates,
    );
  } catch (caught) {
    dailySaveError = `撤销失败：${caught.message}`;
    renderDaily();
    return;
  }
  if (!commitDaily(next)) {
    renderDaily();
    return;
  }
  dailyUndo = null;
  dailyNotice = '已撤销删除';
  renderDaily();
  focusDailyEditButton(restored.item.id);
}

function handleDailyClick(event) {
  const target = event.target;
  if (target.closest('#daily-new-button')) {
    openDailyEditor('add');
    return;
  }
  if (target.closest('#daily-undo-button')) {
    undoDailyDelete();
    return;
  }
  if (target.closest('#daily-restore-button')) {
    restoreDailyDefaults();
    return;
  }

  const row = target.closest('.daily-item');
  if (!row || !dailyState) return;
  const item = dailyState.items.find((entry) => entry.id === row.dataset.id);
  if (!item) return;
  if (target.closest('.daily-toggle')) {
    const completed = (dailyState.completions[dailyDateKey] ?? []).includes(item.id);
    const next = toggleDailyForDate(dailyState, item.id, dailyDateKey);
    if (commitDaily(next)) {
      dailyNotice = completed ? '已标记为待完成' : `已完成：${item.text}`;
      renderDaily();
      focusDailyToggle(item.id);
    } else {
      renderDaily();
    }
    return;
  }
  if (target.closest('.daily-edit-button')) {
    openDailyEditor('edit', item);
    return;
  }
  if (target.closest('.daily-delete-button')) deleteDailyItem(item.id);
}

function restoreDailyDefaults() {
  if (dailyLoadFailure?.kind !== 'corrupt') return;
  const result = dailyStorage.restoreDefaults(dailyLoadFailure.raw);
  if (!result.ok) {
    dailySaveError = result.message;
    if (result.kind === 'stale-data') {
      refreshDailyFromStorage();
      return;
    }
    renderDaily();
    return;
  }
  dailyState = result.state;
  dailyLoadFailure = null;
  dailySaveError = '';
  dailyUndo = null;
  dailyEditor = null;
  dailyNotice = '已备份原数据并恢复默认事项';
  renderDaily();
}

function refreshDailyFromStorage() {
  const result = dailyStorage.load();
  dailyUndo = null;
  dailyEditor = null;
  dailyEditorError = '';
  dailySaveError = '';
  dailyLoad = result;
  dailyState = result.ok ? result.state : (result.state ?? null);
  dailyLoadFailure = result.ok ? null : result;
  dailyDateKey = getLocalDateKey(new Date());
  dailyNotice = result.ok ? '每日必做已在其他标签页更新；未保存的编辑已关闭' : '';
  renderDaily();
}

function refreshDailyDate() {
  const nextDateKey = getLocalDateKey(new Date());
  if (nextDateKey === dailyDateKey) return;
  dailyDateKey = nextDateKey;
  dailyNotice = '新的一天，打卡已重新开始';
  renderDaily();
}

function refreshVisibleDailyDate() {
  refreshDailyDate();
  scheduleDailyMidnight();
}

function scheduleDailyMidnight() {
  const timerHost = globalThis.window;
  if (!dailyList || typeof timerHost?.setTimeout !== 'function') return;
  if (dailyMidnightTimer !== null) timerHost.clearTimeout?.(dailyMidnightTimer);
  const now = new Date();
  const delay = Math.max(0, getNextLocalMidnight(now).getTime() - now.getTime() + 50);
  dailyMidnightTimer = timerHost.setTimeout(() => {
    refreshDailyDate();
    scheduleDailyMidnight();
  }, delay);
}

function initializeDailyInteractions() {
  if (!dailyList) return;
  dailyList.addEventListener('click', handleDailyClick);
  document.querySelector('#daily-new-button').addEventListener('click', handleDailyClick);
  document.querySelector('#daily-undo-button').addEventListener('click', handleDailyClick);
  document.querySelector('#daily-restore-button').addEventListener('click', handleDailyClick);
  document.querySelector('#daily-editor-form').addEventListener('submit', saveDailyEditor);
  document.querySelector('#daily-editor-form').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDailyEditor();
    }
  });
  document.querySelector('#daily-editor-cancel').addEventListener('click', closeDailyEditor);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshVisibleDailyDate();
  });
  globalThis.window?.addEventListener('focus', refreshVisibleDailyDate);
  globalThis.window?.addEventListener('pageshow', refreshVisibleDailyDate);
  globalThis.window?.addEventListener('storage', (event) => {
    if (event.key === DAILY_STORAGE_KEY || event.key === null) {
      refreshDailyFromStorage();
    }
  });
  globalThis.window?.addEventListener('pagehide', () => {
    dailyUndo = null;
    if (dailyMidnightTimer !== null) globalThis.window.clearTimeout?.(dailyMidnightTimer);
  });
  scheduleDailyMidnight();
}

render();
renderDaily();
initializeDailyInteractions();
