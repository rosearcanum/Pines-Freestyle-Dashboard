
const API_KEY          = 'AIzaSyDnXcYZ3kP3sm1fA9429CcduvRVOc7yNVo';
const SPREADSHEET_ID   = '19LKhKBK6JUM6U30Bb_asmIHyyt53loDuI_ljnqwTPN0';
const DATA_RANGE       = 'B3:F100';
const REFRESH_MS       = 60 * 1000;
const WARN_MINUTES     = 10;
const URGENT_MINUTES   = 5;
const ZAMBONI_DURATION = 10;
const ZAMBONI_RANGE    = 'P3:P50';   // Zamboni start times on each day's tab (header in P2)

let refreshTimer    = null;
let countdownTimer  = null;
let nextRefreshSecs = REFRESH_MS / 1000;
let tickInterval    = null;
let allSkaterData   = [];
let zamboniTimes    = [];
let lastZamboniHtml = '';

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

function showToast(message, duration = 10000) {
    const container = document.getElementById('toast-container');
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

function scheduleMidnightReset() {
    const now      = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 10);
    setTimeout(() => {
        zamboniTimes  = [];
        allSkaterData = [];
        renderZamboniList();
        fetchData();
        scheduleMidnightReset();
    }, midnight - now);
}

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

function getZamboniBonus(timeOnDate, timeOffDate) {
    if (!timeOnDate || !timeOffDate) return 0;
    let bonus = 0;
    zamboniTimes.forEach(zStart => {
        const zEnd = new Date(zStart.getTime() + ZAMBONI_DURATION * 60000);
        if (zStart < timeOffDate && zEnd > timeOnDate) bonus += ZAMBONI_DURATION;
    });
    return bonus;
}

function processZamboni(rows) {
    const seen  = {};
    const times = [];
    rows.forEach(r => {
        const t = parseTime(r && r[0] != null ? String(r[0]) : '');
        if (t && !seen[t.getTime()]) { seen[t.getTime()] = true; times.push(t); }
    });
    zamboniTimes = times.sort((a, b) => a - b);
    renderZamboniList();
}

function renderZamboniList() {
    const list    = document.getElementById('zamboni-list');
    const countEl = document.getElementById('zamboni-count');
    if (countEl) countEl.textContent = zamboniTimes.length;
    if (!list) return;

    const now = new Date();
    let html;
    if (zamboniTimes.length === 0) {
        html = '<li class="zamboni-empty">No cleanings logged yet</li>';
    } else {
        html = zamboniTimes.map(z => {
            const zEnd  = new Date(z.getTime() + ZAMBONI_DURATION * 60000);
            const state = now >= zEnd ? 'done' : (now >= z ? 'now' : 'upcoming');
            const note  = state === 'now' ? 'Cleaning now' : (state === 'done' ? 'Done' : 'until ' + formatTimeStr12(zEnd));
            return '<li class="zamboni-item is-' + state + '">' +
                '<span class="zamboni-time">' + formatTimeStr12(z) + '</span>' +
                '<span class="zamboni-window">' + note + '</span>' +
                '</li>';
        }).join('');
    }
    if (html !== lastZamboniHtml) {
        list.innerHTML  = html;
        lastZamboniHtml = html;
    }
}

window.addEventListener('load', () => {
    startClock();
    fetchData();
    startRefreshCycle();
    renderZamboniList();
    scheduleMidnightReset();
});

function startClock() {
    const tick = () => {
        const el = document.getElementById('live-clock');
        if (el) el.textContent = formatTime12(new Date());
        renderZamboniList();   // keeps "Cleaning now" / "Done" current even when the rink is empty
    };
    tick();
    setInterval(tick, 1000);
}

