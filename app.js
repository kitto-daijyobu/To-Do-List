import {
  isConfigured,
  watchAuth,
  login,
  logout,
  useAccount,
  subscribe,
  seedIfEmpty,
  remote,
} from './cloud.js';

// ===== 예전 저장 위치 =====
// 1~3단계에서는 이 브라우저 안에만 저장했어요.
// 처음 로그인할 때 여기 있던 할 일을 인터넷 저장소로 옮겨요. (원본은 지우지 않아요)
const TODOS_KEY = 'mytodo.todos.v1';
const CATEGORIES_KEY = 'mytodo.categories.v1';

function loadJSON(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

// ===== 카테고리 색 =====
// 카테고리 색은 이 목록에서 골라요
const PALETTE = [
  // 파란 계열
  '#A9C8F5', // 연파랑
  '#6CBDE0', // 하늘
  '#5AA9C9', // 바다
  '#7FA7D9', // 안개파랑
  '#5B8DEF', // 파랑
  '#4A7BD0', // 코발트
  '#3D5FC4', // 남색
  '#2F4A9E', // 진남색
  // 그 밖의 색
  '#4DB6A0', // 청록
  '#7DD3C0', // 민트
  '#7FB069', // 초록
  '#A8C66C', // 연두
  '#8E7CE0', // 보라
  '#B4A7EC', // 라벤더
  '#E88AA8', // 분홍
  '#EE8C7A', // 코랄
  '#F0A96B', // 살구
  '#E5C15A', // 노랑
  '#B08B6E', // 갈색
  '#9AA5B4', // 회색
];
const UNCATEGORIZED_COLOR = '#9AA5B4';

const DEFAULT_CATEGORIES = [
  { id: 'school', name: '학교', color: '#5B8DEF' },
  { id: 'career', name: '취업준비', color: '#8E7CE0' },
  { id: 'workout', name: '운동', color: '#4DB6A0' },
  { id: 'personal', name: '개인', color: '#F0A96B' },
];

// 색 값이 '#12abef' 모양일 때만 화면에 써요 (엉뚱한 값이 들어가는 것 방지)
function safeColor(color) {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : UNCATEGORIZED_COLOR;
}

// ===== 날짜 도우미 =====
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// 날짜를 '2026-10-21' 같은 글자로 바꿔요 (할 일을 날짜별로 묶는 열쇠)
function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatTitle(date) {
  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAYS[date.getDay()]})`;
}

function addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

// 제목 위 작은 글씨: 오늘 / 어제 / 내일, 그 밖에는 연도
function formatLabel(date) {
  const key = toDateKey(date);
  const today = new Date();
  if (key === toDateKey(today)) return '오늘';
  if (key === toDateKey(addDays(today, -1))) return '어제';
  if (key === toDateKey(addDays(today, 1))) return '내일';
  return `${date.getFullYear()}년`;
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// 처음 로그인할 때 올릴 카테고리와 할 일 (이 브라우저에 있던 것)
function localDataForSeed() {
  const categories = loadJSON(CATEGORIES_KEY, null) || DEFAULT_CATEGORIES;
  const todos = loadJSON(TODOS_KEY, []).map((t) => ({
    id: t.id,
    title: t.title,
    date: t.date,
    categoryId: t.categoryId || categories[0].id,
    done: Boolean(t.done),
    doneAt: t.done ? t.doneAt || t.createdAt : null,
    order: t.order ?? 0,
    createdAt: t.createdAt ?? Date.now(),
  }));
  return { categories: categories.map(({ id, name, color }) => ({ id, name, color })), todos };
}

// ===== 상태 =====
// 인터넷 저장소에서 받아 와서 채워져요
let categories = [];
let todos = [];

let selectedDate = new Date();
// 달력에 보이는 달 (그 달 1일)
let viewMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
// 할 일 입력칸이 열려 있는 카테고리
let addingCategoryId = null;
// 카테고리 관리 창에서 색 고르기가 열려 있는 카테고리
let pickingColorFor = null;

// ===== 화면 요소 =====
const $calTitle = document.getElementById('cal-title');
const $calGrid = document.getElementById('cal-grid');
const $dayLabel = document.getElementById('day-label');
const $dayTitle = document.getElementById('day-title');
const $progressFill = document.getElementById('progress-fill');
const $progressText = document.getElementById('progress-text');
const $sections = document.getElementById('sections');
const $empty = document.getElementById('empty-message');
const $catDialog = document.getElementById('cat-dialog');
const $catList = document.getElementById('cat-list');
const $loginButton = document.getElementById('login-button');
const $loginError = document.getElementById('login-error');
const $toast = document.getElementById('toast');

const CHECK_PATH = 'M3.5 8.5l3 3 6-7';
const CHECK_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="${CHECK_PATH}"/></svg>`;
const PLUS_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>';
const GRIP_ICON = '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="6" cy="4" r="1.2"/><circle cx="10" cy="4" r="1.2"/><circle cx="6" cy="8" r="1.2"/><circle cx="10" cy="8" r="1.2"/><circle cx="6" cy="12" r="1.2"/><circle cx="10" cy="12" r="1.2"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>';

