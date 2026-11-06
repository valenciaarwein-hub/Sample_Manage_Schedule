// script.js
(function() {
    // ---------- IN-MEMORY JAVASCRIPT STORE (no localStorage) ----------
    let schedules = {};
    let trash = []; // deleted schedules: { id, title, description, dateKey, deletedAt }

    // Seed sample data on first load
    (function seedSampleData() {
        const today = new Date();
        const sampleDate = new Date(today.getFullYear(), today.getMonth(), 15);
        schedules[formatDateKey(sampleDate)] = [
            { id: 's1', title: 'Project kickoff', description: 'Discuss scope and timeline for Q2 launch' },
            { id: 's2', title: 'Design review', description: 'Review new mockups with the product team' }
        ];
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        schedules[formatDateKey(tomorrow)] = [
            { id: 's3', title: 'Client call', description: 'Follow-up on proposal and next steps' }
        ];
    })();

    function saveSchedulesToStorage() { /* in-memory only */ }

    // ---------- EXPORT / IMPORT ----------
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
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    schedules = parsed;
                    onDone(true);
                } else {
                    onDone(false, 'Invalid file format.');
                }
            } catch (err) {
                onDone(false, 'Could not parse JSON file.');
            }
        };
        reader.onerror = () => onDone(false, 'Failed to read file.');
        reader.readAsText(file);
    }

    // ---------- STATE ----------
    let currentDate = new Date();
    currentDate.setDate(1);
    let currentYear = currentDate.getFullYear();
    let currentMonth = currentDate.getMonth();

    let editingScheduleId = null;
    let selectedDateKey = null;
    let activeDayListDateKey = null;
    let reopenHistoryAfterEdit = false;
    let trashSelection = new Set();       // ids selected in the recycle bin
    let dayListSelection = new Set();     // ids selected in the day list modal

    // ---------- DOM ELEMENTS ----------
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

    // day list modal
    const dayListOverlay = document.getElementById('dayListOverlay');
    const dayListDateBadge = document.getElementById('dayListDateBadge');
    const dayScheduleList = document.getElementById('dayScheduleList');
    const addScheduleFromListBtn = document.getElementById('addScheduleFromListBtn');
    const closeDayListBtn = document.getElementById('closeDayListBtn');
    const dayListToolbar = document.getElementById('dayListToolbar');
    const daySelectAll = document.getElementById('daySelectAll');
    const dayDeleteSelectedBtn = document.getElementById('dayDeleteSelectedBtn');

    // schedule form modal
    const modalOverlay = document.getElementById('modalOverlay');
    const modalTitle = document.getElementById('modalTitle');
    const modalDateBadge = document.getElementById('modalDateBadge');
    const scheduleTitle = document.getElementById('scheduleTitle');
    const scheduleDescription = document.getElementById('scheduleDescription');
    const charCount = document.getElementById('charCount');
    const cancelModalBtn = document.getElementById('cancelModalBtn');
    const saveScheduleBtn = document.getElementById('saveScheduleBtn');

    // view modal
    const viewOverlay = document.getElementById('viewOverlay');
    const viewTitle = document.getElementById('viewTitle');
    const viewDescription = document.getElementById('viewDescription');
    const viewDate = document.getElementById('viewDate');
    const closeViewBtn = document.getElementById('closeViewBtn');

    // date picker modal
    const datePickerOverlay = document.getElementById('datePickerOverlay');
    const pickYear = document.getElementById('pickYear');
    const pickMonth = document.getElementById('pickMonth');
    const pickDay = document.getElementById('pickDay');
    const datePreviewText = document.getElementById('datePreviewText');
    const cancelDatePickerBtn = document.getElementById('cancelDatePickerBtn');
    const goToDateBtn = document.getElementById('goToDateBtn');

    // history modal
    const historyOverlay = document.getElementById('historyOverlay');
    const historySearch = document.getElementById('historySearch');
    const historyYearFilter = document.getElementById('historyYearFilter');
    const historyStats = document.getElementById('historyStats');
    const totalSchedulesCount = document.getElementById('totalSchedulesCount');
    const totalDaysCount = document.getElementById('totalDaysCount');
    const totalMonthsCount = document.getElementById('totalMonthsCount');
    const historyList = document.getElementById('historyList');
    const clearAllHistoryBtn = document.getElementById('clearAllHistoryBtn');
    const closeHistoryBtn = document.getElementById('closeHistoryBtn');

    // settings modal
    const settingsOverlay = document.getElementById('settingsOverlay');
    const openTrashBtn = document.getElementById('openTrashBtn');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');

    // trash modal
    const trashOverlay = document.getElementById('trashOverlay');
    const trashSelectAll = document.getElementById('trashSelectAll');
    const trashList = document.getElementById('trashList');
    const trashRecoverSelectedBtn = document.getElementById('trashRecoverSelectedBtn');
    const trashDeleteSelectedBtn = document.getElementById('trashDeleteSelectedBtn');
    const emptyTrashBtn = document.getElementById('emptyTrashBtn');
    const closeTrashBtn = document.getElementById('closeTrashBtn');

    // confirm modal
    const confirmOverlay = document.getElementById('confirmOverlay');
    const confirmIcon = document.getElementById('confirmIcon');
    const confirmTitle = document.getElementById('confirmTitle');
    const confirmMessage = document.getElementById('confirmMessage');
    const confirmCancelBtn = document.getElementById('confirmCancelBtn');
    const confirmOkBtn = document.getElementById('confirmOkBtn');

    // ---------- CONFIRMATION MODAL HELPER ----------
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

    // ---------- HELPERS ----------
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

    // ---------- TRASH HELPERS ----------
    function moveToTrash(dateKey, schedule) {
        trash.unshift({
            id: schedule.id,
            title: schedule.title,
            description: schedule.description || '',
            dateKey: dateKey,
            deletedAt: new Date().toISOString()
        });
    }

    function removeFromTrashById(id) {
        trash = trash.filter(t => t.id !== id);
        trashSelection.delete(id);
    }

    function recoverTrashItem(id) {
        const item = trash.find(t => t.id === id);
        if (!item) return false;

        let targetId = item.id;
        const existing = schedules[item.dateKey] || [];
        if (existing.some(s => s.id === targetId)) {
            targetId = 'sched_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        }

        if (!schedules[item.dateKey]) schedules[item.dateKey] = [];
        schedules[item.dateKey].push({
            id: targetId,
            title: item.title,
            description: item.description
        });

        removeFromTrashById(id);
        return true;
    }

    // ---------- RENDER CALENDAR ----------
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
    }

    // ---------- DAY LIST MODAL ----------
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

        // Show toolbar only if there is at least one schedule
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

        // Prune stale ids from selection
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

        // Per-card checkbox handlers
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

    // ---------- DELETE (single — moves to recycle bin) ----------
    function deleteScheduleFromList(dateKey, id) {
        const schedule = (schedules[dateKey] || []).find(s => s.id === id);
        if (!schedule) return;

        openConfirmModal({
            title: 'Move to Recycle Bin?',
            message: `"${schedule.title}" will be moved to the Recycle Bin. You can recover it later from Settings.`,
            okText: 'Move to Bin',
            iconClass: 'warning',
            onConfirm: () => {
                moveToTrash(dateKey, schedule);

                const daySchedules = schedules[dateKey] || [];
                schedules[dateKey] = daySchedules.filter(s => s.id !== id);
                if (schedules[dateKey].length === 0) delete schedules[dateKey];

                dayListSelection.delete(id);

                saveSchedulesToStorage();
                renderCalendar();
                if (dayListOverlay.classList.contains('active') && activeDayListDateKey === dateKey) {
                    renderDayScheduleList();
                }
                if (historyOverlay.classList.contains('active')) renderHistory();
                if (trashOverlay.classList.contains('active')) renderTrash();
            }
        });
    }

    // ---------- BULK DELETE (selected in day list) ----------
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
                const daySchedules = schedules[dateKey] || [];
                ids.forEach(id => {
                    const s = daySchedules.find(x => x.id === id);
                    if (s) moveToTrash(dateKey, s);
                });
                schedules[dateKey] = daySchedules.filter(s => !ids.includes(s.id));
                if (schedules[dateKey].length === 0) delete schedules[dateKey];

                dayListSelection.clear();

                saveSchedulesToStorage();
                renderCalendar();
                if (dayListOverlay.classList.contains('active') && activeDayListDateKey === dateKey) {
                    renderDayScheduleList();
                }
                if (historyOverlay.classList.contains('active')) renderHistory();
                if (trashOverlay.classList.contains('active')) renderTrash();
            }
        });
    }

    // ---------- VIEW MODAL ----------
    function openViewModal(dateKey, scheduleId, fromHistory = false) {
        const schedule = (schedules[dateKey] || []).find(s => s.id === scheduleId);
        if (!schedule) return;
        reopenHistoryAfterEdit = fromHistory;

        const dateObj = getDateFromKey(dateKey);
        viewTitle.textContent = schedule.title;
        viewDescription.textContent = schedule.description || 'No description provided.';
        viewDate.textContent = dateObj.toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });
        viewOverlay.classList.add('active');
    }

    function closeViewModal() {
        viewOverlay.classList.remove('active');

        if (reopenHistoryAfterEdit) {
            reopenHistoryAfterEdit = false;
            openHistoryModal();
        }
    }

    // ---------- FORM MODAL ----------
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
        updateCharCounter();
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
        updateCharCounter();
        modalOverlay.classList.add('active');
        scheduleTitle.focus();
    }

    function closeFormModal() {
        modalOverlay.classList.remove('active');
        editingScheduleId = null;
        selectedDateKey = null;

        if (reopenHistoryAfterEdit) {
            reopenHistoryAfterEdit = false;
            openHistoryModal();
        }
    }

    function saveSchedule() {
        const title = scheduleTitle.value.trim();
        if (!title) { alert('Please enter a title.'); scheduleTitle.focus(); return; }

        const description = scheduleDescription.value.trim().slice(0, 200);
        const dateKey = selectedDateKey;
        if (!dateKey) return;

        if (editingScheduleId) {
            const daySchedules = schedules[dateKey] || [];
            const index = daySchedules.findIndex(s => s.id === editingScheduleId);
            if (index !== -1) daySchedules[index] = { ...daySchedules[index], title, description };
        } else {
            const newId = 'sched_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
            if (!schedules[dateKey]) schedules[dateKey] = [];
            schedules[dateKey].push({ id: newId, title, description });
        }

        saveSchedulesToStorage();
        renderCalendar();

        const shouldReopenHistory = reopenHistoryAfterEdit;
        reopenHistoryAfterEdit = false;

        modalOverlay.classList.remove('active');
        editingScheduleId = null;
        selectedDateKey = null;

        if (dayListOverlay.classList.contains('active') && activeDayListDateKey === dateKey) {
            renderDayScheduleList();
        }

        if (shouldReopenHistory) {
            openHistoryModal();
        }
    }

    // ---------- DATE PICKER MODAL ----------
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

    // ---------- HISTORY MODAL ----------
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

        filtered.sort((a, b) => b.dateKey.localeCompare(a.dateKey));

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

        const monthGroups = {};
        filtered.forEach(s => {
            const [y, m] = s.dateKey.split('-');
            const monthKey = `${y}-${m}`;
            if (!monthGroups[monthKey]) monthGroups[monthKey] = {};
            if (!monthGroups[monthKey][s.dateKey]) monthGroups[monthKey][s.dateKey] = [];
            monthGroups[monthKey][s.dateKey].push(s);
        });

        const sortedMonthKeys = Object.keys(monthGroups).sort((a, b) => b.localeCompare(a));

        let html = '';
        sortedMonthKeys.forEach(monthKey => {
            const [y, m] = monthKey.split('-');
            const monthLabel = `${monthNames[parseInt(m, 10) - 1]} ${y}`;
            const dates = monthGroups[monthKey];
            const sortedDateKeys = Object.keys(dates).sort((a, b) => b.localeCompare(a));

            html += `<div class="history-month-group"><div class="history-month-header"><i class="fas fa-calendar-alt"></i> ${monthLabel}</div>`;

            sortedDateKeys.forEach(dateKey => {
                const dateObj = getDateFromKey(dateKey);
                const dateLabel = dateObj.toLocaleDateString('en-US', {
                    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
                });
                html += `<div class="history-date-group"><div class="history-date-header"><i class="fas fa-calendar-day"></i> ${dateLabel}</div>`;

                dates[dateKey].forEach(s => {
                    html += `
                        <div class="history-schedule-item">
                            <div class="hs-accent"></div>
                            <div class="hs-body">
                                <div class="hs-title">${escapeHtml(s.title)}</div>
                                ${s.description ? `<div class="hs-desc">${escapeHtml(s.description)}</div>` : ''}
                            </div>
                            <div class="hs-actions">
                                <button class="icon-btn view" data-history-action="view" data-date="${dateKey}" data-id="${s.id}" title="View"><i class="fas fa-eye"></i></button>
                                <button class="icon-btn edit" data-history-action="edit" data-date="${dateKey}" data-id="${s.id}" title="Edit"><i class="fas fa-pen"></i></button>
                                <button class="icon-btn delete" data-history-action="delete" data-date="${dateKey}" data-id="${s.id}" title="Move to recycle bin"><i class="fas fa-trash-alt"></i></button>
                            </div>
                        </div>
                    `;
                });
                html += `</div>`;
            });
            html += `</div>`;
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

    function closeHistoryModal() { historyOverlay.classList.remove('active'); }

    // ---------- CLEAR ALL (moves all to trash) ----------
    function clearAllHistory() {
        const all = getAllSchedulesFlat();
        if (all.length === 0) return;

        openConfirmModal({
            title: 'Move ALL schedules to Recycle Bin?',
            message: `${all.length} schedule${all.length === 1 ? '' : 's'} will be moved to the Recycle Bin. You can recover them from Settings.`,
            okText: 'Move All to Bin',
            iconClass: 'warning',
            onConfirm: () => {
                all.forEach(s => moveToTrash(s.dateKey, s));
                schedules = {};
                dayListSelection.clear();
                saveSchedulesToStorage();
                renderCalendar();
                closeHistoryModal();
                if (dayListOverlay.classList.contains('active')) closeDayListModal();
            }
        });
    }

    // ---------- SETTINGS MODAL ----------
    function openSettingsModal() {
        settingsOverlay.classList.add('active');
    }
    function closeSettingsModal() {
        settingsOverlay.classList.remove('active');
    }

    // ---------- RECYCLE BIN ----------
    function openTrashModal() {
        trashSelection.clear();
        renderTrash();
        trashOverlay.classList.add('active');
    }
    function closeTrashModal() {
        trashOverlay.classList.remove('active');
        trashSelection.clear();
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

        let html = '';
        const sorted = [...trash].sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));

        sorted.forEach(t => {
            const isChecked = trashSelection.has(t.id);
            const dateObj = getDateFromKey(t.dateKey);
            const dateLabel = dateObj.toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric'
            });

            html += `
                <div class="trash-item" data-trash-id="${t.id}">
                    <input type="checkbox" class="trash-checkbox" data-trash-id="${t.id}" ${isChecked ? 'checked' : ''}>
                    <div class="ti-body">
                        <div class="ti-title">${escapeHtml(t.title)}</div>
                        ${t.description ? `<div class="ti-desc">${escapeHtml(t.description)}</div>` : ''}
                        <div class="ti-meta">
                            <span><i class="fas fa-calendar-day"></i> ${dateLabel}</span>
                            <span><i class="fas fa-clock"></i> Deleted ${formatDateTime(t.deletedAt)}</span>
                        </div>
                    </div>
                    <div class="ti-actions">
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
                if (action === 'recover') recoverOne(id);
                else if (action === 'delete') deleteOnePermanently(id);
            });
        });

        updateTrashBulkButtons();
    }

    function recoverOne(id) {
        if (recoverTrashItem(id)) {
            saveSchedulesToStorage();
            renderCalendar();
            renderTrash();
            if (historyOverlay.classList.contains('active')) renderHistory();
        }
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
                removeFromTrashById(id);
                renderTrash();
            }
        });
    }

    function recoverSelected() {
        if (trashSelection.size === 0) return;
        const ids = Array.from(trashSelection);
        ids.forEach(id => recoverTrashItem(id));
        trashSelection.clear();
        saveSchedulesToStorage();
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
                Array.from(trashSelection).forEach(id => removeFromTrashById(id));
                trashSelection.clear();
                renderTrash();
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
                trashSelection.clear();
                renderTrash();
            }
        });
    }

    // ---------- EVENT LISTENERS ----------
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

    // Export / Import wiring
    exportBtn.addEventListener('click', exportSchedulesToFile);
    importBtn.addEventListener('click', () => importFileInput.click());
    importFileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        importSchedulesFromFile(file, (ok, msg) => {
            if (ok) {
                renderCalendar();
                if (historyOverlay.classList.contains('active')) renderHistory();
                alert('Schedules imported successfully.');
            } else {
                alert('Import failed: ' + (msg || 'unknown error'));
            }
            importFileInput.value = '';
        });
    });

    // ---------- SETTINGS ----------
    settingsBtn.addEventListener('click', openSettingsModal);
    closeSettingsBtn.addEventListener('click', closeSettingsModal);
    settingsOverlay.addEventListener('click', (e) => {
        if (e.target === settingsOverlay) closeSettingsModal();
    });

    openTrashBtn.addEventListener('click', () => {
        closeSettingsModal();
        openTrashModal();
    });

    // ---------- LOGOUT (confirmation modal) ----------
    logoutBtn.addEventListener('click', () => {
        closeSettingsModal();
        openConfirmModal({
            title: 'Log out?',
            message: 'You will be signed out and your current session data will be cleared.',
            okText: 'Log Out',
            iconClass: 'warning',
            onConfirm: () => {
                schedules = {};
                trash = [];
                trashSelection.clear();
                dayListSelection.clear();
                editingScheduleId = null;
                selectedDateKey = null;
                activeDayListDateKey = null;
                reopenHistoryAfterEdit = false;

                dayListOverlay.classList.remove('active');
                modalOverlay.classList.remove('active');
                viewOverlay.classList.remove('active');
                datePickerOverlay.classList.remove('active');
                historyOverlay.classList.remove('active');
                trashOverlay.classList.remove('active');
                settingsOverlay.classList.remove('active');

                renderCalendar();

                // Redirect to login page — uncomment and update route:
                // window.location.href = 'login.html';
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
    saveScheduleBtn.addEventListener('click', saveSchedule);
    scheduleDescription.addEventListener('input', updateCharCounter);
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeFormModal();
    });

    closeViewBtn.addEventListener('click', closeViewModal);
    viewOverlay.addEventListener('click', (e) => {
        if (e.target === viewOverlay) closeViewModal();
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

    // Escape key: close topmost open modal
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (confirmOverlay.classList.contains('active')) { closeConfirmModal(); return; }
            if (trashOverlay.classList.contains('active')) { closeTrashModal(); return; }
            if (settingsOverlay.classList.contains('active')) { closeSettingsModal(); return; }
            if (historyOverlay.classList.contains('active')) closeHistoryModal();
            if (dayListOverlay.classList.contains('active')) closeDayListModal();
            if (modalOverlay.classList.contains('active')) closeFormModal();
            if (viewOverlay.classList.contains('active')) closeViewModal();
            if (datePickerOverlay.classList.contains('active')) closeDatePickerModal();
        }
    });

    // Initial render
    renderCalendar();
})();
