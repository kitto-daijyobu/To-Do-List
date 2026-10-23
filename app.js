import {
  isConfigured,
  watchAuth,
  login,
  logout,
  useAccount,
  subscribe,
  seedIfEmpty,
  remote,
  social,
} from './cloud.js';
import { PUSH } from './push-config.js';
import { THEMES, findTheme, resolveTheme, darkQuery } from './themes.js';

// 지금 테마 (index.html 맨 위에서 먼저 입혀 둔 값)
// themeChoice = 고른 것('auto' 포함), theme = 지금 실제로 입은 테마
let themeChoice = 'base';
try { themeChoice = findTheme(localStorage.getItem('mytodo.theme')).id; } catch { /* 괜찮아요 */ }
let theme = resolveTheme(themeChoice);
document.documentElement.dataset.theme = theme.id;

// ===== 부드러운 창(시트) =====
// 폰: 아래에서 스르륵 올라오고, 손잡이를 아래로 쓸거나 바깥을 누르면 스르륵 내려가요
// 컴퓨터: 가운데에 부드럽게 떠오르고 사라져요
// (앱 곳곳의 dialog.close()가 모두 내려가는 애니메이션을 거치도록, close를 한 번 감싸 둬요)
const SHEET_CLOSE_MS = 220;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const nativeClose = HTMLDialogElement.prototype.close;
const nativeShowModal = HTMLDialogElement.prototype.showModal;

HTMLDialogElement.prototype.close = function close(...args) {
  if (!this.open || !this.classList.contains('sheet') || reduceMotion.matches) {
    nativeClose.apply(this, args);
    return;
  }
  if (this._closeTimer) return; // 이미 내려가는 중
  this.classList.add('closing');
  this._closeTimer = setTimeout(() => {
    this._closeTimer = null;
    this.classList.remove('closing');
    this.style.removeProperty('transform');
    nativeClose.apply(this, args);
  }, SHEET_CLOSE_MS);
};

HTMLDialogElement.prototype.showModal = function showModal(...args) {
  // 내려가는 도중에 다시 열면, 내려가기를 취소하고 그대로 둬요
  if (this._closeTimer) {
    clearTimeout(this._closeTimer);
    this._closeTimer = null;
    this.classList.remove('closing');
    this.style.removeProperty('transform');
    return;
  }
  this.style.removeProperty('transform');
  nativeShowModal.apply(this, args);
};

// 모든 시트에 손잡이를 달고, 손잡이·제목 줄을 잡고 아래로 쓸면 닫혀요
function setupSheet(sheet) {
  const grabber = Object.assign(document.createElement('div'), { className: 'grabber' });
  grabber.setAttribute('aria-hidden', 'true');
  sheet.prepend(grabber);
  // Esc 키로 닫을 때도 애니메이션
  sheet.addEventListener('cancel', (e) => {
    e.preventDefault();
    sheet.close();
  });

  sheet.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || !matchMedia('(max-width: 600px)').matches) return;
    const zone = e.target.closest('.grabber, .sheet-head');
    if (!zone || e.target.closest('button, input, select, textarea')) return;
    const startY = e.clientY;
    const startTime = performance.now();
    let dy = 0;
    sheet.style.transition = 'none';
    const move = (ev) => {
      dy = Math.max(0, ev.clientY - startY);
      sheet.style.transform = `translateY(${dy}px)`;
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      sheet.style.transition = '';
      const fast = dy / Math.max(1, performance.now() - startTime) > 0.6;
      if (dy > 90 || (fast && dy > 30)) {
        sheet.close();
      } else {
        sheet.style.transform = '';
      }
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  });
}

document.querySelectorAll('dialog.sheet').forEach(setupSheet);

// 창 열기 (이미 열려 있으면 그대로, 내려가는 중이면 다시 올려요)
function openSheet(dialog) {
  if (!dialog.open || dialog._closeTimer) dialog.showModal();
}

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

// 배경과 너무 비슷한(연한) 색인지: 이런 색은 카테고리 이름표 바탕을 조금 더 진하게 해요
// (밝기 대비가 1.9보다 작으면. 지금 배경에서는 연파랑·민트·연두·살구·노랑)
function luminance(hexColor) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hexColor.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function blendsWithBackground(hexColor) {
  const bg = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#f4f7fb';
  if (!/^#[0-9a-f]{6}$/i.test(bg)) return false;
  const a = luminance(hexColor);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) < 1.9;
}

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
const CHECK_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="${CHECK_PATH}"/></svg>`;
const PLUS_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>';
const MORE_ICON = '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12.5" cy="8" r="1.4"/></svg>';
const GRIP_ICON = '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="6" cy="4" r="1.2"/><circle cx="10" cy="4" r="1.2"/><circle cx="6" cy="8" r="1.2"/><circle cx="10" cy="8" r="1.2"/><circle cx="6" cy="12" r="1.2"/><circle cx="10" cy="12" r="1.2"/></svg>';
const EYE_ICON = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 10S5.5 4.5 10 4.5 17.5 10 17.5 10 14.5 15.5 10 15.5 2.5 10 2.5 10z"/><circle cx="10" cy="10" r="2.5"/></svg>';
const EYE_OFF_ICON = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l12 12M8.2 5a7 7 0 0 1 1.8-.3C14.5 4.7 17.5 10 17.5 10a13 13 0 0 1-2.2 2.8M12 14.9a6.5 6.5 0 0 1-2 .4C5.5 15.3 2.5 10 2.5 10a13 13 0 0 1 2.6-3.1"/></svg>';
const PEOPLE_ICON = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="7" r="2.8"/><path d="M2.5 16c.6-2.8 2.6-4.3 5-4.3s4.4 1.5 5 4.3M13 4.5a2.6 2.6 0 0 1 0 5M14.5 12c1.6.4 2.6 1.7 3 4"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>';

function findCategory(id) {
  return categories.find((c) => c.id === id);
}

// ===== 친구에게 보이는지 =====
// 할 일마다 shared(친구에게 보임) 표시를 저장해 두고, 보안 규칙이 shared인 것만 친구에게 보여 줘요
function categoryHidden(id) {
  return findCategory(id)?.hidden === true;
}

function isShared(todo) {
  return !todo.hideFromFriends && !categoryHidden(todo.categoryId);
}

// 테마 전용 색 목록이 있는 테마(말차 등)에서 이 카테고리의 색 묶음 { dot, bg, fg, box, on }
// 테마에서 따로 고른 색이 없으면 카테고리 순서대로 자동으로 입혀요
function themeEntry(cat) {
  if (!theme.palette || !cat) return null;
  const chosen = cat.themeColors?.[theme.id];
  const picked = theme.palette.find((p) => p.dot === chosen);
  if (picked) return picked;
  const index = Math.max(0, categories.indexOf(cat));
  return theme.palette[index % theme.palette.length];
}

function categoryColor(id) {
  const cat = findCategory(id);
  const entry = themeEntry(cat);
  if (entry) return entry.dot;
  return safeColor(cat ? cat.color : UNCATEGORIZED_COLOR);
}

// 카테고리 색을 화면 요소에 입히기 (이름표 바탕·글자, 체크칸 색까지)
function paintCategory(element, cat) {
  const entry = themeEntry(cat);
  const color = entry ? entry.dot : safeColor(cat?.color || UNCATEGORIZED_COLOR);
  element.style.setProperty('--cat', color);
  if (entry) {
    element.style.setProperty('--cat-soft', entry.bg);
    element.style.setProperty('--cat-ink', entry.fg);
    element.style.setProperty('--cat-box', entry.box || entry.dot);
    element.style.setProperty('--cat-on', entry.on || '#fff');
  } else if (blendsWithBackground(color)) {
    element.classList.add('soft-color');
  }
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
  const typing = document.activeElement?.matches?.('.add-input, .cat-name, .edit-input, .react-input');
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
  if ($routineDialog.open && routineView === 'list') renderRoutineList();
  if ($templateDialog.open) renderTemplates();
  if ($reactDialog.open && !pickerOpen) renderReactions();
}

// 보관함에 없고 지우지 않은(날짜에 놓인) 할 일만
function activeTodos() {
  return todos.filter((t) => !t.archived && !t.deleted);
}

// ===== 루틴 (반복 할 일) =====
// 루틴은 해당하는 날마다 '가상 할 일'로 나타나요.
// 체크·수정·이동처럼 손을 대는 순간 그날 것만 진짜 할 일로 만들어져요 (routineId + routineDate로 연결)
let routines = [];

function daysBetween(aKey, bKey) {
  const a = parseDateKey(aKey);
  const b = parseDateKey(bKey);
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
}

function routineMatches(r, key) {
  if (!r.start || key < r.start || (r.end && key > r.end)) return false;
  const date = parseDateKey(key);
  const { type, days = [], dates = [], every = 1 } = r.repeat || {};
  if (type === 'daily') return true;
  if (type === 'weekly') return days.includes(date.getDay());
  if (type === 'monthly') return dates.includes(date.getDate());
  if (type === 'interval') return daysBetween(r.start, key) % Math.max(1, every) === 0;
  return false;
}

function describeRoutine(r) {
  const { type, days = [], dates = [], every = 1 } = r.repeat;
  const rule = {
    daily: '매일',
    weekly: `매주 ${[...days].sort().map((d) => WEEKDAYS[d]).join('·')}`,
    monthly: `매달 ${[...dates].sort((a, b) => a - b).join('·')}일`,
    interval: `${every}일마다`,
  }[type];
  const short = (key) => { const d = parseDateKey(key); return `${d.getMonth() + 1}월 ${d.getDate()}일`; };
  return `${rule} · ${short(r.start)}부터${r.end ? ` ${short(r.end)}까지` : ''}`;
}

// 그날 나타나야 하는데 아직 진짜 할 일로 안 만들어진 루틴들
function virtualTodosFor(key) {
  const taken = new Set(todos.filter((t) => t.routineId && t.routineDate === key).map((t) => t.routineId));
  return routines
    .filter((r) => !taken.has(r.id) && routineMatches(r, key))
    .map((r) => ({
      id: `v:${r.id}:${key}`,
      virtual: true,
      routineId: r.id,
      routineDate: key,
      title: r.title,
      date: key,
      categoryId: r.categoryId,
      done: false,
      doneAt: null,
      order: 100000 + (r.order ?? 0),
    }));
}

// id로 진짜 할 일을 찾아요. 가상 할 일이면 그 자리에서 진짜로 만들어요
function realize(id) {
  if (!id.startsWith('v:')) return todos.find((t) => t.id === id);
  if (viewing) return null; // 친구 것은 만들 수 없어요
  const [, routineId, key] = id.split(':');
  const existing = todos.find((t) => t.routineId === routineId && t.routineDate === key);
  if (existing) return existing;
  const r = routines.find((x) => x.id === routineId);
  if (!r) return null;
  const todo = {
    id: newId(),
    title: r.title,
    date: key,
    categoryId: r.categoryId,
    done: false,
    doneAt: null,
    archived: false,
    archivedAt: null,
    deleted: false,
    routineId,
    routineDate: key,
    shared: !categoryHidden(r.categoryId),
    order: nextOrder(key),
    createdAt: Date.now(),
  };
  todos.push(todo);
  save(remote.addTodo(todo));
  return todo;
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
    shared: !categoryHidden(categoryId),
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

let justChecked = null; // 방금 체크한 할 일 (그것만 '톡' 효과)

function toggleTodo(id) {
  if (viewing) return; // 친구 할 일은 보기만 해요
  const todo = realize(id);
  if (!todo) return;
  justChecked = todo.done ? null : todo.id;
  setTimeout(() => { justChecked = null; }, 400);
  todo.done = !todo.done;
  todo.doneAt = todo.done ? Date.now() : null;
  save(remote.updateTodo(id, { done: todo.done, doneAt: todo.doneAt }));
  if (todo.done) notifyDone(todo);
  render();
}

// 묻지 않고 바로 지워요. 대신 알림의 '되돌리기'로 살릴 수 있어요
// (루틴에서 나온 할 일은 지우면 그날 루틴이 다시 생기지 않게 '지움' 표시만 해 둬요)
function deleteTodos(ids) {
  const removed = todos.filter((t) => ids.includes(t.id));
  for (const t of removed) {
    if (t.routineId) {
      t.deleted = true;
      save(remote.updateTodo(t.id, { deleted: true }));
    } else {
      save(remote.deleteTodo(t.id));
    }
  }
  todos = todos.filter((t) => t.routineId || !ids.includes(t.id));
  return {
    label: '되돌리기',
    run() {
      for (const t of removed) {
        if (t.routineId) {
          t.deleted = false;
          save(remote.updateTodo(t.id, { deleted: false }));
          continue;
        }
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
    hideFromFriends: !!todo.hideFromFriends,
    shared: isShared(todo),
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
  return [...activeTodos().filter((t) => t.date === key), ...virtualTodosFor(key)]
    .sort((a, b) => a.order - b.order);
}

// 미완료 할 일을 전부 다음 날로
function postponeUndone() {
  const undone = dayTodosOf(selectedDate).filter((t) => !t.done);
  if (!undone.length) return;
  const nextDay = toDateKey(addDays(selectedDate, 1));
  for (const t of undone) moveTodo(realize(t.id), nextDay);
  render();
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
  return [...selectedIds].map(realize).filter(Boolean);
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
  const cat = { id: newId(), name: '새 카테고리', color, order, hidden: false };
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

// 카테고리를 친구에게 숨기거나 보이기 → 그 카테고리의 할 일·루틴도 같이 바뀌어요
function setCategoryHidden(id, hidden) {
  const cat = findCategory(id);
  if (!cat) return;
  cat.hidden = hidden;
  save(remote.updateCategory(id, { hidden }));
  const todoChanges = [];
  for (const t of todos) {
    if (t.categoryId !== id) continue;
    const shared = isShared(t);
    if (t.shared !== shared) {
      t.shared = shared;
      todoChanges.push([t.id, { shared }]);
    }
  }
  const routineChanges = routines
    .filter((r) => r.categoryId === id && r.shared !== !hidden)
    .map((r) => { r.shared = !hidden; return [r.id, { shared: !hidden }]; });
  if (todoChanges.length) save(remote.updateTodos(todoChanges));
  if (routineChanges.length) save(remote.updateRoutines(routineChanges));
  renderCategoryList();
}

// 색 바꾸기: 전용 색 목록이 있는 테마에서는 그 테마 색으로만 따로 기억해요
// (그래서 기본 테마로 돌아오면 원래 고른 색이 그대로 나와요)
function recolorCategory(id, color) {
  const cat = findCategory(id);
  if (!cat) return;
  pickingColorFor = null;
  if (theme.palette) {
    cat.themeColors = { ...(cat.themeColors || {}), [theme.id]: color };
    save(remote.updateCategory(id, { themeColors: cat.themeColors }));
  } else {
    cat.color = color;
    save(remote.updateCategory(id, { color }));
  }
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
  renderPlanner();
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

// 잎 4개 색을 네 귀퉁이에 깔고 흐리게 번지게 한 뒤 클로버 모양으로 잘라요
// → 이웃한 잎끼리 색이 그라데이션으로 섞여요
let cloverSeq = 0;
const LEAF_QUADRANTS = [[-20, -20], [20, -20], [20, 20], [-20, 20]];

function cloverSvg(leafColors) {
  const shape = LEAF_CENTERS.map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="10.5"/>`).join('');
  if (!leafColors) {
    return `<svg viewBox="0 0 40 40" aria-hidden="true"><g fill="var(--clover-empty)">${shape}</g></svg>`;
  }
  const id = `clv${++cloverSeq}`;
  const patches = LEAF_QUADRANTS.map(([x, y], i) =>
    `<rect x="${x}" y="${y}" width="40" height="40" fill="${leafColors[i]}"/>`).join('');
  return `<svg viewBox="0 0 40 40" aria-hidden="true"><defs>` +
    `<clipPath id="${id}c">${shape}</clipPath>` +
    `<filter id="${id}f" filterUnits="userSpaceOnUse" x="-20" y="-20" width="80" height="80"><feGaussianBlur stdDeviation="5"/></filter>` +
    `</defs><g clip-path="url(#${id}c)" opacity="0.9"><g filter="url(#${id}f)">${patches}</g></g></svg>`;
}

