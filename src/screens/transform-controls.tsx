import type { ReactNode } from 'react'
import resizeIcon from '../assets/icon-resize.svg'

const HANDLES = [
  { key: 'tl', x: 0, y: 0, rotate: 0 },
  { key: 'tr', x: 1, y: 0, rotate: 90 },
  { key: 'bl', x: 0, y: 1, rotate: -90 },
  { key: 'br', x: 1, y: 1, rotate: 180 },
] as const

/**
 * 선택한 캐릭터 위의 변형 도구: 점선 경계 + 네 모서리 크기 손잡이 + 아래 회전 손잡이.
 * 캐릭터와 같이 도는 상자 안에 넣는다. 손잡이는 data-role(resize·rotate)로 제스처를 알린다.
 * onRotateBy는 키보드(←/→) 회전용. omit으로 뺀 모서리는 다른 버튼 자리로 쓴다(N10 삭제 버튼).
 */
export function TransformControls({
  width,
  height,
  onRotateBy,
  omit,
  children,
}: {
  width: number
  height: number
  onRotateBy: (deg: number) => void
  omit?: (typeof HANDLES)[number]['key']
  children?: ReactNode
}) {
  return (
    <>
      <div className="place-frame" />
      {HANDLES.filter((h) => h.key !== omit).map((h) => (
        <button
          key={h.key}
          type="button"
          className="place-handle"
          aria-label="크기 조절"
          data-role="resize"
          style={{ left: h.x * width - 8, top: h.y * height - 8 }}
        >
          <img src={resizeIcon} alt="" style={{ transform: `rotate(${h.rotate}deg)` }} />
        </button>
      ))}
      <span className="place-stalk" style={{ left: width / 2 }} aria-hidden="true" />
      <button
        type="button"
        className="place-rotate"
        aria-label="회전"
        data-role="rotate"
        style={{ left: width / 2 - 12 }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') onRotateBy(-15)
          if (e.key === 'ArrowRight') onRotateBy(15)
        }}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {children}
    </>
  )
}
