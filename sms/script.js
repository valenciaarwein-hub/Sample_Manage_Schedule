// sms/script.js
(function() {
    'use strict';

    // ============================================================
    // STATE
    // ============================================================
    let schedules = {};   // { "YYYY-MM-DD": [ {id, title, description, type, createdAt}, ... ] }
    let trash = [];       // [ {id, title, description, type, dateKey, createdAt, deletedAt}, ... ]
    let isLoaded = false;
    let saveTimer = null;
    let savingInFlight = false;

    const TYPE_OPTIONS = ['Meeting', 'Seminar', 'Special Event', 'Other'];

    // ============================================================
    // SUPABASE HELPERS
    // ============================================================
    function getSupabase() {
        if (!window.supabaseClient) {
            throw new Error('Supabase client not initialized. Check your credentials in index.html.');
        }
        return window.supabaseClient;
    }

    // ============================================================
    // API HELPERS (Supabase-backed)
    // ============================================================
    async function loadFromApi(showErrors) {
        try {
            const supabase = getSupabase();

            // Fetch active (non-deleted) schedules
            const { data: activeData, error: activeError } = await supabase
                .from('schedules')
                .select('*')
                .is('deleted_at', null);

            if (activeError) throw activeError;

            // Rebuild schedules object { "YYYY-MM-DD": [ ... ] }
            schedules = {};
            (activeData || []).forEach(item => {
                if (!schedules[item.date_key]) schedules[item.date_key] = [];
                schedules[item.date_key].push({
                    id: item.id,
                    title: item.title,
                    description: item.description || '',
                    type: item.type || '',
                    createdAt: item.created_at
                });
            });

            // Fetch trash (deleted items)
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
                dateKey: item.date_key,
                createdAt: item.created_at,
                deletedAt: item.deleted_at
            }));

            isLoaded = true;
            renderCalendar();
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

    // Syncs the in-memory state to Supabase using targeted CRUD.
    // Strategy: upsert everything that exists + delete rows that were removed.
    async function pushToApi() {
        if (savingInFlight) {
            scheduleSave();
            return;
        }
        savingInFlight = true;
        try {
            const supabase = getSupabase();

            // Build the full set of rows that *should* exist
            const allRows = [];
            Object.keys(schedules).forEach(dateKey => {
                (schedules[dateKey] || []).forEach(s => {
                    allRows.push({
                        id: s.id,
                        date_key: dateKey,
                        title: s.title,
                        description: s.description || '',
                        type: s.type || '',
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
                    created_at: t.createdAt || new Date().toISOString(),
                    updated_at: null,
                    deleted_at: t.deletedAt || new Date().toISOString()
                });
            });

            // 1. UPSERT all current rows
            if (allRows.length > 0) {
                const { error: upsertError } = await supabase
                    .from('schedules')
                    .upsert(allRows, { onConflict: 'id' });
                if (upsertError) throw upsertError;
            }

            // 2. DELETE rows that no longer exist in memory
            const currentIds = allRows.map(r => r.id);
            if (currentIds.length > 0) {
                const { error: delError } = await supabase
                    .from('schedules')
                    .delete()
                    .not('id', 'in', `(${currentIds.map(id => `"${id}"`).join(',')})`);
                if (delError) throw delError;
            } else {
                // Nothing in memory → wipe all rows
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
    const importFileInput = document.getElementById('importFileInput');
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

    // ============================================================
    // CONFIRMATION MODAL
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
                    dateKey,
                    dateObj: d,
                    id: s.id,
                    title: s.title,
                    description: s.description || '',
                    type: s.type || ''
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
                    schedulesHtml += `
                        <div class="schedule-item" data-date="${dateKey}" data-id="${s.id}" title="${escapeHtml(s.title)} — ${escapeHtml(s.description || '')}">
                            <i class="fas fa-circle" style="font-size: 0.35rem;"></i>
                            <span>${escapeHtml(shortTitle)}</span>
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

    function renderDayScheduleList() {
        if (!activeDayListDateKey) return;
        const daySchedules = schedules[activeDayListDateKey] || [];

        const validIds = new Set(daySchedules.map(s => s.id));
        Array.from(dayListSelection).forEach(id => {
            if (!validIds.has(id)) dayListSelection.delete(id);
        });

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
            html += `
                <div class="day-schedule-card">
                    <input type="checkbox" class="day-checkbox" data-day-id="${s.id}" ${isChecked ? 'checked' : ''}>
                    <div class="card-accent"></div>
                    <div class="card-body">
                        <div class="card-title">${escapeHtml(s.title)}</div>
                        <div class="card-desc">${escapeHtml(desc)}</div>
                        ${s.type ? renderTypeBadge(s.type) : ''}
                    </div>
                    <div class="card-actions">
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
    // DELETE (single → recycle bin)
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
                if (dayListOverlay.classList.contains('active') && activeDayListDateKey === dateKey) {
                    renderDayScheduleList();
                }
                if (historyOverlay.classList.contains('active')) renderHistory();
                if (trashOverlay.classList.contains('active')) renderTrash();
            }
        });
    }

    // ============================================================
    // BULK DELETE (day list)
    // ============================================================
    function deleteSelectedDaySchedules() {
        if (!activeDayListDateKey || dayListSelection.size === 0) return;
        const dateKey = activeDayListDateKey;
        const ids = Array.from(dayListSelection);
        const count = ids.length;

        openConfirmModal({
            title: `Move ${count} schedule${count === 1 ? '' : 's'} to Recycle Bin?`,
            message: `The selected schedule${count === 1 ? '' : 's'} will be moved to the Recycle Bin. You can recover them later from Settings.`,
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
                if (dayListOverlay.classList.contains('active') && activeDayListDateKey === dateKey) {
                    renderDayScheduleList();
                }
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
        recoverFromViewBtn.style.display = 'none';
        viewModalTitle.innerHTML = '<i class="fas fa-eye" style="color:#3b82f6;"></i> Schedule Details';

        viewTitle.textContent = schedule.title;
        viewType.innerHTML = schedule.type ? renderTypeBadge(schedule.type) : '<span style="color:#94a3b8;">—</span>';
        viewDescription.textContent = schedule.description || 'No description provided.';
        viewDate.textContent = dateObj.toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });
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
    // VALIDATION
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

    // ============================================================
    // SAVE FLOW
    // ============================================================
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
                    type: original.type || ''
                },
                newData: { title, description, type: resolvedType }
            };
        } else {
            pendingSave = {
                mode: 'create',
                dateKey,
                id: null,
                oldData: null,
                newData: { title, description, type: resolvedType }
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
                item.updatedAt = new Date().toISOString();
            }
        } else {
            if (!schedules[dateKey]) schedules[dateKey] = [];
            schedules[dateKey].push({
                id: uid(),
                title: newData.title,
                description: newData.description,
                type: newData.type,
                createdAt: new Date().toISOString()
            });
        }

        scheduleSave();
        renderCalendar();

        const shouldReopenHistory = reopenHistoryAfterEdit;
        reopenHistoryAfterEdit = false;

        closeReviewModal();
        modalOverlay.classList.remove('active');

        editingScheduleId = null;
        selectedDateKey = null;
        pendingSave = null;
        formType = { base: null, custom: '' };

        if (dayListOverlay.classList.contains('active') && activeDayListDateKey === dateKey) {
            renderDayScheduleList();
        }
        if (historyOverlay.classList.contains('active')) renderHistory();
        if (viewOverlay.classList.contains('active')) {
            const stillExists = (schedules[dateKey] || []).find(s => s.id === id);
            if (stillExists) openViewModal(dateKey, id);
            else closeViewModal();
        }

        if (shouldReopenHistory) {
            openHistoryModal();
        }
    }

    // ============================================================
    // DATE PICKER MODAL
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

        let filtered = all;
        if (query) filtered = filtered.filter(s =>
            s.title.toLowerCase().includes(query) || (s.description || '').toLowerCase().includes(query));
        if (yearFilter !== 'all') filtered = filtered.filter(s => s.dateKey.startsWith(yearFilter + '-'));

        filtered = applySort(filtered, historySort);

        updateSortIcon(historySortBtn, historySort);
        syncSortPopover(historySortPopover, historySort);

        if (filtered.length === 0) {
            historyList.innerHTML = `
                <div class="history-empty">
                    <i class="fas fa-folder-open"></i>
                    No schedules found${query || yearFilter !== 'all' ? ' matching your filters' : ' yet'}.
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

            html += `
                <div class="history-schedule-item">
                    <div class="hs-accent"></div>
                    <div class="hs-body">
                        <div class="hs-title">${escapeHtml(s.title)}</div>
                        ${s.type ? renderTypeBadge(s.type) : ''}
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

                if (action === 'view') {
                    closeHistoryModal();
                    openViewModal(dateKey, id, true);
                } else if (action === 'edit') {
                    closeHistoryModal();
                    openEditFormModal(dateKey, id, true);
                } else if (action === 'delete') {
                    deleteScheduleFromList(dateKey, id);
                }
            });
        });
    }

    function openHistoryModal() {
        historySearch.value = '';
        historyYearFilter.value = 'all';
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
            message: `${all.length} schedule${all.length === 1 ? '' : 's'} will be moved to the Recycle Bin. You can recover them from Settings.`,
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
                closeHistoryModal();
                if (dayListOverlay.classList.contains('active')) closeDayListModal();
            }
        });
    }

    // ============================================================
    // SETTINGS MODAL
    // ============================================================
    function openSettingsModal() { settingsOverlay.classList.add('active'); }
    function closeSettingsModal() { settingsOverlay.classList.remove('active'); }

    // ============================================================
    // RECYCLE BIN
    // ============================================================
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
    // SORT POPOVER LOGIC
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
    // EXPORT / IMPORT
    // ============================================================
    function exportSchedulesToFile() {
        const dataStr = JSON.stringify(schedules, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `schedules_${formatDateKey(new Date())}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function importSchedulesFromFile(file, onDone) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const parsed = JSON.parse(e.target.result);
                if (!parsed || typeof parsed !== 'object') {
                    onDone(false, 'Invalid file format.');
                    return;
                }
                Object.keys(parsed).forEach(dateKey => {
                    const incoming = parsed[dateKey];
                    if (!Array.isArray(incoming)) return;
                    if (!schedules[dateKey]) schedules[dateKey] = [];
                    const existingIds = new Set(schedules[dateKey].map(s => s.id));
                    incoming.forEach(s => {
                        if (!s.id) s.id = uid();
                        if (existingIds.has(s.id)) return;
                        if (!s.createdAt) s.createdAt = new Date().toISOString();
                        schedules[dateKey].push(s);
                        existingIds.add(s.id);
                    });
                });
                scheduleSave();
                renderCalendar();
                if (historyOverlay.classList.contains('active')) renderHistory();
                onDone(true);
            } catch (err) {
                onDone(false, 'Could not parse JSON file.');
            }
        };
        reader.onerror = () => onDone(false, 'Failed to read file.');
        reader.readAsText(file);
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

    exportBtn.addEventListener('click', exportSchedulesToFile);
    importBtn.addEventListener('click', () => importFileInput.click());
    importFileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        importSchedulesFromFile(file, (ok, msg) => {
            if (ok) {
                alert('Schedules imported successfully.');
            } else {
                alert('Import failed: ' + (msg || 'unknown error'));
            }
            importFileInput.value = '';
        });
    });

    historySortBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSortPopover(historySortPopover, historySortBtn);
    });
    wireSortPopover(historySortPopover, historySort, () => {
        renderHistory();
    });

    trashSortBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSortPopover(trashSortPopover, trashSortBtn);
    });
    wireSortPopover(trashSortPopover, trashSort, () => {
        renderTrash();
    });

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

    // ---------- LOGOUT ----------
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

                renderCalendar();
            }
        });
    });

    // ---------- TRASH EVENTS ----------
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

    // ---------- VIEW MODAL EVENTS ----------
    closeViewBtn.addEventListener('click', closeViewModal);
    viewOverlay.addEventListener('click', (e) => {
        if (e.target === viewOverlay) closeViewModal();
    });

    recoverFromViewBtn.addEventListener('click', () => {
        if (viewContext.kind !== 'trash' || !viewContext.trashId) return;
        recoverOne(viewContext.trashId);
    });

    // ---------- DAY LIST BULK EVENTS ----------
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

    // ---------- OTHER MODAL EVENTS ----------
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
    clearAllHistoryBtn.addEventListener('click', clearAllHistory);

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
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
            closeSortPopovers();
        }
    });

    // ============================================================
    // BOOT
    // ============================================================
    // Wait for Supabase to be initialized by the inline module script in index.html
    function boot() {
        renderCalendar();
        loadFromApi(true);

        // Auto-refresh every 30s (in case changes were made from another device)
        setInterval(() => {
            if (!savingInFlight && !document.hidden) loadFromApi(false);
        }, 30000);
    }

    if (window.supabaseReady && window.supabaseClient) {
        boot();
    } else {
        window.addEventListener('supabase-ready', boot, { once: true });
        // Fallback in case the event fired before this script ran
        setTimeout(() => {
            if (window.supabaseClient && !isLoaded) boot();
        }, 500);
    }
})();
