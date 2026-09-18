(() => {
    "use strict";

    const $ = id =>
        document.getElementById(id);

    let busy = false;


    /* ========================================================
       HTTP
       ======================================================== */

    async function readResponse(response) {

        const text =
            await response.text();

        let data = {};

        if (text.trim()) {
            try {
                data =
                    JSON.parse(text);
            }
            catch {
                data =
                    {
                        error: text.trim(),
                    };
            }
        }

        return data;
    }


    async function rawPost(
        path,
        payload={}
    ) {

        return fetch(
            path,
            {
                method:
                    "POST",

                credentials:
                    "same-origin",

                cache:
                    "no-store",

                headers:
                    {
                        "Content-Type":
                            "application/json",
                    },

                body:
                    JSON.stringify(
                        payload
                    ),
            }
        );
    }


    /*
     * V14 trusted-session model:
     *
     * 1. Try the requested action.
     * 2. If bridge says 401, bootstrap the same-origin session.
     * 3. Retry exactly once.
     *
     * No pasted management key.
     */
    async function trustedPost(
        path,
        payload={}
    ) {

        let response =
            await rawPost(
                path,
                payload
            );


        if (
            response.status
            === 401
        ) {

            const bootstrap =
                await rawPost(
                    "/api/session/bootstrap",
                    {}
                );


            const bootstrapData =
                await readResponse(
                    bootstrap
                );


            if (!bootstrap.ok) {

                throw new Error(
                    bootstrapData?.error
                    ||
                    (
                        "trusted-session bootstrap failed: HTTP "
                        + bootstrap.status
                    )
                );
            }


            response =
                await rawPost(
                    path,
                    payload
                );
        }


        const data =
            await readResponse(
                response
            );


        if (!response.ok) {

            const detail =
                data?.error
                ||
                data?.message
                ||
                (
                    "HTTP "
                    + response.status
                );


            throw new Error(
                detail
            );
        }


        return data;
    }


    /* ========================================================
       SETTINGS -> CONTROLLER PARAMETERS

       Reads the existing Settings modal directly.

       Therefore:
         Settings gear -> change values -> Save
         Configure -> launch using those values
       ======================================================== */

    function normalizedText(value) {

        return String(
            value || ""
        )
        .replace(
            /\s+/g,
            " "
        )
        .trim()
        .toLowerCase();
    }


    const numericParameterMap =
        new Map([
            [
                "control rate",
                "frequency",
            ],
            [
                "status rate",
                "status_hz",
            ],
            [
                "max wrist speed",
                "max_wrist_speed",
            ],
            [
                "max wrist rotation",
                "max_wrist_rotation_speed_deg",
            ],
            [
                "joint target speed",
                "joint_target_speed_rps",
            ],
            [
                "max ik target jump",
                "max_ik_target_jump_rad",
            ],
            [
                "bimanual inward offset",
                "bimanual_inward_offset_m",
            ],
            [
                "tracking fault frames",
                "tracking_fault_frames",
            ],
            [
                "resume position tolerance",
                "tracking_resume_position_m",
            ],
            [
                "resume rotation tolerance",
                "tracking_resume_rotation_deg",
            ],
            [
                "resume stable frames",
                "tracking_resume_stable_frames",
            ],
            [
                "finger command rate",
                "finger_frequency",
            ],
            [
                "finger command speed",
                "finger_command_speed_per_s",
            ],
            [
                "minimum finger command",
                "finger_minimum_command",
            ],
            [
                "finger stable tracking",
                "finger_stable_tracking_frames",
            ],
            [
                "finger fault frames",
                "finger_tracking_fault_frames",
            ],
            [
                "finger tracking stale",
                "finger_tracking_stale_s",
            ],
            [
                "finger reacquire tolerance",
                "finger_reacquire_command_tolerance",
            ],
            [
                "finger reacquire stable",
                "finger_reacquire_stable_frames",
            ],
            [
                "finger state stale",
                "finger_state_stale_s",
            ],
        ]);


    function findNumericRowValue(
        wantedLabel
    ) {

        const modal =
            $("controllerModal");

        if (!modal) {
            return null;
        }


        const rows =
            modal.querySelectorAll(
                ".controller-param-row"
            );


        for (
            const row
            of rows
        ) {

            const label =
                row.querySelector(
                    "label"
                );


            const text =
                normalizedText(
                    label?.textContent
                );


            if (
                text !== wantedLabel
            ) {
                continue;
            }


            /*
             * Prefer number input because the existing
             * dashboard keeps it synchronized with the range.
             */
            const number =
                row.querySelector(
                    'input[type="number"]'
                );


            const range =
                row.querySelector(
                    'input[type="range"]'
                );


            const input =
                number || range;


            if (!input) {
                return null;
            }


            const value =
                Number(
                    input.value
                );


            return Number.isFinite(
                value
            )
                ? value
                : null;
        }


        return null;
    }


    function findBooleanValue(
        phrase
    ) {

        const modal =
            $("controllerModal");

        if (!modal) {
            return null;
        }


        const rows =
            modal.querySelectorAll(
                ".controller-bool-row, .controller-param-row"
            );


        for (
            const row
            of rows
        ) {

            const text =
                normalizedText(
                    row.textContent
                );


            if (
                !text.includes(
                    phrase
                )
            ) {
                continue;
            }


            const checkbox =
                row.querySelector(
                    'input[type="checkbox"]'
                );


            if (checkbox) {
                return Boolean(
                    checkbox.checked
                );
            }
        }


        return null;
    }


    function currentControllerParameters() {

        const parameters =
            {};


        for (
            const [
                label,
                key
            ]
            of numericParameterMap
        ) {

            const value =
                findNumericRowValue(
                    label
                );


            if (
                value !== null
            ) {
                parameters[key] =
                    value;
            }
        }


        const questLocomotion =
            findBooleanValue(
                "enable quest locomotion"
            );


        if (
            questLocomotion
            !== null
        ) {
            parameters.enable_quest_locomotion =
                questLocomotion;
        }


        const locomotionDuringXr =
            findBooleanValue(
                "allow locomotion during xr"
            );


        if (
            locomotionDuringXr
            !== null
        ) {
            parameters.allow_locomotion_during_xr =
                locomotionDuringXr;
        }


        return parameters;
    }


    /* ========================================================
       UNDERLYING SETTINGS MENU

       Gear may still use the existing menu-opening handler.
       It performs no controller lifecycle action.
       ======================================================== */

    function openExistingSettings() {

        const original =
            $("controllerSettingsBtn");


        if (!original) {

            console.error(
                "V20.2: controllerSettingsBtn missing"
            );

            return;
        }


        const oldDisabled =
            original.disabled;


        original.disabled =
            false;


        try {
            original.click();
        }
        finally {
            original.disabled =
                oldDisabled;
        }
    }


    /* ========================================================
       DIRECT ACTIONS
       ======================================================== */

    async function startController() {

        if (busy) {
            return;
        }


        const state =
            await fetch(
                "/api/controller",
                {
                    cache:
                        "no-store",
                }
            )
            .then(
                r => r.json()
            );


        if (
            state?.state
            !== "STOPPED"
            ||
            state?.can_start
            !== true
        ) {
            return;
        }


        busy =
            true;


        try {

            const parameters =
                currentControllerParameters();


            console.info(
                "V20.2 launching V1.8 with parameters:",
                parameters
            );


            await trustedPost(
                "/api/controller/start",
                {
                    parameters,
                }
            );

        }
        catch (error) {

            console.error(
                "V20.2 controller start failed:",
                error
            );


            window.alert(
                "Controller start failed: "
                + (
                    error?.message
                    || error
                )
            );

        }
        finally {

            busy =
                false;
        }
    }


    async function stopController() {

        if (busy) {
            return;
        }


        const state =
            await fetch(
                "/api/controller",
                {
                    cache:
                        "no-store",
                }
            )
            .then(
                r => r.json()
            );


        if (
            state?.state
            !== "RUNNING"
            ||
            state?.can_stop
            !== true
        ) {
            return;
        }


        busy =
            true;


        try {

            await trustedPost(
                "/api/controller/stop",
                {}
            );

        }
        catch (error) {

            console.error(
                "V20.2 controller stop failed:",
                error
            );


            window.alert(
                "Controller stop failed: "
                + (
                    error?.message
                    || error
                )
            );

        }
        finally {

            busy =
                false;
        }
    }


    async function requestXr(
        operation
    ) {

        if (busy) {
            return;
        }


        busy =
            true;


        try {

            await trustedPost(
                "/api/controller/action",
                {
                    operation,
                }
            );

        }
        catch (error) {

            console.error(
                "V20.2 XR action failed:",
                error
            );


            window.alert(
                "Teleop action failed: "
                + (
                    error?.message
                    || error
                )
            );

        }
        finally {

            busy =
                false;
        }
    }


    /* ========================================================
       STRIP V20'S OLD LISTENERS

       cloneNode removes JS listeners attached by V20.
       The original V20 polling/state renderer still works,
       because it resolves the controls by ID every poll.
       ======================================================== */

    function replaceButton(
        id,
        handler
    ) {

        const oldButton =
            $(id);


        if (!oldButton) {
            return false;
        }


        const button =
            oldButton.cloneNode(
                true
            );


        oldButton.replaceWith(
            button
        );


        button.addEventListener(
            "click",
            event => {

                event.preventDefault();

                event.stopPropagation();

                handler();
            }
        );


        return true;
    }


    function install() {

        const root =
            $("bacaControllerV20");


        if (!root) {
            return false;
        }


        const ok = [

            replaceButton(
                "bacaSettingsV20",
                openExistingSettings
            ),

            replaceButton(
                "bacaConfigureV20",
                startController
            ),

            replaceButton(
                "bacaStopV20",
                stopController
            ),

            replaceButton(
                "bacaEnterV20",
                () => requestXr(
                    "REQUEST_XR"
                )
            ),

            replaceButton(
                "bacaExitV20",
                () => requestXr(
                    "HAND_BACK_ARMS"
                )
            ),

        ];


        if (
            ok.some(
                value => !value
            )
        ) {

            console.error(
                "V20.2 could not bind every controller control"
            );

            return false;
        }


        console.info(
            "V20.2 direct controller actions installed"
        );


        return true;
    }


    function waitForV20(
        attempt=0
    ) {

        if (install()) {
            return;
        }


        if (
            attempt >= 80
        ) {

            console.error(
                "V20.2 timed out waiting for V20 controls"
            );

            return;
        }


        window.setTimeout(
            () => waitForV20(
                attempt + 1
            ),
            50
        );
    }


    if (
        document.readyState
        === "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            () => waitForV20(),
            {
                once:
                    true,
            }
        );

    }
    else {

        waitForV20();
    }

})();
