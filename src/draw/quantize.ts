import type { Point } from './types.ts'

/**
 * 획 데이터 양자화.
 *
 * 입력 장치가 주는 값은 쓸데없이 정밀하다. performance.now()는 0.4ms를
 * 0.4000000059604645로, 필압은 0.34를 0.34161844849586487로 준다.
 * 그대로 저장하면 점 하나가 89바이트가 되고, 60초 칸 하나가 수백 KB,
 * 방 하나(6칸)가 수 MB까지 간다. 재생(FR-15)은 6칸을 전부 받아야 시작되므로
 * 그대로 두면 모바일에서 재생 시작까지 한참 걸린다.
 *
 * 왜 10진 반올림인가:
 *   정수 격자(round(x * 4096))는 바이너리로 패킹할 때만 이득이다. JSON에서는
 *   0.82가 0.81982421875로 늘어나 오히려 손해다. 10진 반올림은 문자열이 그대로
 *   짧아지고, 연결점 같은 authored 값(0.82)이 변형되지 않는다.
 *
 * 왜 저장 시점이 아니라 캡처 시점인가:
 *   그리는 중 화면에 보이는 것과 저장·전송·재생되는 것이 같아야 한다.
 *   저장할 때 깎으면 내가 그린 선과 남에게 보이는 선이 미세하게 달라진다.
 */

/**
 * 좌표 소수점 자리수.
 *
 * 1/10000 = 정규화 0.0001. 그리기 영역이 가장 클 때(약 1344 device px)
 * 0.13px에 해당해 화소보다 촘촘하다. 눈에 보이는 손실이 없다.
 */
const COORD_DECIMALS = 10_000

/**
 * 필압 소수점 자리수.
 *
 * 1/100. 가장 굵은 펜(약 9px)에서 폭 변화 단계가 0.06px라 띠가 생기지 않는다.
 */
const PRESSURE_DECIMALS = 100

export function quantizeCoord(v: number): number {
  return Math.round(v * COORD_DECIMALS) / COORD_DECIMALS
}

export function quantizePressure(p: number): number {
  return Math.round(p * PRESSURE_DECIMALS) / PRESSURE_DECIMALS
}

/** 시간은 ms 정수. 240Hz 입력도 점 간격이 약 4.2ms라 1ms 해상도면 충분하다. */
export function quantizeTime(ms: number): number {
  return Math.round(ms)
}

export function quantizePoint(x: number, y: number, t: number, p: number): Point {
  return {
    x: quantizeCoord(x),
    y: quantizeCoord(y),
    t: quantizeTime(t),
    p: quantizePressure(p),
  }
}
