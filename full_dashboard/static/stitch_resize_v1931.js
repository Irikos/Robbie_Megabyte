/* ==================================================================
   STITCH V1.9.31 — MAJOR SECTION SIDE RESIZE

   Existing V1.9.24 top grips:
       REORDER sections.

   New left/right edge zones:
       RESIZE sections.

   No MutationObserver.
   No setInterval.
   No polling.
   ================================================================== */

(function(){

    "use strict";


    const STORAGE_KEY =
        "g1Dashboard.stitchMajorWidths.v1931";


    const KEYS = [
        "camera",
        "twin",
        "rail"
    ];


    let grid =
        null;


    let resizeState =
        null;


    /* ============================================================
       STITCH_RESIZE_FRAME_SYNC_V1933

       Pointer events can arrive much faster than the browser paints.

       Do not force the Three.js / WebGL panel through several layout
       sizes inside a single display frame.

       Keep only the newest requested geometry and commit it once on
       the next requestAnimationFrame.
       ============================================================ */

    let resizeFrameV1933 =
        null;


    let queuedResizeV1933 =
        null;


    function applyQueuedResizeV1933(){

        resizeFrameV1933 =
            null;


        if(!queuedResizeV1933){
            return;
        }


        const queued =
            queuedResizeV1933;


        queuedResizeV1933 =
            null;


        applyWidths(
            queued.widths,
            queued.sections
        );
    }


    function queueResizeV1933(
        widths,
        sections
    ){

        queuedResizeV1933 = {

            widths:
                {
                    ...widths
                },

            sections:
                [
                    ...sections
                ]

        };


        if(
            resizeFrameV1933
            !==
            null
        ){
            return;
        }


        resizeFrameV1933 =
            requestAnimationFrame(
                applyQueuedResizeV1933
            );
    }


    function flushResizeV1933(){

        if(
            resizeFrameV1933
            !==
            null
        ){

            cancelAnimationFrame(
                resizeFrameV1933
            );


            resizeFrameV1933 =
                null;
        }


        if(!queuedResizeV1933){
            return;
        }


        const queued =
            queuedResizeV1933;


        queuedResizeV1933 =
            null;


        applyWidths(
            queued.widths,
            queued.sections
        );
    }


    function clearResizeFrameV1933(){

        if(
            resizeFrameV1933
            !==
            null
        ){

            cancelAnimationFrame(
                resizeFrameV1933
            );
        }


        resizeFrameV1933 =
            null;

        queuedResizeV1933 =
            null;
    }



    function clamp(
        value,
        minimum,
        maximum
    ){

        return Math.max(
            minimum,
            Math.min(
                maximum,
                value
            )
        );
    }


    function keyOf(section){

        return section.getAttribute(
            "data-stitch-major-key"
        );
    }


    function sectionsVisual(){

        if(!grid){
            return [];
        }


        return [
            ...grid.querySelectorAll(
                ":scope > "
                +
                ".stitch-major-v1924"
                +
                "[data-stitch-major-key]"
            )
        ]
        .sort(
            (a,b)=>
                a.getBoundingClientRect().left
                -
                b.getBoundingClientRect().left
        );
    }


    function bridge(){

        return window
            .__stitchMajorResizeBridgeV1931
            ||
            null;
    }


    function currentWidths(
        sections =
            sectionsVisual()
    ){

        const result = {};


        for(const section of sections){

            result[
                keyOf(section)
            ] =
                section
                    .getBoundingClientRect()
                    .width;
        }


        return result;
    }


    function gapPixels(){

        if(!grid){
            return 8;
        }


        const styles =
            getComputedStyle(
                grid
            );


        const value =
            parseFloat(
                styles.columnGap
            );


        return Number.isFinite(value)
            ?
            value
            :
            8;
    }


    function usableWidth(){

        if(!grid){
            return 0;
        }


        const count =
            sectionsVisual().length;


        return Math.max(
            0,
            grid
                .getBoundingClientRect()
                .width
            -
            gapPixels()
            *
            Math.max(
                0,
                count - 1
            )
        );
    }


    /* ============================================================
       HARD SIZE LIMITS

       They scale with the available dashboard width while retaining
       sensible absolute floors/ceilings.

       Camera:
           min ~22%
           max ~50%

       Twin:
           min ~28%
           max ~64%

       Rail:
           250px -> 480px
       ============================================================ */

    function boundsFor(
        key,
        available
    ){

        if(key === "camera"){

            return {

                min:
                    Math.max(
                        320,
                        available * .22
                    ),

                max:
                    Math.min(
                        860,
                        available * .50
                    )

            };
        }


        if(key === "twin"){

            return {

                min:
                    Math.max(
                        380,
                        available * .28
                    ),

                max:
                    Math.min(
                        1080,
                        available * .64
                    )

            };
        }


        return {

            min:
                Math.max(
                    330,
                    available * .145
                ),

            max:
                Math.min(
                    480,
                    available * .32
                )

        };
    }


    function applyWidths(
        widths,
        sections =
            sectionsVisual()
    ){

        if(
            !grid
            ||
            sections.length !== 3
        ){
            return;
        }


        const template =
            sections
                .map(section => {

                    const key =
                        keyOf(section);


                    return (
                        Math.max(
                            1,
                            Math.round(
                                widths[key]
                            )
                        )
                        +
                        "px"
                    );
                })
                .join(" ");


        grid.style.setProperty(
            "grid-template-columns",
            template,
            "important"
        );
    }


    function saveFractions(){

        const sections =
            sectionsVisual();


        if(sections.length !== 3){
            return;
        }


        const widths =
            currentWidths(
                sections
            );


        const total =
            KEYS.reduce(
                (sum,key)=>
                    sum
                    +
                    (
                        widths[key]
                        ||
                        0
                    ),
                0
            );


        if(total <= 0){
            return;
        }


        const payload = {};


        for(const key of KEYS){

            payload[key] =
                widths[key]
                /
                total;
        }


        try{

            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify(
                    payload
                )
            );

        }catch(_){
        }
    }


    function loadFractions(){

        try{

            const raw =
                JSON.parse(
                    localStorage.getItem(
                        STORAGE_KEY
                    )
                    ||
                    "null"
                );


            if(
                !raw
                ||
                typeof raw
                    !==
                    "object"
            ){
                return null;
            }


            let sum = 0;


            for(const key of KEYS){

                const value =
                    Number(
                        raw[key]
                    );


                if(
                    !Number.isFinite(value)
                    ||
                    value <= 0
                ){
                    return null;
                }


                sum += value;
            }


            if(sum <= 0){
                return null;
            }


            const normalized = {};


            for(const key of KEYS){

                normalized[key] =
                    Number(raw[key])
                    /
                    sum;
            }


            return normalized;

        }catch(_){

            return null;
        }
    }


    /*
     * Keep all three inside their min/max while preserving the
     * complete available width.
     */

    function fitWidths(
        desired,
        available
    ){

        const result = {};


        for(const key of KEYS){

            const bounds =
                boundsFor(
                    key,
                    available
                );


            result[key] =
                clamp(
                    desired[key],
                    bounds.min,
                    bounds.max
                );
        }


        for(let pass = 0; pass < 12; pass += 1){

            const total =
                KEYS.reduce(
                    (sum,key)=>
                        sum
                        +
                        result[key],
                    0
                );


            const difference =
                available
                -
                total;


            if(
                Math.abs(difference)
                <
                .5
            ){
                break;
            }


            const candidates =
                KEYS.filter(key => {

                    const bounds =
                        boundsFor(
                            key,
                            available
                        );


                    return difference > 0
                        ?
                        result[key]
                            <
                            bounds.max - .25
                        :
                        result[key]
                            >
                            bounds.min + .25;
                });


            if(!candidates.length){
                break;
            }


            const share =
                difference
                /
                candidates.length;


            for(const key of candidates){

                const bounds =
                    boundsFor(
                        key,
                        available
                    );


                result[key] =
                    clamp(
                        result[key]
                        +
                        share,
                        bounds.min,
                        bounds.max
                    );
            }
        }


        return result;
    }


    function restoreStoredWidths(){

        const fractions =
            loadFractions();


        if(!fractions){
            return;
        }


        const available =
            usableWidth();


        if(available <= 0){
            return;
        }


        const desired = {};


        for(const key of KEYS){

            desired[key] =
                fractions[key]
                *
                available;
        }


        applyWidths(
            fitWidths(
                desired,
                available
            )
        );


        const api =
            bridge();


        if(api){

            api.refreshTracks();
        }
    }


    function updateExteriorEdges(){

        const sections =
            sectionsVisual();


        sections.forEach(
            (section,index)=>{

                const left =
                    section.querySelector(
                        ":scope > "
                        +
                        ".stitch-resize-edge-v1931"
                        +
                        '[data-side="left"]'
                    );


                const right =
                    section.querySelector(
                        ":scope > "
                        +
                        ".stitch-resize-edge-v1931"
                        +
                        '[data-side="right"]'
                    );


                if(left){

                    left.classList.toggle(
                        "stitch-resize-disabled-v1931",
                        index === 0
                    );
                }


                if(right){

                    right.classList.toggle(
                        "stitch-resize-disabled-v1931",
                        index
                            ===
                            sections.length - 1
                    );
                }
            }
        );
    }


    function moveResize(event){

        if(
            !resizeState
            ||
            event.pointerId
                !==
                resizeState.pointerId
        ){
            return;
        }


        event.preventDefault();


        const delta =
            event.clientX
            -
            resizeState.startX;


        const pairTotal =
            resizeState.leftStart
            +
            resizeState.rightStart;


        /*
         * Boundary must satisfy BOTH sections' limits.
         */

        const minimumLeft =
            Math.max(
                resizeState.leftBounds.min,
                pairTotal
                -
                resizeState.rightBounds.max
            );


        const maximumLeft =
            Math.min(
                resizeState.leftBounds.max,
                pairTotal
                -
                resizeState.rightBounds.min
            );


        const newLeft =
            clamp(
                resizeState.leftStart
                +
                delta,
                minimumLeft,
                maximumLeft
            );


        const newRight =
            pairTotal
            -
            newLeft;


        resizeState.widths[
            resizeState.leftKey
        ] =
            newLeft;


        resizeState.widths[
            resizeState.rightKey
        ] =
            newRight;


        queueResizeV1933(
            resizeState.widths,
            resizeState.sections
        );
    }


    function cleanupResize(){

        if(!resizeState){
            return;
        }


        resizeState.handle.classList.remove(
            "stitch-resize-active-v1931"
        );


        document.body.classList.remove(
            "stitch-major-resizing-v1931"
        );


        document.removeEventListener(
            "pointermove",
            moveResize,
            true
        );


        document.removeEventListener(
            "pointerup",
            finishResize,
            true
        );


        document.removeEventListener(
            "pointercancel",
            cancelResize,
            true
        );
    }


    function completeResize(
        event,
        cancelled
    ){

        if(
            !resizeState
            ||
            event.pointerId
                !==
                resizeState.pointerId
        ){
            return;
        }


        event.preventDefault();


        const state =
            resizeState;


        /*
         * Commit the newest cursor geometry before persistence /
         * V1.9.24 track learning.
         */

        flushResizeV1933();


        if(cancelled){

            clearResizeFrameV1933();


            applyWidths(
                state.startWidths,
                state.sections
            );
        }


        try{

            state.handle
                .releasePointerCapture(
                    event.pointerId
                );

        }catch(_){
        }


        cleanupResize();


        resizeState =
            null;


        /*
         * Teach the ORIGINAL V1.9.24 engine about the new widths.
         *
         * This is the key part that makes resize and reorder coexist.
         */

        const api =
            bridge();


        if(api){

            api.refreshTracks();
        }


        requestAnimationFrame(
            ()=>{

                updateExteriorEdges();


                if(!cancelled){

                    saveFractions();
                }
            }
        );
    }


    function finishResize(event){

        completeResize(
            event,
            false
        );
    }


    function cancelResize(event){

        completeResize(
            event,
            true
        );
    }


    function beginResize(
        event,
        section,
        side,
        handle
    ){

        if(
            event.button !== 0
            ||
            resizeState
        ){
            return;
        }


        const api =
            bridge();


        if(
            api
            &&
            api.isDragging()
        ){
            return;
        }


        const sections =
            sectionsVisual();


        const index =
            sections.indexOf(
                section
            );


        if(index < 0){
            return;
        }


        let leftSection;
        let rightSection;


        if(side === "right"){

            if(
                index
                >=
                sections.length - 1
            ){
                return;
            }


            leftSection =
                section;


            rightSection =
                sections[
                    index + 1
                ];

        }
        else{

            if(index <= 0){
                return;
            }


            leftSection =
                sections[
                    index - 1
                ];


            rightSection =
                section;
        }


        event.preventDefault();
        event.stopPropagation();


        const widths =
            currentWidths(
                sections
            );


        const available =
            usableWidth();


        const leftKey =
            keyOf(
                leftSection
            );


        const rightKey =
            keyOf(
                rightSection
            );


        resizeState = {

            pointerId:
                event.pointerId,

            handle,

            sections,

            startX:
                event.clientX,

            widths:
                {
                    ...widths
                },

            startWidths:
                {
                    ...widths
                },

            leftKey,

            rightKey,

            leftStart:
                widths[leftKey],

            rightStart:
                widths[rightKey],

            leftBounds:
                boundsFor(
                    leftKey,
                    available
                ),

            rightBounds:
                boundsFor(
                    rightKey,
                    available
                )

        };


        document.body.classList.add(
            "stitch-major-resizing-v1931"
        );


        handle.classList.add(
            "stitch-resize-active-v1931"
        );


        try{

            handle.setPointerCapture(
                event.pointerId
            );

        }catch(_){
        }


        document.addEventListener(
            "pointermove",
            moveResize,
            true
        );


        document.addEventListener(
            "pointerup",
            finishResize,
            true
        );


        document.addEventListener(
            "pointercancel",
            cancelResize,
            true
        );
    }


    function addResizeEdges(){

        const sections =
            sectionsVisual();


        for(const section of sections){

            for(
                const side
                of [
                    "left",
                    "right"
                ]
            ){

                const handle =
                    document.createElement(
                        "div"
                    );


                handle.className =
                    "stitch-resize-edge-v1931";


                handle.dataset.side =
                    side;


                handle.setAttribute(
                    "aria-hidden",
                    "true"
                );


                handle.addEventListener(
                    "pointerdown",
                    event =>
                        beginResize(
                            event,
                            section,
                            side,
                            handle
                        )
                );


                section.appendChild(
                    handle
                );
            }
        }


        updateExteriorEdges();
    }


    function afterPossibleReorder(){

        if(resizeState){
            return;
        }


        /*
         * Reordering itself is still owned exclusively by V1.9.24.
         * We only refresh which outside edge is disabled after it.
         */

        requestAnimationFrame(
            ()=>{

                requestAnimationFrame(
                    updateExteriorEdges
                );

            }
        );
    }


    function install(){

        grid =
            document.querySelector(
                "#view-live "
                +
                ".combined-live-grid"
            );


        if(!grid){
            return;
        }


        if(
            grid.querySelector(
                ".stitch-resize-edge-v1931"
            )
        ){
            return;
        }


        addResizeEdges();


        restoreStoredWidths();


        /*
         * LIVE STARTUP CLEANUP 6
         *
         * Exact V1.9.31 pixel tracks are now authoritative.
         * Retire the temporary <head> pre-paint ratio owner so
         * it cannot interfere with reorder / resize at runtime.
         */
        document
            .getElementById(
                "bacaLivePrepaintWidthsStyleV1"
            )
            ?.remove();

        delete document
            .documentElement
            .dataset
            .bacaLivePrepaintWidths;


        /*
         * Registered once.
         *
         * No polling. This only runs after an actual pointer release.
         */

        document.addEventListener(
            "pointerup",
            afterPossibleReorder,
            true
        );


        console.log(
            "[STITCH V1.9.31] side resizing ready"
        );
    }


    /*
     * LIVE RESIZE REPAIR 1
     *
     * Cleanup 6 now handles persisted Camera / Twin / Rail geometry
     * before first paint.
     *
     * Therefore V1.9.31 no longer needs to install immediately.
     *
     * Its INTERACTION layer must wait until V1.9.24 has established
     * the final major-section structure and data-stitch-major-key
     * ownership. Otherwise addResizeEdges() runs too early and the
     * manual resize zones are never installed correctly.
     *
     * Keep the original two-frame interaction timing while the
     * Cleanup 6 pre-paint rule holds the saved widths stable.
     */

    function scheduleInstallV1931(){

        requestAnimationFrame(
            ()=>{

                requestAnimationFrame(
                    install
                );
            }
        );
    }


    if(
        document.readyState
        ===
        "loading"
    ){

        document.addEventListener(
            "DOMContentLoaded",
            scheduleInstallV1931,
            {
                once:
                    true
            }
        );

    }
    else{

        scheduleInstallV1931();
    }

})();


