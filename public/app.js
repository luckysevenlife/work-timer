(() => {
'use strict';

/* ------------------------------------------------------------------
   Lucky's Work Timer
   All data lives in localStorage and, once you have a save code,
   is also synced to /api so it follows you to any device.
------------------------------------------------------------------- */

const STORE = 'lwt.v1';
const API = 'api';
const RESET_H = 2;                 // the day rolls over at 2 AM
const AWAY = 15 * 60e3;            // gap that triggers "count it?"
const BEAT = 30e3;                 // "still here" heartbeat
const IDLE = 3 * 3600e3;           // no clicks for this long at 2 AM = stop
const HOUR_PX = 46;                // keep in sync with --hour in style.css
const DEFAULT_GOAL = 4 * 3600;
const REASONS = ['Break', 'Food', 'Phone', 'Done'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOWS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l13-7.5a1 1 0 0 0 0-1.72l-13-7.5A1 1 0 0 0 7 4.5z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="5" height="16" rx="1.2"/><rect x="14" y="4" width="5" height="16" rx="1.2"/></svg>';
const ICON_GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

const app = document.getElementById('app');

/* ---------- tiny DOM helper ---------- */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const k in props || {}) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;          // only ever used with the icon constants above
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid);
  return el;
}

/* ---------- state ---------- */
function fresh() {
  return { v: 1, code: null, goal: null, goalU: 0, started: null, days: {}, run: null };
}
function load() {
  try {
    const j = JSON.parse(localStorage.getItem(STORE));
    if (j && j.v === 1 && j.days && typeof j.days === 'object') return Object.assign(fresh(), j);
  } catch (e) { /* storage blocked or empty */ }
  return fresh();
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* ignore */ }
}
let S = load();

