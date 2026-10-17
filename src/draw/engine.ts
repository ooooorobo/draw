import { quantizeCoord, quantizePoint, quantizeTime } from './quantize.ts'
import type { CellTemplate, Stroke, StrokeMode, Vec } from './types.ts'

/**
 * 캔버스 렌더링 엔진. React에 의존하지 않는다.
 *
 * 레이어 3장:
 *   hint      — 경계 띠(옆 칸 가장자리). 지우개가 닿지 않아야 하므로 분리한다.
 *   committed — 제출된 내 획들. 지우개는 여기에만 destination-out으로 적용된다.
 *   visible   — 위 두 장 + 연결점/외곽선 오버레이를 합성해 보여주는 화면.
 *
 * OffscreenCanvas는 iOS 16.4+가 필요해서 쓰지 않는다.
 * 구버전 카카오톡/인스타그램 인앱 웹뷰에서 깨진다.
 */

/**
 * DPR 상한. 레이어가 3장이라 3x 기기에서 그대로 쓰면 캔버스 메모리 한계에 걸린다.
 * (800px 정사각 기준 DPR3 = 약 69MB, DPR2 = 약 30MB)
 * 인앱 웹뷰는 탭 메모리가 더 빡빡해서 2로 묶는다.
 */
const MAX_DPR = 2

/** 경계 띠를 그릴 여백. 칸 한 변 대비 비율. */
const MARGIN_RATIO = 0.08

/** 연결점 스냅 반경. 칸 한 변 대비 비율. */
const SNAP_RATIO = 0.055

/** 필압이 0에 가까워도 선이 사라지지 않게 하는 최소 굵기 배율. */
const MIN_PRESSURE_SCALE = 0.35

/**
 * 속도 기반 굵기에서 "가장 빠름"으로 치는 기준. 정규화 거리 / ms.
 * 칸을 가로지르는 데 약 300ms 걸리는 속도에 해당한다.
 */
const SPEED_FAST = 0.003

/** 빠르게 그어도 선이 사라지지 않게 하는 최소 굵기 배율. */
const MIN_VELOCITY_SCALE = 0.45

/** 속도를 평균 낼 구간(span 수). 길수록 부드럽지만 반응이 둔해진다. */
const VELOCITY_WINDOW = 5

/**
 * 이 거리보다 가까운 점은 버린다. 정규화 단위.
 * 양자화 격자(0.0001)보다 훨씬 크므로 양자화가 중복점을 만들지 않는다.
 */
const MIN_POINT_DISTANCE = 0.0015

/**
 * 제출물 PNG 한 변(px). 기기와 무관하게 고정한다.
 * 칸 6개를 모아 합성하려면 모든 칸이 같은 해상도여야 한다.
 */
const EXPORT_SIZE = 1024

/**
 * 손떨림 보정 계수. 0에 가까울수록 많이 눌러주지만 선이 손가락을 늦게 따라온다.
 * 작은 화면에서 손가락으로 그리면 1~2px 지터가 섞이는데, 그게 그대로 획에 남는다.
 */
const STABILIZE_ALPHA = 0.55

/** 획 시작/끝에서 가늘어지는 구간(점 개수). */
const TAPER_POINTS = 4

/** 테이퍼 구간 끝에서의 굵기 배율. */
const TAPER_MIN = 0.3

/** 형광펜 불투명도. multiply와 함께 쓴다. */
const MARKER_ALPHA = 0.45

