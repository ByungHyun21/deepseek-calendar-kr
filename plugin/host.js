import z from '@deepseek-ai/schemastery'

export const name = 'dsh-calendar'
export const inject = []

// 설정은 호스트가 보관하고 브라우저가 읽는다. 값에 따른 판단과 숨김은 전부 client.js에서 DOM으로 수행하고,
// 호스트는 값을 저장해 두기만 한다(아래 apply는 여전히 아무 작업도 하지 않는다).
// .volatile()은 다른 DSH 플러그인(deepseek-harness-kr)의 사용자 토글과 같은 형태를 따랐다.
export const Config = z.object({
  // 기본값 true = 모바일에서 달력 위젯을 보여주지 않는다. 끄면 예전처럼 모든 화면에서 보인다.
  // 어떤 화면을 모바일로 볼지는 client.js의 '모바일 판정' 주석에 규칙으로 적어 두었다.
  hideOnMobile: z.boolean().default(true).volatile(),
})

// 호스트 쪽에서는 아무 작업도 하지 않는다. 모든 동작은 클라이언트(client.js)에서 DOM으로 수행한다.
// 외부 의존성을 두지 말 것: link 설치에서는 Node가 패키지의 실체 경로에서 모듈을 탐색하므로
// 프로필 node_modules에 있는 의존성을 찾지 못해 활성화 자체가 실패한다.
// 예외는 설정 스키마를 선언하는 @deepseek-ai/schemastery 하나뿐이다(package.json의 dependencies에 선언하고,
// 워크스페이스 폴더를 그대로 설치한 경우에는 그 폴더에서 의존성을 한 번 설치해 주어야 풀린다).
export function apply() {}
