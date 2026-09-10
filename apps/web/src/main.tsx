import { en } from "./locales/en";
import { nb } from "./locales/nb";
import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useState } from "react";
import { api, setCsrf } from "./api";
import type { Me } from "./types";
import {
  Brand,
  AppErrorBoundary,
  ErrorNotice,
  Field,
  Icon,
  Loading,
  LocaleProvider,
  PrefControls,
  Submit,
  useAction,
  useI18n,
  usePreferences,
  type Preferences,
} from "./ui";
import { MemberApp } from "./member";
import { DisplayApp } from "./display";
import { Workbench } from "./workbench";
import { PASSWORD_MAX_LENGTH, validateNewPasswordInput } from "./password-policy";
import "../../../packages/design-tokens/tokens.css";
import "./style.css";
function App() {
  const [prefs, setPrefs, hadStoredPreferences] = usePreferences();
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<{
    claimed: boolean;
    demo: boolean;
    demoAvailable: boolean;
    locale: "en" | "nb";
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [claim, setClaim] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const status = await api<{
        claimed: boolean;
        demo: boolean;
        demoAvailable: boolean;
        locale: "en" | "nb";
      }>("/setup/status");
      setStatus(status);
      if (!hadStoredPreferences)
        setPrefs((current) => ({ ...current, locale: status.locale }));
      if (status.claimed) {
        try {
          const me = await api<Me>("/me");
          setCsrf(me.csrfToken);
          setMe(me);
          setPrefs({ locale: me.account.locale, theme: me.account.theme });
        } catch (error) {
          if ((error as { status: number }).status !== 401) throw error;
          setMe(null);
        }
      }
      setError(null);
    } catch (error) {
      setError(error);
    } finally {
      setLoading(false);
    }
  }, [hadStoredPreferences, setPrefs]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const preferences = async (next: Preferences) => {
    if (me) {
      await api("/me/preferences", "PATCH", next);
    }
    setPrefs(next);
  };
  return (
    <LocaleProvider locale={prefs.locale}>
      {loading ? (
        <Loading />
      ) : error ? (
        <div className="auth-wrap">
          <Brand />
          <ErrorNotice error={error} />
          <button
            className="button"
            onClick={() => void refresh()}
            aria-label={(prefs.locale === "nb" ? nb : en).retry}
          >
            ↻
          </button>
        </div>
      ) : location.pathname === "/invitation" ? (
        <div className="public-page">
          <header className="public-header"><Brand /><PrefControls prefs={prefs} onChange={setPrefs} /></header>
          <AcceptInvitation onSuccess={refresh} />
        </div>
      ) : me ? (
        <MemberApp
          me={me}
          demo={status?.demo ?? false}
          prefs={prefs}
          onPreferences={preferences}
          onSessionChange={refresh}
        />
      ) : (
        <div className="public-page">
          <header className="public-header">
            <Brand />
            <PrefControls prefs={prefs} onChange={setPrefs} />
          </header>
          {status?.claimed ? (
            <SignIn onSuccess={refresh} />
          ) : claim ? (
            <Claim
              prefs={prefs}
              onSuccess={refresh}
              onBack={() => setClaim(false)}
            />
          ) : (
            <Welcome
              prefs={prefs}
              onPrefs={setPrefs}
              onStart={() => setClaim(true)}
              demoAvailable={status?.demoAvailable ?? false}
              onSuccess={refresh}
            />
          )}
        </div>
      )}
    </LocaleProvider>
  );
}
function AcceptInvitation({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const { t } = useI18n();
  const { busy, error, run } = useAction();
  const token = new URLSearchParams(location.hash.slice(1)).get("token");
  return (
    <main className="auth-wrap" id="main">
      <div className="auth-symbol"><Icon name="lock" size={38} /></div>
      <h1>{t("invitationTitle")}</h1>
      <p className="lead">{t("invitationBody")}</p>
      {!token ? <p role="alert" className="notice error">{t("invitationMissing")}</p> : (
        <form className="form-stack" onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void run(async () => {
            await api("/auth/invitations/accept", "POST", { token, password: data.get("password") });
            history.replaceState({}, "", "/");
            await onSuccess();
          });
        }}>
          <Field label={t("newPassword")} hint={t("passwordHint")}>
            <input name="password" type="password" autoComplete="new-password" maxLength={PASSWORD_MAX_LENGTH} required autoFocus onInput={(event)=>validateNewPasswordInput(event.currentTarget,t("passwordPolicyError"))} />
          </Field>
          <ErrorNotice error={error} />
          <Submit busy={busy} label={t("activateAccount")} />
        </form>
      )}
    </main>
  );
}
function Welcome({
  prefs,
  onPrefs,
  onStart,
  demoAvailable,
  onSuccess,
}: {
  prefs: Preferences;
  onPrefs: (p: Preferences) => void;
  onStart: () => void;
  demoAvailable: boolean;
  onSuccess: () => Promise<void>;
}) {
  const { t } = useI18n();
  const { busy, error, run } = useAction();
  return (
    <main className="welcome" id="main">
      <div className="welcome-copy">
        <p className="eyebrow">{t("welcomeEyebrow")}</p>
        <h1>{t("welcomeTitle")}</h1>
        <p className="lead">{t("welcomeBody")}</p>
        <div className="welcome-actions">
          <button className="button primary" onClick={onStart}>
            {t("start")}
            <Icon name="arrow" />
          </button>
          {demoAvailable && (
            <>
              <button
                className="button subtle"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api("/setup/demo", "POST", {});
                    await onSuccess();
                  })
                }
              >
                {t("demo")}
                <Icon name="spark" />
              </button>
              <small>{t("demoHelp")}</small>
            </>
          )}
        </div>
        <ErrorNotice error={error} />
        <details className="privacy-details">
          <summary>{t("privacy")}</summary>
          <p>{t("privacyBody")}</p>
          <a href="https://github.com/pabben/samvev" rel="noreferrer">
            {t("source")}
          </a>
        </details>
        <p className="local-note">
          <Icon name="shield" />
          {t("localNotice")}
        </p>
      </div>
      <div className="welcome-scene" aria-hidden="true">
        <div className="scene-orbit" />
        <div className="scene-leaf leaf-one" />
        <div className="scene-leaf leaf-two" />
        <div className="scene-tag">
          <span className="live-dot" />
          {t("tagline")}
        </div>
        <div className="scene-card">
          <div className="scene-avatar">R</div>
          <div className="scene-line medium" />
          <div className="scene-line" />
          <div className="scene-line short" />
          <div className="scene-card-footer">
            <Icon name="clock" />
            <span>07:00</span>
            <span className="scene-check">
              <Icon name="check" />
            </span>
          </div>
        </div>
        <div className="scene-note">
          <Icon name="leaf" size={34} />
          <span>{t("displayGreeting")}</span>
        </div>
      </div>
    </main>
  );
}
function Claim({
  prefs,
  onSuccess,
  onBack,
}: {
  prefs: Preferences;
  onSuccess: () => Promise<void>;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const { busy, error, run } = useAction();
  return (
    <main className="auth-wrap" id="main">
      <p className="eyebrow">01 / 03 · {t("setup")}</p>
      <h1>{t("ownerTitle")}</h1>
      <p className="lead">{t("ownerBody")}</p>
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void run(async () => {
            const { claimToken } = await api<{ claimToken: string }>(
              "/setup/begin",
              "POST",
              {},
            );
            await api("/setup/claim", "POST", {
              claimToken,
              owner: {
                displayName: data.get("name"),
                email: data.get("email"),
                password: data.get("password"),
              },
              household: {
                name: data.get("household"),
                timezone: data.get("timezone"),
                locale: prefs.locale,
              },
              preferences: prefs,
            });
            await onSuccess();
          });
        }}
      >
        <div className="form-grid">
          <Field label={t("ownerName")}>
            <input
              name="name"
              autoComplete="nickname"
              required
              maxLength={80}
            />
          </Field>
          <Field label={t("householdName")}>
            <input name="household" required maxLength={80} />
          </Field>
        </div>
        <Field label={t("email")}>
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            maxLength={254}
          />
        </Field>
        <Field label={t("password")} hint={t("passwordHint")}>
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            required
            maxLength={PASSWORD_MAX_LENGTH}
            onInput={(event)=>validateNewPasswordInput(event.currentTarget,t("passwordPolicyError"))}
          />
        </Field>
        <Field label={t("timezone")}>
          <input
            name="timezone"
            defaultValue={
              Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Oslo"
            }
            list="timezones"
            required
          />
          <datalist id="timezones">
            <option>Europe/Oslo</option>
            <option>Europe/London</option>
            <option>America/New_York</option>
            <option>UTC</option>
          </datalist>
        </Field>
        <ErrorNotice error={error} />
        <div className="form-actions">
          <button className="button subtle" type="button" onClick={onBack}>
            {t("back")}
          </button>
          <Submit busy={busy} label={t("createHousehold")} />
        </div>
      </form>
    </main>
  );
}
function SignIn({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const { t } = useI18n();
  const { busy, error, run } = useAction();
  return (
    <main className="auth-wrap" id="main">
      <div className="auth-symbol">
        <Icon name="leaf" size={38} />
      </div>
      <h1>{t("signInTitle")}</h1>
      <p className="lead">{t("signInBody")}</p>
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void run(async () => {
            await api("/auth/login", "POST", {
              email: data.get("email"),
              password: data.get("password"),
            });
            await onSuccess();
          });
        }}
      >
        <Field label={t("email")}>
          <input name="email" type="email" autoComplete="username" required />
        </Field>
        <Field label={t("password")}>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
        {error && (error as Error).message === "UNAUTHENTICATED" ? (
          <p role="alert" className="notice error">
            {t("signInFailed")}
          </p>
        ) : (
          <ErrorNotice error={error} />
        )}
        <Submit busy={busy} label={t("signIn")} />
      </form>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>{location.pathname === "/display" ? (
    <DisplayApp />
  ) : location.pathname === "/workbench" ? (
    <Workbench />
  ) : (
    <App />
  )}</AppErrorBoundary>,
);
