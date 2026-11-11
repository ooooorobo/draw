/**
 * 확정 와이어프레임(Figma `MVP v3 흐름별 화면`)의 화면 식별자와 화면 간 공유 상태.
 *
 * 와이어프레임(375×812)의 화면 번호를 그대로 식별자로 쓴다.
 *
 * 확정본이 정한 정책 3가지:
 *   - 추가 캐릭터 참여 허용 (브라우저당 1회 제한 없음)
 *   - 공통 링크 + 관리 비밀번호 (별도 관리 링크 없음)
 *   - 일주일 후 자동 종료 (서버도 생성 7일 뒤 참여 종료로 일치)
 */
import type { Spot } from '../lib/placement.ts'
import type {
  BackgroundChoice,
  Catalog,
  Draft,
  PlacedCharacter,
  RelayDrawClient,
  RoomCreated,
} from '../lib/relay-draw/client.ts'

export type ScreenId =
  // 방장 01 — 방 만들기
  | 'N01'
  | 'N02'
  | 'N02P'
  | 'N03'
  | 'N03D'
  // 참여자 01 — 최초 참여
  | 'N04'
  | 'N04L'
  | 'N05'
  | 'N06'
  | 'N06C'
  | 'N07'
  | 'N09'
  // 후속 검토 — 관리와 재방문
  | 'N04M'
  | 'N10'
  | 'N10C'
  | 'N09R'
  | 'N11'
  // 예외 상태
  | 'E01'
  | 'E02'
  | 'E03'
  | 'E04'

/** 방 제목 입력 상한. 확정 와이어프레임 N03의 "방 제목 최대 14자까지 입력". */
export const TITLE_MAX = 14

/** 별명 입력 상한. 서버 제약(CreateCharacter.nickname)이 10자다. */
export const NICKNAME_MAX = 10

/**
 * 남은 시간을 "6일 12시간" 형태로. 확정 와이어프레임의 "종료까지 6일 12시간" 표기다.
 *
 * 서버가 closesAt(참여 종료)과 expiresAt(보관 종료)을 따로 준다. 화면이 쓰는 것은 closesAt이다.
 */
export function remainingLabel(closesAt: string, now: number = Date.now()): string {
  const left = new Date(closesAt).getTime() - now
  if (!Number.isFinite(left) || left <= 0) return '종료됨'
  const hours = Math.floor(left / 3_600_000)
  const days = Math.floor(hours / 24)
  return days > 0 ? `${days}일 ${hours % 24}시간` : `${hours}시간`
}

/** 업로드한 사진 배경. 확인 화면(N02P)에서 미리보기와 선택 확정에 쓴다. */
export type PendingUpload = {
  assetId: string
  uploadToken: string
  /** 로컬 미리보기 URL(createObjectURL). 서버 왕복 없이 바로 보여준다. */
  previewUrl: string
}

export type FlowState = {
  // 방 만들기(N02 배경 → N03 제목·비밀번호)
  roomTitle: string
  /**
   * 방장 관리 비밀번호(N03 입력).
   *
   * 확정 설계는 "공통 링크 + 관리 비밀번호"지만 서버 API(v0.2.0)에 비밀번호가 없다.
   * POST /rooms는 {title, background, sourceRoomId}만 받고, 관리 권한은 hostToken으로만
   * 확인한다. 그래서 이 값은 화면 간 전달에만 쓰고 서버로 보내지 않으며, 저장도 하지 않는다.
   * 실제 인가는 hostToken이 한다. 서버가 비밀번호를 지원하면 이 값이 그 자리에 들어간다.
   */
  managePassword: string
  /** 서버에 보낼 배경 선택. presetId는 카탈로그가 주는 문자열(park/beach/...). */
  background: BackgroundChoice | null
  /** 배경 미리보기 URL. preset은 카탈로그 url, upload는 로컬 objectURL. */
  backgroundUrl: string | null
  upload: PendingUpload | null

  // 방 생성 결과(N03) — hostToken은 이 응답에만 들어있다.
  created: RoomCreated | null

  // 참여(N04~N09)
  roomId: string | null
  hostToken: string | null
  nickname: string
  presetId: string | null
  poseId: string | null
  /** 캐릭터 생성 응답. characterToken이 제출 인증에 쓰인다. */
  draft: Draft | null
  /** 그린 얼굴과 획 데이터. 제출 재시도에서 같은 파일을 다시 보내야 해서 들고 있는다. */
  face: Blob | null
  replay: Blob | null
  /**
   * 배경 위 배치(N07). 등록 실패(E02)에서 배치 화면으로 돌아올 때 같은 자리를 복원해야 해서
   * 화면 로컬 상태가 아니라 흐름 상태로 들고 있는다.
   */
  placement: Spot | null
  /**
   * 제출 멱등 키. 재시도에도 같은 키를 보내야 등록이 1회로 유지된다.
   * (서버 확인: 같은 키 재요청은 replayed=true, version 그대로)
   */
  idempotencyKey: string | null

  /** 삭제 확인(N10C) 대상. 방장 관리(N10)에서 고른 캐릭터다. */
  pendingDelete: { id: string; nickname: string } | null

  /** 마지막 오류. 예외 화면이 서버 메시지를 그대로 보여준다. */
  lastError: string | null
}

