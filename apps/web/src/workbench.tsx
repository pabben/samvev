import { useState } from "react";
import {
  Avatar,
  Brand,
  Empty,
  ErrorNotice,
  Field,
  Icon,
  Loading,
  LocaleProvider,
  PrefControls,
  Status,
  useI18n,
  usePreferences,
  type Preferences,
} from "./ui";
import { DisplayCard } from "./display";
export function Workbench() {
  const [prefs, setPrefs] = usePreferences("samvev.workbench.preferences");
  return (
    <LocaleProvider locale={prefs.locale}>
      <Examples prefs={prefs} setPrefs={setPrefs} />
    </LocaleProvider>
  );
}
function Examples({
  prefs,
  setPrefs,
}: {
  prefs: Preferences;
  setPrefs: (p: Preferences) => void;
}) {
  const { t } = useI18n();
  const [start, setStart] = useState("2026-09-07T07:00");
  return (
    <div className="workbench">
      <header className="public-header">
        <Brand />
        <PrefControls prefs={prefs} onChange={setPrefs} />
      </header>
      <main>
        <p className="eyebrow">{t("components")}</p>
        <h1>{t("workbench")}</h1>
        <p>{t("workbenchBody")}</p>
        <div className="demo-banner">
          <Icon name="spark" />
          {t("demoBadge")}
        </div>
        <header className="display-header">
          <div>
            <Brand />
            <div className="display-identity">
              <span>{t("sampleHousehold")}</span>
              <strong>{t("sampleDisplay")}</strong>
            </div>
          </div>
          <div className="display-date">
            <strong>
              {new Intl.DateTimeFormat(prefs.locale, {
                timeZone: "Europe/Oslo",
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date("2026-09-07T05:00:00Z"))}
            </strong>
            <span>
              {new Intl.DateTimeFormat(prefs.locale, {
                timeZone: "Europe/Oslo",
                weekday: "long",
                day: "numeric",
                month: "long",
              }).format(new Date("2026-09-07T05:00:00Z"))}
            </span>
          </div>
        </header>
        <div className="workbench-grid">
          <section>
            <DisplayCard
              zone="Europe/Oslo"
              primary
              card={{
                id: "synthetic",
                kind: "household_message",
                body: t("sampleMessage"),
                author: t("sampleAuthor"),
                importance: "attention",
                publishAt: "2026-09-07T05:00:00Z",
                expiresAt: "2026-09-07T08:00:00Z",
                revision: 1,
              }}
            />
            <div className="workbench-badges">
              <Avatar name={t("sampleAuthor")} />
              {[
                "scheduled",
                "published",
                "displayed",
                "expired",
                "withdrawn",
                "failed",
              ].map((state) => (
                <Status key={state} state={state} />
              ))}
            </div>
          </section>
          <section className="surface-card">
            <h2>{t("scheduleControls")}</h2>
            <p>{t("timezoneNote", { zone: "Europe/Oslo" })}</p>
            <Field label={t("startTime")}>
              <input
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field label={t("expiry")}>
              <input type="datetime-local" defaultValue="2026-09-07T10:00" />
            </Field>
          </section>
          <section>
            <h2>{t("empty")}</h2>
            <Empty title={t("emptyNow")} body={t("emptyNowBody")} />
          </section>
          <section className="surface-card">
            <h2>{t("offlineState")}</h2>
            <div className="notice offline">
              <Icon name="offline" />
              <span>{t("offline")}</span>
            </div>
            <h2>{t("errorState")}</h2>
            <ErrorNotice error={new Error("OFFLINE")} />
            <h2>{t("loadingState")}</h2>
            <Loading />
          </section>
        </div>
      </main>
    </div>
  );
}
