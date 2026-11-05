window.__ModuleLoader__.load({ id: "dsh-calendar", factory: (require) => {
const module = { exports: {} }; const exports = module.exports;
const PLUGIN_ID = "dsh-calendar";
const SLOT = "__dshCalendarDispose";
const STORE_KEY = "dsh-calendar:entries:v1";
/* 0.4.0까지 쓰던 키. 값이 마스킹 사고로 "dsh-calenda...(revoked token)"로 남아 있었고
   저장 형식은 같다. 읽을 때 새 키로 옮겨 기존 일정이 고아가 되지 않게 한다. */
const LEGACY_STORE_KEYS = ["dsh-calenda...(revoked token)"];
const WD = ["일", "월", "화", "수", "목", "금", "토"];

/* ---------------- 공휴일 (「관공서의 공휴일에 관한 규정」 기준) ----------------
   양력 고정 공휴일 + 음력 명절 앵커(설날/추석/부처님 오신 날 D-day)에서
   연휴와 대체공휴일을 규칙으로 계산한다. 세 번째 값 = 대체공휴일 적용 여부.
   신정·현충일·성탄절은 대체공휴일 미적용, 2026년부터 노동절·제헌절이 추가됐다. */
const FIXED_HOLIDAYS = (y) => [
  ["01-01", "신정", false],
  ["03-01", "3·1절", true],
  ["05-05", "어린이날", true],
  ["06-06", "현충일", false],
  ["08-15", "광복절", true],
  ["10-03", "개천절", true],
  ["10-09", "한글날", true],
  ["12-25", "성탄절", true],
  ...(y >= 2026 ? [["05-01", "노동절", true], ["07-17", "제헌절", true]] : []),
];
/* [설날, 추석, 부처님 오신 날] 음력 앵커의 양력 날짜. 없는 해는 공휴일 표시만 생략된다.
   날짜는 KST 기준 신월이 든 날이다. 자정 직후 신월(2027·2028·2030)은 중국(CST) 표와
   하루 갈리므로 중국 자료를 옮겨 적으면 틀린다. 2028 설날 신월 = 2028-01-27 00:12 KST,
   2030 설날 신월 = 2030-02-03 01:07 KST (2028은 중국 기준 01-26). */
const LUNAR_ANCHORS = {
  2024: ["02-10", "09-17", "05-15"],
  2025: ["01-29", "10-06", "05-05"],
  2026: ["02-17", "09-25", "05-24"],
  2027: ["02-07", "09-15", "05-13"],
  2028: ["01-27", "10-03", "05-02"],
  2029: ["02-13", "09-22", "05-20"],
  2030: ["02-03", "09-12", "05-09"],
};

/* 임기만료에 의한 선거일 (공직선거법 제34조). 새 선거가 정해지면 이 표에 추가한다. */
const ELECTION_DAYS = { 2024: ["04-10"], 2025: ["06-03"], 2026: ["06-03"], 2028: ["04-12"] };

const dayOfWeek = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d).getDay(); };
function shiftKey(key, days) {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(y, m - 1, d + days);
  return ymd(t.getFullYear(), t.getMonth(), t.getDate());
}
const holidayCache = new Map();
function holidaysFor(y) {
  if (holidayCache.has(y)) return holidayCache.get(y);
  const marks = new Map();
  const add = (k, name) => marks.set(k, marks.has(k) ? `${marks.get(k)} · ${name}` : name);
  const singles = [];   // [key, 대체적용]
  const groups = [];    // [첫날, 마지막날]

  for (const [mmdd, name, alt] of FIXED_HOLIDAYS(y)) { const k = `${y}-${mmdd}`; add(k, name); singles.push([k, alt]); }
  for (const mmdd of ELECTION_DAYS[y] || []) add(`${y}-${mmdd}`, "선거일");
  const anchor = LUNAR_ANCHORS[y];
  if (anchor) {
    for (const i of [0, 1]) {
      const mid = `${y}-${anchor[i]}`;
      const days = [shiftKey(mid, -1), mid, shiftKey(mid, 1)];
      for (const k of days) add(k, i ? "추석 연휴" : "설날 연휴");
      groups.push([days[0], days[2]]);
    }
    const buddha = `${y}-${anchor[2]}`;
    add(buddha, "부처님 오신 날");
    singles.push([buddha, true]);
  }

  /* 대체공휴일: 일요일과 겹치는 명절 연휴, 토요일·일요일·다른 공휴일과 겹치는 단일 공휴일 →
     겹치는 날 이후의 첫 번째 비공휴일. 신정·현충일·성탄절은 적용하지 않는다. */
  const claimed = new Set(marks.keys());
  const freeFrom = (from) => { let k = from; while (dayOfWeek(k) === 0 || claimed.has(k)) k = shiftKey(k, 1); return k; };
  const subs = new Set();
  for (const [k, alt] of singles) {
    const overlap = dayOfWeek(k) === 0 || dayOfWeek(k) === 6 || marks.get(k).includes(" · ");
    if (alt && overlap) subs.add(freeFrom(shiftKey(k, 1)));
  }
  for (const [first, last] of groups) {
    let clash = false;
    for (let k = first; k <= last; k = shiftKey(k, 1)) if (dayOfWeek(k) === 0 || marks.get(k).includes(" · ")) clash = true;
    if (clash) subs.add(freeFrom(shiftKey(last, 1)));
  }
  for (const s of [...subs].sort()) { claimed.add(s); add(s, "대체공휴일"); }
  holidayCache.set(y, marks);
  return marks;
}
function holidayName(key) {
  const y = +key.slice(0, 4);
  for (const yy of [y - 1, y, y + 1]) { const n = holidaysFor(yy).get(key); if (n) return n; }
  return "";
}

/* ---------------- 일정 저장소 (localStorage) ---------------- */
/* 저장 값 검증: 손상되거나 손으로 고친 값이 DOM sink로 흘러가지 않게 형태부터 확인한다. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
function readStoredJson() {
  const current = localStorage.getItem(STORE_KEY);
  if (current !== null) return current;
  for (const legacy of LEGACY_STORE_KEYS) {
    const old = localStorage.getItem(legacy);
    if (old !== null) {
      /* 마이그레이션: 구 키 → 새 키. 옮기지 못하면(quota 등) 읽기만 하고 다음 기회로 미룬다. */
      try { localStorage.setItem(STORE_KEY, old); localStorage.removeItem(legacy); } catch {}
      return old;
    }
  }
  return null;
}
function loadEntries() {
  try {
    const raw = JSON.parse(readStoredJson() || "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((e) => e && typeof e.date === "string" && DATE_RE.test(e.date) && typeof e.title === "string")
      .map((e) => ({
        id: ID_RE.test(String(e.id || "")) ? String(e.id) : Math.random().toString(36).slice(2, 10),
        date: e.date,
        end: typeof e.end === "string" && DATE_RE.test(e.end) && e.end > e.date ? e.end : "",
        time: typeof e.time === "string" && TIME_RE.test(e.time) ? e.time : "",
        title: e.title.slice(0, 200),
      }));
  } catch { return []; }
}
let entries = loadEntries();
const listeners = new Set();
const sortAll = () => entries.sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
function emit() { for (const fn of [...listeners]) { try { fn(); } catch (e) { console.warn("dsh-calendar:", e); } } }
let lastSaveFailed = false;
function persist() {
  sortAll();
  try { localStorage.setItem(STORE_KEY, JSON.stringify(entries)); lastSaveFailed = false; }
  catch (error) {
    /* quota·차단: 조용히 삼키지 않고 한 번만 경고한다(저장된 줄 알았다가 사라지는 일 방지). */
    if (!lastSaveFailed) console.warn("dsh-calendar: 일정 저장 실패", error);
    lastSaveFailed = true;
  }
  emit();
}
function addEntry(date, end, time, title) { entries.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date, end: end && end > date ? end : "", time: time || "", title }); persist(); }
function updateEntry(id, patch) { const e = entries.find((x) => x.id === id); if (e) { Object.assign(e, patch); persist(); } }
function removeEntry(id) { entries = entries.filter((x) => x.id !== id); persist(); }
/* 기간(end)이 있는 일정은 시작일~종료일 사이의 모든 날짜를 커버한다. */
const covers = (e, d) => d >= e.date && d <= (e.end || e.date);
const byDate = (d) => entries.filter((e) => covers(e, d));
const spanLabel = (e) => !e.end ? "" : e.end.slice(0, 7) === e.date.slice(0, 7) ? `~${e.end.slice(8)}일` : `~${e.end.slice(5, 7)}.${e.end.slice(8)}`;

