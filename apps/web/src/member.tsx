import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { Display, HouseholdDashboard, HouseholdSettings, Me, Message, Person } from "./types";
import {
  Avatar,
  Brand,
  Dialog,
  Empty,
  ErrorNotice,
  Icon,
  Loading,
  PreferenceEditor,
  Field,
  Submit,
  Status,
  useAction,
  useI18n,
  type Preferences,
} from "./ui";
import { formatDate } from "./time";
import { Composer } from "./messages";
import { PeoplePanel } from "./people";
import { DisplaysPanel } from "./displays-admin";
import { AiSettingsPanel } from "./ai-settings";
import { MonitorsPanel } from "./monitors";
import { PASSWORD_MAX_LENGTH, validateNewPasswordInput } from "./password-policy";

type MemberTab = "messages" | "people" | "displays" | "monitors" | "ai";

export function MemberApp({
  me,
  demo,
  prefs,
  onPreferences,
  onSessionChange,
}: {
  me: Me;
  demo: boolean;
  prefs: Preferences;
  onPreferences: (p: Preferences) => Promise<void>;
  onSessionChange: () => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [household, setHousehold] = useState(me.memberships[0]!.household_id);
  const member = me.memberships.find((m) => m.household_id === household)!;
  const base = `/households/${household}`;
  const [tab, setTab] = useState<MemberTab>("messages");
  const [lane, setLane] = useState<"now" | "planned" | "history">("now");
  const [people, setPeople] = useState<Person[]>([]);
  const [displays, setDisplays] = useState<Display[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [dashboard, setDashboard] = useState<HouseholdDashboard>({ upcomingBirthday: null });
  const [householdSettings, setHouseholdSettings] = useState<HouseholdSettings | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<unknown>();
  const [step, setStep] = useState("complete");
  const [compose, setCompose] = useState<Message | null | undefined>(undefined);
  const [withdraw, setWithdraw] = useState<Message | null>(null);
  const [settings, setSettings] = useState(false);
  const { error, busy, run } = useAction();
  const refresh = useCallback(async () => {
    try {
      const [p, d, m, board, householdConfig] = await Promise.all([
        api<{ people: Person[] }>(`${base}/people`),
        api<{ displays: Display[] }>(`${base}/displays`),
        api<{ messages: Message[] }>(`${base}/messages`),
        api<HouseholdDashboard>(`${base}/dashboard`),
        api<HouseholdSettings>(`${base}/settings`),
      ]);
      setPeople(p.people);
      setDisplays(d.displays);
      setMessages(m.messages);
      setDashboard(board);
      setHouseholdSettings(householdConfig);
      setLoadError(null);
      setLoaded(true);
    } catch (error) {
      setLoadError(error);
      if ((error as { status: number }).status === 401) void onSessionChange();
    }
  }, [base, onSessionChange]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (member.capabilities.includes("installation.manage"))
      void api<{ setupStep: string }>("/setup/progress").then(
        ({ setupStep }) => {
          setStep(setupStep);
          if (setupStep === "people") setTab("people");
          else if (setupStep === "display") setTab("displays");
        },
      );
  }, [member.id]);
  useEffect(() => {
    if (["ai", "monitors"].includes(tab) && !member.capabilities.includes("household.manage")) {
      setTab("messages");
    }
  }, [member.id, tab]);
  const nextStep = async (next: string) => {
    await api("/setup/progress", "PATCH", { setupStep: next });
    setStep(next);
    setTab(next === "display" ? "displays" : "messages");
  };
  const counts = {
    now: messages.filter((m) => m.state === "published").length,
    planned: messages.filter((m) => m.state === "scheduled").length,
    history: messages.filter(
      (m) => !["published", "scheduled"].includes(m.state),
    ).length,
  };
  const visible = messages.filter((m) =>
    lane === "now"
      ? m.state === "published"
      : lane === "planned"
        ? m.state === "scheduled"
        : !["published", "scheduled"].includes(m.state),
  );
  const can = (cap: string) => member.capabilities.includes(cap);
  const navigation: MemberTab[] = [
    "messages",
    "people",
    "displays",
    ...(can("household.manage") ? (["monitors", "ai"] as const) : []),
  ];
  const goHome = () => {
    setTab("messages");
    setLane("now");
    setCompose(undefined);
    setWithdraw(null);
    setSettings(false);
    if (location.pathname !== "/" || location.search || location.hash) history.replaceState({}, "", "/");
    requestAnimationFrame(() => document.getElementById("main")?.focus());
  };
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        {t("skip")}
      </a>
      <aside className="sidebar">
        <Brand onHome={goHome} />
        <div className="household-label">
          <span className="mini-label">{t("ownerStep")}</span>
          {me.memberships.length > 1 ? (
            <select
              aria-label={t("householdName")}
              value={household}
              onChange={(e) => setHousehold(e.target.value)}
            >
              {me.memberships.map((m) => (
                <option key={m.household_id} value={m.household_id}>
                  {m.household_name}
                </option>
              ))}
            </select>
          ) : (
            <strong>{member.household_name}</strong>
          )}
        </div>
        <nav
          aria-label={t("householdName")}
          className={navigation.length > 3 ? "admin-navigation" : undefined}
        >
          {navigation.map((key) => (
            <button
              key={key}
              aria-label={t(key)}
              aria-current={tab === key ? "page" : undefined}
              className={tab === key ? "nav-item active" : "nav-item"}
              onClick={() => setTab(key)}
            >
              <Icon
                name={
                  key === "messages"
                    ? "message"
                    : key === "displays"
                      ? "display"
                      : key === "people"
                        ? "people"
                        : "spark"
                }
              />
              {t(key)}
              {key === "messages" && counts.now > 0 && (
                <span className="nav-count">{counts.now}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-motto">
            <Icon name="leaf" size={32} />
            <p>{t("tagline")}</p>
          </div>
          <button className="account-button" onClick={() => setSettings(true)}>
            <Avatar name={member.display_name} />
            <span>
              <strong>{member.display_name}</strong>
              <small>{t("preferences")}</small>
            </span>
            <Icon name="settings" />
          </button>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="member-topbar">
          <span className="topbar-title">{t(tab)}</span>
          <span className="topbar-date">
            {formatDate(Date.now(), locale, member.timezone, {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </span>
          <button
            className="mobile-account icon-button"
            aria-label={t("preferences")}
            onClick={() => setSettings(true)}
          >
            <Icon name="settings" />
          </button>
        </header>
        <main id="main" className="member-main" tabIndex={-1}>
          {demo && (
            <div className="demo-banner">
              <Icon name="spark" />
              {t("demoBadge")}
            </div>
          )}
          {step !== "complete" && can("installation.manage") && (
            <section className="setup-progress" aria-label={t("setup")}>
              <div className="step-dots">
                <span className="done">✓</span>
                <span className={step === "people" ? "current" : "done"}>
                  2
                </span>
                <span className={step === "display" ? "current" : ""}>3</span>
              </div>
              <div>
                <strong>{t("setup")}</strong>
                <p>
                  {t(step === "people" ? "peopleBody" : "displaySetupBody")}
                </p>
              </div>
              <button
                className="button"
                onClick={() =>
                  void run(() =>
                    nextStep(step === "people" ? "display" : "complete"),
                  )
                }
              >
                {t(
                  step === "people"
                    ? "continue"
                    : displays.length
                      ? "finish"
                      : "later",
                )}
                <Icon name="arrow" />
              </button>
            </section>
          )}
          <ErrorNotice error={error} />
          <ErrorNotice error={loadError} />
          {tab === "monitors" && can("household.manage") ? (
            <MonitorsPanel householdId={household} timezone={member.timezone} people={people} displays={displays}/>
          ) : tab === "ai" && can("household.manage") ? (
            <AiSettingsPanel
              key={household}
              householdId={household}
              timezone={member.timezone}
            />
          ) : !loaded ? (
            <Loading />
          ) : tab === "people" ? (
            <PeoplePanel
              people={people}
              displays={displays}
              member={member}
              householdSettings={householdSettings}
              refresh={refresh}
            />
          ) : tab === "displays" ? (
            <DisplaysPanel
              displays={displays}
              member={member}
              refresh={refresh}
            />
          ) : (
            <>
              <section className="board-hero">
                <div>
                  <p className="eyebrow">{t("boardEyebrow")}</p>
                  <h1>{t("boardTitle")}</h1>
                  <p>{t("boardBody")}</p>
                </div>
                <div className="hero-sprig" aria-hidden="true">
                  <Icon name="leaf" size={86} />
                </div>
                {can("message.create.household") && (
                  <button
                    className="button primary"
                    onClick={() => setCompose(null)}
                  >
                    <Icon name="plus" />
                    {t("newMessage")}
                  </button>
                )}
              </section>
              {dashboard.upcomingBirthday && <BirthdayCard birthday={dashboard.upcomingBirthday} locale={locale} />}
              <div className="board-toolbar">
                <div className="tabs" role="tablist" aria-label={t("messages")}>
                  {(["now", "planned", "history"] as const).map((key) => (
                    <button
                      role="tab"
                      tabIndex={lane === key ? 0 : -1}
                      onKeyDown={(event) => {
                        const keys = ["now", "planned", "history"] as const;
                        const index = keys.indexOf(key);
                        const next =
                          event.key === "ArrowRight"
                            ? keys[(index + 1) % 3]
                            : event.key === "ArrowLeft"
                              ? keys[(index + 2) % 3]
                              : event.key === "Home"
                                ? "now"
                                : event.key === "End"
                                  ? "history"
                                  : undefined;
                        if (next) {
                          event.preventDefault();
                          setLane(next);
                          document.getElementById(`tab-${next}`)?.focus();
                        }
                      }}
                      aria-selected={lane === key}
                      id={`tab-${key}`}
                      aria-controls="message-panel"
                      key={key}
                      className={lane === key ? "selected" : ""}
                      onClick={() => setLane(key)}
                    >
                      {t(key)}
                      <span>{counts[key]}</span>
                    </button>
                  ))}
                </div>
                <div
                  className="people-stack"
                  role="group"
                  aria-label={t("people")}
                >
                  {people.slice(0, 4).map((p, i) => (
                    <Avatar key={p.id} name={p.display_name} index={i} />
                  ))}
                </div>
              </div>
              <section
                role="tabpanel"
                id="message-panel"
                aria-labelledby={`tab-${lane}`}
              >
                <div className="message-grid">
                  {visible.map((message) => (
                    <article
                      className={`message-card ${message.importance}`}
                      key={message.id}
                    >
                      <div className="card-top">
                        <span className={`message-type ${message.importance}`}>
                          <Icon
                            name={
                              message.importance === "attention"
                                ? "sun"
                                : "message"
                            }
                          />
                          {t(message.importance)}
                        </span>
                        <Status state={message.state} />
                      </div>
                      <p className="message-text">{message.body}</p>
                      <p className="audience-line">
                        {t("to", {
                          audience: [
                            message.audience_household
                              ? t("wholeHousehold")
                              : "",
                            ...message.person_ids.map(
                              (id) =>
                                people.find((p) => p.id === id)?.display_name ??
                                "",
                            ),
                            ...message.display_ids.map(
                              (id) =>
                                displays.find((d) => d.id === id)?.name ??
                                t("unknownDisplay"),
                            ),
                          ]
                            .filter(Boolean)
                            .join(" · "),
                        })}
                      </p>
                      <div className="card-meta">
                        <Avatar
                          name={message.author_name}
                          index={people.findIndex(
                            (p) => p.id === message.author_person_id,
                          )}
                        />
                        <div>
                          <strong>
                            {t("from", { name: message.author_name })}
                          </strong>
                          <span>
                            {formatDate(
                              message.publish_at,
                              locale,
                              member.timezone,
                            )}
                          </span>
                        </div>
                      </div>
                      <div className="card-expiry">
                        <Icon name="clock" />
                        {t("until", {
                          time: formatDate(
                            message.expires_at,
                            locale,
                            member.timezone,
                          ),
                        })}
                      </div>
                      {message.deliveries.length > 0 && (
                        <details className="delivery-details">
                          <summary>
                            {t("delivery")}{" "}
                            <span>
                              {
                                message.deliveries.filter(
                                  (d) => d.state === "displayed",
                                ).length
                              }
                              /{message.deliveries.length}
                            </span>
                          </summary>
                          <p>{t("deliveryHint")}</p>
                          {message.deliveries.map((d) => (
                            <div className="delivery-row" key={d.displayId}>
                              <span>
                                {displays.find(
                                  (display) => display.id === d.displayId,
                                )?.name ?? t("unknownDisplay")}
                              </span>
                              <Status state={d.state} />
                            </div>
                          ))}
                        </details>
                      )}
                      {(message.activity?.length ?? 0) > 0 && (
                        <div
                          className="message-activity"
                          role="group"
                          aria-label={t("messageActivity")}
                        >
                          {message.activity!.map((activity, index) => (
                            <p key={`${activity.occurredAt}:${index}`}>
                              {t(
                                activity.action === "edited"
                                  ? "activityEdited"
                                  : "activityWithdrawn",
                                {
                                  name: activity.actorName,
                                  time: formatDate(
                                    activity.occurredAt,
                                    locale,
                                    member.timezone,
                                  ),
                                },
                              )}
                            </p>
                          ))}
                        </div>
                      )}
                      {message.can_edit &&
                        ["scheduled", "published"].includes(message.state) && (
                          <div className="card-actions">
                            <button onClick={() => setCompose(message)}>
                              {t("edit")}
                            </button>
                            <button onClick={() => setWithdraw(message)}>
                              {t("withdraw")}
                            </button>
                          </div>
                        )}
                    </article>
                  ))}
                </div>
                {!visible.length && (
                  <Empty
                    title={t(
                      lane === "now"
                        ? "emptyNow"
                        : lane === "planned"
                          ? "emptyPlanned"
                          : "emptyHistory",
                    )}
                    body={t(
                      lane === "now"
                        ? "emptyNowBody"
                        : lane === "planned"
                          ? "emptyPlannedBody"
                          : "emptyHistoryBody",
                    )}
                  >
                    {can("message.create.household") && (
                      <button
                        className="button"
                        onClick={() => setCompose(null)}
                      >
                        <Icon name="plus" />
                        {t("newMessage")}
                      </button>
                    )}
                  </Empty>
                )}
              </section>
              {member.role_preset === "limited" && (
                <p className="permission-footnote">
                  <Icon name="shield" />
                  {t("limitedHint")}
                </p>
              )}
            </>
          )}
        </main>
        <footer className="member-footer">
          <span>samvev.</span>
          <span>{t("tagline")}</span>
        </footer>
      </div>
      {compose !== undefined && (
        <Composer
          message={compose}
          people={people}
          displays={displays}
          member={member}
          onClose={() => setCompose(undefined)}
          onSaved={async () => {
            setCompose(undefined);
            await refresh();
          }}
        />
      )}
      {withdraw && (
        <Dialog title={t("withdrawTitle")} onClose={() => setWithdraw(null)}>
          <p>{t("withdrawBody")}</p>
          <blockquote>{withdraw.body}</blockquote>
          <ErrorNotice error={error} />
          <div className="form-actions">
            <button className="button subtle" onClick={() => setWithdraw(null)}>
              {t("cancel")}
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api(
                    `${base}/messages/${withdraw.id}/withdraw`,
                    "POST",
                    { expectedRevision: withdraw.revision },
                  );
                  setWithdraw(null);
                  await refresh();
                })
              }
            >
              {t("withdrawConfirm")}
            </button>
          </div>
        </Dialog>
      )}
      {settings && (
        <Dialog title={t("preferences")} onClose={() => setSettings(false)}>
          <p>{me.account.email}</p>
          <PreferenceEditor prefs={prefs} onSave={onPreferences} />
          <PasswordEditor />
          {demo && (
            <div className="demo-info">
              <strong>{t("demoAccounts")}</strong>
              <p>{t("demoNote")}</p>
              <p>{t("demoPassword")}</p>
            </div>
          )}
          <ErrorNotice error={error} />
          <button
            className="button logout"
            onClick={() =>
              void run(async () => {
                await api("/auth/logout", "POST", {});
                await onSessionChange();
              })
            }
          >
            <Icon name="logout" />
            {t("signOut")}
          </button>
        </Dialog>
      )}
    </div>
  );
}

function BirthdayCard({ birthday, locale }: { birthday: NonNullable<HouseholdDashboard["upcomingBirthday"]>; locale: "en" | "nb" }) {
  const { t } = useI18n();
  const relative = birthday.daysUntil === 0 ? t("birthdayToday") : birthday.daysUntil === 1 ? t("birthdayTomorrow") : t("birthdayInDays", { count: birthday.daysUntil });
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${birthday.date}T12:00:00Z`));
  return <section className="birthday-card" aria-labelledby="next-birthday-title">
    <div className="birthday-mark" aria-hidden="true">✦</div>
    <div><p className="eyebrow" id="next-birthday-title">{t("nextBirthday")}</p><h2>{birthday.displayName}</h2><p>{date}</p></div>
    <p className="birthday-relative">{relative}<span aria-hidden="true"> · </span>{t("turningAge", { age: birthday.ageTurning })}</p>
  </section>;
}

function PasswordEditor() {
  const { t } = useI18n();
  const { busy, error, run } = useAction();
  const [saved, setSaved] = useState(false);
  return <details className="password-editor"><summary>{t("changePassword")}</summary>
    <form className="form-stack" onSubmit={(event) => { event.preventDefault(); const form=event.currentTarget; const data=new FormData(form); setSaved(false); void run(async()=>{await api("/me/password","POST",{currentPassword:data.get("currentPassword"),newPassword:data.get("newPassword")});form.reset();setSaved(true);}); }}>
      <Field label={t("currentPassword")}><input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128}/></Field>
      <Field label={t("newPassword")} hint={t("passwordHint")}><input name="newPassword" type="password" autoComplete="new-password" required maxLength={PASSWORD_MAX_LENGTH} onInput={(event)=>validateNewPasswordInput(event.currentTarget,t("passwordPolicyError"))}/></Field>
      {saved && <p role="status" className="notice success">{t("passwordChanged")}</p>}<ErrorNotice error={error}/><Submit busy={busy} label={t("changePassword")}/>
    </form>
  </details>;
}
