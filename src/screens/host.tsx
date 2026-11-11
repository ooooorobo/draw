import { useEffect, useRef, useState } from 'react'
import { getApi, type Catalog } from '../lib/relay-draw/client.ts'
import { roomLink } from '../lib/route.ts'
import { saveHostToken } from '../lib/session.ts'
import { useAsync } from '../lib/useAsync.ts'
import { ErrorBox, Field, Loading, NoteList, PasswordField, Screen, Stage } from './shell.tsx'
import { TITLE_MAX, type ScreenProps } from './types.ts'

/**
 * 방장 흐름 N01 → N02(→ N02P) → N03 → N03D.
 * 확정 시안: 시작 → 배경 선택 → 제목·관리 비밀번호 → 공통 링크 복사·공유.
 *
 * N03 시안은 N02 화면 아래에 제목·비밀번호 입력이 붙은 형태다. 그래서 배경 선택 줄(BackgroundPicker)을
 * 두 화면이 같이 쓴다. N03에서도 배경을 바꿀 수 있다.
 */

/** 시작 화면 배경. 시안의 `캐릭터 없는 파스텔 초원` 그대로다(public/figma). */
const START_BACKGROUND = '/figma/meadow.png'

/** 배경 선택 첫 칸의 카메라 아이콘. 시안의 `photo_camera` 그대로다. */
const CAMERA_ICON = '/figma/photo_camera.svg'

/** N01 · 시작. 배경 전면에 타이틀과 CTA만 올린다. */
export function Start({ nav }: ScreenProps) {
  return (
    <Screen
      variant="bleed"
      actions={
        <button type="button" onClick={() => nav('N02')}>
          시작하기
        </button>
      }
    >
      <img src={START_BACKGROUND} alt="" className="start-bg" />
      <h1 className="start-title">
        DRAWING
        <br />
        PARTY
      </h1>
    </Screen>
  )
}

/**
 * 배경 선택 줄. 첫 칸은 사진 올리기(카메라 아이콘), 나머지는 카탈로그 기본 배경이다.
 *
 * 시안의 `N02 방 만들기_이미지선택`(사진 선택 시트)은 OS가 그리는 화면이다.
 * capture 속성 없이 file input을 열면 모바일에서 "사진 찍기 / 사진 보관함" 선택지가 같이 뜬다.
 *
 * 배경 목록은 GET /api/v1/catalog에서 받는다. 칸 수를 고정하지 않고 카탈로그가 주는 만큼 그린다.
 * 아직 고른 배경이 없으면 첫 기본 배경을 골라둔다(시안 N02가 첫 배경이 선택된 상태로 시작한다).
 */
function BackgroundPicker({ nav, flow, patch }: ScreenProps) {
  const api = getApi()
  const catalog = useAsync((signal) => api.catalog(signal), [])
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)

  const first = catalog.state === 'ready' ? catalog.data.backgrounds[0] : undefined
  const needsDefault = flow.background === null && first !== undefined
  useEffect(() => {
    if (needsDefault && first) {
      patch({
        background: { type: 'preset', presetId: first.id },
        backgroundUrl: api.url(first.url),
      })
    }
  }, [needsDefault, first, api, patch])

  // 사진 업로드 → assetId/uploadToken을 받아 N02P에서 확인한다.
  const upload = async (file: File) => {
    setBusy(true)
    try {
      const result = await api.uploadBackground(file)
      patch({
        upload: {
          assetId: result.assetId,
          uploadToken: result.uploadToken,
          previewUrl: URL.createObjectURL(file),
        },
        lastError: null,
      })
      nav('N02P')
    } catch (error) {
      patch({ lastError: error instanceof Error ? error.message : String(error) })
      nav('E01')
    } finally {
      setBusy(false)
    }
  }

  const uploaded = flow.background?.type === 'upload'

  return (
    <div className="bg-picker">
      <p className="label">배경 선택</p>
      {catalog.state === 'loading' && <Loading label="배경 불러오는 중" />}
      {catalog.state === 'error' && (
        <ErrorBox message={catalog.error.message} onRetry={catalog.reload} />
      )}
      {catalog.state === 'ready' && (
        <div className="bg-row">
          <button
            type="button"
            className="bg-thumb"
            aria-label="사진 올리기"
            aria-pressed={uploaded}
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {uploaded && flow.backgroundUrl ? (
              <img src={flow.backgroundUrl} alt="" />
            ) : (
              <img src={CAMERA_ICON} alt="" className="bg-camera" />
            )}
          </button>
          {catalog.data.backgrounds.map((bg) => (
            <PresetThumb key={bg.id} bg={bg} flow={flow} patch={patch} />
          ))}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void upload(file)
        }}
      />
    </div>
  )
}

function PresetThumb({
  bg,
  flow,
  patch,
}: {
  bg: Catalog['backgrounds'][number]
  flow: ScreenProps['flow']
  patch: ScreenProps['patch']
}) {
  const api = getApi()
  const url = api.url(bg.url)
  return (
    <button
      type="button"
      className="bg-thumb"
      aria-label={bg.name}
      aria-pressed={flow.background?.type === 'preset' && flow.background.presetId === bg.id}
      onClick={() =>
        patch({ background: { type: 'preset', presetId: bg.id }, backgroundUrl: url, upload: null })
      }
    >
      <img src={url} alt="" />
    </button>
  )
}

