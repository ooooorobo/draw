/**
 * 화면용 React 훅. 로딩·오류 상태와 폴링만 담당하고, 화면 전이는 호출한 화면이 errors.ts로 정한다.
 */
import { useCallback, useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from 'react'
import type { RoomV2, SceneV2 } from './api-v2.ts'
import { resolveEntry, type Entry } from './entry.ts'
import { isThrottled } from './errors.ts'
import { jitterMs, retryAfterMs, retryThrottled } from './retry.ts'
import { loadScene, remainingLabel, remainingRatio } from './screens.ts'

export type AsyncState<T> =
  | { status: 'loading'; data: T | null; error: null }
  | { status: 'success'; data: T; error: null }
  | { status: 'error'; data: T | null; error: unknown }

/**
 * 한 번 불러오는 조회. deps가 바뀌면 이전 요청을 취소하고 다시 부른다.
 * 429는 Retry-After만큼 기다려 최대 3회 다시 부르고, 그 뒤는 reload()로 수동 재시도(retry 버튼).
 */
export function useAsync<T>(load: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[]) {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading', data: null, error: null })
  const [tick, setTick] = useState(0)
  const runLoad = useEffectEvent(load)

  useEffect(() => {
    const controller = new AbortController()
    setState((prev) => ({ status: 'loading', data: prev.data, error: null }))
    retryThrottled(() => runLoad(controller.signal), controller.signal).then(
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
 * 탭이 안 보이면 멈췄다가 다시 보이면 바로 받는다. 오류가 나도 마지막 scene은 유지하고 계속 폴링한다.
 * 연속 실패하면 간격을 두 배씩 늘려 최대 30초까지 기다리고, 429면 Retry-After에 0~1초를 더한 것보다 짧게 기다리지 않는다.
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
    let closed = false
    let inFlight = false
    let failures = 0
    /** 다음 요청을 보내도 되는 시각. 숨김 동안 타이머를 지워도 실패 대기 시간은 지킨다. */
    let nextAt = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined

    const schedule = () => {
      clearTimeout(timer)
      timer = undefined
      if (stopped || closed || inFlight || document.visibilityState === 'hidden') return
      timer = setTimeout(poll, Math.max(0, nextAt - Date.now()))
    }

    const poll = async () => {
      timer = undefined
      inFlight = true
      controller = new AbortController()
      let delay = intervalMs
      try {
        const next = await loadScene(roomId, controller.signal)
        if (stopped) return
        setScene(next)
        setFetchedAt(Date.now())
        setError(null)
        failures = 0
        closed = next.status !== 'OPEN'
      } catch (e) {
        if (stopped) return
        setError(e)
        failures += 1
        delay = intervalMs * 2 ** failures
        if (isThrottled(e)) delay = Math.max(delay, retryAfterMs(e) + jitterMs())
        delay = Math.min(POLL_MAX_DELAY_MS, delay)
      } finally {
        inFlight = false
      }
      nextAt = Date.now() + delay
      schedule()
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        clearTimeout(timer)
        timer = undefined
      } else {
        // 성공 직후라면 2~3초를 다 기다리지 않고 바로 받는다. 실패 대기 중이면 남은 시간을 지킨다.
        if (failures === 0) nextAt = 0
        schedule()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    schedule()

    return () => {
      stopped = true
      clearTimeout(timer)
      controller?.abort()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [roomId, enabled, intervalMs, refreshKey])

  /** 삭제·제출 직후 즉시 다시 받기. */
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])
  return { scene, fetchedAt, error, refresh }
}

const POLL_MAX_DELAY_MS = 30_000

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

/** 429로 잠근 버튼 액션의 해제 시각. 화면을 옮겨도(N07 → E02) 같은 키면 잠금이 이어진다. */
const cooldowns = new Map<string, number>()

/**
 * 버튼 액션(방 만들기·확정·등록·삭제 등). 진행 중 재호출을 막는다 — 서버가 중복 생성 재시도를 금지한다.
 * run()은 성공 값 또는 실패 시 throw. blocked로 버튼을 잠근다.
 *
 * 429를 받으면 자동으로 다시 보내지 않고 Retry-After 동안 blocked를 유지한다.
 * 화면을 옮겨도 잠금을 이어야 하면 cooldownKey를 같게 준다.
 */
export function useAction<A extends unknown[], R>(
  action: (...args: A) => Promise<R>,
  { cooldownKey }: { cooldownKey?: string } = {},
) {
  const ownKey = useId()
  const key = cooldownKey ?? ownKey
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [coolingUntil, setCoolingUntil] = useState(() => cooldowns.get(key) ?? 0)
  const [cooling, setCooling] = useState(() => coolingUntil > Date.now())
  const busy = useRef(false)
  const actionRef = useRef(action)
  useLayoutEffect(() => {
    actionRef.current = action
  })

  useEffect(() => {
    const left = coolingUntil - Date.now()
    if (left <= 0) return
    const timer = setTimeout(() => setCooling(false), left)
    return () => clearTimeout(timer)
  }, [coolingUntil])

  const run = useCallback(
    async (...args: A): Promise<R> => {
      if (busy.current) throw new Error('이미 처리 중이다.')
      if ((cooldowns.get(key) ?? 0) > Date.now()) throw new Error('요청 제한으로 잠시 막혀 있다.')
      busy.current = true
      setPending(true)
      setError(null)
      try {
        return await actionRef.current(...args)
      } catch (e) {
        if (isThrottled(e)) {
          const until = Date.now() + retryAfterMs(e)
          cooldowns.set(key, until)
          setCoolingUntil(until)
          setCooling(true)
        }
        setError(e)
        throw e
      } finally {
        busy.current = false
        setPending(false)
      }
    },
    [key],
  )

  return { run, pending, cooling, blocked: pending || cooling, error }
}
