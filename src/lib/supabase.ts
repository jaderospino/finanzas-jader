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
    // si no existe "settings", no falla: usamos una función ligera
    const { data, error } = await supabase.rpc("now"); // requiere la RPC built-in
    return error ?? null;
  } catch (e: any) {
    // fallback: intenta leer 1 fila de settings si existe
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
    options: { emailRedirectTo: window.location.href },
  });
  if (error) throw error;
}
export async function signOut() {
  await supabase.auth.signOut();
}

/* =============================== SETTINGS ============================== */
/** Guardamos etiquetas (tags) y presupuesto (budget) en una sola tabla "settings" */

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
/** Tabla principal: movements */

export type TxRow = {
  id: string;
  user_id: string;
  type: "Ingreso" | "Gasto" | "Transferencia";
  account: string;
  to_account: string | null;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm:ss
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

export async function addTx(row: Omit<TxRow, "user_id">) {
  const user = await getUser();
  if (!user) throw new Error("No hay sesión. Inicia sesión primero.");
  const payload = { ...row, user_id: user.id, to_account: row.to_account ?? null, note: row.note ?? null };
  const { error } = await supabase.from("movements").insert(payload);
  if (error) throw error;
}

export async function addTransfer({
  fromAccount,
  toAccount,
  date,
  time,
  amount,
  note,
}: {
  fromAccount: string;
  toAccount: string;
  date: string;
  time: string;
  amount: number; // positivo
  note?: string | null;
}) {
  const user = await getUser();
  if (!user) throw new Error("No hay sesión. Inicia sesión primero.");
  const rows: Omit<TxRow, "user_id">[] = [
    {
      id: crypto.randomUUID(),
      type: "Transferencia",
      account: fromAccount,
      to_account: toAccount,
      date,
      time,
      amount: -Math.abs(amount),
      category: "Ingresos",
      subcategory: "Entre cuentas",
      note: note ?? null,
    },
    {
      id: crypto.randomUUID(),
      type: "Transferencia",
      account: toAccount,
      to_account: fromAccount,
      date,
      time,
      amount: Math.abs(amount),
      category: "Ingresos",
      subcategory: "Entre cuentas",
      note: note ?? null,
    },
  ];
  const payload = rows.map((r) => ({ ...r, user_id: user.id }));
  const { error } = await supabase.from("movements").insert(payload);
  if (error) throw error;
}

export async function upsertTxBulk(rows: Omit<TxRow, "user_id">[]) {
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

/* ============================== Realtime (opcional) ============================== */

export function subscribeMovements(userId: string, onChange: (evt: "INSERT" | "UPDATE" | "DELETE", row: Partial<TxRow>) => void) {
  const channel = supabase
    .channel("movements-realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "movements", filter: `user_id=eq.${userId}` },
      (payload) => {
        const evt = payload.eventType as "INSERT" | "UPDATE" | "DELETE";
        const row = (evt === "DELETE" ? payload.old : payload.new) as Partial<TxRow>;
        onChange(evt, row);
      }
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}
