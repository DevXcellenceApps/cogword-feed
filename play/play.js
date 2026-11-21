// The free weekly web lock (phase 18). Plain JavaScript, no framework and no build step.
// The rules live in engine.js (a port of CogwordKit's engine, checked by test/engine.test.mjs);
// this file draws boards 13 and 11 and wires the controls. Nothing is sent anywhere: the week's
// result stays in this browser's localStorage.

import { ALPHABET, Lock, State, mod26 } from './engine.js';

/** The App Store link for the badge and the "Stuck?" chip: the campaign link (ct=weblock), so installs from the web lock show in App Store Connect. */
const APP_STORE_URL = 'https://apps.apple.com/app/apple-store/id6818298736?pt=129015800&ct=weblock&mt=8';
/** The address the share text ends with. */
const SHARE_URL = 'cogword.devxcellence.com/play';
/** After this long on the clock, or this many moves, the "Stuck?" chip shows (the app's thresholds). */
const STUCK_SECONDS = 6 * 60;
const STUCK_MOVES = 40;

const $ = (id) => document.getElementById(id);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const storage = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: fine */ } },
};

let lock, state, week, selected = null, history = [], elapsedBefore = 0, runningSince = null, solved = false;
let tick = null;
const wheels = [];

// MARK: Sound (off by default; the app's effects)

const sound = {
  on: storage.get('cogword.weblock.sound') === true,
  cache: {},
  play(name, rate = 1) {
    if (!this.on) return;
    const a = (this.cache[name] ||= new Audio(`sounds/${name}.m4a`)).cloneNode();
    a.playbackRate = rate;
    a.volume = name === 'notch' || name === 'cascade' ? 0.6 : 0.9;
    a.play().catch(() => {});
  },
};

function setSound(on) {
  sound.on = on;
  storage.set('cogword.weblock.sound', on);
  $('sound').setAttribute('aria-pressed', String(on));
  $('sound').setAttribute('aria-label', on ? 'Sound effects on' : 'Sound effects off');
}

// MARK: Start

async function start() {
  const data = await (await fetch('weblock.json', { cache: 'no-cache' })).json();
  week = data.week;
  lock = new Lock(data.lock);
  state = new State(lock, new Set(data.accepted));
  $('lock-number').textContent = `No. ${data.lock.number}`;
  $('par').textContent = lock.par;
  $('stuck').href = APP_STORE_URL;
  $('store-badge').href = APP_STORE_URL;
  if (window.self !== window.top) $('own-window').hidden = false;
  setSound(sound.on);
  buildBoard();

  const saved = storage.get(key('result'));
  if (saved) {
    // The player's own square, behind the open door.
    if (saved.offsets) state.restore({ offsets: saved.offsets, moves: saved.moves, lastWheel: null });
    render(true);
    return showSolved(saved, false);
  }
  const progress = storage.get(key('progress'));
  if (progress) {
    state.restore(progress);
    elapsedBefore = progress.elapsed || 0;
    history = progress.history || [];
  }
  render(true);
  wire();
  $('app').setAttribute('aria-busy', 'false');
}

const key = (what) => `cogword.weblock.${week}.${what}`;

// MARK: The board (board 13)

function buildBoard() {
  const grid = $('grid');
  grid.textContent = '';
  const n = lock.size;
  for (let r = 0; r < n; r++) {
    const row = document.createElement('div');
    row.className = 'row';
    const cells = document.createElement('div');
    cells.className = 'cells';
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      const w = document.createElement('div');
      w.className = 'wheel';
      const drum = document.createElement('div');
      drum.className = 'drum';
      const strip = document.createElement('div');
      strip.className = 'strip';
      // Three alphabets, so a turn across Z–A rolls one notch, as in the app.
      strip.innerHTML = (ALPHABET + ALPHABET + ALPHABET).split('').map((ch) => `<span aria-hidden="true">${ch}</span>`).join('');
      drum.append(strip, el('div', 'shade'), el('div', 'rule a'), el('div', 'rule b'));
      const ring = el('div', 'ring');
      const pick = document.createElement('button');
      pick.className = 'pick';
      pick.type = 'button';
      pick.addEventListener('click', () => select(i));
      w.append(drum, ring, pick);
      if (lock.isDriver(i)) {
        const badge = el('div', 'badge');
        badge.innerHTML = '<svg width="15" height="15" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="36" fill="none" stroke="#F0CF8E" stroke-width="18" stroke-dasharray="10 8.8"/><circle cx="50" cy="50" r="12" fill="#F0CF8E"/></svg>';
        w.append(badge);
      }
      cells.append(w);
      wheels[i] = { el: w, strip, ring, pick, shown: null };
    }
    // Links leaving this row's wheels, in the gaps (the app's Connector, with its chevron).
    for (const [from, links] of lock.links) {
      if (Math.floor(from / n) !== r) continue;
      for (const l of links) cells.append(connector(from, l.target, l.sign));
    }
    const lamp = el('div', 'lamp');
    lamp.dataset.row = r;
    row.append(cells, lamp);
    grid.append(row);
  }
  const cols = el('div', 'col-lamps');
  for (let c = 0; c < n; c++) {
    const holder = document.createElement('span');
    const lamp = el('div', 'lamp');
    lamp.dataset.col = c;
    holder.append(lamp);
    cols.append(holder);
  }
  grid.append(cols);
  drawDial();
  fitBoard();
}

