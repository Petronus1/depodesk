// ============================================================
// DepoDesk — Supabase Client Layer
// ============================================================
// SETUP:
//   1. npm install @supabase/supabase-js
//   2. Replace SUPABASE_URL and SUPABASE_ANON_KEY below
//      (find these in Supabase Dashboard → Settings → API)
//   3. Import functions from this file into your React app
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
 * Start a new deposition session for a case.
 * Returns the session including witness_token (used in the witness URL).
 */
export async function startSession(caseId) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not logged in");

  // End any existing active sessions for this case first
  await supabase
    .from("sessions")
    .update({ is_active: false, ended_at: new Date().toISOString() })
    .eq("case_id", caseId)
    .eq("is_active", true);

  const { data, error } = await supabase
    .from("sessions")
    .insert({ case_id: caseId, host_id: user.id })
    .select()
    .single();
  if (error) throw error;
  return data;
  // data.witness_token → append to witness URL: /witness?token=data.witness_token
}

/**
 * Push an exhibit to all witnesses in a session.
 * Uses Supabase Realtime (replaces BroadcastChannel).
 */
export async function pushExhibitToWitnesses(sessionId, exhibit) {
  const channel = supabase.channel(`session:${sessionId}`);
  await channel.send({
    type: "broadcast",
    event: "exhibit_push",
    payload: { exhibit },
  });
}

/**
 * Subscribe to exhibit pushes as a witness.
 * Call this on the Witness View page.
 *
 * @example
 *   const unsub = subscribeToSession(token, (exhibit) => setShownExhibit(exhibit))
 *   // call unsub() on component unmount
 */
export function subscribeToSession(sessionId, onExhibit) {
  const channel = supabase
    .channel(`session:${sessionId}`)
    .on("broadcast", { event: "exhibit_push" }, ({ payload }) => {
      onExhibit(payload.exhibit);
    })
    .subscribe();

  return () => supabase.removeChannel(channel);
}

/**
 * End a deposition session.
 */
export async function endSession(sessionId) {
  const { error } = await supabase
    .from("sessions")
    .update({ is_active: false, ended_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) throw error;
}

/**
 * Look up a session by witness token (no auth required).
 * Used by the Witness View to find which session to subscribe to.
 */
export async function getSessionByToken(token) {
  const { data, error } = await supabase
    .from("sessions")
    .select("*, cases(name, number)")
    .eq("witness_token", token)
    .eq("is_active", true)
    .single();
  if (error) throw error;
  return data;
}


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
    getCurrentUser().then(u => { setUser(u); setLoading(false); });
    const sub = onAuthChange(u => setUser(u));
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
