// Warstwa danych. Jedno API dla dwóch backendów:
//  - Supabase (produkcja) — gdy w config.js ustawiono URL i klucz,
//  - localStorage (tryb demo) — gdy konfiguracja jest pusta.
//
// list(table, { eq: {col: val}, in: {col: [vals]}, order: ['col', asc?] })
// insert(table, row | rows) -> wstawione wiersze
// update(table, id, patch)  -> zaktualizowany wiersz
// remove(table, id), removeWhere(table, eq)
// uploadImage(blob, folder) -> publiczny URL obrazka
import { SUPABASE_URL, SUPABASE_ANON_KEY, loginToEmail } from './config.js';
import { createLocalDb } from './db-local.js';

const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm';
const IMAGE_BUCKET = 'images'; // Supabase Storage, tworzony w supabase/schema.sql

async function createSupabaseDb() {
  const { createClient } = await import(SUPABASE_ESM);
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const check = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };

  return {
    mode: 'supabase',
    async list(table, { eq = {}, in: inn = {}, order } = {}) {
      let q = sb.from(table).select('*');
      for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
      for (const [k, arr] of Object.entries(inn)) {
        if (!arr.length) return [];
        q = q.in(k, arr);
      }
      if (order) q = q.order(order[0], { ascending: order[1] !== false });
      return check(await q);
    },
    async insert(table, rows) {
      const many = Array.isArray(rows);
      if (many && !rows.length) return [];
      const data = check(await sb.from(table).insert(rows).select());
      return many ? data : data[0];
    },
    async update(table, id, patch) {
      return check(await sb.from(table).update(patch).eq('id', id).select().single());
    },
    async remove(table, id) {
      check(await sb.from(table).delete().eq('id', id));
    },
    async removeWhere(table, eq) {
      let q = sb.from(table).delete();
      for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
      check(await q);
    },
    async uploadImage(blob, folder) {
      const ext = blob.type === 'image/png' ? 'png' : 'webp';
      const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await sb.storage.from(IMAGE_BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: '31536000' });
      if (error) throw new Error(`Nie udało się wgrać pliku: ${error.message}`);
      return sb.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
    },
    auth: {
      async user() {
        const { data } = await sb.auth.getSession();
        return data.session?.user ?? null;
      },
      async signIn(login, password) {
        const { error } = await sb.auth.signInWithPassword({ email: loginToEmail(login), password });
        if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Nieprawidłowy login lub hasło' : error.message);
      },
      async signOut() {
        await sb.auth.signOut();
      },
      async isAdmin() {
        const { data, error } = await sb.rpc('is_admin');
        return !error && data === true;
      },
    },
  };
}

export const db = SUPABASE_URL && SUPABASE_ANON_KEY ? await createSupabaseDb() : createLocalDb();