/** N02 · 방 만들기(배경 선택). 고른 배경을 크게 본다. 가로·세로 사진 모두 비율 그대로 들어간다. */
export function CreateRoom(props: ScreenProps) {
  const { nav, flow } = props
  return (
    <Screen
      title="방 만들기"
      actions={
        <button type="button" disabled={!flow.background} onClick={() => nav('N03')}>
          다음
        </button>
      }
    >
      <Stage url={flow.backgroundUrl} />
      <BackgroundPicker {...props} />
    </Screen>
  )
}

/** N02P · 업로드 배경 확인. 기본 배경을 쓰면 생략되는 분기. */
export function BackgroundConfirm({ nav, flow, patch }: ScreenProps) {
  const pending = flow.upload

  if (!pending) {
    return (
      <Screen
        title="배경 확인"
        actions={
          <button type="button" onClick={() => nav('N02')}>
            배경 선택으로
          </button>
        }
      >
        <ErrorBox message="확인할 사진이 없어요." />
      </Screen>
    )
  }

  return (
    <Screen
      title="배경 확인"
      actions={
        <>
          <button
            type="button"
            onClick={() => {
              patch({ upload: null })
              nav('N02')
            }}
          >
            다시 선택
          </button>
          <button
            type="button"
            onClick={() => {
              patch({
                background: {
                  type: 'upload',
                  assetId: pending.assetId,
                  uploadToken: pending.uploadToken,
                },
                backgroundUrl: pending.previewUrl,
              })
              nav('N02')
            }}
          >
            사용하기
          </button>
        </>
      }
    >
      <Stage url={pending.previewUrl} />
      <p className="copy">이 배경을 사용할까요?</p>
    </Screen>
  )
}

/**
 * N03 · 방 만들기(제목·관리 비밀번호).
 *
 * 비밀번호는 서버로 보내지 않는다. API v0.2.0의 POST /rooms는 {title, background, sourceRoomId}만
 * 받고 관리 권한은 hostToken으로만 확인하기 때문이다(types.ts의 managePassword 주석 참고).
 * 지금은 방을 만든 브라우저에 보관한 hostToken이 관리 권한의 전부다.
 */
export function RoomSetup(props: ScreenProps) {
  const { nav, flow, patch } = props
  const [busy, setBusy] = useState(false)

  const title = flow.roomTitle.trim()
  const ready = flow.background !== null && title.length > 0 && flow.managePassword.length > 0

  const create = async () => {
    if (!flow.background || !ready) return
    setBusy(true)
    try {
      const created = await getApi().createRoom({ title, background: flow.background })
      // 관리 비밀번호를 서버가 모르므로, 관리 권한은 이 토큰이 전부다. 만든 브라우저에 보관한다.
      saveHostToken(created.roomId, created.hostToken)
      patch({ created, roomId: created.roomId, hostToken: created.hostToken, lastError: null })
      nav('N03D')
    } catch (error) {
      patch({ lastError: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen
      title="방 만들기"
      actions={
        <button type="button" disabled={!ready || busy} onClick={() => void create()}>
          {busy ? '만드는 중…' : '다음'}
        </button>
      }
    >
      <Stage url={flow.backgroundUrl} />
      <BackgroundPicker {...props} />

      <Field
        label="방 제목"
        value={flow.roomTitle}
        placeholder={`방 제목 최대 ${TITLE_MAX}자까지 입력`}
        maxLength={TITLE_MAX}
        onChange={(roomTitle) => patch({ roomTitle })}
      />

      <PasswordField
        label="방장 관리 비밀번호"
        value={flow.managePassword}
        placeholder="비밀번호 입력"
        onChange={(managePassword) => patch({ managePassword })}
      />

      {flow.lastError && <p className="error">{flow.lastError}</p>}
    </Screen>
  )
}

/**
 * N03D · 방 생성 완료.
 *
 * 확정 설계에서 관리 링크가 없어졌다. 참여도 관리도 같은 방 링크 하나로 들어간다.
 */
export function RoomCreated({ nav, flow }: ScreenProps) {
  const created = flow.created
  const [message, setMessage] = useState<string | null>(null)

  if (!created) {
    return (
      <Screen
        title="방 생성 완료!"
        hero
        actions={
          <button type="button" onClick={() => nav('N02')}>
            방 만들기로
          </button>
        }
      >
        <ErrorBox message="생성된 방 정보가 없어요." />
      </Screen>
    )
  }

  const joinUrl = roomLink(created.roomId)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl)
      setMessage('링크를 복사했어요')
    } catch {
      setMessage(`복사하지 못했어요. 링크: ${joinUrl}`)
    }
  }

  const share = async () => {
    // Web Share API가 없는 환경(데스크톱 브라우저 다수)에서는 복사로 대체한다.
    if (navigator.share) {
      try {
        await navigator.share({ title: created.title, url: joinUrl })
        void getApi().event({ roomId: created.roomId, type: 'share_click', channel: 'web-share' })
      } catch {
        // 사용자가 공유 시트를 닫은 경우. 오류가 아니다.
      }
      return
    }
    await copy()
  }

  return (
    <Screen
      title="방 생성 완료!"
      hero
      sub={`<${created.title}>`}
      largeSub
      actions={
        <>
          <button type="button" onClick={() => void copy()}>
            링크 복사
          </button>
          <button type="button" onClick={() => void share()}>
            링크 공유
          </button>
        </>
      }
    >
      <Stage url={flow.backgroundUrl} />
      <NoteList
        items={['개설 후 일주일 동안 참여 가능', '같은 방 링크에서 비밀번호로 관리할 수 있어요.']}
      />
      {message && <p className="ok">{message}</p>}
    </Screen>
  )
}
