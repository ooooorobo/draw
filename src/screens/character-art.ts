import { MARGIN_RATIO } from '../draw/engine.ts'
import type { CellTemplate, Vec } from '../draw/types.ts'
import type { Artwork, CharacterV2 } from '../lib/relay-draw/api-v2.ts'
import { assetUrl } from '../lib/relay-draw/screens.ts'

/**
 * 캐릭터 = 포즈 원화(얼굴이 비어 있는 몸) + 사용자가 그린 얼굴.
 *
 * 좌표계는 서버 artwork 기준이다.
 *   - canvas: 포즈 원화 크기(200×200)
 *   - faceRect: 원화 안 얼굴 영역
 *   - faceMask.path: 같은 좌표계의 얼굴 모양 SVG path
 * 얼굴 파일은 faceRect 크기 비율 그대로 잘라서 올리고, 그릴 때 faceRect에 맞춰 faceMask로 오린다.
 */

type Rect = { x: number; y: number; width: number; height: number }

/**
 * 얼굴 그리기 엔진 배치 정보.
 *
 * 엔진은 정사각 캔버스에 MARGIN_RATIO만큼 여백을 둔 "칸"을 정규화 좌표(0..1)로 쓴다.
 * faceRect를 감싸는 정사각을 칸으로 잡고, 실제 그릴 수 있는 곳은 faceRect에 내접한 타원이다.
 */
export function faceGeometry(art: Pick<Artwork, 'faceRect'>) {
  const f = art.faceRect
  const side = Math.max(f.width, f.height)
  const cx = f.x + f.width / 2
  const cy = f.y + f.height / 2
  const box: Rect = { x: cx - side / 2, y: cy - side / 2, width: side, height: side }
  const canvasSide = side / (1 - MARGIN_RATIO * 2)
  /** 엔진 캔버스가 원화 좌표계에서 차지하는 정사각. */
  const canvas: Rect = {
    x: box.x - canvasSide * MARGIN_RATIO,
    y: box.y - canvasSide * MARGIN_RATIO,
    width: canvasSide,
    height: canvasSide,
  }
  /** faceRect를 칸 정규화 좌표로. */
  const faceNorm: Rect = {
    x: (f.x - box.x) / side,
    y: (f.y - box.y) / side,
    width: f.width / side,
    height: f.height / side,
  }
  return { box, canvas, faceNorm }
}

/** faceRect에 내접한 타원을 다각형으로 만든 그리기 칸. 연결점·경계 띠는 없다. */
export function faceTemplate(art: Artwork): CellTemplate {
  const { faceNorm: n } = faceGeometry(art)
  const cx = n.x + n.width / 2
  const cy = n.y + n.height / 2
  const steps = 72
  const outline: Vec[] = Array.from({ length: steps }, (_, i) => {
    const t = (i / steps) * Math.PI * 2
    return { x: cx + (n.width / 2) * Math.cos(t), y: cy + (n.height / 2) * Math.sin(t) }
  })
  return { id: `face:${art.id}`, label: '얼굴', outline, anchors: [], hints: [] }
}

/**
 * 엔진 내보내기(정사각, 여백 포함)에서 faceRect 부분만 잘라 업로드용 PNG를 만든다.
 * 결과는 faceRect와 같은 비율이고 타원 밖은 투명하다.
 */
export function cropFace(exported: HTMLCanvasElement, art: Artwork): Promise<Blob> {
  const { faceNorm: n } = faceGeometry(art)
  const size = exported.width
  const origin = size * MARGIN_RATIO
  const span = size - origin * 2
  const sx = origin + n.x * span
  const sy = origin + n.y * span
  const sw = n.width * span
  const sh = n.height * span

  const out = document.createElement('canvas')
  out.width = Math.round(sw)
  out.height = Math.round(sh)
  const ctx = out.getContext('2d')
  if (!ctx) return Promise.reject(new Error('2d context unavailable'))
  ctx.drawImage(exported, sx, sy, sw, sh, 0, 0, out.width, out.height)
  return new Promise((resolve, reject) => {
    out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('얼굴 이미지 생성 실패'))), 'image/png')
  })
}

/** 얼굴 파일 URL. 서버 scene 캐릭터면 face asset, 로컬에서 방금 그린 얼굴이면 object URL. */
export function faceAssetUrl(character: Pick<CharacterV2, 'assets'>): string | null {
  const face = character.assets.find((a) => a.kind === 'face')
  return face ? assetUrl(face.url) : null
}

/** 이름표 문구. 내 캐릭터는 "별명 · 나", 별명이 없으면 "나". */
export function nameTag(nickname: string, mine: boolean): string {
  const name = nickname.trim()
  if (!mine) return name
  return name ? `${name} · 나` : '나'
}

