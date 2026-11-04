export const name = 'dsh-calendar'
export const inject = []

// 호스트 쪽에서는 아무 작업도 하지 않는다. 모든 동작은 클라이언트(client.js)에서 DOM으로 수행한다.
// 외부 의존성을 두지 말 것: link 설치에서는 Node가 패키지의 실체 경로에서 모듈을 탐색하므로
// 프로필 node_modules에 있는 의존성을 찾지 못해 활성화 자체가 실패한다.
export function apply() {}
