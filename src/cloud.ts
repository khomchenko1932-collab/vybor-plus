import AsyncStorage from "@react-native-async-storage/async-storage";
import type { HistoryItem } from "./api";

export type CloudUser = { id: string; email?: string };
export type CloudSession = { access_token: string; refresh_token: string; expires_in?: number; user: CloudUser };

const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SESSION_KEY = "@vybor-plus/cloud-session";
export const cloudConfigured = Boolean(url && anonKey);

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  if (!url || !anonKey) throw new Error("Supabase ещё не настроен");
  const response = await fetch(url + path, { ...init, headers: { apikey: anonKey, Authorization: `Bearer ${token || anonKey}`, "Content-Type": "application/json", ...init.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.msg || body.message || body.error_description || "Ошибка облачного сервиса");
  return body as T;
}

async function saveSession(session: CloudSession | null) {
  if (session) await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else await AsyncStorage.removeItem(SESSION_KEY);
}

export async function signIn(email: string, password: string) {
  const session = await request<CloudSession>("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) });
  await saveSession(session); return session;
}

export async function signUp(email: string, password: string) {
  const response = await request<CloudSession & { access_token?: string }>("/auth/v1/signup", { method: "POST", body: JSON.stringify({ email, password }) });
  if (response.access_token) await saveSession(response as CloudSession);
  return response.access_token ? (response as CloudSession) : null;
}

export async function restoreSession() {
  if (!cloudConfigured) return null;
  const raw = await AsyncStorage.getItem(SESSION_KEY); if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as CloudSession;
    const refreshed = await request<CloudSession>("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: saved.refresh_token }) });
    await saveSession(refreshed); return refreshed;
  } catch { await saveSession(null); return null; }
}

export async function signOut(session: CloudSession) {
  await request("/auth/v1/logout", { method: "POST" }, session.access_token).catch(() => undefined); await saveSession(null);
}

export async function mergeCloudHistory(session: CloudSession, local: HistoryItem[]) {
  const rows = await request<Array<{ payload: HistoryItem }>>("/rest/v1/choice_history?select=payload&order=updated_at.desc", {}, session.access_token);
  const merged = Array.from(new Map([...local, ...rows.map(row => row.payload)].map(item => [item.id, item])).values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
  await replaceCloudHistory(session, merged); return merged;
}

export async function replaceCloudHistory(session: CloudSession, history: HistoryItem[]) {
  await request(`/rest/v1/choice_history?user_id=eq.${encodeURIComponent(session.user.id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }, session.access_token);
  if (!history.length) return;
  await request("/rest/v1/choice_history", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(history.map(item => ({ user_id: session.user.id, item_id: item.id, payload: item, updated_at: new Date().toISOString() }))) }, session.access_token);
}