export const INITIAL_FLOW: FlowState = {
  roomTitle: '',
  managePassword: '',
  background: null,
  backgroundUrl: null,
  upload: null,
  created: null,
  roomId: null,
  hostToken: null,
  nickname: '',
  presetId: null,
  poseId: null,
  draft: null,
  face: null,
  replay: null,
  placement: null,
  idempotencyKey: null,
  pendingDelete: null,
  lastError: null,
}

/** 카탈로그에서 presetId로 배경 이름을 찾는다. */
export function backgroundName(catalog: Catalog | null, presetId: string): string {
  return catalog?.backgrounds.find((b) => b.id === presetId)?.name ?? presetId
}

export type Pose = Catalog['characters'][number]['poses'][number]

/** 포즈 하나와 그것이 속한 캐릭터 프리셋. 제출에는 두 ID가 모두 필요하다. */
export type PoseChoice = { presetId: string; pose: Pose }

/** 고른 캐릭터·포즈를 카탈로그에서 찾는다. 둘 중 하나라도 안 맞으면 null. */
export function findPose(
  catalog: Catalog,
  presetId: string | null,
  poseId: string | null,
): PoseChoice | null {
  const character = catalog.characters.find((c) => c.id === presetId)
  const pose = character?.poses.find((p) => p.id === poseId)
  return character && pose ? { presetId: character.id, pose } : null
}

/** 카탈로그의 첫 포즈. 선택을 건너뛴 상태(개발용 화면 이동)에서도 화면이 보이게 한다. */
export function firstPose(catalog: Catalog): PoseChoice | null {
  for (const character of catalog.characters) {
    const pose = character.poses[0]
    if (pose) return { presetId: character.id, pose }
  }
  return null
}

/** 배경 위에 그릴 캐릭터 하나. PlacedSprite가 그대로 받는 형태다. */
export type SpriteView = {
  /** React key로 쓰는 캐릭터 id. 배치 중인 내 캐릭터는 아직 서버 id가 없다. */
  id: string
  poseUrl: string
  faceUrl: string | null
  faceRect: Pose['faceRect']
  canvas: Pose['canvas']
  x: number
  y: number
  scale: number
  rotation: number
  zIndex: number
}

/**
 * 서버 장면을 그릴 수 있는 형태로 바꾼다.
 * 카탈로그 조회와 상대 URL 조립(api.url)을 화면에서 걷어낸다.
 */
export function sceneSprites(
  api: RelayDrawClient,
  catalog: Catalog,
  characters: PlacedCharacter[],
): SpriteView[] {
  return characters.flatMap((character) => {
    const found = findPose(catalog, character.presetId, character.poseId)
    // 카탈로그에 없는 프리셋(에셋 버전이 올라간 경우)은 그릴 방법이 없다.
    if (!found) return []
    const face = character.assets.find((asset) => asset.kind === 'face')
    const sprite: SpriteView = {
      id: character.id,
      poseUrl: api.url(found.pose.url),
      faceUrl: face ? api.url(face.url) : null,
      faceRect: found.pose.faceRect,
      canvas: found.pose.canvas,
      x: character.x,
      y: character.y,
      scale: character.scale,
      rotation: character.rotation,
      zIndex: character.zIndex,
    }
    return [sprite]
  })
}

export type Nav = (to: ScreenId) => void

export type ScreenProps = {
  nav: Nav
  flow: FlowState
  patch: (next: Partial<FlowState>) => void
}
