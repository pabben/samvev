import { useEffect, useMemo, useRef, useState } from "react";
import type { Display, Person } from "./types";
import { displayMediaAdapter, fileAsBase64, mediaErrorKey, memberMediaAdapter, type DisplayMediaAdapter, type DisplayMediaProjection, type MediaAlbum, type MediaAlbumGrant, type MediaAsset, type MediaDisplayGrant } from "./media-adapters";
import { Icon, useI18n } from "./ui";

type Props = { householdId: string; people: Person[]; displays: Display[]; canManageHousehold: boolean; canManageDisplays: boolean };
type Grants = { album: { id: string; name: string; kind: "photos" | "backgrounds"; revision: number }; memberGrants: MediaAlbumGrant[]; displayGrants: MediaDisplayGrant[] };
const IMAGE_TYPES = ".jpg,.jpeg,.png,.webp,.avif,.heic,.heif";
const MAX_UPLOAD = 10 * 1024 * 1024;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
}
function authorizationFailure(error: unknown): boolean { return [401, 403, 404].includes((error as { status?: number } | null)?.status ?? 0); }

export function MediaSlideshow({ assets, label }: { assets: MediaAsset[]; label: string }) {
  const { t } = useI18n();
  const reducedMotion = useReducedMotion();
  const [currentId, setCurrentId] = useState(assets[0]?.id ?? "");
  const [playing, setPlaying] = useState(false);
  const [intervalSeconds, setIntervalSeconds] = useState(8);
  const initialized = useRef(false);
  const index = Math.max(0, assets.findIndex(asset => asset.id === currentId));
  useEffect(() => {
    if (!assets.length) { setCurrentId(""); return; }
    const first = assets[0];
    if (!assets.some(asset => asset.id === currentId) && first) setCurrentId(first.id);
    if (!initialized.current) {
      initialized.current = true;
      if (assets.length > 1 && !reducedMotion) setPlaying(true);
    }
  }, [assets, currentId, reducedMotion]);
  useEffect(() => { if (reducedMotion) setPlaying(false); }, [reducedMotion]);
  useEffect(() => {
    if (!playing || assets.length < 2 || reducedMotion) return;
    const timer = window.setInterval(() => setCurrentId(value => {
      const current = assets.findIndex(asset => asset.id === value);
      return assets[(Math.max(0, current) + 1) % assets.length]?.id ?? "";
    }), intervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [playing, assets, reducedMotion, intervalSeconds]);
  const current = assets[index];
  if (!current) return <p className="field-hint">{t("mediaNoPhotos")}</p>;
  return <div className="media-slideshow" aria-label={label}>
    <figure className="media-slide" data-review-private="album-image">
      <img src={current.previewUrl} alt={current.title || t("mediaPhotoAlt")} loading="lazy" referrerPolicy="no-referrer"/>
      <figcaption data-review-private="album-caption">{current.title}</figcaption>
    </figure>
    <div className="media-playback-controls">
      <button type="button" className="media-control" onClick={() => setCurrentId(assets[(index + assets.length - 1) % assets.length]?.id ?? "")} disabled={assets.length < 2} aria-label={t("mediaPreviousPhoto")}><Icon name="back" size={17}/></button>
      <button type="button" className="media-control" onClick={() => setPlaying(value => !value)} disabled={assets.length < 2 || reducedMotion} aria-label={playing ? t("mediaPause") : t("mediaPlay")} aria-pressed={playing}>{playing ? "Ⅱ" : "▶"}</button>
      <button type="button" className="media-control" onClick={() => setCurrentId(assets[(index + 1) % assets.length]?.id ?? "")} disabled={assets.length < 2} aria-label={t("mediaNextPhoto")}><Icon name="arrow" size={17}/></button>
      <label className="media-interval-label">{t("mediaSlideInterval")}<select value={intervalSeconds} onChange={event => setIntervalSeconds(Number(event.target.value))}><option value={5}>5 s</option><option value={8}>8 s</option><option value={15}>15 s</option></select></label>
      {assets.length > 1 && <span className="field-hint">{index + 1} / {assets.length}</span>}
    </div>
  </div>;
}

/** Reusable paired-device surface; it only calls the display-scoped projection adapter. */
export function DisplayMediaPlayback(props: { displayId: string; enabled?: boolean }) {
  return <DisplayMediaPlaybackContent key={props.displayId} {...props}/>;
}

function DisplayMediaPlaybackContent({ displayId, enabled = false }: { displayId: string; enabled?: boolean }) {
  const { t } = useI18n();
  const adapter = useMemo(() => displayMediaAdapter(displayId, enabled), [displayId, enabled]);
  const [projection, setProjection] = useState<DisplayMediaProjection | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState("");
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    let active = true;
    setProjection(null); setFailed(!adapter.enabled); setRefreshError(false);
    if (!adapter.enabled) return () => { active = false; };
    const refresh = async () => {
      if (!active) return;
      setRefreshing(true);
      try { const value = await adapter.projection(); if (active) { setProjection(value); setFailed(false); setRefreshError(false); } }
      catch (error) {
        if (!active) return;
        const status = (error as { status?: number })?.status;
        if ([401, 403, 404].includes(status ?? 0)) { setProjection(null); setFailed(true); }
        else setRefreshError(true);
      } finally { if (active) setRefreshing(false); }
    };
    refreshRef.current = () => { void refresh(); };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [adapter]);
  if (!adapter.enabled || failed) return <p className="field-hint">{t("mediaPermissionLost")}</p>;
  if (!projection) return <p className="field-hint">{refreshError ? t("mediaActionError") : t("loading")} <button type="button" className="media-control" disabled={refreshing} onClick={() => refreshRef.current()}>{t("mediaRefresh")}</button></p>;
  const albumId = projection.albums.some(album => album.id === selectedAlbum) ? selectedAlbum : projection.albums[0]?.id ?? "";
  const photos = projection.assets.filter(asset => asset.albumId === albumId);
  return <section className="hub-panel media-display-playback" aria-label={t("mediaPhotosTitle")}>
    {refreshError && <p className="household-board-error" role="status">{t("mediaActionError")}</p>}
    <button type="button" className="media-control" disabled={refreshing} onClick={() => refreshRef.current()}>{t("mediaRefresh")}</button>
    {projection.albums.length > 1 && <label className="media-display-album-select">{t("mediaChooseAlbum")}<select data-review-private="album-selection" value={albumId} onChange={event => setSelectedAlbum(event.target.value)}>{projection.albums.map(album => <option value={album.id} key={album.id}>{album.name}</option>)}</select></label>}
    <MediaSlideshow assets={photos} label={t("mediaPhotosTitle")}/>
    {(projection.background || projection.householdBackground) && <div className="media-display-background" data-review-private="background-image"><img src={(projection.background ?? projection.householdBackground)!.previewUrl} alt={(projection.background ?? projection.householdBackground)!.title || t("mediaBackgroundAlt")} referrerPolicy="no-referrer"/></div>}
  </section>;
}

export function HouseholdBackgroundLayer({ householdId }: { householdId: string }) {
  return <HouseholdBackgroundContent key={householdId} householdId={householdId}/>;
}

function HouseholdBackgroundContent({ householdId }: { householdId: string }) {
  const adapter = useMemo(() => memberMediaAdapter(householdId), [householdId]);
  const [asset, setAsset] = useState<MediaAsset | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try { const result = await adapter.householdBackground(); if (active) setAsset(result.background); }
      catch (error) { if (active && authorizationFailure(error)) setAsset(null); }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [adapter]);
  if (!asset) return null;
  return <div className="home-background-layer" aria-hidden="true" data-review-private="household-background"><img src={asset.previewUrl} alt="" referrerPolicy="no-referrer"/></div>;
}

