import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  clampSpot,
  DEFAULT_SPOT,
  moveSpot,
  pinchSpot,
  readPinch,
  type Grip,
  type Pinch,
  type Spot,
} from '../lib/placement.ts'
import type { Catalog, RelayDrawClient, Scene } from '../lib/relay-draw/client.ts'
import { errorMessage } from '../lib/useAsync.ts'
import { registerCharacter } from './register.ts'
import { ErrorBox, Loading, PlacedSprite, Screen, Stage } from './shell.tsx'
import { mySprite, useObjectUrl } from './sprite.ts'
import { findPose, firstPose, sceneSprites, type PoseChoice, type ScreenProps } from './types.ts'
import { useScene } from './useScene.ts'

/**
 * N07 / 참여 ④ — 배치.
 *
 * 그린 얼굴을 올린 캐릭터를 배경 위에 놓고 등록까지 마치는 화면.
 *
 * 좌표 계약은 src/lib/placement.ts에 정리되어 있다. 화면은 "배경 사각형 기준 비율"만
 * 다루고 픽셀을 저장하지 않는다. 그래서 기기 해상도·배경 크기가 달라도 같은 자리에 놓인다.
 *
 * 등록은 두 요청이다.
 *   1. POST characters — 캐릭터 생성(DRAFT). characterToken을 받는다.
 *   2. POST submission — 얼굴 파일 + 획 데이터 + 배치 metadata 제출
 * 1을 N05가 아니라 여기서 호출한다. 그리기 도중 이탈하면 쓰지 않는 DRAFT가 남고,
 * 포즈를 바꿔 돌아왔을 때 이미 만든 DRAFT가 어긋나기 때문이다.
 * 2가 실패하면 flow.draft를 들고 E02로 가고, 재시도는 같은 DRAFT·같은 멱등 키를 다시 쓴다.
 */
export function Placement(props: ScreenProps) {
  // 방이 있으면 먼저 등록한 사람들까지 같이 받는다. 그 사이에 자리를 잡아야 하기 때문이다.
  const view = useScene(props.flow.roomId)

  if (view.state === 'loading') {
    return (
      <Screen title="배치">
        <Loading label="배경 불러오는 중" />
      </Screen>
    )
  }
  if (view.state === 'error') {
    return (
      <Screen title="배치">
        <ErrorBox message={errorMessage(view.error)} onRetry={view.reload} />
      </Screen>
    )
  }

  // 편집기는 배경이 붙은 뒤에만 의미가 있다. 제스처가 stage DOM 노드를 필요로 해서
  // 조회 상태와 편집 상태를 한 컴포넌트에 두지 않고 분리한다.
  return <PlacementEditor {...props} {...view.data} />
}

function PlacementEditor({
  nav,
  flow,
  patch,
  api,
  catalog,
  scene,
}: ScreenProps & { api: RelayDrawClient; catalog: Catalog; scene: Scene | null }) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [spot, setSpot] = useState<Spot>(flow.placement ?? DEFAULT_SPOT)
  const [pending, setPending] = useState(false)

  /*
   * 제스처 핸들러는 한 번만 바인딩하고 최신 값을 ref로 읽는다. 상태를 의존성에 넣으면
   * 포인터가 움직일 때마다 리스너를 다시 달게 된다.
   *
   * ref는 값을 바꾸는 순간 같이 갱신한다. effect로 미루면 포인터 이벤트가 연속으로 들어올 때
   * (손가락 드래그는 한 프레임에 여러 건이 온다) effect가 밀려서 핸들러가 이전 값을 읽고
   * 이동량이 통째로 사라진다. 실제로 10건 중 1건이 유실되는 것을 확인했다.
   */
  const spotRef = useRef(spot)
  const applySpot = useCallback((next: Spot) => {
    spotRef.current = next
    setSpot(next)
  }, [])
  useStageGesture(stageRef, spotRef, applySpot)

  /*
   * 화면을 떠날 때 배치를 흐름 상태에 남긴다.
   * 등록 실패(E02) → 배치로 돌아오기에서 같은 자리를 그대로 복원해야 한다.
   */
  useEffect(() => () => patch({ placement: spotRef.current }), [patch])

  const faceUrl = useObjectUrl(flow.face)
  const chosen = findPose(catalog, flow.presetId, flow.poseId)
  const choice = chosen ?? firstPose(catalog)

  // 서버 장면이 있으면 그 배경이 기준이다. 없으면(방 만들기 전) 방장이 고른 배경을 쓴다.
  const backgroundUrl = scene
    ? api.url(scene.background.url)
    : (flow.backgroundUrl ?? presetBackgroundUrl(api, catalog))
  const placed = scene ? sceneSprites(api, catalog, scene.characters) : []
  const mine = choice ? mySprite(api, choice, faceUrl, spot) : null

  const blocked = submitBlockReason(flow.roomId, flow.face, choice, scene)

  async function register() {
    if (pending || blocked || !choice) return
    setPending(true)
    try {
      await registerCharacter({ api, flow, patch, nav, choice, spot: spotRef.current })
    } finally {
      setPending(false)
    }
  }

  return (
    <Screen
      variant="top"
      actions={
        <button type="button" disabled={pending || blocked !== null} onClick={register}>
          {pending ? '등록 중…' : '완료'}
        </button>
      }
    >
      {/* 배경 어디서나 끌어 옮기고, 두 손가락으로 크기와 회전을 맞춘다. */}
      <Stage url={backgroundUrl} stageRef={stageRef} interactive>
        {placed.map((sprite) => (
          <PlacedSprite key={sprite.id} sprite={sprite} />
        ))}
        {mine && <PlacedSprite sprite={mine} mark="dashed" />}
      </Stage>
      {blocked && <p className="error">{blocked}</p>}
    </Screen>
  )
}

