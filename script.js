
const API_KEY          = 'AIzaSyDnXcYZ3kP3sm1fA9429CcduvRVOc7yNVo';
const SPREADSHEET_ID   = '19LKhKBK6JUM6U30Bb_asmIHyyt53loDuI_ljnqwTPN0';
const DATA_RANGE       = 'B3:F100';
const ZAMBONI_RANGE    = 'P3:P50';   // Zamboni start times on each day's tab (header in P2)
const REFRESH_MS       = 60 * 1000;
const WARN_MINUTES     = 10;         // "Leaving soon" group, gold
const URGENT_MINUTES   = 5;          // red
const ZAMBONI_DURATION = 10;
const SCROLL_HOLD_TOP        = 10;  // TV: seconds to stay at the top before scrolling
const SCROLL_SECONDS_PER_ROW = 3;   // TV: scroll speed, seconds per skater (bigger = slower)
const SCROLL_HOLD_BOTTOM     = 6;   // TV: seconds to stay at the end before going back to the top
const SCROLL_FADE            = 0.6; // TV: seconds for the fade back to the top
const ZAMBONI_TV_MAX   = 5;          // cleanings shown at once on the TV timeline
const TV_QUERY         = '(min-width: 1200px)';
const THEME_KEY        = 'freestyle-theme';

let allSkaterData   = [];
let zamboniTimes    = [];
let lastSignature   = '';
let lastZamboniHtml = '';
let renderedKeys    = new Map();   // skater key -> effective time off (ms)
let toastedKeys     = new Set();
let exitPending     = false;
let scrollAnim      = null;

const $ = id => document.getElementById(id);

/* ===== Theme ===== */

function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = $('theme-toggle');
    if (btn) btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0F1720' : '#A8D8EA');
}

function toggleTheme() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
}

/* ===== Formatting ===== */

function formatDuration(raw) {
    if (!raw || raw.trim() === '') return '—';
    const s = raw.trim().toLowerCase();

    if (s === '30' || s === '30 min' || s === '30min')                          return '30 min';
    if (s === '60' || s === '60 min' || s === '60min' || s === '1 hr')          return '60 min';
    if (s === '90' || s === '90 min' || s === '90min' || s === '1.5 hr')        return '90 min';
    if (s === '120' || s === '120 min' || s === '120min' || s === '2 hr')       return '120 min';
    if (s === 'nm 30' || s === 'nm30' || s === 'non member 30' ||
        s === 'non-member 30' || s === 'non member 30 min' ||
        s === 'non-member 30 min')                                               return 'Non-Member 30 min';
    if (s === 'nm 60' || s === 'nm60' || s === 'non member 60' ||
        s === 'non-member 60' || s === 'non member 60 min' ||
        s === 'non-member 60 min')                                               return 'Non-Member 60 min';

    if (/^\d+$/.test(s)) return s + ' min';

    return raw.trim();
}

function formatCoach(raw) {
    const c = (raw || '').trim();
    if (!c || c === '—' || c === '-') return '';
    return /^coach\b/i.test(c) ? c : 'Coach ' + c;
}

function formatTimeStr12(date) {
    let h = date.getHours();
    const m  = String(date.getMinutes()).padStart(2, '0');
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + m + ' ' + ap;
}

function formatTimeStr(str) { return (!str || str.trim() === '') ? '—' : str.trim(); }

function formatSpan(s) {
    if (!s.timeOnDate || !s.timeOffDate) return formatTimeStr(s.timeOn);
    const a = formatTimeStr12(s.timeOnDate);
    const b = formatTimeStr12(s.timeOffDate);
    if (a.slice(-2) === b.slice(-2)) return a.slice(0, -3) + ' to ' + b;
    return a + ' to ' + b;
}

