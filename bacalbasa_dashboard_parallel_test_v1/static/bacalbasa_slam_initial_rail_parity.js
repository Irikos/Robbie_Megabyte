(() => {
    "use strict";

    const PREFIX =
        "g1Dashboard.bacaSlamMajorWidths.";

    function liveGeometry() {
        const liveGrid =
            document.querySelector(
                "#view-live .combined-live-grid"
            );

        const liveRail =
            document.querySelector(
                '#view-live [data-stitch-major-key="rail"]'
            )
            ||
            document.querySelector(
                "#view-live .combined-rail"
            );

        if (!liveGrid || !liveRail) {
            return null;
        }

        const gridRect =
            liveGrid.getBoundingClientRect();

        const railRect =
            liveRail.getBoundingClientRect();

        if (
            gridRect.width < 100
            ||
            railRect.width < 100
        ) {
            return null;
        }

        return {
            total: gridRect.width,
            rail: railRect.width,
            ratio: railRect.width / gridRect.width
        };
    }


    function applyParity() {
        const g =
            liveGeometry();

        const slam =
            document.getElementById(
                "view-slam"
            );

        const layout =
            slam?.querySelector(
                ".slam-layout"
            );

        if (!g || !slam || !layout) {
            return false;
        }


        /*
         * Exact pixel parity with the CURRENT Live rail.
         */

        slam.style.setProperty(
            "--slam-live-rail-width-v2207",
            `${g.rail}px`
        );

        layout.style.setProperty(
            "grid-template-columns",
            `minmax(0, 1fr) ${g.rail}px`,
            "important"
        );


        /*
         * Also replace every existing SLAM-width persistence entry
         * so the resize owner cannot immediately restore an older
         * mismatched width.
         */

        const saved =
            JSON.stringify({
                world: 1 - g.ratio,
                rail: g.ratio
            });

        const keys = [];

        for (
            let i = 0;
            i < localStorage.length;
            i++
        ) {
            const key =
                localStorage.key(i);

            if (
                key
                &&
                key.startsWith(PREFIX)
            ) {
                keys.push(key);
            }
        }

        /*
         * Known namespaces are also created when absent.
         */

        keys.push(
            "g1Dashboard.bacaSlamMajorWidths.clean1",
            "g1Dashboard.bacaSlamMajorWidths.v2210r1"
        );

        for (
            const key
            of new Set(keys)
        ) {
            localStorage.setItem(
                key,
                saved
            );
        }

        return true;
    }


    function schedule() {
        requestAnimationFrame(
            () => requestAnimationFrame(
                applyParity
            )
        );
    }


    window.addEventListener(
        "load",
        schedule,
        {once:true}
    );


    /*
     * Run once more when SLAM is first opened.
     * This lets any older SLAM initialization finish first.
     */

    document.addEventListener(
        "click",
        event => {

            if (
                !event.target.closest(
                    '[data-view="slam"]'
                )
            ) {
                return;
            }

            schedule();
        },
        true
    );
})();
