import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import eraserIcon from '../assets/icon-eraser.svg'
import penIcon from '../assets/icon-pen.svg'
import undoIcon from '../assets/icon-undo.svg'
import { DrawEngine, type Tool } from '../draw/engine.ts'
import { bindPointerInput, type PinchSample } from '../draw/pointer.ts'
import type { Stroke } from '../draw/types.ts'
import type { Artwork } from '../lib/relay-draw/api-v2.ts'
import { assetUrl } from '../lib/relay-draw/screens.ts'
import { faceGeometry, faceTemplate } from './character-art.ts'
import { useElementSize } from './layout.ts'

/** Figma 펜 색상 6개(79:85). */
const PEN_COLORS = ['#222222', '#ED8178', '#F1C664', '#80B87C', '#78ACCF', '#A58BC0'] as const

/** 펜 굵기 범위. 정규화 값(얼굴 칸 한 변 대비)이라 화면 크기와 무관하게 같은 두께다. */
const PEN_MIN = 0.012
const PEN_MAX = 0.07
/** Figma 슬라이더 기본 위치(74 / 218). */
const PEN_DEFAULT = 0.34

/**
 * 팔레트 버튼에서 펼치는 추가 색. 기본 6색과 겹치지 않게 밝은·어두운 톤과 피부색 계열을 골랐다.
 * 이 밖의 색은 OS 색 선택기(input type=color)로 고른다.
 */
const EXTRA_COLORS = [
  '#ffffff', '#9e9e9e', '#5c5c5c', '#000000', '#f6c8b6', '#e0a47e',
  '#a86b4c', '#6b3f2a', '#ff5a4f', '#ff9a3c', '#ffe14d', '#b7dc5a',
  '#2fa66b', '#3fc6c6', '#2f6fd6', '#1f3a8a', '#ff8fc3', '#c03a8a',
] as const

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

/** 카드 안에서 포즈 원화가 차지하는 비율. Figma에서 343×370 카드에 310px. */
const POSE_FILL = 0.9

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
  const poseSize = Math.min(card.width, card.height) * POSE_FILL
  const k = poseSize / art.canvas.width
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

  const f = art.faceRect
  const ex = poseLeft + (f.x + f.width / 2) * k
  const ey = poseTop + (f.y + f.height / 2) * k
  const rx = (f.width / 2) * k
  const ry = (f.height / 2) * k

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
          <svg className="draw-dim" width={card.width} height={card.height} aria-hidden="true">
            <path
              fillRule="evenodd"
              fill="var(--canvas-dim)"
              d={`M0 0H${card.width}V${card.height}H0Z M${ex - rx} ${ey}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0Z`}
            />
          </svg>
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
  /** 팔레트에서 마지막으로 고른 색. 팔레트 버튼 가운데에 남겨 다시 고르기 쉽게 한다. */
  const [customColor, setCustomColor] = useState<string | null>(null)
  const optionsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    engine?.setTool(
      mode === 'draw'
        ? { mode: 'draw', color, width: penWidth(thickness) }
        : { mode: 'erase', color, width: ERASER_WIDTH },
    )
  }, [engine, mode, color, thickness])

  // 팔레트가 열려 있을 때 바깥을 누르면 닫는다.
  useEffect(() => {
    if (!paletteOpen) return
    const onDown = (event: PointerEvent) => {
      if (!optionsRef.current?.contains(event.target as Node)) setPaletteOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [paletteOpen])

  /** 색을 고르면 펜으로 돌아간다. */
  const pickColor = (next: string) => {
    setColor(next)
    setMode('draw')
  }
  const pickCustom = (next: string) => {
    setCustomColor(next)
    pickColor(next)
  }

  const isBase = (PEN_COLORS as readonly string[]).includes(color)
  /** 기본 6색이 아닌 색을 쓰고 있으면 그 색이 팔레트 버튼에 보인다. */
  const customShown = customColor ?? (isBase ? null : color)

  return (
    <>
      {optionsOpen && (
        <div className="pen-options" ref={optionsRef}>
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
            <button
              type="button"
              aria-label="색 더 보기"
              aria-expanded={paletteOpen}
              aria-pressed={mode === 'draw' && !isBase}
              className={customShown ? 'swatch swatch--custom has-color' : 'swatch swatch--custom'}
              style={customShown ? ({ '--custom': customShown } as CSSProperties) : undefined}
              onClick={() => setPaletteOpen((open) => !open)}
            />
          </div>
          {paletteOpen && (
            <div className="palette-pop" role="dialog" aria-label="색 고르기">
              <div className="palette-grid">
                {EXTRA_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    aria-pressed={mode === 'draw' && color === c}
                    className="swatch"
                    style={{ background: c }}
                    onClick={() => {
                      pickCustom(c)
                      setPaletteOpen(false)
                    }}
                  />
                ))}
              </div>
              <label className="palette-picker">
                <input
                  type="color"
                  value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#000000'}
                  onChange={(e) => pickCustom(e.target.value)}
                />
                <span>직접 고르기</span>
              </label>
            </div>
          )}
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
    </>
  )
}