function formatCountdown(minutes) {
    const totalSecs = Math.max(0, Math.floor(minutes * 60));
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseTime(str) {
    if (!str || str.trim() === '') return null;
    str = str.trim();
    const now = new Date();
    const m12 = str.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(AM|PM)$/i);
    if (m12) {
        let h = parseInt(m12[1]);
        const m = m12[2] ? parseInt(m12[2]) : 0;
        const ap = m12[3].toUpperCase();
        if (ap === 'PM' && h !== 12) h += 12;
        if (ap === 'AM' && h === 12) h = 0;
        return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
    }
    const m24 = str.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (m24) return new Date(now.getFullYear(), now.getMonth(), now.getDate(), parseInt(m24[1]), parseInt(m24[2]), 0, 0);
    return null;
}

/* ===== Toasts ===== */

function showToast(message, duration = 10000) {
    const container = $('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => {
        requestAnimationFrame(() => toast.classList.add('show'));
    });
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 500);
    }, duration);
}

/* ===== Sheet ===== */

function getTodaySheetName() {
    const day = new Date().getDate();
    if (day === 1)  return '1st';
    if (day === 2)  return '2nd';
    if (day === 3)  return '3rd';
    if (day === 4)  return '4th';
    if (day === 5)  return '5th';
    if (day === 6)  return '6th';
    if (day === 7)  return '7th';
    if (day === 8)  return '8th';
    if (day === 9)  return '9th';
    if (day === 10) return '10th';
    if (day === 11) return '11th';
    if (day === 12) return '12th';
    if (day === 13) return '13th';
    if (day === 14) return '14th';
    if (day === 15) return '15th';
    if (day === 16) return '16th';
    if (day === 17) return '17th';
    if (day === 18) return '18th';
    if (day === 19) return '19th';
    if (day === 20) return '20th';
    if (day === 21) return '21st';
    if (day === 22) return '22nd';
    if (day === 23) return '23rd';
    if (day === 24) return '24th';
    if (day === 25) return '25th';
    if (day === 26) return '26th';
    if (day === 27) return '27th';
    if (day === 28) return '28th';
    if (day === 29) return '29th';
    if (day === 30) return '30th';
    if (day === 31) return '31st';
}

function buildSheetUrl(sheetName) {
    const tab = encodeURIComponent(sheetName);
    return 'https://sheets.googleapis.com/v4/spreadsheets/' + SPREADSHEET_ID + '/values:batchGet' +
        '?ranges=' + tab + '!' + DATA_RANGE +
        '&ranges=' + tab + '!' + ZAMBONI_RANGE +
        '&key=' + API_KEY;
}

function applySheetData(data) {
    const ranges = (data && data.valueRanges) || [];
    processZamboni((ranges[1] && ranges[1].values) || []);
    processRows((ranges[0] && ranges[0].values) || []);
}

async function fetchData() {
    setStatus('connecting');
    const sheetName = getTodaySheetName();
    try {
        const res = await fetch(buildSheetUrl(sheetName));
        if (!res.ok) {
            const err = await res.json().catch(() => null);
            if (err && err.error && (err.error.code === 400 || err.error.code === 404)) {
                throw new Error('There is no tab for today ("' + sheetName + '") in the sheet yet. Add it to get started.');
            }
            throw new Error((err && err.error && err.error.message) || 'The sheet could not be reached (HTTP ' + res.status + ').');
        }
        applySheetData(await res.json());
        setStatus('live');
        updateLastRefreshed();
    } catch (e) {
        console.error('Fetch error:', e);
        setStatus('error');
        showError(e.message);
    }
}

async function silentFetch() {
    try {
        const res = await fetch(buildSheetUrl(getTodaySheetName()));
        if (!res.ok) return;
        applySheetData(await res.json());
        setStatus('live');
        updateLastRefreshed();
    } catch (e) {
        console.error('Silent fetch error:', e);
    }
}

function processRows(rows) {
    const skaters = rows.filter(r => r && r[0] && r[0].trim() !== '');
    allSkaterData = skaters.map(row => {
        const name     = row[0] || '—';
        const duration = row[1] || '—';
        const timeOn   = row[2] || '';
        const timeOff  = row[3] || '';
        const coach    = row[4] || '';
        return { name, duration, timeOn, timeOff, coach, timeOnDate: parseTime(timeOn), timeOffDate: parseTime(timeOff) };
    });
    renderVisible(true);
}

