// ===== 저장소 =====
// 지금은 이 컴퓨터의 브라우저 안에만 저장해요.
// 4단계에서 이 부분만 인터넷 저장소(Firebase)로 바꿀 예정이에요.
const STORAGE_KEY = 'mytodo.todos.v1';

const store = {
  load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  },
  save(todos) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
    } catch {
      // 저장 공간을 쓸 수 없는 환경이면 조용히 넘어가요
    }
  },
};

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
let todos = store.load();
let selectedDate = new Date();
// 달력에 보이는 달 (그 달 1일)
let viewMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);

// ===== 화면 요소 =====
const $calTitle = document.getElementById('cal-title');
const $calGrid = document.getElementById('cal-grid');
const $dayLabel = document.getElementById('day-label');
const $dayTitle = document.getElementById('day-title');
const $progressFill = document.getElementById('progress-fill');
const $progressText = document.getElementById('progress-text');
const $form = document.getElementById('add-form');
const $input = document.getElementById('add-input');
const $list = document.getElementById('todo-list');
const $empty = document.getElementById('empty-message');

const CHECK_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>';
const CHECK_MARK =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>';

// ===== 동작 =====
function addTodo(title) {
  const dateKey = toDateKey(selectedDate);
  const sameDay = todos.filter((t) => t.date === dateKey);
  todos.push({
    id: newId(),
    title,
    date: dateKey,
    done: false,
    order: sameDay.length ? Math.max(...sameDay.map((t) => t.order)) + 1 : 0,
    createdAt: Date.now(),
  });
  commit();
}

function toggleTodo(id) {
  const todo = todos.find((t) => t.id === id);
  if (!todo) return;
  todo.done = !todo.done;
  commit();
}

function deleteTodo(id) {
  todos = todos.filter((t) => t.id !== id);
  commit();
}

function commit() {
  store.save(todos);
  render();
}

function selectDate(date) {
  selectedDate = date;
  viewMonth = new Date(date.getFullYear(), date.getMonth(), 1);
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

function renderCalendar() {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  $calTitle.textContent = `${year}년 ${month + 1}월`;

  // 날짜별 [전체, 완료] 개수
  const counts = {};
  for (const t of todos) {
    const c = (counts[t.date] ||= [0, 0]);
    c[0]++;
    if (t.done) c[1]++;
  }

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
    const [total, done] = counts[key] || [0, 0];

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal-day';
    if (date.getDay() === 0) cell.classList.add('sun');
    if (date.getDay() === 6) cell.classList.add('sat');
    if (date.getMonth() !== month) cell.classList.add('other');
    if (key === todayKey) cell.classList.add('today');
    if (key === selectedKey) cell.classList.add('selected');

    const num = document.createElement('span');
    num.className = 'cal-num';
    num.textContent = date.getDate();

    const mark = document.createElement('span');
    mark.className = 'cal-mark';
    if (total && done === total) {
      mark.classList.add('all-done');
      mark.innerHTML = CHECK_MARK;
    } else if (total) {
      mark.classList.add('left');
      mark.textContent = total - done;
    }

    let label = `${date.getMonth() + 1}월 ${date.getDate()}일`;
    if (total) label += `, 할 일 ${total}개 중 ${done}개 완료`;
    cell.setAttribute('aria-label', label);
    if (key === selectedKey) cell.setAttribute('aria-pressed', 'true');

    cell.append(num, mark);
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

  const doneCount = dayTodos.filter((t) => t.done).length;
  const total = dayTodos.length;
  $progressFill.style.width = total ? `${(doneCount / total) * 100}%` : '0';
  $progressText.textContent = total ? `${doneCount} / ${total} 완료` : '할 일 없음';

  $list.replaceChildren(...dayTodos.map(renderItem));
  $empty.hidden = total > 0;
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

// ===== 시작 =====
$form.addEventListener('submit', (e) => {
  e.preventDefault();
  const title = $input.value.trim();
  if (!title) return;
  addTodo(title);
  $input.value = '';
  $input.focus();
});

document.getElementById('cal-prev').addEventListener('click', () => moveMonth(-1));
document.getElementById('cal-next').addEventListener('click', () => moveMonth(1));
document.getElementById('cal-today').addEventListener('click', () => selectDate(new Date()));

render();
