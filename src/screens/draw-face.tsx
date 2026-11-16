import { useEffect, useMemo, useRef, useState } from 'react'
import eraserIcon from '../assets/icon-eraser.svg'
import penIcon from '../assets/icon-pen.svg'
import undoIcon from '../assets/icon-undo.svg'
import { DrawEngine, type Tool } from '../draw/engine.ts'
import { bindPointerInput } from '../draw/pointer.ts'
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

const ERASER_WIDTH = 0.08

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
    if (!canvas) return
    const engine = new DrawEngine(canvas, template, defaultTool(), { background: null })
    engineRef.current = engine
    if (initialStrokes?.length) engine.loadStrokes(initialStrokes)
    onReady(engine)
    onStrokeCount(engine.strokeCount)

    const unbind = bindPointerInput(canvas, {
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
    })
    return () => {
      unbind()
      engineRef.current = null
      onReady(null)
    }
    // 이어 그리기 획(initialStrokes)은 생성 시점에 한 번만 넣는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template])

  useEffect(() => {
    if (card.width > 0) engineRef.current?.resize(canvasSide)
  }, [canvasSide, card.width])

  const f = art.faceRect
  const ex = poseLeft + (f.x + f.width / 2) * k
  const ey = poseTop + (f.y + f.height / 2) * k
  const rx = (f.width / 2) * k
  const ry = (f.height / 2) * k

  return (
    <div className="draw-card" ref={cardRef}>
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
  )
}

function defaultTool(): Tool {
  return { mode: 'draw', color: PEN_COLORS[0], width: penWidth(PEN_DEFAULT) }
}

function penWidth(t: number) {
  return PEN_MIN + (PEN_MAX - PEN_MIN) * t
}

/** 펜 옵션(색 + 굵기) + 도구 버튼(펜 / 지우개 / 되돌리기). */
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

  useEffect(() => {
    engine?.setTool(
      mode === 'draw'
        ? { mode: 'draw', color, width: penWidth(thickness) }
        : { mode: 'erase', color, width: ERASER_WIDTH },
    )
  }, [engine, mode, color, thickness])

  return (
    <>
      {mode === 'draw' && optionsOpen && (
        <div className="pen-options">
          <div className="swatches" role="radiogroup" aria-label="펜 색상">
            {PEN_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className="swatch"
                style={{ background: c }}
                aria-label={c}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
              />
            ))}
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
              onChange={(e) => setThickness(Number(e.target.value))}
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
