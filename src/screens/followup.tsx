import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import deleteIcon from '../assets/icon-delete.svg'
import { track } from '../lib/analytics.ts'
import { ApiError } from '../lib/relay-draw/api-client.ts'
import { onAdminError, onLoadError } from '../lib/relay-draw/errors.ts'
import { useAction, useAsync, useScene } from '../lib/relay-draw/hooks.ts'
import { roomLink } from '../lib/relay-draw/entry.ts'
import { createdRoomStore } from '../lib/relay-draw/storage.ts'
import {
  assetUrl,
  deleteCharacters,
  loadAdminCharacters,
  savePlacements,
  shareRoom,
  trackResultView,
} from '../lib/relay-draw/screens.ts'
import { backgroundAspect, faceAssetUrl, spriteBox } from './character-art.ts'
import { Sprite } from './character.tsx'
import { Missing } from './host.tsx'
import { useSaveImage } from './save-image.ts'
import { TransformControls } from './transform-controls.tsx'
import { clamp, fingerPair, normalizeRotation, pinchTransform, scaleFromCorner } from './transform.ts'
import { NameTags, NameToggle, ScenePreview } from './scene.tsx'
import type { ScreenProps } from './types.ts'
import { useElementSize } from './layout.ts'
import { Body, Cta, ErrorNotice, Foot, Head, HScroll, Page } from './ui.tsx'

/**
 * N10 — 방장 관리(Figma 158:2299 · 158:2020 · 171:57).
 *
 * 그림이 화면 위를 꽉 채우고(배경 cover), 아래 시트에서 캐릭터를 고른다.
 * 고른 캐릭터는 점선 상자 + 삭제 버튼(오른쪽 위)이 붙고, 끌어서 옮기고, 모서리 손잡이·두 손가락으로
 * 크기를, 아래 회전 손잡이·두 손가락 비틀기로 각도를 바꾼다(N07 배치와 같은 도구).
 * 바꾼 배치는 "변경사항 저장"으로 한 번에 보낸다(PATCH admin/placements, 위치·크기·회전).
 * 그림이 화면보다 크면 빈 곳을 끌어 그림을 움직인다. 가로 배경은 아래 좌우 스크롤도 있다.
 */
