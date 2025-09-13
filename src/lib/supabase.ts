// ./lib/supabase.ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL!;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY!;
export const supabase: SupabaseClient = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export async function checkSupabase() {
  try {
    const { data, error } = await supabase.from("settings").select("updated_at").limit(1);
    return error ?? null;
  } catch (e:any) { return e; }
}

/* --------------------------- AUTH (Magic Link) --------------------------- */
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}
export async function getUser() {
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}
export async function signInWithEmail(email: string) {
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } });
  if (error) throw error;
}
export async function signOut() {
  await supabase.auth.signOut();
}

/* ------------------------- SETTINGS (tags + budget) ---------------------- */
export async function loadSettings() {
  const user = await getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("settings")
    .select("tags, budget")
    .eq("user_id", user.id)
    .single();
  if (error && error.code !== "PGRST116") throw error; // no rows
  return data ?? null;
}

export async function saveSettings(payload: { tags: any; budget: any }) {
  const user = await getUser();
  if (!user) throw new Error("No hay sesión. Inicia sesión primero.");
  const { error } = await supabase.from("settings").upsert({
    user_id: user.id,
    tags: payload.tags,
    budget: payload.budget,
  });
  if (error) throw error;
}

/* ------------------------------ TRANSACCIONES --------------------------- */
import type { Database } from "./types"; // opcional si usas types

export type TxRow = {
  id: string;
  type: "Ingreso"|"Gasto"|"Transferencia";
  account: string;
  to_account?: string | null;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm:ss
  amount: number;
  category: string;
  subcategory: string;
  note?: string | null;
};

export async function pullTx(): Promise<TxRow[]> {
  const user = await getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("user_id", user.id)
    .order("date", { ascending: false })
    .order("time", { ascending: false });
  if (error) throw error;
  return data as any;
}

export async function pushTxBulk(rows: TxRow[]) {
  const user = await getUser();
  if (!user) throw new Error("No hay sesión. Inicia sesión primero.");
  if (!rows.length) return;
  const payload = rows.map((r) => ({
    id: r.id,
    user_id: user.id,
    type: r.type,
    account: r.account,
    to_account: r.to_account ?? null,
    date: r.date,
    time: r.time,
    amount: r.amount,
    category: r.category,
    subcategory: r.subcategory,
    note: r.note ?? null,
  }));
  const { error } = await supabase.from("transactions").upsert(payload, { onConflict: "id" });
  if (error) throw error;
}

export async function deleteTx(ids: string[]) {
  const user = await getUser();
  if (!user || !ids.length) return;
  const { error } = await supabase.from("transactions").delete().in("id", ids).eq("user_id", user.id);
  if (error) throw error;
}
