import { useEffect, useMemo, useState } from 'react'
import { DrawCell } from '../DrawCell.tsx'
import { faceTemplate } from '../draw/template.ts'
import { composeScene, downloadBlob, shareImage } from '../lib/compose.ts'
import { getApi } from '../lib/relay-draw/client.ts'
import { roomLink } from '../lib/route.ts'
import { visitorId } from '../lib/session.ts'
import { errorCode, errorMessage, useAsync } from '../lib/useAsync.ts'
import { SceneBoard } from './scene.tsx'
import { useObjectUrl } from './sprite.ts'
import { ErrorBox, Field, Figure, Loading, Screen } from './shell.tsx'
import { sceneView, useScene } from './useScene.ts'
import {
  findPose,
  firstPose,
  NICKNAME_MAX,
  remainingLabel,
  type FlowState,
  type Nav,
  type ScreenProps,
} from './types.ts'

/**
 * N04 · 최초 참여 / N04L · 가로 배경 참여.
 *
 * 두 화면은 같은 구성이고 배경 비율만 다르다. Stage가 이미 배경 비율을 고정하지 않으므로
 * 세로·가로 사진 모두 같은 코드로 들어간다. 확정 시안이 둘을 나눠 그린 것은 레이아웃 확인용이라
 * 화면을 쪼개지 않고 하나로 둔다(N04L은 개발용 이동에서 같은 화면을 연다).
 *
 * 참여 경로의 관문이라 방 상태를 여기서 확인한다. 확인하지 않으면 종료·만료된 방에서도
 * 캐릭터를 고르고 얼굴을 다 그린 뒤 제출(N07)에서야 409/410으로 거절당한다.
 */
export function JoinStart({ nav, flow, patch }: ScreenProps) {
  const view = useScene(flow.roomId)
  const scene = view.state === 'ready' ? view.data.scene : null
  const closed = scene !== null && scene.status !== 'OPEN'

  // 방 제목은 서버가 가지고 있다. 링크로 들어오면 흐름 상태가 비어 있어서 여기서 채운다.
  useEffect(() => {
    if (scene && scene.title !== flow.roomTitle) patch({ roomTitle: scene.title })
  }, [scene, flow.roomTitle, patch])

  // 방문 측정. 실패해도 참여를 막지 않는다.
  const roomId = scene?.roomId
  useEffect(() => {
    if (!roomId) return
    void getApi()
      .event({ roomId, type: 'link_visit', visitorId: visitorId() })
      .catch(() => undefined)
  }, [roomId])

  // 없는 방·잘못된 링크는 예외 화면으로(E03). 만료(410)는 결과 화면이 맞다.
  const failure = view.state === 'error' ? view.error : null
  useEffect(() => {
    if (!failure) return
    patch({ lastError: errorMessage(failure) })
    nav(errorCode(failure) === 'ROOM_EXPIRED' ? 'N11' : 'E03')
  }, [failure, nav, patch])

  return (
    <Screen
      title={`<${flow.roomTitle || scene?.title || '우리의 그림 방'}>`}
      sub={scene ? `종료까지 ${remainingLabel(scene.closesAt)}` : undefined}
      aside={
        // 확정 설계: 관리도 같은 방 링크로 들어간다. 별도 관리 링크가 없다.
        <button type="button" className="screen-aside" onClick={() => nav('N04M')}>
          방 관리
        </button>
      }
      actions={
        closed ? (
          <button type="button" onClick={() => nav('N11')}>
            결과 보기
          </button>
        ) : (
          <button type="button" disabled={view.state !== 'ready'} onClick={() => nav('N05')}>
            캐릭터 고르기
          </button>
        )
      }
    >
      <SceneBoard view={view} fallbackUrl={flow.backgroundUrl} />
      {closed ? (
        <p className="copy">종료된 방입니다. 새로운 참여를 받지 않습니다.</p>
      ) : (
        <Field
          label="별명"
          value={flow.nickname}
          placeholder="별명을 입력해 주세요"
          maxLength={NICKNAME_MAX}
          onChange={(nickname) => patch({ nickname })}
        />
      )}
    </Screen>
  )
}

/**
 * N05 · 캐릭터 선택.
 *
 * 캐릭터·포즈 목록은 카탈로그가 내려준다(라이브: 3캐릭터 × 3포즈. 확정 시안은 4×4라 시안이 앞서 있다).
 * 선택을 바꾸면 draft를 버린다. 이미 만든 DRAFT는 그때의 포즈로 고정이라서,
 * 포즈를 바꾼 뒤 그 DRAFT로 제출하면 화면과 다른 캐릭터가 등록된다.
 */