const pad2 = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
const todayStr = () => { const t = new Date(); return ymd(t.getFullYear(), t.getMonth(), t.getDate()); };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function dateLabel(s) {
  const [y, m, d] = s.split("-").map(Number);
  return `${m}. ${pad2(d)} (${WD[new Date(y, m - 1, d).getDay()]})`;
}

/* ---------------- 스타일 ---------------- */
const CSS = `
#dshcal-root { position: fixed; z-index: 28; display: none; font-family: "Malgun Gothic", sans-serif;
  color: #26305c; user-select: none; }
#dshcal-root.show { display: block; }
#dshcal-panel { background: #fffffff2; border: 1px solid #5f7cf52b; border-radius: 16px;
  box-shadow: 0 8px 28px #5f7cf522; padding: 8px; backdrop-filter: blur(6px); }
#dshcal-panel { max-height: var(--dshcal-avail, calc(100vh - 24px)); overflow: hidden auto; scrollbar-width: thin; }
.dshcal-head { display: flex; align-items: center; justify-content: space-between; margin: 2px 2px 6px; }
.dshcal-head button { width: 24px; height: 24px; border: 0; border-radius: 8px; background: transparent; cursor: pointer;
  color: #5f7cf5; font-size: 15px; line-height: 1; }
.dshcal-head button:hover { background: #6f8cff1a; }
.dshcal-title { font: 700 13px/1 "Malgun Gothic", sans-serif; color: #26305c; cursor: pointer; }
.dshcal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.dshcal-wd { margin-bottom: 2px; }
.dshcal-wd span { text-align: center; font: 600 10px/1.6 "Malgun Gothic", sans-serif; opacity: .55; }
.dshcal-wd span:first-child { color: #e5484d; opacity: .9; }
.dshcal-wd span:last-child { color: #3f6fe8; opacity: .9; }
.dshcal-day { position: relative; height: 27px; border: 0; border-radius: 8px; background: transparent; cursor: pointer;
  color: #26305c; font: 500 11.5px/1 "Malgun Gothic", sans-serif; padding: 0; }
.dshcal-day:hover { background: #6f8cff1a; }
.dshcal-day.blank { visibility: hidden; pointer-events: none; }
.dshcal-day.sun { color: #e5484d; }
.dshcal-day.sat { color: #3f6fe8; }
/* 공휴일: 일요일과 같은 빨강 굵은 글자, 이름은 가리키기 팝업과 선택 날짜 머리에 표시 */
.dshcal-day.holi { color: #e5484d; font-weight: 700; }
.dshcal-day.today.holi { color: #fff; }
.dshcal-day.today { background: #5f7cf5; color: #fff; font-weight: 700; }
.dshcal-day.today:hover { background: #4f6ce8; }
.dshcal-day.sel { box-shadow: inset 0 0 0 1.5px #ff8fbd; }
/* 일정 표시: 셀 배경 틴트(진하기 = 개수) + 아래 분할 막대(최대 3개, 4개째 흐린 막대) */
.dshcal-day.has { background: #ff8fbd26; }
.dshcal-day.has2 { background: #ff8fbd3d; }
.dshcal-day.has3 { background: #ff8fbd57; }
.dshcal-day.has:hover, .dshcal-day.has2:hover, .dshcal-day.has3:hover { filter: brightness(.985); }
.dshcal-day.cont { background: #ff8fbd1a; }
.dshcal-day.today.has, .dshcal-day.today.has2, .dshcal-day.today.has3, .dshcal-day.today.cont { background: #5f7cf5; }
.dshcal-bars { position: absolute; left: 2px; right: 2px; bottom: 3px; display: flex; justify-content: center; gap: 2px; }
.dshcal-bars i { width: 5px; height: 3px; border-radius: 2px; background: #ff8fbd; }
.dshcal-bars i:only-child { width: 11px; }
.dshcal-bars i.fade { background: #ff8fbd73; }
.dshcal-day.today .dshcal-bars i { background: #fff; }
/* ---- 선택 날짜 일정 목록 (달력 아래, 최대 3개 → 초과 시 스크롤) ---- */
.dshcal-sel { margin: 6px 2px 2px; padding-top: 7px; border-top: 1px solid #5f7cf524; }
.dshcal-sel-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 5px; }
.dshcal-sel-date { font: 700 11.5px/1 "Malgun Gothic", sans-serif; color: #26305c; }
.dshcal-sel-holi { font-style: normal; color: #e5484d; }
.dshcal-sel-cnt { font: 600 10px/1 "Malgun Gothic", sans-serif; color: #5f7cf5; }
.dshcal-sel-list { max-height: 84px; overflow-y: auto; overscroll-behavior: contain; display: grid; gap: 3px; scrollbar-width: thin; }
.dshcal-li-empty { font: 500 11px/1.9 "Malgun Gothic", sans-serif; text-align: center; opacity: .45; color: #26305c; padding: 5px 0; }
.dshcal-li { display: flex; align-items: center; gap: 6px; min-height: 24px; padding: 2px 6px; border-radius: 8px; background: #f3f6ff; cursor: pointer; }
.dshcal-li:hover { background: #e9efff; }
.dshcal-li em { flex: none; min-width: 34px; font: 700 10.5px/1 "Malgun Gothic", sans-serif; font-style: normal; color: #5f7cf5; }
.dshcal-li .dshcal-li-t { flex: 1; min-width: 0; font: 500 11.5px/1.35 "Malgun Gothic", sans-serif; color: #26305c;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshcal-li .dshcal-li-t small { margin-left: 4px; color: #ff8fbd; font-weight: 700; }
.dshcal-li-x { flex: none; border: 0; border-radius: 6px; background: transparent; cursor: pointer; padding: 2px 4px;
  color: #26305c66; font-size: 10px; line-height: 1; opacity: 0; }
.dshcal-li:hover .dshcal-li-x, .dshcal-li-x:focus-visible { opacity: 1; }
.dshcal-li-x:hover { background: #e06a9426; color: #e06a94; }
#dshcal-add { width: 100%; margin-top: 6px; padding: 6px 10px; border: 0; border-radius: 10px; cursor: pointer;
  background: linear-gradient(135deg, #6f8cff, #b58cff); color: #fff; font: 600 11.5px/1 "Malgun Gothic", sans-serif;
  box-shadow: 0 3px 10px #6f8cff3d; }
#dshcal-add:hover { filter: brightness(1.06); }
body[data-ds-dark-theme] #dshcal-root { color: #e8ebf5; }
body[data-ds-dark-theme] #dshcal-panel { background: #22242bf2; border-color: #8fa6ff33; box-shadow: 0 8px 28px #00000059; }
body[data-ds-dark-theme] .dshcal-title { color: #e8ebf5; }
body[data-ds-dark-theme] .dshcal-day { color: #e8ebf5; }
body[data-ds-dark-theme] .dshcal-wd span:first-child { color: #ff6b6b; }
body[data-ds-dark-theme] .dshcal-wd span:last-child { color: #7f9dff; }
body[data-ds-dark-theme] .dshcal-day.sun { color: #ff6b6b; }
body[data-ds-dark-theme] .dshcal-day.sat { color: #7f9dff; }
body[data-ds-dark-theme] .dshcal-day.holi { color: #ff6b6b; }
body[data-ds-dark-theme] .dshcal-day:hover { background: #8fa6ff24; }
body[data-ds-dark-theme] .dshcal-day.today { background: #6b7ff0; }
body[data-ds-dark-theme] .dshcal-day.sel { box-shadow: inset 0 0 0 1.5px #d97aa8; }
body[data-ds-dark-theme] .dshcal-day.has { background: #d97aa82e; }
body[data-ds-dark-theme] .dshcal-day.has2 { background: #d97aa845; }
body[data-ds-dark-theme] .dshcal-day.has3 { background: #d97aa861; }
body[data-ds-dark-theme] .dshcal-day.cont { background: #d97aa820; }
body[data-ds-dark-theme] .dshcal-day.has:hover { background: #d97aa845; }
body[data-ds-dark-theme] .dshcal-day.has2:hover { background: #d97aa85c; }
body[data-ds-dark-theme] .dshcal-day.has3:hover { background: #d97aa878; }
body[data-ds-dark-theme] .dshcal-day.today.has, body[data-ds-dark-theme] .dshcal-day.today.has2,
body[data-ds-dark-theme] .dshcal-day.today.has3, body[data-ds-dark-theme] .dshcal-day.today.cont { background: #6b7ff0; }
body[data-ds-dark-theme] .dshcal-bars i { background: #d97aa8; }
body[data-ds-dark-theme] .dshcal-bars i.fade { background: #d97aa87a; }
body[data-ds-dark-theme] .dshcal-day.today .dshcal-bars i { background: #fff; }
body[data-ds-dark-theme] .dshcal-sel { border-top-color: #8fa6ff33; }
body[data-ds-dark-theme] .dshcal-sel-date, body[data-ds-dark-theme] .dshcal-li .dshcal-li-t,
body[data-ds-dark-theme] .dshcal-li-empty { color: #e8ebf5; }
body[data-ds-dark-theme] .dshcal-li { background: #26282d; }
body[data-ds-dark-theme] .dshcal-li:hover { background: #2f323b; }
body[data-ds-dark-theme] .dshcal-li-x { color: #e8ebf566; }
body[data-ds-dark-theme] .dshcal-li-x:hover { background: #d97aa833; color: #f0a9c6; }
body[data-ds-dark-theme] .dshcal-sel-holi { color: #ff6b6b; }
/* ---- 일정 관리 다이얼로그 ---- */
#dshcal-modal { position: fixed; inset: 0; z-index: 50; display: none; align-items: center; justify-content: center;
  background: #1a204055; backdrop-filter: blur(3px); font-family: "Malgun Gothic", sans-serif; }
#dshcal-modal.show { display: flex; }
#dshcal-card { width: min(460px, calc(100vw - 40px)); max-height: min(70vh, 620px); display: flex; flex-direction: column;
  background: #fff; border: 1px solid #5f7cf526; border-radius: 20px; box-shadow: 0 18px 60px #26305c40; overflow: hidden; }
#dshcal-card header { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px 10px; }
#dshcal-card header h2 { margin: 0; font: 700 15px/1.3 "Malgun Gothic", sans-serif; color: #26305c; }
#dshcal-card header button { border: 0; background: transparent; cursor: pointer; font-size: 16px; color: #26305c99; }
.dshcal-form { display: grid; grid-template-columns: 1fr 88px auto; gap: 8px; align-items: center; padding: 6px 18px 10px; }
.dshcal-form input { border: 1.5px solid #5f7cf533; border-radius: 10px; padding: 7px 9px; font: 500 12.5px "Malgun Gothic", sans-serif;
  color: #26305c; background: #f7f9ff; outline: none; min-width: 0; }
.dshcal-form input:focus { border-color: #5f7cf5; }
.dshcal-form .dshcal-wide { grid-column: 1 / -1; }
.dshcal-range { display: flex; align-items: center; gap: 4px; min-width: 0; }
.dshcal-range i { font-style: normal; opacity: .5; font-size: 11px; }
.dshcal-range input { padding: 6px 5px; font-size: 12px; }
.dshcal-form button { border: 0; border-radius: 10px; padding: 7px 14px; cursor: pointer; color: #fff; font: 600 12.5px "Malgun Gothic", sans-serif;
  background: linear-gradient(135deg, #5f7cf5, #ff8fbd); }
.dshcal-hint { padding: 0 18px 2px; font: 500 10.5px/1.5 "Malgun Gothic", sans-serif; opacity: .55; color: #26305c; }
.dshcal-foot { display: none; justify-content: flex-end; padding: 4px 18px 16px; }
.dshcal-foot.show { display: flex; }
.dshcal-foot button { border: 0; border-radius: 10px; padding: 6px 12px; cursor: pointer; background: #e06a941f; color: #e06a94;
  font: 600 12px "Malgun Gothic", sans-serif; }
.dshcal-foot button:hover { background: #e06a9433; }
body[data-ds-dark-theme] #dshcal-card { background: #1e2026; border-color: #8fa6ff33; }
body[data-ds-dark-theme] #dshcal-card header h2, body[data-ds-dark-theme] .dshcal-hint { color: #e8ebf5; }
body[data-ds-dark-theme] .dshcal-form input { background: #26282d; border-color: #8fa6ff4d; color: #e8ebf5; }
body[data-ds-dark-theme] .dshcal-foot button { background: #d97aa826; color: #f0a9c6; }
body[data-ds-dark-theme] .dshcal-foot button:hover { background: #d97aa83d; }
body[data-ds-dark-theme] #dshcal-card header button { color: #e8ebf5a8; }
`;

