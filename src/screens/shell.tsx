import { useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { faceBox } from './sprite.ts'
import type { SpriteView } from './types.ts'

/**
 * 확정 디자인의 공통 골격.
 * 제목(+부제) / 본문 / 하단 입체 CTA의 3단 구조를 모든 화면이 공유한다.
 */
export function Screen({
  title,
  sub,
  strong = false,
  hero = false,
  largeSub = false,
  aside,
  variant,
  scroll = false,
  children,
  actions,
}: {
  /** 없으면 제목 줄을 그리지 않는다(N07). */
  title?: string
  sub?: string
  /** 시안에서 제목이 Bold인 화면(N10·N10C·N11·E01). */
  strong?: boolean
  /** 큰 제목(N03D "방 생성 완료!", 26px). */
  hero?: boolean
  /** 부제가 18px인 화면(N03D·N11의 방 제목). */
  largeSub?: boolean
  /** 제목 줄 오른쪽 끝의 보조 동작(N04 "방 관리"). */
  aside?: ReactNode
  /** top: 제목 없이 위 16px부터(N07). bleed: 여백 없이 전체(N01). */
  variant?: 'top' | 'bleed'
  /** 본문이 길어 스크롤해야 하는 화면(N05). */
  scroll?: boolean
  children?: ReactNode
  actions?: ReactNode
}) {
  const className = ['screen', variant && `screen--${variant}`].filter(Boolean).join(' ')
  const titleClass = ['screen-title', strong && 'is-strong', hero && 'is-hero']
    .filter(Boolean)
    .join(' ')

  return (
    <section className={className}>
      {title && (
        <header className="screen-head">
          <h1 className={titleClass}>{title}</h1>
          {sub && <p className={largeSub ? 'screen-sub is-large' : 'screen-sub'}>{sub}</p>}
        </header>
      )}
      {aside}
      <div className={scroll ? 'screen-body is-scroll' : 'screen-body'}>{children}</div>
      {actions && <div className="screen-foot">{actions}</div>}
    </section>
  )
}

/** 서버 조회 중. */
export function Loading({ label = '불러오는 중' }: { label?: string }) {
  return <p className="state">{label}…</p>
}

/** 서버 오류. 서버가 한국어 message를 주므로 그대로 보여준다. */
export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state">
      <p className="error">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          다시 시도
        </button>
      )}
    </div>
  )
}

/**
 * 배경 무대. 자식으로 배치된 캐릭터를 올린다.
 *
 * 배경 비율을 고정하지 않는다. 배경 이미지가 로드되면 그 비율 그대로 남는 공간에 맞춰 들어간다
 * (styles.css의 .stage-fit 주석 참고). 기본 배경은 가로·세로가 섞여 있고 업로드 사진은
 * 비율이 제각각인데, 틀을 고정하고 잘라내면 "화면에서 배치한 자리"와
 * "서버에 보낸 배경 사각형 기준 비율"이 어긋난다.
 */
export function Stage({
  url,
  stageRef,
  interactive = false,
  size,
  children,
}: {
  url: string | null
  /** 제스처 계산에 배경 사각형의 실제 크기가 필요해서 노드를 노출한다(N07). */
  stageRef?: RefObject<HTMLDivElement | null>
  /** 제스처를 받는 배경. 브라우저의 스크롤·줌·길게 누름 팝업을 끄는 클래스를 붙인다. */
  interactive?: boolean
  /** 남는 높이를 다 쓰지 않는 작은 미리보기(N04M 280px, E01 360px). */
  size?: 'preview' | 'medium'
  children?: ReactNode
}) {
  // 배경 비율(가로/세로). 이미지가 로드되기 전에는 CSS 기본값(세로형)을 쓴다.
  const [loaded, setLoaded] = useState<{ url: string; ratio: number } | null>(null)
  const ratio = loaded && loaded.url === url ? loaded.ratio : null

  const fitClass = ['stage-fit', size && `is-${size}`].filter(Boolean).join(' ')
  const style = ratio ? ({ '--ratio': ratio } as CSSProperties) : undefined

  return (
    <div className={fitClass}>
      <div className={interactive ? 'stage stage-live' : 'stage'} ref={stageRef} style={style}>
        {url ? (
          <img
            src={url}
            alt=""
            className="stage-bg"
            onLoad={(e) => {
              const { naturalWidth, naturalHeight } = e.currentTarget
              if (naturalWidth > 0 && naturalHeight > 0) {
                setLoaded({ url, ratio: naturalWidth / naturalHeight })
              }
            }}
          />
        ) : (
          <div className="stage-empty" />
        )}
        {children}
      </div>
    </div>
  )
}

