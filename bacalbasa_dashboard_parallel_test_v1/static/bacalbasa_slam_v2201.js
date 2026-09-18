(() => {
    "use strict";


    const MARKER =
        "BACALBASA_SLAM_LIVE_STYLE_SAMPLE_V2201";


    function cleanText(
        value
    ){

        return String(
            value || ""
        )
        .replace(
            /\s+/g,
            " "
        )
        .trim();
    }


    function exactLeafByText(
        root,
        wanted
    ){

        if(!root){
            return null;
        }


        const target =
            cleanText(
                wanted
            )
            .toLowerCase();


        return (
            [...root.querySelectorAll("*")]
            .find(
                element =>
                    element.children.length === 0
                    &&
                    cleanText(
                        element.textContent
                    )
                    .toLowerCase()
                    === target
            )
            ||
            null
        );
    }


    function setVariable(
        root,
        name,
        value
    ){

        if(
            !root
            ||
            !value
        ){
            return;
        }


        root.style.setProperty(
            name,
            value
        );
    }


    function copyTypographyToVariables(
        root,
        source,
        prefix
    ){

        if(
            !root
            ||
            !source
        ){
            return false;
        }


        const style =
            getComputedStyle(
                source
            );


        const mapping = {
            "family":
                style.fontFamily,

            "size":
                style.fontSize,

            "weight":
                style.fontWeight,

            "style":
                style.fontStyle,

            "line":
                style.lineHeight,

            "spacing":
                style.letterSpacing,

            "word-spacing":
                style.wordSpacing,

            "transform":
                style.textTransform,

            "color":
                style.color,
        };


        for(
            const [
                suffix,
                value
            ]
            of Object.entries(
                mapping
            )
        ){

            setVariable(
                root,
                `--${prefix}-${suffix}-v2201`,
                value
            );
        }


        return true;
    }


    function installV2201(){

        const slam =
            document.getElementById(
                "view-slam"
            );


        if(!slam){
            return;
        }


        /*
         * --------------------------------------------------------
         * RIGHT RAIL WIDTH
         *
         * Capture the Live rail's real startup width instead of
         * hard-coding a guessed number.
         * --------------------------------------------------------
         */

        const liveRail =
            document.querySelector(
                "#view-live .combined-rail"
            );


        if(liveRail){

            const rect =
                liveRail.getBoundingClientRect();


            if(
                Number.isFinite(
                    rect.width
                )
                &&
                rect.width > 100
            ){

                setVariable(
                    slam,
                    "--slam-live-rail-width-v2201",
                    `${Math.round(rect.width)}px`
                );
            }
        }


        /*
         * --------------------------------------------------------
         * HEADINGS <- CAMERA MULTIVIEW
         * --------------------------------------------------------
         */

        const cameraTitle =
            document.getElementById(
                "cameraMultiviewTitle"
            );


        copyTypographyToVariables(
            slam,
            cameraTitle,
            "slam-live-heading"
        );


        /*
         * --------------------------------------------------------
         * LOCALIZATION TEXT <- PINKY
         *
         * Search the actual rendered Live content, so historical
         * class/cascade changes do not matter.
         * --------------------------------------------------------
         */

        const live =
            document.getElementById(
                "view-live"
            );


        const pinky =
            exactLeafByText(
                live,
                "Pinky"
            );


        copyTypographyToVariables(
            slam,
            pinky,
            "slam-live-pinky"
        );


        slam.dataset
            .bacalbasaSlamLiveSample =
            MARKER;
    }


    function scheduleV2201(){

        requestAnimationFrame(
            ()=>{
                requestAnimationFrame(
                    installV2201
                );
            }
        );
    }


    if(
        document.readyState ===
        "complete"
    ){

        scheduleV2201();

    }else{

        window.addEventListener(
            "load",
            scheduleV2201,
            {
                once:
                    true
            }
        );
    }
})();


/* ==================================================================
   BACALBASA_LIVE_START_GEOMETRY_V2203

   IMPORTANT:

   This is deliberately very small.

   It does NOT:
       - move SLAM cards
       - inspect card descendants
       - absolutely position anything
       - rebuild DOM
       - observe mutations
       - run continuously

   It only establishes the canonical startup Live proportions and
   copies surface colors/width to SLAM.
   ================================================================== */

