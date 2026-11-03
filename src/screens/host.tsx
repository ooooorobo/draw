import { BackgroundBox, Field, Screen } from './shell.tsx'
import { describeBackground, type ScreenProps } from './types.ts'

/** N01 / 방장 ① — 시작. */
export function Start({ nav }: ScreenProps) {
  return (
    <Screen
      title="시작"
      actions={
        <button type="button" onClick={() => nav('N02')}>
          시작하기
        </button>
      }
    >
      <div className="hero">DRAWING PARTY</div>
    </Screen>
  )
}

/** N02 / 방장 ② — 방 만들기. 제목과 배경만 설정한다. */
export function CreateRoom({ nav, flow, patch }: ScreenProps) {
  return (
    <Screen
      title="방 만들기"
      note="개설 후 일주일 동안 참여 가능"
      actions={
        <button type="button" onClick={() => nav('N03')}>
          방 만들기
        </button>
      }
    >
      <Field
        label="방 제목"
        value={flow.roomTitle}
        placeholder="우리의 그림 방"
        onChange={(roomTitle) => patch({ roomTitle })}
      />

      <p className="label">배경 선택</p>
      <div className="bg-grid">
        {[1, 2, 3, 4].map((id) => (
          <button
            key={id}
            type="button"
            className="bg-choice"
            aria-pressed={flow.background?.kind === 'preset' && flow.background.id === id}
            onClick={() => patch({ background: { kind: 'preset', id } })}
          >
            배경 {id}
          </button>
        ))}
      </div>

      <p className="label">선택한 배경</p>
      <BackgroundBox label={describeBackground(flow.background)} />

      {/* 갤러리/촬영은 둘 다 N02P(사진 확인)로 간다. 실제 파일 선택은 API 연동 이후. */}
      <div className="tools">
        <button type="button" onClick={() => nav('N02P')}>
          갤러리에서 가져오기
        </button>
        <button type="button" onClick={() => nav('N02P')}>
          촬영하기
        </button>
      </div>
    </Screen>
  )
}

/** N02P / 방장 ③ — 업로드 배경 확인. 기본 배경을 쓰면 생략되는 분기. */
export function BackgroundConfirm({ nav, patch }: ScreenProps) {
  return (
    <Screen
      title="업로드 배경 확인"
      note="배경 규격·크롭 미정"
      actions={
        <>
          <button
            type="button"
            onClick={() => {
              patch({ background: { kind: 'photo' } })
              nav('N02')
            }}
          >
            이 배경 사용
          </button>
          <button type="button" onClick={() => nav('N02')}>
            다시 선택
          </button>
        </>
      }
    >
      <BackgroundBox label="선택한 사진 미리보기" />
    </Screen>
  )
}

/** N03 / 방장 ④ — 방 생성 완료. 참여 링크 공유와 관리 링크 보관. */
export function RoomCreated({ nav, flow }: ScreenProps) {
  return (
    <Screen
      title="방 생성 완료"
      sub={flow.roomTitle || '우리의 그림 방'}
      note="방장 관리 링크를 별도로 보관하세요."
      actions={
        <>
          <button type="button">링크 복사</button>
          <button type="button">공유</button>
          {/* 와이어프레임 흐름: 참여 링크 → N04 / 관리 링크 → N10 */}
          <button type="button" onClick={() => nav('N04')}>
            참여 링크 열기
          </button>
          <button type="button" onClick={() => nav('N10')}>
            관리 링크 열기
          </button>
        </>
      }
    >
      <BackgroundBox label={describeBackground(flow.background)} />
    </Screen>
  )
}
