/**
 * 화면별 API 호출. 화면 컴포넌트는 SDK 대신 이 함수들을 부른다.
 *
 * 화면 ID는 Figma 최종 디자인(MVP v4) 기준. 각 함수 주석에 호출 화면과 성공 시 다음 화면을 적는다.
 * 실패 처리는 errors.ts의 on*Error로 화면 전이를 정한다.
 */
import { ApiError, type BackgroundChoice, type Placement } from './api-client.ts'
import {
  batchDeleteCharacters,
  createRoomWithPassword,
  listAdminCharacters,
  openAdminSession,
  type AdminCharacter,
  type Artwork,
  type BackgroundUploadV2,
  type BackgroundViewV2,
  type CatalogV2,
  type DraftV2,
  type RoomCreatedV2,
  type RoomV2,
  type SceneV2,
} from './api-v2.ts'
import { getApi } from './client.ts'
import { adminSessionStore, createdRoomStore, participationStore, visitorId, type Participation } from './storage.ts'

// ─── 공통 ───────────────────────────────────────────────────────────

/** API가 주는 상대 경로(/api/v1/...)를 <img src>에 쓸 절대 URL로 바꾼다. */
export function assetUrl(path: string): string {
  return getApi().url(path)
}

/** 가로 배경이면 N04L/N07 가로 레이아웃. 업로드 배경 크기를 서버가 못 읽었으면(null) 세로로 본다. */
export function isLandscape(bg: Pick<BackgroundViewV2, 'width' | 'height'>): boolean {
  return bg.width != null && bg.height != null && bg.width > bg.height
}

/**
 * "종료까지 6일 12시간" 문구. 기기 시계가 틀려도 맞도록 serverNow 기준으로 계산한다.
 * fetchedAt은 room/scene 응답을 받은 시각(Date.now()).
 */
