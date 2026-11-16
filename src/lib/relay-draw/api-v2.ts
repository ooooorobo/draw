/**
 * 서버 API v0.2(apiVersion=2)에서 생긴 것 중 전달받은 SDK(api-client.ts)에 아직 없는 부분.
 *
 * 출처: 서버 OpenAPI(`GET {VITE_API_ORIGIN}/docs/json`, 2026-11-16 확인).
 * SDK는 백엔드 전달 파일이라 고치지 않고 여기서 보완한다. 백엔드가 SDK를 갱신하면
 * 이 파일의 해당 부분을 지우고 SDK 메서드로 바꾼다.
 *
 * 추가된 것:
 *   - 방 생성 시 관리 비밀번호(adminPassword). 응답에 hostToken/hostUrl이 없다.
 *   - 관리 세션(POST admin/session) → adminToken(최대 1시간)
 *   - 관리용 캐릭터 목록(GET admin/characters), 일괄 삭제(POST characters/batch-delete)
 *   - Room/Scene의 managementMode·replayDurationMs, 배경 width/height, 캐릭터 artwork
 */
import {
  ApiError,
  type Asset,
  type BackgroundChoice,
  type Catalog,
  type Draft,
  type PlacedCharacter,
  type RelayDrawClient,
  type RoomSummary,
  type Scene,
} from './api-client.ts'

export type Artwork = Catalog['characters'][number]['poses'][number] & {
  faceMask?: { url: string; path: string; regionCount: number }
}

/** v0.2 배경. preset은 크기가 항상 있고, upload는 서버가 못 읽었으면 null이다. */
export type BackgroundViewV2 =
  | { type: 'preset'; presetId: string; url: string; width: number; height: number }
  | { type: 'upload'; assetId: string; url: string; width: number | null; height: number | null }

export type RoomV2 = Omit<RoomSummary, 'background'> & {
  replayDurationMs: number
  /** password = 새 방(관리 비밀번호), legacy-token = 이전 hostToken 방. */
  managementMode: 'password' | 'legacy-token'
  background: BackgroundViewV2
}

export type CharacterV2 = PlacedCharacter & { artwork: Artwork }

export type SceneV2 = Omit<Scene, 'background' | 'characters'> &
  Omit<RoomV2, keyof RoomSummary> & {
    background: BackgroundViewV2
    characters: CharacterV2[]
  }

export type CatalogV2 = Catalog & {
  replayDurationMs?: number
  backgrounds: (Catalog['backgrounds'][number] & { width: number; height: number })[]
}

export type DraftV2 = Draft & { artwork: Artwork }

export type BackgroundUploadV2 = {
  assetId: string
  uploadToken: string
  uploadExpiresAt: string
  width: number
  height: number
}

/** 비밀번호 방은 hostToken/hostUrl이 오지 않는다. 공유는 roomUrl 하나뿐이다. */
export type RoomCreatedV2 = {
  roomId: string
  title: string
  roomUrl: string
  hostToken?: string
  hostUrl?: string
  createdAt: string
  closesAt: string
  expiresAt: string
}

export type AdminSession = { adminToken: string; expiresAt: string }

/** 관리 화면(N10) 캐릭터. bodyImageUrl + faceImage로 썸네일을 그린다. */
export type AdminCharacter = CharacterV2 & {
  bodyImageUrl: string | null
  faceImage: Pick<Asset, 'id' | 'kind' | 'mime' | 'size' | 'url'> | null
}

export const ADMIN_PASSWORD_MIN = 8
export const ADMIN_PASSWORD_MAX = 64
export const TITLE_MAX = 80
export const NICKNAME_MAX = 10

/** SDK의 private json()과 같은 동작. 오류 본문 {code, message}를 ApiError로 바꾼다. */
async function request<T>(api: RelayDrawClient, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(api.url(path), init)
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(res.status, data?.code ?? 'HTTP_ERROR', data?.message ?? `HTTP ${res.status}`)
  }
  return data as T
}

const room = (roomId: string) => `/api/v1/rooms/${encodeURIComponent(roomId)}`

export function createRoomWithPassword(
  api: RelayDrawClient,
  input: { title: string; background: BackgroundChoice; adminPassword: string; sourceRoomId?: string },
): Promise<RoomCreatedV2> {
  return request(api, '/api/v1/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function openAdminSession(api: RelayDrawClient, roomId: string, password: string): Promise<AdminSession> {
  return request(api, `${room(roomId)}/admin/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  })
}

export function listAdminCharacters(
  api: RelayDrawClient,
  roomId: string,
  adminToken: string,
  signal?: AbortSignal,
): Promise<{ roomId: string; version: number; characters: AdminCharacter[] }> {
  return request(api, `${room(roomId)}/admin/characters`, {
    headers: { authorization: `Bearer ${adminToken}` },
    signal,
  })
}

export function batchDeleteCharacters(
  api: RelayDrawClient,
  roomId: string,
  characterIds: string[],
  adminToken: string,
): Promise<{ deletedCharacterIds: string[]; version: number }> {
  return request(api, `${room(roomId)}/characters/batch-delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ characterIds }),
  })
}
