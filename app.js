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

// '2026-10-21' → 날짜
function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// '2026-10-21' → '10월 21일 (수)'
function formatDateKey(key) {
  return formatTitle(parseDateKey(key));
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
const $todoSheet = document.getElementById('todo-sheet');
const $todoSheetTitle = document.getElementById('todo-sheet-title');
const $todoSheetBody = document.getElementById('todo-sheet-body');
const $archiveDialog = document.getElementById('archive-dialog');
const $archiveList = document.getElementById('archive-list');
const $archiveEmpty = document.getElementById('archive-empty');
const $loginButton = document.getElementById('login-button');
const $loginError = document.getElementById('login-error');
const $toast = document.getElementById('toast');
const $toastText = document.getElementById('toast-text');
const $toastAction = document.getElementById('toast-action');
const $selectBar = document.getElementById('select-bar');
const $selectCount = document.getElementById('select-count');
const $postpone = document.getElementById('postpone-undone');

const CHECK_PATH = 'M3.5 8.5l3 3 6-7';
const CHECK_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="${CHECK_PATH}"/></svg>`;
const PLUS_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>';
const MORE_ICON = '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12.5" cy="8" r="1.4"/></svg>';
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

// 아래에 잠깐 나오는 알림. action을 주면 '되돌리기' 같은 버튼도 같이 나와요
let toastTimer = null;
let toastAction = null;
function showToast(message, action = null) {
  $toastText.textContent = message;
  toastAction = action;
  $toastAction.hidden = !action;
  if (action) $toastAction.textContent = action.label;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? 6000 : 4000);
}

function hideToast() {
  $toast.classList.remove('show');
  toastAction = null;
}

// 다른 기기에서 바뀐 내용이 들어오면 화면을 다시 그려요.
// 단, 마우스를 누르고 있거나 글자를 입력하는 중이면 끝날 때까지 기다려요.
// (그래야 누르던 버튼이 사라지거나 쓰던 글자가 끊기지 않아요)
let pointerIsDown = false;
let renderPending = false;

function scheduleRender() {
  const typing = document.activeElement?.matches?.('.add-input, .cat-name, .edit-input');
  if (pointerIsDown || typing || dropping) {
    renderPending = true;
    return;
  }
  renderPending = false;
  render();
  if (selecting) renderSelectBar();
  if ($catDialog.open) renderCategoryList();
  if ($archiveDialog.open) renderArchive();
  if ($todoSheet.open && sheetMode === 'menu') renderTodoSheet();
}

// 보관함에 없는(날짜에 놓인) 할 일만
function activeTodos() {
  return todos.filter((t) => !t.archived);
}

function flushRender() {
  if (renderPending) setTimeout(() => renderPending && scheduleRender(), 0);
}

document.addEventListener('pointerdown', () => { pointerIsDown = true; }, true);
document.addEventListener('pointerup', () => { pointerIsDown = false; flushRender(); }, true);
document.addEventListener('pointercancel', () => { pointerIsDown = false; flushRender(); }, true);
document.addEventListener('focusout', flushRender);

// ===== 할 일 동작 =====
// 그 날짜 목록의 맨 끝 순서 번호
function nextOrder(dateKey) {
  const sameDay = activeTodos().filter((t) => t.date === dateKey);
  return sameDay.length ? Math.max(...sameDay.map((t) => t.order)) + 1 : 0;
}

// 할 일을 만들어 저장만 하고, 화면은 다시 그리지 않아요
function createTodo(title, categoryId) {
  const dateKey = toDateKey(selectedDate);
  const todo = {
    id: newId(),
    title,
    date: dateKey,
    categoryId,
    done: false,
    doneAt: null,
    archived: false,
    archivedAt: null,
    order: nextOrder(dateKey),
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

// 묻지 않고 바로 지워요. 대신 알림의 '되돌리기'로 살릴 수 있어요
function deleteTodos(ids) {
  const removed = todos.filter((t) => ids.includes(t.id));
  todos = todos.filter((t) => !ids.includes(t.id));
  for (const t of removed) save(remote.deleteTodo(t.id));
  return {
    label: '되돌리기',
    run() {
      for (const t of removed) {
        if (todos.some((x) => x.id === t.id)) continue;
        todos.push(t);
        save(remote.addTodo(t));
      }
      render();
      if ($archiveDialog.open) renderArchive();
    },
  };
}

// 다른 날짜로 옮기기 (보관함에서 꺼낼 때도 써요)
function moveTodo(todo, dateKey) {
  const fields = { date: dateKey, order: nextOrder(dateKey), archived: false, archivedAt: null };
  Object.assign(todo, fields);
  save(remote.updateTodo(todo.id, fields));
}

// 같은 할 일을 다른 날짜에 하나 더 (체크 안 된 상태로)
function copyTodo(todo, dateKey) {
  const copy = {
    id: newId(),
    title: todo.title,
    date: dateKey,
    categoryId: todo.categoryId,
    done: false,
    doneAt: null,
    archived: false,
    archivedAt: null,
    order: nextOrder(dateKey),
    createdAt: Date.now(),
  };
  todos.push(copy);
  save(remote.addTodo(copy));
}

function archiveTodo(todo) {
  const fields = { archived: true, archivedAt: Date.now() };
  Object.assign(todo, fields);
  save(remote.updateTodo(todo.id, fields));
}

// 고른 날짜의 할 일 (순서대로)
function dayTodosOf(date) {
  const key = toDateKey(date);
  return activeTodos().filter((t) => t.date === key).sort((a, b) => a.order - b.order);
}

// 미완료 할 일을 전부 다음 날로
function postponeUndone() {
  const undone = dayTodosOf(selectedDate).filter((t) => !t.done);
  if (!undone.length) return;
  const nextDay = toDateKey(addDays(selectedDate, 1));
  for (const t of undone) moveTodo(t, nextDay);
  render();
  showToast(`미완료 ${undone.length}개를 ${formatDateKey(nextDay)}로 옮겼어요`);
}

// ===== 여러 개 선택 =====
let selecting = false;
const selectedIds = new Set();

function startSelecting() {
  setMenuOpen(false);
  selecting = true;
  selectedIds.clear();
  addingCategoryId = null;
  document.body.classList.add('selecting');
  renderDay();
  renderSelectBar();
}

function stopSelecting() {
  selecting = false;
  selectedIds.clear();
  document.body.classList.remove('selecting');
  renderDay();
  renderSelectBar();
}

function toggleSelected(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  renderDay();
  renderSelectBar();
}

// 고르기 버튼: 이미 전부 골라져 있으면 전부 풀어요
function selectWhere(test) {
  const ids = dayTodosOf(selectedDate).filter(test).map((t) => t.id);
  const already = ids.length && ids.length === selectedIds.size && ids.every((id) => selectedIds.has(id));
  selectedIds.clear();
  if (!already) ids.forEach((id) => selectedIds.add(id));
  renderDay();
  renderSelectBar();
}

function renderSelectBar() {
  $selectBar.hidden = !selecting;
  if (!selecting) return;
  // 다른 기기에서 지워진 할 일은 선택에서 빼요
  const visible = new Set(dayTodosOf(selectedDate).map((t) => t.id));
  for (const id of [...selectedIds]) if (!visible.has(id)) selectedIds.delete(id);
  $selectCount.textContent = selectedIds.size ? `${selectedIds.size}개 선택` : '할 일을 눌러 고르세요';
}

function selectedTodos() {
  return todos.filter((t) => selectedIds.has(t.id));
}

function runBulk(kind) {
  const chosen = selectedTodos();
  if (!chosen.length) {
    showToast('먼저 할 일을 골라 주세요');
    return;
  }
  if (kind === 'move' || kind === 'copy') {
    openDateSheet(chosen.map((t) => t.id), kind);
    return;
  }
  if (kind === 'archive') {
    chosen.forEach(archiveTodo);
    stopSelecting();
    render();
    showToast(`${chosen.length}개를 보관함에 넣었어요`);
  } else if (kind === 'delete') {
    const undo = deleteTodos(chosen.map((t) => t.id));
    stopSelecting();
    render();
    showToast(`${chosen.length}개를 지웠어요`, undo);
  }
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
  selectedIds.clear();
  render();
  renderSelectBar();
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
  for (const t of activeTodos()) (byDate[t.date] ||= []).push(t);

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
  const dayTodos = dayTodosOf(selectedDate);

  $dayLabel.textContent = formatLabel(selectedDate);
  $dayTitle.textContent = formatTitle(selectedDate);
  renderProgress();

  // 선택하는 중에는 할 일을 새로 추가하지 않아요
  const sections = categories.map((cat) =>
    renderSection(cat, dayTodos.filter((t) => t.categoryId === cat.id), !selecting)
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
  const dayTodos = dayTodosOf(selectedDate);
  const doneCount = dayTodos.filter((t) => t.done).length;
  const total = dayTodos.length;
  $progressFill.style.width = total ? `${(doneCount / total) * 100}%` : '0';
  $progressText.textContent = total ? `${doneCount} / ${total} 완료` : '할 일 없음';
  $empty.hidden = total > 0;

  const undone = total - doneCount;
  $postpone.hidden = !undone || selecting;
  $postpone.textContent = `미완료 ${undone}개 내일 하기 →`;
}

function renderSection(cat, items, canAdd) {
  const section = document.createElement('section');
  section.className = 'cat-section';
  section.style.setProperty('--cat', safeColor(cat.color));
  if (cat.id) section.dataset.catId = cat.id; // 끌어서 옮길 때 어느 카테고리인지 알려고

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
  if (selecting) return renderSelectableItem(todo);

  const li = document.createElement('li');
  li.className = 'todo-item' + (todo.done ? ' done' : '');

  const check = document.createElement('button');
  check.className = 'check';
  check.type = 'button';
  check.innerHTML = CHECK_ICON;
  check.setAttribute('aria-label', todo.done ? '완료 취소' : '완료');
  check.addEventListener('click', () => toggleTodo(todo.id));

  // 할 일 이름을 누르면 메뉴가 열려요 (투두메이트처럼)
  const title = document.createElement('button');
  title.type = 'button';
  title.className = 'todo-title';
  title.textContent = todo.title;
  title.addEventListener('click', () => openTodoSheet(todo.id));

  li.append(check, title);
  li.dataset.id = todo.id;
  li.addEventListener('pointerdown', (e) => pressTodo(e, li));
  return li;
}

// ===== 할 일 끌어서 옮기기 =====
// 컴퓨터: 누른 채 조금 움직이면 시작 / 휴대폰: 꾹 누르고(0.35초) 있다가 끌기
// 다른 카테고리 위에 놓으면 그 카테고리로 바뀌어요
let todoDrag = null;
let dropping = false; // 놓는 애니메이션 중에는 화면을 다시 그리지 않아요
let suppressClick = false;

function pressTodo(e, li) {
  if (!e.isPrimary || e.button > 0 || e.target.closest('input')) return;
  const start = { x: e.clientX, y: e.clientY };
  const touch = e.pointerType !== 'mouse';
  let timer = null;

  const cleanup = () => {
    clearTimeout(timer);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', cleanup);
    document.removeEventListener('pointercancel', cleanup);
  };

  const onMove = (ev) => {
    const moved = Math.hypot(ev.clientX - start.x, ev.clientY - start.y);
    if (touch) {
      if (moved > 8) cleanup(); // 꾹 누르기 전에 움직이면 그냥 스크롤
    } else if (moved > 6) {
      cleanup();
      beginTodoDrag(li, ev.clientY);
    }
  };

  if (touch) {
    timer = setTimeout(() => {
      cleanup();
      if (navigator.vibrate) navigator.vibrate(10);
      beginTodoDrag(li, start.y);
    }, 350);
  }
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', cleanup);
  document.addEventListener('pointercancel', cleanup);
}

// 끄는 동안: 할 일은 손가락을 그대로 따라 떠다니고,
// 원래 자리에는 같은 크기의 빈자리(gap)가 생겨서 놓일 곳으로 스르륵 움직여요
function beginTodoDrag(li, y) {
  const box = li.getBoundingClientRect();
  const gap = document.createElement('li');
  gap.className = 'drop-gap';
  gap.style.height = `${box.height}px`;
  li.replaceWith(gap);

  li.classList.add('dragging');
  li.style.setProperty('--cat', getComputedStyle(gap).getPropertyValue('--cat'));
  Object.assign(li.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px` });
  document.body.append(li);

  todoDrag = { li, gap, offset: y - box.top, lastY: y };
  document.body.classList.add('is-dragging');
  document.addEventListener('pointermove', onTodoDragMove);
  document.addEventListener('pointerup', endTodoDrag);
  document.addEventListener('pointercancel', endTodoDrag);
}