(() => {
    "use strict";


    /*
     * SLAM FINAL CLEANUP 1
     *
     * Live owns its own geometry.
     *
     * V2203 is now strictly a READ-ONLY sampler of the rendered
     * Live surfaces. It must never establish Camera / Twin / Rail
     * proportions on behalf of Live.
     */

    function isTransparent(
        color
    ){

        return (
            !color
            ||
            color === "transparent"
            ||
            color === "rgba(0, 0, 0, 0)"
        );
    }


    function paintedBackground(
        element,
        stopElement = null
    ){

        let node =
            element;


        while(
            node
            &&
            node !== stopElement
        ){

            const style =
                getComputedStyle(
                    node
                );


            if(
                !isTransparent(
                    style.backgroundColor
                )
            ){

                return style.backgroundColor;
            }


            node =
                node.parentElement;
        }


        return "";
    }


    function setVar(
        slam,
        name,
        value
    ){

        if(
            !slam
            ||
            value === undefined
            ||
            value === null
            ||
            value === ""
        ){
            return;
        }


        slam.style.setProperty(
            name,
            String(value)
        );
    }


    function copyLiveSurfacesToSlam(){

        const slam =
            document.getElementById(
                "view-slam"
            );


        const rail =
            document.querySelector(
                "#view-live .combined-rail"
            );


        const mode =
            document.querySelector(
                "#view-live .combined-rail .stitch-mode-section"
            );


        if(
            !slam
            ||
            !rail
        ){
            return false;
        }


        /*
         * --------------------------------------------------------
         * SIDEBAR WIDTH
         * --------------------------------------------------------
         */

        const railRect =
            rail.getBoundingClientRect();


        if(
            Number.isFinite(
                railRect.width
            )
            &&
            railRect.width > 0
        ){

            setVar(
                slam,
                "--slam-live-rail-width-v2203",
                `${railRect.width}px`
            );
        }


        /*
         * --------------------------------------------------------
         * OUTER LIVE RAIL SURFACE
         * --------------------------------------------------------
         */

        const railStyle =
            getComputedStyle(
                rail
            );


        const railBackground =
            paintedBackground(
                rail
            );


        setVar(
            slam,
            "--slam-live-rail-bg-v2203",
            railBackground
        );


        setVar(
            slam,
            "--slam-live-rail-border-v2203",
            railStyle.borderTopColor
        );


        setVar(
            slam,
            "--slam-live-rail-radius-v2203",
            railStyle.borderTopLeftRadius
        );


        setVar(
            slam,
            "--slam-live-rail-shadow-v2203",
            railStyle.boxShadow
        );


        /*
         * --------------------------------------------------------
         * MODE CARD SURFACE
         *
         * .stitch-mode-section is a direct known class. We are NOT
         * searching arbitrary ancestors like the failed V2202 code.
         * --------------------------------------------------------
         */

        if(mode){

            const modeStyle =
                getComputedStyle(
                    mode
                );


            const modeBackground =
                paintedBackground(
                    mode,
                    rail
                )
                ||
                railBackground;


            setVar(
                slam,
                "--slam-live-mode-bg-v2203",
                modeBackground
            );


            setVar(
                slam,
                "--slam-live-mode-border-v2203",
                modeStyle.borderTopColor
            );


            setVar(
                slam,
                "--slam-live-mode-radius-v2203",
                modeStyle.borderTopLeftRadius
            );


            setVar(
                slam,
                "--slam-live-mode-shadow-v2203",
                modeStyle.boxShadow
            );
        }


        slam.dataset
            .surfaceMatchV2203 =
            "ready";


        return true;
    }


    function install(){

        /*
         * SLAM FINAL CLEANUP 1
         *
         * Wait for the current Live layout to settle, then SAMPLE it.
         * No Live geometry is written by this SLAM owner.
         */

        requestAnimationFrame(
            () => {

                requestAnimationFrame(
                    () => {

                        if(
                            !copyLiveSurfacesToSlam()
                        ){

                            /*
                             * One bounded retry in case MODE is
                             * assembled slightly later.
                             *
                             * This is NOT a polling loop.
                             */

                            setTimeout(
                                copyLiveSurfacesToSlam,
                                180
                            );
                        }
                    }
                );
            }
        );
    }


    if(
        document.readyState ===
        "complete"
    ){

        install();

    }else{

        window.addEventListener(
            "load",
            install,
            {
                once:
                    true
            }
        );
    }


    /*
     * Width only.
     *
     * On browser resize we do NOT reapply the starting Live layout.
     * The FR proportions already resize naturally and user drag state
     * remains free to work.
     *
     * We only refresh the SLAM rail's matching startup-width formula.
     */

    window.addEventListener(
        "resize",
        () => {

            const slam =
                document.getElementById(
                    "view-slam"
                );


            if(!slam){
                return;
            }


            const liveRail =
                document.querySelector(
                    "#view-live .combined-rail"
                );


            if(!liveRail){
                return;
            }


            const rect =
                liveRail.getBoundingClientRect();


            if(
                Number.isFinite(
                    rect.width
                )
                &&
                rect.width > 0
            ){

                setVar(
                    slam,
                    "--slam-live-rail-width-v2203",
                    `${rect.width}px`
                );
            }
        },
        {
            passive:
                true
        }
    );
})();

/* ==================================================================
   BACALBASA_SLAM_LIVE_REFERENCE_SYNC_V2209

   Copies only final rendered VISUAL references:

       CAMERA MULTIVIEW -> Laboratory Point Cloud
       MODE             -> Localization
       command/feedback -> Layers legend typography

   Event-driven only.
   No MutationObserver.
   No DOM rebuilding.
   ================================================================== */

