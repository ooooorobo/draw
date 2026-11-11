import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { getApi } from './lib/relay-draw/client.ts'
import { readRoute } from './lib/route.ts'
import { hasRegistered, loadHostToken } from './lib/session.ts'
import {
  BadJoinLink,
  BadManagePassword,
  RegisterFailed,
  UploadFailed,
} from './screens/errors.tsx'
import { DeleteConfirm, HostManage, ManageAuth, Result, Revisit } from './screens/followup.tsx'
import {
  BackgroundConfirm,
  CreateRoom,
  RoomCreated,
  RoomSetup,
  Start,
} from './screens/host.tsx'
import {
  CharacterSelect,
  DrawFace,
  FullBodyConfirm,
  JoinDone,
  JoinStart,
} from './screens/participant.tsx'
import { Placement } from './screens/placement.tsx'
import {
  INITIAL_FLOW,
  type FlowState,
  type ScreenId,
  type ScreenProps,
} from './screens/types.ts'

/**
 * 확정 와이어프레임(Figma `MVP v3 흐름별 화면`) + 백엔드 연동.
 *
 * 진입 화면은 URL이 결정한다.
 *   /                              → N01 시작
 *   /rooms/{id}                    → N04 참여 (등록 완료 브라우저도 N04R이 아니라 N09R)
 *   /rooms/{id}#host={hostToken}   → N10 방장 관리
 *
 * 확정 설계는 "공통 링크 + 관리 비밀번호"라 관리 링크가 따로 없다. 다만 서버 API(v0.2.0)에
 * 비밀번호가 없어서 hostToken 경로를 아직 지운다. 자세한 사정은 screens/followup.tsx의
 * ManageAuth 주석에 적어뒀다.
 *
 * 등록(캐릭터 생성 + 제출)은 배치 화면(N07)에서 일어난다. src/screens/placement.tsx 참고.
 */

const SCREENS: Record<ScreenId, (props: ScreenProps) => ReactElement> = {
  N01: Start,
  N02: CreateRoom,
  N02P: BackgroundConfirm,
  N03: RoomSetup,
  N03D: RoomCreated,
  N04: JoinStart,
  // 가로 배경 참여는 같은 화면이다. Stage가 배경 비율을 고정하지 않아 코드가 갈리지 않는다.
  N04L: JoinStart,
  N05: CharacterSelect,
  N06: DrawFace,
  N06C: FullBodyConfirm,
  N07: Placement,
  N09: JoinDone,
  N04M: ManageAuth,
  N10: HostManage,
  N10C: DeleteConfirm,
  N09R: Revisit,
  N11: Result,
  E01: UploadFailed,
  E02: RegisterFailed,
  E03: BadJoinLink,
  E04: BadManagePassword,
}

/**
 * URL에서 시작 화면과 초기 상태를 정한다.
 *
 * 등록 완료 판정은 localStorage다. 서버가 브라우저를 식별하지 않으므로
 * 사이트 데이터를 지우면 다시 참여할 수 있다(정책 메모의 알려진 한계).
 */
function initialState(): { screen: ScreenId; flow: FlowState } {
  const { roomId, hostToken } = readRoute()
  if (!roomId) return { screen: 'N01', flow: INITIAL_FLOW }

  // fragment에 토큰이 없어도 방을 만든 브라우저면 보관한 토큰을 쓴다.
  const token = hostToken ?? loadHostToken(roomId)
  const flow: FlowState = { ...INITIAL_FLOW, roomId, hostToken: token }

  if (hostToken) return { screen: 'N10', flow }
  return { screen: hasRegistered(roomId) ? 'N09R' : 'N04', flow }
}

/**
 * API origin 설정 오류를 렌더 전에 잡는다.
 *
 * 화면들은 렌더 중에 getApi()를 부른다. 환경변수가 없으면 거기서 throw되어
 * 앱 전체가 빈 화면이 된다. 그걸 막는 게 client.ts가 검사를 호출 시점으로 늦춘 이유이므로,
 * 여기서 한 번 확인하고 설정 안내를 보여준다.
 */
function readConfigError(): string | null {
  try {
    getApi()
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

export default function App() {
  const [{ screen, flow }, setApp] = useState(initialState)
  // 환경변수는 런타임에 바뀌지 않는다. 최초 1회만 확인한다.
  const [configError] = useState(readConfigError)

  const nav = useCallback((to: ScreenId) => {
    setApp((prev) => ({ ...prev, screen: to }))
  }, [])

  const patch = useCallback((next: Partial<FlowState>) => {
    setApp((prev) => ({ ...prev, flow: { ...prev.flow, ...next } }))
  }, [])

  // 뒤로 가기/앞으로 가기로 URL이 바뀌면 화면을 다시 판정한다.
  useEffect(() => {
    const onPop = () => setApp(initialState())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  if (configError) {
    return (
      <main className="app">
        <div className="phone">
          <section className="screen">
            <h1 className="screen-title">설정 필요</h1>
            <p className="error">{configError}</p>
          </section>
        </div>
      </main>
    )
  }

  const Current = SCREENS[screen]

  return (
    <main className="app">
      {/* 375×812 와이어프레임 기준 프레임. */}
      <div className="phone">
        <Current nav={nav} flow={flow} patch={patch} />
      </div>
    </main>
  )
}
