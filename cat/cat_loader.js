/* ============================================================
   cat_loader.js — Realistic-ish Three.js walking cat loader
   Tube geometry + jointed legs + MeshStandardMaterial shading.
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
    let _catRoot = null;
    let _bodyPivot = null;
    let _headPivot = null;
    let _tailPivot = null;
    let _legs = [];   // { upper, lower, paw, phase, isFront }
    let _clock = null;
    let _animId = null;
    let _running = false;
    let _contactShadow = null;

    // ------------------------------------------------------------
    // Import map
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
    // Fragment injection
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
    // Scene init
    // ------------------------------------------------------------
    async function _initThree() {
        if (_renderer) return;

        _injectImportMap();
        const THREE = await import('three');

        const canvas = document.getElementById('catCanvas');
        if (!canvas) throw new Error('catCanvas not found');

        // Renderer — physically-based lighting needs correct color space
        _renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: true,
            powerPreference: 'low-power'
        });
        _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        _renderer.setClearColor(0x000000, 0);
        _renderer.outputColorSpace = THREE.SRGBColorSpace;
        _renderer.toneMapping = THREE.ACESFilmicToneMapping;
        _renderer.toneMappingExposure = 1.15;

        _scene = new THREE.Scene();

        _camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
        _camera.position.set(0.2, 0.85, 5.2);
        _camera.lookAt(0, 0.45, 0);

        // Three-point lighting tuned for purple fur
        const ambient = new THREE.AmbientLight(0xf3f0ff, 0.55);
        _scene.add(ambient);

        const key = new THREE.DirectionalLight(0xffffff, 1.4);
        key.position.set(2.5, 4, 4);
        key.castShadow = true;
        _scene.add(key);

        const fill = new THREE.DirectionalLight(0xc4b5fd, 0.7);
        fill.position.set(-3, 2, 3);
        _scene.add(fill);

        const rim = new THREE.DirectionalLight(0x8b5cf6, 0.9);
        rim.position.set(-2, 1.5, -3);
        _scene.add(rim);

        const back = new THREE.PointLight(0xa78bfa, 0.4, 10);
        back.position.set(0, 1.5, -2.5);
        _scene.add(back);

        _buildCat(THREE);

        // Soft ground shadow under the cat
        _buildContactShadow(THREE);

        _clock = new THREE.Clock();
        _resize();

        console.log('[CatLoader] realistic cat ready');
    }

    // ------------------------------------------------------------
    // Contact shadow — a flattened circle under the cat
    // ------------------------------------------------------------
    function _buildContactShadow(THREE) {
        const geo = new THREE.CircleGeometry(1.15, 32);
        const mat = new THREE.MeshBasicMaterial({
            color: 0x6d28d9,
            transparent: true,
            opacity: 0.12,
            depthWrite: false
        });
        _contactShadow = new THREE.Mesh(geo, mat);
        _contactShadow.rotation.x = -Math.PI / 2;
        _contactShadow.position.set(0, 0.0, 0);
        _contactShadow.scale.set(1, 0.45, 1);
        _scene.add(_contactShadow);
    }

    // ------------------------------------------------------------
    // Cat builder
    // ------------------------------------------------------------
    function _buildCat(THREE) {
        _catRoot = new THREE.Group();
        _scene.add(_catRoot);

        // --- Materials ---
        // Standard material with a slight sheen — reads as soft fur rather
        // than plastic, without needing actual fur shading.
        const furMat = new THREE.MeshStandardMaterial({
            color: 0x7c3aed,
            roughness: 0.72,
            metalness: 0.02,
            flatShading: false
        });

        const darkFurMat = new THREE.MeshStandardMaterial({
            color: 0x5b21b6,
            roughness: 0.78,
            metalness: 0.02
        });

        const accentMat = new THREE.MeshStandardMaterial({
            color: 0xa78bfa,
            roughness: 0.55,
            metalness: 0.05
        });

        const noseMat = new THREE.MeshStandardMaterial({
            color: 0xdb2777,
            roughness: 0.4,
            metalness: 0.1
        });

        const eyeWhiteMat = new THREE.MeshStandardMaterial({
            color: 0xf5f3ff,
            roughness: 0.35,
            metalness: 0.0
        });

        const eyeBlackMat = new THREE.MeshStandardMaterial({
            color: 0x111827,
            roughness: 0.25,
            metalness: 0.1
        });

        // --- Helper: tapered tube along a curve ---
        function tube(points, r0, r1, mat, segments = 48) {
            const curve = new THREE.CatmullRomCurve3(points);
            const geo = new THREE.TubeGeometry(curve, segments, r0, 12, false);
            // Taper radii by scaling vertices along the curve — simpler
            // approach than a custom tube with varying radius.
            const pos = geo.attributes.position;
            const count = pos.count;
            const frames = curve.computeFrenetFrames(segments, false);
            const totalSegs = segments + 1;

            // For each ring, scale the radius from r0 → r1
            for (let i = 0; i < count; i++) {
                const ring = Math.floor(i / 13); // 13 verts per ring (radialSegments+1)
                const f = Math.min(1, ring / (totalSegs - 1));
                const targetR = r0 + (r1 - r0) * f;
                const scale = targetR / r0;
                if (ring === 0) continue;

                // Center of this ring is the curve point
                const t = ring / totalSegs;
                const center = curve.getPointAt(Math.min(0.9999, t));
                const x = pos.getX(i) - center.x;
                const y = pos.getY(i) - center.y;
                const z = pos.getZ(i) - center.z;
                pos.setXYZ(i, center.x + x * scale, center.y + y * scale, center.z + z * scale);
            }
            pos.needsUpdate = true;
            geo.computeVertexNormals();

            const mesh = new THREE.Mesh(geo, mat);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            return mesh;
        }

        // --- Body ---
        // Arched spine, thicker at the chest, tapering to the haunch.
        const bodyPivot = new THREE.Group();
        _catRoot.add(bodyPivot);
        _bodyPivot = bodyPivot;

        const bodyMesh = tube([
            new THREE.Vector3(-1.10, 0.62, 0),
            new THREE.Vector3(-0.70, 0.80, 0),
            new THREE.Vector3(-0.20, 0.84, 0),
            new THREE.Vector3( 0.35, 0.80, 0),
            new THREE.Vector3( 0.85, 0.72, 0),
            new THREE.Vector3( 1.15, 0.62, 0)
        ], 0.26, 0.20, furMat, 64);
        bodyPivot.add(bodyMesh);

        // Chest fur patch (slightly darker, sits on top of the chest)
        const chest = new THREE.Mesh(
            new THREE.SphereGeometry(0.22, 16, 12),
            darkFurMat
        );
        chest.scale.set(1.1, 0.9, 0.95);
        chest.position.set(0.85, 0.62, 0.05);
        chest.castShadow = true;
        bodyPivot.add(chest);

        // Haunch (hind leg muscle) — a flattened sphere on the hip
        const haunch = new THREE.Mesh(
            new THREE.SphereGeometry(0.20, 16, 12),
            furMat
        );
        haunch.scale.set(1.0, 0.9, 0.95);
        haunch.position.set(-0.75, 0.60, 0);
        haunch.castShadow = true;
        bodyPivot.add(haunch);

        // --- Head pivot (attached to the front of the body) ---
        const headPivot = new THREE.Group();
        headPivot.position.set(1.05, 0.72, 0);
        bodyPivot.add(headPivot);
        _headPivot = headPivot;

        // Skull — slightly egg-shaped
        const skull = new THREE.Mesh(
            new THREE.SphereGeometry(0.22, 24, 18),
            furMat
        );
        skull.scale.set(1.1, 1.0, 1.0);
        skull.position.set(0.20, 0.10, 0);
        skull.castShadow = true;
        headPivot.add(skull);

        // Muzzle — smaller sphere pushed forward
        const muzzle = new THREE.Mesh(
            new THREE.SphereGeometry(0.12, 16, 12),
            furMat
        );
        muzzle.scale.set(1.2, 0.9, 1.0);
        muzzle.position.set(0.36, 0.02, 0);
        muzzle.castShadow = true;
        headPivot.add(muzzle);

        // Nose
        const nose = new THREE.Mesh(
            new THREE.SphereGeometry(0.035, 10, 8),
            noseMat
        );
        nose.position.set(0.47, 0.02, 0);
        headPivot.add(nose);

        // Ears — cones, tilted outward
        const earGeo = new THREE.ConeGeometry(0.10, 0.24, 12);
        earGeo.computeVertexNormals();

        const earBack = new THREE.Mesh(earGeo, furMat);
        earBack.position.set(0.12, 0.30, -0.10);
        earBack.rotation.z = -0.18;
        earBack.rotation.x = -0.12;
        earBack.castShadow = true;
        headPivot.add(earBack);

        const earFront = new THREE.Mesh(earGeo, furMat);
        earFront.position.set(0.20, 0.30,  0.10);
        earFront.rotation.z = -0.18;
        earFront.rotation.x =  0.12;
        earFront.castShadow = true;
        headPivot.add(earFront);

        // Inner ears (smaller darker cones inside)
        const earInnerGeo = new THREE.ConeGeometry(0.055, 0.16, 10);
        const earBackInner = new THREE.Mesh(earInnerGeo, darkFurMat);
        earBackInner.position.copy(earBack.position);
        earBackInner.position.y -= 0.01;
        earBackInner.rotation.copy(earBack.rotation);
        headPivot.add(earBackInner);

        const earFrontInner = new THREE.Mesh(earInnerGeo, darkFurMat);
        earFrontInner.position.copy(earFront.position);
        earFrontInner.position.y -= 0.01;
        earFrontInner.rotation.copy(earFront.rotation);
        headPivot.add(earFrontInner);

        // Eyes — white sclera + black pupil
        function makeEye(zSide) {
            const g = new THREE.Group();

            const white = new THREE.Mesh(
                new THREE.SphereGeometry(0.055, 16, 12),
                eyeWhiteMat
            );
            white.scale.set(1.0, 1.1, 0.7);
            g.add(white);

            const pupil = new THREE.Mesh(
                new THREE.SphereGeometry(0.032, 12, 10),
                eyeBlackMat
            );
            pupil.position.set(0.03, 0, 0.02);
            g.add(pupil);

            g.position.set(0.28, 0.15, zSide);
            return g;
        }
        headPivot.add(makeEye( 0.13));
        headPivot.add(makeEye(-0.13));

        // Whiskers (very thin tubes, mostly cosmetic)
        const whiskerMat = new THREE.MeshStandardMaterial({
            color: 0xc4b5fd,
            roughness: 0.5,
            metalness: 0.0
        });
        function whisker(startX, startY, startZ, endX, endY, endZ) {
            const pts = [
                new THREE.Vector3(startX, startY, startZ),
                new THREE.Vector3(
                    startX + (endX - startX) * 0.5,
                    startY + (endY - startY) * 0.5,
                    startZ + (endZ - startZ) * 0.5
                ),
                new THREE.Vector3(endX, endY, endZ)
            ];
            const w = tube(pts, 0.006, 0.003, whiskerMat, 12);
            headPivot.add(w);
        }
        // Right side whiskers
        whisker(0.42, 0.08,  0.14, 0.75, 0.10,  0.30);
        whisker(0.42, 0.02,  0.14, 0.78, 0.02,  0.32);
        whisker(0.42, -0.04, 0.14, 0.75, -0.06, 0.30);
        // Left side whiskers
        whisker(0.42, 0.08, -0.14, 0.75, 0.10, -0.30);
        whisker(0.42, 0.02, -0.14, 0.78, 0.02, -0.32);
        whisker(0.42, -0.04, -0.14, 0.75, -0.06, -0.30);

        // --- Tail (pivots from the rear) ---
        const tailPivot = new THREE.Group();
        tailPivot.position.set(-1.15, 0.62, 0);
        bodyPivot.add(tailPivot);
        _tailPivot = tailPivot;

        const tail = tube([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(-0.35, 0.05, 0),
            new THREE.Vector3(-0.55, 0.30, 0),
            new THREE.Vector3(-0.60, 0.65, 0),
            new THREE.Vector3(-0.50, 0.95, 0)
        ], 0.055, 0.045, furMat, 40);
        tailPivot.add(tail);

        // Tail tip (slightly lighter)
        const tailTip = new THREE.Mesh(
            new THREE.SphereGeometry(0.045, 12, 10),
            accentMat
        );
        tailTip.position.set(-0.50, 0.95, 0);
        tailPivot.add(tailTip);

        // --- Legs ---
        // Each leg has: upper bone (shoulder → knee), lower bone (knee → paw),
        // and a paw cap. The upper bone pivots at the shoulder/hip; the lower
        // bone bends at the knee. That's what makes the walk feel real.
        function makeLeg(hipX, hipY, hipZ, isFront, phase) {
            const hipPivot = new THREE.Group();
            hipPivot.position.set(hipX, hipY, hipZ);

            // Upper bone
            const upper = tube([
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(0.02, -0.22, 0),
                new THREE.Vector3(0.06, -0.42, 0)
            ], isFront ? 0.075 : 0.085, isFront ? 0.06 : 0.07, furMat, 24);
            hipPivot.add(upper);

            // Knee joint — small sphere so the bend doesn't look pinched
            const knee = new THREE.Mesh(
                new THREE.SphereGeometry(isFront ? 0.062 : 0.072, 12, 10),
                furMat
            );
            knee.position.set(0.06, -0.42, 0);
            hipPivot.add(knee);

            // Lower bone (pivots at the knee)
            const kneePivot = new THREE.Group();
            kneePivot.position.set(0.06, -0.42, 0);
            hipPivot.add(kneePivot);

            const lower = tube([
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(-0.04, -0.22, 0),
                new THREE.Vector3(-0.02, -0.42, 0)
            ], isFront ? 0.06 : 0.07, isFront ? 0.045 : 0.055, furMat, 24);
            kneePivot.add(lower);

            // Paw
            const paw = new THREE.Mesh(
                new THREE.SphereGeometry(isFront ? 0.085 : 0.095, 14, 10),
                darkFurMat
            );
            paw.scale.set(1.15, 0.7, 1.0);
            paw.position.set(-0.02, -0.44, 0);
            kneePivot.add(paw);

            return {
                hipPivot,
                kneePivot,
                phase,
                isFront
            };
        }

        // Near side (z = +0.18), far side (z = -0.18)
        // Diagonal gait: near-back + far-front in phase 0;
        // near-front + far-back in phase π.
        const legDefs = [
            // Far side (behind body)
            { x: -0.75, z: -0.18, front: false, phase: Math.PI },  // far back
            { x:  0.82, z: -0.18, front: true,  phase: 0 },        // far front
            // Near side (in front of body)
            { x: -0.75, z:  0.18, front: false, phase: 0 },        // near back
            { x:  0.82, z:  0.18, front: true,  phase: Math.PI }   // near front
        ];

        legDefs.forEach(def => {
            const leg = makeLeg(def.x, 0.55, def.z, def.front, def.phase);
            bodyPivot.add(leg.hipPivot);
            _legs.push(leg);
        });

        // Slight overall tilt so the cat reads as "walking forward"
        _catRoot.rotation.y = 0.15;
        _catRoot.position.y = -0.18;
    }

    // ------------------------------------------------------------
    // Animation loop — smooth 4-beat walk with articulated knees
    // ------------------------------------------------------------
    function _tick() {
        if (!_running) return;
        _animId = requestAnimationFrame(_tick);

        const t = _clock.getElapsedTime();
        const cycle = 1.05;            // seconds per full gait cycle
        const phase = (t / cycle) * Math.PI * 2;

        // Leg swing — near side and far side alternate by phase
        _legs.forEach(leg => {
            const p = phase + leg.phase;

            // Upper bone swings ±22°
            const upperSwing = Math.sin(p) * 0.38;
            leg.hipPivot.rotation.z = upperSwing;

            // Lower bone bends the knee — bends more on the forward
            // swing (lift) than on the backward swing (push-off).
            const kneeBend = 0.25 + 0.35 * Math.max(0, Math.sin(p));
            leg.kneePivot.rotation.z = -kneeBend;

            // Give the paw a slight counter-rotation so it stays flat
            const pawRot = -upperSwing - (-kneeBend);
            // paw is the last child of kneePivot; we can read it via index
            const paw = leg.kneePivot.children[leg.kneePivot.children.length - 1];
            if (paw) paw.rotation.z = pawRot;
        });

        // Body bob — twice per gait cycle (one bounce per step pair)
        if (_bodyPivot) {
            _bodyPivot.position.y = Math.sin(phase * 2) * 0.025;
            _bodyPivot.rotation.z = Math.sin(phase) * 0.018;
        }

        // Head nod — lags the body slightly for weight
        if (_headPivot) {
            _headPivot.rotation.z = -Math.sin(phase - 0.4) * 0.05;
            _headPivot.rotation.x = Math.sin(t * 0.6) * 0.04;
        }

        // Tail sway — counter to the body, slower cycle
        if (_tailPivot) {
            _tailPivot.rotation.z = Math.sin(t * 1.1) * 0.10;
            _tailPivot.rotation.y = Math.sin(t * 0.7) * 0.14;
        }

        // Shadow breathes with the body bob
        if (_contactShadow) {
            const s = 1 + Math.sin(phase * 2) * 0.02;
            _contactShadow.scale.set(s, 0.45 * s, 1);
        }

        _renderer.render(_scene, _camera);
    }

    // ------------------------------------------------------------
    // Resize
    // ------------------------------------------------------------
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
