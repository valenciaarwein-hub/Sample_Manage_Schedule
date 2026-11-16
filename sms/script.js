/* ============================================================
   SKEDO · script.js — PART 1 of 2
   State, storage, calendar render, day list, create/edit,
   review, view, date picker, confirm, validation
   ============================================================ */

'use strict';

/* ============================================================
   1. GLOBAL STATE
   ============================================================ */
const State = {
    schedules: [],           // [{ id, date, title, time, type, status, late, description, createdAt, deletedAt? }]
    trash: [],               // soft-deleted schedules
    history: [],             // [{ id, action, title, date, notes, at }]
    recentImports: [],       // [{ id, fileName, count, importedAt, fileHash }]
    currentDate: new Date(), // anchor date (visible month / day / week)
    selectedDate: '',        // YYYY-MM-DD currently focused
    view: 'month',           // month | day | 3days | week
    editingId: null,
    pendingForm: null,       // held while review modal is open
    statusPopupTargetId: null,
    notifUnread: 0,
};

const STORAGE_KEYS = {
    schedules:     'skedo_schedules',
    trash:         'skedo_trash',
    history:       'skedo_history',
    recentImports: 'skedo_recent_imports',
    view:          'skedo_calendar_view',
};

/* ============================================================
   2. UTILITIES
   ============================================================ */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function pad(n) { return String(n).padStart(2, '0'); }

