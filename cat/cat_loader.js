/* ============================================================
   cat_loader.js — Three.js procedural walking cat loader
   Injects cat_loader.html, lazily loads Three.js, renders a
   walking cat inside #catCanvas, exposes window.CatLoader.
   ============================================================ */
(function () {
    'use strict';

    const HOST_ID = 'catLoaderHost';
    const FRAGMENT_URL = 'cat/cat_loader.html';
    const THREE_VERSION = '0.187.0';
    const THREE_CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}`;

    let _loaded = false;
    let _loading = false;
    let _hideTimer = null;

    // Three.js state
    let _renderer = null;
    let _scene = null;
    let _camera = null;
    let _catGroup = null;
    let _legs = [];
    let _tail = null;
    let _clock = null;
    let _animId = null;
    let _running = false;

    // ------------------------------------------------------------
    // Import map (declared once, before dynamic import)
    // ------------------------------------------------------------
    function _injectImportMap() {
        if (document.querySelector('script[type="importmap"][data-cat-loader]')) return;
        const map = document.createElement('script');
        map.type = 'importmap';
        map.dataset.catLoader = '1';
        map.textContent = JSON.stringify({
            imports: {
                'three': `${THREE_CDN}/build/three.module.js`,
                'three/addons/': `${THREE_CDN}/examples/jsm/`
            }
        });
        document.head.appendChild(map);
    }

    // ------------------------------------------------------------
    // Fetch + inject the HTML fragment
    // ------------------------------------------------------------
    async function _inject() {
        if (_loaded || _loading) return;
        _loading = true;

        const host = document.getElementById(HOST_ID);
        if (!host) {
            console.warn('[CatLoader] #' + HOST_ID + ' not found.');
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
    // Lazy-load Three.js and build the scene
    // ------------------------------------------------------------
    async function _initThree() {
        if (_renderer) return;

        _injectImportMap();

        const THREE = await import('three');

        const canvas = document.getElementById('catCanvas');
        if (!canvas) throw new Error('catCanvas not found');

        _renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: true,
            powerPreference: 'low-power'
        });
        _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        _renderer.setClearColor(0x000000, 0);

        _scene = new THREE.Scene();
        _camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
        _camera.position.set(0, 0.6, 5.5);
        _camera.lookAt(0, 0.3, 0);

        const ambient = new THREE.AmbientLight(0xffffff, 0.65);
        _scene.add(ambient);

        const key = new THREE.DirectionalLight(0xa78bfa, 1.1);
        key.position.set(2, 3, 4);
        _scene.add(key);

        const rim = new THREE.DirectionalLight(0xc4b5fd, 0.6);
        rim.position.set(-3, 1, -2);
        _scene.add(rim);

        _buildCat(THREE);
        _clock = new THREE.Clock();
        _resize();
    }

    // ------------------------------------------------------------
    // Procedural cat (tube geometry)
    // ------------------------------------------------------------
    function _buildCat(THREE) {
        _catGroup = new THREE.Group();
        _scene.add(_catGroup);

        const bodyMat = new THREE.MeshBasicMaterial({ color: 0x6d28d9 });
        const accentMat = new THREE.MeshBasicMaterial({ color: 0xa78bfa });

        function tube(points, radius, mat) {
            const curve = new THREE.CatmullRomCurve3(points);
            const geo = new THREE.TubeGeometry(curve, 32, radius, 6, false);
            return new THREE.Mesh(geo, mat);
        }

        // Body spine
        const body = tube([
            new THREE.Vector3(-1.1, 0.55, 0),
            new THREE.Vector3(-0.6, 0.75, 0),
            new THREE.Vector3(0.1, 0.70, 0),
            new THREE.Vector3(0.7, 0.60, 0),
            new THREE.Vector3(1.1, 0.55, 0)
        ], 0.18, bodyMat);
        _catGroup.add(body);

        // Head
        const head = tube([
            new THREE.Vector3(1.05, 0.60, 0),
            new THREE.Vector3(1.35, 0.62, 0),
            new THREE.Vector3(1.55, 0.55, 0)
        ], 0.16, bodyMat);
        _catGroup.add(head);

        // Ears
        const earBack = tube([
            new THREE.Vector3(1.25, 0.75, -0.05),
            new THREE.Vector3(1.28, 0.92, -0.05),
            new THREE.Vector3(1.38, 0.78, -0.05)
        ], 0.03, bodyMat);
        _catGroup.add(earBack);

        const earFront = tube([
            new THREE.Vector3(1.42, 0.74, 0.05),
            new THREE.Vector3(1.48, 0.92, 0.05),
            new THREE.Vector3(1.56, 0.76, 0.05)
        ], 0.03, bodyMat);
        _catGroup.add(earFront);

        // Eye
        const eye = new THREE.Mesh(
            new THREE.SphereGeometry(0.035, 8, 8),
            accentMat
        );
        eye.position.set(1.48, 0.62, 0.13);
        _catGroup.add(eye);

        // Tail
        _tail = tube([
            new THREE.Vector3(-1.05, 0.55, 0),
            new THREE.Vector3(-1.35, 0.60, 0),
            new THREE.Vector3(-1.55, 0.80, 0),
            new THREE.Vector3(-1.60, 1.05, 0)
        ], 0.05, accentMat);
        _catGroup.add(_tail);

        // Legs — four pivoting groups
        const legDefs = [
            { x: -0.7, z:  0.18, phase: 0 },       // near back
            { x:  0.7, z:  0.18, phase: Math.PI }, // near front
            { x: -0.7, z: -0.18, phase: Math.PI }, // far back
            { x:  0.7, z: -0.18, phase: 0 }        // far front
        ];

        legDefs.forEach((def, i) => {
            const legGroup = new THREE.Group();
            legGroup.position.set(def.x, 0.55, def.z);

            const legMesh = tube([
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(0.05, -0.25, 0),
                new THREE.Vector3(0.05, -0.55, 0)
            ], 0.06, bodyMat);
            legGroup.add(legMesh);

            const paw = new THREE.Mesh(
                new THREE.SphereGeometry(0.08, 8, 8),
                bodyMat
            );
            paw.position.set(0.05, -0.55, 0);
            legGroup.add(paw);

            legGroup.userData = { phase: def.phase, index: i };
            _catGroup.add(legGroup);
            _legs.push(legGroup);
        });

        _catGroup.scale.set(1.15, 1.15, 1.15);
        _catGroup.position.y = -0.15;
    }

    // ------------------------------------------------------------
    // Animation loop
    // ------------------------------------------------------------
    function _tick() {
        if (!_running) return;
        _animId = requestAnimationFrame(_tick);

        const t = _clock.getElapsedTime();
        const cycle = 1.1;
        const phase = (t / cycle) * Math.PI * 2;

        _legs.forEach(leg => {
            const p = phase + leg.userData.phase;
            leg.rotation.x = Math.sin(p) * 0.25;
        });

        if (_tail) {
            _tail.rotation.y = Math.sin(t * 1.2) * 0.15;
            _tail.rotation.z = Math.cos(t * 0.9) * 0.08;
        }

        if (_catGroup) {
            _catGroup.position.y = -0.15 + Math.sin(phase * 2) * 0.02;
            _catGroup.rotation.z = Math.sin(phase) * 0.015;
        }

        _renderer.render(_scene, _camera);
    }

    function _resize() {
        if (!_renderer || !_camera) return;
        const canvas = _renderer.domElement;
        const parent = canvas.parentElement;
        if (!parent) return;

        const w = parent.clientWidth || 180;
        const h = parent.clientHeight || 130;

        _renderer.setSize(w, h, false);
        _camera.aspect = w / h;
        _camera.updateProjectionMatrix();
    }

    // ------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------
    function show() {
        const screen = document.getElementById('loaderScreen');
        if (!screen) return;
        clearTimeout(_hideTimer);
        screen.classList.add('active');
        screen.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';

        if (!_renderer) {
            _initThree()
                .then(() => {
                    _resize();
                    if (!_running) {
                        _running = true;
                        _clock.start();
                        _tick();
                    }
                })
                .catch(err => {
                    console.error('[CatLoader] Three.js init failed:', err);
                });
        } else {
            _resize();
            if (!_running) {
                _running = true;
                _clock.start();
                _tick();
            }
        }
    }

    function hide() {
        const screen = document.getElementById('loaderScreen');
        if (!screen) return;
        screen.classList.remove('active');
        screen.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';

        _running = false;
        if (_animId) {
            cancelAnimationFrame(_animId);
            _animId = null;
        }
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

    window.addEventListener('resize', _resize, { passive: true });

    window.CatLoader = {
        ready,
        show,
        hide,
        showAndReload,
        isLoaded: () => _loaded
    };
})();