// ===== 🌙 우주 테마: 달 =====
// f = 위상 (0 삭 → 0.25 상현 → 0.5 보름 → 0.75 하현 → 1 다시 삭)
// 밝은 쪽 = 반원 + 반타원(가로 반지름 = r·|cos 2πf|)
function moonLitPath(f, cx, cy, r) {
  const rx = (r * Math.abs(Math.cos(2 * Math.PI * f))).toFixed(2);
  const waxing = f < 0.5;
  const crescent = f < 0.25 || f > 0.75;
  const outer = waxing ? 1 : 0;
  const inner = waxing ? (crescent ? 0 : 1) : (crescent ? 1 : 0);
  return `M${cx} ${cy - r}A${r} ${r} 0 0 ${outer} ${cx} ${cy + r}A${rx} ${r} 0 0 ${inner} ${cx} ${cy - r}Z`;
}

// 달력 마크: 그날 끝낸 비율만큼 차오르는 달 (다 끝내면 빛나는 보름달)
function moonMarkSvg(total, done) {
  const disk = '<circle cx="20" cy="20" r="15" class="moon-dark"/>';
  if (!total || !done) return `<svg viewBox="0 0 40 40" aria-hidden="true">${disk}</svg>`;
  if (done === total) return '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="15" class="moon-full"/></svg>';
  const f = 0.5 * (done / total);
  return `<svg viewBox="0 0 40 40" aria-hidden="true">${disk}<path d="${moonLitPath(f, 20, 20, 15)}" class="moon-lit"/></svg>`;
}

// 실제 달 위상: 기준 삭(신월) 2000-01-06 18:14 UTC, 삭망월 29.530588853일
const NEW_MOON_2000 = Date.UTC(2000, 0, 6, 18, 14);
const SYNODIC_DAYS = 29.530588853;
const PHASE_NAMES = ['NEW MOON', 'WAXING CRESCENT', 'FIRST QUARTER', 'WAXING GIBBOUS', 'FULL MOON', 'WANING GIBBOUS', 'LAST QUARTER', 'WANING CRESCENT'];

function moonPhaseOf(date) {
  const noon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const days = (noon - NEW_MOON_2000) / 86400000;
  return (((days / SYNODIC_DAYS) % 1) + 1) % 1;
}

function renderSpaceMoon() {
  const box = document.getElementById('space-moon');
  if (theme.id !== 'space') { box.replaceChildren(); return; }
  const f = moonPhaseOf(selectedDate);
  const name = PHASE_NAMES[Math.round(f * 8) % 8];
  // 북두칠성 (국자 4개 + 손잡이 3개)
  // 북두칠성 (시안 그대로: 손잡이 3개 → 국자 4개)
  const stars = [[2, 6, 1.5], [14, 4, 1.5], [25, 8, 1.6], [35, 13, 1.3], [55, 15, 1.9], [52, 28, 1.8], [37, 25, 1.5]];
  box.innerHTML =
    `<svg class="dipper" width="62" height="34" viewBox="0 0 62 34">` +
    `<polyline points="2,6 14,4 25,8 35,13 55,15 52,28 37,25 35,13"/>` +
    stars.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('') +
    `</svg>` +
    `<svg class="moon" viewBox="0 0 66 66"><circle cx="33" cy="33" r="31" class="moon-dark"/>` +
    `<path d="${moonLitPath(f, 33, 33, 31)}" class="moon-lit"/></svg>` +
    `<span class="moon-name">${name}</span>`;
}

// ===== 🍥 위시코어: 나루토마끼 달력 마크 =====
// (시안 그대로) 32각 톱니 테두리 + 안쪽 원 2겹, 다 끝낸 날은 분홍 소용돌이
const scallop = (c, rOut, rIn) => Array.from({ length: 32 }, (_, i) => {
  const a = (i / 32) * 2 * Math.PI;
  const r = i % 2 ? rIn : rOut;
  return `${(c + r * Math.cos(a)).toFixed(2)},${(c + r * Math.sin(a)).toFixed(2)}`;
}).join(' ');
// 소용돌이 선 (시안의 spiral 함수와 같아요)
function spiralPath(cx, cy, a, b, turns) {
  let d = '';
  for (let th = 0; th <= turns * 2 * Math.PI; th += 0.25) {
    const r = a + b * th;
    d += (d ? 'L' : 'M') + (cx + r * Math.cos(th)).toFixed(1) + ' ' + (cy + r * Math.sin(th)).toFixed(1);
  }
  return d;
}
const NARUTO_RIM = scallop(15, 15, 13.2);
const NARUTO_IN = scallop(15, 13, 11.44);
const NARUTO_SWIRL = spiralPath(15, 15, 0.6, 0.82, 1.6);
const narutoSeen = new Map(); // 날짜 → 지난번에 다 끝낸 상태였는지 (방금 완료한 날 찾기용)
const narutoPopAt = new Map(); // 날짜 → 완료 모션을 시작한 시각

function narutoSvg(total, done) {
  const state = !total ? 'empty' : done === total ? 'full' : 'part';
  const swirl = state === 'full' ? `<path d="${NARUTO_SWIRL}" class="naruto-swirl" pathLength="1"/>` : '';
  return `<svg viewBox="0 0 30 30" aria-hidden="true"><polygon points="${NARUTO_RIM}" class="naruto-rim-${state}"/>` +
    `<polygon points="${NARUTO_IN}" class="naruto-${state}"/>${swirl}</svg>`;
}

// ===== 🎀 위시코어 꾸밈 (처음 한 번만 만들어 두고, 위시코어일 때만 보여요) =====
const STAR_PTS = '50,0 63,34 98,36 70,58 80,94 50,74 20,94 30,58 2,36 37,34';
const WISH_ICONS = {
  home: `<svg class="icon-wish" viewBox="0 0 40 32" aria-hidden="true"><g transform="translate(2 3)" fill="#e3f0fb" stroke="#5b9ae0" stroke-width="1.8" stroke-linejoin="round"><path d="M3 13l11-9 11 9v12H3z"/><path d="M11 25v-6h6v6" fill="#fff"/></g><path transform="translate(22 3)" d="M1.5 5C5 1.5 13 1.5 16.5 5.5c-1.6 0-2.6.8-2.6 2-1.5-.4-2.8.4-2.8 1.8-1.4-.4-2.6.4-2.6 1.7C4.5 11 1.6 8.6 1.5 5z" fill="#fff" stroke="#8ec1ec" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
  planner: `<svg class="icon-wish" viewBox="0 0 32 32" aria-hidden="true"><path d="${spiralPath(16, 16, 1, 1.05, 1.9)}" fill="none" stroke="#9cc98a" stroke-width="2.6" stroke-linecap="round"/></svg>`,
  timer: `<svg class="icon-wish" viewBox="0 0 30 30" aria-hidden="true"><defs><filter id="wish-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="0.9"/></filter></defs><ellipse cx="15" cy="16" rx="13" ry="12" fill="#f37a6c" filter="url(#wish-soft)"/><polygon transform="translate(9 0) scale(.12)" points="${STAR_PTS}" fill="#6aa05a"/></svg>`,
  me: `<svg class="icon-wish" viewBox="0 0 38 32" aria-hidden="true"><g fill="none" stroke-linecap="round"><path d="M5 21v-5a11 11 0 0 1 22 0v5" stroke="#8ec1ec" stroke-width="2.4"/><rect x="3" y="18" width="6" height="11" rx="3" fill="#f6a9c3" stroke="#f28cb1" stroke-width="1.5"/><rect x="23" y="18" width="6" height="11" rx="3" fill="#f6a9c3" stroke="#f28cb1" stroke-width="1.5"/></g><text x="29" y="10" font-size="10" fill="#f28cb1">♪</text></svg>`,
  bell: `<svg class="icon-wish" viewBox="0 0 28 28" aria-hidden="true"><g fill="#fff" stroke="#5b88b8" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><rect x="3" y="8" width="22" height="15" rx="3.5"/><path d="M4.5 10l9.5 7 9.5-7" fill="none"/></g><path d="M14 4.4c-1-1.6-3.6-.9-3.2 1 .3 1.3 3.2 3.1 3.2 3.1s2.9-1.8 3.2-3.1c.4-1.9-2.2-2.6-3.2-1z" fill="#f6a9c3" stroke="#f28cb1" stroke-width="1.2"/></svg>`,
  friends: `<svg class="icon-wish" viewBox="0 0 30 28" aria-hidden="true"><g stroke="#5b88b8" stroke-width="1.8" stroke-linejoin="round"><path d="M13.5 17a6 5.2 0 0 0 12 0V9l-2.8 2.2a7 6 0 0 0-6.4 0L13.5 9z" fill="#e3f0fb"/><path d="M2.5 19a7 6 0 0 0 14 0V10l-3.2 2.6a8 7 0 0 0-7.6 0L2.5 10z" fill="#fff"/></g><circle cx="7" cy="18" r="1" fill="#5b88b8"/><circle cx="12" cy="18" r="1" fill="#5b88b8"/><circle cx="5.5" cy="20.5" r="1.2" fill="#f6a9c3"/><circle cx="13.5" cy="20.5" r="1.2" fill="#f6a9c3"/></svg>`,
};

// 배경 스티커: 뿌연 딸기 · 토마토 · 별 몇 개만
const sticker = (x, y, w, rot, svg, extra = '') =>
  `<span class="wd ${extra}" style="left:${x};top:${y};width:${w}px;transform:rotate(${rot}deg)">${svg}</span>`;
const WD = {
  berry: `<svg viewBox="0 0 40 46"><path d="M20 12c10-4 18 2 17 11-1 10-9 19-17 21C12 42 4 33 3 23 2 14 10 8 20 12z" fill="#f7b6cc"/><g fill="#fff" opacity=".9"><circle cx="12" cy="22" r="1.1"/><circle cx="20" cy="20" r="1.1"/><circle cx="28" cy="22" r="1.1"/><circle cx="15" cy="29" r="1.1"/><circle cx="24" cy="29" r="1.1"/><circle cx="20" cy="36" r="1.1"/><circle cx="10" cy="30" r="1"/><circle cx="30" cy="30" r="1"/></g><path d="M20 13l-7-4 6 0-1-6 4 5 4-5-1 6 6 0z" fill="#9ed3bf"/></svg>`,
  tomato: `<svg viewBox="0 0 30 30"><ellipse cx="15" cy="16" rx="13" ry="12" fill="#f58a7d"/><polygon transform="translate(9 0) scale(.12)" points="${STAR_PTS}" fill="#7bb26a"/></svg>`,
  star: (c) => `<svg viewBox="0 0 100 100"><polygon points="${STAR_PTS}" fill="${c}"/></svg>`,
};

function setupWishDecor() {
  const tabs = { home: 'home', planner: 'planner', timer: 'timer', me: 'me' };
  for (const [tab, key] of Object.entries(tabs)) {
    document.querySelector(`.tab[data-tab="${tab}"]`)?.insertAdjacentHTML('afterbegin', WISH_ICONS[key]);
  }
  document.getElementById('open-notices')?.insertAdjacentHTML('afterbegin', WISH_ICONS.bell);
  document.getElementById('toggle-friends')?.insertAdjacentHTML('afterbegin', WISH_ICONS.friends);

  // 프로필 사진: 헤일로 + 양쪽 날개 (깃털 3장씩)
  document.getElementById('home-photo')?.insertAdjacentHTML('beforebegin',
    '<span class="wish-angel" aria-hidden="true"><span class="wing l"><i></i><i></i><i></i></span><span class="wing r"><i></i><i></i><i></i></span><span class="halo"></span></span>');

  // 배경 스티커: 가장자리에 줄 세우지 않고 화면 곳곳에 뿌옇게
  const layer = document.createElement('div');
  layer.className = 'wish-deco';
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = [
    sticker('62%', '11%', 66, 12, WD.berry, 'dreamy'),
    sticker('18%', '7%', 24, -8, WD.star('#b9d7f0'), 'soft'),
    sticker('-6%', '38%', 74, -10, WD.tomato, 'dreamy'),
    sticker('80%', '33%', 20, 14, WD.star('#f8c4d6'), 'soft'),
    sticker('42%', '52%', 16, 0, WD.star('#dfe9b8'), 'soft'),
    sticker('74%', '60%', 56, -14, WD.berry, 'dreamy'),
    sticker('10%', '71%', 28, 10, WD.star('#cfe4f6'), 'soft'),
    sticker('44%', '80%', 50, 8, WD.tomato, 'dreamy'),
    sticker('88%', '86%', 22, -6, WD.star('#f8c4d6'), 'soft'),
    sticker('2%', '90%', 42, 20, WD.berry, 'dreamy'),
  ].join('');
  document.body.prepend(layer);
}
setupWishDecor();

