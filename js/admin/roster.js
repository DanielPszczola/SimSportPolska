import { useState } from '../../vendor/preact-htm.js';
import { db } from '../db.js';
import { html, Flag, TeamLogo, attempt, shortDate } from '../ui.js';
import { carClass, seasonClasses, seasonStyle } from '../scoring.js';
import { lineupAt, teamSeats, reserveSeats } from '../lineup.js';

// Kafelki „Składy” na osi sezonu — przed każdą rundą od 2.: zmiany w zespołach (LMU: zmiany aut) w dowolnym momencie
// sezonu, także między wyścigami, a nie tylko przy wpisywaniu wyników. Każda zmiana obowiązuje od wybranej rundy (roster_changes.from_round);
// skład na pierwszą rundę ustala się w kafelku „Start sezonu”.

/** Rundy, od których można wprowadzić zmianę: od 2. rundy (wyścigi główne). */
export const changeRounds = (b) => b.races.filter((r) => r.round > 1);

/** Czy w rundzie są już wyniki (wyścig główny albo sprint). */
const roundPlayed = (b, round) => b.sessions.some((s) => s.round === round && (s.status === 'completed' || b.results.some((x) => x.race_id === s.id)));

/** Domyślna runda zmian: najbliższa runda bez wyników, a gdy wszystkie rozegrane — ostatnia. */
export function defaultChangeRound(b) {
  const rounds = changeRounds(b);
  return (rounds.find((r) => !roundPlayed(b, r.round)) || rounds[rounds.length - 1])?.round ?? null;
}

export function RosterPanel({ b, round, nav, reload }) {
  const rounds = changeRounds(b);
  const lmu = seasonStyle(b.season) === 'lmu';
  const race = rounds.find((r) => r.round === round);
  const prev = b.races.find((r) => r.round === round - 1);
  const played = rounds.filter((r) => r.round >= round && roundPlayed(b, r.round));
  const changes = [...b.rosterChanges].sort((x, y) => x.from_round - y.from_round);
  const pick = (r) => nav('sklady', String(r));
  const undo = async (c) => (await attempt(() => db.remove('roster_changes', c.id), 'Zmiana cofnięta — skład wrócił do poprzedniego stanu')) && reload();
  const trackName = (r) => b.trackById.get(r?.track_id)?.name ?? '?';
  const d = shortDate(race?.race_date);

  return html`<section class="panel">
    <div class="panel-head">
      <div class="panel-title">
        <${Flag} code=${b.trackById.get(race?.track_id)?.country_code} size=${36} />
        <div>
          <span class="eyebrow">Między wyścigami · po R${round - 1} ${trackName(prev)}</span>
          <h2>${lmu ? 'Auta' : 'Składy'} od rundy ${round}</h2>
          <div class="muted">R${round} · ${trackName(race)}${race?.race_date ? ` · ${d.day} ${d.month}` : ''}</div>
        </div>
      </div>
    </div>
    <div class="panel-body">
      ${!race ? html`<div class="empty">Nie ma takiej rundy w kalendarzu.</div>` : html`
        <p class="muted">Zmiana zapisana tutaj obowiązuje od rundy ${round} do końca sezonu (albo do kolejnej zmiany). Wyniki wcześniejszych wyścigów zostają bez zmian:
          punkty zespołu zostają przy zespole, a punkty indywidualne przy kierowcy. Zastępstwo na jeden wyścig wpisuje się w wynikach tego wyścigu — bez zmiany składu.</p>
        ${played.length ? html`<p class="hint warn">Runda ${played[0].round}${played.length > 1 ? ' i kolejne' : ''} ma już wpisane wyniki. Zmiana od rundy ${round} zmieni skład, w którym te wyścigi zostały przejechane (także podział punktów ${lmu ? 'między auta' : 'zespołowych'}) — używaj tego tylko do poprawiania błędów.</p>` : null}
        ${lmu
          ? html`<${CarChanges} key=${round} b=${b} round=${round} reload=${reload} />`
          : html`<${TeamChanges} key=${round} b=${b} round=${round} reload=${reload} />`}

        <h3>Wszystkie zmiany w sezonie</h3>
        ${changes.length ? html`<ul class="roster-log">
          ${changes.map((c) => html`<li class=${c.from_round === round ? 'current' : ''}>
            <button type="button" class="roster-round link-btn" onClick=${() => pick(c.from_round)} title="Pokaż skład od tej rundy">od R${c.from_round}</button>
            <${ChangeText} b=${b} c=${c} lmu=${lmu} />
            ${c.note ? html`<span class="muted">${c.note}</span>` : null}
            <button class="btn btn-xs btn-danger" onClick=${() => undo(c)}>Cofnij</button>
          </li>`)}
        </ul>` : html`<p class="muted">Brak zmian — wszyscy jeżdżą w składzie ze startu sezonu.</p>`}
      `}
    </div>
  </section>`;
}

