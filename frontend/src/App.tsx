import './App.css'
import MainLayout from './components/MainLayout'
import CommandPalette from './shell/CommandPalette'
import CellPanelHost from './components/CellPanelHost'
import { ConsoleProvider } from './context/ConsoleContext'
import { InspectorProvider } from './context/InspectorContext'
import { StepPaletteProvider } from './context/StepPaletteContext'

// The session cookie is minted by the toolbar's connection check
// (hooks/useConnection), which hits /api/session on mount and every 5s.
// Selection inspectors are app-wide: opened from a grid, floating over the
// app, minimized onto the steps bar.
function App() {
  return (
    <ConsoleProvider>
      <InspectorProvider>
        {/* The step palette in use: steps read it, Settings switches it. */}
        <StepPaletteProvider>
          <MainLayout />
          <CommandPalette />
          <CellPanelHost />
        </StepPaletteProvider>
      </InspectorProvider>
    </ConsoleProvider>
  )
}

export default App
