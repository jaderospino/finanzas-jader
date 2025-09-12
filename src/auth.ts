import { supabase } from './lib/supabase';

export const signUp = (email: string, password: string) =>
  supabase.auth.signUp({ email, password });

export const signIn = (email: string, password: string) =>
  supabase.auth.signInWithPassword({ email, password });

export const signOut = () => supabase.auth.signOut();

export const getSession = async () => (await supabase.auth.getSession()).data.session;

export const onAuthChange = (cb: (session: any) => void) =>
  supabase.auth.onAuthStateChange((_e, session) => cb(session));