function renderCalendar() {
  renderSpaceMoon();
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  $calTitle.textContent = `${year}년 ${month + 1}월`;


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
    const dayTodos = dayTodosOf(date); // 루틴으로 생기는 할 일도 포함
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

    // 달력 마크는 모든 날에 나와요
    const checkSvg = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="${CHECK_PATH}"/></svg>`;
    const clover = document.createElement('span');
    if (theme.mark === 'clover') {
      // 기본: 끝낸 카테고리 색으로 잎이 물드는 클로버, 할 일이 없는 날은 빈 회색 클로버
      clover.className = 'clover';
      const leafColors = total ? cloverLeafColors(dayTodos) : null;
      if (!leafColors) clover.classList.add('empty');
      let inner = '';
      if (total && done === total) inner = checkSvg.replace('<svg', '<svg class="clover-check"');
      else if (total) inner = `<span class="clover-count">${total - done}</span>`;
      clover.innerHTML = cloverSvg(leafColors) + inner;
    } else if (theme.mark === 'naruto') {
      // 위시코어: 나루토마끼 (남은 개수, 다 끝내면 분홍 소용돌이)
      const full = total > 0 && done === total;
      // 방금 막 다 끝낸 날만 소용돌이가 그려지는 모션
      // (달력이 연달아 다시 그려져도 모션이 끊기지 않게, 시작 시각을 기억해 이어서 재생)
      if (full && narutoSeen.get(key) === false) narutoPopAt.set(key, Date.now());
      narutoSeen.set(key, full);
      const popAge = full ? Date.now() - (narutoPopAt.get(key) || 0) : Infinity;
      clover.className = 'naruto-mark' + (popAge < 1100 ? ' pop' : '');
      if (popAge < 1100) clover.style.setProperty('--pop-delay', `-${popAge}ms`);
      clover.innerHTML = narutoSvg(total, done) + (total && done < total ? `<span>${total - done}</span>` : '');
    } else if (theme.mark === 'moon') {
      // 우주: 끝낸 만큼 차오르는 달 (숫자 없음)
      clover.className = 'moon-mark' + (total && done === total ? ' full' : '');
      clover.innerHTML = moonMarkSvg(total, done);
    } else {
      // 다른 테마: 빈 날 / 진행 중(남은 개수) / 다 끝냄(✓)
      clover.className = 'mark' + (total && done === total ? ' full' : total ? ' part' : '');
      clover.dataset.left = String(Math.min(total - done, 4)); // 아이폰: 남은 일이 많을수록 진한 파랑
      if (total && done === total) clover.innerHTML = checkSvg;
      else if (total) clover.textContent = total - done;
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

  $dayLabel.textContent = ''; // '오늘/어제/내일' 글씨는 쓰지 않아요 (자리는 테마 장식용)
  $dayTitle.textContent = formatTitle(selectedDate);
  renderProgress();

  // 선택하는 중에는 할 일을 새로 추가하지 않아요
  const sections = categories.map((cat) =>
    renderSection(cat, dayTodos.filter((t) => t.categoryId === cat.id), !selecting && !viewing)
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
  // '완료' 글자는 시리얼·우주 테마에서 숨겨요 ("3 / 5")
  if (total) $progressText.replaceChildren(`${doneCount} / ${total}`, el('span', { className: 'progress-done', textContent: ' 완료' }));
  else $progressText.textContent = '할 일 없음';
  $empty.hidden = total > 0;
  $empty.textContent = viewing ? '이 날 공개된 할 일이 없어요.' : '카테고리 이름을 눌러 할 일을 추가해 보세요.';

  const undone = total - doneCount;
  $postpone.hidden = !undone || selecting;
  $postpone.textContent = `미완료 ${undone}개 내일 하기 →`;
}

function renderSection(cat, items, canAdd) {
  const section = document.createElement('section');
  section.className = 'cat-section';
  paintCategory(section, cat.id ? findCategory(cat.id) : null);
  if (cat.id) section.dataset.catId = cat.id; // 끌어서 옮길 때 어느 카테고리인지 알려고

  const head = document.createElement(canAdd ? 'button' : 'div');
  head.className = 'cat-head';
  const dot = document.createElement('span');
  dot.className = 'cat-dot';
  const name = document.createElement('span');
  name.className = 'cat-title';
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
  li.className = 'todo-item' + (todo.done ? ' done' : '') + (todo.id === justChecked ? ' pop' : '');

  const check = document.createElement('button');
  check.className = 'check';
  check.type = 'button';
  check.innerHTML = CHECK_ICON;
  check.setAttribute('aria-label', todo.done ? '완료 취소' : '완료');
  check.addEventListener('click', () => toggleTodo(todo.id));
  check.disabled = !!viewing;

  // 할 일 이름을 누르면 메뉴가 열려요 (투두메이트처럼)
  const title = document.createElement('button');
  title.type = 'button';
  title.className = 'todo-title';
  title.textContent = todo.title;
  title.addEventListener('click', () => openTodoSheet(todo.id));
  if (todo.routineId) {
    const mark = document.createElement('span');
    mark.className = 'routine-mark';
    mark.innerHTML = sheetIcon('routine');
    mark.setAttribute('aria-label', '루틴');
    title.append(mark);
  }

  // 이름 아래에 반응 줄 (있을 때만)
  const main = el('div', { className: 'todo-main' }, [title]);
  const line = currentUser ? reactionLine(todo) : null;
  if (line) main.append(line);

  li.append(check, main);
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
  if (viewing || !e.isPrimary || e.button > 0 || e.target.closest('input')) return;
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

  todoDrag = { li, gap, offset: y - box.top, lastY: y, startTop: box.top };
  li.style.transform = 'translateY(0) scale(1.02)';
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
  // top 대신 transform으로 움직여야 휴대폰에서 부드러워요
  const dy = e.clientY - todoDrag.offset - todoDrag.startTop;
  todoDrag.li.style.transform = `translateY(${dy}px) scale(1.02)`;
  placeGap(e.clientY);
  // 화면 위·아래 끝으로 끌면 저절로 스크롤
  if (e.clientY < 70) window.scrollBy(0, -12);
  else if (e.clientY > window.innerHeight - 90) window.scrollBy(0, 12);
}

function endTodoDrag() {
  if (!todoDrag) return;
  const { li, gap, startTop } = todoDrag;
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
  li.style.transition = 'transform 0.15s ease';
  li.style.transform = `translateY(${dest.top - startTop}px)`;
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
      const todo = realize(item.dataset.id);
      if (!todo) continue;
      const fields = {};
      if (todo.order !== order) fields.order = order;
      if (catId && item === li && todo.categoryId !== catId) {
        fields.categoryId = catId;
        fields.shared = isShared({ ...todo, categoryId: catId }); // 숨긴 카테고리로 옮기면 친구에게도 숨겨져요
      }
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
  if (viewing) {
    // 친구 할 일을 누르면 이모지·댓글 창
    const target = dayTodosOf(selectedDate).find((t) => t.id === id);
    if (target) openReactions(target);
    return;
  }
  const todo = realize(id);
  if (!todo) return;
  sheetIds = [todo.id];
  sheetMode = 'menu';
  renderTodoSheet();
  openSheet($todoSheet);
}

// 날짜 고르기부터 바로 열기 (여러 개 이동·복사)
function openDateSheet(ids, mode) {
  sheetIds = ids;
  sheetMode = mode;
  renderTodoSheet();
  openSheet($todoSheet);
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
  // 알림은 '되돌리기'가 있는 경우(삭제)에만 띄워요. 나머지는 조용히 바로 실행
  if (message && action) showToast(message, action);
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
  routine: '<path d="M5 9a5 5 0 0 1 8.5-3.5L15 7M15 4v3h-3M15 11a5 5 0 0 1-8.5 3.5L5 13M5 16v-3h3"/>',
  eye: '<path d="M3 10s2.6-4.5 7-4.5S17 10 17 10s-2.6 4.5-7 4.5S3 10 3 10z"/><circle cx="10" cy="10" r="2"/>',
  eyeOff: '<path d="M3 10s2.6-4.5 7-4.5S17 10 17 10s-2.6 4.5-7 4.5S3 10 3 10z"/><path d="M4.5 15.5l11-11"/>',
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
        sheetButton(todo.routineId ? '루틴 수정하기' : '루틴 등록하기', '', () => {
          closeTodoSheet();
          const routine = routines.find((r) => r.id === todo.routineId);
          openRoutineForm(routine || null, routine ? null : todo);
        }, 'routine'),
        sheetButton('보관함으로 이동', '', () => {
          archiveTodo(todo);
          finishAction('보관함에 넣었어요');
        }, 'archive'),
        hideButton(todo),
      ];

  $todoSheetBody.replaceChildren(tiles, ...items);
}

// 일정 메뉴의 "친구에게 숨기기 / 친구에게 보이기" (누를 때마다 바뀌어요)
function hideButton(todo) {
  if (categoryHidden(todo.categoryId)) {
    const b = sheetButton('친구에게 숨겨짐', '카테고리 전체가 숨겨져 있어요', () => {}, 'eyeOff');
    b.disabled = true;
    return b;
  }
  const hidden = !!todo.hideFromFriends;
  return sheetButton(hidden ? '친구에게 보이기' : '친구에게 숨기기', hidden ? '지금 숨겨져 있어요' : '', () => {
    const fields = { hideFromFriends: !hidden };
    Object.assign(todo, fields);
    fields.shared = isShared(todo);
    todo.shared = fields.shared;
    save(remote.updateTodo(todo.id, fields));
    render();
    renderTodoSheet();
  }, hidden ? 'eye' : 'eyeOff');
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

// ===== 루틴 관리 창 =====
const $routineDialog = document.getElementById('routine-dialog');
const $routineTitle = document.getElementById('routine-title');
const $routineBody = document.getElementById('routine-body');
let routineView = 'list'; // list(목록) / form(만들기·고치기)
let routineDraft = null; // 만들거나 고치는 중인 루틴
let routineFromTodoId = null; // '루틴 등록하기'로 시작했으면 그 할 일
let routineCameFromList = false;
let routinePicking = null; // 'start' / 'end' 미니 달력이 열려 있는 칸

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function openRoutineList() {
  routineView = 'list';
  renderRoutineDialog();
  openSheet($routineDialog);
}

function openRoutineForm(routine, fromTodo = null) {
  routineCameFromList = $routineDialog.open && routineView === 'list';
  const start = fromTodo ? fromTodo.date : toDateKey(selectedDate);
  const startDate = parseDateKey(start);
  routineDraft = routine
    ? JSON.parse(JSON.stringify(routine))
    : {
        id: null,
        title: fromTodo ? fromTodo.title : '',
        categoryId: fromTodo ? fromTodo.categoryId : categories[0]?.id,
        repeat: { type: 'weekly', days: [startDate.getDay()], dates: [startDate.getDate()], every: 2 },
        start,
        end: null,
      };
  routineDraft.repeat.days ||= [startDate.getDay()];
  routineDraft.repeat.dates ||= [startDate.getDate()];
  routineDraft.repeat.every ||= 2;
  routineFromTodoId = fromTodo ? fromTodo.id : null;
  routinePicking = null;
  routineView = 'form';
  renderRoutineDialog();
  openSheet($routineDialog);
}

function renderRoutineDialog() {
  if (routineView === 'list') renderRoutineList();
  else renderRoutineForm();
}

function renderRoutineList() {
  $routineTitle.textContent = '루틴 관리';
  const items = [...routines].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((r) => {
    const button = el('button', { type: 'button', className: 'archive-item' }, [
      el('span', { className: 'cat-dot' }),
      el('span', { className: 'archive-title' }, [
        el('span', { className: 'routine-name', textContent: r.title }),
        el('span', { className: 'routine-rule', textContent: describeRoutine(r) }),
      ]),
    ]);
    button.style.setProperty('--cat', categoryColor(r.categoryId));
    button.addEventListener('click', () => openRoutineForm(r));
    return el('li', {}, [button]);
  });
  const list = el('ul', { className: 'archive-list' }, items);
  const empty = el('p', { className: 'archive-empty', textContent: '아직 루틴이 없어요.' });
  empty.hidden = items.length > 0;
  const add = el('button', { type: 'button', className: 'cat-add', textContent: '+ 새 루틴' });
  add.addEventListener('click', () => openRoutineForm(null));
  $routineBody.replaceChildren(list, empty, add);
}

function renderRoutineForm() {
  const d = routineDraft;
  $routineTitle.textContent = d.id ? '루틴 고치기' : '새 루틴';

  // 이름
  const name = el('input', { type: 'text', className: 'edit-input', maxLength: 200, value: d.title, placeholder: '예: 헬스장 가기' });
  name.setAttribute('aria-label', '루틴 이름');
  name.addEventListener('input', () => { d.title = name.value; });

  // 카테고리
  const cats = el('div', { className: 'chip-row' }, categories.map((c) => {
    const chip = el('button', { type: 'button', className: 'cat-chip' + (c.id === d.categoryId ? ' on' : '') }, [
      el('span', { className: 'cat-dot' }), c.name,
    ]);
    chip.style.setProperty('--cat', categoryColor(c.id));
    chip.addEventListener('click', () => { d.categoryId = c.id; renderRoutineForm(); });
    return chip;
  }));

  // 반복 방식
  const types = [['daily', '매일'], ['weekly', '매주'], ['monthly', '매달'], ['interval', '며칠마다']];
  const seg = el('div', { className: 'segmented' }, types.map(([type, label]) => {
    const b = el('button', { type: 'button', className: 'seg' + (d.repeat.type === type ? ' on' : ''), textContent: label });
    b.addEventListener('click', () => { d.repeat.type = type; renderRoutineForm(); });
    return b;
  }));

  const detail = el('div', { className: 'repeat-detail' });
  if (d.repeat.type === 'weekly') {
    detail.append(el('div', { className: 'chip-row weekdays' }, WEEKDAYS.map((w, i) => {
      const b = el('button', { type: 'button', className: 'day-chip' + (d.repeat.days.includes(i) ? ' on' : ''), textContent: w });
      b.addEventListener('click', () => {
        const set = new Set(d.repeat.days);
        set.has(i) ? set.delete(i) : set.add(i);
        d.repeat.days = [...set];
        renderRoutineForm();
      });
      return b;
    })));
  } else if (d.repeat.type === 'monthly') {
    const grid = el('div', { className: 'month-days' });
    for (let n = 1; n <= 31; n++) {
      const b = el('button', { type: 'button', className: 'day-chip' + (d.repeat.dates.includes(n) ? ' on' : ''), textContent: n });
      b.addEventListener('click', () => {
        const set = new Set(d.repeat.dates);
        set.has(n) ? set.delete(n) : set.add(n);
        d.repeat.dates = [...set];
        renderRoutineForm();
      });
      grid.append(b);
    }
    detail.append(grid, el('p', { className: 'sheet-hint', textContent: '31일처럼 없는 날짜가 있는 달은 그날을 건너뛰어요.' }));
  } else if (d.repeat.type === 'interval') {
    const every = el('input', { type: 'number', className: 'every-input', min: 1, max: 365, value: d.repeat.every, inputMode: 'numeric' });
    every.setAttribute('aria-label', '며칠마다');
    every.addEventListener('input', () => { d.repeat.every = Math.max(1, Math.min(365, parseInt(every.value, 10) || 1)); });
    detail.append(el('label', { className: 'every-row' }, [every, '일마다 (시작일부터 세요)']));
  }

  // 시작일 · 종료일
  const dateRow = (label, field) => {
    const value = d[field];
    const row = el('button', { type: 'button', className: 'date-row' + (routinePicking === field ? ' open' : '') }, [
      el('span', { textContent: label }),
      el('span', { className: 'date-row-value', textContent: value ? formatDateKey(value) : '없음' }),
    ]);
    row.addEventListener('click', () => { routinePicking = routinePicking === field ? null : field; renderRoutineForm(); });
    const parts = [row];
    if (routinePicking === field) {
      parts.push(miniCalendar(value || d.start, (key) => {
        d[field] = key;
        if (d.end && d.end < d.start) d.end = field === 'start' ? null : d.end;
        routinePicking = null;
        renderRoutineForm();
      }));
      if (field === 'end' && d.end) {
        const none = el('button', { type: 'button', className: 'text-button no-end', textContent: '종료일 없애기' });
        none.addEventListener('click', () => { d.end = null; routinePicking = null; renderRoutineForm(); });
        parts.push(none);
      }
    }
    return parts;
  };

  const error = el('p', { className: 'form-error', role: 'alert' });

  // 아래 버튼들
  const buttons = el('div', { className: 'date-form-buttons' });
  if (d.id) {
    const del = el('button', { type: 'button', className: 'text-button danger-text', textContent: '루틴 삭제' });
    del.addEventListener('click', () => deleteRoutine(d.id));
    buttons.append(del);
  }
  const cancel = el('button', { type: 'button', className: 'text-button', textContent: '취소' });
  cancel.addEventListener('click', closeRoutineForm);
  const ok = el('button', { type: 'button', className: 'primary-button', textContent: '저장' });
  ok.addEventListener('click', () => {
    const problem = saveRoutine();
    if (problem) error.textContent = problem;
  });
  buttons.append(cancel, ok);

  $routineBody.replaceChildren(
    el('div', { className: 'routine-form' }, [
      name,
      el('p', { className: 'field-label', textContent: '카테고리' }), cats,
      el('p', { className: 'field-label', textContent: '반복' }), seg, detail,
      ...dateRow('시작일', 'start'),
      ...dateRow('종료일', 'end'),
      error,
      buttons,
    ])
  );
}

function closeRoutineForm() {
  if (routineCameFromList) openRoutineList();
  else $routineDialog.close();
}

// 저장. 문제가 있으면 그 이유를 돌려줘요
function saveRoutine() {
  const d = routineDraft;
  const title = d.title.trim();
  if (!title) return '루틴 이름을 적어 주세요.';
  if (!d.categoryId) return '카테고리를 골라 주세요.';
  if (d.repeat.type === 'weekly' && !d.repeat.days.length) return '요일을 하나 이상 골라 주세요.';
  if (d.repeat.type === 'monthly' && !d.repeat.dates.length) return '날짜를 하나 이상 골라 주세요.';
  if (d.end && d.end < d.start) return '종료일은 시작일보다 뒤여야 해요.';

  const routine = {
    id: d.id || newId(),
    title,
    categoryId: d.categoryId,
    repeat: { type: d.repeat.type, days: d.repeat.days, dates: d.repeat.dates, every: d.repeat.every },
    shared: !categoryHidden(d.categoryId),
    start: d.start,
    end: d.end || null,
    order: d.order ?? routines.length,
    createdAt: d.createdAt || Date.now(),
  };
  const index = routines.findIndex((r) => r.id === routine.id);
  if (index >= 0) routines[index] = routine;
  else routines.push(routine);
  save(remote.saveRoutine(routine));

  // '루틴 등록하기'로 만든 거면, 원래 할 일을 그날의 루틴으로 연결해요 (같은 날 두 개 생기지 않게)
  const source = routineFromTodoId && todos.find((t) => t.id === routineFromTodoId);
  if (source && !source.routineId && routineMatches(routine, source.date)) {
    Object.assign(source, { routineId: routine.id, routineDate: source.date });
    save(remote.updateTodo(source.id, { routineId: routine.id, routineDate: source.date }));
  }

  render();
  closeRoutineForm();
  return null;
}

function deleteRoutine(id) {
  const routine = routines.find((r) => r.id === id);
  if (!routine) return;
  routines = routines.filter((r) => r.id !== id);
  save(remote.deleteRoutine(id));
  render();
  closeRoutineForm();
  showToast(`'${routine.title}' 루틴을 지웠어요`, {
    label: '되돌리기',
    run() {
      if (routines.some((r) => r.id === id)) return;
      routines.push(routine);
      save(remote.saveRoutine(routine));
      render();
      if ($routineDialog.open && routineView === 'list') renderRoutineList();
    },
  });
}

// ===== 플래너 (시간대별 블록) =====
// 블록: { id, date, start:'08:00', end:'09:20', title, categoryId(없으면 휴식), items:[{ id, text, done, todoId? }] }
// todoId가 있는 세부 할 일은 홈의 할 일과 연결돼서, 줄 그으면 홈에서도 체크돼요
let blocks = [];
let plannerTemplates = [];
let plannerDate = new Date();
let blockDraft = null;
let blockLinking = false; // '홈 할 일에서 불러오기' 목록이 열려 있는지

const $plDate = document.getElementById('pl-date');
const $plCal = document.getElementById('pl-cal');
const $plList = document.getElementById('pl-list');
const $plEmpty = document.getElementById('pl-empty');
const $plAdd = document.getElementById('pl-add');
const $blockDialog = document.getElementById('block-dialog');
const $blockTitle = document.getElementById('block-title');
const $blockBody = document.getElementById('block-body');
const $templateDialog = document.getElementById('template-dialog');
const $templateBody = document.getElementById('template-body');

const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMin = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const showTime = (t) => { const [h, m] = t.split(':').map(Number); return `${h}:${String(m).padStart(2, '0')}`; };

// 2h 30m 처럼 (공책에 쓰시던 모양)
function durationText(start, end) {
  const d = toMin(end) - toMin(start);
  const h = Math.floor(d / 60);
  const m = d % 60;
  return [h && `${h}h`, m && `${m}m`].filter(Boolean).join(' ');
}

function blocksOf(key) {
  return blocks.filter((b) => b.date === key).sort((a, b) => toMin(a.start) - toMin(b.start) || toMin(a.end) - toMin(b.end));
}

// 연결된 홈 할 일이 있으면 그 이름과 체크 상태를 따라가요
function itemState(item) {
  if (item.todoId) {
    const todo = todos.find((t) => t.id === item.todoId && !t.deleted);
    if (todo) return { text: todo.title, done: todo.done, linked: true };
  }
  return { text: item.text, done: item.done, linked: false };
}

function toggleItem(block, itemId) {
  const item = block.items.find((i) => i.id === itemId);
  if (!item) return;
  if (itemState(item).linked) {
    toggleTodo(item.todoId);
  } else {
    item.done = !item.done;
    save(remote.saveBlock(block));
  }
  renderPlanner();
}

function renderPlanner() {
  const key = toDateKey(plannerDate);
  const now = new Date();
  const isToday = key === toDateKey(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  $plDate.textContent = formatTitle(plannerDate);
  $plDate.classList.toggle('is-today', isToday); // 오늘이면 날짜 뒤에 반투명 타원 배경
  $plDate.setAttribute('aria-label', formatTitle(plannerDate) + (isToday ? ', 오늘' : '') + ', 달력 열기');

  const list = blocksOf(key);
  $plList.replaceChildren(...list.map((b) => renderBlock(b, isToday && toMin(b.start) <= nowMin && nowMin < toMin(b.end))));
  $plEmpty.hidden = list.length > 0;
  $plAdd.textContent = list.length ? `+ 일정 추가 (${showTime(list[list.length - 1].end)}부터)` : '+ 일정 추가';
  if (!$plCal.hidden) renderPlannerCalendar();
}

function renderBlock(b, isNow) {
  const cat = b.categoryId && findCategory(b.categoryId);
  const card = el('div', { className: 'blk' + (cat ? '' : ' rest') + (isNow ? ' now' : '') });
  if (cat) card.style.setProperty('--cat', categoryColor(cat.id));

  const time = el('div', { className: 'blk-time' }, [
    el('span', { className: 'blk-start', textContent: showTime(b.start) }),
    el('span', { className: 'blk-end', textContent: `~ ${showTime(b.end)}` }),
    el('span', { className: 'blk-dur', textContent: durationText(b.start, b.end) }),
  ]);

  const head = el('div', { className: 'blk-title' }, [
    cat ? el('span', { className: 'cat-dot' }) : '',
    el('span', { textContent: b.title || (cat ? cat.name : '휴식') }),
  ]);
  if (isNow) head.append(el('span', { className: 'now-badge', textContent: '지금' }));

  const body = el('div', { className: 'blk-body' }, [head]);
  if (b.items.length) {
    body.append(el('div', { className: 'blk-items' }, b.items.map((item) => {
      const { text, done, linked } = itemState(item);
      const chip = el('button', { type: 'button', className: 'blk-item' + (done ? ' done' : '') + (linked ? ' linked' : ''), textContent: text });
      chip.setAttribute('aria-pressed', String(done));
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleItem(b, item.id);
      });
      return chip;
    })));
  }

  card.append(time, body);
  card.addEventListener('click', () => openBlockForm(b));
  return card;
}

function renderPlannerCalendar() {
  $plCal.replaceChildren(miniCalendar(toDateKey(plannerDate), (key) => {
    plannerDate = parseDateKey(key);
    setPlannerCalendar(false);
    renderPlanner();
  }));
}

function setPlannerCalendar(open) {
  $plCal.hidden = !open;
  $plDate.setAttribute('aria-expanded', String(open));
  if (open) renderPlannerCalendar();
}

// ----- 일정 만들기·고치기 -----
function openBlockForm(block) {
  const key = toDateKey(plannerDate);
  if (block) {
    blockDraft = JSON.parse(JSON.stringify(block));
  } else {
    const list = blocksOf(key);
    const start = Math.min(list.length ? toMin(list[list.length - 1].end) : 8 * 60, 23 * 60 + 30);
    blockDraft = {
      id: null,
      date: key,
      start: fromMin(start),
      end: fromMin(Math.min(start + 30, 24 * 60)),
      title: '',
      categoryId: categories[0]?.id ?? null,
      items: [],
    };
  }
  blockLinking = false;
  renderBlockForm();
  openSheet($blockDialog);
}

// 시·분 고르기 (5분 단위). 끝 시간은 24:00까지
function timePicker(value, maxHour, onChange) {
  const [h, m] = value.split(':').map(Number);
  const hour = el('select', { className: 'time-select' });
  for (let i = 0; i <= maxHour; i++) hour.append(el('option', { value: i, textContent: `${i}시`, selected: i === h }));
  const minute = el('select', { className: 'time-select' });
  for (let i = 0; i < 60; i += 5) minute.append(el('option', { value: i, textContent: `${String(i).padStart(2, '0')}분`, selected: i === m }));
  if (h === 24) minute.disabled = true;
  const change = () => {
    const hh = Number(hour.value);
    const mm = hh === 24 ? 0 : Number(minute.value);
    onChange(fromMin(hh * 60 + mm));
  };
  hour.addEventListener('change', change);
  minute.addEventListener('change', change);
  hour.setAttribute('aria-label', '시');
  minute.setAttribute('aria-label', '분');
  return el('span', { className: 'time-pick' }, [hour, minute]);
}

function renderBlockForm() {
  const d = blockDraft;
  $blockTitle.textContent = d.id ? '일정 고치기' : '일정 추가';

  const dur = el('span', { className: 'time-dur' });
  const updateDur = () => {
    dur.textContent = toMin(d.end) > toMin(d.start) ? durationText(d.start, d.end) : '끝 시간을 확인해 주세요';
  };
  updateDur();
  const times = el('div', { className: 'time-row' }, [
    timePicker(d.start, 23, (v) => {
      // 시작을 옮기면 길이는 그대로 두고 끝도 같이 옮겨요
      const length = toMin(d.end) - toMin(d.start);
      d.start = v;
      if (length > 0) d.end = fromMin(Math.min(toMin(v) + length, 24 * 60));
      renderBlockForm();
    }),
    el('span', { className: 'time-sep', textContent: '~' }),
    timePicker(d.end, 24, (v) => { d.end = v; renderBlockForm(); }),
  ]);

  const title = el('input', { type: 'text', className: 'edit-input', maxLength: 100, value: d.title, placeholder: '예: 컴이활 / 아침 준비' });
  title.setAttribute('aria-label', '일정 이름');
  title.addEventListener('input', () => { d.title = title.value; });

  const cats = el('div', { className: 'chip-row' }, [
    ...categories.map((c) => {
      const chip = el('button', { type: 'button', className: 'cat-chip' + (c.id === d.categoryId ? ' on' : '') }, [el('span', { className: 'cat-dot' }), c.name]);
      chip.style.setProperty('--cat', categoryColor(c.id));
      chip.addEventListener('click', () => { d.categoryId = c.id; renderBlockForm(); });
      return chip;
    }),
    (() => {
      const rest = el('button', { type: 'button', className: 'cat-chip' + (!d.categoryId ? ' on' : ''), textContent: '없음 (휴식·식사)' });
      rest.style.setProperty('--cat', UNCATEGORIZED_COLOR);
      rest.addEventListener('click', () => { d.categoryId = null; renderBlockForm(); });
      return rest;
    })(),
  ]);

  // 세부 할 일
  const itemRows = d.items.map((item, index) => {
    const { text, linked } = itemState(item);
    const remove = el('button', { type: 'button', className: 'icon-button', textContent: '×' });
    remove.setAttribute('aria-label', `${text} 빼기`);
    remove.addEventListener('click', () => { d.items.splice(index, 1); renderBlockForm(); });
    return el('li', { className: 'item-row' }, [
      el('span', { className: 'item-text', textContent: text }),
      linked ? el('span', { className: 'item-link', textContent: '홈 할 일' }) : '',
      remove,
    ]);
  });
  const newItem = el('input', { type: 'text', className: 'edit-input', maxLength: 100, placeholder: '세부 할 일 입력 후 엔터' });
  newItem.setAttribute('aria-label', '세부 할 일');
  const addItem = () => {
    const text = newItem.value.trim();
    if (!text) return;
    d.items.push({ id: newId(), text, done: false });
    renderBlockForm();
    $blockBody.querySelector('.item-add .edit-input')?.focus();
  };
  newItem.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      addItem();
    }
  });
  const addButton = el('button', { type: 'button', className: 'text-button', textContent: '추가' });
  addButton.addEventListener('click', addItem);

  const linkToggle = el('button', { type: 'button', className: 'link-toggle', textContent: blockLinking ? '홈 할 일 닫기' : '+ 홈 할 일에서 불러오기' });
  linkToggle.addEventListener('click', () => { blockLinking = !blockLinking; renderBlockForm(); });
  const linkArea = el('div', { className: 'chip-row' });
  if (blockLinking) {
    const used = new Set(d.items.map((i) => i.todoId).filter(Boolean));
    const candidates = dayTodosOf(parseDateKey(d.date)).filter((t) => !used.has(t.id));
    if (!candidates.length) linkArea.append(el('p', { className: 'sheet-hint', textContent: '이 날 불러올 홈 할 일이 없어요.' }));
    for (const t of candidates) {
      const chip = el('button', { type: 'button', className: 'cat-chip' }, [el('span', { className: 'cat-dot' }), t.title]);
      chip.style.setProperty('--cat', categoryColor(t.categoryId));
      chip.addEventListener('click', () => {
        const todo = realize(t.id); // 루틴이면 그날 것을 진짜로 만들어 연결
        if (!todo) return;
        d.items.push({ id: newId(), text: todo.title, done: false, todoId: todo.id });
        renderBlockForm();
      });
      linkArea.append(chip);
    }
  }

  const error = el('p', { className: 'form-error', role: 'alert' });
  const buttons = el('div', { className: 'date-form-buttons' });
  if (d.id) {
    const del = el('button', { type: 'button', className: 'text-button danger-text', textContent: '일정 삭제' });
    del.addEventListener('click', () => deleteBlock(d.id));
    buttons.append(del);
  }
  const cancel = el('button', { type: 'button', className: 'text-button', textContent: '취소' });
  cancel.addEventListener('click', () => $blockDialog.close());
  const ok = el('button', { type: 'button', className: 'primary-button', textContent: '저장' });
  ok.addEventListener('click', () => {
    if (newItem.value.trim()) addItem(); // 입력칸에 적어 둔 것도 같이 저장
    const problem = saveBlock();
    if (problem) error.textContent = problem;
  });
  buttons.append(cancel, ok);

  $blockBody.replaceChildren(el('div', { className: 'routine-form' }, [
    el('p', { className: 'field-label' }, ['시간 ', dur]), times,
    el('p', { className: 'field-label', textContent: '이름' }), title,
    el('p', { className: 'field-label', textContent: '카테고리' }), cats,
    el('p', { className: 'field-label', textContent: '세부 할 일' }),
    el('ul', { className: 'item-list' }, itemRows),
    el('div', { className: 'item-add' }, [newItem, addButton]),
    linkToggle, linkArea,
    error, buttons,
  ]));
}

function saveBlock() {
  const d = blockDraft;
  if (toMin(d.end) <= toMin(d.start)) return '끝 시간은 시작 시간보다 뒤여야 해요.';
  const block = {
    id: d.id || newId(),
    date: d.date,
    start: d.start,
    end: d.end,
    title: d.title.trim(),
    categoryId: d.categoryId || null,
    items: d.items.map(({ id, text, done, todoId }) => (todoId ? { id, text, done: !!done, todoId } : { id, text, done: !!done })),
  };
  const index = blocks.findIndex((b) => b.id === block.id);
  if (index >= 0) blocks[index] = block;
  else blocks.push(block);
  save(remote.saveBlock(block));
  $blockDialog.close();
  renderPlanner();
  return null;
}

function deleteBlock(id) {
  const block = blocks.find((b) => b.id === id);
  if (!block) return;
  blocks = blocks.filter((b) => b.id !== id);
  save(remote.deleteBlock(id));
  $blockDialog.close();
  renderPlanner();
  showToast('일정을 지웠어요', {
    label: '되돌리기',
    run() {
      if (blocks.some((b) => b.id === id)) return;
      blocks.push(block);
      save(remote.saveBlock(block));
      renderPlanner();
    },
  });
}

// ----- 플래너 템플릿 -----
function renderTemplates() {
  const key = toDateKey(plannerDate);
  const rows = plannerTemplates
    .slice()
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .map((t) => {
      const first = t.blocks[0];
      const last = t.blocks[t.blocks.length - 1];
      const summary = first ? `${t.blocks.length}개 시간대 · ${showTime(first.start)}–${showTime(last.end)}` : '비어 있음';
      const apply = el('button', { type: 'button', className: 'archive-item' }, [
        el('span', { className: 'archive-title' }, [
          el('span', { className: 'routine-name', textContent: t.name }),
          el('span', { className: 'routine-rule', textContent: summary }),
        ]),
        el('span', { className: 'archive-from', textContent: '불러오기' }),
      ]);
      apply.addEventListener('click', () => applyTemplate(t));
      const remove = el('button', { type: 'button', className: 'icon-button', textContent: '×' });
      remove.setAttribute('aria-label', `${t.name} 템플릿 지우기`);
      remove.addEventListener('click', () => deleteTemplate(t.id));
      return el('li', { className: 'template-row' }, [apply, remove]);
    });

  const name = el('input', { type: 'text', className: 'edit-input', maxLength: 30, placeholder: '템플릿 이름 (예: 시험 기간 평일)' });
  name.setAttribute('aria-label', '템플릿 이름');
  const error = el('p', { className: 'form-error', role: 'alert' });
  const saveButton = el('button', { type: 'button', className: 'primary-button', textContent: '지금 플래너를 템플릿으로 저장' });
  saveButton.addEventListener('click', () => {
    const list = blocksOf(key);
    if (!list.length) { error.textContent = '이 날 플래너가 비어 있어요.'; return; }
    if (!name.value.trim()) { error.textContent = '템플릿 이름을 적어 주세요.'; return; }
    const template = {
      id: newId(),
      name: name.value.trim(),
      createdAt: Date.now(),
      blocks: list.map((b) => ({ start: b.start, end: b.end, title: b.title, categoryId: b.categoryId || null, items: b.items.map((i) => itemState(i).text) })),
    };
    plannerTemplates.push(template);
    save(remote.saveTemplate(template));
    renderTemplates();
  });

  $templateBody.replaceChildren(
    el('p', { className: 'sheet-hint', textContent: `템플릿을 누르면 ${formatTitle(plannerDate)} 플래너가 그 템플릿으로 바뀌어요.` }),
    el('ul', { className: 'archive-list' }, rows),
    rows.length ? '' : el('p', { className: 'archive-empty', textContent: '저장한 템플릿이 없어요.' }),
    el('div', { className: 'routine-form template-save' }, [name, error, saveButton]),
  );
}

function applyTemplate(template) {
  const key = toDateKey(plannerDate);
  const previous = blocksOf(key);
  for (const b of previous) save(remote.deleteBlock(b.id));
  const created = template.blocks.map((t) => ({
    id: newId(),
    date: key,
    start: t.start,
    end: t.end,
    title: t.title,
    categoryId: t.categoryId,
    items: t.items.map((text) => ({ id: newId(), text, done: false })),
  }));
  for (const b of created) save(remote.saveBlock(b));
  blocks = blocks.filter((b) => b.date !== key).concat(created);
  $templateDialog.close();
  renderPlanner();
  showToast(`'${template.name}' 템플릿을 불러왔어요`, {
    label: '되돌리기',
    run() {
      const swap = new Set([...created, ...previous].map((b) => b.id));
      for (const b of created) save(remote.deleteBlock(b.id));
      for (const b of previous) save(remote.saveBlock(b));
      blocks = blocks.filter((b) => !swap.has(b.id)).concat(previous);
      renderPlanner();
    },
  });
}

function deleteTemplate(id) {
  const template = plannerTemplates.find((t) => t.id === id);
  plannerTemplates = plannerTemplates.filter((t) => t.id !== id);
  save(remote.deleteTemplate(id));
  renderTemplates();
  showToast(`'${template.name}' 템플릿을 지웠어요`, {
    label: '되돌리기',
    run() {
      plannerTemplates.push(template);
      save(remote.saveTemplate(template));
      if ($templateDialog.open) renderTemplates();
    },
  });
}

// ===== 타이머: 뽀모도로 / 공부 시간 측정 =====
// 타이머 상태는 이 기기에만 저장해요 (시작한 시각을 기억해서, 앱을 껐다 켜도 시간이 맞아요)
// 공부한 시간은 '공부 기록'으로 인터넷에 저장돼요: { date, start, end, seconds, categoryId, kind }
const POMO_PRESETS = [[25, 5], [50, 10], [60, 10]];
const TIMER_KEY = 'mytodo.timer';
let studyLogs = [];
let audioCtx = null;
let wakeLock = null;

const $timerTime = document.getElementById('timer-time');
const $timerPhase = document.getElementById('timer-phase');
const $timerSub = document.getElementById('timer-sub');
const $ringBar = document.getElementById('ring-bar');
const $timerMain = document.getElementById('timer-main');
const $timerReset = document.getElementById('timer-reset');
const $timerSkip = document.getElementById('timer-skip');
const RING = 2 * Math.PI * 108;

function defaultTimer() {
  // mode: 지금 재고 있는 것 / view: 보고 있는 화면 (화면을 바꿔도 재던 건 이어져요)
  return { mode: 'pomo', view: 'pomo', preset: 0, phase: 'focus', running: false, startedAt: 0, elapsed: 0, cycles: 0, cyclesDate: '', categoryId: null };
}

function loadTimer() {
  try {
    return { ...defaultTimer(), ...JSON.parse(localStorage.getItem(TIMER_KEY) || '{}') };
  } catch {
    return defaultTimer();
  }
}

let timer = loadTimer();

function saveTimer() {
  try { localStorage.setItem(TIMER_KEY, JSON.stringify(timer)); } catch { /* 저장 못 해도 괜찮아요 */ }
  scheduleTimerPush(); // 끝나는 시각 알림도 다시 맞춰요
}

const timerElapsed = (now = Date.now()) => timer.elapsed + (timer.running ? now - timer.startedAt : 0);
const phaseLength = () => POMO_PRESETS[timer.preset][timer.phase === 'focus' ? 0 : 1] * 60000;
const counting = () => timer.mode === 'watch' || timer.phase === 'focus'; // 공부 시간으로 쌓이는 중인지

function clock(ms, withHours = false) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n) => String(n).padStart(2, '0');
  return withHours || h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

function durationWords(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
}

// 공부한 한 덩어리를 기록해요 (10초 미만은 버려요)
function logRun(start, end) {
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 10 || !currentUser) return;
  const log = { id: newId(), date: toDateKey(new Date(start)), start, end, seconds, categoryId: timer.categoryId || null, kind: timer.mode };
  studyLogs.push(log);
  save(remote.addStudyLog(log));
}

// 끝났을 때 소리 + 진동
function unlockAudio() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
  } catch { /* 소리를 못 내는 기기 */ }
}

function chime() {
  if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 300]);
  if (!audioCtx) return;
  [0, 0.35, 0.7].forEach((delay, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = i === 2 ? 1046 : 880;
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + delay + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + delay + 0.3);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(audioCtx.currentTime + delay);
    osc.stop(audioCtx.currentTime + delay + 0.32);
  });
}

// 도는 동안 화면이 꺼지지 않게
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* 지원하지 않는 기기 */ }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && timer.running) keepAwake(true);
});

function startTimer() {
  unlockAudio();
  timer.running = true;
  timer.startedAt = Date.now();
  saveTimer();
  keepAwake(true);
  renderTimer();
}

function pauseTimer() {
  if (!timer.running) return;
  const now = Date.now();
  if (counting()) logRun(timer.startedAt, now);
  timer.elapsed += now - timer.startedAt;
  timer.running = false;
  saveTimer();
  keepAwake(false);
  renderTimer();
  renderStudy();
}

function resetTimer() {
  pauseTimer();
  timer.elapsed = 0;
  timer.phase = 'focus';
  saveTimer();
  renderTimer();
}

function skipPhase() {
  const wasRunning = timer.running;
  pauseTimer();
  timer.phase = timer.phase === 'focus' ? 'break' : 'focus';
  timer.elapsed = 0;
  saveTimer();
  if (wasRunning && timer.phase === 'break') startTimer();
  else renderTimer();
}

function bumpCycles() {
  const today = toDateKey(new Date());
  if (timer.cyclesDate !== today) {
    timer.cyclesDate = today;
    timer.cycles = 0;
  }
  timer.cycles++;
}

// 0.25초마다: 뽀모도로 시간이 다 됐는지 확인하고 화면을 새로 그려요
function tickTimer() {
  if (timer.mode === 'pomo' && timer.running) {
    const end = timer.startedAt + (phaseLength() - timer.elapsed);
    if (Date.now() >= end) {
      if (timer.phase === 'focus') {
        // 집중 끝 → 기록하고 휴식 자동 시작
        logRun(timer.startedAt, end);
        bumpCycles();
        timer.phase = 'break';
        timer.elapsed = 0;
        timer.startedAt = end;
      } else {
        // 휴식 끝 → 멈춰서 기다려요 (시작을 눌러야 다음 집중)
        timer.phase = 'focus';
        timer.elapsed = 0;
        timer.running = false;
        keepAwake(false);
      }
      chime();
      saveTimer();
      renderTimer();
      renderStudy();
    }
  }
  if (timer.running) {
    document.title = `${$timerTime.textContent} · ${timer.mode === 'pomo' ? (timer.phase === 'focus' ? '집중' : '휴식') : '공부 중'}`;
  } else if (document.title !== '나의 할 일') {
    document.title = '나의 할 일';
  }
  if (document.body.dataset.tab === 'timer' || timer.running) renderTimerFace();
}

// 오늘 총 공부 시간 (기록 + 지금 재고 있는 것). 뽀모도로 집중 시간도 들어가요
function todayStudyMs(now = Date.now()) {
  const todayKey = toDateKey(new Date(now));
  const logged = studyLogs.filter((l) => l.date === todayKey).reduce((s, l) => s + l.seconds * 1000, 0);
  const live = timer.running && counting() ? now - timer.startedAt : 0;
  return logged + live;
}

// 화면(view)은 보기만 바꾸고, 실제로 재고 있는 것(mode)은 그대로 이어져요
function renderTimerFace() {
  const elapsed = timerElapsed();
  const view = timer.view || timer.mode;
  let progress;
  if (view === 'pomo') {
    const pomoActive = timer.mode === 'pomo';
    const len = phaseLength();
    $timerTime.textContent = clock(pomoActive ? len - elapsed : POMO_PRESETS[timer.preset][0] * 60000);
    $timerPhase.textContent = pomoActive && timer.phase === 'break' ? '휴식' : '집중';
    const today = toDateKey(new Date());
    const cycles = timer.cyclesDate === today ? timer.cycles : 0;
    $timerSub.textContent = !pomoActive && timer.running
      ? '공부 시간 재는 중 · 시작하면 이어서 재요'
      : (cycles ? `오늘 🍅 ${cycles}번` : '');
    progress = pomoActive ? Math.min(1, elapsed / len) : 0;
  } else {
    const total = todayStudyMs();
    $timerTime.textContent = clock(total, true);
    if (!timer.running) $timerPhase.textContent = '오늘 공부 시간';
    else if (timer.mode === 'pomo') $timerPhase.textContent = timer.phase === 'focus' ? '🍅 뽀모도로로 재는 중' : '🍅 휴식 중';
    else $timerPhase.textContent = '공부 중';
    $timerSub.textContent = '';
    progress = (total % 3600000) / 3600000; // 한 바퀴 = 1시간
  }
  $ringBar.style.strokeDasharray = `${RING}`;
  $ringBar.style.strokeDashoffset = `${RING * (1 - progress)}`;
  document.getElementById('view-timer').classList.toggle('on-break', timer.mode === 'pomo' && timer.phase === 'break');
}

function renderTimer() {
  const view = timer.view || timer.mode;
  for (const b of document.querySelectorAll('.timer-modes .seg')) b.classList.toggle('on', b.dataset.mode === view);

  // 뽀모도로 시간 고르기
  const presets = document.getElementById('pomo-presets');
  presets.hidden = view !== 'pomo';
  presets.replaceChildren(...POMO_PRESETS.map(([focus, rest], i) => {
    const chip = el('button', { type: 'button', className: 'chip-button' + (timer.preset === i ? ' on' : ''), textContent: `${focus}분 / ${rest}분` });
    chip.addEventListener('click', () => {
      if (timer.preset === i) return;
      // 공부 시간 측정이 돌고 있으면 그대로 두고, 뽀모도로만 새로
      if (timer.mode === 'pomo') {
        pauseTimer();
        timer.phase = 'focus';
        timer.elapsed = 0;
      }
      timer.preset = i;
      saveTimer();
      renderTimer();
    });
    return chip;
  }));

  // 무엇을 공부하나요? (내 카테고리)
  const mine = viewing ? mineSaved.categories : categories;
  const pick = (id) => {
    if (timer.categoryId === id) return;
    // 도는 중에 바꾸면 지금까지는 이전 카테고리로 기록하고 이어서 새로 재요
    if (timer.running && counting()) {
      const now = Date.now();
      logRun(timer.startedAt, now);
      timer.elapsed += now - timer.startedAt;
      timer.startedAt = now;
    }
    timer.categoryId = id;
    saveTimer();
    renderTimer();
    renderStudy();
  };
  const chips = mine.map((c) => {
    const chip = el('button', { type: 'button', className: 'cat-chip' + (timer.categoryId === c.id ? ' on' : '') }, [el('span', { className: 'cat-dot' }), c.name]);
    chip.style.setProperty('--cat', categoryColor(c.id));
    chip.addEventListener('click', () => pick(c.id));
    return chip;
  });
  const none = el('button', { type: 'button', className: 'cat-chip' + (!timer.categoryId ? ' on' : ''), textContent: '선택 안 함' });
  none.style.setProperty('--cat', UNCATEGORIZED_COLOR);
  none.addEventListener('click', () => pick(null));
  document.getElementById('timer-cats').replaceChildren(...chips, none);

  // 버튼: 보고 있는 화면 기준
  if (view === 'pomo') {
    const pomoActive = timer.mode === 'pomo';
    if (pomoActive && timer.running) $timerMain.textContent = '일시정지';
    else if (pomoActive && timer.elapsed) $timerMain.textContent = '계속';
    else $timerMain.textContent = !pomoActive && timer.running ? '뽀모도로로 잇기' : '시작';
    $timerSkip.hidden = !pomoActive;
    $timerReset.textContent = '초기화';
    $timerReset.hidden = !pomoActive;
  } else {
    $timerMain.textContent = timer.running ? '일시정지' : '시작';
    $timerSkip.hidden = true;
    $timerReset.textContent = '그만하기';
    $timerReset.hidden = !timer.running && !(timer.mode === 'watch' && timer.elapsed);
  }
  renderTimerFace();
}

// 큰 버튼: 화면에 맞게 시작·일시정지. 다른 쪽이 돌고 있으면 끊기지 않게 이어서 재요
function onTimerMain() {
  const view = timer.view || timer.mode;
  if (view === 'pomo') {
    if (timer.mode === 'pomo') {
      if (timer.running) pauseTimer();
      else startTimer();
      return;
    }
    // 공부 시간 측정 → 뽀모도로로 이어서
    pauseTimer();
    Object.assign(timer, { mode: 'pomo', phase: 'focus', elapsed: 0 });
    startTimer();
    return;
  }
  if (timer.running) {
    pauseTimer();
    return;
  }
  // 공부 시간 측정 시작 (멈춰 있던 뽀모도로가 있으면 접어요)
  Object.assign(timer, { mode: 'watch', phase: 'focus', elapsed: 0 });
  startTimer();
}

// 작은 왼쪽 버튼: 뽀모도로 화면은 초기화, 공부 시간 화면은 그만하기(지금까지 기록하고 멈춤)
function onTimerReset() {
  const view = timer.view || timer.mode;
  if (view === 'pomo') {
    if (timer.mode === 'pomo') resetTimer();
    return;
  }
  pauseTimer();
  Object.assign(timer, { mode: 'watch', phase: 'focus', elapsed: 0 });
  saveTimer();
  renderTimer();
}

// 오늘 공부 시간 · 카테고리별 · 최근 7일
function renderStudy() {
  const now = Date.now();
  const live = timer.running && counting() ? { date: toDateKey(new Date(timer.startedAt)), seconds: Math.round((now - timer.startedAt) / 1000), categoryId: timer.categoryId } : null;
  const all = live ? [...studyLogs, live] : studyLogs;
  const todayKey = toDateKey(new Date());
  const today = all.filter((l) => l.date === todayKey);
  document.getElementById('study-today').textContent = durationWords(today.reduce((s, l) => s + l.seconds, 0));

  const mine = viewing ? mineSaved.categories : categories;
  const byCat = new Map();
  for (const l of today) byCat.set(l.categoryId || '', (byCat.get(l.categoryId || '') || 0) + l.seconds);
  const max = Math.max(1, ...byCat.values());
  document.getElementById('study-by-cat').replaceChildren(...[...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([id, sec]) => {
    const cat = mine.find((c) => c.id === id);
    const row = el('li', { className: 'study-row' }, [
      el('span', { className: 'study-name', textContent: cat ? cat.name : '선택 안 함' }),
      el('span', { className: 'study-bar' }, [el('span', { className: 'study-fill' })]),
      el('span', { className: 'study-sec', textContent: durationWords(sec) }),
    ]);
    row.style.setProperty('--cat', cat ? categoryColor(cat.id) : UNCATEGORIZED_COLOR);
    row.querySelector('.study-fill').style.width = `${(sec / max) * 100}%`;
    return row;
  }));

  const days = Array.from({ length: 7 }, (_, i) => addDays(new Date(), i - 6));
  const totals = days.map((d) => all.filter((l) => l.date === toDateKey(d)).reduce((s, l) => s + l.seconds, 0));
  const weekMax = Math.max(1, ...totals);
  document.getElementById('study-week').replaceChildren(...days.map((d, i) => {
    const bar = el('span', { className: 'week-bar' + (i === 6 ? ' today' : '') });
    bar.style.height = `${Math.max(totals[i] ? 6 : 2, (totals[i] / weekMax) * 100)}%`;
    const col = el('div', { className: 'week-col' }, [
      el('span', { className: 'week-val', textContent: totals[i] ? durationWords(totals[i]).replace('시간 ', 'h').replace('시간', 'h').replace('분', 'm') : '' }),
      el('span', { className: 'week-track' }, [bar]),
      el('span', { className: 'week-day', textContent: i === 6 ? '오늘' : WEEKDAYS[d.getDay()] }),
    ]);
    col.setAttribute('aria-label', `${formatTitle(d)} ${durationWords(totals[i])}`);
    return col;
  }));
}

for (const b of document.querySelectorAll('.timer-modes .seg')) {
  b.addEventListener('click', () => {
    // 화면만 바꿔요. 재고 있던 건 멈추지 않아요
    timer.view = b.dataset.mode;
    saveTimer();
    renderTimer();
  });
}
$timerMain.addEventListener('click', onTimerMain);
$timerReset.addEventListener('click', onTimerReset);
$timerSkip.addEventListener('click', skipPhase);

let studyTick = 0;
setInterval(() => {
  tickTimer();
  // 1초마다 오늘 공부 시간도 새로
  if (++studyTick % 4 === 0 && document.body.dataset.tab === 'timer' && timer.running) renderStudy();
}, 250);

// ===== 보관함 =====
function renderArchive() {
  const items = todos
    .filter((t) => t.archived && !t.deleted)
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
    li.style.setProperty('--cat', categoryColor(cat.id));

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

    // 눈 버튼: 이 카테고리를 친구에게 숨기기
    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'icon-button cat-eye' + (cat.hidden ? ' off' : '');
    eye.innerHTML = cat.hidden ? EYE_OFF_ICON : EYE_ICON;
    eye.setAttribute('aria-label', cat.hidden ? `${cat.name}: 친구에게 숨김 (눌러서 보이기)` : `${cat.name}: 친구에게 보임 (눌러서 숨기기)`);
    eye.title = cat.hidden ? '친구에게 숨김' : '친구에게 보임';
    eye.addEventListener('click', () => setCategoryHidden(cat.id, !cat.hidden));

    line.append(handle, swatch, name, eye, del);
    li.append(line);

    if (pickingColorFor === cat.id) {
      const palette = document.createElement('div');
      palette.className = 'palette';
      // 테마 전용 색 목록이 있으면 그것만 (말차 = 연두 계열 등)
      const choices = theme.palette ? theme.palette.map((p) => ({ color: p.dot, name: p.name })) : PALETTE.map((color) => ({ color, name: '' }));
      const current = categoryColor(cat.id);
      for (const { color, name: colorName } of choices) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'palette-chip' + (color === current ? ' current' : '');
        chip.style.background = color;
        chip.setAttribute('aria-label', colorName ? `${colorName}으로` : '이 색으로');
        if (colorName) chip.title = colorName;
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
document.getElementById('open-routines').addEventListener('click', openRoutineList);

// 플래너
const movePlanner = (n) => {
  plannerDate = addDays(plannerDate, n);
  renderPlanner();
};
document.getElementById('pl-prev').addEventListener('click', () => movePlanner(-1));
document.getElementById('pl-next').addEventListener('click', () => movePlanner(1));
$plDate.addEventListener('click', () => setPlannerCalendar($plCal.hidden));
$plAdd.addEventListener('click', () => openBlockForm(null));
document.getElementById('pl-templates').addEventListener('click', () => {
  renderTemplates();
  $templateDialog.showModal();
});
document.getElementById('block-close').addEventListener('click', () => $blockDialog.close());
document.getElementById('template-close').addEventListener('click', () => $templateDialog.close());
for (const dialog of [$blockDialog, $templateDialog]) {
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}
// '지금' 표시가 시간에 맞게 바뀌도록 1분마다 다시 그려요
setInterval(() => {
  if (document.body.dataset.tab === 'planner' && document.body.dataset.screen === 'app') renderPlanner();
}, 60 * 1000);
document.getElementById('routine-close').addEventListener('click', () => $routineDialog.close());
$routineDialog.addEventListener('click', (e) => {
  if (e.target === $routineDialog) $routineDialog.close();
});
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
  if (name === 'timer') {
    renderTimer();
    renderStudy();
  }
  if (name === 'me') renderPushState();
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
// ===== 프로필 =====
// { nickname, bio, photo(작게 줄인 사진), photoSource: 'custom'(직접 올림) / 'google' / 'none' }
let currentUser = null;
let profile = null;
let profileDraft = null;
const $profileDialog = document.getElementById('profile-dialog');
const $profileBody = document.getElementById('profile-body');

// 화면에 보일 값 (설정 안 한 건 구글 계정 정보로)
function profileView(p = profile || {}) {
  const source = p.photoSource || 'google';
  let photo = null;
  if (source === 'custom' && p.photo) photo = p.photo;
  else if (source === 'google' && currentUser?.photoURL) photo = currentUser.photoURL;
  return {
    nickname: p.nickname || currentUser?.displayName || '이름 없음',
    bio: p.bio || '',
    photo,
  };
}

function fillAvatar(box, view) {
  box.replaceChildren();
  if (view.photo) {
    box.append(el('img', { src: view.photo, alt: '', referrerPolicy: 'no-referrer' }));
  } else {
    box.textContent = view.nickname.slice(0, 1);
  }
}

function renderProfile() {
  if (!currentUser) return;
  const view = profileView();
  document.getElementById('profile-name').textContent = view.nickname;
  const $bio = document.getElementById('profile-bio');
  $bio.textContent = view.bio;
  $bio.hidden = !view.bio;
  document.getElementById('profile-email').textContent = currentUser.email || '';
  fillAvatar(document.getElementById('profile-photo'), view);
  if (!viewing) renderHomeProfile();
  renderFriendStrip();
}

// 올린 사진을 가운데 정사각형으로 잘라 256×256으로 줄여요 (약 20~40KB)
async function shrinkPhoto(file) {
  const size = 256;
  let source;
  try {
    source = await createImageBitmap(file);
  } catch {
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  const w = source.width;
  const h = source.height;
  const side = Math.min(w, h);
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
  canvas.getContext('2d').drawImage(source, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', 0.85);
}

function openProfileForm() {
  const p = profile || {};
  profileDraft = {
    nickname: p.nickname || currentUser?.displayName || '',
    bio: p.bio || '',
    photo: p.photo || '',
    photoSource: p.photoSource || 'google',
  };
  renderProfileForm();
  $profileDialog.showModal();
}

function renderProfileForm() {
  const d = profileDraft;
  const preview = el('div', { className: 'profile-photo profile-photo-big' });
  fillAvatar(preview, profileView(d));

  const file = el('input', { type: 'file', accept: 'image/*', hidden: true });
  const error = el('p', { className: 'form-error', role: 'alert' });
  file.addEventListener('change', async () => {
    const picked = file.files[0];
    if (!picked) return;
    try {
      d.photo = await shrinkPhoto(picked);
      d.photoSource = 'custom';
      renderProfileForm();
    } catch {
      error.textContent = '이 사진은 불러올 수 없어요. 다른 사진을 골라 주세요.';
    }
  });
  const upload = el('button', { type: 'button', className: 'chip-button', textContent: '사진 올리기' });
  upload.addEventListener('click', () => file.click());
  const google = el('button', { type: 'button', className: 'chip-button' + (d.photoSource === 'google' ? ' on' : ''), textContent: '구글 사진' });
  google.addEventListener('click', () => { d.photoSource = 'google'; renderProfileForm(); });
  const none = el('button', { type: 'button', className: 'chip-button' + (d.photoSource === 'none' ? ' on' : ''), textContent: '사진 없이' });
  none.addEventListener('click', () => { d.photoSource = 'none'; renderProfileForm(); });

  const nickname = el('input', { type: 'text', className: 'edit-input', maxLength: 20, value: d.nickname, placeholder: '닉네임' });
  nickname.setAttribute('aria-label', '닉네임');
  nickname.addEventListener('input', () => { d.nickname = nickname.value; });

  const count = el('span', { className: 'char-count', textContent: `${d.bio.length}/60` });
  const bio = el('input', { type: 'text', className: 'edit-input', maxLength: 60, value: d.bio, placeholder: '예: 오늘도 한 칸씩 🍀' });
  bio.setAttribute('aria-label', '한 줄 소개');
  bio.addEventListener('input', () => { d.bio = bio.value; count.textContent = `${bio.value.length}/60`; });

  const cancel = el('button', { type: 'button', className: 'text-button', textContent: '취소' });
  cancel.addEventListener('click', () => $profileDialog.close());
  const ok = el('button', { type: 'button', className: 'primary-button', textContent: '저장' });
  ok.addEventListener('click', () => {
    if (!d.nickname.trim()) { error.textContent = '닉네임을 적어 주세요.'; return; }
    profile = {
      nickname: d.nickname.trim(),
      bio: d.bio.trim(),
      photo: d.photoSource === 'custom' ? d.photo : '',
      photoSource: d.photoSource,
      friendCode: profile?.friendCode || null,
      updatedAt: Date.now(),
    };
    save(remote.saveProfile(profile));
    publishProfile();
    renderProfile();
    $profileDialog.close();
  });

  $profileBody.replaceChildren(el('div', { className: 'routine-form' }, [
    el('div', { className: 'profile-edit-photo' }, [preview, el('div', { className: 'chip-row' }, [upload, google, none]), file]),
    el('p', { className: 'field-label', textContent: '닉네임' }), nickname,
    el('p', { className: 'field-label' }, ['한 줄 소개 ', count]), bio,
    error,
    el('div', { className: 'date-form-buttons' }, [cancel, ok]),
  ]));
}

// ===== 친구 =====
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 O·0·I·1은 빼요
let follows = { mine: [], toMe: [] };
const people = new Map(); // 계정 → 공개 프로필
const peopleStops = new Map();
let stopFollows = null;
let socialStarted = false;
let socialBroken = false;
let viewing = null; // 보고 있는 친구 계정 (null이면 나)
let mineSaved = null; // 친구 할 일을 보는 동안 맡아 둔 내 데이터
let stopFriend = null;

const $friendStrip = document.getElementById('friend-strip');
const $friendLists = document.getElementById('friend-lists');
const $followMsg = document.getElementById('follow-msg');

function watchPerson(personUid) {
  if (peopleStops.has(personUid)) return;
  peopleStops.set(personUid, social.watchProfile(personUid, (p) => {
    if (p) people.set(personUid, p);
    renderFriendStrip();
    renderFriendLists();
    if (viewing === personUid) renderHomeProfile();
  }));
}

function personName(personUid) {
  return people.get(personUid)?.nickname || '친구';
}

// 다른 사람이 적어 둔 사진 주소는 믿지 않아요: 앱이 줄인 사진(data:image/jpeg)과 구글 사진만 보여 줘요
function safePhoto(photo) {
  if (typeof photo !== 'string') return null;
  if (photo.startsWith('data:image/jpeg;base64,')) return photo;
  if (/^https:\/\/lh\d\.googleusercontent\.com\//.test(photo)) return photo;
  return null;
}

function personView(personUid) {
  const p = people.get(personUid) || {};
  return {
    nickname: String(p.nickname || '친구').slice(0, 20),
    bio: String(p.bio || '').slice(0, 60),
    photo: safePhoto(p.photo),
  };
}

const followingIds = () => follows.mine.filter((f) => f.status === 'accepted').map((f) => f.to);

// 친구 코드가 없으면 새로 만들어요 (다른 사람과 겹치지 않게 확인)
async function ensureFriendCode() {
  if (profile?.friendCode) return profile.friendCode;
  for (let i = 0; i < 5; i++) {
    const code = Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    if (await social.findByCode(code)) continue;
    profile = { ...(profile || {}), friendCode: code };
    save(remote.saveProfile(profile));
    return code;
  }
  return null;
}

// 친구에게 보이는 공개 프로필을 최신으로
function publishProfile() {
  if (!profile?.friendCode) return;
  const view = profileView();
  social.savePublicProfile({
    nickname: view.nickname.slice(0, 20),
    bio: view.bio.slice(0, 60),
    photo: safePhoto(view.photo) || '',
    friendCode: profile.friendCode,
  })
    .catch(markSocialBroken);
}

function markSocialBroken(err) {
  console.error(err);
  socialBroken = true;
  renderFriendLists();
}

async function startSocial() {
  if (socialStarted) return;
  socialStarted = true;
  try {
    await ensureFriendCode();
  } catch (err) {
    markSocialBroken(err);
    return;
  }
  document.getElementById('my-code').textContent = formatCode(profile.friendCode);
  publishProfile();
  stopFollows = social.watchFollows((state) => {
    follows = state;
    for (const f of [...state.mine, ...state.toMe]) watchPerson(f.from === currentUser.uid ? f.to : f.from);
    // 더는 친구가 아니면 내 화면으로
    if (viewing && !followingIds().includes(viewing)) viewMe();
    renderFriendStrip();
    renderFriendLists();
    const pending = state.toMe.filter((f) => f.status === 'pending').length;
    for (const badge of [document.getElementById('me-badge'), document.getElementById('friends-badge')]) {
      badge.hidden = !pending;
      badge.textContent = pending ? `요청 ${pending}` : '';
    }
    document.getElementById('me-badge').textContent = pending;
  }, markSocialBroken);
}

function stopSocial() {
  if (stopFollows) stopFollows();
  stopFollows = null;
  for (const stop of peopleStops.values()) stop();
  peopleStops.clear();
  people.clear();
  follows = { mine: [], toMe: [] };
  socialStarted = false;
  socialBroken = false;
}

const formatCode = (code) => (code ? `${code.slice(0, 3)}-${code.slice(3)}` : '······');

// ----- 홈 맨 위 -----
function renderHomeProfile() {
  const view = viewing ? personView(viewing) : profileView();
  fillAvatar(document.getElementById('home-photo'), view);
  document.getElementById('home-name').textContent = view.nickname;
  const $bio = document.getElementById('home-bio');
  $bio.textContent = view.bio;
  $bio.hidden = !view.bio;
}

function friendChip(label, view, active, onClick) {
  const avatarBox = el('span', { className: 'profile-photo chip-photo' });
  fillAvatar(avatarBox, view);
  const chip = el('button', { type: 'button', className: 'friend-chip' + (active ? ' on' : '') }, [avatarBox, el('span', { textContent: label })]);
  chip.setAttribute('aria-pressed', String(active));
  chip.addEventListener('click', onClick);
  return chip;
}

function renderFriendStrip() {
  if (!currentUser) return;
  const chips = [friendChip('나', profileView(), !viewing, viewMe)];
  for (const id of followingIds()) {
    chips.push(friendChip(personName(id), personView(id), viewing === id, () => viewFriend(id)));
  }
  const add = el('button', { type: 'button', className: 'friend-chip add', textContent: '+ 친구' });
  add.addEventListener('click', () => {
    showTab('me');
    renderFriendLists();
    $friendsDialog.showModal();
    document.getElementById('follow-code').focus();
  });
  chips.push(add);
  $friendStrip.replaceChildren(...chips);
}

function setFriendsCollapsed(collapsed) {
  $friendStrip.hidden = collapsed;
  const button = document.getElementById('toggle-friends');
  button.setAttribute('aria-expanded', String(!collapsed));
  button.setAttribute('aria-label', collapsed ? '친구 칸 펴기' : '친구 칸 접기');
  try { localStorage.setItem('mytodo.friendsCollapsed', collapsed ? '1' : ''); } catch { /* 저장 못 해도 괜찮아요 */ }
}

// ----- 친구 할 일 보기 (보기 전용) -----
function viewFriend(friendUid) {
  if (viewing === friendUid) return;
  if (selecting) stopSelecting();
  if (!viewing) mineSaved = { todos, categories, routines };
  if (stopFriend) stopFriend();
  viewing = friendUid;
  todos = [];
  categories = [];
  routines = [];
  addingCategoryId = null;
  document.body.classList.add('viewing-friend');
  render();
  renderHomeProfile();
  renderFriendStrip();
  stopFriend = social.watchFriend(friendUid, {
    onTodos: (list) => { if (viewing === friendUid) { todos = list; scheduleRender(); } },
    onCategories: (list) => { if (viewing === friendUid) { categories = list; scheduleRender(); } },
    onRoutines: (list) => { if (viewing === friendUid) { routines = list; scheduleRender(); } },
  }, (err) => {
    console.error(err);
    viewMe();
  });
  watchFriendReactions(friendUid);
}

function viewMe() {
  if (!viewing) return;
  if (stopFriend) stopFriend();
  stopFriend = null;
  stopWatchingFriendReactions();
  if ($reactDialog.open) $reactDialog.close();
  viewing = null;
  ({ todos, categories, routines } = mineSaved);
  mineSaved = null;
  document.body.classList.remove('viewing-friend');
  render();
  renderHomeProfile();
  renderFriendStrip();
}

// ----- 개인정보 탭의 친구 목록 -----
function personRow(personUid, ...buttons) {
  const avatarBox = el('span', { className: 'profile-photo chip-photo' });
  fillAvatar(avatarBox, personView(personUid));
  return el('li', { className: 'person-row' }, [avatarBox, el('span', { className: 'person-name', textContent: personName(personUid) }), ...buttons]);
}

function smallButton(label, onClick, extra = '') {
  const b = el('button', { type: 'button', className: `chip-button ${extra}`.trim(), textContent: label });
  b.addEventListener('click', onClick);
  return b;
}

function renderFriendLists() {
  if (!currentUser) return;
  if (socialBroken) {
    $friendLists.replaceChildren(el('p', { className: 'form-error', textContent: '친구 기능을 쓰려면 Firebase 보안 규칙을 새것으로 바꿔 주세요.' }));
    return;
  }
  const me = currentUser.uid;
  const requests = follows.toMe.filter((f) => f.status === 'pending');
  const followers = follows.toMe.filter((f) => f.status === 'accepted');
  const followingSet = new Set(follows.mine.map((f) => f.to));

  const section = (title, rows, emptyText) => [
    el('p', { className: 'field-label', textContent: `${title} ${rows.length ? rows.length : ''}`.trim() }),
    rows.length ? el('ul', { className: 'person-list' }, rows) : el('p', { className: 'sheet-hint', textContent: emptyText }),
  ];

  $friendLists.replaceChildren(
    ...(requests.length ? section('받은 요청', requests.map((f) => personRow(f.from,
      smallButton('수락', () => save(social.acceptFollow(f.from)), 'on'),
      smallButton('거절', () => save(social.removeFollow(f.from, me))),
    )), '') : []),
    ...section('내가 보는 친구', follows.mine.map((f) => personRow(f.to,
      el('span', { className: 'person-state', textContent: f.status === 'accepted' ? '' : '수락 기다리는 중' }),
      smallButton(f.status === 'accepted' ? '끊기' : '취소', () => save(social.removeFollow(me, f.to))),
    )), '친구 코드로 팔로우 요청을 보내 보세요.'),
    ...section('나를 보는 친구', followers.map((f) => personRow(f.from,
      ...(followingSet.has(f.from) ? [] : [smallButton('맞팔로우', () => save(social.requestFollow(f.from)), 'on')]),
      smallButton('삭제', () => save(social.removeFollow(f.from, me))),
    )), '아직 없어요.'),
  );
}

document.getElementById('follow-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('follow-code');
  const code = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  $followMsg.className = 'follow-msg';
  const say = (text, bad = true) => {
    $followMsg.textContent = text;
    $followMsg.classList.toggle('bad', bad);
  };
  if (code.length !== 6) return say('친구 코드는 6자리예요.');
  if (code === profile?.friendCode) return say('내 코드예요. 친구의 코드를 넣어 주세요.');
  try {
    const person = await social.findByCode(code);
    if (!person) return say('그 코드의 친구를 찾지 못했어요.');
    if (follows.mine.some((f) => f.to === person.uid)) return say(`이미 ${person.nickname}님에게 요청했어요.`);
    await social.requestFollow(person.uid);
    input.value = '';
    say(`${person.nickname}님에게 요청을 보냈어요. 수락하면 할 일을 볼 수 있어요.`, false);
  } catch (err) {
    markSocialBroken(err);
    say('요청을 보내지 못했어요.');
  }
});

document.getElementById('copy-code').addEventListener('click', async (e) => {
  if (!profile?.friendCode) return;
  try {
    await navigator.clipboard.writeText(profile.friendCode);
    e.target.textContent = '복사됨';
    setTimeout(() => { e.target.textContent = '복사'; }, 1500);
  } catch { /* 복사가 안 되는 브라우저면 코드를 보고 직접 알려 주면 돼요 */ }
});

// 개인정보 → 친구 창
const $friendsDialog = document.getElementById('friends-dialog');
document.getElementById('open-friends').addEventListener('click', () => {
  renderFriendLists();
  $friendsDialog.showModal();
});
document.getElementById('friends-close').addEventListener('click', () => $friendsDialog.close());
$friendsDialog.addEventListener('click', (e) => {
  if (e.target === $friendsDialog) $friendsDialog.close();
});

document.getElementById('toggle-friends').addEventListener('click', () => setFriendsCollapsed(!$friendStrip.hidden));
try { setFriendsCollapsed(localStorage.getItem('mytodo.friendsCollapsed') === '1'); } catch { setFriendsCollapsed(false); }

// 예전에 만든 할 일·카테고리·루틴에 '친구에게 보이는지' 표시를 채워 넣어요 (한 번만)
let sharingMigrated = false;
function migrateSharing() {
  if (sharingMigrated || viewing) return;
  sharingMigrated = true;
  for (const c of categories) {
    if (typeof c.hidden === 'boolean') continue;
    c.hidden = false;
    save(remote.updateCategory(c.id, { hidden: false }));
  }
  const todoChanges = todos.filter((t) => typeof t.shared !== 'boolean').map((t) => { t.shared = isShared(t); return [t.id, { shared: t.shared }]; });
  const routineChanges = routines.filter((r) => typeof r.shared !== 'boolean').map((r) => { r.shared = !categoryHidden(r.categoryId); return [r.id, { shared: r.shared }]; });
  if (todoChanges.length) save(remote.updateTodos(todoChanges));
  if (routineChanges.length) save(remote.updateRoutines(routineChanges));
}

// ===== 이모지·댓글 =====
// 반응은 할 일 주인의 reactions 칸에 { targetKey, date, from, emoji 또는 text } 로 저장돼요
// 루틴 할 일은 '루틴+날짜'로 묶어서, 가상 할 일이 진짜가 돼도 반응이 그대로 붙어 있어요
let myReactions = [];
let friendReactions = [];
let stopFriendReactions = null;
let reactTarget = null; // 반응 창이 보여 주는 할 일 { key, title, categoryId, date }
let pickerOpen = false;
let emojiModule = null;

const $reactDialog = document.getElementById('react-dialog');
const $reactTitle = document.getElementById('react-title');
const $reactBody = document.getElementById('react-body');
const $noticeDialog = document.getElementById('notice-dialog');
const $noticeList = document.getElementById('notice-list');
const $noticeEmpty = document.getElementById('notice-empty');
const $noticeBadge = document.getElementById('notice-badge');

const reactionsNow = () => (viewing ? friendReactions : myReactions);
const reactionOwner = () => viewing || currentUser.uid;
const targetKeyOf = (todo) => (todo.routineId ? `r:${todo.routineId}:${todo.routineDate || todo.date}` : todo.id);
const reactionsFor = (key) => reactionsNow().filter((r) => r.targetKey === key).sort((a, b) => a.createdAt - b.createdAt);
const whoName = (personUid) => (personUid === currentUser?.uid ? profileView().nickname : personName(personUid));
const whoView = (personUid) => (personUid === currentUser?.uid ? profileView() : personView(personUid));

function timeAgo(ms) {
  const minutes = Math.floor((Date.now() - ms) / 60000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}시간 전`;
  const d = new Date(ms);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

// 같은 이모지끼리 묶기
function groupEmojis(list) {
  const groups = new Map();
  for (const r of list) {
    if (!r.emoji) continue;
    const g = groups.get(r.emoji) || { emoji: r.emoji, people: [], mine: null };
    g.people.push(r.from);
    if (r.from === currentUser.uid) g.mine = r;
    groups.set(r.emoji, g);
  }
  return [...groups.values()];
}

// 할 일 아래 작은 반응 줄: 투두메이트처럼 친구가 남긴 이모지를 스티커처럼 나란히 (댓글만 있으면 💬)
function reactionLine(todo) {
  const list = reactionsFor(targetKeyOf(todo));
  if (!list.length) return null;
  const shown = list.slice(0, 8);
  const line = el('button', { type: 'button', className: 'react-line' }, [
    ...shown.map((r) => el('span', { className: 'react-sticker', textContent: r.emoji || '💬' })),
    list.length > shown.length ? el('span', { className: 'react-more', textContent: `+${list.length - shown.length}` }) : '',
  ]);
  line.setAttribute('aria-label', '반응 보기');
  line.addEventListener('click', (e) => {
    e.stopPropagation();
    openReactions(todo);
  });
  return line;
}

function openReactions(todo) {
  reactTarget = { key: targetKeyOf(todo), title: todo.title, categoryId: todo.categoryId, date: todo.date };
  pickerOpen = false;
  renderReactions();
  openSheet($reactDialog);
}

function addReaction(fields) {
  const r = { id: newId(), targetKey: reactTarget.key, date: reactTarget.date, from: currentUser.uid, createdAt: Date.now(), ...fields };
  reactionsNow().push(r);
  save(social.addReaction(reactionOwner(), r));
  notifyReaction(reactionOwner(), r, reactTarget.title);
  renderReactions();
  render();
}

function removeReaction(r) {
  const list = reactionsNow();
  const index = list.findIndex((x) => x.id === r.id);
  if (index >= 0) list.splice(index, 1);
  save(social.deleteReaction(reactionOwner(), r.id));
  renderReactions();
  render();
}

// 이모지 고르기 (전체 이모지, 영어로 검색). 처음 열 때 한 번만 받아요
async function makeEmojiPicker() {
  emojiModule ||= import('https://cdn.jsdelivr.net/npm/emoji-picker-element@1.21.3/index.js');
  await emojiModule;
  const picker = document.createElement('emoji-picker');
  picker.dataSource = 'https://cdn.jsdelivr.net/npm/emoji-picker-element-data@1.6.1/en/emojibase/data.json';
  picker.className = 'emoji-picker';
  picker.addEventListener('emoji-click', (e) => {
    pickerOpen = false;
    const emoji = e.detail.unicode;
    const mine = reactionsFor(reactTarget.key).find((r) => r.emoji === emoji && r.from === currentUser.uid);
    if (mine) renderReactions();
    else addReaction({ emoji });
  });
  return picker;
}

function renderReactions() {
  if (!reactTarget) return;
  const me = currentUser.uid;
  const list = reactionsFor(reactTarget.key);
  $reactDialog.style.setProperty('--cat', categoryColor(reactTarget.categoryId));
  $reactTitle.textContent = reactTarget.title;

  // 이모지: 누르면 나도 같이 달기 / 내가 단 건 취소
  const emojiRow = el('div', { className: 'chip-row react-emojis' }, groupEmojis(list).map((g) => {
    const b = el('button', { type: 'button', className: 'react-pill big' + (g.mine ? ' mine' : ''), textContent: `${g.emoji} ${g.people.length}` });
    b.title = g.people.map(whoName).join(', ');
    b.setAttribute('aria-label', `${g.emoji} ${g.people.map(whoName).join(', ')}${g.mine ? ' (눌러서 취소)' : ' (눌러서 나도 달기)'}`);
    b.addEventListener('click', () => (g.mine ? removeReaction(g.mine) : addReaction({ emoji: g.emoji })));
    return b;
  }));
  const pickButton = el('button', { type: 'button', className: 'react-pill big add', textContent: pickerOpen ? '닫기' : '+ 이모지' });
  pickButton.addEventListener('click', () => { pickerOpen = !pickerOpen; renderReactions(); });
  emojiRow.append(pickButton);

  const pickerArea = el('div', { className: 'picker-area' });
  if (pickerOpen) {
    pickerArea.textContent = '이모지 불러오는 중…';
    makeEmojiPicker()
      .then((picker) => { if (pickerOpen) pickerArea.replaceChildren(picker); })
      .catch(() => { pickerArea.textContent = '이모지를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'; });
  }

  // 댓글
  const comments = list.filter((r) => r.text).map((r) => {
    const avatarBox = el('span', { className: 'profile-photo chip-photo' });
    fillAvatar(avatarBox, whoView(r.from));
    const row = el('li', { className: 'comment' }, [
      avatarBox,
      el('div', { className: 'comment-body' }, [
        el('p', { className: 'comment-head' }, [el('b', { textContent: whoName(r.from) }), el('span', { textContent: ` · ${timeAgo(r.createdAt)}` })]),
        el('p', { className: 'comment-text', textContent: r.text }),
      ]),
    ]);
    // 내가 쓴 댓글, 또는 내 할 일에 달린 댓글은 지울 수 있어요
    if (r.from === me || !viewing) {
      const del = el('button', { type: 'button', className: 'icon-button', textContent: '×' });
      del.setAttribute('aria-label', '댓글 지우기');
      del.addEventListener('click', () => removeReaction(r));
      row.append(del);
    }
    return row;
  });

  const input = el('input', { type: 'text', className: 'edit-input react-input', maxLength: 300, placeholder: '댓글 달기' });
  input.setAttribute('aria-label', '댓글');
  const send = el('button', { type: 'button', className: 'primary-button', textContent: '보내기' });
  const submit = () => {
    const text = input.value.trim();
    if (!text) return;
    addReaction({ text });
    $reactBody.querySelector('.react-input')?.focus();
  };
  send.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });

  $reactBody.replaceChildren(
    emojiRow,
    pickerArea,
    el('p', { className: 'field-label', textContent: `댓글 ${comments.length || ''}`.trim() }),
    comments.length ? el('ul', { className: 'comment-list' }, comments) : el('p', { className: 'sheet-hint', textContent: '첫 댓글을 남겨 보세요.' }),
    el('div', { className: 'item-add' }, [input, send]),
  );
}

