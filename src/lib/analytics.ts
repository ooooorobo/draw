/**
 * GA4 측정. GTM(index.html)이 Google 태그(gtag.js)를 띄우고, 여기서 gtag('event')로 보낸 이벤트를
 * 그 Google 태그가 그대로 GA4로 보낸다. 그래서 GTM에 이벤트별 트리거·태그를 만들 필요가 없다.
 *
 * 화면이 바뀌어도 주소가 그대로인 앱이라 화면 조회는 page_view를 직접 보낸다.
 * 주소에는 방 ID(/r/<uuid>)가 들어 있으므로 page_location을 /screen/<화면ID>로 바꿔 보낸다.
 * (GTM Google 태그의 자동 page_view는 꺼야 한다: send_page_view = false)
 *
 * 방 ID·별명·비밀번호 같은 식별·개인 정보는 보내지 않는다.
 *
 * 광고 유입(UTM): GA4는 세션 첫 page_view의 page_location 쿼리에서 utm_*을 읽어 유입 경로를 정한다.
 * page_location을 바꿔 보내므로, 첫 화면 조회에는 진입 주소의 utm_* 쿼리를 붙여 그대로 넘긴다.
 * 또 화면이 바뀌거나 주소가 방 링크로 바뀌어도(N03 pushState) 남도록 sessionStorage에 저장해 두고,
 * room_create 등 핵심 이벤트에 entry_* 매개변수로 함께 싣는다.
 */

type Params = Record<string, string | number | boolean | undefined>

function debugEnabled() {
  try {
    return localStorage.getItem('ga-debug') === '1'
  } catch {
    return false
  }
}

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
  }
}

function send(event: string, params: Params) {
  // 로컬 개발(vite dev)에서는 보내지 않는다. 팀원 개발 중 클릭이 실제 지표에 섞이지 않게.
  // 개발 중에 보는 법: 브라우저 콘솔에서 localStorage.setItem('ga-debug', '1') 후 새로고침.
  if (import.meta.env.DEV && !debugEnabled()) return
  try {
    window.gtag?.('event', event, params)
  } catch {
    // 측정 실패가 앱 동작을 막으면 안 된다.
  }
}

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const
const UTM_STORAGE = 'utm'
type Utm = Partial<Record<(typeof UTM_KEYS)[number], string>>

/** 이번 페이지 진입 주소의 utm_* 쿼리. */
function utmFromUrl(): Utm {
  const params = new URLSearchParams(window.location.search)
  const utm: Utm = {}
  for (const key of UTM_KEYS) {
    const value = params.get(key)
    if (value) utm[key] = value.slice(0, 100)
  }
  return utm
}

/** 진입 주소의 utm (모듈 로드 시점 = 첫 진입, pushState 전). */
const landingUtm = utmFromUrl()

/** 세션 동안 유지할 utm. 새 utm으로 들어오면 덮어쓰고, 없으면 이전 값을 쓴다. */
const sessionUtm: Utm = (() => {
  try {
    if (Object.keys(landingUtm).length > 0) {
      sessionStorage.setItem(UTM_STORAGE, JSON.stringify(landingUtm))
      return landingUtm
    }
    return JSON.parse(sessionStorage.getItem(UTM_STORAGE) ?? '{}') as Utm
  } catch {
    return landingUtm
  }
})()

/** 이벤트에 싣는 유입 정보. 값이 없으면 키도 보내지 않는다. */
function entryParams(): Params {
  return {
    entry_source: sessionUtm.utm_source,
    entry_medium: sessionUtm.utm_medium,
    entry_campaign: sessionUtm.utm_campaign,
    entry_content: sessionUtm.utm_content,
  }
}

let firstPageView = true

/** 화면 조회. id는 Figma 화면 번호(N04 등), name은 사람이 읽는 이름. */
export function trackScreen(id: string, name: string) {
  // 첫 화면 조회에만 진입 utm을 붙인다. GA4가 이걸로 세션의 소스/매체/캠페인을 잡는다.
  const query = firstPageView ? new URLSearchParams(landingUtm).toString() : ''
  firstPageView = false
  send('page_view', {
    page_title: `${id} ${name}`,
    page_location: `${window.location.origin}/screen/${id}${query ? `?${query}` : ''}`,
    screen_id: id,
  })
}

/** 퍼널 이벤트. 이름과 매개변수는 GA4 보고서에 그대로 나온다. */
export const track = {
  /** 방 생성 완료. */
  roomCreate: (backgroundType: 'preset' | 'upload') => send('room_create', { background_type: backgroundType, ...entryParams() }),
  /** 참여 화면(N04) 진입. */
  joinStart: () => send('join_start', entryParams()),
  /** 캐릭터·포즈 선택. 카탈로그 ID라 개인 정보가 아니다. */
  characterSelect: (presetId: string, poseId: string) =>
    send('character_select', { preset_id: presetId, pose_id: poseId }),
  /** 그리기 완료(전체모습 보기). */
  drawComplete: (strokeCount: number) => send('draw_complete', { stroke_count: strokeCount }),
  /** 배치까지 끝내 제출 성공. */
  characterSubmit: () => send('character_submit', entryParams()),
  /** 완성 이미지 저장. */
  imageSave: () => send('image_save', {}),
  /** 방 링크 공유·복사. method: shared(공유 시트) / copied(클립보드). */
  linkShare: (method: 'shared' | 'copied') => send('link_share', { method }),
  /** 방장 로그인 성공. */
  adminLogin: () => send('admin_login', {}),
  /** 방장 관리 변경사항 저장. */
  adminSave: (count: number) => send('admin_save', { character_count: count }),
  /** 방장이 캐릭터 삭제. */
  adminDelete: () => send('admin_delete', {}),
}
