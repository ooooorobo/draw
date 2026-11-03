/** Copy into the frontend. This module has no server dependencies. */
export type RoomStatus = "OPEN" | "CLOSED" | "EXPIRED";
export type BackgroundChoice =
  | { type: "preset"; presetId: string }
  | { type: "upload"; assetId: string; uploadToken: string };
export type BackgroundView =
  | { type: "preset"; presetId: string; url: string }
  | { type: "upload"; assetId: string; url: string };
export interface RoomSummary {
  roomId: string;
  title: string;
  status: RoomStatus;
  version: number;
  createdAt: string;
  closesAt: string;
  expiresAt: string;
  serverNow: string;
  characterCount: number;
  background: BackgroundView;
}
export interface Asset {
  id: string;
  kind: string;
  mime: string;
  size: number;
  url: string;
  characterId?: string | null;
  sceneVersion?: number | null;
}
export interface PlacedCharacter {
  id: string;
  nickname: string;
  presetId: string;
  poseId: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  zIndex: number;
  placedAt: string;
  assets: Asset[];
}
export interface Scene extends RoomSummary {
  characters: PlacedCharacter[];
  resultAssets: Asset[];
}
export interface Placement {
  x: number;
  y: number;
  scale?: number;
  rotation?: number;
}
export interface Draft {
  characterId: string;
  characterToken: string;
  status: "DRAFT";
  createdAt: string;
  closesAt: string;
}
export interface RoomCreated {
  roomId: string;
  title: string;
  roomUrl: string;
  hostUrl: string;
  hostToken: string;
  createdAt: string;
  closesAt: string;
  expiresAt: string;
}
export interface BackgroundUpload {
  assetId: string;
  uploadToken: string;
  uploadExpiresAt: string;
}
export interface Catalog {
  assetVersion: number;
  sampleArtwork: boolean;
  backgrounds: { id: string; name: string; url: string }[];
  characters: {
    id: string;
    name: string;
    poses: {
      id: string;
      name: string;
      url: string;
      canvas: { width: number; height: number };
      faceRect: { x: number; y: number; width: number; height: number };
    }[];
  }[];
}
export class ApiError extends Error {
  // 파라미터 프로퍼티는 이 프로젝트의 erasableSyntaxOnly와 충돌해서 풀어 썼다.
  // 백엔드가 api-client.ts를 갱신해 재복사할 때 이 부분만 다시 적용한다.
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}
export class RelayDrawClient {
  readonly origin: string;
  constructor(origin: string) {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol) || url.pathname !== "/")
      throw new Error("Use the API origin, without /api/v1");
    this.origin = url.origin;
  }
  private async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(this.url(path), init);
    const data = await res.json().catch(() => null);
    if (!res.ok)
      throw new ApiError(
        res.status,
        data?.code ?? "HTTP_ERROR",
        data?.message ?? `HTTP ${res.status}`,
      );
    return data as T;
  }
  url(path: string) {
    const url = new URL(path, this.origin);
    if (url.origin !== this.origin)
      throw new Error("Cross-origin API asset URL rejected");
    return url.href;
  }
  catalog(signal?: AbortSignal) {
    return this.json<Catalog>("/api/v1/catalog", { signal });
  }
  room(roomId: string, signal?: AbortSignal) {
    return this.json<RoomSummary>(
      `/api/v1/rooms/${encodeURIComponent(roomId)}`,
      { signal },
    );
  }
  scene(roomId: string, signal?: AbortSignal) {
    return this.json<Scene>(
      `/api/v1/rooms/${encodeURIComponent(roomId)}/scene`,
      { signal },
    );
  }
  createRoom(input: {
    title: string;
    background: BackgroundChoice;
    sourceRoomId?: string;
  }) {
    return this.json<RoomCreated>("/api/v1/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  }
  uploadBackground(file: Blob) {
    const form = new FormData();
    form.append("background", file, "background");
    return this.json<BackgroundUpload>("/api/v1/background-uploads", {
      method: "POST",
      body: form,
    });
  }
  createCharacter(
    roomId: string,
    input: { nickname?: string; presetId: string; poseId: string },
  ) {
    return this.json<Draft>(
      `/api/v1/rooms/${encodeURIComponent(roomId)}/characters`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  }
  submit(
    draft: Draft,
    face: Blob,
    position: Placement,
    idempotencyKey: string,
    replay?: Blob,
  ) {
    const form = new FormData();
    form.append("face", face, "face");
    if (replay) form.append("replay", replay, "replay");
    form.append("metadata", JSON.stringify(position));
    return this.json<{
      characterId: string;
      status: "PLACED";
      version: number;
      replayed: boolean;
    }>(
      `/api/v1/characters/${encodeURIComponent(draft.characterId)}/submission`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${draft.characterToken}`,
          "idempotency-key": idempotencyKey,
        },
        body: form,
      },
    );
  }
  deleteCharacter(roomId: string, characterId: string, hostToken: string) {
    return this.json<{ deleted: true }>(
      `/api/v1/rooms/${encodeURIComponent(roomId)}/characters/${encodeURIComponent(characterId)}`,
      { method: "DELETE", headers: { authorization: `Bearer ${hostToken}` } },
    );
  }
  saveResult(
    roomId: string,
    version: number,
    files: { image?: Blob; animation?: Blob },
  ) {
    if (!files.image && !files.animation)
      throw new Error("A result file is required");
    const form = new FormData();
    if (files.image) form.append("result-image", files.image, "result-image");
    if (files.animation)
      form.append("result-animation", files.animation, "result-animation");
    form.append("metadata", JSON.stringify({ version }));
    return this.json<{ version: number; assets: Asset[] }>(
      `/api/v1/rooms/${encodeURIComponent(roomId)}/result-assets`,
      { method: "POST", body: form },
    );
  }
  async assetBlob(asset: Pick<Asset, "url" | "mime">, uploadToken?: string) {
    const res = await fetch(this.url(asset.url), {
      headers: uploadToken ? { authorization: `Bearer ${uploadToken}` } : {},
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new ApiError(
        res.status,
        data?.code ?? "HTTP_ERROR",
        data?.message ?? `HTTP ${res.status}`,
      );
    }
    return new Blob([await res.arrayBuffer()], { type: asset.mime });
  }
  share(roomId: string) {
    return this.json<RoomSummary & { message: string }>(
      `/api/v1/rooms/${encodeURIComponent(roomId)}/share`,
    );
  }
  event(input: {
    roomId: string;
    type: "share_click" | "link_visit" | "result_view" | "room_conversion";
    visitorId?: string;
    channel?: string;
  }) {
    return this.json<{ recorded: true }>("/api/v1/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  }
}
