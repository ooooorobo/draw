import type { ReactNode } from 'react'

/**
 * 와이어프레임 화면의 공통 골격. 디자인이 아니라 배치만 담당한다.
 * 제목 / 본문 / 하단 액션의 3단 구조는 모든 화면이 공유한다.
 */
export function Screen({
  title,
  sub,
  note,
  children,
  actions,
}: {
  title: string
  sub?: string
  /** 와이어프레임에 적힌 보조 안내 문구. */
  note?: string
  children?: ReactNode
  actions?: ReactNode
}) {
  return (
    <section className="screen">
      <h1 className="screen-title">{title}</h1>
      {sub && <p className="screen-sub">{sub}</p>}
      <div className="screen-body">{children}</div>
      {note && <p className="note">{note}</p>}
      {actions && <div className="screen-foot">{actions}</div>}
    </section>
  )
}

/** 배경 자리. 실제 이미지는 API 연동 이후에 들어온다. */
export function BackgroundBox({ label }: { label: string }) {
  return (
    <div className="bg-box">
      <span>{label}</span>
    </div>
  )
}

/**
 * 캐릭터 선택 칸. 정방형 4열(와이어프레임 N05).
 * 칸 내용은 비워둔다 — 포즈 이미지는 아직 넣지 않는다.
 */
export function SlotGrid({
  count,
  selected,
  onSelect,
}: {
  count: number
  selected: number | null
  onSelect: (pose: number) => void
}) {
  return (
    <div className="slot-grid">
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          className="slot"
          aria-label={`칸 ${i + 1}`}
          aria-pressed={selected === i}
          onClick={() => onSelect(i)}
        />
      ))}
    </div>
  )
}

/** 등록된 그림이 놓이는 자리(N10 / N09R / N11). 선택 대상이 아니라 표시용이다. */
export function SlotBoard({ count }: { count: number }) {
  return (
    <div className="slot-grid">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="slot" />
      ))}
    </div>
  )
}

/** 라벨 + 입력 한 쌍. */
export function Field({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string
  value: string
  placeholder: string
  onChange: (value: string) => void
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}