/** 배경 위 캐릭터 박스(px). 서버 좌표: x·y = 중심 비율, scale = 배경 너비 대비 캐릭터 너비 비율. */
export function spriteBox(
  c: { x: number; y: number; scale: number; artwork: Artwork },
  bg: { width: number; height: number },
) {
  const width = c.scale * bg.width
  const height = (width * c.artwork.canvas.height) / c.artwork.canvas.width
  return { left: c.x * bg.width - width / 2, top: c.y * bg.height - height / 2, width, height }
}

async function loadBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`이미지를 불러오지 못했어요 (${res.status})`)
  return createImageBitmap(await res.blob())
}

/**
 * 저장용 합성 PNG. 배경 원본 크기에 캐릭터를 scene 좌표대로 올린다.
 * 서버는 합성하지 않는다(결과 저장 API 문서). 이미지는 fetch → Blob으로 받아 캔버스가 오염되지 않게 한다.
 */
export async function renderSceneBlob(
  scene: {
    background: { url: string; width: number | null; height: number | null }
    characters: CharacterV2[]
  },
  options: { names?: boolean } = {},
): Promise<Blob> {
  const bg = await loadBitmap(assetUrl(scene.background.url))
  const W = bg.width
  const H = bg.height
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.drawImage(bg, 0, 0, W, H)

  const ordered = [...scene.characters].sort((a, b) => a.zIndex - b.zIndex)
  for (const c of ordered) {
    const art = c.artwork
    const box = spriteBox(c, { width: W, height: H })
    const k = box.width / art.canvas.width
    ctx.save()
    ctx.translate(box.left + box.width / 2, box.top + box.height / 2)
    ctx.rotate((c.rotation * Math.PI) / 180)
    ctx.translate(-box.width / 2, -box.height / 2)
    ctx.scale(k, k)
    ctx.drawImage(await loadBitmap(assetUrl(art.url)), 0, 0, art.canvas.width, art.canvas.height)
    const faceUrl = faceAssetUrl(c)
    if (faceUrl) {
      const f = art.faceRect
      ctx.save()
      if (art.faceMask?.path) {
        ctx.clip(new Path2D(art.faceMask.path))
      } else {
        ctx.beginPath()
        ctx.ellipse(f.x + f.width / 2, f.y + f.height / 2, f.width / 2, f.height / 2, 0, 0, Math.PI * 2)
        ctx.clip()
      }
      ctx.drawImage(await loadBitmap(faceUrl), f.x, f.y, f.width, f.height)
      ctx.restore()
    }
    ctx.restore()
  }

  // 별명은 모든 캐릭터 위에 올린다(화면과 같다). 캐릭터 회전을 따라 같이 기운다.
  if (options.names) {
    await document.fonts?.ready
    for (const c of ordered) {
      const name = c.nickname.trim()
      if (!name) continue
      const box = spriteBox(c, { width: W, height: H })
      ctx.save()
      ctx.translate(box.left + box.width / 2, box.top + box.height / 2)
      ctx.rotate((c.rotation * Math.PI) / 180)
      drawLabel(ctx, name, -box.height / 2, W)
      ctx.restore()
    }
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('이미지 생성 실패'))), 'image/png')
  })
}

/**
 * 캐릭터 아래 별명 알약. 화면의 .sprite-name과 같은 모양이다.
 * 캐릭터 좌표계(중심 원점, 회전 적용) 안에서 그린다. top은 캐릭터 위 끝(y), 알약은 그 위에 놓인다.
 */
function drawLabel(ctx: CanvasRenderingContext2D, text: string, top: number, sceneWidth: number): void {
  const size = Math.max(12, Math.round(sceneWidth * 0.028))
  ctx.font = `700 ${size}px CookieRun, 'Noto Sans KR', system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const padX = size * 0.6
  const h = size * 1.6
  const w = ctx.measureText(text).width + padX * 2
  const y = top - size * 0.2 - h
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.strokeStyle = '#333333'
  ctx.lineWidth = Math.max(1, size * 0.08)
  ctx.beginPath()
  ctx.roundRect(-w / 2, y, w, h, h / 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#292929'
  ctx.fillText(text, 0, y + h / 2)
}

/** 업로드 배경 크기를 서버가 못 읽었으면 세로(디자인 기본 비율)로 본다. */
const FALLBACK_ASPECT = 491 / 815

export function backgroundAspect(bg: { width: number | null; height: number | null }): number {
  return bg.width && bg.height ? bg.width / bg.height : FALLBACK_ASPECT
}
