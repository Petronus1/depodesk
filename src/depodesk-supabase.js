// ============================================================
// DepoDesk — Supabase Client Layer
// ============================================================
// The URL and anon (publishable) key below are the single source
// of truth. The publishable key is public by design — it ships in
// the browser bundle and is safe to commit; row-level security,
// not this key, is what protects data. Find both in the Supabase
// Dashboard → Settings → API.
// ============================================================

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL      = "https://jxpsqttphsccbigeppfg.supabase.co"
const SUPABASE_ANON_KEY = "sb_publishable_PrBPJgc6LuQVglauugGa8A_1S9OiiJ7"
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  }
});


// ── AUTH ─────────────────────────────────────────────────────

/**
 * Sign up a new attorney account.
 * @example await signUp("ryan@peterson.legal", "password123", "Ryan Peterson")
 */
export async function signUp(email, password, fullName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  if (error) throw error;
  return data.user;
}

/**
 * Sign in an existing user.
 */
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

/**
 * Sign out.
 */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Get the currently logged-in user (or null).
 */
export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

/**
 * Subscribe to auth state changes (login / logout).
 * @example onAuthChange((user) => setUser(user))
 */
export function onAuthChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
  return data.subscription; // call subscription.unsubscribe() on cleanup
}


// ── CASES ────────────────────────────────────────────────────

/**
 * Fetch all cases for the logged-in user.
 * Returns cases the user owns OR is a member of.
 */
