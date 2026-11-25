import assert from "node:assert/strict";
import test from "node:test";
import { displayMediaAdapter, mediaErrorKey, memberMediaAdapter } from "../src/media-adapters.ts";

test("member media adapter uses only household-scoped album, asset, grant and background routes", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const adapter = memberMediaAdapter("household / one");
    assert.equal(adapter.scopeKey, "member:household / one");
    await adapter.listAlbums();
    await adapter.createAlbum({ name: "fixture album", kind: "photos" });
    await adapter.uploadAsset("album/one", { title: "fixture image", description: "", imageBase64: "ZmFrZQ==" });
    await adapter.setGrant("album/one", { expectedRevision: 3, membershipId: null, householdWide: true, canRead: true, canUpload: false, canManage: false });
    await adapter.setDisplayGrant("album/one", "display/one", { expectedRevision: null, canRead: true, canUpload: false });
    await adapter.setHouseholdBackground({ expectedRevision: 4, assetId: null });
    assert.deepEqual(calls.map(call => [call.url, call.method]), [
      ["/api/v1/households/household%20%2F%20one/media/albums", "GET"],
      ["/api/v1/households/household%20%2F%20one/media/albums", "POST"],
      ["/api/v1/households/household%20%2F%20one/media/albums/album%2Fone/assets", "POST"],
      ["/api/v1/households/household%20%2F%20one/media/albums/album%2Fone/grants", "PUT"],
      ["/api/v1/households/household%20%2F%20one/media/albums/album%2Fone/displays/display%2Fone", "PUT"],
      ["/api/v1/households/household%20%2F%20one/media/background", "PUT"],
    ]);
    assert.deepEqual(calls[3]?.body, { expectedRevision: 3, membershipId: null, householdWide: true, canRead: true, canUpload: false, canManage: false });
    assert.deepEqual(calls[5]?.body, { expectedRevision: 4, assetId: null });
  } finally { globalThis.fetch = originalFetch; }
});

test("display media adapter is default-deny until its photos view is enabled and never calls member endpoints", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async input => { called = true; assert.equal(String(input), "/api/v1/display/media"); return new Response(JSON.stringify({ albums: [], assets: [], background: null, householdBackground: null }), { status: 200 }); };
  try {
    assert.throws(() => displayMediaAdapter(""), /display ID is required/);
    const denied = displayMediaAdapter("device-fixture");
    assert.equal(denied.enabled, false);
    await assert.rejects(denied.projection(), (error: { status: number }) => error.status === 403);
    assert.equal(called, false);
    const allowed = displayMediaAdapter("device-fixture", true);
    assert.equal(allowed.enabled, true);
    assert.equal(allowed.scopeKey, "display:device-fixture");
    assert.deepEqual(await allowed.projection(), { albums: [], assets: [], background: null, householdBackground: null });
    assert.equal(called, true);
  } finally { globalThis.fetch = originalFetch; }
});

test("media API errors map known normalization, dimension, quota and revision cases to localized keys", () => {
  assert.equal(mediaErrorKey({ status: 400, details: { reason: "photo_format_invalid" } }), "mediaUnsupportedImage");
  assert.equal(mediaErrorKey({ status: 400, details: { reason: "photo_dimensions_too_large" } }), "mediaImageDimensions");
  assert.equal(mediaErrorKey({ status: 413, details: { reason: "media_household_quota_exceeded" } }), "mediaLimitReached");
  assert.equal(mediaErrorKey({ status: 409 }), "mediaChangedRefresh");
  assert.equal(mediaErrorKey({ status: 403 }), "mediaPermissionLost");
});
