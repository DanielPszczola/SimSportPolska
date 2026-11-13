import { useState, useMemo, useEffect } from '../../vendor/preact-htm.js';
import { db } from '../db.js';
import { html, seasonUnit, sessionLabel, Flag, TeamTag, PosBadge, attempt, formatDate, raceTimeState, DEFAULT_RACE_MINUTES, formatMinutes, STREAMS } from '../ui.js';
import {
  computeRaceByClass, computeStandings, parseTime, formatDuration, penaltyLabel, carClass,
  STATUSES, PENALTY_TYPES, CAR_CLASSES, seasonClasses, seasonStyle, seasonHasPoints, seasonCarType, isSprint, SPRINT_POINTS, licenseTable, licenseLabel,
} from '../scoring.js';
import { lineupAt, teamSeats, startingSeats } from '../lineup.js';
import { StepBar, NextStep, DurationInput } from './common.js';
import { classBundle } from '../pages/league.js';
import { refreshDotdLive } from '../pages/dotd.js';

// ---------- kafelek wyścigu ----------

export function RacePanel({ b, race, step, nav, reload }) {
  const track = b.trackById.get(race.track_id);
  const results = b.results.filter((r) => r.race_id === race.id);
  const pens = b.penalties.filter((p) => p.race_id === race.id);
  const sprint = isSprint(race);
  const idxInSeason = b.sessions.findIndex((r) => r.id === race.id);
  const unapprovedBefore = b.sessions.slice(0, idxInSeason).filter((r) => r.status !== 'completed');
  const done = race.status === 'completed';

  const streams = STREAMS.filter(([k]) => race[k]).length;
  const timing = raceTimeState(race);
  const dotd = dotdState(race);
  const steps = [
    { id: 'przed', label: 'Przed wyścigiem', note: [streams ? `${streams} ${streams === 1 ? 'transmisja' : 'transmisje'}` : 'transmisja, czas', Array.isArray(race.start_lineup) ? `skład: ${race.start_lineup.length}` : null].filter(Boolean).join(' · '), state: streams || Array.isArray(race.start_lineup) ? 'done' : 'info' },
    { id: 'trakcie', label: 'W trakcie wyścigu', note: dotd === 'open' ? '⭐ głosowanie trwa' : dotd === 'ended' ? 'głosowanie zakończone' : 'kierowca dnia', state: dotd === 'open' ? 'done' : 'info' },
    { id: 'wyniki', label: 'Wyniki', note: results.length ? `${results.length} kierowców` : 'do wpisania', state: results.length ? 'done' : 'todo' },
    { id: 'kary', label: 'Kary', note: pens.length ? `${pens.length} decyzji` : 'brak kar', state: !results.length ? 'todo' : pens.length ? 'done' : 'info' },
    { id: 'zatwierdzenie', label: 'Zatwierdzenie', note: done ? 'opublikowany' : 'nieopublikowany', state: done ? 'done' : 'todo' },
  ];
  // przed startem — konfiguracja transmisji; w trakcie — kierowca dnia; po wyścigu — wyniki
  const current = steps.some((s) => s.id === step) ? step
    : !results.length ? (timing === 'upcoming' || timing === 'unscheduled' ? 'przed' : timing === 'live' || dotd === 'open' ? 'trakcie' : 'wyniki') : done ? 'zatwierdzenie' : 'kary';
  const idx = steps.findIndex((s) => s.id === current);
  const go = (id) => nav(race.id, id);

  return html`<section class="panel">
    <div class="panel-head">
      <div class="panel-title">
        <${Flag} code=${track?.country_code} size=${36} />
        <div>
          <span class="eyebrow">Runda ${race.round} z ${b.races.length}${sprint ? ' · Sprint' : ''}</span>
          <h2>${track?.name ?? 'Tor'}${sprint ? html` <span class="badge badge-sprint">Sprint</span>` : null}</h2>
          <div class="muted">${formatDate(race.race_date)}${race.laps ? ` · ${race.laps} okr.` : ''}${race.counts === false ? ' · nie liczy się do klasyfikacji' : ''}</div>
        </div>
      </div>
      <span class=${`tile-state ${done ? 'st-done' : results.length ? 'st-draft' : timing === 'live' ? 'st-live' : timing === 'over' ? 'st-over' : 'st-next'}`}>${done ? '✓ Zatwierdzony' : results.length ? 'Do zatwierdzenia' : timing === 'live' ? '🔴 Trwa' : timing === 'over' ? 'Czeka na wyniki' : 'Bez wyników'}</span>
    </div>
    ${!done && timing === 'over' ? html`<p class="hint warn">Czas wyścigu minął — na stronie nie jest już „trwający”. Wpisz wyniki i zatwierdź je, żeby stały się oficjalne.</p>` : null}
    ${unapprovedBefore.length ? html`<p class="hint warn">Uwaga: niezatwierdzone wcześniejsze wyścigi: ${unapprovedBefore.map((r) => sessionLabel(r, true)).join(', ')}. Skład na ten wyścig może się jeszcze zmienić.</p>` : null}
    ${sprint && !seasonHasPoints(b.season) ? html`<p class="hint">Sprint: osobny wynik przed wyścigiem głównym. Kierowcy jadą w tym samym składzie.</p>` : null}
    ${sprint && seasonHasPoints(b.season) ? html`<p class="hint">Sprint: punkty ${SPRINT_POINTS.join('-')} dla pierwszej ósemki${seasonClasses(b.season).length > 1 ? ' w każdej klasie' : ''}, bez punktów za pole i najszybsze okrążenie. Kierowcy jadą w składzie z rundy ${race.round}.</p>` : null}
    <${StepBar} steps=${steps} value=${current} onChange=${go} />
    <div class="panel-body">
      ${current === 'przed' ? html`<${PreRace} key=${race.id} b=${b} race=${race} reload=${reload} />` : null}
      ${current === 'trakcie' ? html`<${DuringRace} key=${race.id} b=${b} race=${race} reload=${reload} />` : null}
      ${current === 'wyniki' ? html`<${ResultsForm} key=${race.id + results.length} b=${b} race=${race} onSaved=${reload} />` : null}
      ${current === 'kary' ? html`<${RacePenalties} b=${b} race=${race} reload=${reload} />` : null}
      ${current === 'zatwierdzenie' ? html`<${RaceSummary} b=${b} race=${race} nav=${nav} reload=${reload} />` : null}
    </div>
    ${idx < steps.length - 1 ? html`<${NextStep} label=${`Dalej: ${steps[idx + 1].label}`} onClick=${() => go(steps[idx + 1].id)} />` : null}
  </section>`;
}

// ---------- krok 0: przed wyścigiem (transmisja, czas trwania) ----------

const RACE_STREAMS = STREAMS.filter(([k]) => ['youtube_url', 'twitch_url', 'tiktok_url'].includes(k));

