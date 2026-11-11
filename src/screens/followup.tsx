import { useState } from 'react'
import { getApi } from '../lib/relay-draw/client.ts'
import { errorCode, errorMessage } from '../lib/useAsync.ts'
import { SceneView } from './participant.tsx'
import { SceneBoard } from './scene.tsx'
import { ErrorBox, Figure, Loading, PasswordField, Screen, Stage } from './shell.tsx'
import { sceneView, useScene } from './useScene.ts'
import { remainingLabel, type ScreenProps } from './types.ts'

/**
 * N04M · 방 관리 인증.
 *
 * 확정 설계는 "방을 만들 때 설정한 비밀번호를 입력해 관리 화면으로 들어간다"지만,
 * 서버 API(v0.2.0)에 비밀번호가 없다. 관리 권한을 확인하는 수단은 hostToken뿐이고
 * 그 토큰은 방을 만든 브라우저에만 보관돼 있다(session.ts).
 *
 * 그래서 입력한 비밀번호로 권한이 생기지는 않는다. 비밀번호를 맞다고 판정하는 가짜 검사를
 * 넣지 않고, 토큰 유무로만 통과시킨다. 토큰이 없으면 E04로 보낸다.
 * 서버가 비밀번호 인증을 제공하면 이 화면의 입력값을 그 요청에 실어 보내면 된다.
 */
export function ManageAuth({ nav, flow, patch }: ScreenProps) {
  const view = useScene(flow.roomId)

  const submit = () => {
    if (!flow.hostToken) {
      nav('E04')
      return
    }
    nav('N10')
  }

  // 시안은 캐릭터 없이 배경만 작게 보여준다.
  const backgroundUrl =
    view.state === 'ready' && view.data.scene
      ? view.data.api.url(view.data.scene.background.url)
      : flow.backgroundUrl

  return (
    <Screen
      title="방 관리"
      actions={
        <>
          <button type="button" onClick={() => nav('N04')}>
            취소
          </button>
          <button type="button" disabled={flow.managePassword.length === 0} onClick={submit}>
            관리모드로
          </button>
        </>
      }
    >
      <Stage url={backgroundUrl} size="preview" />

      <div className="form">
        <p className="copy is-left">방을 만들 때 설정한 비밀번호를 입력해 주세요.</p>
        <PasswordField
          label="관리 비밀번호"
          value={flow.managePassword}
          placeholder="비밀번호 입력"
          onChange={(managePassword) => patch({ managePassword })}
        />
      </div>
    </Screen>
  )
}

/**
 * N10 · 방장 관리.
 *
 * 관리 권한은 hostToken으로 확인한다. 토큰이 없으면 E04다.
 * 서버에 토큰 검증 전용 엔드포인트가 없어서, 권한이 필요한 동작(캐릭터 삭제)을
 * 실제로 호출할 때 403으로 확인된다.
 *
 * 삭제는 여기서 바로 하지 않는다. 캐릭터를 고르면 확인 화면(N10C)으로 넘긴다.
 */
export function HostManage({ nav, flow, patch }: ScreenProps) {
  const roomId = flow.roomId
  const view = useScene(roomId)

  if (!flow.hostToken) {
    return (
      <Screen
        title="방 관리"
        actions={
          <button type="button" onClick={() => nav('E04')}>
            안내 보기
          </button>
        }
      >
        <ErrorBox message="관리 권한을 확인할 수 없어요." />
      </Screen>
    )
  }

  if (view.state === 'loading') {
    return (
      <Screen title="방 관리">
        <Loading />
      </Screen>
    )
  }
  if (view.state === 'error') {
    const code = errorCode(view.error)
    return (
      <Screen
        title="방 관리"
        actions={
          code === 'ROOM_EXPIRED' ? (
            <button type="button" onClick={() => nav('N11')}>
              결과 보기
            </button>
          ) : undefined
        }
      >
        <ErrorBox message={errorMessage(view.error)} onRetry={view.reload} />
      </Screen>
    )
  }

  const scene = view.data.scene
  if (!roomId || !scene) {
    return (
      <Screen title="방 관리">
        <ErrorBox message="방 정보가 없어요." />
      </Screen>
    )
  }

  const selected = flow.pendingDelete
  const count = selected ? 1 : 0

  return (
    <Screen
      title="방 관리"
      strong
      sub={`<${scene.title}> · ${remainingLabel(scene.closesAt)} 남음`}
      actions={
        <>
          <button
            type="button"
            onClick={() => {
              patch({ pendingDelete: null })
              nav('N04')
            }}
          >
            관리 나가기
          </button>
          <button type="button" disabled={!selected} onClick={() => selected && nav('N10C')}>
            선택 이미지 삭제
          </button>
        </>
      }
    >
      {/* 그림 위의 캐릭터를 눌러 고른다. 한 번에 하나, 다시 누르면 해제. */}
      <SceneBoard
        view={view}
        selectedId={selected?.id ?? null}
        onPick={(sprite) => {
          const character = scene.characters.find((c) => c.id === sprite.id)
          if (!character) return
          patch({
            pendingDelete:
              selected?.id === character.id
                ? null
                : { id: character.id, nickname: character.nickname },
          })
        }}
      />

      <div className="copy-group">
        <p className="copy">
          {scene.characterCount > 0 ? '삭제할 캐릭터를 선택해 주세요.' : '아직 등록된 캐릭터가 없어요.'}
        </p>
        <p className="copy">선택한 캐릭터 {count}개</p>
        {flow.lastError && <p className="error">{flow.lastError}</p>}
      </div>
    </Screen>
  )
}

