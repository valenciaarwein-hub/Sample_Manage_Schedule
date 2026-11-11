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

        // Scroll the list back to the top so a previously-scrolled day
        // doesn't reopen mid-scroll now that the body is scrollable.
        const scrollBody = dayListOverlay.querySelector('.day-list-scroll-body');
        if (scrollBody) scrollBody.scrollTop = 0;

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
    // STATUS POPUP
    // ============================================================
    let openStatusPopup = null;

    function closeStatusPopup(reopenView) {
        if (openStatusPopup && openStatusPopup.parentNode) {
            const wrap = openStatusPopup.parentNode;
            wrap.removeChild(openStatusPopup);
            if (wrap.classList && wrap.classList.contains('view-status-popup-wrap') && wrap.parentNode) {
                wrap.parentNode.removeChild(wrap);
            }
        }
        openStatusPopup = null;

        if (reopenView && viewContext.kind === 'schedule' && viewContext.dateKey && viewContext.id) {
            const sched = (schedules[viewContext.dateKey] || []).find(s => s.id === viewContext.id);
            if (sched) openViewModal(viewContext.dateKey, viewContext.id, reopenHistoryAfterEdit);
        }
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

    function isDoneAllowed(dateKey, sched) {
        if (!sched) return false;
        const nowPH = getNowPH();

        if (dateKey < nowPH.dateKey) return true;
        if (dateKey > nowPH.dateKey) return false;

        const range = parseScheduleTimeRange(sched.time);
        if (!range) return false;
        return nowPH.totalMinutes > range.endMin;
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

        const doneAllowed = isDoneAllowed(dateKey, sched);
        const isLateNow = isScheduleLateNow(dateKey, sched, getNowPH());
        const priorityAllowed = !isLateNow;

        const popup = document.createElement('div');
        popup.className = 'status-popup';
        popup.innerHTML = `
            <button type="button" class="status-popup-option ${currentStatus === 'upcoming' ? 'selected' : ''}" data-pick="upcoming">
                <i class="fas fa-calendar-check"></i>
                <span>Upcoming</span>
                <i class="fas fa-check status-popup-check"></i>
            </button>
            <button type="button"
                    class="status-popup-option ${currentStatus === 'done' ? 'selected' : ''} ${doneAllowed ? '' : 'disabled'}"
                    data-pick="done"
                    ${doneAllowed ? '' : 'disabled'}
                    title="${doneAllowed ? '' : 'Done can only be set once this schedule is in the past'}">
                <i class="fas fa-check-circle"></i>
                <span>Done${doneAllowed ? '' : ' (locked)'}</span>
                <i class="fas fa-check status-popup-check"></i>
            </button>
            <button type="button"
                    class="status-popup-option ${currentStatus === 'priority' ? 'selected' : ''} ${priorityAllowed ? '' : 'disabled'}"
                    data-pick="priority"
                    ${priorityAllowed ? '' : 'disabled'}
                    title="${priorityAllowed ? '' : 'Priority is not available for schedules marked as Late'}">
                <i class="fas fa-star"></i>
                <span>Priority${priorityAllowed ? '' : ' (locked)'}</span>
                <i class="fas fa-check status-popup-check"></i>
            </button>
        `;

        const modalEl = anchorEl.closest ? anchorEl.closest('.modal') : null;
        const fromViewModal = modalEl && viewOverlay.contains(modalEl);

        if (fromViewModal) {
            modalEl.style.position = 'relative';
            const wrap = document.createElement('div');
            wrap.className = 'view-status-popup-wrap';
            wrap.appendChild(popup);
            modalEl.appendChild(wrap);
            openStatusPopup = popup;

            const modalRect = modalEl.getBoundingClientRect();
            const btnRect = anchorEl.getBoundingClientRect();
            const popupWidth = 200;
            const popupHeight = popup.offsetHeight || 150;

            let top = btnRect.bottom - modalRect.top + 6;
            if (top + popupHeight > modalRect.height - 8) {
                top = btnRect.top - modalRect.top - popupHeight - 6;
            }
            let left = btnRect.left - modalRect.left + (btnRect.width / 2) - (popupWidth / 2);
            if (left < 8) left = 8;
            if (left + popupWidth > modalRect.width - 8) {
                left = modalRect.width - popupWidth - 8;
            }

            popup.style.top = top + 'px';
            popup.style.left = left + 'px';
            popup.style.width = popupWidth + 'px';

            popup.querySelectorAll('[data-pick]').forEach(btn => {
                if (btn.disabled) return;
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const chosen = btn.dataset.pick;
                    closeStatusPopup();
                    setScheduleStatus(dateKey, id, chosen);
                });
            });

            return;
        }

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
            if (btn.disabled) return;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const chosen = btn.dataset.pick;
                closeStatusPopup();
                setScheduleStatus(dateKey, id, chosen);
            });
        });
    }

    document.addEventListener('click', (e) => {
        if (!openStatusPopup) return;
        if (e.target.closest('.status-popup')) return;
        if (e.target.closest('[data-status-trigger]')) return;
        if (e.target.closest('#changeStatusFromViewBtn')) return;

        if (viewOverlay.classList.contains('active') && viewOverlay.contains(e.target)) {
            if (e.target === viewOverlay) closeStatusPopup(true);
            return;
        }

        closeStatusPopup(true);
    });
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && openStatusPopup) closeStatusPopup(true);
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

        if (normalized === 'priority' && isScheduleLateNow(dateKey, item, getNowPH())) {
            openConfirmModal({
                title: 'Cannot set as Priority',
                message: 'This schedule is already late. Priority is reserved for schedules that are still upcoming (0–3 days ahead).',
                okText: 'OK',
                iconClass: 'warning',
                showCancel: false,
                onConfirm: () => {}
            });
            return;
        }

        if (normalizeStatus(item.status) === normalized) return;

        if (normalized === 'done' && !isDoneAllowed(dateKey, item)) {
            openConfirmModal({
                title: 'Cannot mark as Done',
                message: 'A schedule can only be marked as Done after its date and time have already passed.',
                okText: 'OK',
                iconClass: 'warning',
                showCancel: false,
                onConfirm: () => {}
            });
            return;
        }

        item.status = normalized;
        if (normalized === 'done') item.lateMarked = false;
        item.updatedAt = new Date().toISOString();

        scheduleSave();
        renderCalendar();
        renderNotifications();
        renderDayScheduleList();
        if (historyOverlay.classList.contains('active')) renderHistory();

        logHistory({
            action: 'status',
            title: item.title,
            dateKey,
            id,
            notes: `Status changed to ${normalized}`
        });

        if (viewContext.kind === 'schedule' && viewContext.dateKey === dateKey && viewContext.id === id) {
            openViewModal(dateKey, id, reopenHistoryAfterEdit);
        }
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

                logHistory({
                    action: 'deleted',
                    title: removed.title,
                    dateKey,
                    id: removed.id,
                    notes: `Moved to Recycle Bin`
                });
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

                    logHistory({
                        action: 'deleted',
                        title: removed.title,
                        dateKey,
                        id: removed.id,
                        notes: `Moved to Recycle Bin (bulk)`
                    });
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

        closeStatusPopup();
        viewContext = { kind: 'schedule', trashId: null, dateKey, id: scheduleId };
        viewOverlay.classList.remove('trash-context');
        viewTrashDetails.style.display = 'none';
        viewStatusRow.style.display = 'block';
        recoverFromViewBtn.style.display = 'none';
        if (changeStatusFromViewBtn) changeStatusFromViewBtn.style.display = 'inline-flex';
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

        viewContext = { kind: 'trash', trashId, dateKey: null, id: null };
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

        if (changeStatusFromViewBtn) changeStatusFromViewBtn.style.display = 'none';
        recoverFromViewBtn.style.display = 'inline-flex';
        viewOverlay.classList.add('active');
    }

    function closeViewModal() {
        closeStatusPopup();
        viewOverlay.classList.remove('active');
        viewOverlay.classList.remove('trash-context');
        viewTrashDetails.style.display = 'none';
        recoverFromViewBtn.style.display = 'none';
        if (changeStatusFromViewBtn) changeStatusFromViewBtn.style.display = 'none';
        viewContext = { kind: 'schedule', trashId: null, dateKey: null, id: null };

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
        updateTitleWordCounter();

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
        updateTitleWordCounter();

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
        const startVal = startPicker ? startPicker.getValue() : '';
        const endVal   = endPicker   ? endPicker.getValue()   : '';

        if (!titleVal) errors.push('Title is required.');
        const titleWords = countWords(titleVal);
        if (titleWords > 30) {
            errors.push(`Title must be 30 words or fewer (currently ${titleWords}).`);
        }
        if (!descVal) errors.push('Description is required.');
        if (!resolvedType) errors.push('Schedule type is required — pick a button or specify "Other".');
        if (!startVal) errors.push('Start time is required.');
        if (!endVal) errors.push('End time is required.');
        if (startVal && endVal) {
            const s = parseTimeToMinutes12h(startVal);
            const e = parseTimeToMinutes12h(endVal);
            if (s != null && e != null && e < s) {
                errors.push('End time must be after start time.');
            }
        }

        return errors;
    }

    function highlightInvalidFields() {
        const titleField = scheduleTitle.closest('.field');
        const descField = scheduleDescription.closest('.field');
        const typeField = typeButtonGroup.closest('.field');
        const timeField = document.querySelector('.time-row').closest('.field');

        const titleTrimmed = scheduleTitle.value.trim();
        if (!titleTrimmed || countWords(titleTrimmed) > 30) titleField.classList.add('invalid');
        else titleField.classList.remove('invalid');

        if (!scheduleDescription.value.trim()) descField.classList.add('invalid');
        else descField.classList.remove('invalid');

        if (!getResolvedType().trim()) typeField.classList.add('invalid');
        else typeField.classList.remove('invalid');

        const startVal = startPicker ? startPicker.getValue() : '';
        const endVal   = endPicker   ? endPicker.getValue()   : '';
        if (!startVal || !endVal) timeField.classList.add('invalid');
        else timeField.classList.remove('invalid');

        if (startPickerEl) startPickerEl.classList.remove('invalid');
        if (endPickerEl) endPickerEl.classList.remove('invalid');
        if (!startVal && startPickerEl) startPickerEl.classList.add('invalid');
        if (!endVal && endPickerEl) endPickerEl.classList.add('invalid');
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
        updateTitleWordCounter();

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
            const newSched = {
                id: uid(),
                title: newData.title,
                description: newData.description,
                type: newData.type,
                time: newData.time || '',
                status: normalizeStatus(newData.status),
                createdAt: new Date().toISOString()
            };
            maybeMarkLate(dateKey, newSched);
            schedules[dateKey].push(newSched);
        }

        scheduleSave();
        renderCalendar();
        renderNotifications();

        const shouldReopenHistory = reopenHistoryAfterEdit;
        reopenHistoryAfterEdit = false;

        closeReviewModal();
        modalOverlay.classList.remove('active');

        if (mode === 'edit' && id) {
            logHistory({
                action: 'edited',
                title: newData.title,
                dateKey,
                id,
                notes: `Updated schedule on ${dateKey}`
            });
        } else {
            const last = (schedules[dateKey] || []).slice(-1)[0];
            logHistory({
                action: 'added',
                title: newData.title,
                dateKey,
                id: last ? last.id : '',
                notes: `Added new schedule on ${dateKey}`
            });
        }

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
    // HISTORY (audit log via Supabase)
    // ============================================================
    function sortHistoryEntries(list, sort) {
        const arr = [...list];
        const kind = (sort && sort.kind) || 'date-created';
        const order = (sort && sort.order) === 'asc' ? 1 : -1;

        function entryTimestampMs(entry) {
            if (entry.dateKey) {
                const base = getDateFromKey(entry.dateKey);
                const t = parseScheduleTimeRange(entry.time || '');
                if (t) {
                    base.setHours(Math.floor(t.startMin / 60), t.startMin % 60, 0, 0);
                }
                return base.getTime();
            }
            const at = new Date(entry.at || 0).getTime();
            return isNaN(at) ? 0 : at;
        }

        arr.sort((a, b) => {
            if (kind === 'title') {
                const cmp = (a.title || '').localeCompare(
                    b.title || '',
                    undefined,
                    { sensitivity: 'base', numeric: true }
                );
                return cmp * order;
            }

            const aT = entryTimestampMs(a);
            const bT = entryTimestampMs(b);
            if (aT !== bT) return (aT - bT) * order;

            const aC = new Date(a.at || 0).getTime() || 0;
            const bC = new Date(b.at || 0).getTime() || 0;
            return (aC - bC) * order;
        });

        return arr;
    }

    function populateHistoryYearFilter() {
        const years = new Set();
        years.add(new Date().getFullYear());

        Object.keys(schedules).forEach(dateKey => {
            const y = dateKey.split('-')[0];
            if (y) years.add(parseInt(y, 10));
        });
        historyLogCache.forEach(e => {
            if (e.dateKey) {
                const y = e.dateKey.split('-')[0];
                if (y) years.add(parseInt(y, 10));
            }
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

        const query = historySearch.value.trim().toLowerCase();
        const yearFilter = historyYearFilter.value;
        const monthFilter = historyMonthFilter.value;

        let filtered = historyLogCache;

        if (yearFilter !== 'all') {
            filtered = filtered.filter(e => (e.dateKey || '').startsWith(yearFilter + '-'));
        }
        if (monthFilter !== 'all') {
            const mm = String(monthFilter).padStart(2, '0');
            filtered = filtered.filter(e => (e.dateKey || '').slice(5, 7) === mm);
        }
        if (query) {
            filtered = filtered.filter(e =>
                (e.title || '').toLowerCase().includes(query) ||
                (e.notes || '').toLowerCase().includes(query) ||
                (e.action || '').toLowerCase().includes(query)
            );
        }

        filtered = sortHistoryEntries(filtered, historySort);
        updateSortIcon(historySortBtn, historySort);
        syncSortPopover(historySortPopover, historySort);

        totalSchedulesCount.textContent = historyLogTotalCount;
        totalDaysCount.textContent = new Set(filtered.map(e => e.dateKey).filter(Boolean)).size;
        totalMonthsCount.textContent = new Set(
            filtered.map(e => (e.dateKey || '').slice(0, 7)).filter(Boolean)
        ).size;

        if (filtered.length === 0) {
            historyList.innerHTML = `
                <div class="history-empty">
                    <i class="fas fa-folder-open"></i>
                    No history entries${query ? ' match your search' : ''}.<br>
                    <span style="font-size:0.72rem; color:#cbd5e1; margin-top:4px; display:inline-block;">
                        Every add, edit, status change, and delete will appear here — from all your devices.
                    </span>
                </div>
            `;
            clearAllHistoryBtn.style.display = historyLogTotalCount > 0 ? 'inline-flex' : 'none';
            renderHistoryPager(0);
            return;
        }

        const ACTION_META = {
            added:     { label: 'Added',     icon: 'fa-plus-circle',  cls: 'action-added' },
            edited:    { label: 'Edited',    icon: 'fa-pen',           cls: 'action-edited' },
            status:    { label: 'Status',    icon: 'fa-exchange-alt',  cls: 'action-status' },
            deleted:   { label: 'Deleted',   icon: 'fa-trash-alt',     cls: 'action-deleted' },
            recovered: { label: 'Recovered', icon: 'fa-undo-alt',      cls: 'action-recovered' },
            imported:  { label: 'Imported',  icon: 'fa-file-import',   cls: 'action-imported' }
        };

        let html = '';
        filtered.forEach(e => {
            const meta = ACTION_META[e.action] || { label: e.action, icon: 'fa-info-circle', cls: 'action-status' };
            const dateObj = e.dateKey ? getDateFromKey(e.dateKey) : null;
            const dateLabel = dateObj
                ? dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
                : '—';
            const atLabel = e.at ? formatDateTime(e.at) : '—';

            html += `
                <div class="history-log-item ${meta.cls}">
                    <div class="hl-accent"></div>
                    <div class="hl-body">
                        <div class="hl-top">
                            <span class="hl-action-badge">
                                <i class="fas ${meta.icon}"></i> ${meta.label}
                            </span>
                            <span class="hl-title">${escapeHtml(e.title)}</span>
                        </div>
                        <div class="hl-meta">
                            <span><i class="fas fa-calendar-day"></i> ${escapeHtml(dateLabel)}</span>
                            <span><i class="fas fa-clock"></i> ${escapeHtml(atLabel)}</span>
                        </div>
                        ${e.notes ? `<div class="hl-notes">${escapeHtml(e.notes)}</div>` : ''}
                    </div>
                </div>
            `;
        });

        historyList.innerHTML = html;
        clearAllHistoryBtn.style.display = historyLogTotalCount > 0 ? 'inline-flex' : 'none';

        const totalPages = Math.ceil(historyLogTotalCount / HISTORY_LOG_PAGE_SIZE);
        renderHistoryPager(totalPages);
    }

    function renderHistoryPager(totalPages) {
        const pager = document.getElementById('historyPager');
        const dots = document.getElementById('historyPagerDots');
        const prev = document.getElementById('historyPrevBtn');
        const next = document.getElementById('historyNextBtn');
        if (!pager || !dots || !prev || !next) return;

        if (!totalPages || totalPages <= 1) {
            pager.style.display = 'none';
            return;
        }
        pager.style.display = 'flex';
        prev.disabled = historyLogPage === 0;
        next.disabled = historyLogPage === totalPages - 1;

        const MAX_DOTS = 5;
        const current = historyLogPage;
        let start = Math.max(0, current - Math.floor(MAX_DOTS / 2));
        let end = Math.min(totalPages - 1, start + MAX_DOTS - 1);
        start = Math.max(0, end - MAX_DOTS + 1);

        const pages = [];
        for (let i = start; i <= end; i++) pages.push(i);

        let dotsHtml = '';
        pages.forEach((i, idx) => {
            const isFirst = idx === 0;
            const isLast = idx === pages.length - 1;
            const gapBefore = isFirst && i > 0;
            const gapAfter = isLast && i < totalPages - 1;

            if (gapBefore) {
                dotsHtml += `<span class="history-pager-gap">…</span>`;
            }
            dotsHtml += `<button type="button" class="history-pager-dot${i === current ? ' active' : ''}" data-page="${i}" aria-label="Page ${i + 1}"></button>`;
            if (gapAfter) {
                dotsHtml += `<span class="history-pager-gap">…</span>`;
            }
        });

        dots.innerHTML = dotsHtml;

        dots.querySelectorAll('.history-pager-dot').forEach(dot => {
            dot.addEventListener('click', () => {
                const page = parseInt(dot.dataset.page, 10) || 0;
                if (page === historyLogPage) return;
                historyLogPage = page;
                historyLogLoading = false;
                fetchHistoryLog().then(() => renderHistory());
            });
        });

        prev.onclick = () => {
            if (historyLogPage > 0) {
                historyLogPage--;
                historyLogLoading = false;
                fetchHistoryLog().then(() => renderHistory());
            }
        };
        next.onclick = () => {
            if (historyLogPage < totalPages - 1) {
                historyLogPage++;
                historyLogLoading = false;
                fetchHistoryLog().then(() => renderHistory());
            }
        };
    }

    function openHistoryModal() {
        historySearch.value = '';
        historyYearFilter.value = 'all';
        historyMonthFilter.value = 'all';

        historyOverlay.classList.add('active');
        historyLogPage = 0;
        historyLogLoading = false;

        historyList.innerHTML = `
            <div class="history-loading">
                <div class="history-loading-dots">
                    <span></span><span></span><span></span>
                </div>
                <div class="history-loading-caption">Loading history</div>
            </div>
        `;

        fetchHistoryLog().then(() => {
            if (historyOverlay.classList.contains('active')) renderHistory();
        });
    }

    function closeHistoryModal() {
        historyOverlay.classList.remove('active');
        closeSortPopovers();
    }

    function clearAllHistory() {
        const allLogs = historyLogCache;
        if (allLogs.length === 0) return;

        openConfirmModal({
            title: 'Clear Schedule History?',
            message: `${historyLogTotalCount} history entr${historyLogTotalCount === 1 ? 'y' : 'ies'} will be removed from all devices. Your schedules will NOT be deleted.`,
            okText: 'Clear History',
            iconClass: 'warning',
            onConfirm: async () => {
                try {
                    const supabase = getSupabase();
                    const { error } = await supabase
                        .from('schedule_history')
                        .delete()
                        .neq('id', '00000000-0000-0000-0000-000000000000');
                    if (error) throw error;

                    historyLogCache = [];
                    historyLogTotalCount = 0;
                    historyLogPage = 0;
                    renderHistory();
                } catch (err) {
                    console.error('Clear history error:', err);
                    alert('Could not clear history: ' + err.message);
                }
            }
        });
    }

    // ============================================================
    // BULK DELETE (grouped by Year / Month) — Recycle Bin only
    // ============================================================
    function bulkDeleteOpen() {
        bulkDeleteSelection.clear();
        bulkDeleteExpandedYears.clear();
        bulkDeleteExpandedMonths.clear();
        bulkDeleteSearch.value = '';
        bulkDeleteOverlay.classList.add('active');
        renderBulkDeleteTree();
    }

    function bulkDeleteClose() {
        bulkDeleteOverlay.classList.remove('active');
        bulkDeleteSelection.clear();
        bulkDeleteExpandedYears.clear();
        bulkDeleteExpandedMonths.clear();
    }

    function buildBulkDeleteTree(filterQuery) {
        const q = (filterQuery || '').trim().toLowerCase();
        const groups = {};

        Object.keys(schedules).forEach(dateKey => {
            const list = schedules[dateKey] || [];
            if (list.length === 0) return;
            const [yearStr, monthStr] = dateKey.split('-');
            const year = parseInt(yearStr, 10);
            const month = parseInt(monthStr, 10);

            list.forEach(s => {
                if (q) {
                    const haystack = (s.title + ' ' + (s.description || '')).toLowerCase();
                    if (!haystack.includes(q)) return;
                }
                if (!groups[year]) groups[year] = {};
                if (!groups[year][month]) groups[year][month] = [];
                groups[year][month].push({
                    id: s.id,
                    title: s.title,
                    description: s.description || '',
                    dateKey,
                    time: s.time || '',
                    status: normalizeStatus(s.status),
                    type: s.type || '',
                    lateMarked: !!s.lateMarked
                });
            });
        });

        Object.keys(groups).forEach(year => {
            Object.keys(groups[year]).forEach(month => {
                groups[year][month].sort((a, b) => {
                    if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
                    const ra = parseScheduleTimeRange(a.time);
                    const rb = parseScheduleTimeRange(b.time);
                    const sa = ra ? ra.startMin : Number.MAX_SAFE_INTEGER;
                    const sb = rb ? rb.startMin : Number.MAX_SAFE_INTEGER;
                    return sa - sb;
                });
            });
        });

        return groups;
    }

    function countSchedulesInMonth(groups, year, month) {
        return (groups[year] && groups[year][month]) ? groups[year][month].length : 0;
    }
    function countSchedulesInYear(groups, year) {
        if (!groups[year]) return 0;
        return Object.values(groups[year]).reduce((a, b) => a + b.length, 0);
    }
    function countSelectedInMonth(groups, year, month) {
        if (!groups[year] || !groups[year][month]) return 0;
        return groups[year][month].reduce((acc, s) => acc + (bulkDeleteSelection.has(s.id) ? 1 : 0), 0);
    }
    function countSelectedInYear(groups, year) {
        if (!groups[year]) return 0;
        let n = 0;
        Object.keys(groups[year]).forEach(m => {
            groups[year][m].forEach(s => { if (bulkDeleteSelection.has(s.id)) n++; });
        });
        return n;
    }

    function renderBulkDeleteTree() {
        const groups = buildBulkDeleteTree(bulkDeleteSearch.value);
        const years = Object.keys(groups).map(y => parseInt(y, 10)).sort((a, b) => b - a);

        let total = 0;
        years.forEach(y => { total += countSchedulesInYear(groups, y); });

        bulkDeleteSelectedCount.textContent = String(bulkDeleteSelection.size);
        bulkDeleteTotalCount.textContent = String(total);
        if (bulkDeleteMoveToBinBtn) {
            bulkDeleteMoveToBinBtn.disabled = bulkDeleteSelection.size === 0;
        }

        const validIds = new Set();
        years.forEach(y => Object.keys(groups[y]).forEach(m => groups[y][m].forEach(s => validIds.add(s.id))));
        Array.from(bulkDeleteSelection).forEach(id => {
            if (!validIds.has(id)) bulkDeleteSelection.delete(id);
        });

        if (total === 0) {
            bulkDeleteTree.innerHTML = '';
            bulkDeleteEmpty.style.display = 'block';
            return;
        }
        bulkDeleteEmpty.style.display = 'none';

        const monthNamesFull = monthNames;
        let html = '';

        years.forEach(year => {
            const yearTotal = countSchedulesInYear(groups, year);
            const yearSelected = countSelectedInYear(groups, year);
            const yearAllSelected = yearSelected === yearTotal && yearTotal > 0;
            const yearOpen = bulkDeleteExpandedYears.has(year);

            html += `
                <div class="bulk-delete-year ${yearOpen ? 'open' : ''}" data-year="${year}">
                    <div class="bulk-delete-year-header">
                        <input type="checkbox" class="bulk-delete-year-checkbox"
                               data-year-checkbox="${year}"
                               ${yearAllSelected ? 'checked' : ''}>
                        <button type="button" class="bulk-delete-toggle-year" data-year-toggle="${year}">
                            <i class="fas fa-chevron-${yearOpen ? 'down' : 'right'}"></i>
                            <span class="bulk-delete-year-label">${year}</span>
                            <span class="bulk-delete-count">${yearTotal} schedule${yearTotal === 1 ? '' : 's'}</span>
                            ${yearSelected > 0 ? `<span class="bulk-delete-selected-pill">${yearSelected} selected</span>` : ''}
                        </button>
                    </div>
            `;

            if (yearOpen) {
                const months = Object.keys(groups[year]).map(m => parseInt(m, 10)).sort((a, b) => b - a);
                html += `<div class="bulk-delete-year-body">`;

                months.forEach(month => {
                    const mTotal = countSchedulesInMonth(groups, year, month);
                    const mSelected = countSelectedInMonth(groups, year, month);
                    const mAll = mSelected === mTotal && mTotal > 0;
                    const mOpen = bulkDeleteExpandedMonths.has(`${year}-${month}`);
                    const monthLabel = monthNamesFull[month - 1];

                    html += `
                        <div class="bulk-delete-month ${mOpen ? 'open' : ''}" data-year="${year}" data-month="${month}">
                            <div class="bulk-delete-month-header">
                                <input type="checkbox" class="bulk-delete-month-checkbox"
                                       data-year-checkbox-month="${year}-${month}"
                                       ${mAll ? 'checked' : ''}>
                                <button type="button" class="bulk-delete-toggle-month" data-year-toggle-month="${year}-${month}">
                                    <i class="fas fa-chevron-${mOpen ? 'down' : 'right'}"></i>
                                    <span class="bulk-delete-month-label">${monthLabel}</span>
                                    <span class="bulk-delete-count">${mTotal} schedule${mTotal === 1 ? '' : 's'}</span>
                                    ${mSelected > 0 ? `<span class="bulk-delete-selected-pill">${mSelected} selected</span>` : ''}
                                </button>
                            </div>
                    `;

                    if (mOpen) {
                        html += `<div class="bulk-delete-month-body">`;
                        groups[year][month].forEach(s => {
                            const checked = bulkDeleteSelection.has(s.id);
                            const dObj = getDateFromKey(s.dateKey);
                            const dLabel = dObj.toLocaleDateString('en-US', {
                                weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
                            });
                            const timeLabel = s.time ? ` • ${escapeHtml(s.time)}` : '';
                            html += `
                                <label class="bulk-delete-item">
                                    <input type="checkbox" class="bulk-delete-item-checkbox"
                                           data-item-id="${s.id}"
                                           ${checked ? 'checked' : ''}>
                                    <div class="bulk-delete-item-body">
                                        <div class="bulk-delete-item-title">${escapeHtml(s.title)}</div>
                                        <div class="bulk-delete-item-meta">
                                            <span><i class="fas fa-calendar-day"></i> ${escapeHtml(dLabel)}${timeLabel}</span>
                                            ${s.type ? renderTypeBadge(s.type) : ''}
                                        </div>
                                    </div>
                                </label>
                            `;
                        });
                        html += `</div>`;
                    }

                    html += `</div>`;
                });

                html += `</div>`;
            }

            html += `</div>`;
        });

        bulkDeleteTree.innerHTML = html;

        years.forEach(year => {
            const yearCb = bulkDeleteTree.querySelector(`[data-year-checkbox="${year}"]`);
            const yTotal = countSchedulesInYear(groups, year);
            const ySel = countSelectedInYear(groups, year);
            if (yearCb) yearCb.indeterminate = ySel > 0 && ySel < yTotal;

            Object.keys(groups[year]).forEach(m => {
                const monthCb = bulkDeleteTree.querySelector(`[data-year-checkbox-month="${year}-${m}"]`);
                if (!monthCb) return;
                const mTotal = countSchedulesInMonth(groups, year, parseInt(m, 10));
                const mSel = countSelectedInMonth(groups, year, parseInt(m, 10));
                monthCb.indeterminate = mSel > 0 && mSel < mTotal;
            });
        });

        bulkDeleteTree.querySelectorAll('[data-year-checkbox]').forEach(cb => {
            cb.addEventListener('change', () => {
                const year = parseInt(cb.dataset.yearCheckbox, 10);
                const target = groups[year] || {};
                const allIds = [];
                Object.keys(target).forEach(m => target[m].forEach(s => allIds.push(s.id)));
                if (cb.checked) allIds.forEach(id => bulkDeleteSelection.add(id));
                else allIds.forEach(id => bulkDeleteSelection.delete(id));
                renderBulkDeleteTree();
            });
        });

        bulkDeleteTree.querySelectorAll('[data-year-checkbox-month]').forEach(cb => {
            cb.addEventListener('change', () => {
                const [yearStr, monthStr] = cb.dataset.yearCheckboxMonth.split('-');
                const year = parseInt(yearStr, 10);
                const month = parseInt(monthStr, 10);
                const list = (groups[year] && groups[year][month]) || [];
                if (cb.checked) list.forEach(s => bulkDeleteSelection.add(s.id));
                else list.forEach(s => bulkDeleteSelection.delete(s.id));
                renderBulkDeleteTree();
            });
        });

        bulkDeleteTree.querySelectorAll('[data-item-id]').forEach(cb => {
            cb.addEventListener('change', () => {
                const id = cb.dataset.itemId;
                if (cb.checked) bulkDeleteSelection.add(id);
                else bulkDeleteSelection.delete(id);
                renderBulkDeleteTree();
            });
        });

        bulkDeleteTree.querySelectorAll('[data-year-toggle]').forEach(btn => {
            btn.addEventListener('click', () => {
                const year = parseInt(btn.dataset.yearToggle, 10);
                if (bulkDeleteExpandedYears.has(year)) bulkDeleteExpandedYears.delete(year);
                else bulkDeleteExpandedYears.add(year);
                renderBulkDeleteTree();
            });
        });

        bulkDeleteTree.querySelectorAll('[data-year-toggle-month]').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.yearToggleMonth;
                if (bulkDeleteExpandedMonths.has(key)) bulkDeleteExpandedMonths.delete(key);
                else bulkDeleteExpandedMonths.add(key);
                renderBulkDeleteTree();
            });
        });
    }

    function bulkDeleteApplyMoveToBin() {
        if (bulkDeleteSelection.size === 0) return;
        const ids = Array.from(bulkDeleteSelection);
        const count = ids.length;

        openConfirmModal({
            title: `Move ${count} schedule${count === 1 ? '' : 's'} to Recycle Bin?`,
            message: `The selected schedule${count === 1 ? '' : 's'} will be moved to the Recycle Bin. You can recover them from Settings → Recycle Bin.`,
            okText: 'Move to Bin',
            iconClass: 'warning',
            onConfirm: () => {
                let moved = 0;
                ids.forEach(id => {
                    Object.keys(schedules).forEach(dateKey => {
                        const list = schedules[dateKey] || [];
                        const idx = list.findIndex(s => s.id === id);
                        if (idx === -1) return;
                        const [removed] = list.splice(idx, 1);
                        if (list.length === 0) delete schedules[dateKey];
                        removed.dateKey = dateKey;
                        removed.deletedAt = new Date().toISOString();
                        trash.push(removed);
                        moved++;

                        logHistory({
                            action: 'deleted',
                            title: removed.title,
                            dateKey,
                            id: removed.id,
                            notes: 'Moved to Recycle Bin (bulk from Settings)'
                        });
                    });
                });

                bulkDeleteSelection.clear();
                scheduleSave();
                renderCalendar();
                renderNotifications();
                renderBulkDeleteTree();
                if (trashOverlay.classList.contains('active')) renderTrash();
                if (historyOverlay.classList.contains('active')) renderHistory();

                bulkDeleteClose();
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

        logHistory({
            action: 'recovered',
            title: item.title,
            dateKey: key,
            id: item.id,
            notes: `Restored from Recycle Bin`
        });
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

                logHistory({
                    action: 'deleted',
                    title: item.title,
                    dateKey: item.dateKey || '',
                    id: item.id,
                    notes: `Permanently deleted`
                });
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

            logHistory({
                action: 'recovered',
                title: item.title,
                dateKey: key,
                id: item.id,
                notes: `Restored from Recycle Bin (bulk)`
            });
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
                trashSelection.forEach(id => {
                    const old = trash.find(t => t.id === id);
                    if (old) {
                        logHistory({
                            action: 'deleted',
                            title: old.title,
                            dateKey: old.dateKey || '',
                            id: old.id,
                            notes: `Permanently deleted (bulk)`
                        });
                    }
                });
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
                trash.forEach(t => {
                    logHistory({
                        action: 'deleted',
                        title: t.title,
                        dateKey: t.dateKey || '',
                        id: t.id,
                        notes: `Permanently deleted (empty bin)`
                    });
                });
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
                    id: s.id,
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
                        <th class="ep-actions-head">View</th>
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

            const descCell = r.description
                ? `<span class="ep-desc" title="${escapeHtml(r.description)}">${escapeHtml(r.description)}</span>`
                : `<span style="color:#cbd5e1;">No description</span>`;

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
                    <td class="ep-desc-cell">${descCell}</td>
                    <td class="ep-actions-cell">
                        <button type="button"
                                class="ep-eye-btn"
                                data-export-view-id="${r.id}"
                                data-export-view-date="${r.dateKey}"
                                title="View full schedule">
                            <i class="fas fa-eye"></i>
                        </button>
                    </td>
                </tr>
            `;
        });

        html += '</tbody></table>';
        exportPreviewScroll.innerHTML = html;

        exportPreviewScroll.querySelectorAll('.ep-eye-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.exportViewId;
                const dateKey = btn.dataset.exportViewDate;
                if (!id || !dateKey) return;
                openViewModal(dateKey, id);
            });
        });
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

    function buildExportYearLabel() {
        const years = Array.from(exportSelectedYears).filter(y => !isNaN(y)).sort((a, b) => a - b);
        if (years.length === 0) {
            return String(new Date().getFullYear());
        }
        if (years.length === 1) {
            return String(years[0]);
        }

        const isContiguous = years.every((y, i) => i === 0 || y === years[i - 1] + 1);
        if (isContiguous) {
            return `${years[0]}-${years[years.length - 1]}`;
        }

        const parts = [];
        let runStart = years[0];
        let prev = years[0];
        for (let i = 1; i < years.length; i++) {
            const y = years[i];
            if (y === prev + 1) {
                prev = y;
                continue;
            }
            parts.push(runStart === prev ? String(runStart) : `${runStart}-${prev}`);
            runStart = y;
            prev = y;
        }
        parts.push(runStart === prev ? String(runStart) : `${runStart}-${prev}`);
        return parts.join('_');
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

        const yearLabel = buildExportYearLabel();
        XLSX.writeFile(wb, `SCHEDULE_${yearLabel}.xlsx`);
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
            const newSched = {
                id: uid(),
                title: r.title,
                description: r.description,
                type: r.type,
                time: r.time || '',
                status: normalizeStatus(r.status),
                lateMarked: !!r.lateMarked,
                createdAt: now
            };
            if (!newSched.lateMarked) {
                maybeMarkLate(dateKey, newSched);
            }
            schedules[dateKey].push(newSched);
            added++;
            perDateCounts[dateKey] = (perDateCounts[dateKey] || 0) + 1;
        });

        sweepLateOnAllPastSchedules();

        if (currentImportFile) {
            recordImportSignature(currentImportFile);
        }
        recordRecentImport(currentImportFile ? currentImportFile.name : 'Imported file', added);

        scheduleSave();
        renderCalendar();
        renderNotifications();
        if (historyOverlay.classList.contains('active')) renderHistory();

        logHistory({
            action: 'imported',
            title: `${added} schedule${added === 1 ? '' : 's'} imported`,
            dateKey: '',
            notes: `Imported from ${currentImportFile ? currentImportFile.name : 'Excel file'}`
        });

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
    // LOGO → CAT LOADER → REFRESH
    // ============================================================
    const headerLogo = document.getElementById('headerLogo');

    function showLoaderAndReload() {
        if (window.CatLoader) {
            window.CatLoader.showAndReload(5000);
            return;
        }
        if (window.CatLoader === undefined) {
            setTimeout(() => {
                if (window.CatLoader) {
                    window.CatLoader.showAndReload(5000);
                } else {
                    window.location.reload();
                }
            }, 50);
            return;
        }
        window.location.reload();
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

    if (openBulkDeleteBtn) {
        openBulkDeleteBtn.addEventListener('click', () => {
            closeSettingsModal();
            bulkDeleteOpen();
        });
    }

    if (bulkDeleteCancelBtn) bulkDeleteCancelBtn.addEventListener('click', bulkDeleteClose);
    if (bulkDeleteOverlay) {
        bulkDeleteOverlay.addEventListener('click', (e) => {
            if (e.target === bulkDeleteOverlay) bulkDeleteClose();
        });
    }
    if (bulkDeleteSearch) {
        bulkDeleteSearch.addEventListener('input', () => {
            renderBulkDeleteTree();
        });
    }
    if (bulkDeleteExpandAllBtn) {
        bulkDeleteExpandAllBtn.addEventListener('click', () => {
            const groups = buildBulkDeleteTree(bulkDeleteSearch.value);
            Object.keys(groups).forEach(y => {
                bulkDeleteExpandedYears.add(parseInt(y, 10));
                Object.keys(groups[y]).forEach(m => bulkDeleteExpandedMonths.add(`${y}-${m}`));
            });
            renderBulkDeleteTree();
        });
    }
    if (bulkDeleteCollapseAllBtn) {
        bulkDeleteCollapseAllBtn.addEventListener('click', () => {
            bulkDeleteExpandedYears.clear();
            bulkDeleteExpandedMonths.clear();
            renderBulkDeleteTree();
        });
    }
    if (bulkDeleteMoveToBinBtn) bulkDeleteMoveToBinBtn.addEventListener('click', bulkDeleteApplyMoveToBin);

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
                historyLogCache = [];
                historyLogTotalCount = 0;

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
                viewContext = { kind: 'schedule', trashId: null, dateKey: null, id: null };

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
                bulkDeleteOverlay.classList.remove('active');
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

    if (changeStatusFromViewBtn) {
        changeStatusFromViewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (viewContext.kind !== 'schedule' || !viewContext.dateKey || !viewContext.id) return;
            const sched = (schedules[viewContext.dateKey] || []).find(s => s.id === viewContext.id);
            if (!sched) return;

            const currentStatus = normalizeStatus(sched.status);
            openStatusPicker(changeStatusFromViewBtn, viewContext.dateKey, viewContext.id, currentStatus);
        });
    }

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

    closeDayListXBtn.addEventListener('click', closeDayListModal);
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
        updateTitleWordCounter();
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
            if (openStatusPopup) { closeStatusPopup(true); return; }
            if (importSuccessOverlay.classList.contains('active')) { closeImportSuccessModal(); return; }
            if (notifPanel && notifPanel.classList.contains('open')) { closeNotifPanel(); return; }
            if (validationOverlay.classList.contains('active')) { closeValidationModal(); return; }
            if (confirmOverlay.classList.contains('active')) { closeConfirmModal(); return; }
            if (viewOverlay.classList.contains('active')) { closeViewModal(); return; }
            if (reviewOverlay.classList.contains('active')) { goBackToForm(); return; }
            if (bulkDeleteOverlay.classList.contains('active')) { bulkDeleteClose(); return; }
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
        fetchHistoryLog();
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