function PreRace({ b, race, reload }) {
  const patch = async (p) => (await attempt(() => db.update('races', race.id, p), 'Zapisano')) && reload();
  const setLink = (key, v) => {
    const url = v.trim();
    if (url && !/^https?:\/\//i.test(url)) return alert('Podaj pełny adres, np. https://www.youtube.com/live/…');
    return patch({ [key]: url || null });
  };
  const minutes = race.duration_minutes || DEFAULT_RACE_MINUTES;
  const end = race.race_date ? new Date(new Date(race.race_date).getTime() + minutes * 60000) : null;
  return html`
    <h3>Przed wyścigiem</h3>
    <p class="muted">W trakcie wyścigu (od startu przez podany czas) wyścig jest na stronie głównej w sekcji <b>„Trwa teraz”</b> —
      z transmisją YouTube w tle i przyciskiem <b>„Oglądaj”</b>. Po tym czasie znika z „trwających”, ale wyniki i tak trzeba zatwierdzić.</p>
    <div class="form-grid">
      <label class="field"><span>Czas trwania</span>
        <${DurationInput} value=${race.duration_minutes} placeholder=${DEFAULT_RACE_MINUTES} onChange=${(v) => patch({ duration_minutes: v })} />
        <small class="muted">${race.race_date ? `Start ${formatDate(race.race_date)} · „trwa” do ${end.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}` : 'Ustaw datę wyścigu w kalendarzu'}${race.duration_minutes ? '' : ` (domyślnie ${formatMinutes(DEFAULT_RACE_MINUTES)})`}</small>
      </label>
      <div class="field"><span>Stan</span><b>${{ upcoming: 'Przed startem', unscheduled: 'Bez terminu', live: '🔴 Trwa teraz', over: 'Czas minął — czeka na wyniki', done: '✓ Zatwierdzony' }[raceTimeState(race)]}</b></div>
      ${RACE_STREAMS.map(([key, label]) => html`<label class="field span2"><span>Transmisja ${label}</span>
        <input value=${race[key] || ''} placeholder=${key === 'youtube_url' ? 'https://www.youtube.com/live/… (w tle kafelka na stronie głównej)' : 'https://…'} onChange=${(e) => setLink(key, e.target.value)} /></label>`)}
    </div>
    <p class="hint">YouTube: wklej link do konkretnej transmisji (…/live/<i>ID</i> albo watch?v=<i>ID</i>) — wtedy wideo jest tłem kafelka. Link do kanału zadziała tylko jako przycisk „Oglądaj”.</p>
    <${StartingLineup} key=${race.id + JSON.stringify(race.start_lineup ?? null)} b=${b} race=${race} reload=${reload} />
  `;
}

// skład startowy: kto faktycznie jedzie w tym wyścigu (nieobecni odznaczeni, zastępstwa dopisane)
const lineupKey = (list) => JSON.stringify([...list].map((x) => `${x.driver_id}:${x.team_id || ''}`).sort());

function StartingLineup({ b, race, reload }) {
  const roster = lineupAt(b.entries, b.rosterChanges, race.round); // skład rundy z kafelka „Składy”
  const rosterStart = [...roster.values()].filter((x) => x.team_id);
  const custom = Array.isArray(race.start_lineup);
  const saved = custom ? race.start_lineup.map((x) => ({ driver_id: x.driver_id, team_id: x.team_id || null })) : rosterStart;
  const [draft, setDraft] = useState(saved);
  const [add, setAdd] = useState({ driver_id: '', team_id: '' });
  const [busy, setBusy] = useState(false);
  const inDraft = new Map(draft.map((x) => [x.driver_id, x]));
  const nick = (id) => b.driverById.get(id)?.nick ?? '?';
  const changed = lineupKey(draft) !== lineupKey(saved);

  // kierowca ze składu: zaznaczony = startuje w swoim zespole
  const starts = (seat) => inDraft.get(seat.driver_id)?.team_id === seat.team_id;
  const toggle = (seat) => setDraft(starts(seat) ? draft.filter((x) => x.driver_id !== seat.driver_id)
    : [...draft.filter((x) => x.driver_id !== seat.driver_id), { driver_id: seat.driver_id, team_id: seat.team_id }]);
  // zastępstwa: startujący spoza składu tego zespołu
  const subs = (teamId) => draft.filter((x) => (x.team_id || null) === teamId && roster.get(x.driver_id)?.team_id !== x.team_id);
  const remove = (id) => setDraft(draft.filter((x) => x.driver_id !== id));
  // wolne miejsce (ktoś nie przyszedł) — domyślny zespół dla zastępstwa
  const gap = b.teams.find((t) => teamSeats(roster, t.id).some((seat) => !starts(seat)));
  const addSub = () => {
    if (!add.driver_id) return;
    const team_id = (add.team_id || gap?.id || null) === '-' ? null : add.team_id || gap?.id || null;
    setDraft([...draft.filter((x) => x.driver_id !== add.driver_id), { driver_id: add.driver_id, team_id }]);
    setAdd({ driver_id: '', team_id: '' });
  };
  const reserves = [...roster.values()].filter((x) => !x.team_id && !inDraft.has(x.driver_id)).map((x) => b.driverById.get(x.driver_id)).filter(Boolean);
  const others = b.drivers.filter((d) => !roster.has(d.id) && !inDraft.has(d.id));
  // kierowcy ze składu, którzy w tym wyścigu jadą gdzie indziej (np. przesiadka do innego auta)
  const moved = rosterStart.filter((x) => !inDraft.has(x.driver_id)).map((x) => b.driverById.get(x.driver_id)).filter(Boolean);

  const save = async (value) => {
    setBusy(true);
    const ok = await attempt(() => db.update('races', race.id, { start_lineup: value }), value ? `Zapisano skład startowy: ${value.length} kierowców` : 'Przywrócono skład z kafelka „Składy”');
    setBusy(false);
    if (ok) reload();
  };

  const teamCard = (t) => {
    const seats = teamSeats(roster, t.id);
    const extra = subs(t.id);
    const n = seats.filter(starts).length + extra.length;
    return html`<div class="sl-team" style=${{ '--team': t.color || '#888' }} key=${t.id}>
      <div class="sl-team-head"><${TeamTag} team=${t} link=${false} /><span class="muted small sl-count">${n} ${n === 1 ? 'kierowca' : 'kierowców'}</span></div>
      ${seats.map((seat) => html`<label class=${`sl-row ${starts(seat) ? '' : 'sl-absent'}`}>
        <input type="checkbox" checked=${starts(seat)} onChange=${() => toggle(seat)} /> <span class="sl-name">${nick(seat.driver_id)}</span>
        ${starts(seat) ? null : html`<span class="muted small">${inDraft.has(seat.driver_id) ? `jedzie w: ${b.teamById.get(inDraft.get(seat.driver_id).team_id)?.name ?? 'bez zespołu'}` : 'nie startuje'}</span>`}
      </label>`)}
      ${extra.map((x) => html`<div class="sl-row sl-sub"><span class="badge">zastępstwo</span> <span class="sl-name">${nick(x.driver_id)}</span>
        <button type="button" class="btn btn-sm btn-ghost" title="Usuń ze startu" onClick=${() => remove(x.driver_id)}>✕</button></div>`)}
    </div>`;
  };
  const noTeam = subs(null);

  return html`<div class="start-lineup">
    <h3>Skład startowy</h3>
    <p class="muted">Kto <b>faktycznie jedzie</b> w tym wyścigu. Odznacz osoby, które nie przyszły, i dopisz zastępstwa. Tylko te osoby
      są w <b>głosowaniu na kierowcę dnia</b>, a w wynikach pokazujemy, kogo ze startu jeszcze brakuje. Zmiany w składach na kolejne rundy
      robisz jak dotąd w kafelku „Składy”.</p>
    <p class="small">${custom
      ? html`<span class="tile-state st-done">Ustawiony</span> ${race.start_lineup.length} kierowców startuje`
      : html`<span class="tile-state st-next">Domyślny</span> skład rundy ${race.round} z kafelka „Składy” (${rosterStart.length} kierowców)`}</p>
    <div class="sl-grid">
      ${b.teams.map(teamCard)}
      ${noTeam.length ? html`<div class="sl-team" style=${{ '--team': '#888' }}>
        <div class="sl-team-head"><b>Bez zespołu</b></div>
        ${noTeam.map((x) => html`<div class="sl-row sl-sub"><span class="badge">zastępstwo</span> <span class="sl-name">${nick(x.driver_id)}</span>
          <button type="button" class="btn btn-sm btn-ghost" title="Usuń ze startu" onClick=${() => remove(x.driver_id)}>✕</button></div>`)}
      </div>` : null}
    </div>
    <div class="sl-add">
      <select value=${add.driver_id} onChange=${(e) => setAdd({ ...add, driver_id: e.target.value })} aria-label="Kierowca na zastępstwo">
        <option value="">+ Zastępstwo: wybierz kierowcę…</option>
        ${reserves.length ? html`<optgroup label="Rezerwa sezonu">${reserves.map((d) => html`<option value=${d.id}>${d.nick}</option>`)}</optgroup>` : null}
        ${moved.length ? html`<optgroup label="Ze składu — przesiadka do innego zespołu / auta">${moved.map((d) => html`<option value=${d.id}>${d.nick}</option>`)}</optgroup>` : null}
        ${others.length ? html`<optgroup label="Pozostali kierowcy">${others.map((d) => html`<option value=${d.id}>${d.nick}</option>`)}</optgroup>` : null}
      </select>
      <select value=${add.team_id || gap?.id || '-'} onChange=${(e) => setAdd({ ...add, team_id: e.target.value })} aria-label="Zespół zastępstwa">
        ${b.teams.map((t) => html`<option value=${t.id}>${t.name}</option>`)}
        <option value="-">bez zespołu</option>
      </select>
      <button type="button" class="btn btn-sm" disabled=${!add.driver_id} onClick=${addSub}>Dodaj</button>
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-accent" disabled=${busy || (!changed && custom)} onClick=${() => save(draft)}>${busy ? 'Zapisywanie…' : 'Zapisz skład startowy'}</button>
      ${changed ? html`<button type="button" class="btn" disabled=${busy} onClick=${() => setDraft(saved)}>Cofnij zmiany</button>` : null}
      ${custom ? html`<button type="button" class="btn" disabled=${busy} onClick=${() => confirm('Wrócić do składu z kafelka „Składy”? Ręczne zmiany startu znikną.') && save(null)}>Przywróć skład z kafelka „Składy”</button>` : null}
    </div>
  </div>`;
}

// ---------- krok: w trakcie wyścigu (głosowanie na kierowcę dnia) ----------

const DOTD_MAX_MS = 12 * 3600000; // baza zamyka głosowanie samo po 12 h (zabezpieczenie)

/** 'open' — trwa, 'ended' — zakończone (przyciskiem, zatwierdzeniem albo po 12 h), 'idle' — nieuruchomione. */
export function dotdState(race) {
  if (!race.dotd_started_at) return 'idle';
  if (race.dotd_ended_at || race.status === 'completed' || Date.now() >= new Date(race.dotd_started_at).getTime() + DOTD_MAX_MS) return 'ended';
  return 'open';
}

const clock = (iso) => new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
const votesLabel = (n) => `${n} ${n === 1 ? 'głos' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'głosy' : 'głosów'}`;

function DuringRace({ b, race, reload }) {
  const state = dotdState(race);
  const [votes, setVotes] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => db.rpc('dotd_staff_results', { p_race: race.id }).then((x) => { setVotes(x || []); setError(null); }, (e) => setError(e.message));
  useEffect(() => {
    load();
    if (state !== 'open') return undefined;
    const t = setInterval(load, 10000); // wyniki na żywo dla organizatorów
    return () => clearInterval(t);
  }, [race.id, state]);

  const set = async (open) => {
    if (!open && !confirm('Zakończyć głosowanie na kierowcę dnia? Przycisk zniknie ze strony, a wynik pojawi się w kalendarzu.')) return;
    setBusy(true);
    const ok = await attempt(() => db.rpc('dotd_set_open', { p_race: race.id, p_open: open }), open ? 'Głosowanie uruchomione — przycisk widzą teraz wszyscy' : 'Głosowanie zakończone');
    setBusy(false);
    if (ok) { refreshDotdLive(); reload(); }
  };

  const total = (votes || []).reduce((n, r) => n + r.votes, 0);
  const teamOf = (id) => b.teamById.get(startingSeats(b, race).get(id)?.team_id);
  return html`
    <h3>W trakcie wyścigu</h3>
    <div class=${`dotd-admin dotd-admin-${state}`}>
      <div class="dotd-admin-head">
        <span class="dotd-admin-star" aria-hidden="true">⭐</span>
        <div class="dotd-admin-title">
          <b>Głosowanie na kierowcę dnia</b>
          <div class="muted small">${state === 'open' ? html`<span class="tile-state st-live">Trwa</span> od ${clock(race.dotd_started_at)} · ${votesLabel(total)}`
            : state === 'ended' ? html`<span class="tile-state st-done">Zakończone</span>${race.dotd_ended_at ? ` o ${clock(race.dotd_ended_at)}` : ''} · ${votesLabel(total)}`
            : html`<span class="tile-state st-next">Nieuruchomione</span>`}</div>
        </div>
        ${race.status === 'completed' ? null
          : state === 'open' ? html`<button class="btn btn-danger" disabled=${busy} onClick=${() => set(false)}>■ Zakończ głosowanie</button>`
          : html`<button class="btn btn-dotd dotd-admin-start" disabled=${busy} onClick=${() => set(true)}>⭐ ${state === 'ended' ? 'Wznów głosowanie' : 'Uruchom głosowanie'}</button>`}
      </div>
      <p class="muted small">${race.status === 'completed'
        ? 'Wyścig jest zatwierdzony — głosowanie jest zamknięte, a wynik widać w kalendarzu.'
        : html`Uruchom, gdy kierowcy już jadą. Wtedy <b>wszyscy na stronie</b> zobaczą przycisk i kartę „Głosuj na kierowcę dnia” (w ciągu ok. 20 s, bez odświeżania).
          Głosowanie kończy się przyciskiem „Zakończ”, po zatwierdzeniu wyników albo samo po 12 godzinach.${state === 'ended' ? ' Wznowienie zachowuje oddane głosy.' : ''}`}</p>
      ${error ? html`<p class="hint warn">Głosowanie wymaga aktualizacji bazy: uruchom w Supabase → SQL Editor plik <b>supabase/migrations/2026-11-11_kierowca_dnia_start.sql</b> (${error}).</p>` : null}
      ${votes && votes.length ? html`<ol class="dotd-results">
        ${votes.map((r, i) => {
          const pct = total ? Math.round((r.votes / total) * 100) : 0;
          return html`<li class=${i === 0 ? 'lead' : ''} style=${{ '--team': teamOf(r.driver_id)?.color || 'var(--gold)' }}>
            <span class="dotd-bar" style=${{ width: `${pct}%` }}></span>
            <span class="dotd-name">${i === 0 ? '⭐ ' : ''}${b.driverById.get(r.driver_id)?.nick ?? '?'}</span>
            <span class="dotd-pct"><b>${pct}%</b> <span class="muted">(${r.votes})</span></span>
          </li>`;
        })}
      </ol>` : votes && state !== 'idle' ? html`<p class="muted">Nikt jeszcze nie zagłosował.</p>` : null}
      ${state === 'open' ? html`<p class="muted small">Wyniki odświeżają się co 10 s. Publicznie widzi je tylko ten, kto już zagłosował, a wszyscy — po zakończeniu.</p>` : null}
    </div>
  `;
}

// ---------- krok 1: wyniki ----------

let keySeq = 0;
const blankRow = () => ({ key: ++keySeq, driver_id: '', team_id: '', car_class: '', grid: '', status: 'FIN', time: '', laps_down: 0, best_lap: '', fastest_lap: false, pit_stops: '' });

function rowsFromResults(results) {
  return results.slice().sort((a, c) => a.position - c.position).map((r) => ({
    key: ++keySeq,
    driver_id: r.driver_id,
    team_id: r.team_id || '',
    car_class: r.car_class || '',
    grid: r.grid ?? '',
    status: r.status || 'FIN',
    time: r.time_ms != null ? formatDuration(r.time_ms) : '',
    laps_down: r.laps_down || 0,
    best_lap: r.best_lap_ms != null ? formatDuration(r.best_lap_ms) : '',
    fastest_lap: !!r.fastest_lap,
    pit_stops: r.pit_stops ?? '',
  }));
}

/** Zamienia wiersze formularza na rekordy tabeli results (z walidacją). */
function toRecords(rows, raceId, season) {
  const multiClass = seasonStyle(season) === 'lmu';
  const fixedClass = season.series === 'f1' ? 'F1' : seasonCarType(season);
  const used = new Set();
  let winnerMs = null;
  return rows.map((r, i) => {
    if (!r.driver_id) throw new Error(`Pozycja ${i + 1}: wybierz kierowcę`);
    if (used.has(r.driver_id)) throw new Error(`Pozycja ${i + 1}: kierowca występuje dwa razy`);
    used.add(r.driver_id);
    if (multiClass && !r.car_class) throw new Error(`Pozycja ${i + 1}: wybierz klasę samochodu`);

    let time_ms = null;
    const t = String(r.time).trim();
    if (t && r.status === 'FIN') {
      if (t.startsWith('+')) {
        if (winnerMs == null) throw new Error(`Pozycja ${i + 1}: strata "+…" wymaga pełnego czasu zwycięzcy w 1. wierszu`);
        const gap = parseTime(t.slice(1));
        if (gap == null) throw new Error(`Pozycja ${i + 1}: nieprawidłowa strata "${t}"`);
        time_ms = winnerMs + gap;
      } else {
        time_ms = parseTime(t);
        if (time_ms == null) throw new Error(`Pozycja ${i + 1}: nieprawidłowy czas "${t}"`);
      }
      if (winnerMs == null) winnerMs = time_ms;
    }
    const best = String(r.best_lap).trim();
    const best_lap_ms = best ? parseTime(best) : null;
    if (best && best_lap_ms == null) throw new Error(`Pozycja ${i + 1}: nieprawidłowy czas okrążenia "${best}"`);

    return {
      race_id: raceId,
      driver_id: r.driver_id,
      team_id: r.team_id || null,
      car_class: multiClass ? r.car_class : fixedClass,
      position: i + 1,
      grid: r.grid === '' ? null : Number(r.grid),
      status: r.status,
      laps_down: Number(r.laps_down) || 0,
      time_ms,
      best_lap_ms,
      fastest_lap: !!r.fastest_lap,
      pit_stops: r.pit_stops === '' ? null : Number(r.pit_stops),
    };
  });
}

function ResultsForm({ b, race, onSaved }) {
  const existing = b.results.filter((r) => r.race_id === race.id);
  const seats = startingSeats(b, race); // skład startowy tego wyścigu (albo skład rundy z kafelka „Składy”)
  const scored = seasonHasPoints(b.season); // pojedyncze wydarzenie — bez kolumny punktów
  const multiClass = seasonStyle(b.season) === 'lmu';
  const classOptions = seasonClasses(b.season);
  // przy jednej klasie w sezonie ustawiamy ją automatycznie
  const teamClass = (teamId) => b.teamById.get(teamId)?.car_class || (classOptions.length === 1 ? classOptions[0] : '');
  const seatTeam = (driverId) => seats.get(driverId)?.team_id || '';
  // lista startuje pusta — admin dodaje kierowców wiersz po wierszu, w kolejności na mecie
  const [rows, setRows] = useState(() => (existing.length ? rowsFromResults(existing) : []));
  const [showPaste, setShowPaste] = useState(false);
  const [busy, setBusy] = useState(false);
  const [extraDrivers, setExtraDrivers] = useState([]);
  const drivers = [...b.drivers, ...extraDrivers];
  const chosen = new Set(rows.map((r) => r.driver_id).filter(Boolean));
  const inLineup = drivers.filter((d) => seats.get(d.id)?.team_id);
  const inReserve = drivers.filter((d) => seats.has(d.id) && !seats.get(d.id).team_id);
  const others = drivers.filter((d) => !seats.has(d.id));

  const setRow = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  // najszybsze okrążenie jest jedno na klasę
  const setFastest = (i) => setRows(rows.map((r, j) => ({ ...r, fastest_lap: j === i ? !r.fastest_lap : r.car_class === rows[i].car_class ? false : r.fastest_lap })));
  const moveTo = (i, target) => {
    const j = Math.max(0, Math.min(rows.length - 1, target));
    if (j === i || Number.isNaN(j)) return;
    const next = rows.slice();
    const [row] = next.splice(i, 1);
    next.splice(j, 0, row);
    setRows(next);
  };
  const removeRow = (i) => setRows(rows.filter((_, j) => j !== i));
  const addRow = (driverId = '') => {
    const team_id = driverId ? seatTeam(driverId) : '';
    setRows([...rows, { ...blankRow(), driver_id: driverId, team_id, car_class: teamClass(team_id) }]);
  };
  // kierowcy ze składu tej rundy, których jeszcze nie ma na liście
  const custom = Array.isArray(race.start_lineup);
  const missing = [...b.teams.flatMap((t) => teamSeats(seats, t.id)), ...(custom ? [...seats.values()].filter((s) => !s.team_id) : [])].filter((s) => !chosen.has(s.driver_id));

  const preview = useMemo(() => {
    try {
      const recs = toRecords(rows.filter((r) => r.driver_id), race.id, b.season).map((r, i) => ({ ...r, id: `tmp${i}` }));
      return { map: new Map(computeRaceByClass(race, b.season, recs, b.penalties).map((r) => [r.driver_id, r])) };
    } catch (e) {
      return { map: new Map(), error: e.message };
    }
  }, [rows, b]);

  const save = async () => {
    let records;
    try {
      records = toRecords(rows, race.id, b.season);
    } catch (e) {
      return alert(e.message);
    }
    if (!records.length) return alert('Dodaj co najmniej jednego kierowcę');
    setBusy(true);
    const ok = await attempt(async () => {
      await db.removeWhere('results', { race_id: race.id });
      await db.insert('results', records);
    }, 'Zapisano wyniki. Dalej: kary i zatwierdzenie.');
    setBusy(false);
    if (ok) onSaved();
  };
  const clearAll = async () => {
    if (!confirm('Usunąć wszystkie wyniki tego wyścigu? Wyścig zostanie też odpublikowany.')) return;
    const ok = await attempt(async () => {
      await db.removeWhere('results', { race_id: race.id });
      await db.update('races', race.id, { status: 'scheduled' });
    }, 'Wyniki usunięte');
    if (ok) onSaved();
  };

  const opts = (list, row) => list.map((d) => html`<option value=${d.id} disabled=${chosen.has(d.id) && d.id !== row.driver_id}>${d.nick}</option>`);
  // zmiana kierowcy przestawia też zespół (i klasę) na jego skład w tej rundzie — chyba że zespół
  // ustawiono w tym wierszu ręcznie (zastępstwo); wcześniej zespół zostawał od poprzedniego kierowcy
  const driverSelect = (row, i) => html`<select value=${row.driver_id} onChange=${(e) => {
    const team_id = row.teamManual ? row.team_id : seatTeam(e.target.value);
    setRow(i, { driver_id: e.target.value, team_id, car_class: row.teamManual ? row.car_class : teamClass(team_id) || row.car_class });
  }}>
    <option value="">— kierowca —</option>
    <optgroup label=${`Skład na rundę ${race.round}`}>${opts(inLineup, row)}</optgroup>
    ${inReserve.length ? html`<optgroup label="Rezerwa">${opts(inReserve, row)}</optgroup>` : null}
    ${others.length ? html`<optgroup label="Spoza składu sezonu">${opts(others, row)}</optgroup>` : null}
  </select>`;

  return html`
    <div class="form-actions">
      ${existing.length ? html`<span class="badge">Edycja zapisanych wyników</span>` : null}
      <button class="btn btn-sm" onClick=${() => setShowPaste(!showPaste)}>${showPaste ? 'Ukryj import' : 'Wklej wyniki z tekstu'}</button>
    </div>
    ${showPaste ? html`<${PasteImport} b=${b} seats=${seats} onImport=${(r, created) => { setExtraDrivers([...extraDrivers, ...created]); setRows(r); setShowPaste(false); }} />` : null}

    <p class="hint">Dodawaj kierowców w kolejności na mecie (przed karami): pierwszy wiersz to P1, drugi P2 i tak dalej.
      Pomyłkę poprawisz strzałkami albo usuwając wiersz. Czas: pełny dla zwycięzcy
      (np. <code>1:28:33.412</code>), dla pozostałych pełny albo strata (np. <code>+3.215</code>). Zastępstwo: wybierz kierowcę z rezerwy i zespół, za który jechał.
      ${multiClass ? (scored ? ' Wyścig wieloklasowy: kolejność ogólna, a punkty liczą się w każdej klasie osobno.' : ' Wyścig wieloklasowy: kolejność ogólna, pozycje liczone są też w każdej klasie.') : ''}</p>

    <div class="table-wrap">
      <table class="table edit-table results-edit">
        <thead><tr>
          <th class="c">Poz</th><th>Kierowca</th><th>${seasonUnit(b.season).one}</th>${multiClass ? html`<th>Klasa</th>` : null}<th class="c">Start</th><th>Status</th>
          <th>Czas / strata</th><th class="c" title="Okrążenia straty do lidera">Okr.−</th><th>Najl. okr.</th><th class="c" title="Najszybsze okrążenie">NO</th><th class="c">Pit</th>
          ${scored ? html`<th class="r">Pkt</th>` : null}<th></th>
        </tr></thead>
        <tbody>
          ${rows.map((row, i) => {
            const p = preview.map.get(row.driver_id);
            const sub = row.driver_id && row.team_id && seatTeam(row.driver_id) !== row.team_id;
            return html`<tr key=${row.key} class=${sub ? 'row-sub' : ''}>
              <td class="c"><span class="pos-fixed">P${i + 1}</span></td>
              <td>${driverSelect(row, i)}${sub ? html`<span class="badge" title=${multiClass ? 'Inne auto niż przypisane w tej rundzie' : 'Jedzie za inny zespół niż w składzie'}>${multiClass ? 'inne auto' : 'zastępstwo'}</span>` : null}</td>
              <td><select value=${row.team_id} onChange=${(e) => setRow(i, { team_id: e.target.value, teamManual: true, car_class: teamClass(e.target.value) || row.car_class })}>
                <option value="">—</option>
                ${b.teams.map((t) => html`<option value=${t.id}>${t.name}</option>`)}
              </select></td>
              ${multiClass ? html`<td><select value=${row.car_class} onChange=${(e) => setRow(i, { car_class: e.target.value })}>
                <option value="">—</option>
                ${classOptions.map((id) => html`<option value=${id}>${id}</option>`)}
              </select></td>` : null}
              <td class="c"><input class="w-num" type="number" min="1" value=${row.grid} onInput=${(e) => setRow(i, { grid: e.target.value })} /></td>
              <td><select value=${row.status} onChange=${(e) => setRow(i, { status: e.target.value })}>
                ${STATUSES.map((s) => html`<option value=${s.id}>${s.id}</option>`)}
              </select></td>
              <td><input class="w-time mono" value=${row.time} placeholder=${i === 0 ? '1:28:33.412' : '+3.215'} disabled=${row.status !== 'FIN'} onInput=${(e) => setRow(i, { time: e.target.value })} /></td>
              <td class="c"><input class="w-num" type="number" min="0" value=${row.laps_down} disabled=${row.status !== 'FIN'} onInput=${(e) => setRow(i, { laps_down: e.target.value })} /></td>
              <td><input class="w-time mono" value=${row.best_lap} placeholder="1:31.204" onInput=${(e) => setRow(i, { best_lap: e.target.value })} /></td>
              <td class="c"><input type="checkbox" checked=${row.fastest_lap} onChange=${() => setFastest(i)} /></td>
              <td class="c"><input class="w-num" type="number" min="0" value=${row.pit_stops} onInput=${(e) => setRow(i, { pit_stops: e.target.value })} /></td>
              ${scored ? html`<td class="r pts" title=${p && multiClass ? `P${p.classPos ?? '-'} w klasie` : ''}>${p ? p.points : ''}</td>` : null}
              <td class="r actions nowrap">
                <button class="btn btn-xs" onClick=${() => moveTo(i, i - 1)} disabled=${i === 0} title="W górę">↑</button>
                <button class="btn btn-xs" onClick=${() => moveTo(i, i + 1)} disabled=${i === rows.length - 1} title="W dół">↓</button>
                <button class="btn btn-xs btn-danger" onClick=${() => removeRow(i)} title="Usuń wiersz">✕</button>
              </td>
            </tr>`;
          })}
          ${!rows.length ? html`<tr><td colspan=${multiClass ? 13 : 12} class="empty-row">Lista jest pusta — dodaj kierowcę, który zajął <b>P1</b>.</td></tr>` : null}
        </tbody>
      </table>
    </div>
    ${preview.error && rows.some((r) => r.driver_id) ? html`<p class="hint warn">Podgląd: ${preview.error}</p>` : null}

    <div class="add-row">
      <button class="btn btn-accent" onClick=${() => addRow()}>+ Dodaj P${rows.length + 1}</button>
      ${missing.length ? html`<div class="quick-add">
        <span class="muted">albo kliknij kierowcę ${custom ? 'ze składu startowego' : `ze składu rundy ${race.round}`}, który zajął P${rows.length + 1}:</span>
        ${missing.map((s) => html`<button class="chip" style=${{ '--team': b.teamById.get(s.team_id)?.color || '#888' }} onClick=${() => addRow(s.driver_id)}>${b.driverById.get(s.driver_id)?.nick ?? '?'}</button>`)}
      </div>` : rows.length ? html`<span class="muted">✓ Wpisano wszystkich kierowców ${custom ? 'ze składu startowego' : 'ze składu tej rundy'}</span>` : null}
    </div>

    <div class="form-actions">
      <span class="spacer"></span>
      ${existing.length ? html`<button class="btn btn-danger" onClick=${clearAll}>Usuń wyniki</button>` : null}
      <button class="btn btn-accent" onClick=${save} disabled=${busy}>${busy ? 'Zapisywanie…' : existing.length ? 'Zapisz zmiany' : 'Zapisz wyniki'}</button>
    </div>
  `;
}

/**
 * Import wyników z tekstu — jeden kierowca na linię, w kolejności na mecie:
 *   Nick | Zespół | P. startowa | Pit | Najlepsze okrążenie | Czas [| Klasa]
 */
function PasteImport({ b, seats, onImport }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const parsed = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/\s*[|\t;]\s*/));
    const norm = (s) => (s || '').trim().toLowerCase();
    const unknown = [...new Set(parsed.map((p) => p[0]).filter((n) => n && !b.drivers.some((d) => norm(d.nick) === norm(n))))];
    if (unknown.length && !confirm(`Nowi kierowcy zostaną dodani do bazy:\n${unknown.join(', ')}\n\nKontynuować?`)) return;
    setBusy(true);
    const created = unknown.length ? await attempt(() => db.insert('drivers', unknown.map((nick) => ({ nick, country_code: 'PL', number: null })))) : [];
    setBusy(false);
    if (created === false) return;
    const all = [...b.drivers, ...(created || [])];
    const CLASS_ALIASES = { HY: 'HY', HYPERCAR: 'HY', LMH: 'HY', LMDH: 'HY', LMP: 'LMP', LMP2: 'LMP', LMP3: 'LMP', GT3: 'GT3', LMGT3: 'GT3' };

    onImport(parsed.map(([nick, team, grid, pit, best, time, cls]) => {
      const d = all.find((x) => norm(x.nick) === norm(nick));
      const t = b.teams.find((x) => norm(x.name) === norm(team));
      const st = (time || '').trim().toUpperCase();
      const status = ['DNF', 'DNS', 'DSQ', 'NC'].includes(st) ? st : 'FIN';
      const lapped = /^\+?(\d+)\s*(okr|lap|l)/i.exec(time || '');
      return {
        ...blankRow(),
        driver_id: d?.id || '',
        team_id: t?.id || seats.get(d?.id)?.team_id || '',
        // klasy LMU po skrótach, własne klasy wydarzeń „Inne” po nazwie
        car_class: CLASS_ALIASES[(cls || '').trim().toUpperCase().replace(/\s/g, '')]
          || seasonClasses(b.season).find((c) => norm(c) === norm(cls || '')) || t?.car_class || '',
        grid: (grid || '').replace(/\D/g, ''),
        pit_stops: (pit || '').replace(/\D/g, ''),
        best_lap: best || '',
        status,
        time: status === 'FIN' && !lapped ? (time || '') : '',
        laps_down: lapped ? Number(lapped[1]) : 0,
      };
    }), created || []);
  };

  return html`<div class="subform">
    <b>Wklej wyniki</b>
    <p class="hint">Jedna linia = jeden kierowca, w kolejności na mecie: <code>Nick | ${seasonUnit(b.season).one} | P. startowa | Pit | Najlepsze okrążenie | Czas</code>${seasonStyle(b.season) === 'lmu' ? html` <code>| Klasa</code>` : null}<br />
      W polu czasu można wpisać <code>DNF</code>, <code>DNS</code>, <code>DSQ</code>, <code>NC</code> albo <code>+1 okr</code>. Działa też wklejka z Excela.</p>
    <textarea rows="8" class="mono" value=${text} onInput=${(e) => setText(e.target.value)} placeholder=${'Kowal_Racing | McLaren | 2 | 1 | 1:31.204 | 1:28:33.412\nSzybki_Bill | Ferrari | 1 | 1 | 1:31.380 | +3.215'}></textarea>
    <div class="form-actions"><button class="btn btn-accent" onClick=${run} disabled=${busy || !text.trim()}>Wczytaj do formularza</button></div>
  </div>`;
}

