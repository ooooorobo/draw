import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** 요소의 콘텐츠 박스 크기. 미리보기를 남는 공간에 contain으로 맞출 때 쓴다. */
export function useElementSize<T extends HTMLElement>(): [RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      setSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      )
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, size]
}

/** aspect(가로/세로)를 유지하며 width × height 안에 들어가는 최대 크기. */
export function containSize(aspect: number, width: number, height: number) {
  if (width <= 0 || height <= 0 || !Number.isFinite(aspect) || aspect <= 0) {
    return { width: 0, height: 0 }
  }
  return width / height > aspect
    ? { width: height * aspect, height }
    : { width, height: width / aspect }
}

