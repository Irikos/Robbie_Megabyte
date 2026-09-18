(() => {
    "use strict";


    const VERSION =
        "BACALBASA_UI_V2000";


    /* ==================================================================
       LOCAL UI-PREVIEW NETWORK GUARD
       ================================================================== */


    const LOCAL_PREVIEW =
        (
            location.hostname === "127.0.0.1"
            ||
            location.hostname === "localhost"
        )
        &&
        location.port === "8081";


    function isCompanion8090(
        input
    ){

        let raw = "";


        if(
            typeof input === "string"
            ||
            input instanceof URL
        ){

            raw =
                String(
                    input
                );

        }else if(
            input
            &&
            typeof input.url === "string"
        ){

            raw =
                input.url;

        }else{

            return null;
        }


        try{

            const url =
                new URL(
                    raw,
                    location.href
                );


            const local =
                (
                    url.hostname === "127.0.0.1"
                    ||
                    url.hostname === "localhost"
                );


            if(
                local
                &&
                url.port === "8090"
                &&
                url.pathname.startsWith(
                    "/api/"
                )
            ){

                return url;
            }

        }
        catch(_){
        }


        return null;
    }


    function offlinePayload(
        url
    ){

        const base = {
            ok: false,
            offline: true,
            available: false,
            connected: false,
            reachable: false,
            ui_preview: true
        };


        if(
            url.pathname.endsWith(
                "/api/logs"
            )
        ){

            return {
                ...base,
                logs: [],
                items: []
            };
        }


        if(
            url.pathname.endsWith(
                "/api/events"
            )
        ){

            return {
                ...base,
                events: []
            };
        }


        if(
            url.pathname.endsWith(
                "/api/status"
            )
        ){

            return {
                ...base,

                system: {
                    running: false
                },

                simulation: {
                    running: false
                },

                physical: {
                    running: false
                },

                sonic: {
                    running: false
                },

                camera: {
                    running: false
                },

                alignment: {
                    ready: false
                },

                tracking: {
                    active: false
                }
            };
        }


        return base;
    }


    if(LOCAL_PREVIEW){


        /* --------------------------------------------------------------
           fetch()
           -------------------------------------------------------------- */

        if(
            typeof window.fetch ===
            "function"
        ){

            const realFetch =
                window.fetch.bind(
                    window
                );


            window.fetch =
                function(
                    input,
                    init
                ){

                    const url =
                        isCompanion8090(
                            input
                        );


                    if(!url){

                        return realFetch(
                            input,
                            init
                        );
                    }


                    return Promise.resolve(
                        new Response(
                            JSON.stringify(
                                offlinePayload(
                                    url
                                )
                            ),
                            {
                                status:
                                    200,

                                headers: {
                                    "Content-Type":
                                        "application/json"
                                }
                            }
                        )
                    );
                };
        }


        /* --------------------------------------------------------------
           XMLHttpRequest
           -------------------------------------------------------------- */

        if(
            window.XMLHttpRequest
        ){

            const realOpen =
                XMLHttpRequest
                .prototype
                .open;


            XMLHttpRequest
            .prototype
            .open =
                function(
                    method,
                    url,
                    async = true,
                    user,
                    password
                ){

                    if(
                        isCompanion8090(
                            url
                        )
                    ){

                        return realOpen.call(
                            this,
                            "GET",
                            "/static/bacalbasa_ui_v2000_offline.json",
                            async !== false
                        );
                    }


                    return realOpen.call(
                        this,
                        method,
                        url,
                        async,
                        user,
                        password
                    );
                };
        }


        /* --------------------------------------------------------------
           EventSource
           -------------------------------------------------------------- */

        if(
            window.EventSource
        ){

            const RealEventSource =
                window.EventSource;


            class OfflineEventSource {

                constructor(
                    url
                ){

                    this.url =
                        String(
                            url
                        );


                    this.readyState =
                        2;


                    this.withCredentials =
                        false;


                    this.onopen =
                        null;


                    this.onmessage =
                        null;


                    this.onerror =
                        null;
                }


                addEventListener(){
                }


                removeEventListener(){
                }


                dispatchEvent(){

                    return true;
                }


                close(){

                    this.readyState =
                        2;
                }
            }


            function PreviewEventSource(
                url,
                options
            ){

                if(
                    isCompanion8090(
                        url
                    )
                ){

                    return new OfflineEventSource(
                        url
                    );
                }


                return new RealEventSource(
                    url,
                    options
                );
            }


            PreviewEventSource.CONNECTING =
                RealEventSource.CONNECTING;


            PreviewEventSource.OPEN =
                RealEventSource.OPEN;


            PreviewEventSource.CLOSED =
                RealEventSource.CLOSED;


            PreviewEventSource.prototype =
                RealEventSource.prototype;


            window.EventSource =
                PreviewEventSource;
        }
    }


    /* ==================================================================
       UI HELPERS
       ================================================================== */


    function cleanText(
        element
    ){

        return String(
            element?.textContent || ""
        )
        .replace(
            /\s+/g,
            " "
        )
        .trim()
        .toUpperCase();
    }


    /* ==================================================================
       REMOVE STALE GENERATED TAB SLIDERS
       ================================================================== */


    function cleanNavigation(){

        document
        .querySelectorAll(
            ".stitch-tab-slider-v1955,"
            +
            ".stitch-tab-slider-v1959"
        )
        .forEach(
            element =>
                element.remove()
        );
    }


    /* ==================================================================
       CONNECT / DISCONNECT — V2.1.0

       The HTML itself now contains the final component.

       This code ONLY:
           - reads real connection state,
           - moves the indicator,
           - watches disabled-state changes.

       It does not build/replace/clone buttons.
       ================================================================== */


    function installPowerSwitch(){

        const shell =
            document.getElementById(
                "stitchCameraPowerSwitchV158"
            );


        const connect =
            document.getElementById(
                "cameraConnectBtn"
            );


        const disconnect =
            document.getElementById(
                "cameraStopBtn"
            );


        const indicator =
            shell
            ?.querySelector(
                ".baca-power-indicator-v2100"
            );


        if(
            !shell
            ||
            !connect
            ||
            !disconnect
            ||
            !indicator
        ){
            return;
        }


        /*
         * Multiple finite startup passes may call this function.
         * Only bind it once.
         */

        if(
            shell.dataset
                .bacaPowerInstalled ===
                "v2100"
        ){
            return;
        }


        shell.dataset
            .bacaPowerInstalled =
                "v2100";


        let selected =
            "connect";


        function inferredState(){

            /*
             * Standard application state:
             *
             * Connected:
             *     Connect disabled
             *     Disconnect enabled
             *
             * Disconnected:
             *     Connect enabled
             *     Disconnect disabled
             */

            if(
                connect.disabled
                &&
                !disconnect.disabled
            ){
                return "disconnect";
            }


            if(
                disconnect.disabled
                &&
                !connect.disabled
            ){
                return "connect";
            }


            return selected;
        }


        function moveIndicator(
            state = inferredState(),
            immediate = false
        ){

            selected =
                state;


            shell.dataset
                .bacaPowerState =
                    state;


            const target =
                state === "disconnect"
                ?
                disconnect
                :
                connect;


            requestAnimationFrame(
                () => {

                    const shellRect =
                        shell
                        .getBoundingClientRect();


                    const targetRect =
                        target
                        .getBoundingClientRect();


                    if(immediate){

                        indicator.style.setProperty(
                            "transition",
                            "none",
                            "important"
                        );
                    }


                    shell.style.setProperty(
                        "--baca-power-x-v2100",
                        `${
                            targetRect.left
                            -
                            shellRect.left
                        }px`
                    );


                    shell.style.setProperty(
                        "--baca-power-y-v2100",
                        `${
                            targetRect.top
                            -
                            shellRect.top
                        }px`
                    );


                    shell.style.setProperty(
                        "--baca-power-w-v2100",
                        `${targetRect.width}px`
                    );


                    shell.style.setProperty(
                        "--baca-power-h-v2100",
                        `${targetRect.height}px`
                    );


                    if(immediate){

                        indicator
                        .getBoundingClientRect();


                        requestAnimationFrame(
                            () => {

                                indicator.style
                                .removeProperty(
                                    "transition"
                                );
                            }
                        );
                    }
                }
            );
        }


        /*
         * Begin the visual movement immediately on press.
         */

        connect.addEventListener(
            "pointerdown",
            () => {

                selected =
                    "connect";


                moveIndicator(
                    "connect"
                );
            },
            true
        );


        disconnect.addEventListener(
            "pointerdown",
            () => {

                selected =
                    "disconnect";


                moveIndicator(
                    "disconnect"
                );
            },
            true
        );


        /*
         * After the existing dashboard action runs, synchronize to
         * the real application state.
         */

        connect.addEventListener(
            "click",
            () => {

                setTimeout(
                    () =>
                        moveIndicator(
                            inferredState()
                        ),
                    120
                );
            }
        );


        disconnect.addEventListener(
            "click",
            () => {

                setTimeout(
                    () =>
                        moveIndicator(
                            inferredState()
                        ),
                    120
                );
            }
        );


        /*
         * Narrow observer ONLY on the two actual buttons.
         */

        const stateObserver =
            new MutationObserver(
                () => {

                    moveIndicator(
                        inferredState()
                    );
                }
            );


        const observerOptions = {

            attributes:
                true,

            attributeFilter: [
                "disabled",
                "aria-disabled"
            ]
        };


        stateObserver.observe(
            connect,
            observerOptions
        );


        stateObserver.observe(
            disconnect,
            observerOptions
        );


        window.addEventListener(
            "resize",
            () => {

                moveIndicator(
                    inferredState(),
                    true
                );
            },
            {
                passive:
                    true
            }
        );


        moveIndicator(
            inferredState(),
            true
        );
    }


/* ==================================================================
       RIGHT CARD LOOKUP
       ================================================================== */


    function findHeading(
        rail,
        title
    ){

        const wanted =
            title.toUpperCase();


        return (
            [...rail.querySelectorAll("*")]
            .find(
                element =>
                    element.children.length === 0
                    &&
                    cleanText(
                        element
                    ) === wanted
            )
            ||
            null
        );
    }


    function findCard(
        rail,
        title
    ){

        const heading =
            findHeading(
                rail,
                title
            );


        if(!heading){
            return null;
        }


        /*
         * Prefer semantic containers first.
         */

        const semantic =
            heading.closest(
                "section,.panel,.hero-state,.health-panel"
            );


        if(semantic){
            return semantic;
        }


        /*
         * Otherwise walk outward until we reach a substantial card.
         */

        let node =
            heading.parentElement;


        while(
            node
            &&
            node !== rail
        ){

            const rect =
                node.getBoundingClientRect();


            if(
                rect.width > 250
                &&
                rect.height > 75
            ){

                return node;
            }


            node =
                node.parentElement;
        }


        return null;
    }


    /* ==================================================================
       TOP-RIGHT MINI CONTROLS

       Controller Process is visually correct.

       Therefore:
           1. identify its actual mini shell,
           2. read its REAL rendered radius/geometry,
           3. find the corresponding shell in Hands at the same
              card-relative position,
           4. copy the Controller Process corner geometry exactly.

       No guessed Hands class names.
       ================================================================== */


    function visiblePaint(
        element
    ){

        if(!element){
            return false;
        }


        const style =
            getComputedStyle(
                element
            );


        const border =
            Math.max(
                parseFloat(
                    style.borderTopWidth
                ) || 0,

                parseFloat(
                    style.borderRightWidth
                ) || 0,

                parseFloat(
                    style.borderBottomWidth
                ) || 0,

                parseFloat(
                    style.borderLeftWidth
                ) || 0
            );


        const bg =
            style.backgroundColor;


        return (
            border >= .5
            ||
            (
                bg
                &&
                bg !==
                    "transparent"
                &&
                bg !==
                    "rgba(0, 0, 0, 0)"
            )
        );
    }


    function findTopRightMini(
        card
    ){

        if(!card){
            return null;
        }


        const cardRect =
            card.getBoundingClientRect();


        const candidates =
            [...card.querySelectorAll("*")]
            .filter(
                element => {

                    const rect =
                        element.getBoundingClientRect();


                    if(
                        rect.width < 28
                        ||
                        rect.width > 90
                        ||
                        rect.height < 14
                        ||
                        rect.height > 40
                    ){
                        return false;
                    }


                    if(
                        rect.right
                        <
                        cardRect.right - 105
                    ){
                        return false;
                    }


                    if(
                        rect.top
                        >
                        cardRect.top + 50
                    ){
                        return false;
                    }


                    const style =
                        getComputedStyle(
                            element
                        );


                    if(
                        style.display ===
                            "none"
                        ||
                        style.visibility ===
                            "hidden"
                        ||
                        Number(
                            style.opacity
                        ) === 0
                    ){
                        return false;
                    }


                    return visiblePaint(
                        element
                    );
                }
            );


        if(!candidates.length){
            return null;
        }


        candidates.sort(
            (a,b) => {

                const ar =
                    a.getBoundingClientRect();


                const br =
                    b.getBoundingClientRect();


                const scoreA =
                    Math.abs(
                        cardRect.right
                        -
                        ar.right
                    )
                    +
                    Math.abs(
                        ar.top
                        -
                        cardRect.top
                    );


                const scoreB =
                    Math.abs(
                        cardRect.right
                        -
                        br.right
                    )
                    +
                    Math.abs(
                        br.top
                        -
                        cardRect.top
                    );


                return (
                    scoreA
                    -
                    scoreB
                );
            }
        );


        return candidates[0];
    }


    function applyMiniCluster(
        card,
        target,
        radius
    ){

        if(
            !card
            ||
            !target
        ){
            return;
        }


        const targetRect =
            target.getBoundingClientRect();


        /*
         * Apply the radius to every overlapping layer that draws the
         * same little shell. This handles a border on one element and
         * the dash/background on a nested element.
         */

        const cluster =
            [
                ...card.querySelectorAll("*")
            ]
            .filter(
                element => {

                    const rect =
                        element.getBoundingClientRect();


                    return (
                        Math.abs(
                            rect.left
                            -
                            targetRect.left
                        ) <= 5
                        &&
                        Math.abs(
                            rect.top
                            -
                            targetRect.top
                        ) <= 5
                        &&
                        Math.abs(
                            rect.right
                            -
                            targetRect.right
                        ) <= 5
                        &&
                        Math.abs(
                            rect.bottom
                            -
                            targetRect.bottom
                        ) <= 5
                    );
                }
            );


        cluster.push(
            target
        );


        [
            ...new Set(
                cluster
            )
        ]
        .forEach(
            element => {

                element.classList.add(
                    "baca-mini-control-v2000"
                );


                element.style.setProperty(
                    "border-radius",
                    radius,
                    "important"
                );


                element.style.setProperty(
                    "overflow",
                    "hidden",
                    "important"
                );


                element.style.setProperty(
                    "clip-path",
                    `inset(0 round ${radius})`,
                    "important"
                );
            }
        );
    }


    function mirrorHandsMiniFromController(
        rail
    ){

        const controllerCard =
            findCard(
                rail,
                "CONTROLLER PROCESS"
            );


        const handsCard =
            findCard(
                rail,
                "HANDS"
            );


        if(
            !controllerCard
            ||
            !handsCard
        ){
            return;
        }


        const source =
            findTopRightMini(
                controllerCard
            );


        if(!source){
            return;
        }


        const sourceStyle =
            getComputedStyle(
                source
            );


        const sourceRadius =
            sourceStyle.borderRadius
            ||
            "6px";


        const sourceRect =
            source.getBoundingClientRect();


        const controllerRect =
            controllerCard
            .getBoundingClientRect();


        const handsRect =
            handsCard
            .getBoundingClientRect();


        /*
         * Use the already-correct Controller Process control's exact
         * offset from its card's top/right edges.
         */

        const rightInset =
            controllerRect.right
            -
            sourceRect.right;


        const topInset =
            sourceRect.top
            -
            controllerRect.top;


        const expectedLeft =
            handsRect.right
            -
            rightInset
            -
            sourceRect.width;


        const expectedTop =
            handsRect.top
            +
            topInset;


        const expectedCenterX =
            expectedLeft
            +
            sourceRect.width / 2;


        const expectedCenterY =
            expectedTop
            +
            sourceRect.height / 2;


        /*
         * Hit-test the exact corresponding visual position in Hands.
         */

        let targets =
            document
            .elementsFromPoint(
                expectedCenterX,
                expectedCenterY
            )
            .filter(
                element => {

                    if(
                        !handsCard.contains(
                            element
                        )
                    ){
                        return false;
                    }


                    const rect =
                        element.getBoundingClientRect();


                    return (
                        Math.abs(
                            rect.width
                            -
                            sourceRect.width
                        ) <= 10
                        &&
                        Math.abs(
                            rect.height
                            -
                            sourceRect.height
                        ) <= 8
                    );
                }
            );


        /*
         * If the point lands on the white dash itself, look through
         * Hands descendants for the surrounding shell at the expected
         * rectangle.
         */

        if(!targets.length){

            targets =
                [
                    ...handsCard
                    .querySelectorAll(
                        "*"
                    )
                ]
                .filter(
                    element => {

                        const rect =
                            element
                            .getBoundingClientRect();


                        return (
                            Math.abs(
                                rect.left
                                -
                                expectedLeft
                            ) <= 8
                            &&
                            Math.abs(
                                rect.top
                                -
                                expectedTop
                            ) <= 8
                            &&
                            Math.abs(
                                rect.width
                                -
                                sourceRect.width
                            ) <= 12
                            &&
                            Math.abs(
                                rect.height
                                -
                                sourceRect.height
                            ) <= 10
                        );
                    }
                );
        }


        if(!targets.length){

            /*
             * Final local fallback only inside Hands.
             */

            const fallback =
                findTopRightMini(
                    handsCard
                );


            if(fallback){

                targets = [
                    fallback
                ];
            }
        }


        if(!targets.length){
            return;
        }


        targets.sort(
            (a,b) => {

                const ar =
                    a.getBoundingClientRect();


                const br =
                    b.getBoundingClientRect();


                const aScore =
                    Math.abs(
                        ar.left
                        -
                        expectedLeft
                    )
                    +
                    Math.abs(
                        ar.top
                        -
                        expectedTop
                    );


                const bScore =
                    Math.abs(
                        br.left
                        -
                        expectedLeft
                    )
                    +
                    Math.abs(
                        br.top
                        -
                        expectedTop
                    );


                return (
                    aScore
                    -
                    bScore
                );
            }
        );


        applyMiniCluster(
            handsCard,
            targets[0],
            sourceRadius
        );
    }


/* ==================================================================
       INSTALL UI
       ================================================================== */


    function applyUI(){

        cleanNavigation();

        installPowerSwitch();


        const rail =
            document.querySelector(
                "#view-live .combined-rail"
            );


        if(rail){

            /*
             * Controller Process is already visually correct.
             * Use it as the literal template for Hands.
             */

            mirrorHandsMiniFromController(
                rail
            );
        }


        document.documentElement.dataset
            .bacalbasaUi =
                VERSION;
    }


    function scheduleUI(){

        /*
         * Four finite passes because older dashboard modules perform
         * several one-time DOM rearrangements during initial load.
         */

        [
            0,
            120,
            400,
            1000
        ]
        .forEach(
            delay => {

                setTimeout(
                    () => {

                        requestAnimationFrame(
                            applyUI
                        );
                    },
                    delay
                );
            }
        );
    }


    if(
        document.readyState ===
        "loading"
    ){

        document.addEventListener(
            "DOMContentLoaded",
            scheduleUI,
            {
                once:
                    true
            }
        );

    }else{

        scheduleUI();
    }
})();

