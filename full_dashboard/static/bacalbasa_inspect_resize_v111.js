(() => {
    "use strict";

    const STORAGE =
        "g1Dashboard.bacaInspectWidths.v111";

    const KEYS = [
        "system",
        "imu",
        "odom",
        "processes"
    ];

    let resizeState = null;
    let frame = 0;
    let queuedWeights = null;


    function api(){
        return window.BACALBASA_INSPECT_LAYOUT_V18 || null;
    }


    function grid(){
        return document.querySelector(
            "#view-inspect .inspect-health-grid.inspect-v45"
        );
    }


    function clamp(value, min, max){
        return Math.max(
            min,
            Math.min(max, value)
        );
    }


    function ordered(){
        const a = api();

        if(!a){
            return [];
        }

        const map = a.getElements();

        return a
            .getOrder()
            .map(key => ({
                key,
                el: map[key]
            }))
            .filter(item => item.el);
    }


    function gapPixels(){
        const g = grid();

        if(!g){
            return 8;
        }

        const value =
            parseFloat(
                getComputedStyle(g).columnGap
            );

        return Number.isFinite(value)
            ? value
            : 8;
    }


    function usableWidth(){
        const g = grid();
        const count = ordered().length;

        if(!g){
            return 0;
        }

        return Math.max(
            0,
            g.getBoundingClientRect().width
            -
            gapPixels()
            *
            Math.max(0, count - 1)
        );
    }


    /*
     * Inspect-specific content floors.
     *
     * Interaction is Live-equivalent, but these limits protect the
     * four-card Inspect contents from becoming unusably narrow.
     */

    function boundsFor(key, available){

        if(key === "system"){
            return {
                min: Math.max(390, available * .18),
                max: Math.min(760, available * .42)
            };
        }

        if(key === "imu"){
            return {
                min: Math.max(300, available * .17),
                max: Math.min(700, available * .40)
            };
        }

        if(key === "odom"){
            return {
                min: Math.max(300, available * .17),
                max: Math.min(700, available * .40)
            };
        }

        return {
            min: Math.max(300, available * .17),
            max: Math.min(760, available * .42)
        };
    }


    function currentWidths(){
        const result = {};

        for(const item of ordered()){
            result[item.key] =
                item.el.getBoundingClientRect().width;
        }

        return result;
    }


    function applyQueued(){

        frame = 0;

        if(
            !queuedWeights
            ||
            !api()
        ){
            return;
        }

        const next = queuedWeights;
        queuedWeights = null;

        api().setTrackWeights(next);
    }


    function queueWeights(weights){

        queuedWeights = {
            ...weights
        };

        if(frame){
            return;
        }

        frame =
            requestAnimationFrame(
                applyQueued
            );
    }


    function flush(){

        if(frame){
            cancelAnimationFrame(frame);
            frame = 0;
        }

        applyQueued();
    }


    function save(){

        const a = api();

        if(!a){
            return;
        }

        const weights =
            a.getTrackWeights();

        let total = 0;

        for(const key of KEYS){
            total += Number(weights[key]) || 0;
        }

        if(total <= 0){
            return;
        }

        const saved = {};

        for(const key of KEYS){
            saved[key] =
                (Number(weights[key]) || 0)
                /
                total;
        }

        try{
            localStorage.setItem(
                STORAGE,
                JSON.stringify(saved)
            );
        }catch(_){}
    }


    function restore(){

        const a = api();

        if(!a){
            return;
        }

        try{
            const saved =
                JSON.parse(
                    localStorage.getItem(STORAGE)
                    ||
                    "null"
                );

            if(
                !saved
                ||
                typeof saved !== "object"
            ){
                return;
            }

            for(const key of KEYS){
                if(
                    !Number.isFinite(
                        Number(saved[key])
                    )
                    ||
                    Number(saved[key]) <= 0
                ){
                    return;
                }
            }

            a.setTrackWeights(saved);

        }catch(_){}
    }


    function updateExteriorEdges(){

        const sections =
            ordered();

        sections.forEach(
            (item, index) => {

                const left =
                    item.el.querySelector(
                        ':scope > .baca-inspect-resize-edge-v111[data-side="left"]'
                    );

                const right =
                    item.el.querySelector(
                        ':scope > .baca-inspect-resize-edge-v111[data-side="right"]'
                    );

                left?.classList.toggle(
                    "stitch-resize-disabled-v1931",
                    index === 0
                );

                right?.classList.toggle(
                    "stitch-resize-disabled-v1931",
                    index === sections.length - 1
                );
            }
        );
    }


    function moveResize(event){

        if(
            !resizeState
            ||
            event.pointerId
                !==
                resizeState.pointerId
        ){
            return;
        }

        event.preventDefault();

        const delta =
            event.clientX
            -
            resizeState.startX;

        const pairTotal =
            resizeState.leftStart
            +
            resizeState.rightStart;

        const minimumLeft =
            Math.max(
                resizeState.leftBounds.min,
                pairTotal
                -
                resizeState.rightBounds.max
            );

        const maximumLeft =
            Math.min(
                resizeState.leftBounds.max,
                pairTotal
                -
                resizeState.rightBounds.min
            );

        const newLeft =
            clamp(
                resizeState.leftStart + delta,
                minimumLeft,
                maximumLeft
            );

        const newRight =
            pairTotal - newLeft;

        const pairWeight =
            resizeState.startWeights[
                resizeState.leftKey
            ]
            +
            resizeState.startWeights[
                resizeState.rightKey
            ];

        const next = {
            ...resizeState.startWeights
        };

        next[
            resizeState.leftKey
        ] =
            pairWeight
            *
            (
                newLeft
                /
                pairTotal
            );

        next[
            resizeState.rightKey
        ] =
            pairWeight
            -
            next[
                resizeState.leftKey
            ];

        queueWeights(next);
    }


    function cleanup(){

        if(!resizeState){
            return;
        }

        resizeState.handle.classList.remove(
            "stitch-resize-active-v1931"
        );

        document.body.classList.remove(
            "stitch-major-resizing-v1931"
        );

        document.removeEventListener(
            "pointermove",
            moveResize,
            true
        );

        document.removeEventListener(
            "pointerup",
            finishResize,
            true
        );

        document.removeEventListener(
            "pointercancel",
            cancelResize,
            true
        );
    }


    function completeResize(event, cancelled){

        if(
            !resizeState
            ||
            event.pointerId
                !==
                resizeState.pointerId
        ){
            return;
        }

        event.preventDefault();

        const state = resizeState;

        flush();

        if(cancelled){
            api()?.setTrackWeights(
                state.startWeights
            );
        }

        try{
            state.handle.releasePointerCapture(
                event.pointerId
            );
        }catch(_){}

        cleanup();

        resizeState = null;

        if(!cancelled){
            save();
        }

        requestAnimationFrame(
            updateExteriorEdges
        );
    }


    function finishResize(event){
        completeResize(event, false);
    }


    function cancelResize(event){
        completeResize(event, true);
    }


    function beginResize(
        event,
        key,
        side,
        handle
    ){

        if(
            event.button !== 0
            ||
            resizeState
        ){
            return;
        }

        const sections =
            ordered();

        const index =
            sections.findIndex(
                item => item.key === key
            );

        if(index < 0){
            return;
        }

        let left;
        let right;

        if(side === "right"){

            if(
                index >=
                sections.length - 1
            ){
                return;
            }

            left = sections[index];
            right = sections[index + 1];

        }else{

            if(index <= 0){
                return;
            }

            left = sections[index - 1];
            right = sections[index];
        }

        event.preventDefault();
        event.stopPropagation();

        const widths =
            currentWidths();

        const startWeights =
            api().getTrackWeights();

        const available =
            usableWidth();

        resizeState = {
            pointerId:
                event.pointerId,

            handle,

            startX:
                event.clientX,

            leftKey:
                left.key,

            rightKey:
                right.key,

            leftStart:
                widths[left.key],

            rightStart:
                widths[right.key],

            startWeights:
                {...startWeights},

            leftBounds:
                boundsFor(
                    left.key,
                    available
                ),

            rightBounds:
                boundsFor(
                    right.key,
                    available
                )
        };

        document.body.classList.add(
            "stitch-major-resizing-v1931"
        );

        handle.classList.add(
            "stitch-resize-active-v1931"
        );

        try{
            handle.setPointerCapture(
                event.pointerId
            );
        }catch(_){}

        document.addEventListener(
            "pointermove",
            moveResize,
            true
        );

        document.addEventListener(
            "pointerup",
            finishResize,
            true
        );

        document.addEventListener(
            "pointercancel",
            cancelResize,
            true
        );
    }


    function addEdges(){

        const a = api();

        if(!a){
            return false;
        }

        const map =
            a.getElements();

        for(const key of KEYS){

            const section =
                map[key];

            if(!section){
                return false;
            }

            section.classList.add(
                "baca-inspect-resizable-v111"
            );

            for(const side of ["left", "right"]){

                if(
                    section.querySelector(
                        `:scope > .baca-inspect-resize-edge-v111[data-side="${side}"]`
                    )
                ){
                    continue;
                }

                const edge =
                    document.createElement(
                        "div"
                    );

                edge.className =
                    "stitch-resize-edge-v1931 baca-inspect-resize-edge-v111";

                edge.dataset.side =
                    side;

                edge.setAttribute(
                    "aria-hidden",
                    "true"
                );

                edge.addEventListener(
                    "pointerdown",
                    event =>
                        beginResize(
                            event,
                            key,
                            side,
                            edge
                        )
                );

                section.appendChild(edge);
            }
        }

        updateExteriorEdges();

        return true;
    }


    function afterPossibleReorder(){

        if(resizeState){
            return;
        }

        requestAnimationFrame(
            () =>
                requestAnimationFrame(
                    updateExteriorEdges
                )
        );
    }


    function install(){

        if(
            !grid()
            ||
            !api()
        ){
            return;
        }

        restore();

        if(!addEdges()){
            return;
        }

        document.addEventListener(
            "pointerup",
            afterPossibleReorder,
            true
        );

        console.log(
            "[BACALBASA INSPECT V1.11] Live-style side resizing ready"
        );
    }


    requestAnimationFrame(
        () =>
            requestAnimationFrame(
                install
            )
    );

})();