function processZamboni(rows) {
    const seen  = {};
    const times = [];
    rows.forEach(r => {
        const t = parseTime(r && r[0] != null ? String(r[0]) : '');
        if (t && !seen[t.getTime()]) { seen[t.getTime()] = true; times.push(t); }
    });
    zamboniTimes = times.sort((a, b) => a - b);
    renderZamboni();
}

/* ===== Zamboni bonus ===== */

function getZamboniBonus(timeOnDate, timeOffDate) {
    if (!timeOnDate || !timeOffDate) return 0;
    let bonus = 0;
    zamboniTimes.forEach(zStart => {
        const zEnd = new Date(zStart.getTime() + ZAMBONI_DURATION * 60000);
        if (zStart < timeOffDate && zEnd > timeOnDate) bonus += ZAMBONI_DURATION;
    });
    return bonus;
}

function withZamboni(s) {
    const bonus = getZamboniBonus(s.timeOnDate, s.timeOffDate);
    const effectiveTimeOff = s.timeOffDate ? new Date(s.timeOffDate.getTime() + bonus * 60000) : null;
    return Object.assign({}, s, { bonus: bonus, effectiveTimeOff: effectiveTimeOff });
}

function isOnIce(s, now) {
    const started = s.timeOnDate && s.timeOnDate <= now;
    const notOver = !s.effectiveTimeOff || s.effectiveTimeOff > now;
    return started && notOver;
}

/* ===== Skater list ===== */

function skaterKey(s) { return s.name + '|' + s.timeOn + '|' + s.timeOff; }

function minutesLeft(s, now) { return s.effectiveTimeOff ? (s.effectiveTimeOff - now) / 60000 : null; }

function isSoon(s, now) {
    const left = minutesLeft(s, now);
    return left !== null && left <= WARN_MINUTES;
}

function urgencyClass(left) {
    if (left === null) return '';
    if (left <= URGENT_MINUTES) return 'is-urgent';
    if (left <= WARN_MINUTES) return 'is-warn';
    return '';
}

function percentLeft(s, now) {
    if (!s.timeOnDate || !s.effectiveTimeOff) return 100;
    const total = s.effectiveTimeOff - s.timeOnDate;
    if (total <= 0) return 0;
    return Math.max(0, Math.min(100, ((s.effectiveTimeOff - now) / total) * 100));
}

function getVisible(now) {
    return allSkaterData
        .map(withZamboni)
        .filter(s => isOnIce(s, now))
        .sort((a, b) => {
            if (a.effectiveTimeOff && b.effectiveTimeOff) return a.effectiveTimeOff - b.effectiveTimeOff;
            if (a.effectiveTimeOff) return -1;
            if (b.effectiveTimeOff) return 1;
            return 0;
        });
}

function signatureOf(visible, now) {
    return visible.map(s =>
        skaterKey(s) + '@' + (s.effectiveTimeOff ? s.effectiveTimeOff.getTime() : '') +
        ':' + (isSoon(s, now) ? 's' : 'i') + ':' + s.coach + ':' + s.duration
    ).join('|');
}

function rowHtml(s, now) {
    const left    = minutesLeft(s, now);
    const plus    = s.bonus > 0 ? '<span class="plus">+' + s.bonus + '</span>' : '';
    const coach   = formatCoach(s.coach);
    const offText = s.effectiveTimeOff ? formatTimeStr12(s.effectiveTimeOff) : formatTimeStr(s.timeOff);
    const label   = left === null ? '—' : formatCountdown(left);
    return '<div class="row ' + urgencyClass(left) + '"' +
        ' data-key="' + escHtml(skaterKey(s)) + '"' +
        ' data-timeon="' + (s.timeOnDate ? s.timeOnDate.getTime() : '') + '"' +
        ' data-timeout="' + (s.effectiveTimeOff ? s.effectiveTimeOff.getTime() : '') + '">' +
        '<div class="row-main">' +
            '<div class="cell-name">' +
                '<span class="name">' + escHtml(s.name) + '</span>' +
                (coach ? '<span class="coach">' + escHtml(coach) + '</span>' : '') +
                '<span class="meta-mobile">Off ' + escHtml(offText) + (plus ? ' ' + plus : '') + '</span>' +
            '</div>' +
            '<div class="cell-session">' +
                '<span class="dur">' + escHtml(formatDuration(s.duration)) + '</span>' +
                '<span class="span">' + escHtml(formatSpan(s)) + '</span>' +
            '</div>' +
            '<div class="cell-off"><span class="off">' + escHtml(offText) + '</span>' + plus + '</div>' +
            '<div class="countdown">' + label + '</div>' +
        '</div>' +
        '<div class="bar"><div class="bar-fill" style="width:' + percentLeft(s, now).toFixed(2) + '%"></div></div>' +
    '</div>';
}

