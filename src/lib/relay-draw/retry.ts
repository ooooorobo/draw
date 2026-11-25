/**
 * 429 대기·재시도 공통. 서버 지침: Retry-After만큼 기다리고, 자동 재시도는 최대 3회.
 * 쓰기 요청(방·캐릭터 생성, 제출)은 여기로 자동 재전송하지 않는다.
 */
import { isThrottled } from './errors.ts'

export const MAX_AUTO_RETRIES = 3
const DEFAULT_RETRY_AFTER_SECONDS = 3

/** 429 응답이 기다리라고 한 시간(ms). 헤더가 없으면 3초. */
export function retryAfterMs(error: unknown): number {
  const seconds = isThrottled(error) ? error.retryAfterSeconds : undefined
  return (seconds ?? DEFAULT_RETRY_AFTER_SECONDS) * 1000
}

/** 같은 순간에 몰린 클라이언트가 동시에 다시 부르지 않게 0~1초를 더한다. */
export function jitterMs(): number {
  return Math.random() * 1000
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal!.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** 조회처럼 다시 불러도 안전한 요청만 감싼다. 429일 때만 기다렸다가 최대 3회 다시 부른다. */
export async function retryThrottled<T>(load: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await load()
    } catch (error) {
      if (!isThrottled(error) || attempt >= MAX_AUTO_RETRIES || signal?.aborted) throw error
      await sleep(retryAfterMs(error) + jitterMs(), signal)
    }
  }
}
