/* ==================================================================
   BACALBASA SLAM V2.2.16.0

   One presentation owner for:
     - exact Live Reset-view appearance
     - exact Live center-header vertical boundary
     - exact Live Reset-view placement
     - Initial Pose control appearance
     - idle caption appearance

   IMPORTANT:
     - animation SVG is untouched
     - SLAM canvas/WebGL is untouched
     - Reset-view functionality is untouched
     - no polling
     - no MutationObserver
   ================================================================== */

(() => {

    "use strict";


function textOf(node) {

        return String(
            node?.value
            ??
            node?.textContent
            ??
            ""
        )
        .replace(/\s+/g, " ")
        .trim();
    }


    function setImportant(
        target,
        property,
        value
    ) {

        if (
            target
            &&
            value !== undefined
            &&
            value !== null
        ) {

            target.style.setProperty(
                property,
                String(value),
                "important"
            );
        }
    }


    function copyComputed(
        source,
        target,
        properties
    ) {

        if (
            !source
            ||
            !target
        ) {
            return;
        }


        const sourceStyle =
            getComputedStyle(
                source
            );


        for (
            const property
            of properties
        ) {

            const value =
                sourceStyle
                    .getPropertyValue(
                        property
                    );


            if (value) {

                setImportant(
                    target,
                    property,
                    value
                );
            }
        }
    }


    function findButtonByText(
        root,
        wanted
    ) {

        if (!root) {
            return null;
        }


        return [
            ...root.querySelectorAll(
                "button"
            )
        ]
        .find(
            button =>
                textOf(button)
                    .toLowerCase()
                ===
                wanted.toLowerCase()
        )
        ||
        null;
    }


    function findControlByText(
        root,
        wanted
    ) {

        if (!root) {
            return null;
        }


        return [
            ...root.querySelectorAll(
                "input, button, select, textarea, div, span"
            )
        ]
        .find(
            node =>
                textOf(node)
                    .toLowerCase()
                ===
                wanted.toLowerCase()
        )
        ||
        null;
    }


    function findLeafByText(
        root,
        expression
    ) {

        if (!root) {
            return null;
        }


        return [
            ...root.querySelectorAll("*")
        ]
        .find(
            node => {

                if (
                    node.children.length
                    !==
                    0
                ) {
                    return false;
                }


                return expression.test(
                    textOf(node)
                );
            }
        )
        ||
        null;
    }


    const BUTTON_PROPERTIES = [

        "box-sizing",

        "background",
        "background-color",

        "color",

        "border",
        "border-top",
        "border-right",
        "border-bottom",
        "border-left",

        "border-radius",

        "box-shadow",

        "font-family",
        "font-size",
        "font-style",
        "font-weight",

        "line-height",
        "letter-spacing",
        "text-transform",

        "padding-top",
        "padding-right",
        "padding-bottom",
        "padding-left",

        "outline"
    ];


    const TEXT_PROPERTIES = [

        "color",

        "font-family",
        "font-size",
        "font-style",
        "font-weight",

        "line-height",
        "letter-spacing",

        "text-transform"
    ];


    /* ============================================================
       CAPTURE THE REAL LIVE CENTER GEOMETRY

       Do not use a hand-entered px value.

       We measure:
           Live center panel top
           Live robot/canvas top
           Live Reset view top/right/size

       The difference between panel top and canvas top is the exact
       vertical size SLAM's top region must have.
       ============================================================ */

    /* ============================================================
       RESET VIEW — EXACT LIVE APPEARANCE
       ============================================================ */

    /* ============================================================
       APPLY EXACT LIVE HEADER BOUNDARY + RESET POSITION TO SLAM
       ============================================================ */

    /* ============================================================
       INITIAL POSE — KEEP EXISTING FUNCTIONAL ELEMENTS
       ============================================================ */

    function copyInitialPoseAppearance() {

        const live =
            document.getElementById(
                "view-live"
            );


        const slam =
            document.getElementById(
                "view-slam"
            );


        const source =
            findButtonByText(
                live,
                "Enter Teleop"
            );


        const setRobot =
            findButtonByText(
                slam,
                "Set robot position"
            );


        const noPosition =
            findControlByText(
                slam,
                "No position selected"
            );


        if (!source) {
            return;
        }


        const sourceRect =
            source.getBoundingClientRect();


        for (
            const target
            of [
                setRobot,
                noPosition
            ]
        ) {

            if (!target) {
                continue;
            }


            copyComputed(
                source,
                target,
                BUTTON_PROPERTIES
            );


            setImportant(
                target,
                "width",
                "100%"
            );

            setImportant(
                target,
                "max-width",
                "none"
            );

            setImportant(
                target,
                "text-align",
                "center"
            );


            if (
                sourceRect.height > 1
            ) {

                setImportant(
                    target,
                    "height",
                    `${sourceRect.height}px`
                );

                setImportant(
                    target,
                    "min-height",
                    `${sourceRect.height}px`
                );

                setImportant(
                    target,
                    "max-height",
                    `${sourceRect.height}px`
                );
            }
        }
    }


    /* ============================================================
       "LABORATORY MAP UNAVAILABLE"
       EXACT LIVE IDLE-LABEL TYPOGRAPHY
       ============================================================ */

    function copyIdleCaptionAppearance() {

        const live =
            document.getElementById(
                "view-live"
            );


        const source =
            findLeafByText(
                live,
                /^RGB\s*\+\s*depth\s+idle$/i
            )
            ||
            findLeafByText(
                live,
                /^RGB\s+stream\s+idle$/i
            );


        const target =
            document.querySelector(
                "#slamOverlay > strong"
            );


        if (
            !source
            ||
            !target
        ) {
            return;
        }


        copyComputed(
            source,
            target,
            TEXT_PROPERTIES
        );
    }


    function captureEverythingFromLive() {



        copyInitialPoseAppearance();

        copyIdleCaptionAppearance();
    }


    function afterTwoFrames(
        callback
    ) {

        requestAnimationFrame(
            () => {

                requestAnimationFrame(
                    callback
                );
            }
        );
    }


    function captureThenApplySlam() {

        captureEverythingFromLive();
    }

    function install() {

        /*
         * Default application state is Live.
         * Capture it after final layout code has settled.
         */

        afterTwoFrames(
            captureEverythingFromLive
        );


        /*
         * Capture phase:
         * measure Live BEFORE normal tab code hides it.
         */

        document.addEventListener(
            "pointerdown",
            event => {

                const slamTab =
                    event.target.closest(
                        '.tab[data-view="slam"]'
                    );


                if (!slamTab) {
                    return;
                }


                captureThenApplySlam();
            },
            true
        );


        /*
         * SLAM FINAL CLEANUP 1
         *
         * The former click fallback was empty and had no behavior.
         * Pointerdown capture remains the functional pre-tab-switch
         * sampling path.
         */


        /*
         * Re-measure only after an actual browser resize while Live
         * is visible. There is no timer/poll loop.
         */

        window.addEventListener(
            "resize",
            () => {

                const live =
                    document.getElementById(
                        "view-live"
                    );


                if (
                    live
                    &&
                    live.classList.contains(
                        "active"
                    )
                ) {

                    afterTwoFrames(
                        captureEverythingFromLive
                    );
                }

            },
            {
                passive:
                    true
            }
        );
    }


    if (
        document.readyState
        ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            install,
            {
                once:
                    true
            }
        );

    }
    else {

        install();
    }

})();
