export function addTodo(todos, text, options = {}) {
  const value = text.trim();
  if (!value) throw new Error('请输入任务内容');

  const id = options.id ?? crypto.randomUUID();
  const createdAt = options.now ?? Date.now();
  return [{ id, text: value, completed: false, createdAt }, ...todos];
}

export function toggleTodo(todos, id) {
  return todos.map((todo) =>
    todo.id === id ? { ...todo, completed: !todo.completed } : todo,
  );
}

export function editTodo(todos, id, text) {
  const value = text.trim();
  if (!value) throw new Error('任务内容不能为空');
  return todos.map((todo) => (todo.id === id ? { ...todo, text: value } : todo));
}

export function removeTodo(todos, id) {
  return todos.filter((todo) => todo.id !== id);
}

export function filterTodos(todos, filter) {
  if (filter === 'active') return todos.filter((todo) => !todo.completed);
  if (filter === 'completed') return todos.filter((todo) => todo.completed);
  return todos;
}

export function clearCompleted(todos) {
  return todos.filter((todo) => !todo.completed);
}
