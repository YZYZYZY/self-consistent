import { describe, expect, it } from 'vitest'
import { buildCapacitorConfig } from './capacitor.config'

describe('capacitor remote frontend config', () => {
  it('uses bundled assets by default', () => {
    const config = buildCapacitorConfig({})

    expect(config.appId).toBe('com.selfconsistent.microactioncoach')
    expect(config.appName).toBe('微行动教练')
    expect(config.server).toEqual({ androidScheme: 'https' })
  })

  it('allows hosted HTTPS frontend mode', () => {
    const config = buildCapacitorConfig({ CAP_SERVER_URL: 'https://app.example.com' })

    expect(config.server).toEqual({
      url: 'https://app.example.com',
      cleartext: false,
    })
  })

  it('allows local cleartext frontend mode for LAN debugging', () => {
    const config = buildCapacitorConfig({ CAP_SERVER_URL: 'http://192.168.1.5:5173' })

    expect(config.server).toEqual({
      url: 'http://192.168.1.5:5173',
      cleartext: true,
    })
  })

  it('rejects public cleartext frontend mode unless explicitly allowed', () => {
    expect(() => buildCapacitorConfig({ CAP_SERVER_URL: 'http://app.example.com' })).toThrow(/https/)
    expect(buildCapacitorConfig({ CAP_SERVER_URL: 'http://app.example.com', CAP_ALLOW_CLEAR_TEXT: 'true' }).server).toEqual({
      url: 'http://app.example.com',
      cleartext: true,
    })
  })
})
