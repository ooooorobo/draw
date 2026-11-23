import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import deleteIcon from '../assets/icon-delete.svg'
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
import { NameTags, NameToggle, ScenePreview } from './scene.tsx'
import type { ScreenProps } from './types.ts'
import { useElementSize } from './layout.ts'
import { Body, Cta, ErrorNotice, Foot, Head, HScroll, Page } from './ui.tsx'

/**
 * N10 — 방장 관리(Figma 158:2299 · 158:2020 · 171:57).
 *
 * 그림이 화면 위를 꽉 채우고(배경 cover), 아래 시트에서 캐릭터를 고른다.
 * 고른 캐릭터는 점선 상자 + 삭제 버튼이 붙고, 끌어서 옮길 수 있다.
 * 옮긴 위치는 "변경사항 저장"으로 한 번에 보낸다(PATCH admin/placements).
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
  /** 저장 전 옮긴 위치. 캐릭터 id → 중심 비율 좌표. */
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>({})
  const [areaRef, area] = useElementSize<HTMLDivElement>()
  const [rosterRef, roster] = useElementSize<HTMLDivElement>()
  const [scroll, setScroll] = useState({ left: 0, width: 0 })
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const drag = useRef<
    | { kind: 'move'; id: string; startX: number; startY: number; from: { x: number; y: number } }
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

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const target = (e.target as Element).closest('[data-id]')
    const id = target?.getAttribute('data-id')
    const c = id ? characters.find((it) => it.id === id) : null
    e.currentTarget.setPointerCapture(e.pointerId)
    if (c) {
      setSelected(c.id)
      drag.current = { kind: 'move', id: c.id, startX: e.clientX, startY: e.clientY, from: { x: c.x, y: c.y } }
    } else {
      drag.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, from: { x: px, y: py } }
    }
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || worldW <= 0) return
    if (d.kind === 'move') {
      const next = {
        x: clamp(d.from.x + (e.clientX - d.startX) / worldW, 0, 1),
        y: clamp(d.from.y + (e.clientY - d.startY) / worldH, 0, 1),
      }
      setMoved((m) => ({ ...m, [d.id]: next }))
    } else {
      setPan({ x: d.from.x - (e.clientX - d.startX), y: d.from.y - (e.clientY - d.startY) })
    }
  }
  const onUp = () => {
    drag.current = null
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
        Object.entries(moved).map(([characterId, p]) => ({ characterId, x: p.x, y: p.y })),
      )
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
                    style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
                  />
                )
              })}
              {flow.showNames && <NameTags characters={ordered} size={{ width: worldW, height: worldH }} />}
              {box && (
                <>
                  <div
                    className="manage-frame"
                    style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
                  />
                  <button
                    type="button"
                    className="manage-delete"
                    aria-label="선택한 캐릭터 삭제"
                    style={{ left: box.left + box.width - 13, top: box.top - 10 }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={askDelete}
                  >
                    <img src={deleteIcon} alt="" />
                  </button>
                </>
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

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** N10C — 삭제 확인. */
export function DeleteConfirm({ nav, flow, patch, toast }: ScreenProps) {
  const remove = useAction(deleteCharacters)
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
          disabled={remove.pending}
          onClick={async () => {
            try {
              await remove.run(roomId, [target.id])
              patch({ deleteTarget: null })
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
