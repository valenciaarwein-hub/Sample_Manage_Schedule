/* ============================================================
   cat_loader.js — Option B: SVG head-on cat loader
   Fetches cat_loader.html, injects it, exposes window.CatLoader.
   No Three.js dependency — zero CDN fetches, zero WebGL.
   ============================================================ */
(function () {
    'use strict';

    const HOST_ID = 'catLoaderHost';
    const FRAGMENT_URL = 'cat/cat_loader.html';

    let _loaded = false;
    let _loading = false;
    let _hideTimer = null;

    // ------------------------------------------------------------
    // Fetch + inject the HTML fragment
    // ------------------------------------------------------------
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
            host.innerHTML = await res.text();
            _loaded = true;
        } catch (err) {
            console.error('[CatLoader] Could not load', FRAGMENT_URL, err);
        } finally {
            _loading = false;
        }
    }

    // ------------------------------------------------------------
    // Show / hide / showAndReload
    // ------------------------------------------------------------
    function show() {
        const screen = document.getElementById('loaderScreen');
        if (!screen) return;
        clearTimeout(_hideTimer);
        screen.classList.add('active');
        screen.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    }

    function hide() {
        const screen = document.getElementById('loaderScreen');
        if (!screen) return;
        screen.classList.remove('active');
        screen.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
    }

    function showAndReload(durationMs) {
        const wait = typeof durationMs === 'number' ? durationMs : 5000;
        const screen = document.getElementById('loaderScreen');
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

    // ------------------------------------------------------------
    // Boot
    // ------------------------------------------------------------
    const ready = _inject();

    window.CatLoader = {
        ready,
        show,
        hide,
        showAndReload,
        isLoaded: () => _loaded
    };
})();