(() => {
    "use strict";


    let cameraReference =
        null;

    let modeReference =
        null;

    let handsLegendReference =
        null;


    function cleanText(
        value
    ){

        return String(
            value || ""
        )
        .replace(
            /\s+/g,
            " "
        )
        .trim();
    }


    function exactTextElement(
        root,
        targetText
    ){

        if(!root){
            return null;
        }


        const wanted =
            String(
                targetText
            )
            .toLowerCase();


        /*
         * Text-node search is more reliable than requiring an element
         * to have zero children.
         */

        const walker =
            document.createTreeWalker(
                root,
                NodeFilter.SHOW_TEXT
            );


        let node =
            walker.nextNode();


        while(node){

            if(
                cleanText(
                    node.nodeValue
                )
                .toLowerCase()
                ===
                wanted
            ){

                return node.parentElement;
            }


            node =
                walker.nextNode();
        }


        return null;
    }


    function styleSnapshot(
        element
    ){

        if(!element){
            return null;
        }


        const style =
            getComputedStyle(
                element
            );


        return {
            color:
                style.color,

            fontFamily:
                style.fontFamily,

            fontSize:
                style.fontSize,

            fontWeight:
                style.fontWeight,

            lineHeight:
                style.lineHeight,

            letterSpacing:
                style.letterSpacing,

            textTransform:
                style.textTransform
        };
    }


    function setVar(
        root,
        name,
        value
    ){

        if(
            !root
            ||
            value === undefined
            ||
            value === null
            ||
            value === ""
        ){
            return;
        }


        root.style.setProperty(
            name,
            String(value)
        );
    }


    function captureLiveReferences(){

        const live =
            document.getElementById(
                "view-live"
            );


        if(
            !live
            ||
            !live.classList.contains(
                "active"
            )
        ){
            return false;
        }


        /* --------------------------------------------------------
           CAMERA MULTIVIEW
           -------------------------------------------------------- */

        const cameraTitle =
            document.getElementById(
                "cameraMultiviewTitle"
            )
            ||
            exactTextElement(
                live,
                "CAMERA MULTIVIEW"
            );


        const cameraPanel =
            cameraTitle
            ? (
                cameraTitle.closest(
                    ".camera-panel"
                )
                ||
                cameraTitle.closest(
                    '[data-stitch-major-key="camera"]'
                )
            )
            : null;


        if(
            cameraTitle
            &&
            cameraPanel
        ){

            const titleRect =
                cameraTitle
                .getBoundingClientRect();


            const panelRect =
                cameraPanel
                .getBoundingClientRect();


            cameraReference = {

                x:
                    titleRect.left
                    -
                    panelRect.left,

                y:
                    titleRect.top
                    -
                    panelRect.top,

                style:
                    styleSnapshot(
                        cameraTitle
                    )
            };
        }


        /* --------------------------------------------------------
           MODE
           -------------------------------------------------------- */

        const rail =
            document.querySelector(
                "#view-live .combined-rail"
            );


        const modeTitle =
            document.querySelector(
                "#view-live .stitch-mode-section .panel-kicker"
            )
            ||
            exactTextElement(
                rail,
                "MODE"
            );


        if(
            rail
            &&
            modeTitle
        ){

            const titleRect =
                modeTitle
                .getBoundingClientRect();


            const railRect =
                rail
                .getBoundingClientRect();


            modeReference = {

                x:
                    titleRect.left
                    -
                    railRect.left,

                y:
                    titleRect.top
                    -
                    railRect.top,

                style:
                    styleSnapshot(
                        modeTitle
                    )
            };
        }


        /* --------------------------------------------------------
           HANDS COMMAND / FEEDBACK
           -------------------------------------------------------- */

        const command =
            exactTextElement(
                rail,
                "command"
            );


        const feedback =
            exactTextElement(
                rail,
                "feedback"
            );


        handsLegendReference =
            styleSnapshot(
                command
                ||
                feedback
            );


        return Boolean(
            cameraReference
            &&
            modeReference
        );
    }


    function installReferenceStyles(
        slam
    ){

        if(
            !slam
        ){
            return;
        }


        const camera =
            cameraReference
            ? cameraReference.style
            : null;


        if(camera){

            setVar(
                slam,
                "--slam-camera-title-color-v2209",
                camera.color
            );

            setVar(
                slam,
                "--slam-camera-title-family-v2209",
                camera.fontFamily
            );

            setVar(
                slam,
                "--slam-camera-title-size-v2209",
                camera.fontSize
            );

            setVar(
                slam,
                "--slam-camera-title-weight-v2209",
                camera.fontWeight
            );

            setVar(
                slam,
                "--slam-camera-title-line-v2209",
                camera.lineHeight
            );

            setVar(
                slam,
                "--slam-camera-title-spacing-v2209",
                camera.letterSpacing
            );

            setVar(
                slam,
                "--slam-camera-title-transform-v2209",
                camera.textTransform
            );
        }


        const mode =
            modeReference
            ? modeReference.style
            : null;


        if(mode){

            setVar(
                slam,
                "--slam-mode-title-color-v2209",
                mode.color
            );

            setVar(
                slam,
                "--slam-mode-title-family-v2209",
                mode.fontFamily
            );

            setVar(
                slam,
                "--slam-mode-title-size-v2209",
                mode.fontSize
            );

            setVar(
                slam,
                "--slam-mode-title-weight-v2209",
                mode.fontWeight
            );

            setVar(
                slam,
                "--slam-mode-title-line-v2209",
                mode.lineHeight
            );

            setVar(
                slam,
                "--slam-mode-title-spacing-v2209",
                mode.letterSpacing
            );

            setVar(
                slam,
                "--slam-mode-title-transform-v2209",
                mode.textTransform
            );
        }


        const hands =
            handsLegendReference;


        if(hands){

            setVar(
                slam,
                "--slam-hands-key-family-v2209",
                hands.fontFamily
            );

            setVar(
                slam,
                "--slam-hands-key-size-v2209",
                hands.fontSize
            );

            setVar(
                slam,
                "--slam-hands-key-weight-v2209",
                hands.fontWeight
            );

            setVar(
                slam,
                "--slam-hands-key-line-v2209",
                hands.lineHeight
            );

            setVar(
                slam,
                "--slam-hands-key-spacing-v2209",
                hands.letterSpacing
            );
        }
    }


    function alignTitle(
        target,
        targetContainer,
        reference,
        root,
        xVariable,
        yVariable
    ){

        if(
            !target
            ||
            !targetContainer
            ||
            !reference
            ||
            !root
        ){
            return;
        }


        /*
         * Zero previous correction before measuring.
         */

        root.style.setProperty(
            xVariable,
            "0px"
        );


        root.style.setProperty(
            yVariable,
            "0px"
        );


        const targetRect =
            target
            .getBoundingClientRect();


        const containerRect =
            targetContainer
            .getBoundingClientRect();


        const currentX =
            targetRect.left
            -
            containerRect.left;


        const currentY =
            targetRect.top
            -
            containerRect.top;


        setVar(
            root,
            xVariable,
            `${
                reference.x
                -
                currentX
            }px`
        );


        setVar(
            root,
            yVariable,
            `${
                reference.y
                -
                currentY
            }px`
        );
    }


    function applyToSlam(){

        const slam =
            document.getElementById(
                "view-slam"
            );


        if(
            !slam
            ||
            !slam.classList.contains(
                "active"
            )
        ){
            return false;
        }


        installReferenceStyles(
            slam
        );


        alignTitle(
            document.getElementById(
                "slamLabTitleV2209"
            ),
            slam.querySelector(
                ".slam-world-panel"
            ),
            cameraReference,
            slam,
            "--slam-lab-title-dx-v2209",
            "--slam-lab-title-dy-v2209"
        );


        alignTitle(
            document.getElementById(
                "slamLocalizationTitleV2209"
            ),
            slam.querySelector(
                ".slam-sidebar"
            ),
            modeReference,
            slam,
            "--slam-localization-title-dx-v2209",
            "--slam-localization-title-dy-v2209"
        );


        slam.dataset
            .liveReferenceV2209 =
            "ready";


        return true;
    }


    function captureAfterLayout(){

        requestAnimationFrame(
            () => {

                requestAnimationFrame(
                    captureLiveReferences
                );
            }
        );
    }


    function applyAfterSwitch(){

        requestAnimationFrame(
            () => {

                requestAnimationFrame(
                    applyToSlam
                );
            }
        );
    }


    if(
        document.readyState ===
        "complete"
    ){

        captureAfterLayout();

    }else{

        window.addEventListener(
            "load",
            captureAfterLayout,
            {
                once:
                    true
            }
        );
    }


    /*
     * Capture BEFORE Live disappears.
     * This listener runs in capture phase.
     */

    document.addEventListener(
        "click",
        event => {

            const tab =
                event.target.closest(
                    ".tab[data-view]"
                );


            if(!tab){
                return;
            }


            if(
                tab.dataset.view
                ===
                "slam"
            ){

                captureLiveReferences();

                applyAfterSwitch();

                return;
            }


            if(
                tab.dataset.view
                ===
                "live"
            ){

                captureAfterLayout();
            }
        },
        true
    );


    window.addEventListener(
        "resize",
        () => {

            const live =
                document.getElementById(
                    "view-live"
                );


            if(
                live
                &&
                live.classList.contains(
                    "active"
                )
            ){

                captureLiveReferences();

            }else{

                applyToSlam();
            }
        },
        {
            passive:
                true
        }
    );

})();