function startRefreshCycle() {
    nextRefreshSecs = REFRESH_MS / 1000;
    clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
        nextRefreshSecs--;
        const el = document.getElementById('stat-refresh');
        if (el) el.textContent = nextRefreshSecs > 0 ? nextRefreshSecs + 's' : '...';
        if (nextRefreshSecs <= 0) nextRefreshSecs = REFRESH_MS / 1000;
    }, 1000);
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
        silentFetch();
        nextRefreshSecs = REFRESH_MS / 1000;
    }, REFRESH_MS);
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
    const tabEl = document.getElementById('sheet-tab');
    if (tabEl) tabEl.textContent = 'Sheet: ' + sheetName;
    const url = buildSheetUrl(sheetName);
    try {
        const res = await fetch(url);
        if (!res.ok) {
            const err = await res.json();
            if (err && err.error && (err.error.code === 400 || err.error.code === 404)) {
                throw new Error('No sheet tab found for today ("' + sheetName + '"). Create it in Google Sheets to get started.');
            }
            throw new Error((err && err.error && err.error.message) || 'HTTP ' + res.status);
        }
        const data = await res.json();
        applySheetData(data);
        setStatus('live');
        updateLastRefreshed();
    } catch (e) {
        console.error('Fetch error:', e);
        setStatus('error');
        showError(e.message);
    }
}

async function silentFetch() {
    const sheetName = getTodaySheetName();
    const url = buildSheetUrl(sheetName);
    try {
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        applySheetData(data);
        setStatus('live');
        updateLastRefreshed();
    } catch (e) {
        console.error('Silent fetch error:', e);
    }
}

