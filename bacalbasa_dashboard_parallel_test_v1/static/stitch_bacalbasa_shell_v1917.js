/* ================================================================
   STITCH BACALBASA SHELL V1.9.17

   Uses exact SVG templates from the standalone Bacalbasa
   reference_video_skin.js.

   Keeps existing Dragos navigation buttons and listeners.

   Also provides FINAL deterministic geometry for:
       YOLO
       ARM OWNERSHIP

   No MutationObserver.
   No interval.
   No polling.
   ================================================================ */

(function(){


/* STITCH_V1949_NO_LEGACY_FLOURISH
 * Old Bacalbasa/henna header flourish permanently retired.
 */

const bacEmblemV1917 = `
        <div class="rv-brand-emblem" aria-hidden="true">
            <svg fill="none" stroke="currentColor"
                 viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="44" opacity=".6"
                        stroke-dasharray="3 3" stroke-width="2"/>
                <circle cx="50" cy="50" r="36" opacity=".4"
                        stroke-width="1.5"/>
                <path d="M50 14 C44 28,35 40,50 65 C65 40,56 28,50 14 Z"
                      fill="rgba(245,158,11,.18)" stroke-width="2"/>
                <path d="M14 50 C28 44,40 35,65 50 C40 65,28 56,14 50 Z"
                      fill="rgba(245,158,11,.15)" stroke-width="2"/>
                <path d="M50 86 C44 72,35 60,50 35 C65 60,56 72,50 86 Z"
                      fill="rgba(245,158,11,.18)" stroke-width="2"/>
                <path d="M86 50 C72 44,60 35,35 50 C60 65,72 56,86 50 Z"
                      fill="rgba(245,158,11,.15)" stroke-width="2"/>
                <circle cx="50" cy="50" r="6"
                        fill="#10b981" stroke-width="1.5"/>
            </svg>
            <span class="rv-brand-online-dot"></span>
        </div>
    `;


    /* ============================================================
       EXACT BACALBASA EMBLEM
       ============================================================ */

    function installEmblemV1917(){

        const oldLogo =
            document.getElementById(
                'stitchAppLogo'
            );


        if(!oldLogo){
            return;
        }


        if(
            oldLogo.classList.contains(
                'rv-brand-emblem'
            )
        ){
            return;
        }


        const holder =
            document.createElement(
                'div'
            );


        holder.innerHTML =
            bacEmblemV1917.trim();


        const emblem =
            holder.firstElementChild;


        if(!emblem){
            return;
        }


        emblem.id =
            'stitchAppLogo';


        oldLogo.replaceWith(
            emblem
        );
    }


    /* ============================================================
       EXACT BACALBASA FLOURISH SVGs AROUND EXISTING NAV
       ============================================================ */

    function installHeaderCenterV1917(){

        const header =
            document.querySelector(
                'body.stitch-live-v12 > header.topbar'
            );


        const nav =
            header
            ? header.querySelector(
                '.tabs'
            )
            : null;


        if(!header || !nav){
            return;
        }


        if(
            document.querySelector(
                '.stitch-baca-header-center-v1917'
            )
        ){
            return;
        }


        const center =
            document.createElement(
                'div'
            );


        center.className =
            'stitch-baca-header-center-v1917';

        /* V1.9.49: no legacy side flourishes. */

        header.insertBefore(
            center,
            nav
        );


        center.append(nav);
    }


    /* ============================================================
       YOLO — FINAL ABSOLUTE PLACEMENT

       Desired result:
           YOLO right edge == Disconnect right edge

       The Y coordinate is preserved exactly.
       ============================================================ */

    function placeYoloV1917(){

        const yolo =
            document.getElementById(
                'cameraYoloControl'
            );


        const disconnect =
            document.getElementById(
                'cameraStopBtn'
            );


        if(!yolo || !disconnect){
            return;
        }


        const wrapper =
            yolo.closest(
                '.camera-mode-options'
            );


        if(!wrapper || !wrapper.parentElement){
            return;
        }


        const host =
            wrapper.parentElement;


        /*
         * Hidden runtime strings were the reason the wrapper
         * occupied much more horizontal space than visible YOLO.
         */

        const yoloState =
            document.getElementById(
                'cameraYoloState'
            );


        const modeState =
            document.getElementById(
                'cameraModeState'
            );


        if(yoloState){
            yoloState.style.setProperty(
                'display',
                'none',
                'important'
            );
        }


        if(modeState){
            modeState.style.setProperty(
                'display',
                'none',
                'important'
            );
        }


        /*
         * Save its ACTUAL current Y before removing it from flex.
         */

        const originalRect =
            wrapper.getBoundingClientRect();


        /*
         * Remove every historical inline geometry value.
         */

        for(
            const property
            of [
                'left',
                'right',
                'top',
                'bottom',
                'transform',
                'margin-left',
                'margin-right'
            ]
        ){
            wrapper.style.removeProperty(
                property
            );
        }


        yolo.style.removeProperty(
            'left'
        );


        yolo.style.removeProperty(
            'right'
        );


        yolo.style.removeProperty(
            'transform'
        );


        if(
            getComputedStyle(host).position
            ===
            'static'
        ){
            host.style.setProperty(
                'position',
                'relative',
                'important'
            );
        }


        /*
         * Take wrapper out of the flex/grid fight completely.
         */

        wrapper.style.setProperty(
            'position',
            'absolute',
            'important'
        );


        wrapper.style.setProperty(
            'width',
            'max-content',
            'important'
        );


        wrapper.style.setProperty(
            'min-width',
            'max-content',
            'important'
        );


        wrapper.style.setProperty(
            'max-width',
            'max-content',
            'important'
        );


        wrapper.style.setProperty(
            'margin',
            '0',
            'important'
        );


        wrapper.style.setProperty(
            'transform',
            'none',
            'important'
        );


        /*
         * Establish a known origin.
         */

        wrapper.style.setProperty(
            'left',
            '0px',
            'important'
        );


        wrapper.style.setProperty(
            'top',
            '0px',
            'important'
        );


        void wrapper.offsetWidth;


        /*
         * Restore the exact previous vertical position.
         */

        let current =
            wrapper.getBoundingClientRect();


        const yCorrection =
            originalRect.top
            -
            current.top;


        wrapper.style.setProperty(
            'top',
            `${yCorrection.toFixed(2)}px`,
            'important'
        );


        void wrapper.offsetWidth;


        /*
         * Now place its RIGHT EDGE exactly on the right edge
         * of Disconnect.
         */

        current =
            wrapper.getBoundingClientRect();


        const disconnectRect =
            disconnect.getBoundingClientRect();


        const xCorrection =
            disconnectRect.right
            -
            current.right;


        wrapper.style.setProperty(
            'left',
            `${xCorrection.toFixed(2)}px`,
            'important'
        );


        console.debug(
            'V1.9.17 YOLO final',
            {
                yoloRight:
                    wrapper
                        .getBoundingClientRect()
                        .right,

                disconnectRight:
                    disconnectRect.right
            }
        );
    }


    /* ============================================================
       ARM OWNERSHIP — DIRECT STATIC DOM TARGET

       No .stitch-mode-section dependency.
       No text-search dependency.

       Move the WHOLE ownership-box so:
           ARM OWNERSHIP.top == MODE.top
       ============================================================ */

    function placeOwnershipV1917(){

        const box =
            document.querySelector(
                '#view-live .ownership-box'
            );


        if(!box){
            return;
        }


        const ownershipText =
            box.querySelector(
                ':scope > span'
            );


        const hero =
            box.closest(
                '.hero-state'
            )
            ||
            box.parentElement;


        const modeText =
            hero
            ? hero.querySelector(
                '.panel-kicker'
            )
            : null;


        if(
            !ownershipText
            ||
            !modeText
        ){
            return;
        }


        /*
         * Kill old inline movement on BOTH the text and box.
         */

        for(
            const element
            of [
                ownershipText,
                box
            ]
        ){
            for(
                const property
                of [
                    'top',
                    'bottom',
                    'transform'
                ]
            ){
                element.style.removeProperty(
                    property
                );
            }
        }


        void box.offsetWidth;


        const modeRect =
            modeText
                .getBoundingClientRect();


        const ownerRect =
            ownershipText
                .getBoundingClientRect();


        const yCorrection =
            modeRect.top
            -
            ownerRect.top;


        /*
         * Move the complete box:
         * ARM OWNERSHIP + its live dash/value move together.
         */

        box.style.setProperty(
            'position',
            'relative',
            'important'
        );


        box.style.setProperty(
            'transform',
            `translateY(${yCorrection.toFixed(2)}px)`,
            'important'
        );


        console.debug(
            'V1.9.17 ownership final',
            {
                modeTop:
                    modeRect.top,

                ownershipTopAfter:
                    ownershipText
                        .getBoundingClientRect()
                        .top,

                correction:
                    yCorrection
            }
        );
    }


    /* ============================================================
       INSTALL
       ============================================================ */

    function installShellV1917(){

        installEmblemV1917();

        installHeaderCenterV1917();
    }


    function installFinalGeometryV1917(){

        /*
         * This runs ONCE, after the historical Stitch RAF patches.
         *
         * It is intentionally delayed rather than continuously
         * rewriting the DOM.
         */

        requestAnimationFrame(
            ()=>{
                placeYoloV1917();
                placeOwnershipV1917();
            }
        );
    }


    if(
        document.readyState
        ===
        'loading'
    ){

        document.addEventListener(
            'DOMContentLoaded',
            installShellV1917,
            {
                once:
                    true
            }
        );

    }
    else{

        installShellV1917();
    }


    /*
     * One-time authoritative geometry pass.
     */

    window.setTimeout(
        installFinalGeometryV1917,
        650
    );

})();
