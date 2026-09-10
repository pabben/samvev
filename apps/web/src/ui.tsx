import {
  Children,
  Component,
  cloneElement,
  isValidElement,
  type ReactElement,
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
  type ErrorInfo,
} from "react";
import { en, type TranslationKey } from "./locales/en";
import { nb } from "./locales/nb";
import type { Locale, Theme } from "./types";
import { ApiError } from "./api";
export interface Preferences {
  locale: Locale;
  theme: Theme;
}
const I18n = createContext<{
  locale: Locale;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}>({ locale: "nb", t: (k) => nb[k] });
export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <I18n.Provider
      value={{
        locale,
        t: (key, vars = {}) =>
          Object.entries(vars).reduce(
            (s, [k, v]) =>
              s.replaceAll(
                `{${k}}`,
                typeof v === "number"
                  ? new Intl.NumberFormat(locale).format(v)
                  : v,
              ),
            (locale === "nb" ? nb : en)[
              key === "messageCount" &&
              typeof vars.count === "number" &&
              new Intl.PluralRules(locale).select(vars.count) === "one"
                ? "messageCountOne"
                : key
            ],
          ),
      }}
    >
      {children}
    </I18n.Provider>
  );
}
export const useI18n = () => useContext(I18n);
export function usePreferences(storageKey = "samvev.preferences") {
  const [hadStoredValue] = useState(() => {
    try { return localStorage.getItem(storageKey) !== null; } catch { return false; }
  });
  const [prefs, setPrefs] = useState<Preferences>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
      return {
        locale: v.locale === "en" ? "en" : "nb",
        theme: ["light", "dark", "system"].includes(v.theme)
          ? v.theme
          : "system",
      };
    } catch {
      return { locale: "nb", theme: "system" };
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(prefs));
    } catch {}
    document.documentElement.lang = prefs.locale;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        prefs.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : prefs.theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [prefs, storageKey]);
  return [prefs, setPrefs, hadStoredValue] as const;
}
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    message: (
      <>
        <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 0 1 4 11.5 8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" />
        <path d="M8 10h8M8 14h5" />
      </>
    ),
    people: (
      <>
        <circle cx="9" cy="7" r="3" />
        <path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-3-5" />
      </>
    ),
    display: (
      <>
        <rect x="2" y="3" width="20" height="14" rx="3" />
        <path d="M8 21h8M12 17v4" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1" />
      </>
    ),
    leaf: (
      <>
        <path d="M20 4C7 3 2 10 7 16s14 1 13-12ZM4 21 16 9" />
      </>
    ),
    offline: (
      <>
        <path d="m3 3 18 18M2 8a17 17 0 0 1 3-2m4-1a17 17 0 0 1 13 3M5 12a11 11 0 0 1 4-2m5 0a11 11 0 0 1 5 2M8 16a6 6 0 0 1 5-1" />
        <circle cx="12" cy="20" r=".5" />
      </>
    ),
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    logout: (
      <>
        <path d="M9 4H4v16h5M10 12h11m-4-4 4 4-4 4" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="15" cy="17" r="3" />
      </>
    ),
    spark: (
      <>
        <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.message}
    </svg>
  );
}
export function Brand({ onHome }: { onHome?: () => void } = {}) {
  return (
    <a className="brand" href="/" aria-label="Samvev" onClick={(event) => {
      if (!onHome || event.defaultPrevented || event.button !== 0 ||
          event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      onHome();
    }}>
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span>
        samvev<span className="brand-dot">.</span>
      </span>
    </a>
  );
}

function RenderFailure() {
  let locale: Locale = "nb";
  try {
    if (JSON.parse(localStorage.getItem("samvev.preferences") ?? "{}").locale === "en") locale = "en";
  } catch { /* A storage failure must not break the recovery view. */ }
  const text = locale === "en" ? en : nb;
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  return (
    <main id="main" className="auth-wrap" lang={locale}>
      <Brand />
      <h1>{text.pageLoadFailedTitle}</h1>
      <p className="lead">{text.pageLoadFailedBody}</p>
      <button className="button primary" onClick={() => location.reload()}>{text.pageLoadFailedRetry}</button>
    </main>
  );
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV || import.meta.env.MODE === "test") {
      console.error("Samvev render failed", error, info.componentStack);
    }
  }
  render() { return this.state.failed ? <RenderFailure /> : this.props.children; }
}
export function PrefControls({
  prefs,
  onChange,
  disabled = false,
}: {
  prefs: Preferences;
  disabled?: boolean;
  onChange: (value: Preferences) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="pref-controls">
      <label>
        <span className="sr-only">{t("language")}</span>
        <select
          disabled={disabled}
          aria-label={t("language")}
          value={prefs.locale}
          onChange={(e) =>
            onChange({ ...prefs, locale: e.target.value as Locale })
          }
        >
          <option value="en">{t("en")}</option>
          <option value="nb">{t("nb")}</option>
        </select>
      </label>
      <label>
        <span className="sr-only">{t("appearance")}</span>
        <select
          disabled={disabled}
          aria-label={t("appearance")}
          value={prefs.theme}
          onChange={(e) =>
            onChange({ ...prefs, theme: e.target.value as Theme })
          }
        >
          {(["light", "dark", "system"] as const).map((v) => (
            <option key={v} value={v}>
              {t(v)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
/** One observable write at a time; disabled controls cannot submit stale combinations. */
export function PreferenceEditor({
  prefs,
  onSave,
}: {
  prefs: Preferences;
  onSave: (prefs: Preferences) => Promise<void>;
}) {
  const { t } = useI18n();
  const active = useRef(false);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [error, setError] = useState<unknown>();
  const save = async (next: Preferences) => {
    if (active.current) return;
    active.current = true;
    setState("saving");
    setError(undefined);
    try {
      await onSave(next);
      setState("saved");
    } catch (error) {
      setError(error);
      setState("error");
    } finally {
      active.current = false;
    }
  };
  return (
    <div className="preference-editor" aria-busy={state === "saving"}>
      <PrefControls
        prefs={prefs}
        disabled={state === "saving"}
        onChange={(next) => void save(next)}
      />
      <p
        role="status"
        data-testid="preference-save-status"
        className="field-hint"
      >
        {state === "saving"
          ? t("saving")
          : state === "saved"
            ? t("preferencesSaved")
            : ""}
      </p>
      <ErrorNotice error={error} />
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {Children.map(children, (child) =>
        isValidElement(child) &&
        ["input", "select", "textarea"].includes(String(child.type))
          ? cloneElement(child as ReactElement<Record<string, unknown>>, {
              id,
              "aria-describedby": hint ? `${id}-hint` : undefined,
            })
          : child,
      )}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}

export function Check({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
export function Status({ state }: { state: string }) {
  const { t } = useI18n();
  return (
    <span className={`status status-${state}`}>
      <span aria-hidden="true">
        {["published", "displayed", "delivered"].includes(state)
          ? "✓"
          : ["scheduled", "queued"].includes(state)
            ? "◷"
            : "•"}
      </span>
      {t(state in en ? (state as TranslationKey) : "normal")}
    </span>
  );
}
export function Avatar({ name, index = 0 }: { name: string; index?: number }) {
  return (
    <span className={`avatar accent-${index % 4}`} aria-hidden="true">
      {name.trim().slice(0, 1).toLocaleUpperCase()}
    </span>
  );
}
export function ErrorNotice({ error }: { error: unknown }) {
  const { t } = useI18n();
  if (!error) return null;
  const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
  const reason = error instanceof ApiError && typeof error.details?.reason === "string" ? error.details.reason : undefined;
  const key = reason && reason in en ? reason : code in en ? code : "INTERNAL_ERROR";
  return (
    <div role="alert" className="notice error">
      <Icon name="shield" />
      <span>{t(key as TranslationKey)}</span>
    </div>
  );
}
export function Empty({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-art" aria-hidden="true">
        <Icon name="leaf" size={42} />
        <span />
        <span />
      </div>
      <h2>{title}</h2>
      <p>{body}</p>
      {children}
    </div>
  );
}
export function Loading() {
  const { t } = useI18n();
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      {t("loading")}
    </div>
  );
}
export function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => {
      active?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "dialog dialog-wide" : "dialog"}
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
        )).filter((node) => node.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-header">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label={t("close")}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function useAction() {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return { error, setError, busy, run };
}
export function Submit({
  busy,
  label,
  disabled = false,
}: {
  busy: boolean;
  label: string;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <button
      className="button primary"
      type="submit"
      disabled={busy || disabled}
    >
      {busy ? t("saving") : label}
      <Icon name={busy ? "clock" : "arrow"} />
    </button>
  );
}
export const formValue = (event: FormEvent<HTMLFormElement>, name: string) =>
  String(new FormData(event.currentTarget).get(name) ?? "");
export { ApiError };
