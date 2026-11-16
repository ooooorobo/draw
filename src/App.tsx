import { useCallback, useRef, useState, type ReactElement } from 'react'
import type { Entry } from './lib/relay-draw/entry.ts'
import { useEntry } from './lib/relay-draw/hooks.ts'
import { BadJoinLink, DeleteConfirm, HostManage, Result } from './screens/followup.tsx'
import { BackgroundConfirm, CreateRoom, RoomCreated, Start, UploadFailed } from './screens/host.tsx'
import {
  AdminAuth,
  CharacterSelect,
  ConfirmLook,
  DrawFace,
  JoinDone,
  JoinStart,
  Placement,
  RegisterFailed,
} from './screens/participant.tsx'
import { INITIAL_FLOW, type FlowState, type ScreenId, type ScreenProps } from './screens/types.ts'
import { Cta, Foot, Page, Toast } from './screens/ui.tsx'

/**
 * DRAWING PARTY — Figma 최종 디자인(MVP v4) 화면 라우터.
 *
 * 첫 화면은 주소로 정한다(lib/relay-draw/entry.ts).
 *   방 링크 없음 → N01, 방 링크 → N04(가로 배경이면 N04L 레이아웃, 이미 참여했어도 N04),
 *   종료된 방 → N11, 잘못된 링크 → E03.
 * 이후 화면 전이는 로컬 상태로만 일어난다.
 */

const SCREENS: Record<ScreenId, (props: ScreenProps) => ReactElement> = {
  N01: Start,
  N02: CreateRoom,
  N02P: BackgroundConfirm,
  N03: RoomCreated,
  N04: JoinStart,
  N04L: JoinStart,
  N04M: AdminAuth,
  N05: CharacterSelect,
  N06: DrawFace,
  N06C: ConfirmLook,
  N07: Placement,
  N09: JoinDone,
  N09R: JoinDone,
  N10: HostManage,
  N10C: DeleteConfirm,
  N11: Result,
  E01: UploadFailed,
  E02: RegisterFailed,
  E03: BadJoinLink,
}

const TOAST_MS = 2200

export default function App() {
  const entry = useEntry()
  const data = entry.data

  if (entry.status === 'success' && data && data.screen !== null) {
    return <Flow entry={data} />
  }

  const failed = entry.status === 'error' || data?.screen === null
  return (
    <main className="app">
      <Page>
        <div className="loading">
          {!failed
            ? '불러오는 중…'
            : data && data.screen === null
              ? data.retryMessage
              : '방 정보를 불러오지 못했어요.'}
        </div>
        {failed && (
          <Foot>
            <Cta onClick={entry.reload}>다시 시도</Cta>
          </Foot>
        )}
      </Page>
    </main>
  )
}

/** 진입 화면이 정해진 뒤의 흐름. 첫 상태는 진입 결과(방 정보·이전 별명)로 만든다. */
function Flow({ entry }: { entry: Exclude<Entry, { screen: null }> }) {
  const [screen, setScreen] = useState<ScreenId>(entry.screen)
  const [flow, setFlow] = useState<FlowState>(() => ({
    ...INITIAL_FLOW,
    room: 'room' in entry ? entry.room : null,
    nickname: 'participation' in entry && entry.participation ? entry.participation.nickname : '',
  }))
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const patch = useCallback((next: Partial<FlowState>) => {
    setFlow((prev) => ({ ...prev, ...next }))
  }, [])

  const nav = useCallback((to: ScreenId) => {
    setScreen(to)
    window.scrollTo(0, 0)
  }, [])

  const toast = useCallback((message: string) => {
    clearTimeout(toastTimer.current)
    setToastMessage(message)
    toastTimer.current = setTimeout(() => setToastMessage(null), TOAST_MS)
  }, [])

  const Current = SCREENS[screen]
  return (
    <main className="app">
      <Current nav={nav} flow={flow} patch={patch} toast={toast} />
      <Toast message={toastMessage} />
    </main>
  )
}