function findCategory(id) {
  return categories.find((c) => c.id === id);
}

function categoryColor(id) {
  const cat = findCategory(id);
  return safeColor(cat ? cat.color : UNCATEGORIZED_COLOR);
}

// ===== 저장 =====
// 화면은 바로 바꾸고, 인터넷 저장은 뒤에서 해요. 실패하면 알려 줘요.
function save(promise) {
  promise.catch((err) => {
    console.error(err);
    showToast('저장하지 못했어요. 로그인 상태를 확인해 주세요.');
  });
}

let toastTimer = null;
function showToast(message) {
  $toast.textContent = message;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 4000);
}

// 다른 기기에서 바뀐 내용이 들어오면 화면을 다시 그려요.
// 단, 마우스를 누르고 있거나 글자를 입력하는 중이면 끝날 때까지 기다려요.
// (그래야 누르던 버튼이 사라지거나 쓰던 글자가 끊기지 않아요)
let pointerIsDown = false;
let renderPending = false;

function scheduleRender() {
  const typing = document.activeElement?.matches?.('.add-input, .cat-name, .todo-edit');
  if (pointerIsDown || typing) {
    renderPending = true;
    return;
  }
  renderPending = false;
  render();
  if ($catDialog.open) renderCategoryList();
}

function flushRender() {
  if (renderPending) setTimeout(() => renderPending && scheduleRender(), 0);
}

document.addEventListener('pointerdown', () => { pointerIsDown = true; }, true);
document.addEventListener('pointerup', () => { pointerIsDown = false; flushRender(); }, true);
document.addEventListener('pointercancel', () => { pointerIsDown = false; flushRender(); }, true);
document.addEventListener('focusout', flushRender);

// ===== 할 일 동작 =====
// 할 일을 만들어 저장만 하고, 화면은 다시 그리지 않아요
function createTodo(title, categoryId) {
  const dateKey = toDateKey(selectedDate);
  const sameDay = todos.filter((t) => t.date === dateKey);
  const todo = {
    id: newId(),
    title,
    date: dateKey,
    categoryId,
    done: false,
    doneAt: null,
    order: sameDay.length ? Math.max(...sameDay.map((t) => t.order)) + 1 : 0,
    createdAt: Date.now(),
  };
  todos.push(todo);
  save(remote.addTodo(todo));
  return todo;
}

function addTodo(title, categoryId) {
  createTodo(title, categoryId);
  render();
}

function toggleTodo(id) {
  const todo = todos.find((t) => t.id === id);
  if (!todo) return;
  todo.done = !todo.done;
  todo.doneAt = todo.done ? Date.now() : null;
  save(remote.updateTodo(id, { done: todo.done, doneAt: todo.doneAt }));
  render();
}

function deleteTodo(id) {
  todos = todos.filter((t) => t.id !== id);
  save(remote.deleteTodo(id));
  render();
}

// ===== 카테고리 동작 =====
function commitCategories() {
  render();
  renderCategoryList();
}

function saveCategoryOrder() {
  categories.forEach((c, i) => { c.order = i; });
  save(remote.reorderCategories(categories.map((c) => c.id)));
}

function addCategory() {
  const used = new Set(categories.map((c) => c.color));
  const color = PALETTE.find((p) => !used.has(p)) || PALETTE[0];
  const order = categories.length ? Math.max(...categories.map((c) => c.order ?? 0)) + 1 : 0;
  const cat = { id: newId(), name: '새 카테고리', color, order };
  categories.push(cat);
  save(remote.addCategory(cat));
  commitCategories();
  const input = $catList.querySelector(`[data-id="${cat.id}"] .cat-name`);
  if (input) {
    input.focus();
    input.select();
  }
}

