// 시험용 가짜 저장소: 진짜 Firebase 대신 메모리에만 저장해요 (미리보기 시험 전용)
export const isConfigured = true;

const data = { todos: new Map(), categories: new Map(), routines: new Map(), blocks: new Map(), templates: new Map(), studyLogs: new Map() };
const copyAll = (map) => [...map.values()].map((x) => JSON.parse(JSON.stringify(x)));
const reactionStore = new Map(); // 주인 계정 → Map(id → 반응)
const reactionWatchers = new Map(); // 주인 계정 → [콜백]
function reactionsOf(owner) {
  if (!reactionStore.has(owner)) reactionStore.set(owner, new Map());
  return reactionStore.get(owner);
}
function emitReactions(owner) {
  if (owner === 'test-user') emit();
  for (const cb of reactionWatchers.get(owner) || []) setTimeout(() => cb(copyAll(reactionsOf(owner))), 0);
}
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
      l.onProfile(data.profile ? JSON.parse(JSON.stringify(data.profile)) : null);
      l.onReactions(copyAll(reactionsOf('test-user')));
      l.onStudyLogs(copyAll(data.studyLogs));
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
  saveProfile: (p) => later(() => { data.profile = JSON.parse(JSON.stringify(p)); }),
  addStudyLog: (log) => later(() => data.studyLogs.set(log.id, { ...log })),
  reorderCategories: (ids) => later(() => ids.forEach((id, i) => data.categories.set(id, { ...data.categories.get(id), order: i }))),
};

remote.updateTodos = (changes) => later(() => changes.forEach(([id, f]) => data.todos.set(id, { ...data.todos.get(id), ...f })));
remote.updateRoutines = (changes) => later(() => changes.forEach(([id, f]) => data.routines.set(id, { ...data.routines.get(id), ...f })));

// 가짜 친구 한 명: 코드 FRIEND1, 공개 할 일 1개 + 숨긴 할 일 1개(숨긴 건 안 보여야 함)
const FRIEND = { uid: 'friend-1', nickname: '서영이', bio: '같이 공부해요', photo: '', friendCode: 'FRIEND' };
const follows = new Map();
const followListeners = [];
const emitFollows = () => {
  const all = [...follows.values()];
  for (const cb of followListeners) setTimeout(() => cb({ mine: all.filter((f) => f.from === 'test-user'), toMe: all.filter((f) => f.to === 'test-user') }), 0);
};
const publicProfiles = new Map([[FRIEND.uid, FRIEND]]);
const today = new Date();
const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
export const social = {
  savePublicProfile: (p) => later(() => publicProfiles.set('test-user', { ...p, uid: 'test-user' })),
  findByCode: async (code) => [...publicProfiles.values()].find((p) => p.friendCode === code) || null,
  watchProfile: (id, cb) => { setTimeout(() => cb(publicProfiles.get(id) || null), 0); return () => {}; },
  requestFollow: (to) => later(() => {
    // 친구는 바로 수락해 줘요 (시험용)
    follows.set(`test-user_${to}`, { from: 'test-user', to, status: 'accepted' });
    emitFollows();
  }),
  acceptFollow: (from) => later(() => { follows.get(`${from}_test-user`).status = 'accepted'; emitFollows(); }),
  removeFollow: (from, to) => later(() => { follows.delete(`${from}_${to}`); emitFollows(); }),
  watchFollows: (cb) => { followListeners.push(cb); emitFollows(); return () => {}; },
  addReaction: (owner, r) => later(() => { reactionsOf(owner).set(r.id, { ...r }); emitReactions(owner); }),
  deleteReaction: (owner, id) => later(() => { reactionsOf(owner).delete(id); emitReactions(owner); }),
  watchReactions: (owner, cb) => {
    if (!reactionWatchers.has(owner)) reactionWatchers.set(owner, []);
    reactionWatchers.get(owner).push(cb);
    setTimeout(() => cb(copyAll(reactionsOf(owner))), 0);
    return () => {};
  },
  watchFriend: (id, { onTodos, onCategories, onRoutines }) => {
    setTimeout(() => {
      onCategories([{ id: 'study', name: '공부', color: '#8E7CE0', order: 0, hidden: false }]);
      onRoutines([]);
      onTodos([
        { id: 'f1', title: '영어 단어 30개', date: todayKey, categoryId: 'study', done: true, doneAt: 1, order: 0, shared: true },
      ]);
    }, 0);
    return () => {};
  },
};
// 친구가 나에게 보낸 요청 하나 (받은 요청 시험용)
follows.set('friend-2_test-user', { from: 'friend-2', to: 'test-user', status: 'pending' });
publicProfiles.set('friend-2', { uid: 'friend-2', nickname: '민지', bio: '', photo: '', friendCode: 'MINJI2' });

// 친구가 내 할 일에 반응을 남긴 것처럼 흉내 내기 (시험용): __fake.friendReacts(todoId, emoji, text)
function friendReacts(targetKey, emoji, text) {
  const r = { id: 'r' + Math.random().toString(36).slice(2, 8), targetKey, date: todayKey, from: 'friend-1', createdAt: Date.now() };
  if (emoji) r.emoji = emoji;
  if (text) r.text = text;
  reactionsOf('test-user').set(r.id, r);
  emitReactions('test-user');
}

// 시험할 때 다른 기기에서 바뀐 것처럼 흉내 내기
window.__fake = { data, emit, friendReacts, reactionsOf };
