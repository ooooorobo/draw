import { Screen, SlotBoard } from './shell.tsx'
import type { ScreenProps } from './types.ts'

/** 등록된 그림이 놓이는 자리 수. API 연동 전이라 고정값이다. */
const BOARD_SLOTS = 6

/** N10 / 방장 ⑤ — 방장 관리. */
export function HostManage({ nav, flow }: ScreenProps) {
  return (
    <Screen
      title="방장 관리"
      sub={`${flow.roomTitle || '우리의 그림 방'} · 진행 중`}
      note="종료 예정 시점 표시"
      actions={
        <>
          <button type="button">참여 링크 공유</button>
          <button type="button" onClick={() => nav('N10C')}>
            방 종료
          </button>
        </>
      }
    >
      <SlotBoard count={BOARD_SLOTS} />
    </Screen>
  )
}

/** N10C / 결과 ③ — 종료 확인. 조기 종료 분기. */
export function CloseConfirm({ nav, flow }: ScreenProps) {
  return (
    <Screen
      title="종료 확인"
      sub={flow.roomTitle || '우리의 그림 방'}
      note="캐릭터 삭제 없음"
      actions={
        <>
          <button type="button" onClick={() => nav('N11')}>
            방 종료하기
          </button>
          <button type="button" onClick={() => nav('N10')}>
            계속 열어두기
          </button>
        </>
      }
    >
      <p>방을 종료할까요?</p>
      <p>종료하면 새로운 참여를 받을 수 없습니다.</p>
    </Screen>
  )
}

/** N09R / 결과 ② — 참여 완료자 재접속. 같은 방·브라우저에서 추가 그리기 불가. */
export function Revisit({ flow }: ScreenProps) {
  return (
    <Screen
      title="참여 완료자 재접속"
      sub={flow.roomTitle || '우리의 그림 방'}
      actions={
        <>
          <button type="button">친구 초대하기</button>
          <button type="button">지금 그림 저장</button>
        </>
      }
    >
      <SlotBoard count={BOARD_SLOTS} />
    </Screen>
  )
}

/** N11 / 결과 ④ — 종료 결과. 일주일 경과 또는 조기 종료. */
export function Result({ flow }: ScreenProps) {
  return (
    <Screen
      title="종료 결과"
      sub={`${flow.roomTitle || '우리의 그림 방'} · 종료`}
      note="과정 재생 보류"
      actions={
        <>
          <button type="button">완성 그림 저장</button>
          <button type="button">완성 그림 공유</button>
        </>
      }
    >
      <SlotBoard count={BOARD_SLOTS} />
    </Screen>
  )
}
