import { Component } from "react"
import { useAuth } from "./depodesk-supabase"
import AuthScreen, { ResetPasswordScreen } from "./depodesk-auth"
import DepoDesk from "./depo-exhibit-app"
import JoinPage from "./depodesk-join"
import WitnessView from "./depodesk-witness"
import OpposingCounselView from "./depodesk-opposing-counsel"
import CourtReporterView from "./depodesk-court-reporter"

// A render crash used to blank the whole screen — unacceptable mid-
// deposition, and it hides the cause. Show what broke, and let counsel
// recover without losing the session.
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null, info: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("DepoDesk crashed:", error, info); this.setState({ info }); }
  render() {
    if (!this.state.error) return this.props.children;
    const { error, info } = this.state;
    return (
      <div style={{ background: "#0A1628", minHeight: "100vh", color: "#E8EDF5", fontFamily: "'Inter', system-ui, sans-serif", padding: "40px 24px" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#F87171", marginBottom: 8 }}>Something broke in DepoDesk</div>
          <div style={{ fontSize: 13, color: "#7A93B8", marginBottom: 16, lineHeight: 1.6 }}>
            Your cases and exhibits are safe — this is a display error. Reload to continue.
            If it keeps happening, copy the details below.
          </div>
          <button onClick={() => window.location.reload()} style={{
            background: "#C9A84C", color: "#0F1B2D", border: "none", borderRadius: 6,
            padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", marginBottom: 20,
          }}>Reload</button>
          <pre style={{
            background: "#0F1B2D", border: "1px solid #1E3254", borderRadius: 8, padding: 14,
            fontSize: 11, color: "#F87171", whiteSpace: "pre-wrap", wordBreak: "break-word", overflowX: "auto",
          }}>{String(error?.stack || error?.message || error)}
{info?.componentStack ? "\nComponent stack:" + info.componentStack : ""}</pre>
        </div>
      </div>
    );
  }
}

function Router() {
  const path = window.location.pathname

  if (path === "/join")             return <JoinPage />
  if (path === "/witness")          return <WitnessView />
  if (path === "/opposing-counsel") return <OpposingCounselView />
  if (path === "/court-reporter")   return <CourtReporterView />
  if (path === "/reset-password")   return <ResetPasswordScreen />

  return <AuthedApp />
}

function AuthedApp() {
  const { user, loading } = useAuth()

  if (loading) return (
    <div style={{
      background: "#0A1628", minHeight: "100vh",
      display: "flex", alignItems: "center", justifyContent: "center"
    }}>
      <div style={{
        width: 32, height: 32,
        border: "3px solid #1E3254", borderTopColor: "#C9A84C",
        borderRadius: "50%", animation: "spin 0.8s linear infinite"
      }} />
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  // Anonymous sessions belong to deposition participants (created on
  // /join for private realtime channels) — never the attorney app.
  if (!user || user.is_anonymous) return <AuthScreen />
  return <DepoDesk />
}

export default function App() {
  return <ErrorBoundary><Router /></ErrorBoundary>
}