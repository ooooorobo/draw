import { useId, type CSSProperties } from 'react'
import type { Artwork } from '../lib/relay-draw/api-v2.ts'
import { assetUrl } from '../lib/relay-draw/screens.ts'

/**
 * 포즈 + 얼굴을 한 장으로. SVG라 크기와 무관하게 선명하고, faceMask path로 바로 오릴 수 있다.
 * width는 CSS px. 높이는 원화 비율을 따른다.
 */
export function Sprite({
  art,
  faceUrl,
  width,
  style,
  className,
  onClick,
}: {
  art: Artwork
  faceUrl: string | null
  width: number
  style?: CSSProperties
  className?: string
  onClick?: () => void
}) {
  const clipId = useId()
  const { width: cw, height: ch } = art.canvas
  const f = art.faceRect
  const mask = art.faceMask?.path
  return (
    <svg
      className={className ?? 'sprite'}
      viewBox={`0 0 ${cw} ${ch}`}
      width={width}
      height={(width * ch) / cw}
      style={style}
      aria-hidden="true"
      onClick={onClick}
    >
      <image href={assetUrl(art.url)} x={0} y={0} width={cw} height={ch} />
      {faceUrl && (
        <>
          <clipPath id={clipId}>
            {mask ? (
              <path d={mask} />
            ) : (
              <ellipse cx={f.x + f.width / 2} cy={f.y + f.height / 2} rx={f.width / 2} ry={f.height / 2} />
            )}
          </clipPath>
          <image
            href={faceUrl}
            x={f.x}
            y={f.y}
            width={f.width}
            height={f.height}
            preserveAspectRatio="none"
            clipPath={`url(#${clipId})`}
          />
        </>
      )}
    </svg>
  )
}

