/**
 * 획(stroke) 데이터 모델.
 *
 * PRD FR-09 "획 데이터로 저장" / FR-15 "칸을 획 순서대로 재생"을 만족시키기 위해
 * 캔버스를 픽셀 비트맵이 아니라 획의 목록으로 보관한다.
 * 픽셀로 저장하면 재생 연출과 서버 전송 단위가 모두 불가능해진다.
 */

/** 칸 기준 정규화 좌표. 칸의 그리기 영역이 0..1. 경계 띠 힌트는 0..1 밖으로 나갈 수 있다. */
export type Vec = {
  x: number
  y: number
}

export type Point = Vec & {
  /** 획 시작 시점부터의 경과 ms. 재생 타이밍에 쓴다. */
  t: number
  /**
   * 필압 0..1. 태블릿 펜슬에서만 실제 값이 들어오고,
   * 손가락/마우스는 1로 고정된다(= 굵기 변화 없음).
   */
  p: number
}

export type StrokeMode = 'draw' | 'erase'

export type Stroke = {
  id: string
  mode: StrokeMode
  /** CSS 색. mode가 erase면 무시된다. */
  color: string
  /** 정규화 굵기. 실제 px = width * 칸 한 변 길이. 칸 크기가 달라도 같은 두께로 보인다. */
  width: number
  /** 입력 장치. 필압 적용 여부와 디버깅에 쓴다. */
  device: 'pen' | 'touch' | 'mouse'
  /** 세션 시작 기준 획 시작 시각(ms). 재생 순서와 간격의 기준. */
  startedAt: number
  points: Point[]
}

/** 칸 하나의 틀. 서버에서 내려줄 템플릿 데이터의 PoC 대역. */
export type CellTemplate = {
  id: string
  label: string
  /** 그리기 가능 영역을 정의하는 닫힌 다각형(정규화 좌표). */
  outline: Vec[]
  /** 연결점: 칸 경계에 고정된 점. 양쪽 칸의 선이 이 점에서 만난다. */
  anchors: Vec[]
  /** 경계 띠: 이미 채워진 옆 칸의 가장자리 일부. 그리는 사람에게만 보이는 힌트. */
  hints: Stroke[]
}

/** 칸 크기별 제한 시간(FR-09). */
export type CellSize = 'small' | 'medium' | 'large'

export const TIME_LIMIT_MS: Record<CellSize, number> = {
  small: 20_000,
  medium: 45_000,
  large: 60_000,
}
