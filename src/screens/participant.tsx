import { DrawCell } from '../DrawCell.tsx'
import { TORSO_CELL } from '../draw/template.ts'
import { BackgroundBox, Field, Screen, SlotGrid } from './shell.tsx'
import { describeBackground, type ScreenProps } from './types.ts'

/** 캐릭터 그룹 수와 그룹별 포즈 칸 수(정방형 4열). */
const CHARACTER_GROUPS = 3
const POSES_PER_GROUP = 4

/** N04 / 참여 ① — 참여 시작. 이름 입력. */
export function JoinStart({ nav, flow, patch }: ScreenProps) {
  return (
    <Screen
      title="참여 시작"
      sub={flow.roomTitle || '우리의 그림 방'}
      actions={
        <button type="button" onClick={() => nav('N05')}>
          캐릭터 고르기
        </button>
      }
    >
      <BackgroundBox label={describeBackground(flow.background)} />
      <Field
        label="이름 또는 닉네임"
        value={flow.nickname}
        placeholder="표시할 이름 입력"
        onChange={(nickname) => patch({ nickname })}
      />
    </Screen>
  )
}

/** N05 / 참여 ② — 캐릭터 선택. 칸은 버튼만 만들고 내용은 비워둔다. */
export function CharacterSelect({ nav, flow, patch }: ScreenProps) {
  return (
    <Screen
      title="캐릭터 선택"
      sub="캐릭터별로 원하는 모습을 고르세요."
      actions={
        <button type="button" onClick={() => nav('N06')}>
          얼굴 그리기
        </button>
      }
    >
      {Array.from({ length: CHARACTER_GROUPS }, (_, group) => (
        <div key={group} className="char-group">
          <p className="label">캐릭터 {group + 1}</p>
          <SlotGrid
            count={POSES_PER_GROUP}
            selected={flow.character?.group === group ? flow.character.pose : null}
            onSelect={(pose) => patch({ character: { group, pose } })}
          />
        </div>
      ))}
    </Screen>
  )
}

/**
 * N06 / 참여 ③ — 얼굴 그리기.
 *
 * 그림판은 개발해둔 DrawCell을 그대로 쓴다. 도구·획 데이터·PNG 내보내기 전부 기존 구현이다.
 * 와이어프레임에 "제한 시간 없음"이라고 적혀 있어 타이머만 끈다.
 * 얼굴 템플릿은 서버가 내려줄 데이터라 PoC 템플릿(TORSO_CELL)을 자리 대신 쓴다.
 */
export function DrawFace({ nav, flow, patch }: ScreenProps) {
  return (
    <section className="screen">
      <h1 className="screen-title">얼굴 그리기</h1>
      <p className="screen-sub">선택한 캐릭터 · {flow.nickname || '민지'}</p>
      <DrawCell
        template={TORSO_CELL}
        cellSize="large"
        minStrokes={2}
        timeLimitMs={null}
        submitLabel="배치하기"
        onSubmit={() => {
          patch({ drawn: true })
          nav('N07')
        }}
      />
    </section>
  )
}

/**
 * N07 / 참여 ④ 배치 — 미구현.
 *
 * "배경 위 자유 배치"는 아직 구현하지 않는다(요청 범위 밖).
 * 흐름이 끊기지 않게 N09로 가는 완료 버튼만 둔다.
 */
export function Placement({ nav }: ScreenProps) {
  return (
    <Screen
      title="배치"
      note="배경 위 자유 배치 — 아직 구현하지 않음"
      actions={
        <button type="button" onClick={() => nav('N09')}>
          완료
        </button>
      }
    >
      <BackgroundBox label="배치 화면 미구현" />
    </Screen>
  )
}

/** N09 / 참여 ⑤ — 등록 완료. 완료 안내 멘트는 없다. */
export function JoinDone({ nav, flow }: ScreenProps) {
  return (
    <Screen
      title="등록 완료"
      sub={flow.roomTitle || '우리의 그림 방'}
      note="현재까지 등록된 그림을 저장합니다."
      actions={
        <>
          <button type="button">친구에게 공유</button>
          <button type="button">이미지 저장</button>
          <button type="button" onClick={() => nav('N09R')}>
            다시 접속
          </button>
        </>
      }
    >
      <BackgroundBox label={describeBackground(flow.background)} />
    </Screen>
  )
}