/**
 * 배경 위에 놓인 캐릭터 하나.
 *
 * 서버 좌표 계약(제출 API 설명): x/y는 배경 사각형 기준 "중심 비율",
 * scale은 "배경 너비 대비 비율", rotation은 도 단위.
 */
export function PlacedSprite({
  sprite: { poseUrl, faceUrl, faceRect, canvas, x, y, scale, rotation, zIndex },
  mark,
  onPick,
  label,
}: {
  /** 포즈·얼굴 URL과 좌표를 한 덩어리로 받는다(types.ts의 sceneSprites가 만든다). */
  sprite: SpriteView
  /** dashed: 배치 중인 내 캐릭터(N07). boxed: 삭제 대상으로 고른 캐릭터(N10). */
  mark?: 'dashed' | 'boxed'
  /** 누르면 고르는 캐릭터(N10). */
  onPick?: () => void
  /** 고를 수 있을 때 읽어줄 이름. */
  label?: string
}) {
  const className = ['sprite', mark && `is-${mark}`, onPick && 'is-pickable']
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={className}
      role={onPick ? 'button' : undefined}
      tabIndex={onPick ? 0 : undefined}
      aria-label={onPick ? label : undefined}
      aria-pressed={onPick ? mark === 'boxed' : undefined}
      onClick={onPick}
      onKeyDown={
        onPick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onPick()
              }
            }
          : undefined
      }
      style={{
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        // scale은 배경 너비 대비 비율이므로 너비만 지정하고 높이는 비율로 따라가게 둔다.
        width: `${scale * 100}%`,
        aspectRatio: `${canvas.width} / ${canvas.height}`,
        transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
        zIndex,
      }}
    >
      <img src={poseUrl} alt="" className="sprite-pose" />
      {faceUrl && <img src={faceUrl} alt="" className="sprite-face" style={faceBox(faceRect, canvas)} />}
    </div>
  )
}

/**
 * 캐릭터 한 명을 크게(N06C 전체모습 확인, N10C 삭제 확인).
 * 포즈 위에 얼굴을 얹는 방식은 무대와 같다(object-fit: contain).
 */
export function Figure({
  poseUrl,
  faceUrl,
  faceRect,
  canvas,
  size,
}: Pick<SpriteView, 'poseUrl' | 'faceUrl' | 'faceRect' | 'canvas'> & {
  size?: 'small' | 'tiny'
}) {
  return (
    <div className="figure">
      <div className={size ? `figure-art is-${size}` : 'figure-art'}>
        <img src={poseUrl} alt="" />
        {faceUrl && (
          <img src={faceUrl} alt="" className="figure-face" style={faceBox(faceRect, canvas)} />
        )}
      </div>
    </div>
  )
}

/**
 * 비밀번호 입력. 확정 시안의 `비밀번호 입력` 프레임에 대응한다.
 *
 * 글자 수를 세지 않는다. 비밀번호는 길이를 노출할 이유가 없고, 설계에도 카운터가 없다.
 */
export function PasswordField({
  label,
  value,
  placeholder,
  invalid = false,
  onChange,
}: {
  label: string
  value: string
  placeholder: string
  /** 불일치 표시(E04). 입력값은 지우지 않는다. */
  invalid?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="password"
        value={value}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

/** 불릿 안내 목록. 확정 시안이 생성 완료 안내에 쓰는 형태다. */
export function NoteList({ items }: { items: string[] }) {
  return (
    <ul className="note-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

/**
 * 라벨 + 입력 한 쌍.
 * 시안에 글자 수 표시가 없어서 세지 않는다. 상한은 maxLength로 입력 단계에서 막는다.
 */
export function Field({
  label,
  value,
  placeholder,
  maxLength,
  onChange,
}: {
  label: string
  value: string
  placeholder: string
  /** 서버 제약을 입력 단계에서 막는다(제목 14자, 닉네임 10자). */
  maxLength: number
  onChange: (value: string) => void
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}
