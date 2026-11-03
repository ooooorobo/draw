/**
 * 백엔드 연동 확인 스크립트. `npm run check:api`로 실행한다.
 *
 * .env.local의 VITE_API_ORIGIN을 그대로 읽어서, 프론트가 실제로 쓸 주소가
 * 살아있는지와 응답이 전달받은 SDK 타입과 맞는지 확인한다.
 * 방을 만들지 않는 읽기 전용 요청만 보낸다.
 */
import { readFileSync } from 'node:fs'

function readEnvOrigin() {
  if (process.env.VITE_API_ORIGIN) return process.env.VITE_API_ORIGIN
  for (const file of ['.env.local', '.env.example']) {
    try {
      const line = readFileSync(file, 'utf8')
        .split('\n')
        .find((l) => l.trim().startsWith('VITE_API_ORIGIN='))
      if (line) return line.slice(line.indexOf('=') + 1).trim()
    } catch {
      // 다음 파일을 본다.
    }
  }
  throw new Error('VITE_API_ORIGIN을 찾지 못했다. .env.local을 만든다.')
}

const origin = readEnvOrigin()
let failed = 0

function report(ok, name, detail) {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function get(path) {
  const res = await fetch(new URL(path, origin))
  const body = await res.json().catch(() => null)
  return { res, body }
}

console.log(`API origin: ${origin}\n`)

// 1. 서버 준비 상태.
try {
  const { res, body } = await get('/ready')
  report(
    res.ok && body?.status === 'ok',
    'GET /ready',
    `status=${body?.status} apiVersion=${body?.apiVersion}`,
  )
} catch (error) {
  report(false, 'GET /ready', error.message)
}

// 2. 카탈로그. 방 만들기 화면이 배경·캐릭터·포즈 ID를 여기서 받는다.
try {
  const { res, body } = await get('/api/v1/catalog')
  const poses = body?.characters?.flatMap((c) => c.poses) ?? []
  report(
    res.ok && body?.backgrounds?.length > 0 && poses.length > 0,
    'GET /api/v1/catalog',
    `배경 ${body?.backgrounds?.length}종 / 캐릭터 ${body?.characters?.length}종 / 포즈 ${poses.length}개 / sampleArtwork=${body?.sampleArtwork}`,
  )

  // SDK 타입(Catalog)이 선언한 필드가 실제 응답에 있는지 본다.
  const pose = poses[0]
  const hasShape =
    typeof pose?.canvas?.width === 'number' &&
    typeof pose?.canvas?.height === 'number' &&
    typeof pose?.faceRect?.x === 'number' &&
    typeof pose?.faceRect?.width === 'number'
  report(
    hasShape,
    'catalog 응답이 SDK 타입과 일치 (canvas/faceRect)',
    hasShape
      ? `예: ${pose.id} canvas ${pose.canvas.width}x${pose.canvas.height}`
      : '얼굴 합성에 필요한 canvas/faceRect가 없다',
  )
} catch (error) {
  report(false, 'GET /api/v1/catalog', error.message)
}

// 3. 문서에 적힌 샘플 방. 상태 계약(OPEN 조회 / EXPIRED 410)을 확인한다.
try {
  const { res, body } = await get(
    '/api/v1/rooms/0c26181a-0dbc-4cb9-8874-1ae173fb2c7b',
  )
  report(
    res.ok && typeof body?.version === 'number',
    'GET /api/v1/rooms/:id (샘플 OPEN 방)',
    `status=${body?.status} version=${body?.version} characterCount=${body?.characterCount}`,
  )
} catch (error) {
  report(false, 'GET /api/v1/rooms/:id', error.message)
}

try {
  const { res, body } = await get(
    '/api/v1/rooms/8e6a01e4-9574-4e55-952f-48d4dfc283c3',
  )
  report(
    res.status === 410,
    '만료 방이 410으로 응답 (오류 계약)',
    `HTTP ${res.status} code=${body?.code}`,
  )
} catch (error) {
  report(false, '만료 방 410 확인', error.message)
}

// 4. 개발 서버 origin의 CORS preflight. 브라우저에서 호출 가능한지 결정한다.
const devOrigin = 'http://localhost:5173'
try {
  const res = await fetch(new URL('/api/v1/rooms', origin), {
    method: 'OPTIONS',
    headers: {
      origin: devOrigin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type,idempotency-key',
    },
  })
  const allow = res.headers.get('access-control-allow-origin')
  report(
    allow === devOrigin || allow === '*',
    `CORS preflight (${devOrigin})`,
    `allow-origin=${allow ?? '없음'}`,
  )
} catch (error) {
  report(false, 'CORS preflight', error.message)
}

console.log(failed === 0 ? '\n연동 준비 확인 완료.' : `\n실패 ${failed}건.`)
process.exitCode = failed === 0 ? 0 : 1