// 다른 줄들이 새 자리로 부드럽게 미끄러지게 (움직이기 전 위치 → 후 위치)
function animateShift(change) {
  const els = [...$sections.querySelectorAll('.todo-item, .cat-head, .add-row')];
  const before = new Map(els.map((el) => [el, el.getBoundingClientRect().top]));
  change();
  for (const el of els) {
    const dy = before.get(el) - el.getBoundingClientRect().top;
    if (!dy) continue;
    el.style.transition = 'none';
    el.style.transform = `translateY(${dy}px)`;
    requestAnimationFrame(() => {
      el.style.transition = 'transform 0.18s ease';
      el.style.transform = '';
    });
  }
}

// 손가락 높이(y)에 맞춰 빈자리를 옮겨요 (다른 카테고리 위면 그 카테고리로)
function placeGap(y) {
  const { li, gap } = todoDrag;
  const sections = [...$sections.querySelectorAll('.cat-section[data-cat-id]')];
  if (!sections.length) return;
  let target = sections[0];
  for (const s of sections) if (s.getBoundingClientRect().top <= y) target = s;

  // 끌고 있는 할 일의 색을 놓일 카테고리 색으로 미리 보여 줘요
  li.style.setProperty('--cat', target.style.getPropertyValue('--cat'));

  const list = target.querySelector('.todo-list');
  const items = [...list.querySelectorAll('.todo-item')];
  const before = items.find((x) => {
    const b = x.getBoundingClientRect();
    return y < b.top + b.height / 2;
  }) || null;
  if (gap.parentElement === list && gap.nextElementSibling === before) return;
  animateShift(() => list.insertBefore(gap, before));
}

