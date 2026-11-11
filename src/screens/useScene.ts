import { getApi, type Catalog, type RelayDrawClient, type Scene } from '../lib/relay-draw/client.ts'
import { useAsync, type Async } from '../lib/useAsync.ts'
import { sceneSprites, type SpriteView } from './types.ts'

/**
 * 한 방의 화면에 필요한 서버 데이터 한 묶음.
 *
 * 카탈로그(포즈 SVG·얼굴 사각형)가 없으면 장면을 그릴 수 없어서 항상 같이 받는다.
 * 방이 아직 없는 단계(방 만들기 중)에서는 scene이 null이다.
 */
export type SceneData = { api: RelayDrawClient; catalog: Catalog; scene: Scene | null }

export type SceneAsync = Async<SceneData> & { reload: () => void }

/**
 * 화면들이 공유하는 조회. 결과를 자식(SceneBoard)에 내려주면 한 화면에 한 번만 조회한다.
 * 저장·가드·제목도 같은 결과를 쓴다.
 */
export function useScene(roomId: string | null): SceneAsync {
  return useAsync<SceneData>(
    async (signal) => {
      const api = getApi()
      const catalog = await api.catalog(signal)
      const scene = roomId ? await api.scene(roomId, signal) : null
      return { api, catalog, scene }
    },
    [roomId],
  )
}

/**
 * 그릴 값으로 환산. 화면(PlacedSprite)과 합성(composeScene)이 같은 값을 받아야
 * 저장한 그림과 보고 있는 그림이 같다.
 */
export function sceneView(
  data: SceneData,
  fallbackUrl: string | null,
): { url: string | null; sprites: SpriteView[] } {
  const url = data.scene ? data.api.url(data.scene.background.url) : fallbackUrl
  const sprites = data.scene ? sceneSprites(data.api, data.catalog, data.scene.characters) : []
  return { url, sprites }
}
