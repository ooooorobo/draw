/**
 * MVP v3 와이어프레임의 화면 식별자와 화면 간 공유 상태.
 *
 * 와이어프레임(375×812)의 화면 번호를 그대로 식별자로 쓴다.
 * 서버/API는 범위 밖이라 모든 상태는 세션 메모리에만 있다.
 */

export type ScreenId =
  // 방장 01 — 방 만들기
  | 'N01'
  | 'N02'
  | 'N02P'
  | 'N03'
  // 참여자 01 — 최초 참여
  | 'N04'
  | 'N05'
  | 'N06'
  | 'N07'
  | 'N09'
  // 후속 검토 — 관리와 재방문
  | 'N10'
  | 'N10C'
  | 'N09R'
  | 'N11'
  // 예외 상태
  | 'E01'
  | 'E02'
  | 'E03'
  | 'E04'

/** 개발용 화면 이동 목록. 예외 화면은 API 없이는 도달 경로가 없어서 여기서만 열린다. */
export const SCREEN_LIST: { id: ScreenId; label: string }[] = [
  { id: 'N01', label: '시작' },
  { id: 'N02', label: '방 만들기' },
  { id: 'N02P', label: '업로드 배경 확인' },
  { id: 'N03', label: '방 생성 완료' },
  { id: 'N04', label: '참여 시작' },
  { id: 'N05', label: '캐릭터 선택' },
  { id: 'N06', label: '얼굴 그리기' },
  { id: 'N07', label: '배치' },
  { id: 'N09', label: '등록 완료' },
  { id: 'N10', label: '방장 관리' },
  { id: 'N10C', label: '종료 확인' },
  { id: 'N09R', label: '참여 완료자 재접속' },
  { id: 'N11', label: '종료 결과' },
  { id: 'E01', label: '배경 업로드 실패' },
  { id: 'E02', label: '등록 실패' },
  { id: 'E03', label: '잘못된 참여 링크' },
  { id: 'E04', label: '관리 링크 오류' },
]

/** 기본 배경 4종 또는 업로드 사진. 규격·크롭은 와이어프레임에서 미정. */
export type Background = { kind: 'preset'; id: number } | { kind: 'photo' }

export function describeBackground(background: Background | null): string {
  if (!background) return '배경 미선택'
  return background.kind === 'preset' ? `배경 ${background.id}` : '업로드 사진'
}

/** 선택한 캐릭터 칸. 칸 내용(포즈 이미지)은 비워둔 상태다. */
export type CharacterPick = { group: number; pose: number }

export type FlowState = {
  roomTitle: string
  background: Background | null
  nickname: string
  character: CharacterPick | null
  /** 얼굴 그리기 결과. 배치 화면은 미구현이라 아직 소비하지 않는다. */
  drawn: boolean
}

export const INITIAL_FLOW: FlowState = {
  roomTitle: '',
  background: null,
  nickname: '',
  character: null,
  drawn: false,
}

export type Nav = (to: ScreenId) => void

export type ScreenProps = {
  nav: Nav
  flow: FlowState
  patch: (next: Partial<FlowState>) => void
}
