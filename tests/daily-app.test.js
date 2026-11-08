import test from 'node:test';
import assert from 'node:assert/strict';

const KEY = 'daily-focus-routines-v1';
let importCounter = 0;

class FakeElement {
  constructor(document) {
    this.document = document;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.value = '';
    this._textContent = '';
    this.disabled = false;
    this.hidden = false;
    this.type = '';
    this.maxLength = 0;
    this._className = '';
    this.parent = null;
    this.classList = {
      toggle: (name, force) => {
        const classes = new Set(this._className.split(/\s+/).filter(Boolean));
        const shouldAdd = force === undefined ? !classes.has(name) : force;
        if (shouldAdd) classes.add(name);
        else classes.delete(name);
        this._className = [...classes].join(' ');
      },
      contains: (name) => this._className.split(/\s+/).includes(name),
    };
  }
  get className() { return this._className; }
  set className(value) { this._className = value; }
  get textContent() { return this._textContent + this.children.map((child) => child.textContent).join(''); }
  set textContent(value) {
    this._textContent = String(value ?? '');
    for (const child of this.children) child.parent = null;
    this.children = [];
  }
  get innerText() { return this.textContent; }
  set innerText(value) { this.textContent = value; }
  set innerHTML(value) { this._textContent = String(value); }
  get innerHTML() { return this._textContent; }
  addEventListener(type, callback) {
    const list = this.listeners.get(type) ?? [];
    list.push(callback);
    this.listeners.set(type, list);
  }
  dispatch(type, event = {}) {
    for (const callback of [...(this.listeners.get(type) ?? [])]) callback(event);
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.append(...nodes);
  }
  matches(selector) {
    return selector.startsWith('.')
      ? this.className.split(/\s+/).includes(selector.slice(1))
      : selector.startsWith('#') ? this.attributes.get('id') === selector.slice(1) : false;
  }
  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches(selector)) return node;
      node = node.parent;
    }
    return null;
  }
  querySelector(selector) {
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) return child;
        const nested = visit(child);
        if (nested) return nested;
      }
      return null;
    };
    return visit(this);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  focus() { this.document.activeElement = this; }
  select() {}
}

function createDateControl(startTime) {
  const NativeDate = globalThis.Date;
  const clock = { time: new NativeDate(startTime).getTime() };
  class ControlledDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [clock.time])); }
    static now() { return clock.time; }
  }
  return {
    Date: ControlledDate,
    set(value) { clock.time = new NativeDate(value).getTime(); },
  };
}

function createEnvironment(storage = new Map(), startTime = '2026-11-08T04:00:00.000Z') {
  const document = {
    activeElement: null,
    visibilityState: 'visible',
    elements: new Map(),
    listeners: new Map(),
    querySelector(selector) { return this.elements.get(selector); },
    querySelectorAll(selector) {
      if (selector === '.filter') return this.filterButtons;
      return [];
    },
    createElement() { return new FakeElement(this); },
    addEventListener(type, callback) {
      const list = this.listeners.get(type) ?? [];
      list.push(callback);
      this.listeners.set(type, list);
    },
    dispatch(type, event = {}) {
      for (const callback of [...(this.listeners.get(type) ?? [])]) callback(event);
    },
  };
  const ids = [
    '#todo-list', '#todo-form', '#todo-input', '#form-error', '#empty-state',
    '#progress-ring', '#today', '#remaining-count', '#completed-count',
    '#progress-value', '#clear-completed', '.filters',
    '#daily-card', '#daily-list', '#daily-count', '#daily-minutes',
    '#daily-empty', '#daily-new-button', '#daily-editor-form',
    '#daily-editor-heading', '#daily-editor-text', '#daily-editor-minutes',
    '#daily-editor-error', '#daily-editor-cancel', '#daily-status',
    '#daily-undo-message', '#daily-undo-button', '#daily-storage-error',
    '#daily-storage-error-message', '#daily-restore-button',
  ];
  for (const selector of ids) {
    const element = new FakeElement(document);
    if (selector.startsWith('#')) element.setAttribute('id', selector.slice(1));
    document.elements.set(selector, element);
  }
  document.filterButtons = ['all', 'active', 'completed'].map((filter) => {
    const button = new FakeElement(document);
    button.dataset.filter = filter;
    button.className = filter === 'all' ? 'filter active' : 'filter';
    return button;
  });

  const localStorage = {
    values: storage,
    failWrites: false,
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) {
      if (this.failWrites) throw new Error('quota exceeded');
      storage.set(key, String(value));
    },
  };
  const date = createDateControl(startTime);
  const scheduled = [];
  const window = {
    listeners: new Map(),
    addEventListener(type, callback) {
      const list = this.listeners.get(type) ?? [];
      list.push(callback);
      this.listeners.set(type, list);
    },
    dispatch(type, event = {}) {
      for (const callback of [...(this.listeners.get(type) ?? [])]) callback(event);
    },
    setTimeout(callback, delay) {
      const entry = { callback, delay, cancelled: false };
      scheduled.push(entry);
      return entry;
    },
    clearTimeout(entry) { if (entry) entry.cancelled = true; },
  };
  return {
    document, localStorage, window, date, scheduled, storage,
    dailyList: document.querySelector('#daily-list'),
    storedDaily() { return JSON.parse(storage.get(KEY)); },
  };
}

