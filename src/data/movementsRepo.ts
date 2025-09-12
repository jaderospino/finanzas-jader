import { supabase } from '../lib/supabase';

export type MovementType = 'income' | 'expense' | 'transfer';
export type Movement = {
  id?: string;
  date: string;          // 'YYYY-MM-DD'
  amount: number;
  type: MovementType;
  note?: string | null;
};

export async function listMovements() {
  const { data, error } = await supabase
    .from('movements')
    .select('*')
    .order('date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addMovement(m: Movement) {
  // user_id se autocompleta por trigger (set_auth_user_id)
  const { data, error } = await supabase
    .from('movements')
    .insert(m)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateMovement(id: string, patch: Partial<Movement>) {
  const { data, error } = await supabase
    .from('movements')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteMovement(id: string) {
  const { error } = await supabase
    .from('movements')
    .delete()
    .eq('id', id);
  if (error) throw error;
}