export function HostManage({ nav, flow, patch, toast }: ScreenProps) {
  const roomId = flow.room?.roomId ?? null
  const { scene, refresh } = useScene(roomId)
  const admin = useAsync(
    (signal) => (roomId ? loadAdminCharacters(roomId, signal) : Promise.resolve([])),
    [roomId, scene?.version],
  )
  const save = useAction(savePlacements)
  const [selected, setSelected] = useState<string | null>(flow.deleteTarget?.id ?? null)
  /** 저장 전 바꾼 배치. 캐릭터 id → 위치·크기·회전. */
  const [moved, setMoved] = useState<Record<string, Transform>>({})
  const [areaRef, area] = useElementSize<HTMLDivElement>()
  const [rosterRef, roster] = useElementSize<HTMLDivElement>()
  const [scroll, setScroll] = useState({ left: 0, width: 0 })
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const viewRef = useRef<HTMLDivElement | null>(null)
  const targetRef = useRef<HTMLDivElement | null>(null)
  /** 화면에 닿아 있는 손가락들. 두 손가락이면 고른 캐릭터 크기·회전. */
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const drag = useRef<
    | { kind: 'move'; id: string; startX: number; startY: number; from: Transform }
    | { kind: 'resize'; id: string; from: Transform }
    | { kind: 'rotate'; id: string; from: Transform; startAngle: number }
    | { kind: 'pinch'; id: string; from: Transform; distance: number; angle: number }
    | { kind: 'pan'; startX: number; startY: number; from: { x: number; y: number } }
    | null
  >(null)

  useEffect(() => {
    if (admin.status !== 'error') return
    const action = onAdminError(admin.error)
    if (action.kind === 'goto') nav(action.screen)
    else toast(action.message)
  }, [admin.status, admin.error, nav, toast])

  const background = scene?.background ?? flow.room?.background
  if (!flow.room || !background || !roomId) return <Missing />

  // 그림 크기: 화면을 꽉 채운다(cover). 넘치는 쪽은 끌어서 본다.
  const aspect = backgroundAspect(background)
  const wide = area.width > 0 && area.height > 0 && aspect > area.width / area.height
  const worldW = wide ? area.height * aspect : area.width
  const worldH = wide ? area.height : area.width / aspect
  const maxPan = { x: Math.max(0, worldW - area.width), y: Math.max(0, worldH - area.height) }
  const px = clamp(pan.x, 0, maxPan.x)
  const py = clamp(pan.y, 0, maxPan.y)

  const characters = (admin.data ?? []).map((c) => (moved[c.id] ? { ...c, ...moved[c.id] } : c))
  const ordered = [...characters].sort((a, b) => a.zIndex - b.zIndex)
  const current = characters.find((c) => c.id === selected) ?? null
  const thumbFace = (c: (typeof characters)[number]) =>
    c.faceImage ? assetUrl(c.faceImage.url) : faceAssetUrl(c)
  const changed = Object.keys(moved).length > 0

  const bar = scroll.width > 0 ? Math.min(1, roster.width / scroll.width) : 1
  const barLeft = scroll.width > roster.width ? (scroll.left / (scroll.width - roster.width)) * (1 - bar) : 0

  const transformOf = (c: { x: number; y: number; scale: number; rotation: number }): Transform => ({
    x: c.x,
    y: c.y,
    scale: c.scale,
    rotation: c.rotation,
  })
  const setTransform = (id: string, t: Transform) => setMoved((m) => ({ ...m, [id]: t }))

  /** 고른 캐릭터 중심(화면 좌표). 회전해도 바운딩 박스 중심은 그대로다. */
  const targetCenter = () => {
    const rect = targetRef.current?.getBoundingClientRect()
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null
  }
  const worldPoint = (e: ReactPointerEvent) => {
    const rect = viewRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left + px, y: e.clientY - rect.top + py }
  }
  const startPinch = () => {
    const p = fingerPair(pointers.current.values())
    if (!p || !current) return
    drag.current = { kind: 'pinch', id: current.id, from: transformOf(current), distance: p.distance, angle: p.angle }
  }

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    e.currentTarget.setPointerCapture(e.pointerId)
    if (pointers.current.size === 2) {
      startPinch()
      return
    }
    if (pointers.current.size > 2) return
    const el = e.target as Element
    const role = el.closest('[data-role]')?.getAttribute('data-role')
    if (current && role === 'resize') {
      drag.current = { kind: 'resize', id: current.id, from: transformOf(current) }
      return
    }
    if (current && role === 'rotate') {
      const c = targetCenter()
      if (!c) return
      drag.current = {
        kind: 'rotate',
        id: current.id,
        from: transformOf(current),
        startAngle: Math.atan2(e.clientY - c.y, e.clientX - c.x),
      }
      return
    }
    const id = el.closest('[data-id]')?.getAttribute('data-id')
    const c = id ? characters.find((it) => it.id === id) : null
    if (c) {
      setSelected(c.id)
      drag.current = { kind: 'move', id: c.id, startX: e.clientX, startY: e.clientY, from: transformOf(c) }
    } else {
      drag.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, from: { x: px, y: py } }
    }
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const d = drag.current
    if (!d || worldW <= 0) return
    if (d.kind === 'pinch') {
      const p = fingerPair(pointers.current.values())
      if (p) setTransform(d.id, { ...d.from, ...pinchTransform(d.from, d, p) })
    } else if (d.kind === 'move') {
      setTransform(d.id, {
        ...d.from,
        x: clamp(d.from.x + (e.clientX - d.startX) / worldW, 0, 1),
        y: clamp(d.from.y + (e.clientY - d.startY) / worldH, 0, 1),
      })
    } else if (d.kind === 'resize') {
      const art = characters.find((c) => c.id === d.id)?.artwork
      if (!art) return
      setTransform(d.id, {
        ...d.from,
        scale: scaleFromCorner(d.from, worldPoint(e), { width: worldW, height: worldH }, art.canvas),
      })
    } else if (d.kind === 'rotate') {
      const c = targetCenter()
      if (!c) return
      const angle = Math.atan2(e.clientY - c.y, e.clientX - c.x)
      setTransform(d.id, {
        ...d.from,
        rotation: normalizeRotation(d.from.rotation + ((angle - d.startAngle) * 180) / Math.PI),
      })
    } else {
      setPan({ x: d.from.x - (e.clientX - d.startX), y: d.from.y - (e.clientY - d.startY) })
    }
  }
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
    // 두 손가락 중 하나를 떼면 남은 손가락으로 이어 끌지 않는다(캐릭터가 튀지 않게).
    if (pointers.current.size === 2) startPinch()
    else drag.current = null
  }

  const askDelete = () => {
    if (!current) return
    patch({ deleteTarget: { id: current.id, artwork: current.artwork, faceUrl: thumbFace(current) } })
    nav('N10C')
  }

  const saveChanges = async () => {
    if (!changed || !scene) return
    try {
      await save.run(
        roomId,
        scene.version,
        Object.entries(moved).map(([characterId, t]) => ({ characterId, ...t })),
      )
      track.adminSave(Object.keys(moved).length)
      setMoved({})
      refresh()
      toast('변경사항을 저장했어요.')
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // 그 사이 누가 참여하거나 지웠다. 최신 장면으로 다시 맞춘다.
        setMoved({})
        refresh()
        toast('그림이 바뀌어서 다시 불러왔어요. 다시 옮겨 주세요.')
        return
      }
      const action = onAdminError(e)
      if (action.kind === 'goto') nav(action.screen)
      else toast(action.message)
    }
  }

  const box = current && spriteBox(current, { width: worldW, height: worldH })

  return (
    <section className="page page--manage">
      <div className="manage-scene" ref={areaRef}>
        <div
          ref={viewRef}
          className="manage-view"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {worldW > 0 && (
            <div
              className="place-world"
              style={{ width: worldW, height: worldH, transform: `translate(${-px}px, ${-py}px)` }}
            >
              <img className="scene-bg" src={assetUrl(background.url)} alt="" draggable={false} />
              {ordered.map((c) => {
                const b = spriteBox(c, { width: worldW, height: worldH })
                return (
                  <Sprite
                    key={c.id}
                    art={c.artwork}
                    faceUrl={thumbFace(c)}
                    width={b.width}
                    style={{
                      left: b.left,
                      top: b.top,
                      transform: c.rotation ? `rotate(${c.rotation}deg)` : undefined,
                    }}
                  />
                )
              })}
              {/* 잡기 영역. 스프라이트는 pointer-events가 없어서 위에 투명 상자를 둔다. */}
              {ordered.map((c) => {
                const b = spriteBox(c, { width: worldW, height: worldH })
                return (
                  <div
                    key={`hit-${c.id}`}
                    className="manage-hit"
                    data-id={c.id}
                    style={{
                      left: b.left,
                      top: b.top,
                      width: b.width,
                      height: b.height,
                      transform: c.rotation ? `rotate(${c.rotation}deg)` : undefined,
                    }}
                  />
                )
              })}
              {flow.showNames && <NameTags characters={ordered} size={{ width: worldW, height: worldH }} />}
              {current && box && (
                // 고른 캐릭터: 캐릭터와 같이 도는 상자 + 크기·회전 손잡이 + 삭제 버튼(Figma 158:2313).
                <div
                  ref={targetRef}
                  className="manage-target"
                  data-id={current.id}
                  style={{
                    left: box.left,
                    top: box.top,
                    width: box.width,
                    height: box.height,
                    transform: current.rotation ? `rotate(${current.rotation}deg)` : undefined,
                  }}
                >
                  <TransformControls
                    width={box.width}
                    height={box.height}
                    omit="tr"
                    onRotateBy={(deg) =>
                      setTransform(current.id, {
                        ...transformOf(current),
                        rotation: normalizeRotation(current.rotation + deg),
                      })
                    }
                  >
                    <button
                      type="button"
                      className="manage-delete"
                      aria-label="선택한 캐릭터 삭제"
                      style={{ left: box.width - 13, top: -10 }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={askDelete}
                    >
                      <img src={deleteIcon} alt="" />
                    </button>
                  </TransformControls>
                </div>
              )}
            </div>
          )}
        </div>
        {characters.length > 0 && (
          <NameToggle on={flow.showNames} onToggle={() => patch({ showNames: !flow.showNames })} />
        )}
        {maxPan.x > 0 && (
          <div className="manage-hscroll">
            <HScroll value={px / maxPan.x} onChange={(t) => setPan((p) => ({ ...p, x: t * maxPan.x }))} />
          </div>
        )}
      </div>

      <div className="manage-sheet">
        <h1 className="manage-title">방 관리</h1>
        <p className="text">
          {characters.length === 0 && admin.status === 'success'
            ? '아직 배치된 캐릭터가 없어요.'
            : '캐릭터를 선택하여 이동하거나 삭제할 수 있어요.'}
        </p>
        <div className="manage-list">
          <div
            className="roster"
            ref={rosterRef}
            onScroll={(e) => setScroll({ left: e.currentTarget.scrollLeft, width: e.currentTarget.scrollWidth })}
          >
            {characters.map((c) => (
              <button
                key={c.id}
                type="button"
                className="roster-item"
                aria-label={c.nickname || '캐릭터'}
                aria-pressed={c.id === current?.id}
                onClick={() => setSelected(c.id)}
              >
                <Sprite art={c.artwork} faceUrl={thumbFace(c)} width={51} />
              </button>
            ))}
          </div>
          {characters.length > 0 && (
            <div className="roster-bar">
              <div className="roster-bar-fill" style={{ left: `${barLeft * 100}%`, width: `${bar * 100}%` }} />
            </div>
          )}
        </div>
        <div className="manage-cta">
          <Cta onClick={() => nav('N04')}>관리 나가기</Cta>
          <Cta disabled={!changed || save.pending} onClick={saveChanges}>
            {save.pending ? '저장 중…' : '변경사항 저장'}
          </Cta>
        </div>
      </div>
    </section>
  )
}


