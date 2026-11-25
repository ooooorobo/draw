import { useState } from 'react'
import { track } from '../lib/analytics.ts'
import type { SceneV2 } from '../lib/relay-draw/api-v2.ts'
import { ERROR_CODES, isApiError, isThrottled } from '../lib/relay-draw/errors.ts'
import { jitterMs, MAX_AUTO_RETRIES, retryAfterMs, sleep } from '../lib/relay-draw/retry.ts'
import { downloadBlob, loadScene, saveResult } from '../lib/relay-draw/screens.ts'
import { renderSceneBlob } from './character-art.ts'
import type { ScreenProps } from './types.ts'

/**
 * 결과 파일 서버 보관. 사용자는 이미 내려받았으므로 실패해도 알리지 않는다.
 * 장면이 바뀌었으면(SCENE_CHANGED) 최신 scene으로 다시 합성하고, 429면 Retry-After만큼 기다린다. 최대 3회.
 */
async function storeResult(scene: SceneV2, image: Blob) {
  for (let attempt = 0; attempt <= MAX_AUTO_RETRIES; attempt++) {
    try {
      await saveResult(scene.roomId, scene.version, { image })
      return
    } catch (error) {
      if (attempt === MAX_AUTO_RETRIES) return
      if (isApiError(error) && error.code === ERROR_CODES.SCENE_CHANGED) {
        scene = await loadScene(scene.roomId)
        image = await renderSceneBlob(scene)
      } else if (isThrottled(error)) {
        await sleep(retryAfterMs(error) + jitterMs())
      } else {
        return
      }
    }
  }
}

/** 완성 그림 저장(N09 / N09R / N11). 합성은 프론트가 하고 서버에는 보관용으로 올린다. */
export function useSaveImage(toast: ScreenProps['toast']) {
  const [saving, setSaving] = useState(false)
  /** names: 화면에서 별명을 켜 두었으면 저장 이미지에도 넣는다. */
  const save = async (scene: SceneV2 | null, title: string, names = false) => {
    if (!scene || saving) return
    setSaving(true)
    try {
      const blob = await renderSceneBlob(scene, { names })
      downloadBlob(blob, `${title || 'drawing-party'}.png`)
      track.imageSave()
      storeResult(scene, blob).catch(() => {})
    } catch {
      toast('이미지를 저장하지 못했어요.')
    } finally {
      setSaving(false)
    }
  }
  return { save, saving }
}