function onTodoDragMove(e) {
  if (!todoDrag) return;
  e.preventDefault();
  todoDrag.lastY = e.clientY;
  todoDrag.li.style.top = `${e.clientY - todoDrag.offset}px`;
  placeGap(e.clientY);
  // 화면 위·아래 끝으로 끌면 저절로 스크롤
  if (e.clientY < 70) window.scrollBy(0, -12);
  else if (e.clientY > window.innerHeight - 90) window.scrollBy(0, 12);
}

function endTodoDrag() {
  if (!todoDrag) return;
  const { li, gap } = todoDrag;
  todoDrag = null;
  document.removeEventListener('pointermove', onTodoDragMove);
  document.removeEventListener('pointerup', endTodoDrag);
  document.removeEventListener('pointercancel', endTodoDrag);
  document.body.classList.remove('is-dragging');

  // 끌기가 끝난 직후의 '클릭'(체크·메뉴)은 무시해요
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);

  // 빈자리로 쏙 들어가는 모습을 보여 준 뒤 저장해요
  dropping = true;
  const dest = gap.getBoundingClientRect();
  li.style.transition = 'top 0.15s ease, left 0.15s ease';
  Object.assign(li.style, { top: `${dest.top}px`, left: `${dest.left}px` });
  setTimeout(() => {
    li.classList.remove('dragging');
    li.removeAttribute('style');
    gap.replaceWith(li);
    dropping = false;
    saveTodoOrder(li);
    flushRender();
  }, 150);
}