function el(tag, cls) {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

/** A 14pt connector in the gap between two wheels (left/top of the upper-left wheel's box as in
 *  board 13: right links at 50, 35; down links at 20, 80), with a chevron pointing to the driven wheel. */
function connector(from, to, sign) {
  const n = lock.size;
  const [fr, fc, tr, tc] = [Math.floor(from / n), from % n, Math.floor(to / n), to % n];
  const left = Math.min(fc, tc) * 64, top = 0;
  const horizontal = fr === tr;
  const box = el('div', `link ${sign > 0 ? 'same' : 'opposite'}`);
  box.style.left = `${horizontal ? left + 50 : fc * 64 + 20}px`;
  box.style.top = `${horizontal ? top + 35 : 80}px`;
  if (!horizontal) box.style.top = `${(Math.min(fr, tr) - fr) * 94 + 80}px`;
  const rotation = horizontal ? (tc > fc ? 0 : 180) : (tr > fr ? 90 : 270);
  box.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" style="transform: rotate(${rotation}deg)" aria-hidden="true"><path d="M5.5 4L9 7L5.5 10" fill="none" stroke="#1B130D" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return box;
}

/** The vault dial's ticks (board 11): 36, every 30° a long one. */
function drawDial() {
  const svg = $('dial').querySelector('svg');
  let s = '';
  for (let k = 0; k < 36; k++) {
    const major = k % 3 === 0;
    s += `<path d="M50 6 L50 ${major ? 14 : 11}" stroke="#5A4026" stroke-width="${major ? 2.4 : 1.4}" transform="rotate(${k * 10} 50 50)"/>`;
  }
  svg.innerHTML = s + '<circle cx="50" cy="50" r="22" fill="none" stroke="#5A4026" stroke-width="1.6"/><circle cx="50" cy="50" r="6" fill="#5A4026"/>';
}

/** The board takes the room left in the column (like PuzzleBoard(scale:)), never more than 1:1. */
function fitBoard() {
  const fit = $('board-fit');
  const s = Math.min(1, fit.clientWidth / 360, fit.clientHeight / 512);
  document.documentElement.style.setProperty('--s', Math.max(0.4, s).toFixed(4));
}
window.addEventListener('resize', fitBoard);
// The chip, the result or the fonts arriving change the room left: refit whenever it changes.
if ('ResizeObserver' in window) new ResizeObserver(fitBoard).observe(document.getElementById('board-fit'));

// MARK: Drawing the state

function render(instant = false) {
  const n = lock.size;
  const rows = state.litRows, cols = state.litColumns;
  const driven = new Map();
  if (selected !== null) for (const step of lock.cascade(selected).slice(1)) driven.set(step.wheel, step.sign);
  for (let i = 0; i < lock.wheelCount; i++) {
    const w = wheels[i];
    const r = Math.floor(i / n), c = i % n;
    const lit = rows.includes(r) || cols.includes(c), both = rows.includes(r) && cols.includes(c);
    w.el.classList.toggle('lit', lit);
    w.el.classList.toggle('both', both);
    w.ring.className = 'ring' + (selected === i ? ' sel' : driven.has(i) ? (driven.get(i) > 0 ? ' gold' : ' teal') : '');
    roll(w, mod26(state.position(i)), instant);
    const parts = [`Row ${r + 1}, column ${c + 1}, letter ${state.letter(i)}`];
    if (lock.isDriver(i)) parts.push('driver');
    if (selected === i) parts.push('picked');
    w.pick.setAttribute('aria-label', parts.join(', '));
    w.pick.setAttribute('aria-pressed', String(selected === i));
  }
  document.querySelectorAll('.row').forEach((row, r) => {
    const on = rows.includes(r);
    row.querySelector('.lamp').classList.toggle('on', on);
    const cells = row.querySelector('.cells');
    const sweep = cells.querySelector('.sweep');
    if (on && !sweep) cells.append(el('div', 'sweep'));
    if (!on && sweep) sweep.remove();
  });
  document.querySelectorAll('[data-col]').forEach((lamp) => lamp.classList.toggle('on', cols.includes(Number(lamp.dataset.col))));
  $('moves').textContent = state.moves;
  const picked = selected !== null;
  $('back-letter').textContent = picked ? ALPHABET[mod26(state.letterIndex(selected) - 1)] : '';
  $('forward-letter').textContent = picked ? ALPHABET[mod26(state.letterIndex(selected) + 1)] : '';
  $('back').setAttribute('aria-disabled', String(!picked));
  $('forward').setAttribute('aria-disabled', String(!picked));
  $('undo').setAttribute('aria-disabled', String(history.length === 0));
  $('help').textContent = !picked ? 'Tap a wheel to pick it, then use the big buttons'
    : lock.isDriver(selected) ? 'Driver picked: the dashed wheels turn with it' : 'Wheel picked: turn it with the big buttons';
  updateClock();
}

/** Rolls a drum to letter `idx` the short way round (crossing Z–A by one notch). */
function roll(w, idx, instant) {
  const target = 26 + idx;
  if (w.shown === null || instant || reduceMotion.matches) {
    w.shown = target;
    place(w, target, true);
    return;
  }
  let from = w.shown;
  if (target - from > 13) from += 26;
  if (from - target > 13) from -= 26;
  if (from !== w.shown) place(w, from, true);
  w.shown = target;
  requestAnimationFrame(() => requestAnimationFrame(() => place(w, target, false)));
}

function place(w, pos, jump) {
  w.strip.classList.toggle('jump', jump);
  w.strip.style.transform = `translateY(${28 - pos * 28}px)`;
}

// MARK: Playing

function select(i) {
  if (solved) return;
  selected = i;
  render();
}

function turn(direction) {
  if (solved || selected === null) return;
  const before = state.snapshot();
  const rowsBefore = state.litRows.length, colsBefore = state.litColumns.length;
  const result = state.turn(selected, direction);
  if (!result) return;
  history.push(before);
  if (runningSince === null) runningSince = Date.now();
  sound.play('notch');
  const depth = Math.max(...result.cascade.map((s) => s.depth));
  for (let d = 1; d <= depth; d++) setTimeout(() => sound.play('cascade', 1 + 0.06 * (d - 1)), d * 70);
  render();
  const locked = [...result.lockedRows.map((r) => `Row ${r + 1}`), ...result.lockedColumns.map((c) => `Column ${c + 1}`)];
  if (locked.length && !result.solvedBoard) {
    sound.play('lock');
    $('announce').textContent = `${locked.join(' and ')} lit. ${state.litRows.length + state.litColumns.length} of 10 lamps.`;
  } else if (state.litRows.length + state.litColumns.length < rowsBefore + colsBefore) {
    $('announce').textContent = `${state.litRows.length + state.litColumns.length} of 10 lamps lit.`;
  }
  if (result.solvedBoard) return finish();
  save();
  maybeStuck();
}

function undo() {
  if (solved || !history.length) return;
  state.restore(history.pop());
  render();
  save();
}

function reset() {
  if (solved) return;
  state.reset();
  history = [];
  selected = null;
  render();
  save();
}

function save() {
  storage.set(key('progress'), { ...state.snapshot(), elapsed: elapsed(), history: history.slice(-200) });
}

function elapsed() {
  return elapsedBefore + (runningSince === null ? 0 : (Date.now() - runningSince) / 1000);
}

function updateClock() {
  const s = Math.floor(elapsed());
  $('time').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function maybeStuck() {
  if (!$('stuck').hidden) return;
  if (elapsed() >= STUCK_SECONDS || state.moves >= STUCK_MOVES) $('stuck').hidden = false;
}

function wire() {
  $('back').addEventListener('click', () => turn(-1));
  $('forward').addEventListener('click', () => turn(1));
  $('undo').addEventListener('click', undo);
  $('reset').addEventListener('click', reset);
  $('sound').addEventListener('click', () => { setSound(!sound.on); sound.play('tap'); });
  // Keyboard: arrows pick (from the top left), Q turns back, E forward, Z undoes.
  document.addEventListener('keydown', (e) => {
    if (solved || e.metaKey || e.ctrlKey || e.altKey) return;
    const n = lock.size;
    const moves = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
    if (moves[e.key]) {
      e.preventDefault();
      if (selected === null) return select(0);
      const r = Math.min(n - 1, Math.max(0, Math.floor(selected / n) + moves[e.key][0]));
      const c = Math.min(n - 1, Math.max(0, (selected % n) + moves[e.key][1]));
      select(r * n + c);
      wheels[selected].pick.focus({ preventScroll: true });
    } else if (e.key === 'q' || e.key === 'Q') turn(-1);
    else if (e.key === 'e' || e.key === 'E') turn(1);
    else if (e.key === 'z' || e.key === 'Z') undo();
  });
  tick = setInterval(() => { if (runningSince !== null) { updateClock(); maybeStuck(); } }, 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && runningSince !== null) { elapsedBefore = elapsed(); runningSince = null; save(); }
  });
}

