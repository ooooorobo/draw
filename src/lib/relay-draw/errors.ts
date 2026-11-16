/**
 * API 오류 → 화면 처리 규칙.
 *
 * 화면 ID는 Figma 최종 디자인(MVP v4) 기준이다. src/screens의 ScreenId와 철자가 같게 둔다.
 * 오류 코드는 서버 OpenAPI와 실제 응답에서 확인한 것만 이름으로 다루고,
 * 나머지는 HTTP 상태로 판단한다.
 */
import { ApiError } from './api-client.ts'

export type FlowScreen =
  | 'N01' | 'N02' | 'N02P' | 'N03'
  | 'N04' | 'N04L' | 'N04M' | 'N05' | 'N06' | 'N06C' | 'N07' | 'N09' | 'N09R'
  | 'N10' | 'N10C' | 'N11'
  | 'E01' | 'E02' | 'E03'

/** 서버가 실제로 내려주는 것으로 확인한 코드. */
export const ERROR_CODES = {
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND', // 404
  INVALID_ID: 'INVALID_ID', // 400
  ROOM_EXPIRED: 'ROOM_EXPIRED', // 410 (생성 14일 후, 파일 보관 종료)
  ROOM_CLOSED: 'ROOM_CLOSED', // 409 (생성 7일 후, 참여 종료)
  SCENE_CHANGED: 'SCENE_CHANGED', // 409 결과 저장 중 장면 버전 변경
  RESULT_EXISTS: 'RESULT_EXISTS', // 409 같은 버전 결과 중복 저장
} as const

/**
 * 화면이 오류를 어떻게 처리할지.
 *   - goto: 다른 화면으로 보낸다.
 *   - inline: 현재 화면에 메시지만 띄운다(입력 오류, 비밀번호 틀림 등).
 *   - retry: 현재 화면에서 다시 시도하게 한다(네트워크·5xx·429).
 */
export type ErrorAction =
  | { kind: 'goto'; screen: FlowScreen }
  | { kind: 'inline'; message: string }
  | { kind: 'retry'; message: string }

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

/** 사용자에게 보여줄 문구. 서버 message가 한국어 사용자용이라 그대로 쓴다. */
export function errorMessage(error: unknown): string {
  if (isApiError(error)) {
    if (error.status === 413) return '파일이 너무 커요. 10MB 이하로 올려 주세요.'
    if (error.status === 429) return '요청이 많아요. 잠시 후 다시 시도해 주세요.'
    if (error.status >= 500) return '잠시 문제가 생겼어요. 다시 시도해 주세요.'
    return error.message
  }
  return '네트워크 연결을 확인하고 다시 시도해 주세요.'
}

function transient(error: unknown): boolean {
  return !isApiError(error) || error.status === 429 || error.status >= 500
}

/** 방 자체가 없거나 못 쓰는 경우. 어느 화면이든 같은 처리다. */
function roomGone(error: unknown): FlowScreen | null {
  if (!isApiError(error)) return null
  if (error.status === 404 && error.code === ERROR_CODES.ROOM_NOT_FOUND) return 'E03'
  if (error.status === 400 && error.code === ERROR_CODES.INVALID_ID) return 'E03'
  // 만료 방은 결과도 못 본다(scene 410). 디자인에 만료 화면이 없어 E03으로 보낸다.
  if (error.status === 410 && error.code === ERROR_CODES.ROOM_EXPIRED) return 'E03'
  // 참여 기간 종료. 결과는 볼 수 있다.
  if (error.status === 409 && error.code === ERROR_CODES.ROOM_CLOSED) return 'N11'
  return null
}

/** 진입·조회(N04, N09, N09R, N11 등)에서 room/scene 조회 실패. */
export function onLoadError(error: unknown): ErrorAction {
  const screen = roomGone(error)
  if (screen) return { kind: 'goto', screen }
  return { kind: 'retry', message: errorMessage(error) }
}

/** N02/N02P 사진 배경 업로드 실패 → E01. 크기 초과만 화면에 남는다. */
export function onUploadError(error: unknown): ErrorAction {
  if (isApiError(error) && error.status === 413) return { kind: 'inline', message: errorMessage(error) }
  return { kind: 'goto', screen: 'E01' }
}

/**
 * N02 방 생성 실패. 업로드 토큰 만료(1시간)·업로드 배경 삭제는 E01로 다시 고르게 한다.
 * 그 외 400은 입력 오류라 화면에 남는다.
 */
export function onCreateRoomError(error: unknown, usedUpload: boolean): ErrorAction {
  if (usedUpload && isApiError(error) && (error.status === 403 || error.status === 410)) {
    return { kind: 'goto', screen: 'E01' }
  }
  if (transient(error)) return { kind: 'retry', message: errorMessage(error) }
  return { kind: 'inline', message: errorMessage(error) }
}

/** N06C 확정(캐릭터 DRAFT 생성) 실패. */
export function onCreateCharacterError(error: unknown): ErrorAction {
  const screen = roomGone(error)
  if (screen) return { kind: 'goto', screen }
  if (transient(error)) return { kind: 'retry', message: errorMessage(error) }
  return { kind: 'inline', message: errorMessage(error) }
}

/**
 * N07 제출 실패. 방이 닫혔으면 N11, 없으면 E03, 그 외는 E02(그림·위치 유지 후 재등록).
 * E02에서 재등록할 때 같은 Idempotency-Key·같은 파일을 써야 한다(screens.ts의 submitPlacement가 보장).
 */
export function onSubmitError(error: unknown): ErrorAction {
  const screen = roomGone(error)
  if (screen) return { kind: 'goto', screen }
  return { kind: 'goto', screen: 'E02' }
}

/**
 * N04M 관리 비밀번호 확인 실패.
 * 비밀번호 틀림은 403으로 온다고 가정한다(서버 문서는 "토큰 누락·권한 없음"만 명시, 실측 안 함).
 */
export function onAdminAuthError(error: unknown): ErrorAction {
  const screen = roomGone(error)
  if (screen) return { kind: 'goto', screen }
  if (isApiError(error) && (error.status === 403 || error.status === 400)) {
    return { kind: 'inline', message: '비밀번호가 맞지 않아요.' }
  }
  return { kind: 'retry', message: errorMessage(error) }
}

/** N10/N10C 관리 API 실패. 세션 만료(403)는 N04M으로 돌려보내 다시 인증받는다. */
export function onAdminError(error: unknown): ErrorAction {
  const screen = roomGone(error)
  if (screen) return { kind: 'goto', screen }
  if (isApiError(error) && error.status === 403) return { kind: 'goto', screen: 'N04M' }
  return { kind: 'retry', message: errorMessage(error) }
}
