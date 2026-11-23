import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { DrawEngine } from '../draw/engine.ts'
import type { Artwork, CharacterV2, SceneV2 } from '../lib/relay-draw/api-v2.ts'
import { ADMIN_PASSWORD_MAX, ADMIN_PASSWORD_MIN, NICKNAME_MAX } from '../lib/relay-draw/api-v2.ts'
import {
  onAdminAuthError,
  onCreateCharacterError,
  onLoadError,
  onSubmitError,
} from '../lib/relay-draw/errors.ts'
import { track } from '../lib/analytics.ts'
import { useAction, useAsync, useRemaining, useRemainingRatio, useScene } from '../lib/relay-draw/hooks.ts'
import {
  assetUrl,
  authenticateAdmin,
  confirmCharacter,
  hasAdminSession,
  loadCharacters,
  myCharacterId,
  replayBlob,
  resetSubmission,
  submitPlacement,
  trackVisit,
} from '../lib/relay-draw/screens.ts'
import { backgroundAspect, cropFace, faceAssetUrl, labelAnchor, nameTag, spriteBox } from './character-art.ts'
import { Sprite } from './character.tsx'
import { DrawTools, FaceBoard } from './draw-face.tsx'
import { Missing } from './host.tsx'
import { NameTag, NameTags, NameToggle, ScenePreview } from './scene.tsx'
import { useSaveImage } from './save-image.ts'
import { TransformControls } from './transform-controls.tsx'
import { clamp, fingerPair, MAX_SCALE, MIN_SCALE, normalizeRotation, pinchTransform, scaleFromCorner } from './transform.ts'
import type { FlowState, PlacementDraft, ScreenProps } from './types.ts'
import { containSize, useElementSize } from './layout.ts'
import { Body, Cta, Field, Foot, Head, HScroll, Page, RemainingBar } from './ui.tsx'

/** 방이 있어야 하는 화면 공통. scene 폴링 + 오류 시 화면 전이. */
function useRoomScene({ flow, nav, toast }: Pick<ScreenProps, 'flow' | 'nav' | 'toast'>) {
  const roomId = flow.room?.roomId ?? null
  const { scene, fetchedAt, error, refresh } = useScene(roomId)
  const remaining = useRemaining(scene ?? flow.room, fetchedAt)
  const ratio = useRemainingRatio(scene ?? flow.room, fetchedAt)

  useEffect(() => {
    if (!error) return
    const action = onLoadError(error)
    if (action.kind === 'goto') nav(action.screen)
    else if (!scene) toast(action.message)
  }, [error, nav, scene, toast])

  return { roomId, scene, remaining, ratio, refresh }
}

/** scene이 오기 전에도 배경은 room 정보로 바로 그린다. */
function sceneBackground(flow: FlowState, scene: SceneV2 | null) {
  return scene?.background ?? flow.room?.background ?? null
}

/** N04 / N04L — 최초 참여. 배경이 가로면 미리보기가 가로로 그려진다(N04L). */
export function JoinStart(props: ScreenProps) {
  const { nav, flow, patch } = props
  const { roomId, scene, remaining, ratio } = useRoomScene(props)
  const background = sceneBackground(flow, scene)

  useEffect(() => {
    if (roomId) trackVisit(roomId)
    if (roomId) track.joinStart()
  }, [roomId])

  if (!flow.room || !background) return <Missing />

  return (
    <Page>
      <Head title={flow.room.title} />
      <RemainingBar label={remaining} ratio={ratio} />
      <Body gap={16}>
        <ScenePreview
          background={background}
          characters={scene?.characters}
          maxHeight={428}
          showNames={flow.showNames}
          onToggleNames={() => patch({ showNames: !flow.showNames })}
        />
        <Field
          label="별명"
          value={flow.nickname}
          placeholder="별명을 입력해 주세요"
          maxLength={NICKNAME_MAX}
          onChange={(nickname) => patch({ nickname })}
          onEnter={() => nav('N05')}
        />
      </Body>
      <Foot
        below={
          // 방장 진입: CTA 아래 밑줄 글자(디자인 피드백). 공통 링크 + 관리 비밀번호.
          <button
            type="button"
            className="text-link"
            onClick={() => nav(roomId && hasAdminSession(roomId) ? 'N10' : 'N04M')}
          >
            방장 관리 페이지
          </button>
        }
      >
        <Cta onClick={() => nav('N05')}>캐릭터 고르기</Cta>
      </Foot>
    </Page>
  )
}

