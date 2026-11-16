/**
 * 브라우저에 남기는 클라이언트 상태.
 *
 * 서버 지침: "토큰은 최초 생성 응답에서 보관하고 URL·공유 링크에 넣지 마세요."
 * 그래서 토큰은 전부 여기(localStorage/sessionStorage)에만 둔다.
 *
 *   - 참여 기록(방별): DRAFT 토큰, 제출 Idempotency-Key, 제출 완료 여부
 *   - 관리 세션(방별): adminToken은 최대 1시간이라 sessionStorage에 둔다
 *   - 내가 만든 방(방별): N03 재진입·공유용 roomUrl
 *   - 방문자 ID: 이벤트 측정용 익명 ID
 *
 * 관리 비밀번호 자체는 저장하지 않는다.
 */
import type { Placement } from './api-client.ts'
import type { AdminSession, DraftV2, RoomCreatedV2 } from './api-v2.ts'

const PREFIX = 'relay-draw:v1:'

function read<T>(store: Storage, key: string): T | null {
  try {
    const raw = store.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(store: Storage, key: string, value: unknown) {
  try {
    if (value === null) store.removeItem(PREFIX + key)
    else store.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // 사파리 비공개 모드 등 저장 불가. 이번 탭 흐름은 메모리 상태로 계속된다.
  }
}

/** 방 하나에 대한 내 참여 기록. */
export type Participation = {
  roomId: string
  nickname: string
  presetId: string
  poseId: string
  draft: DraftV2
  /** 제출 재시도는 같은 키·같은 파일·같은 metadata여야 한다. 첫 제출 시도 때 고정한다. */
  idempotencyKey?: string
  placement?: Placement
  /** 제출 성공 시각. 제출 재시도(E02)와 DRAFT 재사용 판단에 쓴다. */
  submittedAt?: string
}

export const participationStore = {
  get: (roomId: string) => read<Participation>(localStorage, `participation:${roomId}`),
  set: (p: Participation) => write(localStorage, `participation:${p.roomId}`, p),
  clear: (roomId: string) => write(localStorage, `participation:${roomId}`, null),
}

export const adminSessionStore = {
  /** 만료 30초 전부터는 없는 것으로 본다. */
  get(roomId: string): AdminSession | null {
    const s = read<AdminSession>(sessionStorage, `admin:${roomId}`)
    if (!s) return null
    if (Date.parse(s.expiresAt) - Date.now() < 30_000) {
      write(sessionStorage, `admin:${roomId}`, null)
      return null
    }
    return s
  },
  set: (roomId: string, s: AdminSession) => write(sessionStorage, `admin:${roomId}`, s),
  clear: (roomId: string) => write(sessionStorage, `admin:${roomId}`, null),
}

export const createdRoomStore = {
  get: (roomId: string) => read<RoomCreatedV2>(localStorage, `created:${roomId}`),
  set: (r: RoomCreatedV2) => write(localStorage, `created:${r.roomId}`, r),
}

/** 이벤트 측정용 익명 ID(최대 64자). 한 번 만들면 유지한다. */
export function visitorId(): string {
  const existing = read<string>(localStorage, 'visitor')
  if (existing) return existing
  const id = crypto.randomUUID()
  write(localStorage, 'visitor', id)
  return id
}
