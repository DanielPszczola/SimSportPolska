import { useState } from '../../vendor/preact-htm.js';
import { db } from '../db.js';
import { html, useAsync, attempt, formatDate } from '../ui.js';
import { useSession, isDiscordUser } from '../session.js';
import { DiscordButton } from './account.js';
import { PrivacyNote } from './privacy.js';
import { timeLeft } from './signup.js';

// Głosowanie (ankieta) w ogłoszeniu: pytanie do społeczności z kilkoma odpowiedziami (posts.form_kind = 'poll').
// Głosują osoby zalogowane przez Discord — jeden głos na konto, do końca można go zmienić. Wyniki widać po oddaniu
// głosu i po zakończeniu głosowania (moderator — zawsze). Zasad pilnuje baza (poll_state / poll_vote).

const plural = (n) => (n === 1 ? 'osoba' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'osoby' : 'osób');

export function PollBox({ post }) {
  const s = useSession();
  const discord = isDiscordUser(s.user);
  const state = useAsync(() => db.rpc('poll_state', { p_post: post.id }), [post.id, s.user?.id]);
  const [poll, setPoll] = useState(null); // stan po oddaniu głosu (bez ponownego pobierania)
  const [pick, setPick] = useState(null);
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const options = post.form_fields || [];
  const st = poll || state.data;

  if (state.error && !poll) return html`<div class="poll-box"><p class="muted small">Głosowanie jest niedostępne: ${state.error.message}</p></div>`;
  if (!st) return html`<div class="poll-box"><p class="muted small">Ładowanie głosowania…</p></div>`;

  const chosen = pick ?? st.my ?? [];
  const toggle = (id) => setPick(post.poll_multi ? (chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]) : [id]);
  const vote = async (e) => {
    e.preventDefault();
    if (!chosen.length) return;
    setBusy(true);
    const res = await attempt(() => db.rpc('poll_vote', { p_post: post.id, p_options: chosen }), st.my?.length ? 'Głos zmieniony' : 'Dziękujemy za głos!');
    setBusy(false);
    if (res) {
      setPoll(res);
      setPick(null);
      setChanging(false);
    }
  };

  const voted = (st.my || []).length > 0;
  let body;
  if (st.open && discord && (!voted || changing)) {
    body = html`<form class="poll-form" onSubmit=${vote}>
      ${options.map((o) => html`<label class=${`poll-option ${chosen.includes(o.id) ? 'active' : ''}`}>
        <input type=${post.poll_multi ? 'checkbox' : 'radio'} name=${`poll-${post.id}`} checked=${chosen.includes(o.id)} onChange=${() => toggle(o.id)} /> ${o.label}
      </label>`)}
      <div class="poll-actions">
        <button class="btn btn-accent btn-sm" disabled=${busy || !chosen.length}>${busy ? 'Zapisywanie…' : voted ? 'Zapisz zmianę' : 'Głosuj'}</button>
        ${changing ? html`<button type="button" class="btn btn-sm" onClick=${() => { setChanging(false); setPick(null); }}>Anuluj</button>` : null}
        ${post.poll_multi ? html`<span class="muted small">Możesz zaznaczyć kilka odpowiedzi.</span>` : null}
      </div>
    </form>`;
  } else if (st.results) {
    body = html`<${PollResults} options=${options} results=${st.results} my=${st.my || []} />
      ${st.open && discord ? html`<div class="poll-actions"><button type="button" class="btn btn-sm" onClick=${() => setChanging(true)}>Zmień głos</button></div>` : null}`;
  } else {
    // głosowanie trwa, a ta osoba nie może (jeszcze) głosować — pokazujemy odpowiedzi bez wyników
    body = html`<ul class="poll-preview">${options.map((o) => html`<li>${o.label}</li>`)}</ul>
      <div class="poll-actions">${!s.ready ? null : !s.user
        ? html`<${DiscordButton} label="Zaloguj przez Discord, aby zagłosować" /><${PrivacyNote} />`
        : html`<span class="muted small">Głosować można kontem Discord — zaloguj się przez Discord.</span>`}</div>`;
  }

  return html`<div class=${`poll-box ${st.open ? '' : 'closed'}`}>
    <div class="signup-meta">
      <b>📊 Głosowanie${st.open ? '' : ' zakończone'}</b>
      <span class="muted small">${st.open && post.form_until ? `do ${formatDate(post.form_until)} · ${timeLeft(post.form_until)}` : post.form_until ? `zakończone ${formatDate(post.form_until)}` : ''}
        ${st.results ? ` · zagłosowało ${st.results.voters} ${plural(st.results.voters)}` : ''}</span>
    </div>
    ${body}
  </div>`;
}

/** Wyniki: paski z procentem głosujących, zaznaczony mój wybór, prowadząca odpowiedź wyróżniona. */
export function PollResults({ options, results, my = [] }) {
  const votes = results.votes || {};
  const voters = results.voters || 0;
  const max = Math.max(0, ...options.map((o) => votes[o.id] || 0));
  return html`<ol class="poll-results">
    ${options.map((o) => {
      const n = votes[o.id] || 0;
      const pct = voters ? Math.round((n / voters) * 100) : 0;
      return html`<li class=${`${my.includes(o.id) ? 'mine' : ''} ${n && n === max ? 'lead' : ''}`}>
        <span class="poll-bar" style=${{ width: `${pct}%` }}></span>
        <span class="poll-label">${my.includes(o.id) ? '✓ ' : ''}${o.label}</span>
        <span class="poll-pct"><b>${pct}%</b> <span class="muted">(${n})</span></span>
      </li>`;
    })}
  </ol>`;
}