export function CharacterSelect({ nav, flow, patch }: ScreenProps) {
  const api = getApi()
  const catalog = useAsync((signal) => api.catalog(signal), [])

  if (catalog.state === 'loading') {
    return (
      <Screen title="캐릭터 선택">
        <Loading label="캐릭터 불러오는 중" />
      </Screen>
    )
  }
  if (catalog.state === 'error') {
    return (
      <Screen title="캐릭터 선택">
        <ErrorBox message={catalog.error.message} onRetry={catalog.reload} />
      </Screen>
    )
  }

  return (
    <Screen
      title="캐릭터 선택"
      sub="원하는 캐릭터와 모습을 골라주세요."
      scroll
      actions={
        <button type="button" disabled={!flow.presetId || !flow.poseId} onClick={() => nav('N06')}>
          얼굴 그리기
        </button>
      }
    >
      <div className="char-list">
        {catalog.data.characters.map((character) => (
          <div key={character.id} className="char-group">
            <p className="label">{character.name}</p>
            <div className="slot-grid">
              {character.poses.map((pose) => (
                <button
                  key={pose.id}
                  type="button"
                  className="slot"
                  aria-label={`${character.name} ${pose.name}`}
                  aria-pressed={flow.presetId === character.id && flow.poseId === pose.id}
                  onClick={() => patch({ presetId: character.id, poseId: pose.id, draft: null })}
                >
                  <img src={api.url(pose.url)} alt="" className="slot-art" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Screen>
  )
}

/**
 * N06 · 얼굴 그리기.
 *
 * 그림판은 개발해둔 DrawCell을 그대로 쓴다. 도구·획 데이터·PNG 내보내기 전부 기존 구현이다.
 * 확정 와이어프레임에 타이머가 없으므로 제한 시간을 끈다.
 * 템플릿은 포즈의 faceRect에 맞춘 얼굴 칸이다(src/draw/template.ts).
 *
 * 제출은 여기서 하지 않는다. 얼굴 파일과 획 데이터를 흐름 상태에 넣고 전체모습 확인(N06C)으로 넘긴다.
 */
export function DrawFace({ nav, flow, patch }: ScreenProps) {
  const [failed, setFailed] = useState(false)
  const api = getApi()
  const catalog = useAsync((signal) => api.catalog(signal), [])

  // 고른 포즈의 faceRect가 곧 그릴 수 있는 영역이다. 선택을 건너뛴 상태(개발용 화면 이동)면
  // 카탈로그 첫 포즈로 대신 그린다.
  const data = catalog.state === 'ready' ? catalog.data : null
  const choice = data ? (findPose(data, flow.presetId, flow.poseId) ?? firstPose(data)) : null
  const faceRect = choice?.pose.faceRect

  /*
   * 엔진은 template이 바뀌면 다시 만들어진다(그리던 획이 날아간다).
   * faceRect 객체는 매 조회마다 새로 생기므로 값으로 메모이즈한다.
   */
  const faceWidth = faceRect?.width
  const faceHeight = faceRect?.height
  const template = useMemo(
    () =>
      faceWidth !== undefined && faceHeight !== undefined
        ? faceTemplate({ width: faceWidth, height: faceHeight })
        : null,
    [faceWidth, faceHeight],
  )

  if (catalog.state === 'loading' || !template) {
    return (
      <Screen title="얼굴 그리기">
        {catalog.state === 'error' ? (
          <ErrorBox message={errorMessage(catalog.error)} onRetry={catalog.reload} />
        ) : (
          <Loading label="얼굴 칸 불러오는 중" />
        )}
      </Screen>
    )
  }

  const characterName =
    (choice && data?.characters.find((c) => c.id === choice.presetId)?.name) ?? '선택한 캐릭터'

  return (
    <Screen title="얼굴 그리기" sub={`${characterName} · ${flow.nickname.trim() || '참여자'}`}>
      <DrawCell
        template={template}
        cellSize="large"
        minStrokes={2}
        timeLimitMs={null}
        submitLabel="전체모습 보기"
        pose={
          choice
            ? {
                url: api.url(choice.pose.url),
                canvas: choice.pose.canvas,
                faceRect: choice.pose.faceRect,
              }
            : undefined
        }
        onSubmit={({ face, strokes }) => {
          // PNG 인코딩 실패는 드물지만 조용히 넘기면 얼굴 없는 캐릭터가 등록된다.
          if (!face) {
            setFailed(true)
            return
          }
          patch({
            face,
            // 획 데이터는 재생(FR-15)용으로 같이 올린다. 서버는 파일로만 보관한다.
            replay: new Blob([JSON.stringify(strokes)], { type: 'application/json' }),
            // 다시 그린 그림은 다른 제출이다. 이전 시도의 멱등 키를 재사용하면
            // 서버가 지난 등록을 replayed로 돌려주고 새 그림이 올라가지 않는다.
            idempotencyKey: null,
          })
          nav('N06C')
        }}
      />
      {failed && <p className="error">그림을 저장하지 못했어요. 다시 시도해주세요.</p>}
    </Screen>
  )
}

/**
 * N06C · 전체모습 확인.
 *
 * 얼굴만 그린 상태에서는 캐릭터 전체가 어떻게 보이는지 알 수 없다. 배치(N07)로 넘기기 전에
 * 포즈 위에 얼굴을 얹은 결과를 한 번 보여주고 확정을 받는다.
 */
export function FullBodyConfirm({ nav, flow }: ScreenProps) {
  const api = getApi()
  const catalog = useAsync((signal) => api.catalog(signal), [])
  const faceUrl = useObjectUrl(flow.face)

  const data = catalog.state === 'ready' ? catalog.data : null
  const choice = data ? (findPose(data, flow.presetId, flow.poseId) ?? firstPose(data)) : null

  if (catalog.state === 'loading') {
    return (
      <Screen title="전체모습 확인">
        <Loading />
      </Screen>
    )
  }
  if (catalog.state === 'error') {
    return (
      <Screen title="전체모습 확인">
        <ErrorBox message={errorMessage(catalog.error)} onRetry={catalog.reload} />
      </Screen>
    )
  }

  return (
    <Screen
      title="전체모습 확인"
      actions={
        <>
          <button type="button" onClick={() => nav('N06')}>
            다시 그리기
          </button>
          <button type="button" disabled={!choice || !flow.face} onClick={() => nav('N07')}>
            확정
          </button>
        </>
      }
    >
      {choice && (
        <Figure
          poseUrl={api.url(choice.pose.url)}
          faceUrl={faceUrl}
          faceRect={choice.pose.faceRect}
          canvas={choice.pose.canvas}
        />
      )}

      <div className="copy-group">
        <p className="copy is-large">이 모습으로 확정할까요?</p>
        <p className="copy">확정하면 배경에 배치할 수 있어요.</p>
        {!flow.face && <p className="error">그린 얼굴이 없어요. 얼굴 그리기부터 해야 합니다.</p>}
      </div>
    </Screen>
  )
}

/** N09 · 배치 완료. */
export function JoinDone(props: ScreenProps) {
  return <SceneView {...props} />
}

/**
 * 등록을 마친 뒤 보는 화면들의 공통 뷰(N09 / N09R / N11).
 *
 * 세 화면 모두 "배경 + 등록된 캐릭터 + 저장/공유" 구조가 같고 문구만 다르다.
 *
 * 그림 저장은 서버를 거치지 않는다. 서버는 합성을 하지 않으므로(GET /result = scene JSON)
 * 배경과 캐릭터를 클라이언트에서 캔버스로 합쳐 PNG로 내려받는다.
 * 종료된 방(N11)에서는 같은 이미지를 방의 결과 에셋으로도 올려둔다.
 */
export function SceneView({
  nav,
  flow,
  patch,
  closedView = false,
}: {
  nav: Nav
  flow: FlowState
  patch: ScreenProps['patch']
  /** 종료된 방(N11). 참여 유도 대신 결과만 보여준다. */
  closedView?: boolean
}) {
  const view = useScene(flow.roomId)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const ready = view.state === 'ready' ? view.data : null
  const scene = ready?.scene ?? null
  const roomTitle = flow.roomTitle || scene?.title || '우리의 그림 방'

  // 결과 열람 측정. 종료 결과 화면에서만 보낸다.
  const viewedRoomId = closedView ? scene?.roomId : undefined
  useEffect(() => {
    if (!viewedRoomId) return
    void getApi()
      .event({ roomId: viewedRoomId, type: 'result_view', visitorId: visitorId() })
      .catch(() => undefined)
  }, [viewedRoomId])

  /** 배경 + 캐릭터를 PNG 한 장으로 합친다. 저장·공유가 같은 결과를 쓴다. */
  const render = async () => {
    if (!ready) return null
    const { url, sprites } = sceneView(ready, flow.backgroundUrl)
    if (!url) {
      setMessage('배경이 없어 그림을 만들 수 없어요.')
      return null
    }
    const result = await composeScene({ backgroundUrl: url, sprites })
    if (result.missing > 0) {
      setMessage(`캐릭터 ${result.missing}명을 불러오지 못해 빼고 저장했어요.`)
    }
    return result
  }

  const fileName = `${roomTitle.replace(/[^\p{L}\p{N}]+/gu, '-')}.png`

  const save = async () => {
    if (busy) return
    setBusy(true)
    setMessage(null)
    try {
      const result = await render()
      if (!result) return
      downloadBlob(result.blob, fileName)
      setMessage(`그림을 저장했어요 (${result.width}×${result.height})`)

      /*
       * 더 이상 바뀌지 않는 방이면 결과를 방에도 남긴다(POST result-assets).
       * 진행 중인 방은 사람이 더 들어올 수 있어서 스냅샷을 올리지 않는다.
       * 저장 자체는 이미 끝났으므로 업로드가 실패해도 되돌리지 않는다.
       */
      if (scene && scene.status !== 'OPEN') {
        try {
          await getApi().saveResult(scene.roomId, scene.version, { image: result.blob })
        } catch (error) {
          setMessage(
            `그림은 저장했지만 방에 올리지는 못했어요: ${errorMessage(error instanceof Error ? error : new Error(String(error)))}`,
          )
        }
      }
    } catch (error) {
      setMessage(errorMessage(error instanceof Error ? error : new Error(String(error))))
    } finally {
      setBusy(false)
    }
  }

  const share = async () => {
    if (busy || !flow.roomId) return
    const roomId = flow.roomId
    const link = roomLink(roomId)

    setBusy(true)
    setMessage(null)
    let result
    try {
      result = await render()
    } catch (error) {
      setMessage(errorMessage(error instanceof Error ? error : new Error(String(error))))
      return
    } finally {
      /*
       * "만드는 중"은 합성까지다.
       * navigator.share는 사용자가 공유 시트를 닫을 때까지 끝나지 않고, 시트가 뜨지 않는
       * 환경에서는 영영 안 끝나기도 한다(헤드리스 크롬에서 확인). 거기에 버튼을 묶어두면
       * 화면이 잠긴 채로 남는다.
       */
      setBusy(false)
    }
    if (!result) return

    try {
      const how = await shareImage(result.blob, fileName, { title: roomTitle, url: link })

      if (how === 'unsupported') {
        await navigator.clipboard.writeText(link)
        setMessage('공유를 지원하지 않는 브라우저라 링크를 복사했어요.')
        return
      }
      if (how === 'cancelled') return

      setMessage('공유했어요.')
      void getApi()
        .event({
          roomId,
          type: 'share_click',
          visitorId: visitorId(),
          channel: how === 'image' ? 'web-share-image' : 'web-share-link',
        })
        .catch(() => undefined)
    } catch {
      setMessage('공유하지 못했어요. 링크를 직접 복사해주세요.')
    }
  }

  /*
   * 확정 설계: 추가 캐릭터 참여 허용. 완료 화면에서 같은 방에 캐릭터를 하나 더 그린다.
   * 이전 캐릭터의 제출 상태(DRAFT·멱등 키·배치)는 새 캐릭터에 쓰면 안 되므로 비운다.
   * 별명이 없으면(재접속) 별명부터 받도록 참여 첫 화면으로 보낸다.
   */
  const joinAgain = () => {
    patch({ draft: null, face: null, replay: null, placement: null, idempotencyKey: null })
    nav(flow.nickname.trim() ? 'N05' : 'N04')
  }

  return (
    <Screen
      title={closedView ? '그림방이 종료됐어요' : `<${roomTitle}>`}
      strong={closedView}
      sub={
        closedView
          ? `<${roomTitle}>`
          : scene
            ? `종료까지 ${remainingLabel(scene.closesAt)}`
            : undefined
      }
      largeSub={closedView}
      actions={
        closedView ? (
          <>
            <button type="button" disabled={!ready || busy} onClick={() => void save()}>
              {busy ? '만드는 중…' : '이미지 저장'}
            </button>
            <button
              type="button"
              disabled={!ready || busy || !flow.roomId}
              onClick={() => void share()}
            >
              공유
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={!flow.roomId} onClick={joinAgain}>
              이 방 참여하기
            </button>
            <button type="button" disabled={!ready || busy} onClick={() => void save()}>
              {busy ? '만드는 중…' : '이미지 저장하기'}
            </button>
          </>
        )
      }
    >
      <SceneBoard view={view} fallbackUrl={flow.backgroundUrl} />
      <div className="copy-group">
        <p className="copy">
          {closedView
            ? '완성된 그림을 저장하거나 공유해 보세요.'
            : // 과정 재생은 확정 시안에서도 "재생 방식 미정"이다. 자리만 둔다.
              '그리는 과정 · GIF 5초'}
        </p>
        {message && <p className="ok">{message}</p>}
      </div>
    </Screen>
  )
}