function renderVisible(force) {
    const now     = new Date();
    const visible = getVisible(now);
    const sig     = signatureOf(visible, now);

    updateStats(visible, now);
    updateAffected(now);

    if (!force && sig === lastSignature) { tickRows(now); return; }
    lastSignature = sig;
    renderedKeys  = new Map(visible.map(s => [skaterKey(s), s.effectiveTimeOff ? s.effectiveTimeOff.getTime() : null]));

    const soon = visible.filter(s => isSoon(s, now));
    const ice  = visible.filter(s => !isSoon(s, now));

    $('empty-msg').hidden = visible.length > 0;
    if (visible.length === 0) $('empty-msg').textContent = 'No skaters on the ice right now';

    $('group-soon').hidden = soon.length === 0;
    $('soon-list').innerHTML = soon.map(s => rowHtml(s, now)).join('');

    $('group-ice').hidden = ice.length === 0;
    const iceHtml = ice.map(s => rowHtml(s, now)).join('');
    $('ice-list').innerHTML = iceHtml;

    updateAutoScroll();
}

function tickRows(now) {
    document.querySelectorAll('.row[data-timeout]').forEach(row => {
        const eff = Number(row.dataset.timeout);
        if (!eff) return;
        const on   = Number(row.dataset.timeon);
        const left = (eff - now.getTime()) / 60000;
        const cd = row.querySelector('.countdown');
        if (cd) cd.textContent = formatCountdown(left);
        row.classList.toggle('is-urgent', left <= URGENT_MINUTES);
        row.classList.toggle('is-warn', left > URGENT_MINUTES && left <= WARN_MINUTES);
        const fill = row.querySelector('.bar-fill');
        if (fill && on && eff > on) {
            const pct = Math.max(0, Math.min(100, ((eff - now.getTime()) / (eff - on)) * 100));
            fill.style.width = pct.toFixed(2) + '%';
        }
    });
}

function checkExpired(now) {
    let anyExpired = false;
    renderedKeys.forEach((eff, key) => {
        if (eff && eff <= now.getTime() && !toastedKeys.has(key)) {
            toastedKeys.add(key);
            anyExpired = true;
            document.querySelectorAll('.row').forEach(r => { if (r.dataset.key === key) r.classList.add('is-leaving'); });
            showToast(key.split('|')[0] + "'s time has run out", 10000);
        }
    });
    if (anyExpired) {
        exitPending = true;
        setTimeout(() => { exitPending = false; renderVisible(true); }, 700);
    }
}

/* ===== TV auto-scroll ===== */