// 화면에 놓인 순서 그대로 순서 번호와 카테고리를 저장해요
function saveTodoOrder(li) {
  let order = 0;
  for (const section of $sections.querySelectorAll('.cat-section')) {
    const catId = section.dataset.catId;
    for (const item of section.querySelectorAll('.todo-item[data-id]')) {
      const todo = todos.find((t) => t.id === item.dataset.id);
      if (!todo) continue;
      const fields = {};
      if (todo.order !== order) fields.order = order;
      if (catId && item === li && todo.categoryId !== catId) fields.categoryId = catId;
      if (Object.keys(fields).length) {
        Object.assign(todo, fields);
        save(remote.updateTodo(todo.id, fields));
      }
      order++;
    }
  }
  render();
}

// 터치로 끄는 동안에는 화면이 스크롤되지 않게
document.addEventListener('touchmove', (e) => {
  if (todoDrag) e.preventDefault();
}, { passive: false });

// 휴대폰에서 꾹 누를 때 뜨는 복사/공유 메뉴 막기
$sections.addEventListener('contextmenu', (e) => {
  if (e.target.closest('.todo-item')) e.preventDefault();
});

document.addEventListener('click', (e) => {
  if (suppressClick) {
    e.stopPropagation();
    e.preventDefault();
  }
}, true);

