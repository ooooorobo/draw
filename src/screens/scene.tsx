import type { ReactNode } from 'react'
import switchOff from '../assets/switch-off.svg'
import switchOn from '../assets/switch-on.svg'
import type { BackgroundViewV2, CharacterV2 } from '../lib/relay-draw/api-v2.ts'
import { assetUrl } from '../lib/relay-draw/screens.ts'
import { backgroundAspect, faceAssetUrl, labelAnchor, nameTag, spriteBox } from './character-art.ts'
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
  mineId,
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
  /** 내 캐릭터 id. 이름표에 "· 나"를 붙인다(Figma N09). */
  mineId?: string | null
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
          {showNames && <NameTags characters={ordered} size={size} mineId={mineId} />}
          {children?.(size)}
          {onToggleNames && characters.length > 0 && <NameToggle on={showNames} onToggle={onToggleNames} />}
        </div>
      )}
    </Stage>
  )
}

/** 이름표 하나. at은 캐릭터 머리 위 지점(labelAnchor). 캐릭터가 돌아가도 이름표는 똑바로 선다. */
export function NameTag({ label, at }: { label: string; at: { x: number; y: number } }) {
  return (
    <span className="sprite-name sprite-name--at" style={{ left: at.x, top: at.y }}>
      {label}
    </span>
  )
}

/** 캐릭터 머리 위 이름표(Figma N07·N09). 별명이 없는 캐릭터는 건너뛴다. */
export function NameTags({
  characters,
  size,
  mineId,
}: {
  characters: CharacterV2[]
  size: { width: number; height: number }
  mineId?: string | null
}) {
  return (
    <>
      {characters.map((c) => {
        const label = nameTag(c.nickname, c.id === mineId)
        if (!label) return null
        return <NameTag key={`name-${c.id}`} label={label} at={labelAnchor(spriteBox(c, size), c.rotation)} />
      })}
    </>
  )
}

/** "이름 보기" 스위치. 그림 오른쪽 위(Figma N04·N07·N09·N09R). */
export function NameToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="name-toggle"
      role="switch"
      aria-checked={on}
      // 배치 화면은 그림 전체가 드래그 영역이다. 스위치 누름이 드래그로 잡히지 않게 막는다.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onToggle}
    >
      이름 보기
      <img src={on ? switchOn : switchOff} alt="" />
    </button>
  )
}