function ymd(d) {
    if (typeof d === 'string') return d;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseYmd(s) {
    if (!s) return null;
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addMonths(d, n) { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function formatDateLong(iso) {
    const d = parseYmd(iso);
    if (!d) return '—';
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function formatDateShort(iso) {
    const d = parseYmd(iso);
    if (!d) return '—';
    return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

function nowStamp() { return new Date().toISOString(); }

function formatStamp(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function uid() {
    return 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function todayIso() { return ymd(new Date()); }

/* Parse "01:00 PM" / "13:00" → minutes since midnight */
function parseTimeToMinutes(str) {
    if (!str) return null;
    const m = String(str).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const ap = (m[3] || '').toUpperCase();
    if (ap === 'PM' && h !== 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return h * 60 + min;
}

/* Parse a schedule's time field → { startMin, endMin } */
function scheduleRange(s) {
    if (!s.time) return null;
    const parts = String(s.time).split(/[–\-—]|to/i).map(p => p.trim()).filter(Boolean);
    if (!parts.length) return null;
    const startMin = parseTimeToMinutes(parts[0]);
    const endMin   = parts[1] ? parseTimeToMinutes(parts[1]) : (startMin != null ? startMin + 60 : null);
    if (startMin == null) return null;
    return { startMin, endMin: endMin == null ? startMin + 60 : endMin };
}

function minutesToTimeString(min) {
    if (min == null) return '';
    let h = Math.floor(min / 60) % 24;
    const m = min % 60;
    const ap = h < 12 ? 'AM' : 'PM';
    let hh = h % 12; if (hh === 0) hh = 12;
    return `${pad(hh)}:${pad(m)} ${ap}`;
}

/* ============================================================
   3. STORAGE
   ============================================================ */
function loadAll() {
    State.schedules     = safeParse(localStorage.getItem(STORAGE_KEYS.schedules), []);
    State.trash         = safeParse(localStorage.getItem(STORAGE_KEYS.trash), []);
    State.history       = safeParse(localStorage.getItem(STORAGE_KEYS.history), []);
    State.recentImports = safeParse(localStorage.getItem(STORAGE_KEYS.recentImports), []);
}

function saveSchedules()     { localStorage.setItem(STORAGE_KEYS.schedules, JSON.stringify(State.schedules)); }
function saveTrash()         { localStorage.setItem(STORAGE_KEYS.trash, JSON.stringify(State.trash)); }
function saveHistory()       { localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(State.history)); }
function saveRecentImports() { localStorage.setItem(STORAGE_KEYS.recentImports, JSON.stringify(State.recentImports)); }

function safeParse(raw, fallback) {
    if (!raw) return fallback;
    try {
        const v = JSON.parse(raw);
        return v ?? fallback;
    } catch (_) { return fallback; }
}

/* ============================================================
   4. HISTORY LOGGING
   ============================================================ */
function logHistory(action, payload) {
    const entry = {
        id: uid(),
        action,                     // added | edited | status | deleted | recovered | imported
        title: payload.title || '',
        date: payload.date || '',
        notes: payload.notes || '',
        at: nowStamp(),
    };
    State.history.unshift(entry);
    // Cap at 2000 entries
    if (State.history.length > 2000) State.history.length = 2000;
    saveHistory();
}

/* ============================================================
   5. CALENDAR RENDER (MONTH VIEW)
   ============================================================ */
function getSchedulesForDate(isoDate) {
    return State.schedules.filter(s => s.date === isoDate);
}

/* Expose for the view switcher / time grid (Part 2) */
window.getSchedulesForDate = getSchedulesForDate;
window.currentDate = State.currentDate;

function renderMonthHeader() {
    const d = State.currentDate;
    const el = $('#monthYearText');
    if (el) el.textContent = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function renderCalendar() {
    renderMonthHeader();

    const grid = $('#calendarGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const anchor = State.currentDate;
    const year = anchor.getFullYear();
    const month = anchor.getMonth();

    // Monday-first calendar
    const first = new Date(year, month, 1);
    const startDow = (first.getDay() + 6) % 7; // Mon=0
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevDays = new Date(year, month, 0).getDate();
    const today = todayIso();

    const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;

    for (let i = 0; i < totalCells; i++) {
        const cell = document.createElement('div');
        cell.className = 'day-cell';

        let dayNum, cellDate;
        if (i < startDow) {
            dayNum = prevDays - startDow + 1 + i;
            cellDate = new Date(year, month - 1, dayNum);
            cell.classList.add('other-month');
        } else if (i >= startDow + daysInMonth) {
            dayNum = i - (startDow + daysInMonth) + 1;
            cellDate = new Date(year, month + 1, dayNum);
            cell.classList.add('other-month');
        } else {
            dayNum = i - startDow + 1;
            cellDate = new Date(year, month, dayNum);
        }

        const iso = ymd(cellDate);
        if (iso === today) cell.classList.add('today');

        // Day header
        const head = document.createElement('div');
        head.className = 'day-header';
        const num = document.createElement('div');
        num.className = 'day-number';
        num.textContent = dayNum;
        head.appendChild(num);
        cell.appendChild(head);

        // Schedule list
        const list = document.createElement('div');
        list.className = 'schedule-list';

        const items = cell.classList.contains('other-month') ? [] : getSchedulesForDate(iso);
        const MAX_VISIBLE = 3;
        items.slice(0, MAX_VISIBLE).forEach(s => {
            const item = document.createElement('div');
            item.className = 'schedule-item';
            item.dataset.id = s.id;
            item.dataset.date = iso;
            if (s.late) item.style.borderLeftColor = '#ef4444';
            else if ((s.status || '').toLowerCase() === 'priority') item.style.borderLeftColor = '#eab308';
            else if ((s.status || '').toLowerCase() === 'done') item.style.borderLeftColor = '#16a34a';
            item.innerHTML = `<i class="fas fa-circle"></i><span>${escapeHtml(s.title)}</span>`;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                openDayList(iso);
            });
            list.appendChild(item);
        });

        if (items.length > MAX_VISIBLE) {
            const more = document.createElement('div');
            more.className = 'empty-hint';
            more.textContent = `+${items.length - MAX_VISIBLE} more`;
            list.appendChild(more);
        } else if (items.length === 0 && !cell.classList.contains('other-month')) {
            const hint = document.createElement('div');
            hint.className = 'empty-hint';
            hint.textContent = '—';
            list.appendChild(hint);
        }

        cell.appendChild(list);

        if (!cell.classList.contains('other-month')) {
            cell.addEventListener('click', () => openDayList(iso));
        }

        grid.appendChild(cell);
    }
}

window.renderCalendar = renderCalendar;

/* Keep the view switcher's anchor in sync */
function setCurrentDate(d) {
    State.currentDate = startOfDay(d);
    window.currentDate = State.currentDate;
    if (State.view === 'month') renderCalendar();
    else if (window.SkedoView) window.SkedoView.refresh();
    document.dispatchEvent(new CustomEvent('skedo:date-changed'));
}

/* ============================================================
   6. DAY LIST MODAL
   ============================================================ */
let dayListCurrentIso = '';

function openDayList(iso) {
    dayListCurrentIso = iso;
    State.selectedDate = iso;

    const overlay = $('#dayListOverlay');
    const badge = $('#dayListDateBadge');
    const list = $('#dayScheduleList');
    const toolbar = $('#dayListToolbar');
    const selectAll = $('#daySelectAll');
    const deleteBtn = $('#dayDeleteSelectedBtn');

    if (badge) badge.textContent = formatDateLong(iso);
    if (list) list.innerHTML = '';
    if (toolbar) toolbar.style.display = 'none';
    if (selectAll) selectAll.checked = false;
    if (deleteBtn) deleteBtn.disabled = true;

    const items = getSchedulesForDate(iso).sort((a, b) => {
        const ra = scheduleRange(a), rb = scheduleRange(b);
        return (ra?.startMin ?? 0) - (rb?.startMin ?? 0);
    });

    if (items.length === 0) {
        list.innerHTML = `
            <div class="empty-day-message">
                <i class="fas fa-mug-hot"></i>
                <p>No schedules for this day.<br>Add one below.</p>
            </div>`;
    } else {
        if (toolbar) toolbar.style.display = '';
        items.forEach(s => list.appendChild(renderDayCard(s)));
    }

    overlay.classList.add('active');
    lockBodyScroll(true);
}

function renderDayCard(s) {
    const card = document.createElement('div');
    card.className = 'day-schedule-card';
    card.dataset.id = s.id;

    const statusClass = s.late ? 'late'
        : ((s.status || '').toLowerCase() === 'done' ? 'done'
        : ((s.status || '').toLowerCase() === 'priority' ? 'priority' : 'upcoming'));

    const accentColor = statusClass === 'late' ? '#ef4444'
        : statusClass === 'priority' ? '#eab308'
        : statusClass === 'done' ? '#16a34a'
        : '#6d28d9';

    card.innerHTML = `
        <input type="checkbox" class="day-checkbox" data-id="${s.id}">
        <div class="card-accent" style="background:${accentColor}"></div>
        <div class="card-body">
            <div class="card-title">${escapeHtml(s.title)}</div>
            <div class="card-desc"><i class="fas fa-clock" style="font-size:0.6rem;color:#9ca3af;margin-right:4px;"></i>${escapeHtml(s.time || 'All day')}</div>
            ${s.type ? `<div><span class="type-badge"><i class="fas fa-tag"></i>${escapeHtml(s.type)}</span></div>` : ''}
            ${s.late ? `<div><span class="late-pill"><i class="fas fa-exclamation-circle"></i>Late</span></div>` : ''}
        </div>
        <div class="card-actions">
            <button class="icon-btn view" title="View"><i class="fas fa-eye"></i></button>
            <button class="icon-btn edit" title="Edit"><i class="fas fa-pen"></i></button>
            <button class="icon-btn delete" title="Delete"><i class="fas fa-trash-alt"></i></button>
        </div>`;

    card.querySelector('.icon-btn.view').addEventListener('click', (e) => {
        e.stopPropagation();
        openViewModal(s.id);
    });
    card.querySelector('.icon-btn.edit').addEventListener('click', (e) => {
        e.stopPropagation();
        openEditModal(s.id);
    });
    card.querySelector('.icon-btn.delete').addEventListener('click', (e) => {
        e.stopPropagation();
        confirmDeleteSchedule(s.id);
    });
    const cb = card.querySelector('.day-checkbox');
    if (cb) cb.addEventListener('change', updateDayListToolbarState);
    return card;
}

function updateDayListToolbarState() {
    const boxes = $$('.day-checkbox');
    const checked = boxes.filter(b => b.checked);
    const selectAll = $('#daySelectAll');
    const delBtn = $('#dayDeleteSelectedBtn');
    if (selectAll) selectAll.checked = boxes.length > 0 && checked.length === boxes.length;
    if (delBtn) delBtn.disabled = checked.length === 0;
}

/* ============================================================
   7. CREATE / EDIT MODAL
   ============================================================ */
function openCreateModal(iso) {
    State.editingId = null;
    State.selectedDate = iso || State.selectedDate || todayIso();

    const badge = $('#modalDateBadge');
    if (badge) badge.textContent = formatDateLong(State.selectedDate);
    $('#modalTitle').innerHTML = '<i class="fas fa-calendar-plus"></i> New Schedule';
    $('#editingId').value = '';
    $('#selectedDate').value = State.selectedDate;
    $('#scheduleTitle').value = '';
    $('#scheduleDescription').value = '';
    $('#startTimeInput').value = '';
    $('#endTimeInput').value = '';
    $('#customTypeInput').value = '';
    $('#customTypeInput').style.display = 'none';
    $('#titleWordCount').textContent = '0';
    $('#charCount').textContent = '0';

    $$('.type-btn').forEach(b => b.classList.remove('selected'));
    $$('.ampm-btn').forEach(b => b.classList.remove('selected'));

    openOverlay('#modalOverlay');
}

function openEditModal(id) {
    const s = State.schedules.find(x => x.id === id);
    if (!s) return;
    State.editingId = id;
    State.selectedDate = s.date;

    const badge = $('#modalDateBadge');
    if (badge) badge.textContent = formatDateLong(s.date);
    $('#modalTitle').innerHTML = '<i class="fas fa-pen"></i> Edit Schedule';
    $('#editingId').value = id;
    $('#selectedDate').value = s.date;
    $('#scheduleTitle').value = s.title || '';
    $('#scheduleDescription').value = s.description || '';

    const range = scheduleRange(s);
    if (range) {
        $('#startTimeInput').value = minutesToTimeString(range.startMin).replace(/\s?(AM|PM)$/i, '');
        $('#endTimeInput').value   = minutesToTimeString(range.endMin).replace(/\s?(AM|PM)$/i, '');
        const ap = range.startMin < 720 ? 'AM' : 'PM';
        $$('.ampm-btn').forEach(b => b.classList.toggle('selected', b.dataset.ampm === ap));
    } else {
        $('#startTimeInput').value = '';
        $('#endTimeInput').value = '';
        $$('.ampm-btn').forEach(b => b.classList.remove('selected'));
    }

    $$('.type-btn').forEach(b => {
        b.classList.toggle('selected', b.dataset.type === s.type);
    });
    if (s.type && !$$('.type-btn').some(b => b.dataset.type === s.type)) {
        $('#customTypeInput').style.display = 'block';
        $('#customTypeInput').value = s.type;
    } else {
        $('#customTypeInput').style.display = 'none';
        $('#customTypeInput').value = '';
    }

    $('#titleWordCount').textContent = (s.title || '').split(/\s+/).filter(Boolean).length;
    $('#charCount').textContent = (s.description || '').length;

    openOverlay('#modalOverlay');
}

function readFormValues() {
    const title = $('#scheduleTitle').value.trim();
    const description = $('#scheduleDescription').value.trim();
    const startRaw = $('#startTimeInput').value.trim();
    const endRaw = $('#endTimeInput').value.trim();
    const ampm = $$('.ampm-btn').find(b => b.classList.contains('selected'))?.dataset.ampm || 'AM';
    const selectedType = $$('.type-btn').find(b => b.classList.contains('selected'))?.dataset.type || '';
    const customType = $('#customTypeInput').value.trim();
    const type = selectedType === 'Other' ? (customType || 'Other') : (selectedType || customType || 'Other');

    let time = '';
    if (startRaw && endRaw) {
        time = `${startRaw} ${ampm} – ${endRaw} ${ampm}`;
    } else if (startRaw) {
        time = `${startRaw} ${ampm}`;
    }

    return { title, description, time, type, date: $('#selectedDate').value };
}

function validateForm(values) {
    const missing = [];
    if (!values.title) missing.push('Title is required.');
    if (values.title.split(/\s+/).filter(Boolean).length > 30) missing.push('Title exceeds 30 words.');
    if (!values.time) missing.push('Time is required.');
    if (!values.type) missing.push('Schedule type is required.');
    if (!values.description) missing.push('Description is required.');
    if (values.description.length > 200) missing.push('Description exceeds 200 characters.');
    return missing;
}

function showValidationModal(messages) {
    const list = $('#validationList');
    if (list) {
        list.innerHTML = messages.map(m => `<li><i class="fas fa-exclamation-circle"></i>${escapeHtml(m)}</li>`).join('');
    }
    openOverlay('#validationOverlay');
}

/* ============================================================
   8. REVIEW MODAL
   ============================================================ */
function openReviewModal(values, isEdit) {
    State.pendingForm = values;
    const body = $('#reviewBody');
    const titleText = $('#reviewTitleText');
    const subtitle = $('#reviewSubtitle');

    if (titleText) titleText.textContent = isEdit ? 'Review Changes' : 'Review New Schedule';
    if (subtitle) subtitle.textContent = isEdit
        ? 'Please review the changes below before saving.'
        : 'Please review the new schedule before saving.';

    body.innerHTML = '';
    const fields = [
        ['Date', formatDateLong(values.date)],
        ['Title', values.title],
        ['Time', values.time],
        ['Type', values.type],
        ['Description', values.description],
    ];

    const block = document.createElement('div');
    block.className = 'review-block';
    block.innerHTML = `
        <div class="review-block-label"><i class="fas fa-calendar-check"></i>${isEdit ? 'Updated fields' : 'New schedule'}</div>
    `;
    fields.forEach(([name, value]) => {
        const f = document.createElement('div');
        f.className = 'review-field';
        f.innerHTML = `
            <div class="review-field-name">${escapeHtml(name)}</div>
            <div class="review-value ${value ? '' : 'empty'}">${escapeHtml(value || '—')}</div>
        `;
        block.appendChild(f);
    });
    body.appendChild(block);

    openOverlay('#reviewOverlay');
}

/* ============================================================
   9. VIEW MODAL
   ============================================================ */
function openViewModal(id) {
    const s = State.schedules.find(x => x.id === id) || State.trash.find(x => x.id === id);
    if (!s) return;

    const isTrash = State.trash.some(x => x.id === id);
    const overlay = $('#viewOverlay');
    overlay.classList.toggle('trash-context', isTrash);

    $('#viewTitle').textContent = s.title || '—';
    $('#viewType').textContent = s.type || '—';
    $('#viewTime').textContent = s.time || '—';
    $('#viewDescription').textContent = s.description || '—';
    $('#viewDate').textContent = formatDateLong(s.date);

    const statusRow = $('#viewStatusRow');
    if (statusRow) {
        statusRow.style.display = '';
        $('#viewStatus').textContent = s.late ? 'Late' : (s.status || 'Upcoming');
    }

    const trashDetails = $('#viewTrashDetails');
    if (trashDetails) {
        trashDetails.style.display = isTrash ? '' : 'none';
        if (isTrash) {
            $('#viewCreatedAt').textContent = formatStamp(s.createdAt);
            $('#viewDeletedAt').textContent = formatStamp(s.deletedAt);
        }
    }

    $('#recoverFromViewBtn').style.display = isTrash ? '' : 'none';
    $('#recoverFromViewBtn').onclick = () => { recoverSchedule(id); closeOverlay('#viewOverlay'); };
    $('#changeStatusFromViewBtn').onclick = (e) => openStatusPopup(e.currentTarget, id);

    openOverlay('#viewOverlay');
}

/* ============================================================
   10. SAVE / DELETE / RECOVER
   ============================================================ */
function saveScheduleFromReview() {
    const values = State.pendingForm;
    if (!values) return;

    if (State.editingId) {
        const s = State.schedules.find(x => x.id === State.editingId);
        if (s) {
            Object.assign(s, values);
            logHistory('edited', { title: s.title, date: s.date, notes: 'Schedule updated' });
        }
    } else {
        const s = {
            id: uid(),
            ...values,
            status: 'Upcoming',
            late: false,
            createdAt: nowStamp(),
        };
        State.schedules.push(s);
        logHistory('added', { title: s.title, date: s.date, notes: 'Schedule created' });
    }

    saveSchedules();
    closeOverlay('#reviewOverlay');
    closeOverlay('#modalOverlay');
    renderCalendar();
    if (window.SkedoView) window.SkedoView.refresh();
    renderUpcoming();
    refreshNotifications();
}

function confirmDeleteSchedule(id) {
    const s = State.schedules.find(x => x.id === id);
    if (!s) return;
    $('#confirmTitle').textContent = 'Delete this schedule?';
    $('#confirmMessage').textContent = `"${s.title}" will be moved to the Recycle Bin.`;
    $('#confirmOkBtn').onclick = () => {
        moveToTrash(id);
        closeOverlay('#confirmOverlay');
        closeOverlay('#dayListOverlay');
        closeOverlay('#viewOverlay');
    };
    openOverlay('#confirmOverlay');
}

function moveToTrash(id) {
    const idx = State.schedules.findIndex(x => x.id === id);
    if (idx < 0) return;
    const [s] = State.schedules.splice(idx, 1);
    s.deletedAt = nowStamp();
    State.trash.push(s);
    saveSchedules();
    saveTrash();
    logHistory('deleted', { title: s.title, date: s.date, notes: 'Moved to Recycle Bin' });
    renderCalendar();
    if (window.SkedoView) window.SkedoView.refresh();
    renderUpcoming();
    renderTrash();
    refreshNotifications();
}

function recoverSchedule(id) {
    const idx = State.trash.findIndex(x => x.id === id);
    if (idx < 0) return;
    const [s] = State.trash.splice(idx, 1);
    delete s.deletedAt;
    State.schedules.push(s);
    saveSchedules();
    saveTrash();
    logHistory('recovered', { title: s.title, date: s.date, notes: 'Recovered from Recycle Bin' });
    renderCalendar();
    if (window.SkedoView) window.SkedoView.refresh();
    renderUpcoming();
    renderTrash();
    refreshNotifications();
}

/* ============================================================
   11. OVERLAY HELPERS
   ============================================================ */
let scrollLockY = 0;

function openOverlay(sel) {
    const el = $(sel);
    if (!el) return;
    el.classList.add('active');
    lockBodyScroll(true);
}
function closeOverlay(sel) {
    const el = $(sel);
    if (!el) return;
    el.classList.remove('active');
    if ($$('.modal-overlay.active').length === 0) lockBodyScroll(false);
}
function lockBodyScroll(lock) {
    if (lock) {
        if (document.body.classList.contains('modal-open')) return;
        scrollLockY = window.scrollY || 0;
        document.body.style.setProperty('--modal-scroll-lock-y', `-${scrollLockY}px`);
        document.body.classList.add('modal-open');
    } else {
        if (!document.body.classList.contains('modal-open')) return;
        document.body.classList.remove('modal-open');
        window.scrollTo(0, scrollLockY);
    }
}

/* ============================================================
   12. UPCOMING 7 DAYS
   ============================================================ */
function renderUpcoming() {
    const body = $('#upcomingTableBody');
    const empty = $('#upcomingEmpty');
    const rangeEl = $('#upcomingRange');
    if (!body) return;

    const today = startOfDay(new Date());
    const end = addDays(today, 7);

    if (rangeEl) {
        rangeEl.textContent = `${formatDateShort(ymd(today))} – ${formatDateShort(ymd(end))}`;
    }

    const items = State.schedules
        .filter(s => {
            const d = parseYmd(s.date);
            return d && d >= today && d <= end;
        })
        .sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            const ra = scheduleRange(a), rb = scheduleRange(b);
            return (ra?.startMin ?? 0) - (rb?.startMin ?? 0);
        });

    body.innerHTML = '';
    if (items.length === 0) {
        if (empty) empty.style.display = '';
        const wrap = document.querySelector('.upcoming-table-wrap');
        if (wrap) wrap.style.display = 'none';
        return;
    }
    if (empty) empty.style.display = 'none';
    const wrap = document.querySelector('.upcoming-table-wrap');
    if (wrap) wrap.style.display = '';

    items.forEach(s => {
        const d = parseYmd(s.date);
        const isToday = ymd(d) === todayIso();
        const tr = document.createElement('tr');
        if (isToday) tr.classList.add('upcoming-today');
        if (s.late) tr.classList.add('upcoming-late');

        const statusClass = s.late ? 'late'
            : ((s.status || '').toLowerCase() === 'done' ? 'done'
            : ((s.status || '').toLowerCase() === 'priority' ? 'priority' : 'upcoming'));
        const statusLabel = s.late ? 'Late' : (s.status || 'Upcoming');

        tr.innerHTML = `
            <td><div class="upcoming-date-cell">${formatDateShort(s.date)}${isToday ? ' <span class="upcoming-today-badge">TODAY</span>' : ''}</div></td>
            <td><div class="upcoming-day-cell">${DAYS[d.getDay()]}</div></td>
            <td><div class="upcoming-title-cell">${escapeHtml(s.title)}</div></td>
            <td><div class="upcoming-time-cell">${escapeHtml(s.time || '—')}</div></td>
            <td>${s.type ? `<span class="type-badge"><i class="fas fa-tag"></i>${escapeHtml(s.type)}</span>` : '—'}</td>
            <td><span class="upcoming-status-badge ${statusClass}"><i class="fas fa-circle" style="font-size:0.4rem"></i>${escapeHtml(statusLabel)}</span></td>
            <td><div class="upcoming-desc-cell upcoming-desc-clamp ${s.description ? '' : 'empty'}">${escapeHtml(s.description || 'No description')}</div></td>
            <td>
                <div class="upcoming-actions">
                    <button class="icon-btn view" title="View"><i class="fas fa-eye"></i></button>
                    <button class="icon-btn edit" title="Edit"><i class="fas fa-pen"></i></button>
                    <button class="icon-btn delete" title="Delete"><i class="fas fa-trash-alt"></i></button>
                </div>
            </td>`;

        tr.querySelector('.icon-btn.view').addEventListener('click', (e) => { e.stopPropagation(); openViewModal(s.id); });
        tr.querySelector('.icon-btn.edit').addEventListener('click', (e) => { e.stopPropagation(); openEditModal(s.id); });
        tr.querySelector('.icon-btn.delete').addEventListener('click', (e) => { e.stopPropagation(); confirmDeleteSchedule(s.id); });

        body.appendChild(tr);
    });
}

/* ============================================================
   13. WIRE UP — PART 1 EVENTS
   ============================================================ */
function initPart1() {
    loadAll();
    renderCalendar();
    renderUpcoming();

    /* Month navigation */
    $('#prevMonthBtn')?.addEventListener('click', () => {
        setCurrentDate(addMonths(State.currentDate, -1));
    });
    $('#nextMonthBtn')?.addEventListener('click', () => {
        setCurrentDate(addMonths(State.currentDate, 1));
    });
    $('#todayBtn')?.addEventListener('click', () => {
        setCurrentDate(new Date());
    });

    /* Month/year trigger → date picker */
    $('#monthYearTrigger')?.addEventListener('click', openDatePicker);

    /* Day list modal */
    $('#closeDayListXBtn')?.addEventListener('click', () => closeOverlay('#dayListOverlay'));
    $('#addScheduleFromListBtn')?.addEventListener('click', () => {
        closeOverlay('#dayListOverlay');
        openCreateModal(dayListCurrentIso || State.selectedDate);
    });
    $('#daySelectAll')?.addEventListener('change', (e) => {
        $$('.day-checkbox').forEach(b => { b.checked = e.target.checked; });
        updateDayListToolbarState();
    });
    $('#dayDeleteSelectedBtn')?.addEventListener('click', () => {
        const ids = $$('.day-checkbox').filter(b => b.checked).map(b => b.dataset.id);
        if (!ids.length) return;
        $('#confirmTitle').textContent = `Delete ${ids.length} schedule(s)?`;
        $('#confirmMessage').textContent = 'They will be moved to the Recycle Bin.';
        $('#confirmOkBtn').onclick = () => {
            ids.forEach(id => moveToTrash(id));
            closeOverlay('#confirmOverlay');
            closeOverlay('#dayListOverlay');
        };
        openOverlay('#confirmOverlay');
    });

    /* Create modal */
    $('#createScheduleBtn')?.addEventListener('click', () => openCreateModal(todayIso()));
    $('#cancelModalBtn')?.addEventListener('click', () => closeOverlay('#modalOverlay'));

    /* Type buttons */
    $$('.type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('.type-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            if (btn.dataset.type === 'Other') {
                $('#customTypeInput').style.display = 'block';
                $('#customTypeInput').focus();
            } else {
                $('#customTypeInput').style.display = 'none';
                $('#customTypeInput').value = '';
            }
        });
    });

    /* AM/PM buttons */
    $$('.ampm-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const group = btn.closest('.time-picker');
            group.querySelectorAll('.ampm-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
        });
    });

    /* Title word count */
    $('#scheduleTitle')?.addEventListener('input', (e) => {
        const words = e.target.value.trim().split(/\s+/).filter(Boolean).length;
        $('#titleWordCount').textContent = words;
    });
    /* Description char count */
    $('#scheduleDescription')?.addEventListener('input', (e) => {
        $('#charCount').textContent = e.target.value.length;
    });

    /* Save → validate → review */
    $('#saveScheduleBtn')?.addEventListener('click', () => {
        const values = readFormValues();
        const errors = validateForm(values);
        if (errors.length) { showValidationModal(errors); return; }
        openReviewModal(values, !!State.editingId);
    });

    /* Review */
    $('#reviewGoBackBtn')?.addEventListener('click', () => closeOverlay('#reviewOverlay'));
    $('#reviewConfirmBtn')?.addEventListener('click', saveScheduleFromReview);

    /* View modal */
    $('#closeViewBtn')?.addEventListener('click', () => closeOverlay('#viewOverlay'));

    /* Validation modal */
    $('#validationOkBtn')?.addEventListener('click', () => closeOverlay('#validationOverlay'));

    /* Confirm modal */
    $('#confirmCancelBtn')?.addEventListener('click', () => closeOverlay('#confirmOverlay'));

    /* Click backdrop to close (except confirm / review / validation) */
    $$('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target !== overlay) return;
            if (overlay.id === 'confirmOverlay') return;
            if (overlay.id === 'reviewOverlay') return;
            if (overlay.id === 'validationOverlay') return;
            closeOverlay('#' + overlay.id);
        });
    });

    /* Escape closes topmost overlay */
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const open = $$('.modal-overlay.active');
        if (open.length) {
            const last = open[open.length - 1];
            if (last.id === 'confirmOverlay' || last.id === 'reviewOverlay') return;
            closeOverlay('#' + last.id);
        }
    });
}