// 선택하는 중: 줄 어디를 눌러도 골라지고/풀려요
function renderSelectableItem(todo) {
  const li = document.createElement('li');
  const picked = selectedIds.has(todo.id);
  li.className = 'todo-item selectable' + (todo.done ? ' done' : '') + (picked ? ' picked' : '');
  li.tabIndex = 0;
  li.setAttribute('role', 'checkbox');
  li.setAttribute('aria-checked', String(picked));

  const box = document.createElement('span');
  box.className = 'pick-box';
  box.innerHTML = CHECK_ICON;

  const title = document.createElement('span');
  title.className = 'todo-title';
  title.textContent = todo.title;

  li.append(box, title);
  li.addEventListener('click', () => toggleSelected(todo.id));
  li.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      toggleSelected(todo.id);
    }
  });
  return li;
}

// ===== 할 일 메뉴 =====
// sheetMode: menu(메뉴 목록) / move(날짜 바꾸기) / copy(복사하기) / restore(보관함에서 꺼내기)
// sheetIds: 메뉴가 다루는 할 일들 (⋯ 메뉴는 1개, 여러 개 선택은 여러 개)
let sheetIds = [];
let sheetMode = 'menu';

function openTodoSheet(id) {
  sheetIds = [id];
  sheetMode = 'menu';
  renderTodoSheet();
  if (!$todoSheet.open) $todoSheet.showModal();
}

// 날짜 고르기부터 바로 열기 (여러 개 이동·복사)
function openDateSheet(ids, mode) {
  sheetIds = ids;
  sheetMode = mode;
  renderTodoSheet();
  if (!$todoSheet.open) $todoSheet.showModal();
}

function closeTodoSheet() {
  if ($todoSheet.open) $todoSheet.close();
}

// 메뉴 동작을 하고, 창을 닫고, 다시 그리고, 알려 줘요
function finishAction(message, action = null) {
  closeTodoSheet();
  if (selecting) stopSelecting();
  render();
  if ($archiveDialog.open) renderArchive();
  if (message) showToast(message, action);
}

// 메뉴 아이콘 (동그라미 안에 들어가요)
const SHEET_ICONS = {
  edit: '<path d="M4 14.5V16h1.5l7.7-7.7-1.5-1.5zM13.6 5.2l1.2 1.2"/>',
  trash: '<path d="M5 6.5h10M8.3 6.5V5h3.4v1.5M6.4 6.5l.6 9h6l.6-9M8.8 9.5v3.5M11.2 9.5v3.5"/>',
  next: '<path d="M5 10h10M11 6l4 4-4 4"/>',
  again: '<path d="M14.5 7.5A5 5 0 1 0 15 11M14.8 4.5v3.2h-3.2"/>',
  date: '<rect x="4.5" y="5.5" width="11" height="10" rx="2"/><path d="M4.5 8.5h11M7.5 4v3M12.5 4v3"/>',
  copy: '<rect x="7" y="7" width="8" height="8" rx="1.8"/><path d="M5 12.5V6a1 1 0 0 1 1-1h6.5"/>',
  archive: '<rect x="4" y="5" width="12" height="3" rx="1"/><path d="M5 8v6.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8M8.5 11h3"/>',
  today: '<circle cx="10" cy="10" r="5.5"/><path d="M10 7.5V10l1.8 1.2"/>',
};

function sheetIcon(name) {
  return `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SHEET_ICONS[name]}</svg>`;
}

// 맨 위 큰 버튼 (수정하기 / 삭제하기)
function sheetTile(label, icon, onClick, extraClass = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `sheet-tile ${extraClass}`.trim();
  button.innerHTML = sheetIcon(icon);
  const text = document.createElement('span');
  text.textContent = label;
  button.append(text);
  button.addEventListener('click', onClick);
  return button;
}