function renameCategory(id, name) {
  const cat = findCategory(id);
  if (!cat) return;
  const trimmed = name.trim();
  if (trimmed && trimmed !== cat.name) {
    cat.name = trimmed;
    save(remote.updateCategory(id, { name: trimmed }));
    render();
  }
}

function recolorCategory(id, color) {
  const cat = findCategory(id);
  if (!cat) return;
  cat.color = color;
  pickingColorFor = null;
  save(remote.updateCategory(id, { color }));
  commitCategories();
}

function deleteCategory(id) {
  const cat = findCategory(id);
  if (!cat) return;
  if (categories.length === 1) {
    alert('카테고리는 최소 1개는 있어야 해요.');
    return;
  }
  const count = todos.filter((t) => t.categoryId === id).length;
  let message = `'${cat.name}' 카테고리를 지울까요?`;
  if (count) message += `\n이 카테고리의 할 일 ${count}개는 지워지지 않고 '미분류'로 옮겨져요.`;
  if (!confirm(message)) return;
  categories = categories.filter((c) => c.id !== id);
  save(remote.deleteCategory(id));
  commitCategories();
}

// ===== 날짜 이동 =====
function selectDate(date) {
  selectedDate = date;
  viewMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  addingCategoryId = null;
  render();
}

function moveMonth(n) {
  viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + n, 1);
  renderCalendar();
}

// ===== 화면 그리기 =====
function render() {
  renderCalendar();
  renderDay();
}

// 네잎 클로버의 잎 색 4개 (왼쪽 위 → 오른쪽 위 → 오른쪽 아래 → 왼쪽 아래)
// 끝낸 카테고리를 끝낸 순서대로 최대 4개까지, 4개를 넘으면 오래된 것부터 밀려나요
function cloverLeafColors(dayTodos) {
  const lastDone = new Map();
  for (const t of dayTodos) {
    if (!t.done) continue;
    const prev = lastDone.get(t.categoryId) || 0;
    lastDone.set(t.categoryId, Math.max(prev, t.doneAt || 0));
  }
  const colors = [...lastDone.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(-4)
    .map(([id]) => categoryColor(id));

  const [a, b, c, d] = colors;
  switch (colors.length) {
    case 1: return [a, a, a, a];
    case 2: return [a, a, b, b];
    case 3: return [a, b, c, a];
    case 4: return [a, b, c, d];
    default: return null;
  }
}

const LEAF_CENTERS = [[13, 13], [27, 13], [27, 27], [13, 27]];

function cloverSvg(leafColors) {
  const leaves = LEAF_CENTERS.map(([cx, cy], i) => {
    const fill = leafColors ? leafColors[i] : 'var(--clover-empty)';
    return `<circle cx="${cx}" cy="${cy}" r="10.5" fill="${fill}"/>`;
  }).join('');
  return `<svg viewBox="0 0 40 40" aria-hidden="true"><g opacity="${leafColors ? 0.85 : 1}">${leaves}</g></svg>`;
}

function renderCalendar() {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  $calTitle.textContent = `${year}년 ${month + 1}월`;

  // 날짜별로 할 일 묶기
  const byDate = {};
  for (const t of todos) (byDate[t.date] ||= []).push(t);

  const todayKey = toDateKey(new Date());
  const selectedKey = toDateKey(selectedDate);

  // 달력 첫 칸 = 이번 달 1일이 속한 주의 일요일
  const start = addDays(viewMonth, -viewMonth.getDay());
  const lastDay = new Date(year, month + 1, 0);
  const weeks = Math.ceil((viewMonth.getDay() + lastDay.getDate()) / 7);

  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const date = addDays(start, i);
    const key = toDateKey(date);
    const dayTodos = byDate[key] || [];
    const total = dayTodos.length;
    const done = dayTodos.filter((t) => t.done).length;

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal-day';
    if (date.getDay() === 0) cell.classList.add('sun');
    if (date.getDay() === 6) cell.classList.add('sat');
    if (date.getMonth() !== month) cell.classList.add('other');
    if (key === todayKey) cell.classList.add('today');
    if (key === selectedKey) cell.classList.add('selected');

    const clover = document.createElement('span');
    clover.className = 'clover';
    if (total) {
      const leafColors = cloverLeafColors(dayTodos);
      if (!leafColors) clover.classList.add('empty');
      const inner = done === total
        ? `<svg class="clover-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="${CHECK_PATH}"/></svg>`
        : `<span class="clover-count">${total - done}</span>`;
      clover.innerHTML = cloverSvg(leafColors) + inner;
    }

    const num = document.createElement('span');
    num.className = 'cal-num';
    num.textContent = date.getDate();

    let label = `${date.getMonth() + 1}월 ${date.getDate()}일`;
    if (total) label += `, 할 일 ${total}개 중 ${done}개 완료`;
    cell.setAttribute('aria-label', label);
    if (key === selectedKey) cell.setAttribute('aria-pressed', 'true');

    cell.append(clover, num);
    cell.addEventListener('click', () => selectDate(date));
    cells.push(cell);
  }
  $calGrid.replaceChildren(...cells);
}

