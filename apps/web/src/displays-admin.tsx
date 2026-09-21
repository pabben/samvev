import { useState } from "react";
import { api } from "./api";
import type { Display, Membership } from "./types";
import {
  Check,
  Dialog,
  Empty,
  ErrorNotice,
  Field,
  Icon,
  Submit,
  useAction,
  useI18n,
} from "./ui";
import { formatDate } from "./time";
export function DisplaysPanel({
  displays,
  member,
  refresh,
}: {
  displays: Display[];
  member: Membership;
  refresh: () => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [pair, setPair] = useState(false);
  const [revoke, setRevoke] = useState<Display | null>(null);
  const { error, busy, run } = useAction();
  const manage = member.capabilities.includes("display.manage");
  const update = async (d: Display, change: object) => {
    await api(
      `/households/${member.household_id}/displays/${d.id}`,
      "PATCH",
      change,
    );
    await refresh();
  };
  return (
    <>
      <section className="section-heading">
        <div>
          <p className="eyebrow">{t("displays")}</p>
          <h1>{t("displaysTitle")}</h1>
          <p>{t("displaysBody")}</p>
        </div>
        {manage && (
          <button className="button primary" onClick={() => setPair(true)}>
            <Icon name="plus" />
            {t("pairDisplay")}
          </button>
        )}
      </section>
      <ErrorNotice error={error} />
      <div className="display-grid">
        {displays.map((d) => (
          <article className="display-admin-card" key={d.id}>
            <div className="display-illustration" aria-hidden="true">
              <Icon name="display" size={76} />
            </div>
            <h2>{d.name}</h2>
            <p className="field-hint">
              {d.revoked_at
                ? t("revoked")
                : d.last_seen_at
                  ? t("lastSeen", {
                      time: formatDate(d.last_seen_at, locale, member.timezone),
                    })
                  : t("neverSeen")}
            </p>
            <p className="scope-label">
              <Icon name="shield" />
              {t("allowedContent")}
            </p>
            {manage && !d.revoked_at && (
              <>
                <div className="form-grid">
                  <Field label={t("displayLocale")}>
                    <select
                      value={d.locale}
                      onChange={(e) =>
                        void run(() => update(d, { locale: e.target.value }))
                      }
                    >
                      <option value="en">{t("en")}</option>
                      <option value="nb">{t("nb")}</option>
                    </select>
                  </Field>
                  <Field label={t("displayTheme")}>
                    <select
                      value={d.theme}
                      onChange={(e) =>
                        void run(() => update(d, { theme: e.target.value }))
                      }
                    >
                      {(["light", "dark", "system"] as const).map((v) => (
                        <option key={v} value={v}>
                          {t(v)}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Check
                  label={t("displayPrivacy")}
                  checked={d.privacy_mode}
                  onChange={(v) =>
                    void run(() => update(d, { privacyMode: v }))
                  }
                />
                <button
                  className="text-button danger-text"
                  onClick={() => setRevoke(d)}
                >
                  {t("revoke")}
                </button>
              </>
            )}
          </article>
        ))}
      </div>
      {!displays.length && (
        <Empty title={t("noDisplays")} body={t("noDisplaysBody")}>
          {manage && (
            <button className="button" onClick={() => setPair(true)}>
              {t("pairDisplay")}
            </button>
          )}
        </Empty>
      )}
      {pair && (
        <PairDialog
          member={member}
          onClose={() => setPair(false)}
          onSaved={async () => {
            setPair(false);
            await refresh();
          }}
        />
      )}
      {revoke && (
        <Dialog title={t("revokeTitle")} onClose={() => setRevoke(null)}>
          <p>{t("revokeBody")}</p>
          <ErrorNotice error={error} />
          <div className="form-actions">
            <button className="button subtle" onClick={() => setRevoke(null)}>
              {t("cancel")}
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await update(revoke, { revoked: true });
                  setRevoke(null);
                })
              }
            >
              {t("revokeConfirm")}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
function PairDialog({
  member,
  onClose,
  onSaved,
}: {
  member: Membership;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const { busy, error, run } = useAction();
  const [privacy, setPrivacy] = useState(false);
  return (
    <Dialog title={t("pairDisplay")} onClose={onClose}>
      <p>{t("pairingInstructions")}</p>
      <a className="button" href="/display" target="_blank" rel="noreferrer">
        <Icon name="display" />
        {t("openDisplay")}
      </a>
      <form
        className="form-stack pairing-form"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void run(async () => {
            await api(
              `/households/${member.household_id}/displays/pairing/approve`,
              "POST",
              {
                code: data.get("code"),
                name: data.get("name"),
                locale: data.get("locale"),
                theme: data.get("theme"),
                privacyMode: privacy,
                allowedContent: "household_messages",
              },
            );
            await onSaved();
          });
        }}
      >
        <Field label={t("pairingCode")}>
          <input
            name="code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            minLength={6}
            maxLength={6}
            required
            autoComplete="one-time-code"
            className="code-input"
          />
        </Field>
        <Field label={t("displayName")}>
          <input name="name" maxLength={80} required />
        </Field>
        <div className="form-grid">
          <Field label={t("displayLocale")}>
            <select name="locale" defaultValue={locale}>
              <option value="en">{t("en")}</option>
              <option value="nb">{t("nb")}</option>
            </select>
          </Field>
          <Field label={t("displayTheme")}>
            <select name="theme" defaultValue="system">
              {(["light", "dark", "system"] as const).map((v) => (
                <option key={v} value={v}>
                  {t(v)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Check
          label={t("displayPrivacy")}
          checked={privacy}
          onChange={setPrivacy}
        />
        <p className="scope-label">
          <Icon name="shield" />
          {t("allowedContent")}
        </p>
        <ErrorNotice error={error} />
        <div className="form-actions">
          <button className="button subtle" type="button" onClick={onClose}>
            {t("cancel")}
          </button>
          <Submit busy={busy} label={t("approvePairing")} />
        </div>
      </form>
    </Dialog>
  );
}
