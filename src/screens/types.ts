import type { BackgroundChoice } from '../lib/relay-draw/api-client.ts'
import type { Artwork, RoomCreatedV2, RoomV2 } from '../lib/relay-draw/api-v2.ts'
import type { FlowScreen } from '../lib/relay-draw/errors.ts'
import type { Stroke } from '../draw/types.ts'

/**
 * 화면 식별자는 Figma 최종 디자인(MVP v4)의 화면 번호 그대로다.
 * API 레이어(errors.ts)의 FlowScreen과 같은 집합이라 오류 처리 결과를 바로 화면 전이에 쓴다.
 * N04L(가로 배경 참여)은 N04가 배경 비율로 알아서 바꿔 그린다.
 */
export type ScreenId = FlowScreen

/** 방장이 고른 배경. 미리보기용 URL·크기와 서버에 넘길 선택값을 같이 든다. */
export type PickedBackground = {
  choice: BackgroundChoice
  /** <img src>에 바로 쓸 URL(기본 배경은 API URL, 업로드는 object URL). */
  previewUrl: string
  width: number
  height: number
}

/** 얼굴 그리기 결과. 제출 재시도(E02)는 같은 Blob이어야 해서 여기 보관한다. */
export type DrawnFace = {
  strokes: Stroke[]
  blob: Blob
  /** 그리는 과정(획 데이터) 파일. 제출 재시도에서도 같은 Blob을 보내야 한다. */
  replay: Blob
  /** blob의 object URL. N06C·N07 미리보기용. */
  url: string
}

/** 배경 기준 캐릭터 위치(서버 좌표계와 같다). */
export type PlacementDraft = {
  x: number
  y: number
  scale: number
  /** 시계 방향 각도(도, -180~180). 서버 rotation과 같다. */
  rotation: number
}

export type FlowState = {
  // 방장
  background: PickedBackground | null
  /** N02P에서 확인 중인 사진. 사용하기를 누르면 업로드한다. */
  pendingPhoto: { file: File; url: string; width: number; height: number } | null
  title: string
  created: RoomCreatedV2 | null

  // 참여자 / 방장 관리
  room: RoomV2 | null
  nickname: string
  pick: { presetId: string; poseId: string; characterName: string } | null
  artwork: Artwork | null
  face: DrawnFace | null
  placement: PlacementDraft | null

  /** 그림 위 캐릭터 아래에 별명을 보여줄지(N04·N09·N11 토글). 화면을 오가도 유지한다. */
  showNames: boolean

  /** N10에서 고른 삭제 대상. */
  deleteTarget: { id: string; artwork: Artwork; faceUrl: string | null } | null
}

export const INITIAL_FLOW: FlowState = {
  background: null,
  pendingPhoto: null,
  title: '',
  created: null,
  room: null,
  nickname: '',
  pick: null,
  artwork: null,
  face: null,
  placement: null,
  showNames: true,
  deleteTarget: null,
}

export type Nav = (to: ScreenId) => void

export type ScreenProps = {
  nav: Nav
  flow: FlowState
  patch: (next: Partial<FlowState>) => void
  /** 화면 아래쪽 짧은 안내. */
  toast: (message: string) => void
}