// MARK: Opening (board 11, simplified)

function finish() {
  solved = true;
  clearInterval(tick);
  const seconds = Math.floor(elapsed());
  runningSince = null;
  elapsedBefore = seconds;
  selected = null;
  render();
  const result = { moves: state.moves, seconds, stars: state.stars, par: lock.par, offsets: state.offsets.slice() };
  storage.set(key('result'), result);
  storage.set(key('progress'), null);
  $('announce').textContent = `Unlocked in ${result.moves} moves. Par ${lock.par}. ${result.stars} of 3 stars.`;
  if (reduceMotion.matches) return showSolved(result, true);
  const vault = $('vault');
  // The lamp chase, then the dial, bolts, door, light and flash (CSS keyframes), then the result.
  document.querySelectorAll('.lamp').forEach((lamp, k) => setTimeout(() => sound.play('lampTick'), k * 45));
  vault.classList.add('unlocking');
  [1100, 1180, 1260, 1340].forEach((t) => setTimeout(() => sound.play('bolt'), t));
  setTimeout(() => sound.play('doorRelease'), 1750);
  setTimeout(() => sound.play('vaultChime'), 2050);
  setTimeout(() => showSolved(result, true), 3000);
}

function showSolved(result, justNow) {
  solved = true;
  const vault = $('vault');
  vault.classList.remove('unlocking');
  vault.classList.add('opened');
  $('app').classList.add('solved');
  $('app').setAttribute('aria-busy', 'false');
  $('moves').textContent = result.moves;
  $('time').textContent = `${Math.floor(result.seconds / 60)}:${String(result.seconds % 60).padStart(2, '0')}`;
  $('stars').innerHTML = [0, 1, 2].map((k) => {
    const on = k < result.stars;
    return `<svg viewBox="0 0 24 24" style="filter:${on ? 'drop-shadow(0 0 8px rgba(255,200,110,.9))' : 'none'}"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" fill="${on ? '#FFD27A' : 'rgba(255,255,255,.06)'}" stroke="#F0CF8E" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
  }).join('');
  $('verdict').textContent = `Opened in ${result.moves} moves · ${verdict(result.moves, result.par)}`;
  $('next-lock').hidden = justNow;
  const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  $('install-ios').hidden = !apple;
  $('install-other').hidden = apple;
  $('result').hidden = false;
  fitBoard();
  if (!justNow) {
    $('announce').textContent = `You opened this week's lock in ${result.moves} moves. A new lock arrives Monday.`;
  }
  if (!$('share').dataset.wired) {
    $('share').dataset.wired = '1';
    $('share').addEventListener('click', share);
  }
  window._result = result;
}

/** "Matched par", "1 under par", "3 over par" (the Unlocked screen's verdict). */
function verdict(moves, par) {
  if (moves === par) return `matched par ${par}`;
  return moves < par ? `${par - moves} under par ${par}` : `${moves - par} over par ${par}`;
}

// MARK: Sharing (17-ShareCard.html's message; no letters or words)

/** ⚙️ per move up to par, then 🔩 per move over it (at most 8, then "+N"). */
export function gears(moves, par) {
  const over = Math.max(0, moves - par);
  let s = '⚙️'.repeat(Math.min(Math.max(moves, 0), par)) + '🔩'.repeat(Math.min(over, 8));
  if (over > 8) s += ` +${over - 8}`;
  return s;
}

export function shareText(number, r) {
  const clock = `${Math.floor(r.seconds / 60)}:${String(r.seconds % 60).padStart(2, '0')}`;
  return [
    `Cogword Weekly Lock No. ${number} ${'⭐'.repeat(r.stars)}`,
    `Opened in ${r.moves} moves · par ${r.par} · ${clock}`,
    gears(r.moves, r.par),
    SHARE_URL,
  ].join('\n');
}

async function share() {
  const r = window._result || storage.get(key('result'));
  if (!r) return;
  const text = shareText(Number($('lock-number').textContent.replace(/\D/g, '')), r);
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(text);
    $('share-label').textContent = 'Copied';
  } catch {
    $('share-label').textContent = 'Couldn’t copy';
  }
  setTimeout(() => { $('share-label').textContent = 'Share my lock'; }, 2000);
}

start().catch(() => {
  $('app').setAttribute('aria-busy', 'false');
  $('help').textContent = 'The workshop is closed for a moment. Try again shortly.';
});