/** 등록을 막는 이유. 없으면 null. 개발용 화면 이동으로 바로 들어온 경우가 대부분이다. */
function submitBlockReason(
  roomId: string | null,
  face: Blob | null,
  choice: PoseChoice | null,
  scene: Scene | null,
): string | null {
  if (!choice) return '카탈로그에 캐릭터가 없어 배치할 수 없습니다.'
  if (!roomId) return '방 정보가 없어 등록할 수 없습니다. 참여 링크로 들어와야 합니다.'
  if (!face) return '얼굴 그림이 없어 등록할 수 없습니다. 얼굴 그리기부터 해야 합니다.'
  if (scene && scene.status !== 'OPEN') return '종료된 방이라 등록할 수 없습니다.'
  /*
   * 브라우저당 1회 등록 제한은 없앴다. 확정 와이어프레임이 "추가 캐릭터 참여 허용"으로
   * 바뀌어서, 같은 사람이 캐릭터를 더 그려 넣을 수 있다.
   * markRegistered는 계속 기록한다. 재방문 화면(N09R) 판정에 쓰인다.
   */
  return null
}

/** 방장이 고른 배경도, 서버 장면도 없을 때 쓰는 카탈로그 첫 배경. */
function presetBackgroundUrl(api: RelayDrawClient, catalog: Catalog): string | null {
  const first = catalog.backgrounds[0]
  return first ? api.url(first.url) : null
}

/**
 * 배경 위 제스처. 한 손가락은 이동, 두 손가락은 크기와 회전이다.
 *
 * 캐릭터를 직접 집지 않고 배경 어디서나 끌 수 있게 했다. 작게 줄인 캐릭터는 손가락으로
 * 집기 어렵고, 회전된 사각형의 적중 판정을 넣을 만큼 복잡한 화면도 아니다. 배치 대상은
 * 항상 내 캐릭터 하나뿐이다.
 *
 * 그리기 화면(src/draw/pointer.ts)과 달리 두 번째 포인터를 버리지 않는다. 여기서는
 * 두 손가락이 기능이다. 대신 세 번째 이후는 무시한다.
 */
