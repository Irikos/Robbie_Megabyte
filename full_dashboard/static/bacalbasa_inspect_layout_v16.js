(() => {
    "use strict";


    /* ============================================================
       BACALBASA INSPECT REORDER V1.8

       Adapted to the same interaction model as Live:

         - real surface follows pointer
         - no drag clone
         - native width belongs to section identity
         - other real sections reflow
         - FLIP settle animation
         - persisted order

       ============================================================ */


    const STORAGE_KEY =
        "g1Dashboard.bacaInspectOrder.v18";


    const DEFAULT_ORDER = [
        "system",
        "imu",
        "odom",
        "processes"
    ];


    const FLIP_MS =
        290;


    const FLIP_EASING =
        "cubic-bezier(0.2, 0.85, 0.25, 1)";


    const animations =
        new WeakMap();


    let grid =
        null;


    let order =
        [...DEFAULT_ORDER];


    let trackWeights = {
        system: 1.12,
        imu: 0.92,
        odom: 0.92,
        processes: 1.04
    };


    let drag =
        null;


    /* ============================================================
       ELEMENTS
       ============================================================ */

    function elements() {

        const view =
            document.getElementById(
                "view-inspect"
            );


        const split =
            view?.querySelector(
                ".base-sensing-card .sensor-split"
            );


        return {
            system:
                view?.querySelector(
                    ".system-health-card"
                ),

            imu:
                split?.querySelector(
                    ".sensor-block:first-child"
                ),

            odom:
                split?.querySelector(
                    ".sensor-block:last-child"
                ),

            processes:
                view?.querySelector(
                    ".runtime-card"
                )
        };
    }


    /* ============================================================
       ORDER STORAGE
       ============================================================ */

    function loadOrder() {

        try {

            const saved =
                JSON.parse(
                    localStorage.getItem(
                        STORAGE_KEY
                    )
                );


            if (
                Array.isArray(saved)
                &&
                saved.length ===
                    DEFAULT_ORDER.length
                &&
                DEFAULT_ORDER.every(
                    key =>
                        saved.includes(key)
                )
            ) {

                return saved;
            }

        } catch (_) {
        }


        return [
            ...DEFAULT_ORDER
        ];
    }


    function saveOrder() {

        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(order)
        );
    }


    /* ============================================================
       WIDTH IDENTITY

       Measure each SECTION'S current native width once.

       Width belongs to:
           system
           imu
           odom
           processes

       NOT to:
           slot 1
           slot 2
           slot 3
           slot 4
       ============================================================ */

    function measureTrackWeights() {

        const map =
            elements();


        const widths = {};


        let total =
            0;


        for (
            const key
            of DEFAULT_ORDER
        ) {

            const el =
                map[key];


            if (!el) {
                return false;
            }


            const width =
                el
                    .getBoundingClientRect()
                    .width;


            if (
                !Number.isFinite(width)
                ||
                width < 20
            ) {

                return false;
            }


            widths[key] =
                width;


            total +=
                width;
        }


        if (total <= 0) {
            return false;
        }


        const mean =
            total
            /
            DEFAULT_ORDER.length;


        trackWeights = {};


        for (
            const key
            of DEFAULT_ORDER
        ) {

            trackWeights[key] =
                widths[key]
                /
                mean;
        }


        return true;
    }


    /* ============================================================
       APPLY ORDER

       Column widths are emitted IN SECTION ORDER.

       Therefore when A and B exchange places:
           A keeps A width
           B keeps B width
       ============================================================ */

    function applyOrderBare(
        nextOrder
    ) {

        if (
            !grid
            ||
            !trackWeights
        ) {
            return;
        }


        const map =
            elements();


        const tracks =
            nextOrder
                .map(
                    key =>
                        `minmax(0, ${trackWeights[key]}fr)`
                )
                .join(" ");


        grid.style.setProperty(
            "grid-template-columns",
            tracks,
            "important"
        );


        nextOrder.forEach(
            (key, index) => {

                const el =
                    map[key];


                if (!el) {
                    return;
                }


                el.style.setProperty(
                    "grid-column",
                    String(index + 1),
                    "important"
                );


                el.style.setProperty(
                    "grid-row",
                    String(
                        window.BACALBASA_INSPECT_VERTICAL_V115?.topRow?.()
                        || 1
                    ),
                    "important"
                );
            }
        );
    }


    /* ============================================================
       FLIP
       ============================================================ */

    function captureRects() {

        const map =
            elements();


        const result = {};


        for (
            const key
            of DEFAULT_ORDER
        ) {

            const el =
                map[key];


            if (el) {

                result[key] =
                    el.getBoundingClientRect();
            }
        }


        return result;
    }


    function cancelAnimations() {

        const map =
            elements();


        for (
            const key
            of DEFAULT_ORDER
        ) {

            const el =
                map[key];


            const animation =
                el
                ?
                animations.get(el)
                :
                null;


            if (animation) {

                try {
                    animation.cancel();
                } catch (_) {
                }


                animations.delete(el);
            }
        }
    }


    function animateFrom(
        before,
        skipKey = null
    ) {

        const map =
            elements();


        for (
            const key
            of DEFAULT_ORDER
        ) {

            if (
                key === skipKey
            ) {
                continue;
            }


            const el =
                map[key];


            const oldRect =
                before[key];


            if (
                !el
                ||
                !oldRect
            ) {
                continue;
            }


            const now =
                el.getBoundingClientRect();


            const dx =
                oldRect.left
                -
                now.left;


            const dy =
                oldRect.top
                -
                now.top;


            if (
                Math.abs(dx) < .5
                &&
                Math.abs(dy) < .5
            ) {
                continue;
            }


            const animation =
                el.animate(
                    [
                        {
                            transform:
                                `translate3d(${dx}px, ${dy}px, 0)`
                        },
                        {
                            transform:
                                "translate3d(0,0,0)"
                        }
                    ],
                    {
                        duration:
                            FLIP_MS,

                        easing:
                            FLIP_EASING,

                        fill:
                            "none"
                    }
                );


            animations.set(
                el,
                animation
            );


            animation.addEventListener(
                "finish",
                () => {

                    if (
                        animations.get(el)
                        ===
                        animation
                    ) {

                        animations.delete(el);
                    }
                },
                {
                    once:
                        true
                }
            );
        }
    }


    /* ============================================================
       NATURAL RECTS

       During drag, the held card has a transform.

       Temporarily remove that transform so we can measure its real
       new grid slot without moving it visually for the user.
       ============================================================ */

    function naturalRects() {

        if (!drag) {
            return captureRects();
        }


        const old =
            drag.el.style.transform;


        drag.el.style.transform =
            "none";


        const result =
            captureRects();


        drag.el.style.transform =
            old;


        return result;
    }


    function centersFrom(
        rects
    ) {

        const result = {};


        for (
            const key
            of order
        ) {

            const r =
                rects[key];


            if (r) {

                result[key] =
                    r.left
                    +
                    r.width / 2;
            }
        }


        return result;
    }


    /* ============================================================
       HELD REAL PANEL FOLLOWS POINTER
       ============================================================ */

    function followPointer(
        clientX
    ) {

        if (!drag) {
            return;
        }


        const natural =
            naturalRects()[
                drag.key
            ];


        if (!natural) {
            return;
        }


        const desiredLeft =
            drag.startRect.left
            +
            (
                clientX
                -
                drag.startX
            );


        const translateX =
            desiredLeft
            -
            natural.left;


        drag.el.style.transform =
            `translate3d(${translateX}px,0,0)`;
    }


    /* ============================================================
       DRAG
       ============================================================ */

    function beginDrag(
        event,
        key,
        handle,
        el
    ) {

        if (
            event.button !== 0
            ||
            drag
        ) {
            return;
        }


        event.preventDefault();
        event.stopPropagation();


        cancelAnimations();


        const startRect =
            el.getBoundingClientRect();


        drag = {
            key,
            el,
            handle,

            pointerId:
                event.pointerId,

            startX:
                event.clientX,

            startRect,

            startOrder:
                [...order],

            targetOrder:
                [...order],

            centers:
                centersFrom(
                    captureRects()
                )
        };


        el.classList.add(
            "baca-inspect-following-v18"
        );


        handle.classList.add(
            "is-active"
        );


        document
            .getElementById(
                "view-inspect"
            )
            ?.classList.add(
                "baca-inspect-dragging-v18"
            );


        try {

            handle.setPointerCapture(
                event.pointerId
            );

        } catch (_) {
        }


        document.addEventListener(
            "pointermove",
            moveDrag,
            true
        );


        document.addEventListener(
            "pointerup",
            finishDrag,
            true
        );


        document.addEventListener(
            "pointercancel",
            cancelDrag,
            true
        );
    }


    function moveDrag(
        event
    ) {

        if (
            !drag
            ||
            event.pointerId
                !==
                drag.pointerId
        ) {
            return;
        }


        event.preventDefault();


        followPointer(
            event.clientX
        );


        let targetIndex =
            drag.targetOrder.indexOf(
                drag.key
            );


        let best =
            Infinity;


        drag.targetOrder.forEach(
            (key, index) => {

                const center =
                    drag.centers[key];


                if (
                    !Number.isFinite(center)
                ) {
                    return;
                }


                const distance =
                    Math.abs(
                        event.clientX
                        -
                        center
                    );


                if (
                    distance
                    <
                    best
                ) {

                    best =
                        distance;

                    targetIndex =
                        index;
                }
            }
        );


        const currentIndex =
            drag.targetOrder.indexOf(
                drag.key
            );


        if (
            targetIndex ===
            currentIndex
        ) {
            return;
        }


        /*
         * Capture CURRENT visible positions first.
         */

        const before =
            captureRects();


        cancelAnimations();


        const next =
            [
                ...drag.targetOrder
            ];


        next.splice(
            currentIndex,
            1
        );


        next.splice(
            targetIndex,
            0,
            drag.key
        );


        drag.targetOrder =
            next;


        order =
            [...next];


        applyOrderBare(
            order
        );


        /*
         * Measure the accepted/native destinations before the held
         * panel's pointer translation is re-established.
         */

        const destinations =
            naturalRects();


        drag.centers =
            centersFrom(
                destinations
            );


        /*
         * Other REAL sections FLIP into their new positions.
         */

        animateFrom(
            before,
            drag.key
        );


        /*
         * Held REAL section remains underneath pointer.
         */

        followPointer(
            event.clientX
        );
    }


    function cleanupDrag() {

        if (!drag) {
            return;
        }


        drag.el.classList.remove(
            "baca-inspect-following-v18"
        );


        drag.el.style.removeProperty(
            "transform"
        );


        drag.handle.classList.remove(
            "is-active"
        );


        document
            .getElementById(
                "view-inspect"
            )
            ?.classList.remove(
                "baca-inspect-dragging-v18"
            );


        document.removeEventListener(
            "pointermove",
            moveDrag,
            true
        );


        document.removeEventListener(
            "pointerup",
            finishDrag,
            true
        );


        document.removeEventListener(
            "pointercancel",
            cancelDrag,
            true
        );
    }


    function finish(
        event,
        cancelled
    ) {

        if (
            !drag
            ||
            event.pointerId
                !==
                drag.pointerId
        ) {
            return;
        }


        event.preventDefault();


        /*
         * Capture exactly where every REAL surface currently appears.
         */

        const before =
            captureRects();


        cancelAnimations();


        const finalOrder =
            cancelled
            ?
            drag.startOrder
            :
            drag.targetOrder;


        try {

            drag.handle
                .releasePointerCapture(
                    event.pointerId
                );

        } catch (_) {
        }


        drag.el.style.removeProperty(
            "transform"
        );


        order =
            [...finalOrder];


        applyOrderBare(
            order
        );


        /*
         * Same Live-style FLIP settle.
         */

        animateFrom(
            before
        );


        if (!cancelled) {
            saveOrder();
        }


        cleanupDrag();


        drag =
            null;
    }


    function finishDrag(
        event
    ) {

        finish(
            event,
            false
        );
    }


    function cancelDrag(
        event
    ) {

        finish(
            event,
            true
        );
    }


    /* ============================================================
       HANDLES
       ============================================================ */

    function installHandle(
        el,
        key
    ) {

        if (!el) {
            return;
        }


        /*
         * Reuse the V1.6 handle if already present.
         */

        const old =
            el.querySelector(
                ":scope > .baca-inspect-drag-handle-v16"
            );


        const handle =
            old
            ||
            document.createElement(
                "button"
            );


        handle.type =
            "button";


        handle.className =
            "baca-inspect-drag-handle-v16";


        handle.title =
            "Drag to reorder";


        handle.setAttribute(
            "aria-label",
            `Move ${key} section`
        );


        if (!old) {

            const grip =
                document.createElement(
                    "span"
                );


            grip.className =
                "baca-inspect-drag-grip-v16";


            handle.appendChild(
                grip
            );


            el.prepend(
                handle
            );
        }


        /*
         * Clone the handle to discard V1.6 pointer listeners.
         */

        const fresh =
            handle.cloneNode(true);


        handle.replaceWith(
            fresh
        );


        fresh.addEventListener(
            "pointerdown",
            event => {

                beginDrag(
                    event,
                    key,
                    fresh,
                    el
                );
            },
            true
        );
    }


    /* ============================================================
       INSTALL
       ============================================================ */

    function install() {

        grid =
            document.querySelector(
                "#view-inspect .inspect-health-grid.inspect-v45"
            );


        const map =
            elements();


        if (
            !grid
            ||
            DEFAULT_ORDER.some(
                key => !map[key]
            )
        ) {
            return;
        }


        /*
         * Measure default/native geometry BEFORE restoring order.
         * That permanently associates width with section identity.
         */

        


        order =
            loadOrder();


        applyOrderBare(
            order
        );


        for (
            const key
            of DEFAULT_ORDER
        ) {

            installHandle(
                map[key],
                key
            );
        }
    }


    requestAnimationFrame(
        () => requestAnimationFrame(
            install
        )
    );



    /* ============================================================
       BACALBASA_INSPECT_LAYOUT_BRIDGE_V111

       Resize and reorder share ONE width owner.

       Width belongs to panel identity, never to slot position.
       ============================================================ */

    window.BACALBASA_INSPECT_LAYOUT_V18 = {

        getOrder(){
            return [...order];
        },

        setOrder(next){

            if (
                !Array.isArray(next)
                ||
                next.length !== 4
            ) {
                return false;
            }

            order = [...next];

            applyOrderBare(order);

            return true;
        },

        getTrackWeights(){
            return {...trackWeights};
        },

        setTrackWeights(next){

            trackWeights = {
                ...trackWeights,
                ...next
            };

            applyOrderBare(order);
        },

        getElements(){
            return elements();
        },

        refresh(){
            applyOrderBare(order);
        }
    };



    /* BACALBASA_INSPECT_HANDLE_REINSTALL_V113
       Re-run the existing handle installer after final layout settles.
       No geometry or reorder behaviour is changed.
    */

    window.addEventListener(
        "load",
        () => {
            requestAnimationFrame(
                () => requestAnimationFrame(
                    install
                )
            );
        },
        {once:true}
    );

    document.addEventListener(
        "click",
        event => {

            if (
                event.target.closest(
                    '[data-view="inspect"]'
                )
            ) {
                requestAnimationFrame(
                    () => requestAnimationFrame(
                        install
                    )
                );
            }
        },
        true
    );



    /* ============================================================
       BACALBASA_INSPECT_SERVICE_HANDLE_V114

       Visual drag handle for the full-width Service Inventory card.

       IMPORTANT:
       This does NOT modify grid rows, heights, resizing, or the
       existing four-card reorder system.
       ============================================================ */

    function installServiceInventoryHandleV114() {

        const service =
            document.querySelector(
                "#view-inspect .unitree-services-card"
            );

        if (!service) {
            return;
        }


        if (
            service.querySelector(
                ":scope > .baca-inspect-service-handle-v114"
            )
        ) {
            return;
        }


        const handle =
            document.createElement(
                "button"
            );

        handle.type =
            "button";

        handle.className =
            "baca-inspect-drag-handle-v16 " +
            "baca-inspect-service-handle-v114";

        handle.title =
            "Move Service Inventory";

        handle.setAttribute(
            "aria-label",
            "Move Service Inventory"
        );


        const grip =
            document.createElement(
                "span"
            );

        grip.className =
            "baca-inspect-drag-grip-v16";


        handle.appendChild(
            grip
        );

        service.prepend(
            handle
        );
    }


    window.addEventListener(
        "load",
        () => {

            requestAnimationFrame(
                () => requestAnimationFrame(
                    installServiceInventoryHandleV114
                )
            );
        },
        {
            once:
                true
        }
    );


    document.addEventListener(
        "click",
        event => {

            if (
                event.target.closest(
                    '[data-view="inspect"]'
                )
            ) {

                requestAnimationFrame(
                    () => requestAnimationFrame(
                        installServiceInventoryHandleV114
                    )
                );
            }
        },
        true
    );

})();
