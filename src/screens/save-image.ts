import { useState } from 'react'
import type { SceneV2 } from '../lib/relay-draw/api-v2.ts'
import { downloadBlob, saveResult } from '../lib/relay-draw/screens.ts'
import { renderSceneBlob } from './character-art.ts'
import type { ScreenProps } from './types.ts'

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
      saveResult(scene.roomId, scene.version, { image: blob }).catch(() => {})
    } catch {
      toast('이미지를 저장하지 못했어요.')
    } finally {
      setSaving(false)
    }
  }
  return { save, saving }
}