// ---------- krok 2: kary ----------

const VALUE_LABEL = { time: 'Sekundy', points: 'Punkty', grid: 'Pozycje' };
const classOrder = (c) => CAR_CLASSES.findIndex((x) => x.id === c);
// własne klasy wydarzeń „Inne” nie są na liście — grupujemy je po nazwie
const byClass = (rows) => rows.sort((x, y) => classOrder(y.carClass) - classOrder(x.carClass) || String(x.carClass ?? '').localeCompare(String(y.carClass ?? '')));

function RacePenalties({ b, race, reload }) {
  const [f, setF] = useState({ driver_id: '', type: 'time', value: 5, license_points: 0, reason: '' });
  const results = b.results.filter((r) => r.race_id === race.id);
  if (!results.length) return html`<div class="empty">Najpierw wpisz wyniki wyścigu (krok 1).</div>`;
  // pojedyncze wydarzenie: bez punktów — bez kary „odjęcie punktów” i bez kolumn punktów
  const scored = seasonHasPoints(b.season);
  const types = scored ? PENALTY_TYPES : PENALTY_TYPES.filter((t) => t.id !== 'points');
  const multiClass = seasonStyle(b.season) === 'lmu';
  const racePens = b.penalties.filter((p) => p.race_id === race.id);
  const before = byClass(computeRaceByClass(race, b.season, b.results, []));
  const after = byClass(computeRaceByClass(race, b.season, b.results, b.penalties));
  const beforeBy = new Map(before.map((r) => [r.driver_id, r]));
  const nick = (id) => b.driverById.get(id)?.nick ?? '?';
  const selected = before.find((r) => r.driver_id === f.driver_id);
  const needsValue = f.type in VALUE_LABEL;
  const license = licenseTable(b);
  const driverPoints = license.find((r) => r.driver_id === f.driver_id)?.points ?? 0;

  const add = async (e) => {
    e.preventDefault();
    if (!f.driver_id) return;
    const points = Math.max(0, Math.round(Number(f.license_points) || 0));
    if (f.type === 'license' && !points) return alert('Podaj liczbę punktów karnych');
    const row = {
      race_id: race.id, driver_id: f.driver_id, type: f.type, value: needsValue ? Number(f.value) || 0 : 0, reason: f.reason.trim(),
      ...(points ? { license_points: points } : {}), // kolumna dochodzi w aktualizacji bazy — zwykłe kary działają też bez niej
    };
    if (await attempt(() => db.insert('penalties', row), `Nałożono karę: ${nick(f.driver_id)} ${penaltyLabel(row)}`)) {
      setF({ ...f, driver_id: '', reason: '', license_points: 0 });
      reload();
    }
  };
  const remove = async (p) => {
    if (!confirm(`Cofnąć karę ${penaltyLabel(p)} dla ${nick(p.driver_id)}?`)) return;
    if (await attempt(() => db.remove('penalties', p.id), 'Kara cofnięta')) reload();
  };

  return html`
    <form class="subform" onSubmit=${add}>
      <b>Nałóż karę</b>
      <div class="form-grid">
        <label class="field"><span>Kierowca</span>
          <select required value=${f.driver_id} onChange=${(e) => setF({ ...f, driver_id: e.target.value })}>
            <option value="">— wybierz —</option>
            ${before.map((r) => html`<option value=${r.driver_id}>${multiClass ? `[${r.carClass}] ` : ''}${r.finalPos ? `P${r.finalPos}` : r.status} · ${nick(r.driver_id)}</option>`)}
          </select>
        </label>
        <label class="field"><span>Rodzaj kary</span>
          <select value=${f.type} onChange=${(e) => setF({ ...f, type: e.target.value })}>
            ${types.map((t) => html`<option value=${t.id}>${t.label}</option>`)}
          </select>
        </label>
        ${needsValue ? html`<label class="field"><span>${VALUE_LABEL[f.type]}</span>
          <input type="number" min="0" step=${f.type === 'time' ? '0.5' : '1'} value=${f.value} onInput=${(e) => setF({ ...f, value: e.target.value })} />
        </label>` : null}
        <label class="field"><span>Punkty karne</span>
          <input type="number" min="0" step="1" value=${f.license_points} onInput=${(e) => setF({ ...f, license_points: e.target.value })} />
          <small class="muted">${f.driver_id ? `${nick(f.driver_id)}: ${driverPoints} w sezonie` : 'Sumują się w sezonie, niezależnie od kary na wyścig'}</small>
        </label>
        <label class="field span2"><span>Uzasadnienie (widoczne publicznie)</span>
          <input value=${f.reason} onInput=${(e) => setF({ ...f, reason: e.target.value })} placeholder="np. Spowodowanie kolizji w zakręcie 1" />
        </label>
      </div>
      ${f.type === 'time' && selected && selected.time_ms == null && selected.status === 'FIN' ? html`<p class="hint warn">Ten kierowca nie ma wpisanego czasu — kara czasowa nie zmieni jego pozycji.</p>` : null}
      ${f.type === 'grid' ? html`<p class="hint">Kara na starcie jest informacyjna — uwzględnij ją w polu startowym kolejnego wyścigu.</p>` : null}
      <div class="form-actions"><button class="btn btn-accent">Nałóż karę</button></div>
    </form>

    <h3>Decyzje w tym wyścigu</h3>
    ${!racePens.length ? html`<p class="muted">Brak kar. Ten krok możesz pominąć.</p>` : html`<ul class="pen-list">
      ${racePens.map((p) => html`<li>
        <span class="badge badge-pen">${penaltyLabel(p)}</span>
        <b>${nick(p.driver_id)}</b>
        <span class="muted">${p.reason || '—'}</span>
        <button class="btn btn-xs btn-danger" onClick=${() => remove(p)}>Cofnij</button>
      </li>`)}
    </ul>`}

    ${license.length ? html`<h3>Punkty karne w sezonie</h3>
      <ul class="pen-list">
        ${license.map((r) => html`<li>
          <span class="badge badge-pen">${licenseLabel(r.points)}</span>
          <b>${nick(r.driver_id)}</b>
        </li>`)}
      </ul>` : null}

    <h3>Wynik po karach</h3>
    <div class="table-wrap"><table class="table">
      <thead><tr>${multiClass ? html`<th>Klasa</th>` : null}<th class="c">Poz</th><th class="c">Było</th><th>Kierowca</th>${scored ? html`<th class="r">Pkt przed</th><th class="r">Pkt po</th>` : null}</tr></thead>
      <tbody>
        ${after.map((r) => {
          const was = beforeBy.get(r.driver_id);
          const changed = was.finalPos !== r.finalPos || (scored && was.points !== r.points) || was.status !== r.status;
          return html`<tr class=${changed ? 'row-changed' : ''}>
            ${multiClass ? html`<td>${r.carClass}</td>` : null}
            <td class="c"><${PosBadge} pos=${r.finalPos} status=${r.status} /></td>
            <td class="c muted">${was.finalPos ?? was.status}</td>
            <td>${nick(r.driver_id)} ${r.penalties.map((p) => html`<span class="badge badge-pen">${penaltyLabel(p)}</span>`)}</td>
            ${scored ? html`<td class="r muted">${was.points}</td><td class="r pts">${r.points}</td>` : null}
          </tr>`;
        })}
      </tbody>
    </table></div>
  `;
}

