import { useCallback, useState, type ReactElement } from 'react'
import { BadJoinLink, BadManageLink, RegisterFailed, UploadFailed } from './screens/errors.tsx'
import { CloseConfirm, HostManage, Result, Revisit } from './screens/followup.tsx'
import { BackgroundConfirm, CreateRoom, RoomCreated, Start } from './screens/host.tsx'
import {
  CharacterSelect,
  DrawFace,
  JoinDone,
  JoinStart,
  Placement,
} from './screens/participant.tsx'
import {
  INITIAL_FLOW,
  SCREEN_LIST,
  type FlowState,
  type ScreenId,
  type ScreenProps,
} from './screens/types.ts'

/**
 * MVP v3 와이어프레임 화면 구현.
 *
 * 범위: 화면과 화면 전이만. API 연동과 디자인은 아직 들어가지 않는다.
 *   - 그림판(N06)은 개발해둔 DrawCell을 그대로 연동한다.
 *   - 배치(N07)는 미구현 — 흐름 유지용 자리만 있다.
 *   - 캐릭터 선택 칸(N05)은 버튼만 있고 내용은 비어 있다.
 *
 * 링크/라우팅이 없어서 화면 전이는 로컬 상태로만 일어난다.
 */

const SCREENS: Record<ScreenId, (props: ScreenProps) => ReactElement> = {
  N01: Start,
  N02: CreateRoom,
  N02P: BackgroundConfirm,
  N03: RoomCreated,
  N04: JoinStart,
  N05: CharacterSelect,
  N06: DrawFace,
  N07: Placement,
  N09: JoinDone,
  N10: HostManage,
  N10C: CloseConfirm,
  N09R: Revisit,
  N11: Result,
  E01: UploadFailed,
  E02: RegisterFailed,
  E03: BadJoinLink,
  E04: BadManageLink,
}

export default function App() {
  const [screen, setScreen] = useState<ScreenId>('N01')
  const [flow, setFlow] = useState<FlowState>(INITIAL_FLOW)

  const patch = useCallback((next: Partial<FlowState>) => {
    setFlow((prev) => ({ ...prev, ...next }))
  }, [])

  const Current = SCREENS[screen]

  return (
    <main className="app">
      {/* 375×812 와이어프레임 기준 프레임. */}
      <div className="phone">
        <Current nav={setScreen} flow={flow} patch={patch} />
      </div>

      {/*
        개발용 화면 이동. 와이어프레임 확인 전용이며 서비스 UI가 아니다.
        예외 화면(E01~E04)은 API 없이는 도달 경로가 없어서 여기서만 열린다.
      */}
      <nav className="screen-nav">
        {SCREEN_LIST.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={screen === id}
            onClick={() => setScreen(id)}
          >
            {id} {label}
          </button>
        ))}
      </nav>
    </main>
  )
}
