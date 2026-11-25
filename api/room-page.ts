/**
 * 방 링크(/rooms/:id)의 OG 태그를 방 정보로 채운다.
 *
 * 카카오톡·슬랙 같은 링크 미리보기 크롤러는 JS를 실행하지 않으므로, SPA의 index.html을
 * 받아 메타 태그만 바꿔서 내려준다. 사람이 열어도 같은 HTML이라 앱 동작은 그대로다.
 * 방 조회가 실패하면(없는 방, 만료, API 장애) 공통 OG 그대로 index.html을 준다.
 */

interface RoomMeta {
  roomId: string
  title: string
  status: 'OPEN' | 'CLOSED' | 'EXPIRED'
  characterCount: number
  background?: { url?: string; width?: number; height?: number }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SITE_NAME = 'DRAWING PARTY'
// 크롤러 응답 시간이 길어지면 미리보기 자체가 실패하므로 방 조회는 짧게 끊는다.
const ROOM_TIMEOUT_MS = 2500

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const roomId = (url.searchParams.get('id') ?? '').toLowerCase()

  const [html, room] = await Promise.all([loadIndexHtml(url.origin, request), loadRoom(roomId)])
  if (html === null) {
    // index.html을 못 받으면 앱이 같은 방으로 진입하는 다른 주소로 보낸다.
    return Response.redirect(`${url.origin}/?room=${encodeURIComponent(roomId)}`, 302)
  }

  const body = room ? applyRoomMeta(html, room, url.origin) : html
  return new Response(body, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
    },
  })
}

export const HEAD = GET

async function loadIndexHtml(origin: string, request: Request): Promise<string | null> {
  try {
    // 프리뷰 배포의 Deployment Protection 쿠키를 넘겨야 자기 자신을 읽을 수 있다.
    const cookie = request.headers.get('cookie')
    const res = await fetch(`${origin}/index.html`, { headers: cookie ? { cookie } : {} })
    return res.ok ? await res.text() : null
  } catch {
    return null
  }
}

async function loadRoom(roomId: string): Promise<{ room: RoomMeta; apiOrigin: string } | null> {
  const apiOrigin = process.env.VITE_API_ORIGIN
  if (!apiOrigin || !UUID.test(roomId)) return null
  try {
    const res = await fetch(new URL(`/api/v1/rooms/${roomId}`, apiOrigin), {
      signal: AbortSignal.timeout(ROOM_TIMEOUT_MS),
    })
    if (!res.ok) return null
    return { room: (await res.json()) as RoomMeta, apiOrigin }
  } catch {
    return null
  }
}

function applyRoomMeta(html: string, { room, apiOrigin }: { room: RoomMeta; apiOrigin: string }, origin: string) {
  const title = `${room.title} | ${SITE_NAME}`
  const description = describe(room)
  const pageUrl = `${origin}/rooms/${room.roomId}`

  let out = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
  const set = (key: string, value: string) => {
    out = setMeta(out, key, value)
  }
  set('description', description)
  set('og:title', title)
  set('og:description', description)
  set('og:url', pageUrl)
  set('twitter:title', title)
  set('twitter:description', description)

  const bg = room.background
  if (bg?.url) {
    const image = new URL(bg.url, apiOrigin).href
    set('og:image', image)
    set('twitter:image', image)
    // 배경 크기를 모르면 공통 이미지의 1200×630이 남아 비율이 틀어지므로 태그를 지운다.
    if (Number.isFinite(bg.width) && Number.isFinite(bg.height)) {
      set('og:image:width', String(bg.width))
      set('og:image:height', String(bg.height))
    } else {
      out = out.replace(/\s*<meta property="og:image:(?:width|height)"[^>]*>/g, '')
    }
  }
  return out
}

function describe(room: RoomMeta): string {
  if (room.status !== 'OPEN') return '참여가 마감된 방이에요. 친구들이 완성한 그림을 구경해 보세요.'
  if (room.characterCount > 0) return `${room.characterCount}명이 함께 그리고 있어요. 내 캐릭터로 함께해요!`
  return '내 캐릭터를 그려서 친구들과 한 장면을 완성해요!'
}

function setMeta(html: string, key: string, value: string): string {
  const pattern = new RegExp(`(<meta (?:property|name)="${key.replace(/[.:]/g, '\\$&')}" content=")[^"]*(")`)
  return html.replace(pattern, (_, head: string, tail: string) => `${head}${escapeHtml(value)}${tail}`)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