/* ================================================================
   STITCH_RESPONSIVE_TWIN_V1936

   Presentation-only responsive tagging.

   - Composite gets a compact control class.
   - Reset view gets a fit-content control class.
   - The two bottom information strips get individual classes.
   - Twin becomes a CSS container so stacking depends on PANEL WIDTH,
     not browser-window width.

   No MutationObserver.
   No setInterval.
   No polling.
   ================================================================ */

(function(){

    "use strict";


    function normalizeV1936(value){

        return String(value || "")
            .replace(/\s+/g," ")
            .trim()
            .toLowerCase();
    }


    function smallestMatchingV1936(
        root,
        required
    ){

        const candidates =
            [
                ...root.querySelectorAll(
                    "div,span,p,section"
                )
            ]
            .filter(element => {

                const text =
                    normalizeV1936(
                        element.textContent
                    );

                return required.every(
                    needle =>
                        text.includes(
                            needle
                        )
                );
            });


        if(!candidates.length){
            return null;
        }


        /*
         * Select the visually smallest wrapper containing all the
         * requested words instead of accidentally tagging the entire
         * twin panel.
         */

        candidates.sort((a,b)=>{

            const ar =
                a.getBoundingClientRect();

            const br =
                b.getBoundingClientRect();

            const aa =
                Math.max(
                    1,
                    ar.width * ar.height
                );

            const ba =
                Math.max(
                    1,
                    br.width * br.height
                );

            return aa - ba;
        });


        return candidates[0];
    }


    function installResponsiveTwinV1936(){

        const twin =
            document.querySelector(
                '#view-live [data-stitch-major-key="twin"]'
            );


        if(!twin){
            console.warn(
                "V1.9.36: twin section not found"
            );

            return;
        }


        twin.classList.add(
            "stitch-twin-responsive-v1936"
        );


        /* --------------------------------------------------------
           COMPOSITE
           -------------------------------------------------------- */

        const selects =
            [
                ...twin.querySelectorAll(
                    "select"
                )
            ];


        const composite =
            selects.find(select => {

                return [
                    ...select.options
                ].some(
                    option =>
                        normalizeV1936(
                            option.textContent
                        )
                        ===
                        "composite"
                );
            });


        if(composite){

            composite.classList.add(
                "stitch-composite-compact-v1936"
            );
        }


        /* --------------------------------------------------------
           RESET VIEW
           -------------------------------------------------------- */

        const reset =
            [
                ...twin.querySelectorAll(
                    "button"
                )
            ]
            .find(
                button =>
                    normalizeV1936(
                        button.textContent
                    )
                    ===
                    "reset view"
            );


        if(reset){

            reset.classList.add(
                "stitch-reset-compact-v1936"
            );
        }


        /* --------------------------------------------------------
           BOTTOM LEFT LEGEND

           measured body + hand
           published arm + hand command
           -------------------------------------------------------- */

        const measuredLegend =
            smallestMatchingV1936(
                twin,
                [
                    "measured body",
                    "published arm"
                ]
            );


        if(measuredLegend){

            measuredLegend.classList.add(
                "stitch-twin-measured-legend-v1936"
            );
        }


        /* --------------------------------------------------------
           BOTTOM HEALTH LEGEND

           nominal / watch / high / very high
           -------------------------------------------------------- */

        const healthLegend =
            smallestMatchingV1936(
                twin,
                [
                    "nominal",
                    "watch",
                    "very high"
                ]
            );


        if(healthLegend){

            healthLegend.classList.add(
                "stitch-twin-health-legend-v1936"
            );
        }


        console.log(
            "V1.9.36 responsive twin:",
            {
                composite:
                    !!composite,

                reset:
                    !!reset,

                measuredLegend:
                    !!measuredLegend,

                healthLegend:
                    !!healthLegend
            }
        );
    }


    if(document.readyState === "complete"){

        requestAnimationFrame(
            installResponsiveTwinV1936
        );

    }else{

        window.addEventListener(
            "load",
            ()=>
                requestAnimationFrame(
                    installResponsiveTwinV1936
                ),
            {
                once:
                    true
            }
        );
    }

})();


