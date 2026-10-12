import type { CellTemplate, Stroke, Vec } from './types.ts'

/**
 * PoC용 칸 템플릿 1개.
 *
 * 실제 템플릿(사람 전신 6칸, 얼굴 이목구비 6칸, 가변형)은 서버가 내려준다.
 * 여기서는 "몸통" 칸 하나만 손으로 정의해서 렌더링 계층을 검증한다.
 */

function hint(points: Vec[], color: string, width: number): Stroke {
  return {
    id: `hint_${color}_${Math.round(points[0]!.x * 1000)}`,
    mode: 'draw',
    color,
    width,
    device: 'mouse',
    startedAt: 0,
    points: points.map((p, i) => ({ x: p.x, y: p.y, t: i * 16, p: 1 })),
  }
}

/** 연결점. 양옆/위아래 칸의 선이 이 점에서 만난다. */
const NECK: Vec = { x: 0.5, y: 0 }
const SHOULDER_L: Vec = { x: 0.18, y: 0.16 }
const SHOULDER_R: Vec = { x: 0.82, y: 0.16 }
const HIP_L: Vec = { x: 0.3, y: 1 }
const HIP_R: Vec = { x: 0.7, y: 1 }

export const TORSO_CELL: CellTemplate = {
  id: 'torso',
  label: '몸통',
  outline: [
    NECK,
    SHOULDER_R,
    { x: 0.88, y: 0.3 },
    HIP_R,
    HIP_L,
    { x: 0.12, y: 0.3 },
    SHOULDER_L,
  ],
  anchors: [NECK, SHOULDER_L, SHOULDER_R, HIP_L, HIP_R],
  /*
   * 경계 띠: 이미 채워진 옆 칸의 가장자리.
   * PoC라 서버 데이터가 없어서 고정값을 넣는다. 가짜 그림이 아니라
   * "이웃 칸의 획 데이터를 받아 바깥 영역에만 렌더한다"는 경로를 증명하는 용도다.
   */
  hints: [
    // 위(머리) 칸: 목 연결점에서 내려오는 선.
    hint(
      [
        { x: 0.42, y: -0.09 },
        { x: 0.45, y: -0.05 },
        { x: 0.5, y: 0 },
      ],
      '#111111',
      0.012,
    ),
    hint(
      [
        { x: 0.58, y: -0.09 },
        { x: 0.55, y: -0.05 },
        { x: 0.5, y: 0 },
      ],
      '#111111',
      0.012,
    ),
    // 오른팔 칸: 어깨 연결점에서 뻗어나가는 선.
    hint(
      [
        { x: 0.82, y: 0.16 },
        { x: 0.88, y: 0.2 },
        { x: 0.94, y: 0.26 },
      ],
      '#111111',
      0.012,
    ),
  ],
}