export function remainingLabel(room: Pick<RoomV2, 'closesAt' | 'serverNow'>, fetchedAt: number, now = Date.now()): string {
  const serverNow = Date.parse(room.serverNow) + (now - fetchedAt)
  const ms = Math.max(0, Date.parse(room.closesAt) - serverNow)
  const minutes = Math.floor(ms / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return `${days}일 ${hours}시간`
  if (hours > 0) return `${hours}시간 ${minutes % 60}분`
  return `${minutes % 60}분`
}

/** 카탈로그는 앱 수명 동안 바뀌지 않는다고 보고 한 번만 받는다. */
let catalogPromise: Promise<CatalogV2> | null = null
export function loadCatalog(): Promise<CatalogV2> {
  catalogPromise ??= (getApi().catalog() as Promise<CatalogV2>).catch((error) => {
    catalogPromise = null
    throw error
  })
  return catalogPromise
}

export function loadRoom(roomId: string, signal?: AbortSignal): Promise<RoomV2> {
  return getApi().room(roomId, signal) as unknown as Promise<RoomV2>
}

/** N04 N04L N07 N09 N09R N10 N11 — 배경 + PLACED 캐릭터(zIndex 오름차순). 2~3초 폴링은 hooks.ts. */
export function loadScene(roomId: string, signal?: AbortSignal): Promise<SceneV2> {
  return getApi().scene(roomId, signal) as unknown as Promise<SceneV2>
}

/** 측정 이벤트. 실패해도 화면 흐름에 영향 없게 삼킨다. */
export function track(roomId: string, type: 'share_click' | 'link_visit' | 'result_view' | 'room_conversion', channel?: string) {
  getApi()
    .event({ roomId, type, visitorId: visitorId(), channel })
    .catch(() => {})
}

// ─── 방장: N01 → N02 (→ N02P) → N03 ───────────────────────────────────

/** 기본 배경 하나. v0.2 카탈로그는 width/height를 준다(SDK 타입에는 아직 없다). */
export type BackgroundOption = { id: string; name: string; url: string; width: number; height: number }

/** N02 — 기본 배경 목록. catalog.backgrounds[].{id,name,url,width,height} */
export async function loadBackgrounds(): Promise<BackgroundOption[]> {
  return (await loadCatalog()).backgrounds as BackgroundOption[]
}

/**
 * N02P "이 배경 사용" — 사진 업로드. PNG·JPEG·WebP, 10MiB 이하. HEIC 변환은 프론트 몫.
 * 반환값으로 BackgroundChoice를 만들어 createRoom에 넘긴다. uploadToken은 1시간 유효.
 * 실패 → onUploadError (E01)
 */
export async function uploadBackground(file: Blob): Promise<{ upload: BackgroundUploadV2; choice: BackgroundChoice }> {
  const upload = (await getApi().uploadBackground(file)) as BackgroundUploadV2
  return { upload, choice: { type: 'upload', assetId: upload.assetId, uploadToken: upload.uploadToken } }
}

/**
 * N02 "방 만들기" → N03. 제목 1~80자, 관리 비밀번호 8~64자.
 * 서버 지침상 중복 재시도 금지 — 버튼을 잠그고 한 번만 부른다.
 * 실패 → onCreateRoomError
 */
export async function createRoom(input: {
  title: string
  background: BackgroundChoice
  adminPassword: string
}): Promise<RoomCreatedV2> {
  const created = await createRoomWithPassword(getApi(), input)
  createdRoomStore.set(created)
  return created
}

/**
 * N03 "링크 복사"/"공유하기". Web Share가 있으면 공유 시트, 없으면 클립보드.
 * 공유 문구는 서버(share.message)를 쓴다. 반환: 실제로 한 동작.
 */
export async function shareRoom(roomId: string, roomUrl: string, mode: 'copy' | 'share'): Promise<'shared' | 'copied' | 'cancelled'> {
  track(roomId, 'share_click', mode)
  if (mode === 'share' && navigator.share) {
    const text = await getApi()
      .share(roomId)
      .then((s) => s.message)
      .catch(() => undefined)
    try {
      await navigator.share({ url: roomUrl, text })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
      // 공유 시트 실패 시 복사로 대체한다.
    }
  }
  await navigator.clipboard.writeText(roomUrl)
  return 'copied'
}

// ─── 참여자: N04/N04L → N05 → N06 → N06C → N07 → N09 ─────────────────

/** N04/N04L 진입 시 1회. */
export function trackVisit(roomId: string) {
  track(roomId, 'link_visit')
}

/** N05 — 캐릭터 8종 × 포즈 3~4개. pose.url은 몸 원화 PNG, canvas 200×200 기준 faceRect/faceMask. */
export async function loadCharacters() {
  return (await loadCatalog()).characters
}

/** N06 — 고른 포즈의 원화(얼굴 템플릿·마스크). DRAFT를 만들기 전이라 카탈로그에서 찾는다. */
export async function findArtwork(presetId: string, poseId: string): Promise<Artwork | null> {
  const character = (await loadCatalog()).characters.find((c) => c.id === presetId)
  return (character?.poses.find((p) => p.id === poseId) as Artwork | undefined) ?? null
}

/**
 * N06C "확정" → N07. 캐릭터 DRAFT 생성. 호출할 때마다 새 DRAFT가 생기므로 한 번만 부른다.
 * 같은 방·같은 캐릭터·포즈의 미제출 DRAFT가 이미 있으면 재사용한다(새로고침 대비).
 * 닉네임 1~10자(선택). 실패 → onCreateCharacterError
 */
export async function confirmCharacter(
  roomId: string,
  input: { nickname: string; presetId: string; poseId: string },
): Promise<Participation> {
  const nickname = input.nickname.trim()
  const existing = participationStore.get(roomId)
  // 닉네임·캐릭터·포즈는 DRAFT 생성 때 고정된다. 하나라도 바뀌었으면 새로 만든다.
  if (
    existing &&
    !existing.submittedAt &&
    existing.nickname === nickname &&
    existing.presetId === input.presetId &&
    existing.poseId === input.poseId &&
    Date.parse(existing.draft.closesAt) > Date.now()
  ) {
    return existing
  }
  const draft = (await getApi().createCharacter(roomId, {
    nickname: nickname || undefined,
    presetId: input.presetId,
    poseId: input.poseId,
  })) as DraftV2
  const participation: Participation = { roomId, nickname, presetId: input.presetId, poseId: input.poseId, draft }
  participationStore.set(participation)
  return participation
}

/**
 * N07 "등록하기" → N09. 얼굴 파일 + (선택) 재생 데이터 + 배치 제출.
 *
 * 좌표(서버 문서): x·y = 배경 사각형 기준 캐릭터 중심 비율(0~1), scale = 배경 너비 대비 캐릭터 너비 비율
 * (0.05~1), rotation = 도(-180~180). zIndex는 서버가 정한다.
 *
 * 재시도(E02 "다시 등록")는 같은 파일·MIME·metadata·Idempotency-Key여야 한다.
 * 그래서 첫 시도의 키와 placement를 저장해 두고, 재시도에서는 저장된 placement를 쓴다.
 * face/replay Blob은 호출자가 같은 것을 다시 넘겨야 한다(메모리 보관).
 * 실패 → onSubmitError (E02 / N11 / E03)
 */
export async function submitPlacement(
  roomId: string,
  files: { face: Blob; replay?: Blob },
  placement: Placement,
): Promise<{ version: number; replayed: boolean }> {
  const participation = participationStore.get(roomId)
  if (!participation) throw new Error('캐릭터 확정(N06C) 없이 제출할 수 없다.')
  if (!participation.idempotencyKey) {
    participation.idempotencyKey = crypto.randomUUID()
    participation.placement = placement
    participationStore.set(participation)
  }
  const result = await getApi().submit(
    participation.draft,
    files.face,
    participation.placement ?? placement,
    participation.idempotencyKey,
    files.replay,
  )
  participationStore.set({ ...participation, submittedAt: new Date().toISOString() })
  return { version: result.version, replayed: result.replayed }
}

/**
 * E02 → N07 "배치로 돌아가기"로 위치를 바꾸고 싶을 때. 저장된 키·위치를 버린다.
 * 서버에 이미 반영된 첫 요청이 있었다면 409(제출 불변)가 날 수 있다 — 그때는 N09로 보낸다.
 */
export function resetSubmission(roomId: string) {
  const p = participationStore.get(roomId)
  if (p && !p.submittedAt) participationStore.set({ ...p, idempotencyKey: undefined, placement: undefined })
}

/** DrawCell의 SubmitResult.png(data URL)를 업로드용 Blob으로. */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob()
}