/** N04M — 방 관리 인증. 방을 만들 때 정한 비밀번호. */
export function AdminAuth(props: ScreenProps) {
  const { nav, flow, toast } = props
  const { roomId, scene } = useRoomScene(props)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const auth = useAction(authenticateAdmin)
  const background = sceneBackground(flow, scene)

  if (!roomId || !background) return <Missing />

  const submit = async () => {
    if (password.length < ADMIN_PASSWORD_MIN) return
    setError(null)
    try {
      await auth.run(roomId, password)
      track.adminLogin()
      nav('N10')
    } catch (e) {
      const action = onAdminAuthError(e)
      if (action.kind === 'goto') nav(action.screen)
      else if (action.kind === 'inline') setError('비밀번호가 일치하지 않습니다.')
      else toast(action.message)
    }
  }

  return (
    <Page>
      <Head title="방 관리" sub="방을 만들 때 설정한 비밀번호를 입력해 주세요." />
      <Body gap={44}>
        {/* Figma N04M은 배경만 보여준다(캐릭터 없음). */}
        <ScenePreview background={background} maxHeight={260} />
        <div className="field">
          <Field
            label="관리 비밀번호"
            type="password"
            value={password}
            placeholder={`${ADMIN_PASSWORD_MIN}자리 이상`}
            maxLength={ADMIN_PASSWORD_MAX}
            autoFocus
            error={error}
            onChange={(v) => {
              setPassword(v)
              setError(null)
            }}
            onEnter={submit}
          />
        </div>
      </Body>
      <Foot>
        <Cta onClick={() => nav('N04')}>뒤로가기</Cta>
        <Cta disabled={password.length < ADMIN_PASSWORD_MIN || auth.pending} onClick={submit}>
          관리모드로
        </Cta>
      </Foot>
    </Page>
  )
}

/** N05 — 캐릭터 선택. 캐릭터별 포즈 4개(정방형 4열), 목록은 세로 스크롤. */
export function CharacterSelect({ nav, flow, patch, toast }: ScreenProps) {
  const characters = useAsync(() => loadCharacters(), [])

  useEffect(() => {
    if (characters.status === 'error') toast('캐릭터를 불러오지 못했어요.')
  }, [characters.status, toast])

  return (
    <Page variant="fixed">
      <Head title={flow.room?.title ?? '캐릭터 선택'} sub="원하는 캐릭터와 모습을 골라주세요." />
      <div className="char-list">
        {characters.data?.map((character) => (
          <section key={character.id} className="char-group">
            <h2 className="char-name">{character.name}</h2>
            <div className="char-row">
              {character.poses.map((pose) => {
                const selected = flow.pick?.presetId === character.id && flow.pick.poseId === pose.id
                return (
                  <button
                    key={pose.id}
                    type="button"
                    className="pose"
                    aria-label={`${character.name} ${pose.name}`}
                    aria-pressed={selected}
                    onClick={() => {
                      // 다른 포즈로 바꾸면 얼굴 영역이 달라지므로 그리던 얼굴은 버린다.
                      if (!selected) {
                        if (flow.face) URL.revokeObjectURL(flow.face.url)
                        track.characterSelect(character.id, pose.id)
                        patch({
                          pick: { presetId: character.id, poseId: pose.id, characterName: character.name },
                          artwork: pose as Artwork,
                          face: null,
                          placement: null,
                        })
                      }
                    }}
                  >
                    <img src={assetUrl(pose.url)} alt="" loading="lazy" />
                  </button>
                )
              })}
            </div>
          </section>
        ))}
      </div>
      <Foot>
        <Cta className="cta cta--back" onClick={() => nav('N04')}>
          뒤로가기
        </Cta>
        <Cta disabled={!flow.pick} onClick={() => nav('N06')}>
          얼굴 그리기
        </Cta>
      </Foot>
    </Page>
  )
}

