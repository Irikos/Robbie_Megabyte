(() => {
    "use strict";

    const $ = id =>
        document.getElementById(id);

    let controller = {};
    let latest = {};


    async function getJson(path) {
        const sharedPaths = ["/api/controller", "/api/latest", "/api/system"];
        const share = sharedPaths.includes(path);
        const pending = window.bacaPendingTelemetryReads
            || (window.bacaPendingTelemetryReads = new Map());

        if (!share) {
            const response = await fetch(path, {
                cache: "no-store",
                credentials: "same-origin"
            });
            if (!response.ok) {
                throw new Error(`${path}: HTTP ${response.status}`);
            }
            return response.json();
        }

        let request = pending.get(path);
        if (!request) {
            request = (async () => {
                const response = await fetch(path, {
                    cache: "no-store",
                    credentials: "same-origin"
                });
                if (!response.ok) {
                    throw new Error(`${path}: HTTP ${response.status}`);
                }
                return response.json();
            })();
            pending.set(path, request);
        }

        try {
            // Each consumer receives its own copy.
            return JSON.parse(JSON.stringify(await request));
        } finally {
            if (pending.get(path) === request) pending.delete(path);
        }
    }


    /* ========================================================
       XR

       Desired presentation:

       controller stopped
           Xr —

       V1.8 running, before ENTER TELEOP
           Xr OK / BAD

       XR_ACTIVE
           Xr OK / BAD

       XR_TRACKING_HOLD
           Xr HOLD

       This uses the controller's real health.xr data.
       ======================================================== */

    function renderXr() {

        const element =
            $("xrValue");


        if (!element) {
            return;
        }


        element.classList.remove(
            "good",
            "warn",
            "bad"
        );


        const running =
            controller?.state
            === "RUNNING";


        if (!running) {

            element.textContent =
                "—";

            return;
        }


        const telemetry =
            latest?.telemetry;


        if (!telemetry) {

            element.textContent =
                "—";

            return;
        }


        const mode =
            telemetry?.mode?.state;


        /*
         * Preserve the semantic requested earlier:
         * tracking hold is shown explicitly as HOLD.
         */
        if (
            mode === "XR_TRACKING_HOLD"
        ) {

            element.textContent =
                "HOLD";

            element.classList.add(
                "warn"
            );

            return;
        }


        const xr =
            telemetry?.health?.xr;


        if (
            typeof xr?.ok
            !== "boolean"
        ) {

            element.textContent =
                "—";

            return;
        }


        if (xr.ok) {

            element.textContent =
                "OK";

            element.classList.add(
                "good"
            );

        }
        else {

            element.textContent =
                "BAD";

            element.classList.add(
                "warn"
            );
        }
    }


    /* ========================================================
       HANDS

       The telemetry packet can remain cached briefly after the
       V1.8 process stops.

       Do not show that stale command/feedback as though the
       listener were still active.

       STOPPED/STOPPING/UNAVAILABLE:
           reset visual matrix to refresh-style placeholders.
       ======================================================== */

    function clearHands() {

        const body =
            $("handMatrixBody");


        if (!body) {
            return;
        }


        body
            .querySelectorAll(
                ".hand-command-fill"
            )
            .forEach(
                fill => {
                    fill.style.width =
                        "0%";
                }
            );


        body
            .querySelectorAll(
                ".hand-feedback-marker"
            )
            .forEach(
                marker => {
                    marker.style.display =
                        "none";
                }
            );


        body
            .querySelectorAll(
                ".hand-readout strong"
            )
            .forEach(
                value => {
                    value.textContent =
                        "—";
                }
            );


        body
            .querySelectorAll(
                ".hand-readout em"
            )
            .forEach(
                value => {
                    value.textContent =
                        "—";
                }
            );
    }


    function renderHandsLifecycle() {

        if (
            controller?.state
            === "RUNNING"
        ) {

            /*
             * app.js owns live hand rendering while V1.8 runs.
             * Do not interfere with it.
             */
            return;
        }


        clearHands();
    }


    function render() {
        renderXr();
        // BACA_HANDS_POINT_FIX_V1
        // app.js exclusively owns hand values and placeholders.
    }


    let bacaNoOverlap_poll = false;

    async function poll() {
        if (bacaNoOverlap_poll) return;
        bacaNoOverlap_poll = true;
        try {

            try {

                controller =
                    await getJson(
                        "/api/controller"
                    );

            }
            catch {

                controller =
                    {};
            }


            try {

                latest =
                    await getJson(
                        "/api/latest"
                    );

            }
            catch {

                latest =
                    {};
            }


            render();
        } finally {
            bacaNoOverlap_poll = false;
        }
    }


    function start() {
        // BACA_FAST_HANDS_XR_V2
        // app.js owns XR presentation and hand values.
        // No separate presentation polling is needed.
    }


    if (
        document.readyState
        === "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            start,
            {
                once:
                    true,
            }
        );

    }
    else {

        start();
    }

})();
