// ===== 저장소 =====
// 지금은 이 컴퓨터의 브라우저 안에만 저장해요.
// 4단계에서 이 부분만 인터넷 저장소(Firebase)로 바꿀 예정이에요.
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

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장 공간을 쓸 수 없는 환경이면 조용히 넘어가요
  }
}

const store = {
  loadTodos: () => loadJSON(TODOS_KEY, []),
  saveTodos: (todos) => saveJSON(TODOS_KEY, todos),
  loadCategories: () => loadJSON(CATEGORIES_KEY, null),
  saveCategories: (categories) => saveJSON(CATEGORIES_KEY, categories),
};

// ===== 카테고리 색 =====
// 카테고리 색은 이 목록에서 골라요
const PALETTE = [
  '#5B8DEF', // 파랑
  '#3D5FC4', // 남색
  '#6CBDE0', // 하늘
  '#4DB6A0', // 청록
  '#7FB069', // 초록
  '#8E7CE0', // 보라
  '#E88AA8', // 분홍
  '#F0A96B', // 살구
  '#E5C15A', // 노랑
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

// ===== 상태 =====
let categories = store.loadCategories() || DEFAULT_CATEGORIES.map((c) => ({ ...c }));
let todos = store.loadTodos();

// 예전(1·2단계)에 만든 할 일은 첫 번째 카테고리로 넣어 줘요
for (const t of todos) {
  if (!t.categoryId) t.categoryId = categories[0].id;
  if (t.done && !t.doneAt) t.doneAt = t.createdAt;
}

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

const CHECK_PATH = 'M3.5 8.5l3 3 6-7';
const CHECK_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="${CHECK_PATH}"/></svg>`;
const PLUS_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>';

function findCategory(id) {
  return categories.find((c) => c.id === id);
}

function categoryColor(id) {
  const cat = findCategory(id);
  return safeColor(cat ? cat.color : UNCATEGORIZED_COLOR);
}

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
  store.saveTodos(todos);
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
  commit();
}

function deleteTodo(id) {
  todos = todos.filter((t) => t.id !== id);
  commit();
}

function commit() {
  store.saveTodos(todos);
  render();
}

// ===== 카테고리 동작 =====
function commitCategories() {
  store.saveCategories(categories);
  render();
  renderCategoryList();
}

function addCategory() {
  const used = new Set(categories.map((c) => c.color));
  const color = PALETTE.find((p) => !used.has(p)) || PALETTE[0];
  const cat = { id: newId(), name: '새 카테고리', color };
  categories.push(cat);
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
    store.saveCategories(categories);
    render();
  }
}

function recolorCategory(id, color) {
  const cat = findCategory(id);
  if (!cat) return;
  cat.color = color;
  pickingColorFor = null;
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

  $sections.replaceChildren(...sections);

  const addInput = $sections.querySelector('.add-input');
  if (addInput) addInput.focus();
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
  if (canAdd && addingCategoryId === cat.id) list.append(renderAddRow(cat.id));

  section.append(head, list);
  return section;
}

function renderAddRow(categoryId) {
  const li = document.createElement('li');
  li.className = 'todo-item adding';

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
      // 다시 그리면서 이 입력칸이 사라질 때 blur에서 또 추가되지 않도록 표시해 둬요
      li.dataset.retired = '1';
      addTodo(title, categoryId); // 입력칸은 열린 채로 다시 그려져요
    } else if (e.key === 'Escape') {
      input.value = '';
      input.blur();
    }
  });

  // 입력칸 밖을 누르면: 적어 둔 게 있으면 추가하고 입력칸을 닫아요.
  // 목록 전체를 다시 그리지 않아야 방금 누른 버튼이 한 번에 눌려요.
  input.addEventListener('blur', () => {
    if (li.dataset.retired || !input.isConnected || addingCategoryId !== categoryId) return;
    addingCategoryId = null;
    const title = input.value.trim();
    if (title) li.replaceWith(renderItem(createTodo(title, categoryId)));
    else li.remove();
    renderCalendar();
    renderProgress();
  });

  li.append(ring, input);
  return li;
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

  const del = document.createElement('button');
  del.className = 'delete';
  del.type = 'button';
  del.textContent = '×';
  del.setAttribute('aria-label', '삭제');
  del.addEventListener('click', () => deleteTodo(todo.id));

  li.append(check, title, del);
  return li;
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

    line.append(swatch, name, del);
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

render();
