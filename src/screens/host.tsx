import { useEffect, useRef, useState } from 'react'
import heroBg from '../assets/bg-meadow.png'
import cameraIcon from '../assets/icon-camera.svg'
import { ADMIN_PASSWORD_MIN } from '../lib/relay-draw/api-v2.ts'
import { onCreateRoomError, onUploadError } from '../lib/relay-draw/errors.ts'
import { useAction, useAsync } from '../lib/relay-draw/hooks.ts'
import { roomLink } from '../lib/relay-draw/entry.ts'
import { assetUrl, createRoom, loadBackgrounds, shareRoom, uploadBackground } from '../lib/relay-draw/screens.ts'
import { ScenePreview } from './scene.tsx'
import type { FlowState, ScreenProps } from './types.ts'
import { Body, Cta, Field, Foot, Head, Page } from './ui.tsx'

/** 방 제목 최대 길이. 서버는 80자까지 받지만 디자인 안내 문구가 14자다. */
const TITLE_MAX = 14

/** N01 / 방장 ① — 시작. */
export function Start({ nav }: ScreenProps) {
  return (
    <Page variant="hero">
      <img className="hero-bg" src={heroBg} alt="" />
      <h1 className="hero-title">
        DRAWING
        <br />
        PARTY
      </h1>
      <Foot>
        <Cta onClick={() => nav('N02')}>시작하기</Cta>
      </Foot>
    </Page>
  )
}

/** 사진 선택 → N02P. 카메라/갤러리 선택은 OS 시트가 띄운다. */
function usePhotoPicker({ nav, patch, flow }: Pick<ScreenProps, 'nav' | 'patch' | 'flow'>) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const input = (
    <input
      ref={inputRef}
      className="visually-hidden"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      tabIndex={-1}
      onChange={async (e) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (!file) return
        try {
          const bitmap = await createImageBitmap(file)
          if (flow.pendingPhoto) URL.revokeObjectURL(flow.pendingPhoto.url)
          patch({
            pendingPhoto: { file, url: URL.createObjectURL(file), width: bitmap.width, height: bitmap.height },
          })
          bitmap.close()
          nav('N02P')
        } catch {
          // 브라우저가 못 여는 형식(HEIC 등). 서버도 못 받으니 E01로 보낸다.
          nav('E01')
        }
      }}
    />
  )
  return { open: () => inputRef.current?.click(), input }
}

function previewOf(bg: FlowState['background']) {
  return bg && { url: '', previewUrl: bg.previewUrl, width: bg.width, height: bg.height }
}

/**
 * N02 / 방장 ② — 방 만들기.
 * 1단계: 배경 선택 → "다음" → 2단계: 방 제목·관리 비밀번호 → "다음" → 방 생성 → N03.
 */
export function CreateRoom({ nav, flow, patch, toast }: ScreenProps) {
  const [step, setStep] = useState<'background' | 'details'>(flow.title ? 'details' : 'background')
  const [password, setPassword] = useState('')
  const backgrounds = useAsync(() => loadBackgrounds(), [])
  const picker = usePhotoPicker({ nav, patch, flow })
  const create = useAction(createRoom)
  const [error, setError] = useState<string | null>(null)

  // 처음 들어오면 첫 기본 배경을 골라 둔다(디자인 진입 상태).
  const first = backgrounds.data?.[0]
  useEffect(() => {
    if (!flow.background && first) {
      patch({
        background: {
          choice: { type: 'preset', presetId: first.id },
          previewUrl: assetUrl(first.url),
          width: first.width,
          height: first.height,
        },
      })
    }
  }, [first, flow.background, patch])

  const uploaded = flow.background?.choice.type === 'upload' ? flow.background : null
  const title = flow.title.trim()
  const ready = title.length > 0 && password.length >= ADMIN_PASSWORD_MIN && !!flow.background

  const submit = async () => {
    if (!ready || !flow.background) return
    setError(null)
    try {
      const created = await create.run({ title, background: flow.background.choice, adminPassword: password })
      patch({ created })
      nav('N03')
    } catch (e) {
      const action = onCreateRoomError(e, !!uploaded)
      if (action.kind === 'goto') nav(action.screen)
      else if (action.kind === 'retry') toast(action.message)
      else setError(action.message)
    }
  }

  const preview = previewOf(flow.background)

  return (
    <Page>
      <Head title="방 만들기" />
      <Body>
        {preview ? (
          <ScenePreview background={preview} maxHeight={step === 'background' ? 492 : 302} />
        ) : (
          <div className="stage" />
        )}

        <div className="field">
          <span className="field-label">배경 선택</span>
          <div className="picker">
            <button type="button" className="thumb" aria-label="사진 가져오기" onClick={picker.open}>
              <img className="thumb-icon" src={cameraIcon} alt="" />
            </button>
            {uploaded && (
              <button type="button" className="thumb" aria-pressed="true" aria-label="가져온 사진">
                <img src={uploaded.previewUrl} alt="" />
              </button>
            )}
            {backgrounds.data?.map((bg) => {
              const selected = flow.background?.choice.type === 'preset' && flow.background.choice.presetId === bg.id
              return (
                <button
                  key={bg.id}
                  type="button"
                  className="thumb"
                  aria-pressed={selected}
                  aria-label={bg.name}
                  onClick={() =>
                    patch({
                      background: {
                        choice: { type: 'preset', presetId: bg.id },
                        previewUrl: assetUrl(bg.url),
                        width: bg.width,
                        height: bg.height,
                      },
                    })
                  }
                >
                  <img src={assetUrl(bg.url)} alt="" />
                </button>
              )
            })}
          </div>
          {picker.input}
        </div>

        {step === 'details' && (
          <>
            <Field
              label="방 제목"
              value={flow.title}
              placeholder={`방 제목 최대 ${TITLE_MAX}자까지 입력`}
              maxLength={TITLE_MAX}
              onChange={(v) => patch({ title: v })}
            />
            <Field
              label="방장 관리 비밀번호"
              type="password"
              value={password}
              placeholder={`비밀번호 최소 ${ADMIN_PASSWORD_MIN}자리 이상 입력`}
              maxLength={64}
              error={error}
              onChange={setPassword}
              onEnter={submit}
            />
          </>
        )}
      </Body>
      <Foot>
        {step === 'background' ? (
          <Cta disabled={!flow.background} onClick={() => setStep('details')}>
            다음
          </Cta>
        ) : (
          <Cta disabled={!ready || create.pending} onClick={submit}>
            {create.pending ? '만드는 중…' : '다음'}
          </Cta>
        )}
      </Foot>
    </Page>
  )
}