function renderDay() {
  const dateKey = toDateKey(selectedDate);
  const dayTodos = todos
    .filter((t) => t.date === dateKey)
    .sort((a, b) => a.order - b.order);

  $dayLabel.textContent = formatLabel(selectedDate);
  $dayTitle.textContent = formatTitle(selectedDate);
  renderProgress();

  const sections = categories.map((cat) =>
    renderSection(cat, dayTodos.filter((t) => t.categoryId === cat.id), true)
  );

  // 지워진 카테고리에 있던 할 일
  const orphans = dayTodos.filter((t) => !findCategory(t.categoryId));
  if (orphans.length) {
    sections.push(renderSection({ id: null, name: '미분류', color: UNCATEGORIZED_COLOR }, orphans, false));
  }

  // 다시 그리기 전에 입력 중이던 글자를 기억해 두고, 사라질 입력줄은 표시해 둬요
  // (사라지면서 blur가 일어나도 할 일이 또 추가되지 않게)
  const oldInput = $sections.querySelector('.add-input');
  const draft = oldInput ? oldInput.value : '';
  $sections.querySelectorAll('.add-row').forEach((row) => { row.dataset.retired = '1'; });

  $sections.replaceChildren(...sections);

  const addInput = $sections.querySelector('.add-input');
  if (addInput) {
    addInput.value = draft;
    addInput.focus();
  }
}

function renderProgress() {
  const dateKey = toDateKey(selectedDate);
  const dayTodos = todos.filter((t) => t.date === dateKey);
  const doneCount = dayTodos.filter((t) => t.done).length;
  const total = dayTodos.length;
  $progressFill.style.width = total ? `${(doneCount / total) * 100}%` : '0';
  $progressText.textContent = total ? `${doneCount} / ${total} 완료` : '할 일 없음';
  $empty.hidden = total > 0;
}

function renderSection(cat, items, canAdd) {
  const section = document.createElement('section');
  section.className = 'cat-section';
  section.style.setProperty('--cat', safeColor(cat.color));

  const head = document.createElement(canAdd ? 'button' : 'div');
  head.className = 'cat-head';
  const dot = document.createElement('span');
  dot.className = 'cat-dot';
  const name = document.createElement('span');
  name.textContent = cat.name;
  head.append(dot, name);
  if (canAdd) {
    head.type = 'button';
    head.setAttribute('aria-label', `${cat.name}에 할 일 추가`);
    const plus = document.createElement('span');
    plus.className = 'cat-plus';
    plus.innerHTML = PLUS_ICON;
    head.append(plus);
    head.addEventListener('click', () => {
      addingCategoryId = cat.id;
      renderDay();
    });
  }

  const list = document.createElement('ul');
  list.className = 'todo-list';
  list.append(...items.map(renderItem));

  section.append(head, list);
  if (canAdd && addingCategoryId === cat.id) section.append(renderAddRow(cat.id, list));
  return section;
}

// 새 할 일 입력줄 (흰 목록 칸 밖, 바로 아래에 나와요)
function renderAddRow(categoryId, list) {
  const row = document.createElement('div');
  row.className = 'add-row';

  const ring = document.createElement('span');
  ring.className = 'check';
  ring.setAttribute('aria-hidden', 'true');

  const input = document.createElement('input');
  input.className = 'add-input';
  input.type = 'text';
  input.maxLength = 200;
  input.placeholder = '할 일 입력 후 엔터';
  input.setAttribute('aria-label', '새 할 일');

  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return; // 한글 입력 중에는 엔터를 무시해요
    if (e.key === 'Enter') {
      e.preventDefault();
      const title = input.value.trim();
      if (!title) return;
      input.value = '';
      addTodo(title, categoryId); // 입력칸은 열린 채로 다시 그려져요
    } else if (e.key === 'Escape') {
      input.value = '';
      input.blur();
    }
  });

  // 입력칸 밖을 누르면: 적어 둔 게 있으면 추가하고 입력칸을 닫아요.
  // 목록 전체를 다시 그리지 않아야 방금 누른 버튼이 한 번에 눌려요.
  input.addEventListener('blur', () => {
    if (row.dataset.retired || !input.isConnected || addingCategoryId !== categoryId) return;
    addingCategoryId = null;
    const title = input.value.trim();
    if (title) list.append(renderItem(createTodo(title, categoryId)));
    row.remove();
    renderCalendar();
    renderProgress();
  });

  row.append(ring, input);
  return row;
}