/* ---------------- 모바일 판정 ----------------
   두 신호 중 하나라도 참이면 모바일로 본다.
     1) 주 입력이 터치: (hover: none) and (pointer: coarse)
        폰·태블릿은 화면이 넓은 가로 모드여도 숨긴다. 이 위젯은 position: fixed 오버레이라
        좁은 화면에서 본문 대화를 덮어 가리기 때문이다.
     2) 터치를 지원하는 기기(navigator.maxTouchPoints)에서 뷰포트가 NARROW보다 좁은 경우
        태블릿의 '데스크톱 웹사이트' 모드처럼 pointer 미디어쿼리가 fine으로 보고되는 기기를 잡는다.
   데스크톱에서 창만 좁힌 경우(터치 미지원, maxTouchPoints 0)는 데스크톱으로 남긴다. 근거는 두 가지다.
     - 사용자가 잠깐 만드는 상태이고, 그 상태에서도 사이드바 발판(findAnchor)이 그대로 있어
       위젯이 자기 자리에 붙는다.
     - 이 플러그인은 데스크톱 동작을 바꾸지 않는 것을 전제로 한다. 폭이 좁아지면 위젯 폭도 함께 준다.
   터치 지원 노트북·컨버터블은 창을 좁히면 2번에 걸려 숨겨진다 — 그 자세는 사실상 태블릿 사용으로 본다.
   UA 문자열은 스푸핑에 약하고 태블릿·데스크톱 모드를 구분하지 못해 쓰지 않는다.
   MQ_COARSE.matches는 라이브 값이라 place()가 매 프레임 읽으면 회전·창 크기 변화에 따로 리스너를 두지
   않아도 따라간다. */
