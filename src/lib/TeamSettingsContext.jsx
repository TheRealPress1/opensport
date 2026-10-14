import { createContext, useContext } from 'react'
import { DEFAULT_TEAM } from './config'

const TeamSettingsContext = createContext({ ...DEFAULT_TEAM, demo: false })

export function TeamSettingsProvider({ settings, demo = false, children }) {
  return <TeamSettingsContext.Provider value={{ ...DEFAULT_TEAM, ...settings, demo }}>{children}</TeamSettingsContext.Provider>
}

// Context and hook intentionally share the small settings module.
// eslint-disable-next-line react-refresh/only-export-components
export function useTeamSettings() {
  const settings = useContext(TeamSettingsContext)
  return { ...settings, homeScoreLabel: settings.name, soccer: settings.sport_mode === 'soccer' }
}
