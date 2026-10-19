// Backend demo: cała "baza" w localStorage tej przeglądarki.
import { buildDemoData } from './demo-data.js';

const KEY = 'ssp_demo_db_v10'; // zmiana wersji = nowe dane demo
const AUTH_KEY = 'ssp_demo_auth';

const storage = {
  get(k) {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k, v) {
    try { localStorage.setItem(k, v); } catch { /* tryb prywatny itp. — dane tylko w pamięci */ }
  },
  del(k) {
    try { localStorage.removeItem(k); } catch { /* j.w. */ }
  },
};

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

export function createLocalDb() {
  let data;
  try { data = JSON.parse(storage.get(KEY)); } catch { data = null; }
  if (!data) {
    data = buildDemoData(uid);
    storage.set(KEY, JSON.stringify(data));
  }
  const save = () => storage.set(KEY, JSON.stringify(data));
  const tbl = (t) => (data[t] ||= []);
  const matches = (row, eq) => Object.entries(eq).every(([k, v]) => row[k] === v);
  const clone = (x) => JSON.parse(JSON.stringify(x));

  return {
    mode: 'demo',
    async list(table, { eq = {}, in: inn = {}, order } = {}) {
      let rows = tbl(table).filter((r) => matches(r, eq) && Object.entries(inn).every(([k, arr]) => arr.includes(r[k])));
      if (order) {
        const [col, asc = true] = order;
        rows = [...rows].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1));
      }
      return clone(rows);
    },
    async insert(table, rows) {
      const many = Array.isArray(rows);
      const now = new Date().toISOString();
      const added = (many ? rows : [rows]).map((r) => ({ id: uid(), created_at: now, ...r }));
      tbl(table).push(...added);
      save();
      return clone(many ? added : added[0]);
    },
    async update(table, id, patch) {
      const row = tbl(table).find((r) => r.id === id);
      if (!row) throw new Error('Nie znaleziono rekordu');
      Object.assign(row, patch);
      save();
      return clone(row);
    },
    async remove(table, id) {
      data[table] = tbl(table).filter((r) => r.id !== id);
      save();
    },
    async removeWhere(table, eq) {
      data[table] = tbl(table).filter((r) => !matches(r, eq));
      save();
    },
    // tryb demo: obrazek zapisywany jako data URL w localStorage (limit przeglądarki ok. 5 MB łącznie)
    async uploadImage(blob) {
      if (blob.size > 400 * 1024) throw new Error('W trybie demo obrazek może mieć maks. 400 KB po zmniejszeniu');
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(new Error('Nie udało się odczytać pliku'));
        r.readAsDataURL(blob);
      });
    },
    reset() {
      storage.del(KEY);
      storage.del(AUTH_KEY);
      location.reload();
    },
    auth: {
      async user() {
        const email = storage.get(AUTH_KEY);
        return email ? { email } : null;
      },
      async signIn(email, password) {
        if (password !== 'admin') throw new Error('W trybie demo hasło to: admin');
        storage.set(AUTH_KEY, email || 'admin@demo');
      },
      async signOut() {
        storage.del(AUTH_KEY);
      },
      async isAdmin() {
        return !!storage.get(AUTH_KEY);
      },
    },
  };
}