/* ---------- time helpers ---------- */
const pad = (n) => String(n).padStart(2, '0');
const fmtKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const keyOf = (ts) => fmtKey(new Date(ts - RESET_H * 3600e3));
function dateOf(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(key, n) { const d = dateOf(key); d.setDate(d.getDate() + n); return fmtKey(d); }
function weekStart(key) { const d = dateOf(key); d.setDate(d.getDate() - d.getDay()); return fmtKey(d); }
const todayKey = () => keyOf(Date.now());
const activeDay = () => (S.run ? S.run.day : todayKey());

function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  return `${Math.floor(sec / 3600)}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}`;
}
function fmtDur(sec) {
  sec = Math.max(0, Math.floor(sec));
  const hh = Math.floor(sec / 3600), mm = Math.floor(sec / 60) % 60;
  if (hh && mm) return `${hh}h ${mm}m`;
  if (hh) return `${hh}h`;
  if (mm) return `${mm}m`;
  return sec > 0 ? '<1m' : '0m';
}
const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function hourLabel(hr) { const x = ((hr % 24) + 24) % 24; return `${x % 12 === 0 ? 12 : x % 12} ${x < 12 ? 'AM' : 'PM'}`; }
const shortDate = (key) => { const d = dateOf(key); return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`; };

/* ---------- day math ---------- */
function day(key, create) {
  let d = S.days[key];
  if (!d && create) d = S.days[key] = { segs: [], adj: 0, note: '', rest: false, g: S.goal || DEFAULT_GOAL, u: Date.now() };
  return d;
}
function total(key, now = Date.now()) {
  const d = S.days[key];
  let ms = 0;
  if (d) { for (const x of d.segs) ms += x.e - x.s; ms += (d.adj || 0) * 1000; }
  if (S.run && S.run.day === key) ms += now - S.run.s;
  return Math.max(0, Math.floor(ms / 1000));
}
function segsOf(key, now = Date.now()) {
  const d = S.days[key];
  const a = d ? d.segs.map((x) => ({ s: x.s, e: x.e, r: x.r })) : [];
  if (S.run && S.run.day === key) a.push({ s: S.run.s, e: now, live: true });
  return a.sort((x, y) => x.s - y.s);
}
const goalOf = (key) => (S.days[key] && S.days[key].g) || S.goal || DEFAULT_GOAL;
const breaksOf = (key) => Math.max(0, segsOf(key).length - 1);

// green = hit goal, yellow = worked but missed, red = no work, rest = rest day, '' = nothing to show
function status(key) {
  const today = todayKey();
  if (key > today || !S.started || key < S.started) return '';
  const t = total(key), d = S.days[key];
  if (t >= goalOf(key)) return 'green';
  if (d && d.rest) return 'rest';
  if (t > 0) return 'yellow';
  return key === today ? '' : 'red';
}

/* ---------- timer actions ---------- */
let askReason = null;        // { day, s } of the session that was just paused
let awayOpen = false;
let lastTouch = Date.now();

function touch() { save(); queueSync(); }

function start() {
  if (S.run) return;
  if (S.goal == null) return goalModal(true);
  const now = Date.now(), key = keyOf(now);
  S.run = { s: now, seen: now, day: key };
  if (!S.started || key < S.started) S.started = key;
  day(key, true);
  askReason = null;
  save();
  render();
}
function stop(at = Date.now(), ask = true) {
  if (!S.run) return;
  const r = S.run, d = day(r.day, true);
  if (at > r.s) d.segs.push({ s: r.s, e: at });
  d.u = Date.now();
  S.run = null;
  askReason = ask && at > r.s ? { day: r.day, s: r.s } : null;
  touch();
  render();
}
function toggle() { S.run ? stop() : start(); }

function setReason(reason) {
  if (!askReason) return;
  const d = S.days[askReason.day];
  const seg = d && d.segs.find((x) => x.s === askReason.s);
  if (!seg) return;
  seg.r = seg.r === reason ? undefined : reason;
  d.u = Date.now();
  touch();
  render();
}

function adjust(deltaSec) {
  const key = activeDay(), d = day(key, true);
  const cur = total(key), next = Math.max(0, cur + deltaSec);
  if (next === cur) return;
  d.adj = (d.adj || 0) + (next - cur);
  d.u = Date.now();
  if (!S.started || key < S.started) S.started = key;
  touch();
  paintTimer(true);
}

/* ---------- away / closed-tab handling ---------- */
function checkAway(now) {
  if (!S.run) return;
  const r = S.run;
  const rolled = keyOf(now) !== r.day;
  const gap = now - r.seen;

  if (gap > AWAY) {
    if (rolled) {                       // gone past the 2 AM reset: stop where they left off
      closeModal();
      awayOpen = false;
      stop(r.seen, false);
      toast(`Timer stopped at ${fmtTime(r.seen)} because you were away.`);
    } else if (!awayOpen) {
      awayModal(gap);
    }
    return;
  }
  if (rolled && now - lastTouch > IDLE) { // tab left open overnight, nobody here
    const cut = dateOf(addDays(r.day, 1)).getTime() + RESET_H * 3600e3;
    stop(Math.max(r.s, Math.min(cut, now)), false);
    toast('Timer stopped at 2 AM because nobody was here.');
    return;
  }
  if (!awayOpen && gap >= BEAT) { r.seen = now; save(); }
}

function awayModal(gap) {
  awayOpen = true;
  const seen = S.run.seen;
  openModal(h('div', { class: 'modal' },
    h('h2', null, 'Were you working?'),
    h('p', null, 'The timer was running while you were away for ', h('b', null, fmtDur(gap / 1000)), '. Count it?'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => { awayOpen = false; closeModal(); stop(seen, false); } }, 'No'),
      h('button', { class: 'btn light', onclick: () => { awayOpen = false; if (S.run) { S.run.seen = Date.now(); save(); } closeModal(); } }, 'Yes'))
  ), false);
}

/* ---------- sync ---------- */
let syncT = null;
const exportData = () => ({ v: 1, goal: S.goal, goalU: S.goalU, started: S.started, days: S.days });

function merge(remote) {
  if (!remote || typeof remote !== 'object') return;
  const days = remote.days && typeof remote.days === 'object' ? remote.days : {};
  for (const k in days) {
    const r = days[k], l = S.days[k];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !r || !Array.isArray(r.segs)) continue;
    if (!l || (r.u || 0) > (l.u || 0)) S.days[k] = r;
  }
  if (typeof remote.goal === 'number' && (remote.goalU || 0) > (S.goalU || 0)) { S.goal = remote.goal; S.goalU = remote.goalU; }
  if (S.goal == null && typeof remote.goal === 'number') { S.goal = remote.goal; S.goalU = remote.goalU || 0; }
  if (remote.started && (!S.started || remote.started < S.started)) S.started = remote.started;
}
function push(keepalive) {
  return fetch(`${API}/data?code=${encodeURIComponent(S.code)}`, {
    method: 'PUT', keepalive: !!keepalive,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(exportData()),
  });
}
async function syncNow() {
  clearTimeout(syncT); syncT = null;
  if (!S.code) return;
  try {
    const r = await fetch(`${API}/data?code=${encodeURIComponent(S.code)}`);
    if (r.ok) { const j = await r.json(); merge(j.data); save(); }
    await push();
  } catch (e) { /* offline: local copy is still safe, try again next change */ }
}
function queueSync() {
  if (!S.code) return;
  clearTimeout(syncT);
  syncT = setTimeout(syncNow, 3000);
}

const OFFLINE_MSG = "Couldn't save online right now. Your data is still saved on this device.";

async function submitName(raw, say) {
  const v = String(raw || '').trim();
  if (!v) return;
  if (/^[a-z]{1,12}\d{4}$/i.test(v)) return loadCode(v, say);
  const name = v.replace(/[^a-z]/gi, '').slice(0, 12);
  if (!name) return say('Type your name using letters.');
  say('Saving…');
  try {
    const r = await fetch(`${API}/claim`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, data: exportData() }),
    });
    const j = await r.json();
    if (!r.ok || !j.code) throw new Error('claim failed');
    S.code = j.code;
    save();
    render();
    codeModal();
  } catch (e) { say(OFFLINE_MSG); }
}
async function loadCode(code, say) {
  say('Loading…');
  try {
    const r = await fetch(`${API}/data?code=${encodeURIComponent(code)}`);
    if (r.status === 404) return say('No data found for that code. Check the spelling.');
    const j = await r.json();
    if (!r.ok || !j.code) throw new Error('load failed');
    merge(j.data);
    S.code = j.code;
    save();
    closeModal();
    render();
    toast(`Loaded ${j.code}.`);
    push().catch(() => {});
  } catch (e) { say("Couldn't load right now. Check your connection and try again."); }
}

/* ---------- modal + toast ---------- */
let veil = null;
function openModal(content, dismissible = true) {
  closeModal();
  veil = h('div', { class: 'veil', onclick: (e) => { if (dismissible && e.target === veil) closeModal(); } }, content);
  veil.dataset.dismiss = dismissible ? '1' : '';
  document.body.append(veil);
  const f = content.querySelector('[data-focus]') || content.querySelector('button.light');
  if (f) f.focus();
}
function closeModal() { if (veil) { veil.remove(); veil = null; } }

let toastEl = null, toastT = null;
function toast(msg) {
  if (toastEl) toastEl.remove();
  toastEl = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(toastEl);
  clearTimeout(toastT);
  toastT = setTimeout(() => { if (toastEl) toastEl.remove(); toastEl = null; }, 5000);
}

async function copyText(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
  } catch (e) {
    const ta = h('textarea', { class: 'note', readOnly: true, value: text, 'data-focus': '1' });
    openModal(h('div', { class: 'modal' },
      h('h2', null, 'Copy this'),
      h('p', null, 'Select all of it and copy.'),
      ta,
      h('div', { class: 'row' }, h('button', { class: 'btn light', onclick: closeModal }, 'Done'))));
    ta.select();
  }
}

function stepper(getV, setV) {
  const out = h('b', null, fmtDur(getV()));
  const bump = (d) => { setV(Math.min(16 * 3600, Math.max(1800, getV() + d))); out.textContent = fmtDur(getV()); };
  return h('div', { class: 'stepper' },
    h('button', { type: 'button', 'aria-label': 'Less', onclick: () => bump(-1800) }, '−'),
    out,
    h('button', { type: 'button', 'aria-label': 'More', onclick: () => bump(1800) }, '+'));
}

function setGoal(sec) {
  S.goal = sec;
  S.goalU = Date.now();
  const d = S.days[todayKey()];
  if (d) { d.g = sec; d.u = Date.now(); }
}

function goalModal(thenStart) {
  let g = S.goal || DEFAULT_GOAL;
  openModal(h('div', { class: 'modal' },
    h('h2', null, 'How much real work today?'),
    h('p', null, 'This is your daily goal. You can change it anytime.'),
    stepper(() => g, (v) => { g = v; }),
    h('div', { class: 'row' },
      h('button', { class: 'btn light', onclick: () => { setGoal(g); save(); closeModal(); if (thenStart) start(); else render(); } }, thenStart ? 'Start' : 'Save'))));
}

function codeModal() {
  openModal(h('div', { class: 'modal' },
    h('h2', null, 'Your code is'),
    h('div', { class: 'bigcode' }, S.code),
    h('p', null, 'Save it. Type it in on any device to get your data back.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => copyText(S.code, 'Code copied.') }, 'Copy code'),
      h('button', { class: 'btn light', onclick: closeModal }, 'Done'))));
}

function saveForm(placeholder, button, where = 'page') {
  const msg = h('small', { role: 'status' });
  const input = h('input', { class: 'field', id: `name-${where}-${button.toLowerCase()}`, placeholder, autocomplete: 'off', autocapitalize: 'words', spellcheck: false, maxLength: 20, 'aria-label': placeholder });
  const form = h('form', { onsubmit: (e) => { e.preventDefault(); submitName(input.value, (t) => { msg.textContent = t; }); } },
    input, h('button', { class: 'btn', type: 'submit' }, button));
  return [form, msg];
}

function settingsModal() {
  let g = S.goal || DEFAULT_GOAL;
  const codeSect = S.code
    ? h('div', { class: 'sect' },
        h('label', null, 'Your code'),
        h('div', { class: 'bigcode' }, S.code),
        h('span', { class: 'hint' }, 'Type it in on any device to get your data back.'),
        h('div', { class: 'row', style: 'justify-content:flex-start' },
          h('button', { class: 'btn small', onclick: () => copyText(S.code, 'Code copied.') }, 'Copy code')),
        h('label', { style: 'margin-top:8px' }, 'Have a different code?'),
        saveForm('Enter your code', 'Load', 'settings'))
    : h('div', { class: 'sect' },
        h('label', null, 'Save your data'),
        saveForm('Enter your name to save your data', 'Save', 'settings'),
        h('span', { class: 'hint' }, 'Already have a code? Type it in instead.'));
  openModal(h('div', { class: 'modal' },
    h('h2', null, 'Settings'),
    h('div', { class: 'sect' },
      h('label', null, 'Daily goal'),
      stepper(() => g, (v) => { g = v; setGoal(v); touch(); render(); })),
    codeSect,
    h('div', { class: 'row' }, h('button', { class: 'btn light', onclick: closeModal }, 'Done'))));
}

/* ---------- routing ---------- */
const VIEWS = ['timer', 'calendar', 'records'];
const currentView = () => { const v = location.hash.replace('#', ''); return VIEWS.includes(v) ? v : 'timer'; };
function go(v) { if (currentView() === v) render(); else location.hash = v; }

/* ---------- timer view ---------- */
let T = null; // live elements of the timer view

function viewTimer() {
  T = {
    clock: h('div', { class: 'clock', role: 'timer', 'aria-live': 'off' }),
    goal: h('div', { class: 'goal' }),
    play: h('button', { class: 'play', onclick: toggle }),
    last: {},
  };
  const adj = (label, sec) => h('button', { class: 'chip', onclick: () => adjust(sec), 'aria-label': `${sec < 0 ? 'Remove' : 'Add'} ${label.slice(1)}` }, label);

  let reasons = h('div', { class: 'reasons' });
  if (askReason && !S.run) {
    const d = S.days[askReason.day], seg = d && d.segs.find((x) => x.s === askReason.s);
    if (seg) reasons = h('div', { class: 'reasons' },
      h('span', null, 'Why did you pause?'),
      h('div', null, REASONS.map((r) => h('button', { class: 'chip' + (seg.r === r ? ' on' : ''), onclick: () => setReason(r) }, r))));
  }

  const saveBox = S.code
    ? h('div', { class: 'save' },
        h('div', { class: 'codeline' }, 'Your data is saved as ', h('b', null, S.code)),
        h('button', { class: 'btn small', onclick: () => copyText(S.code, 'Code copied.') }, 'Copy code'))
    : h('div', { class: 'save' },
        saveForm('Enter your name to save your data', 'Save'),
        h('span', { class: 'hint' }, 'Already have a code? Type it in instead.'));

  const el = h('section', { class: 'timer' },
    T.clock, T.goal, T.play,
    h('div', { class: 'adjust', role: 'group', 'aria-label': 'Adjust time' },
      adj('−30m', -1800), adj('−10m', -600), adj('−1m', -60), h('span', { class: 'gap' }),
      adj('+1m', 60), adj('+10m', 600), adj('+30m', 1800)),
    reasons, saveBox);
  paintTimer(true);
  return el;
}

function paintTimer(force) {
  const now = Date.now(), key = activeDay(), t = total(key, now);
  const text = fmtClock(t);
  const title = `${S.run ? '▶' : '⏸'} ${text} · Lucky's Work Timer`;
  if (document.title !== title) document.title = title;
  if (!T || currentView() !== 'timer') return;
  const L = T.last;
  if (force || L.text !== text) { T.clock.textContent = text; L.text = text; }
  const running = !!S.run;
  if (force || L.running !== running) {
    T.play.innerHTML = running ? ICON_PAUSE : ICON_PLAY;
    T.play.setAttribute('aria-label', running ? 'Pause' : 'Start');
    L.running = running;
  }
  const goal = S.goal == null ? null : goalOf(key);
  const pct = goal ? Math.min(100, Math.floor((t / goal) * 100)) : 0;
  const gk = `${goal}|${pct}`;
  if (force || L.gk !== gk) {
    L.gk = gk;
    T.goal.replaceChildren();
    if (goal) {
      T.goal.append(
        pct >= 100 ? h('span', null, h('b', null, 'Goal hit'), ` · ${fmtDur(goal)}`) : h('span', null, `Goal ${fmtDur(goal)}`),
        h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` })));
    }
  }
}

/* ---------- calendar ---------- */
const cal = { mode: 'month', cur: todayKey() };

function rangeStats(keys) {
  let sum = 0, worked = 0, hit = 0;
  for (const k of keys) {
    const t = total(k);
    sum += t;
    if (t > 0) worked++;
    if (status(k) === 'green') hit++;
  }
  return h('div', { class: 'stats' },
    h('div', { class: 'stat' }, h('span', null, 'Total'), h('b', null, fmtDur(sum))),
    h('div', { class: 'stat' }, h('span', null, 'Average per work day'), h('b', null, fmtDur(worked ? sum / worked : 0))),
    h('div', { class: 'stat' }, h('span', null, 'Days worked'), h('b', null, String(worked))),
    h('div', { class: 'stat' }, h('span', null, 'Goals hit'), h('b', null, String(hit))));
}

function legend() {
  const item = (cls, label) => h('span', null, h('i', { class: cls }), label);
  return h('div', { class: 'legend' },
    item('s-green', 'Hit goal'), item('s-yellow', 'Worked, missed goal'), item('s-red', "Didn't work"), item('s-rest', 'Rest day'));
}

function openDay(key) { cal.mode = 'day'; cal.cur = key; render(); }

function timeGrid(keys, week) {
  const now = Date.now(), today = todayKey();
  const all = keys.map((k) => segsOf(k, now));
  let lo = 8, hi = 18;
  keys.forEach((k, i) => {
    const base = dateOf(k).getTime();
    for (const x of all[i]) {
      lo = Math.min(lo, Math.floor((x.s - base) / 3600e3));
      hi = Math.max(hi, Math.ceil((x.e - base) / 3600e3));
    }
  });
  const height = (hi - lo) * HOUR_PX;
  const hours = h('div', { class: 'hours', style: `height:${height}px` });
  for (let hr = lo; hr <= hi; hr++) hours.append(h('span', { style: `top:${(hr - lo) * HOUR_PX}px` }, hourLabel(hr)));

  const lanes = keys.map((k, i) => {
    const base = dateOf(k).getTime();
    const y = (ts) => ((ts - base) / 3600e3 - lo) * HOUR_PX;
    const lane = h('div', { class: 'lane', style: `height:${height}px` });
    all[i].forEach((x, n) => {
      const top = y(x.s), ht = Math.max(2, y(x.e) - top);
      const dur = fmtDur((x.e - x.s) / 1000);
      const full = `${fmtTime(x.s)} – ${x.live ? 'now' : fmtTime(x.e)} · ${dur}`;
      const label = week ? (ht >= 17 ? dur : '') : (ht >= 19 ? full : '');
      lane.append(h('div', { class: 'blk' + (x.live ? ' live' : ''), style: `top:${top}px;height:${ht}px`, title: full }, label));
      const nx = all[i][n + 1];
      if (!week && nx && y(nx.s) - y(x.e) >= 17) {
        lane.append(h('div', { class: 'gaplbl', style: `top:${(y(x.e) + y(nx.s)) / 2}px` }, `${x.r || 'Paused'} · ${fmtDur((nx.s - x.e) / 1000)}`));
      }
    });
    return h('div', { class: 'col' }, lane);
  });

  const grid = h('div', { class: 'grid' + (week ? ' week' : '') });
  if (week) {
    grid.append(h('div', { class: 'gridhead' },
      h('div', { class: 'hours' }),
      keys.map((k) => {
        const d = dateOf(k), st = status(k), t = total(k, now);
        return h('button', { class: 'col colhead' + (k === today ? ' today' : ''), onclick: () => openDay(k), 'aria-label': `${DOWS_LONG[d.getDay()]} ${shortDate(k)}` },
          h('span', { class: 'dow' }, DOWS[d.getDay()]),
          h('span', { class: 'num' + (st ? ' s-' + st : '') }, String(d.getDate())),
          h('span', { class: 'tot' }, t > 0 ? fmtDur(t) : ''));
      })));
  }
  grid.append(h('div', { class: 'gridbody' }, hours, h('div', { class: 'cols' }, lanes)));
  return grid;
}

function dayView(key) {
  const today = todayKey(), future = key > today;
  const d = S.days[key], t = total(key), st = status(key), segs = segsOf(key);
  const pillText = { green: 'Hit', yellow: key === today ? 'In progress' : 'Missed', red: 'No work', rest: 'Rest day' }[st];

  const list = h('ul', { class: 'sessions' });
  segs.forEach((x, n) => {
    list.append(h('li', null, h('span', null, `${fmtTime(x.s)} – ${x.live ? 'now' : fmtTime(x.e)}`), h('b', null, fmtDur((x.e - x.s) / 1000))));
    const nx = segs[n + 1];
    if (nx) list.append(h('li', { class: 'pause' }, h('span', null, x.r ? `Paused · ${x.r}` : 'Paused'), h('span', null, fmtDur((nx.s - x.e) / 1000))));
    else if (x.r && !x.live) list.append(h('li', { class: 'pause' }, h('span', null, `Stopped · ${x.r}`), h('span', null, fmtTime(x.e))));
  });
  if (!segs.length) list.append(h('li', { class: 'pause' }, h('span', null, future ? "This day hasn't happened yet." : 'No work recorded.')));

  const side = h('div', { class: 'side' },
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', null, 'Worked'), h('b', null, fmtDur(t))),
      h('div', { class: 'stat' }, h('span', null, 'Breaks'), h('b', null, String(breaksOf(key)))),
      h('div', { class: 'stat' }, h('span', null, 'Goal'), h('b', null, fmtDur(goalOf(key)), pillText ? ' ' : '', pillText ? h('span', { class: 'pill s-' + st }, pillText) : null))),
    d && d.adj ? h('span', { class: 'hint' }, `Edited by hand: ${d.adj > 0 ? '+' : '−'}${fmtDur(Math.abs(d.adj))}`) : null,
    h('div', null, h('h3', null, 'Sessions'), list));

  if (!future) {
    const note = h('textarea', {
      class: 'note', id: 'note-' + key, placeholder: 'What did you work on?', value: (d && d.note) || '', maxLength: 4000,
      'aria-label': 'Note for this day',
      oninput: () => { const x = day(key, true); x.note = note.value; x.u = Date.now(); touch(); },
    });
    side.append(
      h('div', null, h('h3', null, 'Note'), note),
      h('div', null, h('button', { class: 'btn small', onclick: () => { const x = day(key, true); x.rest = !x.rest; x.u = Date.now(); touch(); render(); } },
        d && d.rest ? 'Rest day ✓  Undo' : 'Mark as rest day')));
  }
  return h('div', { class: 'dayview' }, timeGrid([key], false), side);
}

function monthView(key) {
  const d0 = dateOf(key), y = d0.getFullYear(), m = d0.getMonth(), today = todayKey();
  const n = new Date(y, m + 1, 0).getDate(), lead = new Date(y, m, 1).getDay();
  const keys = [];
  const grid = h('div', { class: 'month' }, DOWS.map((x) => h('div', { class: 'dow' }, x)));
  for (let i = 0; i < lead; i++) grid.append(h('div', { class: 'cell empty' }));
  for (let dd = 1; dd <= n; dd++) {
    const k = `${y}-${pad(m + 1)}-${pad(dd)}`;
    keys.push(k);
    const st = status(k), t = total(k), rec = S.days[k];
    const sub = t > 0 ? fmtDur(t) + (rec && rec.adj ? ' ✎' : '') : (st === 'rest' ? 'Rest' : '');
    grid.append(h('button', {
      class: 'cell' + (st ? ' s-' + st : '') + (k === today ? ' today' : '') + (k > today ? ' future' : ''),
      onclick: () => openDay(k), 'aria-label': `${MONTHS[m]} ${dd}${sub ? ', ' + sub : ''}`,
    }, h('span', { class: 'n' }, String(dd)), h('span', { class: 't' }, sub)));
  }
  return [rangeStats(keys), grid, legend()];
}

function yearView(key) {
  const y = dateOf(key).getFullYear(), today = todayKey();
  const keys = [];
  const wrap = h('div', { class: 'year' });
  for (let m = 0; m < 12; m++) {
    const n = new Date(y, m + 1, 0).getDate(), lead = new Date(y, m, 1).getDay();
    const g = h('div', { class: 'minigrid' });
    for (let i = 0; i < lead; i++) g.append(h('i'));
    for (let dd = 1; dd <= n; dd++) {
      const k = `${y}-${pad(m + 1)}-${pad(dd)}`;
      keys.push(k);
      const st = status(k);
      g.append(h('button', { class: (st ? 's-' + st : 'plain') + (k === today ? ' today' : ''), onclick: () => openDay(k), 'aria-label': `${MONTHS[m]} ${dd}` }, String(dd)));
    }
    wrap.append(h('div', { class: 'mini' },
      h('h4', null, h('button', { onclick: () => { cal.mode = 'month'; cal.cur = `${y}-${pad(m + 1)}-01`; render(); } }, MONTHS[m])), g));
  }
  return [rangeStats(keys), wrap, legend()];
}

function viewCalendar() {
  const d = dateOf(cal.cur), mode = cal.mode;
  let title, body;
  if (mode === 'day') {
    title = [`${DOWS_LONG[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()} `, h('span', null, String(d.getFullYear()))];
    body = dayView(cal.cur);
  } else if (mode === 'week') {
    const ws = weekStart(cal.cur), keys = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
    const a = dateOf(keys[0]), b = dateOf(keys[6]);
    const name = a.getMonth() === b.getMonth() ? MONTHS[a.getMonth()] : `${MONTHS[a.getMonth()].slice(0, 3)} – ${MONTHS[b.getMonth()].slice(0, 3)}`;
    title = [name + ' ', h('span', null, String(b.getFullYear()))];
    body = [rangeStats(keys), timeGrid(keys, true), legend()];
  } else if (mode === 'month') {
    title = [MONTHS[d.getMonth()] + ' ', h('span', null, String(d.getFullYear()))];
    body = monthView(cal.cur);
  } else {
    title = [String(d.getFullYear())];
    body = yearView(cal.cur);
  }

  const move = (dir) => {
    const x = dateOf(cal.cur);
    if (mode === 'day') x.setDate(x.getDate() + dir);
    else if (mode === 'week') x.setDate(x.getDate() + 7 * dir);
    else if (mode === 'month') { x.setDate(1); x.setMonth(x.getMonth() + dir); }
    else { x.setDate(1); x.setFullYear(x.getFullYear() + dir); }
    cal.cur = fmtKey(x);
    render();
  };
  const tab = (id, label) => h('button', { class: mode === id ? 'on' : '', onclick: () => { cal.mode = id; render(); } }, label);

  return h('section', { class: 'cal' },
    h('div', { class: 'calhead' },
      h('div', { class: 'caltitle' }, title),
      h('div', { class: 'calctl' },
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Calendar view' }, tab('day', 'Day'), tab('week', 'Week'), tab('month', 'Month'), tab('year', 'Year')),
        h('div', { class: 'arrows' },
          h('button', { onclick: () => move(-1), 'aria-label': 'Previous' }, '‹'),
          h('button', { onclick: () => { cal.cur = todayKey(); render(); } }, 'Today'),
          h('button', { onclick: () => move(1), 'aria-label': 'Next' }, '›')))),
    body);
}

/* ---------- records ---------- */
function allTotals() {
  const keys = new Set(Object.keys(S.days));
  if (S.run) keys.add(S.run.day);
  const out = [];
  for (const k of keys) { const t = total(k); if (t > 0) out.push([k, t]); }
  return out;
}
function top3(map) { return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3); }

function viewRecords() {
  const days = allTotals();
  const weeks = new Map(), months = new Map();
  let sum = 0, hit = 0;
  for (const [k, t] of days) {
    sum += t;
    if (status(k) === 'green') hit++;
    const w = weekStart(k), m = k.slice(0, 7);
    weeks.set(w, (weeks.get(w) || 0) + t);
    months.set(m, (months.get(m) || 0) + t);
  }
  const col = (titleText, rows, labelOf, open) => h('div', { class: 'rec' },
    h('h3', null, titleText),
    rows.length
      ? h('ol', null, rows.map(([k, t], i) => h('li', null, h('button', { onclick: () => open(k) },
          h('span', { class: 'rank' }, String(i + 1)), h('span', { class: 'amt' }, fmtDur(t)), h('span', { class: 'when' }, labelOf(k))))))
      : h('div', { class: 'none' }, 'Nothing yet. Start the timer.'));

  const dayLabel = (k) => { const d = dateOf(k); return `${DOWS[d.getDay()]}, ${shortDate(k)}, ${d.getFullYear()}`; };
  const weekLabel = (k) => `${shortDate(k)} – ${shortDate(addDays(k, 6))}, ${dateOf(addDays(k, 6)).getFullYear()}`;
  const monthLabel = (k) => `${MONTHS[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`;
  const jump = (mode) => (k) => { cal.mode = mode; cal.cur = mode === 'month' ? k + '-01' : k; go('calendar'); };

  return h('section', { class: 'records' },
    h('div', { class: 'calhead' }, h('div', { class: 'caltitle' }, 'Records')),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', null, 'All-time total'), h('b', null, fmtDur(sum))),
      h('div', { class: 'stat' }, h('span', null, 'Days worked'), h('b', null, String(days.length))),
      h('div', { class: 'stat' }, h('span', null, 'Goals hit'), h('b', null, String(hit)))),
    h('div', { class: 'reccols' },
      col('Best days', top3(new Map(days)), dayLabel, jump('day')),
      col('Best weeks', top3(weeks), weekLabel, jump('week')),
      col('Best months', top3(months), monthLabel, jump('month'))),
    h('div', { class: 'ai' },
      h('h3', null, 'Ask AI how to work better'),
      h('p', null, 'This copies all your hours, breaks and notes with a ready-made prompt. Paste it into any AI chat and it tells you what to fix.'),
      h('button', { class: 'btn light', onclick: () => copyText(aiText(), 'Copied. Paste it into any AI chat.') }, 'Copy for AI')));
}

function aiText() {
  const today = todayKey();
  const lines = [];
  if (S.started) {
    for (let k = S.started; k <= today; k = addDays(k, 1)) {
      const d = S.days[k], t = total(k), segs = segsOf(k), st = status(k);
      const dow = DOWS[dateOf(k).getDay()];
      if (!t && !(d && (d.rest || d.note))) { lines.push(`${k} ${dow} | no work${k === today ? ' yet (today)' : ''}`); continue; }
      const reasons = {};
      segs.forEach((x, i) => { if (i < segs.length - 1 || x.r) reasons[x.r || 'no reason given'] = (reasons[x.r || 'no reason given'] || 0) + 1; });
      const parts = [
        `${k} ${dow}`,
        `worked ${fmtDur(t)}`,
        `goal ${fmtDur(goalOf(k))} (${st === 'green' ? 'hit' : d && d.rest ? 'rest day' : 'missed'})`,
        `breaks ${breaksOf(k)}`,
      ];
      if (segs.length) parts.push(`first start ${fmtTime(segs[0].s)}, last stop ${fmtTime(segs[segs.length - 1].e)}`);
      if (segs.length) parts.push('sessions ' + segs.map((x) => fmtDur((x.e - x.s) / 1000)).join(', '));
      const rs = Object.entries(reasons).map(([r, n]) => `${r} x${n}`).join(', ');
      if (rs) parts.push(`pause reasons: ${rs}`);
      if (d && d.adj) parts.push(`edited by hand ${d.adj > 0 ? '+' : '-'}${fmtDur(Math.abs(d.adj))}`);
      if (d && d.note && d.note.trim()) parts.push(`note: ${d.note.trim().replace(/\s+/g, ' ')}`);
      lines.push(parts.join(' | '));
    }
  }
  return [
    'You are my work coach. Below is my real work log from a timer that only counts time I was actually working. I pause it every time I stop, pick up my phone, or get distracted.',
    '',
    'Look at the data and tell me, in plain language:',
    '1. The patterns you see: which days of the week are strong or weak, what time of day I work best, and whether I am trending up or down.',
    '2. What my breaks and pause reasons say about me. Am I taking too many? Is my phone a problem?',
    '3. Whether my daily goal is too easy, too hard, or about right.',
    '4. The 3 most useful changes I should make, starting this week. Be specific and use numbers from my log.',
    '',
    'Be direct. Do not flatter me. If the data is too thin to say something, say so.',
    '',
    `Today is ${today}. Each line is one day. A day runs from 2 AM to 2 AM.`,
    '',
    '--- MY WORK LOG ---',
    lines.length ? lines.join('\n') : '(no days logged yet)',
  ].join('\n');
}

/* ---------- shell ---------- */
function render() {
  const view = currentView();
  const keepFocus = document.activeElement && document.activeElement.id;
  const navBtn = (id, label) => h('button', { class: view === id ? 'on' : '', onclick: () => go(id) }, label);
  T = null;
  const body = view === 'calendar' ? viewCalendar() : view === 'records' ? viewRecords() : viewTimer();
  app.replaceChildren(
    h('header', { class: 'top' },
      h('div', { class: 'brand' }, "Lucky's Work Timer"),
      h('nav', { class: 'nav' },
        navBtn('timer', 'Timer'), navBtn('calendar', 'Calendar'), navBtn('records', 'Records'),
        h('button', { class: 'gear', onclick: settingsModal, 'aria-label': 'Settings', html: ICON_GEAR }))),
    h('main', null, body));
  if (keepFocus) { const el = document.getElementById(keepFocus); if (el) el.focus(); }
  paintTimer(true);
}

/* ---------- events ---------- */
let lastCalPaint = Date.now();
function tick() {
  const now = Date.now();
  checkAway(now);
  paintTimer(false);
  if (S.run && currentView() === 'calendar' && now - lastCalPaint > 60e3) {
    lastCalPaint = now;
    const a = document.activeElement;
    if (!veil && !(a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT'))) render();
  }
}

window.addEventListener('hashchange', render);
window.addEventListener('storage', (e) => { if (e.key === STORE) { S = load(); render(); } });
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => { lastTouch = Date.now(); }, true);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (S.run && !awayOpen && Date.now() - S.run.seen <= AWAY) S.run.seen = Date.now();
    save();
    if (S.code && syncT) { clearTimeout(syncT); syncT = null; push(true).catch(() => {}); }
  } else {
    lastTouch = Date.now();
    tick();
  }
});
window.addEventListener('pagehide', () => {
  if (S.run && !awayOpen && Date.now() - S.run.seen <= AWAY) S.run.seen = Date.now();
  save();
});

const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && veil && veil.dataset.dismiss) return closeModal();
  if (e.code !== 'Space' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if (veil || isTyping(e.target) || currentView() !== 'timer') return;
  e.preventDefault();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  toggle();
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && !veil && !isTyping(e.target) && currentView() === 'timer') e.preventDefault();
});

render();
checkAway(Date.now());
setInterval(tick, 250);
if (S.code) syncNow().then(render);
})();
