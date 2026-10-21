// 시험용 가짜 저장소: 진짜 Firebase 대신 메모리에만 저장해요 (미리보기 시험 전용)
export const isConfigured = true;

const data = { todos: new Map(), categories: new Map() };
const listeners = [];
let authCallback = null;

function emit() {
  const todos = [...data.todos.values()].map((t) => ({ ...t }));
  const categories = [...data.categories.values()].map((c) => ({ ...c })).sort((a, b) => a.order - b.order);
  for (const l of listeners) {
    setTimeout(() => { l.onTodos(todos); l.onCategories(categories); }, 0);
  }
}

export function watchAuth(callback) {
  authCallback = callback;
  setTimeout(() => callback(TEST_USER), 0);
}
const TEST_USER = { uid: 'test-user', displayName: '시험 사용자', email: 'test@example.com', photoURL: null };
export const login = async () => authCallback(TEST_USER);
export const logout = async () => authCallback(null);
export function useAccount() {}

export function subscribe(l) {
  listeners.push(l);
  emit();
  return () => listeners.splice(listeners.indexOf(l), 1);
}

export async function seedIfEmpty(categories, todos) {
  if (data.categories.size) return;
  categories.forEach((c, i) => data.categories.set(c.id, { ...c, order: i }));
  todos.forEach((t) => data.todos.set(t.id, { ...t }));
}

const later = (fn) => new Promise((resolve) => setTimeout(() => { fn(); emit(); resolve(); }, 30));

export const remote = {
  addTodo: (t) => later(() => data.todos.set(t.id, { ...t })),
  updateTodo: (id, f) => later(() => data.todos.set(id, { ...data.todos.get(id), ...f })),
  deleteTodo: (id) => later(() => data.todos.delete(id)),
  addCategory: (c) => later(() => data.categories.set(c.id, { ...c })),
  updateCategory: (id, f) => later(() => data.categories.set(id, { ...data.categories.get(id), ...f })),
  deleteCategory: (id) => later(() => data.categories.delete(id)),
  reorderCategories: (ids) => later(() => ids.forEach((id, i) => data.categories.set(id, { ...data.categories.get(id), order: i }))),
};

// 시험할 때 다른 기기에서 바뀐 것처럼 흉내 내기
window.__fake = { data, emit };