// ----- 🔔 새 소식: 친구가 내 할 일에 남긴 반응 -----
const SEEN_KEY = 'mytodo.noticesSeen';
function noticesSeenAt() {
  try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; }
}

function myNotices() {
  return myReactions.filter((r) => r.from !== currentUser?.uid).sort((a, b) => b.createdAt - a.createdAt);
}

function updateNoticeBadge() {
  const seen = noticesSeenAt();
  const count = myNotices().filter((r) => r.createdAt > seen).length;
  $noticeBadge.hidden = !count;
  $noticeBadge.textContent = count > 99 ? '99+' : count;
}

// 반응이 달린 내 할 일의 이름 찾기
function myTodoTitle(key) {
  const mine = viewing ? mineSaved : { todos, routines };
  if (key.startsWith('r:')) return mine.routines.find((r) => r.id === key.split(':')[1])?.title || '루틴';
  return mine.todos.find((t) => t.id === key)?.title || '지운 할 일';
}

function openNotices() {
  const seen = noticesSeenAt();
  const items = myNotices().slice(0, 50).map((r) => {
    const avatarBox = el('span', { className: 'profile-photo chip-photo' });
    fillAvatar(avatarBox, whoView(r.from));
    const what = r.emoji ? `${whoName(r.from)}님이 ${r.emoji} 반응했어요` : `${whoName(r.from)}님의 댓글: ${r.text}`;
    const button = el('button', { type: 'button', className: 'archive-item' + (r.createdAt > seen ? ' unread' : '') }, [
      avatarBox,
      el('span', { className: 'archive-title' }, [
        el('span', { className: 'routine-name', textContent: what }),
        el('span', { className: 'routine-rule', textContent: `${myTodoTitle(r.targetKey)} · ${formatDateKey(r.date)} · ${timeAgo(r.createdAt)}` }),
      ]),
    ]);
    button.addEventListener('click', () => {
      $noticeDialog.close();
      viewMe();
      showTab('home');
      selectDate(parseDateKey(r.date));
    });
    return el('li', {}, [button]);
  });
  $noticeList.replaceChildren(...items);
  $noticeEmpty.hidden = items.length > 0;
  $noticeDialog.showModal();
  try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch { /* 괜찮아요 */ }
  updateNoticeBadge();
}