export function MediaLibraryPanel(props: Props) {
  return <MediaLibraryPanelContent key={props.householdId} {...props}/>;
}

function MediaLibraryPanelContent({ householdId, people, displays, canManageHousehold, canManageDisplays }: Props) {
  const { t } = useI18n();
  const adapter = useMemo(() => memberMediaAdapter(householdId), [householdId]);
  const [open, setOpen] = useState(false);
  const [albums, setAlbums] = useState<MediaAlbum[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [assetsFor, setAssetsFor] = useState("");
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [backgroundAssets, setBackgroundAssets] = useState<MediaAsset[]>([]);
  const [backgroundRevision, setBackgroundRevision] = useState(1);
  const [backgroundId, setBackgroundId] = useState("");
  const [storedBackgroundId, setStoredBackgroundId] = useState("");
  const [grants, setGrants] = useState<Grants | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const requestRef = useRef(0);
  const mountedRef = useRef(true);
  const loadRef = useRef<(targetId?: string) => Promise<void>>(async () => {});
  const backgroundLoadRef = useRef<() => void>(() => {});
  const [busy, setBusy] = useState(false);
  const [albumName, setAlbumName] = useState("");
  const [albumKind, setAlbumKind] = useState<"photos" | "backgrounds">("photos");
  const [assetTitle, setAssetTitle] = useState("");
  const [assetDescription, setAssetDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [grantTarget, setGrantTarget] = useState("household");
  const [grantRead, setGrantRead] = useState(true);
  const [grantUpload, setGrantUpload] = useState(false);
  const [grantManage, setGrantManage] = useState(false);
  const [displayTarget, setDisplayTarget] = useState("");
  const [displayRead, setDisplayRead] = useState(true);
  const [displayUpload, setDisplayUpload] = useState(false);
  const [editingAsset, setEditingAsset] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");

  const selected = albums.find(album => album.id === selectedId) ?? null;
  const activeDisplays = displays.filter(display => !display.revoked_at);
  const canManageSelected = selected?.permissions.manage === true;
  const load = async (targetId = selectedId) => {
    const generation = ++requestRef.current;
    setLoading(true);
    try {
      const [albumResult, backgroundResult] = await Promise.all([adapter.listAlbums(), adapter.householdBackground()]);
      if (!mountedRef.current || requestRef.current !== generation) return;
      setAlbums(albumResult.albums); setBackgroundRevision(backgroundResult.revision); setBackgroundId(backgroundResult.background?.id ?? ""); setStoredBackgroundId(backgroundResult.background?.id ?? "");
      setLoaded(true);
      const nextId = albumResult.albums.some(album => album.id === targetId && album.permissions.read) ? targetId : albumResult.albums.find(album => album.permissions.read)?.id ?? "";
      setSelectedId(nextId);
      setError(null);
    } catch (cause) {
      if (mountedRef.current && requestRef.current === generation) {
        setError(mediaErrorKey(cause));
        if (authorizationFailure(cause)) { setAlbums([]); setAssets([]); setAssetsFor(""); setBackgroundAssets([]); setGrants(null); setSelectedId(""); setLoaded(false); }
      }
    }
    finally { if (mountedRef.current && requestRef.current === generation) setLoading(false); }
  };
  loadRef.current = load;
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; requestRef.current++; }; }, []);
  useEffect(() => {
    if (open) {
      setLoaded(false); void loadRef.current("");
      const timer = window.setInterval(() => { void loadRef.current(); }, 30_000);
      return () => { window.clearInterval(timer); requestRef.current++; };
    }
    requestRef.current++; setAlbums([]); setAssets([]); setAssetsFor(""); setBackgroundAssets([]); setGrants(null); setSelectedId(""); setLoaded(false);
  }, [open, adapter.scopeKey]);
  useEffect(() => {
    if (!open || !selectedId) { setAssets([]); setAssetsFor(""); setAssetsLoading(false); setGrants(null); return; }
    let active = true;
    if (assetsFor !== selectedId) { setAssets([]); setAssetsFor(""); }
    setAssetsLoading(true); setGrants(null);
    const album = albums.find(item => item.id === selectedId);
    const assetPromise = adapter.listAssets(selectedId);
    const grantPromise = album?.permissions.manage ? adapter.albumGrants(selectedId) : Promise.resolve(null);
    void Promise.allSettled([assetPromise, grantPromise] as const).then(([assetResult, grantResult]) => {
      if (!active) return;
      if (assetResult.status === "fulfilled") { setAssets(assetResult.value.assets); setAssetsFor(selectedId); } else { setError(mediaErrorKey(assetResult.reason)); if (authorizationFailure(assetResult.reason)) { setAssets([]); setAssetsFor(""); setAlbums(previous => previous.filter(item => item.id !== selectedId)); setSelectedId(""); } }
      if (grantResult.status === "fulfilled") setGrants(grantResult.value); else { setGrants(null); setError(mediaErrorKey(grantResult.reason)); if (authorizationFailure(grantResult.reason)) setAlbums(previous => previous.map(item => item.id === selectedId ? { ...item, permissions: { ...item.permissions, manage: false } } : item)); }
      setAssetsLoading(false);
    });
    return () => { active = false; };
  }, [selectedId, open, adapter, albums]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const sources = albums.filter(album => album.kind === "backgrounds" && album.permissions.read);
    const refresh = async () => {
      const results = await Promise.all(sources.map(async album => ({ album, result: await adapter.listAssets(album.id).then(value => ({ ok: true as const, assets: value.assets }), error => ({ ok: false as const, error })) })));
      if (!active || !mountedRef.current) return;
      const successful = new Set(results.filter(item => item.result.ok).map(item => item.album.id));
      const denied = results.filter(item => !item.result.ok && authorizationFailure(item.result.error));
      const incoming = results.flatMap(item => item.result.ok ? item.result.assets : []);
      const allowedSourceIds = new Set(sources.map(album => album.id));
      setBackgroundAssets(previous => [...previous.filter(asset => allowedSourceIds.has(asset.albumId) && !successful.has(asset.albumId) && !denied.some(item => item.album.id === asset.albumId)), ...incoming]);
      if (denied.length) {
        setAlbums(previous => previous.filter(album => !denied.some(item => item.album.id === album.id)));
        setError("mediaPermissionLost");
      } else if (results.some(item => !item.result.ok)) setError("mediaActionError");
    };
    backgroundLoadRef.current = () => { void refresh(); };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => { active = false; window.clearInterval(timer); backgroundLoadRef.current = () => {}; };
  }, [open, adapter, albums]);

  const mutate = async (action: () => Promise<unknown>, refreshId = selectedId) => {
    setBusy(true); setError(null);
    try { await action(); if (!mountedRef.current) return false; await load(refreshId); return mountedRef.current; }
    catch (cause) {
      if (!mountedRef.current) return false;
      const key = mediaErrorKey(cause);
      if ([401, 403, 404, 409].includes((cause as { status?: number }).status ?? 0)) await load(refreshId);
      setError(key);
      if (authorizationFailure(cause)) { setAssets([]); setAssetsFor(""); setGrants(null); if ((cause as { status?: number }).status === 401) { setAlbums([]); setBackgroundAssets([]); setSelectedId(""); setLoaded(false); } }
      return false;
    }
    finally { if (mountedRef.current) setBusy(false); }
  };
  const upload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !file || !assetTitle.trim()) return;
    if (file.size > MAX_UPLOAD) { setError("mediaLimitReached"); return; }
    setBusy(true); setError(null);
    try {
      const imageBase64 = await fileAsBase64(file);
      if (!mountedRef.current) return;
      await adapter.uploadAsset(selected.id, { title: assetTitle.trim(), description: assetDescription.trim(), imageBase64 });
      if (!mountedRef.current) return;
      setFile(null); setAssetTitle(""); setAssetDescription("");
      const picker = document.getElementById("media-upload-file") as HTMLInputElement | null; if (picker) picker.value = "";
      await load(selected.id);
    } catch (cause) { if (mountedRef.current) { setError(mediaErrorKey(cause)); if (authorizationFailure(cause)) { setAssets([]); setAssetsFor(""); setGrants(null); } } }
    finally { if (mountedRef.current) setBusy(false); }
  };

  return <details className="media-library-disclosure" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><Icon name="photo" size={18}/>{t("mediaOpen")}</summary>
    <section className="hub-panel media-library" aria-label={t("mediaLibraryTitle")}>
      <header className="hub-panel-title"><h2><Icon name="photo"/>{t("mediaLibraryTitle")}</h2><button type="button" className="media-control" disabled={loading || busy} onClick={() => { void loadRef.current(); backgroundLoadRef.current(); }}>{t("mediaRefresh")}</button></header>
      {error && <p className="household-board-error" role="status">{t(error as "mediaPermissionLost" | "mediaChangedRefresh" | "mediaLimitReached" | "mediaUnsupportedImage" | "mediaImageDimensions" | "mediaActionError")} <button type="button" className="media-control" disabled={loading || busy} onClick={() => void load()}>{t("mediaRefresh")}</button></p>}
      {!open || (!loaded && loading) ? <p className="field-hint">{t("loading")}</p> : !loaded ? <p className="field-hint" role="status">{t("mediaActionError")} <button type="button" className="media-control" disabled={loading || busy} onClick={() => { void loadRef.current(); backgroundLoadRef.current(); }}>{t("mediaRefresh")}</button></p> : <>
        {loaded && !albums.length && <p className="field-hint">{t("mediaNoAlbums")}</p>}
        {!!albums.length && <div className="media-album-list"><label>{t("mediaChooseAlbum")}<select data-review-private="album-selection" value={selectedId} onChange={event => { setSelectedId(event.target.value); setAssets([]); setAssetsFor(""); setGrants(null); }}><option value="">{t("mediaChooseAlbum")}</option>{albums.map(album => <option value={album.id} key={album.id}>{album.name} · {t(album.kind === "photos" ? "mediaPhotoAlbums" : "mediaBackgroundAlbums")}</option>)}</select></label></div>}
        {selected && <>
          <div className="media-album-heading"><h3 data-review-private="album-name">{selected.name}</h3>{canManageSelected && <div><button type="button" className="media-control" disabled={busy} onClick={() => { const name = window.prompt(t("mediaRenameAlbum"), selected.name); if (name?.trim()) void mutate(() => adapter.updateAlbum(selected.id, { expectedRevision: selected.revision, name: name.trim() })); }}>{t("mediaRename")}</button><button type="button" className="media-control danger" disabled={busy} onClick={() => { if (window.confirm(t("mediaDeleteAlbumConfirm", { name: selected.name }))) void mutate(() => adapter.deleteAlbum(selected.id, selected.revision), ""); }}>{t("mediaDelete")}</button></div>}</div>
          {assetsFor === selected.id ? <MediaSlideshow assets={assets} label={selected.name}/> : assetsLoading ? <p className="field-hint">{t("loading")}</p> : null}
          {selected.permissions.upload && <form className="media-upload-form" onSubmit={event => void upload(event)}>
            <h4>{t("mediaUpload")}</h4><p className="field-hint">{t("mediaUploadHint")}</p>
            <label htmlFor="media-upload-title">{t("mediaPhotoTitleLabel")}</label><input id="media-upload-title" data-review-private="media-upload-title" maxLength={80} value={assetTitle} onChange={event => setAssetTitle(event.target.value)} placeholder={t("mediaPhotoTitleLabel")} required disabled={busy}/>
            <label htmlFor="media-upload-description">{t("mediaDescriptionLabel")}</label><textarea id="media-upload-description" data-review-private="media-upload-description" maxLength={500} value={assetDescription} onChange={event => setAssetDescription(event.target.value)} placeholder={t("mediaDescriptionLabel")} disabled={busy}/>
            <label htmlFor="media-upload-file">{t("mediaChooseFile")}</label><input id="media-upload-file" data-review-private="media-upload-file" type="file" accept={IMAGE_TYPES} onChange={event => { const next = event.target.files?.[0] ?? null; setFile(next); if (next && !assetTitle.trim()) setAssetTitle(next.name.replace(/\.[^.]+$/, "").slice(0, 80)); }} disabled={busy}/>
            <button type="submit" className="button" disabled={busy || !file || !assetTitle.trim()}>{t("mediaUpload")}</button>
          </form>}
          {canManageSelected && <ul className="media-asset-management">{assets.map(asset => <li key={asset.id}>
            {editingAsset === asset.id ? <form onSubmit={event => { event.preventDefault(); void mutate(() => adapter.updateAsset(asset.id, { expectedRevision: asset.revision, title: editTitle.trim(), description: editDescription.trim() })).then(saved => { if (saved) setEditingAsset(null); }); }}><label htmlFor={`media-edit-title-${asset.id}`}>{t("mediaPhotoTitleLabel")}</label><input id={`media-edit-title-${asset.id}`} data-review-private="media-edit-title" maxLength={80} value={editTitle} onChange={event => setEditTitle(event.target.value)}/><label htmlFor={`media-edit-description-${asset.id}`}>{t("mediaDescriptionLabel")}</label><textarea id={`media-edit-description-${asset.id}`} data-review-private="media-edit-description" maxLength={500} value={editDescription} onChange={event => setEditDescription(event.target.value)}/><button className="media-control" type="submit" disabled={busy || !editTitle.trim()}>{t("mediaSave")}</button></form> : <><span data-review-private="media-asset-title">{asset.title}</span><button className="media-control" type="button" disabled={busy} onClick={() => { setEditingAsset(asset.id); setEditTitle(asset.title); setEditDescription(asset.description); }}>{t("mediaEdit")}</button><button className="media-control danger" type="button" disabled={busy} onClick={() => { if (window.confirm(t("mediaDeletePhotoConfirm", { title: asset.title }))) void mutate(() => adapter.deleteAsset(asset.id, asset.revision)); }}>{t("mediaDelete")}</button></>}
          </li>)}</ul>}
          {canManageSelected && <details className="media-sharing"><summary>{t("mediaSharing")}</summary>
            {grants && <ul>{grants.memberGrants.map((grant,index) => <li key={`${grant.membershipId ?? "household"}-${index}`} data-review-private="media-grant-row"><span>{grant.householdWide ? t("mediaWholeHousehold") : grant.displayName ?? t("mediaMember")}</span><span>{t(grant.permissions.read ? "mediaCanRead" : "mediaNoRead")}, {t(grant.permissions.upload ? "mediaCanUpload" : "mediaNoUpload")}</span>{grant.householdWide || grant.membershipId ? <button type="button" className="media-control danger" disabled={busy} onClick={() => void mutate(() => adapter.setGrant(selected.id, { expectedRevision: selected.revision, membershipId: grant.membershipId, householdWide: grant.householdWide, canRead: false, canUpload: false, canManage: false, revoke: true }))}>{t("mediaRevoke")}</button> : null}</li>)}</ul>}
            <form className="media-grant-form" onSubmit={event => { event.preventDefault(); const householdWide = grantTarget === "household"; const membershipId = householdWide ? null : grantTarget; void mutate(() => adapter.setGrant(selected.id, { expectedRevision: selected.revision, membershipId, householdWide, canRead: grantRead, canUpload: grantUpload, canManage: grantManage })); }}>
              <label>{t("mediaShareWith")}<select data-review-private="media-member-grant-target" value={grantTarget} onChange={event => { const target = event.target.value; setGrantTarget(target); const current = grants?.memberGrants.find(grant => target === "household" ? grant.householdWide : grant.membershipId === target); setGrantRead(current?.permissions.read ?? true); setGrantUpload(current?.permissions.upload ?? false); setGrantManage(current?.permissions.manage ?? false); }}><option value="household">{t("mediaWholeHousehold")}</option>{people.map(person => <option key={person.membership_id} value={person.membership_id}>{person.display_name}</option>)}</select></label>
              <label><input type="checkbox" checked={grantRead} onChange={event => setGrantRead(event.target.checked)}/>{t("mediaCanRead")}</label><label><input type="checkbox" checked={grantUpload} onChange={event => setGrantUpload(event.target.checked)}/>{t("mediaCanUpload")}</label><label><input type="checkbox" checked={grantManage} onChange={event => setGrantManage(event.target.checked)}/>{t("mediaCanManage")}</label><button type="submit" className="button" disabled={busy || (!grantRead && !grantUpload && !grantManage)}>{t("mediaSaveGrant")}</button>
            </form>
            {canManageDisplays && activeDisplays.length > 0 && <form className="media-grant-form" onSubmit={event => { event.preventDefault(); const existing = grants?.displayGrants.find(grant => grant.displayId === displayTarget); void mutate(() => adapter.setDisplayGrant(selected.id, displayTarget, { expectedRevision: existing?.revision ?? null, canRead: displayRead, canUpload: displayUpload })); }}><label>{t("mediaShareWithDisplay")}<select data-review-private="media-display-grant-target" required value={displayTarget} onChange={event => { const id = event.target.value; setDisplayTarget(id); const current = grants?.displayGrants.find(grant => grant.displayId === id); setDisplayRead(current?.permissions.read ?? true); setDisplayUpload(current?.permissions.upload ?? false); }}><option value="">{t("mediaChooseDisplay")}</option>{activeDisplays.map(display => <option value={display.id} key={display.id}>{display.name}</option>)}</select></label><label><input type="checkbox" checked={displayRead} onChange={event => setDisplayRead(event.target.checked)}/>{t("mediaCanRead")}</label><label><input type="checkbox" checked={displayUpload} onChange={event => setDisplayUpload(event.target.checked)}/>{t("mediaCanUpload")}</label><button type="submit" className="button" disabled={busy || !displayTarget}>{t("mediaSaveGrant")}</button></form>}
            {grants?.displayGrants.map(grant => <p key={grant.displayId} data-review-private="media-display-grant">{grant.displayName}: {t(grant.permissions.read ? "mediaCanRead" : "mediaNoRead")}{canManageDisplays && <button type="button" className="media-control danger" disabled={busy} onClick={() => void mutate(() => adapter.setDisplayGrant(selected.id, grant.displayId, { expectedRevision: grant.revision, canRead: false, canUpload: false, revoke: true }))}>{t("mediaRevoke")}</button>}</p>)}
          </details>}
        </>}
        {canManageHousehold && <section className="media-background-settings"><h3>{t("mediaHouseholdBackground")}</h3><label>{t("mediaChooseBackground")}<select data-review-private="background-selection" value={backgroundId} onChange={event => setBackgroundId(event.target.value)}><option value="">{t("mediaNoBackground")}</option>{backgroundAssets.map(asset => <option key={asset.id} value={asset.id}>{asset.title}</option>)}</select></label>{backgroundAssets.find(asset => asset.id === backgroundId) && <div className="media-background-current" data-review-private="background-image"><img src={backgroundAssets.find(asset => asset.id === backgroundId)!.previewUrl} alt={t("mediaBackgroundAlt")} referrerPolicy="no-referrer"/></div>}<button type="button" className="button" disabled={busy || !storedBackgroundId} onClick={() => void mutate(() => adapter.setHouseholdBackground({ expectedRevision: backgroundRevision, assetId: null }))}>{t("mediaResetBackground")}</button><button type="button" className="button" disabled={busy || !backgroundId || backgroundId === storedBackgroundId} onClick={() => void mutate(() => adapter.setHouseholdBackground({ expectedRevision: backgroundRevision, assetId: backgroundId }))}>{t("mediaSetBackground")}</button></section>}
      </>}
      <form className="media-create-album" onSubmit={event => { event.preventDefault(); if (!albumName.trim()) return; void mutate(() => adapter.createAlbum({ name: albumName.trim(), kind: albumKind }), "").then(saved => { if (saved) setAlbumName(""); }); }}><h3>{t("mediaCreateAlbum")}</h3><label htmlFor="media-new-album">{t("mediaAlbumName")}</label><input id="media-new-album" data-review-private="media-new-album" maxLength={80} value={albumName} onChange={event => setAlbumName(event.target.value)} placeholder={t("mediaAlbumName")} disabled={busy}/><label htmlFor="media-album-kind">{t("mediaAlbumKind")}</label><select id="media-album-kind" value={albumKind} onChange={event => setAlbumKind(event.target.value as "photos" | "backgrounds")}><option value="photos">{t("mediaPhotoAlbums")}</option><option value="backgrounds">{t("mediaBackgroundAlbums")}</option></select><button className="button" type="submit" disabled={busy || !albumName.trim()}>{t("mediaCreateAlbum")}</button><p className="field-hint">{t("mediaPrivateByDefault")}</p></form>
    </section>
  </details>;
}