function useStageGesture(
  stageRef: RefObject<HTMLDivElement | null>,
  spotRef: RefObject<Spot>,
  onChange: (spot: Spot) => void,
): void {
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    type Touch = { clientX: number; clientY: number }

    /** 배경에 닿아 있는 포인터. 두 개까지 추적한다. */
    const active = new Map<number, Touch>()
    /** 두 손가락 제스처의 시작 상태. 한 손가락이면 null. */
    let pinchStart: { spot: Spot; pinch: Pinch } | null = null
    /** 한 손가락 이동의 직전 위치. */
    let lastPoint: Touch | null = null

    const gripOf = (touch: Touch, rect: DOMRect): Grip => ({
      ratioX: (touch.clientX - rect.left) / rect.width,
      ratioY: (touch.clientY - rect.top) / rect.height,
      clientX: touch.clientX,
      clientY: touch.clientY,
    })

    const readTwo = (rect: DOMRect): Pinch | null => {
      const [a, b] = [...active.values()]
      return a && b ? readPinch(gripOf(a, rect), gripOf(b, rect)) : null
    }

    /** 주소창 높이 변화와 레이아웃 변화를 반영하려고 움직일 때마다 다시 읽는다. */
    const rectOf = (): DOMRect | null => {
      const rect = stage.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 ? rect : null
    }

    const onPointerDown = (event: PointerEvent) => {
      if (active.size >= 2) return
      active.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY })
      try {
        // 배경 밖으로 손가락이 나가도 계속 받는다. 인앱 웹뷰에서 특히 중요하다.
        stage.setPointerCapture(event.pointerId)
      } catch {
        // 캡처 실패는 치명적이지 않다. 움직임이 배경 안에서만 반영된다.
      }
      event.preventDefault()

      const rect = rectOf()
      if (active.size === 2 && rect) {
        const pinch = readTwo(rect)
        pinchStart = pinch ? { spot: spotRef.current, pinch } : null
        lastPoint = null
        return
      }
      lastPoint = { clientX: event.clientX, clientY: event.clientY }
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!active.has(event.pointerId)) return
      event.preventDefault()
      active.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY })

      const rect = rectOf()
      if (!rect) return

      if (active.size >= 2) {
        const now = readTwo(rect)
        if (pinchStart && now) onChange(pinchSpot(pinchStart.spot, pinchStart.pinch, now))
        return
      }
      if (!lastPoint) return
      const dx = (event.clientX - lastPoint.clientX) / rect.width
      const dy = (event.clientY - lastPoint.clientY) / rect.height
      lastPoint = { clientX: event.clientX, clientY: event.clientY }
      onChange(moveSpot(spotRef.current, dx, dy))
    }

    const release = (event: PointerEvent) => {
      if (!active.delete(event.pointerId)) return
      try {
        stage.releasePointerCapture(event.pointerId)
      } catch {
        // 이미 해제된 경우.
      }
      pinchStart = null
      // 두 손가락 중 하나만 떼면 남은 손가락으로 이동을 이어간다.
      const [remaining] = [...active.values()]
      lastPoint = remaining ?? null
    }

    /*
     * touch-action:none이 최신 브라우저에서는 스크롤·줌을 막아준다. 구버전 iOS WKWebView
     * (카카오톡·인스타그램 인앱)는 이를 무시하는 경우가 있어서 직접 막는다.
     * 그리기 화면과 같은 이유·같은 처리다.
     */
    const swallow = (event: Event) => {
      if (event.cancelable) event.preventDefault()
    }

    /*
     * 데스크톱 보조 입력. 마우스에는 두 손가락이 없어서, 휠로 크기를 조절한다.
     * (시안에 크기·회전 슬라이더가 없어서 화면 컨트롤은 두지 않는다.)
     */
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const current = spotRef.current
      onChange(clampSpot({ ...current, scale: current.scale * Math.exp(-event.deltaY * 0.0015) }))
    }

    stage.addEventListener('pointerdown', onPointerDown)
    stage.addEventListener('wheel', onWheel, { passive: false })
    stage.addEventListener('pointermove', onPointerMove)
    stage.addEventListener('pointerup', release)
    stage.addEventListener('pointercancel', release)
    stage.addEventListener('lostpointercapture', release)
    stage.addEventListener('touchstart', swallow, { passive: false })
    stage.addEventListener('touchmove', swallow, { passive: false })
    stage.addEventListener('gesturestart', swallow)
    stage.addEventListener('gesturechange', swallow)
    stage.addEventListener('contextmenu', swallow)

    return () => {
      stage.removeEventListener('pointerdown', onPointerDown)
      stage.removeEventListener('wheel', onWheel)
      stage.removeEventListener('pointermove', onPointerMove)
      stage.removeEventListener('pointerup', release)
      stage.removeEventListener('pointercancel', release)
      stage.removeEventListener('lostpointercapture', release)
      stage.removeEventListener('touchstart', swallow)
      stage.removeEventListener('touchmove', swallow)
      stage.removeEventListener('gesturestart', swallow)
      stage.removeEventListener('gesturechange', swallow)
      stage.removeEventListener('contextmenu', swallow)
    }
  }, [stageRef, spotRef, onChange])
}