function renderItem(todo) {
  const li = document.createElement('li');
  li.className = 'todo-item' + (todo.done ? ' done' : '');

  const check = document.createElement('button');
  check.className = 'check';
  check.type = 'button';
  check.innerHTML = CHECK_ICON;
  check.setAttribute('aria-label', todo.done ? '완료 취소' : '완료');
  check.addEventListener('click', () => toggleTodo(todo.id));

  const title = document.createElement('span');
  title.className = 'todo-title';
  title.textContent = todo.title;
  title.title = '눌러서 이름 고치기';
  title.addEventListener('click', () => startEditTitle(title, todo));

  const del = document.createElement('button');
  del.className = 'delete';
  del.type = 'button';
  del.textContent = '×';
  del.setAttribute('aria-label', '삭제');
  del.addEventListener('click', () => deleteTodo(todo.id));

  li.append(check, title, del);
  return li;
}

// 할 일 이름을 누르면 그 자리에서 고칠 수 있어요
// 엔터나 바깥을 누르면 저장, Esc는 취소, 다 지우면 원래 이름으로 돌아가요
function startEditTitle(span, todo) {
  const input = document.createElement('input');
  input.className = 'todo-edit';
  input.type = 'text';
  input.maxLength = 200;
  input.value = todo.title;
  input.setAttribute('aria-label', '할 일 이름 고치기');

  let finished = false;
  const finish = (keep) => {
    if (finished) return;
    finished = true;
    const value = input.value.trim();
    if (keep && value && value !== todo.title) {
      todo.title = value;
      save(remote.updateTodo(todo.id, { title: value }));
    }
    span.textContent = todo.title;
    if (input.isConnected) input.replaceWith(span);
    scheduleRender();
  };

  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));

  span.replaceWith(input);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

// ===== 카테고리 관리 창 =====
function renderCategoryList() {
  const rows = categories.map((cat) => {
    const li = document.createElement('li');
    li.className = 'cat-row';
    li.dataset.id = cat.id;
    li.style.setProperty('--cat', safeColor(cat.color));

    const line = document.createElement('div');
    line.className = 'cat-row-line';

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'cat-handle';
    handle.innerHTML = GRIP_ICON;
    handle.setAttribute('aria-label', `${cat.name} 순서 바꾸기 (끌거나 위·아래 화살표 키)`);
    handle.addEventListener('pointerdown', (e) => startCategoryDrag(e, li));
    handle.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        moveCategory(cat.id, e.key === 'ArrowUp' ? -1 : 1);
      }
    });

    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'cat-swatch';
    swatch.setAttribute('aria-label', `${cat.name} 색 바꾸기`);
    swatch.setAttribute('aria-expanded', String(pickingColorFor === cat.id));
    swatch.addEventListener('click', () => {
      pickingColorFor = pickingColorFor === cat.id ? null : cat.id;
      renderCategoryList();
    });

    const name = document.createElement('input');
    name.className = 'cat-name';
    name.type = 'text';
    name.maxLength = 20;
    name.value = cat.name;
    name.setAttribute('aria-label', '카테고리 이름');
    name.addEventListener('change', () => renameCategory(cat.id, name.value));
    name.addEventListener('blur', () => {
      if (!name.value.trim()) name.value = cat.name; // 비워 두면 원래 이름으로
    });
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) name.blur();
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'icon-button cat-delete';
    del.innerHTML = TRASH_ICON;
    del.setAttribute('aria-label', `${cat.name} 삭제`);
    del.addEventListener('click', () => deleteCategory(cat.id));

    line.append(handle, swatch, name, del);
    li.append(line);

    if (pickingColorFor === cat.id) {
      const palette = document.createElement('div');
      palette.className = 'palette';
      for (const color of PALETTE) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'palette-chip' + (color === cat.color ? ' current' : '');
        chip.style.background = color;
        chip.setAttribute('aria-label', '이 색으로');
        chip.addEventListener('click', () => recolorCategory(cat.id, color));
        palette.append(chip);
      }
      li.append(palette);
    }
    return li;
  });
  $catList.replaceChildren(...rows);
}

