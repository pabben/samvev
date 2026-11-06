import type { TranslationKey } from './locales/en';
import { useI18n } from './ui';

export type HomeAssistantPreviewItem = {
  name: string;
  domain: 'light' | 'cover';
  state: string | null;
  stateStatus: 'current' | 'unavailable' | 'unknown';
  lastChangedAt: string | null;
};

export function HomeAssistantPreviewCard({ items }: { items: HomeAssistantPreviewItem[] }) {
  const { t } = useI18n();
  const domainLabel: Record<HomeAssistantPreviewItem['domain'], TranslationKey> = {
    light: 'homeAssistantLight', cover: 'homeAssistantCover',
  };
  const statusLabel: Record<HomeAssistantPreviewItem['stateStatus'], TranslationKey> = {
    current: 'homeAssistantStateCurrent', unavailable: 'homeAssistantStateUnavailable', unknown: 'homeAssistantStateUnknown',
  };
  return <div className="home-assistant-preview-card" data-testid="home-assistant-preview-card">
    {items.length ? items.map((item, index) => <article className="display-preview-item" key={`${item.domain}:${item.name}:${index}`}>
      <strong>{item.name}</strong><small>{t(domainLabel[item.domain])}</small>
      <p role="status">{t(statusLabel[item.stateStatus])}{item.stateStatus === 'current' && item.state ? ` · ${item.state}` : ''}</p>
    </article>) : <p className="field-hint" role="status">{t('homeAssistantStateUnknown')}</p>}
  </div>;
}
