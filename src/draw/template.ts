import type { CellTemplate, Vec } from './types.ts'

/**
 * 얼굴 칸 템플릿.
 *
 * 칸의 모양은 카탈로그가 내려주는 포즈의 faceRect에서 만든다. 서버에 "그리기 템플릿"
 * 엔드포인트는 없지만(엔드포인트 17개 전수 확인) 얼굴이 들어갈 영역은 카탈로그에 있고,
 * 그 영역이 곧 그릴 수 있는 범위다. 상수로 박아두면 서버가 faceRect를 바꿨을 때
 * 그리는 칸과 합성 결과가 어긋난다.
 *
 * 그리기 캔버스는 정사각이고(엔진이 정사각으로 맞춘다) 합성은 faceRect 안에 비율을
 * 지켜 넣는다(object-fit: contain). 그래서 faceRect가 정사각이 아니면 실제로 보이는
 * 영역도 정사각이 아니다. 가이드 타원을 그 비율에 맞춰야 "그린 자리 = 올라가는 자리"가 된다.
 *
 * 연결점(anchors)과 경계 띠(hints)는 비어 있다. 얼굴은 한 사람이 통째로 그려서
 * 이어 그릴 이웃 칸이 없다. 엔진의 지원은 서버가 여러 칸 템플릿을 주는 경우를 위해 남아 있다.
 */

/** 외곽선 다각형의 꼭짓점 수. 32개면 이 크기에서 원과 구분되지 않는다. */
const OUTLINE_POINTS = 32

/**
 * 칸 대비 반지름. 경계에 딱 붙이면 획 굵기의 절반이 잘려 테두리가 어색해진다.
 * 0.48로 살짝 안쪽에 둔다.
 */
const RADIUS = 0.48

function ellipse(rx: number, ry: number, points: number): Vec[] {
  return Array.from({ length: points }, (_, i) => {
    const angle = (i / points) * Math.PI * 2
    return { x: 0.5 + Math.cos(angle) * rx, y: 0.5 + Math.sin(angle) * ry }
  })
}

/**
 * 포즈의 faceRect로 얼굴 칸을 만든다.
 *
 * 같은 faceRect면 같은 결과라서 호출자가 메모이즈해 두면 된다(엔진은 template이 바뀌면
 * 다시 만들어진다).
 */
export function faceTemplate(faceRect: { width: number; height: number }): CellTemplate {
  const width = faceRect.width > 0 ? faceRect.width : 1
  const height = faceRect.height > 0 ? faceRect.height : 1
  // 긴 쪽을 칸에 꽉 채우고 짧은 쪽을 비율만큼 줄인다. contain과 같은 계산이다.
  const aspect = width / height
  const rx = aspect >= 1 ? RADIUS : RADIUS * aspect
  const ry = aspect >= 1 ? RADIUS / aspect : RADIUS

  return {
    id: 'face',
    label: '얼굴',
    outline: ellipse(rx, ry, OUTLINE_POINTS),
    anchors: [],
    hints: [],
  }
}
