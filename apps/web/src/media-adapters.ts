import { api } from "./api";

export type MediaAlbumKind = "photos" | "backgrounds";
export type MediaAlbum = { id: string; name: string; kind: MediaAlbumKind; revision: number; owner: boolean; permissions: { read: boolean; upload: boolean; manage: boolean }; assetCount: number };
export type MediaAsset = { id: string; albumId: string; kind: MediaAlbumKind; revision: number; title: string; description: string; mimeType: "image/webp"; sourceMimeType?: string; width: number; height: number; storedBytes?: number; createdAt?: string; updatedAt?: string; url: string; previewUrl: string };
export type MediaAlbumGrant = { membershipId: string | null; householdWide: boolean; displayName: string | null; permissions: { read: boolean; upload: boolean; manage: boolean } };
export type MediaDisplayGrant = { displayId: string; displayName: string; revision: number; permissions: { read: boolean; upload: boolean } };
export type MediaBackground = { background: MediaAsset | null; revision: number };
export type DisplayMediaProjection = { albums: Array<{ id: string; name: string; asset_count: number }>; assets: MediaAsset[]; background: MediaAsset | null; householdBackground: MediaAsset | null };

export interface MemberMediaAdapter {
  readonly scopeKey: string;
  listAlbums(): Promise<{ albums: MediaAlbum[] }>;
  createAlbum(input: { name: string; kind: MediaAlbumKind }): Promise<MediaAlbum>;
  updateAlbum(id: string, input: { expectedRevision: number; name: string }): Promise<unknown>;
  deleteAlbum(id: string, expectedRevision: number): Promise<unknown>;
  listAssets(albumId: string): Promise<{ assets: MediaAsset[] }>;
  uploadAsset(albumId: string, input: { title: string; description: string; imageBase64: string }): Promise<{ asset: MediaAsset; remaining: { assets: number; bytes: number } }>;
  updateAsset(id: string, input: { expectedRevision: number; title: string; description: string }): Promise<unknown>;
  deleteAsset(id: string, expectedRevision: number): Promise<unknown>;
  albumGrants(albumId: string): Promise<{ album: Pick<MediaAlbum, "id" | "name" | "kind" | "revision">; memberGrants: MediaAlbumGrant[]; displayGrants: MediaDisplayGrant[] }>;
  setGrant(albumId: string, input: { expectedRevision: number; membershipId: string | null; householdWide: boolean; canRead: boolean; canUpload: boolean; canManage: boolean; revoke?: boolean }): Promise<unknown>;
  setDisplayGrant(albumId: string, displayId: string, input: { expectedRevision: number | null; canRead: boolean; canUpload: boolean; revoke?: boolean }): Promise<unknown>;
  householdBackground(): Promise<MediaBackground>;
  setHouseholdBackground(input: { expectedRevision: number; assetId: string | null }): Promise<unknown>;
}

function householdBase(householdId: string): string { return `/households/${encodeURIComponent(householdId)}/media`; }
export function memberMediaAdapter(householdId: string): MemberMediaAdapter {
  const base = householdBase(householdId);
  return {
    scopeKey: `member:${householdId}`,
    listAlbums: () => api(`${base}/albums`),
    createAlbum: input => api(`${base}/albums`, "POST", input),
    updateAlbum: (id, input) => api(`${base}/albums/${encodeURIComponent(id)}`, "PATCH", input),
    deleteAlbum: (id, expectedRevision) => api(`${base}/albums/${encodeURIComponent(id)}`, "DELETE", { expectedRevision }),
    listAssets: id => api(`${base}/albums/${encodeURIComponent(id)}/assets`),
    uploadAsset: (id, input) => api(`${base}/albums/${encodeURIComponent(id)}/assets`, "POST", input),
    updateAsset: (id, input) => api(`${base}/assets/${encodeURIComponent(id)}`, "PATCH", input),
    deleteAsset: (id, expectedRevision) => api(`${base}/assets/${encodeURIComponent(id)}`, "DELETE", { expectedRevision }),
    albumGrants: id => api(`${base}/albums/${encodeURIComponent(id)}/grants`),
    setGrant: (id, input) => api(`${base}/albums/${encodeURIComponent(id)}/grants`, "PUT", input),
    setDisplayGrant: (albumId, displayId, input) => api(`${base}/albums/${encodeURIComponent(albumId)}/displays/${encodeURIComponent(displayId)}`, "PUT", input),
    householdBackground: () => api(`${base}/background`),
    setHouseholdBackground: input => api(`${base}/background`, "PUT", input),
  };
}

/** Paired display media never falls back to member routes or member credentials. */
export interface DisplayMediaAdapter {
  readonly scopeKey: string;
  readonly enabled: boolean;
  projection(): Promise<DisplayMediaProjection>;
}
export function displayMediaAdapter(displayId: string, enabled = false): DisplayMediaAdapter {
  if (!displayId.trim()) throw new Error("A paired display ID is required for media scoping.");
  return {
    scopeKey: `display:${displayId}`,
    enabled,
    projection: () => {
      if (!enabled) return Promise.reject(Object.assign(new Error("Display media is not enabled in this view."), { status: 403 }));
      return api("/display/media");
    },
  };
}

export function fileAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("file_read_failed"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      if (comma < 0) reject(new Error("file_read_failed"));
      else resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function mediaErrorKey(error: unknown): string {
  const value = error as { status?: number; code?: string; details?: { reason?: string } };
  if ([401, 403, 404].includes(value?.status ?? 0)) return "mediaPermissionLost";
  if (value?.status === 409) return "mediaChangedRefresh";
  const reason = value?.details?.reason;
  if (reason === "photo_too_large" || reason === "media_household_quota_exceeded") return "mediaLimitReached";
  if (["photo_invalid", "photo_format_invalid"].includes(reason ?? "")) return "mediaUnsupportedImage";
  if (reason === "photo_dimensions_too_large") return "mediaImageDimensions";
  return "mediaActionError";
}