function processRows(rows) {
    const skaters = rows.filter(r => r && r[0] && r[0].trim() !== '');
    allSkaterData = skaters.map(row => {
        const name      = row[0] || '—';
        const duration  = row[1] || '—';
        const timeOn    = row[2] || '';
        const timeOff   = row[3] || '';
        const coach     = row[4] || '—';
        const timeOnDate  = parseTime(timeOn);
        const timeOffDate = parseTime(timeOff);
        return { name, duration, timeOn, timeOff, coach, timeOnDate, timeOffDate };
    });
    renderVisible();
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

function renderVisible() {
    const tbody = document.getElementById('skater-tbody');
    const now   = new Date();

    let visible = allSkaterData.map(withZamboni).filter(s => isOnIce(s, now));

    if (visible.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="6"><div class="empty-msg">No skaters currently on ice</div></td></tr>';
        updateStats(0, 0);
        updateAffectedCount(0);
        return;
    }

    visible.sort((a, b) => {
        if (a.effectiveTimeOff && b.effectiveTimeOff) return a.effectiveTimeOff - b.effectiveTimeOff;
        if (a.effectiveTimeOff) return -1;
        if (b.effectiveTimeOff) return 1;
        return 0;
    });

    const urgentCount   = visible.filter(s => s.effectiveTimeOff && (s.effectiveTimeOff - now) / 60000 <= WARN_MINUTES).length;
    const affectedCount = visible.filter(s => s.bonus > 0).length;
    updateStats(visible.length, urgentCount);
    updateAffectedCount(affectedCount);

    tbody.innerHTML = visible.map((s, i) => {
        const remainingMin = s.effectiveTimeOff ? (s.effectiveTimeOff - now) / 60000 : null;
        const urg = getUrgency(remainingMin);
        const badge = s.bonus > 0 ? '<span class="zamboni-badge">+' + s.bonus + 'm 🚧</span>' : '';
        const timeOffDisplay = s.effectiveTimeOff ? formatTimeStr12(s.effectiveTimeOff) : formatTimeStr(s.timeOff);
        return '<tr class="' + urg.rowClass + '" style="animation-delay:' + (i * 0.05) + 's"' +
            ' data-timeout="' + (s.effectiveTimeOff ? s.effectiveTimeOff.getTime() : '') + '"' +
            ' data-timeon="' + (s.timeOnDate ? s.timeOnDate.getTime() : '') + '"' +
            ' data-name="' + escHtml(s.name) + '">' +
            '<td class="td-name">' + escHtml(s.name) + badge + '</td>' +
            '<td class="td-coach">' + escHtml(s.coach) + '</td>' +
            '<td class="td-duration">' + formatDuration(s.duration) + '</td>' +
            '<td class="td-time">' + formatTimeStr(s.timeOn) + '</td>' +
            '<td class="td-timeout">' + timeOffDisplay + '</td>' +
            '<td class="td-remaining ' + urg.urgencyClass + '" data-timeout="' + (s.effectiveTimeOff ? s.effectiveTimeOff.getTime() : '') + '">' + urg.label + '</td>' +
            '</tr>';
    }).join('');

    startCountdownTick();
}

function startCountdownTick() {
    clearInterval(tickInterval);
    tickInterval = setInterval(updateCountdowns, 1000);
}

function updateCountdowns() {
    const now = new Date();

    const anyNew = allSkaterData.map(withZamboni).some(s => {
        const inTable = document.querySelector('#skater-tbody tr[data-timeon="' + (s.timeOnDate ? s.timeOnDate.getTime() : '') + '"]');
        return isOnIce(s, now) && !inTable;
    });
    if (anyNew) { renderVisible(); return; }

    const rows = document.querySelectorAll('#skater-tbody tr[data-timeout]');
    let urgentCount = 0;
    let toRemove = [];

    rows.forEach(row => {
        const ts = parseInt(row.dataset.timeout);
        if (!ts) return;
        const remainingMin = (ts - now.getTime()) / 60000;
        if (remainingMin <= 0) { toRemove.push(row); return; }
        const urg = getUrgency(remainingMin);
        const cell = row.querySelector('.td-remaining');
        if (cell) { cell.textContent = urg.label; cell.className = 'td-remaining ' + urg.urgencyClass; }
        row.className = urg.rowClass;
        if (remainingMin <= WARN_MINUTES) urgentCount++;
    });

    toRemove.forEach(row => {
        const name = row.dataset.name || 'A skater';
        row.style.transition = 'opacity 0.7s';
        row.style.opacity = '0';
        setTimeout(() => {
            row.remove();
            showToast('⏰ ' + name + "'s time has run out", 10000);
        }, 700);
    });

    const remaining = rows.length - toRemove.length;
    const totalEl  = document.getElementById('stat-total');
    const urgentEl = document.getElementById('stat-urgent');
    if (totalEl)  totalEl.textContent = Math.max(0, remaining);
    if (urgentEl) urgentEl.textContent = urgentCount;
}

function getUrgency(remainingMin) {
    if (remainingMin === null) return { urgencyClass: '',        rowClass: '',           label: '—' };
    if (remainingMin <= 0)     return { urgencyClass: 'expired', rowClass: '',           label: 'TIME EXPIRED' };
    const label = formatCountdown(remainingMin);
    if (remainingMin <= URGENT_MINUTES) return { urgencyClass: 'urgent',  rowClass: 'row-urgent',  label: label };
    if (remainingMin <= WARN_MINUTES)   return { urgencyClass: 'warning', rowClass: 'row-warning', label: label };
    return { urgencyClass: 'ok', rowClass: '', label: label };
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

function formatTime12(date) {
    let h = date.getHours();
    const m  = String(date.getMinutes()).padStart(2, '0');
    const s  = String(date.getSeconds()).padStart(2, '0');
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + m + ':' + s + ' ' + ap;
}

function formatTimeStr12(date) {
    let h = date.getHours();
    const m  = String(date.getMinutes()).padStart(2, '0');
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + m + ' ' + ap;
}

function formatTimeStr(str) { return (!str || str.trim() === '') ? '—' : str.trim(); }

function formatCountdown(minutes) {
    const totalSecs = Math.floor(minutes * 60);
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    return String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
}

function setStatus(state) {
    const dot  = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    if (!dot || !text) return;
    dot.className = 'status-dot';
    if (state === 'live')       { dot.classList.add('live');  text.textContent = 'Live'; }
    else if (state === 'error') { dot.classList.add('error'); text.textContent = 'Error'; }
    else                        { text.textContent = 'Connecting...'; }
}

function showError(msg) {
    const tbody = document.getElementById('skater-tbody');
    if (tbody) tbody.innerHTML = '<tr class="empty-row"><td colspan="6"><div class="empty-msg">' + escHtml(msg) + '</div></td></tr>';
}

function updateStats(total, urgent) {
    const t = document.getElementById('stat-total');
    const u = document.getElementById('stat-urgent');
    if (t) t.textContent = total;
    if (u) u.textContent = urgent;
}

function updateAffectedCount(count) {
    const el = document.getElementById('zamboni-affected');
    if (el) el.textContent = count;
}

function updateLastRefreshed() {
    const el = document.getElementById('last-updated');
    if (el) el.textContent = 'Last updated: ' + formatTime12(new Date());
}

function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
