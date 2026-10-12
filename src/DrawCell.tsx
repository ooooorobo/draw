import { useCallback, useEffect, useRef, useState } from 'react'
import { DrawEngine, type Tool } from './draw/engine.ts'
import { bindPointerInput } from './draw/pointer.ts'
import { TIME_LIMIT_MS, type CellSize, type CellTemplate, type Stroke } from './draw/types.ts'

/**
 * 칸 그리기 화면(FR-09, FR-10).
 *
 * 디자인은 디자이너 작업물로 교체된다. 여기 있는 색/배치/여백은 전부 임시이며
 * 기능 검증(도구 동작, 제한 시간, 최소 획수, 제출)만을 목적으로 한다.
 */

/** 펜 굵기 2종(FR-09). 정규화 값이라 칸 크기와 무관하게 같은 두께로 보인다. */
const PEN_WIDTHS = [0.012, 0.03] as const

/** 색 6개(FR-09). 디자이너 팔레트로 교체 예정. */
const COLORS = ['#111111', '#e5342b', '#2f6fdd', '#f2b01e', '#2aa34a', '#8b5a2b'] as const

const ERASER_WIDTH = 0.055

export type SubmitResult = {
  strokes: Stroke[]
  png: string
  /** 최소 획수를 못 채우면 저장하지 않는다(FR-09 획수제한, 시나리오 12단계). */
  saved: boolean
  reason: 'manual' | 'timeout'
}

type Props = {
  template: CellTemplate
  cellSize: CellSize
  /** 이 획수를 못 채우면 제출이 저장되지 않는다. */
  minStrokes: number
  onSubmit: (result: SubmitResult) => void
}

export function DrawCell({ template, cellSize, minStrokes, onSubmit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const engineRef = useRef<DrawEngine | null>(null)
  const submittedRef = useRef(false)

  const [tool, setTool] = useState<Tool>({ mode: 'draw', color: COLORS[0], width: PEN_WIDTHS[0] })
  const [strokeCount, setStrokeCount] = useState(0)
  const [remainingMs, setRemainingMs] = useState(TIME_LIMIT_MS[cellSize])

  const submit = useCallback(
    (reason: SubmitResult['reason']) => {
      const engine = engineRef.current
      if (!engine || submittedRef.current) return
      submittedRef.current = true
      const strokes = engine.getStrokes()
      onSubmit({
        strokes,
        png: engine.toPNG(),
        saved: strokes.length >= minStrokes,
        reason,
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

  // 제한 시간. 0이 되면 자동 제출(FR-10).
  useEffect(() => {
    const limit = TIME_LIMIT_MS[cellSize]
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
  }, [cellSize, submit])

  const enough = strokeCount >= minStrokes

  return (
    <div className="cell">
      <div className="cell-head">
        <span>
          {template.label} / {cellSize}
        </span>
        <span>{(remainingMs / 1000).toFixed(1)}s</span>
      </div>

      <div className="timer-track">
        <div
          className="timer-fill"
          style={{ width: `${(remainingMs / TIME_LIMIT_MS[cellSize]) * 100}%` }}
        />
      </div>

      <div className="canvas-frame" ref={frameRef}>
        <canvas ref={canvasRef} className="canvas" />
      </div>

      <div className="tools">
        {PEN_WIDTHS.map((width, i) => (
          <button
            key={width}
            type="button"
            aria-pressed={tool.mode === 'draw' && tool.width === width}
            onClick={() => setTool((t) => ({ ...t, mode: 'draw', width }))}
          >
            펜 {i === 0 ? '얇게' : '굵게'}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={tool.mode === 'erase'}
          onClick={() => setTool((t) => ({ ...t, mode: 'erase', width: ERASER_WIDTH }))}
        >
          지우개
        </button>
        <button
          type="button"
          onClick={() => {
            engineRef.current?.undo()
            setStrokeCount(engineRef.current?.strokeCount ?? 0)
          }}
        >
          되돌리기
        </button>
      </div>

      <div className="tools">
        {COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={color}
            aria-pressed={tool.mode === 'draw' && tool.color === color}
            className="swatch"
            style={{ background: color }}
            onClick={() => setTool((t) => ({ ...t, mode: 'draw', color }))}
          />
        ))}
      </div>

      <div className="cell-foot">
        <span>
          획 {strokeCount} / 최소 {minStrokes}
        </span>
        <button type="button" disabled={!enough} onClick={() => submit('manual')}>
          완료
        </button>
      </div>
    </div>
  )
}