/* ============================================================
   14. DATE PICKER
   ============================================================ */
function openDatePicker() {
    const yearSel = $('#pickYear');
    const monthSel = $('#pickMonth');
    const daySel = $('#pickDay');
    if (!yearSel || !monthSel || !daySel) return;

    const current = State.currentDate;
    const thisYear = new Date().getFullYear();

    yearSel.innerHTML = '';
    for (let y = thisYear - 5; y <= thisYear + 10; y++) {
        const o = document.createElement('option');
        o.value = y; o.textContent = y;
        if (y === current.getFullYear()) o.selected = true;
        yearSel.appendChild(o);
    }

    monthSel.innerHTML = '';
    MONTHS.forEach((m, i) => {
        const o = document.createElement('option');
        o.value = i; o.textContent = m;
        if (i === current.getMonth()) o.selected = true;
        monthSel.appendChild(o);
    });

    populateDays();
    yearSel.onchange = populateDays;
    monthSel.onchange = populateDays;
    daySel.onchange = updateDatePreview;

    function populateDays() {
        const y = +yearSel.value;
        const m = +monthSel.value;
        const days = new Date(y, m + 1, 0).getDate();
        daySel.innerHTML = '';
        for (let d = 1; d <= days; d++) {
            const o = document.createElement('option');
            o.value = d; o.textContent = d;
            if (y === current.getFullYear() && m === current.getMonth() && d === current.getDate()) o.selected = true;
            daySel.appendChild(o);
        }
        updateDatePreview();
    }
    function updateDatePreview() {
        const d = new Date(+yearSel.value, +monthSel.value, +daySel.value);
        $('#datePreviewText').textContent = `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    }

    openOverlay('#datePickerOverlay');
}

function initDatePickerEvents() {
    $('#cancelDatePickerBtn')?.addEventListener('click', () => closeOverlay('#datePickerOverlay'));
    $('#goToDateBtn')?.addEventListener('click', () => {
        const y = +$('#pickYear').value;
        const m = +$('#pickMonth').value;
        const d = +$('#pickDay').value;
        setCurrentDate(new Date(y, m, d));
        closeOverlay('#datePickerOverlay');
    });
}

/* Expose for Part 2 */
window.SkedoState = State;
window.openDayList = openDayList;
window.openViewModal = openViewModal;
window.openEditModal = openEditModal;
window.confirmDeleteSchedule = confirmDeleteSchedule;
window.renderUpcoming = renderUpcoming;
window.renderCalendar = renderCalendar;
window.setCurrentDate = setCurrentDate;
window.escapeHtml = escapeHtml;
window.parseYmd = parseYmd;
window.ymd = ymd;
window.addDays = addDays;
window.startOfDay = startOfDay;
window.scheduleRange = scheduleRange;
window.formatDateLong = formatDateLong;
window.formatDateShort = formatDateShort;
window.openOverlay = openOverlay;
window.closeOverlay = closeOverlay;
window.logHistory = logHistory;
window.nowStamp = nowStamp;
window.uid = uid;
/* ============================================================
   SKEDO · script.js — PART 2 of 2
   History, trash, bulk delete, import, export, notifications,
   status popup, recent imports, view switcher, time grid, boot
   ============================================================ */

'use strict';

/* These come from Part 1 via window.* */
const State = window.SkedoState;

/* ============================================================
   15. HISTORY MODAL
   ============================================================ */
let historyPage = 1;
const HISTORY_PER_PAGE = 10;
let historySort = { kind: 'date-created', order: 'desc' };

function openHistoryModal() {
    const list = $('#historyList');
    if (list) list.innerHTML = `<div class="history-loading"><div class="history-loading-dots"><span></span><span></span><span></span></div><div class="history-loading-caption">Loading</div></div>`;
    openOverlay('#historyOverlay');

    // Build year filter
    const yearSel = $('#historyYearFilter');
    if (yearSel) {
        const years = new Set(State.history.map(h => new Date(h.at).getFullYear()));
        yearSel.innerHTML = '<option value="all">All Years</option>' +
            Array.from(years).sort((a,b) => b-a).map(y => `<option value="${y}">${y}</option>`).join('');
    }

    setTimeout(() => renderHistoryList(), 100);
}

function renderHistoryList() {
    const list = $('#historyList');
    const pager = $('#historyPager');
    if (!list) return;

    const search = ($('#historySearch')?.value || '').toLowerCase();
    const yearF = $('#historyYearFilter')?.value || 'all';
    const monthF = $('#historyMonthFilter')?.value || 'all';

    let items = State.history.slice();

    if (search) {
        items = items.filter(h =>
            (h.title || '').toLowerCase().includes(search) ||
            (h.notes || '').toLowerCase().includes(search)
        );
    }
    if (yearF !== 'all') {
        items = items.filter(h => new Date(h.at).getFullYear() === +yearF);
    }
    if (monthF !== 'all') {
        items = items.filter(h => new Date(h.at).getMonth() + 1 === +monthF);
    }

    /* Sort */
    items.sort((a, b) => {
        let cmp = 0;
        if (historySort.kind === 'title') {
            cmp = (a.title || '').localeCompare(b.title || '');
        } else {
            cmp = new Date(a.at) - new Date(b.at);
        }
        return historySort.order === 'asc' ? cmp : -cmp;
    });

    /* Stats */
    const days = new Set(items.map(h => ymd(new Date(h.at))));
    const months = new Set(items.map(h => ymd(new Date(h.at)).slice(0, 7)));
    $('#totalSchedulesCount').textContent = items.length;
    $('#totalDaysCount').textContent = days.size;
    $('#totalMonthsCount').textContent = months.size;

    /* Pagination */
    const totalPages = Math.max(1, Math.ceil(items.length / HISTORY_PER_PAGE));
    if (historyPage > totalPages) historyPage = totalPages;
    const slice = items.slice((historyPage - 1) * HISTORY_PER_PAGE, historyPage * HISTORY_PER_PAGE);

    list.innerHTML = '';
    if (slice.length === 0) {
        list.innerHTML = `<div class="history-empty"><i class="fas fa-inbox"></i>No history entries match your filters.</div>`;
        if (pager) pager.style.display = 'none';
        return;
    }

    slice.forEach(h => {
        const div = document.createElement('div');
        div.className = `history-log-item action-${h.action}`;
        const badgeMap = {
            added: 'Added', edited: 'Edited', status: 'Status', deleted: 'Deleted', recovered: 'Recovered', imported: 'Imported'
        };
        div.innerHTML = `
            <div class="hl-accent"></div>
            <div class="hl-body">
                <div class="hl-top">
                    <span class="hl-action-badge"><i class="fas fa-circle" style="font-size:0.4rem"></i>${badgeMap[h.action] || h.action}</span>
                    <span class="hl-title">${escapeHtml(h.title || '(untitled)')}</span>
                </div>
                <div class="hl-meta">
                    <span><i class="fas fa-calendar"></i>${formatDateShort(h.date)}</span>
                    <span><i class="fas fa-clock"></i>${formatStamp(h.at)}</span>
                </div>
                ${h.notes ? `<div class="hl-notes">${escapeHtml(h.notes)}</div>` : ''}
            </div>`;
        list.appendChild(div);
    });

    /* Pager dots */
    const dots = $('#historyPagerDots');
    if (dots && totalPages > 1) {
        dots.innerHTML = '';
        for (let i = 1; i <= totalPages; i++) {
            const b = document.createElement('button');
            b.className = 'history-pager-dot' + (i === historyPage ? ' active' : '');
            b.dataset.page = i;
            b.addEventListener('click', () => { historyPage = i; renderHistoryList(); });
            dots.appendChild(b);
        }
    }
    if (pager) pager.style.display = totalPages > 1 ? '' : 'none';
}

function initHistoryEvents() {
    $('#historyBtn')?.addEventListener('click', openHistoryModal);
    $('#closeHistoryBtn')?.addEventListener('click', () => closeOverlay('#historyOverlay'));
    $('#historySearch')?.addEventListener('input', () => { historyPage = 1; renderHistoryList(); });
    $('#historyYearFilter')?.addEventListener('change', () => { historyPage = 1; renderHistoryList(); });
    $('#historyMonthFilter')?.addEventListener('change', () => { historyPage = 1; renderHistoryList(); });
    $('#historyPrevBtn')?.addEventListener('click', () => { if (historyPage > 1) { historyPage--; renderHistoryList(); } });
    $('#historyNextBtn')?.addEventListener('click', () => { historyPage++; renderHistoryList(); });

    /* Sort popover */
    $('#historySortBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        $('#historySortPopover')?.classList.toggle('open');
    });
    $$('#historySortPopover .sort-option').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.sortKind) historySort.kind = btn.dataset.sortKind;
            if (btn.dataset.sortOrder) historySort.order = btn.dataset.sortOrder;
            $$('#historySortPopover .sort-option').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            renderHistoryList();
        });
    });
}

/* ============================================================
   16. TRASH MODAL
   ============================================================ */
let trashSort = { kind: 'date-created', order: 'desc' };

function openTrashModal() {
    renderTrash();
    openOverlay('#trashOverlay');
}

function renderTrash() {
    const list = $('#trashList');
    const empty = $('#emptyTrashBtn');
    if (!list) return;

    let items = State.trash.slice();
    items.sort((a, b) => {
        let cmp = 0;
        if (trashSort.kind === 'title') cmp = (a.title || '').localeCompare(b.title || '');
        else cmp = new Date(a.deletedAt || a.createdAt) - new Date(b.deletedAt || b.createdAt);
        return trashSort.order === 'asc' ? cmp : -cmp;
    });

    list.innerHTML = '';
    if (items.length === 0) {
        list.innerHTML = `<div class="trash-empty"><i class="fas fa-dumpster"></i>Recycle Bin is empty.</div>`;
        if (empty) empty.style.display = 'none';
        updateTrashToolbarState();
        return;
    }
    if (empty) empty.style.display = '';

    items.forEach(s => {
        const div = document.createElement('div');
        div.className = 'trash-item';
        div.innerHTML = `
            <input type="checkbox" class="trash-checkbox" data-id="${s.id}">
            <div class="ti-body">
                <div class="ti-title">${escapeHtml(s.title)}</div>
                <div class="ti-desc">${escapeHtml(s.description || 'No description')}</div>
                <div class="ti-meta">
                    <span><i class="fas fa-calendar"></i>${formatDateLong(s.date)}</span>
                    <span><i class="fas fa-trash"></i>${formatStamp(s.deletedAt)}</span>
                </div>
            </div>
            <div class="ti-actions">
                <button class="icon-btn view" title="View"><i class="fas fa-eye"></i></button>
                <button class="icon-btn recover" title="Recover"><i class="fas fa-undo-alt"></i></button>
                <button class="icon-btn delete" title="Delete forever"><i class="fas fa-trash-alt"></i></button>
            </div>`;
        div.querySelector('.icon-btn.view').addEventListener('click', () => openViewModal(s.id));
        div.querySelector('.icon-btn.recover').addEventListener('click', () => recoverSchedule(s.id));
        div.querySelector('.icon-btn.delete').addEventListener('click', () => {
            $('#confirmTitle').textContent = 'Permanently delete?';
            $('#confirmMessage').textContent = `"${s.title}" will be gone forever.`;
            $('#confirmOkBtn').onclick = () => {
                State.trash = State.trash.filter(x => x.id !== s.id);
                saveTrash();
                renderTrash();
                closeOverlay('#confirmOverlay');
            };
            openOverlay('#confirmOverlay');
        });
        div.querySelector('.trash-checkbox').addEventListener('change', updateTrashToolbarState);
        list.appendChild(div);
    });
    updateTrashToolbarState();
}

function updateTrashToolbarState() {
    const boxes = $$('.trash-checkbox');
    const checked = boxes.filter(b => b.checked);
    const selectAll = $('#trashSelectAll');
    if (selectAll) selectAll.checked = boxes.length > 0 && checked.length === boxes.length;
    $('#trashRecoverSelectedBtn').disabled = checked.length === 0;
    $('#trashDeleteSelectedBtn').disabled = checked.length === 0;
}

function initTrashEvents() {
    $('#openTrashBtn')?.addEventListener('click', () => { closeOverlay('#settingsOverlay'); openTrashModal(); });
    $('#closeTrashBtn')?.addEventListener('click', () => closeOverlay('#trashOverlay'));
    $('#trashSelectAll')?.addEventListener('change', (e) => {
        $$('.trash-checkbox').forEach(b => { b.checked = e.target.checked; });
        updateTrashToolbarState();
    });
    $('#trashRecoverSelectedBtn')?.addEventListener('click', () => {
        const ids = $$('.trash-checkbox').filter(b => b.checked).map(b => b.dataset.id);
        ids.forEach(id => recoverSchedule(id));
    });
    $('#trashDeleteSelectedBtn')?.addEventListener('click', () => {
        const ids = $$('.trash-checkbox').filter(b => b.checked).map(b => b.dataset.id);
        if (!ids.length) return;
        $('#confirmTitle').textContent = `Permanently delete ${ids.length} schedule(s)?`;
        $('#confirmMessage').textContent = 'This cannot be undone.';
        $('#confirmOkBtn').onclick = () => {
            State.trash = State.trash.filter(x => !ids.includes(x.id));
            saveTrash();
            renderTrash();
            closeOverlay('#confirmOverlay');
        };
        openOverlay('#confirmOverlay');
    });
    $('#emptyTrashBtn')?.addEventListener('click', () => {
        $('#confirmTitle').textContent = 'Empty Recycle Bin?';
        $('#confirmMessage').textContent = 'All deleted schedules will be permanently removed.';
        $('#confirmOkBtn').onclick = () => {
            State.trash = [];
            saveTrash();
            renderTrash();
            closeOverlay('#confirmOverlay');
        };
        openOverlay('#confirmOverlay');
    });
    $('#trashSortBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        $('#trashSortPopover')?.classList.toggle('open');
    });
    $$('#trashSortPopover .sort-option').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.sortKind) trashSort.kind = btn.dataset.sortKind;
            if (btn.dataset.sortOrder) trashSort.order = btn.dataset.sortOrder;
            $$('#trashSortPopover .sort-option').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            renderTrash();
        });
    });
}

/* ============================================================
   17. SETTINGS
   ============================================================ */
function initSettingsEvents() {
    $('#settingsBtn')?.addEventListener('click', () => openOverlay('#settingsOverlay'));
    $('#closeSettingsBtn')?.addEventListener('click', () => closeOverlay('#settingsOverlay'));
    $('#openTrashBtn')?.addEventListener('click', () => { closeOverlay('#settingsOverlay'); openTrashModal(); });
    $('#openBulkDeleteBtn')?.addEventListener('click', () => { closeOverlay('#settingsOverlay'); openBulkDeleteModal(); });
    $('#clearImportHistoryBtn')?.addEventListener('click', () => {
        $('#confirmTitle').textContent = 'Reset import history?';
        $('#confirmMessage').textContent = 'The same Excel file can be imported again after this.';
        $('#confirmOkBtn').onclick = () => {
            State.recentImports = [];
            saveRecentImports();
            renderRecentImports();
            closeOverlay('#confirmOverlay');
            closeOverlay('#settingsOverlay');
        };
        openOverlay('#confirmOverlay');
    });
    $('#logoutBtn')?.addEventListener('click', () => {
        $('#confirmTitle').textContent = 'Log out?';
        $('#confirmMessage').textContent = 'Your schedules stay saved in this browser.';
        $('#confirmOkBtn').onclick = () => {
            Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k));
            location.reload();
        };
        openOverlay('#confirmOverlay');
    });
}

/* ============================================================
   18. BULK DELETE
   ============================================================ */
let bulkDeleteOpenGroups = new Set();

function openBulkDeleteModal() {
    renderBulkDeleteTree();
    openOverlay('#bulkDeleteOverlay');
}

function renderBulkDeleteTree() {
    const tree = $('#bulkDeleteTree');
    const empty = $('#bulkDeleteEmpty');
    if (!tree) return;

    const search = ($('#bulkDeleteSearch')?.value || '').toLowerCase();
    let items = State.schedules.slice();
    if (search) {
        items = items.filter(s =>
            (s.title || '').toLowerCase().includes(search) ||
            (s.description || '').toLowerCase().includes(search)
        );
    }

    /* Group by year → month */
    const groups = new Map();
    items.forEach(s => {
        const d = parseYmd(s.date);
        if (!d) return;
        const y = d.getFullYear();
        const m = d.getMonth();
        if (!groups.has(y)) groups.set(y, new Map());
        const mm = groups.get(y);
        if (!mm.has(m)) mm.set(m, []);
        mm.get(m).push(s);
    });

    tree.innerHTML = '';
    $('#bulkDeleteTotalCount').textContent = items.length;

    if (items.length === 0) {
        if (empty) empty.style.display = '';
        updateBulkDeleteSummary();
        return;
    }
    if (empty) empty.style.display = 'none';

    const years = Array.from(groups.keys()).sort((a, b) => b - a);
    years.forEach(y => {
        const yGroup = document.createElement('div');
        yGroup.className = 'bd-group' + (bulkDeleteOpenGroups.has('y' + y) ? ' open' : '');
        const yCount = Array.from(groups.get(y).values()).reduce((sum, arr) => sum + arr.length, 0);
        yGroup.innerHTML = `
            <div class="bd-group-row">
                <input type="checkbox" class="bd-year-check" data-year="${y}">
                <button class="bd-group-toggle"><i class="fas fa-chevron-right"></i></button>
                <div class="bd-group-label"><i class="fas fa-calendar"></i>${y}</div>
                <div class="bd-group-count">${yCount}</div>
            </div>
            <div class="bd-group-children"></div>
        `;
        const children = yGroup.querySelector('.bd-group-children');
        const months = Array.from(groups.get(y).entries()).sort((a, b) => b[0] - a[0]);
        months.forEach(([m, arr]) => {
            const mGroup = document.createElement('div');
            mGroup.className = 'bd-group' + (bulkDeleteOpenGroups.has(`y${y}m${m}`) ? ' open' : '');
            mGroup.innerHTML = `
                <div class="bd-group-row">
                    <input type="checkbox" class="bd-month-check" data-year="${y}" data-month="${m}">
                    <button class="bd-group-toggle"><i class="fas fa-chevron-right"></i></button>
                    <div class="bd-group-label"><i class="fas fa-calendar-alt"></i>${MONTHS[m]}</div>
                    <div class="bd-group-count">${arr.length}</div>
                </div>
                <div class="bd-group-children"></div>
            `;
            const mChildren = mGroup.querySelector('.bd-group-children');
            arr.forEach(s => {
                const item = document.createElement('div');
                item.className = 'bd-item';
                item.innerHTML = `
                    <input type="checkbox" class="bd-item-check" data-id="${s.id}">
                    <div class="bd-item-body">
                        <div class="bd-item-title">${escapeHtml(s.title)}</div>
                        <div class="bd-item-meta">
                            <span><i class="fas fa-calendar-day"></i>${formatDateShort(s.date)}</span>
                            <span><i class="fas fa-clock"></i>${escapeHtml(s.time || '—')}</span>
                        </div>
                    </div>`;
                item.querySelector('.bd-item-check').addEventListener('change', updateBulkDeleteSummary);
                mChildren.appendChild(item);
            });
            mGroup.querySelector('.bd-group-toggle').addEventListener('click', () => {
                mGroup.classList.toggle('open');
                if (mGroup.classList.contains('open')) bulkDeleteOpenGroups.add(`y${y}m${m}`);
                else bulkDeleteOpenGroups.delete(`y${y}m${m}`);
            });
            mGroup.querySelector('.bd-month-check').addEventListener('change', (e) => {
                mChildren.querySelectorAll('.bd-item-check').forEach(cb => { cb.checked = e.target.checked; });
                updateBulkDeleteSummary();
            });
            children.appendChild(mGroup);
        });
        yGroup.querySelector('.bd-group-toggle').addEventListener('click', () => {
            yGroup.classList.toggle('open');
            if (yGroup.classList.contains('open')) bulkDeleteOpenGroups.add('y' + y);
            else bulkDeleteOpenGroups.delete('y' + y);
        });
        yGroup.querySelector('.bd-year-check').addEventListener('change', (e) => {
            yGroup.querySelectorAll('input[type="checkbox"]:not(.bd-year-check)').forEach(cb => { cb.checked = e.target.checked; });
            updateBulkDeleteSummary();
        });
        tree.appendChild(yGroup);
    });
    updateBulkDeleteSummary();
}

function updateBulkDeleteSummary() {
    const checked = $$('.bd-item-check').filter(c => c.checked);
    $('#bulkDeleteSelectedCount').textContent = checked.length;
    $('#bulkDeleteMoveToBinBtn').disabled = checked.length === 0;
}

function initBulkDeleteEvents() {
    $('#bulkDeleteCancelBtn')?.addEventListener('click', () => closeOverlay('#bulkDeleteOverlay'));
    $('#bulkDeleteSearch')?.addEventListener('input', renderBulkDeleteTree);
    $('#bulkDeleteExpandAllBtn')?.addEventListener('click', () => {
        $$('.bd-group').forEach(g => g.classList.add('open'));
        $$('.bd-group').forEach(g => {
            const y = g.querySelector('.bd-year-check')?.dataset.year;
            const m = g.querySelector('.bd-month-check')?.dataset.month;
            if (y && m !== undefined) bulkDeleteOpenGroups.add(`y${y}m${m}`);
            else if (y) bulkDeleteOpenGroups.add('y' + y);
        });
    });
    $('#bulkDeleteCollapseAllBtn')?.addEventListener('click', () => {
        $$('.bd-group').forEach(g => g.classList.remove('open'));
        bulkDeleteOpenGroups.clear();
    });
    $('#bulkDeleteMoveToBinBtn')?.addEventListener('click', () => {
        const ids = $$('.bd-item-check').filter(c => c.checked).map(c => c.dataset.id);
        if (!ids.length) return;
        $('#confirmTitle').textContent = `Move ${ids.length} schedule(s) to Recycle Bin?`;
        $('#confirmMessage').textContent = 'You can recover them from the Recycle Bin.';
        $('#confirmOkBtn').onclick = () => {
            ids.forEach(id => moveToTrash(id));
            closeOverlay('#confirmOverlay');
            closeOverlay('#bulkDeleteOverlay');
        };
        openOverlay('#confirmOverlay');
    });
}

/* ============================================================
   19. RECENT IMPORTS
   ============================================================ */
function renderRecentImports() {
    const body = $('#recentImportsBody');
    const empty = $('#recentImportsEmpty');
    const table = document.querySelector('.recent-imports-table-wrap');
    const pager = $('#recentImportsPager');
    if (!body) return;

    if (State.recentImports.length === 0) {
        if (empty) empty.style.display = '';
        if (table) table.style.display = 'none';
        if (pager) pager.style.display = 'none';
        return;
    }
    if (empty) empty.style.display = 'none';
    if (table) table.style.display = '';

    body.innerHTML = '';
    State.recentImports.slice(0, 5).forEach(imp => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><div class="ri-file-cell"><i class="fas fa-file-excel"></i><span class="ri-file-name">${escapeHtml(imp.fileName)}</span></div></td>
            <td><span class="ri-count-pill"><i class="fas fa-calendar-check"></i>${imp.count}</span></td>
            <td><div class="ri-date-cell">${formatStamp(imp.importedAt)}</div></td>`;
        body.appendChild(tr);
    });
    if (pager) pager.style.display = 'none';
}

