import { useState } from "react";
import { signIn, signUp, supabase } from "./depodesk-supabase";

const GOLD  = "#C9A84C";
const NAVY  = "#0F1B2D";
const DARK  = "#0A1628";
const BORDER = "#1E3254";
const MUTED = "#7A93B8";
const DIM   = "#4A6080";

function Input({ label, type = "text", value, onChange, placeholder, autoComplete }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: DIM, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>
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

function Btn({ onClick, children, loading = false }) {
  return (
    <button type="button" onClick={onClick} disabled={loading} style={{
      width: "100%", padding: "11px 0",
      background: GOLD, border: "none", color: NAVY,
      borderRadius: 7, fontSize: 14, fontWeight: 700,
      cursor: loading ? "not-allowed" : "pointer",
      opacity: loading ? 0.6 : 1, fontFamily: "inherit",
    }}>
      {loading ? "Please wait…" : children}
    </button>
  );
}

function Alert({ msg, type = "error" }) {
  if (!msg || typeof msg !== "string" || msg.length === 0) return null;
  return (
    <div style={{
      background: type === "error" ? "#1A0A0A" : "#0D2D1A",
      border: `1px solid ${type === "error" ? "#5C1A1A" : "#2A5C3A"}`,
      borderRadius: 7, padding: "10px 14px",
      fontSize: 13, color: type === "error" ? "#F87171" : "#4CAF82",
      marginBottom: 18, lineHeight: 1.5,
    }}>{msg}</div>
  );
}

function SignInForm({ onSwitch, onForgot }) {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);

  async function handleSubmit() {
    setError(null);
    if (!email.trim() || !password.trim()) { setError("Please enter your email and password."); return; }
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err.message || "Sign in failed. Please check your credentials.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#E8EDF5", marginBottom: 6 }}>Welcome back</div>
        <div style={{ fontSize: 13, color: MUTED }}>Sign in to your DepoDesk account</div>
      </div>
      <Alert msg={error} />
      <Input label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@yourfirm.com" autoComplete="email" />
      <Input label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
      <div style={{ textAlign: "right", marginBottom: 20, marginTop: -8 }}>
        <span onClick={onForgot} style={{ fontSize: 12, color: DIM, cursor: "pointer" }}>Forgot password?</span>
      </div>
      <Btn onClick={handleSubmit} loading={loading}>Sign In</Btn>
      <div style={{ textAlign: "center", marginTop: 20, fontSize: 13, color: DIM }}>
        Don't have an account?{" "}
        <span onClick={onSwitch} style={{ color: GOLD, cursor: "pointer", fontWeight: 600 }}>Create one</span>
      </div>
    </div>
  );
}

function SignUpForm({ onSwitch }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [success, setSuccess]   = useState(null);

  async function handleSubmit() {
    setError(null);
    if (!fullName.trim() || !email.trim()) { setError("Please enter your name and email."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setLoading(true);
    try {
      await signUp(email.trim(), password, fullName.trim());
      setSuccess("Account created! You can now sign in.");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#E8EDF5", marginBottom: 6 }}>Create your account</div>
        <div style={{ fontSize: 13, color: MUTED }}>Start managing depositions with DepoDesk</div>
      </div>
      <Alert msg={error} type="error" />
      <Alert msg={success} type="success" />
      {!success && (
        <>
          <Input label="Full Name" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Ryan Peterson" autoComplete="name" />
          <Input label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@yourfirm.com" autoComplete="email" />
          <Input label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="8+ characters" autoComplete="new-password" />
          <Input label="Confirm Password" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
          <div style={{ marginBottom: 20 }} />
          <Btn onClick={handleSubmit} loading={loading}>Create Account</Btn>
        </>
      )}
      {success && (
        <button onClick={onSwitch} style={{
          width: "100%", padding: "11px 0", background: "transparent",
          border: `1px solid ${BORDER}`, color: MUTED,
          borderRadius: 7, fontSize: 14, cursor: "pointer", fontFamily: "inherit",
        }}>Go to Sign In</button>
      )}
      <div style={{ textAlign: "center", marginTop: 20, fontSize: 13, color: DIM }}>
        Already have an account?{" "}
        <span onClick={onSwitch} style={{ color: GOLD, cursor: "pointer", fontWeight: 600 }}>Sign in</span>
      </div>
    </div>
  );
}

function ForgotForm({ onBack }) {
  const [email, setEmail]     = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [success, setSuccess] = useState(null);

  async function handleSubmit() {
    setError(null);
    if (!email.trim()) { setError("Please enter your email."); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setSuccess("Password reset email sent. Check your inbox.");
    } catch (err) {
      setError(err.message || "Failed to send reset email.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#E8EDF5", marginBottom: 6 }}>Reset password</div>
        <div style={{ fontSize: 13, color: MUTED }}>We'll send a reset link to your email</div>
      </div>
      <Alert msg={error} type="error" />
      <Alert msg={success} type="success" />
      {!success && (
        <>
          <Input label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@yourfirm.com" autoComplete="email" />
          <div style={{ marginBottom: 20 }} />
          <Btn onClick={handleSubmit} loading={loading}>Send Reset Link</Btn>
        </>
      )}
      <div style={{ textAlign: "center", marginTop: 20, fontSize: 13, color: DIM }}>
        <span onClick={onBack} style={{ color: GOLD, cursor: "pointer", fontWeight: 600 }}>← Back to sign in</span>
      </div>
    </div>
  );
}

export default function AuthScreen() {
  const [view, setView] = useState("signin");
  return (
    <div style={{
      fontFamily: "'Inter', system-ui, sans-serif",
      background: DARK, minHeight: "100vh",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 36 }}>
        <div style={{ width: 36, height: 36, background: GOLD, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 18, color: NAVY }}>D</div>
        <span style={{ fontWeight: 800, fontSize: 20 }}>DepoDesk</span>
      </div>
      <div style={{ width: "100%", maxWidth: 400, background: NAVY, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 32, boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
        {view === "signin" && <SignInForm onSwitch={() => setView("signup")} onForgot={() => setView("forgot")} />}
        {view === "signup" && <SignUpForm onSwitch={() => setView("signin")} />}
        {view === "forgot" && <ForgotForm onBack={() => setView("signin")} />}
      </div>
      <div style={{ marginTop: 28, fontSize: 12, color: DIM, textAlign: "center" }}>
        Secure deposition exhibit management<br />
        <span style={{ color: "#2A3F58" }}>Your data is encrypted and protected by Supabase RLS</span>
      </div>
    </div>
  );
}
