
(() => {
    "use strict";

    /*
     * D14E — visual transplant helper only.
     *
     * This file:
     *   - moves existing DOM nodes for the Stitch layout,
     *   - injects decorative SVG,
     *   - injects idle reticles.
     *
     * It performs NO network calls and installs NO
     * robot-control listeners.
     */

    const NS = "http://www.w3.org/2000/svg";

    const flourish = (flip=false) => `
        <svg class="rv-flourish${flip ? " flip" : ""}"
             fill="none" stroke="currentColor" viewBox="0 0 60 20"
             aria-hidden="true">
            <path d="M2 10 C 15 3, 30 18, 45 10 C 52 6, 58 10, 58 10"
                  stroke="#f59e0b" stroke-linecap="round"
                  stroke-width="1.2"/>
            <path d="M18 7 C 22 2, 28 4, 25 9"
                  fill="rgba(245,158,11,0.18)"
                  stroke="#f59e0b" stroke-width="1"/>
            <path d="M33 13 C 37 18, 43 16, 40 11"
                  fill="rgba(16,185,129,0.25)"
                  stroke="#10b981" stroke-width="1"/>
            <circle cx="5" cy="10" r="1.5" fill="#f59e0b"
                    stroke="none"/>
            <circle cx="58" cy="10" r="1.5" fill="#10b981"
                    stroke="none"/>
        </svg>
    `;

    const emblem = `
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

    const ornaments = {
        raw: `
            <svg class="rv-header-ornament" fill="none"
                 stroke="currentColor" viewBox="0 0 24 24"
                 aria-hidden="true">
                <path d="M12 2C12 2 13.8 6.2 16.5 7.5C19.2 8.8 22 8 22 8C22 8 20.8 11.2 18.5 13C16.2 14.8 15 18 15 18C15 18 13.5 15.5 12 15C10.5 15.5 9 18 9 18C9 18 7.8 14.8 5.5 13C3.2 11.2 2 8 2 8C2 8 4.8 8.8 7.5 7.5C10.2 6.2 12 2 12 2Z"
                      fill="rgba(245,158,11,.18)"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="1.2"/>
                <circle cx="12" cy="10" r="1.5"
                        fill="#34d399" stroke="none"/>
            </svg>`,
        sim: `
            <svg class="rv-header-ornament" fill="none"
                 stroke="currentColor" viewBox="0 0 24 24"
                 aria-hidden="true">
                <circle cx="12" cy="12" r="8"
                        stroke="rgba(245,158,11,.6)"
                        stroke-dasharray="2 2"
                        stroke-width="1.2"/>
                <path d="M12 4 L14 10 L20 12 L14 14 L12 20 L10 14 L4 12 L10 10 Z"
                      fill="rgba(245,158,11,.22)"
                      stroke="#f59e0b" stroke-width="1"/>
                <circle cx="12" cy="12" r="1.5"
                        fill="#10b981" stroke="none"/>
            </svg>`,
        keypoint: `
            <svg class="rv-header-ornament" fill="none"
                 stroke="currentColor" viewBox="0 0 24 24"
                 aria-hidden="true">
                <path d="M12 2C13 6 18 7 18 12C18 17 13 18 12 22C11 18 6 17 6 12C6 7 11 6 12 2Z"
                      fill="rgba(245,158,11,.18)"
                      stroke="#f59e0b" stroke-width="1.2"/>
                <circle cx="12" cy="12" r="1.8"
                        fill="#10b981" stroke="none"/>
                <circle cx="12" cy="5" r=".8"
                        fill="#f59e0b" stroke="none"/>
                <circle cx="12" cy="19" r=".8"
                        fill="#f59e0b" stroke="none"/>
            </svg>`,
        robot: `
            <svg class="rv-header-ornament" fill="none"
                 stroke="currentColor" viewBox="0 0 24 24"
                 aria-hidden="true">
                <path d="M7 17C7 17 8 13 12 11C16 9 17 5 17 5C17 5 15 9 11 11C7 13 7 17 7 17Z"
                      fill="rgba(245,158,11,.2)"
                      stroke="#f59e0b"
                      stroke-linecap="round"
                      stroke-width="1.4"/>
                <circle cx="12" cy="11" r="1.3"
                        fill="#34d399" stroke="none"/>
                <path d="M11 17C11 17 12 15 14 14"
                      stroke="#34d399" stroke-width="1"/>
            </svg>`
    };

    const reticles = {
        raw: `
            <div class="rv-reticle raw" aria-hidden="true">
                <svg class="rv-outer reticle-spin" fill="none"
                     stroke="#10b981" stroke-opacity=".35"
                     viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="47"
                            stroke-dasharray="3 4" stroke-width="1"/>
                    <circle cx="50" cy="50" r="41"
                            opacity=".6" stroke-width=".75"/>
                    <circle cx="50" cy="3" r="2"
                            fill="#f59e0b" stroke="none"/>
                    <circle cx="97" cy="50" r="2"
                            fill="#10b981" stroke="none"/>
                    <circle cx="50" cy="97" r="2"
                            fill="#f59e0b" stroke="none"/>
                    <circle cx="3" cy="50" r="2"
                            fill="#10b981" stroke="none"/>
                </svg>
                <svg class="rv-inner reticle-spin-rev" fill="none"
                     stroke="#f59e0b" stroke-opacity=".40"
                     viewBox="0 0 100 100">
                    <path d="M50 16 C42 32,32 42,50 68 C68 42,58 32,50 16 Z"
                          fill="rgba(245,158,11,.08)" stroke-width="1.2"/>
                    <path d="M16 50 C32 42,42 32,68 50 C42 68,32 58,16 50 Z"
                          fill="rgba(245,158,11,.08)" stroke-width="1.2"/>
                    <path d="M50 84 C42 68,32 58,50 32 C68 58,58 68,50 84 Z"
                          fill="rgba(245,158,11,.08)" stroke-width="1.2"/>
                    <path d="M84 50 C68 42,58 32,32 50 C58 68,68 58,84 50 Z"
                          fill="rgba(245,158,11,.08)" stroke-width="1.2"/>
                    <circle cx="50" cy="50" r="30" opacity=".7"
                            stroke-dasharray="1 3" stroke-width=".8"/>
                </svg>
                <div class="rv-reticle-core reticle-pulse">
                    <svg fill="none" stroke="currentColor"
                         viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="9"
                                stroke-dasharray="2 2"
                                stroke-width="1.2"/>
                        <path d="M12 7c-2 2.5-3 5-3 7 0 1.66 1.34 3 3 3s3-1.34 3-3c0-2-1-4.5-3-7z"
                              fill="rgba(52,211,153,.25)"
                              stroke-width="1.3"/>
                        <circle cx="12" cy="14" r="1.5"
                                fill="#34d399" stroke="none"/>
                    </svg>
                </div>
            </div>`,
        sim: `
            <div class="rv-reticle sim" aria-hidden="true">
                <svg class="rv-outer reticle-spin" fill="none"
                     stroke="#10b981" stroke-opacity=".35"
                     viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="46"
                            stroke-dasharray="4 3" stroke-width="1"/>
                    <rect x="23" y="23" width="54" height="54"
                          transform="rotate(45 50 50)"
                          stroke="rgba(16,185,129,.3)"
                          stroke-dasharray="3 3"
                          stroke-width="1.2"/>
                    <circle cx="50" cy="50" r="35"
                            opacity=".4" stroke-width=".8"/>
                </svg>
                <svg class="rv-inner reticle-spin-rev" fill="none"
                     stroke="#f59e0b" stroke-opacity=".40"
                     viewBox="0 0 100 100">
                    <rect x="27" y="27" width="46" height="46"
                          fill="rgba(245,158,11,.07)"
                          stroke-width="1.2"/>
                    <circle cx="50" cy="27" r="2.5" fill="#f59e0b"/>
                    <circle cx="73" cy="50" r="2.5" fill="#f59e0b"/>
                    <circle cx="50" cy="73" r="2.5" fill="#f59e0b"/>
                    <circle cx="27" cy="50" r="2.5" fill="#f59e0b"/>
                </svg>
                <div class="rv-reticle-core reticle-pulse">
                    <svg fill="none" stroke="currentColor"
                         stroke-width="1.5" viewBox="0 0 24 24">
                        <rect x="6" y="6" width="12" height="12"
                              transform="rotate(45 12 12)"
                              fill="rgba(16,185,129,.18)"
                              stroke-width="1.4"/>
                        <circle cx="12" cy="12" r="2.5"
                                fill="#34d399" stroke="none"/>
                    </svg>
                </div>
            </div>`,
        keypoint: `
            <div class="rv-reticle keypoint" aria-hidden="true">
                <svg class="rv-outer reticle-spin" fill="none"
                     stroke="#34d399" stroke-opacity=".40"
                     viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="46"
                            stroke-dasharray="2 4" stroke-width="1"/>
                    <circle cx="50" cy="14" r="3"
                            fill="#10b981" stroke="#34d399" stroke-width="1"/>
                    <circle cx="86" cy="50" r="3"
                            fill="#10b981" stroke="#34d399" stroke-width="1"/>
                    <circle cx="50" cy="86" r="3"
                            fill="#10b981" stroke="#34d399" stroke-width="1"/>
                    <circle cx="14" cy="50" r="3"
                            fill="#10b981" stroke="#34d399" stroke-width="1"/>
                    <line x1="50" y1="14" x2="86" y2="50"
                          opacity=".5" stroke-dasharray="2 3" stroke-width=".75"/>
                    <line x1="86" y1="50" x2="50" y2="86"
                          opacity=".5" stroke-dasharray="2 3" stroke-width=".75"/>
                    <line x1="50" y1="86" x2="14" y2="50"
                          opacity=".5" stroke-dasharray="2 3" stroke-width=".75"/>
                    <line x1="14" y1="50" x2="50" y2="14"
                          opacity=".5" stroke-dasharray="2 3" stroke-width=".75"/>
                </svg>
                <svg class="rv-inner reticle-spin-rev" fill="none"
                     stroke="#f59e0b" stroke-opacity=".45"
                     viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="32"
                            stroke-dasharray="3 3" stroke-width="1"/>
                    <circle cx="50" cy="24" r="2.2" fill="#f59e0b"/>
                    <circle cx="68" cy="32" r="2" fill="#fbbf24"/>
                    <circle cx="76" cy="50" r="2.2" fill="#f59e0b"/>
                    <circle cx="68" cy="68" r="2" fill="#fbbf24"/>
                    <circle cx="50" cy="76" r="2.2" fill="#f59e0b"/>
                    <circle cx="32" cy="68" r="2" fill="#fbbf24"/>
                    <circle cx="24" cy="50" r="2.2" fill="#f59e0b"/>
                    <circle cx="32" cy="32" r="2" fill="#fbbf24"/>
                </svg>
                <div class="rv-reticle-core reticle-pulse">
                    <svg fill="none" stroke="currentColor"
                         viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="22"
                                stroke-dasharray="2 2"
                                stroke-width="1.5"/>
                        <circle cx="50" cy="50" r="6"
                                fill="#34d399" stroke="none"/>
                        <circle cx="50" cy="50" r="11"
                                fill="none" stroke="#10b981"
                                stroke-width="2"/>
                    </svg>
                </div>
            </div>`,
        robot: `
            <div class="rv-reticle robot" aria-hidden="true">
                <svg class="rv-outer reticle-spin" fill="none"
                     stroke="#10b981" stroke-opacity=".35"
                     viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="47"
                            stroke-dasharray="5 3" stroke-width="1"/>
                    <circle cx="50" cy="50" r="42"
                            opacity=".5" stroke-width=".8"/>
                    <path d="M50 8 L50 20 M92 50 L80 50 M50 92 L50 80 M8 50 L20 50"
                          stroke="#f59e0b" stroke-width="1.5"/>
                    <path d="M20 20 L28 28 M80 20 L72 28 M80 80 L72 72 M20 80 L28 72"
                          stroke="#10b981" stroke-width="1.2"/>
                </svg>
                <svg class="rv-inner reticle-spin-rev" fill="none"
                     stroke="#f59e0b" stroke-opacity=".40"
                     viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="34"
                            stroke-dasharray="2 3"
                            stroke-width="1.2"/>
                    <circle cx="50" cy="18" r="2.2" fill="#10b981"/>
                    <circle cx="78" cy="36" r="2" fill="#f59e0b"/>
                    <circle cx="78" cy="64" r="2" fill="#f59e0b"/>
                    <circle cx="50" cy="82" r="2.2" fill="#10b981"/>
                    <circle cx="22" cy="64" r="2" fill="#f59e0b"/>
                    <circle cx="22" cy="36" r="2" fill="#f59e0b"/>
                </svg>
                <div class="rv-reticle-core reticle-pulse">
                    <svg fill="none" stroke="currentColor"
                         stroke-width="1.5" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="8"
                                stroke-dasharray="2 2"
                                stroke-width="1.2"/>
                        <circle cx="12" cy="12" r="4.5"
                                fill="rgba(16,185,129,.2)"
                                stroke="none"/>
                        <circle cx="12" cy="12" r="2.2"
                                fill="#34d399" stroke="none"/>
                    </svg>
                </div>
            </div>`
    };

    function kindFromText(value) {
        const text = String(value || "").trim().toUpperCase();
        if (text.includes("RAW CAMERA")) return "raw";
        if (text.includes("KEYPOINT")) return "keypoint";
        if (text.includes("SIMULATION") || text.includes("MUJOCO")) return "sim";
        if (text.includes("ROBOT CAMERA")) return "robot";
        return null;
    }

    function makeBrand(topbar) {
        if (!topbar || topbar.querySelector(".rv-brand-cluster")) return;

        const sidebar = document.querySelector(".sidebar");
        const brand = sidebar?.querySelector(".brand") || document.querySelector(".brand");
        const footer = sidebar?.querySelector(".sidebar-footer") || document.querySelector(".sidebar-footer");

        const cluster = document.createElement("div");
        cluster.className = "rv-brand-cluster";
        cluster.innerHTML = emblem;

        const text = document.createElement("div");
        text.className = "rv-brand-copy";

        if (brand) text.appendChild(brand);
        if (footer) text.appendChild(footer);

        cluster.appendChild(text);
        topbar.prepend(cluster);
    }

    function makeCenterTitle(topbar) {
        if (!topbar || topbar.querySelector(".rv-center-title")) return;

        const title = document.getElementById("pageTitle");
        if (!title) return;

        const oldParent = title.parentElement;

        const center = document.createElement("div");
        center.className = "rv-center-title";
        center.innerHTML = flourish(false) + '<span class="rv-title-dot"></span>';
        center.appendChild(title);
        center.insertAdjacentHTML("beforeend", flourish(true));

        topbar.appendChild(center);

        if (
            oldParent &&
            oldParent !== topbar &&
            oldParent !== center &&
            oldParent.children.length === 0 &&
            !oldParent.textContent.trim()
        ) {
            oldParent.remove();
        }
    }

    function addNavIcons() {
        for (const button of document.querySelectorAll(".nav-item")) {
            if (button.querySelector(".rv-nav-icon")) continue;
            const text = button.textContent.trim().toLowerCase();
            const wrap = document.createElement("span");
            wrap.className = "rv-nav-icon";
            wrap.innerHTML = text.includes("log")
                ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2zm0-4H7V7h10v2zm-4 8H7v-2h6v2z"/></svg>'
                : '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M13 2L3 14h8l-2 8 10-12h-8l2-8z"/></svg>';
            button.prepend(wrap);
        }
    }

    function headerTarget(tile) {
        return tile.querySelector(
            ".workspace-tile-header, .panel-header, .camera-feed-label"
        );
    }

    function addHeaderOrnament(tile, kind) {
        const header = headerTarget(tile);
        if (!header || header.querySelector(".rv-header-ornament")) return;

        const label = header.querySelector("strong, h2, span");
        if (!label) return;

        label.insertAdjacentHTML("afterend", ornaments[kind]);
    }

    function addReticle(tile, kind) {
        const placeholder = tile.querySelector(
            ".camera-placeholder, .unified-preview-placeholder, .robot-camera-placeholder"
        );

        if (!placeholder || placeholder.querySelector(".rv-reticle")) return;
        placeholder.insertAdjacentHTML("afterbegin", reticles[kind]);
    }

    function decorateTiles() {
        const tiles = document.querySelectorAll(
            "#mediaWorkspace > *, .workspace-tile, .camera-feed, .mujoco-panel, .robot-camera-panel"
        );

        for (const tile of tiles) {
            const header = headerTarget(tile);
            const kind = kindFromText(header?.textContent || tile.textContent);
            if (!kind) continue;
            addHeaderOrnament(tile, kind);
            addReticle(tile, kind);
        }

        const direct = [
            ["#rawCameraPlaceholder", "raw"],
            ["#cameraPlaceholder", "keypoint"],
        ];

        for (const [selector, kind] of direct) {
            const placeholder = document.querySelector(selector);
            if (placeholder && !placeholder.querySelector(".rv-reticle")) {
                placeholder.insertAdjacentHTML("afterbegin", reticles[kind]);
            }
        }
    }

    function moveTopbar() {
        const shell = document.querySelector(".app-shell");
        const topbar = document.querySelector(".topbar");
        if (!shell || !topbar) return null;

        if (topbar.parentElement !== shell) {
            shell.prepend(topbar);
        }

        return topbar;
    }

    function apply() {
        document.body.classList.add("reference-stitch");

        const topbar = moveTopbar();
        makeBrand(topbar);
        makeCenterTitle(topbar);
        /* D14G: Live / Logs intentionally have no icons. */
        decorateTiles();
    }

    let queued = false;

    function queueApply() {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            apply();
        });
    }

    function init() {
        apply();

        const observer = new MutationObserver(queueApply);
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        window.addEventListener("load", queueApply, { once: true });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();

// D14G_OFF_STATUS_VISUAL_NORMALIZER
(() => {
    "use strict";

    /*
     * Presentation only:
     * marks sidebar text whose displayed value is literally OFF.
     * No API/network calls.
     * No click/drag/control listeners.
     */

    function syncOffStatusVisuals() {
        const nodes =
            document.querySelectorAll(
                ".sidebar strong, .sidebar span"
            );

        for (const node of nodes) {
            const value =
                String(
                    node.textContent || ""
                )
                .trim()
                .toUpperCase();

            node.classList.toggle(
                "rv-status-off",
                value === "OFF"
            );
        }
    }

    let queued =
        false;

    function queueSync() {
        if (queued) {
            return;
        }

        queued =
            true;

        requestAnimationFrame(
            () => {
                queued =
                    false;

                syncOffStatusVisuals();
            }
        );
    }

    if (
        document.readyState
        === "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            queueSync,
            {
                once: true,
            }
        );
    }

    else {
        queueSync();
    }

    const observer =
        new MutationObserver(
            queueSync
        );

    observer.observe(
        document.body,
        {
            childList: true,
            subtree: true,
            characterData: true,
        }
    );
})();