function initRecentImportsEvents() {
    $('#clearRecentImportsBtn')?.addEventListener('click', () => {
        $('#confirmTitle').textContent = 'Clear import history?';
        $('#confirmMessage').textContent = 'This only clears the Recent Imports list, not the schedules.';
        $('#confirmOkBtn').onclick = () => {
            State.recentImports = [];
            saveRecentImports();
            renderRecentImports();
            closeOverlay('#confirmOverlay');
        };
        openOverlay('#confirmOverlay');
    });
}

/* ============================================================
   20. IMPORT (Excel)
   ============================================================ */
let pendingImportRows = null;
let pendingImportFileName = '';

function initImportEvents() {
    $('#importBtn')?.addEventListener('click', () => openOverlay('#importOverlay'));
    $('#importCancelBtn')?.addEventListener('click', () => closeOverlay('#importOverlay'));

    $('#downloadTemplateBtn')?.addEventListener('click', downloadTemplate);

    $('#importUploadBtn')?.addEventListener('click', () => $('#importExcelInput')?.click());
    $('#importExcelInput')?.addEventListener('change', handleImportFile);

    $('#importConfirmBtn')?.addEventListener('click', commitImport);
    $('#importSuccessCloseBtn')?.addEventListener('click', () => closeOverlay('#importSuccessOverlay'));
    $('#importSuccessViewBtn')?.addEventListener('click', () => {
        closeOverlay('#importSuccessOverlay');
        setCurrentDate(new Date());
    });
}