function sheetButton(label, hint, onClick, icon = 'next') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sheet-action';
  const badge = document.createElement('span');
  badge.className = 'sheet-action-icon';
  badge.innerHTML = sheetIcon(icon);
  const text = document.createElement('span');
  text.className = 'sheet-action-label';
  text.textContent = label;
  button.append(badge, text);
  if (hint) {
    const small = document.createElement('span');
    small.className = 'sheet-action-hint';
    small.textContent = hint;
    button.append(small);
  }
  button.addEventListener('click', onClick);
  return button;
}

function renderTodoSheet() {
  const targets = todos.filter((t) => sheetIds.includes(t.id));
  if (!targets.length) {
    closeTodoSheet();
    return;
  }
  const [todo] = targets;
  const many = targets.length > 1;
  $todoSheet.style.setProperty('--cat', many ? 'var(--primary)' : categoryColor(todo.categoryId));
  $todoSheetTitle.textContent = many ? `할 일 ${targets.length}개` : todo.title;

  if (sheetMode === 'edit') {
    $todoSheetBody.replaceChildren(renderEditForm(todo));
    return;
  }
  if (sheetMode !== 'menu') {
    $todoSheetBody.replaceChildren(renderDateForm(targets));
    return;
  }

  const nextDay = toDateKey(addDays(parseDateKey(todo.date), 1));
  const todayKey = toDateKey(new Date());
  const goto = (mode) => () => {
    sheetMode = mode;
    renderTodoSheet();
  };

  // 맨 위: 수정하기 / 삭제하기
  const tiles = document.createElement('div');
  tiles.className = 'sheet-tiles';
  tiles.append(
    sheetTile('수정하기', 'edit', goto('edit')),
    sheetTile('삭제하기', 'trash', () => finishAction('지웠어요', deleteTodos([todo.id])), 'danger')
  );

  const items = todo.archived
    ? [
        sheetButton('오늘 하기', formatDateKey(todayKey), () => {
          moveTodo(todo, todayKey);
          finishAction('오늘 할 일로 꺼냈어요');
        }, 'today'),
        sheetButton('날짜 정해서 꺼내기', '', goto('restore'), 'date'),
      ]
    : [
        sheetButton('내일 하기', formatDateKey(nextDay), () => {
          moveTodo(todo, nextDay);
          finishAction(`${formatDateKey(nextDay)}로 옮겼어요`);
        }, 'next'),
        sheetButton('내일 또 하기', '오늘 것은 그대로', () => {
          copyTodo(todo, nextDay);
          finishAction(`${formatDateKey(nextDay)}에도 추가했어요`);
        }, 'again'),
        sheetButton('날짜 바꾸기', '', goto('move'), 'date'),
        sheetButton('복사하기', '다른 날에 하나 더', goto('copy'), 'copy'),
        sheetButton('보관함으로 이동', '', () => {
          archiveTodo(todo);
          finishAction('보관함에 넣었어요');
        }, 'archive'),
      ];

  $todoSheetBody.replaceChildren(tiles, ...items);
}

// 이름 고치기
function renderEditForm(todo) {
  const form = document.createElement('form');
  form.className = 'date-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'edit-input';
  input.maxLength = 200;
  input.value = todo.title;
  input.setAttribute('aria-label', '할 일 이름');

  const buttons = document.createElement('div');
  buttons.className = 'date-form-buttons';
  buttons.append(backButton('뒤로'), Object.assign(document.createElement('button'), {
    type: 'submit', className: 'primary-button', textContent: '저장',
  }));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (value && value !== todo.title) {
      todo.title = value;
      save(remote.updateTodo(todo.id, { title: value }));
    }
    sheetMode = 'menu';
    render();
    renderTodoSheet();
  });

  form.append(input, buttons);
  setTimeout(() => {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, 0);
  return form;
}

// 메뉴로 돌아가기 (여러 개 선택에서 왔으면 창 닫기)
function backButton(label) {
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'text-button';
  back.textContent = label;
  back.addEventListener('click', () => {
    if (label === '취소') {
      closeTodoSheet();
      return;
    }
    sheetMode = 'menu';
    renderTodoSheet();
  });
  return back;
}