function updateAutoScroll() {
    const scroller = $('scroller');
    const track    = $('scroll-track');
    const list     = $('ice-list');
    const isTV     = window.matchMedia(TV_QUERY).matches;
    const reduce   = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Remember where we were, so a refresh doesn't restart the cycle
    let resumeAt = 0;
    if (scrollAnim) {
        resumeAt = Number(scrollAnim.currentTime) || 0;
        scrollAnim.cancel();
        scrollAnim = null;
    }
    scroller.classList.remove('is-scrolling');

    if (!isTV || list.children.length === 0) return;

    scroller.classList.add('is-scrolling');   // adds the end padding and fade before measuring
    const distance = track.scrollHeight - scroller.clientHeight;
    if (distance <= 2) { scroller.classList.remove('is-scrolling'); return; }
    if (reduce || !track.animate) return;     // reduced motion: the list can be scrolled by hand instead

    const rowHeight  = list.firstElementChild.offsetHeight || 1;
    const scrollSecs = Math.max(4, (distance / rowHeight) * SCROLL_SECONDS_PER_ROW);
    const total      = SCROLL_HOLD_TOP + scrollSecs + SCROLL_HOLD_BOTTOM + SCROLL_FADE * 2;
    const at         = secs => secs / total;
    const tDown      = SCROLL_HOLD_TOP;
    const tEnd       = tDown + scrollSecs;
    const tFade      = tEnd + SCROLL_HOLD_BOTTOM;
    const tGone      = tFade + SCROLL_FADE;
    const top        = 'translateY(0)';
    const bottom     = 'translateY(' + (-distance) + 'px)';

    // Hold at the top, scroll down to the last skater, hold, fade back to the top, repeat
    scrollAnim = track.animate([
        { offset: 0,                                  transform: top,    opacity: 1 },
        { offset: at(tDown),                          transform: top,    opacity: 1, easing: 'ease-in-out' },
        { offset: at(tEnd),                           transform: bottom, opacity: 1 },
        { offset: at(tFade),                          transform: bottom, opacity: 1, easing: 'ease-in' },
        { offset: at(tGone),                          transform: bottom, opacity: 0 },
        { offset: Math.min(1, at(tGone) + 0.0001),    transform: top,    opacity: 0, easing: 'ease-out' },
        { offset: 1,                                  transform: top,    opacity: 1 }
    ], { duration: total * 1000, iterations: Infinity });

    if (resumeAt) scrollAnim.currentTime = resumeAt % (total * 1000);
}

/* ===== Zamboni panel ===== */

function zamboniItems(now) {
    return zamboniTimes.map(start => {
        const end   = new Date(start.getTime() + ZAMBONI_DURATION * 60000);
        const state = now >= end ? 'done' : (now >= start ? 'now' : 'next');
        return { start, end, state };
    });
}

function renderZamboni() {
    const now   = new Date();
    const items = zamboniItems(now);

    // TV timeline: keep it to a few entries, centred on what is happening now
    let html;
    if (items.length === 0) {
        html = '<li class="z-empty">No cleanings logged yet</li>';
    } else {
        const firstActive = items.findIndex(i => i.state !== 'done');
        const anchor = firstActive === -1 ? items.length : firstActive;
        const start  = Math.max(0, Math.min(anchor - 1, items.length - ZAMBONI_TV_MAX));
        const shown  = items.slice(start, start + ZAMBONI_TV_MAX);
        const later  = items.length - (start + shown.length);
        html = (start > 0 ? '<li class="z-more">' + start + ' earlier</li>' : '') +
            shown.map(i => {
                const note = i.state === 'done' ? 'Done' : (i.state === 'now' ? 'Cleaning now' : 'Until ' + formatTimeStr12(i.end));
                return '<li class="z-item is-' + i.state + '"><span class="z-dot"></span>' +
                    '<span class="z-body"><span class="z-time">' + formatTimeStr12(i.start) + '</span>' +
                    '<span class="z-note">' + note + '</span></span></li>';
            }).join('') +
            (later > 0 ? '<li class="z-more">' + later + ' later</li>' : '');
    }
    const list = $('zamboni-list');
    if (list && html !== lastZamboniHtml) {
        list.innerHTML = html;
        list.classList.toggle('is-empty', items.length === 0);
        lastZamboniHtml = html;
    }

    // Phone summary
    const statusEl  = $('zamboni-status');
    const summaryEl = $('zamboni-summary');
    const current   = items.find(i => i.state === 'now');
    const next      = items.find(i => i.state === 'next');
    const done      = items.filter(i => i.state === 'done');
    let status = '', quiet = false, summary;
    if (items.length === 0) {
        summary = 'No cleanings logged yet.';
    } else if (current) {
        status  = 'Cleaning now';
        summary = 'Until ' + formatTimeStr12(current.end) + '.' + (next ? ' Next at ' + formatTimeStr12(next.start) + '.' : '');
    } else if (next) {
        status  = 'Next at ' + formatTimeStr12(next.start);
        quiet   = true;
        summary = 'Next cleaning ' + formatTimeStr12(next.start) + ' to ' + formatTimeStr12(next.end) + '.';
    } else {
        status  = 'Done for now';
        quiet   = true;
        summary = 'Last cleaning was at ' + formatTimeStr12(done[done.length - 1].start) + '.';
    }
    if (statusEl) {
        statusEl.hidden = !status;
        if (statusEl.textContent !== status) statusEl.textContent = status;
        statusEl.classList.toggle('is-quiet', quiet);
    }
    if (summaryEl && summaryEl.textContent !== summary) summaryEl.textContent = summary;
}