function downloadTemplate() {
    if (!window.XLSX) { alert('XLSX library not loaded.'); return; }
    const wsData = [
        ['Month','Day','Year','Title','Time','Type','Status','Late','Description'],
        [1, 15, 2026, 'Sample Meeting', '01:00 PM – 03:00 PM', 'Meeting', 'Upcoming', 'No', 'This is a sample row.'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Schedules');
    XLSX.writeFile(wb, 'skedo_import_template.xlsx');
}

async function handleImportFile(e) {
    const file = e.target.files?.[0];
    const status = $('#importStatus');
    const nameEl = $('#importFileName');
    const confirmBtn = $('#importConfirmBtn');
    if (!file) return;

    pendingImportRows = null;
    pendingImportFileName = file.name;
    if (nameEl) nameEl.textContent = file.name;
    if (confirmBtn) confirmBtn.disabled = true;

    try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });

        if (!rows.length) throw new Error('File is empty.');

        const expectedHeaders = ['Month','Day','Year','Title','Time','Type','Status','Late','Description'];
        const actualHeaders = rows[0].map(h => String(h || '').trim());
        const headerOk = expectedHeaders.every((h, i) => actualHeaders[i]?.toLowerCase() === h.toLowerCase());
        if (!headerOk) throw new Error('Header row does not match template. Expected: ' + expectedHeaders.join(', '));

        const dataRows = rows.slice(1).filter(r => r.some(c => String(c || '').trim() !== ''));
        if (!dataRows.length) throw new Error('No data rows found.');

        const errors = [];
        const parsed = dataRows.map((r, idx) => {
            const rowNum = idx + 2;
            const [m, d, y, title, time, type, status, late, description] = r;
            const month = parseInt(m, 10);
            const day = parseInt(d, 10);
            const year = parseInt(y, 10);
            if (!month || month < 1 || month > 12) errors.push(`Row ${rowNum}: invalid Month`);
            if (!day || day < 1 || day > 31) errors.push(`Row ${rowNum}: invalid Day`);
            if (!year || year < 1900) errors.push(`Row ${rowNum}: invalid Year`);
            if (!String(title || '').trim()) errors.push(`Row ${rowNum}: Title required`);
            if (!String(description || '').trim()) errors.push(`Row ${rowNum}: Description required`);
            return {
                date: `${year}-${pad(month)}-${pad(day)}`,
                title: String(title || '').trim(),
                time: String(time || '').trim(),
                type: String(type || 'Other').trim(),
                status: String(status || 'Upcoming').trim(),
                late: String(late || '').toLowerCase() === 'yes',
                description: String(description || '').trim(),
            };
        });

        if (errors.length) throw new Error(errors.slice(0, 5).join('\n'));

        pendingImportRows = parsed;
        if (confirmBtn) confirmBtn.disabled = false;
        if (status) {
            status.style.display = '';
            status.className = 'import-status success';
            status.innerHTML = `<i class="fas fa-check-circle"></i><div>${parsed.length} valid row(s) ready to import.</div>`;
        }
    } catch (err) {
        if (status) {
            status.style.display = '';
            status.className = 'import-status error';
            status.innerHTML = `<i class="fas fa-times-circle"></i><div>${escapeHtml(err.message)}</div>`;
        }
    }
}

