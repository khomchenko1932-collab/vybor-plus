import { Platform } from "react-native";

export type Question = { id: string; label: string; placeholder: string; required: boolean };
export type ChoiceCategory = "product" | "gift" | "place" | "service" | "decision";
export type ChoiceSource = { id: string; name: string; url: string; mode: "search" | "live"; price?: number | null; available?: boolean | null };
export type ChoiceCard = { title: string; description: string; reasons: string[]; searchQuery?: string; sources?: ChoiceSource[] };
export type ChoiceResult = { best: ChoiceCard; budget: ChoiceCard; premium: ChoiceCard; avoid: ChoiceCard; finalAdvice: string; confidence?: number; freshnessNote?: string; updatedAt?: string; sourceStatus?: "search-only" | "live"; sourcesCheckedAt?: string; demo?: boolean };
export type HistoryItem = { id: string; createdAt: string; query: string; currency: string; result: ChoiceResult; favorite?: boolean };

const baseUrl = process.env.EXPO_PUBLIC_API_URL || (Platform.OS === "web" ? "http://localhost:8787" : "http://10.0.2.2:8787");

async function post<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(baseUrl + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Сервис временно недоступен");
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("AI отвечает слишком долго. Попробуйте ещё раз.");
    throw error;
  } finally { clearTimeout(timeout); }
}
export const getQuestions = (query: string, currency: string) => post<{ questions: Question[]; category?: ChoiceCategory }>("/api/questions", { query, currency });
export const getRecommendation = (query: string, currency: string, answers: Record<string,string>) => post<ChoiceResult>("/api/recommendations", { query, currency, answers });