/** 채우기에서 "비어 있다"로 치는 알파 상한. 색 허용오차 대신 알파만 본다. */
const FILL_ALPHA_THRESHOLD = 128

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = Number.parseInt(full, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export type Tool = {
  mode: StrokeMode
  color: string
  width: number
}

type Layer = {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
}

function createLayer(): Layer {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  return { canvas, ctx }
}

function ctxOf(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  return ctx
}

export class DrawEngine {
  private readonly visible: HTMLCanvasElement
  private readonly vctx: CanvasRenderingContext2D
  private readonly committed = createLayer()
  private readonly hint = createLayer()

  private template: CellTemplate
  private tool: Tool

  /** CSS px 단위 캔버스 한 변. 정사각으로 유지한다. */
  private size = 0
  private dpr = 1

  private strokes: Stroke[] = []
  private live: Stroke | null = null
  /** 손떨림 보정의 직전 출력값. 원본 입력이 아니라 눌러준 값을 누적한다. */
  private smoothed: Vec | null = null
  /** 직전 원본 입력. 손을 뗀 자리에 선이 정확히 닿게 하려고 따로 들고 있는다. */
  private rawLast: Vec | null = null
  /** 칸 안쪽 픽셀 마스크. 채우기가 칸 밖으로 새지 않게 한다. */
  private cellMask: Uint8Array | null = null
  /** 획 종료 시 연결점 스냅이 일어났는지. 일어났으면 그 획만 다시 그려야 한다. */
  private liveSnapped = false

  private replayHandle: number | null = null

  constructor(canvas: HTMLCanvasElement, template: CellTemplate, tool: Tool) {
    this.visible = canvas
    this.vctx = ctxOf(canvas)
    this.template = template
    this.tool = tool
  }

  setTool(tool: Tool): void {
    this.tool = tool
  }

  getStrokes(): Stroke[] {
    return this.strokes
  }

  get strokeCount(): number {
    return this.strokes.length
  }

  /** 칸 한 변(px)에 대한 그리기 영역 정보. 정규화 좌표 ↔ CSS px 변환의 기준. */
  private get box(): { origin: number; span: number } {
    const margin = this.size * MARGIN_RATIO
    return { origin: margin, span: this.size - margin * 2 }
  }

  private toPx(v: Vec): Vec {
    const { origin, span } = this.box
    return { x: origin + v.x * span, y: origin + v.y * span }
  }

  /** 클라이언트 좌표 → 정규화 좌표. */
  clientToNorm(clientX: number, clientY: number): Vec {
    const rect = this.visible.getBoundingClientRect()
    const { origin, span } = this.box
    return {
      x: (clientX - rect.left - origin) / span,
      y: (clientY - rect.top - origin) / span,
    }
  }

  /**
   * 캔버스 크기 재설정. 획은 정규화 좌표라 해상도에 독립적이므로 그대로 다시 그린다.
   * 인앱 브라우저는 주소창/키보드 때문에 뷰포트가 자주 바뀌어서 이 경로가 자주 호출된다.
   */
  resize(cssSize: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
    if (cssSize === this.size && dpr === this.dpr) return

    this.size = cssSize
    this.dpr = dpr
    const device = Math.round(cssSize * dpr)

    for (const canvas of [this.visible, this.committed.canvas, this.hint.canvas]) {
      canvas.width = device
      canvas.height = device
    }
    this.visible.style.width = `${cssSize}px`
    this.visible.style.height = `${cssSize}px`

    // 이후 모든 드로잉은 CSS px 단위로 한다.
    for (const ctx of [this.vctx, this.committed.ctx, this.hint.ctx]) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
    }

    // 마스크는 device px 기준이라 크기가 바뀌면 버린다.
    this.cellMask = null

    this.paintHints()
    this.redrawCommitted()
    this.present()
  }

  private outlinePath(ctx: CanvasRenderingContext2D): void {
    const pts = this.template.outline
    if (pts.length === 0) return
    ctx.beginPath()
    for (let i = 0; i < pts.length; i++) {
      const p = this.toPx(pts[i]!)
      if (i === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    }
    ctx.closePath()
  }

  /** 경계 띠: 외곽선 바깥에만 보이게 클립한다. 내 그리기 영역을 덮으면 안 된다. */
  private paintHints(): void {
    const { ctx } = this.hint
    ctx.clearRect(0, 0, this.size, this.size)
    if (this.template.hints.length === 0) return

    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, this.size, this.size)
    const pts = this.template.outline
    for (let i = 0; i < pts.length; i++) {
      const p = this.toPx(pts[i]!)
      if (i === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    }
    ctx.closePath()
    ctx.clip('evenodd')

    ctx.globalAlpha = 0.45
    for (const stroke of this.template.hints) this.paintStroke(ctx, stroke)
    ctx.restore()
  }

  /**
   * 손가락·마우스 입력의 속도 기반 굵기 배율.
   *
   * 펜에는 필압이 있지만 손가락에는 없다. 그대로 두면 굵기가 완전히 균일한
   * 선이 나와서 성의 없어 보인다. 실제 펜은 빨리 그으면 가늘고 천천히 그으면
   * 굵은데, 그 특성을 속도로 흉내낸다.
   *
   * 반드시 뒤쪽 점만 본다. drawLiveTail이 새 점이 들어올 때마다 마지막 두 span을
   * 덧그리는데, 앞쪽 점을 참조하면 나중에 다시 그릴 때 굵기가 달라져
   * 멱등성이 깨진다(같은 자리에 다른 굵기로 두 번 그려진다).
   */
  private velocityScale(stroke: Stroke, index: number): number {
    const pts = stroke.points
    const from = Math.max(1, index - VELOCITY_WINDOW + 1)
    const head = pts[from - 1]
    const tail = pts[index]
    if (!head || !tail) return 1

    let distance = 0
    for (let i = from; i <= index; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      if (a && b) distance += Math.hypot(b.x - a.x, b.y - a.y)
    }

    // 시간은 ms 정수로 양자화돼 있어 연속된 점이 같은 값을 가질 수 있다. 0 나눗셈 방지.
    const elapsed = Math.max(1, tail.t - head.t)
    const ratio = Math.min(1, distance / elapsed / SPEED_FAST)
    return 1 - (1 - MIN_VELOCITY_SCALE) * ratio
  }

  /**
   * 획 시작과 끝을 가늘게 만든다. 뭉툭하게 끊긴 선이 "성의 없어 보이는" 주된 원인이다.
   *
   * 끝 테이퍼는 획이 끝난 뒤에만 적용한다. 진행 중에는 어디가 끝인지 알 수 없고,
   * 추측해서 그리면 확정 후 다시 그릴 때 값이 달라져 잔재가 남는다.
   * 그래서 endStroke에서 committed를 한 번 다시 만든다.
   */
  private taperScale(stroke: Stroke, index: number): number {
    const n = stroke.points.length
    if (n < TAPER_POINTS * 2) return 1
    const fromStart = index
    const fromEnd = stroke === this.live ? Number.POSITIVE_INFINITY : n - 1 - index
    const d = Math.min(fromStart, fromEnd)
    if (d >= TAPER_POINTS) return 1
    return TAPER_MIN + (1 - TAPER_MIN) * (d / TAPER_POINTS)
  }

  private lineWidthAt(stroke: Stroke, index: number): number {
    const base = stroke.width * this.box.span

    // 지우개는 굵기가 일정해야 어디까지 지워지는지 예측할 수 있다.
    // 형광펜도 일정해야 칠한 면의 농도가 고르다.
    if (stroke.mode === 'erase' || stroke.mode === 'marker') return base

    const taper = this.taperScale(stroke, index)

    if (stroke.device === 'pen') {
      const cur = stroke.points[index]
      if (!cur) return base
      const prev = stroke.points[index - 1] ?? cur
      const p = (prev.p + cur.p) / 2
      return base * (MIN_PRESSURE_SCALE + (1 - MIN_PRESSURE_SCALE) * p) * taper
    }

    return base * this.velocityScale(stroke, index) * taper
  }

  /**
   * 획의 span i(= points[i-1]→points[i] 구간)를 그린다.
   *
   * 중간점 보간: 구간의 시작/끝을 이웃 점과의 중간점으로 잡고 원래 점을 제어점으로 쓴다.
   * 같은 span을 몇 번 다시 그려도 결과가 같다(불투명 페인트 / destination-out 모두 멱등).
   * 덕분에 실시간 입력은 마지막 두 span만 덧그리면 되고 전체 재렌더가 필요 없다.
   */
  private paintSpan(ctx: CanvasRenderingContext2D, stroke: Stroke, i: number): void {
    const pts = stroke.points
    const prev = pts[i - 1]
    const cur = pts[i]
    if (!prev || !cur) return

    const a = this.toPx(prev)
    const b = this.toPx(cur)
    const before = pts[i - 2]
    const after = pts[i + 1]

    const start = before
      ? { x: (this.toPx(before).x + a.x) / 2, y: (this.toPx(before).y + a.y) / 2 }
      : a
    const end = after
      ? { x: (b.x + this.toPx(after).x) / 2, y: (b.y + this.toPx(after).y) / 2 }
      : b

    ctx.save()
    if (stroke.mode === 'erase') {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.strokeStyle = 'rgba(0,0,0,1)'
    } else {
      ctx.globalCompositeOperation = 'source-over'
      ctx.strokeStyle = stroke.color
    }
    ctx.lineWidth = this.lineWidthAt(stroke, i)
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.quadraticCurveTo(a.x, a.y, end.x, end.y)
    ctx.stroke()
    ctx.restore()
  }

  /** 점 하나뿐인 획(탭)은 원으로 찍는다. */
  private paintDot(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
    const only = stroke.points[0]
    if (!only) return
    const c = this.toPx(only)
    ctx.save()
    if (stroke.mode === 'erase') {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = 'rgba(0,0,0,1)'
    } else {
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = stroke.color
    }
    ctx.beginPath()
    ctx.arc(c.x, c.y, this.lineWidthAt(stroke, 0) / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  /**
   * 형광펜. 획 전체를 하나의 path로 만들어 한 번만 stroke한다.
   *
   * span마다 따로 칠하면 반투명이 이음매에서 겹쳐 점점이 진해진다.
   * 한 번의 stroke 호출 안에서는 자기 자신과 겹쳐도 농도가 올라가지 않는다.
   */
  private paintMarker(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
    const pts = stroke.points
    if (pts.length === 0) return
    const width = stroke.width * this.box.span

    ctx.save()
    ctx.globalCompositeOperation = 'multiply'
    ctx.globalAlpha = MARKER_ALPHA
    ctx.strokeStyle = stroke.color
    ctx.fillStyle = stroke.color
    ctx.lineWidth = width

    if (pts.length === 1) {
      const c = this.toPx(pts[0]!)
      ctx.beginPath()
      ctx.arc(c.x, c.y, width / 2, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.beginPath()
      const first = this.toPx(pts[0]!)
      ctx.moveTo(first.x, first.y)
      for (let i = 1; i < pts.length; i++) {
        const a = this.toPx(pts[i - 1]!)
        const b = this.toPx(pts[i]!)
        ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2)
      }
      const last = this.toPx(pts[pts.length - 1]!)
      ctx.lineTo(last.x, last.y)
      ctx.stroke()
    }
    ctx.restore()
  }

  /**
   * 칸 안쪽 픽셀 마스크. getImageData는 clip을 따르지 않으므로 직접 만든다.
   * 이게 없으면 채우기가 칸 경계를 넘어 옆 사람 영역까지 칠한다.
   */
  private getCellMask(): Uint8Array {
    if (this.cellMask) return this.cellMask
    const w = this.committed.canvas.width
    const h = this.committed.canvas.height
    const tmp = document.createElement('canvas')
    tmp.width = w
    tmp.height = h
    const tctx = ctxOf(tmp)
    tctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    tctx.fillStyle = '#000000'
    this.outlinePath(tctx)
    tctx.fill()
    const d = tctx.getImageData(0, 0, w, h).data
    const mask = new Uint8Array(w * h)
    for (let i = 0; i < mask.length; i++) mask[i] = (d[i * 4 + 3] ?? 0) > 128 ? 1 : 0
    this.cellMask = mask
    return mask
  }

  /**
   * 채우기. 탭한 지점에서 ４방향으로 번져나가며 빈 픽셀을 칠한다.
   *
   * 색 허용오차 대신 알파만 본다. 안티에일리어싱된 선 가장자리의 색은
   * 클라이언트와 서버에서 미세하게 다를 수 있지만, "칠해졌나 아닌가"의
   * 이진 판정은 같게 나온다. 재생과 서버 렌더가 어긋나면 안 되기 때문이다.
   *
   * 선에 틈이 있으면 칸 전체로 샌다. 다만 칸 마스크가 바깥을 막으므로
   * 피해는 그 칸 안으로 한정된다. 되돌리기로 취소할 수 있다.
   */
  private paintFill(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
    const seed = stroke.points[0]
    if (!seed) return
    const w = ctx.canvas.width
    const h = ctx.canvas.height
    if (w === 0 || h === 0) return

    const mask = this.getCellMask()
    const px = this.toPx(seed)
    const sx = Math.round(px.x * this.dpr)
    const sy = Math.round(px.y * this.dpr)
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return

    const start = sy * w + sx
    if (mask[start] !== 1) return

    const img = ctx.getImageData(0, 0, w, h)
    const d = img.data
    if ((d[start * 4 + 3] ?? 0) > FILL_ALPHA_THRESHOLD) return

    const { r, g, b } = hexToRgb(stroke.color)
    const seen = new Uint8Array(w * h)
    const stack: number[] = [start]
    seen[start] = 1

    while (stack.length > 0) {
      const p = stack.pop()!
      const o = p * 4
      d[o] = r
      d[o + 1] = g
      d[o + 2] = b
      d[o + 3] = 255

      const x = p % w
      const y = (p / w) | 0
      const visit = (q: number) => {
        if (seen[q] === 1 || mask[q] !== 1) return
        if ((d[q * 4 + 3] ?? 0) > FILL_ALPHA_THRESHOLD) return
        seen[q] = 1
        stack.push(q)
      }
      if (x > 0) visit(p - 1)
      if (x < w - 1) visit(p + 1)
      if (y > 0) visit(p - w)
      if (y < h - 1) visit(p + w)
    }
    ctx.putImageData(img, 0, 0)
  }

  /** 점 하나 또는 통째로 칠하는 모드의 첫 프레임. */
  private paintAtomic(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
    if (stroke.mode === 'fill') this.paintFill(ctx, stroke)
    else if (stroke.mode === 'marker') this.paintMarker(ctx, stroke)
    else this.paintDot(ctx, stroke)
  }

  private paintStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, upto?: number): void {
    if (stroke.mode === 'fill' || stroke.mode === 'marker') {
      this.paintAtomic(ctx, stroke)
      return
    }
    const last = upto ?? stroke.points.length - 1
    if (last <= 0) {
      this.paintDot(ctx, stroke)
      return
    }
    for (let i = 1; i <= last; i++) this.paintSpan(ctx, stroke, i)
  }

  /** committed 레이어를 획 목록으로부터 전부 다시 만든다. 되돌리기/스냅 보정/리사이즈용. */
  private redrawCommitted(limit?: number): void {
    const { ctx } = this.committed
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.committed.canvas.width, this.committed.canvas.height)
    ctx.restore()

    ctx.save()
    this.outlinePath(ctx)
    ctx.clip()
    const end = limit ?? this.strokes.length
    for (let i = 0; i < end; i++) {
      const stroke = this.strokes[i]
      if (stroke) this.paintStroke(ctx, stroke)
    }
    ctx.restore()
  }

  /** 레이어를 합성해 화면에 올린다. 매 프레임 비용이 레이어 수에 비례(획 수와 무관). */
  private present(): void {
    const ctx = this.vctx
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, this.visible.width, this.visible.height)
    ctx.drawImage(this.hint.canvas, 0, 0)
    ctx.drawImage(this.committed.canvas, 0, 0)
    ctx.restore()
    this.paintLiveTail()
    this.paintOverlay()
  }

  /**
   * 연결점과 칸 외곽선. FR-09가 요구하는 기능 표시물이고 장식이 아니다.
   * 디자인 확정 전이라 중립 회색만 쓴다.
   */
  private paintOverlay(): void {
    const ctx = this.vctx
    ctx.save()
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    this.outlinePath(ctx)
    ctx.stroke()
    ctx.setLineDash([])

    const r = Math.max(3, this.size * 0.012)
    for (const anchor of this.template.anchors) {
      const c = this.toPx(anchor)
      ctx.beginPath()
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'
      ctx.lineWidth = 2
      ctx.stroke()
    }
    ctx.restore()
  }

  /** 연결점 근처면 정확히 그 점으로 붙인다. 양쪽 칸의 선이 반드시 만나야 하므로 필요하다. */
  private snap(v: Vec): { point: Vec; snapped: boolean } {
    let best: Vec | null = null
    let bestDist = SNAP_RATIO
    for (const anchor of this.template.anchors) {
      const d = Math.hypot(anchor.x - v.x, anchor.y - v.y)
      if (d < bestDist) {
        bestDist = d
        best = anchor
      }
    }
    return best ? { point: { ...best }, snapped: true } : { point: v, snapped: false }
  }

  beginStroke(at: Vec, device: Stroke['device'], pressure: number, now: number): void {
    this.cancelReplay()
    const { point, snapped } = this.snap(at)
    this.liveSnapped = snapped
    this.smoothed = { x: point.x, y: point.y }
    this.rawLast = { x: point.x, y: point.y }
    this.live = {
      id: `s${this.strokes.length}_${Math.round(now)}`,
      mode: this.tool.mode,
      color: this.tool.color,
      width: this.tool.width,
      device,
      startedAt: quantizeTime(now),
      points: [quantizePoint(point.x, point.y, 0, pressure)],
    }
    this.strokes.push(this.live)
    this.commitSettledSpans()
    this.present()
  }

  extendStroke(at: Vec, pressure: number, now: number): void {
    const live = this.live
    if (!live) return
    // 채우기는 탭이다. 끌어도 영역이 늘어나지 않는다.
    if (live.mode === 'fill') return

    this.rawLast = { x: at.x, y: at.y }

    // 손떨림 보정: 원본으로 바로 가지 않고 직전 출력에서 일부만 따라간다.
    const prev = this.smoothed ?? at
    const smooth = {
      x: prev.x + (at.x - prev.x) * STABILIZE_ALPHA,
      y: prev.y + (at.y - prev.y) * STABILIZE_ALPHA,
    }
    this.smoothed = smooth

    const last = live.points[live.points.length - 1]
    if (last && Math.hypot(smooth.x - last.x, smooth.y - last.y) < MIN_POINT_DISTANCE) return

    live.points.push(quantizePoint(smooth.x, smooth.y, now - live.startedAt, pressure))
    this.commitSettledSpans()
    this.present()
  }

  /**
   * 진행 중인 획에서 '기하가 확정된' span만 committed에 올린다.
   *
   * span i의 끝점은 점 i와 점 i+1의 중간점이다. 즉 점 i+1이 들어와야 span i의
   * 모양이 정해진다. 확정 전에 미리 그리면, 나중에 제 모양으로 다시 그릴 때
   * 그 획이 더 가늘면(속도가 빨라졌으면) 먼저 그린 굵은 자국이 안 덮여서 남는다.
   * 실측으로 획 가장자리에 247px(전체 잉크의 6%)의 잔재가 쌓였다.
   *
   * 그래서 확정된 span만 committed에 넣고, 아직 확정 안 된 마지막 span은
   * paintLiveTail이 화면 레이어에만 그린다. 저장되는 픽셀과 보이는 픽셀이
   * 어긋나지 않으면서, 선이 손가락을 지연 없이 따라온다.
   *
   * 지우개는 예외다. 굵기가 항상 일정해서 덧그려도 잔재가 생기지 않고,
   * destination-out을 화면 레이어에 쓰면 경계 띠까지 지워버린다.
   */
  private commitSettledSpans(): void {
    const live = this.live
    if (!live) return
    const { ctx } = this.committed
    const n = live.points.length

    ctx.save()
    this.outlinePath(ctx)
    ctx.clip()
    if (live.mode === 'fill') {
      // 탭 즉시 확정된다. 미리보기가 따로 없다.
      this.paintFill(ctx, live)
    } else if (live.mode === 'marker') {
      // 형광펜은 끝날 때 한 번에 올린다. 그래야 이음매가 진해지지 않는다.
    } else if (live.mode === 'erase') {
      if (n === 1) this.paintDot(ctx, live)
      else this.paintSpan(ctx, live, n - 1)
    } else if (n >= 3) {
      this.paintSpan(ctx, live, n - 2)
    }
    ctx.restore()
  }

  /** 아직 확정되지 않은 마지막 span. 화면에만 그리고 committed는 건드리지 않는다. */
  private paintLiveTail(): void {
    const live = this.live
    if (!live || live.mode === 'erase' || live.mode === 'fill') return
    const ctx = this.vctx
    const n = live.points.length

    ctx.save()
    this.outlinePath(ctx)
    ctx.clip()
    if (live.mode === 'marker') {
      // 아직 committed에 없으므로 진행 중인 전체를 화면에만 보여준다.
      this.paintMarker(ctx, live)
    } else if (n === 1) {
      this.paintDot(ctx, live)
    } else {
      this.paintSpan(ctx, live, n - 1)
    }
    ctx.restore()
  }

  endStroke(): Stroke | null {
    const live = this.live
    if (!live) return null
    this.live = null

    // 끝점도 연결점에 붙인다. 기하가 바뀌므로 이 획이 그려진 픽셀은 한 번 다시 만들어야 한다.
    const tail = live.points[live.points.length - 1]
    if (tail && live.points.length > 1) {
      const { point, snapped } = this.snap(tail)
      if (snapped) {
        tail.x = quantizeCoord(point.x)
        tail.y = quantizeCoord(point.y)
        this.liveSnapped = true
      }
    }
    // 손을 뗀 자리에 선이 정확히 닿게 한다. 보정값은 원본보다 뒤처져 있다.
    const raw = this.rawLast
    if (raw && live.mode !== 'fill' && live.points.length > 1 && !this.liveSnapped) {
      const tip = live.points[live.points.length - 1]!
      if (Math.hypot(raw.x - tip.x, raw.y - tip.y) >= MIN_POINT_DISTANCE) {
        live.points.push(quantizePoint(raw.x, raw.y, tip.t, tip.p))
      }
    }
    this.smoothed = null
    this.rawLast = null

    // 끝 테이퍼는 획이 끝나야 적용된다. 진행 중 그려둔 span들의 굵기가 바뀌므로
    // 이 시점에 committed를 통째로 다시 만든다. 손을 뗄 때 한 번만 치르는 비용이다.
    this.redrawCommitted()
    this.liveSnapped = false
    this.present()
    return live
  }

  /** pointercancel 등으로 입력이 끊긴 경우. 인앱 웹뷰에서 실제로 발생한다. */
  cancelStroke(): void {
    if (!this.live) return
    this.live = null
    this.strokes.pop()
    this.liveSnapped = false
    this.redrawCommitted()
    this.present()
  }

  undo(): void {
    this.cancelReplay()
    if (this.live) {
      this.cancelStroke()
      return
    }
    if (this.strokes.length === 0) return
    this.strokes.pop()
    this.redrawCommitted()
    this.present()
  }

  /** PoC 검증용. 제품에는 다시 그리기가 없다(FR-10). */
  reset(): void {
    this.cancelReplay()
    this.live = null
    this.strokes = []
    this.redrawCommitted()
    this.present()
  }

  /**
   * 획 순서 재생(FR-15). 원래 타임라인을 durationMs로 압축한다.
   * 전체 재렌더 없이 커서를 전진시키며 새로 드러난 span만 그린다.
   */
  replay(durationMs: number, onDone?: () => void): void {
    this.cancelReplay()

    type Frame = { stroke: Stroke; index: number; at: number }
    const frames: Frame[] = []
    for (const stroke of this.strokes) {
      // 형광펜과 채우기는 통째로 칠해지므로 프레임 하나로 둔다.
      if (stroke.points.length <= 1 || stroke.mode === 'marker' || stroke.mode === 'fill') {
        frames.push({ stroke, index: 0, at: stroke.startedAt })
        continue
      }
      for (let i = 1; i < stroke.points.length; i++) {
        frames.push({ stroke, index: i, at: stroke.startedAt + (stroke.points[i]?.t ?? 0) })
      }
    }
    if (frames.length === 0) {
      onDone?.()
      return
    }

    const first = frames[0]!.at
    const total = Math.max(1, frames[frames.length - 1]!.at - first)
    const scale = total / durationMs

    const { ctx } = this.committed
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.committed.canvas.width, this.committed.canvas.height)
    ctx.restore()
    this.present()

    let cursor = 0
    const startedAt = performance.now()

    const step = () => {
      const virtual = first + (performance.now() - startedAt) * scale
      const { ctx: cctx } = this.committed
      cctx.save()
      this.outlinePath(cctx)
      cctx.clip()
      while (cursor < frames.length && frames[cursor]!.at <= virtual) {
        const frame = frames[cursor]!
        if (frame.index === 0) this.paintAtomic(cctx, frame.stroke)
        else this.paintSpan(cctx, frame.stroke, frame.index)
        cursor++
      }
      cctx.restore()
      this.present()

      if (cursor >= frames.length) {
        this.replayHandle = null
        onDone?.()
        return
      }
      this.replayHandle = requestAnimationFrame(step)
    }
    this.replayHandle = requestAnimationFrame(step)
  }

  cancelReplay(): void {
    if (this.replayHandle === null) return
    cancelAnimationFrame(this.replayHandle)
    this.replayHandle = null
    this.redrawCommitted()
    this.present()
  }

  /**
   * 제출물을 고정 해상도로 렌더한다. 경계 띠(옆 칸 힌트)와 오버레이는 제외한다.
   *
   * committed 레이어를 그대로 복사하지 않는 이유:
   *   그 레이어는 기기의 DPR과 뷰포트에 따라 크기가 달라진다. 같은 그림이라도
   *   아이폰에서 내면 732px, 아이패드에서 내면 1488px이 나온다. 칸 6개를 모아
   *   한 장으로 합성해야 하는데 칸마다 해상도가 다르면 합성이 성립하지 않는다.
   *
   * 배경을 칠하지 않는 이유:
   *   흰색으로 채우면 칸을 겹칠 때 위 칸의 흰 사각형이 아래 칸을 지운다.
   *   배경은 합성하는 쪽에서 한 번만 깔아야 한다.
   */
  private renderExport(size: number): HTMLCanvasElement {
    const out = document.createElement('canvas')
    out.width = size
    out.height = size
    const ctx = ctxOf(out)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    // paint 계열은 this.size를 기준으로 좌표를 환산한다. 렌더가 동기이고 멱등이라
    // 잠시 바꿔 쓰고 되돌려도 안전하다.
    const saved = this.size
    this.size = size
    try {
      ctx.save()
      this.outlinePath(ctx)
      ctx.clip()
      for (const stroke of this.strokes) this.paintStroke(ctx, stroke)
      ctx.restore()
    } finally {
      this.size = saved
    }
    return out
  }

  /** 미리보기/다운로드용. 업로드에는 toBlob을 쓴다. */
  toPNG(size = EXPORT_SIZE): string {
    return this.renderExport(size).toDataURL('image/png')
  }

  /**
   * 업로드용. data URL은 base64라 실제 바이트보다 33% 크다.
   * 네트워크로 보낼 때는 Blob을 그대로 보내야 한다.
   */
  toBlob(size = EXPORT_SIZE): Promise<Blob | null> {
    return new Promise((resolve) => {
      this.renderExport(size).toBlob(resolve, 'image/png')
    })
  }
}