/* ==================================================================
   BACALBASA_RIGHT_RAIL_VIEWPORT_V2104
   ================================================================== */

(() => {
    "use strict";


    let pendingFrame =
        0;


    function syncRightRailViewportV2104(){

        pendingFrame =
            0;


        const rail =
            document.querySelector(
                "body.stitch-live-v12 "
                +
                "#view-live "
                +
                ".combined-live-grid "
                +
                "> .combined-rail"
            );


        if(!rail){
            return;
        }


        const rect =
            rail.getBoundingClientRect();


        /*
         * Leave a small bottom breathing gap.
         * The rail's REAL rendered top is used, so this survives
         * header-height changes without a magic top offset.
         */

        const bottomGap =
            8;


        const available =
            Math.max(
                140,
                Math.floor(
                    window.innerHeight
                    -
                    rect.top
                    -
                    bottomGap
                )
            );


        rail.style.setProperty(
            "--baca-right-rail-viewport-max-v2104",
            `${available}px`
        );
    }


    function scheduleRightRailViewportV2104(){

        if(pendingFrame){
            cancelAnimationFrame(
                pendingFrame
            );
        }


        pendingFrame =
            requestAnimationFrame(
                syncRightRailViewportV2104
            );
    }


    if(
        document.readyState ===
        "loading"
    ){

        document.addEventListener(
            "DOMContentLoaded",
            scheduleRightRailViewportV2104,
            {
                once:
                    true
            }
        );

    }else{

        scheduleRightRailViewportV2104();
    }


    window.addEventListener(
        "resize",
        scheduleRightRailViewportV2104,
        {
            passive:
                true
        }
    );


    window.addEventListener(
        "pageshow",
        scheduleRightRailViewportV2104
    );


    if(window.visualViewport){

        window.visualViewport.addEventListener(
            "resize",
            scheduleRightRailViewportV2104,
            {
                passive:
                    true
            }
        );
    }
})();