/* ==================================================================
   BACALBASA_SLAM_WORKSPACE_V2210

   Two-panel analogue of the accepted Live major-section system.

   REORDER:
       actual surface follows pointer
       290ms FLIP settle
       width belongs to panel identity
       order persists

   RESIZE:
       side edge changes adjacent pair
       requestAnimationFrame update
       width fractions persist

   No MutationObserver.
   No setInterval.
   No polling.
   ================================================================== */

(function(){

    "use strict";


    const ORDER_STORAGE =
        "g1Dashboard.bacaSlamMajorOrder.clean1";


    const WIDTH_STORAGE =
        "g1Dashboard.bacaSlamMajorWidths.clean1";


    const DEFAULT_ORDER = [
        "world",
        "rail"
    ];


    const FLIP_MS =
        290;


    const FLIP_EASING =
        "cubic-bezier(0.2, 0.85, 0.25, 1)";


    let root =
        null;


    let grid =
        null;


    let elements =
        null;


    let order =
        [...DEFAULT_ORDER];


    let layoutWidths =
        null;


    let fractions =
        null;


    let drag =
        null;


    let resize =
        null;


    let resizeFrame =
        null;


    let queuedResize =
        null;


    let windowResizeFrame =
        null;


    const animations =
        new WeakMap();


    /* ============================================================
       HELPERS
       ============================================================ */


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


    function validOrder(value){

        return (
            Array.isArray(value)
            &&
            value.length === 2
            &&
            DEFAULT_ORDER.every(
                key => value.includes(key)
            )
            &&
            new Set(value).size === 2
        );
    }


    function loadOrder(){

        try{

            const value =
                JSON.parse(
                    localStorage.getItem(
                        ORDER_STORAGE
                    )
                    ||
                    "null"
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
                ORDER_STORAGE,
                JSON.stringify(order)
            );

        }catch(_){
        }
    }


    function loadFractions(){

        try{

            const value =
                JSON.parse(
                    localStorage.getItem(
                        WIDTH_STORAGE
                    )
                    ||
                    "null"
                );


            if(
                !value
                ||
                typeof value !== "object"
            ){
                return null;
            }


            const world =
                Number(value.world);


            const rail =
                Number(value.rail);


            if(
                !Number.isFinite(world)
                ||
                !Number.isFinite(rail)
                ||
                world <= 0
                ||
                rail <= 0
            ){
                return null;
            }


            const total =
                world + rail;


            if(total <= 0){
                return null;
            }


            return {
                world:
                    world / total,

                rail:
                    rail / total
            };

        }catch(_){

            return null;
        }
    }


    function saveFractions(){

        if(!layoutWidths){
            return;
        }


        const total =
            layoutWidths.world
            +
            layoutWidths.rail;


        if(total <= 0){
            return;
        }


        fractions = {
            world:
                layoutWidths.world / total,

            rail:
                layoutWidths.rail / total
        };


        try{

            localStorage.setItem(
                WIDTH_STORAGE,
                JSON.stringify(fractions)
            );

        }catch(_){
        }
    }


    function gapPixels(){

        if(!grid){
            return 8;
        }


        const value =
            parseFloat(
                getComputedStyle(grid)
                    .columnGap
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


        return Math.max(
            0,
            grid
                .getBoundingClientRect()
                .width
            -
            gapPixels()
        );
    }


    function currentRenderedWidths(){

        return {
            world:
                elements.world
                    .getBoundingClientRect()
                    .width,

            rail:
                elements.rail
                    .getBoundingClientRect()
                    .width
        };
    }


    /*
     * Same rail limits used by the accepted Live resize system where
     * practical. At very small browser widths the absolute floor is
     * relaxed so the two-panel SLAM layout cannot become impossible.
     */

    function boundsFor(
        key,
        available
    ){

        if(key === "rail"){

            let minimum =
                Math.max(
                    250,
                    available * .145
                );


            let maximum =
                Math.min(
                    480,
                    available * .32
                );


            if(
                minimum + 380
                >
                available
            ){

                minimum =
                    Math.max(
                        180,
                        available * .28
                    );
            }


            maximum =
                Math.max(
                    minimum,
                    maximum
                );


            maximum =
                Math.min(
                    maximum,
                    Math.max(
                        minimum,
                        available - 300
                    )
                );


            return {
                min:
                    minimum,

                max:
                    maximum
            };
        }


        let minimum =
            Math.max(
                380,
                available * .50
            );


        const railMinimum =
            boundsFor(
                "rail",
                available
            ).min;


        minimum =
            Math.min(
                minimum,
                Math.max(
                    1,
                    available - railMinimum
                )
            );


        return {
            min:
                minimum,

            max:
                Math.max(
                    minimum,
                    available - railMinimum
                )
        };
    }


    function fitWidths(
        desired,
        available
    ){

        const result = {};


        for(const key of DEFAULT_ORDER){

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


        for(
            let pass = 0;
            pass < 12;
            pass += 1
        ){

            const total =
                result.world
                +
                result.rail;


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
                DEFAULT_ORDER.filter(
                    key => {

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
                    }
                );


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


        /*
         * Numerical clean-up.
         *
         * Put any tiny remaining fraction into World so the grid always
         * consumes the complete width.
         */

        const remaining =
            available
            -
            (
                result.world
                +
                result.rail
            );


        result.world +=
            remaining;


        return result;
    }


    function applyLayout(){

        if(
            !grid
            ||
            !layoutWidths
        ){
            return;
        }


        grid.style.setProperty(
            "grid-template-columns",

            order
                .map(
                    key =>
                        `${Math.max(
                            1,
                            Math.round(
                                layoutWidths[key]
                            )
                        )}px`
                )
                .join(" "),

            "important"
        );


        order.forEach(
            (key,index)=>{

                const section =
                    elements[key];


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


        grid.getBoundingClientRect();
    }


    function applyWidths(
        widths
    ){

        layoutWidths = {
            world:
                widths.world,

            rail:
                widths.rail
        };


        applyLayout();
    }


    /* ============================================================
       FLIP
       ============================================================ */


    function cancelAnimation(element){

        const animation =
            animations.get(element);


        if(!animation){
            return;
        }


        try{
            animation.cancel();
        }catch(_){
        }


        animations.delete(element);
    }


    function animateFromRect(
        element,
        oldRect
    ){

        cancelAnimation(element);


        const newRect =
            element
                .getBoundingClientRect();


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
            return;
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
                        animations.get(element)
                        ===
                        animation
                    ){
                        animations.delete(
                            element
                        );
                    }


                    try{
                        animation.cancel();
                    }catch(_){
                    }
                },
                {
                    once:
                        true
                }
            );

        }catch(_){
        }
    }


    /* ============================================================
       REORDER
       ============================================================ */


    function cleanupDragListeners(){

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


    function beginDrag(
        event,
        key,
        handle
    ){

        if(
            event.button !== 0
            ||
            drag
            ||
            resize
        ){
            return;
        }


        const section =
            elements[key];


        const rect =
            section
                .getBoundingClientRect();


        drag = {
            pointerId:
                event.pointerId,

            key,

            section,

            handle,

            originOrder:
                [...order],

            startX:
                event.clientX,

            startY:
                event.clientY,

            pointerOffsetX:
                event.clientX
                -
                rect.left,

            baseLeft:
                rect.left,

            started:
                false
        };


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


    function moveDrag(event){

        if(
            !drag
            ||
            event.pointerId
                !==
            drag.pointerId
        ){
            return;
        }


        const dx =
            event.clientX
            -
            drag.startX;


        const dy =
            event.clientY
            -
            drag.startY;


        if(
            !drag.started
            &&
            Math.hypot(dx,dy)
                <
            5
        ){
            return;
        }


        if(!drag.started){

            drag.started =
                true;


            drag.section.classList.add(
                "baca-slam-dragging-v2210"
            );


            document.body.classList.add(
                "baca-slam-major-dragging-v2210"
            );
        }


        event.preventDefault();


        const desiredLeft =
            event.clientX
            -
            drag.pointerOffsetX;


        const translateX =
            desiredLeft
            -
            drag.baseLeft;


        drag.section.style.setProperty(
            "transform",
            `translate3d(${translateX}px, 0, 0)`,
            "important"
        );


        drag.section.style.setProperty(
            "z-index",
            "60",
            "important"
        );


        const gridRect =
            grid
                .getBoundingClientRect();


        const targetIndex =
            event.clientX
            <
            (
                gridRect.left
                +
                gridRect.width / 2
            )
                ?
                0
                :
                1;


        const currentIndex =
            order.indexOf(
                drag.key
            );


        if(
            targetIndex
            ===
            currentIndex
        ){
            return;
        }


        const otherKey =
            order[
                targetIndex
            ];


        const other =
            elements[
                otherKey
            ];


        const otherBefore =
            other
                .getBoundingClientRect();


        /*
         * Remove transform for one synchronous layout measurement.
         * There is no paint between these statements.
         */

        drag.section.style.removeProperty(
            "transform"
        );


        const next =
            [...order];


        next[
            currentIndex
        ] =
            otherKey;


        next[
            targetIndex
        ] =
            drag.key;


        order =
            next;


        applyLayout();


        drag.baseLeft =
            drag.section
                .getBoundingClientRect()
                .left;


        drag.section.style.setProperty(
            "transform",

            `translate3d(${
                desiredLeft
                -
                drag.baseLeft
            }px, 0, 0)`,

            "important"
        );


        animateFromRect(
            other,
            otherBefore
        );


        updateExteriorEdges();
    }


    function completeDrag(
        event,
        cancelled
    ){

        if(
            !drag
            ||
            event.pointerId
                !==
            drag.pointerId
        ){
            return;
        }


        const state =
            drag;


        drag =
            null;


        cleanupDragListeners();


        try{

            state.handle.releasePointerCapture(
                event.pointerId
            );

        }catch(_){
        }


        if(!state.started){
            return;
        }


        event.preventDefault();


        const before =
            state.section
                .getBoundingClientRect();


        state.section.style.removeProperty(
            "transform"
        );


        state.section.style.removeProperty(
            "z-index"
        );


        state.section.classList.remove(
            "baca-slam-dragging-v2210"
        );


        document.body.classList.remove(
            "baca-slam-major-dragging-v2210"
        );


        if(cancelled){

            order =
                [
                    ...state.originOrder
                ];


            applyLayout();
        }


        animateFromRect(
            state.section,
            before
        );


        if(!cancelled){
            saveOrder();
        }


        updateExteriorEdges();


        requestAnimationFrame(
            ()=>{

                window.dispatchEvent(
                    new Event("resize")
                );
            }
        );
    }


    function finishDrag(event){

        completeDrag(
            event,
            false
        );
    }


    function cancelDrag(event){

        completeDrag(
            event,
            true
        );
    }


    /* ============================================================
       RESIZE
       ============================================================ */


    function queueResize(
        widths
    ){

        queuedResize = {
            world:
                widths.world,

            rail:
                widths.rail
        };


        if(
            resizeFrame
            !==
            null
        ){
            return;
        }


        resizeFrame =
            requestAnimationFrame(
                ()=>{

                    resizeFrame =
                        null;


                    if(!queuedResize){
                        return;
                    }


                    const latest =
                        queuedResize;


                    queuedResize =
                        null;


                    applyWidths(
                        latest
                    );
                }
            );
    }


    function flushResize(){

        if(
            resizeFrame
            !==
            null
        ){

            cancelAnimationFrame(
                resizeFrame
            );


            resizeFrame =
                null;
        }


        if(!queuedResize){
            return;
        }


        const latest =
            queuedResize;


        queuedResize =
            null;


        applyWidths(
            latest
        );
    }


    function visualSections(){

        return order.map(
            key =>
                elements[key]
        );
    }


    function keyFor(section){

        return section
            .dataset
            .bacaSlamMajorKeyV2210;
    }


    function updateExteriorEdges(){

        const sections =
            visualSections();


        sections.forEach(
            (section,index)=>{

                const left =
                    section.querySelector(
                        ':scope > .baca-slam-resize-edge-v2210[data-side="left"]'
                    );


                const right =
                    section.querySelector(
                        ':scope > .baca-slam-resize-edge-v2210[data-side="right"]'
                    );


                if(left){

                    left.classList.toggle(
                        "baca-slam-resize-disabled-v2210",
                        index === 0
                    );
                }


                if(right){

                    right.classList.toggle(
                        "baca-slam-resize-disabled-v2210",
                        index
                        ===
                        sections.length - 1
                    );
                }
            }
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
            resize
            ||
            drag
        ){
            return;
        }


        const sections =
            visualSections();


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

        }else{

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


        const available =
            usableWidth();


        const startWidths = {
            world:
                layoutWidths.world,

            rail:
                layoutWidths.rail
        };


        const leftKey =
            keyFor(
                leftSection
            );


        const rightKey =
            keyFor(
                rightSection
            );


        resize = {
            pointerId:
                event.pointerId,

            handle,

            sections,

            startX:
                event.clientX,

            startWidths:
                {
                    ...startWidths
                },

            widths:
                {
                    ...startWidths
                },

            leftKey,

            rightKey,

            leftStart:
                startWidths[
                    leftKey
                ],

            rightStart:
                startWidths[
                    rightKey
                ],

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
            "baca-slam-major-resizing-v2210"
        );


        handle.classList.add(
            "baca-slam-resize-active-v2210"
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


    function moveResize(event){

        if(
            !resize
            ||
            event.pointerId
                !==
            resize.pointerId
        ){
            return;
        }


        event.preventDefault();


        const delta =
            event.clientX
            -
            resize.startX;


        const pairTotal =
            resize.leftStart
            +
            resize.rightStart;


        const minimumLeft =
            Math.max(
                resize.leftBounds.min,
                pairTotal
                -
                resize.rightBounds.max
            );


        const maximumLeft =
            Math.min(
                resize.leftBounds.max,
                pairTotal
                -
                resize.rightBounds.min
            );


        const newLeft =
            clamp(
                resize.leftStart
                +
                delta,
                minimumLeft,
                maximumLeft
            );


        const newRight =
            pairTotal
            -
            newLeft;


        resize.widths[
            resize.leftKey
        ] =
            newLeft;


        resize.widths[
            resize.rightKey
        ] =
            newRight;


        queueResize(
            resize.widths
        );
    }


    function cleanupResizeListeners(){

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
            !resize
            ||
            event.pointerId
                !==
            resize.pointerId
        ){
            return;
        }


        event.preventDefault();


        const state =
            resize;


        flushResize();


        if(cancelled){

            applyWidths(
                state.startWidths
            );
        }


        try{

            state.handle.releasePointerCapture(
                event.pointerId
            );

        }catch(_){
        }


        state.handle.classList.remove(
            "baca-slam-resize-active-v2210"
        );


        document.body.classList.remove(
            "baca-slam-major-resizing-v2210"
        );


        cleanupResizeListeners();


        resize =
            null;


        if(!cancelled){
            saveFractions();
        }


        updateExteriorEdges();


        requestAnimationFrame(
            ()=>{

                window.dispatchEvent(
                    new Event("resize")
                );
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


    /* ============================================================
       WINDOW RESIZE
       ============================================================ */


    function refitToWindow(){

        windowResizeFrame =
            null;


        if(
            !root
            ||
            !root.classList.contains(
                "active"
            )
            ||
            drag
            ||
            resize
        ){
            return;
        }


        const available =
            usableWidth();


        if(available <= 0){
            return;
        }


        if(!fractions){

            fractions = {
                world:
                    layoutWidths.world
                    /
                    (
                        layoutWidths.world
                        +
                        layoutWidths.rail
                    ),

                rail:
                    layoutWidths.rail
                    /
                    (
                        layoutWidths.world
                        +
                        layoutWidths.rail
                    )
            };
        }


        const desired = {
            world:
                fractions.world
                *
                available,

            rail:
                fractions.rail
                *
                available
        };


        applyWidths(
            fitWidths(
                desired,
                available
            )
        );
    }


    function scheduleWindowRefit(){

        if(
            windowResizeFrame
            !==
            null
        ){
            return;
        }


        windowResizeFrame =
            requestAnimationFrame(
                refitToWindow
            );
    }


    /* ============================================================
       INSTALL
       ============================================================ */


    function addInteractions(
        section,
        key
    ){

        section.classList.add(
            "baca-slam-major-v2210"
        );


        section.dataset
            .bacaSlamMajorKeyV2210 =
                key;


        const grip =
            document.createElement(
                "div"
            );


        grip.className =
            "baca-slam-major-grip-v2210";


        grip.setAttribute(
            "role",
            "button"
        );


        grip.setAttribute(
            "aria-label",
            key === "world"
                ?
                "Move Laboratory Point Cloud section"
                :
                "Move SLAM sidebar"
        );


        grip.title =
            "Drag to reorder";


        grip.addEventListener(
            "pointerdown",
            event =>
                beginDrag(
                    event,
                    key,
                    grip
                )
        );


        section.appendChild(
            grip
        );


        for(
            const side
            of [
                "left",
                "right"
            ]
        ){

            const edge =
                document.createElement(
                    "div"
                );


            edge.className =
                "baca-slam-resize-edge-v2210";


            edge.dataset.side =
                side;


            edge.setAttribute(
                "aria-hidden",
                "true"
            );


            edge.addEventListener(
                "pointerdown",
                event =>
                    beginResize(
                        event,
                        section,
                        side,
                        edge
                    )
            );


            section.appendChild(
                edge
            );
        }
    }


    function install(){

        root =
            document.getElementById(
                "view-slam"
            );


        grid =
            root
                ?.querySelector(
                    ".slam-layout"
                );


        const world =
            root
                ?.querySelector(
                    ".slam-world-panel"
                );


        const rail =
            root
                ?.querySelector(
                    ".slam-sidebar"
                );


        if(
            !root
            ||
            !grid
            ||
            !world
            ||
            !rail
        ){

            console.error(
                "V2210 SLAM workspace: required section missing"
            );

            return false;
        }


        /*
         * V2210R1 IMPORTANT:
         *
         * #view-slam is display:none while Live is active.
         * Measuring it in that state returns zero-width panels.
         *
         * NEVER establish SLAM workspace geometry until the view is
         * genuinely visible.
         */

        if(
            !root.classList.contains(
                "active"
            )
        ){
            return false;
        }


        const visibleGridRect =
            grid.getBoundingClientRect();


        if(
            visibleGridRect.width < 500
            ||
            visibleGridRect.height < 100
        ){
            return false;
        }


        if(
            root.querySelector(
                ".baca-slam-major-grip-v2210"
            )
        ){
            scheduleWindowRefit();
            return true;
        }


        elements = {
            world,
            rail
        };


        /*
         * Capture the approved V2209 geometry only now, while the
         * SLAM layout is actually rendered.
         */

        layoutWidths =
            currentRenderedWidths();


        if(
            !Number.isFinite(layoutWidths.world)
            ||
            !Number.isFinite(layoutWidths.rail)
            ||
            layoutWidths.world < 100
            ||
            layoutWidths.rail < 100
        ){

            console.error(
                "V2210R1 SLAM workspace: refusing invalid visible widths",
                layoutWidths
            );

            layoutWidths = null;
            elements = null;

            return false;
        }


        fractions =
            loadFractions();


        order =
            loadOrder();


        addInteractions(
            world,
            "world"
        );


        addInteractions(
            rail,
            "rail"
        );


        const available =
            usableWidth();


        if(
            fractions
            &&
            available > 0
        ){

            applyWidths(
                fitWidths(
                    {
                        world:
                            fractions.world
                            *
                            available,

                        rail:
                            fractions.rail
                            *
                            available
                    },
                    available
                )
            );

        }else{

            fractions = {
                world:
                    layoutWidths.world
                    /
                    (
                        layoutWidths.world
                        +
                        layoutWidths.rail
                    ),

                rail:
                    layoutWidths.rail
                    /
                    (
                        layoutWidths.world
                        +
                        layoutWidths.rail
                    )
            };


            applyLayout();
        }


        updateExteriorEdges();


        window.addEventListener(
            "resize",
            scheduleWindowRefit,
            {
                passive:
                    true
            }
        );


        /*
         * When SLAM is entered, fit persisted fractions to whatever
         * browser width exists at that moment.
         */

        document.addEventListener(
            "click",
            event => {

                const tab =
                    event.target.closest(
                        '.tab[data-view="slam"]'
                    );


                if(!tab){
                    return;
                }


                requestAnimationFrame(
                    ()=>{

                        requestAnimationFrame(
                            scheduleWindowRefit
                        );
                    }
                );
            },
            true
        );


        document.body.dataset
            .bacaSlamWorkspace =
                "v2210";


        console.log(
            "[BACALBASA SLAM V2210R1] reorder + resize ready",
            {
                order:
                    [...order],

                fractions:
                    {...fractions},

                widths:
                    {...layoutWidths}
            }
        );


        return true;
    }


    /* ============================================================
       DEFERRED VISIBLE-VIEW INITIALIZATION

       No polling.
       No MutationObserver.

       We initialize only:
           - if SLAM is already visible on page restoration, or
           - immediately after the user switches to SLAM.
       ============================================================ */

    let installFrameV2210R1 =
        null;


    function scheduleInstallV2210R1(){

        if(
            installFrameV2210R1
            !==
            null
        ){
            return;
        }


        installFrameV2210R1 =
            requestAnimationFrame(
                ()=>{

                    requestAnimationFrame(
                        ()=>{

                            installFrameV2210R1 =
                                null;


                            install();
                        }
                    );
                }
            );
    }


    function installIfVisibleV2210R1(){

        const slam =
            document.getElementById(
                "view-slam"
            );


        if(
            slam
            &&
            slam.classList.contains(
                "active"
            )
        ){
            scheduleInstallV2210R1();
        }
    }


    document.addEventListener(
        "click",
        event => {

            const tab =
                event.target.closest(
                    '.tab[data-view="slam"]'
                );


            if(!tab){
                return;
            }


            /*
             * The dashboard's normal tab handler runs during this click.
             * Two animation frames put our measurement safely after the
             * SLAM view has become display:block.
             */

            scheduleInstallV2210R1();
        },
        true
    );


    if(
        document.readyState
        ===
        "loading"
    ){

        document.addEventListener(
            "DOMContentLoaded",
            installIfVisibleV2210R1,
            {
                once:
                    true
            }
        );

    }else{

        installIfVisibleV2210R1();
    }


    window.addEventListener(
        "pageshow",
        installIfVisibleV2210R1
    );

})();
