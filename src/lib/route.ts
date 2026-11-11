/**
 * URL 라우팅. 서버가 내려주는 링크 형식에 맞춘다(확인한 실제 응답).
 *
 *   roomUrl  = {origin}/rooms/{roomId}
 *   hostUrl  = {origin}/rooms/{roomId}#host={hostToken}
 *
 * 방장 토큰이 fragment에 있는 것은 의도된 설계다. fragment는 서버로 전송되지 않아
 * 액세스 로그·리퍼러에 토큰이 남지 않는다. 그래서 토큰은 쿼리로 옮기지 않는다.
 */

export type Route = {
  roomId: string | null
  hostToken: string | null
}

const ROOM_PATH = /^\/rooms\/([0-9a-f-]{36})\/?$/i

export function readRoute(): Route {
  const roomId = ROOM_PATH.exec(window.location.pathname)?.[1] ?? null
  // fragment는 "#host=토큰" 형태다. URLSearchParams로 파싱하면 +가 공백이 되므로 직접 자른다.
  const hash = window.location.hash
  const hostToken = hash.startsWith('#host=') ? decodeURIComponent(hash.slice('#host='.length)) : null
  return { roomId, hostToken }
}

/**
 * 공유용 링크. 서버의 roomUrl은 API origin을 가리키므로(프론트 배포 주소를 서버가 모른다)
 * 사용자가 실제로 열 수 있는 현재 origin 기준으로 다시 만든다.
 */
export function roomLink(roomId: string): string {
  return `${window.location.origin}/rooms/${roomId}`
}

export function hostLink(roomId: string, hostToken: string): string {
  return `${roomLink(roomId)}#host=${encodeURIComponent(hostToken)}`
}

/** 방 진입. 히스토리를 남겨서 뒤로 가기가 동작하게 한다. */
export function goToRoom(roomId: string, hostToken?: string): void {
  const url = hostToken ? hostLink(roomId, hostToken) : roomLink(roomId)
  window.history.pushState(null, '', url)
}

export function goToStart(): void {
  window.history.pushState(null, '', '/')
}
