/**
 * 포인터 입력 계층. 모바일/태블릿 펜슬/인앱 브라우저 대응이 전부 여기에 모여 있다.
 *
 * 다루는 문제:
 *   1. 제스처 충돌(FR-09 "화면 스크롤과 그리기 제스처가 충돌하지 않을 것")
 *   2. Apple Pencil 필압과 240Hz 입력(coalesced events)
 *   3. 팜 리젝션 — 펜으로 그릴 때 손바닥 터치 무시
 *   4. 멀티터치 — 두 번째 손가락으로 선이 튀지 않게
 *   5. pointercancel 복구 — 인앱 웹뷰가 입력을 가로채는 경우
 */

export type InputDevice = 'pen' | 'touch' | 'mouse'

export type InputSample = {
  clientX: number
  clientY: number
  pressure: number
  device: InputDevice
}

export type PointerHandlers = {
  onBegin: (sample: InputSample) => void
  onExtend: (sample: InputSample) => void
  onEnd: () => void
  onCancel: () => void
}

/** 펜 입력 후 이 시간 안의 터치는 손바닥으로 보고 버린다. */
const PALM_WINDOW_MS = 900

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

export function bindPointerInput(canvas: HTMLCanvasElement, handlers: PointerHandlers): () => void {
  /** 현재 그리는 포인터. 하나만 허용한다. */
  let activeId: number | null = null
  let activeDevice: InputDevice = 'mouse'
  let lastPenAt = 0

  const onPointerDown = (event: PointerEvent) => {
    const device = deviceOf(event)
    if (device === 'pen') lastPenAt = event.timeStamp

    // 팜 리젝션: 펜을 쓰는 중에 들어온 터치는 손바닥이다.
    if (device === 'touch' && event.timeStamp - lastPenAt < PALM_WINDOW_MS) return
    // 멀티터치: 이미 그리는 중이면 두 번째 포인터는 무시한다.
    if (activeId !== null) return

    activeId = event.pointerId
    activeDevice = device
    // 캔버스 밖으로 나가도 이벤트를 계속 받는다. 인앱 웹뷰에서 특히 중요하다.
    try {
      canvas.setPointerCapture(event.pointerId)
    } catch {
      // 캡처 실패는 치명적이지 않다. 문서 레벨 리스너로 받는다.
    }
    event.preventDefault()
    handlers.onBegin(sampleOf(event, device))
  }

  const onPointerMove = (event: PointerEvent) => {
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

  const release = (event: PointerEvent) => {
    if (event.pointerId !== activeId) return
    if (deviceOf(event) === 'pen') lastPenAt = event.timeStamp
    activeId = null
    try {
      canvas.releasePointerCapture(event.pointerId)
    } catch {
      // 이미 해제된 경우.
    }
  }

  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== activeId) return
    release(event)
    handlers.onEnd()
  }

  const onPointerCancel = (event: PointerEvent) => {
    if (event.pointerId !== activeId) return
    release(event)
    handlers.onCancel()
  }

  /*
   * touch-action:none이 최신 브라우저에서는 스크롤/줌을 막아준다.
   * 하지만 구버전 iOS WKWebView(카카오톡/인스타그램 인앱)는 이를 무시하는 경우가 있어
   * 네이티브 터치 이벤트를 passive:false로 직접 막는다.
   */
  const swallowTouch = (event: TouchEvent) => {
    if (event.cancelable) event.preventDefault()
  }

  /** iOS 핀치 줌. user-scalable=no를 무시하므로 별도로 막아야 한다. */
  const swallowGesture = (event: Event) => {
    event.preventDefault()
  }

  /** 길게 누르면 뜨는 컨텍스트 메뉴/이미지 저장 팝업 차단. */
  const swallowContextMenu = (event: Event) => {
    event.preventDefault()
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerCancel)
  canvas.addEventListener('lostpointercapture', onPointerCancel)
  canvas.addEventListener('touchstart', swallowTouch, { passive: false })
  canvas.addEventListener('touchmove', swallowTouch, { passive: false })
  canvas.addEventListener('touchend', swallowTouch, { passive: false })
  canvas.addEventListener('gesturestart', swallowGesture)
  canvas.addEventListener('gesturechange', swallowGesture)
  canvas.addEventListener('contextmenu', swallowContextMenu)

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointercancel', onPointerCancel)
    canvas.removeEventListener('lostpointercapture', onPointerCancel)
    canvas.removeEventListener('touchstart', swallowTouch)
    canvas.removeEventListener('touchmove', swallowTouch)
    canvas.removeEventListener('touchend', swallowTouch)
    canvas.removeEventListener('gesturestart', swallowGesture)
    canvas.removeEventListener('gesturechange', swallowGesture)
    canvas.removeEventListener('contextmenu', swallowContextMenu)
  }
}
