/**
 * 배치 값과 제스처 수학. React·DOM에 의존하지 않는다.
 *
 * 좌표 계약은 제출 API(Placement 스키마)를 그대로 따른다.
 *   x, y     배경 사각형 기준 "중심" 비율 0..1
 *   scale    배경 너비 대비 캐릭터 너비 비율 0.05..1
 *   rotation 도 단위 -180..180
 * 서버가 이 범위를 검사해서 벗어나면 400이다. 그래서 모든 변형 결과를 clampSpot으로 거른다.
 *
 * zIndex는 보내지 않는다. 서버가 등록 순서로 정한다.
 */
import type { Placement } from './relay-draw/client.ts'

/** 확정된 배치 한 자리. 서버 스키마에서 선택값인 scale/rotation을 화면에서는 항상 들고 있는다. */
export type Spot = Required<Placement>

export const SCALE_MIN = 0.05
export const SCALE_MAX = 1

/**
 * 처음 올려둘 자리. 가로 가운데, 세로는 중심 0.55.
 * 기본 배경(1200×800)의 지면선이 y≈0.7이라 기본 크기(0.2)의 캐릭터가 거의 바닥에 선다.
 */
export const DEFAULT_SPOT: Spot = { x: 0.5, y: 0.55, scale: 0.2, rotation: 0 }

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 회전을 -180..180으로 접는다. 제스처로 몇 바퀴를 돌려도 서버 범위를 넘지 않는다. */
export function wrapRotation(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180
}

export function clampSpot(spot: Spot): Spot {
  return {
    x: clamp(spot.x, 0, 1),
    y: clamp(spot.y, 0, 1),
    scale: clamp(spot.scale, SCALE_MIN, SCALE_MAX),
    rotation: wrapRotation(spot.rotation),
  }
}

/** 드래그 이동. dx/dy는 픽셀이 아니라 배경 사각형 기준 비율이다. */
export function moveSpot(spot: Spot, dx: number, dy: number): Spot {
  return clampSpot({ ...spot, x: spot.x + dx, y: spot.y + dy })
}

/**
 * 두 손가락 제스처의 한 순간.
 *
 * 중심은 배경 비율, 거리와 각도는 화면 픽셀 기준이다. 비율 공간은 가로·세로 배율이 서로
 * 달라서(배경이 정사각이 아니다) 거리·각도를 비율로 재면 찌그러진다.
 */
export type Pinch = { x: number; y: number; distance: number; angle: number }

/** 포인터 한 점. ratio는 배경 사각형 기준 0..1, client는 화면 픽셀. */
export type Grip = { ratioX: number; ratioY: number; clientX: number; clientY: number }

export function readPinch(a: Grip, b: Grip): Pinch {
  return {
    x: (a.ratioX + b.ratioX) / 2,
    y: (a.ratioY + b.ratioY) / 2,
    distance: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
    angle: (Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX) * 180) / Math.PI,
  }
}

/**
 * 두 손가락 변형. 제스처 시작(from)과 현재(to)를 비교해서 거리비는 크기에,
 * 각도차는 회전에, 두 손가락 중심의 이동은 위치에 적용한다.
 *
 * base는 "제스처 시작 시점의 배치"다. 프레임마다 누적하지 않아서 제스처가 길어져도
 * 오차가 쌓이지 않고, 손가락을 되돌리면 원래 값으로 정확히 돌아온다.
 */
export function pinchSpot(base: Spot, from: Pinch, to: Pinch): Spot {
  // 두 포인터가 같은 점이면(거리 0) 크기를 건드리지 않는다. 나누면 Infinity가 된다.
  const ratio = from.distance > 0 ? to.distance / from.distance : 1
  return clampSpot({
    x: base.x + (to.x - from.x),
    y: base.y + (to.y - from.y),
    scale: base.scale * ratio,
    rotation: base.rotation + (to.angle - from.angle),
  })
}

function round(value: number, digits: number): number {
  const unit = 10 ** digits
  return Math.round(value * unit) / unit
}

/**
 * 제출용 값 고정.
 *
 * 재시도에는 같은 metadata JSON을 보내야 한다(서버 멱등 조건). 제스처가 만든
 * 긴 소수를 그대로 쓰면 재시도 JSON이 달라질 여지가 있어서 제출 직전에 자른다.
 */
export function roundSpot(spot: Spot): Spot {
  return {
    x: round(spot.x, 4),
    y: round(spot.y, 4),
    scale: round(spot.scale, 4),
    rotation: round(spot.rotation, 1),
  }
}
