import type { ReactNode } from 'react'
import type { BackgroundViewV2, CharacterV2 } from '../lib/relay-draw/api-v2.ts'
import { assetUrl } from '../lib/relay-draw/screens.ts'
import { backgroundAspect, faceAssetUrl, spriteBox } from './character-art.ts'
import { Sprite } from './character.tsx'
import { Stage } from './ui.tsx'

/**
 * 현재 그림 / 배경 미리보기. 배경 위에 배치된 캐릭터를 zIndex 순으로 올린다.
 * 남는 공간에 contain으로 맞추되 maxHeight(Figma 화면별 높이)를 넘지 않는다.
 */
export function ScenePreview({
  background,
  characters = [],
  maxHeight,
  maxWidth,
  highlightId,
  onSelect,
  children,
}: {
  background: Pick<BackgroundViewV2, 'url' | 'width' | 'height'> & { previewUrl?: string }
  characters?: CharacterV2[]
  maxHeight?: number
  maxWidth?: number
  /** N10 선택 강조. */
  highlightId?: string | null
  onSelect?: (id: string) => void
  children?: (size: { width: number; height: number }) => ReactNode
}) {
  const src = background.previewUrl ?? assetUrl(background.url)
  const ordered = [...characters].sort((a, b) => a.zIndex - b.zIndex)
  return (
    <Stage aspect={backgroundAspect(background)} maxHeight={maxHeight} maxWidth={maxWidth}>
      {(size) => (
        <div className="scene" style={{ width: size.width, height: size.height }}>
          <img className="scene-bg" src={src} alt="" draggable={false} />
          {ordered.map((c) => {
            const box = spriteBox(c, size)
            return (
              <Sprite
                key={c.id}
                art={c.artwork}
                faceUrl={faceAssetUrl(c)}
                width={box.width}
                style={{
                  left: box.left,
                  top: box.top,
                  transform: c.rotation ? `rotate(${c.rotation}deg)` : undefined,
                  pointerEvents: onSelect ? 'auto' : undefined,
                  cursor: onSelect ? 'pointer' : undefined,
                }}
                onClick={onSelect ? () => onSelect(c.id) : undefined}
              />
            )
          })}
          {highlightId &&
            ordered
              .filter((c) => c.id === highlightId)
              .map((c) => {
                const box = spriteBox(c, size)
                return (
                  <div
                    key="mark"
                    className="sprite-mark"
                    style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
                  />
                )
              })}
          {children?.(size)}
        </div>
      )}
    </Stage>
  )
}
