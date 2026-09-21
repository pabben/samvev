import { useMemo, useState } from "react";
import { api } from "./api";
import { ageOnDate, initialDisplayGrants, loginPresentation } from "./person-policy";
import type { Display, HouseholdSettings, Membership, Person } from "./types";
import type { TranslationKey } from "./locales/en";
import { Avatar, Check, Dialog, ErrorNotice, Field, Icon, Submit, useAction, useI18n } from "./ui";
import { PASSWORD_MAX_LENGTH, validateNewPasswordInput } from "./password-policy";

const caps: Record<string, TranslationKey> = {
  "household.view": "viewHousehold", "message.create.household": "createMessages",
  "message.publish.display": "publishDisplay", "message.schedule": "scheduleMessages",
  "household.manage": "manageHousehold", "people.manage": "managePeople",
  "account.manage": "manageAccounts", "capability.manage": "managePermissions",
  "message.manage.household": "manageMessages", "display.manage": "manageDisplays",
  "installation.manage": "manageInstallation",
};
const preset: Record<string, string[]> = {
  installation_admin: Object.keys(caps),
  household_admin: Object.keys(caps).filter((cap) => cap !== "installation.manage"),
  member: ["household.view", "message.create.household", "message.publish.display", "message.schedule"],
  limited: ["household.view"],
};
const elevatedCapabilities = new Set(["installation.manage", "household.manage", "people.manage", "account.manage", "capability.manage", "message.manage.household", "display.manage"]);
function roleCapabilities(role: string, held: string[]): string[] {
  return (preset[role] ?? preset.member!).filter((cap) => held.includes(cap));
}
function todayInTimezone(timeZone: string): string {
  const values=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const part=(type:string)=>values.find((value)=>value.type===type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function PeoplePanel({ people, displays, member, householdSettings, refresh }: { people: Person[]; displays: Display[]; member: Membership; householdSettings: HouseholdSettings | null; refresh: () => Promise<void> }) {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState<Person | null | undefined>(undefined);
  return <>
    <section className="section-heading"><div><p className="eyebrow">{t("people")}</p><h1>{t("peopleTitle")}</h1><p>{t("peopleBody")}</p></div>
      {member.capabilities.includes("people.manage") && <button className="button primary" onClick={() => setEditing(null)}><Icon name="plus" />{t("addPerson")}</button>}
    </section>
    {member.capabilities.includes("household.manage") && householdSettings && <BirthdaySetting settings={householdSettings} householdId={member.household_id} refresh={refresh} />}
    <div className="person-grid">{people.map((person, index) => {
      const login = loginPresentation(person);
      return <article className="person-card" key={person.id}>
        <Avatar name={person.display_name} index={index} /><h2>{person.display_name}</h2>
        <p>{t(person.role_preset as TranslationKey)}</p>
        <span className={`person-login ${person.account_status ?? "profile"}`}><Icon name={login.icon} />{t(login.label)}</span>
        {member.capabilities.includes("people.manage") && person.birth_date && <p className="person-birth-date">{t("bornWithAge", { date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${person.birth_date}T12:00:00Z`)), age: person.calculated_age ?? "" })}</p>}
        {member.capabilities.includes("account.manage") && person.email && <p className="person-email">{person.email}</p>}
        {member.capabilities.includes("people.manage") && <details className="permission-summary"><summary>{t("capabilityPreview")}</summary><ul className="permission-list">{person.capabilities.map((cap) => <li key={cap}><Icon name="check" size={14} />{t(caps[cap]!)}</li>)}</ul></details>}
        {member.capabilities.includes("people.manage") && <button className="button" onClick={() => setEditing(person)}>{t("editPerson")}</button>}
      </article>;
    })}</div>
    {editing !== undefined && <PersonEditor person={editing} displays={displays} member={member} onClose={() => setEditing(undefined)} onSaved={refresh} />}
  </>;
}

function BirthdaySetting({ settings, householdId, refresh }: { settings: HouseholdSettings; householdId: string; refresh: () => Promise<void> }) {
  const { t } = useI18n(); const { busy, error, run } = useAction();
  return <section className="household-feature"><div><h2>{t("showUpcomingBirthday")}</h2><p>{t("showUpcomingBirthdayHint")}</p></div><Check label={t("showUpcomingBirthday")} checked={settings.show_upcoming_birthday} disabled={busy} onChange={(enabled)=>void run(async()=>{await api(`/households/${householdId}/settings`,"PATCH",{showUpcomingBirthday:enabled,expectedRevision:settings.revision});await refresh();})}/><ErrorNotice error={error}/></section>;
}

function PersonEditor({ person, displays, member, onClose, onSaved }: { person: Person | null; displays: Display[]; member: Membership; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useI18n();
  const { busy, error, run } = useAction();
  const [name, setName] = useState(person?.display_name ?? "");
  const [birthDate, setBirthDate] = useState(person?.birth_date ?? "");
  const [ageGroup, setAgeGroup] = useState(person?.age_group ?? "unspecified");
  const [role, setRole] = useState(person?.role_preset ?? "member");
  const [permissions, setPermissions] = useState(person?.capabilities ?? roleCapabilities("member", member.capabilities));
  const [displayIds, setDisplayIds] = useState(() => initialDisplayGrants(person?.display_ids ?? [], displays));
  const [login, setLogin] = useState(person?.has_login ?? false);
  const [loginMethod, setLoginMethod] = useState<"password" | "invitation">("invitation");
  const [email, setEmail] = useState(person?.email ?? "");
  const [password, setPassword] = useState("");
  const [ownerConfirmed, setOwnerConfirmed] = useState(false);
  const [accountDisabled, setAccountDisabled] = useState(person?.account_status === "disabled");
  const [invitationToken, setInvitationToken] = useState<string | null>(null);
  const householdToday = useMemo(() => todayInTimezone(member.timezone), [member.timezone]);
  const calculatedAge = useMemo(() => birthDate ? ageOnDate(birthDate, householdToday) : null, [birthDate, householdToday]);
  const adminRole = role === "household_admin" || role === "installation_admin";
  const needsOwnerConfirmation = role === "installation_admin" && (!person || person.role_preset !== "installation_admin");
  const canManageAccount = member.capabilities.includes("account.manage");
  const canAssignOwner = member.capabilities.includes("installation.manage");
  const capabilitiesChanged = person ? role !== person.role_preset || JSON.stringify([...permissions].sort()) !== JSON.stringify([...person.capabilities].sort()) || JSON.stringify([...displayIds].sort()) !== JSON.stringify([...person.display_ids].sort()) : true;

  const chooseRole = (next: string) => {
    setRole(next); setPermissions(roleCapabilities(next, member.capabilities)); setOwnerConfirmed(false);
    if (["household_admin", "installation_admin"].includes(next) && !login) setLogin(true);
  };
  const loginPayload = { email, loginMethod, ...(loginMethod === "password" ? { password } : {}), locale: member.household_locale, theme: "system" };
  const ownerConfirmation = needsOwnerConfirmation ? { confirmInstallationOwner: ownerConfirmed } : {};

  if (invitationToken) {
    const inviteUrl = `${location.origin}/invitation#token=${invitationToken}`;
    return <Dialog title={t("invitationReady")} onClose={onClose}><p>{t("invitationReadyBody")}</p><Field label={t("invitationLink")}><input readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} /></Field><p className="field-hint">{t("invitationSecretHint")}</p><div className="form-actions"><button className="button primary" onClick={onClose}>{t("done")}</button></div></Dialog>;
  }

  return <Dialog title={t(person ? "editPerson" : "addPerson")} onClose={onClose}>
    <form className="form-stack person-editor" onSubmit={(event) => { event.preventDefault(); void run(async () => {
      const personChanged = person && (name !== person.display_name || birthDate !== (person.birth_date ?? "") || ageGroup !== person.age_group);
      if (!person) {
        const created = await api<{ invitationToken: string | null }>(`/households/${member.household_id}/people`, "POST", {
          displayName: name, birthDate: birthDate || null, ageGroup, rolePreset: role, capabilities: permissions, displayIds,
          ...(login ? { login: loginPayload } : {}), ...ownerConfirmation,
        });
        await onSaved();
        if (created.invitationToken) { setInvitationToken(created.invitationToken); return; }
      } else {
        if (personChanged) await api(`/households/${member.household_id}/people/${person.id}`, "PATCH", { displayName: name, birthDate: birthDate || null, ageGroup, expectedRevision: person.person_revision! });
        if (!person.has_login && login) {
          const created = await api<{ invitationToken: string | null }>(`/households/${member.household_id}/memberships/${person.membership_id}/account`, "POST", { login: loginPayload, rolePreset: role, capabilities: permissions, displayIds, expectedRevision: person.revision, ...ownerConfirmation });
          await onSaved();
          if (created.invitationToken) { setInvitationToken(created.invitationToken); return; }
        } else if (capabilitiesChanged) {
          await api(`/households/${member.household_id}/memberships/${person.membership_id}`, "PATCH", { rolePreset: role, capabilities: permissions, displayIds, expectedRevision: person.revision, ...ownerConfirmation });
        }
        if (person.has_login && person.account_id && person.account_revision != null && accountDisabled !== (person.account_status === "disabled")) {
          await api(`/households/${member.household_id}/accounts/${person.account_id}`, "PATCH", { disabled: accountDisabled, expectedRevision: person.account_revision });
        }
        await onSaved();
      }
      onClose();
    }); }}>
      <section className="editor-section"><h3>{t("personDetails")}</h3>
        <Field label={t("personName")}><input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} autoFocus /></Field>
        <div className="form-grid"><Field label={t("birthDate")} hint={t("birthDateHint")}><input type="date" value={birthDate} max={householdToday} min="1900-01-01" onChange={(event) => { const value=event.target.value; setBirthDate(value); if(value){const age=ageOnDate(value,householdToday);setAgeGroup(age>=18?"adult":age>=13?"teen":"child");} }} /></Field>
          <Field label={t("ageGroup")} hint={t("ageGroupHint")}><select value={ageGroup} onChange={(event) => setAgeGroup(event.target.value)}>{(["unspecified", "adult", "teen", "child"] as const).map((value) => <option key={value} value={value}>{t(value)}</option>)}</select></Field></div>
        {calculatedAge !== null && <p className="calculated-age" aria-live="polite">{t("calculatedAge", { age: calculatedAge })}</p>}
      </section>
      <section className="editor-section"><h3>{t("roleAndAccess")}</h3>
        <Field label={t("role")}><select value={role} onChange={(event) => chooseRole(event.target.value)}>{["member", "limited", "household_admin", ...(canAssignOwner ? ["installation_admin"] : [])].map((value) => <option key={value} value={value}>{t(value as TranslationKey)}</option>)}</select></Field>
        {canManageAccount && !person?.has_login && <><Check label={t("withLogin")} checked={login} disabled={adminRole} onChange={setLogin} />{adminRole && <p className="field-hint">{t("adminLoginRequired")}</p>}</>}
        {login && !person?.has_login && <div className="account-setup"><Field label={t("email")}><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} autoComplete="off" /></Field>
          <fieldset><legend>{t("loginSetup")}</legend><label className="radio-row"><input name="loginMethod" type="radio" checked={loginMethod === "invitation"} onChange={() => setLoginMethod("invitation")} />{t("sendInvitation")}</label><label className="radio-row"><input name="loginMethod" type="radio" checked={loginMethod === "password"} onChange={() => setLoginMethod("password")} />{t("setPasswordNow")}</label></fieldset>
          {loginMethod === "password" && <Field label={t("password")} hint={t("passwordHint")}><input type="password" value={password} onChange={(event) => {validateNewPasswordInput(event.currentTarget,t("passwordPolicyError"));setPassword(event.target.value);}} maxLength={PASSWORD_MAX_LENGTH} required autoComplete="new-password" /></Field>}
        </div>}
        {person?.has_login && <div className="account-state"><strong>{t("accountStatus")}</strong><span>{t(loginPresentation(person).label)}</span>{person.email && <small>{person.email}</small>}{canManageAccount && person.account_status === "pending" && person.account_id && person.account_revision != null && <button className="button" type="button" disabled={busy} onClick={()=>void run(async()=>{const result=await api<{invitationToken:string}>(`/households/${member.household_id}/accounts/${person.account_id}/invitation`,"POST",{expectedRevision:person.account_revision});await onSaved();setInvitationToken(result.invitationToken);})}>{t("reissueInvitation")}</button>}{canManageAccount && person.account_status !== "pending" && <Check label={t("disableLogin")} checked={accountDisabled} onChange={setAccountDisabled} />}</div>}
        <fieldset className="capability-preview"><legend>{t("capabilityPreview")}</legend><p className="field-hint">{t(adminRole ? "adminCapabilityHint" : "permissionHint")}</p>{Object.entries(caps).filter(([cap]) => member.capabilities.includes(cap)).map(([cap, label]) => <Check key={cap} label={t(label)} checked={permissions.includes(cap)} disabled={adminRole || elevatedCapabilities.has(cap)} onChange={(checked) => setPermissions(checked ? [...permissions, cap] : permissions.filter((value) => value !== cap))} />)}</fieldset>
        {needsOwnerConfirmation && <div className="owner-confirm"><Check label={t("confirmInstallationOwner")} checked={ownerConfirmed} onChange={setOwnerConfirmed} /><p className="field-hint">{t("ownerConfirmationHint")}</p></div>}
      </section>
      {permissions.includes("message.publish.display") && !permissions.includes("display.manage") && <fieldset><legend>{t("displayGrants")}</legend>{displays.filter((display) => !display.revoked_at).map((display) => <Check key={display.id} label={display.name} checked={displayIds.includes(display.id)} onChange={(checked) => setDisplayIds(checked ? [...displayIds, display.id] : displayIds.filter((id) => id !== display.id))} />)}{!displays.some((display) => !display.revoked_at) && <p className="field-hint">{t("noDisplayGrants")}</p>}</fieldset>}
      <ErrorNotice error={error} /><div className="form-actions"><button className="button subtle" type="button" onClick={onClose}>{t("cancel")}</button><Submit busy={busy} disabled={(adminRole && !login) || (needsOwnerConfirmation && !ownerConfirmed)} label={t("save")} /></div>
    </form>
  </Dialog>;
}
