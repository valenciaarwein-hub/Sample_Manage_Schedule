/* ============================================================
   cat_loader.js — injects cat_loader.html + wires show/hide
   Usage:
     await CatLoader.ready;              // wait for DOM injection
     CatLoader.show();                   // fade in
     CatLoader.hide();                   // fade out
     CatLoader.showAndReload(3000);      // fade in, wait, reload
   ============================================================ */
(function () {
    'use strict';

    const HOST_ID = 'catLoaderHost';
    const FRAGMENT_URL = 'cat_loader.html';

    let _loaded = false;
    let _loading = false;
    let _hideTimer = null;

    async function _inject() {
        if (_loaded || _loading) return;
        _loading = true;

        const host = document.getElementById(HOST_ID);
        if (!host) {
            console.warn('[CatLoader] #' + HOST_ID + ' not found in the page.');
            _loading = false;
            return;
        }

        try {
            const res = await fetch(FRAGMENT_URL, { cache: 'no-cache' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const html = await res.text();
            host.innerHTML = html;
            _loaded = true;
        } catch (err) {
            console.error('[CatLoader] Could not load', FRAGMENT_URL, err);
        } finally {
            _loading = false;
        }
    }

    function _getScreen() {
        return document.getElementById('loaderScreen');
    }

    function show() {
        const screen = _getScreen();
        if (!screen) return;
        clearTimeout(_hideTimer);
        screen.classList.add('active');
        screen.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    }

    function hide() {
        const screen = _getScreen();
        if (!screen) return;
        screen.classList.remove('active');
        screen.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
    }

    /**
     * Show the loader for `durationMs`, then reload the page.
     * Mirrors the old showLoaderAndReload() flow in script.js.
     */
    function showAndReload(durationMs) {
        const wait = typeof durationMs === 'number' ? durationMs : 3000;
        const screen = _getScreen();
        if (!screen) {
            window.location.reload();
            return;
        }
        if (screen.classList.contains('active')) return;

        show();

        clearTimeout(_hideTimer);
        _hideTimer = setTimeout(() => {
            hide();
            setTimeout(() => window.location.reload(), 450);
        }, wait);
    }

    /* Kick off injection as soon as possible. */
    const ready = _inject();

    /* Public API */
    window.CatLoader = {
        ready,
        show,
        hide,
        showAndReload,
        isLoaded: () => _loaded
    };
})();
