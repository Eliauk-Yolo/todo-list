import test from 'node:test';
import assert from 'node:assert/strict';

const STORAGE_KEY = 'daily-focus-todos-v1';
let importCounter = 0;

class FakeElement {
  constructor(document, selector = '') {
    this.document = document;
    this.selector = selector;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.value = '';
    this.textContent = '';
    this.disabled = false;
    this.hidden = false;
    this.type = '';
    this.maxLength = 0;
    this._className = '';
    this._innerHTML = '';
    this.replaceChildrenCount = 0;
    this.parent = null;
    this.classList = { toggle() {} };
  }
  get className() { return this._className; }
  set className(value) { this._className = value; }
  set innerHTML(value) { this._innerHTML = value; }
  get innerHTML() { return this._innerHTML; }
  addEventListener(type, callback, options = {}) {
    const list = this.listeners.get(type) ?? [];
    list.push({ callback, once: options.once === true });
    this.listeners.set(type, list);
  }
  dispatch(type, event = {}) {
    const list = this.listeners.get(type) ?? [];
    for (const listener of [...list]) {
      if (listener.once) this.listeners.set(type, (this.listeners.get(type) ?? []).filter((entry) => entry !== listener));
      listener.callback(event);
    }
  }
  append(...nodes) {
    for (const node of nodes) { node.parent = this; this.children.push(node); }
  }
  replaceWith(node) {
    if (!this.parent) throw new Error('replaceWith requires a parent');
    const siblings = this.parent.children;
    const index = siblings.indexOf(this);
    node.parent = this.parent;
    siblings[index] = node;
    this.parent = null;
  }
  replaceChildren(...nodes) {
    if (this.selector === '#todo-list') {
      const active = this.document.activeElement;
      if (active && this.children.some((child) => contains(child, active))) active.blur();
      this.replaceChildrenCount += 1;
    }
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.append(...nodes);
  }
  querySelector(selector) {
    const className = selector.startsWith('.') ? selector.slice(1) : null;
    const visit = (node) => {
      for (const child of node.children) {
        if (className && child.className.split(/\s+/).includes(className)) return child;
        const nested = visit(child);
        if (nested) return nested;
      }
      return null;
    };
    return visit(this);
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  focus() { this.document.activeElement = this; }
  select() {}
  blur() {
    if (this.document.activeElement !== this) return;
    this.document.activeElement = null;
    this.dispatch('blur');
  }
}

function contains(parent, child) {
  if (parent === child) return true;
  return parent.children.some((node) => contains(node, child));
}

function createEnvironment() {
  const document = {
    activeElement: null,
    elements: new Map(),
    querySelector(selector) { return this.elements.get(selector); },
    querySelectorAll() { return []; },
    createElement(tag) { const node = new FakeElement(this); node.tagName = tag.toUpperCase(); return node; },
  };
  for (const selector of [
    '#todo-list', '#todo-form', '#todo-input', '#form-error', '#empty-state',
    '#progress-ring', '#today', '#remaining-count', '#completed-count',
    '#progress-value', '#clear-completed', '.filters',
  ]) document.elements.set(selector, new FakeElement(document, selector));
  const values = new Map([[STORAGE_KEY, JSON.stringify([
    { id: 'task-1', text: 'Original task', completed: false, createdAt: 1 },
  ])]]);
  const localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
  return {
    document, localStorage,
    list: document.querySelector('#todo-list'),
    storedTodos() { return JSON.parse(values.get(STORAGE_KEY)); },
  };
}

async function boot(t, env) {
  const previousDocument = globalThis.document;
  const previousStorage = globalThis.localStorage;
  globalThis.document = env.document;
  globalThis.localStorage = env.localStorage;
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  });
  await import('../app.js?app-edit-case=' + (++importCounter));
}

function clickEdit(env) {
  const item = env.list.children[0];
  const target = {
    closest(selector) {
      if (selector === '.todo-item') return item;
      if (selector === '.edit-button') return this;
      return null;
    },
  };
  env.list.dispatch('click', { target });
  return item;
}

test('clicking Edit keeps the task editor mounted in the list', async (t) => {
  const env = createEnvironment();
  await boot(t, env);
  clickEdit(env);
  assert.ok(env.list.querySelector('.edit-input'), 'the editor should remain visible after the click handler returns');
});

test('pressing Enter saves the edited task', async (t) => {
  const env = createEnvironment();
  await boot(t, env);
  clickEdit(env);
  const editor = env.list.querySelector('.edit-input');
  assert.ok(editor);
  editor.value = 'Updated task';
  editor.dispatch('keydown', { key: 'Enter' });
  assert.equal(env.storedTodos()[0].text, 'Updated task');
});

test('pressing Escape discards the edit even when removing the editor blurs it', async (t) => {
  const env = createEnvironment();
  await boot(t, env);
  clickEdit(env);
  const editor = env.list.querySelector('.edit-input');
  assert.ok(editor);
  editor.value = 'Unsaved edit';
  editor.dispatch('keydown', { key: 'Escape' });
  assert.equal(env.storedTodos()[0].text, 'Original task');
});

test('a corrected value can save after whitespace is rejected on blur', async (t) => {
  const env = createEnvironment();
  await boot(t, env);
  clickEdit(env);
  const editor = env.list.querySelector('.edit-input');
  assert.ok(editor);
  editor.value = '   ';
  editor.blur();
  assert.equal(env.storedTodos()[0].text, 'Original task');
  editor.value = 'Corrected task';
  editor.blur();
  assert.equal(env.storedTodos()[0].text, 'Corrected task');
});