function commitImport() {
    if (!pendingImportRows) return;
    const created = pendingImportRows.map(r => ({
        id: uid(),
        ...r,
        createdAt: nowStamp(),
    }));
    State.schedules.push(...created);
    saveSchedules();
    logHistory('imported', {
        title: `${created.length} schedules imported`,
        date: created[0]?.date || todayIso(),
        notes: `From file: ${pendingImportFileName}`,
    });
    State.recentImports.unshift({
        id: uid(),
        fileName: pendingImportFileName,
        count: created.length,
        importedAt: nowStamp(),
    });
    saveRecentImports();
    renderRecentImports();

    /* Success modal */
    $('#importSuccessCount').textContent = created.length;
    $('#importSuccessCountLabel').textContent = created.length === 1 ? 'schedule added' : 'schedules added';
    const dates = Array.from(new Set(created.map(c => c.date))).sort();
    const dl = $('#importSuccessDatesList');
    if (dl) {
        dl.innerHTML = dates.map(d => `<li><i class="fas fa-calendar-day"></i>${formatDateLong(d)}</li>`).join('');
    }
    const datesWrap = $('#importSuccessDates');
    if (datesWrap) datesWrap.style.display = dates.length ? '' : 'none';

    closeOverlay('#importOverlay');
    openOverlay('#importSuccessOverlay');

    renderCalendar();
    if (window.SkedoView) window.SkedoView.refresh();
    renderUpcoming();
    refreshNotifications();

    pendingImportRows = null;
    pendingImportFileName = '';
}

/* ============================================================
   21. EXPORT
   ============================================================ */
