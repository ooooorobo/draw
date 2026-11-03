/**
 * 백엔드 전달 SDK(api-client.ts)를 이 프로젝트의 환경변수에 연결한다.
 *
 * api-client.ts는 백엔드가 전달한 파일이므로 직접 고치지 않는다(ApiError 한 군데 예외,
 * 해당 파일 주석 참고). 앱 코드는 이 모듈만 import 한다.
 */
import { RelayDrawClient } from './api-client.ts'

export * from './api-client.ts'

let cached: RelayDrawClient | undefined

/**
 * 환경변수 VITE_API_ORIGIN으로 클라이언트를 만든다. 최초 호출 때 한 번만 생성한다.
 *
 * origin에는 /api/v1을 붙이지 않는다. SDK가 경로를 직접 조립한다.
 * 모듈 로드 시점이 아니라 호출 시점에 검사해서, 환경변수가 없을 때
 * 앱 전체가 빈 화면이 되는 대신 호출한 화면에서 오류를 처리할 수 있게 한다.
 */
export function getApi(): RelayDrawClient {
  if (cached) return cached
  const origin = import.meta.env.VITE_API_ORIGIN
  if (!origin) {
    throw new Error(
      'VITE_API_ORIGIN이 없다. .env.example을 .env.local로 복사하고 개발 서버를 다시 실행한다.',
    )
  }
  cached = new RelayDrawClient(origin)
  return cached
}
