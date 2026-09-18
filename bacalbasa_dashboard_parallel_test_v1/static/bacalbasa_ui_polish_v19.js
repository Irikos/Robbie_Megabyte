(() => {
    "use strict";

    const $ = id => document.getElementById(id);

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


    /*
     * Dispatch directly to the already-existing V18/app
     * controls. Their visual presentation is hidden, but
     * their tested functionality remains intact.
     */
    function triggerExisting(id) {
        const button = $(id);

        if (!button) {
            console.error(
                `Missing underlying controller button: ${id}`
            );
            return;
        }

        button.dispatchEvent(
            new MouseEvent(
                "click",
                {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                }
            )
        );
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


    function setButton(id, enabled, tone) {
        const button = $(id);

        if (!button) {
            return;
        }

        button.disabled = !enabled;

        button.dataset.enabled =
            enabled ? "true" : "false";

        button.dataset.tone =
            enabled ? tone : "off";

        button.setAttribute(
            "aria-disabled",
            enabled ? "false" : "true"
        );
    }


    function renderController() {
        const state =
            controller?.state || "UNAVAILABLE";

        const stopped =
            state === "STOPPED";

        const running =
            state === "RUNNING";

        const handover =
            xrHandover();


        /*
         * INITIAL STATE:
         *
         * Settings   YES
         * Configure  YES
         * Stop       NO
         * Enter      NO
         * Exit       NO
         */
        setButton(
            "bacaSettingsV19",
            stopped,
            "neutral"
        );

        setButton(
            "bacaConfigureV19",
            stopped
            && controller?.can_start === true,
            "go"
        );

        setButton(
            "bacaStopV19",
            running
            && controller?.can_stop === true,
            "stop"
        );


        /*
         * Enter cannot become active merely because
         * the page loaded.
         *
         * Listener must actually be RUNNING and the
         * controller must explicitly report REQUEST_XR.
         */
        setButton(
            "bacaEnterV19",
            running
            && handover?.available === true
            && handover?.operation === "REQUEST_XR",
            "go"
        );


        /*
         * Exit only while XR is actually owned.
         */
        setButton(
            "bacaExitV19",
            running
            && handover?.available === true
            && handover?.operation === "HAND_BACK_ARMS",
            "stop"
        );
    }


    function installController() {
        if ($("bacaControllerV19")) {
            return;
        }

        const panel =
            document.querySelector(
                ".controller-process-panel"
            );

        if (!panel) {
            return;
        }


        const oldActions =
            panel.querySelector(
                ".controller-process-actions"
            );


        const oldXr =
            $("controllerXrSwitchV16");


        if (oldActions) {
            oldActions.classList.add(
                "baca-old-controller-hidden-v19"
            );
        }


        if (oldXr) {
            oldXr.classList.add(
                "baca-old-controller-hidden-v19"
            );
        }


        const ui =
            document.createElement("div");

        ui.id =
            "bacaControllerV19";

        ui.className =
            "baca-controller-v19";


        ui.innerHTML = `
          <div class="baca-controller-process-row-v19">

            <button
              id="bacaSettingsV19"
              class="baca-settings-v19"
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

            <div class="baca-switch-v19">
              <button
                id="bacaConfigureV19"
                class="baca-segment-v19 baca-go-v19"
                type="button"
              >Configure</button>

              <button
                id="bacaStopV19"
                class="baca-segment-v19 baca-stop-v19"
                type="button"
              >Stop</button>
            </div>

          </div>

          <div class="baca-controller-xr-row-v19">

            <div class="baca-switch-v19">
              <button
                id="bacaEnterV19"
                class="baca-segment-v19 baca-go-v19"
                type="button"
              >Enter Teleop</button>

              <button
                id="bacaExitV19"
                class="baca-segment-v19 baca-stop-v19"
                type="button"
              >Exit Teleop</button>
            </div>

          </div>
        `;


        if (oldActions) {
            oldActions.insertAdjacentElement(
                "beforebegin",
                ui
            );
        }
        else {
            panel.appendChild(ui);
        }


        $("bacaSettingsV19")
            .addEventListener(
                "click",
                () => {
                    if (
                        controller?.state === "STOPPED"
                    ) {
                        triggerExisting(
                            "controllerSettingsBtn"
                        );
                    }
                }
            );


        $("bacaConfigureV19")
            .addEventListener(
                "click",
                () => {
                    if (
                        controller?.state === "STOPPED"
                        &&
                        controller?.can_start === true
                    ) {
                        triggerExisting(
                            "controllerConfigureBtn"
                        );
                    }
                }
            );


        $("bacaStopV19")
            .addEventListener(
                "click",
                () => {
                    if (
                        controller?.state === "RUNNING"
                        &&
                        controller?.can_stop === true
                    ) {
                        triggerExisting(
                            "controllerStopBtn"
                        );
                    }
                }
            );


        $("bacaEnterV19")
            .addEventListener(
                "click",
                () => {
                    const h = xrHandover();

                    if (
                        controller?.state === "RUNNING"
                        &&
                        h?.available === true
                        &&
                        h?.operation === "REQUEST_XR"
                    ) {
                        triggerExisting(
                            "bacaEnterTeleopBtn"
                        );
                    }
                }
            );


        $("bacaExitV19")
            .addEventListener(
                "click",
                () => {
                    const h = xrHandover();

                    if (
                        controller?.state === "RUNNING"
                        &&
                        h?.available === true
                        &&
                        h?.operation === "HAND_BACK_ARMS"
                    ) {
                        triggerExisting(
                            "bacaExitTeleopBtn"
                        );
                    }
                }
            );


        renderController();
    }


    let bacaNoOverlap_pollController = false;

    async function pollController() {
        if (bacaNoOverlap_pollController) return;
        bacaNoOverlap_pollController = true;
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


            renderController();
        } finally {
            bacaNoOverlap_pollController = false;
        }
    }


    /* ========================================================
       BATTERY
       ======================================================== */

    function installBattery() {
        if ($("bacaBatteryV19")) {
            return;
        }

        const topbar =
            document.querySelector(
                "header.topbar"
            )
            ||
            document.querySelector(
                ".topbar"
            );

        if (!topbar) {
            return;
        }


        const battery =
            document.createElement("div");

        battery.id =
            "bacaBatteryV19";

        battery.className =
            "baca-battery-v19";

        battery.title =
            "Robot battery";


        battery.innerHTML = `
          <span class="baca-battery-body-v19">
            <i id="bacaBatteryFillV19"></i>
          </span>

          <strong id="bacaBatteryTextV19">
            —%
          </strong>
        `;


        topbar.appendChild(
            battery
        );
    }


    function validPercent(value) {
        const n =
            Number(value);

        return (
            Number.isFinite(n)
            &&
            n >= 0
            &&
            n <= 100
        )
            ? n
            : null;
    }


    function findBattery(
        object,
        path="",
        depth=0
    ) {
        if (
            !object
            ||
            typeof object !== "object"
            ||
            depth > 9
        ) {
            return null;
        }


        for (
            const [key,value]
            of Object.entries(object)
        ) {
            const lower =
                String(key)
                .toLowerCase();

            const next =
                `${path}/${lower}`;


            const candidate =
                (
                    lower === "soc"
                    ||
                    lower === "battery_soc"
                    ||
                    lower === "battery_percent"
                    ||
                    lower === "battery_percentage"
                    ||
                    lower === "bms_soc"
                );


            const batteryContext =
                (
                    next.includes("battery")
                    ||
                    next.includes("bms")
                );


            if (
                candidate
                &&
                batteryContext
            ) {
                const n =
                    validPercent(value);

                if (n !== null) {
                    return n;
                }
            }


            const nested =
                findBattery(
                    value,
                    next,
                    depth + 1
                );


            if (nested !== null) {
                return nested;
            }
        }


        return null;
    }


    function renderBattery(percent) {
        const root =
            $("bacaBatteryV19");

        const fill =
            $("bacaBatteryFillV19");

        const text =
            $("bacaBatteryTextV19");

        if (
            !root
            ||
            !fill
            ||
            !text
        ) {
            return;
        }


        if (percent === null) {
            root.dataset.tone =
                "unknown";

            fill.style.width =
                "0%";

            text.textContent =
                "—%";

            return;
        }


        const p =
            Math.max(
                0,
                Math.min(
                    100,
                    Math.round(percent)
                )
            );


        fill.style.width =
            `${p}%`;


        text.textContent =
            `${p}%`;


        root.dataset.tone =
            p <= 15
            ? "critical"
            : p <= 30
              ? "low"
              : "good";
    }


    let bacaNoOverlap_pollBattery = false;

    async function pollBattery() {
        if (bacaNoOverlap_pollBattery) return;
        bacaNoOverlap_pollBattery = true;
        try {
            let percent = null;

            try {
                const data =
                    await getJson(
                        "/api/latest"
                    );

                percent =
                    findBattery(data);
            }
            catch {}


            if (percent === null) {
                try {
                    const system =
                        await getJson(
                            "/api/system"
                        );

                    percent =
                        findBattery(system);
                }
                catch {}
            }


            renderBattery(percent);
        } finally {
            bacaNoOverlap_pollBattery = false;
        }
    }


    function install() {
        installController();
        installBattery();

        pollController();
        pollBattery();

        window.setInterval(
            pollController,
            500
        );

        window.setInterval(
            pollBattery,
            1500
        );
    }


    if (
        document.readyState === "loading"
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