let exportSelectedYears = new Set();
let exportSelectedMonths = new Set();

function openExportModal() {
    exportSelectedYears = new Set();
    exportSelectedMonths = new Set();
    State.schedules.forEach(s => {
        const d = parseYmd(s.date);
        if (!d) return;
        exportSelectedYears.add(d.getFullYear());
        exportSelectedMonths.add(d.getMonth());
    });
    renderExportFilters();
    renderExportPreview();
    openOverlay('#exportOverlay');
}

function renderExportFilters() {
    const years = new Set(State.schedules.map(s => parseYmd(s.date)?.getFullYear()).filter(Boolean));
    const yearWrap = $('#exportYearChips');
    if (yearWrap) {
        yearWrap.innerHTML = '';
        Array.from(years).sort((a,b)=>a-b).forEach(y => {
            const chip = document.createElement('button');
            chip.className = 'export-chip' + (exportSelectedYears.has(y) ? ' selected' : '');
            chip.innerHTML = `<i class="fas fa-check"></i>${y}`;
            chip.addEventListener('click', () => {
                if (exportSelectedYears.has(y)) exportSelectedYears.delete(y);
                else exportSelectedYears.add(y);
                chip.classList.toggle('selected');
                renderExportPreview();
            });
            yearWrap.appendChild(chip);
        });
    }
    const monthWrap = $('#exportMonthChips');
    if (monthWrap) {
        monthWrap.innerHTML = '';
        MONTHS.forEach((m, i) => {
            const chip = document.createElement('button');
            chip.className = 'export-chip' + (exportSelectedMonths.has(i) ? ' selected' : '');
            chip.innerHTML = `<i class="fas fa-check"></i>${m.slice(0,3)}`;
            chip.addEventListener('click', () => {
                if (exportSelectedMonths.has(i)) exportSelectedMonths.delete(i);
                else exportSelectedMonths.add(i);
                chip.classList.toggle('selected');
                renderExportPreview();
            });
            monthWrap.appendChild(chip);
        });
    }
}

function getExportRows() {
    return State.schedules.filter(s => {
        const d = parseYmd(s.date);
        if (!d) return false;
        return exportSelectedYears.has(d.getFullYear()) && exportSelectedMonths.has(d.getMonth());
    });
}

function renderExportPreview() {
    const rows = getExportRows();
    const summary = $('#exportPreviewSummary');
    if (summary) summary.textContent = `${rows.length} schedule(s) match your filters.`;
    $('#exportPreviewCount').textContent = `${rows.length} rows`;

    const scroll = $('#exportPreviewScroll');
    if (!scroll) return;
    if (!rows.length) {
        scroll.innerHTML = `<div class="export-preview-empty"><i class="fas fa-inbox"></i>No schedules match your filters.</div>`;
        return;
    }
    const headers = ['Date','Title','Time','Type','Status','Late','Description'];
    const html = `
        <table>
            <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
            <tbody>
                ${rows.map(s => `
                    <tr>
                        <td>${escapeHtml(s.date)}</td>
                        <td>${escapeHtml(s.title)}</td>
                        <td>${escapeHtml(s.time || '—')}</td>
                        <td>${escapeHtml(s.type || '—')}</td>
                        <td>${escapeHtml(s.status || 'Upcoming')}</td>
                        <td>${s.late ? 'Yes' : 'No'}</td>
                        <td>${escapeHtml(s.description || '')}</td>
                    </tr>`).join('')}
            </tbody>
        </table>`;
    scroll.innerHTML = html;
}

function initExportEvents() {
    $('#exportBtn')?.addEventListener('click', openExportModal);
    $('#exportCancelBtn')?.addEventListener('click', () => closeOverlay('#exportOverlay'));
    $('#exportYearsAll')?.addEventListener('click', () => {
        State.schedules.forEach(s => { const d = parseYmd(s.date); if (d) exportSelectedYears.add(d.getFullYear()); });
        renderExportFilters(); renderExportPreview();
    });
    $('#exportYearsNone')?.addEventListener('click', () => { exportSelectedYears.clear(); renderExportFilters(); renderExportPreview(); });
    $('#exportMonthsAll')?.addEventListener('click', () => {
        for (let i = 0; i < 12; i++) exportSelectedMonths.add(i);
        renderExportFilters(); renderExportPreview();
    });
    $('#exportMonthsNone')?.addEventListener('click', () => { exportSelectedMonths.clear(); renderExportFilters(); renderExportPreview(); });

    $('#exportDownloadBtn')?.addEventListener('click', () => {
        const rows = getExportRows();
        if (!rows.length) { alert('No schedules match your filters.'); return; }
        const aoa = [['Month','Day','Year','Title','Time','Type','Status','Late','Description']];
        rows.forEach(s => {
            const d = parseYmd(s.date);
            aoa.push([d.getMonth()+1, d.getDate(), d.getFullYear(), s.title, s.time || '', s.type || '', s.status || 'Upcoming', s.late ? 'Yes' : 'No', s.description || '']);
        });
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Schedules');
        XLSX.writeFile(wb, `skedo_export_${todayIso()}.xlsx`);
        closeOverlay('#exportOverlay');
    });
}

/* ============================================================
   22. NOTIFICATIONS
   ============================================================ */
let notifSortStatus = 'upcoming';
let notifSortOrder = 'asc';

function refreshNotifications() {
    const items = buildNotifications();
    const unread = items.filter(n => n.unread).length;
    const badge = $('#notifBadge');
    if (badge) {
        badge.textContent = unread > 99 ? '99+' : unread;
        badge.style.display = unread > 0 ? '' : 'none';
    }
    renderNotifList(items);
}

function buildNotifications() {
    const now = new Date();
    const today = startOfDay(now);
    const list = [];
    State.schedules.forEach(s => {
        const d = parseYmd(s.date);
        if (!d) return;
        const diffDays = Math.round((d - today) / 86400000);
        const status = (s.status || '').toLowerCase();
        if (s.late || (diffDays < 0 && status !== 'done')) {
            list.push({ id: s.id, title: s.title, date: s.date, kind: 'late', unread: true, time: s.time });
        } else if (status === 'priority') {
            list.push({ id: s.id, title: s.title, date: s.date, kind: 'priority', unread: true, time: s.time });
        } else if (diffDays >= 0 && diffDays <= 3) {
            list.push({ id: s.id, title: s.title, date: s.date, kind: 'upcoming', unread: true, time: s.time });
        }
    });
    return list.sort((a, b) => {
        if (notifSortStatus !== 'all') {
            const map = { upcoming: 0, priority: 1, late: 2 };
            const cmp = (map[a.kind] ?? 3) - (map[b.kind] ?? 3);
            if (cmp !== 0) return notifSortOrder === 'asc' ? cmp : -cmp;
        }
        return notifSortOrder === 'asc' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date);
    });
}

function renderNotifList(items) {
    const list = $('#notifList');
    if (!list) return;
    if (!items.length) {
        list.innerHTML = `<div class="notif-empty"><i class="fas fa-bell-slash"></i>No notifications right now.</div>`;
        return;
    }
    list.innerHTML = '';
    items.forEach(n => {
        const el = document.createElement('div');
        el.className = 'notif-item' + (n.unread ? ' unread' : '');
        el.innerHTML = `
            <div class="notif-item-icon ${n.kind}"><i class="fas fa-${n.kind === 'late' ? 'exclamation-circle' : n.kind === 'priority' ? 'star' : 'clock'}"></i></div>
            <div class="notif-item-body">
                <div class="notif-item-title">${escapeHtml(n.title)}</div>
                <div class="notif-item-meta">
                    <span><i class="fas fa-calendar"></i>${formatDateShort(n.date)}</span>
                    ${n.time ? `<span><i class="fas fa-clock"></i>${escapeHtml(n.time)}</span>` : ''}
                </div>
            </div>`;
        el.addEventListener('click', () => {
            closeNotifPanel();
            openDayList(n.date);
        });
        list.appendChild(el);
    });
}

function openNotifPanel() {
    $('#notifPanel')?.classList.add('open');
    refreshNotifications();
}
function closeNotifPanel() {
    $('#notifPanel')?.classList.remove('open');
    $('#notifSortPopover')?.classList.remove('open');
}

function initNotificationEvents() {
    $('#notifBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if ($('#notifPanel')?.classList.contains('open')) closeNotifPanel();
        else openNotifPanel();
    });
    $('#notifCloseBtn')?.addEventListener('click', closeNotifPanel);
    $('#notifMarkReadBtn')?.addEventListener('click', () => {
        $$('.notif-item').forEach(el => el.classList.remove('unread'));
        const badge = $('#notifBadge');
        if (badge) badge.style.display = 'none';
    });
    $('#notifSortBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        $('#notifSortPopover')?.classList.toggle('open');
    });
    $$('#notifSortPopover .sort-option').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.notifStatus) notifSortStatus = btn.dataset.notifStatus;
            if (btn.dataset.notifOrder) notifSortOrder = btn.dataset.notifOrder;
            $$('#notifSortPopover .sort-option').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            refreshNotifications();
        });
    });
    document.addEventListener('click', (e) => {
        if ($('#notifPanel')?.classList.contains('open') && !$('.notif-wrap')?.contains(e.target)) {
            closeNotifPanel();
        }
    });
}

/* ============================================================
   23. STATUS POPUP
   ============================================================ */
let statusPopupEl = null;

