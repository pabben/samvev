import {Icon} from './ui';

export type CalendarProviderLogoName = 'google' | 'microsoft' | 'home_assistant' | 'spond';

/** Decorative, code-native symbols; provider names remain readable adjacent text. */
export function CalendarProviderLogo({provider}: {provider: CalendarProviderLogoName}) {
  const icon = provider === 'home_assistant' ? 'home' : 'calendar';
  return <span className={`calendar-provider-mark calendar-provider-mark-${provider}`} aria-hidden="true">
    <Icon name={icon} size={24}/>
  </span>;
}

/** Spond activities are reached through the household's Home Assistant connection. */
export function SpondHomeAssistantLogos() {
  return <span className="calendar-provider-logos" aria-hidden="true">
    <CalendarProviderLogo provider="spond" />
    <CalendarProviderLogo provider="home_assistant" />
  </span>;
}
