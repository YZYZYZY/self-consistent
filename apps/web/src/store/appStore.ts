import { create } from 'zustand'
import type { AppTab, AppTheme, CoachScene, EncouragementStyle, FontDensity, MainChallenge } from '../types'

interface AppState {
  tab: AppTab
  scene: CoachScene
  onboardingComplete: boolean
  historyEnabled: boolean
  serverRecordEnabled: boolean
  profileEnabled: boolean
  mainChallenge: MainChallenge
  encouragementStyle: EncouragementStyle
  appTheme: AppTheme
  fontDensity: FontDensity
  reminderEnabled: boolean
  reminderTime: string
  apiBaseUrl: string
  setTab: (tab: AppTab) => void
  setScene: (scene: CoachScene) => void
  setOnboardingComplete: (value: boolean) => void
  setHistoryEnabled: (value: boolean) => void
  setServerRecordEnabled: (value: boolean) => void
  setProfileEnabled: (value: boolean) => void
  setMainChallenge: (value: MainChallenge) => void
  setEncouragementStyle: (value: EncouragementStyle) => void
  setAppTheme: (value: AppTheme) => void
  setFontDensity: (value: FontDensity) => void
  setReminderEnabled: (value: boolean) => void
  setReminderTime: (value: string) => void
  setApiBaseUrl: (value: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  tab: 'home',
  scene: 'procrastination',
  onboardingComplete: false,
  historyEnabled: true,
  serverRecordEnabled: true,
  profileEnabled: true,
  mainChallenge: 'procrastination',
  encouragementStyle: 'rational',
  appTheme: 'warm',
  fontDensity: 'comfortable',
  reminderEnabled: true,
  reminderTime: '21:30',
  apiBaseUrl: '',
  setTab: (tab) => set({ tab }),
  setScene: (scene) => set({ scene }),
  setOnboardingComplete: (onboardingComplete) => set({ onboardingComplete }),
  setHistoryEnabled: (historyEnabled) => set({ historyEnabled }),
  setServerRecordEnabled: (serverRecordEnabled) => set({ serverRecordEnabled }),
  setProfileEnabled: (profileEnabled) => set({ profileEnabled }),
  setMainChallenge: (mainChallenge) => set({ mainChallenge }),
  setEncouragementStyle: (encouragementStyle) => set({ encouragementStyle }),
  setAppTheme: (appTheme) => set({ appTheme }),
  setFontDensity: (fontDensity) => set({ fontDensity }),
  setReminderEnabled: (reminderEnabled) => set({ reminderEnabled }),
  setReminderTime: (reminderTime) => set({ reminderTime }),
  setApiBaseUrl: (apiBaseUrl) => set({ apiBaseUrl }),
}))
