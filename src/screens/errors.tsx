import { Screen } from './shell.tsx'
import type { ScreenProps } from './types.ts'

/**
 * 예외 상태 E01~E04.
 * API 연동 전에는 실제 실패를 만들 수 없어서 개발용 화면 이동으로만 도달한다.
 */

/** E01 / 예외 ① — 배경 업로드 실패. N02 또는 N02P로 복귀. */
export function UploadFailed({ nav }: ScreenProps) {
  return (
    <Screen
      title="배경 업로드 실패"
      sub="사진을 불러오지 못했어요."
      note="다른 사진을 선택하거나 다시 시도해주세요."
      actions={
        <>
          <button type="button" onClick={() => nav('N02P')}>
            다시 선택
          </button>
          <button type="button" onClick={() => nav('N02')}>
            기본 배경 선택
          </button>
        </>
      }
    />
  )
}

/** E02 / 예외 ② — 등록 실패. 그림·위치 유지 권장. */
export function RegisterFailed({ nav }: ScreenProps) {
  return (
    <Screen
      title="등록 실패"
      sub="등록하지 못했어요."
      note="중복 요청에서도 등록 1회"
      actions={
        <>
          <button type="button" onClick={() => nav('N07')}>
            다시 등록
          </button>
          <button type="button" onClick={() => nav('N07')}>
            배치로 돌아가기
          </button>
        </>
      }
    />
  )
}

/** E03 / 예외 ③ — 잘못된 참여 링크. 유효한 종료 링크는 오류 대신 N11. */
export function BadJoinLink({ nav }: ScreenProps) {
  return (
    <Screen
      title="잘못된 참여 링크"
      sub="방을 찾을 수 없어요."
      note="공유받은 링크를 다시 확인해주세요."
      actions={
        <button type="button" onClick={() => nav('N01')}>
          시작 화면으로
        </button>
      }
    />
  )
}

/** E04 / 예외 ④ — 관리 링크 오류. 참여 링크에는 관리 권한이 없다. */
export function BadManageLink({ nav }: ScreenProps) {
  return (
    <Screen
      title="관리 링크 오류"
      sub="관리 권한을 확인할 수 없어요."
      note="방 생성 시 받은 관리 링크로 접속해주세요. 복구 기능은 제공하지 않습니다."
      actions={
        <button type="button" onClick={() => nav('N01')}>
          시작 화면으로
        </button>
      }
    />
  )
}