/**
 * N10C · 삭제 확인.
 *
 * 서버의 DELETE는 OPEN 기간에만 동작하고 반복 호출도 성공으로 처리한다.
 * 얼굴·재생 파일과 이전 결과 파일까지 함께 무효화되므로 되돌릴 수 없다.
 */
export function DeleteConfirm({ nav, flow, patch }: ScreenProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const view = useScene(flow.roomId)
  const target = flow.pendingDelete

  if (!target) {
    return (
      <Screen
        title="삭제 확인"
        strong
        actions={
          <button type="button" onClick={() => nav('N10')}>
            관리로 돌아가기
          </button>
        }
      >
        <ErrorBox message="선택한 캐릭터가 없어요." />
      </Screen>
    )
  }

  // 지울 캐릭터를 크게 보여준다. 장면을 못 받아도 삭제 자체는 할 수 있다.
  const sprite =
    view.state === 'ready'
      ? (sceneView(view.data, null).sprites.find((s) => s.id === target.id) ?? null)
      : null

  const remove = async () => {
    if (!flow.roomId || !flow.hostToken || busy) return
    setBusy(true)
    setError(null)
    try {
      await getApi().deleteCharacter(flow.roomId, target.id, flow.hostToken)
      patch({ pendingDelete: null, lastError: null })
      nav('N10')
    } catch (e) {
      const failure = e instanceof Error ? e : new Error(String(e))
      if (errorCode(failure) === 'FORBIDDEN') {
        patch({ lastError: errorMessage(failure) })
        nav('E04')
        return
      }
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen
      title="삭제 확인"
      strong
      actions={
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              patch({ pendingDelete: null })
              nav('N10')
            }}
          >
            취소
          </button>
          <button type="button" disabled={busy} onClick={() => void remove()}>
            {busy ? '삭제 중…' : '삭제'}
          </button>
        </>
      }
    >
      {sprite ? <Figure {...sprite} size="small" /> : <div className="figure" />}
      <div className="copy-group">
        <p className="copy is-large">선택한 캐릭터를 삭제할까요?</p>
        <p className="copy">선택한 캐릭터가 방의 그림에서 사라집니다.</p>
        {error && <p className="error">{error}</p>}
      </div>
    </Screen>
  )
}

/**
 * N09R · 완료자 재접속.
 *
 * 확정 설계가 "추가 캐릭터 참여 허용"으로 바뀌어서, 재접속해도 더 그릴 수 있다.
 * 공통 뷰(SceneView)의 "캐릭터 더 그리기"가 그 경로다.
 */
export function Revisit(props: ScreenProps) {
  return <SceneView {...props} />
}

/**
 * N11 · 종료 결과. 일주일 경과 또는 조기 종료.
 *
 * 과정 재생(GIF 5초)은 확정 와이어프레임에서도 "재생 방식 미정"이다. 획 데이터는 제출 때
 * 함께 올라가 있어서 재생 화면이 생기면 서버 작업 없이 붙일 수 있다.
 */
export function Result(props: ScreenProps) {
  return <SceneView {...props} closedView />
}