// 날짜 고르기 (날짜 바꾸기 / 복사하기 / 꺼내기) — 여러 개도 한 번에
function renderDateForm(targets) {
  const [todo] = targets;
  const fromSelection = targets.length > 1 || selecting;
  const labels = {
    move: ['어느 날로 옮길까요?', '옮기기'],
    copy: ['어느 날에 복사할까요?', '복사하기'],
    restore: ['어느 날로 꺼낼까요?', '꺼내기'],
  };
  const [question] = labels[sheetMode];

  const wrap = document.createElement('div');
  wrap.className = 'date-form';

  const label = document.createElement('p');
  label.className = 'date-form-label';
  label.textContent = question;

  // 날짜를 누르면 바로 옮기기/복사/꺼내기
  const pick = (key) => {
    const count = targets.length > 1 ? `${targets.length}개를 ` : '';
    if (sheetMode === 'copy') {
      targets.forEach((t) => copyTodo(t, key));
      finishAction(`${count}${formatDateKey(key)}에 복사했어요`);
    } else {
      targets.forEach((t) => moveTodo(t, key));
      finishAction(`${count}${formatDateKey(key)}로 옮겼어요`);
    }
  };
  const current = todo.archived ? toDateKey(new Date()) : todo.date;

  const buttons = document.createElement('div');
  buttons.className = 'date-form-buttons';
  buttons.append(backButton(fromSelection ? '취소' : '뒤로'));

  wrap.append(label, miniCalendar(current, pick), buttons);
  return wrap;
}

// 귀여운 미니 달력: 날짜를 누르면 onPick('2026-10-21')
function miniCalendar(currentKey, onPick) {
  const box = document.createElement('div');
  box.className = 'mini-cal';
  let month = parseDateKey(currentKey);
  month = new Date(month.getFullYear(), month.getMonth(), 1);
  const todayKey = toDateKey(new Date());

  const draw = () => {
    const head = document.createElement('div');
    head.className = 'mini-cal-head';
    const prev = Object.assign(document.createElement('button'), { type: 'button', className: 'cal-nav', innerHTML: '‹' });
    const next = Object.assign(document.createElement('button'), { type: 'button', className: 'cal-nav', innerHTML: '›' });
    prev.setAttribute('aria-label', '이전 달');
    next.setAttribute('aria-label', '다음 달');
    prev.addEventListener('click', () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); draw(); });
    next.addEventListener('click', () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); draw(); });
    const title = document.createElement('span');
    title.className = 'mini-cal-title';
    title.textContent = `${month.getFullYear()}년 ${month.getMonth() + 1}월`;
    head.append(prev, title, next);

    const grid = document.createElement('div');
    grid.className = 'mini-cal-grid';
    WEEKDAYS.forEach((w, i) => {
      const s = document.createElement('span');
      s.className = 'mini-cal-wd' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '');
      s.textContent = w;
      grid.append(s);
    });
    for (let i = 0; i < month.getDay(); i++) grid.append(document.createElement('span'));
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= days; d++) {
      const date = new Date(month.getFullYear(), month.getMonth(), d);
      const key = toDateKey(date);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mini-cal-day';
      if (date.getDay() === 0) b.classList.add('sun');
      if (date.getDay() === 6) b.classList.add('sat');
      if (key === todayKey) b.classList.add('today');
      if (key === currentKey) b.classList.add('current');
      b.textContent = d;
      b.setAttribute('aria-label', formatDateKey(key));
      b.addEventListener('click', () => onPick(key));
      grid.append(b);
    }
    box.replaceChildren(head, grid);
  };
  draw();
  return box;
}

// ===== 보관함 =====
function renderArchive() {
  const items = todos
    .filter((t) => t.archived)
    .sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));

  $archiveList.replaceChildren(...items.map((todo) => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'archive-item';
    button.style.setProperty('--cat', categoryColor(todo.categoryId));

    const dot = document.createElement('span');
    dot.className = 'cat-dot';
    const title = document.createElement('span');
    title.className = 'archive-title';
    title.textContent = todo.title;
    const from = document.createElement('span');
    from.className = 'archive-from';
    from.textContent = `${formatDateKey(todo.date)}에서`;

    button.append(dot, title, from);
    button.addEventListener('click', () => openTodoSheet(todo.id));
    li.append(button);
    return li;
  }));
  $archiveEmpty.hidden = items.length > 0;
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

