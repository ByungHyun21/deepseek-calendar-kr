import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "client.js"), "utf8");

/* 공휴일 계산 구역만 잘라 Node에서 그대로 실행한다(브라우저 없이 회귀 검증).
   경계는 client.js의 구역 주석이며, 구역이 바뀌면 이 테스트가 즉시 실패한다.
   shiftKey가 쓰는 pad2/ymd는 구역 밖(유틸)에 있으므로 앞에 붙여 준다. */
const START = 'const WD = ["일", "월", "화", "수", "목", "금", "토"];';
const END = "/* ---------------- 일정 저장소 (localStorage) ---------------- */";
const startAt = source.indexOf(START);
const endAt = source.indexOf(END);
assert.ok(startAt >= 0, "공휴일 구역 시작 주석을 찾지 못했습니다");
assert.ok(endAt > startAt, "공휴일 구역 끝 주석을 찾지 못했습니다");
const slice = source.slice(startAt, endAt);

const helpers = [
  'const pad2 = (n) => String(n).padStart(2, "0");',
  'const ymd = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;',
].join("\n");

const api = new Function(`${helpers}\n${slice}\nreturn { holidaysFor, holidayName };`)();
const marks = (year) => api.holidaysFor(year);

/** @param {number} year @param {string} key YYYY-MM-DD */
const isHoliday = (year, key) => marks(year).has(key);

test("음력 설날 앵커 7년치가 KST 신월 날짜와 일치한다", () => {
  /* 2028·2030은 신월이 KST 자정 직후라 중국(CST) 표와 하루 갈린다.
     2028 설날 = 2028-01-27 00:12 KST(중국 01-26), 2030 설날 = 2030-02-03 01:07 KST. */
  const expected = {
    2024: "02-10",
    2025: "01-29",
    2026: "02-17",
    2027: "02-07",
    2028: "01-27",
    2029: "02-13",
    2030: "02-03",
  };
  for (const [year, mmdd] of Object.entries(expected)) {
    const key = `${year}-${mmdd}`;
    assert.ok(isHoliday(Number(year), key), `${key} 설날이 공휴일로 계산되지 않았습니다`);
  }
});

test("2028 설날 연휴는 1/26~1/28이고 1/25는 공휴일이 아니다", () => {
  for (const key of ["2028-01-26", "2028-01-27", "2028-01-28"]) {
    assert.ok(isHoliday(2028, key), `${key} 연휴가 빠졌습니다`);
  }
  assert.equal(isHoliday(2028, "2028-01-25"), false, "1/25는 평일인데 공휴일로 계산됐습니다");
  /* 설날 연휴가 일요일과 겹치지 않으므로 대체공휴일이 없어야 한다. */
  assert.equal(isHoliday(2028, "2028-01-31"), false, "2028년 설날 대체공휴일이 잘못 생겼습니다");
});

test("2030 설날 연휴와 대체공휴일은 2/2~2/4 + 2/5이다", () => {
  for (const key of ["2030-02-02", "2030-02-03", "2030-02-04"]) {
    assert.ok(isHoliday(2030, key), `${key} 연휴가 빠졌습니다`);
  }
  assert.equal(marks(2030).get("2030-02-05"), "대체공휴일", "2030 대체공휴일은 2/5여야 합니다");
  assert.equal(isHoliday(2030, "2030-02-06"), false, "2/6은 대체공휴일이 아닙니다");
});

test("알려진 대체공휴일이 규칙대로 계산된다", () => {
  const expected = [
    ["2024-02-12", "2024년 설날 연휴(일요일 겹침)"],
    ["2024-05-06", "2024년 어린이날(일요일)"],
    ["2025-05-06", "2025년 어린이날·부처님오신날 중복"],
    ["2025-10-08", "2025년 추석 연휴(일요일 겹침)"],
    ["2026-05-25", "2026년 부처님오신날(일요일)"],
  ];
  for (const [key, why] of expected) {
    assert.equal(marks(Number(key.slice(0, 4))).get(key), "대체공휴일", `${key} 대체공휴일 누락: ${why}`);
  }
});

test("선거일(임기만료)이 공휴일로 표시된다", () => {
  for (const key of ["2024-04-10", "2025-06-03", "2026-06-03", "2028-04-12"]) {
    assert.equal(marks(Number(key.slice(0, 4))).get(key), "선거일", `${key} 선거일 누락`);
  }
});

test("저장 키는 정상 문자열이고 구 키는 마이그레이션 경로로 남아 있다", () => {
  assert.ok(
    source.includes('const STORE_KEY = "dsh-calendar:entries:v1";'),
    "저장 키가 정상 문자열이 아닙니다",
  );
  assert.ok(
    source.includes('const LEGACY_STORE_KEYS = ["dsh-calenda...(revoked token)"];'),
    "구 키 마이그레이션 목록이 사라졌습니다",
  );
});