function ChangeText({ b, c, lmu }) {
  const nick = (id) => b.driverById.get(id)?.nick ?? '?';
  const team = b.teamById.get(c.team_id)?.name ?? '?';
  if (lmu) return html`<span>${c.driver_in_id ? html`<b class="in">${nick(c.driver_in_id)}</b> → ${team}` : html`<b class="out">${nick(c.driver_out_id)}</b> → bez auta`}</span>`;
  return html`<span><b>${team}</b>:
    ${c.driver_in_id ? html`<b class="in">▲ ${nick(c.driver_in_id)}</b>` : null}
    ${c.driver_in_id && c.driver_out_id ? ' za ' : ''}
    ${c.driver_out_id ? html`<b class="out">▼ ${nick(c.driver_out_id)}</b>${c.driver_in_id ? '' : ' → rezerwa'}` : null}
  </span>`;
}

/** Liga LMU: zmiana auta kierowcy od wybranej rundy (bez limitu miejsc — jednym modelem jedzie dowolnie wielu kierowców). */
function CarChanges({ b, round, reload }) {
  const before = lineupAt(b.entries, b.rosterChanges, round - 1);
  const after = lineupAt(b.entries, b.rosterChanges, round);
  const nick = (id) => b.driverById.get(id)?.nick ?? '?';
  const carName = (id) => b.teamById.get(id)?.name ?? 'bez auta';
  const classes = seasonClasses(b.season);
  const drivers = [...after.values()].sort((x, y) => nick(x.driver_id).localeCompare(nick(y.driver_id)));

  const change = async (driverId, carId) => {
    const prev = after.get(driverId)?.team_id || null;
    if ((carId || null) === prev) return;
    // zmiana auta = wpis "wchodzi do auta"; zdjęcie z auta = wpis "schodzi z auta"
    const row = carId
      ? { team_id: carId, driver_in_id: driverId, driver_out_id: null }
      : { team_id: prev, driver_in_id: null, driver_out_id: driverId };
    if (await attempt(() => db.insert('roster_changes', { season_id: b.season.id, from_round: round, note: '', ...row }),
      `${nick(driverId)}: ${carName(carId)} od rundy ${round}`)) reload();
  };

  return html`
    <h3>Auta kierowców</h3>
    <div class="table-wrap"><table class="table edit-table">
      <thead><tr><th>Kierowca</th><th>Auto w rundzie ${round - 1}</th><th>Auto od rundy ${round}</th></tr></thead>
      <tbody>${drivers.map((s) => html`<tr class=${s.team_id !== (before.get(s.driver_id)?.team_id ?? null) ? 'row-changed' : ''}>
        <td><b>${nick(s.driver_id)}</b></td>
        <td class="muted">${carName(before.get(s.driver_id)?.team_id)}</td>
        <td><select value=${s.team_id || ''} onChange=${(e) => change(s.driver_id, e.target.value)}>
          <option value="">— bez auta —</option>
          ${classes.map((cls) => html`<optgroup label=${carClass(cls)?.label}>${b.teams.filter((x) => x.car_class === cls).map((x) => html`<option value=${x.id}>${x.name}</option>`)}</optgroup>`)}
        </select></td>
      </tr>`)}</tbody>
    </table></div>
  `;
}

