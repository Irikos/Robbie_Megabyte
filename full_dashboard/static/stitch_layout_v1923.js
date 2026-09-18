
/* ==================================================================
   STITCH V1.9.23

   - fixed grid slots
   - whole section follows cursor
   - no wiggle
   - FLIP snap on drop
   - new functional YOLO proxy
   - structural MODE / ARM OWNERSHIP row

   No MutationObserver.
   No setInterval.
   ================================================================== */

(function(){

    "use strict";


    const HOLD_MS =
        115;

    const MOVE_THRESHOLD =
        6;

    const SNAP_MS =
        290;

    const SNAP_EASE =
        "cubic-bezier(.2,.85,.25,1)";


    /* ============================================================
       YOLO
       ============================================================ */

    function installYolo(){

        const panel =
            document.querySelector(
                "#view-live .camera-panel"
            );

        const real =
            document.getElementById(
                "cameraYoloControl"
            );

        const realInput =
            real?.querySelector(
                'input[type="checkbox"]'
            );

        const disconnect =
            document.getElementById(
                "cameraStopBtn"
            );

        const icons =
            document.querySelector(
                "#view-live .camera-mode-buttons"
            );


        if(
            !panel
            ||
            !real
            ||
            !realInput
            ||
            !disconnect
            ||
            !icons
        ){

            console.error(
                "V1.9.23 YOLO: missing required node"
            );

            return;
        }


        document
            .getElementById(
                "stitchYoloProxyV1923"
            )
            ?.remove();


        real.classList.add(
            "stitch-original-yolo-hidden-v1923"
        );


        const proxy =
            document.createElement(
                "label"
            );


        proxy.id =
            "stitchYoloProxyV1923";


        /*
         * LIVE YOLO STABLE 1
         *
         * Do not display the proxy at an intermediate position.
         * The original YOLO has already been hidden above.
         */
        proxy.style.setProperty(
            "visibility",
            "hidden",
            "important"
        );


        const input =
            document.createElement(
                "input"
            );


        input.type =
            "checkbox";


        const text =
            document.createElement(
                "span"
            );


        text.textContent =
            "YOLO";


        proxy.append(
            input,
            text
        );


        panel.appendChild(
            proxy
        );


        function sync(){

            input.checked =
                !!realInput.checked;

            /*
             * Full Dash owns its own camera-only YOLO endpoint.
             * The visible proxy must remain interactive even if
             * the legacy hidden Dragos input reports disabled.
             */
            input.disabled =
                false;
        }


        sync();


        input.addEventListener(
            "change",
            ()=>{

                /*
                 * Do NOT use realInput.click().
                 *
                 * HTMLElement.click() does nothing on a disabled
                 * checkbox. Instead mirror the proxy state onto the
                 * original input and dispatch the same change event
                 * its real Dragos handler already listens for.
                 */
                realInput.checked =
                    !!input.checked;

                realInput.dispatchEvent(
                    new Event(
                        "change",
                        {
                            bubbles: true
                        }
                    )
                );


                window.setTimeout(
                    sync,
                    0
                );
            }
        );


        realInput.addEventListener(
            "change",
            sync
        );


        /*
         * Match Health typography.
         */

        const health =
            [
                ...document.querySelectorAll(
                    "#view-live label"
                )
            ].find(
                label =>
                    String(
                        label.textContent || ""
                    )
                    .replace(/\s+/g," ")
                    .trim()
                    .toLowerCase()
                    ===
                    "health"
            );


        if(health){

            const style =
                getComputedStyle(
                    health
                );


            for(
                const property
                of [
                    "font-family",
                    "font-size",
                    "font-weight",
                    "font-style",
                    "line-height",
                    "letter-spacing",
                    "text-transform",
                    "color",
                    "opacity"
                ]
            ){

                proxy.style.setProperty(
                    property,
                    style.getPropertyValue(
                        property
                    ),
                    "important"
                );
            }
        }


        /*
         * Position exactly where the working V1.9.22 proxy was:
         *
         * right edge = Disconnect right edge
         * vertically centered on icon bar
         */

        function positionYoloProxyV1923(){

            const panelRect =
                panel.getBoundingClientRect();

            const stopRect =
                disconnect.getBoundingClientRect();

            const iconRect =
                icons.getBoundingClientRect();

            const proxyRect =
                proxy.getBoundingClientRect();


            const right =
                panelRect.right
                -
                stopRect.right;


            const top =
                iconRect.top
                -
                panelRect.top
                +
                (
                    iconRect.height
                    -
                    proxyRect.height
                ) / 2;


            proxy.style.setProperty(
                "right",
                `${right.toFixed(2)}px`,
                "important"
            );


            proxy.style.setProperty(
                "top",
                `${top.toFixed(2)}px`,
                "important"
            );


            /*
             * Reveal only after the accepted final coordinates
             * have been applied.
             */
            proxy.style.removeProperty(
                "visibility"
            );
        }


        function scheduleYoloPositionV1923(){

            requestAnimationFrame(
                ()=>requestAnimationFrame(
                    positionYoloProxyV1923
                )
            );
        }


        if(
            document.fonts
            &&
            document.fonts.ready
        ){

            document.fonts.ready.then(
                scheduleYoloPositionV1923,
                scheduleYoloPositionV1923
            );

        }
        else{

            scheduleYoloPositionV1923();
        }
    }


    /* ============================================================
       MODE + ARM OWNERSHIP
       ============================================================ */

    function installModeHeader(){

        const hero =
            document.querySelector(
                "#view-live .hero-state .hero-top"
            );


        const mode =
            hero?.querySelector(
                ".panel-kicker"
            );


        const ownership =
            hero?.querySelector(
                ".ownership-box"
            );


        if(
            !hero
            ||
            !mode
            ||
            !ownership
        ){

            console.error(
                "V1.9.23 ownership: missing node"
            );

            return;
        }


        /*
         * Remove every inline geometry experiment.
         */

        for(
            const element
            of [
                mode,
                ownership,
                ...ownership.children
            ]
        ){

            for(
                const property
                of [
                    "position",
                    "left",
                    "right",
                    "top",
                    "bottom",
                    "inset",
                    "margin-top",
                    "padding-top",
                    "transform",
                    "translate"
                ]
            ){

                element.style.removeProperty(
                    property
                );
            }
        }


        let row =
            hero.querySelector(
                ":scope > .stitch-mode-heading-v1923"
            );


        if(!row){

            row =
                document.createElement(
                    "div"
                );


            row.className =
                "stitch-mode-heading-v1923";


            hero.prepend(
                row
            );
        }


        /*
         * These are the ORIGINAL elements.
         * The live ownership value therefore remains functional.
         */

        row.append(
            mode,
            ownership
        );


        /*
         * Verify actual rendered top edges.
         */

        requestAnimationFrame(()=>{

            const m =
                mode.getBoundingClientRect();


            const ownerLabel =
                ownership.firstElementChild
                || ownership;


            const o =
                ownerLabel
                    .getBoundingClientRect();


            console.log(
                "V1.9.23 OWNERSHIP ALIGN",
                {
                    modeTop:
                        m.top,

                    ownershipTop:
                        o.top,

                    difference:
                        o.top - m.top
                }
            );
        });
    }


    /* ============================================================
       SECTION DRAG
       ============================================================ */

    function installDrag(){

        const grid =
            document.querySelector(
                "#view-live .combined-live-grid"
            );


        if(!grid){

            console.error(
                "V1.9.23 grid missing"
            );

            return;
        }


        const sections =
            [...grid.children]
            .filter(
                element =>
                    getComputedStyle(
                        element
                    ).display !== "none"
            )
            .slice(
                0,
                3
            );


        if(sections.length !== 3){

            console.error(
                "V1.9.23 expected 3 sections, got",
                sections.length
            );

            return;
        }


        /*
         * Freeze the CURRENT GOOD grid widths.
         *
         * They never change during drag/reorder.
         */

        const columns =
            getComputedStyle(
                grid
            ).gridTemplateColumns;


        grid.style.setProperty(
            "grid-template-columns",
            columns,
            "important"
        );


        sections.forEach(
            (section,index)=>{

                section.classList.add(
                    "stitch-slot-v1923"
                );


                section.style.setProperty(
                    "grid-column",
                    String(index + 1),
                    "important"
                );


                section.style.setProperty(
                    "grid-row",
                    "1",
                    "important"
                );


                /*
                 * Kill all older handles.
                 */

                section
                    .querySelectorAll(
                        ":scope > "
                        +
                        ".stitch-section-handle-v1920,"
                        +
                        ":scope > "
                        +
                        ".stitch-section-handle-v1921,"
                        +
                        ":scope > "
                        +
                        ".stitch-section-handle-v1922,"
                        +
                        ":scope > "
                        +
                        ".stitch-section-handle-v1923"
                    )
                    .forEach(
                        handle =>
                            handle.remove()
                    );


                const handle =
                    document.createElement(
                        "div"
                    );


                handle.className =
                    "stitch-section-handle-v1923";


                const grip =
                    document.createElement(
                        "span"
                    );


                grip.className =
                    "stitch-section-grip-v1923";


                handle.appendChild(
                    grip
                );


                section.prepend(
                    handle
                );


                wireDrag(
                    grid,
                    sections,
                    section,
                    handle
                );
            }
        );
    }


    function slotTarget(
        sections,
        source,
        pointerX
    ){

        let best =
            null;


        for(
            const candidate
            of sections
        ){

            if(candidate === source){
                continue;
            }


            /*
             * Remove any current source transform from target
             * calculations — candidates themselves never move.
             */

            const rect =
                candidate
                    .getBoundingClientRect();


            const centre =
                rect.left
                +
                rect.width / 2;


            const distance =
                Math.abs(
                    pointerX
                    -
                    centre
                );


            if(
                !best
                ||
                distance
                <
                best.distance
            ){

                best = {
                    element:
                        candidate,

                    distance
                };
            }
        }


        return best?.element
            || null;
    }


    function animateToSlot(
        source,
        target,
        sections,
        beforeVisual
    ){

        /*
         * Save target's original visual location.
         */

        const targetBefore =
            target.getBoundingClientRect();


        const sourceColumn =
            getComputedStyle(
                source
            ).gridColumnStart;


        const targetColumn =
            getComputedStyle(
                target
            ).gridColumnStart;


        /*
         * Remove pointer transform BEFORE measuring final slots,
         * but still within this JS turn so browser has not painted.
         */

        source.classList.remove(
            "stitch-dragging-v1923"
        );


        source.style.removeProperty(
            "--stitch-drag-x-v1923"
        );

        source.style.removeProperty(
            "--stitch-drag-y-v1923"
        );


        source.style.setProperty(
            "grid-column",
            targetColumn,
            "important"
        );


        target.style.setProperty(
            "grid-column",
            sourceColumn,
            "important"
        );


        /*
         * Force new layout.
         */

        const sourceFinal =
            source.getBoundingClientRect();


        const targetFinal =
            target.getBoundingClientRect();


        /*
         * Recreate where both visually WERE before drop.
         */

        const sourceDx =
            beforeVisual.left
            -
            sourceFinal.left;


        const sourceDy =
            beforeVisual.top
            -
            sourceFinal.top;


        const targetDx =
            targetBefore.left
            -
            targetFinal.left;


        const targetDy =
            targetBefore.top
            -
            targetFinal.top;


        source.style.transition =
            "none";


        target.style.transition =
            "none";


        source.style.transform =
            `translate(${sourceDx}px,${sourceDy}px)`;


        target.style.transform =
            `translate(${targetDx}px,${targetDy}px)`;


        /*
         * Commit starting frame.
         */

        void source.offsetWidth;


        source.style.transition =
            `transform ${SNAP_MS}ms ${SNAP_EASE}`;


        target.style.transition =
            `transform ${SNAP_MS}ms ${SNAP_EASE}`;


        source.style.transform =
            "translate(0px,0px)";


        target.style.transform =
            "translate(0px,0px)";


        window.setTimeout(
            ()=>{

                for(
                    const element
                    of [
                        source,
                        target
                    ]
                ){

                    element.style.removeProperty(
                        "transition"
                    );


                    element.style.removeProperty(
                        "transform"
                    );
                }


                window.dispatchEvent(
                    new Event(
                        "resize"
                    )
                );
            },
            SNAP_MS + 30
        );
    }


    function animateHome(
        source
    ){

        source.style.setProperty(
            "transition",
            `transform ${SNAP_MS}ms ${SNAP_EASE}`,
            "important"
        );


        source.style.setProperty(
            "--stitch-drag-x-v1923",
            "0px"
        );


        source.style.setProperty(
            "--stitch-drag-y-v1923",
            "0px"
        );


        window.setTimeout(
            ()=>{

                source.classList.remove(
                    "stitch-dragging-v1923"
                );


                source.style.removeProperty(
                    "transition"
                );


                source.style.removeProperty(
                    "--stitch-drag-x-v1923"
                );


                source.style.removeProperty(
                    "--stitch-drag-y-v1923"
                );
            },
            SNAP_MS + 30
        );
    }


    function wireDrag(
        grid,
        sections,
        source,
        handle
    ){

        let pending =
            null;

        let drag =
            null;


        function begin(){

            if(
                !pending
                ||
                drag
            ){
                return;
            }


            clearTimeout(
                pending.timer
            );


            drag = {

                pointerId:
                    pending.pointerId,

                startX:
                    pending.startX,

                startY:
                    pending.startY,

                target:
                    null
            };


            pending =
                null;


            source.classList.add(
                "stitch-dragging-v1923"
            );
        }


        function move(event){

            if(
                pending
                &&
                event.pointerId
                ===
                pending.pointerId
            ){

                const distance =
                    Math.hypot(
                        event.clientX
                        -
                        pending.startX,

                        event.clientY
                        -
                        pending.startY
                    );


                if(
                    distance
                    >
                    MOVE_THRESHOLD
                ){

                    begin();
                }
            }


            if(
                !drag
                ||
                event.pointerId
                !==
                drag.pointerId
            ){
                return;
            }


            event.preventDefault();


            source.style.setProperty(
                "--stitch-drag-x-v1923",
                `${
                    event.clientX
                    -
                    drag.startX
                }px`
            );


            source.style.setProperty(
                "--stitch-drag-y-v1923",
                `${
                    event.clientY
                    -
                    drag.startY
                }px`
            );


            drag.target
                ?.classList
                .remove(
                    "stitch-drop-target-v1923"
                );


            drag.target =
                slotTarget(
                    sections,
                    source,
                    event.clientX
                );


            drag.target
                ?.classList
                .add(
                    "stitch-drop-target-v1923"
                );
        }


        function finish(event){

            if(
                pending
                &&
                event.pointerId
                ===
                pending.pointerId
            ){

                clearTimeout(
                    pending.timer
                );

                pending =
                    null;

                return;
            }


            if(
                !drag
                ||
                event.pointerId
                !==
                drag.pointerId
            ){
                return;
            }


            const target =
                drag.target;


            target
                ?.classList
                .remove(
                    "stitch-drop-target-v1923"
                );


            /*
             * Save actual cursor-following visual rect BEFORE removing
             * the drag transform.
             */

            const beforeVisual =
                source.getBoundingClientRect();


            if(
                target
                &&
                target !== source
            ){

                animateToSlot(
                    source,
                    target,
                    sections,
                    beforeVisual
                );

            }else{

                animateHome(
                    source
                );
            }


            drag =
                null;
        }


        handle.addEventListener(
            "pointerdown",
            event => {

                if(event.button !== 0){
                    return;
                }


                pending = {

                    pointerId:
                        event.pointerId,

                    startX:
                        event.clientX,

                    startY:
                        event.clientY,

                    timer:
                        window.setTimeout(
                            begin,
                            HOLD_MS
                        )
                };


                try{

                    handle.setPointerCapture(
                        event.pointerId
                    );

                }catch(_error){}
            }
        );


        handle.addEventListener(
            "pointermove",
            move
        );


        handle.addEventListener(
            "pointerup",
            finish
        );


        handle.addEventListener(
            "pointercancel",
            finish
        );
    }


    /* ============================================================
       INSTALL
       ============================================================ */


    /*
     * LIVE YOLO STABLE 1
     *
     * V1.9.23 now owns ONLY the functional YOLO proxy.
     *
     * Major drag / order / MODE structure remain owned by V1.9.24.
     */
    function apply(){

        installYolo();
    }


    apply();


})();

