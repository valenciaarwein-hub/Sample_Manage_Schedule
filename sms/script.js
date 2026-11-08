// sms/script.js
(function() {
    'use strict';

    // ============================================================
    // STATE
    // ============================================================
    let schedules = {};
    let trash = [];
    let isLoaded = false;
    let saveTimer = null;
    let savingInFlight = false;

    const TYPE_OPTIONS = ['Meeting', 'Seminar', 'Special Event', 'Other'];
    const STATUS_OPTIONS = ['process', 'done', 'priority'];

    // ============================================================
    // SUPABASE HELPERS
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
                    createdAt: item.created_at
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
                deletedAt: item.deleted_at
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

    // ============================================================
    // STATUS HELPERS
    // ============================================================
    function getStatusIcon(status) {
        switch (status) {
            case 'done': return 'fa-check-circle';
            case 'priority': return 'fa-star';
            default: return 'fa-hourglass-half';
        }
    }

    function getStatusLabel(status) {
        switch (status) {
            case 'done': return 'Done';
            case 'priority': return 'Priority';
            default: return 'Process';
        }
    }

    function normalizeStatus(s) {
        return STATUS_OPTIONS.includes(s) ? s : 'process';
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

    // ============================================================
    // SORT HELPERS
    // ============================================================
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
    // STATE VARIABLES (UI)
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

    let viewContext = { kind: 'schedule', trashId: null };

    // ============================================================
    // DOM ELEMENTS
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
    // NOTIFICATION SYSTEM
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

        Object.keys(schedules).forEach(dateKey => {
            (schedules[dateKey] || []).forEach(s => {
                const st = normalizeStatus(s.status);
                if (st === 'done') return;

                const diff = daysUntil(dateKey);

                let status, dotClass, itemClass;
                if (st === 'priority') {
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
    // FORM: TYPE BUTTONS
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
    // RENDER CALENDAR
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
                    const statusIcon = getStatusIcon(st);
                    const urgency = getUrgencyLevel(dateKey);

                    const itemClass = st === 'done' ? ' status-done'
                                    : st === 'priority' ? ' status-priority'
                                    : ' status-process status-' + urgency;

                    schedulesHtml += `
                        <div class="schedule-item${itemClass}" data-date="${dateKey}" data-id="${s.id}" title="${escapeHtml(s.title)} — ${escapeHtml(s.description || '')}">
                            <i class="fas ${statusIcon} schedule-status-icon ${st}"></i>
                            <span class="schedule-title-highlight">${escapeHtml(shortTitle)}</span>
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
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const dateKey = item.dataset.date;
                if (dateKey) openDayListModal(dateKey);
            });
        });

        document.querySelectorAll('.day-cell').forEach(cell => {
            cell.addEventListener('click', () => {
                const dateKey = cell.dataset.dateKey;
                if (dateKey) openDayListModal(dateKey);
            });
        });

        renderUpcomingTable();
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
        renderDayScheduleList();
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
    // STATUS POPUP (per-row dropdown)
    // ============================================================
    let openStatusPopup = null;

    function closeStatusPopup() {
        if (openStatusPopup && openStatusPopup.parentNode) {
            openStatusPopup.parentNode.removeChild(openStatusPopup);
        }
        openStatusPopup = null;
    }

    function openStatusPicker(anchorEl, dateKey, id, currentStatus) {
        closeStatusPopup();

        const popup = document.createElement('div');
        popup.className = 'status-popup';
        popup.innerHTML = `
            <button type="button" class="status-popup-option ${currentStatus === 'process' ? 'selected' : ''}" data-pick="process">
                <i class="fas fa-hourglass-half"></i>
                <span>Process</span>
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

    // ============================================================
    // CHANGE STATUS
    // ============================================================
    function setScheduleStatus(dateKey, id, newStatus) {
        const list = schedules[dateKey] || [];
        const item = list.find(s => s.id === id);
        if (!item) return;

        const normalized = normalizeStatus(newStatus);

        if (normalized === 'priority' && getUrgencyLevel(dateKey) === 'overdue') {
            openConfirmModal({
                title: 'Cannot set as Priority',
                message: 'This schedule is overdue / late, so it cannot be marked as a Priority (star). It will stay in Process status.',
                okText: 'OK',
                iconClass: 'warning',
                showCancel: false,
                onConfirm: () => {}
            });
            return;
        }

        if (normalizeStatus(item.status) === normalized) return;

        item.status = normalized;
        item.updatedAt = new Date().toISOString();

        scheduleSave();
        renderCalendar();
        renderNotifications();
        renderDayScheduleList();
        if (historyOverlay.classList.contains('active')) renderHistory();
    }

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

        let html = '';
        daySchedules.forEach(s => {
            const desc = s.description || 'No description';
            const isChecked = dayListSelection.has(s.id);
            const st = normalizeStatus(s.status);
            const statusIcon = getStatusIcon(st);
            const cardStatusClass = st === 'done' ? ' status-done'
                                  : st === 'priority' ? ' status-priority'
                                  : '';

            html += `
                <div class="day-schedule-card${cardStatusClass}">
                    <input type="checkbox" class="day-checkbox" data-day-id="${s.id}" ${isChecked ? 'checked' : ''}>
                    <div class="card-accent"></div>
                    <div class="card-body">
                        <div class="card-title">
                            <span class="schedule-title-highlight">${escapeHtml(s.title)}</span>
                        </div>
                        <div class="card-desc">${escapeHtml(desc)}</div>
                        ${s.type ? renderTypeBadge(s.type) : ''}
                    </div>
                    <div class="card-actions">
                        <button type="button"
                                class="status-icon-btn ${st}"
                                data-status-trigger
                                data-date="${activeDayListDateKey}"
                                data-id="${s.id}"
                                data-current="${st}"
                                title="Change status (${getStatusLabel(st)})">
                            <i class="fas ${statusIcon}"></i>
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
        viewDescription.textContent = schedule.description || 'No description provided.';
        viewDate.textContent = dateObj.toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });

        const st = normalizeStatus(schedule.status);
        const stIcon = getStatusIcon(st);
        const stLabel = getStatusLabel(st);
        const stColor = st === 'done' ? '#16a34a' : st === 'priority' ? '#ca8a04' : '#64748b';
        viewStatus.innerHTML = `<span style="color:${stColor}; font-weight:600;"><i class="fas ${stIcon}"></i> ${stLabel}</span>`;

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
    // FORM MODAL
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

    // ============================================================
    // VALIDATION & SAVE FLOW
    // ============================================================
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
        const dateKey = selectedDateKey;
        if (!dateKey) return;

        if (editingScheduleId) {
            const daySchedules = schedules[dateKey] || [];
            const original = daySchedules.find(s => s.id === editingScheduleId);
            if (!original) return;

            const sameTitle = original.title === title;
            const sameDesc = (original.description || '') === description;
            const sameType = (original.type || '') === resolvedType;

            if (sameTitle && sameDesc && sameType) {
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
                    status: normalizeStatus(original.status)
                },
                newData: {
                    title,
                    description,
                    type: resolvedType,
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
                    status: 'process'
                }
            };
        }

        openReviewModal(pendingSave);
    }

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
            </div>
        `;

        if (mode === 'edit') {
            const titleChanged = oldData.title !== newData.title;
            const descChanged = (oldData.description || '') !== (newData.description || '');
            const typeChanged = (oldData.type || '') !== (newData.type || '');

            html += `
                <div class="review-block">
                    <div class="review-block-label"><i class="fas fa-history"></i> Old values</div>
                    <div class="review-field">
                        <div class="review-field-name">Title${titleChanged ? ' — edited' : ''}</div>
                        <div class="review-value ${titleChanged ? 'old' : 'same'}">${escapeHtml(oldData.title)}</div>
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
    // HISTORY MODAL
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

        // Default scope: current year + current month (when both filters are "all")
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

        // Default: current year + current month
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

    // ============================================================
    // CLEAR ALL
    // ============================================================
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
    // SETTINGS & TRASH
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
    // SORT POPOVERS
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
                    description: s.description || ''
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
                        <th>Type</th>
                        <th>Status</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
        `;

        rows.forEach(r => {
            const dateObj = getDateFromKey(r.dateKey);
            const monthLabel = MONTH_NAMES_FULL[dateObj.getMonth()];
            html += `
                <tr>
                    <td class="ep-date">${monthLabel}</td>
                    <td class="ep-date">${dateObj.getDate()}</td>
                    <td class="ep-date">${dateObj.getFullYear()}</td>
                    <td class="ep-title">${escapeHtml(r.title)}</td>
                    <td class="ep-type">${r.type ? escapeHtml(r.type) : '<span style="color:#94a3b8;">—</span>'}</td>
                    <td class="ep-type">${escapeHtml(getStatusLabel(r.status))}</td>
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
            ['Month', 'Day', 'Year', 'Title', 'Type', 'Status', 'Description']
        ];
        rows.forEach(r => {
            const dateObj = getDateFromKey(r.dateKey);
            sheetData.push([
                dateObj.getMonth() + 1,
                dateObj.getDate(),
                dateObj.getFullYear(),
                r.title,
                r.type,
                getStatusLabel(r.status),
                r.description
            ]);
        });

        const ws = XLSX.utils.aoa_to_sheet(sheetData);
        ws['!cols'] = [
            { wch: 8 }, { wch: 6 }, { wch: 8 },
            { wch: 30 }, { wch: 16 }, { wch: 14 }, { wch: 55 }
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

    let importParsedRows = null;

    function openImportModal() {
        importParsedRows = null;
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
                status: normalizeStatus(r.status),
                createdAt: now
            });
            added++;
            perDateCounts[dateKey] = (perDateCounts[dateKey] || 0) + 1;
        });

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
            ['Month', 'Day', 'Year', 'Title', 'Type', 'Status', 'Description'],
            [12, 8, 2025, 'Team Meeting', 'Meeting', 'Process', 'Weekly sync with the team'],
            [12, 15, 2025, 'Year-end Seminar', 'Seminar', 'Priority', 'Annual review and planning'],
            [1, 10, 2026, 'New Year Event', 'Special Event', 'Process', 'Company kickoff celebration'],
            [1, 20, 2026, 'Project Done', 'Meeting', 'Done', 'Quarterly wrap-up']
        ];

        const ws = XLSX.utils.aoa_to_sheet(templateData);
        ws['!cols'] = [
            { wch: 8 }, { wch: 6 }, { wch: 8 },
            { wch: 28 }, { wch: 16 }, { wch: 12 }, { wch: 50 }
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
        return 'process';
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

        if (
            (row.month == null || String(row.month).trim() === '') &&
            (row.day == null || String(row.day).trim() === '') &&
            (row.year == null || String(row.year).trim() === '') &&
            !titleStr && !typeStr && !statusStr && !descStr
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

        return {
            skip: false,
            errors: [],
            parsed: {
                dateKey,
                title: titleStr,
                type: typeStr,
                status: normalizeStatusLabel(statusStr),
                description: descStr
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
        const headerErrors = [];
        IMPORT_REQUIRED_HEADERS.forEach((required, idx) => {
            if (header[idx] !== required) {
                headerErrors.push(`Column ${idx + 1} must be "${required}" (found "${header[idx] || ''}").`);
            }
        });

        if (headerErrors.length > 0) {
            return { rows, errors: ['The header row does not match the template.', ...headerErrors] };
        }

        for (let i = 1; i < grid.length; i++) {
            const raw = grid[i] || [];
            const rowNumber = i + 1;

            const row = {
                month: raw[0],
                day: raw[1],
                year: raw[2],
                title: raw[3],
                type: raw[4],
                status: raw[5],
                description: raw[6]
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
                        <span><strong>${escapeHtml(r.title)}</strong> <span class="imp-type">· ${escapeHtml(r.type)}</span></span>
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
        loadFromApi(true);

        setInterval(() => {
            if (!savingInFlight && !document.hidden) loadFromApi(false);
        }, 30000);
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
