// storage.js
// ============================================================
//  DATA LAYER — owns all schedule + trash state and mutations
//  Exposed globally as `window.Store`
//  Includes: localStorage cache + Firebase cross-device sync
//  No DOM access here. Pure data operations only.
// ============================================================
(function () {
    'use strict';

    // ============================================================
    //  FIREBASE CONFIG — paste your own values from Firebase Console
    //  (console.firebase.google.com → Project settings → Your apps)
    // ============================================================
    const firebaseConfig = {
        apiKey: "YOUR_API_KEY",
        authDomain: "YOUR_PROJECT.firebaseapp.com",
        databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
        projectId: "YOUR_PROJECT",
        storageBucket: "YOUR_PROJECT.appspot.com",
        messagingSenderId: "YOUR_SENDER_ID",
        appId: "YOUR_APP_ID"
    };

    // A "room" id — every device that uses the same DOC_ID shares the same data.
    // Change this to a random string for a private shared schedule.
    const DOC_ID = 'main';
    const ROOT_PATH = `schedules/${DOC_ID}`;
    const LS_SCHEDULES = 'sms.schedules';
    const LS_TRASH = 'sms.trash';

    // ---------- INTERNAL STATE ----------
    let schedules = {};
    let trash = [];

    // ---------- FIREBASE STATE ----------
    let firebaseReady = false;
    let dbRef = null;
    let pushListener = null;
    let cloudHydrated = false;
    let pendingWrites = 0;

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

    function newId() {
        return 'sched_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    }

    // ============================================================
    //  LOCALSTORAGE CACHE
    // ============================================================
    function persistLocal() {
        try {
            localStorage.setItem(LS_SCHEDULES, JSON.stringify(schedules));
            localStorage.setItem(LS_TRASH, JSON.stringify(trash));
        } catch (e) {
            console.warn('localStorage persist failed:', e);
        }
    }

    function hydrateLocal() {
        try {
            const s = JSON.parse(localStorage.getItem(LS_SCHEDULES) || 'null');
            const t = JSON.parse(localStorage.getItem(LS_TRASH) || 'null');
            if (s && typeof s === 'object' && !Array.isArray(s)) schedules = s;
            if (Array.isArray(t)) trash = t;
        } catch (e) {
            console.warn('localStorage hydrate failed:', e);
        }
    }

    // ============================================================
    //  FIREBASE CLOUD SYNC
    // ============================================================
    function initFirebase() {
        try {
            if (typeof firebase === 'undefined') {
                console.warn('Firebase SDK not loaded — falling back to localStorage only.');
                return false;
            }
            if (!firebase.apps || firebase.apps.length === 0) {
                firebase.initializeApp(firebaseConfig);
            }
            dbRef = firebase.database().ref(ROOT_PATH);
            firebaseReady = true;
            console.log('[storage] Firebase connected →', ROOT_PATH);
            return true;
        } catch (e) {
            console.error('Firebase init failed:', e);
            firebaseReady = false;
            return false;
        }
    }

    function cloudWrite() {
        if (!firebaseReady || !dbRef) return;
        pendingWrites++;
        dbRef.set({
            schedules: schedules,
            trash: trash,
            updatedAt: Date.now()
        }).then(() => {
            pendingWrites--;
        }).catch(err => {
            pendingWrites--;
            console.error('Cloud write failed:', err);
        });
    }

    function cloudApply(snapshot) {
        const data = snapshot.val();

        if (pendingWrites > 0) return;

        if (!data) {
            cloudHydrated = true;
            cloudWrite();
            return;
        }

        schedules = (data.schedules && typeof data.schedules === 'object') ? data.schedules : {};
        trash = Array.isArray(data.trash) ? data.trash : [];

        cloudHydrated = true;
        persistLocal();

        if (typeof window.onScheduleDataChanged === 'function') {
            try { window.onScheduleDataChanged(); }
            catch (e) { console.error('onScheduleDataChanged threw:', e); }
        }
    }

    function subscribeCloud() {
        if (!firebaseReady || !dbRef) return;
        if (pushListener) dbRef.off('value', pushListener);
        pushListener = dbRef.on('value', cloudApply, (err) => {
            console.error('Cloud subscription error:', err);
        });
    }

    function persist() {
        persistLocal();
        cloudWrite();
    }

    // ============================================================
    //  SEED
    // ============================================================
    function seedSampleData() {
        const today = new Date();
        const nowIso = new Date().toISOString();

        schedules[formatDateKey(today)] = [
            { id: 's_today', title: 'Daily standup', description: 'Quick sync with the team', type: 'Meeting', createdAt: nowIso }
        ];

        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        schedules[formatDateKey(tomorrow)] = [
            { id: 's3', title: 'Client call', description: 'Follow-up on proposal and next steps', type: 'Meeting', createdAt: nowIso }
        ];

        const inTwoDays = new Date(today);
        inTwoDays.setDate(inTwoDays.getDate() + 2);
        schedules[formatDateKey(inTwoDays)] = [
            { id: 's4', title: 'Gym session', description: 'Leg day — bring water', type: 'Other', createdAt: nowIso }
        ];

        const sampleDate = new Date(today.getFullYear(), today.getMonth(), 15);
        const sampleKey = formatDateKey(sampleDate);
        if (
            sampleKey !== formatDateKey(today) &&
            sampleKey !== formatDateKey(tomorrow) &&
            sampleKey !== formatDateKey(inTwoDays)
        ) {
            schedules[sampleKey] = [
                { id: 's1', title: 'Project kickoff', description: 'Discuss scope and timeline for Q2 launch', type: 'Meeting', createdAt: nowIso },
                { id: 's2', title: 'Design review', description: 'Review new mockups with the product team', type: 'Seminar', createdAt: nowIso }
            ];
        }
    }

    // ============================================================
    //  BOOTSTRAP
    // ============================================================
    hydrateLocal();
    if (Object.keys(schedules).length === 0) seedSampleData();

    if (initFirebase()) {
        subscribeCloud();
    } else {
        persistLocal();
    }

    // ============================================================
    //  PUBLIC API
    // ============================================================
    const Store = {

        // ---------- READ ----------
        getSchedulesForDate(dateKey) {
            return Array.isArray(schedules[dateKey]) ? schedules[dateKey] : [];
        },

        getAllSchedules() {
            const flat = [];
            Object.keys(schedules).forEach(dateKey => {
                (schedules[dateKey] || []).forEach(s => flat.push({ dateKey, ...s }));
            });
            return flat;
        },

        getSchedule(dateKey, id) {
            return (schedules[dateKey] || []).find(s => s.id === id) || null;
        },

        exportSchedules() {
            return JSON.parse(JSON.stringify(schedules));
        },

        // ---------- WRITE ----------
        addSchedule(dateKey, { title, description, type }) {
            if (!Array.isArray(schedules[dateKey])) schedules[dateKey] = [];
            const item = {
                id: newId(),
                title,
                description,
                type,
                createdAt: new Date().toISOString()
            };
            schedules[dateKey].push(item);
            persist();
            return item;
        },

        updateSchedule(dateKey, id, { title, description, type }) {
            const list = schedules[dateKey];
            if (!Array.isArray(list)) return false;

            const idx = list.findIndex(s => s.id === id);
            if (idx === -1) return false;

            list[idx] = {
                ...list[idx],
                title,
                description,
                type
            };
            persist();
            return true;
        },

        deleteSchedule(dateKey, id) {
            const list = schedules[dateKey];
            if (!Array.isArray(list)) return null;

            const idx = list.findIndex(s => s.id === id);
            if (idx === -1) return null;

            const [removed] = list.splice(idx, 1);
            if (list.length === 0) delete schedules[dateKey];

            const trashed = {
                id: removed.id,
                title: removed.title,
                description: removed.description || '',
                type: removed.type || 'Other',
                dateKey,
                createdAt: removed.createdAt || new Date().toISOString(),
                deletedAt: new Date().toISOString()
            };
            trash.unshift(trashed);
            persist();
            return trashed;
        },

        // ---------- TRASH ----------
        getTrash() {
            return trash;
        },

        recoverTrashItem(id) {
            const idx = trash.findIndex(t => t.id === id);
            if (idx === -1) return false;

            const item = trash[idx];
            let targetId = item.id;

            if (!Array.isArray(schedules[item.dateKey])) schedules[item.dateKey] = [];
            if (schedules[item.dateKey].some(s => s.id === targetId)) {
                targetId = newId();
            }

            schedules[item.dateKey].push({
                id: targetId,
                title: item.title,
                description: item.description,
                type: item.type || 'Other',
                createdAt: item.createdAt || new Date().toISOString()
            });

            trash.splice(idx, 1);
            persist();
            return true;
        },

        removeTrashItem(id) {
            const idx = trash.findIndex(t => t.id === id);
            if (idx === -1) return false;
            trash.splice(idx, 1);
            persist();
            return true;
        },

        recoverTrashItems(ids) {
            let any = false;
            ids.forEach(id => { if (Store.recoverTrashItem(id)) any = true; });
            return any;
        },

        removeTrashItems(ids) {
            let any = false;
            ids.forEach(id => { if (Store.removeTrashItem(id)) any = true; });
            return any;
        },

        emptyTrash() {
            if (trash.length === 0) return;
            trash = [];
            persist();
        },

        // ---------- BULK / IMPORT / RESET ----------
        clearAllSchedules() {
            const all = Store.getAllSchedules();
            all.forEach(s => Store.deleteSchedule(s.dateKey, s.id));
            return all.length;
        },

        importSchedules(parsed) {
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return false;
            }
            const nowIso = new Date().toISOString();
            Object.keys(parsed).forEach(dateKey => {
                (parsed[dateKey] || []).forEach(s => {
                    if (!s.createdAt) s.createdAt = nowIso;
                    if (!s.type) s.type = 'Other';
                });
            });
            schedules = parsed;
            persist();
            return true;
        },

        reset() {
            schedules = {};
            trash = [];
            try {
                localStorage.removeItem(LS_SCHEDULES);
                localStorage.removeItem(LS_TRASH);
            } catch (e) { /* ignore */ }
            if (firebaseReady && dbRef) {
                dbRef.set({ schedules: {}, trash: {}, updatedAt: Date.now() })
                    .catch(err => console.error('Cloud reset failed:', err));
            }
        },

        // ---------- UTIL ----------
        formatDateKey,
        getDateFromKey,

        // ---------- DIAGNOSTICS ----------
        isCloudConnected() {
            return firebaseReady && cloudHydrated;
        },
        getCloudPath() {
            return firebaseReady ? ROOT_PATH : null;
        }
    };

    window.Store = Store;
})();