/** 그리는 과정(획 데이터)을 재생 데이터 파일로. 서버는 원본 그대로 저장하고 scene의 mime으로 돌려준다. */
export function replayBlob(strokes: unknown): Blob {
  return new Blob([JSON.stringify({ format: 'relay-draw-strokes', version: 1, strokes })], { type: 'application/json' })
}

// ─── 재방문·결과: N09 / N09R / N11 ───────────────────────────────────

/** 내 캐릭터(N09/N09R 강조용). scene.characters에서 draft.characterId로 찾는다. */
export function myCharacterId(roomId: string): string | null {
  return participationStore.get(roomId)?.draft.characterId ?? null
}

/** N11 진입 시 1회. */
export function trackResultView(roomId: string) {
  track(roomId, 'result_view')
}

/**
 * N09/N09R/N11 "이미지 저장" 후 결과 파일 서버 보관(선택). 서버는 합성하지 않는다 — 프론트가 합성한 PNG/GIF.
 * version은 합성에 쓴 scene.version. 그 사이 장면이 바뀌면 409 SCENE_CHANGED → scene 다시 받아 재합성.
 * 같은 버전에 이미 있으면 409 RESULT_EXISTS → 성공으로 취급.
 */
export async function saveResult(roomId: string, sceneVersion: number, files: { image?: Blob; animation?: Blob }) {
  try {
    return await getApi().saveResult(roomId, sceneVersion, files)
  } catch (error) {
    if (error instanceof ApiError && error.code === 'RESULT_EXISTS') return null
    throw error
  }
}

/** 이미지 파일 내려받기(브라우저 저장). */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ─── 방 관리: N04 "방 관리" → N04M → N10 → N10C ─────────────────────

/** N04M 진입 시: 유효한 세션이 이미 있으면 바로 N10. */
export function hasAdminSession(roomId: string): boolean {
  return adminSessionStore.get(roomId) !== null
}

/** N04M "확인" → N10. 실패 → onAdminAuthError (틀림은 inline). */
export async function authenticateAdmin(roomId: string, password: string) {
  const session = await openAdminSession(getApi(), roomId, password)
  adminSessionStore.set(roomId, session)
  return session
}

function adminToken(roomId: string): string {
  const s = adminSessionStore.get(roomId)
  if (!s) {
    // onAdminError가 N04M으로 보내도록 403 모양으로 던진다.
    throw new ApiError(403, 'ADMIN_SESSION_MISSING', '관리 세션이 만료됐어요.')
  }
  return s.adminToken
}

/** N10 — 삭제 선택용 목록(PLACED만). 썸네일: bodyImageUrl + faceImage. 실패 → onAdminError */
export async function loadAdminCharacters(roomId: string, signal?: AbortSignal): Promise<AdminCharacter[]> {
  return (await listAdminCharacters(getApi(), roomId, adminToken(roomId), signal)).characters
}

/** N10C "삭제" → N10. OPEN 기간에만 가능. 실패 → onAdminError */
export async function deleteCharacters(roomId: string, characterIds: string[]) {
  return batchDeleteCharacters(getApi(), roomId, characterIds, adminToken(roomId))
}
