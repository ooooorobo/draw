/**
 * GA4 측정. GTM(index.html)이 Google 태그(gtag.js)를 띄우고, 여기서 gtag('event')로 보낸 이벤트를
 * 그 Google 태그가 그대로 GA4로 보낸다. 그래서 GTM에 이벤트별 트리거·태그를 만들 필요가 없다.
 *
 * 화면이 바뀌어도 주소가 그대로인 앱이라 화면 조회는 page_view를 직접 보낸다.
 * 주소에는 방 ID(/r/<uuid>)가 들어 있으므로 page_location을 /screen/<화면ID>로 바꿔 보낸다.
 * (GTM Google 태그의 자동 page_view는 꺼야 한다: send_page_view = false)
 *
 * 방 ID·별명·비밀번호 같은 식별·개인 정보는 보내지 않는다.
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

/** 화면 조회. id는 Figma 화면 번호(N04 등), name은 사람이 읽는 이름. */
export function trackScreen(id: string, name: string) {
  send('page_view', {
    page_title: `${id} ${name}`,
    page_location: `${window.location.origin}/screen/${id}`,
    screen_id: id,
  })
}

/** 퍼널 이벤트. 이름과 매개변수는 GA4 보고서에 그대로 나온다. */
export const track = {
  /** 방 생성 완료. */
  roomCreate: (backgroundType: 'preset' | 'upload') => send('room_create', { background_type: backgroundType }),
  /** 참여 화면(N04) 진입. */
  joinStart: () => send('join_start', {}),
  /** 캐릭터·포즈 선택. 카탈로그 ID라 개인 정보가 아니다. */
  characterSelect: (presetId: string, poseId: string) =>
    send('character_select', { preset_id: presetId, pose_id: poseId }),
  /** 그리기 완료(전체모습 보기). */
  drawComplete: (strokeCount: number) => send('draw_complete', { stroke_count: strokeCount }),
  /** 배치까지 끝내 제출 성공. */
  characterSubmit: () => send('character_submit', {}),
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
