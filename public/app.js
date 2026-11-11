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
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOWS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const svg = (body, fill) => `<svg viewBox="0 0 24 24" aria-hidden="true" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'}>${body}</svg>`;
const ICON = {
  logo: svg('<circle cx="12" cy="12" r="9"/><path d="M12 6.5V12l3.5 2"/>'),
  play: svg('<path d="M7 4.5v15a1 1 0 0 0 1.5.86l13-7.5a1 1 0 0 0 0-1.72l-13-7.5A1 1 0 0 0 7 4.5z"/>', true),
  pause: svg('<rect x="5" y="4" width="5" height="16" rx="1.2"/><rect x="14" y="4" width="5" height="16" rx="1.2"/>', true),
  reset: svg('<path d="M3 12a9 9 0 1 0 2.64-6.36L3 8"/><path d="M3 3v5h5"/>'),
  adjust: svg('<path d="M12 3v8M8 7h8M8 18h8"/>'),
};

const app = document.getElementById('app');

/* ---------- tiny DOM helper ---------- */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const k in props || {}) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;          // only ever used with the ICON constants above
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid);
  return el;
}

/* ---------- state ---------- */
// goal: seconds, or null when no goal is set. days: { 'YYYY-MM-DD': { segs, adj, note, rest, g, u } }
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

// "4" / "8.5" / "8.5 hours" / "4h 30m" / "4:30" / "90 min" -> seconds. '' -> null (no goal). Anything else -> undefined.
function parseGoal(text) {
  const s = text.trim().toLowerCase();
  if (!s) return null;
  let sec, m;
  if ((m = s.match(/^(\d+):(\d{1,2})$/))) sec = m[1] * 3600 + m[2] * 60;
  else if ((m = s.match(/^(\d+)\s*(?:m|min|mins|minutes)$/))) sec = m[1] * 60;
  else if ((m = s.match(/^(\d*\.?\d+)\s*(?:h|hr|hrs|hour|hours)?(?:\s*(\d+)\s*(?:m|min|mins|minutes)?)?$/))) sec = m[1] * 3600 + (m[2] || 0) * 60;
  else return undefined;
  sec = Math.round(sec);
  return sec > 0 && sec <= 24 * 3600 ? sec : undefined;
}
function fmtGoal(sec) {
  const hours = Math.round(sec / 36) / 100;
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

/* ---------- day math ---------- */
function day(key, create) {
  let d = S.days[key];
  if (!d && create) d = S.days[key] = { segs: [], adj: 0, note: '', rest: false, g: S.goal, u: Date.now() };
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
  const a = d ? d.segs.map((x) => ({ s: x.s, e: x.e })) : [];
  if (S.run && S.run.day === key) a.push({ s: S.run.s, e: now, live: true });
  return a.sort((x, y) => x.s - y.s);
}
const goalOf = (key) => (S.days[key] && S.days[key].g) || S.goal || null;
const isRest = (key) => !!(S.days[key] && S.days[key].rest);
const tracked = (key) => !!S.started && key >= S.started && key <= todayKey();

// green = hit goal, yellow = worked but missed (or no goal set), red = no work, rest = rest day, '' = nothing to show
function status(key) {
  if (!tracked(key)) return '';
  const t = total(key), goal = goalOf(key);
  if (goal && t >= goal) return 'green';
  if (isRest(key)) return 'rest';
  if (t > 0) return 'yellow';
  return key === todayKey() ? '' : 'red';
}

/* ---------- timer actions ---------- */
let awayOpen = false;
let lastTouch = Date.now();

function touch() { save(); queueSync(); }
function markStarted(key) { if (!S.started || key < S.started) S.started = key; }

function start() {
  if (S.run) return;
  const now = Date.now(), key = keyOf(now);
  S.run = { s: now, seen: now, day: key };
  markStarted(key);
  day(key, true);
  save();
  paintTimer(true);
}
function stop(at = Date.now()) {
  if (!S.run) return;
  const r = S.run, d = day(r.day, true);
  if (at > r.s) d.segs.push({ s: r.s, e: at });
  d.u = Date.now();
  S.run = null;
  touch();
  paintTimer(true);
}
function toggle() { S.run ? stop() : start(); }

function adjust(deltaSec) {
  const key = activeDay(), d = day(key, true);
  const cur = total(key), next = Math.max(0, cur + deltaSec);
  if (next === cur) return;
  d.adj = (d.adj || 0) + (next - cur);
  d.u = Date.now();
  markStarted(key);
  touch();
  paintTimer(true);
}

function resetToday() {
  const key = activeDay(), d = S.days[key];
  S.run = null;
  if (d) { d.segs = []; d.adj = 0; d.u = Date.now(); }
  touch();
  paintTimer(true);
}

function setGoal(sec) {
  S.goal = sec;
  S.goalU = Date.now();
  const d = S.days[activeDay()];
  if (d) { d.g = sec; d.u = Date.now(); }
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
      stop(r.seen);
      toast(`Timer stopped at ${fmtTime(r.seen)} because you were away.`);
    } else if (!awayOpen) {
      awayModal(gap);
    }
    return;
  }
  if (rolled && now - lastTouch > IDLE) { // tab left open overnight, nobody here
    const cut = dateOf(addDays(r.day, 1)).getTime() + RESET_H * 3600e3;
    stop(Math.max(r.s, Math.min(cut, now)));
    toast('Timer stopped at 2 AM because nobody was here.');
    return;
  }
  if (!awayOpen && gap >= BEAT) { r.seen = now; save(); }
}

