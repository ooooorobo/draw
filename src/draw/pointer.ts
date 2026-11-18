/**
 * 포인터 입력 계층. 모바일/태블릿 펜슬/인앱 브라우저 대응이 전부 여기에 모여 있다.
 *
 * 다루는 문제:
 *   1. 제스처 충돌(FR-09 "화면 스크롤과 그리기 제스처가 충돌하지 않을 것")
 *   2. Apple Pencil 필압과 240Hz 입력(coalesced events)
 *   3. 팜 리젝션 — 펜으로 그릴 때 손바닥 터치 무시
 *   4. 멀티터치 — 두 손가락은 그리기가 아니라 확대·이동이다
 *   5. pointercancel 복구 — 인앱 웹뷰가 입력을 가로채는 경우
 *
 * 입력은 캔버스가 아니라 그 바깥 판(surface)에서 받는다. 확대하면 캔버스가 판 밖으로
 * 넘치고, 축소 상태에서는 판의 빈 곳에서도 두 손가락 제스처를 시작할 수 있어야 한다.
 */

export type InputDevice = 'pen' | 'touch' | 'mouse'

export type InputSample = {
  clientX: number
  clientY: number
  pressure: number
  device: InputDevice
}

/** 두 손가락 제스처의 한 순간. 화면(client) 좌표. */
export type PinchSample = { centerX: number; centerY: number; distance: number }

export type PointerHandlers = {
  onBegin: (sample: InputSample) => void
  onExtend: (sample: InputSample) => void
  onEnd: () => void
  onCancel: () => void
  /** 두 번째 손가락이 닿은 순간. */
  onPinchStart?: (sample: PinchSample) => void
  onPinch?: (sample: PinchSample) => void
  onPinchEnd?: () => void
}

/** 펜 입력 후 이 시간 안의 터치는 손바닥으로 보고 버린다. */
const PALM_WINDOW_MS = 900

/**
 * 두 손가락은 동시에 닿지 않는다. 첫 손가락이 닿은 뒤 이 시간 안에 두 번째가 오면
 * 첫 손가락의 획은 확대하려던 것이므로 지운다. 그보다 늦으면 이미 그리던 획이라 확정한다.
 */
const PINCH_GRACE_MS = 250

function deviceOf(event: PointerEvent): InputDevice {
  if (event.pointerType === 'pen') return 'pen'
  if (event.pointerType === 'touch') return 'touch'
  return 'mouse'
}

/**
 * 필압 해석.
 *
 * - pen: 실제 값. 단 획 시작 프레임에 0이 들어오는 기기가 있어 0은 중간값으로 올린다.
 * - touch/mouse: 브라우저가 0.5 또는 0을 넣는다. 의미가 없으므로 1로 고정한다.
 *   (iOS 터치는 force touch가 없어서 필압이 사실상 안 온다)
 */
function pressureOf(event: PointerEvent, device: InputDevice): number {
  if (device !== 'pen') return 1
  if (event.pressure > 0) return Math.min(1, event.pressure)
  return 0.5
}

function sampleOf(event: PointerEvent, device: InputDevice): InputSample {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    pressure: pressureOf(event, device),
    device,
  }
}

function pinchOf(touches: Map<number, { x: number; y: number }>): PinchSample | null {
  const [a, b] = [...touches.values()]
  if (!a || !b) return null
  return {
    centerX: (a.x + b.x) / 2,
    centerY: (a.y + b.y) / 2,
    distance: Math.hypot(b.x - a.x, b.y - a.y),
  }
}