function visibleTaskTexts(env) {
  return env.list.children.map((item) => item.querySelector('.todo-text').textContent);
}

function visibleTaskDates(env) {
  return env.list.children.map((item) => item.querySelector('.todo-date')?.textContent ?? null);
}

function visibleTaskDateTimes(env) {
  return env.list.children.map((item) => item.querySelector('.todo-date')?.attributes.get('datetime') ?? null);
}

function clickTaskAction(env, selector) {
  const item = env.list.children[0];
  const target = {
    closest(value) {
      if (value === '.todo-item') return item;
      if (value === selector) return this;
      return null;
    },
  };
  env.list.dispatch('click', { target });
}

function selectFilter(env, filter) {
  const button = { dataset: { filter } };
  const target = {
    closest(selector) {
      return selector === '[data-filter]' ? button : null;
    },
  };
  env.document.querySelector('.filters').dispatch('click', { target });
}

test('created dates are separate labels that survive edits, filters, status changes, and reload', async (t) => {
  const env = createEnvironment();
  const createdAt = new Date(2026, 10, 3, 12).getTime();
  const olderCreatedAt = new Date(2026, 1, 9, 12).getTime();
  env.localStorage.setItem(STORAGE_KEY, JSON.stringify([
    { id: 'live-class', text: '听直播课', completed: false, createdAt },
    { id: 'older-task', text: '较早任务', completed: false, createdAt: olderCreatedAt },
  ]));
  await boot(t, env);

  assert.deepEqual(visibleTaskTexts(env), ['听直播课', '较早任务']);
  assert.deepEqual(visibleTaskDates(env), ['11.03', '02.09']);
  assert.deepEqual(visibleTaskDateTimes(env), ['2026-11-03', '2026-02-09']);
  assert.equal(env.list.children[0].querySelector('.todo-date').attributes.get('aria-label'), '创建于2026年11月3日');

  clickEdit(env);
  const editor = env.list.querySelector('.edit-input');
  assert.equal(editor.value, '听直播课', 'the editor should contain only the stored title');
  editor.value = '听直播课笔记';
  editor.dispatch('keydown', { key: 'Enter' });

  assert.equal(visibleTaskTexts(env)[0], '听直播课笔记');
  assert.equal(visibleTaskDates(env)[0], '11.03');
  assert.deepEqual(env.storedTodos()[0], {
    id: 'live-class',
    text: '听直播课笔记',
    completed: false,
    createdAt,
  });

  clickTaskAction(env, '.toggle');
  assert.equal(visibleTaskTexts(env)[0], '听直播课笔记');
  assert.equal(visibleTaskDates(env)[0], '11.03');
  assert.equal(env.storedTodos()[0].completed, true);
  assert.equal(env.storedTodos()[0].createdAt, createdAt);

  selectFilter(env, 'active');
  assert.deepEqual(visibleTaskTexts(env), ['较早任务']);
  assert.deepEqual(visibleTaskDates(env), ['02.09']);
  selectFilter(env, 'completed');
  assert.deepEqual(visibleTaskTexts(env), ['听直播课笔记']);
  assert.deepEqual(visibleTaskDates(env), ['11.03']);
  selectFilter(env, 'all');
  assert.deepEqual(visibleTaskTexts(env), ['听直播课笔记', '较早任务']);
  assert.deepEqual(visibleTaskDates(env), ['11.03', '02.09']);

  const currentDisplay = visibleTaskTexts(env)[0];
  clickTaskAction(env, '.toggle');
  assert.equal(env.storedTodos()[0].completed, false);
  assert.equal(env.storedTodos()[0].createdAt, createdAt);
  assert.equal(visibleTaskTexts(env)[0], currentDisplay);
  clickTaskAction(env, '.toggle');
  assert.equal(env.storedTodos()[0].completed, true);
  assert.equal(env.storedTodos()[0].createdAt, createdAt);
  assert.equal(visibleTaskTexts(env)[0], currentDisplay);

  await import('../app.js?app-edit-case=' + (++importCounter));
  assert.deepEqual(visibleTaskTexts(env), ['听直播课笔记', '较早任务']);
  assert.deepEqual(visibleTaskDates(env), ['11.03', '02.09']);
  assert.deepEqual(env.storedTodos()[0], {
    id: 'live-class',
    text: '听直播课笔记',
    completed: true,
    createdAt,
  });
});

test('legacy tasks without a valid creation timestamp keep their original title', async (t) => {
  const env = createEnvironment();
  env.localStorage.setItem(STORAGE_KEY, JSON.stringify([
    { id: 'missing-date', text: '缺少日期', completed: false },
    { id: 'string-date', text: '字符串日期', completed: false, createdAt: '2026-11-03' },
    { id: 'null-date', text: '空日期', completed: false, createdAt: null },
    { id: 'out-of-range-date', text: '越界日期', completed: false, createdAt: 8.64e15 + 1 },
  ]));
  await boot(t, env);

  assert.deepEqual(visibleTaskTexts(env), ['缺少日期', '字符串日期', '空日期', '越界日期']);
  assert.deepEqual(visibleTaskDates(env), [null, null, null, null]);
});
