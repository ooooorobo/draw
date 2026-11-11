import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { DrawEngine, type Tool } from './draw/engine.ts'
import { bindPointerInput } from './draw/pointer.ts'
import { TIME_LIMIT_MS, type CellSize, type CellTemplate, type Stroke } from './draw/types.ts'

/**
 * 칸 그리기 화면(FR-09, FR-10). 확정 시안 `N06 · 얼굴 그리기`의 배치를 따른다.
 *
 *   흰 카드(포즈 + 얼굴 칸) / 도구 줄 / 색 6개 / 펜 굵기 / 하단 입체 CTA
 *
 * 시안의 도구 줄은 펜·지우개·되돌리기 셋이다. 이미 구현된 형광펜·채우기는 같은 줄에 남겨둔다.
 */

/** 펜 굵기 범위(FR-09). 시안의 "가늘게 ── 굵게" 슬라이더. 정규화 값이라 칸 크기와 무관하다. */
const PEN_MIN = 0.008
const PEN_MAX = 0.04
const PEN_DEFAULT = 0.016

/** 색 6개. 시안 팔레트(`N06 · 얼굴 그리기` 색 줄)에서 그대로 뽑았다. */
const COLORS = ['#222222', '#ed8178', '#f1c664', '#80b87c', '#78accf', '#a58bc0'] as const

const ERASER_WIDTH = 0.055

/** 형광펜 굵기. 면을 빨리 덮어야 해서 펜보다 훨씬 굵다. */
const MARKER_WIDTH = 0.09

/** 채우기는 굵기 개념이 없다. 탭한 지점이 속한 닫힌 영역을 칠한다. */
const FILL_WIDTH = 0

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
  const engineRef = useRef<DrawEngine | null>(null)
  const submittedRef = useRef(false)

  /** null = 무제한. undefined면 칸 크기별 기본값. */
  const limitMs = timeLimitMs === undefined ? TIME_LIMIT_MS[cellSize] : timeLimitMs

  const [tool, setTool] = useState<Tool>({ mode: 'draw', color: COLORS[0], width: PEN_DEFAULT })
  /** 펜 굵기는 다른 도구를 쓰다 돌아와도 유지한다. */
  const [penWidth, setPenWidth] = useState<number>(PEN_DEFAULT)
  const [strokeCount, setStrokeCount] = useState(0)
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
    if (!canvas || !frame) return

    const engine = new DrawEngine(canvas, template, tool)
    engineRef.current = engine

    // 정사각 유지. 인앱 브라우저는 주소창 때문에 높이가 자주 바뀐다.
    const observer = new ResizeObserver(() => {
      const rect = frame.getBoundingClientRect()
      engine.resize(Math.max(1, Math.floor(Math.min(rect.width, rect.height))))
    })
    observer.observe(frame)

    const unbind = bindPointerInput(canvas, {
      onBegin: (s) => {
        const at = engine.clientToNorm(s.clientX, s.clientY)
        engine.beginStroke(at, s.device, s.pressure, performance.now())
        setStrokeCount(engine.strokeCount)
      },
      onExtend: (s) => {
        engine.extendStroke(engine.clientToNorm(s.clientX, s.clientY), s.pressure, performance.now())
      },
      onEnd: () => {
        engine.endStroke()
        setStrokeCount(engine.strokeCount)
      },
      onCancel: () => {
        engine.cancelStroke()
        setStrokeCount(engine.strokeCount)
      },
    })

    return () => {
      unbind()
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

  const usePen = () => setTool((t) => ({ ...t, mode: 'draw', width: penWidth }))

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

      <div className="draw-card">
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

      <div className="draw-panel">
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
            disabled={strokeCount === 0}
            onClick={() => {
              engineRef.current?.undo()
              setStrokeCount(engineRef.current?.strokeCount ?? 0)
            }}
          >
            되돌리기
          </button>
        </div>

        <div className="draw-colors">
          {COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`색 ${color}`}
              aria-pressed={tool.color === color}
              className="swatch"
              style={{ background: color }}
              onClick={() =>
                // 지우개를 쓰다가 색을 고르면 그 색의 펜으로 돌아간다.
                setTool((t) =>
                  t.mode === 'erase' ? { mode: 'draw', color, width: penWidth } : { ...t, color },
                )
              }
            />
          ))}
        </div>

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
