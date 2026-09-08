import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { formatDate } from "./time";
import { Check, ErrorNotice, Field, Icon, Loading, useI18n } from "./ui";

type ProviderId =
  | "openai"
  | "chatgpt_subscription"
  | "openai_compatible"
  | "gemini";
type ModelTier = "routine" | "strong";
type AvailabilityStatus =
  | "not_tested"
  | "not_configured"
  | "available"
  | "unavailable"
  | "error";

interface AiSettings {
  enabled: boolean;
  provider: ProviderId;
  hasApiKey: boolean;
  defaultModel: string;
  strongModel: string;
  revision: number;
  availability: {
    status: AvailabilityStatus;
    available: boolean;
    errorCode: string | null;
    checkedAt: string | null;
  };
  providers: {
    id: ProviderId;
    runtimeAvailable: boolean;
    reasonCode: string | null;
  }[];
  chatGptSubscription: {
    feasibility: "partial";
    status: "unavailable";
    reasonCode: string;
  };
}

interface AiUsage {
  summary: {
    requests: number;
    successes: number;
    failures: number;
    inputTokens: number;
    outputTokens: number;
  };
  recent: {
    provider: ProviderId;
    model: string | null;
    purpose: string;
    success: boolean;
    errorCode: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    occurredAt: string;
  }[];
}

interface Draft {
  enabled: boolean;
  provider: ProviderId;
  defaultModel: string;
  strongModel: string;
}

const asDraft = (settings: AiSettings): Draft => ({
  enabled: settings.enabled,
  provider: settings.provider,
  defaultModel: settings.defaultModel,
  strongModel: settings.strongModel,
});