/* ================================================================
   STITCH_TWIN_STAGE_FREEZE_V1937

   Freeze the entire Three.js STAGE width while the major panel
   divider is being dragged.

   Panel:
       continues following pointer.

   Three.js stage:
       retains exact visual width.

   Result:
       no temporary horizontal squeezing/stretching of the robot.

   No observer.
   No interval.
   No polling.
   ================================================================ */

(function(){

    "use strict";

    let frozenStageV1937 =
        null;


    function freezeTwinStageV1937(){

        if(frozenStageV1937){
            return;
        }


        const twin =
            document.querySelector(
                '#view-live [data-stitch-major-key="twin"]'
            );


        const stage =
            twin
            &&
            twin.querySelector(
                ".twin-stage"
            );


        if(!stage){
            return;
        }


        const rect =
            stage.getBoundingClientRect();


        const width =
            Math.max(
                1,
                Math.round(
                    rect.width
                )
            );


        stage.style.setProperty(
            "width",
            `${width}px`,
            "important"
        );


        stage.style.setProperty(
            "min-width",
            `${width}px`,
            "important"
        );


        stage.style.setProperty(
            "max-width",
            `${width}px`,
            "important"
        );


        /*
         * Keep the frozen viewport centered inside the changing
         * center panel. If the panel becomes narrower, it crops
         * symmetrically rather than squeezing the robot.
         */

        stage.style.setProperty(
            "align-self",
            "center",
            "important"
        );


        stage.setAttribute(
            "data-stitch-stage-frozen-v1937",
            "true"
        );


        frozenStageV1937 =
            stage;
    }


    function thawTwinStageV1937(){

        const stage =
            frozenStageV1937;


        if(!stage){
            return;
        }


        stage.style.removeProperty(
            "width"
        );

        stage.style.removeProperty(
            "min-width"
        );

        stage.style.removeProperty(
            "max-width"
        );

        stage.style.removeProperty(
            "align-self"
        );


        stage.removeAttribute(
            "data-stitch-stage-frozen-v1937"
        );


        frozenStageV1937 =
            null;
    }


    document.addEventListener(
        "stitch-major-resize-begin-v1935",
        freezeTwinStageV1937,
        true
    );


    document.addEventListener(
        "stitch-major-resize-end-v1935",
        thawTwinStageV1937,
        true
    );

})();