function watchFriendReactions(friendUid) {
  friendReactions = [];
  stopFriendReactions = social.watchReactions(friendUid, (list) => {
    if (viewing !== friendUid) return;
    friendReactions = list;
    list.forEach((r) => { if (r.from !== currentUser.uid) watchPerson(r.from); });
    scheduleRender();
  }, (err) => console.error(err));
}

function stopWatchingFriendReactions() {
  if (stopFriendReactions) stopFriendReactions();
  stopFriendReactions = null;
  friendReactions = [];
}

// ===== 🔔 알림 받기 (무료 알림 서버) =====
// 이 기기의 '알림 주소'를 저장해 두면, 알림 서버가 그 주소로 알림을 보내요
// 보낼 알림은 pushJobs에 적어 두고, 알림 서버가 1분마다(또는 바로) 가져가서 보내요
const $pushState = document.getElementById('push-state');
let pushOn = false;

const pushReady = () => Boolean(PUSH.workerUrl);
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function keyBytes(base64url) {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64 + '==='.slice((b64.length + 3) % 4)), (c) => c.charCodeAt(0));
}

// 알림 주소마다 짧은 이름 (같은 기기가 두 번 저장되지 않게)
async function subId(endpoint) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(hash)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 알림 관련 저장은 실패해도 조용히 (이미 보낸 알림을 지우려다 실패하는 건 괜찮아요)
const quiet = (promise) => promise.catch((err) => console.warn('알림:', err?.code || err));