/** N02P / 업로드 배경 확인. "사용하기"를 누를 때 업로드한다. */
export function BackgroundConfirm({ nav, flow, patch, toast }: ScreenProps) {
  const picker = usePhotoPicker({ nav, patch, flow })
  const upload = useAction(uploadBackground)
  const photo = flow.pendingPhoto

  if (!photo) {
    return <Missing onBack={() => nav('N02')} />
  }

  const use = async () => {
    try {
      const { choice, upload: up } = await upload.run(photo.file)
      patch({
        background: {
          choice,
          previewUrl: photo.url,
          width: up.width || photo.width,
          height: up.height || photo.height,
        },
      })
      nav('N02')
    } catch (e) {
      const action = onUploadError(e)
      if (action.kind === 'goto') nav(action.screen)
      else toast(action.message)
    }
  }

  return (
    <Page>
      <Head title="배경 확인" />
      <Body gap={32}>
        <ScenePreview
          background={{ url: '', previewUrl: photo.url, width: photo.width, height: photo.height }}
          maxHeight={488}
        />
        <p className="text">이 배경을 사용할까요?</p>
      </Body>
      <Foot>
        <Cta onClick={picker.open} disabled={upload.pending}>
          다시 선택
        </Cta>
        <Cta onClick={use} disabled={upload.pending}>
          {upload.pending ? '올리는 중…' : '사용하기'}
        </Cta>
      </Foot>
      {picker.input}
    </Page>
  )
}

/** N03 / 방 생성 완료. 링크 하나로 참여와 관리(비밀번호)를 같이 한다. */
export function RoomCreated({ flow, toast }: ScreenProps) {
  const created = flow.created
  const preview = previewOf(flow.background)
  if (!created || !preview) return <Missing />

  const link = roomLink(created.roomId, created.roomUrl)
  const share = async (mode: 'copy' | 'share') => {
    try {
      const result = await shareRoom(created.roomId, link, mode)
      if (result === 'copied') toast('링크를 복사했어요.')
    } catch {
      toast('링크를 복사하지 못했어요.')
    }
  }

  return (
    <Page>
      <Head title="방 생성 완료!" size="xl" sub={<span className="text--lead">{`<${created.title}>`}</span>} />
      <Body>
        <ScenePreview background={preview} maxHeight={486} />
        <ul className="bullets">
          <li>개설 후 일주일 동안 참여 가능</li>
          <li>같은 방 링크에서 비밀번호로 관리할 수 있어요.</li>
        </ul>
      </Body>
      <Foot>
        <Cta onClick={() => share('copy')}>링크 복사</Cta>
        <Cta onClick={() => share('share')}>링크 공유</Cta>
      </Foot>
    </Page>
  )
}

/** E01 / 배경 업로드 실패. */
export function UploadFailed({ nav, flow, patch }: ScreenProps) {
  const picker = usePhotoPicker({ nav, patch, flow })
  const photo = flow.pendingPhoto
  const preview = photo
    ? { url: '', previewUrl: photo.url, width: photo.width, height: photo.height }
    : { url: '', previewUrl: heroBg, width: 491, height: 815 }

  return (
    <Page>
      <Head title="사진을 불러오지 못했어요" />
      <Body gap={54}>
        <ScenePreview background={preview} maxHeight={360} />
        <p className="text">다른 사진을 선택하거나 다시 시도해 주세요.</p>
      </Body>
      <Foot>
        <Cta onClick={picker.open}>다시 선택</Cta>
        <Cta
          onClick={() => {
            // 업로드 사진을 버리고 기본 배경 목록으로. N02가 첫 기본 배경을 다시 골라 둔다.
            if (flow.background?.choice.type === 'upload') patch({ background: null })
            patch({ pendingPhoto: null })
            nav('N02')
          }}
        >
          기본 배경 선택
        </Cta>
      </Foot>
      {picker.input}
    </Page>
  )
}

/** 새로고침 등으로 흐름 상태를 잃었을 때. 디자인에 없는 상태라 최소한만 둔다. */
export function Missing({ onBack }: { onBack?: () => void }) {
  return (
    <Page>
      <div className="loading">정보를 다시 불러와 주세요.</div>
      {onBack && (
        <Foot>
          <Cta onClick={onBack}>돌아가기</Cta>
        </Foot>
      )}
    </Page>
  )
}
