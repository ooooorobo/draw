import { useCallback, useEffect, useRef, useState } from 'react'
import { DrawCell, type SubmitResult } from './DrawCell.tsx'
import { DrawEngine } from './draw/engine.ts'
import { TORSO_CELL } from './draw/template.ts'
import type { CellSize } from './draw/types.ts'

/**
 * PoC 검증용 하네스. 제품 화면이 아니다.
 *
 * 방/링크/공유/서버는 전부 범위 밖이고, 여기서 확인하려는 것은 네 가지다.
 *   1. 캔버스 입력이 모바일/펜슬/인앱 브라우저에서 안정적인가
 *   2. 도구(펜 2종, 색 6개, 지우개, 되돌리기)가 동작하는가
 *   3. 제한 시간 자동 제출과 최소 획수 차단이 동작하는가
 *   4. 획 데이터만으로 FR-15 "획 순서대로 재생"이 가능한가
 */

const MIN_STROKES = 2
const REPLAY_MS = 2500

type Phase = 'idle' | 'countdown' | 'drawing' | 'done'

export default function App() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [cellSize, setCellSize] = useState<CellSize>('medium')
  const [countdown, setCountdown] = useState(3)
  const [result, setResult] = useState<SubmitResult | null>(null)

  const replayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const replayEngineRef = useRef<DrawEngine | null>(null)

  // 시작 전 3초 카운트다운(시나리오 8단계).
  // 상태 전이는 타이머 콜백에서 일으킨다. effect 본문에서 바로 setState하면 렌더가 한 번 더 돈다.
  useEffect(() => {
    if (phase !== 'countdown') return
    const timer = setTimeout(() => {
      if (countdown <= 1) setPhase('drawing')
      else setCountdown(countdown - 1)
    }, 1000)
    return () => clearTimeout(timer)
  }, [phase, countdown])

  const onSubmit = useCallback((r: SubmitResult) => {
    setResult(r)
    setPhase('done')
  }, [])

  // 결과 화면: 저장된 획 데이터만으로 재생을 재구성한다.
  useEffect(() => {
    if (phase !== 'done' || !result?.saved) return
    const canvas = replayCanvasRef.current
    if (!canvas) return

    const engine = new DrawEngine(canvas, TORSO_CELL, {
      mode: 'draw',
      color: '#111111',
      width: 0.012,
    })
    replayEngineRef.current = engine
    engine.resize(320)
    for (const stroke of result.strokes) engine.getStrokes().push(stroke)
    engine.replay(REPLAY_MS)

    return () => {
      engine.cancelReplay()
      replayEngineRef.current = null
    }
  }, [phase, result])

  const restart = () => {
    setResult(null)
    setCountdown(3)
    setPhase('idle')
  }

  return (
    <main className="app">
      {phase === 'idle' && (
        <section className="panel">
          <h1>캔버스 PoC</h1>
          <p>칸 크기를 고르면 제한 시간이 달라진다(20 / 45 / 60초).</p>
          <div className="tools">
            {(['small', 'medium', 'large'] as const).map((size) => (
              <button
                key={size}
                type="button"
                aria-pressed={cellSize === size}
                onClick={() => setCellSize(size)}
              >
                {size}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setPhase('countdown')}>
            시작 (시작하면 멈출 수 없음)
          </button>
        </section>
      )}

      {phase === 'countdown' && (
        <section className="panel">
          <p className="countdown">{countdown}</p>
        </section>
      )}

      {phase === 'drawing' && (
        <DrawCell
          template={TORSO_CELL}
          cellSize={cellSize}
          minStrokes={MIN_STROKES}
          onSubmit={onSubmit}
        />
      )}

      {phase === 'done' && result && (
        <section className="panel">
          <h2>{result.saved ? '제출됨' : '저장되지 않음'}</h2>
          <p>
            사유: {result.reason === 'timeout' ? '시간 종료' : '완료 버튼'} / 획 {result.strokes.length}개
            {!result.saved && ` / 최소 ${MIN_STROKES}획 미달`}
          </p>

          {result.saved && (
            <>
              <p>획 순서 재생(FR-15):</p>
              <canvas ref={replayCanvasRef} className="canvas" />
              <div className="tools">
                <button
                  type="button"
                  onClick={() => replayEngineRef.current?.replay(REPLAY_MS)}
                >
                  다시 재생
                </button>
                <a href={result.png} download="cell.png">
                  PNG 저장
                </a>
              </div>
              <details>
                <summary>
                  획 데이터 ({JSON.stringify(result.strokes).length.toLocaleString()} bytes)
                </summary>
                <pre className="dump">
                  {JSON.stringify(
                    result.strokes.map((s) => ({
                      mode: s.mode,
                      color: s.color,
                      width: s.width,
                      device: s.device,
                      points: s.points.length,
                    })),
                    null,
                    2,
                  )}
                </pre>
              </details>
            </>
          )}

          <button type="button" onClick={restart}>
            다시 테스트
          </button>
        </section>
      )}
    </main>
  )
}
