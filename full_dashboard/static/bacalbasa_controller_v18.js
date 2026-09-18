(() => {
    "use strict";

    const $ = id =>
        document.getElementById(id);

    const SETTINGS_KEY =
        "g1FullDashControllerParametersV18";

    const LEGACY_SETTINGS_KEY =
        "g1FullDashControllerParametersV16";

    let busy = false;
    let lastController = {};
    let lastActions = {};
    let modalPreviouslyOpen = false;


    /* ========================================================
       NETWORK
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


    async function ensureTrustedSession() {
        const response =
            await fetch(
                "/api/session/bootstrap",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json",
                    },

                    body: "{}",

                    cache: "no-store",
                    credentials: "same-origin",
                }
            );

        if (!response.ok) {
            throw new Error(
                `trusted session HTTP ${response.status}`
            );
        }
    }


    async function postJson(
        path,
        payload,
        retry=true
    ) {
        await ensureTrustedSession();

        const response =
            await fetch(
                path,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json",
                    },

                    body:
                        JSON.stringify(
                            payload || {}
                        ),

                    credentials: "same-origin",
                }
            );


        if (
            response.status === 401
            && retry
        ) {
            await ensureTrustedSession();

            return postJson(
                path,
                payload,
                false
            );
        }


        let body = {};

        try {
            body =
                await response.json();
        } catch {}


        if (!response.ok) {
            throw new Error(
                body.error
                || `HTTP ${response.status}`
            );
        }

        return body;
    }


    /* ========================================================
       SETTINGS
       ======================================================== */

    function readSavedSettings() {
        for (
            const key
            of [
                SETTINGS_KEY,
                LEGACY_SETTINGS_KEY,
            ]
        ) {
            try {
                const raw =
                    localStorage.getItem(
                        key
                    );

                if (!raw) {
                    continue;
                }

                const value =
                    JSON.parse(raw);

                if (
                    value
                    && typeof value === "object"
                ) {
                    return value;
                }
            } catch {}
        }

        return {};
    }


    function normalizedValue(
        spec,
        raw
    ) {
        if (spec.type === "bool") {
            return !!raw;
        }

        const value =
            Number(raw);

        if (!Number.isFinite(value)) {
            return spec.default;
        }

        if (spec.type === "int") {
            return Math.round(value);
        }

        return value;
    }


    function launchParameters(
        cfg
    ) {
        const saved =
            readSavedSettings();

        const result = {};

        for (
            const spec
            of cfg.parameter_specs || []
        ) {
            const fallback =
                cfg.known_good?.[spec.name]
                ?? spec.default;

            const raw =
                Object.prototype
                .hasOwnProperty.call(
                    saved,
                    spec.name
                )
                ? saved[spec.name]
                : fallback;

            result[spec.name] =
                normalizedValue(
                    spec,
                    raw
                );
        }

        return result;
    }


    function setField(
        spec,
        value
    ) {
        const input =
            $(
                `controller-param-${spec.name}`
            );

        if (!input) {
            return;
        }


        if (spec.type === "bool") {
            input.checked =
                !!value;

            input.dispatchEvent(
                new Event(
                    "change",
                    {
                        bubbles: true,
                    }
                )
            );

            return;
        }


        input.value =
            String(value);

        const range =
            $(
                `controller-range-${spec.name}`
            );

        if (range) {
            range.value =
                String(value);
        }


        input.dispatchEvent(
            new Event(
                "input",
                {
                    bubbles: true,
                }
            )
        );
    }


    async function waitForSettingsForm() {
        for (
            let i=0;
            i<30;
            i++
        ) {
            if (
                document.querySelector(
                    '[id^="controller-param-"]'
                )
            ) {
                return true;
            }

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        50
                    )
            );
        }

        return false;
    }


    async function applySavedSettings() {
        const ready =
            await waitForSettingsForm();

        if (!ready) {
            return;
        }

        const cfg =
            await getJson(
                "/api/controller/config"
            );

        const saved =
            readSavedSettings();

        for (
            const spec
            of cfg.parameter_specs || []
        ) {
            if (
                Object.prototype
                .hasOwnProperty.call(
                    saved,
                    spec.name
                )
            ) {
                setField(
                    spec,
                    saved[spec.name]
                );
            }
        }
    }


    async function resetToDefaults() {
        const cfg =
            await getJson(
                "/api/controller/config"
            );

        for (
            const spec
            of cfg.parameter_specs || []
        ) {
            setField(
                spec,
                spec.default
            );
        }
    }


    async function saveSettings() {
        if (
            lastController.state !== "STOPPED"
        ) {
            return;
        }

        const cfg =
            await getJson(
                "/api/controller/config"
            );

        const result = {};

        for (
            const spec
            of cfg.parameter_specs || []
        ) {
            const input =
                $(
                    `controller-param-${spec.name}`
                );

            if (!input) {
                continue;
            }

            result[spec.name] =
                spec.type === "bool"
                ? !!input.checked
                : normalizedValue(
                    spec,
                    input.value
                );
        }


        localStorage.setItem(
            SETTINGS_KEY,
            JSON.stringify(result)
        );

        /*
         * Mirror into the old V16 key during
         * validation so no previous path can
         * disagree with the new saved values.
         */
        localStorage.setItem(
            LEGACY_SETTINGS_KEY,
            JSON.stringify(result)
        );


        closeSettings();
    }


    function closeSettings() {
        const modal =
            $("controllerModal");

        if (!modal) {
            return;
        }

        modal.classList.add(
            "hidden"
        );

        document.body.classList.remove(
            "modal-open"
        );
    }


    /* ========================================================
       DIRECT PROCESS ACTIONS
       ======================================================== */

    async function startController() {
        if (
            busy
            || lastController.state !== "STOPPED"
            || lastController.can_start !== true
        ) {
            return;
        }

        busy = true;
        applyButtonState();

        try {
            const cfg =
                await getJson(
                    "/api/controller/config"
                );

            const parameters =
                launchParameters(
                    cfg
                );

            await postJson(
                "/api/controller/start",
                {
                    parameters,
                }
            );

            await refreshState();

        } catch (error) {
            window.alert(
                "Controller start failed: "
                + (
                    error?.message
                    || String(error)
                )
            );

        } finally {
            busy = false;
            applyButtonState();
        }
    }


    async function stopController() {
        if (
            busy
            || lastController.state !== "RUNNING"
            || lastController.can_stop !== true
        ) {
            return;
        }


        if (
            !window.confirm(
                "Request controlled teleop listener stop?"
            )
        ) {
            return;
        }


        busy = true;
        applyButtonState();

        try {
            await postJson(
                "/api/controller/stop",
                {}
            );

            await refreshState();

        } catch (error) {
            window.alert(
                "Controller stop failed: "
                + (
                    error?.message
                    || String(error)
                )
            );

        } finally {
            busy = false;
            applyButtonState();
        }
    }


    async function requestXr(
        operation
    ) {
        if (
            busy
            || lastController.state !== "RUNNING"
        ) {
            return;
        }


        const handover =
            lastActions.xr_handover
            || {};

        if (
            handover.available !== true
            || handover.operation !== operation
        ) {
            return;
        }


        busy = true;
        applyButtonState();

        try {
            await postJson(
                "/api/controller/action",
                {
                    operation,
                }
            );

            await refreshState();

        } catch (error) {
            window.alert(
                "Teleop request failed: "
                + (
                    error?.message
                    || String(error)
                )
            );

        } finally {
            busy = false;
            applyButtonState();
        }
    }


    /* ========================================================
       REMOVE OLD BUTTON OWNERS
       ======================================================== */

    function replaceButton(
        id,
        handler
    ) {
        const old =
            $(id);

        if (!old) {
            return null;
        }

        if (
            old.dataset
            .bacalbasaV18 === "1"
        ) {
            return old;
        }

        const fresh =
            old.cloneNode(true);

        fresh.dataset
            .bacalbasaV18 = "1";

        old.replaceWith(
            fresh
        );

        fresh.addEventListener(
            "click",
            handler
        );

        return fresh;
    }


    function ownActionButtons() {
        replaceButton(
            "controllerConfigureBtn",
            startController
        );

        replaceButton(
            "controllerStopBtn",
            stopController
        );

        replaceButton(
            "bacaEnterTeleopBtn",
            () =>
                requestXr(
                    "REQUEST_XR"
                )
        );

        replaceButton(
            "bacaExitTeleopBtn",
            () =>
                requestXr(
                    "HAND_BACK_ARMS"
                )
        );
    }


    function ownSettingsButtons() {
        const reset =
            $("controllerResetDefaultsBtn");

        if (
            reset
            && reset.dataset
                .bacalbasaV18 !== "1"
        ) {
            reset.dataset
                .bacalbasaV18 = "1";

            reset.textContent =
                "Reset to default";

            reset.addEventListener(
                "click",
                event => {
                    event.preventDefault();
                    event.stopImmediatePropagation();

                    resetToDefaults()
                    .catch(console.error);
                },
                true
            );
        }


        const save =
            $("controllerStartBtn");

        if (
            save
            && save.dataset
                .bacalbasaV18 !== "1"
        ) {
            const fresh =
                save.cloneNode(true);

            fresh.dataset
                .bacalbasaV18 = "1";

            fresh.textContent =
                "Save";

            save.replaceWith(
                fresh
            );

            fresh.addEventListener(
                "click",
                event => {
                    event.preventDefault();

                    saveSettings()
                    .catch(
                        error =>
                            window.alert(
                                "Could not save settings: "
                                + (
                                    error?.message
                                    || String(error)
                                )
                            )
                    );
                }
            );
        }
    }


    /* ========================================================
       SETTINGS PRESENTATION
       ======================================================== */

    function cleanSettingsModal() {
        const modal =
            $("controllerModal");

        if (!modal) {
            return;
        }


        const title =
            $("controllerModalTitle");

        if (title) {
            title.textContent =
                "Controller settings";
        }


        const hide = selector => {
            modal
            .querySelectorAll(
                selector
            )
            .forEach(
                element => {
                    element.hidden = true;
                    element.setAttribute(
                        "aria-hidden",
                        "true"
                    );
                }
            );
        };


        hide(
            ".controller-modal-head .panel-kicker"
        );

        hide(
            ".controller-modal-head p"
        );

        hide(
            "#controllerModalNotice"
        );

        hide(
            ".controller-safety-ack"
        );

        hide(
            ".controller-auth-row > label"
        );

        hide(
            ".controller-locked-block"
        );

        hide(
            ".controller-command-details"
        );

        hide(
            "#controllerModalRuntime"
        );


        const reset =
            $("controllerResetDefaultsBtn");

        if (reset) {
            reset.textContent =
                "Reset to default";
        }


        ownSettingsButtons();
    }


    function hideOldTeleopAction() {
        const button =
            $("xrActionBtn");

        if (!button) {
            return;
        }

        button.style
            .setProperty(
                "display",
                "none",
                "important"
            );


        const panel =
            button.closest(
                ".action-readiness-panel"
            );

        if (panel) {
            panel.style
                .setProperty(
                    "display",
                    "none",
                    "important"
                );

            return;
        }


        /*
         * Historical DOM fallback:
         * hide only the small action container,
         * never the entire controller card.
         */
        const parent =
            button.parentElement;

        if (
            parent
            && !parent.classList
                .contains(
                    "controller-process-panel"
                )
        ) {
            parent.style
                .setProperty(
                    "display",
                    "none",
                    "important"
                );
        }
    }


    /* ========================================================
       STATE
       ======================================================== */

    function extractActions(
        latest
    ) {
        return (
            latest?.telemetry?.actions
            || latest?.actions
            || {}
        );
    }


    let bacaNoOverlap_refreshState = false;

    async function refreshState() {
        if (bacaNoOverlap_refreshState) return;
        bacaNoOverlap_refreshState = true;
        try {
            try {
                const controller =
                    await getJson(
                        "/api/controller"
                    );

                lastController =
                    controller || {};
            } catch {}


            try {
                const latest =
                    await getJson(
                        "/api/latest"
                    );

                lastActions =
                    extractActions(
                        latest
                    );
            } catch {}


            applyButtonState();
        } finally {
            bacaNoOverlap_refreshState = false;
        }
    }


    function setOperatorButtonState(
    button,
    enabled
) {
    if (!button) {
        return;
    }

    button.disabled =
        !enabled;

    button.setAttribute(
        "aria-disabled",
        enabled
            ? "false"
            : "true"
    );

    button.classList.toggle(
        "baca-v18-active",
        enabled
    );

    button.classList.toggle(
        "baca-v18-disabled",
        !enabled
    );
}


