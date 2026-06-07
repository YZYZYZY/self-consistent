import type { CapacitorConfig } from '@capacitor/cli'

type CapacitorEnv = Pick<NodeJS.ProcessEnv, 'CAP_SERVER_URL' | 'CAP_ALLOW_CLEAR_TEXT'>

export function buildCapacitorConfig(env: CapacitorEnv = process.env): CapacitorConfig {
  const remoteWebUrl = env.CAP_SERVER_URL?.trim()
  const remoteConfig = remoteWebUrl ? buildRemoteServerConfig(remoteWebUrl, env) : null

  return {
    appId: 'com.selfconsistent.microactioncoach',
    appName: '微行动教练',
    webDir: 'dist',
    server: remoteConfig ?? {
      androidScheme: 'https',
    },
    plugins: {
      LocalNotifications: {
        smallIcon: 'ic_stat_icon_config_sample',
        iconColor: '#f59e0b',
      },
    },
  }
}

function buildRemoteServerConfig(remoteWebUrl: string, env: CapacitorEnv) {
  const url = new URL(remoteWebUrl)
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new Error('CAP_SERVER_URL must start with https:// or http://.')
  }
  if (url.protocol === 'http:' && !isCleartextRemoteAllowed(url.hostname, env)) {
    throw new Error(
      'CAP_SERVER_URL uses http:// for a non-local host. Use https:// for hosted frontend mode, or set CAP_ALLOW_CLEAR_TEXT=true only for trusted local debugging.',
    )
  }
  return {
    url: remoteWebUrl,
    cleartext: url.protocol === 'http:',
  }
}

function isCleartextRemoteAllowed(hostname: string, env: CapacitorEnv) {
  if (env.CAP_ALLOW_CLEAR_TEXT === 'true') {
    return true
  }
  const normalized = hostname.toLowerCase()
  if (normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1') {
    return true
  }
  if (normalized.startsWith('10.') || normalized.startsWith('192.168.')) {
    return true
  }
  const match = normalized.match(/^172\.(\d+)\./)
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31)
}

const config = buildCapacitorConfig()

export default config
