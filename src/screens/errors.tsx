import { useState } from 'react'
import { DEFAULT_SPOT } from '../lib/placement.ts'
import { goToStart } from '../lib/route.ts'
import { errorMessage } from '../lib/useAsync.ts'
import { registerCharacter } from './register.ts'
import { SceneBoard } from './scene.tsx'
import { PasswordField, Screen, Stage } from './shell.tsx'
import { mySprite, useObjectUrl } from './sprite.ts'
import { findPose, firstPose, type ScreenProps } from './types.ts'
import { useScene } from './useScene.ts'

/**
 * 예외 상태 E01~E04.
 * 서버 오류 메시지는 flow.lastError에 담겨 온다. 서버가 한국어 message를 주므로 그대로 쓴다.
 */

/** 시안 E03의 캐릭터 그림(public/figma). */
const LOST_CHARACTER = '/figma/empty-character.png'

/**
 * E01 · 배경 업로드 실패. N02로 복귀.
 * "기본 배경 선택"은 올리던 사진을 버리고 기본 배경으로 돌아간다(N02가 첫 기본 배경을 골라둔다).
 */
export function UploadFailed({ nav, flow, patch }: ScreenProps) {
  return (
    <Screen
      title="사진을 불러오지 못했어요"
      strong
      actions={
        <>
          <button type="button" onClick={() => nav('N02')}>
            다시 선택
          </button>
          <button
            type="button"
            onClick={() => {
              patch({ background: null, backgroundUrl: null, upload: null, lastError: null })
              nav('N02')
            }}
          >
            기본 배경 선택
          </button>
        </>
      }
    >
      <Stage url={flow.backgroundUrl} size="medium" />
      <div className="copy-group">
        <p className="copy">다른 사진을 선택하거나 다시 시도해 주세요.</p>
        {flow.lastError && <p className="note">{flow.lastError}</p>}
      </div>
    </Screen>
  )
}

/**
 * E02 · 등록 실패.
 *
 * 그림·위치를 유지한 채 다시 등록하거나 배치 화면으로 돌아간다(flow에 face/replay/idempotencyKey가 남아있다).
 * 같은 DRAFT·같은 멱등 키로 재시도하므로 중복 요청에서도 등록은 1회다(서버 동작 확인).
 */
export function RegisterFailed(props: ScreenProps) {
  const { nav, flow } = props
  const view = useScene(flow.roomId)
  const faceUrl = useObjectUrl(flow.face)
  const [busy, setBusy] = useState(false)

  const data = view.state === 'ready' ? view.data : null
  const choice = data ? (findPose(data.catalog, flow.presetId, flow.poseId) ?? firstPose(data.catalog)) : null
  const spot = flow.placement ?? DEFAULT_SPOT
  // 아직 서버에 없는 내 캐릭터를 "배치했던 자리"에 덧그린다.
  const mine = data && choice ? mySprite(data.api, choice, faceUrl, spot) : null

  const retry = async () => {
    if (!data || !choice || busy) return
    setBusy(true)
    try {
      await registerCharacter({ ...props, api: data.api, choice, spot })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen
      title="등록하지 못했어요"
      actions={
        <>
          <button type="button" disabled={!data || !choice || !flow.face || busy} onClick={() => void retry()}>
            {busy ? '등록 중…' : '다시 등록'}
          </button>
          <button type="button" disabled={busy} onClick={() => nav('N07')}>
            배치로 돌아가기
          </button>
        </>
      }
    >
      <SceneBoard view={view} fallbackUrl={flow.backgroundUrl} extra={mine} />
      <div className="copy-group">
        <p className="copy">그림과 배치 위치는 그대로 유지돼요.</p>
        <p className="copy">다시 등록해 주세요.</p>
        {flow.lastError && <p className="note">{flow.lastError}</p>}
        {view.state === 'error' && <p className="note">{errorMessage(view.error)}</p>}
      </div>
    </Screen>
  )
}

/** E03 · 잘못된 참여 링크. 유효한 종료 링크는 오류 대신 N11. */
export function BadJoinLink({ nav, flow }: ScreenProps) {
  return (
    <Screen
      title="방을 찾을 수 없어요"
      actions={
        <button
          type="button"
          onClick={() => {
            goToStart()
            nav('N01')
          }}
        >
          시작 화면으로
        </button>
      }
    >
      <div className="figure">
        <div className="figure-art is-tiny">
          <img src={LOST_CHARACTER} alt="" />
        </div>
      </div>
      <div className="copy-group">
        <p className="copy">공유받은 링크를 다시 확인해 주세요.</p>
        {flow.lastError && <p className="note">{flow.lastError}</p>}
      </div>
    </Screen>
  )
}

/**
 * E04 · 비밀번호 오류.
 *
 * 확정 설계에서 "관리 링크 오류"가 "비밀번호 불일치"로 바뀌었다.
 * 다만 서버에 비밀번호 인증이 없어서(api-client v0.2.0), 실제로 이 화면에 오는 경우는
 * 관리 권한(hostToken)이 없을 때다. 화면은 확정 설계의 형태를 따른다.
 */
export function BadManagePassword({ nav, flow, patch }: ScreenProps) {
  return (
    <Screen
      title="방 관리"
      actions={
        <>
          <button type="button" onClick={() => nav('N04')}>
            취소
          </button>
          <button type="button" onClick={() => nav('N04M')}>
            다시 확인
          </button>
        </>
      }
    >
      {/* 시안은 입력 라벨이 top 240에 있다. 본문 시작(≈103)에서 남는 만큼 내린다. */}
      <div className="form" style={{ marginTop: 137 }}>
        <PasswordField
          label="관리 비밀번호"
          value={flow.managePassword}
          placeholder="비밀번호 입력"
          invalid
          onChange={(managePassword) => patch({ managePassword })}
        />
        <p className="copy is-left">
          비밀번호가 일치하지 않아요.
          <br />
          입력한 비밀번호를 다시 확인해 주세요.
        </p>
      </div>
    </Screen>
  )
}