/** N06 — 얼굴 그리기. 제한 시간 없음. */
export function DrawFace({ nav, flow, patch, toast }: ScreenProps) {
  const [engine, setEngine] = useState<DrawEngine | null>(null)
  const [strokeCount, setStrokeCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const art = flow.artwork

  if (!art || !flow.pick) return <Missing onBack={() => nav('N05')} />

  const finish = async () => {
    if (!engine || busy) return
    setBusy(true)
    try {
      const strokes = engine.getStrokes().map((s) => ({ ...s, points: [...s.points] }))
      const blob = await cropFace(engine.exportCanvas(), art)
      if (flow.face) URL.revokeObjectURL(flow.face.url)
      patch({ face: { strokes, blob, replay: replayBlob(strokes), url: URL.createObjectURL(blob) } })
      track.drawComplete(strokes.length)
      nav('N06C')
    } catch {
      toast('그림을 저장하지 못했어요. 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page>
      <Head title="자유롭게 그리기" sub="얼굴 밖에도, 몸에도 자유롭게 그려봐요!" />
      <Body gap={16}>
        <FaceBoard
          art={art}
          initialStrokes={flow.face?.strokes ?? null}
          onReady={setEngine}
          onStrokeCount={setStrokeCount}
        />
        <DrawTools engine={engine} onStrokeCount={setStrokeCount} />
      </Body>
      <Foot>
        {/* 캐릭터 다시 고르기. 지금 그리던 그림은 저장하지 않는다(완료 전이라 서버에도 없다). */}
        <Cta className="cta cta--back" disabled={busy} onClick={() => nav('N05')}>
          뒤로가기
        </Cta>
        <Cta disabled={strokeCount === 0 || busy} onClick={finish}>
          전체모습 보기
        </Cta>
      </Foot>
    </Page>
  )
}

/** N06C — 전체모습 확인. 확정하면 서버에 캐릭터(DRAFT)를 만든다. */
export function ConfirmLook({ nav, flow, toast }: ScreenProps) {
  const confirm = useAction(confirmCharacter)
  const [error, setError] = useState<string | null>(null)
  const [figureRef, box] = useElementSize<HTMLDivElement>()
  if (!flow.room || !flow.pick || !flow.artwork || !flow.face) return <Missing onBack={() => nav('N06')} />
  const { room, pick, artwork, face } = flow

  const submit = async () => {
    setError(null)
    try {
      await confirm.run(room.roomId, { nickname: flow.nickname, presetId: pick.presetId, poseId: pick.poseId })
      nav('N07')
    } catch (e) {
      const action = onCreateCharacterError(e)
      if (action.kind === 'goto') nav(action.screen)
      else if (action.kind === 'retry') toast(action.message)
      else setError(action.message)
    }
  }

  return (
    <Page>
      <Head title="전체모습 확인" />
      <Body gap={0}>
        <div className="stage" ref={figureRef}>
          {box.height > 0 && (
            <Sprite
              art={artwork}
              faceUrl={face.url}
              width={Math.min(245, box.width, box.height)}
              className="figure"
            />
          )}
        </div>
        <div className="head" style={{ paddingBottom: 140 }}>
          <p className="text text--lead">이 모습으로 확정할까요?</p>
          <p className="text">확정하면 배경에 배치할 수 있어요.</p>
          {error && <p className="text text--error">{error}</p>}
        </div>
      </Body>
      <Foot>
        <Cta onClick={() => nav('N06')} disabled={confirm.pending}>
          다시 그리기
        </Cta>
        <Cta onClick={submit} disabled={confirm.pending}>
          확정
        </Cta>
      </Foot>
    </Page>
  )
}

/** 제출(N07 "완료", E02 "다시 등록") 공통. */
function useSubmit({ nav, flow, toast }: Pick<ScreenProps, 'nav' | 'flow' | 'toast'>) {
  const action = useAction(submitPlacement)
  const run = async (placement: PlacementDraft) => {
    if (!flow.room || !flow.face) return
    try {
      await action.run(
        flow.room.roomId,
        { face: flow.face.blob, replay: flow.face.replay },
        { x: placement.x, y: placement.y, scale: placement.scale, rotation: placement.rotation },
      )
      track.characterSubmit()
      nav('N09')
    } catch (e) {
      const next = onSubmitError(e)
      if (next.kind === 'goto') nav(next.screen)
      else toast(next.message)
    }
  }
  return { run, pending: action.pending }
}

type Point = { x: number; y: number }

/** 배치 화면 제스처. 한 손가락은 역할(이동·크기·회전·좌우 이동)별, 두 손가락은 크기+회전. */
type PlaceGesture =
  | { kind: 'move'; startX: number; startY: number; from: PlacementDraft }
  | { kind: 'resize'; from: PlacementDraft }
  | { kind: 'rotate'; from: PlacementDraft; startAngle: number }
  | { kind: 'pan'; startX: number; from: number }
  | { kind: 'pinch'; from: PlacementDraft; distance: number; angle: number }

/**
 * N07 — 자유 배치.
 *
 * 배경을 뷰포트 높이에 맞춘다. 배경이 뷰포트보다 넓으면(가로 배경) 좌우로 움직일 수 있고,
 * 아래 외부 스크롤(트랙 300 · 손잡이 80)로도 옮긴다.
 * 내 캐릭터는 끌어서 옮기고 네 모서리 핸들로 크기를 바꾼다(중심 기준 대칭).
 */
export function Placement(props: ScreenProps) {
  const { nav, flow, patch } = props
  const { scene } = useRoomScene(props)
  const submit = useSubmit(props)
  const [stageRef, stage] = useElementSize<HTMLDivElement>()
  const viewRef = useRef<HTMLDivElement | null>(null)
  const [offset, setOffset] = useState(0)
  const targetRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<PlaceGesture | null>(null)
  /** 화면에 닿아 있는 손가락(포인터)들의 현재 위치. 두 손가락 제스처 판정에 쓴다. */
  const pointers = useRef(new Map<number, Point>())

  const background = sceneBackground(flow, scene)
  const art = flow.artwork
  const aspect = background ? backgroundAspect(background) : 1
  // 세로 배경: 뷰포트(최대 343×686) 안에 배경 전체를 맞춘다.
  // 가로 배경: 높이(최대 630)를 맞추고 넘치는 폭은 좌우 이동(Figma 79:49).
  const availW = Math.max(0, stage.width - 4)
  const availH = Math.max(0, stage.height - 4)
  const portrait = aspect < 1
  const fit = containSize(aspect, availW, Math.min(availH, 686))
  const worldH = portrait ? fit.height : Math.min(availH, 630)
  const worldW = portrait ? fit.width : worldH * aspect
  const viewW = Math.min(availW, worldW)
  const maxOffset = Math.max(0, worldW - viewW)
  const ox = clamp(offset, 0, maxOffset)

  // 한 번도 옮기지 않았으면 보이는 영역 가운데를 따라간다(가로 배경을 넘겨 봐도 화면 안에 있다).
  const placement: PlacementDraft | null =
    flow.placement ??
    (worldW
      ? {
          x: (ox + viewW / 2) / worldW,
          y: 0.6,
          scale: clamp((viewW * 0.34) / worldW, MIN_SCALE, MAX_SCALE),
          rotation: 0,
        }
      : null)

  if (!flow.room || !background || !art || !flow.face) return <Missing onBack={() => nav('N06C')} />

  const setPlacement = (p: PlacementDraft) => patch({ placement: p })
  const others: CharacterV2[] = scene?.characters ?? []
  const mine = placement && spriteBox({ ...placement, artwork: art }, { width: worldW, height: worldH })

  const worldPoint = (e: ReactPointerEvent) => {
    const rect = viewRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left + ox, y: e.clientY - rect.top }
  }

  /** 내 캐릭터 중심(화면 좌표). 회전해도 바운딩 박스 중심은 그대로다. */
  const targetCenter = (): Point | null => {
    const rect = targetRef.current?.getBoundingClientRect()
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null
  }

  /** 지금 닿아 있는 두 손가락 사이 거리·각도. */
  const pair = () => fingerPair(pointers.current.values())

  const startPinch = () => {
    const p = pair()
    if (!p || !placement) return
    drag.current = { kind: 'pinch', from: placement, distance: p.distance, angle: p.angle }
  }

  const onDown = (e: ReactPointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    e.currentTarget.setPointerCapture(e.pointerId)
    // 두 번째 손가락이 닿으면 어디서든 내 캐릭터 크기·회전으로 바꾼다. 캐릭터가 작아도 집기 쉽다.
    if (pointers.current.size === 2) {
      startPinch()
      return
    }
    if (pointers.current.size > 2 || !placement) return
    const role = (e.target as Element).closest('[data-role]')?.getAttribute('data-role')
    if (role === 'resize') {
      drag.current = { kind: 'resize', from: placement }
    } else if (role === 'rotate') {
      const c = targetCenter()
      if (!c) return
      drag.current = { kind: 'rotate', from: placement, startAngle: Math.atan2(e.clientY - c.y, e.clientX - c.x) }
    } else if (role === 'target') {
      drag.current = { kind: 'move', startX: e.clientX, startY: e.clientY, from: placement }
    } else if (maxOffset > 0) {
      drag.current = { kind: 'pan', startX: e.clientX, from: ox }
    }
  }

  const onMove = (e: ReactPointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const d = drag.current
    if (!d || !placement) return
    if (d.kind === 'pinch') {
      const p = pair()
      if (!p) return
      setPlacement({ ...d.from, ...pinchTransform(d.from, d, p) })
    } else if (d.kind === 'move') {
      setPlacement({
        ...d.from,
        x: clamp(d.from.x + (e.clientX - d.startX) / worldW, 0, 1),
        y: clamp(d.from.y + (e.clientY - d.startY) / worldH, 0, 1),
      })
    } else if (d.kind === 'resize') {
      setPlacement({
        ...d.from,
        scale: scaleFromCorner(d.from, worldPoint(e), { width: worldW, height: worldH }, art.canvas),
      })
    } else if (d.kind === 'rotate') {
      const c = targetCenter()
      if (!c) return
      const angle = Math.atan2(e.clientY - c.y, e.clientX - c.x)
      setPlacement({
        ...d.from,
        rotation: normalizeRotation(d.from.rotation + ((angle - d.startAngle) * 180) / Math.PI),
      })
    } else {
      setOffset(clamp(d.from - (e.clientX - d.startX), 0, maxOffset))
    }
  }

  const onUp = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId)
    // 두 손가락 중 하나를 떼면 남은 손가락으로 이어서 끌지 않는다(캐릭터가 튀는 것을 막는다).
    // 세 손가락 이상이었다가 둘이 남으면 그 둘로 다시 시작한다.
    if (pointers.current.size === 2) startPinch()
    else drag.current = null
  }

  return (
    <Page variant="tight">
      <Body gap={16}>
        <div className="stage" ref={stageRef}>
          <div
            ref={viewRef}
            className="place-view"
            style={{ width: viewW, height: worldH, flex: 'none' }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            {worldH > 0 && (
              <div className="place-world" style={{ width: worldW, transform: `translateX(${-ox}px)` }}>
                <img
                  className="scene-bg"
                  src={assetUrl(background.url)}
                  alt=""
                  draggable={false}
                />
                {[...others]
                  .sort((a, b) => a.zIndex - b.zIndex)
                  .map((c) => {
                    const box = spriteBox(c, { width: worldW, height: worldH })
                    return (
                      <Sprite
                        key={c.id}
                        art={c.artwork}
                        faceUrl={faceAssetUrl(c)}
                        width={box.width}
                        style={{
                          left: box.left,
                          top: box.top,
                          transform: c.rotation ? `rotate(${c.rotation}deg)` : undefined,
                        }}
                      />
                    )
                  })}
                {flow.showNames && (
                  <NameTags
                    characters={[...others].sort((a, b) => a.zIndex - b.zIndex)}
                    size={{ width: worldW, height: worldH }}
                  />
                )}
                {mine && placement && (
                  <div
                    ref={targetRef}
                    className="place-target"
                    data-role="target"
                    style={{
                      left: mine.left,
                      top: mine.top,
                      width: mine.width,
                      height: mine.height,
                      transform: placement.rotation ? `rotate(${placement.rotation}deg)` : undefined,
                    }}
                  >
                    <Sprite art={art} faceUrl={flow.face.url} width={mine.width} style={{ left: 0, top: 0 }} />
                    <TransformControls
                      width={mine.width}
                      height={mine.height}
                      onRotateBy={(deg) =>
                        setPlacement({ ...placement, rotation: normalizeRotation(placement.rotation + deg) })
                      }
                    />
                  </div>
                )}
                {/* 내 이름표는 회전하는 배치 상자 밖에 둔다(캐릭터가 돌아도 똑바로). */}
                {mine && placement && flow.showNames && (
                  <NameTag label={nameTag(flow.nickname, true)} at={labelAnchor(mine, placement.rotation)} />
                )}
              </div>
            )}
            {others.length > 0 && (
              <NameToggle on={flow.showNames} onToggle={() => patch({ showNames: !flow.showNames })} />
            )}
          </div>
        </div>
        {maxOffset > 0 && <HScroll value={ox / maxOffset} onChange={(t) => setOffset(t * maxOffset)} />}
      </Body>
      <Foot>
        <Cta disabled={!placement || submit.pending} onClick={() => placement && submit.run(placement)}>
          {submit.pending ? '등록 중…' : '완료'}
        </Cta>
      </Foot>
    </Page>
  )
}

/** N09 배치 완료. */
export function JoinDone(props: ScreenProps) {
  return <Finished {...props} revisit={false} />
}

/** N09R 완료자 재접속. */
export function JoinRevisit(props: ScreenProps) {
  return <Finished {...props} revisit />
}

/**
 * N09 / N09R. 그림은 같고 머리말·버튼이 다르다(Figma 21:1104, 21:1121).
 *   N09: "친구들과 함께 …완성했어요!" / 이미지 저장하기(위, 넓게) + 이 방 참여하기 · 새로운 방 만들기
 *   N09R: 종료까지 남은 시간 / 이 방 참여하기 · 이미지 저장하기
 */
function Finished(props: ScreenProps & { revisit: boolean }) {
  const { nav, flow, patch, toast, revisit } = props
  const { roomId, scene, remaining, ratio } = useRoomScene(props)
  const image = useSaveImage(toast)
  const background = sceneBackground(flow, scene)
  if (!flow.room || !background) return <Missing />

  const joinAgain = () => {
    // 추가 캐릭터 참여. 별명은 남기고 캐릭터부터 다시 고른다.
    if (flow.face) URL.revokeObjectURL(flow.face.url)
    patch({ pick: null, artwork: null, face: null, placement: null })
    nav('N04')
  }
  const saveImage = (
    <Cta disabled={!scene || image.saving} onClick={() => image.save(scene, flow.room?.title ?? '', flow.showNames)}>
      이미지 저장하기
    </Cta>
  )

  return (
    <Page>
      {/* N09R은 머리말 대신 남은 시간 게이지(Figma 21:1121). */}
      <Head title={flow.room.title} sub={revisit ? undefined : '친구들과 함께 귀여운 이미지를 완성했어요!'} />
      {revisit && <RemainingBar label={remaining} ratio={ratio} />}
      <Body gap={24}>
        <ScenePreview
          background={background}
          characters={scene?.characters}
          maxHeight={revisit ? 468 : 440}
          showNames={flow.showNames}
          onToggleNames={() => patch({ showNames: !flow.showNames })}
          mineId={roomId ? myCharacterId(roomId) : null}
        />
      </Body>
      {revisit ? (
        <Foot>
          <Cta onClick={joinAgain}>이 방 참여하기</Cta>
          {saveImage}
        </Foot>
      ) : (
        <Foot stack>
          {saveImage}
          <Cta onClick={joinAgain}>이 방 참여하기</Cta>
          <Cta
            onClick={() => {
              // 새 방은 방장 흐름(N02)부터. 이전에 만들던 방 정보는 비운다.
              if (flow.pendingPhoto) URL.revokeObjectURL(flow.pendingPhoto.url)
              patch({ background: null, pendingPhoto: null, title: '', created: null })
              nav('N02')
            }}
          >
            새로운 방 만들기
          </Cta>
        </Foot>
      )}
    </Page>
  )
}

/** E02 — 등록 실패. 그림과 위치는 그대로 두고 같은 요청으로 다시 등록한다. */
export function RegisterFailed(props: ScreenProps) {
  const { nav, flow } = props
  const { scene } = useRoomScene(props)
  const submit = useSubmit(props)
  const background = sceneBackground(flow, scene)
  if (!flow.room || !background || !flow.artwork || !flow.face || !flow.placement) {
    return <Missing onBack={() => nav('N07')} />
  }
  const { artwork, face, placement } = flow

  return (
    <Page>
      <Head title="등록하지 못했어요" plain />
      <Body gap={34}>
        <ScenePreview background={background} characters={scene?.characters} maxHeight={438}>
          {(size) => {
            const box = spriteBox({ ...placement, artwork }, size)
            return (
              <Sprite
                art={artwork}
                faceUrl={face.url}
                width={box.width}
                style={{
                  left: box.left,
                  top: box.top,
                  transform: placement.rotation ? `rotate(${placement.rotation}deg)` : undefined,
                }}
              />
            )
          }}
        </ScenePreview>
        <div className="head" style={{ gap: 11 }}>
          <p className="text">그림과 배치 위치는 그대로 유지돼요.</p>
          <p className="text">다시 등록해 주세요.</p>
        </div>
      </Body>
      <Foot>
        <Cta disabled={submit.pending} onClick={() => submit.run(placement)}>
          {submit.pending ? '등록 중…' : '다시 등록'}
        </Cta>
        <Cta
          disabled={submit.pending}
          onClick={() => {
            resetSubmission(flow.room!.roomId)
            nav('N07')
          }}
        >
          배치로 돌아가기
        </Cta>
      </Foot>
    </Page>
  )
}