function installSettingsGearV182(){

    const button=
        $("controllerSettingsBtn");

    if(!button){
        return;
    }

    button.setAttribute(
        "aria-label",
        "Controller settings"
    );

    button.setAttribute(
        "title",
        "Controller settings"
    );

    if(
        button.dataset
            .bacaGearV182 === "1"
    ){
        return;
    }

    button.dataset
        .bacaGearV182 = "1";

    button.innerHTML=`
      <svg
        class="baca-controller-gear-v182"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="
          M9.5 3.5
          10.1 2h3.8l.6 1.5
          1.6.7 1.5-.6 2.7 2.7-.6 1.5.7 1.6
          1.5.6v3.8l-1.5.6-.7 1.6.6 1.5-2.7 2.7-1.5-.6-1.6.7-.6 1.5h-3.8l-.6-1.5-1.6-.7-1.5.6-2.7-2.7.6-1.5-.7-1.6-1.5-.6v-3.8l1.5-.6.7-1.6-.6-1.5L6.4 3.6l1.5.6 1.6-.7Z
        "/>
        <circle cx="12" cy="12" r="3.1"/>
      </svg>
    `;
}


function setOperatorButtonState(
    button,
    enabled
){
    if(!button){
        return;
    }

    if(button.disabled === enabled){
        button.disabled=
            !enabled;
    }

    button.setAttribute(
        "aria-disabled",
        enabled
            ? "false"
            : "true"
    );
}


