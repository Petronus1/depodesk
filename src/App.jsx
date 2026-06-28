import { useAuth } from "./depodesk-supabase"
import AuthScreen from "./depodesk-auth"
import DepoDesk from "./depo-exhibit-app"

// Witness View route — if URL contains /witness, show witness page
function Router() {
  const isWitness = window.location.pathname === "/witness"
  const { user, loading } = useAuth()

  if (isWitness) {
    // Dynamically import to avoid loading Supabase auth for witnesses
    const WitnessView = require("./depodesk-witness").default
    return <WitnessView />
  }

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

  if (!user) return <AuthScreen />
  return <DepoDesk />
}

export default Router