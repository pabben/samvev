import { isIP } from 'node:net';

export interface RuntimeConfig {
  publicOrigin: string;
  secureCookies: boolean;
  trustProxy: false | string;
}

export interface InstallationExposureState {
  claimedAt: Date | null;
  demoMode: boolean;
}

function parsePublicOrigin(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('SAMVEV_PUBLIC_ORIGIN must be an absolute HTTP(S) origin');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('SAMVEV_PUBLIC_ORIGIN must use http or https');
  }
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('SAMVEV_PUBLIC_ORIGIN must contain only scheme, hostname and optional port');
  }
  return parsed;
}

function parseTrustProxy(value: string | undefined): false | string {
  const normalized = value?.trim();
  if (!normalized || normalized === 'false') return false;
  if (['true', '1', '*'].includes(normalized.toLowerCase())) {
    throw new Error('SAMVEV_TRUST_PROXY must name the immediate proxy IP or CIDR, not trust every proxy');
  }
  const addresses = normalized.split(',').map((entry) => entry.trim());
  for (const entry of addresses) {
    const [address, prefix, extra] = entry.split('/');
    const version = address ? isIP(address) : 0;
    const exactPrefix = version === 4 ? '32' : version === 6 ? '128' : undefined;
    if (extra !== undefined || !exactPrefix || (prefix !== undefined && prefix !== exactPrefix)) {
      throw new Error('SAMVEV_TRUST_PROXY must contain only exact immediate proxy IPs (/32 or /128)');
    }
  }
  return addresses.join(',');
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const localPort = env.SAMVEV_PORT ?? env.PORT ?? '4173';
  const publicUrl = parsePublicOrigin(env.SAMVEV_PUBLIC_ORIGIN ?? `http://127.0.0.1:${localPort}`);
  return {
    publicOrigin: publicUrl.origin,
    secureCookies: publicUrl.protocol === 'https:',
    trustProxy: parseTrustProxy(env.SAMVEV_TRUST_PROXY)
  };
}

export async function assertPublicDeploymentReady(
  runtime: RuntimeConfig,
  demoModeEnabled: boolean,
  loadInstallation: () => Promise<InstallationExposureState | undefined>
): Promise<void> {
  if (!runtime.secureCookies) return;
  if (demoModeEnabled) throw new Error('Public HTTPS startup refuses SAMVEV_DEMO_MODE=true');
  const installation = await loadInstallation();
  if (!installation?.claimedAt || installation.demoMode) {
    throw new Error('Public HTTPS startup requires a privately claimed, non-demo installation');
  }
}