async function renderPushState() {
  if (!pushReady()) {
    $pushState.textContent = '준비 중';
    return;
  }
  if (!pushSupported()) {
    $pushState.textContent = isIOS() && !isStandalone() ? '홈 화면 앱에서 가능' : '이 기기는 안 돼요';
    return;
  }
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  pushOn = Boolean(sub) && Notification.permission === 'granted';
  $pushState.textContent = pushOn ? '켜짐' : '꺼짐';
  $pushState.classList.toggle('on', pushOn);
}

async function togglePush() {
  if (!pushReady()) {
    showToast('알림 서버를 아직 연결하지 않았어요');
    return;
  }
  if (!pushSupported()) {
    showToast(isIOS() && !isStandalone()
      ? '아이폰은 사파리에서 "홈 화면에 추가"한 앱에서만 알림을 받을 수 있어요'
      : '이 브라우저는 알림을 지원하지 않아요');
    return;
  }
  try {
    if (pushOn) {
      // 끄기
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && (await reg.pushManager.getSubscription());
      if (sub) {
        quiet(remote.deletePushSub(await subId(sub.endpoint)));
        await sub.unsubscribe();
      }
    } else {
      // 켜기: 허용 묻기는 버튼을 누른 바로 그 순간에 해야 아이폰에서 잘 돼요
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (permission !== 'granted') {
        showToast('알림이 막혀 있어요. 폰 설정에서 이 앱의 알림을 허용해 주세요');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription())
        || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUSH.vapidPublicKey) }));
      const json = sub.toJSON();
      await remote.savePushSub(await subId(sub.endpoint), {
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        createdAt: Date.now(),
        device: navigator.userAgent.slice(0, 120),
      });
    }
  } catch (err) {
    console.error(err);
    showToast('알림 설정을 바꾸지 못했어요');
  }
  renderPushState();
}

