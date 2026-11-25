/**
 * API 서버 이미지(배경·원화·얼굴) 로더.
 *
 * 서버 지침: 여러 이미지는 동시에 4~6개씩 불러오고, 혼잡(429)으로 실패한 이미지는 기다렸다가 다시 불러온다.
 * <img src>로 직접 걸면 브라우저가 한꺼번에 요청하고 실패 이유(429)도 알 수 없어서 fetch로 받는다.
 * 같은 URL은 한 번만 받아 object URL로 재사용한다.
 */
import { useEffect, useState } from 'react'
import { apiErrorFrom } from './api-client.ts'
import { getApi } from './client.ts'
import { retryThrottled } from './retry.ts'

const MAX_CONCURRENT = 4

let active = 0
const waiting: (() => void)[] = []

async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve))
  active += 1
  try {
    return await task()
  } finally {
    active -= 1
    waiting.shift()?.()
  }
}

async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) throw apiErrorFrom(res, await res.json().catch(() => null))
  return res.blob()
}

const blobs = new Map<string, Promise<Blob>>()
const objectUrls = new Map<string, Promise<string>>()

/** 대기 중에는 자리를 차지하지 않도록 재시도 루프를 슬롯 밖에 둔다. 최종 실패하면 캐시에서 빼서 다음 화면에서 다시 받게 한다. */
export function loadImageBlob(url: string): Promise<Blob> {
  let blob = blobs.get(url)
  if (!blob) {
    blob = retryThrottled(() => withSlot(() => fetchBlob(url)))
    blobs.set(url, blob)
    blob.catch(() => {
      blobs.delete(url)
      objectUrls.delete(url)
    })
  }
  return blob
}

function loadImageUrl(url: string): Promise<string> {
  let objectUrl = objectUrls.get(url)
  if (!objectUrl) {
    objectUrl = loadImageBlob(url).then((blob) => URL.createObjectURL(blob))
    objectUrls.set(url, objectUrl)
  }
  return objectUrl
}

function isApiAsset(src: string): boolean {
  try {
    return new URL(src).origin === new URL(getApi().url('/')).origin
  } catch {
    return false
  }
}

/**
 * <img src>·<image href>에 넣을 주소. API 서버 이미지는 로더를 거친 object URL을, 받는 중이거나 실패하면 null을 준다.
 * 로컬 이미지(번들 에셋, 방금 그린 얼굴의 blob URL)는 그대로 돌려준다.
 */
export function useImageSrc(src: string | null | undefined): string | null {
  const managed = !!src && isApiAsset(src)
  const [loaded, setLoaded] = useState<{ src: string; url: string } | null>(null)

  useEffect(() => {
    if (!src || !managed) return
    let alive = true
    loadImageUrl(src).then(
      (url) => alive && setLoaded({ src, url }),
      () => {},
    )
    return () => {
      alive = false
    }
  }, [src, managed])

  if (!src) return null
  if (!managed) return src
  return loaded?.src === src ? loaded.url : null
}