// 손잡이를 누른 채 위아래로 끌면 줄이 따라 움직이고, 손을 떼면 그 순서로 저장해요
function startCategoryDrag(e, row) {
  e.preventDefault();
  row.classList.add('dragging');
  document.body.classList.add('is-dragging');

  const onMove = (ev) => {
    const others = [...$catList.children].filter((r) => r !== row);
    const before = others.find((r) => {
      const box = r.getBoundingClientRect();
      return ev.clientY < box.top + box.height / 2;
    });
    if (before) {
      if (row.nextElementSibling !== before) $catList.insertBefore(row, before);
    } else if ($catList.lastElementChild !== row) {
      $catList.append(row);
    }
  };

  const onUp = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    row.classList.remove('dragging');
    document.body.classList.remove('is-dragging');

    const order = [...$catList.children].map((r) => r.dataset.id);
    if (order.some((id, i) => categories[i].id !== id)) {
      categories.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      saveCategoryOrder();
      render();
    }
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

// 키보드로 한 칸씩 옮기기
function moveCategory(id, step) {
  const from = categories.findIndex((c) => c.id === id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= categories.length) return;
  const [cat] = categories.splice(from, 1);
  categories.splice(to, 0, cat);
  saveCategoryOrder();
  commitCategories();
  const handle = $catList.querySelector(`[data-id="${id}"] .cat-handle`);
  if (handle) handle.focus();
}

// ===== 시작 =====
document.getElementById('cal-prev').addEventListener('click', () => moveMonth(-1));
document.getElementById('cal-next').addEventListener('click', () => moveMonth(1));
document.getElementById('cal-today').addEventListener('click', () => selectDate(new Date()));

document.getElementById('open-cats').addEventListener('click', () => {
  pickingColorFor = null;
  renderCategoryList();
  $catDialog.showModal();
});
document.getElementById('cat-close').addEventListener('click', () => $catDialog.close());
document.getElementById('cat-add').addEventListener('click', addCategory);
// 창 바깥(어두운 부분)을 누르면 닫혀요
$catDialog.addEventListener('click', (e) => {
  if (e.target === $catDialog) $catDialog.close();
});

// ===== 로그인 =====
// 화면 상태: loading(불러오는 중) / login(로그인 화면) / app(할 일 화면)
function showScreen(name) {
  document.body.dataset.screen = name;
}

const LOGIN_ERRORS = {
  'auth/popup-blocked': '로그인 창이 막혔어요. 브라우저에서 팝업을 허용한 뒤 다시 눌러 주세요.',
  'auth/unauthorized-domain': '이 주소는 아직 로그인이 허용되지 않았어요. Firebase 설정에서 도메인을 추가해야 해요.',
  'auth/network-request-failed': '인터넷 연결을 확인해 주세요.',
  'permission-denied': '이 구글 계정으로는 사용할 수 없어요. 등록한 계정으로 로그인해 주세요.',
};

function showLoginError(err) {
  console.error(err);
  $loginError.textContent = LOGIN_ERRORS[err.code] || `문제가 생겼어요 (${err.code || err.message})`;
}

$loginButton.addEventListener('click', () => {
  $loginError.textContent = '';
  login().catch((err) => {
    if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return;
    showLoginError(err);
  });
});

document.getElementById('logout').addEventListener('click', () => {
  if (confirm('로그아웃할까요?')) logout();
});

let stopSync = null;

if (!isConfigured) {
  showScreen('login');
  $loginButton.disabled = true;
  $loginError.textContent = 'firebase-config.js에 Firebase 설정을 아직 넣지 않았어요.';
} else {
  watchAuth(async (user) => {
    if (stopSync) {
      stopSync();
      stopSync = null;
    }
    if (!user) {
      todos = [];
      categories = [];
      $catDialog.close();
      showScreen('login');
      return;
    }

    showScreen('loading');
    useAccount(user.uid);
    const local = localDataForSeed();
    await seedIfEmpty(local.categories, local.todos);

    let gotTodos = false;
    let gotCategories = false;
    const ready = () => {
      if (!gotTodos || !gotCategories) return;
      showScreen('app');
      scheduleRender();
    };
    stopSync = subscribe({
      onTodos: (list) => { todos = list; gotTodos = true; ready(); },
      onCategories: (list) => { categories = list; gotCategories = true; ready(); },
      onError: (err) => {
        showLoginError(err);
        logout();
      },
    });
  });
}