/** Ligi z zespołami (F1, serie Eventów): zamiana kierowcy, transfer, rezerwa — od wybranej rundy. */
function TeamChanges({ b, round, reload }) {
  const after = lineupAt(b.entries, b.rosterChanges, round);
  const myChanges = b.rosterChanges.filter((c) => c.from_round === round);
  const [edit, setEdit] = useState(null); // { team_id, out_id | null }
  const [inId, setInId] = useState('');
  const [note, setNote] = useState('');
  const [newReserve, setNewReserve] = useState('');
  const nick = (id) => b.driverById.get(id)?.nick ?? '?';
  const teamName = (id) => b.teamById.get(id)?.name ?? '?';
  const seatsPerTeam = Math.max(1, ...b.teams.map((t) => teamSeats(lineupAt(b.entries, [], 1), t.id).length));

  const record = async (row, msg) => {
    const ok = await attempt(() => db.insert('roster_changes', { season_id: b.season.id, from_round: round, note: note.trim(), ...row }), msg);
    if (ok) {
      setEdit(null);
      setInId('');
      setNote('');
      reload();
    }
  };
  const confirmEdit = () => {
    if (!inId) return;
    record({ team_id: edit.team_id, driver_out_id: edit.out_id || null, driver_in_id: inId },
      edit.out_id ? `${nick(inId)} za ${nick(edit.out_id)} w ${teamName(edit.team_id)} od R${round}` : `${nick(inId)} dołącza do ${teamName(edit.team_id)} od R${round}`);
  };
  const toReserve = (teamId, driverId) => {
    if (!confirm(`${nick(driverId)} schodzi do rezerwy od rundy ${round}? Jego dotychczasowe wyniki zostają.`)) return;
    record({ team_id: teamId, driver_out_id: driverId, driver_in_id: null }, `${nick(driverId)} przechodzi do rezerwy od R${round}`);
  };
  const addReserve = async (e) => {
    e.preventDefault();
    if (!newReserve) return;
    if (await attempt(() => db.insert('entries', { season_id: b.season.id, driver_id: newReserve, team_id: null, is_reserve: true }), 'Dodano do rezerwy')) {
      setNewReserve('');
      reload();
    }
  };

  const reserves = reserveSeats(after);
  const candidates = edit ? [
    ...reserves.map((s) => ({ id: s.driver_id, label: `${nick(s.driver_id)} — rezerwa` })),
    ...[...after.values()].filter((s) => s.team_id && s.team_id !== edit.team_id).map((s) => ({ id: s.driver_id, label: `${nick(s.driver_id)} — transfer z ${teamName(s.team_id)}` })),
  ] : [];
  const outsiders = b.drivers.filter((d) => !after.has(d.id));

  return html`
    <h3>Skład zespołów</h3>
    <div class="lineup-grid">
      ${b.teams.map((t) => {
        const ts = teamSeats(after, t.id);
        return html`<div class="lineup-team" style=${{ '--team': t.color || '#888' }}>
          <div class="lineup-team-head"><${TeamLogo} team=${t} size=${28} /> <b>${t.name}</b></div>
          <ul>
            ${ts.map((s) => html`<li>
              <span class="lineup-driver">${myChanges.some((c) => c.driver_in_id === s.driver_id) ? html`<b class="in">▲</b>` : null} ${nick(s.driver_id)}</span>
              <button class="btn btn-xs icon-btn" onClick=${() => { setEdit({ team_id: t.id, out_id: s.driver_id }); setInId(''); }} title="Zamień kierowcę" aria-label="Zamień kierowcę">⇄</button>
              <button class="btn btn-xs icon-btn" onClick=${() => toReserve(t.id, s.driver_id)} title="Przenieś do rezerwy" aria-label="Przenieś do rezerwy">⤓ R</button>
            </li>`)}
          </ul>
          ${ts.length < seatsPerTeam ? html`<button class="btn btn-xs btn-accent" onClick=${() => { setEdit({ team_id: t.id, out_id: null }); setInId(''); }}>+ Wolne miejsce — dodaj kierowcę</button>` : null}
          ${edit?.team_id === t.id ? html`<div class="swap-box">
            <b>${edit.out_id ? `Za: ${nick(edit.out_id)}` : 'Nowy kierowca'}</b>
            <select value=${inId} onChange=${(e) => setInId(e.target.value)}>
              <option value="">— kto wchodzi? —</option>
              ${candidates.map((c) => html`<option value=${c.id}>${c.label}</option>`)}
              ${outsiders.length ? html`<optgroup label="Spoza składu sezonu">${outsiders.map((d) => html`<option value=${d.id}>${d.nick}</option>`)}</optgroup>` : null}
            </select>
            <input placeholder="Powód (opcjonalnie, widoczny publicznie)" value=${note} onInput=${(e) => setNote(e.target.value)} />
            <div class="form-actions">
              <button class="btn btn-sm btn-accent" onClick=${confirmEdit} disabled=${!inId}>Zapisz zmianę</button>
              <button class="btn btn-sm" onClick=${() => setEdit(null)}>Anuluj</button>
            </div>
          </div>` : null}
        </div>`;
      })}
      <div class="lineup-team lineup-reserve">
        <div class="lineup-team-head"><span class="badge badge-reserve">Rezerwa</span> <b>${reserves.length}</b></div>
        <ul>${reserves.map((s) => html`<li><span class="lineup-driver">${myChanges.some((c) => c.driver_out_id === s.driver_id) ? html`<b class="out">▼</b>` : null} ${nick(s.driver_id)}</span></li>`)}</ul>
        <form class="inline-form" onSubmit=${addReserve}>
          <select value=${newReserve} onChange=${(e) => setNewReserve(e.target.value)}>
            <option value="">— dodaj kierowcę do rezerwy —</option>
            ${outsiders.map((d) => html`<option value=${d.id}>${d.nick}</option>`)}
          </select>
          <button class="btn btn-xs" disabled=${!newReserve}>+ Dodaj</button>
        </form>
      </div>
    </div>
  `;
}
