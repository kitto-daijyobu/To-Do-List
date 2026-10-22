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

// 시리얼 박스: 쨍한 원색 (이름표는 진한 색 바탕 + 크림 글자, 노랑·하늘은 남색 글자)
const CEREAL = [
  { name: '파랑', dot: '#2b5fb4', bg: '#2b5fb4', fg: '#fbefd9', box: '#2b5fb4', on: '#fbefd9' },
  { name: '빨강', dot: '#e2412b', bg: '#e2412b', fg: '#fbefd9', box: '#e2412b', on: '#fbefd9' },
  { name: '노랑', dot: '#f7b928', bg: '#f7b928', fg: '#1b2340', box: '#f7b928', on: '#1b2340' },
  { name: '초록', dot: '#3a9a5b', bg: '#3a9a5b', fg: '#fbefd9', box: '#3a9a5b', on: '#fbefd9' },
  { name: '주황', dot: '#f07a22', bg: '#f07a22', fg: '#fbefd9', box: '#f07a22', on: '#fbefd9' },
  { name: '보라', dot: '#7b4bb3', bg: '#7b4bb3', fg: '#fbefd9', box: '#7b4bb3', on: '#fbefd9' },
  { name: '하늘', dot: '#45b4e6', bg: '#45b4e6', fg: '#1b2340', box: '#45b4e6', on: '#1b2340' },
  { name: '분홍', dot: '#e85a8c', bg: '#e85a8c', fg: '#fbefd9', box: '#e85a8c', on: '#fbefd9' },
  { name: '남색', dot: '#1b2340', bg: '#1b2340', fg: '#fbefd9', box: '#1b2340', on: '#fbefd9' },
];

// 우주: 별빛 파랑 · 보라 · 청록 · 금빛 (어두운 바탕 위 은은한 색)
const SPACE = [
  { name: '별빛', dot: '#7aa7e8', bg: 'rgba(122,167,232,.14)', fg: '#a9c6f0', on: '#0d1420' },
  { name: '성운', dot: '#a99be8', bg: 'rgba(169,155,232,.14)', fg: '#c3b8f2', on: '#0d1420' },
  { name: '오로라', dot: '#6cc5c0', bg: 'rgba(108,197,192,.14)', fg: '#94d8d4', on: '#0d1420' },
  { name: '금성', dot: '#f2c98a', bg: 'rgba(242,201,138,.14)', fg: '#f2d3a3', on: '#0d1420' },
  { name: '화성', dot: '#e89a9a', bg: 'rgba(232,154,154,.14)', fg: '#f0b8b8', on: '#0d1420' },
  { name: '혜성', dot: '#cfe0ff', bg: 'rgba(207,224,255,.12)', fg: '#dde8ff', on: '#0d1420' },
  { name: '해왕성', dot: '#5b8dd6', bg: 'rgba(91,141,214,.16)', fg: '#93b5e8', on: '#0d1420' },
  { name: '은하수', dot: '#c79be8', bg: 'rgba(199,155,232,.14)', fg: '#dcbdf2', on: '#0d1420' },
];

export const THEMES = [
  {
    id: 'base', name: '기본 테마', sub: '맑은 블루',
    swatches: ['#f3f6fb', '#ffffff', '#e4edf8', '#3b6ea8', '#1f2a3a'],
    statusColor: '#f3f6fb', mark: 'clover', ready: true,
  },
  {
    id: 'matcha', name: '말차코어', sub: '미색 · 말차 · 라임',
    swatches: ['#f5f2e8', '#fffdf7', '#a9c632', '#9caf88', '#1d2e1b'],
    statusColor: '#f5f2e8', mark: 'clover', palette: MATCHA, ready: true,
  },
  {
    id: 'cereal', name: '시리얼 박스', sub: '원색 · 두꺼운 테두리',
    swatches: ['#fbefd9', '#e2412b', '#f7b928', '#2b5fb4', '#1b2340'],
    statusColor: '#2b5fb4', mark: 'shape', palette: CEREAL, ready: true,
  },
  {
    id: 'iphone', name: '2007 아이폰', sub: '유광 버튼 · 은회색',
    swatches: ['#dce2ea', '#ffffff', '#6e86a7', '#4f93e0', '#000000'],
    statusColor: '#000000', mark: 'shape', ready: true,
  },
  {
    id: 'dark', name: '다크모드', sub: '눈이 편한 밤 화면',
    swatches: ['#1d1e22', '#26272c', '#303137', '#8fb2ec', '#e9e7e2'],
    statusColor: '#1d1e22', mark: 'clover', ready: true,
  },
  {
    id: 'wish', name: '위시코어', sub: '파스텔 · 손글씨',
    swatches: ['#fde6ee', '#fdfbfb', '#8ec1ec', '#f6a9c3', '#9cc98a'],
    statusColor: '#fde6ee', mark: 'shape', ready: false,
  },
  {
    id: 'space', name: '우주', sub: '끝낸 만큼 차오르는 달',
    swatches: ['#0d1420', '#162031', '#7aa7e8', '#cfe0ff', '#ebe5d4'],
    statusColor: '#0d1420', mark: 'moon', palette: SPACE, ready: true,
  },
  {
    id: 'auto', name: '사용자 지정', sub: '폰 설정 따라 기본 ↔ 다크',
    swatches: ['linear-gradient(90deg,#f3f6fb 50%,#1d1e22 50%)', '#ffffff', '#3b6ea8', '#26272c', '#8fb2ec'],
    statusColor: '#f3f6fb', mark: 'clover', ready: true,
  },
];

export const findTheme = (id) => THEMES.find((t) => t.id === id && t.ready) || THEMES[0];

// '사용자 지정'은 폰(컴퓨터)이 다크모드인지 보고 기본 또는 다크로 바꿔 입어요
export const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
export const resolveTheme = (id) => findTheme(id === 'auto' ? (darkQuery.matches ? 'dark' : 'base') : id);