export function bindPointerInput(surface: HTMLElement, handlers: PointerHandlers): () => void {
  /** 현재 그리는 포인터. 하나만 허용한다. */
  let activeId: number | null = null
  let activeDevice: InputDevice = 'mouse'
  let activeSince = 0
  let lastPenAt = 0
  /** 판에 닿아 있는 손가락. 두 개가 되면 확대·이동 제스처다. */
  const touches = new Map<number, { x: number; y: number }>()
  /** 제스처 중이거나, 제스처 후 손가락이 아직 다 떨어지지 않았다. 이 동안은 그리지 않는다. */
  let pinching = false
  let gestureLock = false

  const capture = (event: PointerEvent) => {
    // 판 밖으로 나가도 이벤트를 계속 받는다. 인앱 웹뷰에서 특히 중요하다.
    try {
      surface.setPointerCapture(event.pointerId)
    } catch {
      // 캡처 실패는 치명적이지 않다.
    }
  }

  const onPointerDown = (event: PointerEvent) => {
    // 판 위에 올린 버튼(원래 크기 등)은 그리기 입력이 아니다.
    if (event.target instanceof Element && event.target.closest('button')) return
    const device = deviceOf(event)
    if (device === 'pen') lastPenAt = event.timeStamp

    // 팜 리젝션: 펜을 쓰는 중에 들어온 터치는 손바닥이다.
    if (device === 'touch' && event.timeStamp - lastPenAt < PALM_WINDOW_MS) return

    if (device === 'touch') {
      if (touches.size >= 2) return
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY })
      capture(event)
      event.preventDefault()

      if (touches.size === 2) {
        // 그리던 손가락이 있으면 정리하고 제스처로 넘어간다.
        if (activeId !== null && activeDevice === 'touch') {
          const young = event.timeStamp - activeSince < PINCH_GRACE_MS
          activeId = null
          if (young) handlers.onCancel()
          else handlers.onEnd()
        }
        const pinch = pinchOf(touches)
        if (pinch && activeId === null) {
          pinching = true
          gestureLock = true
          handlers.onPinchStart?.(pinch)
        }
        return
      }
      if (gestureLock) return
    }

    // 이미 그리는 중이면 다른 포인터는 무시한다.
    if (activeId !== null) return

    activeId = event.pointerId
    activeDevice = device
    activeSince = event.timeStamp
    if (device !== 'touch') capture(event)
    event.preventDefault()
    handlers.onBegin(sampleOf(event, device))
  }

  const onPointerMove = (event: PointerEvent) => {
    if (touches.has(event.pointerId)) {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (pinching) {
        event.preventDefault()
        const pinch = pinchOf(touches)
        if (pinch) handlers.onPinch?.(pinch)
        return
      }
    }
    if (event.pointerId !== activeId) return
    event.preventDefault()

    /*
     * Apple Pencil은 약 240Hz로 보고하는데 pointermove는 화면 주기(약 60Hz)로 합쳐져서 온다.
     * 합쳐진 원본을 복원하지 않으면 빠르게 그을 때 선이 각진다.
     */
    const coalesced =
      typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : []

    if (coalesced.length > 0) {
      for (const raw of coalesced) handlers.onExtend(sampleOf(raw, activeDevice))
      return
    }
    handlers.onExtend(sampleOf(event, activeDevice))
  }

  /** 손가락 추적 해제. 제스처가 끝났으면 알린다. */
  const releaseTouch = (event: PointerEvent) => {
    if (!touches.delete(event.pointerId)) return
    if (pinching && touches.size < 2) {
      pinching = false
      handlers.onPinchEnd?.()
    }
    // 남은 손가락으로 선이 그어지지 않게, 모든 손가락이 떨어질 때까지 그리기를 막는다.
    if (touches.size === 0) gestureLock = false
  }

  const release = (event: PointerEvent) => {
    if (deviceOf(event) === 'pen') lastPenAt = event.timeStamp
    try {
      surface.releasePointerCapture(event.pointerId)
    } catch {
      // 이미 해제된 경우.
    }
  }

  const onPointerUp = (event: PointerEvent) => {
    releaseTouch(event)
    if (event.pointerId !== activeId) return
    activeId = null
    release(event)
    handlers.onEnd()
  }

  const onPointerCancel = (event: PointerEvent) => {
    releaseTouch(event)
    if (event.pointerId !== activeId) return
    activeId = null
    release(event)
    handlers.onCancel()
  }

  /*
   * touch-action:none이 최신 브라우저에서는 스크롤/줌을 막아준다.
   * 하지만 구버전 iOS WKWebView(카카오톡/인스타그램 인앱)는 이를 무시하는 경우가 있어
   * 네이티브 터치 이벤트를 passive:false로 직접 막는다.
   */
  const swallowTouch = (event: TouchEvent) => {
    // 버튼까지 막으면 touchstart가 취소돼서 click이 오지 않는다.
    if (event.target instanceof Element && event.target.closest('button')) return
    if (event.cancelable) event.preventDefault()
  }

  /** iOS 페이지 핀치 줌. user-scalable=no를 무시하므로 별도로 막아야 한다(판 확대는 위에서 직접 한다). */
  const swallowGesture = (event: Event) => {
    event.preventDefault()
  }

  /** 길게 누르면 뜨는 컨텍스트 메뉴/이미지 저장 팝업 차단. */
  const swallowContextMenu = (event: Event) => {
    event.preventDefault()
  }

  surface.addEventListener('pointerdown', onPointerDown)
  surface.addEventListener('pointermove', onPointerMove)
  surface.addEventListener('pointerup', onPointerUp)
  surface.addEventListener('pointercancel', onPointerCancel)
  surface.addEventListener('lostpointercapture', onPointerCancel)
  surface.addEventListener('touchstart', swallowTouch, { passive: false })
  surface.addEventListener('touchmove', swallowTouch, { passive: false })
  surface.addEventListener('touchend', swallowTouch, { passive: false })
  surface.addEventListener('gesturestart', swallowGesture)
  surface.addEventListener('gesturechange', swallowGesture)
  surface.addEventListener('contextmenu', swallowContextMenu)

  return () => {
    surface.removeEventListener('pointerdown', onPointerDown)
    surface.removeEventListener('pointermove', onPointerMove)
    surface.removeEventListener('pointerup', onPointerUp)
    surface.removeEventListener('pointercancel', onPointerCancel)
    surface.removeEventListener('lostpointercapture', onPointerCancel)
    surface.removeEventListener('touchstart', swallowTouch)
    surface.removeEventListener('touchmove', swallowTouch)
    surface.removeEventListener('touchend', swallowTouch)
    surface.removeEventListener('gesturestart', swallowGesture)
    surface.removeEventListener('gesturechange', swallowGesture)
    surface.removeEventListener('contextmenu', swallowContextMenu)
  }
}
