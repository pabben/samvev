import googleCalendar from './assets/calendar-providers/google-calendar.svg';
import outlook from './assets/calendar-providers/outlook.svg';
import homeAssistantLight from './assets/calendar-providers/home-assistant-light.svg';
import homeAssistantDark from './assets/calendar-providers/home-assistant-dark.svg';
import spond from './assets/calendar-providers/spond.svg';

export type CalendarProviderLogoName = 'google' | 'microsoft' | 'home_assistant' | 'spond';

/** Official, locally bundled provider marks. Adjacent localized text supplies the accessible name. */
export function CalendarProviderLogo({provider}: {provider: CalendarProviderLogoName}) {
  if (provider === 'home_assistant') return <span className="calendar-provider-mark calendar-provider-mark-home_assistant" aria-hidden="true">
    <img className="calendar-provider-image calendar-provider-image-ha-light" src={homeAssistantLight} alt="" />
    <img className="calendar-provider-image calendar-provider-image-ha-dark" src={homeAssistantDark} alt="" />
  </span>;
  const src = provider === 'google' ? googleCalendar : provider === 'microsoft' ? outlook : spond;
  return <span className={`calendar-provider-mark calendar-provider-mark-${provider}`} aria-hidden="true">
    <img className="calendar-provider-image" src={src} alt="" />
  </span>;
}

/** Spond activities are reached through the household's Home Assistant connection. */
export function SpondHomeAssistantLogos() {
  return <span className="calendar-provider-logos" aria-hidden="true">
    <CalendarProviderLogo provider="spond" />
    <CalendarProviderLogo provider="home_assistant" />
  </span>;
}
