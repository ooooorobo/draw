/**
 * 브라우저 로컬 상태. 서버가 기억하지 않는 것만 여기 둔다.
 *
 * 정책(와이어프레임 POLICY 메모):
 *   - 같은 방에서 브라우저당 등록 1회
 *   - 등록 전 이탈·실패는 참여 소진 없음 → 제출 성공 시에만 기록한다
 *   - 사이트 데이터 삭제·다른 브라우저는 동일인 판별 불가 (localStorage의 한계 그대로)
 *
 * 방장 토큰은 hostUrl의 fragment(#host=)로만 전달된다. 서버 로그에 남지 않는 대신
 * 링크를 잃으면 복구할 수 없어서(복구 기능 없음), 방을 만든 브라우저에는 따로 보관한다.
 */

const REGISTERED_PREFIX = 'dp.registered.'
const HOST_TOKEN_PREFIX = 'dp.host.'
const VISITOR_KEY = 'dp.visitor'

/** localStorage는 사생활 보호 모드/용량 초과에서 던진다. 측정·편의 기능이라 조용히 넘긴다. */
function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 저장 실패가 참여를 막아선 안 된다.
  }
}

/** 이 브라우저가 해당 방에 등록을 마쳤는지. 제출 성공 후에만 true가 된다. */
export function hasRegistered(roomId: string): boolean {
  return safeGet(REGISTERED_PREFIX + roomId) !== null
}

export function markRegistered(roomId: string, characterId: string): void {
  safeSet(REGISTERED_PREFIX + roomId, characterId)
}

/** 방을 만든 브라우저에 방장 토큰을 보관한다. */
export function saveHostToken(roomId: string, token: string): void {
  safeSet(HOST_TOKEN_PREFIX + roomId, token)
}

export function loadHostToken(roomId: string): string | null {
  return safeGet(HOST_TOKEN_PREFIX + roomId)
}

/** 공유·방문 측정용 익명 식별자. 서버의 visitorId로 보낸다. */
export function visitorId(): string {
  const existing = safeGet(VISITOR_KEY)
  if (existing) return existing
  const id = crypto.randomUUID()
  safeSet(VISITOR_KEY, id)
  return id
}

/**
 * 제출 재시도용 멱등 키.
 *
 * 서버는 같은 키의 재요청을 replayed로 처리하고 등록을 한 번만 센다(확인함).
 * 그래서 키는 "재시도 묶음"마다 하나여야 하고, 등록 실패 화면에서 다시 눌러도
 * 같은 키를 보내야 한다. 호출자가 들고 다닌다.
 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID()
}
