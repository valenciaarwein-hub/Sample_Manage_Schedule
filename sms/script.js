// sms/script.js
(function() {
    'use strict';

    let schedules = {};
    let trash = [];
    let isLoaded = false;
    let saveTimer = null;
    let savingInFlight = false;

    const TYPE_OPTIONS = ['Meeting', 'Seminar', 'Special Event', 'Other'];
    const STATUS_OPTIONS = ['upcoming', 'done', 'priority'];

    // ============================================================
    // PHILIPPINE TIME HELPERS
    // ============================================================
    const PH_TZ = 'Asia/Manila';

    function getNowPH() {
        const now = new Date();
        const fmt = new Intl.DateTimeFormat('en-CA', {
            timeZone: PH_TZ,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
        });
        const parts = {};
        fmt.formatToParts(now).forEach(p => { if (p.type !== 'literal') parts[p.type] = p.value; });

        let hours24 = parseInt(parts.hour, 10);
        if (hours24 === 24) hours24 = 0;
        const minutes = parseInt(parts.minute, 10);

        return {
            hours24,
            minutes,
            totalMinutes: hours24 * 60 + minutes,
            dateKey: `${parts.year}-${parts.month}-${parts.day}`
        };
    }

    function parseTimeToMinutes12h(str) {
        if (!str) return null;
        const m = String(str).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
        if (!m) return null;
        let hh = parseInt(m[1], 10);
        const mm = parseInt(m[2], 10);
        const ampm = m[3].toUpperCase();
        if (isNaN(hh) || isNaN(mm) || mm < 0 || mm > 59) return null;
        if (hh < 1 || hh > 12) return null;
        if (ampm === 'AM') {
            if (hh === 12) hh = 0;
        } else {
            if (hh !== 12) hh += 12;
        }
        return hh * 60 + mm;
    }

    function parseScheduleTimeRange(timeStr) {
        if (!timeStr) return null;
        const parts = String(timeStr).split('–').map(p => p.trim());
        const startMin = parseTimeToMinutes12h(parts[0]);
        const endMin = parseTimeToMinutes12h(parts[1] || parts[0]);
        if (startMin == null || endMin == null) return null;
        return { startMin, endMin };
    }

    function isScheduleLateNow(dateKey, schedule, nowPH) {
        if (!nowPH) nowPH = getNowPH();
        if (dateKey !== nowPH.dateKey) return false;
        if (normalizeStatus(schedule.status) === 'done') return false;
        const range = parseScheduleTimeRange(schedule.time);
        if (!range) return false;
        return nowPH.totalMinutes > range.endMin;
    }

    // ============================================================
    // SUPABASE
    // ============================================================
    function getSupabase() {
        if (!window.supabaseClient) {
            throw new Error('Supabase client not initialized. Check your credentials in index.html.');
        }
        return window.supabaseClient;
    }

    async function loadFromApi(showErrors) {
        try {
            const supabase = getSupabase();

            const { data: activeData, error: activeError } = await supabase
                .from('schedules')
                .select('*')
                .is('deleted_at', null);

            if (activeError) throw activeError;

            schedules = {};
            (activeData || []).forEach(item => {
                if (!schedules[item.date_key]) schedules[item.date_key] = [];
                schedules[item.date_key].push({
                    id: item.id,
                    title: item.title,
                    description: item.description || '',
                    type: item.type || '',
                    status: normalizeStatus(item.status),
                    createdAt: item.created_at,
                    time: item.time || ''
                });
            });

            const { data: trashData, error: trashError } = await supabase
                .from('schedules')
                .select('*')
                .not('deleted_at', 'is', null);

            if (trashError) throw trashError;

            trash = (trashData || []).map(item => ({
                id: item.id,
                title: item.title,
                description: item.description || '',
                type: item.type || '',
                status: normalizeStatus(item.status),
                dateKey: item.date_key,
                createdAt: item.created_at,
                deletedAt: item.deleted_at,
                time: item.time || ''
            }));

            isLoaded = true;
            renderCalendar();
            renderNotifications();
            if (historyOverlay && historyOverlay.classList.contains('active')) renderHistory();
            if (trashOverlay && trashOverlay.classList.contains('active')) renderTrash();
            if (dayListOverlay.classList.contains('active') && activeDayListDateKey) {
                renderDayScheduleList();
            }
        } catch (err) {
            console.error('Load error:', err);
            isLoaded = true;
            if (showErrors) alert('Could not load schedules from Supabase: ' + err.message);
            renderCalendar();
        }
    }

    function scheduleSave() {
        if (!isLoaded) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(pushToApi, 400);
    }

    async function pushToApi() {
        if (savingInFlight) {
            scheduleSave();
            return;
        }
        savingInFlight = true;
        try {
            const supabase = getSupabase();

            const allRows = [];
            Object.keys(schedules).forEach(dateKey => {
                (schedules[dateKey] || []).forEach(s => {
                    allRows.push({
                        id: s.id,
                        date_key: dateKey,
                        title: s.title,
                        description: s.description || '',
                        type: s.type || '',
                        status: normalizeStatus(s.status),
                        time: s.time || null,
                        created_at: s.createdAt || new Date().toISOString(),
                        updated_at: s.updatedAt || null,
                        deleted_at: null
                    });
                });
            });
            trash.forEach(t => {
                allRows.push({
                    id: t.id,
                    date_key: t.dateKey,
                    title: t.title,
                    description: t.description || '',
                    type: t.type || '',
                    status: normalizeStatus(t.status),
                    time: t.time || null,
                    created_at: t.createdAt || new Date().toISOString(),
                    updated_at: null,
                    deleted_at: t.deletedAt || new Date().toISOString()
                });
            });

            if (allRows.length > 0) {
                const { error: upsertError } = await supabase
                    .from('schedules')
                    .upsert(allRows, { onConflict: 'id' });
                if (upsertError) throw upsertError;
            }

            const currentIds = allRows.map(r => r.id);
            if (currentIds.length > 0) {
                const { error: delError } = await supabase
                    .from('schedules')
                    .delete()
                    .not('id', 'in', `(${currentIds.map(id => `"${id}"`).join(',')})`);
                if (delError) throw delError;
            } else {
                const { error: delAllError } = await supabase
                    .from('schedules')
                    .delete()
                    .neq('id', '');
                if (delAllError) throw delAllError;
            }
        } catch (err) {
            console.error('Save error:', err);
            alert('Could not save to Supabase. Your change may not persist.\n\n' + err.message);
        } finally {
            savingInFlight = false;
        }
    }

    async function clearRemote() {
        try {
            const supabase = getSupabase();
            const { error } = await supabase
                .from('schedules')
                .delete()
                .neq('id', '');
            if (error) throw error;
        } catch (err) {
            console.error('Clear error:', err);
            alert('Could not clear the database: ' + err.message);
        }
    }

    function uid() {
        return 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
    }

    function formatDateKey(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function getDateFromKey(key) {
        const [y, m, d] = key.split('-').map(Number);
        return new Date(y, m - 1, d);
    }

    const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const weekdayShort = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

    function daysInMonth(year, month) {
        return new Date(year, month + 1, 0).getDate();
    }

    function updateCharCounter() {
        charCount.textContent = scheduleDescription.value.length;
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatDateTime(iso) {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: 'numeric', minute: '2-digit'
        });
    }

    function getTypeIcon(type) {
        switch (type) {
            case 'Meeting': return 'fa-users';
            case 'Seminar': return 'fa-chalkboard-teacher';
            case 'Special Event': return 'fa-star';
            default: return 'fa-tag';
        }
    }

    function renderTypeBadge(type) {
        if (!type) return '';
        return `<span class="type-badge"><i class="fas ${getTypeIcon(type)}"></i> ${escapeHtml(type)}</span>`;
    }

    function getStatusIcon(status) {
        switch (status) {
            case 'done': return 'fa-check-circle';
            case 'priority': return 'fa-star';
            default: return 'fa-calendar-check';
        }
    }

    function getStatusLabel(status) {
        switch (status) {
            case 'done': return 'Done';
            case 'priority': return 'Priority';
            default: return 'Upcoming';
        }
    }

    function normalizeStatus(s) {
        if (STATUS_OPTIONS.includes(s)) return s;
        if (s === 'process') return 'upcoming';
        return 'upcoming';
    }

    function daysUntil(dateKey) {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const target = getDateFromKey(dateKey);
        return Math.round((target - today) / 86400000);
    }

    function getUrgencyLevel(dateKey) {
        const diff = daysUntil(dateKey);
        if (diff < 0) return 'overdue';
        if (diff <= 2) return 'urgent';
        return 'upcoming';
    }

    function cmpIso(a, b) {
        const aT = a || '';
        const bT = b || '';
        return aT.localeCompare(bT);
    }

    function applySort(list, sort) {
        const arr = [...list];
        const kind = sort.kind;
        const order = sort.order === 'asc' ? 1 : -1;
        arr.sort((a, b) => {
            let primary = 0;
            if (kind === 'title') {
                primary = (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' });
            } else {
                primary = cmpIso(a.createdAt, b.createdAt);
                if (primary === 0) primary = (a.dateKey || '').localeCompare(b.dateKey || '');
            }
            return primary * order;
        });
        return arr;
    }

    function updateSortIcon(btn, sort) {
        const icon = btn.querySelector('i');
        if (!icon) return;
        const base = sort.kind === 'title' ? 'fa-sort-alpha' : 'fa-sort-amount';
        const dir = sort.order === 'asc' ? 'up' : 'down';
        icon.className = `fas ${base}-${dir}`;
        btn.title = `Sort: ${sort.kind === 'title' ? 'Title' : 'Date created'} (${sort.order === 'asc' ? 'Ascending' : 'Descending'})`;
    }

    function syncSortPopover(popover, sort) {
        popover.querySelectorAll('[data-sort-kind]').forEach(el => {
            el.classList.toggle('selected', el.dataset.sortKind === sort.kind);
        });
        popover.querySelectorAll('[data-sort-order]').forEach(el => {
            el.classList.toggle('selected', el.dataset.sortOrder === sort.order);
        });
    }

    let currentDate = new Date();
    currentDate.setDate(1);
    let currentYear = currentDate.getFullYear();
    let currentMonth = currentDate.getMonth();

    let editingScheduleId = null;
    let selectedDateKey = null;
    let activeDayListDateKey = null;
    let reopenHistoryAfterEdit = false;
    let trashSelection = new Set();
    let dayListSelection = new Set();
    let pendingSave = null;

    let formType = { base: null, custom: '' };

    let historySort = { kind: 'date-created', order: 'desc' };
    let trashSort = { kind: 'date-created', order: 'desc' };

    let viewContext = { kind: 'schedule', trashId: null };

    const monthYearText = document.getElementById('monthYearText');
    const monthYearTrigger = document.getElementById('monthYearTrigger');
    const calendarGrid = document.getElementById('calendarGrid');
    const prevMonthBtn = document.getElementById('prevMonthBtn');
    const nextMonthBtn = document.getElementById('nextMonthBtn');
    const todayBtn = document.getElementById('todayBtn');
    const createScheduleBtn = document.getElementById('createScheduleBtn');
    const historyBtn = document.getElementById('historyBtn');
    const exportBtn = document.getElementById('exportBtn');
    const importBtn = document.getElementById('importBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const settingsBtn = document.getElementById('settingsBtn');

    const upcomingTableBody = document.getElementById('upcomingTableBody');
    const upcomingEmpty = document.getElementById('upcomingEmpty');
    const upcomingRange = document.getElementById('upcomingRange');

    const dayListOverlay = document.getElementById('dayListOverlay');
    const dayListDateBadge = document.getElementById('dayListDateBadge');
    const dayScheduleList = document.getElementById('dayScheduleList');
    const addScheduleFromListBtn = document.getElementById('addScheduleFromListBtn');
    const closeDayListBtn = document.getElementById('closeDayListBtn');
    const dayListToolbar = document.getElementById('dayListToolbar');
    const daySelectAll = document.getElementById('daySelectAll');
    const dayDeleteSelectedBtn = document.getElementById('dayDeleteSelectedBtn');

    const modalOverlay = document.getElementById('modalOverlay');
    const modalTitle = document.getElementById('modalTitle');
    const modalDateBadge = document.getElementById('modalDateBadge');
    const scheduleTitle = document.getElementById('scheduleTitle');
    const scheduleDescription = document.getElementById('scheduleDescription');
    const charCount = document.getElementById('charCount');
    const typeButtonGroup = document.getElementById('typeButtonGroup');
    const customTypeInput = document.getElementById('customTypeInput');
    const cancelModalBtn = document.getElementById('cancelModalBtn');
    const saveScheduleBtn = document.getElementById('saveScheduleBtn');

    const reviewOverlay = document.getElementById('reviewOverlay');
    const reviewTitleText = document.getElementById('reviewTitleText');
    const reviewSubtitle = document.getElementById('reviewSubtitle');
    const reviewBody = document.getElementById('reviewBody');
    const reviewGoBackBtn = document.getElementById('reviewGoBackBtn');
    const reviewConfirmBtn = document.getElementById('reviewConfirmBtn');

    const viewOverlay = document.getElementById('viewOverlay');
    const viewModalTitle = document.getElementById('viewModalTitle');
    const viewTitle = document.getElementById('viewTitle');
    const viewType = document.getElementById('viewType');
    const viewTime = document.getElementById('viewTime');
    const viewDescription = document.getElementById('viewDescription');
    const viewDate = document.getElementById('viewDate');
    const viewStatusRow = document.getElementById('viewStatusRow');
    const viewStatus = document.getElementById('viewStatus');
    const viewTrashDetails = document.getElementById('viewTrashDetails');
    const viewCreatedAt = document.getElementById('viewCreatedAt');
    const viewDeletedAt = document.getElementById('viewDeletedAt');
    const closeViewBtn = document.getElementById('closeViewBtn');
    const recoverFromViewBtn = document.getElementById('recoverFromViewBtn');

    const datePickerOverlay = document.getElementById('datePickerOverlay');
    const pickYear = document.getElementById('pickYear');
    const pickMonth = document.getElementById('pickMonth');
    const pickDay = document.getElementById('pickDay');
    const datePreviewText = document.getElementById('datePreviewText');
    const cancelDatePickerBtn = document.getElementById('cancelDatePickerBtn');
    const goToDateBtn = document.getElementById('goToDateBtn');

    const historyOverlay = document.getElementById('historyOverlay');
    const historySearch = document.getElementById('historySearch');
    const historyYearFilter = document.getElementById('historyYearFilter');
    const historyMonthFilter = document.getElementById('historyMonthFilter');
    const historySortBtn = document.getElementById('historySortBtn');
    const historySortPopover = document.getElementById('historySortPopover');
    const historyStats = document.getElementById('historyStats');
    const totalSchedulesCount = document.getElementById('totalSchedulesCount');
    const totalDaysCount = document.getElementById('totalDaysCount');
    const totalMonthsCount = document.getElementById('totalMonthsCount');
    const historyList = document.getElementById('historyList');
    const clearAllHistoryBtn = document.getElementById('clearAllHistoryBtn');
    const closeHistoryBtn = document.getElementById('closeHistoryBtn');

    const settingsOverlay = document.getElementById('settingsOverlay');
    const openTrashBtn = document.getElementById('openTrashBtn');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');

    const trashOverlay = document.getElementById('trashOverlay');
    const trashSortBtn = document.getElementById('trashSortBtn');
    const trashSortPopover = document.getElementById('trashSortPopover');
    const trashSelectAll = document.getElementById('trashSelectAll');
    const trashList = document.getElementById('trashList');
    const trashRecoverSelectedBtn = document.getElementById('trashRecoverSelectedBtn');
    const trashDeleteSelectedBtn = document.getElementById('trashDeleteSelectedBtn');
    const emptyTrashBtn = document.getElementById('emptyTrashBtn');
    const closeTrashBtn = document.getElementById('closeTrashBtn');

    const confirmOverlay = document.getElementById('confirmOverlay');
    const confirmIcon = document.getElementById('confirmIcon');
    const confirmTitle = document.getElementById('confirmTitle');
    const confirmMessage = document.getElementById('confirmMessage');
    const confirmCancelBtn = document.getElementById('confirmCancelBtn');
    const confirmOkBtn = document.getElementById('confirmOkBtn');

    const validationOverlay = document.getElementById('validationOverlay');
    const validationMessage = document.getElementById('validationMessage');
    const validationList = document.getElementById('validationList');
    const validationOkBtn = document.getElementById('validationOkBtn');

    const notifBtn = document.getElementById('notifBtn');
    const notifBadge = document.getElementById('notifBadge');
    const notifPanel = document.getElementById('notifPanel');
    const notifList = document.getElementById('notifList');
    const notifCloseBtn = document.getElementById('notifCloseBtn');
    const notifMarkReadBtn = document.getElementById('notifMarkReadBtn');

    // ============================================================
    // TIME PICKER
    // ============================================================
    const HOURS = ['01','02','03','04','05','06','07','08','09','10','11','12'];

    function initTimePicker(pickerEl) {
        const input = pickerEl.querySelector('.time-input');
        const ampmBtns = pickerEl.querySelectorAll('.ampm-btn');
        const dropdown = pickerEl.querySelector('.time-dropdown');

        let state = { hh: '', mm: '00', ampm: 'AM' };

        dropdown.innerHTML = HOURS.map(h =>
            `<button type="button" class="time-option" data-hour="${h}">
                <span>${h}:00</span>
            </button>`
        ).join('');

        function renderDropdown() {
            dropdown.querySelectorAll('.time-option').forEach(btn => {
                btn.classList.toggle('selected', btn.dataset.hour === state.hh);
            });
        }

        function syncAmpmUI() {
            ampmBtns.forEach(b => b.classList.toggle('active', b.dataset.ampm === state.ampm));
        }

        function writeStateToDataset() {
            pickerEl.dataset.hh = state.hh;
            pickerEl.dataset.mm = state.mm;
            pickerEl.dataset.ampm = state.ampm;
        }

        function sanitizeTyping(raw) {
            let s = String(raw).replace(/[^\d:]/g, '');
            const firstColon = s.indexOf(':');
            if (firstColon !== -1) {
                s = s.slice(0, firstColon + 1) + s.slice(firstColon + 1).replace(/:/g, '');
            }
            const parts = s.split(':');
            let hh = (parts[0] || '').slice(0, 2);
            let mm = parts.length > 1 ? (parts[1] || '').slice(0, 2) : '';
            return parts.length > 1 ? `${hh}:${mm}` : hh;
        }

        function normalizeOnBlur() {
            const raw = input.value.trim();
            if (!raw) {
                state.hh = '';
                state.mm = '00';
                pickerEl.classList.remove('invalid');
                writeStateToDataset();
                syncAmpmUI();
                renderDropdown();
                return;
            }

            const parts = raw.split(':');
            let hhStr = parts[0] || '';
            let mmStr = parts.length > 1 ? parts[1] : '';

            if (hhStr === '') {
                pickerEl.classList.add('invalid');
                return;
            }

            let hh = parseInt(hhStr, 10);
            if (isNaN(hh)) {
                pickerEl.classList.add('invalid');
                return;
            }

            if (hh > 12 && hh <= 23) {
                const a = hh >= 12 ? 'PM' : 'AM';
                let h12 = hh % 12;
                if (h12 === 0) h12 = 12;
                hh = h12;
                state.ampm = a;
            } else if (hh === 0) {
                hh = 12;
                state.ampm = 'AM';
            } else if (hh < 1 || hh > 12) {
                pickerEl.classList.add('invalid');
                return;
            }

            let mm = mmStr === '' ? 0 : parseInt(mmStr, 10);
            if (isNaN(mm) || mm < 0 || mm > 59) {
                pickerEl.classList.add('invalid');
                return;
            }

            state.hh = String(hh).padStart(2, '0');
            state.mm = String(mm).padStart(2, '0');
            pickerEl.classList.remove('invalid');

            input.value = `${state.hh}:${state.mm}`;
            writeStateToDataset();
            syncAmpmUI();
            renderDropdown();
        }

        input.addEventListener('input', () => {
            const sanitized = sanitizeTyping(input.value);
            if (sanitized !== input.value) {
                input.value = sanitized;
            }
            pickerEl.classList.remove('invalid');
        });

        input.addEventListener('blur', () => {
            normalizeOnBlur();
            dropdown.classList.remove('open');
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                normalizeOnBlur();
                input.blur();
            }
        });

        ampmBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                state.ampm = btn.dataset.ampm;
                writeStateToDataset();
                syncAmpmUI();
                input.focus();
            });
        });

        input.addEventListener('focus', () => {
            renderDropdown();
            dropdown.classList.add('open');
        });
        input.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.add('open');
            renderDropdown();
        });

        // Dropdown auto-fill: pick hour → fill input, close, focus
        dropdown.querySelectorAll('.time-option').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                state.hh = btn.dataset.hour;
                if (!state.mm) state.mm = '00';

                pickerEl.classList.remove('invalid');
                input.value = `${state.hh}:${state.mm}`;

                writeStateToDataset();
                syncAmpmUI();
                renderDropdown();
                dropdown.classList.remove('open');
                input.focus();

                // Select the hour digits so user can type minutes right away
                if (input.setSelectionRange) {
                    try { input.setSelectionRange(0, 2); } catch (_) {}
                }
            });
        });

        document.addEventListener('click', (e) => {
            if (!pickerEl.contains(e.target)) dropdown.classList.remove('open');
        });

        syncAmpmUI();
        renderDropdown();

        return {
            reset() {
                state = { hh: '', mm: '00', ampm: 'AM' };
                input.value = '';
                pickerEl.classList.remove('invalid');
                writeStateToDataset();
                syncAmpmUI();
                renderDropdown();
                dropdown.classList.remove('open');
            },
            setValue(hh, mm, ampm) {
                state.hh = hh || '';
                state.mm = mm || '00';
                state.ampm = ampm || 'AM';
                input.value = state.hh ? `${state.hh}:${state.mm}` : '';
                syncAmpmUI();
                renderDropdown();
                pickerEl.classList.remove('invalid');
                writeStateToDataset();
            },
            getValue() {
                if (!state.hh) return '';
                return `${state.hh}:${state.mm} ${state.ampm}`;
            },
            hasValue() { return !!state.hh; }
        };
    }

    const startPickerEl = document.querySelector('[data-picker="start"]');
    const endPickerEl = document.querySelector('[data-picker="end"]');
    const startPicker = startPickerEl ? initTimePicker(startPickerEl) : null;
    const endPicker = endPickerEl ? initTimePicker(endPickerEl) : null;

    function getTimeRange() {
        if (!startPicker || !endPicker) return '';
        const s = startPicker.getValue();
        const e = endPicker.getValue();
        if (!s && !e) return '';
        if (s && e) return `${s} – ${e}`;
        return s || e;
    }

    function parseSavedTimeRange(timeStr) {
        if (!timeStr) return { start: null, end: null };
        const parts = timeStr.split('–').map(p => p.trim());
        const start = parts[0] || null;
        const end = parts[1] || null;
        return { start, end };
    }

    function splitTimeString(timeStr) {
        if (!timeStr) return null;
        const m = timeStr.match(/^(\d{2}):(\d{2})\s*(AM|PM)$/i);
        if (!m) return null;
        return { hh: m[1], mm: m[2], ampm: m[3].toUpperCase() };
    }

    // ============================================================
    // NOTIFICATIONS
    // ============================================================
    const NOTIF_SEEN_KEY = 'schedule_notif_seen_v2';
    const NOTIF_WINDOW_DAYS = 3;

    function loadJson(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch { return fallback; }
    }
    function saveJson(key, val) {
        try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
    }

    let notifSeenIds = new Set(loadJson(NOTIF_SEEN_KEY, []));

    function buildNotificationItems() {
        const items = [];
        const nowPH = getNowPH();

        Object.keys(schedules).forEach(dateKey => {
            (schedules[dateKey] || []).forEach(s => {
                const st = normalizeStatus(s.status);
                if (st === 'done') return;

                const diff = daysUntil(dateKey);
                const lateNow = isScheduleLateNow(dateKey, s, nowPH);

                let status, dotClass, itemClass;
                if (lateNow) {
                    status = 'overdue'; dotClass = 'red'; itemClass = 'overdue';
                } else if (st === 'priority') {
                    status = 'priority'; dotClass = 'yellow'; itemClass = 'imminent';
                } else if (diff < 0) {
                    status = 'overdue'; dotClass = 'red'; itemClass = 'overdue';
                } else if (diff <= NOTIF_WINDOW_DAYS) {
                    status = 'urgent'; dotClass = 'yellow'; itemClass = 'imminent';
                } else {
                    status = 'upcoming'; dotClass = 'green'; itemClass = 'upcoming';
                }

                items.push({
                    id: s.id, dateKey, title: s.title, type: s.type || '',
                    scheduleStatus: st,
                    diff, status, dotClass, itemClass,
                    unread: !notifSeenIds.has(s.id)
                });
            });
        });

        const statusRank = { priority: 0, overdue: 1, urgent: 2, upcoming: 3 };
        items.sort((a, b) => {
            const r = statusRank[a.status] - statusRank[b.status];
            if (r !== 0) return r;
            return a.diff - b.diff;
        });

        return items;
    }

    function renderNotifications() {
        const items = buildNotificationItems();

        const unreadCount = items.filter(i => i.unread).length;
        if (unreadCount > 0) {
            notifBadge.style.display = 'flex';
            notifBadge.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
            notifBadge.classList.add('pulse');
        } else {
            notifBadge.style.display = 'none';
            notifBadge.classList.remove('pulse');
        }

        notifMarkReadBtn.disabled = unreadCount === 0;

        if (items.length === 0) {
            notifList.innerHTML = `
                <div class="notif-empty">
                    <i class="fas fa-bell-slash"></i>
                    No schedules yet.<br>
                    Create one to see it here.
                </div>
            `;
            return;
        }

        let html = '';
        items.forEach(it => {
            const itemClasses = ['notif-item', it.itemClass, it.unread ? 'unread' : ''].filter(Boolean).join(' ');
            const dateObj = getDateFromKey(it.dateKey);
            const dateLabel = dateObj.toLocaleDateString('en-US', {
                month: 'long', day: '2-digit', year: 'numeric'
            });

            const typeBadgeHtml = it.type
                ? `<span class="notif-type-badge-wrap">${renderTypeBadge(it.type)}</span>`
                : `<span class="notif-type-badge-wrap"><span class="type-badge" style="background:#f1f5f9; color:#94a3b8; border-color:#e2e8f0;"><i class="fas fa-tag"></i> No type</span></span>`;

            const statusPill = it.scheduleStatus === 'priority'
                ? `<span class="notif-status-pill priority"><i class="fas fa-star"></i> Priority</span>`
                : '';

            html += `
                <button class="${itemClasses}" data-notif-id="${it.id}" data-notif-date="${it.dateKey}">
                    <span class="notif-dot ${it.dotClass}" title="${it.status}"></span>
                    <span class="notif-body">
                        <span class="notif-title">${escapeHtml(it.title)} ${statusPill}</span>
                        <span class="notif-sub">
                            ${typeBadgeHtml}
                            <span class="notif-date">${escapeHtml(dateLabel)}</span>
                        </span>
                    </span>
                </button>
            `;
        });
        notifList.innerHTML = html;

        notifList.querySelectorAll('[data-notif-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                const dateKey = btn.dataset.notifDate;
                const id = btn.dataset.notifId;
                markNotificationSeen(id);
                closeNotifPanel();
                if (dateKey && id) openViewModal(dateKey, id);
            });
        });
    }

    function markNotificationSeen(id) {
        notifSeenIds.add(id);
        saveJson(NOTIF_SEEN_KEY, Array.from(notifSeenIds));
        renderNotifications();
    }

    function markAllNotificationsRead() {
        const items = buildNotificationItems();
        items.forEach(i => notifSeenIds.add(i.id));
        saveJson(NOTIF_SEEN_KEY, Array.from(notifSeenIds));
        renderNotifications();
    }

    function openNotifPanel() {
        notifPanel.classList.add('open');
        notifBtn.classList.add('active');
        renderNotifications();
    }
    function closeNotifPanel() {
        notifPanel.classList.remove('open');
        notifBtn.classList.remove('active');
    }
    function toggleNotifPanel() {
        if (notifPanel.classList.contains('open')) closeNotifPanel();
        else openNotifPanel();
    }

    notifBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleNotifPanel();
    });
    notifCloseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeNotifPanel();
    });
    notifMarkReadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        markAllNotificationsRead();
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.notif-wrap')) closeNotifPanel();
    });
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && notifPanel.classList.contains('open')) closeNotifPanel();
    });

    // ============================================================
    // CONFIRM / VALIDATION
    // ============================================================
    let pendingConfirmAction = null;

    function openConfirmModal(opts) {
        const {
            title = 'Are you sure?',
            message = 'This action cannot be undone.',
            okText = 'Delete',
            iconClass = 'danger',
            showCancel = true,
            onConfirm = () => {}
        } = opts || {};

        confirmTitle.textContent = title;
        confirmMessage.textContent = message;

        const iconName =
            iconClass === 'warning' ? 'fa-exclamation-triangle'
            : iconClass === 'info' ? 'fa-info-circle'
            : iconClass === 'success' ? 'fa-check-circle'
            : 'fa-trash-alt';

        confirmIcon.className = 'confirm-icon ' + (iconClass === 'success' ? 'info' : iconClass);
        confirmIcon.innerHTML = `<i class="fas ${iconName}"></i>`;

        confirmOkBtn.className = 'btn ' + (iconClass === 'danger' ? 'btn-danger' : 'btn-primary');
        confirmOkBtn.innerHTML = `<i class="fas ${iconName}"></i> ${okText}`;

        confirmCancelBtn.style.display = showCancel ? '' : 'none';

        pendingConfirmAction = onConfirm;
        confirmOverlay.classList.add('active');
    }

    function closeConfirmModal() {
        confirmOverlay.classList.remove('active');
        pendingConfirmAction = null;
    }

    confirmOkBtn.addEventListener('click', () => {
        const action = pendingConfirmAction;
        closeConfirmModal();
        if (typeof action === 'function') action();
    });

    confirmCancelBtn.addEventListener('click', closeConfirmModal);
    confirmOverlay.addEventListener('click', (e) => {
        if (e.target === confirmOverlay) closeConfirmModal();
    });

    function openValidationModal(missingFields) {
        validationMessage.textContent = 'Please complete the required fields below before saving.';
        validationList.innerHTML = missingFields.map(f =>
            `<li><i class="fas fa-exclamation-circle"></i> ${escapeHtml(f)}</li>`
        ).join('');
        validationOverlay.classList.add('active');
    }

    function closeValidationModal() {
        validationOverlay.classList.remove('active');
        document.querySelectorAll('.field.invalid').forEach(el => el.classList.remove('invalid'));
    }

    validationOkBtn.addEventListener('click', closeValidationModal);
    validationOverlay.addEventListener('click', (e) => {
        if (e.target === validationOverlay) closeValidationModal();
    });

    function resetTypeButtons(selectedType) {
        const btns = typeButtonGroup.querySelectorAll('.type-btn');
        const knownTypes = TYPE_OPTIONS;
        const isBase = selectedType && knownTypes.includes(selectedType);

        btns.forEach(btn => {
            const btnType = btn.dataset.type;
            const isSelected = isBase ? btnType === selectedType : btnType === 'Other';
            btn.classList.toggle('selected', isSelected);
        });

        if (selectedType && !isBase) {
            formType.base = 'Other';
            formType.custom = selectedType;
            customTypeInput.style.display = 'inline-block';
            customTypeInput.value = selectedType;
            const otherBtn = typeButtonGroup.querySelector('[data-type="Other"]');
            otherBtn.classList.add('selected');
        } else if (isBase && selectedType !== 'Other') {
            formType.base = selectedType;
            formType.custom = '';
            customTypeInput.style.display = 'none';
            customTypeInput.value = '';
        } else if (selectedType === 'Other') {
            formType.base = 'Other';
            formType.custom = '';
            customTypeInput.style.display = 'inline-block';
            customTypeInput.value = '';
        } else {
            formType.base = null;
            formType.custom = '';
            customTypeInput.style.display = 'none';
            customTypeInput.value = '';
        }
    }

    typeButtonGroup.addEventListener('click', (e) => {
        const btn = e.target.closest('.type-btn');
        if (!btn) return;

        const type = btn.dataset.type;

        if (type === 'Other') {
            formType.base = 'Other';
            if (customTypeInput.style.display === 'none') {
                customTypeInput.style.display = 'inline-block';
                customTypeInput.focus();
            } else {
                customTypeInput.style.display = 'none';
                formType.custom = '';
                customTypeInput.value = '';
            }
        } else {
            formType.base = type;
            formType.custom = '';
            customTypeInput.style.display = 'none';
            customTypeInput.value = '';
        }

        typeButtonGroup.querySelectorAll('.type-btn').forEach(b => {
            if (b.dataset.type === 'Other') {
                b.classList.toggle('selected', formType.base === 'Other');
            } else {
                b.classList.toggle('selected', b.dataset.type === formType.base && formType.base !== 'Other');
            }
        });
    });

    customTypeInput.addEventListener('input', () => {
        formType.custom = customTypeInput.value;
    });

    function getResolvedType() {
        if (formType.base === 'Other') {
            const custom = formType.custom.trim();
            if (custom) return custom;
            return 'Other';
        }
        return formType.base || '';
    }

    function renderUpcomingTable() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const endDate = new Date(today);
        endDate.setDate(endDate.getDate() + 6);

        const rangeStartLabel = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const rangeEndLabel = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        upcomingRange.textContent = `${rangeStartLabel} – ${rangeEndLabel}`;

        const rows = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() + i);
            const dateKey = formatDateKey(d);
            const daySchedules = schedules[dateKey] || [];
            daySchedules.forEach(s => {
                rows.push({
                    dateKey, dateObj: d, id: s.id,
                    title: s.title, description: s.description || '', type: s.type || ''
                });
            });
        }

        const todayKey = formatDateKey(today);

        if (rows.length === 0) {
            upcomingTableBody.innerHTML = '';
            upcomingEmpty.style.display = 'block';
            return;
        }

        upcomingEmpty.style.display = 'none';

        let html = '';
        rows.forEach(r => {
            const isToday = r.dateKey === todayKey;
            const dateLabel = r.dateObj.toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric'
            });
            const dayLabel = weekdayShort[r.dateObj.getDay()];

            html += `
                <tr class="${isToday ? 'upcoming-today' : ''}">
                    <td class="col-date" data-label="Date">
                        <span class="upcoming-date-cell">${escapeHtml(dateLabel)}</span>
                    </td>
                    <td class="col-day" data-label="Day">
                        <span class="upcoming-day-cell">${escapeHtml(dayLabel)}${isToday ? '<span class="upcoming-today-badge">TODAY</span>' : ''}</span>
                    </td>
                    <td class="col-title" data-label="Title">
                        <span class="upcoming-title-cell">${escapeHtml(r.title)}</span>
                    </td>
                    <td class="col-type" data-label="Type">
                        ${r.type ? renderTypeBadge(r.type) : '<span class="upcoming-desc-cell empty">No type</span>'}
                    </td>
                    <td class="col-desc" data-label="Description">
                        ${r.description
                            ? `<span class="upcoming-desc-cell">${escapeHtml(r.description)}</span>`
                            : `<span class="upcoming-desc-cell empty">No description</span>`}
                    </td>
                    <td class="col-actions">
                        <div class="upcoming-actions">
                            <button class="icon-btn view" data-upcoming-action="view" data-date="${r.dateKey}" data-id="${r.id}" title="View details"><i class="fas fa-eye"></i></button>
                            <button class="icon-btn edit" data-upcoming-action="edit" data-date="${r.dateKey}" data-id="${r.id}" title="Edit schedule"><i class="fas fa-pen"></i></button>
                            <button class="icon-btn delete" data-upcoming-action="delete" data-date="${r.dateKey}" data-id="${r.id}" title="Move to