async function boot(t, env) {
  const previous = {
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    window: globalThis.window,
    Date: globalThis.Date,
  };
  globalThis.document = env.document;
  globalThis.localStorage = env.localStorage;
  globalThis.window = env.window;
  globalThis.Date = env.date.Date;
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  await import('../app.js?daily-app-case=' + (++importCounter));
}

function clickAction(env, selector, index = 0) {
  const item = env.dailyList.children[index];
  assert.ok(item, 'daily routine row should exist');
  const button = item.querySelector(selector);
  assert.ok(button, `expected ${selector} in the routine row`);
  env.dailyList.dispatch('click', {
    target: {
      closest(value) {
        if (value === '.daily-item') return item;
        if (value === selector) return button;
        return null;
      },
    },
  });
}

function clickButton(element) {
  element.dispatch('click', { target: element });
}

function submit(element) {
  element.dispatch('submit', { preventDefault() {} });
}

test('missing storage initializes defaults, and same-day checkmarks survive a fresh page load', async (t) => {
  const storage = new Map();
  const env = createEnvironment(storage);
  await boot(t, env);
  assert.deepEqual(env.storedDaily().items.map((item) => [item.text, item.minutes]), [
    ['看抖音创意中心榜单', 10],
    ['小红书站内关键词搜索', 10],
    ['小红书站内低分爆款', 20],
    ['对标账号每天上品监测', 10],
  ]);
  assert.equal(env.document.querySelector('#daily-count').textContent, '0 / 4');
  assert.equal(env.document.querySelector('#daily-minutes').textContent, '预计 50 分钟');
  clickAction(env, '.daily-toggle');
  assert.equal(env.document.activeElement.className, 'daily-toggle');
  assert.equal(env.storedDaily().completions['2026-11-08'].length, 1);

  const reloaded = createEnvironment(storage);
  await boot(t, reloaded);
  assert.equal(reloaded.document.querySelector('#daily-count').textContent, '1 / 4');
  assert.ok(reloaded.dailyList.children[0].classList.contains('completed'));
});

test('delete can be undone with completion and order restored, then deleting all stays empty after reload', async (t) => {
  const storage = new Map();
  const env = createEnvironment(storage);
  await boot(t, env);
  clickAction(env, '.daily-toggle', 1);
  clickAction(env, '.daily-delete-button', 1);
  assert.equal(env.dailyList.children.length, 3);
  clickButton(env.document.querySelector('#daily-undo-button'));
  assert.equal(env.dailyList.children.length, 4);
  assert.equal(env.dailyList.children[1].querySelector('.daily-text').textContent, '小红书站内关键词搜索');
  assert.ok(env.dailyList.children[1].classList.contains('completed'));

  while (env.dailyList.children.length) clickAction(env, '.daily-delete-button');
  assert.equal(env.dailyList.children.length, 0);
  assert.equal(env.document.querySelector('#daily-empty').hidden, false);
  const reloaded = createEnvironment(storage);
  await boot(t, reloaded);
  assert.equal(reloaded.dailyList.children.length, 0);
  assert.equal(reloaded.storedDaily().items.length, 0);
});

test('editing and adding a long Chinese routine saves its text and estimated minutes', async (t) => {
  const env = createEnvironment();
  await boot(t, env);
  clickAction(env, '.daily-edit-button');
  const text = '长中文'.repeat(40);
  env.document.querySelector('#daily-editor-text').value = text;
  env.document.querySelector('#daily-editor-minutes').value = '45';
  submit(env.document.querySelector('#daily-editor-form'));
  assert.equal(env.storedDaily().items[0].text, text);
  assert.equal(env.storedDaily().items[0].minutes, 45);
  assert.equal(env.document.querySelector('#daily-minutes').textContent, '预计 85 分钟');

  clickButton(env.document.querySelector('#daily-new-button'));
  env.document.querySelector('#daily-editor-text').value = '新增长标题：' + '站内关键词'.repeat(18);
  env.document.querySelector('#daily-editor-minutes').value = '15';
  submit(env.document.querySelector('#daily-editor-form'));
  assert.equal(env.storedDaily().items.at(-1).minutes, 15);
  assert.equal(env.dailyList.children.length, 5);
});