function openStatusPopup(anchorEl, scheduleId) {
    closeStatusPopup();
    const s = State.schedules.find(x => x.id === scheduleId);
    if (!s) return;

    const popup = document.createElement('div');
    popup.className = 'status-popup';
    popup.innerHTML = `<div class="status-popup-title">Change Status</div>`;
    const statuses = ['Upcoming', 'Done', 'Priority', 'Late'];
    statuses.forEach(st => {
        const cls = st.toLowerCase();
        const btn = document.createElement('button');
        btn.className = 'status-popup-btn' + ((s.status || '').toLowerCase() === cls || (st === 'Late' && s.late) ? ' current' : '');
        btn.innerHTML = `<span class="sp-dot ${cls}"></span><span class="sp-label">${st}</span><i class="fas fa-check sp-check"></i>`;
        btn.addEventListener('click', () => {
            if (st === 'Late') { s.late = true; s.status = 'Upcoming'; }
            else { s.late = false; s.status = st; }
            saveSchedules();
            logHistory('status', { title: s.title, date: s.date, notes: `Status → ${st}` });
            closeStatusPopup();
            renderCalendar();
            if (window.SkedoView) window.SkedoView.refresh();
            renderUpcoming();
            refreshNotifications();
        });
        popup.appendChild(btn);
    });
    document.body.appendChild(popup);
    statusPopupEl = popup;

    const rect = anchorEl.getBoundingClientRect();
    popup.style.left = Math.min(rect.left, window.innerWidth - 200) + 'px';
    popup.style.top = (rect.bottom + 6) + 'px';

    setTimeout(() => {
        document.addEventListener('click', onDocClickForStatus, { once: true });
    }, 0);
}

function onDocClickForStatus(e) {
    if (!statusPopupEl?.contains(e.target)) closeStatusPopup();
}
function closeStatusPopup() {
    statusPopupEl?.remove();
    statusPopupEl = null;
}

/* ============================================================
   24. VIEW SWITCHER + TIME GRID
   ============================================================ */
(function () {
    const VIEW_KEY = STORAGE_KEYS.view;
    const viewSwitchBtn   = $('#viewSwitchBtn');
    const viewSwitchMenu  = $('#viewSwitchMenu');
    const viewSwitchLabel = $('#viewSwitchLabel');
    const viewSwitchIcon  = $('#viewSwitchIcon');
    const calendarGrid    = $('#calendarGrid');
    const timeGridWrap    = $('#timeGridWrap');
    const timeGrid        = $('#timeGrid');
    const timeGridScroll  = $('#timeGridScroll');

    if (!viewSwitchBtn || !calendarGrid || !timeGrid) return;

    const VIEW_META = {
        month:  { label: 'Month',   icon: 'fa-calendar' },
        day:    { label: 'Day',     icon: 'fa-sun' },
        '3days':{ label: '3 Days',  icon: 'fa-calendar-day' },
        week:   { label: 'Week',    icon: 'fa-calendar-week' },
    };

    let currentView = localStorage.getItem(VIEW_KEY) || 'month';
    if (!VIEW_META[currentView]) currentView = 'month';
    State.view = currentView;
    window.currentDate = State.currentDate;

    function openMenu() {
        viewSwitchMenu.classList.add('open');
        viewSwitchBtn.setAttribute('aria-expanded', 'true');
    }
    function closeMenu() {
        viewSwitchMenu.classList.remove('open');
        viewSwitchBtn.setAttribute('aria-expanded', 'false');
    }

    viewSwitchBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        viewSwitchMenu.classList.contains('open') ? closeMenu() : openMenu();
    });
    document.addEventListener('click', (e) => {
        if (!viewSwitchMenu.contains(e.target) && e.target !== viewSwitchBtn) closeMenu();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

    function renderTimeGrid() {
        const anchor = startOfDay(State.currentDate);
        let days = [];
        if (currentView === 'day')   days = [anchor];
        if (currentView === '3days') days = [0,1,2].map(i => addDays(anchor, i));
        if (currentView === 'week') {
            const dow = (anchor.getDay() + 6) % 7;
            const monday = addDays(anchor, -dow);
            days = Array.from({length: 7}, (_, i) => addDays(monday, i));
        }
        if (!days.length) return;

        const todayIsoStr = todayIso();
        const cols = days.length;
        timeGrid.style.setProperty('--day-cols', cols);

        let html = '';
        html += `<div class="tg-col-head tg-corner">Time</div>`;
        days.forEach(d => {
            const iso = ymd(d);
            const isToday = iso === todayIsoStr;
            html += `
                <div class="tg-col-head${isToday ? ' tg-today' : ''}">
                    <span class="tg-dow">${DAYS_SHORT[d.getDay()]}</span>
                    <span class="tg-date">${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}</span>
                </div>`;
        });

        for (let h = 0; h < 24; h++) {
            let hh = h % 12; if (hh === 0) hh = 12;
            const ap = h < 12 ? 'AM' : 'PM';
            html += `<div class="tg-time-label">${hh}:00 ${ap}</div>`;
            days.forEach(d => {
                const iso = ymd(d);
                const isToday = iso === todayIsoStr;
                html += `<div class="tg-cell${isToday ? ' tg-cell-today' : ''}" data-date="${iso}" data-hour="${h}"></div>`;
            });
        }
        timeGrid.innerHTML = html;

        days.forEach(d => {
            const iso = ymd(d);
            getSchedulesForDate(iso).forEach(s => {
                const range = scheduleRange(s);
                if (!range) return;
                const startMin = Math.max(0, Math.min(1439, range.startMin));
                const endMin   = Math.max(startMin + 15, Math.min(1440, range.endMin));
                const topPx    = (startMin / 60) * 48;
                const heightPx = Math.max(20, ((endMin - startMin) / 60) * 48 - 2);
                const cell = timeGrid.querySelector(
                    `.tg-cell[data-date="${iso}"][data-hour="${Math.floor(startMin / 60)}"]`
                );
                if (!cell) return;
                const ev = document.createElement('div');
                const statusClass = s.late ? 'tg-event-late'
                    : ((s.status || '').toLowerCase() === 'done' ? 'tg-event-done'
                    : ((s.status || '').toLowerCase() === 'priority' ? 'tg-event-priority' : ''));
                ev.className = 'tg-event ' + statusClass;
                ev.style.top = (topPx - Math.floor(startMin / 60) * 48) + 'px';
                ev.style.height = heightPx + 'px';
                ev.title = `${s.title}${s.time ? ' · ' + s.time : ''}`;
                ev.textContent = s.title;
                ev.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openDayList(iso);
                });
                cell.appendChild(ev);
            });
        });

        const now = new Date();
        const todayCol = days.findIndex(d => ymd(d) === todayIsoStr);
        if (todayCol >= 0) {
            const minutes = now.getHours() * 60 + now.getMinutes();
            const top = 50 + (minutes / 60) * 48;
            const line = document.createElement('div');
            line.className = 'tg-now-line';
            line.style.top = top + 'px';
            const colWidthPct = 100 / (cols + 1);
            line.style.left = `calc(72px + ${colWidthPct}% * ${todayCol})`;
            line.style.right = `calc(100% - 72px - ${colWidthPct}% * ${todayCol + 1})`;
            timeGrid.appendChild(line);
        }

        if (!timeGridScroll.dataset.scrolled) {
            timeGridScroll.scrollTop = 8 * 48;
            timeGridScroll.dataset.scrolled = '1';
        }
    }

    function applyView(view, persist = true) {
        if (!VIEW_META[view]) view = 'month';
        currentView = view;
        State.view = view;
        if (persist) localStorage.setItem(VIEW_KEY, view);

        viewSwitchLabel.textContent = VIEW_META[view].label;
        viewSwitchIcon.className = 'fas ' + VIEW_META[view].icon;

        viewSwitchMenu.querySelectorAll('.view-option').forEach(b => {
            b.classList.toggle('selected', b.dataset.view === view);
        });

        if (view === 'month') {
            calendarGrid.style.display = '';
            timeGridWrap.style.display = 'none';
            renderCalendar();
        } else {
            calendarGrid.style.display = 'none';
            timeGridWrap.style.display = '';
            renderTimeGrid();
        }
        closeMenu();
    }

    viewSwitchMenu.querySelectorAll('.view-option').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            applyView(btn.dataset.view);
        });
    });

    ['prevMonthBtn', 'nextMonthBtn', 'todayBtn'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', () => {
            if (currentView !== 'month') setTimeout(renderTimeGrid, 0);
        });
    });
    document.addEventListener('skedo:date-changed', () => {
        if (currentView !== 'month') renderTimeGrid();
    });

    applyView(currentView, false);
    window.SkedoView = { applyView, refresh: renderTimeGrid, get: () => currentView };
})();

/* ============================================================
   25. TIME PICKER (create/edit modal)
   ============================================================ */
function initTimePickers() {
    $$('.time-picker').forEach(picker => {
        const input = picker.querySelector('.time-input');
        const dropdown = picker.querySelector('.time-dropdown');
        if (!input || !dropdown) return;

        const options = [];
        for (let h = 1; h <= 12; h++) {
            for (let m = 0; m < 60; m += 15) {
                options.push(`${pad(h)}:${pad(m)}`);
            }
        }
        dropdown.innerHTML = options.map(o => `<button class="time-dropdown-item" data-val="${o}">${o}</button>`).join('');

        input.addEventListener('focus', () => {
            dropdown.classList.add('open');
            const val = input.value.trim();
            dropdown.querySelectorAll('.time-dropdown-item').forEach(b => {
                b.classList.toggle('active', b.dataset.val === val);
            });
        });
        input.addEventListener('input', (e) => {
            let v = e.target.value.replace(/[^\d:]/g, '');
            if (v.length === 2 && !v.includes(':')) v += ':';
            e.target.value = v.slice(0, 5);
            dropdown.querySelectorAll('.time-dropdown-item').forEach(b => {
                b.classList.toggle('active', b.dataset.val === e.target.value);
            });
        });
        dropdown.querySelectorAll('.time-dropdown-item').forEach(b => {
            b.addEventListener('click', () => {
                input.value = b.dataset.val;
                dropdown.classList.remove('open');
            });
        });
        document.addEventListener('click', (e) => {
            if (!picker.contains(e.target)) dropdown.classList.remove('open');
        });
    });
}

/* ============================================================
   26. BOOT
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
    /* Part 1 */
    initPart1();
    initDatePickerEvents();

    /* Part 2 */
    initHistoryEvents();
    initTrashEvents();
    initSettingsEvents();
    initBulkDeleteEvents();
    initRecentImportsEvents();
    initImportEvents();
    initExportEvents();
    initNotificationEvents();
    initTimePickers();

    /* Initial data render */
    renderRecentImports();
    refreshNotifications();
    updateDayListToolbarState();

    /* Supabase ready → optional sync hook */
    window.addEventListener('supabase-ready', () => {
        // Hook your remote sync here if needed
        console.log('[Skedo] Supabase ready.');
    });
});
