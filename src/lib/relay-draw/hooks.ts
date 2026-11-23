/**
 * 화면용 React 훅. 로딩·오류 상태와 폴링만 담당하고, 화면 전이는 호출한 화면이 errors.ts로 정한다.
 */
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import type { RoomV2, SceneV2 } from './api-v2.ts'
import { resolveEntry, type Entry } from './entry.ts'
import { loadScene, remainingLabel, remainingRatio } from './screens.ts'

export type AsyncState<T> =
  | { status: 'loading'; data: T | null; error: null }
  | { status: 'success'; data: T; error: null }
  | { status: 'error'; data: T | null; error: unknown }

/**
 * 한 번 불러오는 조회. deps가 바뀌면 이전 요청을 취소하고 다시 부른다.
 * reload()로 수동 재시도(retry 버튼).
 */
export function useAsync<T>(load: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[]) {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading', data: null, error: null })
  const [tick, setTick] = useState(0)
  const runLoad = useEffectEvent(load)

  useEffect(() => {
    const controller = new AbortController()
    setState((prev) => ({ status: 'loading', data: prev.data, error: null }))
    runLoad(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: 'success', data, error: null })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState((prev) => ({ status: 'error', data: prev.data, error }))
      },
    )
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 호출자가 deps를 명시한다.
  }, [...deps, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { ...state, reload }
}

/** 앱 진입 화면 결정(URL → N01/N04/N04L/N11/E03). */
export function useEntry() {
  return useAsync<Entry>((signal) => resolveEntry(undefined, signal), [])
}

/**
 * scene 폴링. 서버 지침: 2~3초 간격, 이전 요청이 끝난 뒤 다음 요청.
 * 탭이 안 보이면 멈춘다. 오류가 나도 마지막 scene은 유지하고 계속 폴링한다(일시 오류 대비).
 * 방이 CLOSED가 되면 폴링을 멈춘다(결과가 더 바뀌지 않는다).
 *
 * fetchedAt은 remainingLabel 계산용.
 */
export function useScene(roomId: string | null, { intervalMs = 2500, enabled = true } = {}) {
  const [scene, setScene] = useState<SceneV2 | null>(null)
  const [fetchedAt, setFetchedAt] = useState(0)
  const [error, setError] = useState<unknown>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!roomId || !enabled) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined

    const poll = async () => {
      if (stopped) return
      if (document.visibilityState === 'hidden') {
        timer = setTimeout(poll, intervalMs)
        return
      }
      controller = new AbortController()
      let closed = false
      try {
        const next = await loadScene(roomId, controller.signal)
        if (stopped) return
        setScene(next)
        setFetchedAt(Date.now())
        setError(null)
        closed = next.status !== 'OPEN'
      } catch (e) {
        if (stopped) return
        setError(e)
      }
      if (!closed) timer = setTimeout(poll, intervalMs)
    }
    poll()

    return () => {
      stopped = true
      clearTimeout(timer)
      controller?.abort()
    }
  }, [roomId, enabled, intervalMs, refreshKey])

  /** 삭제·제출 직후 즉시 다시 받기. */
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])
  return { scene, fetchedAt, error, refresh }
}

/** "종료까지 6일 12시간". 1분마다 갱신. */
export function useRemaining(room: Pick<RoomV2, 'closesAt' | 'serverNow'> | null, fetchedAt: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  return room ? remainingLabel(room, fetchedAt || now, now) : ''
}

/** 참여 기간 중 남은 비율 0..1(남은 시간 게이지). useRemaining과 같은 주기로 갱신한다. */
export function useRemainingRatio(
  room: Pick<RoomV2, 'createdAt' | 'closesAt' | 'serverNow'> | null,
  fetchedAt: number,
) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  return room ? remainingRatio(room, fetchedAt || now, now) : 0
}

/**
 * 버튼 액션(방 만들기·확정·등록·삭제 등). 진행 중 재호출을 막는다 — 서버가 중복 생성 재시도를 금지한다.
 * run()은 성공 값 또는 실패 시 throw. pending으로 버튼을 잠근다.
 */
export function useAction<A extends unknown[], R>(action: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const busy = useRef(false)
  const actionRef = useRef(action)
  useLayoutEffect(() => {
    actionRef.current = action
  })

  const run = useCallback(async (...args: A): Promise<R> => {
    if (busy.current) throw new Error('이미 처리 중이다.')
    busy.current = true
    setPending(true)
    setError(null)
    try {
      return await actionRef.current(...args)
    } catch (e) {
      setError(e)
      throw e
    } finally {
      busy.current = false
      setPending(false)
    }
  }, [])

  return { run, pending, error }
}
