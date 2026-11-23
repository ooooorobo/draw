import { useEffect, useState } from 'react'
import { onAdminError, onLoadError } from '../lib/relay-draw/errors.ts'
import { useAction, useAsync, useRemaining, useScene } from '../lib/relay-draw/hooks.ts'
import { roomLink } from '../lib/relay-draw/entry.ts'
import { createdRoomStore } from '../lib/relay-draw/storage.ts'
import {
  assetUrl,
  deleteCharacters,
  loadAdminCharacters,
  shareRoom,
  trackResultView,
} from '../lib/relay-draw/screens.ts'
import { faceAssetUrl } from './character-art.ts'
import { Sprite } from './character.tsx'
import { Missing } from './host.tsx'
import { useSaveImage } from './save-image.ts'
import { ScenePreview } from './scene.tsx'
import type { ScreenProps } from './types.ts'
import { useElementSize } from './layout.ts'
import { Body, Cta, Foot, Head, Page, SignX } from './ui.tsx'

/** N10 — 방장 관리. 배치된 캐릭터 중 하나를 골라 삭제한다(단일 선택). */
export function HostManage({ nav, flow, patch, toast }: ScreenProps) {
  const roomId = flow.room?.roomId ?? null
  const { scene, fetchedAt } = useScene(roomId)
  const remaining = useRemaining(scene ?? flow.room, fetchedAt)
  const admin = useAsync(
    (signal) => (roomId ? loadAdminCharacters(roomId, signal) : Promise.resolve([])),
    [roomId, scene?.version],
  )
  const [selected, setSelected] = useState<string | null>(flow.deleteTarget?.id ?? null)
  const [rosterRef, roster] = useElementSize<HTMLDivElement>()
  const [scroll, setScroll] = useState({ left: 0, width: 0 })

  useEffect(() => {
    if (admin.status !== 'error') return
    const action = onAdminError(admin.error)
    if (action.kind === 'goto') nav(action.screen)
    else toast(action.message)
  }, [admin.status, admin.error, nav, toast])

  const background = scene?.background ?? flow.room?.background
  if (!flow.room || !background) return <Missing />

  const characters = admin.data ?? []
  // 목록이 바뀌어 선택한 캐릭터가 사라졌으면 선택을 푼다.
  const current = characters.find((c) => c.id === selected) ?? null
  const thumbFace = (c: (typeof characters)[number]) =>
    c.faceImage ? assetUrl(c.faceImage.url) : faceAssetUrl(c)

  const bar = scroll.width > 0 ? Math.min(1, roster.width / scroll.width) : 1
  const barLeft = scroll.width > roster.width ? (scroll.left / (scroll.width - roster.width)) * (1 - bar) : 0

  return (
    <Page>
      <Head
        title="방 관리"
        bold
        sub={`<${flow.room.title}>${remaining ? ` · ${remaining} 남음` : ''}`}
      />
      <Body gap={16}>
        <ScenePreview
          background={background}
          characters={scene?.characters}
          maxHeight={430}
          highlightId={current?.id}
          onSelect={setSelected}
        />
        <div
          className="roster"
          ref={rosterRef}
          onScroll={(e) =>
            setScroll({ left: e.currentTarget.scrollLeft, width: e.currentTarget.scrollWidth })
          }
          onLoad={(e) => setScroll({ left: e.currentTarget.scrollLeft, width: e.currentTarget.scrollWidth })}
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
              <Sprite art={c.artwork} faceUrl={thumbFace(c)} width={c.id === current?.id ? 52 : 50} />
            </button>
          ))}
        </div>
        {characters.length > 0 && (
          <div className="roster-bar">
            <div className="roster-bar-fill" style={{ left: `${barLeft * 100}%`, width: `${bar * 100}%` }} />
          </div>
        )}
        <p className="text">
          {characters.length === 0 && admin.status === 'success'
            ? '아직 배치된 캐릭터가 없어요.'
            : '삭제할 캐릭터를 선택해 주세요.'}
        </p>
      </Body>
      <Foot>
        <Cta onClick={() => nav('N04')}>관리 나가기</Cta>
        <Cta
          disabled={!current}
          onClick={() => {
            if (!current) return
            patch({ deleteTarget: { id: current.id, artwork: current.artwork, faceUrl: thumbFace(current) } })
            nav('N10C')
          }}
        >
          선택 이미지 삭제
        </Cta>
      </Foot>
    </Page>
  )
}

/** N10C — 삭제 확인. */
export function DeleteConfirm({ nav, flow, patch, toast }: ScreenProps) {
  const remove = useAction(deleteCharacters)
  const target = flow.deleteTarget
  if (!flow.room || !target) return <Missing onBack={() => nav('N10')} />
  const roomId = flow.room.roomId

  return (
    <Page>
      <Head title="삭제 확인" />
      <Body gap={60}>
        <div className="stage" style={{ flex: 'none', paddingTop: 50 }}>
          <Sprite art={target.artwork} faceUrl={target.faceUrl} width={190} className="figure" />
        </div>
        <div className="head" style={{ gap: 19 }}>
          <p className="text text--lead">선택한 캐릭터를 삭제할까요?</p>
          <p className="text">선택한 캐릭터가 방의 그림에서 사라집니다.</p>
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
      <Head title="그림방이 종료됐어요" sub={<span className="text--lead">{`<${room.title}>`}</span>} />
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
      <div className="head" style={{ paddingTop: 134, gap: 16 }}>
        <h1 className="head-title" style={{ fontSize: 24 }}>
          방을 찾을 수 없어요
        </h1>
        <p className="text">공유받은 링크를 다시 확인해 주세요.</p>
      </div>
      <Body>
        <div className="stage" style={{ alignItems: 'flex-start', paddingTop: 50 }}>
          <SignX />
        </div>
      </Body>
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
