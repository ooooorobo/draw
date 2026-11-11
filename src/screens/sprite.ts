import { useEffect, useState, type CSSProperties } from 'react'
import type { Spot } from '../lib/placement.ts'
import type { RelayDrawClient } from '../lib/relay-draw/client.ts'
import type { PoseChoice, SpriteView } from './types.ts'

/** 포즈 캔버스 기준 faceRect를 퍼센트 사각형으로. 무대·미리보기가 같은 계산을 쓴다. */
export function faceBox(
  faceRect: SpriteView['faceRect'],
  canvas: SpriteView['canvas'],
): CSSProperties {
  return {
    left: `${(faceRect.x / canvas.width) * 100}%`,
    top: `${(faceRect.y / canvas.height) * 100}%`,
    width: `${(faceRect.width / canvas.width) * 100}%`,
    height: `${(faceRect.height / canvas.height) * 100}%`,
  }
}

/** 내가 배치 중인 캐릭터. 편집 중에는 항상 맨 위에 둔다(실제 zIndex는 서버가 정한다). */
export function mySprite(
  api: RelayDrawClient,
  choice: PoseChoice,
  faceUrl: string | null,
  spot: Spot,
): SpriteView {
  return {
    id: 'mine',
    poseUrl: api.url(choice.pose.url),
    faceUrl,
    faceRect: choice.pose.faceRect,
    canvas: choice.pose.canvas,
    ...spot,
    zIndex: 1000,
  }
}

/**
 * Blob을 <img>에 쓸 수 있는 URL로. 화면을 떠나거나 그림이 바뀌면 해제한다.
 *
 * objectURL은 수동으로 만들고 해제해야 하는 외부 자원이라 effect가 맞는 자리다.
 * 렌더 중에(useMemo로) 만들면 StrictMode의 이중 호출에서 해제되지 않는 URL이 남는다.
 */
export function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null)

  // objectURL은 effect 안에서만 만들고 해제할 수 있어서, 만든 값을 렌더로 넘기는 경로가
  // setState뿐이다. 외부 자원과의 동기화라 이 규칙의 예외로 둔다.
  useEffect(() => {
    if (!blob) {
      // eslint-disable-next-line react/set-state-in-effect
      setUrl(null)
      return
    }
    const next = URL.createObjectURL(blob)
    // eslint-disable-next-line react/set-state-in-effect
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])

  return url
}
