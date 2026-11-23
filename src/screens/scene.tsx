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
  showNames = false,
  onToggleNames,
  children,
}: {
  background: Pick<BackgroundViewV2, 'url' | 'width' | 'height'> & { previewUrl?: string }
  characters?: CharacterV2[]
  maxHeight?: number
  maxWidth?: number
  /** N10 선택 강조. */
  highlightId?: string | null
  onSelect?: (id: string) => void
  /** 캐릭터 아래 별명 표시. */
  showNames?: boolean
  /** 주면 오른쪽 위에 별명 on/off 스위치를 띄운다(N04·N09·N11). */
  onToggleNames?: () => void
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
          {showNames &&
            ordered
              .filter((c) => c.nickname.trim())
              .map((c) => {
                // 캐릭터 박스를 같은 각도로 돌린 투명 상자 위에 붙여서 캐릭터와 같이 기운다(Figma 이름표).
                const box = spriteBox(c, size)
                return (
                  <div
                    key={`name-${c.id}`}
                    className="sprite-label"
                    style={{
                      left: box.left,
                      top: box.top,
                      width: box.width,
                      height: box.height,
                      transform: c.rotation ? `rotate(${c.rotation}deg)` : undefined,
                    }}
                  >
                    <span className="sprite-name">{c.nickname.trim()}</span>
                  </div>
                )
              })}
          {children?.(size)}
          {onToggleNames && characters.length > 0 && (
            <button
              type="button"
              className="name-toggle"
              role="switch"
              aria-checked={showNames}
              onClick={onToggleNames}
            >
              이름 보기
              <span className="name-toggle-track" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </Stage>
  )
}
