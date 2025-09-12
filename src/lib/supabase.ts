// src/lib/supabase.ts
import { createClient, type PostgrestError } from "@supabase/supabase-js";

/* ======================== Inicialización del cliente ======================== */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    "[supabase] Faltan variables de entorno VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY"
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* =============================== Tipos de DB =============================== */

export type TxType = "Ingreso" | "Gasto" | "Transferencia";
export type Account =
  | "Banco Davivienda"
  | "Banco de Bogotá"
  | "Nequi"
  | "Rappi"
  | "Efectivo"
  | "TC Rappi";

export type MovementRow = {
  id: string; // uuid
  user_id?: string | null;
  type: TxType;
  account: Account;
  to_account?: Account | "" | null;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm:ss
  amount: number; // COP
  category: string;
  subcategory: string;
  note?: string | null;
};

export type UserSettings = {
  user_id?: string;
  tags: Record<string, string[]>;
  budget: { basicos: number; deseos: number; ahorro: number };
};

/* =============================== Conexión ping ============================== */
/**
 * Intenta tocar una tabla real con HEAD/limit 0 para verificar credenciales y conectividad
 * sin traer datos. Devuelve `null` si está OK, o el error si algo falla.
 */
export async function checkSupabase(): Promise<PostgrestError | null> {
  // user_settings tiene RLS; si no hay fila para el usuario autenticado
  // .maybeSingle() devolverá null sin lanzar error PGRST116.
  const { error } = await supabase
    .from("user_settings")
    .select("user_id", { head: true, count: "exact" })
    .limit(0);
  return error ?? null;
}

/* ============================ Movements helpers ============================ */
/**
 * UPSERT de movimientos. Si `id` existe -> update, si no -> insert.
 * Requiere políticas RLS: movements_ins_own / movements_upd_own.
 */
export async function upsertMovements(
  rows: MovementRow[]
): Promise<MovementRow[]> {
  // Sanitiza: aseguramos nulls en campos opcionales para evitar problemas de tipos
  const payload = rows.map((r) => ({
    ...r,
    to_account: r.to_account ?? null,
    note: r.note ?? null,
  }));

  const { data, error } = await supabase
    .from("movements")
    .upsert(payload, { onConflict: "id" })
    .select("*");

  if (error) throw error;
  return (data || []) as MovementRow[];
}

/**
 * Elimina movimientos por ids (del usuario actual).
 */
export async function deleteMovements(ids: string[]): Promise<void> {
  const { error } = await supabase.from("movements").delete().in("id", ids);
  if (error) throw error;
}

/* ============================== User Settings ============================== */
/**
 * Carga settings (tags + budget) del usuario.
 * Si no existe el registro, lo crea vacío y devuelve defaults.
 *
 * RLS: settings_select_own (select) y settings_upsert_own (insert/update).
 */
export async function loadSettings(): Promise<UserSettings> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("*")
    .maybeSingle(); // no lanza PGRST116 si no hay filas

  // Si hubo error distinto a "no rows", propagarlo
  if (error && error.code !== "PGRST116") throw error;

  if (!data) {
    // Crea registro vacío para el usuario actual
    const { data: inserted, error: err2 } = await supabase
      .from("user_settings")
      .insert([{ tags: {}, budget: { basicos: 0, deseos: 0, ahorro: 0 } }])
      .select("*")
      .single();

    if (err2) throw err2;

    return {
      user_id: inserted.user_id,
      tags: inserted.tags || {},
      budget: inserted.budget || { basicos: 0, deseos: 0, ahorro: 0 },
    } as UserSettings;
  }

  // Retorna lo existente normalizado
  return {
    user_id: data.user_id,
    tags: data.tags || {},
    budget: data.budget || { basicos: 0, deseos: 0, ahorro: 0 },
  } as UserSettings;
}

/**
 * Guarda settings (tags + budget) del usuario actual.
 */
export async function saveSettings(settings: UserSettings): Promise<void> {
  const { error } = await supabase.from("user_settings").upsert([
    {
      tags: settings.tags ?? {},
      budget: settings.budget ?? { basicos: 0, deseos: 0, ahorro: 0 },
    },
  ]);
  if (error) throw error;
}

/* ============================== Utilidad común ============================= */
/**
 * Pequeño helper para envolver llamadas con manejo de error sencillo.
 * Útil si quieres capturar PostgrestError y convertir a mensajes UI.
 */
export async function safeCall<T>(fn: () => Promise<T>): Promise<{
  ok: true; data: T;
} | { ok: false; error: PostgrestError }> {
  try {
    const data = await fn();
    // @ts-expect-error narrow
    if (data?.error) return { ok: false, error: data.error };
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: e as PostgrestError };
  }
}
