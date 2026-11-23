import { useEffect, useMemo, useRef, useState } from 'react'
import eraserIcon from '../assets/icon-eraser.svg'
import penIcon from '../assets/icon-pen.svg'
import checkDark from '../assets/icon-check-dark.svg'
import checkLight from '../assets/icon-check-light.svg'
import colorWheel from '../assets/color-wheel.png'
import undoIcon from '../assets/icon-undo.svg'
import { DrawEngine, type Tool } from '../draw/engine.ts'
import { bindPointerInput, type PinchSample } from '../draw/pointer.ts'
import type { Stroke } from '../draw/types.ts'
import type { Artwork } from '../lib/relay-draw/api-v2.ts'
import { assetUrl } from '../lib/relay-draw/screens.ts'
import { drawClip, faceGeometry, faceTemplate } from './character-art.ts'
import { useElementSize } from './layout.ts'

/** Figma 펜 색상 6개(79:85). */
const PEN_COLORS = ['#222222', '#ED8178', '#F1C664', '#80B87C', '#78ACCF', '#A58BC0'] as const

/** 펜 굵기 범위. 정규화 값(얼굴 칸 한 변 대비)이라 화면 크기와 무관하게 같은 두께다. */
const PEN_MIN = 0.012
const PEN_MAX = 0.07
/** Figma 슬라이더 기본 위치(74 / 218). */
const PEN_DEFAULT = 0.34

/**
 * 60색 팔레트. Figma "60색 선택 / 10열 × 6행"(158:2153). 행은 밝은 → 어두운 명도,
 * 열은 무채색 · 빨강 · 주황 · 노랑 · 연두 · 초록 · 청록 · 파랑 · 보라 · 분홍.
 */
const PALETTE = [
  ['#ffffff', '#ffe3e3', '#ffe8d4', '#fff3c4', '#e9f4cc', '#d8f3e4', '#dcf3f7', '#dfeafe', '#ede2f8', '#fce0ed'],
  ['#e5e5e5', '#ffc1c1', '#ffd0a5', '#ffe78d', '#cde79d', '#aee3c4', '#b0e3ec', '#b3cdf9', '#d4b6ef', '#f4b2d0'],
  ['#bdbdbd', '#f18480', '#f4ae6c', '#f3ce5f', '#9cc76a', '#71c69a', '#73c6d7', '#79a8e7', '#b18cd1', '#e486b5'],
  ['#8d8d8d', '#df5757', '#df873f', '#d5a82d', '#6d9f43', '#3d9d73', '#389caf', '#437dca', '#8a60b0', '#c65b94'],
  ['#5b5b5b', '#ae383e', '#ac5d28', '#a27a20', '#486d2f', '#256e51', '#246d7d', '#2d5596', '#60417e', '#913b6a'],
  ['#222222', '#70272e', '#744023', '#695222', '#304b25', '#1d4938', '#1c4852', '#20365d', '#402e53', '#5f2947'],
] as const

/** 밝은 칸에는 어두운 체크, 어두운 칸에는 밝은 체크(Figma 선택 체크 2종). */
function isLight(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return r * 0.299 + g * 0.587 + b * 0.114 > 150
}

/** 지우개는 획 단위라 굵기 개념이 없다. 닿는 반경은 엔진이 정한다(ERASER_RADIUS). */
const ERASER_WIDTH = 0

/** 카드 안 확대 상한. 얼굴 영역이 카드의 일부라 이 정도면 얼굴이 카드를 꽉 채운다. */
const ZOOM_MAX = 4

/** 카드 안 확대 상태. 확대 레이어의 transform(translate → scale, 원점 좌상단)과 같다. */
type View = { scale: number; x: number; y: number }

const IDENTITY: View = { scale: 1, x: 0, y: 0 }

/** 확대한 내용이 카드 밖으로 밀려나 빈 곳이 보이지 않게 이동량을 묶는다. */
function clampView(view: View, width: number, height: number): View {
  const scale = Math.min(ZOOM_MAX, Math.max(1, view.scale))
  return {
    scale,
    x: Math.min(0, Math.max(width - width * scale, view.x)),
    y: Math.min(0, Math.max(height - height * scale, view.y)),
  }
}

/**
 * 카드 안 포즈 원화 크기. 원화 전체가 카드에 들어가게(contain) 맞추고 가장자리 여유를 조금 둔다.
 * 폭에 맞추면 카드(343×336)보다 키 큰 캐릭터(토끼 귀·발)가 위아래로 잘린다.
 */
