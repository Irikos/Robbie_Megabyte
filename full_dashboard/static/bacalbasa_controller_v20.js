(() => {
    "use strict";

    const $ = id =>
        document.getElementById(id);

    let controller = {};
    let latest = {};


    /* ========================================================
       STATE
       ======================================================== */

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


    function xrHandover() {
        return (
            latest?.telemetry?.actions?.xr_handover
            ||
            latest?.actions?.xr_handover
            ||
            {}
        );
    }


    /*
     * We retain the already-tested underlying controller
     * handlers from app.js/V16.
     *
     * They are visually hidden by V20, but V20 can trigger
     * them after independently checking the real backend state.
     */
    function triggerUnderlying(id) {
        const button = $(id);

        if (!button) {
            console.error(
                `V20 missing underlying control: ${id}`
            );
            return;
        }

        /*
         * Old presentation layers may have incorrectly written
         * disabled=true. V20 has already validated the backend
         * transition itself, so temporarily clear it.
         */
        const wasDisabled =
            button.disabled;

        button.disabled =
            false;

        try {
            button.click();
        }
        finally {
            button.disabled =
                wasDisabled;
        }
    }


    /* ========================================================
       NEW CONTROLLER DOM
       ======================================================== */

    function installController() {
        if ($("bacaControllerV20")) {
            return;
        }


        const panel =
            document.querySelector(
                ".controller-process-panel"
            );

        if (!panel) {
            return;
        }


        /*
         * Remove a V19 runtime component if it already exists
         * in the current document before V20 was loaded.
         */
        $("bacaControllerV19")
            ?.remove();


        const root =
            document.createElement(
                "div"
            );

        root.id =
            "bacaControllerV20";

        root.className =
            "baca-controller-v20";


        root.innerHTML = `
          <div class="baca-controller-process-v20">

            <button
              id="bacaSettingsV20"
              class="baca-settings-v20"
              type="button"
              title="Controller settings"
              aria-label="Controller settings"
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="
                  M9.5 3.5
                  10.1 2h3.8l.6 1.5
                  1.6.7 1.5-.6
                  2.7 2.7-.6 1.5
                  .7 1.6 1.5.6v3.8
                  l-1.5.6-.7 1.6.6 1.5
                  -2.7 2.7-1.5-.6
                  -1.6.7-.6 1.5h-3.8
                  l-.6-1.5-1.6-.7-1.5.6
                  -2.7-2.7.6-1.5-.7-1.6
                  -1.5-.6v-3.8l1.5-.6
                  .7-1.6-.6-1.5
                  L6.4 3.6l1.5.6 1.6-.7Z
                "/>
                <circle cx="12" cy="12" r="3.1"/>
              </svg>
            </button>


            <div
              id="bacaProcessSwitchV20"
              class="baca-switch-v20 baca-process-switch-v20"
            >
              <button
                id="bacaConfigureV20"
                class="baca-segment-v20 baca-connect-v20"
                type="button"
              >
                Configure
              </button>

              <button
                id="bacaStopV20"
                class="baca-segment-v20 baca-disconnect-v20"
                type="button"
              >
                Stop
              </button>
            </div>

          </div>


          <div
            id="bacaXrSwitchV20"
            class="baca-switch-v20 baca-xr-switch-v20"
          >
            <button
              id="bacaEnterV20"
              class="baca-segment-v20 baca-connect-v20"
              type="button"
            >
              Enter Teleop
            </button>

            <button
              id="bacaExitV20"
              class="baca-segment-v20 baca-disconnect-v20"
              type="button"
            >
              Exit Teleop
            </button>
          </div>
        `;


        /*
         * Put it directly into the Controller Process panel.
         * CSS hides every previous generation.
         */
        panel.appendChild(
            root
        );


        $("bacaSettingsV20")
            .addEventListener(
                "click",
                () => {
                    if (
                        controller?.state
                        !== "STOPPED"
                    ) {
                        return;
                    }

                    triggerUnderlying(
                        "controllerSettingsBtn"
                    );
                }
            );


        $("bacaConfigureV20")
            .addEventListener(
                "click",
                () => {
                    if (
                        controller?.state
                        !== "STOPPED"
                        ||
                        controller?.can_start
                        !== true
                    ) {
                        return;
                    }

                    triggerUnderlying(
                        "controllerConfigureBtn"
                    );
                }
            );


        $("bacaStopV20")
            .addEventListener(
                "click",
                () => {
                    if (
                        controller?.state
                        !== "RUNNING"
                        ||
                        controller?.can_stop
                        !== true
                    ) {
                        return;
                    }

                    triggerUnderlying(
                        "controllerStopBtn"
                    );
                }
            );


        $("bacaEnterV20")
            .addEventListener(
                "click",
                () => {
                    const handover =
                        xrHandover();

                    if (
                        controller?.state
                        !== "RUNNING"
                        ||
                        handover?.available
                        !== true
                        ||
                        handover?.operation
                        !== "REQUEST_XR"
                    ) {
                        return;
                    }

                    triggerUnderlying(
                        "bacaEnterTeleopBtn"
                    );
                }
            );


        $("bacaExitV20")
            .addEventListener(
                "click",
                () => {
                    const handover =
                        xrHandover();

                    if (
                        controller?.state
                        !== "RUNNING"
                        ||
                        handover?.available
                        !== true
                        ||
                        handover?.operation
                        !== "HAND_BACK_ARMS"
                    ) {
                        return;
                    }

                    triggerUnderlying(
                        "bacaExitTeleopBtn"
                    );
                }
            );
    }


    /* ========================================================
       PAINT STATE
       ======================================================== */

    function setState(
        id,
        enabled,
        side
    ) {
        const button = $(id);

        if (!button) {
            return;
        }

        button.disabled =
            !enabled;

        button.dataset.state =
            enabled
            ? side
            : "off";

        button.setAttribute(
            "aria-disabled",
            enabled
            ? "false"
            : "true"
        );
    }


    function render() {
        const state =
            controller?.state
            || "UNAVAILABLE";


        const stopped =
            state === "STOPPED";


        const running =
            state === "RUNNING";


        /*
         * Exactly one process-side action:
         *
         * STOPPED = Configure
         * RUNNING = Stop
         */
        const configure =
            stopped
            && controller?.can_start === true;


        const stop =
            running
            && controller?.can_stop === true;


        setState(
            "bacaConfigureV20",
            configure,
            "connect"
        );


        setState(
            "bacaStopV20",
            stop,
            "disconnect"
        );


        /*
         * Gear only while stopped.
         */
        const settings =
            $("bacaSettingsV20");

        if (settings) {
            settings.disabled =
                !stopped;

            settings.dataset.state =
                stopped
                ? "on"
                : "off";
        }


        /*
         * XR switch:
         *
         * STOPPED => neither
         * REQUEST_XR => Enter only
         * HAND_BACK_ARMS => Exit only
         */
        const handover =
            xrHandover();


        const enter =
            running
            &&
            handover?.available === true
            &&
            handover?.operation
            === "REQUEST_XR";


        const exit =
            running
            &&
            handover?.available === true
            &&
            handover?.operation
            === "HAND_BACK_ARMS";


        setState(
            "bacaEnterV20",
            enter,
            "connect"
        );


        setState(
            "bacaExitV20",
            exit,
            "disconnect"
        );
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
                controller = {};
            }


            try {
                latest =
                    await getJson(
                        "/api/latest"
                    );
            }
            catch {
                latest = {};
            }


            render();
        } finally {
            bacaNoOverlap_poll = false;
        }
    }


    function install() {
        installController();

        poll();

        window.setInterval(
            poll,
            400
        );
    }


    if (
        document.readyState
        === "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            install,
            {
                once: true,
            }
        );
    }
    else {
        install();
    }
})();
