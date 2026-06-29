// ============================================================
// DepoDesk — Join Page (/join)
// ============================================================
// Participants open this page, enter the PIN the attorney
// shares with them, then their name, email, and role.
//
// ROUTING (add to App.jsx):
//   const isJoin = window.location.pathname === "/join"
//   if (isJoin) return <JoinPage />
// ============================================================

import { useState, useEffect } from "react";
import { supabase } from "./depodesk-supabase";

const GOLD   = "#C9A84C";
const NAVY   = "#0F1B2D";
const DARK   = "#0A1628";
const BORDER = "#1E3254";
const MUTED  = "#7A93B8";
const DIM    = "#4A6080";
const GREEN  = "#4CAF82";

const ROLES = [
  {
    id: "witness",
    label: "Witness",
    icon: "👤",
    description: "View exhibits as they are presented by counsel",
  },
  {
    id: "opposing_counsel",
    label: "Opposing Counsel",
    icon: "⚖️",
    description: "View introduced exhibits and the exhibit log",
  },
  {
    id: "court_reporter",
    label: "Court Reporter",
    icon: "📋",
    description: "View the live timestamped exhibit log",
  },
];

function Input({ label, type = "text", value, onChange, placeholder, autoComplete }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: DIM, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 5 }}>
        {label}
      </label>
      <input
        type={type} value={value} onChange={onChange}
        placeholder={placeholder} autoComplete={autoComplete}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={{
          width: "100%", background: DARK,
          border: `1px solid ${focused ? GOLD : BORDER}`,
          borderRadius: 7, padding: "10px 14px",
          color: "#E8EDF5", fontSize: 14, outline: "none",
          boxSizing: "border-box", transition: "border-color 0.15s",
          fontFamily: "inherit",
        }}
      />
    </div>
  );
}

function PINInput({ value, onChange }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ marginBottom: 20 }}>
      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: DIM, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8, textAlign: "center" }}>
        Session PIN
      </label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        placeholder="000000"
        maxLength={6}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: "100%", background: DARK,
          border: `2px solid ${focused ? GOLD : BORDER}`,
          borderRadius: 10, padding: "16px",
          color: GOLD, fontSize: 32, outline: "none",
          boxSizing: "border-box", transition: "border-color 0.15s",
          fontFamily: "monospace", letterSpacing: "12px",
          textAlign: "center", fontWeight: 800,
        }}
      />
    </div>
  );
}

// ── Step 1: Enter PIN ─────────────────────────────────────────
function PINStep({ onVerified }) {
  const [pin, setPin]         = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  // Pre-fill PIN from URL if present: /join?pin=123456
  useEffect(() => {
    const urlPin = new URLSearchParams(window.location.search).get("pin");
    if (urlPin) setPin(urlPin);
  }, []);

  async function verify() {
    if (pin.length !== 6) { setError("Please enter the 6-digit PIN."); return; }
    setLoading(true); setError(null);
    try {
      const { data, error } = await supabase
        .from("sessions")
        .select("*, cases(name, number)")
        .eq("pin", pin)
        .eq("is_active", true)
        .single();
      if (error || !data) throw new Error("Invalid PIN or session has ended.");
      onVerified(data);
    } catch (err) {
      setError(err.message || "Invalid PIN. Please check with the attorney.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#E8EDF5", marginBottom: 6 }}>Join Deposition</div>
        <div style={{ fontSize: 13, color: MUTED }}>Enter the PIN provided by counsel</div>
      </div>

      {error && (
        <div style={{ background: "#1A0A0A", border: "1px solid #5C1A1A", borderRadius: 7, padding: "10px 14px", fontSize: 13, color: "#F87171", marginBottom: 16 }}>
          {error}
        </div>
      )}

      <PINInput value={pin} onChange={setPin} />

      <button onClick={verify} disabled={loading || pin.length !== 6} style={{
        width: "100%", padding: "12px",
        background: pin.length === 6 ? GOLD : "#1E3254",
        color: pin.length === 6 ? NAVY : DIM,
        border: "none", borderRadius: 7,
        fontSize: 14, fontWeight: 700,
        cursor: pin.length === 6 ? "pointer" : "not-allowed",
        fontFamily: "inherit", transition: "all 0.15s",
      }}>
        {loading ? "Verifying…" : "Continue"}
      </button>
    </div>
  );
}

