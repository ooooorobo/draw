import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from './relay-draw/client.ts'

/**
 * 서버 호출 상태. 화면은 이 네 가지만 구분하면 된다.
 * 로딩 라이브러리를 더 넣을 이유가 없어서 직접 쓴다.
 */
export type Async<T> =
  | { state: 'loading' }
  | { state: 'ready'; data: T }
  | { state: 'error'; error: ApiError | Error }

/** 사용자에게 보여줄 메시지. 서버가 한국어 message를 주므로 그대로 쓴다. */
export function errorMessage(error: ApiError | Error): string {
  return error.message
}

/** 서버 오류 코드. 화면 분기(만료/종료/권한)에 쓴다. */
export function errorCode(error: ApiError | Error): string | null {
  return error instanceof ApiError ? error.code : null
}

/**
 * 마운트 시 1회 조회. deps가 바뀌면 다시 조회하고 이전 요청은 중단한다.
 * reload로 수동 재조회한다(예외 화면의 "다시 시도").
 */
export function useAsync<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): Async<T> & { reload: () => void } {
  const [result, setResult] = useState<Async<T>>({ state: 'loading' })
  const [nonce, setNonce] = useState(0)

  // fetcher는 매 렌더 새로 만들어지는 화살표 함수라 deps에 넣으면 무한 루프가 된다.
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => {
    const controller = new AbortController()
    setResult({ state: 'loading' })

    fetcherRef
      .current(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult({ state: 'ready', data })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        // AbortError는 화면 전환으로 인한 정상 취소다. 오류로 표시하지 않는다.
        if (error instanceof DOMException && error.name === 'AbortError') return
        setResult({
          state: 'error',
          error: error instanceof Error ? error : new Error(String(error)),
        })
      })

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { ...result, reload }
}