export function AiSettingsPanel({
  householdId,
  timezone,
}: {
  householdId: string;
  timezone: string;
}) {
  const { t, locale } = useI18n();
  const base = `/households/${householdId}/ai`;
  const [settings, setSettings] = useState<AiSettings>();
  const [usage, setUsage] = useState<AiUsage>();
  const [draft, setDraft] = useState<Draft>();
  const [apiKey, setApiKey] = useState("");
  const [removeApiKey, setRemoveApiKey] = useState(false);
  const [loadError, setLoadError] = useState<unknown>();
  const [actionError, setActionError] = useState<unknown>();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState<ModelTier>();
  const [testResult, setTestResult] = useState<{
    tier: ModelTier;
    available: boolean;
    errorCode?: string;
  }>();
  const busy = saving || Boolean(testing);

  const load = useCallback(async () => {
    setLoadError(undefined);
    try {
      const [nextSettings, nextUsage] = await Promise.all([
        api<AiSettings>(`${base}/settings`),
        api<AiUsage>(`${base}/usage`),
      ]);
      setSettings(nextSettings);
      setDraft(asDraft(nextSettings));
      setUsage(nextUsage);
      setApiKey("");
      setRemoveApiKey(false);
    } catch (error) {
      setLoadError(error);
    }
  }, [base]);

  useEffect(() => {
    setSettings(undefined);
    setUsage(undefined);
    setDraft(undefined);
    setSaved(false);
    setTestResult(undefined);
    void load();
  }, [load]);

  const dirty = useMemo(
    () =>
      Boolean(
        settings &&
          draft &&
          (draft.enabled !== settings.enabled ||
            draft.provider !== settings.provider ||
            draft.defaultModel !== settings.defaultModel ||
            draft.strongModel !== settings.strongModel ||
            apiKey.length > 0 ||
            removeApiKey),
      ),
    [apiKey, draft, removeApiKey, settings],
  );
  const invalidKey = apiKey.length > 0 && apiKey.length < 20;

  const save = async () => {
    if (!settings || !draft || busy || invalidKey || !dirty) return;
    setSaving(true);
    setSaved(false);
    setActionError(undefined);
    setTestResult(undefined);
    try {
      const body: Record<string, unknown> = {
        ...draft,
        expectedRevision: settings.revision,
      };
      if (apiKey) body.apiKey = apiKey;
      else if (removeApiKey) body.apiKey = null;
      const next = await api<AiSettings>(`${base}/settings`, "PATCH", body);
      setSettings(next);
      setDraft(asDraft(next));
      setApiKey("");
      setRemoveApiKey(false);
      setSaved(true);
    } catch (error) {
      setActionError(error);
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async (tier: ModelTier) => {
    if (dirty || busy) return;
    setTesting(tier);
    setSaved(false);
    setActionError(undefined);
    setTestResult(undefined);
    try {
      const result = await api<{
        available: boolean;
        provider: ProviderId;
        modelTier: ModelTier;
        checkedAt: string;
        errorCode?: string;
      }>(`${base}/test`, "POST", { modelTier: tier });
      setTestResult({
        tier,
        available: result.available,
        errorCode: result.errorCode,
      });
      const [nextSettings, nextUsage] = await Promise.all([
        api<AiSettings>(`${base}/settings`),
        api<AiUsage>(`${base}/usage`),
      ]);
      setSettings(nextSettings);
      setDraft(asDraft(nextSettings));
      setUsage(nextUsage);
    } catch (error) {
      setActionError(error);
    } finally {
      setTesting(undefined);
    }
  };

  if (!settings || !draft || !usage) {
    return (
      <section className="ai-settings" aria-label={t("aiTitle")}>
        <ErrorNotice error={loadError} />
        {!loadError && <Loading />}
        {Boolean(loadError) && (
          <button className="button" onClick={() => void load()}>
            {t("retry")}
          </button>
        )}
      </section>
    );
  }

  const availabilityLabel = {
    not_tested: t("aiStatusNotTested"),
    not_configured: t("aiStatusNotConfigured"),
    available: t("aiStatusAvailable"),
    unavailable: t("aiStatusUnavailable"),
    error: t("aiStatusError"),
  }[settings.availability.status];

  return (
    <section className="ai-settings" aria-labelledby="ai-title">
      <header className="section-heading ai-heading">
        <div>
          <p className="eyebrow">{t("aiEyebrow")}</p>
          <h1 id="ai-title">{t("aiTitle")}</h1>
          <p>{t("aiBody")}</p>
        </div>
        <span
          className={`ai-availability ai-${settings.availability.status}`}
          data-testid="ai-availability"
        >
          <span aria-hidden="true">{settings.availability.available ? "✓" : "•"}</span>
          {availabilityLabel}
        </span>
      </header>

      <div className="ai-layout">
        <div className="ai-primary">
          <form
            className="ai-card form-stack"
            aria-busy={busy}
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="ai-card-heading">
              <div>
                <h2>{t("aiConfiguration")}</h2>
                <p>{t("aiConfigurationHint")}</p>
              </div>
              <Check
                label={t("aiEnabled")}
                checked={draft.enabled}
                disabled={busy}
                onChange={(enabled) => {
                  setDraft({ ...draft, enabled });
                  setSaved(false);
                }}
              />
            </div>

            <fieldset className="ai-providers">
              <legend>{t("aiProvider")}</legend>
              <label className="ai-provider active">
                <input
                  type="radio"
                  name="ai-provider"
                  value="openai"
                  checked={draft.provider === "openai"}
                  disabled={busy}
                  onChange={() => {
                    setDraft({ ...draft, provider: "openai" });
                    setSaved(false);
                  }}
                />
                <span>
                  <strong>OpenAI API</strong>
                  <small>{t("aiProviderOpenAiHint")}</small>
                </span>
                <span className="ai-provider-state">{t("aiProviderActive")}</span>
              </label>
              <div className="ai-provider unavailable" aria-disabled="true">
                <Icon name="offline" />
                <span>
                  <strong>{t("aiProviderChatGpt")}</strong>
                  <small>{t("aiProviderChatGptHint")}</small>
                </span>
                <span className="ai-provider-state">{t("aiUnavailableSlice")}</span>
              </div>
              <div className="ai-provider unavailable" aria-disabled="true">
                <Icon name="offline" />
                <span>
                  <strong>{t("aiProviderLocal")}</strong>
                  <small>{t("aiProviderLocalHint")}</small>
                </span>
                <span className="ai-provider-state">{t("aiUnavailableSlice")}</span>
              </div>
            </fieldset>

            <div className="form-grid">
              <Field label={t("aiRoutineModel")} hint={t("aiRoutineModelHint")}>
                <input
                  value={draft.defaultModel}
                  maxLength={100}
                  disabled={busy}
                  autoComplete="off"
                  onChange={(event) => {
                    setDraft({ ...draft, defaultModel: event.target.value });
                    setSaved(false);
                  }}
                />
              </Field>
              <Field label={t("aiStrongModel")} hint={t("aiStrongModelHint")}>
                <input
                  value={draft.strongModel}
                  maxLength={100}
                  disabled={busy}
                  autoComplete="off"
                  onChange={(event) => {
                    setDraft({ ...draft, strongModel: event.target.value });
                    setSaved(false);
                  }}
                />
              </Field>
            </div>

            <Field label={t("aiApiKey")} hint={t("aiApiKeyHint")}>
              <input
                type="password"
                value={apiKey}
                minLength={20}
                maxLength={512}
                disabled={busy || removeApiKey}
                autoComplete="new-password"
                placeholder={
                  settings.hasApiKey ? t("aiApiKeyConfigured") : t("aiApiKeyEmpty")
                }
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setSaved(false);
                }}
              />
            </Field>
            {invalidKey && <p className="field-error">{t("aiApiKeyLength")}</p>}
            {settings.hasApiKey && (
              <Check
                label={t("aiRemoveApiKey")}
                checked={removeApiKey}
                disabled={busy}
                onChange={(checked) => {
                  setRemoveApiKey(checked);
                  if (checked) setApiKey("");
                  setSaved(false);
                }}
              />
            )}

            <ErrorNotice error={actionError} />
            <div className="form-actions">
              <span className="field-hint" role="status" aria-live="polite">
                {saved ? t("aiSettingsSaved") : ""}
              </span>
              <button
                className="button primary"
                type="submit"
                disabled={!dirty || invalidKey || busy}
              >
                {saving ? t("saving") : t("save")}
                <Icon name={saving ? "clock" : "arrow"} />
              </button>
            </div>
          </form>

          <section
            className="ai-card"
            aria-labelledby="ai-test-title"
            aria-busy={Boolean(testing)}
          >
            <div className="ai-card-heading">
              <div>
                <h2 id="ai-test-title">{t("aiConnectionTest")}</h2>
                <p>{t("aiConnectionTestHint")}</p>
              </div>
              {settings.availability.checkedAt && (
                <small>
                  {t("aiLastTest", {
                    time: formatDate(
                      settings.availability.checkedAt,
                      locale,
                      timezone,
                    ),
                  })}
                </small>
              )}
            </div>
            {settings.availability.errorCode && !testResult && (
              <p className="ai-availability-reason">
                {t(errorKey(settings.availability.errorCode))}
              </p>
            )}
            <div className="notice offline ai-credit-notice">
              <Icon name="spark" />
              <span>{t("aiTestUsageWarning")}</span>
            </div>
            {dirty && <p className="field-hint">{t("aiSaveBeforeTest")}</p>}
            <div className="ai-test-actions">
              {(["routine", "strong"] as const).map((tier) => (
                <button
                  key={tier}
                  className="button"
                  disabled={dirty || busy}
                  onClick={() => void testConnection(tier)}
                >
                  <Icon name={testing === tier ? "clock" : "spark"} />
                  {testing === tier
                    ? t("aiTesting")
                    : t(tier === "routine" ? "aiTestRoutine" : "aiTestStrong")}
                </button>
              ))}
            </div>
            {testResult && (
              <div
                className={`notice ${testResult.available ? "" : "error"}`}
                role="status"
                data-testid="ai-test-result"
              >
                <Icon name={testResult.available ? "check" : "shield"} />
                <span>
                  {testResult.available
                    ? t("aiTestSucceeded", {
                        tier: t(
                          testResult.tier === "routine"
                            ? "aiRoutineTier"
                            : "aiStrongTier",
                        ),
                      })
                    : t("aiTestFailed", {
                        reason: testResult.errorCode
                          ? t(errorKey(testResult.errorCode))
                          : t("INTERNAL_ERROR"),
                      })}
                </span>
              </div>
            )}
            <p className="field-hint">{t("aiAvailabilityScope")}</p>
          </section>
        </div>

        <aside className="ai-secondary">
          <section className="ai-card" aria-labelledby="ai-usage-title">
            <h2 id="ai-usage-title">{t("aiUsage")}</h2>
            <p className="field-hint">{t("aiUsageHint")}</p>
            <dl className="ai-summary">
              <div><dt>{t("aiRequests")}</dt><dd>{usage.summary.requests}</dd></div>
              <div><dt>{t("aiSucceeded")}</dt><dd>{usage.summary.successes}</dd></div>
              <div><dt>{t("aiFailed")}</dt><dd>{usage.summary.failures}</dd></div>
              <div>
                <dt>{t("aiTokens")}</dt>
                <dd>{usage.summary.inputTokens + usage.summary.outputTokens}</dd>
              </div>
            </dl>
            <h3>{t("aiRecentActivity")}</h3>
            {usage.recent.length ? (
              <div className="ai-usage-list">
                {usage.recent.map((item, index) => (
                  <article key={`${item.occurredAt}:${index}`}>
                    <div>
                      <strong>
                        {item.purpose === "connection_test"
                          ? t("aiConnectionTestPurpose")
                          : item.purpose}
                      </strong>
                      <span className={item.success ? "success" : "failure"}>
                        {item.success ? t("aiSucceeded") : t("aiFailed")}
                      </span>
                    </div>
                    <p>{item.model || t("aiModelNotConfigured")}</p>
                    <small>
                      {formatDate(item.occurredAt, locale, timezone)} · {t("aiTokenPair", {
                        input: item.inputTokens ?? 0,
                        output: item.outputTokens ?? 0,
                      })}
                    </small>
                  </article>
                ))}
              </div>
            ) : (
              <p className="ai-empty-usage">{t("aiNoUsage")}</p>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}

type ErrorTranslationKey =
  | "AI_CONFIGURATION_INVALID"
  | "AI_PROVIDER_UNAVAILABLE"
  | "AI_UPSTREAM_ERROR"
  | "AI_RESPONSE_INVALID"
  | "AI_TIMEOUT"
  | "AI_DISABLED"
  | "CHATGPT_CONNECTION_NOT_CONFIGURED"
  | "PROVIDER_NOT_IMPLEMENTED_M2_1";

const errorLabels: Record<string, ErrorTranslationKey> = {
  AI_CONFIGURATION_INVALID: "AI_CONFIGURATION_INVALID",
  AI_PROVIDER_UNAVAILABLE: "AI_PROVIDER_UNAVAILABLE",
  AI_UPSTREAM_ERROR: "AI_UPSTREAM_ERROR",
  AI_RESPONSE_INVALID: "AI_RESPONSE_INVALID",
  AI_TIMEOUT: "AI_TIMEOUT",
  AI_DISABLED: "AI_DISABLED",
  CHATGPT_CONNECTION_NOT_CONFIGURED: "CHATGPT_CONNECTION_NOT_CONFIGURED",
  PROVIDER_NOT_IMPLEMENTED_M2_1: "PROVIDER_NOT_IMPLEMENTED_M2_1",
};

const errorKey = (code: string | null | undefined): ErrorTranslationKey | "INTERNAL_ERROR" =>
  code && errorLabels[code] ? errorLabels[code]! : "INTERNAL_ERROR";