const NARROW = 768;                       // 이 폭보다 좁으면 '좁은 화면'으로 보는 관용적 분기점
const MQ_COARSE = typeof matchMedia === "function" ? matchMedia("(hover: none) and (pointer: coarse)") : null;
const hasTouch = () => (navigator.maxTouchPoints || 0) > 0 || "ontouchstart" in window;
const isMobile = () => (!!MQ_COARSE && MQ_COARSE.matches) || (hasTouch() && innerWidth < NARROW);

/* ---------------- 배치 판정 ----------------
   이 위젯은 position: fixed 오버레이라 사이드바 "위에" 뜬다. 그러니 크기를 뷰포트가 아니라
   사이드바가 정하게 해야 한다. 창을 세로로 줄였을 때 크기가 그대로여서 위쪽 버튼(플러그인·
   자동화 작업·작업 대상)과 세션 목록을 가리던 원인은 상한을 `발판.top - 24`로 잡은 것이었다.
   발판은 화면 맨 아래에 있어 그 값은 사실상 뷰포트 높이이고, 패널 자연 높이(~330px)가 늘
   그보다 작아 상한이 한 번도 걸리지 않았다.

   그래서 판정 기준을 이렇게 바꾼다.
     - 아래 경계: 발판 위 8px
     - 위 경계: 세션 목록 스크롤 영역의 위쪽(없으면 열 상단 + 176px 안전대) → 위쪽 아이콘 줄은 절대 덮지 않는다
     - 세로 상한: 사이드바 열 높이의 42%, 최대 380px → 창을 줄이면 여기도 같이 줄어든다
     - 두 경계 사이가 MIN_VIS보다 좁으면 아예 그리지 않는다(그리면 버튼을 가릴 수밖에 없다)
   DOM은 건드리지 않는 순수 계산이라 테스트로 고정한다. */
