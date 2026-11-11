/**
 * 장면(배경 + 배치된 캐릭터)을 PNG 한 장으로 합성한다. React에 의존하지 않는다.
 *
 * 서버는 합성을 하지 않는다. GET /result는 scene과 같은 JSON이고, 완성 이미지는
 * 클라이언트가 만들어서 필요하면 POST /result-assets로 올리는 구조다.
 *
 * 좌표 해석은 화면(PlacedSprite)과 반드시 같아야 한다. 하나라도 어긋나면
 * "배치 화면에서 본 그림"과 "저장한 그림"이 달라진다.
 *   x, y     배경 사각형 기준 중심 비율
 *   scale    배경 너비 대비 캐릭터 너비 비율
 *   rotation 중심 기준 회전(도)
 *   zIndex   낮은 것부터 그린다
 *
 * 이미지는 전부 crossOrigin=anonymous로 읽는다. API가 Access-Control-Allow-Origin을
 * 주기 때문에 캔버스가 오염되지 않고 toBlob을 쓸 수 있다(확인함).
 */

export type ComposeSprite = {
  poseUrl: string
  faceUrl: string | null
  /** 포즈 canvas 좌표계에서 얼굴이 들어갈 사각형. */
  faceRect: { x: number; y: number; width: number; height: number }
  canvas: { width: number; height: number }
  x: number
  y: number
  scale: number
  rotation: number
  zIndex: number
}

export type ComposeResult = {
  blob: Blob
  width: number
  height: number
  /** 불러오지 못해 빠진 캐릭터 수. 0이 아니면 호출자가 사용자에게 알려야 한다. */
  missing: number
}

/**
 * 출력 가로 상한. 기본 배경이 1200px이고 업로드 사진은 더 클 수 있다.
 * 제출 파일 상한이 10MiB라 과하게 키우지 않는다.
 */
const MAX_WIDTH = 1600

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    // objectURL(blob:)에는 CORS 개념이 없지만 지정해도 문제가 없다.
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`이미지를 불러오지 못했습니다: ${url}`))
    image.src = url
  })
}

/** SVG는 width/height가 있으면 naturalWidth가 잡힌다. 없을 때를 대비한 하한. */
function naturalSize(image: HTMLImageElement): { width: number; height: number } {
  return {
    width: image.naturalWidth || image.width || MAX_WIDTH,
    height: image.naturalHeight || image.height || Math.round((MAX_WIDTH * 2) / 3),
  }
}

/**
 * 얼굴을 faceRect 안에 비율을 지키며 넣는다.
 * 화면은 CSS object-fit: contain이라 합성도 같은 규칙을 쓴다.
 */
function containRect(
  source: { width: number; height: number },
  box: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const ratio = Math.min(box.width / source.width, box.height / source.height)
  const width = source.width * ratio
  const height = source.height * ratio
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  }
}

export async function composeScene(input: {
  backgroundUrl: string
  sprites: ComposeSprite[]
  /** 출력 가로 픽셀. 생략하면 배경 원본 가로(상한 적용). */
  width?: number
}): Promise<ComposeResult> {
  const background = await loadImage(input.backgroundUrl)
  const source = naturalSize(background)

  const width = Math.round(Math.min(input.width ?? source.width, MAX_WIDTH))
  const height = Math.round((width * source.height) / source.width)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('캔버스를 만들지 못했습니다.')

  ctx.drawImage(background, 0, 0, width, height)

  // 캐릭터는 등록 순서(zIndex)대로 쌓는다. 서버가 준 순서를 그대로 따른다.
  const ordered = [...input.sprites].sort((a, b) => a.zIndex - b.zIndex)
  let missing = 0

  for (const sprite of ordered) {
    let pose: HTMLImageElement
    try {
      pose = await loadImage(sprite.poseUrl)
    } catch {
      // 포즈를 못 읽으면 그 캐릭터는 통째로 빠진다. 나머지는 계속 그린다.
      missing += 1
      continue
    }
    const face = sprite.faceUrl ? await loadImage(sprite.faceUrl).catch(() => null) : null
    if (sprite.faceUrl && !face) missing += 1

    const spriteWidth = sprite.scale * width
    const spriteHeight = (spriteWidth * sprite.canvas.height) / sprite.canvas.width

    ctx.save()
    ctx.translate(sprite.x * width, sprite.y * height)
    ctx.rotate((sprite.rotation * Math.PI) / 180)
    ctx.drawImage(pose, -spriteWidth / 2, -spriteHeight / 2, spriteWidth, spriteHeight)

    if (face) {
      // faceRect는 포즈 canvas 좌표계라 스프라이트 크기 비율로 환산한다.
      const scaleX = spriteWidth / sprite.canvas.width
      const scaleY = spriteHeight / sprite.canvas.height
      const box = {
        x: sprite.faceRect.x * scaleX - spriteWidth / 2,
        y: sprite.faceRect.y * scaleY - spriteHeight / 2,
        width: sprite.faceRect.width * scaleX,
        height: sprite.faceRect.height * scaleY,
      }
      const fit = containRect(naturalSize(face), box)
      ctx.drawImage(face, fit.x, fit.y, fit.width, fit.height)
    }
    ctx.restore()
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png')
  })
  if (!blob) throw new Error('이미지를 만들지 못했습니다.')

  return { blob, width, height, missing }
}

/** 브라우저 다운로드. 서버 왕복 없이 파일로 저장된다. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  // 클릭 직후 해제하면 일부 브라우저가 저장을 놓친다. 다음 틱에 정리한다.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * 파일 공유. 이미지 공유를 지원하면 이미지로, 아니면 링크로 내려간다.
 * 반환값은 실제로 수행한 방식이다. 호출자가 사용자에게 무엇이 일어났는지 알려야 한다.
 */
export async function shareImage(
  blob: Blob,
  filename: string,
  fallback: { title: string; url: string },
): Promise<'image' | 'link' | 'cancelled' | 'unsupported'> {
  const file = new File([blob], filename, { type: blob.type })

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fallback.title })
      return 'image'
    } catch {
      // 사용자가 공유 시트를 닫은 경우. 오류가 아니다.
      return 'cancelled'
    }
  }

  if (navigator.share) {
    try {
      await navigator.share({ title: fallback.title, url: fallback.url })
      return 'link'
    } catch {
      return 'cancelled'
    }
  }

  return 'unsupported'
}