function updateAffected(now) {
    const el = $('zamboni-affected');
    if (!el) return;
    if (zamboniTimes.length === 0) { el.textContent = ''; return; }
    const n = allSkaterData.map(withZamboni).filter(s => s.bonus > 0 && s.timeOnDate && s.timeOnDate <= now).length;
    const text = n === 0 ? 'No skaters affected yet' : n + (n === 1 ? ' skater' : ' skaters') + ' got +10 min today';
    if (el.textContent !== text) el.textContent = text;
}

/* ===== Header bits ===== */

function updateClock(now) {
    let h = now.getHours();
    const m = String(now.getMinutes()).padStart(2, '0');
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    const t = $('clock-time'), a = $('clock-ampm');
    if (t && t.textContent !== h + ':' + m) t.textContent = h + ':' + m;
    if (a && a.textContent !== ap) a.textContent = ap;
}

function updateStats(visible, now) {
    const t = $('stat-total'), u = $('stat-urgent');
    if (t) t.textContent = visible.length;
    if (u) u.textContent = visible.filter(s => isSoon(s, now)).length;
}

function setStatus(state) {
    const dot = $('status-dot'), text = $('status-text'), detail = $('live-detail');
    if (!dot || !text) return;
    dot.className = 'status-dot';
    if (state === 'live') {
        dot.classList.add('live');
        text.textContent = 'Live';
        if (detail) detail.textContent = ', updates every minute';
    } else if (state === 'error') {
        dot.classList.add('error');
        text.textContent = "Can't reach the sheet";
        if (detail) detail.textContent = '';
    } else {
        text.textContent = 'Connecting';
        if (detail) detail.textContent = '';
    }
}

function showError(msg) {
    allSkaterData = [];
    lastSignature = '';
    renderedKeys  = new Map();
    $('group-soon').hidden = true;
    $('group-ice').hidden = true;
    $('empty-msg').hidden = false;
    $('empty-msg').textContent = msg;
    updateStats([], new Date());
}

function updateLastRefreshed() {
    const el = $('last-updated');
    if (el) el.textContent = 'Last updated ' + formatTimeStr12(new Date()) + '.';
}

/* ===== Timers ===== */

function tick() {
    const now = new Date();
    updateClock(now);
    renderZamboni();
    checkExpired(now);
    if (exitPending) tickRows(now);
    else renderVisible(false);
}

function scheduleMidnightReset() {
    const now      = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 10);
    setTimeout(() => {
        zamboniTimes  = [];
        allSkaterData = [];
        toastedKeys   = new Set();
        renderZamboni();
        fetchData();
        scheduleMidnightReset();
    }, midnight - now);
}

window.addEventListener('load', () => {
    applyTheme(currentTheme());
    $('theme-toggle').addEventListener('click', toggleTheme);
    $('refresh-btn').addEventListener('click', () => {
        const btn = $('refresh-btn');
        btn.classList.remove('spinning'); void btn.offsetWidth; btn.classList.add('spinning');
        fetchData();
    });

    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(updateAutoScroll, 200);
    });

    updateClock(new Date());
    renderZamboni();
    fetchData();
    setInterval(silentFetch, REFRESH_MS);
    setInterval(tick, 1000);
    scheduleMidnightReset();
});
