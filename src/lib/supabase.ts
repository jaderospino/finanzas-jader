// src/lib/supabase.ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";

/* ============================ Inicialización ============================ */

const url = import.meta.env.VITE_SUPABASE_URL!;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY!;
export const supabase: SupabaseClient = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Ping rápido para comprobar conexión (opcional) */
export async function checkSupabase() {
  try {
    const { error } = await supabase.rpc("now");
    return error ?? null;
  } catch (e: any) {
    try {
      const { error } = await supabase.from("settings").select("updated_at").limit(1);
      return error ?? null;
    } catch (ee: any) {
      return ee;
    }
  }
}

/* ================================ AUTH ================================ */

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}
export async function getUser() {
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}
export async function signInWithEmail(email: string) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
}
export async function signOut() {
  await supabase.auth.signOut();
}

/* =============================== SETTINGS ============================== */

export type SettingsRow = {
  user_id: string;
  tags: Record<string, string[]>;
  budget: { basicos: number; deseos: number; ahorro: number };
  updated_at?: string | null;
};

export async function loadSettings(): Promise<SettingsRow | null> {
  const user = await getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("settings")
    .select("user_id, tags, budget, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  return (data as SettingsRow) ?? null;
}

export async function saveSettings(payload: {
  tags: Record<string, string[]>;
  budget: { basicos: number; deseos: number; ahorro: number };
}) {
  const user = await getUser();
  if (!user) throw new Error("No hay sesión. Inicia sesión primero.");
  const { error } = await supabase.from("settings").upsert(
    {
      user_id: user.id,
      tags: payload.tags,
      budget: payload.budget,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) throw error;
}

/* ============================== MOVIMIENTOS ============================== */

export type TxRow = {
  id: string;
  user_id: string;
  type: "Ingreso" | "Gasto" | "Transferencia";
  account: string;
  to_account: string | null;
  date: string;
  time: string;
  amount: number;
  category: string;
  subcategory: string;
  note: string | null;
  created_at?: string | null;
};

export async function pullTx(): Promise<TxRow[]> {
  const user = await getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("movements")
    .select("*")
    .eq("user_id", user.id)
    .order("date", { ascending: false })
    .order("time", { ascending: false });
  if (error) throw error;
  return (data as TxRow[]) ?? [];
}

export async function upsertTxBulk(rows: Omit<TxRow, "user_id" | "created_at">[]) {
  const user = await getUser();
  if (!user) throw new Error("No hay sesión. Inicia sesión primero.");
  if (!rows.length) return;
  const payload = rows.map((r) => ({
    ...r,
    user_id: user.id,
    to_account: r.to_account ?? null,
    note: r.note ?? null,
  }));
  const { error } = await supabase.from("movements").upsert(payload, { onConflict: "id" });
  if (error) throw error;
}

export async function deleteTx(ids: string[]) {
  const user = await getUser();
  if (!user || !ids.length) return;
  const { error } = await supabase.from("movements").delete().in("id", ids).eq("user_id", user.id);
  if (error) throw error;
}

/* ================================ GOALS ================================ */

export type GoalRow = {
    id: string;
    user_id: string;
    name: string;
    target_amount: number;
    current_amount: number;
    target_date: string | null;
    created_at?: string | null;
};

export async function loadGoals(): Promise<GoalRow[]> {
    const user = await getUser();
    if (!user) return [];
    const { data, error } = await supabase
        .from("goals")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
}

export async function saveGoal(goal: Omit<GoalRow, "user_id" | "created_at">) {
    const user = await getUser();
    if (!user) throw new Error("No hay sesión. Inicia sesión primero.");
    const payload = { ...goal, user_id: user.id };
    const { error } = await supabase.from("goals").upsert(payload, { onConflict: "id" });
    if (error) throw error;
}

export async function deleteGoal(id: string) {
    const user = await getUser();
    if (!user) return;
    const { error } = await supabase.from("goals").delete().eq("id", id).eq("user_id", user.id);
    if (error) throw error;
}

export async function addContributionToGoal(id: string, newContribution: number) {
    const user = await getUser();
    if (!user) throw new Error("No hay sesión. Inicia sesión primero.");

    const { data: currentGoal, error: fetchError } = await supabase
        .from("goals")
        .select("current_amount")
        .eq("id", id)
        .eq("user_id", user.id)
        .single();

    if (fetchError) throw fetchError;
    if (!currentGoal) throw new Error("Objetivo no encontrado.");

    const newTotal = currentGoal.current_amount + newContribution;

    const { error: updateError } = await supabase
        .from("goals")
        .update({ current_amount: newTotal })
        .eq("id", id);
        
    if (updateError) throw updateError;
}