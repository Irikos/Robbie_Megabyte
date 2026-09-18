(() => {
    "use strict";

    /*
     * STITCH V1.9.45
     *
     * Do NOT try another CSS translate against the historical rules.
     *
     * Find the ACTUAL visible CAMERA MULTIVIEW title and position its
     * center from the ACTUAL Connect button center.
     *
     * This executes once. No MutationObserver. No setInterval.
     */

    function pinActualCameraTitleV1945() {

        const cameraPanel =
            document.querySelector(
                '#view-live [data-stitch-major-key="camera"]'
            )
            ||
            document.querySelector(
                "#view-live .camera-panel"
            );

        const connect =
            document.getElementById(
                "cameraConnectBtn"
            );

        if (!cameraPanel || !connect) {
            console.warn(
                "[V1.9.45] camera panel / Connect button missing"
            );
            return;
        }


        /*
         * Search by ACTUAL displayed text rather than depending on
         * another historical class/id.
         */
        const candidates =
            Array.from(
                cameraPanel.querySelectorAll(
                    ".panel-kicker, strong, span, div"
                )
            );

        const title =
            candidates.find(el => {
                if (el.children.length) {
                    return false;
                }

                return (
                    String(
                        el.textContent || ""
                    )
                    .trim()
                    .toUpperCase()
                    === "CAMERA MULTIVIEW"
                );
            });

        if (!title) {
            console.warn(
                "[V1.9.45] real CAMERA MULTIVIEW node not found"
            );
            return;
        }


        /*
         * Find the title's real header coordinate system.
         */
        const header =
            title.closest(".panel-head")
            ||
            title.parentElement;

        if (!header) {
            return;
        }


        const headerRect =
            header.getBoundingClientRect();

        const buttonRect =
            connect.getBoundingClientRect();

        const buttonCenterY =
            buttonRect.top
            - headerRect.top
            + (
                buttonRect.height
                / 2
            );


        /*
         * Inline !important deliberately beats the large historical
         * stylesheet chain that prevented the earlier attempts from
         * visibly moving this title.
         */
        header.style.setProperty(
            "position",
            "relative",
            "important"
        );

        title.style.setProperty(
            "position",
            "absolute",
            "important"
        );

        title.style.setProperty(
            "top",
            `${buttonCenterY}px`,
            "important"
        );

        title.style.setProperty(
            "left",
            "14px",
            "important"
        );

        title.style.setProperty(
            "right",
            "auto",
            "important"
        );

        title.style.setProperty(
            "bottom",
            "auto",
            "important"
        );

        title.style.setProperty(
            "margin",
            "0",
            "important"
        );

        title.style.setProperty(
            "padding",
            "0",
            "important"
        );

        title.style.setProperty(
            "translate",
            "none",
            "important"
        );

        title.style.setProperty(
            "transform",
            "translateY(-50%)",
            "important"
        );

        title.dataset.stitchCameraTitleV1945 =
            "aligned";

        console.log(
            "[V1.9.45] CAMERA MULTIVIEW aligned to Connect center",
            {
                titleTop:
                    Math.round(
                        title.getBoundingClientRect().top
                    ),

                buttonTop:
                    Math.round(
                        buttonRect.top
                    )
            }
        );
    }


    if (
        document.readyState
        === "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            () => {
                requestAnimationFrame(
                    pinActualCameraTitleV1945
                );
            },
            {
                once: true
            }
        );
    }
    else {
        requestAnimationFrame(
            pinActualCameraTitleV1945
        );
    }

})();
