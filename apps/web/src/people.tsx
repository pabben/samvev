import { useState } from "react";
import { api } from "./api";
import { initialDisplayGrants, loginPresentation } from "./person-policy";
import type { Display, Membership, Person } from "./types";
import type { TranslationKey } from "./locales/en";
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
const caps: Record<string, TranslationKey> = {
  "household.view": "viewHousehold",
  "message.create.household": "createMessages",
  "message.publish.display": "publishDisplay",
  "message.schedule": "scheduleMessages",
  "household.manage": "manageHousehold",
  "people.manage": "managePeople",
  "account.manage": "manageAccounts",
  "capability.manage": "managePermissions",
  "message.manage.household": "manageMessages",
  "display.manage": "manageDisplays",
  "installation.manage": "manageInstallation",
};
const elevatedCapabilities = new Set([
  "installation.manage",
  "household.manage",
  "people.manage",
  "account.manage",
  "capability.manage",
  "message.manage.household",
  "display.manage",
]);
function defaults(role: string, held: string[]): string[] {
  const result =
    role === "limited"
      ? ["household.view"]
      : role === "member"
        ? [
            "household.view",
            "message.create.household",
            "message.publish.display",
            "message.schedule",
          ]
        : held.filter(
            (c) => role === "installation_admin" || c !== "installation.manage",
          );
  return result.filter((cap) => held.includes(cap));
}
export function PeoplePanel({
  people,
  displays,
  member,
  refresh,
}: {
  people: Person[];
  displays: Display[];
  member: Membership;
  refresh: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<Person | null | undefined>(undefined);
  return (
    <>
      <section className="section-heading">
        <div>
          <p className="eyebrow">{t("people")}</p>
          <h1>{t("peopleTitle")}</h1>
          <p>{t("peopleBody")}</p>
        </div>
        {member.capabilities.includes("people.manage") && (
          <button className="button primary" onClick={() => setEditing(null)}>
            <Icon name="plus" />
            {t("addPerson")}
          </button>
        )}
      </section>
      <div className="person-grid">
        {people.map((p, i) => (
          <article className="person-card" key={p.id}>
            <Avatar name={p.display_name} index={i} />
            <h2>{p.display_name}</h2>
            <p>{t(p.role_preset as TranslationKey)}</p>
            <span className="person-login">
              <Icon name={loginPresentation(p).icon} />
              {t(loginPresentation(p).label)}
            </span>
            {member.capabilities.includes("account.manage") && p.email && (
              <p className="person-email">{p.email}</p>
            )}
            {member.capabilities.includes("people.manage") && (
              <ul className="permission-list">
                {p.capabilities.map((cap) => (
                  <li key={cap}>
                    <Icon name="check" size={14} />
                    {t(caps[cap]!)}
                  </li>
                ))}
              </ul>
            )}
            {member.capabilities.includes("capability.manage") && (
              <button className="button" onClick={() => setEditing(p)}>
                {t("editPermissions")}
              </button>
            )}
          </article>
        ))}
      </div>
      {editing !== undefined && (
        <PersonEditor
          person={editing}
          displays={displays}
          member={member}
          onClose={() => setEditing(undefined)}
          onSaved={async () => {
            setEditing(undefined);
            await refresh();
          }}
        />
      )}
    </>
  );
}
function PersonEditor({
  person,
  displays,
  member,
  onClose,
  onSaved,
}: {
  person: Person | null;
  displays: Display[];
  member: Membership;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const { busy, error, run } = useAction();
  const [role, setRole] = useState(person?.role_preset ?? "member");
  const [permissions, setPermissions] = useState(
    person?.capabilities ?? defaults("member", member.capabilities),
  );
  const [displayIds, setDisplayIds] = useState(() =>
    initialDisplayGrants(person?.display_ids ?? [], displays),
  );
  const [login, setLogin] = useState(false);
  const activeLogin = person
    ? (person.has_active_login ?? person.has_login)
    : login;
  const canCreateLogin = member.capabilities.includes("account.manage");
  const elevated =
    role === "household_admin" ||
    role === "installation_admin" ||
    permissions.some((cap) => elevatedCapabilities.has(cap));
  return (
    <Dialog
      title={t(person ? "editPermissions" : "addPerson")}
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void run(async () => {
            const policy = {
              rolePreset: role,
              capabilities: permissions,
              displayIds,
            };
            if (person)
              await api(
                `/households/${member.household_id}/memberships/${person.membership_id}`,
                "PATCH",
                { ...policy, expectedRevision: person.revision },
              );
            else
              await api(`/households/${member.household_id}/people`, "POST", {
                ...policy,
                displayName: data.get("name"),
                ageGroup: data.get("age"),
                ...(login
                  ? {
                      login: {
                        email: data.get("email"),
                        password: data.get("password"),
                        locale,
                        theme: "system",
                      },
                    }
                  : {}),
              });
            await onSaved();
          });
        }}
      >
        {person ? (
          <h3>{person.display_name}</h3>
        ) : (
          <>
            <Field label={t("personName")}>
              <input name="name" required maxLength={80} autoFocus />
            </Field>
            <Field label={t("ageGroup")}>
              <select name="age" defaultValue="unspecified">
                {(["unspecified", "adult", "teen", "child"] as const).map(
                  (v) => (
                    <option key={v} value={v}>
                      {t(v)}
                    </option>
                  ),
                )}
              </select>
            </Field>
          </>
        )}
        {!activeLogin && (
          <p className="field-hint">{t("activeLoginRequired")}</p>
        )}
        <Field label={t("role")}>
          <select
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setPermissions(defaults(e.target.value, member.capabilities));
            }}
          >
            {[
              "member",
              "limited",
              "household_admin",
              ...(member.capabilities.includes("installation.manage")
                ? ["installation_admin"]
                : []),
            ].map((v) => (
              <option
                key={v}
                value={v}
                disabled={
                  ["household_admin", "installation_admin"].includes(v) &&
                  !activeLogin
                }
              >
                {t(v as TranslationKey)}
              </option>
            ))}
          </select>
        </Field>
        <fieldset>
          <legend>{t("permissions")}</legend>
          <p className="field-hint">{t("permissionHint")}</p>
          {Object.entries(caps)
            .filter(([cap]) => member.capabilities.includes(cap))
            .map(([cap, label]) => (
              <Check
                key={cap}
                label={t(label)}
                checked={permissions.includes(cap)}
                disabled={elevatedCapabilities.has(cap) && !activeLogin}
                onChange={(checked) =>
                  setPermissions(
                    checked
                      ? [...permissions, cap]
                      : permissions.filter((c) => c !== cap),
                  )
                }
              />
            ))}
        </fieldset>
        {permissions.includes("message.publish.display") &&
          !permissions.includes("display.manage") && (
            <fieldset>
              <legend>{t("displayGrants")}</legend>
              {displays
                .filter((d) => !d.revoked_at)
                .map((d) => (
                  <Check
                    key={d.id}
                    label={d.name}
                    checked={displayIds.includes(d.id)}
                    onChange={(v) =>
                      setDisplayIds(
                        v
                          ? [...displayIds, d.id]
                          : displayIds.filter((id) => id !== d.id),
                      )
                    }
                  />
                ))}
              {!displays.some((d) => !d.revoked_at) && (
                <p className="field-hint">{t("noDisplayGrants")}</p>
              )}
            </fieldset>
          )}
        {!person && member.capabilities.includes("account.manage") && (
          <>
            <Check
              label={t("withLogin")}
              checked={login}
              onChange={(value) => {
                setLogin(value);
                if (!value) {
                  if (["household_admin", "installation_admin"].includes(role))
                    setRole("member");
                  setPermissions((current) =>
                    current.filter((cap) => !elevatedCapabilities.has(cap)),
                  );
                }
              }}
            />
            {login && (
              <>
                <Field label={t("email")}>
                  <input
                    name="email"
                    type="email"
                    required
                    autoComplete="off"
                  />
                </Field>
                <Field label={t("password")} hint={t("passwordHint")}>
                  <input
                    name="password"
                    type="password"
                    minLength={12}
                    maxLength={128}
                    required
                    autoComplete="new-password"
                  />
                </Field>
              </>
            )}
          </>
        )}
        <ErrorNotice error={error} />
        <div className="form-actions">
          <button className="button subtle" type="button" onClick={onClose}>
            {t("cancel")}
          </button>
          <Submit
            busy={busy}
            disabled={!activeLogin && elevated}
            label={t(person ? "save" : "addPerson")}
          />
        </div>
      </form>
    </Dialog>
  );
}
