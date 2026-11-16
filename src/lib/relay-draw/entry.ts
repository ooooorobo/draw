/**
 * 앱 진입 시 첫 화면 결정.
 *
 *   URL에 방 ID 없음        → N01 (방장 시작)
 *   방 ID 형식 오류·없는 방  → E03
 *   만료 방(410)            → E03 (디자인에 만료 화면 없음)
 *   CLOSED                  → N11
 *   OPEN                    → N04 (배경이 가로면 N04L)
 *
 * 이미 참여한 브라우저도 N04에서 시작한다(추가 캐릭터 참여 허용).
 *
 * 공유 링크 형식(roomUrl)은 서버가 만든다. 실제 형식을 확인하지 못해서
 * 쿼리(?room=), 경로(/r/:id, /rooms/:id), 해시 어디에 있든 UUID를 찾는다.
 */
import { getApi } from './client.ts'
import type { RoomV2 } from './api-v2.ts'
import { onLoadError } from './errors.ts'
import { participationStore, type Participation } from './storage.ts'
import { isLandscape } from './screens.ts'

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

export type RoomRef = { roomId: string } | { invalid: true } | null

/** 현재 주소에서 방 ID를 꺼낸다. 방 관련 표시(room 파라미터, /r/ 경로)는 있는데 UUID가 아니면 invalid. */
export function parseRoomRef(href: string = window.location.href): RoomRef {
  const url = new URL(href)
  const candidates = [
    url.searchParams.get('room'),
    url.searchParams.get('roomId'),
    url.pathname.match(/\/(?:r|rooms?)\/([^/]+)/)?.[1] ?? null,
    url.hash.replace(/^#\/?/, '') || null,
  ]
  for (const c of candidates) {
    if (!c) continue
    const m = decodeURIComponent(c).match(UUID)
    if (m) return { roomId: m[0].toLowerCase() }
  }
  return candidates.some(Boolean) ? { invalid: true } : null
}

/** 공유용 링크. 서버 roomUrl을 그대로 쓰는 게 원칙이고, 없을 때만 현재 origin으로 만든다. */
export function roomLink(roomId: string, roomUrl?: string): string {
  return roomUrl ?? `${window.location.origin}/?room=${roomId}`
}

export type Entry =
  | { screen: 'N01' }
  | { screen: 'E03' }
  | { screen: 'N11'; room: RoomV2 }
  | { screen: 'N04' | 'N04L'; room: RoomV2; participation: Participation | null }
  /** 네트워크·5xx. 화면은 그대로 두고 재시도 버튼을 보여준다. */
  | { screen: null; retryMessage: string }

export async function resolveEntry(href?: string, signal?: AbortSignal): Promise<Entry> {
  const ref = parseRoomRef(href)
  if (ref === null) return { screen: 'N01' }
  if ('invalid' in ref) return { screen: 'E03' }

  let room: RoomV2
  try {
    room = (await getApi().room(ref.roomId, signal)) as unknown as RoomV2
  } catch (error) {
    const action = onLoadError(error)
    // 방 조회 단계의 goto는 없는 방·형식 오류·만료뿐이다(CLOSED 방은 200으로 온다).
    if (action.kind === 'goto') return { screen: 'E03' }
    return { screen: null, retryMessage: action.message }
  }

  if (room.status !== 'OPEN') return { screen: 'N11', room }

  // 이전 참여 기록이 있으면 넘긴다(별명 미리 채우기).
  const participation = participationStore.get(room.roomId)
  const screen = isLandscape(room.background) ? 'N04L' : 'N04'
  return { screen, room, participation }
}