// 알림 서버에 "지금 확인해 줘" (친구 반응을 바로 보내려고)
function flushPush() {
  if (pushReady()) fetch(`${PUSH.workerUrl.replace(/\/$/, '')}/flush`, { method: 'POST' }).catch(() => {});
}

// 뽀모도로가 끝나는 시각에 알림 예약: 집중 끝(timer_), 그 뒤 휴식 끝(timer2_)
// (휴식은 자동으로 시작되니까, 폰이 잠겨 있어도 두 알림이 다 오도록 미리 둘 다 예약해요)
function scheduleTimerPush() {
  if (!pushReady() || !currentUser) return;
  const me = currentUser.uid;
  const focusId = `timer_${me}`;
  const breakId = `timer2_${me}`;
  const now = Date.now();
  const [focusMin, breakMin] = POMO_PRESETS[timer.preset];
  const jobs = {};
  if (timer.mode === 'pomo' && timer.running) {
    const phaseEnd = Math.round(timer.startedAt + (phaseLength() - timer.elapsed));
    if (timer.phase === 'focus') {
      jobs[focusId] = { at: phaseEnd, title: '집중 끝! 🍅', body: `수고했어요. ${breakMin}분 쉬어요.` };
      jobs[breakId] = { at: phaseEnd + breakMin * 60000, title: '휴식 끝!', body: `다시 ${focusMin}분 집중해 볼까요? 앱에서 시작을 눌러 주세요.` };
    } else {
      jobs[breakId] = { at: phaseEnd, title: '휴식 끝!', body: `다시 ${focusMin}분 집중해 볼까요? 앱에서 시작을 눌러 주세요.` };
    }
  }
  for (const id of [focusId, breakId]) {
    const job = jobs[id];
    // 이미 지난 시각은 예약하지 않아요 (같은 알림이 두 번 가지 않게)
    if (job && job.at > now) quiet(remote.setPushJob(id, { ...job, to: me, tag: 'timer' }));
    else quiet(remote.deletePushJob(id));
  }
}

