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
        if (normalizeStatus(schedule.status) === 'done') return false;

        if (schedule.lateMarked) return true;

        if (dateKey !== nowPH.dateKey) return false;

        const range = parseScheduleTimeRange(schedule.time);
        if (!range) return false;
        return nowPH.totalMinutes > range.endMin;
    }

    function autoMarkPastDayAsLate(dateKey) {
        const nowPH = getNowPH();
        const list = schedules[dateKey] || [];
        if (list.length === 0) return false;
        if (dateKey >= nowPH.dateKey) return false;

        let changed = false;
        list.forEach(s => {
            const st = normalizeStatus(s.status);
            if (st === 'done') return;
            if (st === 'priority') return;
            if (!s.lateMarked) {
                s.lateMarked = true;
                s.updatedAt = new Date().toISOString();
                changed = true;
            }
        });

        if (changed) {
            scheduleSave();
            renderNotifications();
        }
        return changed;
    }

    function formatCountdown(ms) {
        const total = Math.max(0, Math.floor(ms / 1000));
        const days = Math.floor(total / 86400);
        const hours = Math.floor((total % 86400) / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const seconds = total % 60;
        const pad = n => String(n).padStart(2, '0');
        const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
        if (days > 0) return `${days}d • ${clock}`;
        return clock;
    }

    function getNotifCountdownHTML(dateKey, s) {
        const nowPH = getNowPH();
        const nowMs = Date.now();

        if (isScheduleLateNow(dateKey, s, nowPH)) {
            const range = parseScheduleTimeRange(s.time);
            let elapsedMs = 0;
            if (range) {
                if (dateKey === nowPH.dateKey) {
                    elapsedMs = Math.max(0, (nowPH.totalMinutes - range.endMin) * 60 * 1000);
                } else {
                    const target = getDateFromKey(dateKey);
                    target.setHours(23, 59, 0, 0);
                    elapsedMs = Math.max(0, nowMs - target.getTime());
                }
            } else {
                const target = getDateFromKey(dateKey);
                target.setHours(23, 59, 0, 0);
                elapsedMs = Math.max(0, nowMs - target.getTime());
            }
            const label = formatCountdown(elapsedMs);
            return `<span class="notif-countdown is-late" data-countdown="late" data-date-key="${dateKey}" data-id="${s.id}">
                        <span class="nc-label">Late:</span> ${label}
                    </span>`;
        }

        const range = parseScheduleTimeRange(s.time);
        let startMs;
        if (range && dateKey === nowPH.dateKey) {
            const sd = new Date();
            sd.setHours(Math.floor(range.startMin / 60), range.startMin % 60, 0, 0);
            startMs = sd.getTime();
        } else {
            const dd = getDateFromKey(dateKey);
            if (range) dd.setHours(Math.floor(range.startMin / 60), range.startMin % 60, 0, 0);
            startMs = dd.getTime();
        }
        const leftMs = startMs - nowMs;

        if (leftMs <= 0) {
            return `<span class="notif-countdown is-urgent" data-countdown="left" data-date-key="${dateKey}" data-id="${s.id}">
                        <span class="nc-label">Left:</span> ${formatCountdown(0)}
                    </span>`;
        }

        const label = formatCountdown(leftMs);
        const hoursLeft = leftMs / 3600000;
        let cls = 'is-safe';
        if (normalizeStatus(s.status) === 'priority') {
            cls = 'is-priority';
        } else if (hoursLeft <= 24) {
            cls = 'is-urgent';
        }

        return `<span class="notif-countdown ${cls}" data-countdown="left" data-date-key="${dateKey}" data-id="${s.id}">
                    <span class="nc-label">Left:</span> ${label}
                </span>`;
    }

    // ============================================================
    // RECENT IMPORT HISTORY
    // ============================================================
    const RECENT_IMPORTS_KEY = 'skedo_recent_imports_v1';
    const RECENT_IMPORTS_MAX = 10;
    const RECENT_IMPORTS_PAGE_SIZE = 2;
    let recentImportsPage = 0;

    function loadRecentImports() {
        try {
            const raw = localStorage.getItem(RECENT_IMPORTS_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch { return []; }
    }

    function saveRecentImports(list) {
        try {
            localStorage.setItem(RECENT_IMPORTS_KEY, JSON.stringify(list.slice(0, RECENT_IMPORTS_MAX)));
        } catch {}
    }

    function recordRecentImport(fileName, count) {
        const list = loadRecentImports();
        list.unshift({
            fileName: String(fileName || 'Imported file'),
            count: Number(count) || 0,
            importedAt: new Date().toISOString()
        });
        saveRecentImports(list.slice(0, RECENT_IMPORTS_MAX));
        recentImportsPage = 0;
        renderRecentImports();
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
                    time: item.time || '',
                    lateMarked: !!item.late_marked
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
                time: item.time || '',
                lateMarked: !!item.late_marked
            }));

            isLoaded = true;
            renderCalendar();
            renderNotifications();
            renderRecentImports();
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
                        late_marked: s.lateMarked || false,
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
                    late_marked: t.lateMarked || false,
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

    // ============================================================
    // HELPERS
    // ============================================================
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
        if (diff <= 3) return 'urgent';
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

    // ============================================================
    // STATE (UI)
    // ============================================================
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
    let notifSort = { kind: 'upcoming', order: 'asc' };

    let viewContext = { kind: 'schedule', trashId: null };

    // ============================================================
    // DOM
    // ============================================================
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
    const notifSortBtn = document.getElementById('notifSortBtn');
    const notifSortPopover = document.getElementById('notifSortPopover');

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

        dropdown.querySelectorAll('.time-option').forEach(btn => {
            btn.addEventListener('mousedown', (e) => {
                e.preventDefault();
            });
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                state.hh = btn.dataset.hour;
                if (!state.mm) state.mm = '00';

                pickerEl.classList.remove('invalid');
                input.value = `${state.hh}:${state.mm}`;

                writeStateToDataset();
                syncAmpmUI();
                renderDropdown();

                requestAnimationFrame(() => {
                    dropdown.classList.remove('open');
                    input.focus();
                    if (input.setSelectionRange) {
                        try { input.setSelectionRange(0, 2); } catch (_) {}
                    }
                });
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
                const autoPriority = !lateNow && diff >= 0 && diff <= 3;

                let status, edgeClass;
                if (lateNow) {
                    status = 'overdue'; edgeClass = 'late-edge';
                } else if (st === 'priority' || autoPriority) {
                    status = 'priority'; edgeClass = 'priority-edge';
                } else if (diff < 0) {
                    status = 'overdue'; edgeClass = 'late-edge';
                } else {
                    status = 'upcoming'; edgeClass = 'upcoming-edge';
                }

                items.push({
                    id: s.id,
                    dateKey,
                    title: s.title,
                    type: s.type || '',
                    scheduleStatus: st,
                    diff,
                    isLate: status === 'overdue',
                    isPriority: status === 'priority',
                    status,
                    edgeClass,
                    unread: !notifSeenIds.has(s.id)
                });
            });
        });

        const statusRank = { upcoming: 0, priority: 1, overdue: 2 };
        const order = notifSort.order === 'asc' ? 1 : -1;

        items.sort((a, b) => {
            const r = (statusRank[a.status] - statusRank[b.status]) * order;
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

        syncNotifSortPopover();

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
        items.forEach(it => { html += renderNotifItemHTML(it); });
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

    function renderNotifItemHTML(it) {
        const itemClasses = ['notif-item', it.edgeClass, it.unread ? 'unread' : ''].filter(Boolean).join(' ');
        const dateObj = getDateFromKey(it.dateKey);
        const dateLabel = dateObj.toLocaleDateString('en-US', {
            month: 'long', day: '2-digit', year: 'numeric'
        });

        const typeBadgeHtml = it.type
            ? `<span class="notif-type-badge-wrap">${renderTypeBadge(it.type)}</span>`
            : `<span class="notif-type-badge-wrap"><span class="type-badge" style="background:#f1f5f9; color:#94a3b8; border-color:#e2e8f0;"><i class="fas fa-tag"></i> No type</span></span>`;

        let statusPill;
        if (it.isLate) {
            statusPill = `<span class="notif-status-pill late"><i class="fas fa-exclamation-circle"></i> Late</span>`;
        } else if (it.isPriority) {
            statusPill = `<span class="notif-status-pill priority"><i class="fas fa-star"></i> Priority</span>`;
        } else {
            statusPill = `<span class="notif-status-pill upcoming"><i class="fas fa-clock"></i> Upcoming</span>`;
        }

        const sched = (schedules[it.dateKey] || []).find(s => s.id === it.id);
        const countdownHtml = sched ? getNotifCountdownHTML(it.dateKey, sched) : '';

        return `
            <button class="${itemClasses}" data-notif-id="${it.id}" data-notif-date="${it.dateKey}">
                <span class="notif-body">
                    <span class="notif-title">${escapeHtml(it.title)} ${statusPill}</span>
                    <span class="notif-sub">
                        ${typeBadgeHtml}
                        <span class="notif-date">${escapeHtml(dateLabel)}</span>
                    </span>
                    ${countdownHtml}
                </span>
            </button>
        `;
    }

    function syncNotifSortPopover() {
        if (!notifSortPopover) return;
        notifSortPopover.querySelectorAll('[data-notif-status]').forEach(el => {
            el.classList.toggle('selected', el.dataset.notifStatus === notifSort.kind);
        });
        notifSortPopover.querySelectorAll('[data-notif-order]').forEach(el => {
            el.classList.toggle('selected', el.dataset.notifOrder === notifSort.order);
        });
        if (notifSortBtn) {
            const icon = notifSortBtn.querySelector('i');
            if (icon) {
                const dir = notifSort.order === 'asc' ? 'up' : 'down';
                icon.className = `fas fa-sort-amount-${dir}`;
            }
        }
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
        tickCountdowns();
    }
    function closeNotifPanel() {
        notifPanel.classList.remove('open');
        notifBtn.classList.remove('active');
        if (notifSortPopover) notifSortPopover.classList.remove('open');
        if (notifSortBtn) {
            notifSortBtn.classList.remove('active');
            notifSortBtn.setAttribute('aria-expanded', 'false');
        }
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

    if (notifSortBtn && notifSortPopover) {
        notifSortBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const willOpen = !notifSortPopover.classList.contains('open');
            notifSortPopover.classList.toggle('open', willOpen);
            notifSortBtn.classList.toggle('active', willOpen);
            notifSortBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            if (willOpen) syncNotifSortPopover();
        });

        notifSortPopover.querySelectorAll('[data-notif-status]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                notifSort.kind = btn.dataset.notifStatus;
                syncNotifSortPopover();
                renderNotifications();
            });
        });
        notifSortPopover.querySelectorAll('[data-notif-order]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                notifSort.order = btn.dataset.notifOrder;
                syncNotifSortPopover();
                renderNotifications();
            });
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.notif-sort-btn') && !e.target.closest('.notif-sort-popover')) {
                notifSortPopover.classList.remove('open');
                notifSortBtn.classList.remove('active');
                notifSortBtn.setAttribute('aria-expanded', 'false');
            }
        });
    }

    // ============================================================
    // CONFIRM MODAL
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

    // ============================================================
    // VALIDATION MODAL
    // ============================================================
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

    // ============================================================
    // TYPE BUTTONS
    // ============================================================
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

    // ============================================================
    // UPCOMING 7 DAYS TABLE
    // ============================================================
    function renderUpcomingTable() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const endDate = new Date(today);
        endDate.setDate(endDate.getDate() + 6);

        const rangeStartLabel = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const rangeEndLabel = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        upcomingRange.textContent = `${rangeStartLabel} – ${rangeEndLabel}`;

        const nowPH = getNowPH();
        const rows = [];

        for (let i = 0; i < 7; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() + i);
            const dateKey = formatDateKey(d);
            const daySchedules = schedules[dateKey] || [];
            daySchedules.forEach(s => {
                const st = normalizeStatus(s.status);
                const isLate = isScheduleLateNow(dateKey, s, nowPH);
                const timeRange = parseScheduleTimeRange(s.time);
                rows.push({
                    dateKey,
                    dateObj: d,
                    id: s.id,
                    title: s.title,
                    description: s.description || '',
                    type: s.type || '',
                    time: s.time || '',
                    status: st,
                    isLate,
                    startMinutes: timeRange ? timeRange.startMin : Number.MAX_SAFE_INTEGER
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

        rows.sort((a, b) => {
            if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
            return a.startMinutes - b.startMinutes;
        });

        let html = '';
        rows.forEach(r => {
            const isToday = r.dateKey === todayKey;
            const dateLabel = r.dateObj.toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric'
            });
            const dayLabel = weekdayShort[r.dateObj.getDay()];

            const timeText = r.time
                ? `<span class="upcoming-time-cell">${escapeHtml(r.time)}</span>`
                : `<span class="upcoming-desc-cell empty">—</span>`;

            let statusBadge;
            if (r.isLate) {
                statusBadge = `<span class="upcoming-status-badge late"><i class="fas fa-exclamation-circle"></i> Late</span>`;
            } else if (r.status === 'done') {
                statusBadge = `<span class="upcoming-status-badge done"><i class="fas fa-check-circle"></i> Done</span>`;
            } else if (r.status === 'priority') {
                statusBadge = `<span class="upcoming-status-badge priority"><i class="fas fa-star"></i> Priority</span>`;
            } else {
                statusBadge = `<span class="upcoming-status-badge upcoming"><i class="fas fa-calendar-check"></i> Upcoming</span>`;
            }

            const rowClasses = [
                isToday ? 'upcoming-today' : '',
                r.isLate ? 'upcoming-late' : ''
            ].filter(Boolean).join(' ');

            html += `
                <tr class="${rowClasses}">
                    <td class="col-date" data-label="Date">
                        <span class="upcoming-date-cell">${escapeHtml(dateLabel)}</span>
                    </td>
                    <td class="col-day" data-label="Day">
                        <span class="upcoming-day-cell">${escapeHtml(dayLabel)}${isToday ? '<span class="upcoming-today-badge">TODAY</span>' : ''}</span>
                    </td>
                    <td class="col-title" data-label="Title">
                        <span class="upcoming-title-cell">${escapeHtml(r.title)}</span>
                    </td>
                    <td class="col-time" data-label="Time">
                        ${timeText}
                    </td>
                    <td class="col-type" data-label="Type">
                        ${r.type ? renderTypeBadge(r.type) : '<span class="upcoming-desc-cell empty">No type</span>'}
                    </td>
                    <td class="col-status" data-label="Status">
                        ${statusBadge}
                    </td>
                    <td class="col-desc" data-label="Description">
                        ${r.description
                            ? `<span class="upcoming-desc-cell upcoming-desc-clamp" title="${escapeHtml(r.description)}">${escapeHtml(r.description)}</span>`
                            : `<span class="upcoming-desc-cell empty">No description</span>`}
                    </td>
                    <td class="col-actions">
                        <div class="upcoming-actions">
                            <button class="icon-btn view" data-upcoming-action="view" data-date="${r.dateKey}" data-id="${r.id}" title="View details"><i class="fas fa-eye"></i></button>
                            <button class="icon-btn edit" data-upcoming-action="edit" data-date="${r.dateKey}" data-id="${r.id}" title="Edit schedule"><i class="fas fa-pen"></i></button>
                            <button class="icon-btn delete" data-upcoming-action="delete" data-date="${r.dateKey}" data-id="${r.id}" title="Move to recycle bin"><i class="fas fa-trash-alt"></i></button>
                        </div>
                    </td>
                </tr>
            `;
        });

        upcomingTableBody.innerHTML = html;

        upcomingTableBody.querySelectorAll('[data-upcoming-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.upcomingAction;
                const dateKey = btn.dataset.date;
                const id = btn.dataset.id;
                if (!dateKey || !id) return;

                if (action === 'view') openViewModal(dateKey, id);
                else if (action === 'edit') openEditFormModal(dateKey, id, false);
                else if (action === 'delete') deleteScheduleFromList(dateKey, id);
            });
        });
    }

    // ============================================================
    // RECENT IMPORTS RENDERER
    // ============================================================
    function renderRecentImports() {
        const body = document.getElementById('recentImportsBody');
        const empty = document.getElementById('recentImportsEmpty');
        const tableWrap = document.querySelector('.recent-imports-table-wrap');
        const clearBtn = document.getElementById('clearRecentImportsBtn');
        const pager = document.getElementById('recentImportsPager');
        const pagerDots = document.getElementById('riPagerDots');
        const prevBtn = document.getElementById('riPrevBtn');
        const nextBtn = document.getElementById('riNextBtn');
        if (!body || !empty) return;

        const list = loadRecentImports();

        if (list.length === 0) {
            body.innerHTML = '';
            empty.style.display = 'block';
            if (tableWrap) tableWrap.style.display = 'none';
            if (clearBtn) clearBtn.style.display = 'none';
            if (pager) pager.style.display = 'none';
            recentImportsPage = 0;
            return;
        }

        empty.style.display = 'none';
        if (tableWrap) tableWrap.style.display = '';
        if (clearBtn) clearBtn.style.display = '';

        const totalPages = Math.ceil(list.length / RECENT_IMPORTS_PAGE_SIZE);
        if (recentImportsPage >= totalPages) recentImportsPage = totalPages - 1;
        if (recentImportsPage < 0) recentImportsPage = 0;

        const start = recentImportsPage * RECENT_IMPORTS_PAGE_SIZE;
        const slice = list.slice(start, start + RECENT_IMPORTS_PAGE_SIZE);

        const rowsHtml = slice.map(item => {
            const date = new Date(item.importedAt);
            const dateLabel = isNaN(date.getTime())
                ? '—'
                : date.toLocaleString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit'
                }).replace(/,\s(\d{4}),\s/, ', $1 • ');

            return `
                <tr>
                    <td data-label="File">
                        <div class="ri-file-cell">
                            <i class="fas fa-file-excel"></i>
                            <span class="ri-file-name">${escapeHtml(item.fileName)}</span>
                        </div>
                    </td>
                    <td data-label="Schedules">
                        <span class="ri-count-pill">
                            <i class="fas fa-calendar-check"></i>
                            ${item.count} schedule${item.count === 1 ? '' : 's'}
                        </span>
                    </td>
                    <td data-label="Imported At" class="ri-date-cell">
                        ${escapeHtml(dateLabel)}
                    </td>
                </tr>
            `;
        }).join('');

        body.innerHTML = rowsHtml;

        if (pager && pagerDots && prevBtn && nextBtn) {
            if (totalPages <= 1) {
                pager.style.display = 'none';
            } else {
                pager.style.display = 'flex';
                prevBtn.disabled = recentImportsPage === 0;
                nextBtn.disabled = recentImportsPage === totalPages - 1;

                let dotsHtml = '';
                for (let i = 0; i < totalPages; i++) {
                    dotsHtml += `<button type="button" class="ri-pager-dot${i === recentImportsPage ? ' active' : ''}" data-page="${i}" aria-label="Page ${i + 1}"></button>`;
                }
                pagerDots.innerHTML = dotsHtml;

                pagerDots.querySelectorAll('.ri-pager-dot').forEach(dot => {
                    dot.addEventListener('click', () => {
                        recentImportsPage = parseInt(dot.dataset.page, 10) || 0;
                        renderRecentImports();
                    });
                });

                prevBtn.onclick = () => {
                    if (recentImportsPage > 0) {
                        recentImportsPage--;
                        renderRecentImports();
                    }
                };
                nextBtn.onclick = () => {
                    if (recentImportsPage < totalPages - 1) {
                        recentImportsPage++;
                        renderRecentImports();
                    }
                };
            }
        }
    }

    // ============================================================
    // CALENDAR RENDERER (auto-priority within 3 days)
    // ============================================================
    function renderCalendar() {
        monthYearText.textContent = `${monthNames[currentMonth]} ${currentYear}`;

        const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
        let startDayOfWeek = firstDayOfMonth.getDay();
        let offset = (startDayOfWeek === 0) ? 6 : startDayOfWeek - 1;

        const daysInCurrentMonth = daysInMonth(currentYear, currentMonth);
        const daysInPrevMonth = daysInMonth(currentYear, currentMonth - 1);

        const totalCells = 42;
        let cells = [];

        for (let i = offset - 1; i >= 0; i--) {
            const day = daysInPrevMonth - i;
            const date = new Date(currentYear, currentMonth - 1, day);
            cells.push({ date, isCurrentMonth: false });
        }
        for (let d = 1; d <= daysInCurrentMonth; d++) {
            const date = new Date(currentYear, currentMonth, d);
            cells.push({ date, isCurrentMonth: true });
        }
        let remaining = totalCells - cells.length;
        for (let d = 1; d <= remaining; d++) {
            const date = new Date(currentYear, currentMonth + 1, d);
            cells.push({ date, isCurrentMonth: false });
        }

        const todayDate = new Date();
        const todayKey = formatDateKey(todayDate);
        const nowPH = getNowPH();

        let gridHtml = '';
        cells.forEach((cell) => {
            const date = cell.date;
            const dateKey = formatDateKey(date);
            const isToday = dateKey === todayKey;
            const isCurrentMonth = cell.isCurrentMonth;
            const dayNumber = date.getDate();

            const daySchedules = schedules[dateKey] || [];

            let schedulesHtml = '';
            const maxVisible = 3;
            if (daySchedules.length > 0) {
                const visible = daySchedules.slice(0, maxVisible);
                visible.forEach(s => {
                    const shortTitle = s.title.length > 16 ? s.title.slice(0, 14) + '…' : s.title;
                    const st = normalizeStatus(s.status);
                    const urgency = getUrgencyLevel(dateKey);
                    const isLate = isScheduleLateNow(dateKey, s, nowPH);
                    const diffFromToday = daysUntil(dateKey);

                    const autoPriority = !isLate && st !== 'done' && diffFromToday >= 0 && diffFromToday <= 3;
                    const effectiveStatus = isLate ? 'late'
                                         : st === 'done' ? 'done'
                                         : (st === 'priority' || autoPriority) ? 'priority'
                                         : 'upcoming';

                    const itemClass = effectiveStatus === 'done' ? ' status-done'
                                    : effectiveStatus === 'late' ? ' status-late'
                                    : effectiveStatus === 'priority' ? ' status-priority'
                                    : ' status-upcoming-status status-' + urgency;

                    const timeLabel = s.time ? ` · ${s.time.split('–')[0].trim()}` : '';
                    const displayIcon = effectiveStatus === 'late' ? 'fa-exclamation-circle'
                                      : effectiveStatus === 'priority' ? 'fa-star'
                                      : getStatusIcon(effectiveStatus === 'upcoming' ? 'upcoming' : effectiveStatus);
                    const iconClass = effectiveStatus;

                    schedulesHtml += `
                        <div class="schedule-item${itemClass}" data-date="${dateKey}" data-id="${s.id}" ${isLate ? 'data-late="1"' : ''} title="${escapeHtml(s.title)} — ${escapeHtml(s.description || '')}">
                            <i class="fas ${displayIcon} schedule-status-icon ${iconClass}"></i>
                            <span class="schedule-title-highlight">${escapeHtml(shortTitle)}${timeLabel ? `<span style="font-weight:400; opacity:0.75;">${escapeHtml(timeLabel)}</span>` : ''}</span>
                        </div>
                    `;
                });
                if (daySchedules.length > maxVisible) {
                    schedulesHtml += `<div class="empty-hint" style="font-style:normal; text-align:left; padding-left:4px;">+ ${daySchedules.length - maxVisible} more</div>`;
                }
            } else {
                schedulesHtml = `<div class="empty-hint">—</div>`;
            }

            const cellClasses = [
                'day-cell',
                !isCurrentMonth ? 'other-month' : '',
                isToday ? 'today' : ''
            ].filter(Boolean).join(' ');

            gridHtml += `
                <div class="${cellClasses}" data-date-key="${dateKey}" data-is-current-month="${isCurrentMonth}">
                    <div class="day-header">
                        <span class="day-number">${dayNumber}</span>
                    </div>
                    <div class="schedule-list" data-date="${dateKey}">
                        ${schedulesHtml}
                    </div>
                </div>
            `;
        });

        calendarGrid.innerHTML = gridHtml;

        document.querySelectorAll('.schedule-item').forEach(item => {
            const parentCell = item.closest('.day-cell');
            if (!parentCell || parentCell.dataset.isCurrentMonth !== 'true') return;

            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const dateKey = item.dataset.date;
                if (dateKey) openDayListModal(dateKey);
            });
        });

        document.querySelectorAll('.day-cell').forEach(cell => {
            const isCurrentMonth = cell.dataset.isCurrentMonth === 'true';
            if (!isCurrentMonth) {
                cell.setAttribute('aria-disabled', 'true');
                cell.removeAttribute('tabindex');
                return;
            }
            cell.addEventListener('click', () => {
                const dateKey = cell.dataset.dateKey;
                if (dateKey) openDayListModal(dateKey);
            });
        });

        renderUpcomingTable();
    }

    // ============================================================
    // LIVE COUNTDOWN TICKER (flips Left → Late automatically)
    // ============================================================
    let countdownTicker = null;

    function tickCountdowns() {
        if (!notifPanel || !notifPanel.classList.contains('open')) return;
        const nodes = notifList.querySelectorAll('[data-countdown]');
        if (nodes.length === 0) return;

        const nowPH = getNowPH();
        const nowMs = Date.now();
        let becameLate = false;

        nodes.forEach(node => {
            const dateKey = node.dataset.dateKey;
            const id = node.dataset.id;
            const sched = (schedules[dateKey] || []).find(s => s.id === id);
            if (!sched) return;

            const isLate = isScheduleLateNow(dateKey, sched, nowPH);
            let newLabel = '';
            let newClass = '';

            if (isLate) {
                if (node.dataset.countdown !== 'late') becameLate = true;

                const range = parseScheduleTimeRange(sched.time);
                let elapsedMs = 0;
                if (range) {
                    if (dateKey === nowPH.dateKey) {
                        elapsedMs = Math.max(0, (nowPH.totalMinutes - range.endMin) * 60 * 1000);
                    } else {
                        const target = getDateFromKey(dateKey);
                        target.setHours(23, 59, 0, 0);
                        elapsedMs = Math.max(0, nowMs - target.getTime());
                    }
                } else {
                    const target = getDateFromKey(dateKey);
                    target.setHours(23, 59, 0, 0);
                    elapsedMs = Math.max(0, nowMs - target.getTime());
                }
                newLabel = formatCountdown(elapsedMs);
                newClass = 'is-late';
            } else {
                const range = parseScheduleTimeRange(sched.time);
                let startMs;
                if (range && dateKey === nowPH.dateKey) {
                    const sd = new Date();
                    sd.setHours(Math.floor(range.startMin / 60), range.startMin % 60, 0, 0);
                    startMs = sd.getTime();
                } else {
                    const dd = getDateFromKey(dateKey);
                    if (range) dd.setHours(Math.floor(range.startMin / 60), range.startMin % 60, 0, 0);
                    startMs = dd.getTime();
                }
                const leftMs = startMs - nowMs;

                if (leftMs <= 0) becameLate = true;

                newLabel = formatCountdown(Math.max(0, leftMs));

                const hoursLeft = leftMs / 3600000;
                if (normalizeStatus(sched.status) === 'priority') {
                    newClass = 'is-priority';
                } else if (hoursLeft <= 24) {
                    newClass = 'is-urgent';
                } else {
                    newClass = 'is-safe';
                }
            }

            node.className = `notif-countdown ${newClass}`;
            node.innerHTML = `
                <span class="nc-label">${isLate ? 'Late:' : 'Left:'}</span> ${newLabel}
            `;
        });

        if (becameLate) renderNotifications();
    }

    function startCountdownTicker() {
        if (countdownTicker) return;
        countdownTicker = setInterval(tickCountdowns, 1000);
    }

    // ============================================================
    // LATE TICKER (watches next 8 days)
    // ============================================================
    let lateTicker = null;
    let lastLateSnapshot = '';

    function buildLateSnapshot() {
        const nowPH = getNowPH();
        const parts = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (let i = 0; i < 8; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() + i);
            const key = formatDateKey(d);
            (schedules[key] || []).forEach(s => {
                if (isScheduleLateNow(key, s, nowPH)) parts.push(s.id);
            });
        }
        return parts.sort().join('|');
    }

    function tickLate() {
        const snap = buildLateSnapshot();
        if (snap !== lastLateSnapshot) {
            lastLateSnapshot = snap;
            renderCalendar();
            if (dayListOverlay.classList.contains('active') && activeDayListDateKey) {
                renderDayScheduleList();
            }
            renderNotifications();
        }
    }

    function startLateTicker() {
        if (lateTicker) return;
        lastLateSnapshot = buildLateSnapshot();
        lateTicker = setInterval(tickLate, 1000);
    }

    // ============================================================
    // DAY LIST MODAL
    // ============================================================
    function openDayListModal(dateKey) {
        activeDayListDateKey = dateKey;
        dayListSelection.clear();
        const dateObj = getDateFromKey(dateKey);
        dayListDateBadge.textContent = dateObj.toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
        });

        autoMarkPastDayAsLate(dateKey);

        renderDayScheduleList();
        renderCalendar();
        renderNotifications();
        dayListOverlay.classList.add('active');
    }

    function closeDayListModal() {
        closeStatusPopup();
        dayListOverlay.classList.remove('active');
        activeDayListDateKey = null;
        dayListSelection.clear();
    }

    function updateDayListBulkUI() {
        const daySchedules = activeDayListDateKey ? (schedules[activeDayListDateKey] || []) : [];
        const total = daySchedules.length;

        dayListToolbar.style.display = total > 0 ? 'flex' : 'none';

        const selected = dayListSelection.size;
        dayDeleteSelectedBtn.disabled = selected === 0;

        if (total === 0) {
            daySelectAll.checked = false;
            daySelectAll.indeterminate = false;
            daySelectAll.disabled = true;
        } else {
            daySelectAll.disabled = false;
            daySelectAll.checked = selected === total;
            daySelectAll.indeterminate = selected > 0 && selected < total;
        }
    }

    // ============================================================
    // STATUS POPUP (locked inside 3-day window unless late/done)
    // ============================================================
    let openStatusPopup = null;

    function closeStatusPopup() {
        if (openStatusPopup && openStatusPopup.parentNode) {
            openStatusPopup.parentNode.removeChild(openStatusPopup);
        }
        openStatusPopup = null;
    }

    function isStatusLocked(dateKey, sched) {
        if (!sched) return false;
        const nowPH = getNowPH();
        const isLate = isScheduleLateNow(dateKey, sched, nowPH);
        const st = normalizeStatus(sched.status);
        if (isLate) return false;
        if (st === 'done') return false;
        const diff = daysUntil(dateKey);
        return diff >= 0 && diff <= 3;
    }

    function openStatusPicker(anchorEl, dateKey, id, currentStatus) {
        const sched = (schedules[dateKey] || []).find(s => s.id === id);
        if (!sched) return;

        if (isStatusLocked(dateKey, sched)) {
            openConfirmModal({
                title: 'Status locked',
                message: 'Schedules within the next 3 days are automatically set to Priority. You can only change the status once the schedule is late or beyond the 3-day window.',
                okText: 'OK',
                iconClass: 'warning',
                showCancel: false,
                onConfirm: () => {}
            });
            return;
        }

        closeStatusPopup();

        const popup = document.createElement('div');
        popup.className = 'status-popup';
        popup.innerHTML = `
            <button type="button" class="status-popup-option ${currentStatus === 'upcoming' ? 'selected' : ''}" data-pick="upcoming">
                <i class="fas fa-calendar-check"></i>
                <span>Upcoming</span>
                <i class="fas fa-check status-popup-check"></i>
            </button>
            <button type="button" class="status-popup-option ${currentStatus === 'done' ? 'selected' : ''}" data-pick="done">
                <i class="fas fa-check-circle"></i>
                <span>Done</span>
                <i class="fas fa-check status-popup-check"></i>
            </button>
            <button type="button" class="status-popup-option ${currentStatus === 'priority' ? 'selected' : ''}" data-pick="priority">
                <i class="fas fa-star"></i>
                <span>Priority</span>
                <i class="fas fa-check status-popup-check"></i>
            </button>
        `;

        document.body.appendChild(popup);
        openStatusPopup = popup;

        const rect = anchorEl.getBoundingClientRect();
        const popupWidth = 170;
        const popupHeight = popup.offsetHeight || 150;

        let top = rect.bottom + window.scrollY + 6;
        if (top + popupHeight > window.scrollY + window.innerHeight - 8) {
            top = rect.top + window.scrollY - popupHeight - 6;
        }
        let left = rect.left + window.scrollX - (popupWidth / 2) + (rect.width / 2);
        if (left < 8) left = 8;
        if (left + popupWidth > window.innerWidth - 8) left = window.innerWidth - popupWidth - 8;

        popup.style.top = top + 'px';
        popup.style.left = left + 'px';
        popup.style.width = popupWidth + 'px';

        popup.querySelectorAll('[data-pick]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const chosen = btn.dataset.pick;
                closeStatusPopup();
                setScheduleStatus(dateKey, id, chosen);
            });
        });
    }

    document.addEventListener('click', (e) => {
        if (openStatusPopup && !e.target.closest('.status-popup') && !e.target.closest('[data-status-trigger]')) {
            closeStatusPopup();
        }
    });
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && openStatusPopup) closeStatusPopup();
    });
    window.addEventListener('scroll', closeStatusPopup, { passive: true });
    window.addEventListener('resize', closeStatusPopup);

    function setScheduleStatus(dateKey, id, newStatus) {
        const list = schedules[dateKey] || [];
        const item = list.find(s => s.id === id);
        if (!item) return;

        if (isStatusLocked(dateKey, item)) {
            openConfirmModal({
                title: 'Status locked',
                message: 'This schedule is within the 3-day priority window and cannot be changed.',
                okText: 'OK',
                iconClass: 'warning',
                showCancel: false,
                onConfirm: () => {}
            });
            return;
        }

        const normalized = normalizeStatus(newStatus);
        if (normalizeStatus(item.status) === normalized) return;

        item.status = normalized;
        if (normalized === 'done') item.lateMarked = false;
        item.updatedAt = new Date().toISOString();

        scheduleSave();
        renderCalendar();
        renderNotifications();
        renderDayScheduleList();
        if (historyOverlay.classList.contains('active')) renderHistory();
    }

    // ============================================================
    // DAY SCHEDULE LIST
    // ============================================================
    function renderDayScheduleList() {
        if (!activeDayListDateKey) return;
        const daySchedules = schedules[activeDayListDateKey] || [];

        const validIds = new Set(daySchedules.map(s => s.id));
        Array.from(dayListSelection).forEach(id => {
            if (!validIds.has(id)) dayListSelection.delete(id);
        });

        closeStatusPopup();

        if (daySchedules.length === 0) {
            dayScheduleList.innerHTML = `
                <div class="empty-day-message">
                    <i class="fas fa-calendar-day"></i>
                    No schedules yet for this day.<br>Click "Add New Schedule" to create one.
                </div>
            `;
            updateDayListBulkUI();
            return;
        }

        const nowPH = getNowPH();
        let html = '';
        daySchedules.forEach(s => {
            const desc = s.description || 'No description';
            const isChecked = dayListSelection.has(s.id);
            const st = normalizeStatus(s.status);
            const isLate = isScheduleLateNow(activeDayListDateKey, s, nowPH);
            const diffFromToday = daysUntil(activeDayListDateKey);
            const autoPriority = !isLate && st !== 'done' && diffFromToday >= 0 && diffFromToday <= 3;
            const effectiveStatus = isLate ? 'late'
                                 : st === 'done' ? 'done'
                                 : (st === 'priority' || autoPriority) ? 'priority'
                                 : 'upcoming';

            const cardStatusClass = effectiveStatus === 'done' ? ' status-done'
                                  : effectiveStatus === 'late' ? ' status-late'
                                  : effectiveStatus === 'priority' ? ' status-priority'
                                  : '';

            const timeHtml = s.time
                ? `<div class="card-desc" style="color:#6d28d9; font-weight:600; font-size:0.72rem;"><i class="fas fa-clock" style="font-size:0.62rem;"></i> ${escapeHtml(s.time)}</div>`
                : '';

            const lateBadge = isLate
                ? `<span class="late-pill"><i class="fas fa-exclamation-circle"></i> Due / Late</span>`
                : autoPriority
                ? `<span class="late-pill" style="background:#fef9c3; color:#a16207; border-color:#fde68a;"><i class="fas fa-lock"></i> Auto-Priority (locked)</span>`
                : '';

            const displayIcon = effectiveStatus === 'late' ? 'fa-exclamation-circle'
                              : effectiveStatus === 'priority' ? 'fa-star'
                              : getStatusIcon(effectiveStatus === 'upcoming' ? 'upcoming' : effectiveStatus);
            const iconClass = effectiveStatus;

            html += `
                <div class="day-schedule-card${cardStatusClass}">
                    <input type="checkbox" class="day-checkbox" data-day-id="${s.id}" ${isChecked ? 'checked' : ''}>
                    <div class="card-accent"></div>
                    <div class="card-body">
                        <div class="card-title">
                            <span class="schedule-title-highlight">${escapeHtml(s.title)}</span>
                        </div>
                        <div class="card-desc">${escapeHtml(desc)}</div>
                        ${timeHtml}
                        ${lateBadge}
                        ${s.type ? renderTypeBadge(s.type) : ''}
                    </div>
                    <div class="card-actions">
                        <button type="button"
                                class="status-icon-btn ${iconClass}"
                                data-status-trigger
                                data-date="${activeDayListDateKey}"
                                data-id="${s.id}"
                                data-current="${st}"
                                title="Change status (${getStatusLabel(st)})">
                            <i class="fas ${displayIcon}"></i>
                        </button>
                        <button class="icon-btn view" data-action="view" data-id="${s.id}" title="View details"><i class="fas fa-eye"></i></button>
                        <button class="icon-btn edit" data-action="edit" data-id="${s.id}" title="Edit schedule"><i class="fas fa-pen"></i></button>
                        <button class="icon-btn delete" data-action="delete" data-id="${s.id}" title="Move to recycle bin"><i class="fas fa-trash-alt"></i></button>
                    </div>
                </div>
            `;
        });
        dayScheduleList.innerHTML = html;

        dayScheduleList.querySelectorAll('.day-checkbox').forEach(cb => {
            cb.addEventListener('change', () => {
                const id = cb.dataset.dayId;
                if (cb.checked) dayListSelection.add(id);
                else dayListSelection.delete(id);
                updateDayListBulkUI();
            });
        });

        dayScheduleList.querySelectorAll('[data-status-trigger]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const dateKey = btn.dataset.date;
                const id = btn.dataset.id;
                const current = btn.dataset.current;
                if (!dateKey || !id) return;
                openStatusPicker(btn, dateKey, id, current);
            });
        });

        dayScheduleList.querySelectorAll('.icon-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                const id = btn.dataset.id;
                if (!id || !activeDayListDateKey) return;
                if (action === 'view') openViewModal(activeDayListDateKey, id);
                else if (action === 'edit') openEditFormModal(activeDayListDateKey, id, false);
                else if (action === 'delete') deleteScheduleFromList(activeDayListDateKey, id);
            });
        });

        updateDayListBulkUI();
    }

    // ============================================================
    // DELETE
    // ============================================================
    function deleteScheduleFromList(dateKey, id) {
        const schedule = (schedules[dateKey] || []).find(s => s.id === id);
        if (!schedule) return;

        openConfirmModal({
            title: 'Move to Recycle Bin?',
            message: `"${schedule.title}" will be moved to the Recycle Bin. You can recover it later from Settings.`,
            okText: 'Move to Bin',
            iconClass: 'warning',
            onConfirm: () => {
                const list = schedules[dateKey] || [];
                const idx = list.findIndex(s => s.id === id);
                if (idx === -1) return;

                const [removed] = list.splice(idx, 1);
                if (list.length === 0) delete schedules[dateKey];
                removed.dateKey = dateKey;
                removed.deletedAt = new Date().toISOString();
                trash.push(removed);

                dayListSelection.delete(id);
                scheduleSave();

                renderCalendar();
                renderNotifications();
                if (dayListOverlay.classList.contains('active') && activeDayListDateKey === dateKey) renderDayScheduleList();
                if (historyOverlay.classList.contains('active')) renderHistory();
                if (trashOverlay.classList.contains('active')) renderTrash();
            }
        });
    }

    function deleteSelectedDaySchedules() {
        if (!activeDayListDateKey || dayListSelection.size === 0) return;
        const dateKey = activeDayListDateKey;
        const ids = Array.from(dayListSelection);
        const count = ids.length;

        openConfirmModal({
            title: `Move ${count} schedule${count === 1 ? '' : 's'} to Recycle Bin?`,
            message: `The selected schedule${count === 1 ? '' : 's'} will be moved to the Recycle Bin.`,
            okText: 'Move to Bin',
            iconClass: 'warning',
            onConfirm: () => {
                const list = schedules[dateKey] || [];
                ids.forEach(id => {
                    const idx = list.findIndex(s => s.id === id);
                    if (idx === -1) return;
                    const [removed] = list.splice(idx, 1);
                    removed.dateKey = dateKey;
                    removed.deletedAt = new Date().toISOString();
                    trash.push(removed);
                });
                if (list.length === 0) delete schedules[dateKey];

                dayListSelection.clear();
                scheduleSave();

                renderCalendar();
                renderNotifications();
                if (dayListOverlay.classList.contains('active') && activeDayListDateKey === dateKey) renderDayScheduleList();
                if (historyOverlay.classList.contains('active')) renderHistory();
                if (trashOverlay.classList.contains('active')) renderTrash();
            }
        });
    }

    // ============================================================
    // VIEW MODAL
    // ============================================================
    function openViewModal(dateKey, scheduleId, fromHistory = false) {
        const schedule = (schedules[dateKey] || []).find(s => s.id === scheduleId);
        if (!schedule) return;
        reopenHistoryAfterEdit = fromHistory;

        const dateObj = getDateFromKey(dateKey);

        viewContext = { kind: 'schedule', trashId: null };
        viewOverlay.classList.remove('trash-context');
        viewTrashDetails.style.display = 'none';
        viewStatusRow.style.display = 'block';
        recoverFromViewBtn.style.display = 'none';
        viewModalTitle.innerHTML = '<i class="fas fa-eye" style="color:#3b82f6;"></i> Schedule Details';

        viewTitle.textContent = schedule.title;
        viewType.innerHTML = schedule.type ? renderTypeBadge(schedule.type) : '<span style="color:#94a3b8;">—</span>';
        viewTime.textContent = schedule.time || '—';
        viewDescription.textContent = schedule.description || 'No description provided.';
        viewDate.textContent = dateObj.toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });

        const st = normalizeStatus(schedule.status);
        const stIcon = getStatusIcon(st);
        const stLabel = getStatusLabel(st);
        const isLate = isScheduleLateNow(dateKey, schedule);
        const stColor = st === 'done' ? '#16a34a'
                        : isLate ? '#dc2626'
                        : st === 'priority' ? '#ca8a04'
                        : '#64748b';
        const finalLabel = isLate ? 'Due / Late' : stLabel;
        const finalIcon = isLate ? 'fa-exclamation-circle' : stIcon;
        viewStatus.innerHTML = `<span style="color:${stColor}; font-weight:600;"><i class="fas ${finalIcon}"></i> ${finalLabel}</span>`;

        viewOverlay.classList.add('active');
    }

    function openTrashViewModal(trashId) {
        const item = trash.find(t => t.id === trashId);
        if (!item) return;

        viewContext = { kind: 'trash', trashId };
        viewOverlay.classList.add('trash-context');
        viewModalTitle.innerHTML = '<i class="fas fa-eye" style="color:#dc2626;"></i> Deleted Schedule Details';

        viewTitle.textContent = item.title;
        viewType.innerHTML = item.type ? renderTypeBadge(item.type) : '<span style="color:#94a3b8;">—</span>';
        viewTime.textContent = item.time || '—';
        viewDescription.textContent = item.description || 'No description provided.';

        const dateObj = getDateFromKey(item.dateKey || formatDateKey(new Date()));
        viewDate.textContent = dateObj.toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });

        const st = normalizeStatus(item.status);
        const stIcon = getStatusIcon(st);
        const stLabel = getStatusLabel(st);
        const stColor = st === 'done' ? '#16a34a' : st === 'priority' ? '#ca8a04' : '#64748b';
        viewStatus.innerHTML = `<span style="color:${stColor}; font-weight:600;"><i class="fas ${stIcon}"></i> ${stLabel}</span>`;
        viewStatusRow.style.display = 'block';

        viewTrashDetails.style.display = 'block';
        viewCreatedAt.textContent = item.createdAt ? formatDateTime(item.createdAt) : '—';
        viewDeletedAt.textContent = item.deletedAt ? formatDateTime(item.deletedAt) : '—';

        recoverFromViewBtn.style.display = 'inline-flex';
        viewOverlay.classList.add('active');
    }

    function closeViewModal() {
        viewOverlay.classList.remove('active');
        viewOverlay.classList.remove('trash-context');
        viewTrashDetails.style.display = 'none';
        recoverFromViewBtn.style.display = 'none';
        viewContext = { kind: 'schedule', trashId: null };

        if (reopenHistoryAfterEdit) {
            reopenHistoryAfterEdit = false;
            openHistoryModal();
        }
    }

    // ============================================================
    // CREATE / EDIT FORM
    // ============================================================
    function openCreateFormModal(dateKey) {
        reopenHistoryAfterEdit = false;
        editingScheduleId = null;
        selectedDateKey = dateKey;
        document.getElementById('editingId').value = '';
        document.getElementById('selectedDate').value = dateKey;

        const dateObj = getDateFromKey(dateKey);
        modalTitle.innerHTML = '<i class="fas fa-calendar-plus" style="color:#3b82f6;"></i> New Schedule';
        modalDateBadge.textContent = dateObj.toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
        });

        scheduleTitle.value = '';
        scheduleDescription.value = '';
        if (startPicker) startPicker.reset();
        if (endPicker) endPicker.reset();
        resetTypeButtons(null);
        updateCharCounter();

        document.querySelectorAll('.field.invalid').forEach(el => el.classList.remove('invalid'));
        modalOverlay.classList.add('active');
        scheduleTitle.focus();
    }

    function openEditFormModal(dateKey, scheduleId, fromHistory = false) {
        const schedule = (schedules[dateKey] || []).find(s => s.id === scheduleId);
        if (!schedule) return;

        reopenHistoryAfterEdit = fromHistory;
        editingScheduleId = scheduleId;
        selectedDateKey = dateKey;
        document.getElementById('editingId').value = scheduleId;
        document.getElementById('selectedDate').value = dateKey;

        const dateObj = getDateFromKey(dateKey);
        modalTitle.innerHTML = '<i class="fas fa-pen" style="color:#3b82f6;"></i> Edit Schedule';
        modalDateBadge.textContent = dateObj.toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
        });

        scheduleTitle.value = schedule.title;
        scheduleDescription.value = schedule.description || '';
        resetTypeButtons(schedule.type || null);
        updateCharCounter();

        if (startPicker) startPicker.reset();
        if (endPicker) endPicker.reset();

        if (schedule.time) {
            const parts = parseSavedTimeRange(schedule.time);
            const s = splitTimeString(parts.start);
            const e = splitTimeString(parts.end);
            if (s && startPicker) startPicker.setValue(s.hh, s.mm, s.ampm);
            if (e && endPicker)   endPicker.setValue(e.hh, e.mm, e.ampm);
        }

        document.querySelectorAll('.field.invalid').forEach(el => el.classList.remove('invalid'));
        modalOverlay.classList.add('active');
        scheduleTitle.focus();
    }

    function closeFormModal() {
        modalOverlay.classList.remove('active');
        editingScheduleId = null;
        selectedDateKey = null;
        pendingSave = null;
        formType = { base: null, custom: '' };
        customTypeInput.style.display = 'none';
        customTypeInput.value = '';
        document.querySelectorAll('.field.invalid').forEach(el => el.classList.remove('invalid'));

        if (reopenHistoryAfterEdit) {
            reopenHistoryAfterEdit = false;
            openHistoryModal();
        }
    }

    function collectValidationErrors() {
        const errors = [];
        const titleVal = scheduleTitle.value.trim();
        const descVal = scheduleDescription.value.trim();
        const resolvedType = getResolvedType().trim();

        if (!titleVal) errors.push('Title is required.');
        if (!descVal) errors.push('Description is required.');
        if (!resolvedType) errors.push('Schedule type is required — pick a button or specify "Other".');

        return errors;
    }

    function highlightInvalidFields() {
        const titleField = scheduleTitle.closest('.field');
        const descField = scheduleDescription.closest('.field');
        const typeField = typeButtonGroup.closest('.field');

        if (!scheduleTitle.value.trim()) titleField.classList.add('invalid');
        else titleField.classList.remove('invalid');

        if (!scheduleDescription.value.trim()) descField.classList.add('invalid');
        else descField.classList.remove('invalid');

        if (!getResolvedType().trim()) typeField.classList.add('invalid');
        else typeField.classList.remove('invalid');
    }

    function requestSaveSchedule() {
        const errors = collectValidationErrors();
        if (errors.length > 0) {
            highlightInvalidFields();
            openValidationModal(errors);
            return;
        }

        const title = scheduleTitle.value.trim();
        const description = scheduleDescription.value.trim().slice(0, 200);
        const resolvedType = getResolvedType().trim();
        const startVal = startPicker ? startPicker.getValue() : '';
        const endVal   = endPicker   ? endPicker.getValue()   : '';
        const timeRange = (startVal && endVal) ? `${startVal} – ${endVal}` : (startVal || endVal || '');
        const dateKey = selectedDateKey;
        if (!dateKey) return;

        if (editingScheduleId) {
            const daySchedules = schedules[dateKey] || [];
            const original = daySchedules.find(s => s.id === editingScheduleId);
            if (!original) return;

            const sameTitle = original.title === title;
            const sameDesc = (original.description || '') === description;
            const sameType = (original.type || '') === resolvedType;
            const sameTime = (original.time || '') === timeRange;

            if (sameTitle && sameDesc && sameType && sameTime) {
                closeFormModal();
                return;
            }

            pendingSave = {
                mode: 'edit',
                dateKey,
                id: editingScheduleId,
                oldData: {
                    title: original.title,
                    description: original.description || '',
                    type: original.type || '',
                    time: original.time || '',
                    status: normalizeStatus(original.status)
                },
                newData: {
                    title,
                    description,
                    type: resolvedType,
                    time: timeRange,
                    status: normalizeStatus(original.status)
                }
            };
        } else {
            pendingSave = {
                mode: 'create',
                dateKey,
                id: null,
                oldData: null,
                newData: {
                    title,
                    description,
                    type: resolvedType,
                    time: timeRange,
                    status: 'upcoming'
                }
            };
        }

        openReviewModal(pendingSave);
    }

    // ============================================================
    // REVIEW MODAL
    // ============================================================
    function openReviewModal(payload) {
        const { mode, dateKey, oldData, newData } = payload;
        const dateObj = getDateFromKey(dateKey);
        const dateLabel = dateObj.toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
        });

        reviewTitleText.textContent = mode === 'edit' ? 'Review Changes' : 'Review New Schedule';

        reviewSubtitle.textContent = mode === 'edit'
            ? 'Changed fields are highlighted. Unchanged fields stay as-is. Nothing is saved yet.'
            : 'Please review the details below before adding this schedule.';

        let html = '';

        html += `
            <div class="review-block">
                <div class="review-block-label"><i class="fas fa-calendar-day"></i> Date</div>
                <div class="review-field">
                    <div class="review-value">${escapeHtml(dateLabel)}</div>
                </div>
                ${newData.time ? `
                    <div class="review-field">
                        <div class="review-field-name">Time</div>
                        <div class="review-value">${escapeHtml(newData.time)}</div>
                    </div>
                ` : ''}
            </div>
        `;

        if (mode === 'edit') {
            const titleChanged = oldData.title !== newData.title;
            const descChanged = (oldData.description || '') !== (newData.description || '');
            const typeChanged = (oldData.type || '') !== (newData.type || '');
            const timeChanged = (oldData.time || '') !== (newData.time || '');

            html += `
                <div class="review-block">
                    <div class="review-block-label"><i class="fas fa-history"></i> Old values</div>
                    <div class="review-field">
                        <div class="review-field-name">Title${titleChanged ? ' — edited' : ''}</div>
                        <div class="review-value ${titleChanged ? 'old' : 'same'}">${escapeHtml(oldData.title)}</div>
                    </div>
                    <div class="review-field">
                        <div class="review-field-name">Time${timeChanged ? ' — edited' : ''}</div>
                        <div class="review-value ${timeChanged ? 'old' : 'same'} ${oldData.time ? '' : 'empty'}">${oldData.time ? escapeHtml(oldData.time) : 'No time'}</div>
                    </div>
                    <div class="review-field">
                        <div class="review-field-name">Type${typeChanged ? ' — edited' : ''}</div>
                        <div class="review-value ${typeChanged ? 'old' : 'same'} ${oldData.type ? '' : 'empty'}">${oldData.type ? escapeHtml(oldData.type) : 'No type'}</div>
                    </div>
                    <div class="review-field">
                        <div class="review-field-name">Description${descChanged ? ' — edited' : ''}</div>
                        <div class="review-value ${descChanged ? 'old' : 'same'} ${oldData.description ? '' : 'empty'}">${oldData.description ? escapeHtml(oldData.description) : 'No description'}</div>
                    </div>
                </div>
            `;

            html += `
                <div class="review-block">
                    <div class="review-new-badge"><i class="fas fa-arrow-right"></i> New values (pending)</div>
                    <div class="review-field">
                        <div class="review-field-name">Title${titleChanged ? ' — changed' : ' — unchanged'}</div>
                        <div class="review-value ${titleChanged ? 'new' : 'same'}">${escapeHtml(newData.title)}</div>
                    </div>
                    <div class="review-field">
                        <div class="review-field-name">Time${timeChanged ? ' — changed' : ' — unchanged'}</div>
                        <div class="review-value ${timeChanged ? 'new' : 'same'} ${newData.time ? '' : 'empty'}">${newData.time ? escapeHtml(newData.time) : 'No time'}</div>
                    </div>
                    <div class="review-field">
                        <div class="review-field-name">Type${typeChanged ? ' — changed' : ' — unchanged'}</div>
                        <div class="review-value ${typeChanged ? 'new' : 'same'} ${newData.type ? '' : 'empty'}">${newData.type ? escapeHtml(newData.type) : 'No type'}</div>
                    </div>
                    <div class="review-field">
                        <div class="review-field-name">Description${descChanged ? ' — changed' : ' — unchanged'}</div>
                        <div class="review-value ${descChanged ? 'new' : 'same'} ${newData.description ? '' : 'empty'}">${newData.description ? escapeHtml(newData.description) : 'No description'}</div>
                    </div>
                </div>
            `;
        } else {
            html += `
                <div class="review-block">
                    <div class="review-new-badge"><i class="fas fa-plus-circle"></i> New schedule</div>
                    <div class="review-field">
                        <div class="review-field-name">Title</div>
                        <div class="review-value new">${escapeHtml(newData.title)}</div>
                    </div>
                    ${newData.time ? `
                        <div class="review-field">
                            <div class="review-field-name">Time</div>
                            <div class="review-value new">${escapeHtml(newData.time)}</div>
                        </div>
                    ` : ''}
                    <div class="review-field">
                        <div class="review-field-name">Type</div>
                        <div class="review-value new">${escapeHtml(newData.type)}</div>
                    </div>
                    <div class="review-field">
                        <div class="review-field-name">Description</div>
                        <div class="review-value new ${newData.description ? '' : 'empty'}">${newData.description ? escapeHtml(newData.description) : 'No description'}</div>
                    </div>
                </div>
            `;
        }

        reviewBody.innerHTML = html;
        modalOverlay.classList.remove('active');
        reviewOverlay.classList.add('active');
    }

    function closeReviewModal() {
        reviewOverlay.classList.remove('active');
    }

    function goBackToForm() {
        reviewOverlay.classList.remove('active');
        if (!pendingSave) return;

        selectedDateKey = pendingSave.dateKey;
        editingScheduleId = pendingSave.id || null;

        if (pendingSave.mode === 'edit') {
            modalTitle.innerHTML = '<i class="fas fa-pen" style="color:#3b82f6;"></i> Edit Schedule';
        } else {
            modalTitle.innerHTML = '<i class="fas fa-calendar-plus" style="color:#3b82f6;"></i> New Schedule';
        }

        const dateObj = getDateFromKey(pendingSave.dateKey);
        modalDateBadge.textContent = dateObj.toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
        });

        scheduleTitle.value = pendingSave.newData.title;
        scheduleDescription.value = pendingSave.newData.description;
        resetTypeButtons(pendingSave.newData.type);
        updateCharCounter();

        if (startPicker) startPicker.reset();
        if (endPicker) endPicker.reset();
        if (pendingSave.newData.time) {
            const parts = parseSavedTimeRange(pendingSave.newData.time);
            const s = splitTimeString(parts.start);
            const e = splitTimeString(parts.end);
            if (s && startPicker) startPicker.setValue(s.hh, s.mm, s.ampm);
            if (e && endPicker)   endPicker.setValue(e.hh, e.mm, e.ampm);
        }

        modalOverlay.classList.add('active');
        scheduleTitle.focus();
    }

    function confirmSave() {
        if (!pendingSave) return;

        const { mode, dateKey, id, newData } = pendingSave;

        if (mode === 'edit' && id) {
            const list = schedules[dateKey] || [];
            const item = list.find(s => s.id === id);
            if (item) {
                item.title = newData.title;
                item.description = newData.description;
                item.type = newData.type;
                item.time = newData.time || '';
                item.status = normalizeStatus(newData.status);
                item.updatedAt = new Date().toISOString();
            }
        } else {
            if (!schedules[dateKey]) schedules[dateKey] = [];
            schedules[dateKey].push({
                id: uid(),
                title: newData.title,
                description: newData.description,
                type: newData.type,
                time: newData.time || '',
                status: normalizeStatus(newData.status),
                createdAt: new Date().toISOString()
            });
        }

        scheduleSave();
        renderCalendar();
        renderNotifications();

        const shouldReopenHistory = reopenHistoryAfterEdit;
        reopenHistoryAfterEdit = false;

        closeReviewModal();
        modalOverlay.classList.remove('active');

        editingScheduleId = null;
        selectedDateKey = null;
        pendingSave = null;
        formType = { base: null, custom: '' };

        if (dayListOverlay.classList.contains('active') && activeDayListDateKey === dateKey) renderDayScheduleList();
        if (historyOverlay.classList.contains('active')) renderHistory();
        if (viewOverlay.classList.contains('active')) {
            const stillExists = (schedules[dateKey] || []).find(s => s.id === id);
            if (stillExists) openViewModal(dateKey, id);
            else closeViewModal();
        }

        if (shouldReopenHistory) openHistoryModal();
    }

    // ============================================================
    // DATE PICKER
    // ============================================================
    function populateDatePicker() {
        const now = new Date();
        const baseYear = now.getFullYear();
        const startYear = baseYear - 50;
        const endYear = baseYear + 50;

        pickYear.innerHTML = '';
        for (let y = startYear; y <= endYear; y++) {
            const opt = document.createElement('option');
            opt.value = y; opt.textContent = y;
            pickYear.appendChild(opt);
        }

        pickMonth.innerHTML = '';
        monthNames.forEach((m, idx) => {
            const opt = document.createElement('option');
            opt.value = idx; opt.textContent = m;
            pickMonth.appendChild(opt);
        });

        pickYear.value = currentYear;
        pickMonth.value = currentMonth;
        updateDayOptions();
        updateDatePreview();
    }

    function updateDayOptions() {
        const year = parseInt(pickYear.value, 10);
        const month = parseInt(pickMonth.value, 10);
        const maxDay = daysInMonth(year, month);
        const previousDay = parseInt(pickDay.value, 10) || 1;

        pickDay.innerHTML = '';
        for (let d = 1; d <= maxDay; d++) {
            const opt = document.createElement('option');
            opt.value = d; opt.textContent = d;
            pickDay.appendChild(opt);
        }
        pickDay.value = Math.min(previousDay, maxDay);
        updateDatePreview();
    }

    function updateDatePreview() {
        const year = parseInt(pickYear.value, 10);
        const month = parseInt(pickMonth.value, 10);
        const day = parseInt(pickDay.value, 10);
        if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
            const previewDate = new Date(year, month, day);
            datePreviewText.textContent = previewDate.toLocaleDateString('en-US', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
            });
        } else {
            datePreviewText.textContent = '—';
        }
    }

    function openDatePickerModal() {
        populateDatePicker();
        pickYear.value = currentYear;
        pickMonth.value = currentMonth;
        const now = new Date();
        pickDay.value = (currentYear === now.getFullYear() && currentMonth === now.getMonth())
            ? now.getDate() : 1;
        updateDayOptions();
        updateDatePreview();
        datePickerOverlay.classList.add('active');
    }

    function closeDatePickerModal() { datePickerOverlay.classList.remove('active'); }

    function goToPickedDate() {
        currentYear = parseInt(pickYear.value, 10);
        currentMonth = parseInt(pickMonth.value, 10);
        renderCalendar();
        closeDatePickerModal();
    }

    // ============================================================
    // HISTORY
    // ============================================================
    function getAllSchedulesFlat() {
        const flat = [];
        Object.keys(schedules).forEach(dateKey => {
            (schedules[dateKey] || []).forEach(s => flat.push({ dateKey, ...s }));
        });
        return flat;
    }

    function populateHistoryYearFilter() {
        const years = new Set();
        years.add(new Date().getFullYear());

        Object.keys(schedules).forEach(dateKey => {
            const y = dateKey.split('-')[0];
            if (y) years.add(parseInt(y, 10));
        });

        const sorted = Array.from(years).sort((a, b) => b - a);
        const currentVal = historyYearFilter.value;
        historyYearFilter.innerHTML = '<option value="all">All Years</option>';
        sorted.forEach(y => {
            const opt = document.createElement('option');
            opt.value = y; opt.textContent = y;
            historyYearFilter.appendChild(opt);
        });
        if (currentVal && (currentVal === 'all' || sorted.includes(parseInt(currentVal, 10)))) {
            historyYearFilter.value = currentVal;
        }
    }

    function renderHistory() {
        populateHistoryYearFilter();

        const all = getAllSchedulesFlat();
        totalSchedulesCount.textContent = all.length;
        totalDaysCount.textContent = new Set(all.map(s => s.dateKey)).size;
        totalMonthsCount.textContent = new Set(all.map(s => s.dateKey.slice(0, 7))).size;

        const query = historySearch.value.trim().toLowerCase();
        const yearFilter = historyYearFilter.value;
        const monthFilter = historyMonthFilter.value;

        const now = new Date();
        const currentYearStr = String(now.getFullYear());
        const currentMonthStr = String(now.getMonth() + 1).padStart(2, '0');

        let filtered = all;

        if (yearFilter === 'all' && monthFilter === 'all') {
            const currentPrefix = `${currentYearStr}-${currentMonthStr}`;
            filtered = filtered.filter(s => s.dateKey.startsWith(currentPrefix));
        } else {
            if (yearFilter !== 'all') {
                filtered = filtered.filter(s => s.dateKey.startsWith(yearFilter + '-'));
            }
            if (monthFilter !== 'all') {
                const mm = String(monthFilter).padStart(2, '0');
                filtered = filtered.filter(s => s.dateKey.slice(5, 7) === mm);
            }
        }

        if (query) {
            filtered = filtered.filter(s =>
                s.title.toLowerCase().includes(query) ||
                (s.description || '').toLowerCase().includes(query)
            );
        }

        filtered = applySort(filtered, historySort);
        updateSortIcon(historySortBtn, historySort);
        syncSortPopover(historySortPopover, historySort);

        if (filtered.length === 0) {
            let emptyLabel = 'No schedules found';

            if (yearFilter === 'all' && monthFilter === 'all' && !query) {
                emptyLabel = `No schedules this month (${now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })})`;
            } else if (query) {
                emptyLabel = 'No schedules match your search';
            } else {
                const yearLabel = yearFilter === 'all' ? 'any year' : yearFilter;
                const monthLabel = monthFilter === 'all'
                    ? 'any month'
                    : monthNames[parseInt(monthFilter, 10) - 1];
                emptyLabel = `No schedules for ${monthLabel}${yearFilter === 'all' ? '' : ' ' + yearLabel}`;
            }

            historyList.innerHTML = `
                <div class="history-empty">
                    <i class="fas fa-folder-open"></i>
                    ${escapeHtml(emptyLabel)}.<br>
                    <span style="font-size:0.72rem; color:#cbd5e1; margin-top:4px; display:inline-block;">
                        Try choosing a different year or month.
                    </span>
                </div>
            `;
            clearAllHistoryBtn.style.display = all.length > 0 ? 'inline-flex' : 'none';
            return;
        }

        let html = '';
        filtered.forEach(s => {
            const dateObj = getDateFromKey(s.dateKey);
            const dateLabel = dateObj.toLocaleDateString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
            });
            const addedLabel = s.createdAt ? formatDateTime(s.createdAt) : '—';
            const st = normalizeStatus(s.status);
            const stIcon = getStatusIcon(st);
            const statusPill = st === 'done'
                ? `<span class="status-pill-inline done"><i class="fas fa-check-circle"></i> Done</span>`
                : st === 'priority'
                ? `<span class="status-pill-inline priority"><i class="fas fa-star"></i> Priority</span>`
                : '';

            html += `
                <div class="history-schedule-item">
                    <div class="hs-accent"></div>
                    <div class="hs-body">
                        <div class="hs-title"><i class="fas ${stIcon} schedule-status-icon ${st}" style="margin-right:6px;"></i><span class="schedule-title-highlight ${st}">${escapeHtml(s.title)}</span></div>
                        ${s.type ? renderTypeBadge(s.type) : ''}
                        ${statusPill}
                        ${s.time ? `<div class="hs-desc" style="color:#6d28d9; font-weight:600;"><i class="fas fa-clock" style="font-size:0.6rem;"></i> ${escapeHtml(s.time)}</div>` : ''}
                        ${s.description ? `<div class="hs-desc">${escapeHtml(s.description)}</div>` : ''}
                        <div class="hs-desc" style="font-size:0.65rem; color:#94a3b8; margin-top:2px;">
                            <i class="fas fa-calendar-day" style="font-size:0.6rem;"></i> ${escapeHtml(dateLabel)}
                            &nbsp;·&nbsp;
                            <i class="fas fa-clock" style="font-size:0.6rem;"></i> Added ${escapeHtml(addedLabel)}
                        </div>
                    </div>
                    <div class="hs-actions">
                        <button class="icon-btn view" data-history-action="view" data-date="${s.dateKey}" data-id="${s.id}" title="View"><i class="fas fa-eye"></i></button>
                        <button class="icon-btn edit" data-history-action="edit" data-date="${s.dateKey}" data-id="${s.id}" title="Edit"><i class="fas fa-pen"></i></button>
                        <button class="icon-btn delete" data-history-action="delete" data-date="${s.dateKey}" data-id="${s.id}" title="Move to recycle bin"><i class="fas fa-trash-alt"></i></button>
                    </div>
                </div>
            `;
        });

        historyList.innerHTML = html;
        clearAllHistoryBtn.style.display = all.length > 0 ? 'inline-flex' : 'none';

        historyList.querySelectorAll('[data-history-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.historyAction;
                const dateKey = btn.dataset.date;
                const id = btn.dataset.id;
                if (!dateKey || !id) return;

                if (action === 'view') { closeHistoryModal(); openViewModal(dateKey, id, true); }
                else if (action === 'edit') { closeHistoryModal(); openEditFormModal(dateKey, id, true); }
                else if (action === 'delete') { deleteScheduleFromList(dateKey, id); }
            });
        });
    }

    function openHistoryModal() {
        historySearch.value = '';
        const now = new Date();
        historyYearFilter.value = String(now.getFullYear());
        historyMonthFilter.value = String(now.getMonth() + 1);

        renderHistory();
        historyOverlay.classList.add('active');
    }

    function closeHistoryModal() {
        historyOverlay.classList.remove('active');
        closeSortPopovers();
    }

    function clearAllHistory() {
        const all = getAllSchedulesFlat();
        if (all.length === 0) return;

        openConfirmModal({
            title: 'Move ALL schedules to Recycle Bin?',
            message: `${all.length} schedule${all.length === 1 ? '' : 's'} will be moved to the Recycle Bin.`,
            okText: 'Move All to Bin',
            iconClass: 'warning',
            onConfirm: () => {
                Object.keys(schedules).forEach(dateKey => {
                    (schedules[dateKey] || []).forEach(s => {
                        s.dateKey = dateKey;
                        s.deletedAt = new Date().toISOString();
                        trash.push(s);
                    });
                });
                schedules = {};
                dayListSelection.clear();
                scheduleSave();

                renderCalendar();
                renderNotifications();
                closeHistoryModal();
                if (dayListOverlay.classList.contains('active')) closeDayListModal();
            }
        });
    }

    // ============================================================
    // SETTINGS + TRASH
    // ============================================================
    function openSettingsModal() { settingsOverlay.classList.add('active'); }
    function closeSettingsModal() { settingsOverlay.classList.remove('active'); }

    function openTrashModal() {
        trashSelection.clear();
        renderTrash();
        trashOverlay.classList.add('active');
    }
    function closeTrashModal() {
        trashOverlay.classList.remove('active');
        trashSelection.clear();
        closeSortPopovers();
    }

    function updateTrashBulkButtons() {
        const hasSelection = trashSelection.size > 0;
        trashRecoverSelectedBtn.disabled = !hasSelection;
        trashDeleteSelectedBtn.disabled = !hasSelection;

        const total = trash.length;
        const selected = trashSelection.size;
        if (total === 0) {
            trashSelectAll.checked = false;
            trashSelectAll.indeterminate = false;
            trashSelectAll.disabled = true;
        } else {
            trashSelectAll.disabled = false;
            trashSelectAll.checked = selected === total;
            trashSelectAll.indeterminate = selected > 0 && selected < total;
        }
    }

    function renderTrash() {
        const validIds = new Set(trash.map(t => t.id));
        Array.from(trashSelection).forEach(id => {
            if (!validIds.has(id)) trashSelection.delete(id);
        });

        updateSortIcon(trashSortBtn, trashSort);
        syncSortPopover(trashSortPopover, trashSort);

        if (trash.length === 0) {
            trashList.innerHTML = `
                <div class="trash-empty">
                    <i class="fas fa-trash-can"></i>
                    Recycle Bin is empty.<br>Deleted schedules will appear here.
                </div>
            `;
            emptyTrashBtn.style.display = 'none';
            updateTrashBulkButtons();
            return;
        }

        emptyTrashBtn.style.display = 'inline-flex';
        const sorted = applySort(trash, trashSort);

        let html = '';
        sorted.forEach(t => {
            const isChecked = trashSelection.has(t.id);
            const dateObj = getDateFromKey(t.dateKey || formatDateKey(new Date()));
            const dateLabel = dateObj.toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric'
            });

            html += `
                <div class="trash-item" data-trash-id="${t.id}">
                    <input type="checkbox" class="trash-checkbox" data-trash-id="${t.id}" ${isChecked ? 'checked' : ''}>
                    <div class="ti-body">
                        <div class="ti-title">${escapeHtml(t.title)}</div>
                        ${t.type ? renderTypeBadge(t.type) : ''}
                        ${t.time ? `<div class="ti-desc" style="color:#6d28d9; font-weight:600;"><i class="fas fa-clock" style="font-size:0.6rem;"></i> ${escapeHtml(t.time)}</div>` : ''}
                        ${t.description ? `<div class="ti-desc">${escapeHtml(t.description)}</div>` : ''}
                        <div class="ti-meta">
                            <span><i class="fas fa-calendar-day"></i> ${dateLabel}</span>
                            <span><i class="fas fa-clock"></i> Deleted ${formatDateTime(t.deletedAt)}</span>
                        </div>
                    </div>
                    <div class="ti-actions">
                        <button class="icon-btn view" data-trash-action="view" data-trash-id="${t.id}" title="View details"><i class="fas fa-eye"></i></button>
                        <button class="icon-btn recover" data-trash-action="recover" data-trash-id="${t.id}" title="Recover"><i class="fas fa-undo-alt"></i></button>
                        <button class="icon-btn delete" data-trash-action="delete" data-trash-id="${t.id}" title="Delete permanently"><i class="fas fa-trash-alt"></i></button>
                    </div>
                </div>
            `;
        });

        trashList.innerHTML = html;

        trashList.querySelectorAll('.trash-checkbox').forEach(cb => {
            cb.addEventListener('change', () => {
                const id = cb.dataset.trashId;
                if (cb.checked) trashSelection.add(id);
                else trashSelection.delete(id);
                updateTrashBulkButtons();
            });
        });

        trashList.querySelectorAll('[data-trash-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.trashAction;
                const id = btn.dataset.trashId;
                if (!id) return;
                if (action === 'view') openTrashViewModal(id);
                else if (action === 'recover') recoverOne(id);
                else if (action === 'delete') deleteOnePermanently(id);
            });
        });

        updateTrashBulkButtons();
    }

    function recoverOne(id) {
        const idx = trash.findIndex(t => t.id === id);
        if (idx === -1) return;
        const [item] = trash.splice(idx, 1);
        const key = item.dateKey || formatDateKey(new Date());
        delete item.dateKey;
        delete item.deletedAt;
        if (!schedules[key]) schedules[key] = [];
        schedules[key].push(item);
        scheduleSave();

        renderCalendar();
        renderNotifications();
        renderTrash();
        if (historyOverlay.classList.contains('active')) renderHistory();
        if (viewContext.kind === 'trash' && viewContext.trashId === id) closeViewModal();
    }

    function deleteOnePermanently(id) {
        const item = trash.find(t => t.id === id);
        if (!item) return;
        openConfirmModal({
            title: 'Delete permanently?',
            message: `"${item.title}" will be permanently deleted. This action cannot be undone.`,
            okText: 'Delete Forever',
            iconClass: 'danger',
            onConfirm: () => {
                trash = trash.filter(t => t.id !== id);
                scheduleSave();
                renderTrash();
                if (viewContext.kind === 'trash' && viewContext.trashId === id) closeViewModal();
            }
        });
    }

    function recoverSelected() {
        if (trashSelection.size === 0) return;
        const ids = Array.from(trashSelection);
        ids.forEach(id => {
            const idx = trash.findIndex(t => t.id === id);
            if (idx === -1) return;
            const [item] = trash.splice(idx, 1);
            const key = item.dateKey || formatDateKey(new Date());
            delete item.dateKey;
            delete item.deletedAt;
            if (!schedules[key]) schedules[key] = [];
            schedules[key].push(item);
        });
        trashSelection.clear();
        scheduleSave();
        renderCalendar();
        renderNotifications();
        renderTrash();
        if (historyOverlay.classList.contains('active')) renderHistory();
    }

    function deleteSelectedPermanently() {
        if (trashSelection.size === 0) return;
        const count = trashSelection.size;
        openConfirmModal({
            title: `Delete ${count} schedule${count === 1 ? '' : 's'} permanently?`,
            message: 'The selected schedules will be permanently deleted. This action cannot be undone.',
            okText: 'Delete Forever',
            iconClass: 'danger',
            onConfirm: () => {
                trash = trash.filter(t => !trashSelection.has(t.id));
                trashSelection.clear();
                scheduleSave();
                renderTrash();
                if (viewContext.kind === 'trash' && viewContext.trashId && !trash.some(t => t.id === viewContext.trashId)) {
                    closeViewModal();
                }
            }
        });
    }

    function emptyTrash() {
        if (trash.length === 0) return;
        const count = trash.length;
        openConfirmModal({
            title: 'Empty Recycle Bin?',
            message: `All ${count} deleted schedule${count === 1 ? '' : 's'} will be permanently deleted. This action cannot be undone.`,
            okText: 'Empty Bin',
            iconClass: 'danger',
            onConfirm: () => {
                trash = [];
                scheduleSave();
                renderTrash();
                if (viewContext.kind === 'trash') closeViewModal();
            }
        });
    }

    // ============================================================
    // SORT POPOVERS (history / trash)
    // ============================================================
    function closeSortPopovers() {
        [historySortPopover, trashSortPopover].forEach(p => p.classList.remove('open'));
        [historySortBtn, trashSortBtn].forEach(b => {
            b.classList.remove('active');
            b.setAttribute('aria-expanded', 'false');
        });
    }

    function toggleSortPopover(popover, btn) {
        const willOpen = !popover.classList.contains('open');
        closeSortPopovers();
        if (willOpen) {
            popover.classList.add('open');
            btn.classList.add('active');
            btn.setAttribute('aria-expanded', 'true');
        }
    }

    function wireSortPopover(popover, sortRef, onChange) {
        popover.querySelectorAll('[data-sort-kind]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const kind = btn.dataset.sortKind;
                if (!kind) return;
                sortRef.kind = kind;
                syncSortPopover(popover, sortRef);
                onChange();
                closeSortPopovers();
            });
        });

        popover.querySelectorAll('[data-sort-order]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const order = btn.dataset.sortOrder;
                if (!order) return;
                sortRef.order = order;
                syncSortPopover(popover, sortRef);
                onChange();
                closeSortPopovers();
            });
        });
    }

    // ============================================================
    // EXPORT
    // ============================================================
    const MONTH_NAMES_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const EXPORT_START_YEAR = 2025;

    let exportSelectedYears = new Set();
    let exportSelectedMonths = new Set();

    const exportOverlay = document.getElementById('exportOverlay');
    const exportYearChips = document.getElementById('exportYearChips');
    const exportMonthChips = document.getElementById('exportMonthChips');
    const exportPreviewSummary = document.getElementById('exportPreviewSummary');
    const exportPreviewCount = document.getElementById('exportPreviewCount');
    const exportPreviewScroll = document.getElementById('exportPreviewScroll');
    const exportCancelBtn = document.getElementById('exportCancelBtn');
    const exportDownloadBtn = document.getElementById('exportDownloadBtn');
    const exportYearsAll = document.getElementById('exportYearsAll');
    const exportYearsNone = document.getElementById('exportYearsNone');
    const exportMonthsAll = document.getElementById('exportMonthsAll');
    const exportMonthsNone = document.getElementById('exportMonthsNone');

    function getExportYearRange() {
        const currentYear = new Date().getFullYear();
        const end = Math.max(currentYear, EXPORT_START_YEAR);
        const years = [];
        for (let y = EXPORT_START_YEAR; y <= end; y++) years.push(y);
        return years;
    }

    function getYearFromDateKey(dateKey) { return parseInt(dateKey.split('-')[0], 10); }
    function getMonthFromDateKey(dateKey) { return parseInt(dateKey.split('-')[1], 10); }

    function getFilteredExportRows() {
        const rows = [];
        Object.keys(schedules).forEach(dateKey => {
            const y = getYearFromDateKey(dateKey);
            const m = getMonthFromDateKey(dateKey);
            if (!exportSelectedYears.has(y)) return;
            if (!exportSelectedMonths.has(m)) return;

            (schedules[dateKey] || []).forEach(s => {
                rows.push({
                    dateKey,
                    title: s.title,
                    type: s.type || '',
                    status: normalizeStatus(s.status),
                    description: s.description || '',
                    time: s.time || '',
                    lateMarked: !!s.lateMarked
                });
            });
        });
        rows.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
        return rows;
    }

    function renderExportChips() {
        const years = getExportYearRange();
        exportYearChips.innerHTML = '';
        years.forEach(y => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'export-chip' + (exportSelectedYears.has(y) ? ' selected' : '');
            btn.innerHTML = `<i class="fas fa-check"></i> ${y}`;
            btn.addEventListener('click', () => {
                if (exportSelectedYears.has(y)) exportSelectedYears.delete(y);
                else exportSelectedYears.add(y);
                renderExportChips();
                renderExportPreview();
            });
            exportYearChips.appendChild(btn);
        });

        exportMonthChips.innerHTML = '';
        MONTH_NAMES_FULL.forEach((name, idx) => {
            const m = idx + 1;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'export-chip' + (exportSelectedMonths.has(m) ? ' selected' : '');
            btn.innerHTML = `<i class="fas fa-check"></i> ${name}`;
            btn.addEventListener('click', () => {
                if (exportSelectedMonths.has(m)) exportSelectedMonths.delete(m);
                else exportSelectedMonths.add(m);
                renderExportChips();
                renderExportPreview();
            });
            exportMonthChips.appendChild(btn);
        });
    }

    function renderExportPreview() {
        const rows = getFilteredExportRows();
        exportPreviewCount.textContent = `${rows.length} row${rows.length === 1 ? '' : 's'}`;

        const yearList = Array.from(exportSelectedYears).sort();
        const monthList = Array.from(exportSelectedMonths).sort((a, b) => a - b)
            .map(m => MONTH_NAMES_FULL[m - 1]);

        const yearLabel = yearList.length === 0 ? 'No years selected'
            : yearList.length === getExportYearRange().length ? 'All years'
            : yearList.join(', ');

        const monthLabel = monthList.length === 0 ? 'No months selected'
            : monthList.length === 12 ? 'All months'
            : monthList.join(', ');

        exportPreviewSummary.innerHTML = `
            <span><i class="fas fa-filter"></i> <strong>${yearLabel}</strong></span>
            <span>·</span>
            <span><i class="fas fa-calendar"></i> <strong>${monthLabel}</strong></span>
        `;

        if (rows.length === 0) {
            exportPreviewScroll.innerHTML = `
                <div class="export-preview-empty">
                    <i class="fas fa-inbox"></i>
                    No schedules match the selected filters.
                </div>
            `;
            exportDownloadBtn.disabled = true;
            return;
        }

        exportDownloadBtn.disabled = false;

        let html = `
            <table class="export-preview-table">
                <thead>
                    <tr>
                        <th>Month</th>
                        <th>Day</th>
                        <th>Year</th>
                        <th>Title</th>
                        <th>Time</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Late</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
        `;

        rows.forEach(r => {
            const dateObj = getDateFromKey(r.dateKey);
            const monthLabel = MONTH_NAMES_FULL[dateObj.getMonth()];
            const lateCell = r.lateMarked
                ? `<span style="color:#dc2626; font-weight:700;">Yes</span>`
                : `<span style="color:#cbd5e1;">No</span>`;
            html += `
                <tr>
                    <td class="ep-date">${monthLabel}</td>
                    <td class="ep-date">${dateObj.getDate()}</td>
                    <td class="ep-date">${dateObj.getFullYear()}</td>
                    <td class="ep-title">${escapeHtml(r.title)}</td>
                    <td class="ep-date">${r.time ? escapeHtml(r.time) : '<span style="color:#cbd5e1;">—</span>'}</td>
                    <td class="ep-type">${r.type ? escapeHtml(r.type) : '<span style="color:#94a3b8;">—</span>'}</td>
                    <td class="ep-type">${escapeHtml(getStatusLabel(r.status))}</td>
                    <td class="ep-type">${lateCell}</td>
                    <td class="ep-desc">${r.description ? escapeHtml(r.description) : '<span style="color:#cbd5e1;">No description</span>'}</td>
                </tr>
            `;
        });

        html += '</tbody></table>';
        exportPreviewScroll.innerHTML = html;
    }

    function openExportModal() {
        exportSelectedYears = new Set(getExportYearRange());
        exportSelectedMonths = new Set([1,2,3,4,5,6,7,8,9,10,11,12]);
        renderExportChips();
        renderExportPreview();
        exportOverlay.classList.add('active');
    }

    function closeExportModal() {
        exportOverlay.classList.remove('active');
    }

    function downloadExcelFile() {
        if (typeof XLSX === 'undefined') {
            alert('Excel library not loaded. Please check your internet connection and reload.');
            return;
        }

        const rows = getFilteredExportRows();
        if (rows.length === 0) return;

        const sheetData = [
            ['Month', 'Day', 'Year', 'Title', 'Time', 'Type', 'Status', 'Late', 'Description']
        ];
        rows.forEach(r => {
            const dateObj = getDateFromKey(r.dateKey);
            sheetData.push([
                dateObj.getMonth() + 1,
                dateObj.getDate(),
                dateObj.getFullYear(),
                r.title,
                r.time,
                r.type,
                getStatusLabel(r.status),
                r.lateMarked ? 'Yes' : 'No',
                r.description
            ]);
        });

        const ws = XLSX.utils.aoa_to_sheet(sheetData);
        ws['!cols'] = [
            { wch: 8 }, { wch: 6 }, { wch: 8 },
            { wch: 30 }, { wch: 20 }, { wch: 16 }, { wch: 14 }, { wch: 8 }, { wch: 55 }
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Schedules');

        const today = formatDateKey(new Date());
        XLSX.writeFile(wb, `schedules_${today}.xlsx`);
        closeExportModal();
    }

    exportCancelBtn.addEventListener('click', closeExportModal);
    exportDownloadBtn.addEventListener('click', downloadExcelFile);
    exportOverlay.addEventListener('click', (e) => {
        if (e.target === exportOverlay) closeExportModal();
    });

    exportYearsAll.addEventListener('click', () => {
        exportSelectedYears = new Set(getExportYearRange());
        renderExportChips();
        renderExportPreview();
    });
    exportYearsNone.addEventListener('click', () => {
        exportSelectedYears.clear();
        renderExportChips();
        renderExportPreview();
    });
    exportMonthsAll.addEventListener('click', () => {
        exportSelectedMonths = new Set([1,2,3,4,5,6,7,8,9,10,11,12]);
        renderExportChips();
        renderExportPreview();
    });
    exportMonthsNone.addEventListener('click', () => {
        exportSelectedMonths.clear();
        renderExportChips();
        renderExportPreview();
    });

    // ============================================================
    // IMPORT
    // ============================================================
    const importOverlay = document.getElementById('importOverlay');
    const importStatus = document.getElementById('importStatus');
    const importFileName = document.getElementById('importFileName');
    const downloadTemplateBtn = document.getElementById('downloadTemplateBtn');
    const importUploadBtn = document.getElementById('importUploadBtn');
    const importExcelInput = document.getElementById('importExcelInput');
    const importCancelBtn = document.getElementById('importCancelBtn');
    const importConfirmBtn = document.getElementById('importConfirmBtn');

    const importSuccessOverlay = document.getElementById('importSuccessOverlay');
    const importSuccessIcon = document.getElementById('importSuccessIcon');
    const importSuccessTitle = document.getElementById('importSuccessTitle');
    const importSuccessMessage = document.getElementById('importSuccessMessage');
    const importSuccessCount = document.getElementById('importSuccessCount');
    const importSuccessCountLabel = document.getElementById('importSuccessCountLabel');
    const importSuccessDates = document.getElementById('importSuccessDates');
    const importSuccessDatesList = document.getElementById('importSuccessDatesList');
    const importSuccessCloseBtn = document.getElementById('importSuccessCloseBtn');
    const importSuccessViewBtn = document.getElementById('importSuccessViewBtn');

    const IMPORT_REQUIRED_HEADERS = ['Month', 'Day', 'Year', 'Title', 'Type', 'Status', 'Description'];
    const IMPORT_MAX_TITLE_LEN = 60;
    const IMPORT_MAX_DESC_LEN = 200;

    const IMPORT_HISTORY_KEY = 'schedule_import_history_v1';

    function loadImportHistory() {
        try {
            const raw = localStorage.getItem(IMPORT_HISTORY_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch { return []; }
    }

    function saveImportHistory(history) {
        try { localStorage.setItem(IMPORT_HISTORY_KEY, JSON.stringify(history.slice(-30))); } catch {}
    }

    function computeFileSignature(file) {
        return `${file.name}|${file.size}|${file.lastModified || 0}`;
    }

    function isDuplicateImport(file) {
        const history = loadImportHistory();
        const sig = computeFileSignature(file);
        return history.includes(sig);
    }

    function recordImportSignature(file) {
        const history = loadImportHistory();
        const sig = computeFileSignature(file);
        if (!history.includes(sig)) {
            history.push(sig);
            saveImportHistory(history);
        }
    }

    let importParsedRows = null;
    let currentImportFile = null;

    function openImportModal() {
        importParsedRows = null;
        currentImportFile = null;
        importExcelInput.value = '';
        importFileName.textContent = 'No file selected';
        importStatus.style.display = 'none';
        importStatus.innerHTML = '';
        importStatus.className = 'import-status';
        importConfirmBtn.disabled = true;
        importOverlay.classList.add('active');
    }

    function closeImportModal() {
        importOverlay.classList.remove('active');
        importParsedRows = null;
        currentImportFile = null;
        importExcelInput.value = '';
        importFileName.textContent = 'No file selected';
        importStatus.style.display = 'none';
        importStatus.innerHTML = '';
        importStatus.className = 'import-status';
        importConfirmBtn.disabled = true;
    }

    function commitImport() {
        if (!importParsedRows || importParsedRows.length === 0) return;

        let added = 0;
        const now = new Date().toISOString();
        const perDateCounts = {};

        importParsedRows.forEach(r => {
            const dateKey = r.dateKey;
            if (!schedules[dateKey]) schedules[dateKey] = [];
            schedules[dateKey].push({
                id: uid(),
                title: r.title,
                description: r.description,
                type: r.type,
                time: r.time || '',
                status: normalizeStatus(r.status),
                lateMarked: !!r.lateMarked,
                createdAt: now
            });
            added++;
            perDateCounts[dateKey] = (perDateCounts[dateKey] || 0) + 1;
        });

        if (currentImportFile) {
            recordImportSignature(currentImportFile);
        }
        recordRecentImport(currentImportFile ? currentImportFile.name : 'Imported file', added);

        scheduleSave();
        renderCalendar();
        renderNotifications();
        if (historyOverlay.classList.contains('active')) renderHistory();

        closeImportModal();
        showImportSuccessModal(added, perDateCounts);
    }

    function showImportSuccessModal(added, perDateCounts) {
        importSuccessCount.textContent = String(added);
        importSuccessCountLabel.textContent = added === 1 ? 'schedule added' : 'schedules added';

        importSuccessMessage.textContent = added === 1
            ? 'Your schedule was imported successfully and is now on your calendar.'
            : `All ${added} schedules were imported successfully and are now on your calendar.`;

        const dateKeys = Object.keys(perDateCounts).sort();
        if (dateKeys.length > 0) {
            importSuccessDates.style.display = 'block';
            importSuccessDatesList.innerHTML = dateKeys.map(dateKey => {
                const d = getDateFromKey(dateKey);
                const label = d.toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric'
                });
                const count = perDateCounts[dateKey];
                return `
                    <li>
                        <span class="succ-date">${escapeHtml(label)}</span>
                        <span class="succ-count">${count} schedule${count === 1 ? '' : 's'}</span>
                    </li>
                `;
            }).join('');
        } else {
            importSuccessDates.style.display = 'none';
            importSuccessDatesList.innerHTML = '';
        }

        importSuccessViewBtn.dataset.firstDate = dateKeys[0] || '';
        importSuccessOverlay.classList.add('active');
    }

    function closeImportSuccessModal() {
        importSuccessOverlay.classList.remove('active');
    }

    if (!importSuccessCloseBtn.dataset.wired) {
        importSuccessCloseBtn.dataset.wired = '1';

        importSuccessCloseBtn.addEventListener('click', closeImportSuccessModal);

        importSuccessViewBtn.addEventListener('click', () => {
            const dateKey = importSuccessViewBtn.dataset.firstDate;
            closeImportSuccessModal();
            if (dateKey) {
                const d = getDateFromKey(dateKey);
                currentYear = d.getFullYear();
                currentMonth = d.getMonth();
                renderCalendar();
                setTimeout(() => openDayListModal(dateKey), 120);
            }
        });

        importSuccessOverlay.addEventListener('click', (e) => {
            if (e.target === importSuccessOverlay) closeImportSuccessModal();
        });
    }

    function downloadImportTemplate() {
        if (typeof XLSX === 'undefined') {
            alert('Excel library not loaded. Please reload the page.');
            return;
        }

        const templateData = [
            ['Month', 'Day', 'Year', 'Title', 'Time', 'Type', 'Status', 'Late', 'Description'],
            [12, 8, 2025, 'Team Meeting', '09:00 AM – 10:00 AM', 'Meeting', 'Upcoming', 'No', 'Weekly sync with the team'],
            [12, 15, 2025, 'Year-end Seminar', '01:00 PM – 03:00 PM', 'Seminar', 'Priority', 'No', 'Annual review and planning'],
            [1, 10, 2026, 'New Year Event', '06:00 PM – 09:00 PM', 'Special Event', 'Upcoming', 'No', 'Company kickoff celebration'],
            [1, 20, 2026, 'Project Done', '10:00 AM – 11:00 AM', 'Meeting', 'Done', 'No', 'Quarterly wrap-up'],
            [2, 14, 2026, 'Missed Check-in', '08:00 AM – 09:00 AM', 'Meeting', 'Upcoming', 'Yes', 'Was not marked done in time']
        ];

        const ws = XLSX.utils.aoa_to_sheet(templateData);
        ws['!cols'] = [
            { wch: 8 }, { wch: 6 }, { wch: 8 },
            { wch: 28 }, { wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 8 }, { wch: 50 }
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Schedules Template');
        XLSX.writeFile(wb, 'schedule_import_template.xlsx');
    }

    function parseMonthCell(v) {
        if (v == null) return null;
        const s = String(v).trim();
        if (!s) return null;
        if (/^\d+$/.test(s)) {
            const n = parseInt(s, 10);
            return (n >= 1 && n <= 12) ? n : null;
        }
        const lower = s.toLowerCase();
        const names = ["january","february","march","april","may","june","july","august","september","october","november","december"];
        for (let i = 0; i < names.length; i++) {
            if (lower === names[i] || lower === names[i].slice(0, 3)) return i + 1;
        }
        return null;
    }

    function parseDayCell(v) {
        if (v == null) return null;
        const s = String(v).trim();
        if (!s) return null;
        if (!/^\d+$/.test(s)) return null;
        const n = parseInt(s, 10);
        return (n >= 1 && n <= 31) ? n : null;
    }

    function parseYearCell(v) {
        if (v == null) return null;
        const s = String(v).trim();
        if (!s) return null;
        if (!/^\d{4}$/.test(s)) return null;
        return parseInt(s, 10);
    }

    function normalizeStatusLabel(s) {
        const v = String(s || '').trim().toLowerCase();
        if (v === 'done') return 'done';
        if (v === 'priority' || v === 'star') return 'priority';
        if (v === 'upcoming' || v === 'process') return 'upcoming';
        return 'upcoming';
    }

    function validateImportRow(row, rowNumber) {
        const errors = [];

        const monthNum = parseMonthCell(row.month);
        const dayNum = parseDayCell(row.day);
        const yearNum = parseYearCell(row.year);
        const titleStr = row.title != null ? String(row.title).trim() : '';
        const typeStr = row.type != null ? String(row.type).trim() : '';
        const statusStr = row.status != null ? String(row.status).trim() : '';
        const descStr = row.description != null ? String(row.description).trim() : '';
        const timeStr = row.time != null ? String(row.time).trim() : '';
        const lateStr = row.late != null ? String(row.late).trim().toLowerCase() : '';

        if (
            (row.month == null || String(row.month).trim() === '') &&
            (row.day == null || String(row.day).trim() === '') &&
            (row.year == null || String(row.year).trim() === '') &&
            !titleStr && !typeStr && !statusStr && !descStr && !timeStr
        ) {
            return { skip: true, errors: [] };
        }

        if (row.month == null || String(row.month).trim() === '') {
            errors.push(`Row ${rowNumber}: Month is required.`);
        } else if (monthNum == null) {
            errors.push(`Row ${rowNumber}: Month must be 1–12 or a month name (got "${row.month}").`);
        }

        if (row.day == null || String(row.day).trim() === '') {
            errors.push(`Row ${rowNumber}: Day is required.`);
        } else if (dayNum == null) {
            errors.push(`Row ${rowNumber}: Day must be a number between 1 and 31 (got "${row.day}").`);
        }

        if (row.year == null || String(row.year).trim() === '') {
            errors.push(`Row ${rowNumber}: Year is required.`);
        } else if (yearNum == null) {
            errors.push(`Row ${rowNumber}: Year must be a 4-digit number (got "${row.year}").`);
        }

        if (monthNum != null && dayNum != null && yearNum != null) {
            const testDate = new Date(yearNum, monthNum - 1, dayNum);
            if (
                testDate.getFullYear() !== yearNum ||
                testDate.getMonth() + 1 !== monthNum ||
                testDate.getDate() !== dayNum
            ) {
                errors.push(`Row ${rowNumber}: ${monthNum}/${dayNum}/${yearNum} is not a real calendar date.`);
            }
        }

        if (!titleStr) {
            errors.push(`Row ${rowNumber}: Title is required.`);
        } else if (titleStr.length > IMPORT_MAX_TITLE_LEN) {
            errors.push(`Row ${rowNumber}: Title exceeds ${IMPORT_MAX_TITLE_LEN} characters.`);
        }

        if (!typeStr) {
            errors.push(`Row ${rowNumber}: Type is required (e.g. Meeting, Seminar, Special Event).`);
        }

        if (!descStr) {
            errors.push(`Row ${rowNumber}: Description is required.`);
        } else if (descStr.length > IMPORT_MAX_DESC_LEN) {
            errors.push(`Row ${rowNumber}: Description exceeds ${IMPORT_MAX_DESC_LEN} characters.`);
        }

        if (errors.length > 0) {
            return { skip: false, errors };
        }

        const dateKey = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
        const lateMarked = lateStr === 'yes' || lateStr === 'true' || lateStr === '1' || lateStr === 'y';

        return {
            skip: false,
            errors: [],
            parsed: {
                dateKey,
                title: titleStr,
                type: typeStr,
                status: normalizeStatusLabel(statusStr),
                description: descStr,
                time: timeStr,
                lateMarked
            }
        };
    }

    function parseImportWorkbook(wb) {
        const errors = [];
        const rows = [];

        if (!wb.SheetNames || wb.SheetNames.length === 0) {
            return { rows, errors: ['The Excel file has no sheets.'] };
        }

        const sheet = wb.Sheets[wb.SheetNames[0]];
        const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });

        if (!grid || grid.length === 0) {
            return { rows, errors: ['The first sheet is empty.'] };
        }

        const header = (grid[0] || []).map(h => String(h).trim());
        const REQUIRED = ['Month', 'Day', 'Year', 'Title', 'Type', 'Status', 'Description'];

        const colIndex = {};
        header.forEach((h, i) => { if (h) colIndex[h] = i; });

        const headerErrors = [];
        REQUIRED.forEach(name => {
            if (colIndex[name] === undefined) {
                headerErrors.push(`Missing required column "${name}".`);
            }
        });

        if (headerErrors.length > 0) {
            return { rows, errors: ['The header row does not match the template.', ...headerErrors] };
        }

        for (let i = 1; i < grid.length; i++) {
            const raw = grid[i] || [];
            const rowNumber = i + 1;

            const get = (name) => {
                const idx = colIndex[name];
                return idx === undefined ? '' : raw[idx];
            };

            const row = {
                month: get('Month'),
                day: get('Day'),
                year: get('Year'),
                title: get('Title'),
                time: get('Time'),
                type: get('Type'),
                status: get('Status'),
                late: get('Late'),
                description: get('Description')
            };

            const result = validateImportRow(row, rowNumber);
            if (result.skip) continue;
            if (result.errors.length > 0) errors.push(...result.errors);
            else rows.push(result.parsed);
        }

        return { rows, errors };
    }

    function wireInPreviewButtons() {
        const previewCancel = document.getElementById('importPreviewCancelBtn');
        const previewConfirm = document.getElementById('importPreviewConfirmBtn');
        if (previewCancel) previewCancel.addEventListener('click', closeImportModal);
        if (previewConfirm) previewConfirm.addEventListener('click', commitImport);
    }

    function renderImportStatus(result) {
        importStatus.style.display = 'block';

        if (result.errors.length > 0) {
            importStatus.className = 'import-status error';
            const shown = result.errors.slice(0, 20);
            const extra = result.errors.length - shown.length;
            importStatus.innerHTML = `
                <div class="import-status-title">
                    <i class="fas fa-times-circle"></i>
                    Import rejected — ${result.errors.length} problem${result.errors.length === 1 ? '' : 's'} found
                </div>
                <div class="import-status-detail">
                    Nothing will be imported. Please fix the file and try again, or download the template.
                </div>
                <ul class="import-error-list">
                    ${shown.map(e => `<li><i class="fas fa-exclamation-circle"></i> ${escapeHtml(e)}</li>`).join('')}
                    ${extra > 0 ? `<li><i class="fas fa-ellipsis-h"></i> …and ${extra} more problem${extra === 1 ? '' : 's'}.</li>` : ''}
                </ul>
                <div class="import-preview-actions">
                    <button type="button" class="btn btn-secondary btn-sm" id="importPreviewCancelBtn">
                        <i class="fas fa-times"></i> Cancel &amp; Clear File
                    </button>
                    <button type="button" class="btn btn-primary btn-sm" disabled>
                        <i class="fas fa-file-import"></i> Import
                    </button>
                </div>
            `;
            importConfirmBtn.disabled = true;
            importParsedRows = null;
            wireInPreviewButtons();
            return;
        }

        if (result.rows.length === 0) {
            importStatus.className = 'import-status error';
            importStatus.innerHTML = `
                <div class="import-status-title">
                    <i class="fas fa-info-circle"></i>
                    No data to import
                </div>
                <div class="import-status-detail">
                    The file doesn't contain any rows with schedules.
                </div>
                <div class="import-preview-actions">
                    <button type="button" class="btn btn-secondary btn-sm" id="importPreviewCancelBtn">
                        <i class="fas fa-times"></i> Cancel &amp; Clear File
                    </button>
                </div>
            `;
            importConfirmBtn.disabled = true;
            importParsedRows = null;
            wireInPreviewButtons();
            return;
        }

        importStatus.className = 'import-status success';
        const shown = result.rows.slice(0, 15);
        const extra = result.rows.length - shown.length;

        importStatus.innerHTML = `
            <div class="import-status-title">
                <i class="fas fa-check-circle"></i>
                Ready to import ${result.rows.length} schedule${result.rows.length === 1 ? '' : 's'}
            </div>
            <div class="import-status-detail">
                The file is valid. Preview below — click <strong>Confirm Import</strong> to save to your calendar.
            </div>
            <ul class="import-preview-list">
                ${shown.map(r => `
                    <li>
                        <span class="imp-date">${escapeHtml(r.dateKey)}</span>
                        <span>
                            <strong>${escapeHtml(r.title)}</strong>
                            <span class="imp-type">· ${escapeHtml(r.type)}</span>
                            ${r.lateMarked ? `<span class="imp-late-pill">Late</span>` : ''}
                        </span>
                    </li>
                `).join('')}
                ${extra > 0 ? `<li><i class="fas fa-ellipsis-h"></i> …and ${extra} more row${extra === 1 ? '' : 's'}.</li>` : ''}
            </ul>
            <div class="import-preview-actions">
                <button type="button" class="btn btn-secondary btn-sm" id="importPreviewCancelBtn">
                    <i class="fas fa-times"></i> Cancel &amp; Clear File
                </button>
                <button type="button" class="btn btn-primary btn-sm" id="importPreviewConfirmBtn">
                    <i class="fas fa-check"></i> Confirm Import
                </button>
            </div>
        `;
        importConfirmBtn.disabled = false;
        importParsedRows = result.rows;
        wireInPreviewButtons();
    }

    function handleImportFile(file) {
        if (!file) return;

        if (isDuplicateImport(file)) {
            importStatus.style.display = 'block';
            importStatus.className = 'import-status error';
            importStatus.innerHTML = `
                <div class="import-status-title">
                    <i class="fas fa-exclamation-triangle"></i>
                    Already imported
                </div>
                <div class="import-status-detail">
                    This file was already imported before. To avoid duplicates, the same file cannot be imported twice.<br>
                    If you made changes, save the Excel file again (its size or modified time will change) and re-upload.
                </div>
                <div class="import-preview-actions">
                    <button type="button" class="btn btn-secondary btn-sm" id="importPreviewCancelBtn">
                        <i class="fas fa-times"></i> Cancel &amp; Clear File
                    </button>
                </div>
            `;
            importConfirmBtn.disabled = true;
            importParsedRows = null;
            currentImportFile = null;
            importFileName.textContent = file.name;
            wireInPreviewButtons();
            return;
        }

        if (!/\.xlsx$/i.test(file.name)) {
            importStatus.style.display = 'block';
            importStatus.className = 'import-status error';
            importStatus.innerHTML = `
                <div class="import-status-title">
                    <i class="fas fa-times-circle"></i>
                    Invalid file type
                </div>
                <div class="import-status-detail">
                    Please upload a <strong>.xlsx</strong> Excel file. Older <code>.xls</code> and <code>.csv</code> are not supported.
                </div>
                <div class="import-preview-actions">
                    <button type="button" class="btn btn-secondary btn-sm" id="importPreviewCancelBtn">
                        <i class="fas fa-times"></i> Cancel &amp; Clear File
                    </button>
                </div>
            `;
            importConfirmBtn.disabled = true;
            importParsedRows = null;
            wireInPreviewButtons();
            return;
        }

        if (typeof XLSX === 'undefined') {
            alert('Excel library not loaded. Please reload the page.');
            return;
        }

        importFileName.textContent = file.name;
        currentImportFile = file;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const wb = XLSX.read(data, { type: 'array', cellDates: false });
                const result = parseImportWorkbook(wb);
                renderImportStatus(result);
            } catch (err) {
                console.error('Parse error:', err);
                importStatus.style.display = 'block';
                importStatus.className = 'import-status error';
                importStatus.innerHTML = `
                    <div class="import-status-title">
                        <i class="fas fa-times-circle"></i>
                        Could not read file
                    </div>
                    <div class="import-status-detail">
                        The file may be corrupted or not a valid Excel file.
                    </div>
                    <div class="import-preview-actions">
                        <button type="button" class="btn btn-secondary btn-sm" id="importPreviewCancelBtn">
                            <i class="fas fa-times"></i> Cancel &amp; Clear File
                        </button>
                    </div>
                `;
                importConfirmBtn.disabled = true;
                importParsedRows = null;
                wireInPreviewButtons();
            }
        };
        reader.onerror = () => alert('Failed to read the file.');
        reader.readAsArrayBuffer(file);
    }

    downloadTemplateBtn.addEventListener('click', downloadImportTemplate);
    importUploadBtn.addEventListener('click', () => importExcelInput.click());
    importExcelInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) handleImportFile(file);
    });
    importCancelBtn.addEventListener('click', closeImportModal);
    importConfirmBtn.addEventListener('click', commitImport);
    importOverlay.addEventListener('click', (e) => {
        if (e.target === importOverlay) closeImportModal();
    });

    // ============================================================
    // CLEAR IMPORT HISTORY
    // ============================================================
    const clearImportHistoryBtn = document.getElementById('clearImportHistoryBtn');
    if (clearImportHistoryBtn) {
        clearImportHistoryBtn.addEventListener('click', () => {
            closeSettingsModal();
            openConfirmModal({
                title: 'Reset Import History?',
                message: 'This will allow files you already imported to be imported again. Your existing schedules will not be deleted.',
                okText: 'Reset',
                iconClass: 'warning',
                onConfirm: () => {
                    try { localStorage.removeItem(IMPORT_HISTORY_KEY); } catch {}
                }
            });
        });
    }

    // ============================================================
    // LOGO → 3D LOADER → REFRESH
    // ============================================================
    const headerLogo = document.getElementById('headerLogo');
    const loaderScreen = document.getElementById('loaderScreen');

    function showLoaderAndReload() {
        if (!loaderScreen) {
            window.location.reload();
            return;
        }

        if (loaderScreen.classList.contains('active')) return;

        loaderScreen.classList.add('active');
        loaderScreen.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';

        setTimeout(() => {
            loaderScreen.classList.remove('active');
            loaderScreen.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
            setTimeout(() => window.location.reload(), 450);
        }, 3000);
    }

    if (headerLogo) {
        headerLogo.addEventListener('click', showLoaderAndReload);
        headerLogo.setAttribute('tabindex', '0');
        headerLogo.setAttribute('role', 'button');
        headerLogo.setAttribute('aria-label', 'Refresh Skedo');
        headerLogo.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                showLoaderAndReload();
            }
        });
    }

    // ============================================================
    // EVENT LISTENERS
    // ============================================================
    prevMonthBtn.addEventListener('click', () => {
        currentMonth--;
        if (currentMonth < 0) { currentMonth = 11; currentYear--; }
        renderCalendar();
    });

    nextMonthBtn.addEventListener('click', () => {
        currentMonth++;
        if (currentMonth > 11) { currentMonth = 0; currentYear++; }
        renderCalendar();
    });

    todayBtn.addEventListener('click', () => {
        const now = new Date();
        currentYear = now.getFullYear();
        currentMonth = now.getMonth();
        renderCalendar();
    });

    monthYearTrigger.addEventListener('click', openDatePickerModal);

    createScheduleBtn.addEventListener('click', () => {
        openCreateFormModal(formatDateKey(new Date()));
    });

    historyBtn.addEventListener('click', openHistoryModal);
    exportBtn.addEventListener('click', openExportModal);
    importBtn.addEventListener('click', openImportModal);

    historySortBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSortPopover(historySortPopover, historySortBtn);
    });
    wireSortPopover(historySortPopover, historySort, () => renderHistory());

    trashSortBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSortPopover(trashSortPopover, trashSortBtn);
    });
    wireSortPopover(trashSortPopover, trashSort, () => renderTrash());

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.sort-wrap')) closeSortPopovers();
    });

    settingsBtn.addEventListener('click', openSettingsModal);
    closeSettingsBtn.addEventListener('click', closeSettingsModal);
    settingsOverlay.addEventListener('click', (e) => {
        if (e.target === settingsOverlay) closeSettingsModal();
    });

    openTrashBtn.addEventListener('click', () => {
        closeSettingsModal();
        openTrashModal();
    });

    logoutBtn.addEventListener('click', () => {
        closeSettingsModal();
        openConfirmModal({
            title: 'Log out?',
            message: 'You will be signed out and your current session data will be cleared on all devices.',
            okText: 'Log Out',
            iconClass: 'warning',
            onConfirm: async () => {
                await clearRemote();
                schedules = {};
                trash = [];

                trashSelection.clear();
                dayListSelection.clear();
                editingScheduleId = null;
                selectedDateKey = null;
                activeDayListDateKey = null;
                reopenHistoryAfterEdit = false;
                pendingSave = null;
                formType = { base: null, custom: '' };
                historySort = { kind: 'date-created', order: 'desc' };
                trashSort = { kind: 'date-created', order: 'desc' };
                viewContext = { kind: 'schedule', trashId: null };

                dayListOverlay.classList.remove('active');
                modalOverlay.classList.remove('active');
                reviewOverlay.classList.remove('active');
                viewOverlay.classList.remove('active');
                viewOverlay.classList.remove('trash-context');
                datePickerOverlay.classList.remove('active');
                historyOverlay.classList.remove('active');
                trashOverlay.classList.remove('active');
                settingsOverlay.classList.remove('active');
                validationOverlay.classList.remove('active');
                closeSortPopovers();
                closeStatusPopup();

                renderCalendar();
                renderNotifications();
                renderRecentImports();
            }
        });
    });

    closeTrashBtn.addEventListener('click', closeTrashModal);
    trashOverlay.addEventListener('click', (e) => {
        if (e.target === trashOverlay) closeTrashModal();
    });

    trashSelectAll.addEventListener('change', () => {
        if (trashSelectAll.checked) {
            trash.forEach(t => trashSelection.add(t.id));
        } else {
            trashSelection.clear();
        }
        trashList.querySelectorAll('.trash-checkbox').forEach(cb => {
            cb.checked = trashSelection.has(cb.dataset.trashId);
        });
        updateTrashBulkButtons();
    });

    trashRecoverSelectedBtn.addEventListener('click', recoverSelected);
    trashDeleteSelectedBtn.addEventListener('click', deleteSelectedPermanently);
    emptyTrashBtn.addEventListener('click', emptyTrash);

    closeViewBtn.addEventListener('click', closeViewModal);
    viewOverlay.addEventListener('click', (e) => {
        if (e.target === viewOverlay) closeViewModal();
    });

    recoverFromViewBtn.addEventListener('click', () => {
        if (viewContext.kind !== 'trash' || !viewContext.trashId) return;
        recoverOne(viewContext.trashId);
    });

    daySelectAll.addEventListener('change', () => {
        if (!activeDayListDateKey) return;
        const daySchedules = schedules[activeDayListDateKey] || [];

        if (daySelectAll.checked) {
            daySchedules.forEach(s => dayListSelection.add(s.id));
        } else {
            dayListSelection.clear();
        }
        dayScheduleList.querySelectorAll('.day-checkbox').forEach(cb => {
            cb.checked = dayListSelection.has(cb.dataset.dayId);
        });
        updateDayListBulkUI();
    });

    dayDeleteSelectedBtn.addEventListener('click', deleteSelectedDaySchedules);

    closeDayListBtn.addEventListener('click', closeDayListModal);
    dayListOverlay.addEventListener('click', (e) => {
        if (e.target === dayListOverlay) closeDayListModal();
    });

    addScheduleFromListBtn.addEventListener('click', () => {
        if (!activeDayListDateKey) return;
        const dateKey = activeDayListDateKey;
        closeDayListModal();
        openCreateFormModal(dateKey);
    });

    cancelModalBtn.addEventListener('click', closeFormModal);
    saveScheduleBtn.addEventListener('click', requestSaveSchedule);
    scheduleDescription.addEventListener('input', updateCharCounter);
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeFormModal();
    });

    scheduleTitle.addEventListener('input', () => {
        scheduleTitle.closest('.field').classList.remove('invalid');
    });
    scheduleDescription.addEventListener('input', () => {
        scheduleDescription.closest('.field').classList.remove('invalid');
    });

    reviewGoBackBtn.addEventListener('click', goBackToForm);
    reviewConfirmBtn.addEventListener('click', confirmSave);
    reviewOverlay.addEventListener('click', (e) => {
        if (e.target === reviewOverlay) goBackToForm();
    });

    pickYear.addEventListener('change', updateDayOptions);
    pickMonth.addEventListener('change', updateDayOptions);
    pickDay.addEventListener('change', updateDatePreview);
    cancelDatePickerBtn.addEventListener('click', closeDatePickerModal);
    goToDateBtn.addEventListener('click', goToPickedDate);
    datePickerOverlay.addEventListener('click', (e) => {
        if (e.target === datePickerOverlay) closeDatePickerModal();
    });

    closeHistoryBtn.addEventListener('click', closeHistoryModal);
    historyOverlay.addEventListener('click', (e) => {
        if (e.target === historyOverlay) closeHistoryModal();
    });
    historySearch.addEventListener('input', renderHistory);
    historyYearFilter.addEventListener('change', renderHistory);
    historyMonthFilter.addEventListener('change', renderHistory);
    clearAllHistoryBtn.addEventListener('click', clearAllHistory);

    const clearRecentImportsBtn = document.getElementById('clearRecentImportsBtn');
    if (clearRecentImportsBtn) {
        clearRecentImportsBtn.addEventListener('click', () => {
            openConfirmModal({
                title: 'Clear recent imports?',
                message: 'This only removes the import log below Upcoming 7 Days. Your schedules will not be deleted.',
                okText: 'Clear Log',
                iconClass: 'warning',
                onConfirm: () => {
                    try { localStorage.removeItem(RECENT_IMPORTS_KEY); } catch {}
                    recentImportsPage = 0;
                    renderRecentImports();
                }
            });
        });
    }

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (openStatusPopup) { closeStatusPopup(); return; }
            if (importSuccessOverlay.classList.contains('active')) { closeImportSuccessModal(); return; }
            if (notifPanel && notifPanel.classList.contains('open')) { closeNotifPanel(); return; }
            if (validationOverlay.classList.contains('active')) { closeValidationModal(); return; }
            if (confirmOverlay.classList.contains('active')) { closeConfirmModal(); return; }
            if (viewOverlay.classList.contains('active')) { closeViewModal(); return; }
            if (reviewOverlay.classList.contains('active')) { goBackToForm(); return; }
            if (trashOverlay.classList.contains('active')) { closeTrashModal(); return; }
            if (settingsOverlay.classList.contains('active')) { closeSettingsModal(); return; }
            if (historyOverlay.classList.contains('active')) closeHistoryModal();
            if (dayListOverlay.classList.contains('active')) closeDayListModal();
            if (modalOverlay.classList.contains('active')) closeFormModal();
            if (datePickerOverlay.classList.contains('active')) closeDatePickerModal();
            if (exportOverlay.classList.contains('active')) closeExportModal();
            if (importOverlay.classList.contains('active')) closeImportModal();
            closeSortPopovers();
        }
    });

    // ============================================================
    // BOOT
    // ============================================================
    function boot() {
        renderCalendar();
        renderNotifications();
        renderRecentImports();
        loadFromApi(true);

        setInterval(() => {
            if (!savingInFlight && !document.hidden) loadFromApi(false);
        }, 30000);

        startLateTicker();
        startCountdownTicker();
    }

    if (window.supabaseReady && window.supabaseClient) {
        boot();
    } else {
        window.addEventListener('supabase-ready', boot, { once: true });
        setTimeout(() => {
            if (window.supabaseClient && !isLoaded) boot();
        }, 500);
    }
})();