function awayModal(gap) {
  awayOpen = true;
  const seen = S.run.seen;
  const answer = (count) => {
    awayOpen = false;
    closeModal();
    if (!count) stop(seen);
    else if (S.run) { S.run.seen = Date.now(); save(); }
  };
  openModal(h('div', { class: 'modal' },
    h('h2', null, 'Were you working?'),
    h('p', null, 'The timer was running while you were away for ', h('b', null, fmtDur(gap / 1000)), '. Count it?'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => answer(false) }, 'No'),
      h('button', { class: 'btn light', onclick: () => answer(true) }, 'Yes'))));
}

/* ---------- sync ---------- */
let syncT = null;
const dataUrl = (code) => `${API}/data?code=${encodeURIComponent(code)}`;
const exportData = () => ({ v: 1, goal: S.goal, goalU: S.goalU, started: S.started, days: S.days });

function merge(remote) {
  if (!remote || typeof remote !== 'object') return;
  const days = remote.days && typeof remote.days === 'object' ? remote.days : {};
  for (const k in days) {
    const r = days[k], l = S.days[k];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !r || !Array.isArray(r.segs)) continue;
    if (!l || (r.u || 0) > (l.u || 0)) S.days[k] = r;
  }
  if ((remote.goalU || 0) > (S.goalU || 0)) {
    S.goal = typeof remote.goal === 'number' ? remote.goal : null;
    S.goalU = remote.goalU;
  }
  if (remote.started) markStarted(remote.started);
}
function push(keepalive) {
  return fetch(dataUrl(S.code), {
    method: 'PUT', keepalive: !!keepalive,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(exportData()),
  });
}
async function syncNow() {
  clearTimeout(syncT); syncT = null;
  if (!S.code) return;
  try {
    const r = await fetch(dataUrl(S.code));
    if (r.ok) { merge((await r.json()).data); save(); }
    await push();
  } catch (e) { /* offline: local copy is still safe, try again next change */ }
}
function queueSync() {
  if (!S.code) return;
  clearTimeout(syncT);
  syncT = setTimeout(syncNow, 3000);
}

// One box does both jobs: a name makes a new code, a code (like Mike4821) loads that data.
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
  } catch (e) { say("Couldn't save online right now. Your data is still saved on this device."); }
}
async function loadCode(code, say) {
  say('Loading…');
  try {
    const r = await fetch(dataUrl(code));
    if (r.status === 404) return say('No data found for that login. Check the spelling.');
    const j = await r.json();
    if (!r.ok || !j.code) throw new Error('load failed');
    merge(j.data);
    S.code = j.code;
    save();
    render();
    toast(`Logged in as ${j.code}.`);
    push().catch(() => {});
  } catch (e) { say("Couldn't load right now. Check your connection and try again."); }
}

