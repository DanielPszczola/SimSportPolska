import { useState } from '../../vendor/preact-htm.js';
import { db } from '../db.js';
import { html, cached, formatDate } from '../ui.js';
import { SignupBox, postOnHome } from './signup.js';

// Ogłoszenia na stronie głównej: posty moderatorów i administratorów (tytuł, zdjęcie, treść).
// Przypięte na początku, potem od najnowszych. Bez ogłoszeń blok się nie wyświetla.
// Ogłoszenie z formularzem zgłoszeń jest na stronie głównej do końca zapisów (signup.js).

// tabela dochodzi w aktualizacji bazy — bez niej strona działa dalej (brak ogłoszeń)
export const loadPosts = () => cached('posts', () => db.list('posts', { order: ['created_at', false] }).catch(() => []));

export const sortPosts = (posts) => [...posts].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;

/** Treść jako zwykły tekst; adresy http(s) stają się linkami. */
export function PostBody({ text }) {
  const parts = String(text || '').split(URL_RE);
  return html`<div class="post-body">${parts.map((p, i) => (i % 2 ? html`<a href=${p} target="_blank" rel="noopener">${p}</a>` : p))}</div>`;
}

const SHOWN = 3;

export function Announcements({ posts }) {
  const [all, setAll] = useState(false);
  const list = sortPosts((posts || []).filter((p) => postOnHome(p)));
  if (!list.length) return null;
  return html`<section class="announcements">
    <div class="page-head"><h2>Ogłoszenia</h2></div>
    <div class="post-grid">${(all ? list : list.slice(0, SHOWN)).map((p) => html`<${PostCard} key=${p.id} post=${p} />`)}</div>
    ${list.length > SHOWN ? html`<button class="btn btn-sm post-more" onClick=${() => setAll(!all)}>${all ? 'Pokaż mniej' : `Pokaż wszystkie (${list.length})`}</button>` : null}
  </section>`;
}

function PostCard({ post }) {
  const [open, setOpen] = useState(false);
  const long = (post.body || '').length > 280;
  return html`<article class=${`post-card ${post.pinned ? 'pinned' : ''}`}>
    ${post.image_url ? html`<div class="post-img"><img src=${post.image_url} alt="" loading="lazy" /></div>` : null}
    <div class="post-main">
      <div class="post-meta muted">${post.pinned ? html`<span class="badge badge-next">📌 Przypięte</span>` : null}
        ${formatDate(post.created_at, false)}${post.author ? ` · ${post.author}` : ''}</div>
      <h3>${post.title}</h3>
      <div class=${long && !open ? 'post-clamp' : ''}><${PostBody} text=${post.body} /></div>
      ${long ? html`<button class="link" onClick=${() => setOpen(!open)}>${open ? 'Zwiń' : 'Czytaj dalej'}</button>` : null}
      ${post.form_kind ? html`<${SignupBox} post=${post} />` : null}
    </div>
  </article>`;
}