document.getElementById('open-archive').addEventListener('click', () => {
  renderArchive();
  $archiveDialog.showModal();
});
document.getElementById('archive-close').addEventListener('click', () => $archiveDialog.close());
document.getElementById('todo-sheet-close').addEventListener('click', closeTodoSheet);

// 창 바깥(어두운 부분)을 누르면 닫혀요
for (const dialog of [$archiveDialog, $todoSheet]) {
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}
document.getElementById('cat-add').addEventListener('click', addCategory);
$catDialog.addEventListener('click', (e) => {
  if (e.target === $catDialog) $catDialog.close();
});

$toastAction.addEventListener('click', () => {
  const action = toastAction;
  hideToast();
  if (action) action.run();
});

// 홈 상단 ☰ 메뉴 (카테고리 관리, 루틴 관리)
const $menuButton = document.getElementById('open-menu');
const $homeMenu = document.getElementById('home-menu');

function setMenuOpen(open) {
  $homeMenu.hidden = !open;
  $menuButton.setAttribute('aria-expanded', String(open));
}

$menuButton.addEventListener('click', () => setMenuOpen($homeMenu.hidden));
$homeMenu.addEventListener('click', (e) => {
  if (e.target.closest('.menu-item')) setMenuOpen(false);
});
document.addEventListener('click', (e) => {
  if (!$homeMenu.hidden && !e.target.closest('#home-menu, #open-menu')) setMenuOpen(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$homeMenu.hidden) {
    setMenuOpen(false);
    $menuButton.focus();
  }
});

// 미완료 내일 하기, 여러 개 선택
$postpone.addEventListener('click', postponeUndone);
document.getElementById('start-select').addEventListener('click', startSelecting);
document.getElementById('select-cancel').addEventListener('click', stopSelecting);
document.getElementById('select-all').addEventListener('click', () => selectWhere(() => true));
document.getElementById('select-undone').addEventListener('click', () => selectWhere((t) => !t.done));
for (const button of document.querySelectorAll('[data-bulk]')) {
  button.addEventListener('click', () => runBulk(button.dataset.bulk));
}

// ===== 하단 메뉴바: 홈 / 플래너 / 개인정보 =====
function showTab(name) {
  if (selecting) stopSelecting();
  document.body.dataset.tab = name;
  for (const tab of document.querySelectorAll('.tab')) {
    if (tab.dataset.tab === name) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => showTab(tab.dataset.tab));
}

// 아직 안 만든 설정: 누르면 알려 줘요
for (const item of document.querySelectorAll('[data-soon]')) {
  item.addEventListener('click', () => showToast(`${item.dataset.soon} 기능은 곧 만들 거예요`));
}

// 개인정보 화면 위쪽: 구글 계정 사진·이름·이메일 (7-5에서 직접 바꿀 수 있게 할 거예요)
function renderProfile(user) {
  document.getElementById('profile-name').textContent = user.displayName || '이름 없음';
  document.getElementById('profile-email').textContent = user.email || '';
  const $photo = document.getElementById('profile-photo');
  $photo.replaceChildren();
  if (user.photoURL) {
    const img = document.createElement('img');
    img.src = user.photoURL;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    $photo.append(img);
  } else {
    $photo.textContent = (user.displayName || user.email || '?').slice(0, 1);
  }
}

// ===== 앱처럼 설치하기 =====
// 오프라인 도우미를 등록해요 (인터넷이 끊겨도 앱이 열리게)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((err) => console.error(err));
}

// 컴퓨터 크롬·갤럭시에서는 설치할 수 있을 때 개인정보 화면에 "앱 설치"가 나타나요
// (아이폰은 이 기능이 없어서 사파리의 "홈 화면에 추가"로 설치해요)
const $installRow = document.getElementById('install-row');
let installPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $installRow.hidden = false;
});

document.getElementById('install-app').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $installRow.hidden = true;
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  $installRow.hidden = true;
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
      for (const dialog of [$catDialog, $todoSheet, $archiveDialog]) dialog.close();
      if (selecting) stopSelecting();
      showTab('home');
      showScreen('login');
      return;
    }

    showScreen('loading');
    useAccount(user.uid);
    renderProfile(user);
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