function applyButtonState(){

    ownActionButtons();

    installSettingsGearV182();


    const state=
        lastController.state
        || "UNAVAILABLE";


    const stopped=
        state === "STOPPED";

    const running=
        state === "RUNNING";


    const settings=
        $("controllerSettingsBtn");

    const configure=
        $("controllerConfigureBtn");

    const stop=
        $("controllerStopBtn");

    const enter=
        $("bacaEnterTeleopBtn");

    const exit=
        $("bacaExitTeleopBtn");

    const save=
        $("controllerStartBtn");


    const canConfigure=
        stopped
        && !busy
        && lastController.can_start === true;


    const canStop=
        running
        && !busy
        && lastController.can_stop === true;


    const handover=
        lastActions.xr_handover
        || {};


    const available=
        handover.available === true;


    const operation=
        handover.operation
        || "NONE";


    const canEnter=
        running
        && !busy
        && available
        && operation === "REQUEST_XR";


    const canExit=
        running
        && !busy
        && available
        && operation === "HAND_BACK_ARMS";


    /*
     * These DATA states own the visual presentation.
     * Legacy app.js may touch disabled; it can no longer
     * make both halves LOOK active simultaneously.
     */
    const processShell=
        $("controllerProcessSwitchV16");

    const xrShell=
        $("controllerXrSwitchV16");


    if(processShell){

        processShell.dataset
            .bacaState =
                canConfigure
                ? "configure"
                : canStop
                  ? "stop"
                  : "none";
    }


    if(xrShell){

        xrShell.dataset
            .bacaState =
                canEnter
                ? "enter"
                : canExit
                  ? "exit"
                  : "none";
    }


    if(settings){

        settings.dataset
            .bacaState =
                stopped && !busy
                ? "enabled"
                : "disabled";
    }


    setOperatorButtonState(
        settings,
        stopped && !busy
    );

    setOperatorButtonState(
        configure,
        canConfigure
    );

    setOperatorButtonState(
        stop,
        canStop
    );

    setOperatorButtonState(
        enter,
        canEnter
    );

    setOperatorButtonState(
        exit,
        canExit
    );


    if(save){
        save.disabled=
            busy || !stopped;
    }
}




    /* ========================================================
       MODAL OPEN WATCH
       ======================================================== */

    async function watchModal() {
        const modal =
            $("controllerModal");

        if (!modal) {
            return;
        }

        const open =
            !modal.classList
                .contains(
                    "hidden"
                );


        if (
            open
            && !modalPreviouslyOpen
        ) {
            cleanSettingsModal();

            /*
             * Existing app builds the parameter rows
             * asynchronously after opening the modal.
             */
            setTimeout(
                () => {
                    cleanSettingsModal();

                    applySavedSettings()
                    .catch(console.error);
                },
                150
            );
        }


        modalPreviouslyOpen =
            open;
    }


    /* ========================================================
       BOOT
       ======================================================== */

    function install() {
        cleanSettingsModal();
        hideOldTeleopAction();
        ownActionButtons();

        refreshState();

        window.setInterval(
            () => {
                cleanSettingsModal();
                hideOldTeleopAction();
                watchModal();

                refreshState()
                .catch(console.error);
            },
            400
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
    } else {
        install();
    }
})();
