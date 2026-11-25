import { useId, type CSSProperties } from 'react'
import type { Artwork } from '../lib/relay-draw/api-v2.ts'
import { useImageSrc } from '../lib/relay-draw/images.ts'
import { assetUrl } from '../lib/relay-draw/screens.ts'
import { drawClip, drawRect } from './character-art.ts'

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
  const body = useImageSrc(assetUrl(art.url))
  const face = useImageSrc(faceUrl)
  const { width: cw, height: ch } = art.canvas
  const f = drawRect(art)
  const clip = drawClip(art)
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
      {body && <image href={body} x={0} y={0} width={cw} height={ch} />}
      {face && (
        <>
          {clip && (
            <clipPath id={clipId}>
              {clip.kind === 'path' ? (
                <path d={clip.d} />
              ) : (
                <ellipse
                  cx={clip.rect.x + clip.rect.width / 2}
                  cy={clip.rect.y + clip.rect.height / 2}
                  rx={clip.rect.width / 2}
                  ry={clip.rect.height / 2}
                />
              )}
            </clipPath>
          )}
          <image
            href={face}
            x={f.x}
            y={f.y}
            width={f.width}
            height={f.height}
            preserveAspectRatio="none"
            clipPath={clip ? `url(#${clipId})` : undefined}
          />
        </>
      )}
    </svg>
  )
}