// Saves everything online one last time, then clears this device so someone else can log in.
async function logout() {
  if (S.run) stop();
  clearTimeout(syncT); syncT = null;
  try { await push(); } catch (e) { return toast("Couldn't save online right now. Try again in a moment."); }
  S = fresh();
  save();
  render();
  toast('Logged out.');
}

/* ---------- modal + toast ---------- */
let veil = null;
function openModal(content) {
  closeModal();
  veil = h('div', { class: 'veil' }, content);
  document.body.append(veil);
  content.querySelector('button.light').focus();
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

function copyCode() {
  navigator.clipboard.writeText(S.code).then(() => toast('Login copied.'), () => toast(`Your login is ${S.code}`));
}

function codeModal() {
  openModal(h('div', { class: 'modal' },
    h('h2', null, 'Your login is'),
    h('div', { class: 'bigcode' }, S.code),
    h('p', null, 'Save it for later. It’s the only way to see your saved hours and calendar on another device.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: copyCode }, 'Copy login'),
      h('button', { class: 'btn light', onclick: closeModal }, 'Done'))));
}

/* ---------- routing ---------- */
const currentView = () => (location.hash === '#calendar' ? 'calendar' : 'timer');
function go(v) {
  if (v === 'calendar') { cal.mode = 'day'; cal.cur = todayKey(); }
  if (currentView() === v) render(); else location.hash = v;
}

/* ---------- timer view ---------- */
let T = null; // live elements of the timer view

function closePops() { if (T) { T.resetPop.hidden = true; T.adjustPop.hidden = true; } }
function togglePop(pop) { const open = pop.hidden; closePops(); pop.hidden = !open; }

function viewTimer() {
  const goalInput = h('input', {
    class: 'goalbox', id: 'goal', placeholder: 'e.g. 4 hours', autocomplete: 'off', spellcheck: false, maxLength: 12, 'aria-label': 'Daily goal in hours',
    onfocus: () => goalInput.select(),
    onkeydown: (e) => { if (e.key === 'Enter') goalInput.blur(); },
    onblur: () => {
      const sec = parseGoal(goalInput.value);
      if (sec === undefined) toast('Type your goal in hours, like 4 or 8.5.');
      else if (sec !== S.goal) setGoal(sec);
      paintTimer(true);
    },
  });
  const adj = (label, sec) => h('button', { class: 'chip', onclick: () => adjust(sec) }, label);

  T = {
    clock: h('div', { class: 'clock', role: 'timer' }),
    goalInput,
    bar: h('i'),
    play: h('button', { class: 'play', onclick: () => { closePops(); toggle(); } }),
    resetPop: h('div', { class: 'pop', hidden: true },
      h('span', null, 'Reset today to 0?'),
      h('div', { class: 'poprow' },
        h('button', { class: 'chip', onclick: () => { closePops(); resetToday(); } }, 'Yes'),
        h('button', { class: 'chip', onclick: closePops }, 'No'))),
    adjustPop: h('div', { class: 'pop', hidden: true },
      h('div', { class: 'popgrid' },
        adj('+1h', 3600), adj('+10m', 600), adj('+1m', 60),
        adj('−1h', -3600), adj('−10m', -600), adj('−1m', -60))),
    last: {},
  };

  const [form, msg] = saveForm();
  const saveBox = S.code
    ? h('div', { class: 'save' },
        h('div', { class: 'codeline' }, 'Logged in as ', h('b', null, S.code)),
        h('button', { class: 'link', onclick: logout }, 'Log out'))
    : h('div', { class: 'save' }, form, msg, h('span', { class: 'hint' }, 'Already have a login? Type it in.'));

  const el = h('section', { class: 'timer' },
    T.clock,
    h('div', { class: 'goal' }, h('label', { for: 'goal' }, 'Goal'), goalInput),
    h('div', { class: 'bar' }, T.bar),
    h('div', { class: 'controls' },
      h('button', { class: 'round', html: ICON.reset, 'aria-label': 'Reset today to zero', onclick: () => togglePop(T.resetPop) }),
      T.play,
      h('button', { class: 'round', html: ICON.adjust, 'aria-label': 'Add or remove time', onclick: () => togglePop(T.adjustPop) }),
      T.resetPop, T.adjustPop),
    saveBox);
  paintTimer(true);
  return el;
}

function saveForm() {
  const msg = h('small', { role: 'status' });
  const input = h('input', { class: 'field', id: 'name', placeholder: 'Enter your first name to save your data', autocomplete: 'off', autocapitalize: 'words', spellcheck: false, maxLength: 20, 'aria-label': 'Enter your first name to save your data' });
  requestAnimationFrame(() => {   // size the box to exactly fit its placeholder, whatever the font
    const cs = getComputedStyle(input), pen = document.createElement('canvas').getContext('2d');
    pen.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    input.style.width = Math.ceil(pen.measureText(input.placeholder).width) + 'px';
  });
  const form = h('form', { onsubmit: (e) => { e.preventDefault(); submitName(input.value, (t) => { msg.textContent = t; }); } },
    input, h('button', { class: 'btn', type: 'submit' }, 'Save'));
  return [form, msg];
}

function paintTimer(force) {
  const key = activeDay(), t = total(key);
  const text = fmtClock(t);
  const title = `Work Timer ${text}`;
  if (document.title !== title) document.title = title;
  if (!T) return;
  const L = T.last;
  if (force || L.text !== text) { T.clock.textContent = text; L.text = text; }
  const running = !!S.run;
  if (force || L.running !== running) {
    T.play.innerHTML = running ? ICON.pause : ICON.play;
    T.play.setAttribute('aria-label', running ? 'Pause' : 'Start');
    L.running = running;
  }
  const goal = goalOf(key);
  const pct = goal ? Math.min(100, (t / goal) * 100).toFixed(1) : 0;
  if (force || L.pct !== pct) { T.bar.style.width = pct + '%'; L.pct = pct; }
  if (force && document.activeElement !== T.goalInput) T.goalInput.value = goal ? fmtGoal(goal) : '';
}

/* ---------- calendar ---------- */
const cal = { mode: 'day', cur: todayKey() };

function rangeStats(keys) {
  const today = todayKey();
  let sum = 0, worked = 0, hit = 0, counted = 0;
  for (const k of keys) {
    const t = total(k);
    sum += t;
    if (t > 0) worked++;
    if (status(k) === 'green') hit++;
    // the average counts every tracked day except rest days; today only counts once it has work
    if (t > 0 || (tracked(k) && k < today && !isRest(k))) counted++;
  }
  const stat = (label, value) => h('div', { class: 'stat' }, h('span', null, label), h('b', null, value));
  return h('div', { class: 'stats' },
    stat('Total', fmtDur(sum)), stat('Average per day', fmtDur(counted ? sum / counted : 0)),
    stat('Days worked', String(worked)), stat('Goals hit', String(hit)));
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
    for (const x of all[i]) {
      const top = y(x.s), ht = Math.max(2, y(x.e) - top);
      const dur = `Worked ${fmtDur((x.e - x.s) / 1000)}`;
      const full = `${fmtTime(x.s)} – ${x.live ? 'now' : fmtTime(x.e)} · ${dur}`;
      const label = week ? (ht >= 17 ? dur : '') : (ht >= 19 ? full : '');
      lane.append(h('div', { class: 'blk' + (x.live ? ' live' : ''), style: `top:${top}px;height:${ht}px`, title: full }, label));
    }
    return h('div', { class: 'col' }, lane);
  });

  const grid = h('div', { class: 'grid' + (week ? ' week' : '') });
  if (week) {
    grid.append(h('div', { class: 'gridhead' },
      h('div', { class: 'hours' }),
      keys.map((k) => {
        const d = dateOf(k), st = status(k), t = total(k, now);
        return h('button', { class: 'col colhead' + (k === today ? ' today' : ''), onclick: () => openDay(k), 'aria-label': `${DOWS_LONG[d.getDay()]} ${d.getDate()}` },
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
  const d = S.days[key], st = status(key), segs = segsOf(key), goal = goalOf(key);
  const pillText = { green: 'Hit', yellow: key === today ? 'In progress' : 'Missed', red: 'No work', rest: 'Rest day' }[st];
  const stat = (label, ...value) => h('div', { class: 'stat' }, h('span', null, label), h('b', null, value));

  const list = h('ul', { class: 'sessions' }, segs.map((x) =>
    h('li', null, h('span', null, `${fmtTime(x.s)} – ${x.live ? 'now' : fmtTime(x.e)}`), h('b', null, fmtDur((x.e - x.s) / 1000)))));
  if (!segs.length) list.append(h('li', { class: 'none' }, future ? "This day hasn't happened yet." : 'No work recorded.'));

  const side = h('div', { class: 'side' },
    h('div', { class: 'stats' },
      stat('Worked', fmtDur(total(key))),
      stat('Breaks', String(Math.max(0, segs.length - 1))),
      stat('Goal', goal ? fmtDur(goal) : '–', pillText ? ' ' : '', pillText ? h('span', { class: 'pill s-' + st }, pillText) : null)),
    h('div', null, h('h3', null, 'Sessions'), list));

  if (!future) {
    const edit = (change) => { const x = day(key, true); change(x); x.u = Date.now(); touch(); };
    const note = h('textarea', {
      class: 'note', id: 'note-' + key, placeholder: 'What did you work on?', value: (d && d.note) || '', maxLength: 4000,
      'aria-label': 'Note for this day',
      oninput: () => { fit(); edit((x) => { x.note = note.value; }); },
    });
    const fit = () => { note.style.height = 'auto'; note.style.height = note.scrollHeight + 2 + 'px'; };  // grow with the text
    requestAnimationFrame(fit);
    side.append(
      h('div', null, h('h3', null, 'Note'), note),
      h('div', null, h('button', { class: 'btn small', onclick: () => { edit((x) => { x.rest = !x.rest; }); render(); } },
        isRest(key) ? 'Rest day ✓  Undo' : 'Mark as rest day')));
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
    const st = status(k), t = total(k);
    const sub = t > 0 ? `Worked ${fmtDur(t)}` : (st === 'rest' ? 'Rest' : '');
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
    const first = addDays(cal.cur, -d.getDay()), keys = Array.from({ length: 7 }, (_, i) => addDays(first, i));
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
          h('button', { onclick: () => move(1), 'aria-label': 'Next' }, '›')))),
    body);
}

/* ---------- shell ---------- */
function render() {
  const view = currentView();
  const keepFocus = document.activeElement && document.activeElement.id;
  const navBtn = (id, label) => h('button', { class: view === id ? 'on' : '', onclick: () => go(id) }, label);
  T = null;
  app.replaceChildren(
    h('header', { class: 'top' },
      h('div', { class: 'brand' }, h('span', { class: 'logo', html: ICON.logo }), "Lucky's Work Timer"),
      h('nav', { class: 'nav' }, navBtn('timer', 'Timer'), navBtn('calendar', 'Calendar'))),
    h('main', null, view === 'calendar' ? viewCalendar() : viewTimer()));
  if (keepFocus) { const el = document.getElementById(keepFocus); if (el) el.focus(); }
  paintTimer(true);
}

/* ---------- events ---------- */
const isTyping = (el) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');

let lastCalPaint = Date.now();
function tick() {
  const now = Date.now();
  checkAway(now);
  paintTimer(false);
  if (S.run && currentView() === 'calendar' && now - lastCalPaint > 60e3) {
    lastCalPaint = now;
    if (!veil && !isTyping(document.activeElement)) render();
  }
}

window.addEventListener('hashchange', render);
window.addEventListener('storage', (e) => { if (e.key === STORE) { S = load(); render(); } });
window.addEventListener('keydown', () => { lastTouch = Date.now(); }, true);
window.addEventListener('pointerdown', (e) => {
  lastTouch = Date.now();
  if (!e.target.closest('.round, .pop')) closePops();
}, true);

function leaving() {
  if (S.run && !awayOpen && Date.now() - S.run.seen <= AWAY) S.run.seen = Date.now();
  save();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    leaving();
    if (S.code && syncT) { clearTimeout(syncT); syncT = null; push(true).catch(() => {}); }
  } else {
    lastTouch = Date.now();
    tick();
  }
});
window.addEventListener('pagehide', leaving);

// Spacebar plays and pauses, unless you are typing.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return closePops();
  if (e.code !== 'Space' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if (veil || isTyping(e.target) || currentView() !== 'timer') return;
  e.preventDefault();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  closePops();
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