/** 배경 위 캐릭터 배치(서버 좌표). */
type Transform = { x: number; y: number; scale: number; rotation: number }

/** N10C — 삭제 확인. */
export function DeleteConfirm({ nav, flow, patch, toast }: ScreenProps) {
  const remove = useAction(deleteCharacters, { cooldownKey: 'delete-character' })
  const target = flow.deleteTarget
  if (!flow.room || !target) return <Missing onBack={() => nav('N10')} />
  const roomId = flow.room.roomId

  return (
    <Page>
      <Head title="삭제 확인" />
      {/* Figma 21:1165: 안내 문구가 위, 캐릭터가 아래. */}
      <Body gap={40}>
        <div className="head" style={{ gap: 19, paddingTop: 30 }}>
          <p className="text text--lead">선택한 캐릭터를 삭제할까요?</p>
          <p className="text">선택한 캐릭터가 방의 그림에서 사라집니다.</p>
        </div>
        <div className="stage" style={{ flex: 'none' }}>
          <Sprite art={target.artwork} faceUrl={target.faceUrl} width={190} className="figure" />
        </div>
      </Body>
      <Foot>
        <Cta disabled={remove.pending} onClick={() => nav('N10')}>
          취소
        </Cta>
        <Cta
          disabled={remove.blocked}
          onClick={async () => {
            try {
              await remove.run(roomId, [target.id])
              patch({ deleteTarget: null })
              track.adminDelete()
              toast('캐릭터를 삭제했어요.')
              nav('N10')
            } catch (e) {
              const action = onAdminError(e)
              if (action.kind === 'goto') nav(action.screen)
              else toast(action.message)
            }
          }}
        >
          삭제
        </Cta>
      </Foot>
    </Page>
  )
}

