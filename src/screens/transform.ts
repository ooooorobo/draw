/**
 * 배경 위 캐릭터 변형(이동·크기·회전) 공통 계산. N07 배치와 N10 방장 관리가 같이 쓴다.
 * 좌표는 서버와 같다: x·y = 배경 기준 중심 비율, scale = 배경 너비 대비 캐릭터 너비, rotation = 도.
 */

/** 서버 제약(scale 0.05~1). */
export const MIN_SCALE = 0.05
export const MAX_SCALE = 1

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** 회전이 0° 근처면 똑바로 붙인다. 손으로 정확히 0°를 맞추기 어렵다. */
const ROTATION_SNAP = 4

/** 각도를 -180~180(서버 범위)으로. 0° 근처는 0으로 붙인다. */
export function normalizeRotation(deg: number): number {
  const d = ((((deg + 180) % 360) + 360) % 360) - 180
  return Math.abs(d) < ROTATION_SNAP ? 0 : Math.round(d * 10) / 10
}

/**
 * 모서리 손잡이를 끈 위치(그림 px)로 새 scale을 구한다. 중심은 고정, 양쪽 대칭으로 커진다.
 * 손가락 위치를 캐릭터 회전 좌표계로 되돌려 재서, 돌린 상태에서도 모서리를 끄는 대로 커진다.
 */
export function scaleFromCorner(
  from: { x: number; y: number; rotation: number },
  point: { x: number; y: number },
  world: { width: number; height: number },
  canvas: { width: number; height: number },
): number {
  const dx = point.x - from.x * world.width
  const dy = point.y - from.y * world.height
  const rad = (-from.rotation * Math.PI) / 180
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad)
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad)
  const half = Math.max(Math.abs(lx), Math.abs(ly) * (canvas.width / canvas.height))
  return clamp((half * 2) / world.width, MIN_SCALE, MAX_SCALE)
}

/** 두 손가락 사이 거리·각도. 핀치(크기)와 비틀기(회전)를 같이 잰다. */
export function fingerPair(points: Iterable<{ x: number; y: number }>) {
  const [a, b] = [...points]
  if (!a || !b) return null
  return { distance: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x) }
}

/** 핀치 시작 → 지금으로 바뀐 scale·rotation. */
export function pinchTransform(
  from: { scale: number; rotation: number },
  start: { distance: number; angle: number },
  now: { distance: number; angle: number },
) {
  const ratio = start.distance > 0 ? now.distance / start.distance : 1
  return {
    scale: clamp(from.scale * ratio, MIN_SCALE, MAX_SCALE),
    rotation: normalizeRotation(from.rotation + ((now.angle - start.angle) * 180) / Math.PI),
  }
}
