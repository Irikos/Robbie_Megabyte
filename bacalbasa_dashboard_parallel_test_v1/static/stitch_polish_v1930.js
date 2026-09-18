/* ================================================================
   STITCH V1.9.30 — EXACT CAMERA / MODE TITLE ALIGNMENT

   One layout measurement after startup.

   No MutationObserver.
   No setInterval.
   No polling.
   No drag-system changes.
   ================================================================ */

(function () {

    function visibleElement(selector) {

        return [
            ...document.querySelectorAll(selector)
        ].find(element => {

            const rect =
                element.getBoundingClientRect();

            return (
                rect.width > 0
                &&
                rect.height > 0
            );
        });
    }


    function alignCameraTitleV1930() {

        const cameraTitle =
            visibleElement(
                '#view-live .camera-panel .panel-kicker'
            );


        const modeTitle =
            visibleElement(
                '#view-live .stitch-mode-section .panel-kicker'
            );


        if (
            !cameraTitle
            ||
            !modeTitle
        ) {

            return;
        }


        /*
         * Align actual rendered top edges.
         *
         * This deliberately avoids a guessed +8 / +10 / +12px
         * correction.
         */

        cameraTitle.style.setProperty(
            '--stitch-camera-title-shift-v1930',
            '0px'
        );


        const cameraRect =
            cameraTitle.getBoundingClientRect();

        const modeRect =
            modeTitle.getBoundingClientRect();


        const correction =
            Math.round(
                modeRect.top
                -
                cameraRect.top
            );


        cameraTitle.style.setProperty(
            '--stitch-camera-title-shift-v1930',
            `${correction}px`
        );


        console.log(
            '[STITCH V1.9.30] Camera title alignment:',
            {
                cameraTop:
                    cameraRect.top,

                modeTop:
                    modeRect.top,

                correction:
                    correction
            }
        );
    }


    function installV1930() {

        /*
         * Two animation frames allow the already-loaded shell/layout
         * scripts to finish their one-time DOM arrangement first.
         */

        requestAnimationFrame(() => {

            requestAnimationFrame(
                alignCameraTitleV1930
            );

        });
    }


    if (
        document.readyState
        ===
        'loading'
    ) {

        document.addEventListener(
            'DOMContentLoaded',
            installV1930,
            {
                once:
                    true
            }
        );

    }
    else {

        installV1930();
    }

})();