const POSE_FILL = 0.96

export type FaceDrawing = {
  engine: DrawEngine
  strokeCount: number
}

/**
 * N06 얼굴 그리기 판.
 *
 * 포즈 원화를 깔고, 얼굴 영역(faceRect)만 그릴 수 있게 엔진 캔버스를 그 위에 겹친다.
 * 얼굴 밖은 30% 어둡게 덮는다(Figma "Subtract"). 획 데이터는 기존 엔진 그대로다.
 *
 * 카드(검은 테두리 상자)가 입력판이다. 한 손가락은 그리기, 두 손가락은 확대·이동이다.
 * 확대는 카드 안쪽 레이어에 CSS transform으로 걸고, 손을 떼면 엔진 해상도를 확대율만큼
 * 올려 선이 뭉개지지 않게 한다.
 */
export function FaceBoard({
  art,
  initialStrokes,
  onReady,
  onStrokeCount,
}: {
  art: Artwork
  initialStrokes: Stroke[] | null
  onReady: (engine: DrawEngine | null) => void
  onStrokeCount: (count: number) => void
}) {
  const [cardRef, card] = useElementSize<HTMLDivElement>()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<DrawEngine | null>(null)
  const zoomRef = useRef<HTMLDivElement | null>(null)
  /** 확대 상태는 제스처마다 바뀌므로 렌더를 거치지 않고 DOM에 바로 쓴다. */
  const viewRef = useRef<View>(IDENTITY)
  /** 확대돼 있으면 "원래 크기" 버튼을 보여준다. */
  const [zoomed, setZoomed] = useState(false)
  const template = useMemo(() => faceTemplate(art), [art])
  const geo = useMemo(() => faceGeometry(art), [art])

  // 원화 → 카드 px 배치
  const k = Math.min(card.width / art.canvas.width, card.height / art.canvas.height) * POSE_FILL
  const poseSize = art.canvas.width * k
  const poseLeft = (card.width - poseSize) / 2
  const poseTop = (card.height - (art.canvas.height * k)) / 2
  const canvasSide = Math.max(1, Math.floor(geo.canvas.width * k))

  // 엔진은 원화(템플릿) 단위로 한 번 만든다. 크기는 아래 effect에서 맞춘다.
  useEffect(() => {
    const canvas = canvasRef.current
    const surface = cardRef.current
    const layer = zoomRef.current
    if (!canvas || !surface || !layer) return
    const engine = new DrawEngine(canvas, template, defaultTool(), { background: null })
    engineRef.current = engine
    if (initialStrokes?.length) engine.loadStrokes(initialStrokes)
    onReady(engine)
    onStrokeCount(engine.strokeCount)

    // ── 카드 안 확대·이동 ──
    const applyView = (view: View) => {
      viewRef.current = view
      layer.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`
    }
    /** 카드 안쪽(테두리 제외) 기준 좌표. */
    const local = (clientX: number, clientY: number) => {
      const rect = surface.getBoundingClientRect()
      return { x: clientX - rect.left - surface.clientLeft, y: clientY - rect.top - surface.clientTop }
    }
    /** 제스처가 끝나면 해상도를 맞춘다. 제스처 중에 하면 매 프레임 전체를 다시 그린다. */
    const settle = () => {
      engine.setZoom(viewRef.current.scale)
      setZoomed(viewRef.current.scale > 1.01)
    }
    let pinchFrom: { view: View; at: { x: number; y: number }; distance: number } | null = null
    const zoomAround = (
      from: View,
      at: { x: number; y: number },
      to: { x: number; y: number },
      scale: number,
    ) => {
      // 시작 시점에 손가락 아래 있던 내용 점이 지금 손가락 아래에 오도록 이동량을 정한다.
      // 배율을 먼저 묶어야 한다. 상한을 넘은 배율로 이동량을 계산하면 내용이 손가락 밖으로 밀린다.
      const s = Math.min(ZOOM_MAX, Math.max(1, scale))
      const contentX = (at.x - from.x) / from.scale
      const contentY = (at.y - from.y) / from.scale
      const next = { scale: s, x: to.x - contentX * s, y: to.y - contentY * s }
      applyView(clampView(next, surface.clientWidth, surface.clientHeight))
    }

    const unbind = bindPointerInput(surface, {
      onBegin: (s) => {
        engine.beginStroke(engine.clientToNorm(s.clientX, s.clientY), s.device, s.pressure, performance.now())
      },
      onExtend: (s) => {
        engine.extendStroke(engine.clientToNorm(s.clientX, s.clientY), s.pressure, performance.now())
      },
      onEnd: () => {
        engine.endStroke()
        onStrokeCount(engine.strokeCount)
      },
      onCancel: () => {
        engine.cancelStroke()
        onStrokeCount(engine.strokeCount)
      },
      onPinchStart: (p: PinchSample) => {
        pinchFrom = { view: viewRef.current, at: local(p.centerX, p.centerY), distance: p.distance }
      },
      onPinch: (p: PinchSample) => {
        if (!pinchFrom) return
        const ratio = pinchFrom.distance > 0 ? p.distance / pinchFrom.distance : 1
        zoomAround(pinchFrom.view, pinchFrom.at, local(p.centerX, p.centerY), pinchFrom.view.scale * ratio)
      },
      onPinchEnd: () => {
        pinchFrom = null
        settle()
      },
    })

    // 데스크톱 보조 입력: 휠로 커서 위치를 중심으로 확대한다.
    let wheelTimer = 0
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const at = local(event.clientX, event.clientY)
      const from = viewRef.current
      zoomAround(from, at, at, from.scale * Math.exp(-event.deltaY * 0.002))
      window.clearTimeout(wheelTimer)
      wheelTimer = window.setTimeout(settle, 150)
    }
    surface.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      unbind()
      surface.removeEventListener('wheel', onWheel)
      window.clearTimeout(wheelTimer)
      engineRef.current = null
      onReady(null)
    }
    // 이어 그리기 획(initialStrokes)은 생성 시점에 한 번만 넣는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template])

  // 카드 크기가 바뀌면 확대 위치가 어긋나므로 원래 크기로 돌린다.
  useEffect(() => {
    viewRef.current = IDENTITY
    if (zoomRef.current) zoomRef.current.style.transform = ''
    setZoomed(false)
    const engine = engineRef.current
    if (card.width > 0 && engine) {
      engine.setZoom(1)
      engine.resize(canvasSide)
    }
  }, [canvasSide, card.width, card.height])

  const resetZoom = () => {
    viewRef.current = IDENTITY
    if (zoomRef.current) zoomRef.current.style.transform = ''
    engineRef.current?.setZoom(1)
    setZoomed(false)
  }

  // 예전 에셋(얼굴 영역 있음)만 얼굴 밖을 어둡게 덮는다. 지금 에셋은 캐릭터 전체에 그린다.
  const clip = drawClip(art)
  const f = clip?.kind === 'ellipse' ? clip.rect : (art.faceRect ?? null)

  return (
    <div className="draw-card" ref={cardRef}>
      <div className="draw-zoom" ref={zoomRef}>
      {card.width > 0 && (
        <>
          <img
            src={assetUrl(art.url)}
            alt=""
            draggable={false}
            style={{ left: poseLeft, top: poseTop, width: poseSize, height: art.canvas.height * k }}
          />
          {f && (
            <svg className="draw-dim" width={card.width} height={card.height} aria-hidden="true">
              <path
                fillRule="evenodd"
                fill="var(--canvas-dim)"
                d={dimPath(card, poseLeft + (f.x + f.width / 2) * k, poseTop + (f.y + f.height / 2) * k, (f.width / 2) * k, (f.height / 2) * k)}
              />
            </svg>
          )}
        </>
      )}
      <canvas
        ref={canvasRef}
        className="canvas"
        style={{ left: poseLeft + geo.canvas.x * k, top: poseTop + geo.canvas.y * k }}
      />
      </div>
      {zoomed && (
        <button type="button" className="draw-zoom-reset" onClick={resetZoom}>
          원래 크기
        </button>
      )}
    </div>
  )
}

/** 카드 전체에서 얼굴 타원만 뚫은 경로. */
function dimPath(card: { width: number; height: number }, ex: number, ey: number, rx: number, ry: number) {
  return `M0 0H${card.width}V${card.height}H0Z M${ex - rx} ${ey}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0Z`
}

function defaultTool(): Tool {
  return { mode: 'draw', color: PEN_COLORS[0], width: penWidth(PEN_DEFAULT) }
}

function penWidth(t: number) {
  return PEN_MIN + (PEN_MAX - PEN_MIN) * t
}

/**
 * 펜 옵션(색 + 굵기) + 도구 버튼(펜 / 지우개 / 되돌리기).
 *
 * 펜 옵션은 지우개를 골라도 사라지지 않는다. 지우개 상태에서 색이나 굵기를 고르면 바로 펜으로 돌아간다.
 * 기본 6색 옆 팔레트 버튼으로 추가 색과 OS 색 선택기를 연다.
 */
export function DrawTools({
  engine,
  onStrokeCount,
}: {
  engine: DrawEngine | null
  onStrokeCount: (count: number) => void
}) {
  const [mode, setMode] = useState<'draw' | 'erase'>('draw')
  const [color, setColor] = useState<string>(PEN_COLORS[0])
  const [thickness, setThickness] = useState(PEN_DEFAULT)
  const [optionsOpen, setOptionsOpen] = useState(true)
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    engine?.setTool(
      mode === 'draw'
        ? { mode: 'draw', color, width: penWidth(thickness) }
        : { mode: 'erase', color, width: ERASER_WIDTH },
    )
  }, [engine, mode, color, thickness])

  /** 색을 고르면 펜으로 돌아간다. */
  const pickColor = (next: string) => {
    setColor(next)
    setMode('draw')
  }

  const isBase = (PEN_COLORS as readonly string[]).some((c) => c.toLowerCase() === color.toLowerCase())

  return (
    <>
      {optionsOpen && (
        <div className="pen-options">
          <div className="swatches" role="radiogroup" aria-label="펜 색상">
            {PEN_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className="swatch"
                style={{ background: c }}
                aria-label={c}
                aria-pressed={mode === 'draw' && color === c}
                onClick={() => pickColor(c)}
              />
            ))}
            {/* Figma "60색 팔레트 열기 / 중앙 무지개 그라데이션"(158:1725). */}
            <button
              type="button"
              aria-label="색 더 보기"
              aria-expanded={paletteOpen}
              aria-pressed={mode === 'draw' && !isBase}
              className="swatch swatch--wheel"
              onClick={() => setPaletteOpen(true)}
            >
              <img src={colorWheel} alt="" />
            </button>
          </div>
          <div className="width-row">
            <span className="width-dot" style={{ width: 4, height: 4 }} />
            <input
              className="width-slider"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={thickness}
              aria-label="펜 굵기"
              style={{ ['--fill' as string]: `${thickness * 100}%` }}
              onChange={(e) => {
                setThickness(Number(e.target.value))
                setMode('draw')
              }}
            />
            <span className="width-dot" style={{ width: 12, height: 12 }} />
          </div>
        </div>
      )}
      <div className="tools">
        <button
          type="button"
          className="tool"
          aria-label="펜"
          aria-pressed={mode === 'draw'}
          onClick={() => {
            // 이미 펜이면 옵션 열기/닫기(Figma "옵션 닫힘" 상태).
            if (mode === 'draw') setOptionsOpen((o) => !o)
            else {
              setMode('draw')
              setOptionsOpen(true)
            }
          }}
        >
          <img src={penIcon} alt="" />
        </button>
        <button
          type="button"
          className="tool"
          aria-label="지우개"
          aria-pressed={mode === 'erase'}
          onClick={() => setMode('erase')}
        >
          <img src={eraserIcon} alt="" />
        </button>
        <button
          type="button"
          className="tool"
          aria-label="되돌리기"
          onClick={() => {
            engine?.undo()
            onStrokeCount(engine?.strokeCount ?? 0)
          }}
        >
          <img src={undoIcon} alt="" />
        </button>
      </div>
      {paletteOpen && (
        <>
          <div className="sheet-dim" onClick={() => setPaletteOpen(false)} />
          <div className="sheet" role="dialog" aria-label="색상 선택">
            <span className="sheet-handle" aria-hidden="true" />
            <h2 className="sheet-title">색상 선택</h2>
            <div className="palette" role="radiogroup" aria-label="60색">
              {PALETTE.flat().map((c) => {
                const selected = mode === 'draw' && color.toLowerCase() === c
                return (
                  <button
                    key={c}
                    type="button"
                    className="palette-cell"
                    style={{ background: c }}
                    aria-label={c}
                    aria-pressed={selected}
                    onClick={() => {
                      // 색상 선택 즉시 적용(Figma 시트 이름). 고르면 시트를 닫는다.
                      pickColor(c)
                      setPaletteOpen(false)
                    }}
                  >
                    {selected && <img src={isLight(c) ? checkDark : checkLight} alt="" />}
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </>
  )
}