test('midnight timer and visible-page restoration clear yesterday without touching ordinary todos', async (t) => {
  const storage = new Map();
  const env = createEnvironment(storage, '2026-11-08T15:59:00.000Z');
  await boot(t, env);
  clickAction(env, '.daily-toggle');
  assert.equal(env.document.querySelector('#daily-count').textContent, '1 / 4');
  env.date.set('2026-11-08T16:01:00.000Z');
  env.scheduled.find((entry) => !entry.cancelled).callback();
  assert.equal(env.document.querySelector('#daily-count').textContent, '0 / 4');
  assert.equal(env.document.querySelector('#todo-list').children.length, 0);

  clickAction(env, '.daily-toggle');
  env.date.set('2026-11-10T04:00:00.000Z');
  env.document.dispatch('visibilitychange');
  env.date.set('2026-11-11T04:00:00.000Z');
  env.window.dispatch('focus');
  assert.equal(env.document.querySelector('#daily-count').textContent, '0 / 4');
  env.window.dispatch('pagehide');
  env.date.set('2026-11-12T04:00:00.000Z');
  env.window.dispatch('pageshow');
  assert.equal(env.document.querySelector('#daily-count').textContent, '0 / 4');
  assert.ok(env.scheduled.some((entry) => !entry.cancelled));
  assert.equal(env.document.querySelector('#daily-count').textContent, '0 / 4');
});

test('corrupt storage stays untouched until the user chooses backed-up recovery', async (t) => {
  const raw = '{broken user data';
  const storage = new Map([[KEY, raw]]);
  const env = createEnvironment(storage);
  await boot(t, env);
  assert.equal(storage.get(KEY), raw);
  assert.equal(env.document.querySelector('#daily-restore-button').hidden, false);
  clickButton(env.document.querySelector('#daily-restore-button'));
  assert.equal(storage.get('daily-focus-routines-v1-backup'), raw);
  assert.equal(env.storedDaily().items.length, 4);
});

test('a failed routine save leaves the displayed and stored completion unchanged', async (t) => {
  const env = createEnvironment();
  await boot(t, env);
  const before = env.storedDaily();
  env.localStorage.failWrites = true;
  clickAction(env, '.daily-toggle');
  assert.deepEqual(env.storedDaily(), before);
  assert.equal(env.dailyList.children[0].classList.contains('completed'), false);
  assert.match(env.document.querySelector('#daily-storage-error-message').textContent, /quota exceeded/);
});

test('a storage update from another tab closes edits and reloads the latest content', async (t) => {
  const env = createEnvironment();
  await boot(t, env);
  clickAction(env, '.daily-edit-button');
  env.document.querySelector('#daily-editor-text').value = 'unsaved edit';
  const external = env.storedDaily();
  external.items[0].text = '另一标签页的更新';
  env.storage.set(KEY, JSON.stringify(external));
  env.window.dispatch('storage', { key: KEY });
  assert.equal(env.dailyList.children[0].querySelector('.daily-text').textContent, '另一标签页的更新');
  assert.equal(env.document.querySelector('#daily-editor-form').hidden, true);
  assert.match(env.document.querySelector('#daily-status').textContent, /其他标签页/);
});

test('routine checkmarks remain independent from the original task progress and clear action', async (t) => {
  const originalTodos = [{ id: 'legacy', text: 'Original done task', completed: true, createdAt: 1 }];
  const originalRaw = JSON.stringify(originalTodos);
  const storage = new Map([['daily-focus-todos-v1', originalRaw]]);
  const env = createEnvironment(storage);
  await boot(t, env);
  assert.equal(env.document.querySelector('#progress-value').textContent, '100%');

  clickAction(env, '.daily-toggle');
  assert.equal(env.document.querySelector('#progress-value').textContent, '100%');
  assert.equal(storage.get('daily-focus-todos-v1'), originalRaw);
  assert.equal(env.document.activeElement.className, 'daily-toggle');
  assert.equal(env.storedDaily().completions['2026-11-08'].length, 1);

  env.document.querySelector('#clear-completed').dispatch('click');
  assert.deepEqual(JSON.parse(storage.get('daily-focus-todos-v1')), []);
  assert.equal(env.document.activeElement.className, 'daily-toggle');
  assert.equal(env.storedDaily().completions['2026-11-08'].length, 1);
  assert.equal(env.document.querySelector('#progress-value').textContent, '0%');
});
