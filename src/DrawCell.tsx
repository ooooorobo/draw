import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { DrawEngine, type Tool } from './draw/engine.ts'
import { bindPointerInput, type PinchSample } from './draw/pointer.ts'
import { TIME_LIMIT_MS, type CellSize, type CellTemplate, type Stroke } from './draw/types.ts'

/**
 * 칸 그리기 화면(FR-09, FR-10). 확정 시안 `N06 · 얼굴 그리기`의 배치를 따른다.
 *
 *   흰 카드(포즈 + 얼굴 칸) / 도구 줄 / 색 6개 / 펜 굵기 / 하단 입체 CTA
 *
 * 시안의 도구 줄은 펜·지우개·되돌리기 셋이다. 이미 구현된 형광펜·채우기는 같은 줄에 남겨둔다.
 *
 * 카드(검은 테두리 상자) 안에서 두 손가락으로 확대·이동한다. 확대는 카드 안쪽 레이어에
 * CSS transform으로 걸고, 손을 떼면 엔진 해상도를 확대율만큼 올려 선이 뭉개지지 않게 한다.
 */

/** 펜 굵기 범위(FR-09). 시안의 "가늘게 ── 굵게" 슬라이더. 정규화 값이라 칸 크기와 무관하다. */
const PEN_MIN = 0.008
const PEN_MAX = 0.04
const PEN_DEFAULT = 0.016

/** 색 6개. 시안 팔레트(`N06 · 얼굴 그리기` 색 줄)에서 그대로 뽑았다. */
const COLORS = ['#222222', '#ed8178', '#f1c664', '#80b87c', '#78accf', '#a58bc0'] as const

/**
 * 팔레트 버튼에서 펼치는 추가 색. 기본 6색과 겹치지 않게 밝은·어두운 톤과 피부색 계열을 골랐다.
 * 이 밖의 색은 OS 색 선택기(input type=color)로 고른다.
 */
const EXTRA_COLORS = [
  '#ffffff', '#9e9e9e', '#5c5c5c', '#000000', '#f6c8b6', '#e0a47e',
  '#a86b4c', '#6b3f2a', '#ff5a4f', '#ff9a3c', '#ffe14d', '#b7dc5a',
  '#2fa66b', '#3fc6c6', '#2f6fd6', '#1f3a8a', '#ff8fc3', '#c03a8a',
] as const

/** 지우개는 획 단위라 굵기 개념이 없다. 반경은 엔진이 정한다. */
const ERASER_WIDTH = 0

/** 형광펜 굵기. 면을 빨리 덮어야 해서 펜보다 훨씬 굵다. */
const MARKER_WIDTH = 0.09

/** 채우기는 굵기 개념이 없다. 탭한 지점이 속한 닫힌 영역을 칠한다. */
const FILL_WIDTH = 0

/** 카드 안 확대 상한. 얼굴 칸이 카드의 일부라 이 정도면 칸이 카드를 꽉 채운다. */
const ZOOM_MAX = 4

/** 카드 안 확대 상태. 내용 레이어의 transform(translate → scale, 원점 좌상단)과 같다. */
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

export type SubmitResult = {
  strokes: Stroke[]
  png: string
  /**
   * 업로드용 PNG. 서버 제출은 data URL이 아니라 Blob을 받으므로 이걸 쓴다.
   * 제출 multipart의 face 파트에 그대로 들어간다.
   * toBlob이 실패하면(캔버스 소실 등) null이다.
   */
  face: Blob | null
  /** 최소 획수를 못 채우면 저장하지 않는다(FR-09 획수제한, 시나리오 12단계). */
  saved: boolean
  reason: 'manual' | 'timeout'
}

type Props = {
  template: CellTemplate
  cellSize: CellSize
  /** 이 획수를 못 채우면 제출이 저장되지 않는다. */
  minStrokes: number
  /**
   * 제한 시간 덮어쓰기. null이면 타이머를 끈다(MVP 얼굴 그리기 화면 = 제한 시간 없음).
   * 생략하면 칸 크기별 기본값(FR-09).
   */
  timeLimitMs?: number | null
  /** 제출 버튼 라벨. 화면마다 다음 단계 이름이 다르다. */
  submitLabel?: string
  /** 제출 후 서버 호출이 진행 중이면 true. 중복 제출을 막는다. */
  busy?: boolean
  /**
   * 얼굴 칸 뒤에 깔 포즈. 주면 시안처럼 캐릭터 전체 위에서 얼굴 자리에 그린다.
   *
   * 칸은 faceRect 안의 정사각(한 변 = 짧은 쪽)이다. 합성(PlacedSprite)이 정사각 PNG를
   * faceRect에 object-fit: contain으로 넣으므로, 같은 자리에 그려야 "그린 자리 = 올라가는 자리"가 된다.
   */
  pose?: {
    url: string
    canvas: { width: number; height: number }
    faceRect: { x: number; y: number; width: number; height: number }
  }
  onSubmit: (result: SubmitResult) => void
}

