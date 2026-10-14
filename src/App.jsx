import { Component, lazy, Suspense, useSyncExternalStore } from 'react'
import LandingPage from './components/LandingPage'

// Live data code is loaded only after choosing the team entrypoint.
const DemoTeamApp = lazy(() => import('./components/DemoTeamApp'))
const LiveTeamApp = lazy(() => import('./components/LiveTeamApp'))
const SetupGuide = lazy(() => import('./components/SetupGuide'))
const DesktopSetup = lazy(() => import('./components/DesktopSetup'))
const subscribe = (notify) => {
  window.addEventListener('hashchange', notify)
  return () => window.removeEventListener('hashchange', notify)
}
const getRoute = () => window.location.hash

class AppErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if (this.state.error) return (
      <main className="mx-auto max-w-lg p-8 text-slate-900">
        <h1 className="text-2xl font-bold">OpenSport couldn’t load this page.</h1>
        <p className="mt-3">Reload to try again. Your saved team data stays on your host.</p>
        <button className="mt-6 rounded-lg bg-emerald-900 px-4 py-3 text-white" onClick={() => window.location.reload()}>Reload page</button>
      </main>
    )
    return this.props.children
  }
}

export default function App() {
  const route = useSyncExternalStore(subscribe, getRoute)
  // A one-click cloud install is always a team, even before its database is connected.
  const mode = import.meta.env.VITE_APP_MODE || (
    import.meta.env.VITE_OPENSPORT_CLOUD === '1' || (import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY) ? 'team' : 'project'
  )
  const demo = route === '#/demo' || window.location.pathname === '/demo'
  return (
    <AppErrorBoundary>
      <Suspense fallback={<div role="status" className="grid min-h-screen place-items-center bg-[#f7f6ef] font-semibold text-emerald-950">Loading OpenSport…</div>}>
        {mode === 'desktop' ? <DesktopSetup /> : demo ? <DemoTeamApp /> : route === '#/setup' || window.location.pathname === '/setup' ? <SetupGuide /> : mode === 'team' ? <LiveTeamApp /> : <LandingPage />}
      </Suspense>
    </AppErrorBoundary>
  )
}
