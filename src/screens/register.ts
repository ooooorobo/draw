import type { Spot } from '../lib/placement.ts'
import { roundSpot } from '../lib/placement.ts'
import type { RelayDrawClient } from '../lib/relay-draw/client.ts'
import { markRegistered, newIdempotencyKey } from '../lib/session.ts'
import { errorMessage } from '../lib/useAsync.ts'
import type { PoseChoice, ScreenProps } from './types.ts'

/**
 * 등록. 캐릭터 생성(DRAFT) → 얼굴·배치 제출. 성공하면 N09, 실패하면 E02.
 *
 * 배치 화면(N07)과 등록 실패 화면(E02 "다시 등록")이 같이 쓴다.
 * 제출값은 여기서 고정한다. 재시도에도 같은 DRAFT·같은 metadata·같은 멱등 키를 보내야
 * 등록이 1회로 유지된다(서버 확인: 같은 키 재요청은 replayed=true).
 */
export async function registerCharacter({
  api,
  flow,
  patch,
  nav,
  choice,
  spot,
}: ScreenProps & { api: RelayDrawClient; choice: PoseChoice; spot: Spot }): Promise<void> {
  if (!flow.roomId || !flow.face) return

  const spotToSend = roundSpot(spot)
  const idempotencyKey = flow.idempotencyKey ?? newIdempotencyKey()
  const nickname = flow.nickname.trim()

  try {
    const draft =
      flow.draft ??
      (await api.createCharacter(flow.roomId, {
        presetId: choice.presetId,
        poseId: choice.pose.id,
        // 서버 기본값이 "참여자"다. 빈 문자열은 400이라 비었으면 아예 보내지 않는다.
        ...(nickname ? { nickname } : {}),
      }))
    // 제출이 실패해도 같은 DRAFT로 재시도하도록 먼저 남긴다.
    patch({ draft, idempotencyKey, placement: spotToSend })

    await api.submit(draft, flow.face, spotToSend, idempotencyKey, flow.replay ?? undefined)

    // 재방문 화면(N09R) 판정용 기록. 제출이 성공한 뒤에만 남긴다.
    markRegistered(flow.roomId, draft.characterId)
    patch({ lastError: null })
    nav('N09')
  } catch (error) {
    patch({
      lastError: errorMessage(error instanceof Error ? error : new Error(String(error))),
      idempotencyKey,
      placement: spotToSend,
    })
    nav('E02')
  }
}
