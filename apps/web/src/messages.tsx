import { useRef, useState } from "react";
import { api, ApiError } from "./api";
import type { Display, Membership, Message, Person } from "./types";
import {
  Avatar,
  Check,
  Dialog,
  ErrorNotice,
  Field,
  Icon,
  Submit,
  useAction,
  useI18n,
} from "./ui";
import { formatDate, tomorrowMorning, wallInput, wallToInstant } from "./time";
export function Composer({
  message,
  people,
  displays,
  member,
  onClose,
  onSaved,
}: {
  message: Message | null;
  people: Person[];
  displays: Display[];
  member: Membership;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const { busy, error, run } = useAction();
  const [body, setBody] = useState(message?.body ?? "");
  const [household, setHousehold] = useState(
    message?.audience_household ?? true,
  );
  const [personIds, setPersonIds] = useState(message?.person_ids ?? []);
  const [displayIds, setDisplayIds] = useState(message?.display_ids ?? []);
  const [scheduled, setScheduled] = useState(message?.state === "scheduled");
  const [start, setStart] = useState(
    message
      ? wallInput(message.publish_at, member.timezone)
      : tomorrowMorning(member.timezone),
  );
  const [expiry, setExpiry] = useState(
    message
      ? wallInput(message.expires_at, member.timezone)
      : wallInput(Date.now() + 8 * 3600000, member.timezone),
  );
  const [attention, setAttention] = useState(
    message?.importance === "attention",
  );
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const allowed = displays.filter(
    (d) =>
      !d.revoked_at &&
      (member.capabilities.includes("display.manage") ||
        member.display_ids.includes(d.id)),
  );
  const toggle = (values: string[], id: string, checked: boolean) =>
    checked ? [...values, id] : values.filter((v) => v !== id);
  const setSchedule = (value: boolean) => {
    setScheduled(value);
    if (value && !message) {
      setExpiry(`${start.slice(0, 10)}T10:00`);
    } else if (!value && !message)
      setExpiry(wallInput(Date.now() + 8 * 3600000, member.timezone));
  };
  const previewTime = (value: string, key: "starts" | "until") => {
    try {
      return t(key, {
        time: formatDate(
          wallToInstant(value, member.timezone),
          locale,
          member.timezone,
        ),
      });
    } catch {
      return t("previewInvalidTime");
    }
  };
  return (
    <Dialog
      title={t(message ? "editTitle" : "composeTitle")}
      onClose={onClose}
      wide
    >
      <p className="dialog-intro">{t("composeBody")}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            if (!household && !personIds.length && !displayIds.length)
              throw new ApiError("AUDIENCE_REQUIRED");
            const publishAt = scheduled
              ? wallToInstant(start, member.timezone)
              : undefined;
            const expiresAt = wallToInstant(expiry, member.timezone);
            if (
              Date.parse(expiresAt) <= Date.now() ||
              Date.parse(expiresAt) <=
                (publishAt ? Date.parse(publishAt) : Date.now()) ||
              (scheduled && Date.parse(publishAt!) <= Date.now())
            )
              throw new ApiError("SCHEDULE_INVALID");
            const payload = {
              body,
              importance: attention ? "attention" : "normal",
              audience: { household, personIds, displayIds },
              expiresAt,
              ...(publishAt ? { publishAt } : {}),
            };
            const serialized = JSON.stringify(payload);
            if (attempt.current?.payload !== serialized)
              attempt.current = {
                payload: serialized,
                key: Array.from(
                  crypto.getRandomValues(new Uint8Array(24)),
                  (b) => b.toString(16).padStart(2, "0"),
                ).join(""),
              };
            await api(
              `/households/${member.household_id}/messages${message ? `/${message.id}` : ""}`,
              message ? "PATCH" : "POST",
              {
                ...payload,
                ...(message
                  ? { expectedRevision: message.revision }
                  : { idempotencyKey: attempt.current!.key }),
              },
            );
            await onSaved();
          });
        }}
      >
        <div className="composer-grid">
          <div className="form-stack">
            <Field label={t("messageBody")}>
              <textarea
                autoFocus
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                }}
                required
                maxLength={1000}
                rows={4}
                placeholder={t("messagePlaceholder")}
              />
              <small className="character-count">
                {t("characterCount", { count: body.length })}
              </small>
            </Field>
            <Check
              label={t("important")}
              checked={attention}
              onChange={setAttention}
            />
            <fieldset>
              <legend>{t("audience")}</legend>
              <Check
                label={t("wholeHousehold")}
                checked={household}
                onChange={setHousehold}
              />
              <details className="audience-details">
                <summary>{t("selectedPeople")}</summary>
                <div className="choice-grid">
                  {people.map((p) => (
                    <Check
                      key={p.id}
                      label={p.display_name}
                      checked={personIds.includes(p.id)}
                      onChange={(v) => setPersonIds(toggle(personIds, p.id, v))}
                    />
                  ))}
                </div>
              </details>
              {member.capabilities.includes("message.publish.display") && (
                <>
                  <h3>{t("targetDisplays")}</h3>
                  {allowed.length ? (
                    allowed.map((d) => (
                      <Check
                        key={d.id}
                        label={d.name}
                        checked={displayIds.includes(d.id)}
                        onChange={(v) =>
                          setDisplayIds(toggle(displayIds, d.id, v))
                        }
                      />
                    ))
                  ) : (
                    <p className="field-hint">{t("noDisplayGrants")}</p>
                  )}
                </>
              )}
              <p className="field-hint">{t("audienceHelp")}</p>
            </fieldset>
            <fieldset>
              <legend>{t("when")}</legend>
              <div className="segmented">
                <button
                  aria-pressed={!scheduled}
                  className={!scheduled ? "selected" : ""}
                  type="button"
                  onClick={() => setSchedule(false)}
                  disabled={message?.state === "scheduled"}
                >
                  {t("sendNow")}
                </button>
                <button
                  aria-pressed={scheduled}
                  className={scheduled ? "selected" : ""}
                  type="button"
                  onClick={() => setSchedule(true)}
                  disabled={
                    !member.capabilities.includes("message.schedule") ||
                    message?.state === "published"
                  }
                >
                  {t("schedule")}
                </button>
              </div>
              <p className="timezone-note">
                <Icon name="clock" />
                {t("timezoneNote", { zone: member.timezone })}
              </p>
              {scheduled && (
                <>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      const tomorrow = tomorrowMorning(member.timezone);
                      setStart(tomorrow);
                      setExpiry(`${tomorrow.slice(0, 10)}T10:00`);
                    }}
                  >
                    {t("tomorrow")}
                  </button>
                  <Field label={t("startTime")}>
                    <input
                      type="datetime-local"
                      value={start}
                      required
                      onChange={(e) => setStart(e.target.value)}
                    />
                  </Field>
                </>
              )}
              <Field label={t("expiry")} hint={t("expiryHelp")}>
                <input
                  type="datetime-local"
                  value={expiry}
                  required
                  onChange={(e) => setExpiry(e.target.value)}
                />
              </Field>
            </fieldset>
          </div>
          <aside className="preview-panel">
            <p className="eyebrow">{t("preview")}</p>
            <article
              className={`message-card preview-card ${attention ? "attention" : "normal"}`}
            >
              <span
                className={`message-type ${attention ? "attention" : "normal"}`}
              >
                <Icon name={attention ? "sun" : "message"} />
                {t(attention ? "attention" : "normal")}
              </span>
              <p className="message-text">{body || t("previewEmpty")}</p>
              <div className="card-meta">
                <Avatar name={message?.author_name ?? member.display_name} />
                <strong>
                  {t("from", {
                    name: message?.author_name ?? member.display_name,
                  })}
                </strong>
              </div>
              <p className="field-hint">
                {scheduled ? previewTime(start, "starts") : t("sendNow")}
              </p>
              <p className="field-hint">{previewTime(expiry, "until")}</p>
              <p className="field-hint">
                {t("timezoneNote", { zone: member.timezone })}
              </p>
            </article>
            <p>{t("previewHint")}</p>
            <div className="preview-audience">
              <Icon name="display" />
              <span>
                {displayIds
                  .map((id) => displays.find((d) => d.id === id)?.name)
                  .join(" · ") || t("noDeliveries")}
              </span>
            </div>
          </aside>
        </div>
        <ErrorNotice error={error} />
        <div className="form-actions sticky-actions">
          <button type="button" className="button subtle" onClick={onClose}>
            {t("cancel")}
          </button>
          <Submit
            busy={busy}
            label={t(message ? "save" : scheduled ? "scheduleSend" : "send")}
          />
        </div>
      </form>
    </Dialog>
  );
}
