import {
  addTodo,
  clearCompleted,
  editTodo,
  filterTodos,
  removeTodo,
  toggleTodo,
} from './todo-store.js';

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
  if (event.target.closest('.toggle')) todos = toggleTodo(todos, item.dataset.id);
  if (event.target.closest('.delete-button')) todos = removeTodo(todos, item.dataset.id);
  if (event.target.closest('.edit-button')) startEditing(item);
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

  const finish = () => {
    try {
      todos = editTodo(todos, id, editor.value);
      commit();
    } catch {
      editor.focus();
    }
  };
  editor.addEventListener('blur', finish, { once: true });
  editor.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') editor.blur();
    if (event.key === 'Escape') render();
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

function createTodoItem(todo) {
  const item = document.createElement('li');
  item.className = `todo-item${todo.completed ? ' completed' : ''}`;
  item.dataset.id = todo.id;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'toggle';
  toggle.setAttribute('aria-label', todo.completed ? '标记为待完成' : '标记为已完成');
  toggle.innerHTML = '<span aria-hidden="true">✓</span>';

  const text = document.createElement('span');
  text.className = 'todo-text';
  text.textContent = todo.text;

  const actions = document.createElement('div');
  actions.className = 'todo-actions';
  actions.innerHTML = `
    <button type="button" class="icon-button edit-button" aria-label="编辑任务">编辑</button>
    <button type="button" class="icon-button delete-button" aria-label="删除任务">删除</button>`;
  item.append(toggle, text, actions);
  return item;
}

render();