const LAYOUT = { minVis: 200, minPanel: 160, maxPanel: 380, ratio: 0.42, gap: 8, fallbackTop: 176, minWidth: 160 };
function layoutDecision({ innerWidth, innerHeight, anchor, column, scrollBox, mobile }) {
  if (mobile) return null;
  const hasAnchor = anchor && anchor.width > 0 && anchor.height > 0;
  if (!hasAnchor) return null;
  /* 접힌 사이드바(발판 폭 ≈56px)에서는 달력이 본문을 덮으므로 그리지 않는다. */
  if (anchor.width < LAYOUT.minWidth) return null;
  const width = Math.max(LAYOUT.minWidth, anchor.width);
  const columnH = column && column.height > 0 ? column.height : innerHeight;
  const columnTop = column && column.height > 0 ? column.top : 0;
  const lower = anchor.top - LAYOUT.gap;
  const upper = scrollBox && scrollBox.height > 0
    ? Math.max(scrollBox.top + LAYOUT.gap, columnTop + 32)
    : columnTop + LAYOUT.fallbackTop;
  const room = Math.round(lower - upper);
  if (room < LAYOUT.minVis) return null;
  const availH = Math.max(LAYOUT.minPanel, Math.min(room, LAYOUT.maxPanel, Math.round(columnH * LAYOUT.ratio)));
  return {
    left: Math.round(anchor.left),
    width: Math.round(width),
    availH,
    bottom: Math.round(innerHeight - lower),
  };
}

/* ---------------- 유틸 ---------------- */
function createLifetime() {
  let stopped = false;
  const cleanups = [], timers = new Set(), frames = new Set();
  const add = (fn) => { if (stopped) fn(); else cleanups.push(fn); };
  const timeout = (fn, ms) => { if (stopped) return 0; const id = setTimeout(() => { timers.delete(id); if (!stopped) fn(); }, ms); timers.add(id); return id; };
  const frame = (fn) => { if (stopped) return 0; const id = requestAnimationFrame((t) => { frames.delete(id); if (!stopped) fn(t); }); frames.add(id); return id; };
  const listen = (target, type, fn, opts) => { if (stopped) return; target.addEventListener(type, fn, opts); add(() => target.removeEventListener(type, fn, opts)); };
  return {
    add, timeout, frame, listen,
    get stopped() { return stopped; },
    dispose() {
      if (stopped) return;
      stopped = true;
      for (const id of timers) clearTimeout(id);
      for (const id of frames) cancelAnimationFrame(id);
      for (const fn of cleanups.reverse()) { try { fn(); } catch (e) { console.warn("dsh-calendar cleanup:", e); } }
    },
  };
}

