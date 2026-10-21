// 시험용 가짜 저장소: 진짜 Firebase 대신 메모리에만 저장해요 (미리보기 시험 전용)
export const isConfigured = true;

const data = { todos: new Map(), categories: new Map(), routines: new Map(), blocks: new Map(), templates: new Map() };
const copyAll = (map) => [...map.values()].map((x) => JSON.parse(JSON.stringify(x)));
const listeners = [];
let authCallback = null;

function emit() {
  const todos = [...data.todos.values()].map((t) => ({ ...t }));
  const categories = [...data.categories.values()].map((c) => ({ ...c })).sort((a, b) => a.order - b.order);
  for (const l of listeners) {
    const routines = [...data.routines.values()].map((r) => JSON.parse(JSON.stringify(r)));
    const blocks = copyAll(data.blocks);
    const templates = copyAll(data.templates);
    setTimeout(() => {
      l.onTodos(todos); l.onCategories(categories); l.onRoutines(routines);
      l.onBlocks(blocks); l.onTemplates(templates);
    }, 0);
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
  saveRoutine: (r) => later(() => data.routines.set(r.id, JSON.parse(JSON.stringify(r)))),
  deleteRoutine: (id) => later(() => data.routines.delete(id)),
  saveBlock: (b) => later(() => data.blocks.set(b.id, JSON.parse(JSON.stringify(b)))),
  deleteBlock: (id) => later(() => data.blocks.delete(id)),
  saveTemplate: (t) => later(() => data.templates.set(t.id, JSON.parse(JSON.stringify(t)))),
  deleteTemplate: (id) => later(() => data.templates.delete(id)),
  reorderCategories: (ids) => later(() => ids.forEach((id, i) => data.categories.set(id, { ...data.categories.get(id), order: i }))),
};

// 시험할 때 다른 기기에서 바뀐 것처럼 흉내 내기
window.__fake = { data, emit };
