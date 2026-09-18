(() => {
    "use strict";

    /*
     * CAMERA TELEOP INTEGRATION V1.6
     *
     * IMPORTANT:
     *
     * This does NOT replace:
     *   - D7H window drag/reorder
     *   - D15 dock behavior
     *   - D15K / D15L major-surface reorder
     *   - Start / Stop handlers
     *   - camera pipeline API calls
     *
     * It owns only:
     *   - embedded single-row geometry
     *   - prevention of accidental native browser drag previews
     *   - visual Start / Stop switch presentation
     *   - final geometry stabilization after existing drag systems move
     */


    const BODY_CLASS =
        "baca-camera-v16";



    /* ============================================================
       HELPERS
       ============================================================ */


    function important(
        element,
        property,
        value
    ) {

        if (!element) {
            return;
        }


        element.style.setProperty(
            property,
            value,
            "important"
        );
    }


    function afterFrames(
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


    /* ============================================================
       SINGLE-ROW EMBEDDED GEOMETRY
       ============================================================ */


    function enforceGeometry() {

        document.body.classList.add(
            BODY_CLASS
        );


        const topbar =
            document.querySelector(
                ".topbar"
            );


        const shell =
            document.querySelector(
                ".app-shell"
            );


        const sidebar =
            document.querySelector(
                ".sidebar"
            );


        const main =
            document.querySelector(
                ".main"
            );


        const dock =
            document.getElementById(
                "d15WindowDock"
            )
            ||
            document.querySelector(
                ".d15-window-dock"
            );


        /*
         * Inner Camera Teleoperation header stays completely gone.
         */

        if (topbar) {

            topbar.hidden =
                true;


            important(
                topbar,
                "display",
                "none"
            );


            important(
                topbar,
                "height",
                "0px"
            );


            important(
                topbar,
                "min-height",
                "0px"
            );
        }


        /*
         * There is now ONE dashboard row.
         *
         * D15K/D15L may continue changing:
         *   grid-template-columns
         *   grid-column
         *   transforms
         *
         * We deliberately do NOT touch any of those here.
         */

        important(
            shell,
            "grid-template-rows",
            "minmax(0, 1fr)"
        );


        important(
            shell,
            "row-gap",
            "0px"
        );


        important(
            shell,
            "height",
            "100%"
        );


        important(
            shell,
            "min-height",
            "0px"
        );


        for (
            const surface
            of
            [
                sidebar,
                main,
                dock
            ]
        ) {

            important(
                surface,
                "grid-row",
                "1"
            );


            important(
                surface,
                "height",
                "100%"
            );


            important(
                surface,
                "min-height",
                "0px"
            );


            important(
                surface,
                "margin-top",
                "0px"
            );


            important(
                surface,
                "align-self",
                "stretch"
            );
        }


        const live =
            document.getElementById(
                "view-live"
            );


        important(
            live,
            "height",
            "100%"
        );


        important(
            live,
            "min-height",
            "0px"
        );


        const workspace =
            document.getElementById(
                "mediaWorkspace"
            );


        if (
            workspace
            &&
            !workspace.classList.contains(
                "d15f-maximized-workspace"
            )
        ) {

            important(
                workspace,
                "height",
                "100%"
            );


            important(
                workspace,
                "min-height",
                "0px"
            );
        }
    }


    /* ============================================================
       PREVENT NATIVE BROWSER DRAG GHOSTS

       Existing Bacalbasa movement is pointer-event based.
       Native HTML drag is not part of D7H/D15.
       ============================================================ */


    function disableNativeDrag() {

        const selectors = [
            ".d15k-left-rail-handle",
            ".d15-dock-grip",
            ".workspace-tile-header",
            ".panel-header",
            ".camera-feed-label"
        ];


        document
            .querySelectorAll(
                selectors.join(",")
            )
            .forEach(
                element => {

                    element.setAttribute(
                        "draggable",
                        "false"
                    );
                }
            );
    }


    document.addEventListener(
        "dragstart",
        event => {

            if (
                event.target.closest(
                    [
                        ".d15k-left-rail-handle",
                        ".d15-dock-grip",
                        ".workspace-tile-header",
                        ".panel-header",
                        ".camera-feed-label"
                    ].join(",")
                )
            ) {

                event.preventDefault();
            }
        },
        true
    );


    /* ============================================================
       START / STOP

       Presentation is intentionally NOT owned here anymore.
       The original functional handlers remain elsewhere.
       ============================================================ */


    /* ============================================================
       BOOT
       ============================================================ */


    function apply() {

        enforceGeometry();

        disableNativeDrag();
    }


    function boot() {

        apply();


        afterFrames(
            apply
        );


        setTimeout(
            apply,
            120
        );


        setTimeout(
            apply,
            500
        );


        setTimeout(
            apply,
            1200
        );
    }


    if (
        document.readyState ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            boot,
            {
                once:
                    true
            }
        );

    } else {

        boot();
    }


    window.addEventListener(
        "load",
        boot,
        {
            once:
                true
        }
    );

})();