// 친구 할 일에 반응하면 그 친구에게 알림 (투두메이트 문구 그대로)
//   제목 = 내 이름
//   이모지만: ❤️ 당신의 "할 일" 할 일을 좋아합니다
//   댓글:     ❤️ 당신의 "할 일"에 메시지를 남겼습니다: "댓글"
function notifyReaction(ownerUid, reaction, todoTitle) {
  if (!pushReady() || ownerUid === currentUser.uid) return;
  const name = profileView().nickname.slice(0, 20);
  const what = reaction.emoji || '💬';
  const title = todoTitle.slice(0, 40);
  const body = (reaction.text
    ? `${what} 당신의 "${title}"에 메시지를 남겼습니다: "${reaction.text}"`
    : `${what} 당신의 "${title}" 할 일을 좋아합니다`).slice(0, 200);
  remote.setPushJob(newId(), { to: ownerUid, at: Date.now(), title: name, body, tag: 'reaction' })
    .then(flushPush)
    .catch((err) => console.warn('알림:', err?.code || err));
}

// 친구에게 공개된 할 일을 끝내면 서로 친구인 사람들에게 알림: "할 일" 할 일을 완료했습니다
function notifyDone(todo) {
  if (!pushReady() || !todo.shared) return;
  const iFollow = new Set(follows.mine.filter((f) => f.status === 'accepted').map((f) => f.to));
  const friends = follows.toMe.filter((f) => f.status === 'accepted' && iFollow.has(f.from)).map((f) => f.from);
  if (!friends.length) return;
  const name = profileView().nickname.slice(0, 20);
  const body = `"${todo.title.slice(0, 120)}" 할 일을 완료했습니다`;
  Promise.all(friends.map((to) => remote.setPushJob(newId(), { to, at: Date.now(), title: name, body, tag: 'done' })))
    .then(flushPush)
    .catch((err) => console.warn('알림:', err?.code || err));
}

document.getElementById('push-toggle').addEventListener('click', togglePush);
document.getElementById('open-notices').addEventListener('click', openNotices);
document.getElementById('notice-close').addEventListener('click', () => $noticeDialog.close());
document.getElementById('react-close').addEventListener('click', () => $reactDialog.close());
for (const dialog of [$noticeDialog, $reactDialog]) {
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}

// ===== 🎨 테마 =====
const $themeDialog = document.getElementById('theme-dialog');

// 테마 바꾸기: 화면 색을 바꾸고, 이 기기와 내 계정(다른 기기)에 기억해요
function applyTheme(id, { remember = true } = {}) {
  themeChoice = findTheme(id).id;
  theme = resolveTheme(themeChoice);
  document.documentElement.dataset.theme = theme.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.statusColor);
  try { localStorage.setItem('mytodo.theme', themeChoice); } catch { /* 괜찮아요 */ }
  document.getElementById('theme-name').textContent = findTheme(themeChoice).name;
  loadThemeFonts();
  if (remember && currentUser && profile?.theme !== themeChoice) {
    profile = { ...(profile || {}), theme: themeChoice };
    save(remote.saveProfile(profile));
  }
  if (currentUser) {
    render();
    if ($catDialog.open) renderCategoryList();
    if ($themeDialog.open) renderThemes();
  }
}

function renderThemes() {
  document.getElementById('theme-grid').replaceChildren(...THEMES.map((t) => {
    const preview = el('div', { className: 'theme-preview' }, t.swatches.slice(1).map((c) => {
      const dot = el('span');
      dot.style.background = c;
      return dot;
    }));
    preview.style.background = t.swatches[0];
    const card = el('button', { type: 'button', className: 'theme-card' + (t.id === themeChoice ? ' on' : ''), disabled: !t.ready }, [
      preview,
      el('span', { className: 'theme-name', textContent: t.name }),
      el('span', { className: 'theme-sub', textContent: t.ready ? t.sub : '곧 나와요' }),
    ]);
    card.setAttribute('aria-pressed', String(t.id === themeChoice));
    card.addEventListener('click', () => applyTheme(t.id));
    return card;
  }));
}

document.getElementById('open-theme').addEventListener('click', () => {
  renderThemes();
  $themeDialog.showModal();
});
document.getElementById('theme-close').addEventListener('click', () => $themeDialog.close());
$themeDialog.addEventListener('click', (e) => {
  if (e.target === $themeDialog) $themeDialog.close();
});
document.getElementById('theme-name').textContent = findTheme(themeChoice).name;

// 테마 전용 글꼴은 그 테마를 입을 때만 받아요 (index.html 맨 위에서 고른 테마 것을 먼저 받기 시작해요 — 목록 같게 유지)
const THEME_FONTS = {
  space: 'family=Noto+Sans+KR:wght@300;400;500;700&family=Space+Mono',
  cereal: 'family=Jua&family=Lilita+One',
  wish: 'family=Gaegu:wght@400;700&family=Gowun+Dodum',
};
function loadThemeFonts() {
  const families = THEME_FONTS[theme.id];
  if (!families || document.getElementById(`${theme.id}-fonts`)) return;
  const link = el('link', { id: `${theme.id}-fonts`, rel: 'stylesheet', href: `https://fonts.googleapis.com/css2?${families}&display=block` });
  document.head.append(link);
}
loadThemeFonts();

// 진행 표시(진행 바 + "1 / 3") 켜고 끄기: 이 기기와 내 계정에 기억해요
function applyProgressSetting(show) {
  document.body.classList.toggle('no-progress', !show);
  const state = document.getElementById('progress-state');
  state.textContent = show ? '켜짐' : '꺼짐';
  state.classList.toggle('on', show);
}
let showProgress = true;
try { showProgress = localStorage.getItem('mytodo.progress') !== 'off'; } catch { /* 괜찮아요 */ }
applyProgressSetting(showProgress);
document.getElementById('progress-toggle').addEventListener('click', () => {
  showProgress = !showProgress;
  applyProgressSetting(showProgress);
  try { localStorage.setItem('mytodo.progress', showProgress ? 'on' : 'off'); } catch { /* 괜찮아요 */ }
  if (currentUser) {
    profile = { ...(profile || {}), hideProgress: !showProgress };
    save(remote.saveProfile(profile));
  }
});

// 사용자 지정: 폰이 다크모드로 바뀌면(해 지면 등) 바로 따라 바꿔요
darkQuery.addEventListener('change', () => {
  if (themeChoice === 'auto') applyTheme('auto', { remember: false });
});

document.getElementById('open-profile').addEventListener('click', openProfileForm);
document.getElementById('profile-close').addEventListener('click', () => $profileDialog.close());
$profileDialog.addEventListener('click', (e) => {
  if (e.target === $profileDialog) $profileDialog.close();
});

// 글을 쓰는 동안(키보드가 올라온 동안)에는 하단바를 숨겨요
// (폰에서 하단바가 키보드 위로 떠올라 입력칸을 가리는 걸 막아요)
// 아이폰은 키보드를 내려도 입력칸에 포커스가 남거나(창이 닫힐 때 등) focusout이 안 오는 일이 있어서,
// '입력칸에 포커스'만 보지 않고 '키보드가 실제로 화면을 가리고 있는지'도 같이 봐요.
const isTypingField = (t) => t?.matches?.('input:not([type="checkbox"]):not([type="radio"]):not([type="color"]), textarea, [contenteditable="true"]');
const vv = window.visualViewport;
// 갤럭시는 키보드가 올라오면 창 전체가 줄어서, 키보드 없을 때 가장 컸던 높이와 비교해요
let fullH = vv ? vv.height : 0;
const keyboardUp = () => {
  if (!vv) return true;
  if (!isTypingField(document.activeElement)) fullH = Math.max(vv.height, window.innerHeight);
  fullH = Math.max(fullH, window.innerHeight);
  return fullH - vv.height > 120;
};
window.addEventListener('orientationchange', () => { fullH = 0; });
const syncTyping = () => {
  const el = document.activeElement;
  const on = isTypingField(el) && el.getClientRects().length > 0 && keyboardUp();
  const was = document.body.classList.contains('typing');
  document.body.classList.toggle('typing', on);
  // 키보드가 내려간 뒤 아이폰이 화면을 밀어 올린 채로 두면 아래 고정 막대가 화면 밖에 남아요 → 제자리로
  if (was && !on) requestAnimationFrame(() => window.scrollTo(window.scrollX, window.scrollY));
};
document.addEventListener('focusin', (e) => {
  if (isTypingField(e.target)) document.body.classList.add('typing');
  setTimeout(syncTyping, 450); // 키보드가 다 올라온 뒤 한 번 더 확인
});
document.addEventListener('focusout', () => setTimeout(syncTyping, 60));
vv?.addEventListener('resize', syncTyping);
document.addEventListener('close', () => setTimeout(syncTyping, 60), true); // 창(dialog)이 닫힐 때
document.addEventListener('visibilitychange', syncTyping);

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
      routines = [];
      blocks = [];
      plannerTemplates = [];
      if (stopFriend) stopFriend();
      stopFriend = null;
      stopWatchingFriendReactions();
      myReactions = [];
      studyLogs = [];
      for (const dialog of [$reactDialog, $noticeDialog, $friendsDialog]) dialog.close();
      viewing = null;
      mineSaved = null;
      document.body.classList.remove('viewing-friend');
      stopSocial();
      sharingMigrated = false;
      profile = null;
      currentUser = null;
      for (const dialog of [$catDialog, $todoSheet, $archiveDialog, $routineDialog, $blockDialog, $templateDialog, $profileDialog]) dialog.close();
      if (selecting) stopSelecting();
      showTab('home');
      showScreen('login');
      return;
    }

    showScreen('loading');
    useAccount(user.uid);
    currentUser = user;
    renderProfile();
    renderPushState();
    const local = localDataForSeed();
    await seedIfEmpty(local.categories, local.todos);

    let gotTodos = false;
    let gotCategories = false;
    let gotRoutines = false;
    let gotBlocks = false;
    let gotTemplates = false;
    const ready = () => {
      if (!gotTodos || !gotCategories || !gotRoutines || !gotBlocks || !gotTemplates) return;
      showScreen('app');
      migrateSharing();
      scheduleRender();
    };
    stopSync = subscribe({
      // 친구 할 일을 보는 중이면, 내 데이터는 맡아 둔 곳에 넣어 둬요
      onTodos: (list) => { if (viewing) mineSaved.todos = list; else todos = list; gotTodos = true; ready(); },
      onCategories: (list) => { if (viewing) mineSaved.categories = list; else categories = list; gotCategories = true; ready(); },
      onRoutines: (list) => { if (viewing) mineSaved.routines = list; else routines = list; gotRoutines = true; ready(); },
      onBlocks: (list) => { blocks = list; gotBlocks = true; ready(); },
      onTemplates: (list) => { plannerTemplates = list; gotTemplates = true; ready(); },
      onStudyLogs: (list) => {
        studyLogs = list;
        if (document.body.dataset.tab === 'timer') renderStudy();
      },
      onReactions: (list) => {
        myReactions = list;
        list.forEach((r) => { if (r.from !== user.uid) watchPerson(r.from); });
        updateNoticeBadge();
        if (!viewing) scheduleRender();
      },
      onProfile: (data) => {
        profile = data;
        // 다른 기기에서 고른 테마를 따라가요
        if (profile?.theme && profile.theme !== themeChoice) applyTheme(profile.theme, { remember: false });
        // 다른 기기에서 바꾼 진행 표시 설정도 따라가요
        if (typeof profile?.hideProgress === 'boolean' && profile.hideProgress === showProgress) {
          showProgress = !profile.hideProgress;
          applyProgressSetting(showProgress);
          try { localStorage.setItem('mytodo.progress', showProgress ? 'on' : 'off'); } catch { /* 괜찮아요 */ }
        }
        renderProfile();
        publishProfile();
        startSocial(); // 프로필을 받은 뒤에 시작해요 (친구 코드가 겹쳐 만들어지지 않게)
      },
      onError: (err) => {
        showLoginError(err);
        logout();
      },
    });
  });
}

// ===== 앱 버전 =====
// 고칠 때마다 updated 를 고친 날짜·시각으로 바꿔요 (sw.js 의 CACHE 숫자도 1 올리기)
// 개인정보 맨 아래에 보여서, 폰에 새 버전이 들어왔는지 이 시각으로 확인할 수 있어요.
const APP_VERSION = { version: '1.0.0', updated: '2026-10-23 18:42' };
document.getElementById('version-now').textContent =
  `버전 ${APP_VERSION.version} · ${APP_VERSION.updated.replaceAll('-', '.')} 수정`;
