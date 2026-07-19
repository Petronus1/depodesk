import { useAuth } from "./depodesk-supabase"
import AuthScreen from "./depodesk-auth"
import DepoDesk from "./depo-exhibit-app"
import JoinPage from "./depodesk-join"
import WitnessView from "./depodesk-witness"
import OpposingCounselView from "./depodesk-opposing-counsel"
import CourtReporterView from "./depodesk-court-reporter"

function Router() {
  const path = window.location.pathname

  if (path === "/join")             return <JoinPage />
  if (path === "/witness")          return <WitnessView />
  if (path === "/opposing-counsel") return <OpposingCounselView />
  if (path === "/court-reporter")   return <CourtReporterView />

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

export default Router