// ===== 인터넷 저장소 (Firebase) =====
// 로그인과, 할 일·카테고리를 인터넷에 저장하고 불러오는 일을 맡아요.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  onSnapshot,
  getDocsFromServer,
} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

// firebase-config.js에 설정을 아직 안 넣었으면 false
export const isConfigured = Boolean(firebaseConfig.projectId);

const app = isConfigured ? initializeApp(firebaseConfig) : null;
const auth = app && getAuth(app);
// 인터넷이 잠깐 끊겨도 쓸 수 있게, 이 기기에도 사본을 저장해 둬요
const db = app && initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// 데이터 위치: users / (내 계정 번호) / todos, categories
let uid = null;
const todosCol = () => collection(db, 'users', uid, 'todos');
const categoriesCol = () => collection(db, 'users', uid, 'categories');

export function watchAuth(callback) {
  onAuthStateChanged(auth, callback);
}

export function login() {
  return signInWithPopup(auth, new GoogleAuthProvider());
}

export function logout() {
  return signOut(auth);
}

export function useAccount(userId) {
  uid = userId;
}

// 할 일·카테고리가 바뀔 때마다 알려 줘요. 다른 기기에서 바꿔도 바로 알려 줘요.
export function subscribe({ onTodos, onCategories, onError }) {
  const stops = [
    onSnapshot(todosCol(), (snap) => onTodos(snap.docs.map((d) => d.data())), onError),
    onSnapshot(
      categoriesCol(),
      (snap) => onCategories(snap.docs.map((d) => d.data()).sort((a, b) => a.order - b.order)),
      onError
    ),
  ];
  return () => stops.forEach((stop) => stop());
}

// 처음 로그인했을 때 저장소가 비어 있으면, 카테고리와 이 기기에 있던 할 일을 올려요
export async function seedIfEmpty(categories, todos) {
  let snap;
  try {
    snap = await getDocsFromServer(categoriesCol());
  } catch {
    return; // 인터넷이 안 되거나 권한이 없으면 건너뛰어요
  }
  if (!snap.empty) return;

  const writes = [
    ...categories.map((c, i) => [doc(categoriesCol(), c.id), { ...c, order: i }]),
    ...todos.map((t) => [doc(todosCol(), t.id), t]),
  ];
  // 한 번에 보낼 수 있는 양이 정해져 있어서 400개씩 나눠 보내요
  for (let i = 0; i < writes.length; i += 400) {
    const batch = writeBatch(db);
    for (const [ref, data] of writes.slice(i, i + 400)) batch.set(ref, data);
    await batch.commit();
  }
}

export const remote = {
  addTodo: (todo) => setDoc(doc(todosCol(), todo.id), todo),
  updateTodo: (id, fields) => updateDoc(doc(todosCol(), id), fields),
  deleteTodo: (id) => deleteDoc(doc(todosCol(), id)),
  addCategory: (cat) => setDoc(doc(categoriesCol(), cat.id), cat),
  updateCategory: (id, fields) => updateDoc(doc(categoriesCol(), id), fields),
  deleteCategory: (id) => deleteDoc(doc(categoriesCol(), id)),
  reorderCategories(ids) {
    const batch = writeBatch(db);
    ids.forEach((id, i) => batch.update(doc(categoriesCol(), id), { order: i }));
    return batch.commit();
  },
};
