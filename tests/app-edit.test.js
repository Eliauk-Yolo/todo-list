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
