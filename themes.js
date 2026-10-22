// ===== 테마 목록 =====
// 색·모양 값은 style.css 맨 아래 [data-theme="..."] 에 있고,
// 여기에는 이름, 미리보기 색, 달력 마크 종류, 테마 전용 카테고리 색 목록이 있어요.
//
// mark: 'clover' = 끝낸 카테고리 색으로 잎이 물드는 클로버(기본)
//       'shape'  = 빈 날 / 진행 중(남은 개수) / 다 끝냄(✓) 세 가지 색의 원·둥근 네모
// palette: 이 테마에서 고를 수 있는 카테고리 색 (없으면 기본 20색)
//   dot = 점·잎·막대에 쓰는 색, bg/fg = 카테고리 이름표 바탕/글자, box/on = 체크칸 채움/✓ 색

// 말차코어: 서로 구별되는 연두·초록 계열
const MATCHA = [
  { name: '말차', dot: '#c9e05a', bg: '#1d2e1b', fg: '#c9e05a', box: '#1d2e1b', on: '#c9e05a' },
  { name: '세이지', dot: '#6f8a4a', bg: '#dfe7cc', fg: '#3d5427', on: '#ffffff' },
  { name: '라임', dot: '#a9c632', bg: '#ecf3c6', fg: '#4c5c12', on: '#1d2e1b' },
  { name: '민트그린', dot: '#6fb589', bg: '#dceee1', fg: '#2f6b41', on: '#ffffff' },
  { name: '올리브', dot: '#8c9140', bg: '#ebebd0', fg: '#4f521c', on: '#ffffff' },
  { name: '청포도', dot: '#b6d86b', bg: '#eef6d6', fg: '#55701a', on: '#1d2e1b' },
  { name: '쑥', dot: '#8fa577', bg: '#e6ecdc', fg: '#46593a', on: '#ffffff' },
  { name: '피스타치오', dot: '#a3c793', bg: '#e8f2e2', fg: '#3f6234', on: '#1d2e1b' },
  { name: '이끼', dot: '#55703e', bg: '#d7e1cc', fg: '#2c3e1f', on: '#ffffff' },
  { name: '숲', dot: '#2f5d3a', bg: '#cfe0d1', fg: '#1d3a24', on: '#ffffff' },
];

export const THEMES = [
  {
    id: 'base', name: '기본 · 맑은 블루', sub: '지금 앱 그대로',
    swatches: ['#f3f6fb', '#ffffff', '#e4edf8', '#3b6ea8', '#1f2a3a'],
    statusColor: '#f3f6fb', mark: 'clover', ready: true,
  },
  {
    id: 'matcha', name: '말차코어', sub: '미색 · 말차 · 라임',
    swatches: ['#f5f2e8', '#fffdf7', '#a9c632', '#9caf88', '#1d2e1b'],
    statusColor: '#f5f2e8', mark: 'shape', palette: MATCHA, ready: true,
  },
  {
    id: 'cereal', name: '시리얼 박스', sub: '원색 · 두꺼운 테두리',
    swatches: ['#fbefd9', '#e2412b', '#f7b928', '#2b5fb4', '#1b2340'],
    statusColor: '#2b5fb4', mark: 'shape', ready: false,
  },
  {
    id: 'iphone', name: '아이폰 2007', sub: '유광 버튼 · 은회색',
    swatches: ['#dce2ea', '#ffffff', '#6e86a7', '#4f93e0', '#000000'],
    statusColor: '#000000', mark: 'shape', ready: false,
  },
  {
    id: 'dark', name: '다크 · 부드러운 밤', sub: '눈이 편한 밤 화면',
    swatches: ['#1d1e22', '#26272c', '#303137', '#8fb2ec', '#e9e7e2'],
    statusColor: '#1d1e22', mark: 'shape', ready: true,
  },
  {
    id: 'wish', name: '소녀 · 위시코어', sub: '파스텔 · 손글씨',
    swatches: ['#fde6ee', '#fdfbfb', '#8ec1ec', '#f6a9c3', '#9cc98a'],
    statusColor: '#fde6ee', mark: 'shape', ready: false,
  },
  {
    id: 'space', name: '우주 · 달을 향해', sub: '차오르는 달',
    swatches: ['#0d1420', '#162031', '#7aa7e8', '#cfe0ff', '#ebe5d4'],
    statusColor: '#0d1420', mark: 'shape', ready: false,
  },
];

export const findTheme = (id) => THEMES.find((t) => t.id === id && t.ready) || THEMES[0];
