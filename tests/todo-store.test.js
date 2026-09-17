import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addTodo,
  clearCompleted,
  editTodo,
  filterTodos,
  removeTodo,
  toggleTodo,
} from '../todo-store.js';

const active = { id: '1', text: 'Write tests', completed: false, createdAt: 1 };
const completed = { id: '2', text: 'Sketch page', completed: true, createdAt: 2 };

test('addTodo trims text and prepends a new active task', () => {
  const todos = addTodo([active], '  Ship the page  ', { id: '3', now: 3 });
  assert.deepEqual(todos, [
    { id: '3', text: 'Ship the page', completed: false, createdAt: 3 },
    active,
  ]);
});

test('addTodo rejects an empty task', () => {
  assert.throws(() => addTodo([], '   '), /请输入任务内容/);
});

test('toggleTodo changes only the selected task', () => {
  assert.deepEqual(toggleTodo([active, completed], '1'), [
    { ...active, completed: true },
    completed,
  ]);
});

test('editTodo trims the replacement text', () => {
  assert.deepEqual(editTodo([active], '1', '  Review changes '), [
    { ...active, text: 'Review changes' },
  ]);
});

test('removeTodo deletes only the selected task', () => {
  assert.deepEqual(removeTodo([active, completed], '1'), [completed]);
});

test('filterTodos returns active, completed, or all tasks', () => {
  const todos = [active, completed];
  assert.deepEqual(filterTodos(todos, 'active'), [active]);
  assert.deepEqual(filterTodos(todos, 'completed'), [completed]);
  assert.deepEqual(filterTodos(todos, 'all'), todos);
});

test('clearCompleted keeps unfinished tasks', () => {
  assert.deepEqual(clearCompleted([active, completed]), [active]);
});
