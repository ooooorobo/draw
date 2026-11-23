import { useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import arrowsIcon from '../assets/icon-arrows-lr.svg'
import clockIcon from '../assets/icon-clock.svg'
import signCross from '../assets/sign-cross.svg'
import signGrass from '../assets/sign-grass.svg'
import signPlank from '../assets/sign-plank.svg'
import signStake from '../assets/sign-stake.svg'
import { containSize, useElementSize } from './layout.ts'

/**
 * 화면 공통 골격과 디자인 컴포넌트(Figma MVP v4).
 *
 * 모든 화면은 머리말(제목·부제) / 본문(남는 높이) / 하단 CTA의 3단이다.
 * Figma는 375×812 절대 배치지만 기기 높이가 제각각이라 본문이 남는 높이를 받는 flex로 옮겼다.
 */

export function Page({
  variant,
  children,
}: {
  variant?: 'hero' | 'tight' | 'fixed'
  children: ReactNode
}) {
  return <section className={variant ? `page page--${variant}` : 'page'}>{children}</section>
}

export function Head({
  title,
  sub,
  size,
  bold,
  badge,
  plain,
}: {
  title: ReactNode
  sub?: ReactNode
  size?: 'xl'
  bold?: boolean
  /**
   * 나무 팻말 없이 글자만. 기본 제목은 Figma "타이틀 / 나무 팻말"(162:107) 위에 얹는다.
   * 큰 제목(xl)·굵은 제목(N10)·오류 안내 화면(E01 등)은 Figma에서도 팻말이 없다.
   */
  plain?: boolean
  /** 제목 오른쪽 배지(N04 "방 관리"). */
  badge?: { label: string; onClick: () => void }
}) {
  const sign = !plain && !bold && size !== 'xl'
  const cls = ['head-title', size === 'xl' && 'head-title--xl', bold && 'head-title--bold', sign && 'head-sign']
    .filter(Boolean)
    .join(' ')
  return (
    <header className="head">
      <h1 className={cls}>{sign ? <span>{title}</span> : title}</h1>
      {sub !== undefined && <p className="head-sub">{sub}</p>}
      {badge && (
        <button type="button" className="badge" onClick={badge.onClick}>
          {badge.label}
        </button>
      )}
    </header>
  )
}

export function Body({ children, gap }: { children: ReactNode; gap?: number }) {
  return (
    <div className="body" style={gap === undefined ? undefined : { gap }}>
      {children}
    </div>
  )
}

/** stack: 첫 버튼은 한 줄을 다 쓰고 나머지는 아래 줄에 나란히(Figma N09 버튼 3개). */
export function Foot({ children, stack }: { children: ReactNode; stack?: boolean }) {
  return <div className={stack ? 'foot foot--stack' : 'foot'}>{children}</div>
}

/** 공통 / 입체 CTA. */
export function Cta({ children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className="cta" {...rest}>
      {children}
    </button>
  )
}

export function Field({
  label,
  value,
  placeholder,
  onChange,
  type = 'text',
  maxLength,
  invalid,
  error,
  autoFocus,
  onEnter,
  inputMode,
}: {
  label: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
  type?: 'text' | 'password'
  maxLength?: number
  invalid?: boolean
  error?: string | null
  autoFocus?: boolean
  onEnter?: () => void
  /** 모바일 키보드 종류. 'numeric'이면 숫자 키패드. */
  inputMode?: 'text' | 'numeric'
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        className="field-input"
        type={type}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-invalid={invalid || Boolean(error)}
        autoFocus={autoFocus}
        inputMode={inputMode}
        pattern={inputMode === 'numeric' ? '[0-9]*' : undefined}
        autoComplete={type === 'password' ? 'off' : undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) onEnter()
        }}
      />
      {error && <span className="text text--error">{error}</span>}
    </label>
  )
}

/**
 * 남는 공간에 aspect 비율 박스를 contain으로 맞춘다.
 * maxHeight는 Figma 화면별 미리보기 높이 — 큰 화면에서 디자인보다 커지지 않게 한다.
 */