function apply(ctx) {
  window[SLOT]?.();
  const life = createLifetime();
  const dispose = () => { if (window[SLOT] !== dispose) return; life.dispose(); delete window[SLOT]; };
  window[SLOT] = dispose;
  ctx.effect(() => dispose, PLUGIN_ID + ": client");

  try {
    /* 스타일 주입 */
    if (!document.getElementById("dshcal-style")) {
      const st = document.createElement("style");
      st.id = "dshcal-style"; st.textContent = CSS;
      document.head.append(st);
    }
    life.add(() => { const s = document.getElementById("dshcal-style"); if (s) s.remove(); });

    /* 위젯 DOM */
    const root = document.createElement("div");
    root.id = "dshcal-root";
    root.innerHTML = `<div id="dshcal-panel">
      <div class="dshcal-head"><button type="button" data-nav="-1">‹</button><span class="dshcal-title"></span><button type="button" data-nav="1">›</button></div>
      <div class="dshcal-grid dshcal-wd">${WD.map((w) => `<span>${w}</span>`).join("")}</div>
      <div class="dshcal-grid dshcal-days"></div>
      <div class="dshcal-sel">
        <div class="dshcal-sel-head"><span class="dshcal-sel-date"></span><span class="dshcal-sel-cnt"></span></div>
        <div class="dshcal-sel-list"></div>
        <button id="dshcal-add" type="button">＋ 일정 추가</button>
      </div>
    </div>`;
    const modal = document.createElement("div");
    modal.id = "dshcal-modal";
    modal.innerHTML = `<div id="dshcal-card">
      <header><h2 class="dshcal-card-title">일정 추가</h2><button type="button" data-close aria-label="닫기">✕</button></header>
      <form class="dshcal-form">
        <input class="dshcal-wide" name="evtitle" placeholder="일정 제목" maxlength="120" required>
        <label class="dshcal-range"><input name="evdate" type="date" aria-label="시작일" required><i>~</i><input name="evend" type="date" aria-label="종료일"></label>
        <input name="evtime" type="time" aria-label="시작 시간">
        <button type="submit" data-submit>추가</button>
      </form>
      <p class="dshcal-hint">종료일을 비우면 하루 일정으로 저장됩니다.</p>
      <footer class="dshcal-foot"><button type="button" data-del>일정 삭제</button></footer>
    </div>`;
    document.body.append(root, modal);
    life.add(() => { root.remove(); modal.remove(); });

    /* 상태 + 노드 참조 */
    const now0 = new Date();
    let viewY = now0.getFullYear(), viewM = now0.getMonth();
    let selected = todayStr();
    let editingId = null;

    const titleEl = root.querySelector(".dshcal-title");
    const daysBox = root.querySelector(".dshcal-days");
    const selDateEl = root.querySelector(".dshcal-sel-date");
    const selCntEl = root.querySelector(".dshcal-sel-cnt");
    const selList = root.querySelector(".dshcal-sel-list");
    const form = modal.querySelector(".dshcal-form");
    const cardTitle = modal.querySelector(".dshcal-card-title");
    const foot = modal.querySelector(".dshcal-foot");
    const fTitle = form.querySelector('[name="evtitle"]');
    const fDate = form.querySelector('[name="evdate"]');
    const fEnd = form.querySelector('[name="evend"]');
    const fTime = form.querySelector('[name="evtime"]');
    const fSubmit = form.querySelector("[data-submit]");

    /* 달력 렌더 */
    function renderCal() {
      titleEl.textContent = `${viewY}. ${pad2(viewM + 1)}`;
      const first = new Date(viewY, viewM, 1).getDay();
      const nDays = new Date(viewY, viewM + 1, 0).getDate();
      const today = todayStr();
      let html = "";
      for (let i = 0; i < first; i++) html += `<button class="dshcal-day blank" type="button" tabindex="-1"></button>`;
      for (let d = 1; d <= nDays; d++) {
        const key = ymd(viewY, viewM, d);
        const wd = new Date(viewY, viewM, d).getDay();
        const starts = entries.filter((e) => e.date === key);
        const cnt = starts.length;
        const holi = holidayName(key);
        /* 기간 일정의 가운데 날짜는 옅은 밴드만 칠해 '이어지는 중'임을 표시한다. */
        const cont = !cnt && byDate(key).length > 0;
        const cls = ["dshcal-day",
          wd === 0 ? "sun" : wd === 6 ? "sat" : "",
          holi ? "holi" : "",
          cnt ? (cnt >= 3 ? "has3" : cnt === 2 ? "has2" : "has") : cont ? "cont" : "",
          key === today ? "today" : "", key === selected ? "sel" : ""].filter(Boolean).join(" ");
        const bars = cnt ? `<span class="dshcal-bars">${
          Array.from({ length: Math.min(cnt, 3) }, (_, i) => `<i${cnt > 3 && i === Math.min(cnt, 3) - 1 ? ' class="fade"' : ""}></i>`).join("")
        }</span>` : "";
        /* 팝업이 없으니 네이티브 툴팁으로 그 날의 내용(공휴일 + 일정 수)만 알려준다. */
        const cover = byDate(key).length;
        const tip = esc([holi, cover ? `일정 ${cover}건` : ""].filter(Boolean).join(" · "));
        html += `<button class="${cls}" type="button" data-date="${key}"${tip ? ` title="${tip}"` : ""}>${d}${bars}</button>`;
      }
      daysBox.innerHTML = html;
    }

    /* 배치: 사이드바 하단 영역(설정/'더 보기' 줄이 있는 footArea) 바로 위.
       '더 보기' 텍스트는 상단 패널 목록에도 있어 텍스트 매칭만으론 오배치되므로
       클래스 셀렉터를 1순위로 하고, 하단 좌측 구역 안의 텍스트 매칭만 폴백으로 쓴다. */
    function findAnchor() {
      const inLeftFooter = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.left < 80 && r.top > innerHeight * 0.5 ? el : null;
      };
      const foot = inLeftFooter(document.querySelector('[class*="_footArea"]'));
      if (foot) return foot;
      const norm = (el) => (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").trim().replace(/\s+/g, "");
      let hit = null;
      for (const el of document.querySelectorAll("button,[role=button]")) {
        if (/^(더보기|more)$/i.test(norm(el)) && inLeftFooter(el)) hit = el;
      }
      if (hit) return hit;
      let best = null, bestTop = 0;
      for (const el of document.querySelectorAll("button,[role=button]")) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.left < 40 && r.top > innerHeight - 160 && r.top > bestTop) { best = el; bestTop = r.top; }
      }
      return best;
    }
    /* --- 사이드바 실측 --- */
    /* 발판에서 위로 올라가며 "세로로 긴 사이드바 열"을 찾는다. 열 높이가 위젯 크기의 기준이다. */
    const findColumn = (anchor) => {
      let el = anchor && anchor.parentElement;
      for (let i = 0; el && i < 10; i++, el = el.parentElement) {
        const b = el.getBoundingClientRect();
        if (b.height >= innerHeight * 0.6 && b.width > 140 && b.width < innerWidth * 0.5) return el;
      }
      return null;
    };
    /* 열 안에서 실제로 스크롤되는 가장 큰 영역(세션 목록)을 찾는다. 클래스명은 셸 빌드마다 바뀌므로
       계산된 스타일(overflow-y)과 scrollHeight로 판별한다. */
    const findScrollBox = (column) => {
      let best = null, bestArea = 0;
      for (const el of column.querySelectorAll("div")) {
        if (el === root || root.contains(el)) continue;
        if (!/(auto|scroll)/.test(getComputedStyle(el).overflowY)) continue;
        const b = el.getBoundingClientRect();
        if (b.height < 120 || b.width < 120) continue;
        if (el.scrollHeight <= el.clientHeight + 4) continue;
        const area = b.width * b.height;
        if (area > bestArea) { best = el; bestArea = area; }
      }
      return best;
    };
    let boxEl = null, boxKey = "";
    const scrollBoxFor = (column) => {
      const vp = innerWidth + "x" + innerHeight;
      if (boxEl && boxEl.isConnected && boxKey === vp && column.contains(boxEl)) return boxEl;
      boxEl = findScrollBox(column); boxKey = vp;
      return boxEl;
    };
    /* 위젯이 목록 위에 뜨므로, 목록 스크롤 영역에 아래 여백을 예약해 마지막 행이 가리지 않게 한다. */
    let paddedEl = null, paddedOrig = "", padValue = "";
    const clearReserve = () => {
      if (paddedEl && paddedEl.isConnected) paddedEl.style.paddingBottom = paddedOrig;
      paddedEl = null; paddedOrig = ""; padValue = "";
    };
    life.add(clearReserve);
    const reserveSpace = (el, px) => {
      if (!el) { clearReserve(); return; }
      if (paddedEl !== el) { clearReserve(); paddedEl = el; paddedOrig = el.style.paddingBottom; }
      padValue = px + "px";
      el.style.paddingBottom = padValue;
    };
    const rectOf = (el) => {
      const b = el && el.getBoundingClientRect();
      return b ? { left: b.left, top: b.top, width: b.width, height: b.height } : null;
    };

    let lastKey = "";
    const place = () => {
      if (life.stopped) return;
      const more = findAnchor();
      const columnEl = more ? findColumn(more) : null;
      const boxElNow = columnEl ? scrollBoxFor(columnEl) : null;
      /* 모바일 판정·접힘 판정·경계 계산은 모두 layoutDecision이 한다. 여기가 .show를 붙이는
         유일한 자리라, 진입점(자동 배치)과 패널(#dshcal-root)이 한 번에 막힌다. */
      const pick = layoutDecision({
        innerWidth, innerHeight,
        anchor: rectOf(more), column: rectOf(columnEl), scrollBox: rectOf(boxElNow),
        mobile: isMobile(),
      });
      const key = pick
        ? [pick.left, pick.width, pick.availH, pick.bottom, innerWidth, innerHeight, boxElNow ? 1 : 0].join("|")
        : "hidden";
      if (key !== lastKey) {
        lastKey = key;
        if (pick) {
          root.classList.add("show");
          root.style.left = pick.left + "px";
          root.style.width = pick.width + "px";
          root.style.bottom = pick.bottom + "px";
          root.style.setProperty("--dshcal-avail", pick.availH + "px");
          /* 실제로 그려진 높이만큼만 목록 아래 여백을 예약한다(짧은 달에 과하게 비우지 않는다). */
          const panelEl = root.firstElementChild;
          const drawn = panelEl ? Math.round(panelEl.getBoundingClientRect().height) : pick.availH;
          reserveSpace(boxElNow, Math.min(pick.availH, drawn) + 12);
        } else {
          root.classList.remove("show");
          clearReserve();
          /* 회전·창 크기로 그릴 수 없게 되는 동안 일정 창이 열려 있으면 같이 닫는다.
             저장된 일정은 localStorage에 그대로 남고, 닫는 것은 화면에서만 사라지는 것이다. */
          if (modal.classList.contains("show")) closeModal();
        }
      }
      /* 셸이 목록 영역을 다시 그리며 인라인 스타일을 덮을 수 있다. 매 프레임 문자열로만 확인하고
         필요할 때만 되돌린다(레이아웃 읽기 없음). */
      if (padValue) {
        if (paddedEl && paddedEl.style.paddingBottom !== padValue) paddedEl.style.paddingBottom = padValue;
      } else if (paddedEl) clearReserve();
      /* 숨겨져도 배치 루프는 계속 돌린다: 좁은 화면에서 다시 넓어졌을 때 앵커를 찾아 그대로 복원하려면
         다음 프레임의 재판정이 필요하다. (판정만 하고 DOM은 건드리지 않는다.) */
      life.frame(place);
    };
    life.frame(place);

    /* 달력 조작 */
    root.querySelector(".dshcal-head").addEventListener("click", (ev) => {
      const nav = ev.target.dataset && ev.target.dataset.nav;
      if (nav) { viewM += +nav; if (viewM < 0) { viewM = 11; viewY--; } if (viewM > 11) { viewM = 0; viewY++; } renderCal(); return; }
      if (ev.target === titleEl) { const t = new Date(); viewY = t.getFullYear(); viewM = t.getMonth(); selected = todayStr(); renderCal(); renderSel(); }
    });
    daysBox.addEventListener("click", (ev) => {
      const cell = ev.target.closest(".dshcal-day");
      if (!cell || cell.classList.contains("blank")) return;
      selected = cell.dataset.date;
      renderCal(); renderSel();
    });

    /* 선택 날짜의 일정 목록: 3개까지 보이고 넘치면 스크롤 */
    function renderSel() {
      const holi = holidayName(selected);
      selDateEl.innerHTML = `${dateLabel(selected)}${holi ? ` <i class="dshcal-sel-holi">${esc(holi)}</i>` : ""}`;
      const items = byDate(selected);
      selCntEl.textContent = items.length ? `${items.length}건` : "";
      selList.innerHTML = items.length
        ? items.map((e) => `<div class="dshcal-li" data-id="${esc(e.id)}" title="${esc(e.title)}">
          <em>${esc(e.time || (e.end ? "기간" : "종일"))}</em>
          <span class="dshcal-li-t">${esc(e.title)}${e.end ? `<small>${esc(spanLabel(e))}</small>` : ""}</span>
          <button class="dshcal-li-x" type="button" data-li-del aria-label="삭제">✕</button>
        </div>`).join("")
        : `<div class="dshcal-li-empty">이 날의 일정이 없습니다</div>`;
    }
    selList.addEventListener("click", (ev) => {
      const row = ev.target.closest(".dshcal-li");
      if (!row || !row.dataset.id) return;
      if (ev.target.closest("[data-li-del]")) { removeEntry(row.dataset.id); return; }
      const e = entries.find((x) => x.id === row.dataset.id);
      if (e) openForm(e);
    });

    /* 일정 추가 / 수정 팝업 */
    function openForm(entry) {
      if (isMobile()) return;   // 가려진 상태에서는 열지 않는다 (진입점은 display:none으로 이미 막혀 있다)
      editingId = entry ? entry.id : null;
      fTitle.value = entry ? entry.title : "";
      fDate.value = entry ? entry.date : selected || todayStr();
      fEnd.value = entry && entry.end ? entry.end : "";
      fEnd.min = fDate.value;
      fTime.value = entry ? entry.time || "" : "";
      cardTitle.textContent = entry ? "일정 수정" : "일정 추가";
      fSubmit.textContent = entry ? "저장" : "추가";
      foot.classList.toggle("show", !!entry);
      modal.classList.add("show");
      fTitle.focus();
    }
    function closeModal() { modal.classList.remove("show"); }
    life.listen(root.querySelector("#dshcal-add"), "click", () => openForm(null));
    modal.addEventListener("click", (ev) => {
      if (ev.target === modal || ev.target.closest("[data-close]")) { closeModal(); return; }
      if (ev.target.closest("[data-del]") && editingId) { removeEntry(editingId); closeModal(); }
    });
    /* 종료일이 시작일보다 앞설 수 없게 최소값을 맞춘다. */
    form.addEventListener("input", (ev) => {
      if (ev.target === fDate) fEnd.min = fDate.value;
      if (ev.target === fEnd && fDate.value && fEnd.value < fDate.value) fEnd.value = fDate.value;
    });
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const t = fTitle.value.trim();
      if (!t || !fDate.value) return;
      const end = fEnd.value && fEnd.value > fDate.value ? fEnd.value : "";
      if (editingId) updateEntry(editingId, { title: t, date: fDate.value, end, time: fTime.value || "" });
      else addEntry(fDate.value, end, fTime.value, t);
      selected = fDate.value;
      viewY = +fDate.value.slice(0, 4); viewM = +fDate.value.slice(5, 7) - 1;
      closeModal();
    });
    life.listen(document, "keydown", (ev) => { if (ev.key === "Escape" && modal.classList.contains("show")) closeModal(); });

    /* 변경 반영 + 저장 */
    const refresh = () => { renderCal(); renderSel(); };
    listeners.add(refresh);
    life.add(() => listeners.delete(refresh));
    life.listen(window, "storage", (ev) => { if (ev.key === null || ev.key === STORE_KEY || LEGACY_STORE_KEYS.includes(ev.key)) { entries = loadEntries(); emit(); } });

    renderCal(); renderSel();
  } catch (error) { dispose(); throw error; }
}

exports.inject = [];
exports.apply = apply;

return module.exports;
} });