/* ================================================================
   STITCH_WEBGL_SNAPSHOT_RESIZE_V1938

   During center-panel edge resizing:

       REAL WEBGL CANVAS
           continues existing underneath
           but is temporarily invisible

       SNAPSHOT CANVAS
           pixel-for-pixel copy of the last rendered frame
           fixed physical width and height
           absolutely centered
           never stretches with the outer panel

   After release:
       real canvas becomes visible
       existing V1.9.35 renderer logic performs its final resize
       snapshot survives for two RAFs, then disappears

   No MutationObserver.
   No interval.
   No polling.
   ================================================================ */

(function(){

    "use strict";

    let snapshotV1938 =
        null;

    let sourceCanvasV1938 =
        null;


    function removeSnapshotV1938(){

        if(snapshotV1938){

            snapshotV1938.remove();

            snapshotV1938 =
                null;
        }


        if(sourceCanvasV1938){

            sourceCanvasV1938.style.removeProperty(
                "visibility"
            );

            sourceCanvasV1938.style.removeProperty(
                "opacity"
            );

            sourceCanvasV1938 =
                null;
        }
    }


    function freezeRenderedTwinV1938(){

        removeSnapshotV1938();


        const stage =
            document.querySelector(
                '#view-live .twin-stage'
            );


        const source =
            document.getElementById(
                "robotTwinCanvas"
            );


        if(!stage || !source){
            return;
        }


        const rect =
            source.getBoundingClientRect();


        const cssWidth =
            Math.max(
                1,
                Math.round(rect.width)
            );


        const cssHeight =
            Math.max(
                1,
                Math.round(rect.height)
            );


        /*
         * Use the drawing-buffer dimensions for the copy so the
         * snapshot retains the current renderer resolution.
         */

        const copy =
            document.createElement(
                "canvas"
            );


        copy.width =
            Math.max(
                1,
                source.width
            );


        copy.height =
            Math.max(
                1,
                source.height
            );


        copy.className =
            "stitch-twin-resize-snapshot-v1938";


        copy.style.setProperty(
            "width",
            `${cssWidth}px`,
            "important"
        );


        copy.style.setProperty(
            "height",
            `${cssHeight}px`,
            "important"
        );


        const context =
            copy.getContext(
                "2d",
                {
                    alpha:
                        false
                }
            );


        if(!context){
            return;
        }


        try {

            /*
             * Snapshot the currently visible WebGL result before any
             * layout width changes.
             */

            context.drawImage(
                source,
                0,
                0,
                copy.width,
                copy.height
            );

        }catch(error){

            console.warn(
                "V1.9.38 twin snapshot failed:",
                error
            );

            return;
        }


        stage.appendChild(
            copy
        );


        /*
         * Do NOT display:none the WebGL canvas.
         *
         * Keeping it alive avoids disturbing Three.js/WebGL state.
         */

        source.style.setProperty(
            "visibility",
            "hidden",
            "important"
        );


        source.style.setProperty(
            "opacity",
            "0",
            "important"
        );


        snapshotV1938 =
            copy;

        sourceCanvasV1938 =
            source;
    }


    function thawRenderedTwinV1938(){

        if(sourceCanvasV1938){

            /*
             * Reveal the real renderer immediately. The existing
             * V1.9.35 end handler schedules the final resize/render.
             */

            sourceCanvasV1938.style.removeProperty(
                "visibility"
            );

            sourceCanvasV1938.style.removeProperty(
                "opacity"
            );
        }


        /*
         * Leave the snapshot covering the final renderer for two
         * frames so setSize()/render() can complete underneath.
         */

        requestAnimationFrame(()=>{

            requestAnimationFrame(()=>{

                if(snapshotV1938){

                    snapshotV1938.remove();

                    snapshotV1938 =
                        null;
                }


                sourceCanvasV1938 =
                    null;
            });
        });
    }


    document.addEventListener(
        "stitch-major-resize-begin-v1935",
        freezeRenderedTwinV1938,
        true
    );


    document.addEventListener(
        "stitch-major-resize-end-v1935",
        thawRenderedTwinV1938,
        true
    );


    document.addEventListener(
        "pointercancel",
        removeSnapshotV1938,
        true
    );

})();