// ── Step 2: Enter details + pick role ─────────────────────────
function DetailsStep({ session, onJoined }) {
  const [name, setName]       = useState("");
  const [email, setEmail]     = useState("");
  const [role, setRole]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  async function join() {
    if (!name.trim()) { setError("Please enter your name."); return; }
    if (!role) { setError("Please select your role."); return; }
    setLoading(true); setError(null);
    try {
      const { data, error } = await supabase
        .from("participants")
        .insert({ session_id: session.id, name: name.trim(), email: email.trim() || null, role })
        .select()
        .single();
      if (error) throw error;

      // Log the join event
      await supabase.from("session_events").insert({
        session_id: session.id,
        event_type: "participant_joined",
        actor_name: name.trim(),
        actor_role: role,
      });

      onJoined({ ...data, session });
    } catch (err) {
      setError(err.message || "Failed to join. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#E8EDF5", marginBottom: 4 }}>
          {session.cases?.name || "Deposition"}
        </div>
        {session.cases?.number && (
          <div style={{ fontSize: 12, color: DIM }}>{session.cases.number}</div>
        )}
      </div>

      {error && (
        <div style={{ background: "#1A0A0A", border: "1px solid #5C1A1A", borderRadius: 7, padding: "10px 14px", fontSize: 13, color: "#F87171", marginBottom: 16 }}>
          {error}
        </div>
      )}

      <Input label="Your Name" value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith" autoComplete="name" />
      <Input label="Email (optional — for receiving exhibits)" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@firm.com" autoComplete="email" />

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: DIM, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>Your Role</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {ROLES.map(r => (
            <div key={r.id} onClick={() => setRole(r.id)} style={{
              padding: "12px 14px", borderRadius: 8, cursor: "pointer",
              border: `1px solid ${role === r.id ? GOLD : BORDER}`,
              background: role === r.id ? "#131F33" : "transparent",
              display: "flex", alignItems: "center", gap: 12,
              transition: "all 0.15s",
            }}>
              <span style={{ fontSize: 20 }}>{r.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: role === r.id ? "#E8EDF5" : MUTED }}>{r.label}</div>
                <div style={{ fontSize: 11, color: DIM, marginTop: 2 }}>{r.description}</div>
              </div>
              <div style={{
                width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
                border: `2px solid ${role === r.id ? GOLD : BORDER}`,
                background: role === r.id ? GOLD : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {role === r.id && <div style={{ width: 6, height: 6, borderRadius: "50%", background: NAVY }} />}
              </div>
            </div>
          ))}
        </div>
      </div>

      <button onClick={join} disabled={loading} style={{
        width: "100%", padding: "12px",
        background: GOLD, color: NAVY,
        border: "none", borderRadius: 7,
        fontSize: 14, fontWeight: 700,
        cursor: loading ? "not-allowed" : "pointer",
        fontFamily: "inherit", opacity: loading ? 0.6 : 1,
      }}>
        {loading ? "Joining…" : "Join Deposition"}
      </button>
    </div>
  );
}

// ── Joined — redirect to role view ────────────────────────────
function JoinedScreen({ participant }) {
  const viewMap = {
    witness: "/witness",
    opposing_counsel: "/opposing-counsel",
    court_reporter: "/court-reporter",
  };

  useEffect(() => {
    const path = viewMap[participant.role];
    const sessionId = participant.session.id;
    const participantId = participant.id;
    // Store in sessionStorage so the view page can access it
    sessionStorage.setItem("depo_session_id", sessionId);
    sessionStorage.setItem("depo_pin", participant.session.pin);
    sessionStorage.setItem("depo_participant_id", participantId);
    sessionStorage.setItem("depo_participant_name", participant.name);
    sessionStorage.setItem("depo_participant_role", participant.role);
    // Redirect after brief delay
    setTimeout(() => { window.location.href = path; }, 1500);
  }, []);

  const roleLabels = {
    witness: "Witness View",
    opposing_counsel: "Opposing Counsel View",
    court_reporter: "Court Reporter View",
  };

  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>✅</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: "#E8EDF5", marginBottom: 8 }}>
        Welcome, {participant.name}
      </div>
      <div style={{ fontSize: 13, color: MUTED, marginBottom: 20 }}>
        Joining as {roleLabels[participant.role]}…
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: GREEN, animation: "pulse 1.5s infinite" }} />
        <span style={{ fontSize: 12, color: GREEN }}>Connecting to session</span>
      </div>
    </div>
  );
}

// ── Root Join Page ────────────────────────────────────────────
export default function JoinPage() {
  const [step, setStep]               = useState("pin"); // pin | details | joined
  const [session, setSession]         = useState(null);
  const [participant, setParticipant] = useState(null);

  return (
    <div style={{
      fontFamily: "'Inter', system-ui, sans-serif",
      background: DARK, minHeight: "100vh",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: 24,
      color: "#E8EDF5",
    }}>
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 32 }}>
        <div style={{ width: 32, height: 32, background: GOLD, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 16, color: NAVY }}>D</div>
        <span style={{ fontWeight: 800, fontSize: 18 }}>DepoDesk</span>
      </div>

      {/* Card */}
      <div style={{
        width: "100%", maxWidth: 420,
        background: NAVY, border: `1px solid ${BORDER}`,
        borderRadius: 12, padding: 28,
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }}>
        {step === "pin" && (
          <PINStep onVerified={sess => { setSession(sess); setStep("details"); }} />
        )}
        {step === "details" && (
          <DetailsStep session={session} onJoined={p => { setParticipant(p); setStep("joined"); }} />
        )}
        {step === "joined" && (
          <JoinedScreen participant={participant} />
        )}
      </div>

      <div style={{ marginTop: 24, fontSize: 12, color: DIM, textAlign: "center" }}>
        Secure deposition exhibit management · DepoDesk
      </div>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );
}