// ---------- krok 3: podsumowanie i zatwierdzenie ----------

function RaceSummary({ b, race, nav, reload }) {
  const results = b.results.filter((r) => r.race_id === race.id);
  const pens = b.penalties.filter((p) => p.race_id === race.id);
  const sprint = isSprint(race);
  // zmiany w składach od kolejnej rundy — robi się je w kafelku „Składy”
  const hasNextRound = !sprint && b.races.some((r) => r.round === race.round + 1);
  const changes = b.rosterChanges.filter((c) => c.from_round === race.round + 1);
  const done = race.status === 'completed';
  const idx = b.sessions.findIndex((r) => r.id === race.id);
  const next = b.sessions[idx + 1] || null; // po sprincie — wyścig główny tej rundy
  const nextName = (r) => (isSprint(r) ? `sprintu rundy ${r.round}` : `rundy ${r.round}`);
  const thisName = sprint ? `sprint rundy ${race.round}` : `rundę ${race.round}`;
  const multiClass = seasonStyle(b.season) === 'lmu';
  const nick = (id) => b.driverById.get(id)?.nick ?? '?';
  const scored = seasonHasPoints(b.season);

  const rows = byClass(computeRaceByClass(race, b.season, b.results, b.penalties));
  // klasyfikacja po tej rundzie (ten wyścig liczony tak, jakby był już zatwierdzony)
  const upto = b.sessions.slice(0, idx + 1).map((r) => (r.id === race.id ? { ...r, status: 'completed' } : r));
  const sb = { ...b, races: upto.filter((r) => !isSprint(r)), sprints: upto.filter(isSprint) };
  const st = computeStandings(sb);
  // liga LMU: klasyfikacja osobno w każdej klasie (jak na stronie)
  const classTables = multiClass ? seasonClasses(b.season).map((cls) => ({ cls, st: computeStandings(classBundle(sb, cls)) })) : [];

  const approve = async () => {
    if (await attempt(() => db.update('races', race.id, { status: 'completed' }), `${sessionLabel(race)} — zatwierdzono i opublikowano`)) {
      reload();
      if (next) nav(next.id, 'wyniki');
    }
  };
  const unapprove = async () => {
    if (!confirm('Cofnąć zatwierdzenie? Wyniki znikną ze strony publicznej do czasu ponownego zatwierdzenia.')) return;
    if (await attempt(() => db.update('races', race.id, { status: 'scheduled' }), 'Zatwierdzenie cofnięte')) reload();
  };

  return html`
    <div class="checklist">
      <div class=${results.length ? 'ok' : 'bad'}>${results.length ? '✓' : '✕'} Wyniki: ${results.length} kierowców</div>
      <div class="ok">⚖️ Kary: ${pens.length || 'brak'}</div>
      ${hasNextRound ? html`<div class="ok">🔁 Zmiany w składzie od R${race.round + 1}: ${changes.length || 'brak'} <button type="button" class="btn btn-xs" onClick=${() => nav('sklady', String(race.round + 1))}>Składy →</button></div>` : null}
    </div>

    ${!results.length ? html`<div class="empty">Bez wyników nie można zatwierdzić wyścigu.</div>` : html`
      <div class=${scored ? 'summary-grid' : ''}>
        <div>
          <h3>Wynik końcowy (po karach)</h3>
          <div class="table-wrap"><table class="table">
            <thead><tr>${multiClass ? html`<th>Kl.</th>` : null}<th class="c">Poz</th><th>Kierowca</th><th>${seasonUnit(b.season).one}</th>${scored ? html`<th class="r">Pkt</th>` : null}</tr></thead>
            <tbody>${rows.map((r) => html`<tr>
              ${multiClass ? html`<td>${r.carClass}</td>` : null}
              <td class="c"><${PosBadge} pos=${r.finalPos} status=${r.status} /></td>
              <td>${nick(r.driver_id)} ${r.penalties.map((p) => html`<span class="badge badge-pen">${penaltyLabel(p)}</span>`)}</td>
              <td><${TeamTag} team=${b.teamById.get(r.team_id)} link=${false} /></td>
              ${scored ? html`<td class="r pts">${r.points}</td>` : null}
            </tr>`)}</tbody>
          </table></div>
        </div>
        ${scored ? html`<div>
          <h3>Klasyfikacja po: ${sessionLabel(race)}</h3>
          ${multiClass ? classTables.map(({ cls, st: cst }) => html`
            <div class="eyebrow">${carClass(cls)?.label ?? cls}</div>
            <div class="table-wrap"><table class="table">
              <tbody>${cst.drivers.slice(0, 5).map((d, i) => html`<tr><td class="c">${i + 1}</td><td>${nick(d.driver_id)}</td><td class="r pts">${d.points}</td></tr>`)}</tbody>
            </table></div>`) : html`
            <div class="table-wrap"><table class="table">
              <thead><tr><th class="c">P</th><th>Kierowca</th><th class="r">Pkt</th></tr></thead>
              <tbody>${st.drivers.slice(0, 10).map((d, i) => html`<tr><td class="c">${i + 1}</td><td>${nick(d.driver_id)}</td><td class="r pts">${d.points}</td></tr>`)}</tbody>
            </table></div>
            <h3>Konstruktorzy</h3>
            <div class="table-wrap"><table class="table">
              <tbody>${st.teams.slice(0, 5).map((t, i) => html`<tr><td class="c">${i + 1}</td><td><${TeamTag} team=${b.teamById.get(t.team_id)} link=${false} /></td><td class="r pts">${t.points}</td></tr>`)}</tbody>
            </table></div>`}
        </div>` : null}
      </div>

      <div class="approve-bar">
        ${done ? html`
          <span class="badge badge-ok">✓ Wyścig zatwierdzony i widoczny na stronie</span>
          <span class="spacer"></span>
          <button class="btn btn-danger" onClick=${unapprove}>Cofnij zatwierdzenie</button>
          ${next ? html`<button class="btn btn-accent" onClick=${() => nav(next.id, 'wyniki')}>Przejdź do ${nextName(next)} →</button>` : null}
        ` : html`
          <span class="muted">Zatwierdzenie publikuje wyniki na stronie i wlicza je do klasyfikacji. Kary i składy możesz zmieniać także później.</span>
          <span class="spacer"></span>
          <button class="btn btn-accent btn-big" onClick=${approve}>✓ Zatwierdź ${thisName}${next ? ` i przejdź do ${nextName(next)}` : ''}</button>
        `}
      </div>
    `}
  `;
}
