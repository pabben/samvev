import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Display, Membership, Person } from "./types";
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
import { DisplaySetupsAdmin } from "./display-setups-admin";
type SetupChoice={id:string;name:string};
export function DisplaysPanel({
  displays,
  member,
  people,
  refresh,
}: {
  displays: Display[];
  member: Membership;
  people:Person[];
  refresh: () => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [pair, setPair] = useState(false);
  const [setups,setSetups]=useState<SetupChoice[]>([]);
  const [revoke, setRevoke] = useState<Display | null>(null);
  const { error, busy, run } = useAction();
  const manage = member.capabilities.includes("display.manage");
  useEffect(()=>{if(!manage)return;void api<{setups:SetupChoice[]}>(`/households/${member.household_id}/display-setups`).then(result=>setSetups(result.setups)).catch(()=>setSetups([]))},[manage,member.household_id]);
  const update = async (d: Display, change: object) => {
    await api(
      `/households/${member.household_id}/displays/${d.id}`,
      "PATCH",
      change,
    );
    await refresh();
  };
  const reloadSetups=async()=>{await refresh();const result=await api<{setups:SetupChoice[]}>(`/households/${member.household_id}/display-setups`);setSetups(result.setups)};
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
      <section className="display-setup-card" aria-label={t("displayAddress")}>
        <div>
          <strong>{t("displayAddress")}</strong>
          <p className="field-hint">{t("displaySetupsBody")}</p>
        </div>
        <DisplayAddressActions />
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
                    <button className="text-button" type="button" onClick={()=>void run(()=>update(d,{locale:null}))}>{t("inheritSetupLocale")}</button>
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
                    <button className="text-button" type="button" onClick={()=>void run(()=>update(d,{theme:null}))}>{t("inheritSetupTheme")}</button>
                  </Field>
                </div>
                <div>
                  <Check label={t("integrationExternalDisplay")} checked={Boolean(d.external_items_enabled)} onChange={(v) => void run(() => update(d, {externalItemsEnabled:v}))} />
                  <p className="field-hint">{t("integrationExternalDisplayHint")}</p>
                </div>
                <Field label={t("displaySetup")}><select value={d.setup_id??""} onChange={e=>void run(()=>update(d,{setupId:e.target.value}))}><option value={d.setup_id??""}>{setups.find(setup=>setup.id===d.setup_id)?.name??t("defaultDisplaySetup")}</option>{setups.filter(setup=>setup.id!==d.setup_id).map(setup=><option key={setup.id} value={setup.id}>{setup.name}</option>)}</select></Field>
                <fieldset><legend>{t("displaySetupPeople")}</legend>{people.map(person=><Check key={`profile:${person.id}`} label={t("displayProfileGrant",{name:person.display_name})} checked={Boolean(d.profile_person_ids?.includes(person.id))} onChange={checked=>void run(()=>update(d,{profilePersonIds:checked?[...new Set([...(d.profile_person_ids??[]),person.id])]:((d.profile_person_ids??[]).filter(id=>id!==person.id))}))}/>)}</fieldset>
                <fieldset><legend>{t("displayBirthdayGrants")}</legend>{people.map(person=><Check key={`birthday:${person.id}`} label={t("displayBirthdayGrant",{name:person.display_name})} checked={Boolean(d.birthday_person_ids?.includes(person.id))} onChange={checked=>void run(()=>update(d,{birthdayPersonIds:checked?[...new Set([...(d.birthday_person_ids??[]),person.id])]:((d.birthday_person_ids??[]).filter(id=>id!==person.id))}))}/>)}</fieldset>
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
      {manage&&<DisplaySetupsAdmin householdId={member.household_id} member={member} people={people} displays={displays} onChanged={reloadSetups}/>}
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
          setups={setups}
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
  setups,
  onClose,
  onSaved,
}: {
  member: Membership;
  setups:SetupChoice[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const { busy, error, run } = useAction();
  const [privacy, setPrivacy] = useState(false);
  return (
    <Dialog title={t("pairDisplay")} onClose={onClose}>
      <p>{t("pairingInstructions")}</p>
      <DisplayAddressActions />
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
                ...(data.get("locale")!=="inherit"?{locale:data.get("locale")}:{ }),
                ...(data.get("theme")!=="inherit"?{theme:data.get("theme")}:{ }),
                ...(data.get("setupId")?{setupId:data.get("setupId")}:{ }),
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
          {setups.length>0&&<Field label={t("displaySetup") }><select name="setupId" defaultValue=""><option value="">{t("defaultDisplaySetup")}</option>{setups.map(setup=><option key={setup.id} value={setup.id}>{setup.name}</option>)}</select></Field>}
          <Field label={t("displayLocale")}>
            <select name="locale" defaultValue="inherit">
              <option value="inherit">{t("inheritSetupLocale")}</option>
              <option value="en">{t("en")}</option>
              <option value="nb">{t("nb")}</option>
            </select>
          </Field>
          <Field label={t("displayTheme")}>
            <select name="theme" defaultValue="inherit">
              <option value="inherit">{t("inheritSetupTheme")}</option>
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

function DisplayAddressActions() {
  const { t } = useI18n();
  const address = typeof window === "undefined" ? "/display" : `${window.location.origin}/display`;
  const addressInput = useRef<HTMLInputElement>(null);
  const [needsManualCopy, setNeedsManualCopy] = useState(false);

  const copyAddress = async () => {
    setNeedsManualCopy(false);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(address);
        return;
      }
    } catch {
      // Insecure LAN origins and browser policy can disable clipboard access.
    }
    addressInput.current?.focus();
    addressInput.current?.select();
    setNeedsManualCopy(true);
  };

  return (
    <div>
      <label className="field display-address-value">
        <span>{t("displayAddress")}</span>
        <input ref={addressInput} type="text" value={address} readOnly onFocus={event => event.currentTarget.select()} />
      </label>
      <div className="display-address-actions">
        <a className="button" href="/display" target="_blank" rel="noreferrer">
          <Icon name="display" />{t("openDisplay")}
        </a>
        <button className="button subtle" type="button" onClick={() => void copyAddress()}>
          {t("copyDisplayAddress")}
        </button>
      </div>
      {needsManualCopy && <p className="field-hint" role="status">{t("displayAddressCopyFallback")}</p>}
    </div>
  );
}
