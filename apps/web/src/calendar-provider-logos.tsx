import googleCalendar from './assets/calendar-providers/google-calendar.svg';
import outlook from './assets/calendar-providers/outlook.png';
import homeAssistant from './assets/calendar-providers/home-assistant.svg';
import spondPositive from './assets/calendar-providers/spond-positive.png';
import spondNegative from './assets/calendar-providers/spond-negative.png';

export type CalendarProviderLogoName = 'google' | 'microsoft' | 'home_assistant' | 'spond';

/** Decorative provider marks; callers keep the provider name as readable text. */
export function CalendarProviderLogo({ provider }: { provider: CalendarProviderLogoName }) {
  if (provider === 'spond') {
    return <span className="calendar-provider-mark calendar-provider-mark-spond" aria-hidden="true">
      <img className="calendar-provider-spond-positive" src={spondPositive} alt="" />
      <img className="calendar-provider-spond-negative" src={spondNegative} alt="" />
    </span>;
  }
  const src = provider === 'google' ? googleCalendar : provider === 'microsoft' ? outlook : homeAssistant;
  return <span className={`calendar-provider-mark calendar-provider-mark-${provider}`} aria-hidden="true">
    <img src={src} alt="" />
  </span>;
}

export function SpondHomeAssistantLogos() {
  return <span className="calendar-provider-logos" aria-hidden="true">
    <CalendarProviderLogo provider="spond" />
    <CalendarProviderLogo provider="home_assistant" />
  </span>;
}