/** faceRect 안에 들어가는 정사각 칸의 위치(포즈 캔버스 대비 %). */
function faceSquare({ canvas, faceRect }: NonNullable<Props['pose']>): CSSProperties {
  const side = Math.min(faceRect.width, faceRect.height)
  const x = faceRect.x + (faceRect.width - side) / 2
  const y = faceRect.y + (faceRect.height - side) / 2
  return {
    left: `${(x / canvas.width) * 100}%`,
    top: `${(y / canvas.height) * 100}%`,
    width: `${(side / canvas.width) * 100}%`,
    height: `${(side / canvas.height) * 100}%`,
  }
}

export function DrawCell({
  template,
  cellSize,
  minStrokes,
  timeLimitMs,
  submitLabel = '완료',
  busy = false,
  pose,
  onSubmit,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const zoomRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  /** 확대 상태는 제스처마다 바뀌므로 렌더를 거치지 않고 DOM에 바로 쓴다. */
  const viewRef = useRef<View>(IDENTITY)
  const engineRef = useRef<DrawEngine | null>(null)
  const submittedRef = useRef(false)

  /** null = 무제한. undefined면 칸 크기별 기본값. */
  const limitMs = timeLimitMs === undefined ? TIME_LIMIT_MS[cellSize] : timeLimitMs

  const [tool, setTool] = useState<Tool>({ mode: 'draw', color: COLORS[0], width: PEN_DEFAULT })
  /** 펜 굵기는 다른 도구를 쓰다 돌아와도 유지한다. */
  const [penWidth, setPenWidth] = useState<number>(PEN_DEFAULT)
  const [strokeCount, setStrokeCount] = useState(0)
  const [canUndo, setCanUndo] = useState(false)
  /** 확대돼 있으면 "원래 크기" 버튼을 보여준다. */
  const [zoomed, setZoomed] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  /** 팔레트에서 마지막으로 고른 색. 기본 6색 옆 칸에 남겨 다시 고르기 쉽게 한다. */
  const [customColor, setCustomColor] = useState<string | null>(null)
  const [remainingMs, setRemainingMs] = useState(limitMs ?? 0)

  const submit = useCallback(
    (reason: SubmitResult['reason']) => {
      const engine = engineRef.current
      if (!engine || submittedRef.current) return
      submittedRef.current = true
      const strokes = engine.getStrokes()
      const saved = strokes.length >= minStrokes
      const png = engine.toPNG()

      // 최소 획수 미달이면 저장하지 않으므로 Blob을 만들 이유가 없다.
      if (!saved) {
        onSubmit({ strokes, png, face: null, saved, reason })
        return
      }
      // toBlob은 비동기다. 제출을 막지 않도록 결과가 나오면 넘긴다.
      void engine.toBlob().then((face) => {
        onSubmit({ strokes, png, face, saved, reason })
      })
    },
    [minStrokes, onSubmit],
  )

  // 엔진 생성 + 입력 바인딩. 템플릿 단위로 한 번만 만든다.
  useEffect(() => {
    const canvas = canvasRef.current
    const frame = frameRef.current
    const card = cardRef.current
    const layer = zoomRef.current
    if (!canvas || !frame || !card || !layer) return

    const engine = new DrawEngine(canvas, template, tool)
    engineRef.current = engine

    const sync = () => {
      setStrokeCount(engine.strokeCount)
      setCanUndo(engine.canUndo)
    }

    // 정사각 유지. 인앱 브라우저는 주소창 때문에 높이가 자주 바뀐다.
    // getBoundingClientRect는 확대(transform)가 반영된 크기라 레이아웃 크기(client*)를 쓴다.
    const observer = new ResizeObserver(() => {
      engine.resize(Math.max(1, Math.floor(Math.min(frame.clientWidth, frame.clientHeight))))
    })
    observer.observe(frame)

    // ── 카드 안 확대·이동 ──
    const applyView = (view: View) => {
      viewRef.current = view
      layer.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`
    }
    /** 카드 안쪽(테두리 제외) 기준 좌표. */
    const local = (clientX: number, clientY: number) => {
      const rect = card.getBoundingClientRect()
      return { x: clientX - rect.left - card.clientLeft, y: clientY - rect.top - card.clientTop }
    }
    /** 제스처가 끝나면 해상도를 맞춘다. 제스처 중에 하면 매 프레임 전체를 다시 그린다. */
    const settle = () => {
      engine.setZoom(viewRef.current.scale)
      setZoomed(viewRef.current.scale > 1.01)
    }
    let pinchFrom: { view: View; at: { x: number; y: number }; distance: number } | null = null
    const zoomAround = (from: View, at: { x: number; y: number }, to: { x: number; y: number }, scale: number) => {
      // 시작 시점에 손가락 아래 있던 내용 점이 지금 손가락 아래에 오도록 이동량을 정한다.
      // 배율을 먼저 묶어야 한다. 상한을 넘은 배율로 이동량을 계산하면 내용이 손가락 밖으로 밀린다.
      const s = Math.min(ZOOM_MAX, Math.max(1, scale))
      const contentX = (at.x - from.x) / from.scale
      const contentY = (at.y - from.y) / from.scale
      const next = { scale: s, x: to.x - contentX * s, y: to.y - contentY * s }
      applyView(clampView(next, card.clientWidth, card.clientHeight))
    }

    const unbind = bindPointerInput(card, {
      onBegin: (s) => {
        const at = engine.clientToNorm(s.clientX, s.clientY)
        engine.beginStroke(at, s.device, s.pressure, performance.now())
        sync()
      },
      onExtend: (s) => {
        engine.extendStroke(engine.clientToNorm(s.clientX, s.clientY), s.pressure, performance.now())
      },
      onEnd: () => {
        engine.endStroke()
        sync()
      },
      onCancel: () => {
        engine.cancelStroke()
        sync()
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
    card.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      unbind()
      card.removeEventListener('wheel', onWheel)
      window.clearTimeout(wheelTimer)
      observer.disconnect()
      engineRef.current = null
    }
    // tool은 아래 effect에서 따로 주입한다. 여기서 의존하면 엔진이 재생성된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template])

  useEffect(() => {
    engineRef.current?.setTool(tool)
  }, [tool])

  // 제한 시간. 0이 되면 자동 제출(FR-10). 무제한이면 타이머를 걸지 않는다.
  useEffect(() => {
    if (limitMs === null) return
    const limit = limitMs
    const startedAt = performance.now()
    let handle = 0

    const tick = () => {
      const left = limit - (performance.now() - startedAt)
      if (left <= 0) {
        setRemainingMs(0)
        submit('timeout')
        return
      }
      setRemainingMs(left)
      handle = requestAnimationFrame(tick)
    }
    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [limitMs, submit])

  const enough = strokeCount >= minStrokes

  // 팔레트가 열려 있을 때 바깥을 누르면 닫는다.
  useEffect(() => {
    if (!paletteOpen) return
    const onDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setPaletteOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [paletteOpen])

  const usePen = () => setTool((t) => ({ ...t, mode: 'draw', width: penWidth }))

  /** 색을 고르면 그 색으로 칠한다. 지우개를 쓰다가 고르면 그 색의 펜으로 돌아간다. */
  const pickColor = (color: string) =>
    setTool((t) => (t.mode === 'erase' ? { mode: 'draw', color, width: penWidth } : { ...t, color }))

  const pickCustom = (color: string) => {
    setCustomColor(color)
    pickColor(color)
  }

  const resetZoom = () => {
    viewRef.current = IDENTITY
    if (zoomRef.current) zoomRef.current.style.transform = ''
    engineRef.current?.setZoom(1)
    setZoomed(false)
  }

  /** 기본 6색이 아닌 색을 쓰고 있으면 그 색이 팔레트 버튼에 보인다. */
  const customShown =
    customColor ?? ((COLORS as readonly string[]).includes(tool.color) ? null : tool.color)
  const customActive = !(COLORS as readonly string[]).includes(tool.color)

  const canvasFrame = (
    <div className="canvas-frame" ref={frameRef} style={pose ? faceSquare(pose) : undefined}>
      <canvas ref={canvasRef} className="canvas" />
    </div>
  )

  return (
    <div className="draw">
      {limitMs !== null && (
        <div className="timer-track" aria-label={`${(remainingMs / 1000).toFixed(1)}초 남음`}>
          <div className="timer-fill" style={{ width: `${(remainingMs / limitMs) * 100}%` }} />
        </div>
      )}

      {/* 카드가 입력판이다. 한 손가락은 그리기, 두 손가락은 확대·이동(src/draw/pointer.ts). */}
      <div className="draw-card" ref={cardRef}>
        <div className="draw-zoom" ref={zoomRef}>
          {pose ? (
            <div
              className="draw-pose"
              style={{ '--ratio': pose.canvas.width / pose.canvas.height } as CSSProperties}
            >
              <img src={pose.url} alt="" />
              {canvasFrame}
            </div>
          ) : (
            canvasFrame
          )}
        </div>
        {zoomed && (
          <button type="button" className="draw-zoom-reset" onClick={resetZoom}>
            원래 크기
          </button>
        )}
      </div>

      <div className="draw-panel" ref={panelRef}>
        <div className="draw-tools">
          <button type="button" aria-pressed={tool.mode === 'draw'} onClick={usePen}>
            펜
          </button>
          <button
            type="button"
            aria-pressed={tool.mode === 'marker'}
            onClick={() => setTool((t) => ({ ...t, mode: 'marker', width: MARKER_WIDTH }))}
          >
            형광펜
          </button>
          <button
            type="button"
            aria-pressed={tool.mode === 'fill'}
            onClick={() => setTool((t) => ({ ...t, mode: 'fill', width: FILL_WIDTH }))}
          >
            채우기
          </button>
          <button
            type="button"
            aria-pressed={tool.mode === 'erase'}
            onClick={() => setTool((t) => ({ ...t, mode: 'erase', width: ERASER_WIDTH }))}
          >
            지우개
          </button>
          <button
            type="button"
            disabled={!canUndo}
            onClick={() => {
              const engine = engineRef.current
              if (!engine) return
              engine.undo()
              setStrokeCount(engine.strokeCount)
              setCanUndo(engine.canUndo)
            }}
          >
            되돌리기
          </button>
        </div>

        {/*
          색·굵기 줄은 도구와 상관없이 항상 보인다. 지우개를 골라도 사라지지 않고,
          여기서 색이나 굵기를 고르면 바로 펜으로 돌아간다.
        */}
        <div className="draw-colors">
          {COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`색 ${color}`}
              aria-pressed={tool.color === color}
              className="swatch"
              style={{ background: color }}
              onClick={() => pickColor(color)}
            />
          ))}
          <button
            type="button"
            aria-label="색 더 보기"
            aria-expanded={paletteOpen}
            aria-pressed={customActive}
            className={customShown ? 'swatch swatch--custom has-color' : 'swatch swatch--custom'}
            style={customShown ? ({ '--custom': customShown } as CSSProperties) : undefined}
            onClick={() => setPaletteOpen((open) => !open)}
          />
        </div>

        {paletteOpen && (
          <div className="palette-pop" role="dialog" aria-label="색 고르기">
            <div className="palette-grid">
              {EXTRA_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`색 ${color}`}
                  aria-pressed={tool.color === color}
                  className="swatch"
                  style={{ background: color }}
                  onClick={() => {
                    pickCustom(color)
                    setPaletteOpen(false)
                  }}
                />
              ))}
            </div>
            <label className="palette-picker">
              <input
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(tool.color) ? tool.color : '#000000'}
                onChange={(e) => pickCustom(e.target.value)}
              />
              <span>직접 고르기</span>
            </label>
          </div>
        )}

        <label className="draw-width">
          <span>펜 굵기</span>
          <span>가늘게</span>
          <input
            type="range"
            min={PEN_MIN}
            max={PEN_MAX}
            step={0.002}
            value={penWidth}
            onChange={(e) => {
              const width = Number(e.target.value)
              setPenWidth(width)
              setTool((t) => ({ ...t, mode: 'draw', width }))
            }}
          />
          <span>굵게</span>
        </label>
      </div>

      <div className="screen-foot">
        <button type="button" disabled={!enough || busy} onClick={() => submit('manual')}>
          {submitLabel}
        </button>
      </div>
    </div>
  )
}
