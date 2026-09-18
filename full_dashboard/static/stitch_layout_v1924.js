/* ==================================================================
   STITCH V1.9.24

   Major-section drag is adapted from Bacalbasa D15L + D15M:

       - actual surface follows pointer
       - native width follows the surface
       - other real surfaces live-reflow
       - FLIP transition
       - no wiggle
       - no drag clone
       - persisted browser-local order

   V1.9.23 remains loaded for its working functional YOLO proxy.
   Its old section handles are removed here, making its old drag
   listeners unreachable.

   No MutationObserver.
   No setInterval.
   No polling.
   ================================================================== */

(function(){

    "use strict";


    const STORAGE_KEY =
        "g1Dashboard.stitchMajorOrder.v1924";


    const DEFAULT_ORDER = [
        "camera",
        "twin",
        "rail"
    ];


    const FLIP_MS =
        290;


    const FLIP_EASING =
        "cubic-bezier(0.2, 0.85, 0.25, 1)";


    const animations =
        new WeakMap();


    let layout =
        null;


    let order = [
        ...DEFAULT_ORDER
    ];


    let trackWeights =
        null;


    let drag =
        null;

    /* ============================================================
       
STITCH_MAJOR_RESIZE_BRIDGE_V1931

       Small bridge for the side-resize layer.

       The resize layer does NOT replace V1.9.24's reorder engine.
       It asks the existing engine to re-measure its native track
       proportions after a resize, keeping subsequent reorder drags
       consistent with the new widths.
       ============================================================ */

    window.__stitchMajorResizeBridgeV1931 = {

        isDragging(){

            return Boolean(
                drag
            );
        },


        refreshTracks(){

            if(!layout){
                return false;
            }


            /*
             * V1.9.32 IMPORTANT:
             *
             * Do NOT call measureTrackWeights() here.
             *
             * V1.9.24's original measurement path intentionally
             * clears grid-template-columns and returns to the native
             * stylesheet geometry first. That was erasing the user's
             * newly resized widths.
             *
             * Instead, read the CURRENT rendered widths directly and
             * teach the existing V1.9.24 reorder engine those ratios.
             */

            const widths = {};

            let total =
                0;


            for(
                const [
                    key,
                    section
                ]
                of Object.entries(
                    layout.elements
                )
            ){

                const width =
                    section
                        .getBoundingClientRect()
                        .width;


                if(
                    !Number.isFinite(width)
                    ||
                    width <= 0
                ){
                    return false;
                }


                widths[key] =
                    width;


                total +=
                    width;
            }


            if(total <= 0){
                return false;
            }


            /*
             * trackFor() only needs proportional weights.
             *
             * Keeping the scale around the original ~1.0 values also
             * makes this easy to inspect in DevTools.
             */

            const mean =
                total
                /
                Object.keys(widths).length;


            trackWeights = {};


            for(
                const [
                    key,
                    width
                ]
                of Object.entries(
                    widths
                )
            ){

                trackWeights[key] =
                    width
                    /
                    mean;
            }


            /*
             * Re-express the exact current proportions through the
             * ORIGINAL V1.9.24 grid engine.
             *
             * The reordered section therefore keeps its resized
             * native width instead of reverting.
             */

            applyOrderBare(
                order
            );


            return true;

        },


        currentOrder()
{

            return [
                ...order
            ];
        }

    };




    /* ============================================================
       BASIC HELPERS
       ============================================================ */

    function sameOrder(a,b){

        return (
            a.length === b.length
            &&
            a.every(
                (value,index) =>
                    value === b[index]
            )
        );
    }


    function validOrder(value){

        return (
            Array.isArray(value)
            &&
            value.length === 3
            &&
            DEFAULT_ORDER.every(
                key =>
                    value.includes(key)
            )
            &&
            new Set(value).size === 3
        );
    }


    function loadOrder(){

        try{

            const value =
                JSON.parse(
                    localStorage.getItem(
                        STORAGE_KEY
                    )
                    || "null"
                );


            if(validOrder(value)){
                return value;
            }

        }catch(_){
        }


        return [
            ...DEFAULT_ORDER
        ];
    }


    function saveOrder(){

        try{

            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify(order)
            );

        }catch(_){
        }
    }


    /* ============================================================
       RESOLVE THE THREE REAL MAJOR SURFACES
       ============================================================ */

    function resolveLayout(){

        const grid =
            document.querySelector(
                "#view-live .combined-live-grid"
            );


        if(!grid){
            return null;
        }


        const camera =
            [...grid.children].find(
                element =>
                    element.matches(
                        ".camera-panel"
                    )
            );


        const twin =
            [...grid.children].find(
                element =>
                    element.matches(
                        ".twin-panel"
                    )
                    ||
                    element.contains(
                        document.getElementById(
                            "robotTwinCanvas"
                        )
                    )
            );


        const rail =
            [...grid.children].find(
                element =>
                    element.matches(
                        ".operator-rail,"
                        +
                        ".combined-rail"
                    )
            );


        if(
            !camera
            ||
            !twin
            ||
            !rail
        ){

            console.error(
                "V1.9.24: major surface missing",
                {
                    camera:
                        Boolean(camera),

                    twin:
                        Boolean(twin),

                    rail:
                        Boolean(rail)
                }
            );

            return null;
        }


        return {
            grid,

            elements: {
                camera,
                twin,
                rail
            }
        };
    }


    /* ============================================================
       RETIRE V1.9.20 - V1.9.23 MAJOR-DRAG ARTIFACTS
       ============================================================ */

    function retireOldMajorDrag(){

        if(!layout){
            return;
        }


        for(
            const section
            of Object.values(
                layout.elements
            )
        ){

            section
                .querySelectorAll(
                    ":scope > "
                    +
                    ".stitch-section-handle-v1920,"
                    +
                    ":scope > "
                    +
                    ".stitch-section-handle-v1921,"
                    +
                    ":scope > "
                    +
                    ".stitch-section-handle-v1922,"
                    +
                    ":scope > "
                    +
                    ".stitch-section-handle-v1923"
                )
                .forEach(
                    handle =>
                        handle.remove()
                );


            section.classList.remove(
                "stitch-draggable-section-v1920",
                "stitch-slot-v1921",
                "stitch-slot-v1922",
                "stitch-slot-v1923",
                "stitch-section-dragging-v1920",
                "stitch-section-dragging-v1921",
                "stitch-section-dragging-v1922",
                "stitch-section-dragging-v1923"
            );


            section.style.removeProperty(
                "grid-column"
            );

            section.style.removeProperty(
                "grid-row"
            );


            for(
                const property
                of [
                    "--stitch-section-drag-x-v1920",
                    "--stitch-section-drag-y-v1920",
                    "--stitch-drag-x-v1921",
                    "--stitch-drag-y-v1921",
                    "--stitch-drag-x-v1922",
                    "--stitch-drag-y-v1922",
                    "--stitch-drag-x-v1923",
                    "--stitch-drag-y-v1923"
                ]
            ){

                section.style.removeProperty(
                    property
                );
            }
        }


        layout.grid.classList.remove(
            "stitch-section-arranging-v1920",
            "stitch-section-arranging-v1921",
            "stitch-section-arranging-v1922",
            "stitch-section-arranging-v1923"
        );


        /*
         * Return to the currently approved stylesheet geometry
         * before measuring our section-native proportions.
         */

        layout.grid.style.removeProperty(
            "grid-template-columns"
        );


        void layout.grid.offsetWidth;
    }


    /* ============================================================
       NATIVE TRACK SIZE

       Important difference from V1.9.23:

       the WIDTH belongs to the SECTION, not to the physical slot.

       Therefore when Camera moves, its wide track moves with it;
       when the operator rail moves, its narrow track moves with it.
       ============================================================ */


    /* ============================================================
       STITCH_V1925_SINGLE_MAJOR_OWNER

       Width belongs to section identity, not starting slot.
       ============================================================ */

    function nativeTrackWeightsV1925(){

        if(
            window.matchMedia(
                "(max-width: 1380px)"
            ).matches
        ){
            return {
                camera: 1.00,
                twin:   1.05,
                rail:    .46
            };
        }


        return {
            camera: 1.03,
            twin:   1.12,
            rail:    .50
        };
    }


    /*
     * Physically remove historical major-section handles.
     *
     * Their listeners disappear with their DOM nodes.
     * V1.9.24's .stitch-major-handle-v1924 is untouched.
     */
    function purgeLegacyMajorHandlesV1925(){

        const selectors = [
            ".stitch-section-handle-v1920",
            ".stitch-section-handle-v1921",
            ".stitch-section-handle-v1922",
            ".stitch-section-handle-v1923"
        ];


        const oldHandles =
            document.querySelectorAll(
                "#view-live "
                +
                selectors.join(
                    ", #view-live "
                )
            );


        const removed =
            oldHandles.length;


        oldHandles.forEach(
            handle =>
                handle.remove()
        );


        if(layout){

            for(
                const section
                of Object.values(
                    layout.elements
                )
            ){

                section.classList.remove(
                    "stitch-section-dragging-v1920",
                    "stitch-section-dragging-v1921",
                    "stitch-section-dragging-v1922",
                    "stitch-section-dragging-v1923"
                );
            }
        }


        console.log(
            "V1.9.25 legacy handles removed:",
            removed
        );
    }


    function measureTrackWeights(){

        const widths = {};


        for(
            const key
            of DEFAULT_ORDER
        ){

            widths[key] =
                Math.max(
                    1,
                    layout.elements[
                        key
                    ]
                    .getBoundingClientRect()
                    .width
                );
        }


        const smallest =
            Math.min(
                ...Object.values(
                    widths
                )
            );


        const result = {};


        for(
            const key
            of DEFAULT_ORDER
        ){

            result[key] =
                widths[key]
                /
                smallest;
        }


        console.log(
            "V1.9.24 native tracks",
            {
                widths,
                weights:
                    result
            }
        );


        return result;
    }


    function trackFor(key){

        return (
            "minmax(0, "
            +
            trackWeights[key]
                .toFixed(5)
            +
            "fr)"
        );
    }


    /* ============================================================
       GRID ORDER
       ============================================================ */

    function applyOrderBare(next){

        order = [
            ...next
        ];


        layout.grid.style.setProperty(
            "grid-template-columns",

            order
                .map(trackFor)
                .join(" "),

            "important"
        );


        order.forEach(
            (key,index)=>{

                const section =
                    layout.elements[
                        key
                    ];


                section.style.setProperty(
                    "grid-column",
                    String(index + 1),
                    "important"
                );


                section.style.setProperty(
                    "grid-row",
                    "1",
                    "important"
                );
            }
        );


        /*
         * Force actual geometry before FLIP measurements.
         */

        layout.grid
            .getBoundingClientRect();
    }


    /* ============================================================
       BACALBASA FLIP
       ============================================================ */

    function captureRects(
        exclude = null
    ){

        const before =
            new Map();


        for(
            const section
            of Object.values(
                layout.elements
            )
        ){

            if(section === exclude){
                continue;
            }


            before.set(
                section,
                section.getBoundingClientRect()
            );
        }


        return before;
    }


    function cancelAnimation(
        element
    ){

        const animation =
            animations.get(
                element
            );


        if(!animation){
            return;
        }


        try{
            animation.cancel();
        }catch(_){
        }


        animations.delete(
            element
        );
    }


    function cancelAnimations(
        exclude = null
    ){

        for(
            const section
            of Object.values(
                layout.elements
            )
        ){

            if(section !== exclude){
                cancelAnimation(
                    section
                );
            }
        }
    }


    function animateFrom(
        before,
        exclude = null
    ){

        for(
            const [
                element,
                oldRect
            ]
            of before
        ){

            if(element === exclude){
                continue;
            }


            cancelAnimation(
                element
            );


            const newRect =
                element.getBoundingClientRect();


            const dx =
                oldRect.left
                -
                newRect.left;


            const dy =
                oldRect.top
                -
                newRect.top;


            if(
                Math.abs(dx) < .5
                &&
                Math.abs(dy) < .5
            ){
                continue;
            }


            try{

                const animation =
                    element.animate(
                        [
                            {
                                transform:
                                    `translate3d(${dx}px, ${dy}px, 0) scale(0.985)`
                            },
                            {
                                transform:
                                    "translate3d(0, 0, 0) scale(1)"
                            }
                        ],
                        {
                            duration:
                                FLIP_MS,

                            easing:
                                FLIP_EASING,

                            fill:
                                "both"
                        }
                    );


                animations.set(
                    element,
                    animation
                );


                animation.addEventListener(
                    "finish",
                    ()=>{

                        if(
                            animations.get(
                                element
                            )
                            === animation
                        ){
                            animations.delete(
                                element
                            );
                        }


                        animation.cancel();
                    },
                    {
                        once:
                            true
                    }
                );

            }catch(_){
            }
        }
    }


    /* ============================================================
       BACALBASA D15K TARGET ORDER
       Exact three-horizontal-position model.
       ============================================================ */

    function targetIndex(
        clientX
    ){

        const rect =
            layout.grid
                .getBoundingClientRect();


        const ratio =
            Math.max(
                0,
                Math.min(
                    .999999,

                    (
                        clientX
                        -
                        rect.left
                    )
                    /
                    Math.max(
                        1,
                        rect.width
                    )
                )
            );


        if(ratio < 1 / 3){
            return 0;
        }


        if(ratio < 2 / 3){
            return 1;
        }


        return 2;
    }


    function candidateOrder(
        key,
        index,
        startOrder
    ){

        const result =
            startOrder.filter(
                item =>
                    item !== key
            );


        result.splice(
            index,
            0,
            key
        );


        return result;
    }


    /* ============================================================
       D15M LIVE REFLOW
       ============================================================ */

    function moveDrag(event){

        if(
            !drag
            ||
            event.pointerId
                !== drag.pointerId
        ){
            return;
        }


        event.preventDefault();


        const desiredLeft =
            event.clientX
            -
            drag.grabOffset;


        drag.dx =
            desiredLeft
            -
            drag.baseLeft;


        drag.rail.style.setProperty(
            "--stitch-major-drag-x-v1924",
            `${drag.dx}px`
        );


        const candidate =
            candidateOrder(
                drag.key,
                targetIndex(
                    event.clientX
                ),
                drag.startOrder
            );


        if(
            sameOrder(
                candidate,
                drag.currentOrder
            )
        ){
            return;
        }


        /*
         * Capture where the OTHER real surfaces currently appear.
         */

        const before =
            captureRects(
                drag.rail
            );


        cancelAnimations(
            drag.rail
        );


        const oldDx =
            drag.dx;


        /*
         * Live grid reflow.
         */

        applyOrderBare(
            candidate
        );


        /*
         * The grid underneath the dragged surface just moved.
         *
         * Recover its NEW untransformed base position and immediately
         * recompute the translation so the exact same grabbed point
         * remains underneath the cursor.
         */

        const visualWithOldTransform =
            drag.rail
                .getBoundingClientRect()
                .left;


        drag.baseLeft =
            visualWithOldTransform
            -
            oldDx;


        drag.dx =
            desiredLeft
            -
            drag.baseLeft;


        drag.rail.style.setProperty(
            "--stitch-major-drag-x-v1924",
            `${drag.dx}px`
        );


        /*
         * Only the OTHER two surfaces perform the FLIP transition.
         * The held surface remains physically attached to the cursor.
         */

        animateFrom(
            before,
            drag.rail
        );


        drag.currentOrder = [
            ...candidate
        ];


        drag.targetOrder = [
            ...candidate
        ];
    }


    /* ============================================================
       BEGIN / FINISH
       ============================================================ */

    function beginDrag(
        event,
        key,
        handle,
        rail
    ){

        if(
            event.button !== 0
            ||
            drag
        ){
            return;
        }


        event.preventDefault();
        event.stopImmediatePropagation();


        cancelAnimations();


        const rect =
            rail.getBoundingClientRect();


        drag = {
            pointerId:
                event.pointerId,

            key,

            handle,

            rail,

            grabOffset:
                event.clientX
                -
                rect.left,

            baseLeft:
                rect.left,

            dx:
                0,

            startOrder: [
                ...order
            ],

            currentOrder: [
                ...order
            ],

            targetOrder: [
                ...order
            ]
        };


        rail.classList.add(
            "stitch-major-following-v1924"
        );


        handle.classList.add(
            "stitch-major-handle-active-v1924"
        );


        document.body.classList.add(
            "stitch-major-dragging-v1924"
        );


        try{

            handle.setPointerCapture(
                event.pointerId
            );

        }catch(_){
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


    function cleanupDrag(){

        if(!drag){
            return;
        }


        drag.rail.classList.remove(
            "stitch-major-following-v1924"
        );


        drag.handle.classList.remove(
            "stitch-major-handle-active-v1924"
        );


        drag.rail.style.removeProperty(
            "--stitch-major-drag-x-v1924"
        );


        document.body.classList.remove(
            "stitch-major-dragging-v1924"
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
    ){

        if(
            !drag
            ||
            event.pointerId
                !== drag.pointerId
        ){
            return;
        }


        event.preventDefault();
        event.stopImmediatePropagation();


        /*
         * Capture CURRENT visible locations while the held real
         * section is still underneath the cursor.
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


        const handle =
            drag.handle;


        try{

            handle.releasePointerCapture(
                event.pointerId
            );

        }catch(_){
        }


        /*
         * Remove cursor translation, then establish accepted grid.
         */

        drag.rail.classList.remove(
            "stitch-major-following-v1924"
        );


        drag.rail.style.removeProperty(
            "--stitch-major-drag-x-v1924"
        );


        applyOrderBare(
            finalOrder
        );


        /*
         * All three real surfaces now FLIP from their current
         * visible positions into the final accepted arrangement.
         */

        animateFrom(
            before
        );


        if(!cancelled){

            order = [
                ...finalOrder
            ];

            saveOrder();
        }


        cleanupDrag();


        drag =
            null;
    }


    function finishDrag(event){

        finish(
            event,
            false
        );
    }


    function cancelDrag(event){

        finish(
            event,
            true
        );
    }


    /* ============================================================
       HANDLES
       ============================================================ */

    function makeHandle(
        section,
        key
    ){

        const handle =
            document.createElement(
                "button"
            );


        handle.type =
            "button";


        handle.className =
            "stitch-major-handle-v1924";


        handle.setAttribute(
            "aria-label",
            `Move ${key} section`
        );


        handle.title =
            `Drag ${key} section`;


        const grip =
            document.createElement(
                "span"
            );


        grip.className =
            "stitch-major-grip-v1924";


        grip.setAttribute(
            "aria-hidden",
            "true"
        );


        handle.appendChild(
            grip
        );


        /*
         * Capture phase guarantees that this new V1.9.24 owner wins
         * over any surviving historical bubbling listeners.
         */

        handle.addEventListener(
            "pointerdown",
            event => {

                beginDrag(
                    event,
                    key,
                    handle,
                    section
                );
            },
            true
        );


        section.prepend(
            handle
        );
    }


    /* ============================================================
       MODE / ARM OWNERSHIP STRUCTURAL REPAIR

       V1.9.23 moved only .panel-kicker and therefore orphaned
       #modeValue.

       Rebuild using:
           complete MODE cluster
           complete ownership cluster
       ============================================================ */

    function clearGeometry(element){

        if(!element){
            return;
        }


        for(
            const property
            of [
                "position",
                "left",
                "right",
                "top",
                "bottom",
                "inset",
                "translate",
                "transform",
                "margin-top"
            ]
        ){

            element.style.removeProperty(
                property
            );
        }
    }


    function repairModeOwnership(){

        const hero =
            document.querySelector(
                "#view-live "
                +
                ".hero-state "
                +
                ".hero-top"
            );


        if(!hero){
            return;
        }


        const modeTitle =
            hero.querySelector(
                ".panel-kicker"
            );


        const modeValue =
            hero.querySelector(
                "#modeValue"
            );


        const ownership =
            hero.querySelector(
                ".ownership-box"
            );


        if(
            !modeTitle
            ||
            !modeValue
            ||
            !ownership
        ){

            console.error(
                "V1.9.24 ownership: required node missing"
            );

            return;
        }


        /*
         * modeValue's parent is the COMPLETE ORIGINAL left cluster.
         * V1.9.23 left this wrapper behind when it removed MODE.
         */

        let modeCluster =
            modeValue.parentElement;


        if(
            !modeCluster
            ||
            modeCluster === hero
            ||
            modeCluster.classList.contains(
                "stitch-mode-heading-v1923"
            )
            ||
            modeCluster.classList.contains(
                "stitch-mode-heading-v1924"
            )
        ){

            modeCluster =
                document.createElement(
                    "div"
                );


            modeValue.before(
                modeCluster
            );


            modeCluster.appendChild(
                modeValue
            );
        }


        /*
         * Restore MODE to its original cluster, immediately above its
         * real dynamic value.
         */

        if(
            modeTitle.parentElement
            !== modeCluster
        ){

            modeCluster.prepend(
                modeTitle
            );
        }


        modeCluster.classList.add(
            "stitch-mode-cluster-v1924"
        );


        /*
         * Build exactly ONE structural two-column row.
         */

        let row =
            hero.querySelector(
                ":scope > "
                +
                ".stitch-mode-heading-v1924"
            );


        if(!row){

            row =
                document.createElement(
                    "div"
                );


            row.className =
                "stitch-mode-heading-v1924";


            hero.prepend(
                row
            );
        }


        row.append(
            modeCluster,
            ownership
        );


        /*
         * Remove empty historical V1.9.23 row.
         */

        hero
            .querySelectorAll(
                ":scope > "
                +
                ".stitch-mode-heading-v1923"
            )
            .forEach(
                oldRow => {

                    if(
                        oldRow !== row
                        &&
                        oldRow.children.length === 0
                    ){
                        oldRow.remove();
                    }
                }
            );


        for(
            const element
            of [
                row,
                modeCluster,
                modeTitle,
                modeValue,
                ownership,
                ...ownership.children
            ]
        ){

            clearGeometry(
                element
            );
        }


        requestAnimationFrame(()=>{

            const modeRect =
                modeTitle
                    .getBoundingClientRect();


            const ownershipLabel =
                ownership.querySelector(
                    ":scope > span"
                );


            const ownerRect =
                ownershipLabel
                    ?.getBoundingClientRect();


            console.log(
                "V1.9.24 OWNERSHIP STRUCTURAL PASS",
                {
                    modeTop:
                        modeRect.top,

                    ownershipTop:
                        ownerRect?.top,

                    difference:
                        ownerRect
                        ?
                        ownerRect.top
                        -
                        modeRect.top
                        :
                        null,

                    modeValueCount:
                        document.querySelectorAll(
                            "#modeValue"
                        ).length,

                    ownershipValueCount:
                        document.querySelectorAll(
                            "#ownershipValue"
                        ).length
                }
            );
        });
    }



    /* ============================================================
       V1.9.25 — EXACT MODE / OWNERSHIP Y ALIGNMENT
       ============================================================ */

    function alignOwnershipExactV1925(){

        const mode =
            document.querySelector(
                "#view-live "
                +
                ".stitch-mode-heading-v1924 "
                +
                ".panel-kicker"
            );


        const ownership =
            document.querySelector(
                "#view-live "
                +
                ".stitch-mode-heading-v1924 "
                +
                ".ownership-box"
            );


        const ownershipLabel =
            ownership
                ?.querySelector(
                    ":scope > span"
                );


        if(
            !mode
            ||
            !ownership
            ||
            !ownershipLabel
        ){
            return;
        }


        /*
         * Always measure from neutral geometry.
         */

        ownership.style.setProperty(
            "transform",
            "none",
            "important"
        );


        const modeRect =
            mode.getBoundingClientRect();


        const ownerRect =
            ownershipLabel
                .getBoundingClientRect();


        const delta =
            modeRect.top
            -
            ownerRect.top;


        ownership.style.setProperty(
            "transform",

            (
                "translate3d("
                +
                "0, "
                +
                delta.toFixed(2)
                +
                "px, "
                +
                "0)"
            ),

            "important"
        );


        console.log(
            "V1.9.25 OWNERSHIP ALIGN",
            {
                modeTop:
                    modeRect.top,

                ownershipTopBefore:
                    ownerRect.top,

                appliedDelta:
                    delta
            }
        );
    }


    /* ============================================================
       INSTALL
       ============================================================ */

    function install(){

        layout =
            resolveLayout();


        if(!layout){
            return;
        }


        /*
         * First let V1.9.23 produce the currently-working YOLO proxy,
         * then retire ONLY its major-section drag geometry.
         */

        retireOldMajorDrag();

        purgeLegacyMajorHandlesV1925();


        trackWeights =
            nativeTrackWeightsV1925();


        for(
            const key
            of DEFAULT_ORDER
        ){

            const section =
                layout.elements[
                    key
                ];


            section.classList.add(
                "stitch-major-v1924"
            );


            section.dataset.stitchMajorKey =
                key;


            makeHandle(
                section,
                key
            );
        }


        order =
            loadOrder();


        applyOrderBare(
            order
        );


        repairModeOwnership();

        requestAnimationFrame(
            alignOwnershipExactV1925
        );


        /*
         * Historical V1.9.14-V1.9.18 code contains delayed one-shot
         * ownership positioning.
         *
         * One single late structural normalization beats those old
         * one-shot writes. This is NOT polling and does not repeat.
         */

        window.setTimeout(
            ()=>{

                purgeLegacyMajorHandlesV1925();

                /*
                 * LIVE STARTUP CLEANUP 7
                 *
                 * Do NOT reapply V1.9.24 grid tracks here.
                 *
                 * V1.9.31 is now the authoritative width owner and
                 * has already restored the user's persisted Camera /
                 * Twin / Rail widths.
                 *
                 * The former applyOrderBare(order) call at 2600 ms
                 * rewrote grid-template-columns and caused the final
                 * visible startup width snap.
                 *
                 * Keep the late structural cleanup below, but leave
                 * the established grid widths untouched.
                 */


                repairModeOwnership();


                requestAnimationFrame(
                    alignOwnershipExactV1925
                );
            },
            2600
        );


        document.body.classList.add(
            "stitch-major-v1924-ready"
        );


        console.log(
            "V1.9.24 READY",
            {
                order,
                trackWeights
            }
        );
    }


    if(
        document.readyState
        === "loading"
    ){

        document.addEventListener(
            "DOMContentLoaded",
            install,
            {
                once:
                    true
            }
        );

    }else{

        install();
    }

})();
