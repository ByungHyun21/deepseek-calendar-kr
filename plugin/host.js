import z from '@deepseek-ai/schemastery'

export const name = 'dsh-calendar'
export const inject = []

// 호스트 쪽에서는 설정만 노출하고 아무 작업도 하지 않는다. 모든 동작은 클라이언트(client.js)에서 DOM으로 수행한다.
export const Config = z.object({})

export function apply() {}