export async function getCases() {
  const { data, error } = await supabase
    .from("cases")
    .select(`
      *,
      exhibits (count)
    `)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

/**
 * Create a new case.
 * @example await createCase({ name: "Smith v. Acme", number: "2024-CV-001", court: "S.D.N.Y.", status: "active" })
 */
export async function createCase({ name, number, court, status = "active" }) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not logged in");

  const { data, error } = await supabase
    .from("cases")
    .insert({ name, number, court, status, owner_id: user.id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Update case fields (name, status, etc.)
 */
export async function updateCase(caseId, fields) {
  const { data, error } = await supabase
    .from("cases")
    .update(fields)
    .eq("id", caseId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Delete a case and all its exhibits (cascades via DB).
 */
export async function deleteCase(caseId) {
  const { error } = await supabase
    .from("cases")
    .delete()
    .eq("id", caseId);
  if (error) throw error;
}


// ── EXHIBITS ─────────────────────────────────────────────────

/**
 * Fetch all exhibits for a case.
 */
export async function getExhibits(caseId) {
  const { data, error } = await supabase
    .from("exhibits")
    .select("*")
    .eq("case_id", caseId)
    .order("exhibit_order", { ascending: true });
  if (error) throw error;
  return data;
}

/**
 * Create a new exhibit (metadata only — upload file separately).
 * @example await createExhibit(caseId, { name: "Employment Agreement", type: "PDF", tags: ["contract"] })
 */
export async function createExhibit(caseId, { name, type = "PDF", document_date, tags = [] }) {
  // Auto-number: count existing exhibits + 1
  const { count } = await supabase
    .from("exhibits")
    .select("*", { count: "exact", head: true })
    .eq("case_id", caseId);

  const exhibitNum = (count ?? 0) + 1;

  const { data, error } = await supabase
    .from("exhibits")
    .insert({
      case_id: caseId,
      label: `Exhibit ${exhibitNum}`,
      name,
      type,
      document_date: document_date || null,
      tags,
      exhibit_order: exhibitNum,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Update exhibit fields (name, marked, tags, etc.)
 */
export async function updateExhibit(exhibitId, fields) {
  const { data, error } = await supabase
    .from("exhibits")
    .update(fields)
    .eq("id", exhibitId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Mark an exhibit into the record.
 */
export async function markExhibit(exhibitId) {
  return updateExhibit(exhibitId, { marked: true });
}

/**
 * Delete an exhibit (also deletes its file from storage).
 */
export async function deleteExhibit(exhibitId, filePath) {
  if (filePath) await deleteExhibitFile(filePath);
  const { error } = await supabase
    .from("exhibits")
    .delete()
    .eq("id", exhibitId);
  if (error) throw error;
}


// ── FILE STORAGE ─────────────────────────────────────────────

/**
 * Upload a PDF or image file for an exhibit.
 * Returns the storage path to save in exhibits.file_path.
 *
 * @example
 *   const path = await uploadExhibitFile(caseId, exhibitId, file)
 *   await updateExhibit(exhibitId, { file_path: path, file_name: file.name, file_size: file.size })
 */
export async function uploadExhibitFile(caseId, exhibitId, file) {
  const ext  = file.name.split(".").pop();
  const path = `${caseId}/${exhibitId}.${ext}`;

  const { error } = await supabase.storage
    .from("exhibits")
    .upload(path, file, { upsert: true });
  if (error) throw error;

  return path;
}

/**
 * Get a temporary signed URL to display a PDF or image.
 * URL expires after 1 hour.
 */
export async function getExhibitFileUrl(filePath) {
  const { data, error } = await supabase.storage
    .from("exhibits")
    .createSignedUrl(filePath, 3600); // 1 hour
  if (error) throw error;
  return data.signedUrl;
}

/**
 * Delete a file from storage.
 */
export async function deleteExhibitFile(filePath) {
  const { error } = await supabase.storage
    .from("exhibits")
    .remove([filePath]);
  if (error) throw error;
}


// ── ANNOTATIONS ──────────────────────────────────────────────
// Annotations are private — RLS ensures users only see their own.

/**
 * Fetch all annotations for an exhibit (current user only).
 */
export async function getAnnotations(exhibitId) {
  const { data, error } = await supabase
    .from("annotations")
    .select("*")
    .eq("exhibit_id", exhibitId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data; // [{ id, type: "stroke"|"note", data: {...} }]
}

/**
 * Save a new annotation (stroke or note).
 * @example await saveAnnotation(exhibitId, "stroke", { pts: [...], color: "#F87171", tool: "pen" })
 * @example await saveAnnotation(exhibitId, "note",   { x: 100, y: 200, text: "Check this", color: "#EAD637" })
 */
export async function saveAnnotation(exhibitId, type, data) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not logged in");

  const { data: row, error } = await supabase
    .from("annotations")
    .insert({ exhibit_id: exhibitId, user_id: user.id, type, data })
    .select()
    .single();
  if (error) throw error;
  return row;
}

/**
 * Delete a single annotation by ID.
 */
export async function deleteAnnotation(annotationId) {
  const { error } = await supabase
    .from("annotations")
    .delete()
    .eq("id", annotationId);
  if (error) throw error;
}

/**
 * Clear all annotations for an exhibit (current user's only).
 */
export async function clearAnnotations(exhibitId) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not logged in");

  const { error } = await supabase
    .from("annotations")
    .delete()
    .eq("exhibit_id", exhibitId)
    .eq("user_id", user.id);
  if (error) throw error;
}


// ── DEPOSITION SESSIONS ──────────────────────────────────────

/**
 * All session broadcast channels are private: RLS on
 * realtime.messages lets hosts send/receive and approved
 * participants receive. Requires the realtime migration.
 */
export function privateChannel(topic) {
  return supabase.channel(topic, { config: { private: true } });
}

// NOTE: The legacy witness_token session flow (startSession,
// pushExhibitToWitnesses, subscribeToSession, endSession,
// getSessionByToken) was removed 2026-07-22. It predated the
// host-only RLS lockdown and would fail for anonymous callers;
// the current app uses startSessionWithPin + the PIN/RPC join flow.


// ── REACT HOOKS ──────────────────────────────────────────────
// Drop-in hooks to replace useState in your components.

import { useState, useEffect } from "react";

/**
 * useAuth — tracks the current user across the app.
 *
 * @example
 *   const { user, loading } = useAuth()
 *   if (loading) return <Spinner />
 *   if (!user) return <LoginPage />
 */
export function useAuth() {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // getSession() reads from local storage — no network call, can't hang
    supabase.auth.getSession().then(({ data }) => {
      setUser(data?.session?.user ?? null);
      setLoading(false);
    });
    const sub = onAuthChange(u => { setUser(u); setLoading(false); });
    return () => sub.unsubscribe();
  }, []);

  return { user, loading };
}

/**
 * useCases — fetches and manages cases for the current user.
 *
 * Replaces: const [cases, setCases] = useState(SEED_CASES)
 *
 * @example
 *   const { cases, addCase, removeCase, loading } = useCases()
 */
export function useCases() {
  const [cases, setCases]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    getCases()
      .then(setCases)
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  async function addCase(fields) {
    const newCase = await createCase(fields);
    setCases(prev => [newCase, ...prev]);
    return newCase;
  }

  async function removeCase(caseId) {
    await deleteCase(caseId);
    setCases(prev => prev.filter(c => c.id !== caseId));
  }

  return { cases, addCase, removeCase, loading, error };
}

/**
 * useExhibits — fetches and manages exhibits for a case.
 *
 * Replaces: exhibits array inside cases state
 *
 * @example
 *   const { exhibits, addExhibit, markExhibit, loading } = useExhibits(caseId)
 */
export function useExhibits(caseId) {
  const [exhibits, setExhibits] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  useEffect(() => {
    if (!caseId) return;
    setLoading(true);
    getExhibits(caseId)
      .then(setExhibits)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [caseId]);

  async function addExhibit(fields, file) {
    // 1. Create the exhibit row
    const exhibit = await createExhibit(caseId, fields);

    // 2. Upload file if provided
    if (file) {
      const path = await uploadExhibitFile(caseId, exhibit.id, file);
      const url  = await getExhibitFileUrl(path);
      const updated = await updateExhibit(exhibit.id, {
        file_path: path,
        file_name: file.name,
        file_size: file.size,
      });
      setExhibits(prev => [...prev, { ...updated, fileUrl: url }]);
      return updated;
    }

    setExhibits(prev => [...prev, exhibit]);
    return exhibit;
  }

  async function markExhibitInRecord(exhibitId) {
    const updated = await markExhibit(exhibitId);
    setExhibits(prev => prev.map(e => e.id === exhibitId ? { ...e, marked: true } : e));
    return updated;
  }

  async function attachFile(exhibitId, file) {
    const path = await uploadExhibitFile(caseId, exhibitId, file);
    const url  = await getExhibitFileUrl(path);
    const updated = await updateExhibit(exhibitId, {
      file_path: path,
      file_name: file.name,
      file_size: file.size,
    });
    setExhibits(prev => prev.map(e => e.id === exhibitId ? { ...e, ...updated, fileUrl: url } : e));
    return { ...updated, fileUrl: url };
  }

  async function removeExhibit(exhibitId) {
    const exhibit = exhibits.find(e => e.id === exhibitId);
    await deleteExhibit(exhibitId, exhibit?.file_path);
    setExhibits(prev => prev.filter(e => e.id !== exhibitId));
  }

  return { exhibits, addExhibit, markExhibitInRecord, attachFile, removeExhibit, loading, error };
}

// ============================================================
// DepoDesk v2 — Session Functions
// Add these to depodesk-supabase.js
// ============================================================

/**
 * Start a deposition session with a PIN.
 * Returns the session including the generated PIN.
 */
export async function startSessionWithPin(caseId, _depositionId) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not logged in");

  // caseId must be a Supabase cases.id UUID (see ensureRemoteCaseId in the
  // app) — the app's local "case-…" ids are not valid here.
  if (caseId) {
    // End any existing active sessions for this case
    await supabase
      .from("sessions")
      .update({ is_active: false, ended_at: new Date().toISOString() })
      .eq("case_id", caseId)
      .eq("is_active", true);
  }

  // Generate a unique PIN via the DB function
  const { data: pinData } = await supabase.rpc("generate_session_pin");
  const pin = pinData;

  const { data, error } = await supabase
  .from("sessions")
  .insert({
    case_id: caseId || null,
    host_id: user.id,
    pin,
    controller_id: user.id,
    controller_role: "host",
  })
  .select()
  .single();
  if (error) throw error;

  await logSessionEvent(data.id, "session_started", { actor_role: "host" });
  return data;
}


/**
 * Insert a session event and broadcast it to the court reporter feed.
 * exhibit_id is a uuid FK — the app's local numeric exhibit ids must
 * not be written there (they fail the insert); pass names/nums instead.
 */
const isUuid = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export async function logSessionEvent(sessionId, eventType, fields = {}) {
  try {
    const row = { session_id: sessionId, event_type: eventType, ...fields };
    if (!isUuid(row.exhibit_id)) row.exhibit_id = null;
    const { data: event, error } = await supabase
      .from("session_events")
      .insert(row)
      .select()
      .single();
    if (error) { console.error("Failed to log session event:", error); return null; }
    await privateChannel(`reporter:${sessionId}`).send({
      type: "broadcast",
      event: "session_event",
      payload: { event },
    });
    return event;
  } catch (err) {
    console.error("Failed to log session event:", err);
    return null;
  }
}

/**
 * All sessions this attorney has hosted (newest first), for the
 * session history / audit trail view.
 */
export async function getSessionHistory() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not logged in");
  const { data, error } = await supabase
    .from("sessions")
    .select("*, cases(name, number)")
    .eq("host_id", user.id)
    .order("started_at", { ascending: false });
  if (error) throw error;
  return data;
}

/**
 * Full audit record for one session: chronological events + roster.
 */
export async function getSessionAudit(sessionId) {
  const [evRes, pRes] = await Promise.all([
    supabase.from("session_events").select("*").eq("session_id", sessionId).order("created_at", { ascending: true }),
    supabase.from("participants").select("*").eq("session_id", sessionId).order("joined_at", { ascending: true }),
  ]);
  if (evRes.error) throw evRes.error;
  if (pRes.error) throw pRes.error;
  return { events: evRes.data || [], participants: pRes.data || [] };
}

/**
 * Transfer exhibit control to opposing counsel.
 */
export async function transferControl(sessionId, toRole) {
  const { data, error } = await supabase
    .from("sessions")
    .update({ controller_role: toRole })
    .eq("id", sessionId)
    .select()
    .single();
  if (error) throw error;

  // Log the event
  await supabase.from("session_events").insert({
    session_id: sessionId,
    event_type: "control_transferred",
    actor_role: toRole,
    notes: toRole === "host" ? "Control returned to counsel" : "Control transferred to opposing counsel",
  });

  // Broadcast to all participants
  await privateChannel(`session:${sessionId}`).send({
    type: "broadcast",
    event: "control_transferred",
    payload: { controller_role: toRole },
  });

  return data;
}

/**
 * Log and broadcast an exhibit being shared.
 */
export async function broadcastExhibit(sessionId, exhibit, actorName) {
  // Broadcast to witness/opposing counsel views
  await privateChannel(`session:${sessionId}`).send({
    type: "broadcast",
    event: "exhibit_push",
    payload: { exhibit },
  });

  // Log the event (also broadcasts to the court reporter feed)
  await logSessionEvent(sessionId, "exhibit_shared", {
    exhibit_id: exhibit.id,
    exhibit_name: exhibit.name,
    exhibit_num: exhibit.exhibitNum || null,
    actor_name: actorName,
    actor_role: "host",
  });
}

/**
 * Log and broadcast an exhibit being marked into the record.
 */
export async function broadcastExhibitMarked(sessionId, exhibit, actorName) {
  const event = await logSessionEvent(sessionId, "exhibit_marked", {
    exhibit_id: exhibit.id,
    exhibit_name: exhibit.name,
    exhibit_num: exhibit.exhibitNum,
    actor_name: actorName,
    actor_role: "host",
  });

  // Broadcast marked exhibit to opposing counsel log
  if (event) {
    await privateChannel(`session:${sessionId}`).send({
      type: "broadcast",
      event: "exhibit_marked",
      payload: { event },
    });
  }
}

/**
 * End a session and notify all participants.
 */
export async function endSessionAndNotify(sessionId) {
  await logSessionEvent(sessionId, "session_ended", { actor_role: "host" });

  // Broadcast end to all views
  await privateChannel(`session:${sessionId}`).send({
    type: "broadcast",
    event: "session_ended",
    payload: {},
  });
  await privateChannel(`reporter:${sessionId}`).send({
    type: "broadcast",
    event: "session_ended",
    payload: {},
  });

  // Mark session as ended
  await supabase
    .from("sessions")
    .update({ is_active: false, ended_at: new Date().toISOString() })
    .eq("id", sessionId);
}