export function Stage({
  aspect,
  maxWidth,
  maxHeight,
  children,
}: {
  aspect: number
  maxWidth?: number
  maxHeight?: number
  children: (size: { width: number; height: number }) => ReactNode
}) {
  const [ref, box] = useElementSize<HTMLDivElement>()
  const size = containSize(
    aspect,
    Math.min(box.width, maxWidth ?? Infinity),
    Math.min(box.height, maxHeight ?? Infinity),
  )
  return (
    <div className="stage" ref={ref}>
      {size.width > 0 && children(size)}
    </div>
  )
}

/**
 * 오류 안내(Figma E01 158:2087 · E03 21:1216). 큰 제목 + 안내 + 바로 아래 나무 X 표지판.
 */
export function ErrorNotice({ title, text }: { title: string; text: string }) {
  return (
    <>
      <div className="head" style={{ paddingTop: 166, gap: 16 }}>
        <h1 className="head-title" style={{ fontSize: 24 }}>
          {title}
        </h1>
        <p className="text">{text}</p>
      </div>
      <Body>
        <div className="notice-sign">
          <SignX />
        </div>
      </Body>
    </>
  )
}

/** E03 나무 X 표지판. Figma 레이어 4장(말뚝·판자·X·풀)을 같은 자리에 겹친다. */
export function SignX() {
  // 위치/회전은 Figma(90:57, 160×140)의 레이어 박스를 그대로 옮겼다.
  // 각 SVG는 원래 크기로 놓고 레이어 박스 중심에 맞춘 뒤 -5° 돌린다.
  const tilt = (cx: number, cy: number, w: number, h: number) => ({
    left: cx - w / 2,
    top: cy - h / 2,
    width: w,
    height: h,
    transform: 'rotate(-5deg)',
  })
  return (
    <div className="sign" aria-hidden="true">
      <img src={signStake} alt="" style={tilt(82.49, 98.4, 20.2, 63.2)} />
      <img src={signPlank} alt="" style={tilt(80.76, 53.07, 150.658, 68.613)} />
      <img src={signCross} alt="" style={tilt(78.29, 50.58, 30.0001, 33.0002)} />
      <img src={signGrass} alt="" style={{ left: 60.11, top: 114.1, width: 43.8, height: 17.8003 }} />
    </div>
  )
}

/**
 * 종료까지 남은 시간 게이지(Figma 158:849). ratio는 참여 기간 중 남은 비율 0..1.
 * 거의 끝나도 글자가 읽히도록 채움은 최소 폭을 둔다.
 */
export function RemainingBar({ label, ratio }: { label: string; ratio: number }) {
  if (!label) return null
  const fill = Math.max(0.08, Math.min(1, ratio))
  return (
    <div className="remain" role="img" aria-label={`종료까지 ${label} 남음`}>
      <div className="remain-track">
        <div className="remain-fill" style={{ width: `calc((100% - 5px) * ${fill})` }} />
        <span className="remain-label">{label} 남음</span>
      </div>
      <img className="remain-clock" src={clockIcon} alt="" />
    </div>
  )
}

/** 짧은 안내(링크 복사됨 등). */
export function Toast({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div className="toast" role="status">
      {message}
    </div>
  )
}

const clampUnit = (v: number) => Math.min(1, Math.max(0, v))

/** 외부 가로 스크롤. value 0..1. */
export function HScroll({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [ref, box] = useElementSize<HTMLDivElement>()
  const knob = 80
  const travel = Math.max(1, box.width - knob)
  const start = useRef<{ x: number; value: number } | null>(null)
  return (
    <div className="hscroll" ref={ref}>
      <div className="hscroll-track" />
      <button
        type="button"
        className="hscroll-knob"
        aria-label="배경 좌우 이동"
        style={{ left: value * travel }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          start.current = { x: e.clientX, value }
        }}
        onPointerMove={(e) => {
          if (!start.current) return
          onChange(clampUnit(start.current.value + (e.clientX - start.current.x) / travel))
        }}
        onPointerUp={() => (start.current = null)}
        onPointerCancel={() => (start.current = null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') onChange(clampUnit(value - 0.1))
          if (e.key === 'ArrowRight') onChange(clampUnit(value + 0.1))
        }}
      >
        <img src={arrowsIcon} alt="" />
      </button>
    </div>
  )
}
