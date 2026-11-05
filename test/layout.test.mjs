import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "client.js"), "utf8");

/* 배치 판정 구역만 잘라 그대로 실행한다. DOM을 건드리지 않는 순수 계산이라 Node에서 돌아간다.
   경계는 client.js의 구역 주석이며, 구역이 바뀌면 이 테스트가 즉시 실패한다. */
const START = "/* ---------------- 배치 판정 ----------------";
const END = "/* ---------------- 유틸 ---------------- */";
const startAt = source.indexOf(START);
const endAt = source.indexOf(END);
assert.ok(startAt >= 0, "배치 판정 구역 시작 주석을 찾지 못했습니다");
assert.ok(endAt > startAt, "배치 판정 구역 끝 주석을 찾지 못했습니다");
const api = new Function(`${source.slice(startAt, endAt)}\nreturn { layoutDecision, LAYOUT };`)();

const base = {
  innerWidth: 1440,
  innerHeight: 900,
  mobile: false,
  anchor: { left: 12, top: 850, width: 240, height: 36 },
  column: { top: 0, height: 900 },
  scrollBox: { top: 200, width: 280, height: 640 },
};

test("긴 창: 세로 상한은 열 높이의 42%와 380px 중 작은 값", () => {
  const pick = api.layoutDecision(base);
  assert.equal(pick.availH, 378, "900px 열의 42% = 378px");
  assert.equal(pick.width, 240, "폭은 발판 폭을 따른다");
  assert.equal(pick.left, 12);
  assert.equal(pick.bottom, 58, "아래 끝은 발판 위 8px(뷰포트 바닥에서 58px)");
});

test("창을 세로로 줄이면 달력 높이도 줄어든다", () => {
  const tall = api.layoutDecision(base);
  const short = api.layoutDecision({
    ...base,
    innerHeight: 640,
    anchor: { ...base.anchor, top: 610 },
    column: { top: 0, height: 640 },
    scrollBox: { top: 200, width: 280, height: 380 },
  });
  assert.ok(short, "640px 창에서도 그려져야 한다");
  assert.ok(short.availH < tall.availH, `높이가 줄어야 하는데 ${tall.availH} → ${short.availH}`);
  assert.equal(short.availH, 269, "640px의 42% = 269px");
  assert.equal(short.bottom, 38, "아래 끝은 발판 위 8px(640px 창에서 38px)");
  assert.ok(short.availH <= 610 - 8, "위젯이 발판 위 공간(602px)을 넘지 않는다");
});

test("위 경계는 세션 목록 스크롤 영역의 위쪽이라 위 아이콘 줄은 덮지 않는다", () => {
  /* 스크롤 영역이 열 상단보다 아래(200px)에서 시작하고 발판이 850px이면,
     세로 상한(378)이 먼저 걸린다. 스크롤 영역을 훨씬 아래로 내리면 상한도 내려간다. */
  const wide = api.layoutDecision(base);
  /* 목록 위 경계를 600px로 내리면 위로 쓸 수 있는 공간이 842-608=234px로 줄어 상한도 따라 준다. */
  const narrow = api.layoutDecision({ ...base, scrollBox: { top: 600, width: 280, height: 240 } });
  assert.ok(narrow, "234px가 남으면 그린다");
  assert.equal(narrow.availH, 234, "위 경계가 내려오면 높이 상한도 내려온다");
  assert.ok(narrow.availH <= wide.availH);
  assert.ok(narrow.availH <= 850 - 8 - 608, `목록 위 경계를 넘지 않아야 하는데 ${narrow.availH}`);
});

test("공간이 너무 좁으면 그리지 않는다", () => {
  const pick = api.layoutDecision({
    innerWidth: 800, innerHeight: 380, mobile: false,
    anchor: { left: 12, top: 350, width: 240, height: 30 },
    column: { top: 0, height: 380 },
    scrollBox: { top: 180, width: 260, height: 160 },
  });
  assert.equal(pick, null, "남는 높이가 200px 미만이면 숨긴다");
});

test("접힌 사이드바·모바일·앵커 없음은 숨긴다", () => {
  const collapsed = api.layoutDecision({ ...base, anchor: { ...base.anchor, width: 56 } });
  assert.equal(collapsed, null, "발판 폭 56px(접힘)에서는 숨긴다");
  const mobile = api.layoutDecision({ ...base, mobile: true });
  assert.equal(mobile, null, "모바일에서는 숨긴다");
  const noAnchor = api.layoutDecision({ ...base, anchor: null });
  assert.equal(noAnchor, null, "발판이 없으면 숨긴다");
});

test("스크롤 영역을 못 찾아도 안전대(열 상단+176px)로 판정한다", () => {
  const pick = api.layoutDecision({ ...base, scrollBox: null });
  assert.ok(pick);
  assert.equal(pick.availH, 378);
});

test("최소 패널 높이는 보장하되 공간보다 크게 그리지 않는다", () => {
  const pick = api.layoutDecision({
    innerWidth: 800, innerHeight: 500, mobile: false,
    anchor: { left: 12, top: 420, width: 240, height: 30 },
    column: { top: 0, height: 300 },
    scrollBox: null,
  });
  assert.ok(pick);
  assert.equal(pick.availH, api.LAYOUT.minPanel, "42%(126px)보다 최소 높이를 우선한다");
  assert.ok(pick.availH <= 420 - 8, "발판 위 공간을 넘지 않는다");
});

test("도킹 가능하면 흐름 배치를 고른다(겹침 없음)", () => {
  const pick = api.layoutDecision({ ...base, dockable: true });
  assert.equal(pick.mode, "docked", "사이드바 흐름에 끼워 넣는 모드여야 한다");
  assert.equal(pick.availH, 378);
  assert.equal(pick.width, 240, "도킹 시에도 폭 기준은 발판 폭");
});

test("도킹 시에도 세로 상한은 열 높이의 42%", () => {
  const tall = api.layoutDecision({ ...base, dockable: true });
  const short = api.layoutDecision({
    ...base, dockable: true,
    anchor: { ...base.anchor, top: 490 },
    column: { top: 0, height: 500 },
  });
  assert.equal(short.mode, "docked");
  assert.equal(short.availH, 210, "500px의 42% = 210px");
  assert.ok(short.availH < tall.availH, "창을 줄이면 도킹 높이도 줄어든다");
});

test("도킹 시 열이 320px 미만이면 숨긴다(목록이 남지 않으므로)", () => {
  const pick = api.layoutDecision({ ...base, dockable: true, column: { top: 0, height: 300 } });
  assert.equal(pick, null);
});

test("도킹 불가(열이 흐름 컨테이너가 아님)면 오버레이로 폴백한다", () => {
  const pick = api.layoutDecision({ ...base, dockable: false });
  assert.equal(pick.mode, "overlay");
  assert.ok(pick.availH >= api.LAYOUT.minPanel);
});
