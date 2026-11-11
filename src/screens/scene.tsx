import { errorMessage } from '../lib/useAsync.ts'
import { ErrorBox, Loading, PlacedSprite, Stage } from './shell.tsx'
import type { SpriteView } from './types.ts'
import { sceneView, type SceneAsync } from './useScene.ts'

/**
 * 배경과 등록된 캐릭터를 보여주는 읽기 전용 뷰.
 *
 * 조회는 화면이 useScene으로 하고 여기는 그리기만 한다. 화면도 같은 데이터를
 * 쓰기 때문에(제목·상태 가드·이미지 저장) 조회를 두 번 하지 않는다.
 * 배치 화면(N07)만 편집이 필요해서 따로 있고, 나머지는 모두 이 뷰를 쓴다.
 */
export function SceneBoard({
  view,
  fallbackUrl = null,
  extra,
  selectedId = null,
  onPick,
}: {
  view: SceneAsync
  /** 방이 아직 없을 때 보여줄 배경(방장이 고른 미리보기). */
  fallbackUrl?: string | null
  /** 서버 장면 위에 덧그릴 캐릭터. 등록 실패(E02)에서 아직 못 올린 내 캐릭터를 보여준다. */
  extra?: SpriteView | null
  /** 고른 캐릭터(N10 삭제 대상). */
  selectedId?: string | null
  /** 주면 캐릭터를 눌러 고를 수 있다(N10). */
  onPick?: (sprite: SpriteView) => void
}) {
  if (view.state === 'loading') return <Loading label="장면 불러오는 중" />
  if (view.state === 'error') {
    return <ErrorBox message={errorMessage(view.error)} onRetry={view.reload} />
  }

  const { url, sprites } = sceneView(view.data, fallbackUrl)
  const nicknames = new Map(view.data.scene?.characters.map((c) => [c.id, c.nickname]))

  return (
    <Stage url={url}>
      {sprites.map((sprite) => (
        <PlacedSprite
          key={sprite.id}
          sprite={sprite}
          mark={selectedId === sprite.id ? 'boxed' : undefined}
          onPick={onPick ? () => onPick(sprite) : undefined}
          label={nicknames.get(sprite.id)}
        />
      ))}
      {extra && <PlacedSprite sprite={extra} />}
    </Stage>
  )
}
