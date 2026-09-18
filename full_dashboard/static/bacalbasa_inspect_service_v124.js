(() => {
    "use strict";

    const GRID =
        "#view-inspect .inspect-health-grid.inspect-v45";

    const SERVICE =
        "#view-inspect .unitree-services-card";

    const MOVE_MS = 290;
    const EASE = "cubic-bezier(0.2,0.85,0.25,1)";

    let serviceTop = false;
    let moveDrag = null;
    let resizeDrag = null;
    let minimumHeight = null;

    let initialized = false;


    const grid = () =>
        document.querySelector(GRID);

    const service = () =>
        document.querySelector(SERVICE);

    const ORDER = [
        "system",
        "imu",
        "odom",
        "processes"
    ];


    const layoutApi = () =>
        window.BACALBASA_INSPECT_LAYOUT_V18
        ||
        null;


    const cards = () => {

        /*
         * Canonical path:
         * use the exact four-card owner already used by Inspect's
         * horizontal reorder/resize mechanic.
         */

        const api =
            layoutApi();


        if (api) {

            const map =
                api.getElements();


            const result =
                ORDER
                    .map(
                        key =>
                            map[key]
                    )
                    .filter(Boolean);


            if (result.length === 4) {
                return result;
            }
        }


        /*
         * Defensive fallback only.
         */

        const view =
            document.getElementById(
                "view-inspect"
            );


        if (!view) {
            return [];
        }


        const candidates =
            [
                ...view.querySelectorAll(
                    ".panel"
                )
            ]
            .filter(
                el =>
                    !el.classList.contains(
                        "unitree-services-card"
                    )
            );


        const result = [];


        const wanted =
            [
                "SYSTEM HEALTH",
                "TORSO IMU",
                "ODOMETRY",
                "PROCESSES"
            ];


        for (const name of wanted) {

            const match =
                candidates.find(
                    el =>
                        String(
                            el.textContent
                            ||
                            ""
                        )
                        .replace(
                            /\\s+/g,
                            " "
                        )
                        .toUpperCase()
                        .includes(
                            name
                        )
                );


            if (
                match
                &&
                !result.includes(
                    match
                )
            ) {

                result.push(
                    match
                );
            }
        }


        return result;
    };


    /*
     * Keep compatibility with the existing horizontal Inspect
     * reorder/resize system.
     */
    window.BACALBASA_INSPECT_VERTICAL_V115 = {
        topRow() {
            return serviceTop ? 2 : 1;
        }
    };


    function text(node) {
        return String(node?.textContent || "")
            .replace(/\s+/g, " ")
            .trim()
            .toUpperCase();
    }


    function titleBottom() {
        const wanted = new Set([
            "SYSTEM HEALTH",
            "TORSO IMU",
            "ODOMETRY",
            "PROCESSES"
        ]);

        let bottom = -Infinity;

        for (const panel of cards()) {
            for (const node of panel.querySelectorAll("*")) {
                if (!wanted.has(text(node))) continue;

                bottom = Math.max(
                    bottom,
                    node.getBoundingClientRect().bottom
                );
            }
        }

        return bottom;
    }


    function monitorAgeTop() {
        for (const panel of cards()) {
            for (const node of panel.querySelectorAll("*")) {
                if (text(node) !== "MONITOR AGE") continue;

                const row =
                    node.closest(".system-kv > div")
                    ||
                    node.parentElement;

                if (row) {
                    return row.getBoundingClientRect().top;
                }
            }
        }

        return NaN;
    }


    function resetScale() {
        const s = service();

        if (!s) return;

        s.style.removeProperty("height");
        s.style.removeProperty("min-height");
        s.style.removeProperty("max-height");
        s.style.removeProperty("align-self");
        s.style.removeProperty("margin-top");
        s.style.removeProperty("margin-bottom");

        s.classList.remove(
            "baca-inspect-service-expanded-v124",
            "baca-inspect-service-resizing-v124"
        );
    }


    function applyBands() {
        const g = grid();
        const s = service();
        const c = cards();

        if (!g || !s || !c.length) return;

        g.style.setProperty(
            "grid-template-rows",
            serviceTop
                ? "minmax(300px,.57fr) minmax(250px,.43fr)"
                : "minmax(250px,.43fr) minmax(300px,.57fr)",
            "important"
        );

        for (const el of c) {
            el.style.setProperty(
                "grid-row",
                serviceTop ? "2" : "1",
                "important"
            );
        }

        s.style.setProperty(
            "grid-column",
            "1 / -1",
            "important"
        );

        s.style.setProperty(
            "grid-row",
            serviceTop ? "1" : "2",
            "important"
        );

        s.classList.toggle(
            "baca-inspect-service-top-v124",
            serviceTop
        );
    }


    function captureCards() {
        const result = new Map();

        for (const el of cards()) {
            result.set(
                el,
                el.getBoundingClientRect()
            );
        }

        return result;
    }


    function animateCards(before) {
        for (const el of cards()) {
            const oldRect = before.get(el);

            if (!oldRect) continue;

            for (const animation of el.getAnimations()) {
                try {
                    animation.cancel();
                } catch (_) {}
            }

            const next = el.getBoundingClientRect();
            const dy = oldRect.top - next.top;

            if (Math.abs(dy) < 0.5) continue;

            el.animate(
                [
                    {
                        transform:
                            `translate3d(0,${dy}px,0)`
                    },
                    {
                        transform:
                            "translate3d(0,0,0)"
                    }
                ],
                {
                    duration: MOVE_MS,
                    easing: EASE
                }
            );
        }
    }


    function follow(pointerY) {
        if (!moveDrag) return;

        const el = moveDrag.el;

        el.style.transform = "none";

        const natural =
            el.getBoundingClientRect();

        const wanted =
            moveDrag.startTop
            +
            pointerY
            -
            moveDrag.startY;

        el.style.transform =
            `translate3d(0,${wanted - natural.top}px,0)`;
    }


    function swap(nextTop, pointerY) {
        if (nextTop === serviceTop) return;

        const movingCards =
            cards();


        if (movingCards.length !== 4) {

            console.warn(
                "[BACALBASA Inspect V1.25] " +
                "Refusing vertical swap: expected 4 upper cards, got",
                movingCards.length
            );

            return;
        }


        const before =
            captureCards();


        /*
         * Any band change returns Service Inventory to its canonical
         * minimum height first.
         */
        resetScale();

        serviceTop = nextTop;

        applyBands();
        animateCards(before);
        follow(pointerY);
    }


    function move(event) {
        if (
            !moveDrag
            ||
            event.pointerId !== moveDrag.pointerId
        ) {
            return;
        }

        event.preventDefault();

        follow(event.clientY);

        const titles = titleBottom();

        if (!Number.isFinite(titles)) return;


        /*
         * BOTTOM -> TOP:
         *
         * The cursor/handle must genuinely reach the title area.
         * Merely beginning a drag no longer moves the upper cards.
         */
        if (
            !serviceTop
            &&
            event.clientY <= titles + 16
        ) {
            swap(
                true,
                event.clientY
            );

            return;
        }


        /*
         * TOP -> BOTTOM:
         *
         * Uses CURRENT state rather than where the drag started.
         * Therefore this can repeat indefinitely without releasing
         * the mouse button.
         */
        if (
            serviceTop
            &&
            event.clientY >= titles + 42
        ) {
            swap(
                false,
                event.clientY
            );
        }
    }


    function stopMove(event) {
        if (
            !moveDrag
            ||
            event.pointerId !== moveDrag.pointerId
        ) {
            return;
        }

        event.preventDefault();

        const el = moveDrag.el;
        const handle = moveDrag.handle;

        const visual =
            el.getBoundingClientRect();

        el.style.transform = "none";

        applyBands();

        const settled =
            el.getBoundingClientRect();

        const dy =
            visual.top - settled.top;

        if (Math.abs(dy) > 0.5) {
            try {
                el.animate(
                    [
                        {
                            transform:
                                `translate3d(0,${dy}px,0)`
                        },
                        {
                            transform:
                                "translate3d(0,0,0)"
                        }
                    ],
                    {
                        duration: MOVE_MS,
                        easing: EASE
                    }
                );
            } catch (_) {}
        }

        el.style.removeProperty("transform");

        handle.classList.remove("is-active");

        try {
            handle.releasePointerCapture(
                event.pointerId
            );
        } catch (_) {}

        moveDrag = null;

        document.removeEventListener(
            "pointermove",
            move,
            true
        );

        document.removeEventListener(
            "pointerup",
            stopMove,
            true
        );

        document.removeEventListener(
            "pointercancel",
            stopMove,
            true
        );
    }


    function startMove(event, handle) {
        if (
            moveDrag
            ||
            resizeDrag
            ||
            event.button !== 0
        ) {
            return;
        }

        const el = service();

        if (!el) return;

        event.preventDefault();
        event.stopPropagation();

        moveDrag = {
            el,
            handle,

            pointerId:
                event.pointerId,

            startY:
                event.clientY,

            startTop:
                el.getBoundingClientRect().top
        };

        handle.classList.add("is-active");

        try {
            handle.setPointerCapture(
                event.pointerId
            );
        } catch (_) {}

        document.addEventListener(
            "pointermove",
            move,
            true
        );

        document.addEventListener(
            "pointerup",
            stopMove,
            true
        );

        document.addEventListener(
            "pointercancel",
            stopMove,
            true
        );
    }


    function ensureControls() {
        const s = service();

        if (!s) return;

        let moveHandle =
            s.querySelector(
                ":scope > .baca-inspect-service-handle-v114"
            );

        if (!moveHandle) {
            moveHandle =
                document.createElement("button");

            moveHandle.type = "button";

            moveHandle.className =
                "baca-inspect-drag-handle-v16 " +
                "baca-inspect-service-handle-v114";

            moveHandle.innerHTML =
                '<span class="baca-inspect-drag-grip-v16"></span>';

            s.prepend(moveHandle);
        }

        moveHandle.title =
            "Drag Service Inventory up or down";


        let topEdge =
            s.querySelector(
                ":scope > .baca-inspect-service-resize-top-v124"
            );

        if (!topEdge) {
            topEdge =
                document.createElement("div");

            topEdge.className =
                "baca-inspect-service-resize-top-v124";

            topEdge.title =
                "Resize Service Inventory upward";

            s.prepend(topEdge);
        }


        let bottomEdge =
            s.querySelector(
                ":scope > .baca-inspect-service-resize-bottom-v124"
            );

        if (!bottomEdge) {
            bottomEdge =
                document.createElement("div");

            bottomEdge.className =
                "baca-inspect-service-resize-bottom-v124";

            bottomEdge.title =
                "Resize Service Inventory downward";

            s.append(bottomEdge);
        }
    }


    function currentGrowth() {
        const s = service();

        if (
            !s
            ||
            !Number.isFinite(minimumHeight)
        ) {
            return 0;
        }

        return Math.max(
            0,
            s.getBoundingClientRect().height
            -
            minimumHeight
        );
    }


    function bottomMaxGrowth() {
        const s = service();
        const titles = titleBottom();

        if (
            !s
            ||
            !Number.isFinite(titles)
        ) {
            return 0;
        }

        const growth =
            currentGrowth();

        const minimumTop =
            s.getBoundingClientRect().top
            +
            growth;

        return Math.max(
            0,
            minimumTop
            -
            (
                titles
                +
                12
            )
        );
    }


    function topMaxGrowth() {
        const s = service();
        const monitorTop = monitorAgeTop();

        if (
            !s
            ||
            !Number.isFinite(monitorTop)
        ) {
            return 0;
        }

        const growth =
            currentGrowth();

        const minimumBottom =
            s.getBoundingClientRect().bottom
            -
            growth;

        return Math.max(
            0,
            (
                monitorTop
                -
                8
            )
            -
            minimumBottom
        );
    }


    function applyGrowth(growth) {
        const s = service();

        if (!s) return;

        growth = Math.max(0, growth);

        const height =
            minimumHeight + growth;

        s.style.setProperty(
            "height",
            `${height}px`,
            "important"
        );

        if (serviceTop) {
            /*
             * Grow downward over the lower cards without changing
             * their row geometry.
             */
            s.style.setProperty(
                "align-self",
                "start",
                "important"
            );

            s.style.setProperty(
                "margin-top",
                "0px",
                "important"
            );

            s.style.setProperty(
                "margin-bottom",
                `${-growth}px`,
                "important"
            );
        }

        else {
            /*
             * Grow upward over the upper cards without changing
             * their row geometry.
             */
            s.style.setProperty(
                "align-self",
                "end",
                "important"
            );

            s.style.setProperty(
                "margin-top",
                `${-growth}px`,
                "important"
            );

            s.style.setProperty(
                "margin-bottom",
                "0px",
                "important"
            );
        }

        s.classList.toggle(
            "baca-inspect-service-expanded-v124",
            growth > 0.5
        );
    }


    function resizeMove(event) {
        if (
            !resizeDrag
            ||
            event.pointerId !== resizeDrag.pointerId
        ) {
            return;
        }

        event.preventDefault();

        let growth;

        if (resizeDrag.edge === "top") {
            growth =
                resizeDrag.startGrowth
                +
                (
                    resizeDrag.startY
                    -
                    event.clientY
                );
        }

        else {
            growth =
                resizeDrag.startGrowth
                +
                (
                    event.clientY
                    -
                    resizeDrag.startY
                );
        }

        growth =
            Math.min(
                resizeDrag.maxGrowth,
                Math.max(
                    0,
                    growth
                )
            );

        applyGrowth(growth);
    }


    function stopResize(event) {
        if (
            !resizeDrag
            ||
            event.pointerId !== resizeDrag.pointerId
        ) {
            return;
        }

        event.preventDefault();

        const edge =
            resizeDrag.target;

        const growth =
            currentGrowth();

        edge.classList.remove("is-active");

        service()?.classList.remove(
            "baca-inspect-service-resizing-v124"
        );

        if (growth <= 1) {
            resetScale();
        }

        try {
            edge.releasePointerCapture(
                event.pointerId
            );
        } catch (_) {}

        resizeDrag = null;

        document.removeEventListener(
            "pointermove",
            resizeMove,
            true
        );

        document.removeEventListener(
            "pointerup",
            stopResize,
            true
        );

        document.removeEventListener(
            "pointercancel",
            stopResize,
            true
        );
    }


    function startResize(
        event,
        target,
        edge
    ) {
        if (
            moveDrag
            ||
            resizeDrag
            ||
            event.button !== 0
        ) {
            return;
        }

        /*
         * Bottom placement scales from TOP.
         * Top placement scales from BOTTOM.
         */
        if (
            (
                !serviceTop
                &&
                edge !== "top"
            )
            ||
            (
                serviceTop
                &&
                edge !== "bottom"
            )
        ) {
            return;
        }

        const s = service();

        if (!s) return;

        event.preventDefault();
        event.stopPropagation();

        if (!Number.isFinite(minimumHeight)) {
            minimumHeight =
                s.getBoundingClientRect().height;
        }

        resizeDrag = {
            target,
            edge,

            pointerId:
                event.pointerId,

            startY:
                event.clientY,

            startGrowth:
                currentGrowth(),

            maxGrowth:
                serviceTop
                    ?
                    topMaxGrowth()
                    :
                    bottomMaxGrowth()
        };

        s.classList.add(
            "baca-inspect-service-resizing-v124"
        );

        target.classList.add(
            "is-active"
        );

        try {
            target.setPointerCapture(
                event.pointerId
            );
        } catch (_) {}

        document.addEventListener(
            "pointermove",
            resizeMove,
            true
        );

        document.addEventListener(
            "pointerup",
            stopResize,
            true
        );

        document.addEventListener(
            "pointercancel",
            stopResize,
            true
        );
    }


    function install() {

        const s =
            service();


        if (!s) {
            return;
        }


        /*
         * Do NOT touch:
         *
         * - horizontal card order
         * - horizontal card widths
         * - dropdown styles
         * - typography
         *
         * We only establish the canonical vertical starting state.
         */

        ensureControls();


        if (!initialized) {

            /*
             * Canonical page-open state:
             *
             * four Inspect cards above,
             * Service Inventory below.
             */

            serviceTop =
                false;


            resetScale();


            applyBands();


            /*
             * Force the browser to resolve the .43/.57 tracks BEFORE
             * measuring the minimum.
             *
             * This is the important V1.25 correction.
             */

            void s.offsetHeight;


            minimumHeight =
                s
                    .getBoundingClientRect()
                    .height;


            initialized =
                true;


            console.info(
                "[BACALBASA Inspect V1.25] " +
                "Service minimum =",
                minimumHeight
            );
        }

        else {

            /*
             * Re-visiting Inspect must preserve whichever vertical
             * band the user currently selected.
             */

            applyBands();
        }
    }


    document.addEventListener(
        "pointerdown",
        event => {
            if (
                !(
                    event.target
                    instanceof Element
                )
            ) {
                return;
            }

            const handle =
                event.target.closest(
                    "#view-inspect " +
                    ".baca-inspect-service-handle-v114"
                );

            if (handle) {
                startMove(
                    event,
                    handle
                );

                return;
            }


            const top =
                event.target.closest(
                    "#view-inspect " +
                    ".baca-inspect-service-resize-top-v124"
                );

            if (top) {
                startResize(
                    event,
                    top,
                    "top"
                );

                return;
            }


            const bottom =
                event.target.closest(
                    "#view-inspect " +
                    ".baca-inspect-service-resize-bottom-v124"
                );

            if (bottom) {
                startResize(
                    event,
                    bottom,
                    "bottom"
                );
            }
        },
        true
    );


    requestAnimationFrame(
        () =>
            requestAnimationFrame(
                install
            )
    );


    window.addEventListener(
        "load",
        () =>
            requestAnimationFrame(
                install
            ),
        {
            once: true
        }
    );


    document.addEventListener(
        "click",
        event => {
            if (
                event.target instanceof Element
                &&
                event.target.closest(
                    '[data-view="inspect"]'
                )
            ) {
                requestAnimationFrame(
                    install
                );
            }
        },
        true
    );

    /* ============================================================
       BACALBASA_INSPECT_SERVICE_STARTUP_V128

       Canonical startup geometry owner.

       - normal opening Service height == resize minimum
       - no collapsed 300px state
       - upper middle boundary exactly centered
       - current card order is NOT changed
       ============================================================ */

    let startupFinalizedV128 =
        false;


    function finalizeStartupGeometryV128() {

        if (startupFinalizedV128) {
            return true;
        }


        const s =
            service();

        const g =
            grid();


        if (
            !s
            ||
            !g
        ) {
            return false;
        }


        /*
         * If Inspect is hidden, geometry is not trustworthy.
         * Leave it un-finalized; the Inspect-tab hook below will
         * retry after the tab becomes visible.
         */
        const gridRect =
            g.getBoundingClientRect();


        if (
            gridRect.width < 100
            ||
            gridRect.height < 100
        ) {
            return false;
        }


        /*
         * Canonical page-open state:
         *
         * four diagnostic cards above,
         * Service Inventory below.
         */
        serviceTop =
            false;


        /*
         * Remove any explicit resize geometry inherited from an
         * earlier interaction before measuring the normal layout.
         */
        resetScale();


        applyBands();


        /*
         * Force style/layout resolution.
         */
        void g.offsetHeight;
        void s.offsetHeight;


        const openingHeight =
            s
                .getBoundingClientRect()
                .height;


        if (
            !Number.isFinite(openingHeight)
            ||
            openingHeight < 100
        ) {
            return false;
        }


        /*
         * THIS is the real minimum:
         *
         * exactly the normal Service Inventory size visible when
         * Inspect first opens.
         *
         * This removes the bad tiny state shown in screenshot #1.
         */
        minimumHeight =
            openingHeight;


        /*
         * Symmetric four-column startup geometry.
         *
         * Visual card order is deliberately untouched.
         *
         * 27 + 23 | 23 + 27
         *
         * Because the outer tracks match and the inner tracks match,
         * the boundary between columns 2 and 3 is the exact midpoint.
         */
        g.style.setProperty(
            "grid-template-columns",
            "27fr 23fr 23fr 27fr",
            "important"
        );


        /*
         * Resolve those tracks before handing them back to the
         * existing horizontal reorder/resize controller.
         */
        void g.offsetWidth;


        const a =
            layoutApi();


        if (
            a
            &&
            typeof a.refreshTracks === "function"
        ) {
            try {
                a.refreshTracks();
            } catch (_) {
            }
        }


        startupFinalizedV128 =
            true;


        console.info(
            "[BACALBASA Inspect V1.28]",
            "Service minimum:",
            minimumHeight,
            "columns:",
            getComputedStyle(g).gridTemplateColumns
        );


        return true;
    }


    function scheduleStartupGeometryV128() {

        requestAnimationFrame(
            () => {

                requestAnimationFrame(
                    () => {

                        requestAnimationFrame(
                            () => {

                                requestAnimationFrame(
                                    finalizeStartupGeometryV128
                                );
                            }
                        );
                    }
                );
            }
        );
    }


    /*
     * Normal page refresh.
     */
    if (document.readyState === "complete") {

        scheduleStartupGeometryV128();

    } else {

        window.addEventListener(
            "load",
            scheduleStartupGeometryV128,
            {
                once: true
            }
        );
    }


    /*
     * If the application initially opens on Live/SLAM instead of
     * Inspect, perform the exact same initialization after Inspect
     * becomes visible.
     */
    document.addEventListener(
        "click",
        event => {

            if (
                startupFinalizedV128
                ||
                !(event.target instanceof Element)
            ) {
                return;
            }


            const tab =
                event.target.closest(
                    '[data-view="inspect"]'
                );


            if (!tab) {
                return;
            }


            scheduleStartupGeometryV128();
        },
        true
    );


    /* ============================================================
       BACALBASA_INSPECT_SERVICE_STARTUP_V128_END
       ============================================================ */

})();
