import { useEffect } from 'react'
import './App.css'
import MainLayout from './components/MainLayout'
import CommandPalette from './shell/CommandPalette'
import { bootstrapSession } from './services/api'

function App() {
  // Mint the session cookie once on app boot.  All subsequent API
  // calls automatically carry the `ss_session` HttpOnly cookie that
  // identifies this browser/tab to the backend.  Failures are logged
  // but non-fatal — endpoints will still mint a session lazily on the
  // first request that hits them.
  useEffect(() => {
    bootstrapSession().catch((e) => {
      console.warn('Session bootstrap failed; will retry lazily.', e)
    })
  }, [])

  return (
    <>
      <MainLayout />
      <CommandPalette />
    </>
  )
}

export default App