/** N11 — 종료 결과. */
export function Result({ nav, flow, patch, toast }: ScreenProps) {
  const roomId = flow.room?.roomId ?? null
  const { scene, error } = useScene(roomId)
  const image = useSaveImage(toast)

  useEffect(() => {
    if (roomId) trackResultView(roomId)
  }, [roomId])

  useEffect(() => {
    if (!error) return
    const action = onLoadError(error)
    if (action.kind === 'goto' && action.screen !== 'N11') nav(action.screen)
  }, [error, nav])

  const background = scene?.background ?? flow.room?.background
  if (!flow.room || !background) return <Missing />
  const room = flow.room

  return (
    <Page>
      <Head title="그림방이 종료됐어요" plain sub={<span className="text--lead">{`<${room.title}>`}</span>} />
      <Body gap={34}>
        <ScenePreview
          background={background}
          characters={scene?.characters}
          maxHeight={468}
          showNames={flow.showNames}
          onToggleNames={() => patch({ showNames: !flow.showNames })}
        />
        <p className="text">완성된 그림을 저장하거나 공유해 보세요.</p>
      </Body>
      <Foot>
        <Cta disabled={!scene || image.saving} onClick={() => image.save(scene, room.title, flow.showNames)}>
          이미지 저장
        </Cta>
        <Cta
          onClick={async () => {
            const link = roomLink(room.roomId, createdRoomStore.get(room.roomId)?.roomUrl ?? window.location.href)
            const result = await shareRoom(room.roomId, link, 'share').catch(() => null)
            if (result === 'copied') toast('링크를 복사했어요.')
          }}
        >
          공유
        </Cta>
      </Foot>
    </Page>
  )
}

/** E03 — 잘못된 참여 링크. */
export function BadJoinLink({ nav }: ScreenProps) {
  return (
    <Page>
      <ErrorNotice title="방을 찾을 수 없어요" text="공유받은 링크를 다시 확인해 주세요." />
      <Foot>
        <Cta
          onClick={() => {
            // 잘못된 방 주소를 지우고 방장 시작 화면으로.
            window.history.replaceState(null, '', import.meta.env.BASE_URL)
            nav('N01')
          }}
        >
          새로운 방 만들기
        </Cta>
      </Foot>
    </Page>
  )
}
