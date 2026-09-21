import { useCallback, useEffect, useRef, useState } from "react";
import { sha256 } from "@noble/hashes/sha2.js";
import { api, ApiError } from "./api";
import type { Card, Projection } from "./types";
import {
  Brand,
  Dialog,
  Empty,
  ErrorNotice,
  Icon,
  LocaleProvider,
  PrefControls,
  useAction,
  useI18n,
  usePreferences,
  type Preferences,
} from "./ui";
import { formatDate } from "./time";
import {
  disconnected,
  streamSignal,
  projectionRecovered,
  type StreamSignal,
} from "./stream-health";
import {
  currentCards,
  restoreCache,
  serverTime,
  type CacheClock,
  type CachedProjection,
} from "./display-cache";
const CACHE = "samvev.display.projection.v1";
function readCache(): {
  projection: Projection;
  clock: CacheClock;
  lastUpdated: string;
} | null {
  try {
    const raw = localStorage.getItem(CACHE);
    if (!raw) return null;
    const value = JSON.parse(raw) as CachedProjection;
    const clock = restoreCache(value, Date.now(), performance.now());
    if (!clock) {
      localStorage.removeItem(CACHE);
      return null;
    }
    return {
      projection: value.projection,
      clock,
      lastUpdated: value.lastUpdated,
    };
  } catch {
    return null;
  }
}
function clearSaved() {
  try {
    localStorage.removeItem(CACHE);
  } catch {
    /* In-memory state is still cleared. */
  }
}
export function DisplayApp() {
  const [prefs, setPrefs] = usePreferences("samvev.display.preferences");
  return (
    <LocaleProvider locale={prefs.locale}>
      <DisplayRuntime prefs={prefs} setPrefs={setPrefs} />
    </LocaleProvider>
  );
}
function DisplayRuntime({
  prefs,
  setPrefs,
}: {
  prefs: Preferences;
  setPrefs: (p: Preferences) => void;
}) {
  const { t, locale } = useI18n();
  const [initialCache] = useState(readCache);
  const initial = useRef(initialCache);
  const [projection, setProjection] = useState<Projection | null>(
    initial.current?.projection ?? null,
  );
  const clock = useRef<CacheClock | null>(initial.current?.clock ?? null);
  const [online, setOnline] = useState(false);
  const onlineRef = useRef(false);
  const [streamLive, setStreamLive] = useState(false);
  const [streamEpoch, setStreamEpoch] = useState(0);
  const [cacheExpired, setCacheExpired] = useState(false);
  const [streamDegraded, setStreamDegraded] = useState(false);
  const streamHealth = useRef(disconnected());
  const refreshAgain = useRef(false);
  const [needsPair, setNeedsPair] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(
    initial.current?.lastUpdated ?? "",
  );
  const [options, setOptions] = useState(false);
  const [layout, setLayout] = useState<"board" | "timeline">(() => {
    try {
      return localStorage.getItem("samvev.display.layout") === "timeline"
        ? "timeline"
        : "board";
    } catch {
      return "board";
    }
  });
  const acknowledged = useRef(new Set<string>());
  const requestActive = useRef(false);
  const eventSource = useRef<EventSource | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const hasPaired = useRef(Boolean(initial.current));
  const loseConnection = useCallback(() => {
    streamHealth.current = streamSignal(streamHealth.current, "error");
    setStreamLive(false);
    setStreamDegraded(false);
  }, []);
  const clear = useCallback(() => {
    generation.current++;
    setProjection(null);
    clock.current = null;
    clearSaved();
    setNeedsPair(true);
    setRevoked(true);
    onlineRef.current = false;
    setOnline(false);
    setStreamLive(false);
    loseConnection();
    acknowledged.current.clear();
    eventSource.current?.close();
  }, [loseConnection]);
  const refresh: () => Promise<void> = useCallback(async () => {
    if (requestActive.current) {
      refreshAgain.current = true;
      return;
    }
    requestActive.current = true;
    const current = generation.current;
    const requestEpoch = streamHealth.current.epoch;
    try {
      const p = await api<Projection>("/display/projection");
      if (!mounted.current || current !== generation.current) return;
      const serverAt = Date.parse(p.serverNow);
      clock.current = {
        serverAt,
        monotonicAt: performance.now(),
        deadline: Math.min(Date.parse(p.cacheUntil), serverAt + 900000),
      };
      hasPaired.current = true;
      setProjection(p);
      setCacheExpired(false);
      streamHealth.current = projectionRecovered(
        streamHealth.current,
        requestEpoch,
      );
      setStreamLive(streamHealth.current.phase === "live");
      setPrefs({ locale: p.display.locale, theme: p.display.theme });
      setLastUpdated(p.generatedAt);
      setOnline(true);
      onlineRef.current = true;
      setNeedsPair(false);
      setRevoked(false);
      try {
        localStorage.setItem(
          CACHE,
          JSON.stringify({
            projection: p,
            savedAt: Date.now(),
            lastUpdated: p.generatedAt,
          }),
        );
      } catch {
        /* Storage may be disabled; runtime cache remains bounded. */
      }
    } catch (e) {
      if (!mounted.current || current !== generation.current) return;
      setOnline(false);
      onlineRef.current = false;
      if ([401, 403].includes((e as ApiError).status)) {
        if (hasPaired.current) clear();
        else {
          setProjection(null);
          clock.current = null;
          clearSaved();
          setNeedsPair(true);
        }
      }
    } finally {
      requestActive.current = false;
      if (mounted.current) {
        setLoading(false);
        if (refreshAgain.current) {
          refreshAgain.current = false;
          queueMicrotask(() => void refresh());
        }
      }
    }
  }, [clear, setPrefs]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => {
      if (navigator.onLine) void refresh();
    }, 5000);
    const ticker = setInterval(() => {
      setTick((v) => v + 1);
      if (
        clock.current &&
        serverTime(clock.current, performance.now()) >= clock.current.deadline
      ) {
        setProjection(null);
        clock.current = null;
        clearSaved();
        setCacheExpired(true);
        setOnline(false);
        onlineRef.current = false;
        loseConnection();
      }
    }, 1000);
    const offline = () => {
      onlineRef.current = false;
      setOnline(false);
      loseConnection();
      eventSource.current?.close();
    };
    const online = () => {
      loseConnection();
      setStreamEpoch((value) => value + 1);
      void refresh();
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      clearInterval(ticker);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, [refresh, loseConnection]);
  useEffect(() => {
    if (!projection || needsPair) return;
    const source = new EventSource("/api/v1/display/events");
    eventSource.current = source;
    const signal = (
      kind: "ready" | "heartbeat" | "listener-degraded" | "listener-restored",
      event: Event,
    ) => {
      if (eventSource.current !== source) return;
      let payload: StreamSignal = {};
      try {
        payload = JSON.parse((event as MessageEvent).data);
      } catch {}
      streamHealth.current = streamSignal(streamHealth.current, kind, payload);
      setStreamLive(streamHealth.current.phase === "live");
      setStreamDegraded(streamHealth.current.phase === "degraded");
      if (kind === "ready" || kind === "listener-restored") void refresh();
    };
    source.addEventListener("ready", (event) => signal("ready", event));
    source.addEventListener("heartbeat", (event) => signal("heartbeat", event));
    source.addEventListener("listener-degraded", (event) =>
      signal("listener-degraded", event),
    );
    source.addEventListener("listener-restored", (event) =>
      signal("listener-restored", event),
    );
    source.addEventListener("projection-invalidated", () => void refresh());
    source.addEventListener("authorization-revoked", clear);
    source.onerror = () => {
      streamHealth.current = streamSignal(streamHealth.current, "error");
      setStreamLive(false);
      void refresh();
    };
    return () => {
      source.close();
      loseConnection();
      eventSource.current = null;
    };
  }, [
    projection?.display.id,
    needsPair,
    clear,
    refresh,
    loseConnection,
    streamEpoch,
  ]);
  const cards =
    projection && clock.current
      ? currentCards(projection, clock.current, performance.now()).sort(
          (a, b) =>
            Number(b.importance === "attention") -
              Number(a.importance === "attention") ||
            Date.parse(a.publishAt) - Date.parse(b.publishAt),
        )
      : [];
  useEffect(() => {
    if (!online || !projection || !clock.current) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (
          cancelled ||
          !onlineRef.current ||
          document.visibilityState !== "visible"
        )
          return;
        for (const card of cards) {
          const key = `${projection.display.id}:${card.id}:${card.revision}`;
          if (acknowledged.current.has(key)) continue;
          const element = document.querySelector(
            `[data-card-id="${CSS.escape(card.id)}"] .display-card-body`,
          );
          if (!element) continue;
          const rect = element.getBoundingClientRect();
          if (
            rect.width <= 0 ||
            rect.height <= 0 ||
            rect.bottom <= 0 ||
            rect.top >= innerHeight - Math.min(24, rect.height) ||
            rect.right <= 0 ||
            rect.left >= innerWidth
          )
            continue;
          acknowledged.current.add(key);
          void api("/display/render-ack", "POST", {
            cardId: card.id,
            revision: card.revision,
            renderedAt: new Date(
              serverTime(clock.current!, performance.now()),
            ).toISOString(),
          }).catch((e) => {
            acknowledged.current.delete(key);
            if ((e as ApiError).status === 401) clear();
          });
        }
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [
    cards.map((c) => `${c.id}:${c.revision}`).join(","),
    online,
    projection?.display.id,
    tick,
  ]);
  const paired = useCallback(async () => {
    generation.current++;
    await refresh();
  }, [refresh, loseConnection]);
  const zone = projection?.display.timezone ?? "UTC";
  if (needsPair)
    return (
      <Pairing
        prefs={prefs}
        setPrefs={setPrefs}
        revoked={revoked}
        onPaired={paired}
      />
    );
  if (loading && !projection)
    return (
      <div className="display-loading">
        <Brand />
        <p role="status">{t("loading")}</p>
      </div>
    );
  return (
    <div
      className={`display-page layout-${layout}`}
      data-timezone={projection?.display.timezone ?? "UTC"}
      data-cache-state={
        projection ? "current" : cacheExpired ? "expired" : "unavailable"
      }
    >
      <header className="display-header">
        <div>
          <Brand />
          <div className="display-identity">
            <span>
              {projection?.display.householdName ?? t("displayGreeting")}
            </span>
            <strong>{projection?.display.name ?? t("unknownDisplay")}</strong>
          </div>
        </div>
        <div className="display-date">
          <strong>
            {formatDate(Date.now(), locale, zone, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </strong>
          <span>
            {formatDate(Date.now(), locale, zone, {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </span>
        </div>
        <button
          className="icon-button"
          aria-label={t("displayOptions")}
          onClick={() => setOptions(true)}
        >
          <Icon name="settings" />
        </button>
      </header>
      <main className="display-main">
        <div className="display-section-title">
          <div>
            <p className="eyebrow">{t("displayNow")}</p>
            <h1>{t("displayGreeting")}</h1>
          </div>
          <span
            className={`connection-pill ${online ? "" : "stale"}`}
            role="status"
          >
            <span className="live-dot" />
            {t(
              !projection
                ? "reconnecting"
                : online
                  ? streamLive
                    ? "live"
                    : streamDegraded
                      ? "polling"
                      : "reconnecting"
                  : "offline",
            )}
          </span>
        </div>
        {!online && (
          <div className="notice offline" role="status">
            <Icon name="offline" />
            <div>
              <strong>{t(projection ? "offline" : "cacheCleared")}</strong>
              <p>
                {lastUpdated
                  ? t("offlineSince", {
                      time: formatDate(lastUpdated, locale, zone),
                    })
                  : t("cacheCleared")}
              </p>
            </div>
          </div>
        )}
        {projection && !projection.display.timezone && (
          <p className="field-hint">{t("timezoneFallback")}</p>
        )}
        {cards.length ? (
          <div className="display-cards">
            {layout === "board"
              ? cards.map((card, i) => (
                  <DisplayCard
                    key={card.id}
                    card={card}
                    zone={zone}
                    primary={i === 0}
                  />
                ))
              : Array.from(
                  cards.reduce((groups, card) => {
                    groups.set(card.author, [
                      ...(groups.get(card.author) ?? []),
                      card,
                    ]);
                    return groups;
                  }, new Map<string, Card[]>()),
                ).map(([author, group]) => (
                  <section className="person-column" key={author}>
                    <h2>
                      <span className="avatar">{author.slice(0, 1)}</span>
                      {author}
                    </h2>
                    {group!
                      .sort(
                        (a, b) =>
                          Date.parse(a.publishAt) - Date.parse(b.publishAt),
                      )
                      .map((card) => (
                        <DisplayCard key={card.id} card={card} zone={zone} />
                      ))}
                  </section>
                ))}
          </div>
        ) : (
          <Empty
            title={t(
              !projection
                ? cacheExpired
                  ? "cacheClearedTitle"
                  : "displayUnavailable"
                : projection.display.privacyMode
                  ? "privacyMode"
                  : "displayEmpty",
            )}
            body={t(
              projection?.display.privacyMode
                ? "displayPrivacyBody"
                : !online
                  ? "cacheCleared"
                  : "displayEmptyBody",
            )}
          />
        )}
      </main>
      <footer className="display-footer">
        <span>
          <Icon name="shield" />
          {t("allowedContent")}
        </span>
        <span>
          {lastUpdated
            ? t("updated", {
                time: formatDate(lastUpdated, locale, zone, {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              })
            : t("reconnecting")}
        </span>
      </footer>
      {options && (
        <Dialog title={t("displayOptions")} onClose={() => setOptions(false)}>
          <p className="field-hint">
            {t("displayTheme")} · {t("displayLocale")}
          </p>
          <p>{t("restrictedNotice")}</p>
          <label className="field">
            <span>{t("displayLayout")}</span>
            <select
              value={layout}
              onChange={(e) => {
                const v = e.target.value as "board" | "timeline";
                setLayout(v);
                try {
                  localStorage.setItem("samvev.display.layout", v);
                } catch {}
              }}
            >
              <option value="board">{t("board")}</option>
              <option value="timeline">{t("timeline")}</option>
            </select>
          </label>
          <button
            className="button"
            onClick={() => {
              void document.documentElement
                .requestFullscreen?.()
                .catch(() => undefined);
              setOptions(false);
            }}
          >
            {t("fullScreen")}
          </button>
        </Dialog>
      )}
    </div>
  );
}
export function DisplayCard({
  card,
  zone,
  primary = false,
}: {
  card: Card;
  zone: string;
  primary?: boolean;
}) {
  const { t, locale } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const bodyElement = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const element = bodyElement.current;
    if (!element || expanded) return;
    const measure = () =>
      setOverflow(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [card.body, expanded]);
  return (
    <article
      data-card-id={card.id}
      className={`display-card ${card.importance} ${primary ? "primary-card" : ""}`}
    >
      <div className="display-card-top">
        <span className={`message-type ${card.importance}`}>
          <Icon name={card.importance === "attention" ? "sun" : "message"} />
          {t(card.importance)}
        </span>
        <span>
          {formatDate(card.publishAt, locale, zone, {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
      <p
        ref={bodyElement}
        className={`display-card-body ${expanded ? "expanded" : ""}`}
      >
        {card.body}
      </p>
      {(overflow || expanded) && (
        <button
          className="text-button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {t(expanded ? "readLess" : "readMore")}
        </button>
      )}
      <div className="display-card-meta">
        <span className="avatar">{card.author.slice(0, 1)}</span>
        <strong>{t("from", { name: card.author })}</strong>
        <span className="display-until">
          <Icon name="clock" />
          {t("until", {
            time: formatDate(card.expiresAt, locale, zone, {
              hour: "2-digit",
              minute: "2-digit",
            }),
          })}
        </span>
      </div>
    </article>
  );
}
function Pairing({
  prefs,
  setPrefs,
  revoked,
  onPaired,
}: {
  prefs: Preferences;
  setPrefs: (p: Preferences) => void;
  revoked: boolean;
  onPaired: () => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const { error, busy, run, setError } = useAction();
  const [pair, setPair] = useState<{
    pairingId: string;
    code: string;
    expiresAt: string;
  } | null>(null);
  const verifier = useRef("");
  const [expired, setExpired] = useState(false);
  const redeemActive = useRef(false);
  const generate = () =>
    void run(async () => {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      verifier.current = btoa(String.fromCharCode(...bytes))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
      const hash = sha256(new TextEncoder().encode(verifier.current));
      const verifierHash = Array.from(hash, (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      const next = await api<{
        pairingId: string;
        code: string;
        expiresAt: string;
      }>("/display/pairing/start", "POST", { verifierHash });
      setPair(next);
      setExpired(false);
    });
  useEffect(() => {
    if (!pair || expired) return;
    const timer = setInterval(async () => {
      if (Date.now() >= Date.parse(pair.expiresAt)) {
        setExpired(true);
        verifier.current = "";
        return;
      }
      if (redeemActive.current || !navigator.onLine) return;
      try {
        const status = await api<{ approved: boolean; expired: boolean }>(
          `/display/pairing/${pair.pairingId}/status`,
        );
        if (status.expired) {
          setExpired(true);
          verifier.current = "";
        } else if (status.approved) {
          redeemActive.current = true;
          await api("/display/pairing/redeem", "POST", {
            pairingId: pair.pairingId,
            verifier: verifier.current,
          });
          verifier.current = "";
          await onPaired();
        }
      } catch (error) {
        setError(error);
        redeemActive.current = false;
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [pair, expired, onPaired, setError]);
  return (
    <div className="public-page pairing-page">
      <header className="public-header">
        <Brand />
        <PrefControls prefs={prefs} onChange={setPrefs} />
      </header>
      <main className="pairing-main">
        <div className="pairing-symbol">
          <Icon name="display" size={60} />
        </div>
        <p className="eyebrow">{t("pairingEyebrow")}</p>
        <h1>{t("pairingTitle")}</h1>
        <p className="lead">{t("pairingBody")}</p>
        {revoked && <p className="notice">{t("revokedNotice")}</p>}
        {pair && !expired ? (
          <>
            <div
              className="pairing-code"
              aria-label={t("pairingCode")}
              data-testid="pairing-code"
            >
              {pair.code}
            </div>
            <p className="waiting">
              <span className="live-dot" />
              {t("waitingApproval")}
            </p>
            <p>
              {t("codeExpires", {
                time: formatDate(
                  pair.expiresAt,
                  locale,
                  Intl.DateTimeFormat().resolvedOptions().timeZone,
                  { hour: "2-digit", minute: "2-digit" },
                ),
              })}
            </p>
          </>
        ) : (
          <>
            <p>{expired ? t("codeExpired") : ""}</p>
            <button
              className="button primary"
              disabled={busy}
              onClick={generate}
            >
              {t(expired ? "regenerate" : "generateCode")}
              <Icon name="arrow" />
            </button>
          </>
        )}
        <ErrorNotice error={error} />
        <p className="restricted-note">
          <Icon name="shield" />
          {t("restrictedNotice")}
        </p>
      </main>
    </div>
  );
}
