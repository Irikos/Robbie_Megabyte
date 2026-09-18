(() => {
    "use strict";

    const RETICLES = {
        rgb: `
            <div class="stitch-idle-reticle stitch-lidar-idle-v156">

                <div class="stitch-reticle-stage">

                    <svg
                        class="stitch-reticle-svg stitch-lidar-svg-v156"
                        viewBox="0 0 100 100"
                        aria-hidden="true"
                    >

                        <!--
                            G1-style hemispherical LiDAR silhouette
                        -->

                        <!-- OUTER DOME -->
                        <path
                            d="M16 61 A34 34 0 0 1 84 61"
                            fill="rgba(16,185,129,.018)"
                            stroke="#10b981"
                            stroke-width="1"
                            stroke-opacity=".70"
                        />

                        <!-- RANGE ARCS -->
                        <path
                            d="M25 61 A25 25 0 0 1 75 61"
                            fill="none"
                            stroke="#22c55e"
                            stroke-width=".7"
                            stroke-opacity=".42"
                        />

                        <path
                            d="M34 61 A16 16 0 0 1 66 61"
                            fill="none"
                            stroke="#f59e0b"
                            stroke-width=".7"
                            stroke-opacity=".46"
                        />


                        <!-- DOME BASE -->
                        <path
                            d="M15 61 H85"
                            stroke="#86efac"
                            stroke-width=".8"
                            stroke-opacity=".48"
                        />


                        <!-- SENSOR BODY -->
                        <path
                            d="
                                M41 61
                                C42 54 45 50 50 50
                                C55 50 58 54 59 61
                                Z
                            "
                            fill="#111814"
                            stroke="#10b981"
                            stroke-width=".8"
                        />

                        <ellipse
                            cx="50"
                            cy="59"
                            rx="5.2"
                            ry="2.8"
                            fill="rgba(245,158,11,.11)"
                            stroke="#f59e0b"
                            stroke-width=".8"
                        />

                        <circle
                            cx="50"
                            cy="59"
                            r="1.5"
                            fill="#fbbf24"
                        />


                        <!-- SWEEP BEAM -->
                        <g class="stitch-lidar-dome-sweep-v156">

                            <path
                                d="
                                    M50 59
                                    L29 31
                                    A34 34 0 0 1 36 27
                                    Z
                                "
                                fill="rgba(97,227,173,.060)"
                                stroke="#61e3ad"
                                stroke-width=".55"
                                stroke-opacity=".70"
                            />

                            <line
                                x1="50"
                                y1="59"
                                x2="32"
                                y2="29"
                                stroke="#a1d494"
                                stroke-width="1.15"
                                stroke-linecap="round"
                            />

                        </g>


                        <!-- DETECTED RETURNS ON HEMISPHERE -->
                        <g>

                            <circle
                                class="stitch-lidar-return-v156"
                                style="--lidar-d:0s"
                                cx="24"
                                cy="48"
                                r="1.8"
                                fill="#22c55e"
                            />

                            <circle
                                class="stitch-lidar-return-v156"
                                style="--lidar-d:.26s"
                                cx="31"
                                cy="36"
                                r="1.7"
                                fill="#fbbf24"
                            />

                            <circle
                                class="stitch-lidar-return-v156"
                                style="--lidar-d:.52s"
                                cx="43"
                                cy="29"
                                r="1.9"
                                fill="#86efac"
                            />

                            <circle
                                class="stitch-lidar-return-v156"
                                style="--lidar-d:.78s"
                                cx="58"
                                cy="29"
                                r="1.7"
                                fill="#22c55e"
                            />

                            <circle
                                class="stitch-lidar-return-v156"
                                style="--lidar-d:1.04s"
                                cx="71"
                                cy="37"
                                r="1.9"
                                fill="#f59e0b"
                            />

                            <circle
                                class="stitch-lidar-return-v156"
                                style="--lidar-d:1.30s"
                                cx="78"
                                cy="50"
                                r="1.7"
                                fill="#86efac"
                            />

                        </g>


                        <!-- LOWER HOUSING -->
                        <path
                            d="
                                M36 61
                                H64
                                L60 70
                                H40
                                Z
                            "
                            fill="rgba(16,185,129,.022)"
                            stroke="#10b981"
                            stroke-width=".7"
                            stroke-opacity=".55"
                        />

                    </svg>

                </div>

                <span class="stitch-idle-label">
                    RGB stream idle
                </span>

            </div>
`,

        depth: `
            <div class="stitch-idle-reticle stitch-depth-idle-v154">
                <div class="stitch-reticle-stage">

                    <svg
                        class="stitch-reticle-svg stitch-depth-svg-v154"
                        viewBox="0 0 100 100"
                        aria-hidden="true"
                    >

                        <!-- range axis -->
                        <path
                            d="M50 13 V87"
                            stroke="#10b981"
                            stroke-width=".7"
                            stroke-opacity=".36"
                            stroke-dasharray="2 4"
                        />


                        <!-- depth planes -->
                        <polygon
                            class="stitch-depth-plane-v154"
                            style="--depth-delay:0s"
                            points="39,25 61,25 68,31 32,31"
                            fill="rgba(16,185,129,.04)"
                            stroke="#10b981"
                            stroke-width=".75"
                        />

                        <polygon
                            class="stitch-depth-plane-v154"
                            style="--depth-delay:.28s"
                            points="34,36 66,36 75,44 25,44"
                            fill="rgba(34,197,94,.035)"
                            stroke="#22c55e"
                            stroke-width=".8"
                        />

                        <polygon
                            class="stitch-depth-plane-v154"
                            style="--depth-delay:.56s"
                            points="29,49 71,49 81,59 19,59"
                            fill="rgba(245,158,11,.025)"
                            stroke="#f59e0b"
                            stroke-width=".85"
                        />

                        <polygon
                            class="stitch-depth-plane-v154"
                            style="--depth-delay:.84s"
                            points="24,63 76,63 86,75 14,75"
                            fill="rgba(134,239,172,.018)"
                            stroke="#86efac"
                            stroke-width=".75"
                        />


                        <!-- travelling range sample -->
                        <g class="stitch-depth-probe-v154">
                            <circle
                                cx="50" cy="22" r="4.5"
                                fill="#f59e0b"
                                fill-opacity=".16"
                                stroke="#fbbf24"
                                stroke-width=".8"
                            />
                            <circle
                                cx="50" cy="22" r="1.8"
                                fill="#f59e0b"
                            />
                        </g>


                        <g
                            stroke="#86efac"
                            stroke-width=".65"
                            stroke-opacity=".5"
                        >
                            <path d="M43 20 H47"/>
                            <path d="M43 35 H47"/>
                            <path d="M43 50 H47"/>
                            <path d="M43 65 H47"/>
                            <path d="M43 80 H47"/>
                        </g>

                    </svg>
                </div>

                <span class="stitch-idle-label">
                    Depth stream idle
                </span>
            </div>
`,

        overlay: `
            <div class="stitch-idle-reticle stitch-fusion-idle-v154">
                <div class="stitch-reticle-stage">

                    <svg
                        class="stitch-reticle-svg stitch-fusion-svg-v154"
                        viewBox="0 0 100 100"
                        aria-hidden="true"
                    >

                        <!-- RGB layer -->
                        <g class="stitch-fusion-rgb-v154">

                            <rect
                                x="18" y="26"
                                width="48" height="48"
                                rx="5"
                                fill="rgba(34,197,94,.025)"
                                stroke="#22c55e"
                                stroke-width="1"
                            />

                            <circle
                                cx="42" cy="50" r="11"
                                fill="none"
                                stroke="#86efac"
                                stroke-width=".8"
                            />

                            <circle
                                cx="42" cy="50" r="3"
                                fill="#22c55e"
                            />

                        </g>


                        <!-- depth layer -->
                        <g class="stitch-fusion-depth-v154">

                            <rect
                                x="34" y="26"
                                width="48" height="48"
                                rx="5"
                                fill="rgba(245,158,11,.022)"
                                stroke="#f59e0b"
                                stroke-width="1"
                            />

                            <path
                                d="M58 38 L70 50 L58 62 L46 50 Z"
                                fill="none"
                                stroke="#fbbf24"
                                stroke-width=".9"
                            />

                            <circle
                                cx="58" cy="50" r="2.5"
                                fill="#f59e0b"
                            />

                        </g>


                        <!-- fusion lock -->
                        <g class="stitch-fusion-lock-v154">

                            <circle
                                cx="50" cy="50" r="18"
                                fill="none"
                                stroke="#61e3ad"
                                stroke-width=".8"
                                stroke-opacity=".5"
                            />

                            <circle
                                cx="50" cy="50" r="7"
                                fill="rgba(97,227,173,.055)"
                                stroke="#a1d494"
                                stroke-width=".8"
                            />

                            <path
                                d="M46 50 H54 M50 46 V54"
                                stroke="#a1d494"
                                stroke-width="1.15"
                                stroke-linecap="round"
                            />

                        </g>

                    </svg>
                </div>

                <span class="stitch-idle-label">
                    RGB + depth idle
                </span>
            </div>
`,

        lifecam: `
            <div class="stitch-idle-reticle stitch-externalcam-idle-v154">
                <div class="stitch-reticle-stage">

                    <svg
                        class="stitch-reticle-svg stitch-externalcam-svg-v154"
                        viewBox="0 0 100 100"
                        aria-hidden="true"
                    >

                        <!-- webcam body -->
                        <rect
                            x="27" y="22"
                            width="46" height="46"
                            rx="12"
                            fill="rgba(16,185,129,.018)"
                            stroke="#10b981"
                            stroke-width=".9"
                            stroke-opacity=".65"
                        />


                        <!-- lens -->
                        <circle
                            cx="50" cy="45" r="15"
                            fill="none"
                            stroke="#86efac"
                            stroke-width=".9"
                        />

                        <circle
                            class="stitch-externalcam-lens-v154"
                            cx="50" cy="45" r="9"
                            fill="rgba(245,158,11,.045)"
                            stroke="#f59e0b"
                            stroke-width=".9"
                        />

                        <circle
                            cx="50" cy="45" r="3"
                            fill="#f59e0b"
                        />


                        <!-- webcam stand -->
                        <path
                            d="M43 68 V76 H57 V68"
                            fill="none"
                            stroke="#86efac"
                            stroke-width=".9"
                        />

                        <path
                            d="M37 78 H63"
                            stroke="#86efac"
                            stroke-width="1"
                            stroke-linecap="round"
                        />


                        <!-- autofocus -->
                        <g
                            class="stitch-externalcam-focus-v154"
                            fill="none"
                            stroke="#61e3ad"
                            stroke-width="1"
                            stroke-linecap="round"
                        >
                            <path d="M20 31 V20 H31"/>
                            <path d="M69 20 H80 V31"/>
                            <path d="M20 59 V70 H31"/>
                            <path d="M69 70 H80 V59"/>
                        </g>


                        <!-- activity LED -->
                        <circle
                            class="stitch-externalcam-led-v154"
                            cx="67" cy="29" r="2.2"
                            fill="#22c55e"
                        />


                        <!-- exposure scan -->
                        <g class="stitch-externalcam-scan-v154">
                            <line
                                x1="31" y1="28"
                                x2="69" y2="28"
                                stroke="#86efac"
                                stroke-width=".75"
                                stroke-opacity=".5"
                            />
                        </g>

                    </svg>
                </div>

                <span class="stitch-idle-label">
                    External cam idle
                </span>
            </div>
`
    };

    /* STITCH_RETICLES_V156
       LiDAR is now a physical half-dome scanner.
       Point-cloud XYZ axes breathe along cube edges.
    */

    /* STITCH_RETICLES_V155
       RGB idle now uses a LiDAR-style ranging scanner.
       Point Cloud axes now follow actual cube edges.
    */

    /* STITCH_RETICLES_V154
       RGB / Depth / RGB+Depth / External Cam use
       function-specific idle models.
    */

    /* STITCH_RETICLES_V152

       The original helper aliased both Disparity and Point Cloud to
       Depth. They now have their own feed-specific idle models.
    */

    /* ============================================================
       STITCH_RETICLES_V153

       DEPTH
           keeps its rotating layered-depth instrument.

       DISPARITY
           becomes a stereo correspondence scanner.
           NO whole-model rotation.

       POINT CLOUD
           becomes a perspective XYZ volume with independently
           pulsing/drifting points and a moving scan plane.
           NO whole-model rotation.
       ============================================================ */


    RETICLES.disparity = `
        <div class="stitch-idle-reticle stitch-disparity-idle-v153">

            <div class="stitch-reticle-stage">

                <svg
                    class="stitch-reticle-svg stitch-disparity-svg-v153"
                    viewBox="0 0 100 100"
                    aria-hidden="true"
                >

                    <!-- LEFT IMAGE PLANE -->
                    <rect
                        x="10"
                        y="22"
                        width="31"
                        height="56"
                        rx="4"
                        fill="rgba(16,185,129,.025)"
                        stroke="#10b981"
                        stroke-width="1"
                        stroke-opacity=".62"
                    />

                    <!-- RIGHT IMAGE PLANE -->
                    <rect
                        x="59"
                        y="22"
                        width="31"
                        height="56"
                        rx="4"
                        fill="rgba(245,158,11,.025)"
                        stroke="#f59e0b"
                        stroke-width="1"
                        stroke-opacity=".62"
                    />

                    <!-- SENSOR/LENS MARKERS -->
                    <circle
                        cx="25.5"
                        cy="34"
                        r="6"
                        fill="none"
                        stroke="#4ade80"
                        stroke-width=".8"
                        stroke-opacity=".55"
                    />

                    <circle
                        cx="74.5"
                        cy="34"
                        r="6"
                        fill="none"
                        stroke="#fbbf24"
                        stroke-width=".8"
                        stroke-opacity=".55"
                    />

                    <circle
                        cx="25.5"
                        cy="34"
                        r="2"
                        fill="#22c55e"
                    />

                    <circle
                        cx="74.5"
                        cy="34"
                        r="2"
                        fill="#f59e0b"
                    />


                    <!-- MOVING STEREO SCAN BEAMS -->
                    <g class="stitch-disparity-sweep-v153">

                        <line
                            x1="13"
                            y1="28"
                            x2="38"
                            y2="28"
                            stroke="#86efac"
                            stroke-width="1.5"
                            stroke-linecap="round"
                        />

                        <line
                            x1="62"
                            y1="28"
                            x2="87"
                            y2="28"
                            stroke="#fbbf24"
                            stroke-width="1.5"
                            stroke-linecap="round"
                        />

                    </g>


                    <!-- CORRESPONDENCE PATHS -->
                    <g
                        class="stitch-disparity-links-v153"
                        fill="none"
                        stroke="#a1d494"
                        stroke-width=".75"
                        stroke-dasharray="3 4"
                        stroke-opacity=".72"
                    >

                        <path d="M31 45 C43 42 57 42 69 45"/>
                        <path d="M28 53 C43 48 57 48 72 53"/>
                        <path d="M33 61 C44 58 56 58 67 61"/>
                        <path d="M24 69 C42 63 58 63 76 69"/>

                    </g>


                    <!-- DISPARITY OFFSET INDICATOR -->
                    <g
                        class="stitch-disparity-offset-v153"
                        fill="none"
                        stroke="#f59e0b"
                        stroke-width="1.3"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >

                        <path d="M43 51 H57"/>
                        <path d="M47 47 L43 51 L47 55"/>
                        <path d="M53 47 L57 51 L53 55"/>

                    </g>

                </svg>

            </div>

            <span class="stitch-idle-label">
                Disparity idle
            </span>

        </div>
    `;


    RETICLES.pointcloud = `
        <div class="stitch-idle-reticle stitch-pointcloud-idle-v156">

            <div class="stitch-reticle-stage">

                <svg
                    class="stitch-reticle-svg stitch-pointcloud-svg-v156"
                    viewBox="0 0 100 100"
                    aria-hidden="true"
                >

                    <!-- CUBE -->
                    <g
                        fill="none"
                        stroke="#10b981"
                        stroke-width=".7"
                        stroke-opacity=".34"
                    >
                        <path d="M25 28 L60 20 L80 36 L43 46 Z"/>
                        <path d="M25 28 L25 63"/>
                        <path d="M43 46 L43 80"/>
                        <path d="M80 36 L80 68"/>
                        <path d="M60 20 L60 54"/>
                        <path d="M25 63 L43 80 L80 68 L60 54 Z"/>
                        <path d="M25 63 L60 54"/>
                        <path d="M43 80 L80 68"/>
                    </g>


                    <!--
                        BREATHING XYZ AXES

                        Origin remains physically attached to cube corner:
                        43,80
                    -->

                    <!-- X AXIS -->
                    <g class="stitch-pc-axis-x-v156">

                        <path
                            d="M43 80 L80 68"
                            stroke="#f59e0b"
                            stroke-width="1.5"
                            stroke-linecap="round"
                        />

                        <circle
                            cx="80"
                            cy="68"
                            r="1.7"
                            fill="#f59e0b"
                        />

                        <text
                            x="83"
                            y="69"
                            fill="#f59e0b"
                            font-family="monospace"
                            font-size="6"
                            font-weight="700"
                        >X</text>

                    </g>


                    <!-- Y AXIS -->
                    <g class="stitch-pc-axis-y-v156">

                        <path
                            d="M43 80 L25 63"
                            stroke="#86efac"
                            stroke-width="1.5"
                            stroke-linecap="round"
                        />

                        <circle
                            cx="25"
                            cy="63"
                            r="1.7"
                            fill="#86efac"
                        />

                        <text
                            x="18"
                            y="63"
                            fill="#86efac"
                            font-family="monospace"
                            font-size="6"
                            font-weight="700"
                        >Y</text>

                    </g>


                    <!-- Z AXIS -->
                    <g class="stitch-pc-axis-z-v156">

                        <path
                            d="M43 80 L43 46"
                            stroke="#22c55e"
                            stroke-width="1.5"
                            stroke-linecap="round"
                        />

                        <circle
                            cx="43"
                            cy="46"
                            r="1.7"
                            fill="#22c55e"
                        />

                        <text
                            x="40"
                            y="41"
                            fill="#22c55e"
                            font-family="monospace"
                            font-size="6"
                            font-weight="700"
                        >Z</text>

                    </g>


                    <!-- ORIGIN -->
                    <circle
                        cx="43"
                        cy="80"
                        r="1.9"
                        fill="#e2e2e2"
                    />


                    <!-- SCAN PLANE -->
                    <polygon
                        class="stitch-pointcloud-scan-v156"
                        points="29,37 62,29 75,39 41,48"
                        fill="rgba(97,227,173,.05)"
                        stroke="#61e3ad"
                        stroke-width=".7"
                        stroke-opacity=".60"
                    />


                    <!-- POINTS -->
                    <circle class="stitch-pointcloud-dot-v156"
                        style="--pc-d:0s;--pc-x:2px;--pc-y:-2px"
                        cx="32" cy="39" r="1.8" fill="#86efac"/>

                    <circle class="stitch-pointcloud-dot-v156"
                        style="--pc-d:.23s;--pc-x:-2px;--pc-y:1px"
                        cx="46" cy="32" r="1.6" fill="#fbbf24"/>

                    <circle class="stitch-pointcloud-dot-v156"
                        style="--pc-d:.46s;--pc-x:1px;--pc-y:2px"
                        cx="58" cy="30" r="1.8" fill="#22c55e"/>

                    <circle class="stitch-pointcloud-dot-v156"
                        style="--pc-d:.69s;--pc-x:-1px;--pc-y:-2px"
                        cx="69" cy="39" r="1.5" fill="#f59e0b"/>

                    <circle class="stitch-pointcloud-dot-v156"
                        style="--pc-d:.92s;--pc-x:2px;--pc-y:1px"
                        cx="38" cy="50" r="1.7" fill="#22c55e"/>

                    <circle class="stitch-pointcloud-dot-v156"
                        style="--pc-d:1.15s;--pc-x:-2px;--pc-y:2px"
                        cx="52" cy="47" r="1.9" fill="#86efac"/>

                    <circle class="stitch-pointcloud-dot-v156"
                        style="--pc-d:1.38s;--pc-x:2px;--pc-y:2px"
                        cx="65" cy="50" r="1.5" fill="#fbbf24"/>

                    <circle class="stitch-pointcloud-dot-v156"
                        style="--pc-d:1.61s;--pc-x:-2px;--pc-y:-2px"
                        cx="32" cy="61" r="1.6" fill="#f59e0b"/>

                    <circle class="stitch-pointcloud-dot-v156"
                        style="--pc-d:1.84s;--pc-x:1px;--pc-y:-2px"
                        cx="47" cy="62" r="1.8" fill="#86efac"/>

                    <circle class="stitch-pointcloud-dot-v156"
                        style="--pc-d:2.07s;--pc-x:2px;--pc-y:-1px"
                        cx="60" cy="59" r="1.5" fill="#22c55e"/>

                    <circle class="stitch-pointcloud-dot-v156"
                        style="--pc-d:2.30s;--pc-x:-2px;--pc-y:2px"
                        cx="72" cy="61" r="1.7" fill="#fbbf24"/>

                </svg>

            </div>

            <span class="stitch-idle-label">
                Point cloud idle
            </span>

        </div>
`;



    /* ============================================================
       STITCH_G1_RGB_CAMERA_V166

       Realsense RGB now visually represents an embedded G1 camera
       module rather than a LiDAR/ranging instrument.

       This overrides only RETICLES.rgb before installation.
       ============================================================ */

    RETICLES.rgb = `
        <div class="stitch-idle-reticle stitch-g1rgb-idle-v166">

            <div class="stitch-reticle-stage">

                <svg
                    class="stitch-reticle-svg stitch-g1rgb-svg-v166"
                    viewBox="0 0 100 100"
                    aria-hidden="true"
                >

                    <!-- compact embedded camera housing -->
                    <path
                        d="M30 32 L36 26 H64 L70 32"
                        fill="none"
                        stroke="#10b981"
                        stroke-width=".8"
                        stroke-opacity=".46"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    />

                    <rect
                        x="20"
                        y="32"
                        width="60"
                        height="36"
                        rx="8"
                        fill="rgba(16,185,129,.018)"
                        stroke="#10b981"
                        stroke-width=".9"
                        stroke-opacity=".72"
                    />

                    <!-- small stereo / sensor windows -->
                    <rect
                        x="26"
                        y="43"
                        width="10"
                        height="14"
                        rx="3"
                        fill="rgba(16,185,129,.035)"
                        stroke="#10b981"
                        stroke-width=".7"
                        stroke-opacity=".55"
                    />

                    <circle
                        cx="31"
                        cy="50"
                        r="2.3"
                        fill="#10b981"
                        fill-opacity=".28"
                        stroke="#86efac"
                        stroke-width=".55"
                    />

                    <rect
                        x="64"
                        y="43"
                        width="10"
                        height="14"
                        rx="3"
                        fill="rgba(245,158,11,.025)"
                        stroke="#f59e0b"
                        stroke-width=".7"
                        stroke-opacity=".55"
                    />

                    <circle
                        cx="69"
                        cy="50"
                        r="2.3"
                        fill="#f59e0b"
                        fill-opacity=".22"
                        stroke="#fbbf24"
                        stroke-width=".55"
                    />


                    <!-- central RGB lens -->
                    <circle
                        cx="50"
                        cy="50"
                        r="12"
                        fill="rgba(16,185,129,.025)"
                        stroke="#10b981"
                        stroke-width="1"
                        stroke-opacity=".8"
                    />

                    <circle
                        cx="50"
                        cy="50"
                        r="8"
                        fill="rgba(245,158,11,.025)"
                        stroke="#f59e0b"
                        stroke-width=".8"
                        stroke-opacity=".72"
                    />

                    <circle
                        cx="50"
                        cy="50"
                        r="3.2"
                        fill="#f59e0b"
                        fill-opacity=".72"
                    />


                    <!-- animated aperture -->
                    <g
                        class="stitch-g1rgb-aperture-v166"
                        fill="none"
                        stroke="#86efac"
                        stroke-width=".72"
                        stroke-opacity=".62"
                        stroke-linejoin="round"
                    >
                        <path d="M50 39 L55 47 L50 50"/>
                        <path d="M61 50 L53 55 L50 50"/>
                        <path d="M50 61 L45 53 L50 50"/>
                        <path d="M39 50 L47 45 L50 50"/>
                    </g>


                    <!-- focus brackets -->
                    <g
                        class="stitch-g1rgb-focus-v166"
                        fill="none"
                        stroke="#a1d494"
                        stroke-width=".9"
                        stroke-linecap="round"
                        stroke-opacity=".75"
                    >
                        <path d="M39 39 H34 V44"/>
                        <path d="M61 39 H66 V44"/>
                        <path d="M39 61 H34 V56"/>
                        <path d="M61 61 H66 V56"/>
                    </g>


                    <!-- sensor exposure sweep -->
                    <g
                        class="stitch-g1rgb-scan-v166"
                    >
                        <line
                            x1="24"
                            y1="50"
                            x2="76"
                            y2="50"
                            stroke="#86efac"
                            stroke-width=".7"
                            stroke-opacity=".48"
                        />

                        <line
                            x1="29"
                            y1="52"
                            x2="71"
                            y2="52"
                            stroke="#10b981"
                            stroke-width=".45"
                            stroke-opacity=".24"
                        />
                    </g>


                    <!-- tiny status LED -->
                    <circle
                        class="stitch-g1rgb-led-v166"
                        cx="75"
                        cy="37"
                        r="1.8"
                        fill="#22c55e"
                    />


                    <!-- mounting/base hint -->
                    <path
                        d="M39 69 H61 M44 69 V74 H56 V69"
                        fill="none"
                        stroke="#10b981"
                        stroke-width=".7"
                        stroke-opacity=".38"
                        stroke-linecap="round"
                    />

                </svg>

            </div>

            <span class="stitch-idle-label">
                RGB stream idle
            </span>

        </div>
    `;


    function installCameraReticles() {
        document
            .querySelectorAll("[data-camera-view-tile]")
            .forEach(tile => {
                const overlay =
                    tile.querySelector(".camera-tile-overlay");

                if (!overlay) {
                    return;
                }

                if (
                    overlay.querySelector(
                        ".stitch-idle-reticle"
                    )
                ) {
                    return;
                }

                const id =
                    tile.dataset.cameraViewTile || "rgb";

                overlay.insertAdjacentHTML(
                    "afterbegin",
                    RETICLES[id] || RETICLES.rgb
                );
            });
    }

    function syncCameraLiveStates() {
        document
            .querySelectorAll("[data-camera-view-tile]")
            .forEach(tile => {
                const state =
                    tile.querySelector(
                        ".camera-tile-state"
                    );

                if (!state) {
                    return;
                }

                const live =
                    state.classList.contains("good")
                    || /LIVE|CONNECTED|STREAMING/i.test(
                        state.textContent || ""
                    );

                if (
                    tile.classList.contains("stitch-camera-live") !== live
                ) {
                    tile.classList.toggle("stitch-camera-live", live);
                }
            });
    }

    function mirrorTone(source, target) {
        if (!source || !target) return;

        const tone = source.classList.contains("good")
            ? "good"
            : source.classList.contains("bad") ? "bad" : "warn";

        for (const name of ["good", "warn", "bad"]) {
            const wanted = name === tone;
            if (target.classList.contains(name) !== wanted) {
                target.classList.toggle(name, wanted);
            }
        }
    }

    function cleanRuntimeText(
        value,
        fallback
    ) {
        const text =
            String(value || "")
                .trim()
                .toUpperCase();

        if (
            !text
            || text.endsWith("—")
        ) {
            return fallback;
        }

        return text;
    }

    function syncTwinRuntime() {
    const ctrl =
        document.getElementById(
            "controllerProcessChip"
        );

    const ctrlTarget =
        document.getElementById(
            "stitchCtrlChip"
        );

    if (ctrl && ctrlTarget) {
        const nextText = cleanRuntimeText(
            ctrl.textContent,
            "CTRL OFFLINE"
        );
        if (ctrlTarget.textContent !== nextText) {
            ctrlTarget.textContent = nextText;
        }

        mirrorTone(
            ctrl,
            ctrlTarget
        );
    }

    const values = [
        ["poseAgeStat", "stitchPoseAge"],
        ["poseRxStat", "stitchPoseRx"],
        ["poseFpsStat", "stitchPoseFps"],
        ["poseSeqStat", "stitchPoseSeq"]
    ];

    for (
        const [sourceId, targetId]
        of values
    ) {
        const source =
            document.getElementById(sourceId);

        const target =
            document.getElementById(targetId);

        if (
            source && target
            && target.textContent !== source.textContent
        ) {
            target.textContent = source.textContent;
        }
    }
}


    function polishDefaultCameraButton() {
        const button =
            document.getElementById(
                "cameraConnectBtn"
            );

        if (!button) {
            return;
        }

        const text =
            String(button.textContent || "")
                .trim();

        if (
            text === "Start & connect"
            || text === "Start & Connect"
        ) {
            button.textContent =
                "Connect views";
        }
    }

    // BACA_LIVE_DOM_OPT_V1
    let updateQueued = false;

    function queueUpdateAll() {
        if (updateQueued) return;
        updateQueued = true;
        requestAnimationFrame(() => {
            updateQueued = false;
            updateAll();
        });
    }

    function updateAll() {
        installCameraReticles();
        syncCameraLiveStates();
        syncTwinRuntime();
        polishDefaultCameraButton();
    }

    function start() {
        updateAll();

        const stage =
            document.getElementById(
                "cameraStage"
            );

        if (stage) {
            const observer =
                new MutationObserver(queueUpdateAll);

            observer.observe(
                stage,
                {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    characterData: true
                }
            );
        }

        const runtimeIds = [
            "controllerProcessChip",
            "poseAgeStat",
            "poseRxStat",
            "poseFpsStat",
            "poseSeqStat",
            "cameraConnectBtn"
        ];

        const runtimeObserver =
            new MutationObserver(queueUpdateAll);

        runtimeIds
            .map(id =>
                document.getElementById(id)
            )
            .filter(Boolean)
            .forEach(node => {
                runtimeObserver.observe(
                    node,
                    {
                        childList: true,
                        subtree: true,
                        attributes: true,
                        characterData: true
                    }
                );
            });

        window.setInterval(
            queueUpdateAll,
            750
        );
    }

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            start,
            { once: true }
        );
    }
    else {
        start();
    }
})();


/* ================================================================
   STITCH_V121_LOCAL_PREVIEW

   Visual preview helper only.
   It changes no control state and enables no action.
   ================================================================ */

(() => {
    const host =
        String(window.location.hostname || "")
            .toLowerCase();

    const local =
        host === "127.0.0.1"
        || host === "localhost"
        || host === "::1";

    if (local) {
        document.body.classList.add(
            "stitch-local-design-preview"
        );
    }
})();



/* ================================================================
   STITCH_V122_SAFETY_LAYOUT

   Move STOP + FAULT below HANDS / GUARD.
   Keep ENTER TELEOP as the only visible Action Readiness control.
   Functional element IDs remain unchanged.
   ================================================================ */

(() => {

    function installSafetyLayout() {

    const healthGrid =
        document.querySelector(
            "#view-live .mini-health-grid"
        );

    const fault =
        document.getElementById(
            "actionCondFault"
        );

    if (
        !healthGrid
        || !fault
    ) {
        return;
    }


    let row =
        document.getElementById(
            "stitchSafetyRow"
        );


    if (!row) {

        row =
            document.createElement(
                "div"
            );

        row.id =
            "stitchSafetyRow";

        row.className =
            "stitch-safety-row";

        healthGrid.insertAdjacentElement(
            "afterend",
            row
        );
    }


    if (
        fault.parentElement !== row
    ) {
        row.appendChild(
            fault
        );
    }


    fault.classList.add(
        "stitch-safety-status"
    );
}



    if (
        document.readyState ===
        "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            installSafetyLayout,
            {
                once: true
            }
        );
    }
    else {
        installSafetyLayout();
    }

})();


/* ================================================================
   STITCH_V125_SECTION_LAYOUT

   Creates four visual sidebar sections without changing any
   existing functional IDs or backend bindings:

     MODE
     CONTROLLER PROCESS
     HANDS
     SELECTED JOINT
   ================================================================ */

(() => {

    function makeWrapper(
        id,
        className,
        beforeNode
    ) {

        let wrapper =
            document.getElementById(id);

        if (wrapper) {
            return wrapper;
        }

        wrapper =
            document.createElement("section");

        wrapper.id = id;

        wrapper.className =
            "stitch-sidebar-section "
            + className;

        beforeNode.parentNode.insertBefore(
            wrapper,
            beforeNode
        );

        return wrapper;
    }


    function installSidebarSections() {

        const rail =
            document.querySelector(
                "#view-live .combined-rail"
            );

        if (!rail) {
            return;
        }


        /* ========================================================
           MODE

           Combine:
             hero-state
             health-panel
             STOP / FAULT row
             quick-panel

           into one Bacalbasa-style card.
           ======================================================== */

        const hero =
            rail.querySelector(
                ".hero-state"
            );

        const health =
            rail.querySelector(
                ".health-panel"
            );

        const safety =
            document.getElementById(
                "stitchSafetyRow"
            );

        const quick =
            rail.querySelector(
                ".quick-panel"
            );


        if (hero) {

            const mode =
                makeWrapper(
                    "stitchModeSection",
                    "stitch-mode-section",
                    hero
                );


            [
                hero,
                health,
                safety,
                quick
            ]
            .filter(Boolean)
            .forEach(node => {

                if (
                    node.parentElement
                    !== mode
                ) {
                    mode.appendChild(node);
                }
            });
        }


        /* ========================================================
           CONTROLLER PROCESS

           Combine listener controls and ENTER TELEOP
           into one section.
           ======================================================== */

        const controller =
            rail.querySelector(
                ".controller-process-panel"
            );

        const action =
            rail.querySelector(
                ".action-readiness-panel"
            );


        if (controller) {

            const section =
                makeWrapper(
                    "stitchControllerSection",
                    "stitch-controller-section",
                    controller
                );


            [
                controller,
                action
            ]
            .filter(Boolean)
            .forEach(node => {

                if (
                    node.parentElement
                    !== section
                ) {
                    section.appendChild(node);
                }
            });
        }


        /* ========================================================
           HANDS
           ======================================================== */

        const hands =
            rail.querySelector(
                ".rail-hand-panel"
            );

        if (hands) {

            hands.classList.add(
                "stitch-sidebar-section",
                "stitch-hands-section"
            );
        }


        /* ========================================================
           SELECTED JOINT
           ======================================================== */

        const joint =
            rail.querySelector(
                ".rail-joint-inspector"
            );

        if (joint) {

            joint.classList.add(
                "stitch-sidebar-section",
                "stitch-joint-section"
            );
        }
    }


    function start() {

        installSidebarSections();

        window.setTimeout(
            installSidebarSections,
            100
        );

        window.setTimeout(
            installSidebarSections,
            600
        );
    }


    if (
        document.readyState === "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            start,
            {
                once: true
            }
        );
    }
    else {
        start();
    }

})();


/* ================================================================
   STITCH_V126_REMOVE_JOINT_HELP
   Remove presentation-only instructional text from Selected Joint.
   ================================================================ */

(() => {

    const unwanted = [
        "Click a link or joint marker on the Live G1 twin to inspect it here.",
        "Health colors are diagnostic display bands; controller/Unitree safety limits remain authoritative."
    ];

    function cleanJointHelp() {

        const panel =
            document.querySelector(
                "#view-live .rail-joint-inspector"
            );

        if (!panel) {
            return;
        }

        panel
            .querySelectorAll(
                "p, small, div, span"
            )
            .forEach(node => {

                const value =
                    String(
                        node.textContent || ""
                    )
                    .trim();

                if (
                    unwanted.includes(value)
                ) {
                    node.style.display =
                        "none";
                }
            });
    }

    if (
        document.readyState ===
        "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            cleanJointHelp,
            { once: true }
        );
    }
    else {
        cleanJointHelp();
    }

    window.setTimeout(
        cleanJointHelp,
        250
    );

    window.setTimeout(
        cleanJointHelp,
        1000
    );

})();


/* ================================================================
   STITCH_V128_JOINT_TEXT_CLEANUP

   Presentation-only cleanup. Functional fields remain untouched.
   ================================================================ */

(() => {

    const needles = [
        "Click a link or joint marker",
        "Health colors are diagnostic",
        "Arm command fields compare",
        "latest IK solution",
        "controller/Unitree safety limits remain authoritative"
    ];

    function cleanSelectedJointCopy() {

        const panel =
            document.querySelector(
                "#view-live .rail-joint-inspector"
            );

        if (!panel) {
            return;
        }

        panel
            .querySelectorAll(
                "p, small, .dim, .hint, .help, .note"
            )
            .forEach(node => {

                const value =
                    String(
                        node.textContent || ""
                    )
                    .trim();

                if (
                    value.length < 500
                    && needles.some(
                        needle =>
                            value.includes(needle)
                    )
                ) {
                    node.style.display =
                        "none";
                }
            });
    }

    if (
        document.readyState === "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            cleanSelectedJointCopy,
            { once: true }
        );
    }
    else {
        cleanSelectedJointCopy();
    }

    window.setTimeout(
        cleanSelectedJointCopy,
        200
    );

    window.setTimeout(
        cleanSelectedJointCopy,
        800
    );

})();

/* ================================================================
   STITCH_HEALTH_CUSTOM_DROPDOWN_V174

   The original #healthModeSelect remains authoritative.

   This layer only replaces the browser-native presentation.

   Selecting an item:
       1. updates the real <select>.value
       2. dispatches its real "change" event
       3. therefore preserves the existing Dragos health-view logic

   No polling.
   No MutationObserver.
   ================================================================ */

(function(){

    function initHealthDropdownV174(){

        const select =
            document.getElementById(
                'healthModeSelect'
            );


        if(
            !select
            ||
            document.getElementById(
                'stitchHealthDropdownV174'
            )
        ){
            return;
        }


        select.classList.add(
            'stitch-health-native-v174'
        );


        const root =
            document.createElement(
                'div'
            );

        root.id =
            'stitchHealthDropdownV174';

        root.className =
            'stitch-health-dropdown-v174';


        const trigger =
            document.createElement(
                'button'
            );

        trigger.type =
            'button';

        trigger.className =
            'stitch-health-trigger-v174';

        trigger.setAttribute(
            'aria-haspopup',
            'listbox'
        );

        trigger.setAttribute(
            'aria-expanded',
            'false'
        );


        const label =
            document.createElement(
                'span'
            );

        label.className =
            'stitch-health-trigger-label-v174';


        const chevron =
            document.createElement(
                'span'
            );

        chevron.className =
            'stitch-health-chevron-v174';

        chevron.setAttribute(
            'aria-hidden',
            'true'
        );


        trigger.append(
            label,
            chevron
        );


        root.appendChild(
            trigger
        );


        select.insertAdjacentElement(
            'afterend',
            root
        );


        /*
         * Put the popup on BODY.
         *
         * This avoids clipping from any center-toolbar overflow rules.
         */
        const menu =
            document.createElement(
                'div'
            );

        menu.className =
            'stitch-health-menu-v174';

        menu.setAttribute(
            'role',
            'listbox'
        );

        menu.hidden =
            true;


        document.body.appendChild(
            menu
        );


        function optionButtons(){

            return [
                ...menu.querySelectorAll(
                    '.stitch-health-option-v174'
                )
            ];
        }


        function sync(){

            const selected =
                select.options[
                    select.selectedIndex
                ];


            label.textContent =
                selected
                ?
                selected.textContent
                :
                'Composite';


            trigger.disabled =
                !!select.disabled;


            for(
                const button
                of optionButtons()
            ){

                const active =
                    button.dataset.value
                    ===
                    select.value;


                button.classList.toggle(
                    'selected',
                    active
                );


                button.setAttribute(
                    'aria-selected',
                    active
                    ?
                    'true'
                    :
                    'false'
                );
            }
        }


        function positionMenu(){

            if(menu.hidden){
                return;
            }


            const rect =
                trigger.getBoundingClientRect();


            menu.style.left =
                `${Math.round(rect.left)}px`;


            menu.style.top =
                `${Math.round(rect.bottom + 5)}px`;


            menu.style.width =
                `${Math.round(rect.width)}px`;
        }


        function closeMenu(){

            if(menu.hidden){
                return;
            }


            menu.hidden =
                true;


            root.classList.remove(
                'open'
            );


            trigger.setAttribute(
                'aria-expanded',
                'false'
            );
        }


        function openMenu(){

            if(trigger.disabled){
                return;
            }


            menu.hidden =
                false;


            root.classList.add(
                'open'
            );


            trigger.setAttribute(
                'aria-expanded',
                'true'
            );


            positionMenu();
        }


        function toggleMenu(){

            if(menu.hidden){

                openMenu();

            }
            else{

                closeMenu();
            }
        }


        function commitValue(
            value
        ){

            if(
                value
                !==
                select.value
            ){

                select.value =
                    value;


                /*
                 * Existing app.js handler receives this exactly
                 * as if the user had changed the original select.
                 */
                select.dispatchEvent(
                    new Event(
                        'change',
                        {
                            bubbles:
                                true
                        }
                    )
                );
            }


            sync();
            closeMenu();
            trigger.focus();
        }


        /*
         * Build options from the ORIGINAL select.
         *
         * We do not duplicate/guess the available health modes.
         */
        for(
            const option
            of select.options
        ){

            const button =
                document.createElement(
                    'button'
                );


            button.type =
                'button';


            button.className =
                'stitch-health-option-v174';


            button.dataset.value =
                option.value;


            button.textContent =
                option.textContent;


            button.setAttribute(
                'role',
                'option'
            );


            button.addEventListener(
                'click',
                ()=>{
                    commitValue(
                        option.value
                    );
                }
            );


            menu.appendChild(
                button
            );
        }


        trigger.addEventListener(
            'click',
            event=>{

                event.preventDefault();
                event.stopPropagation();

                toggleMenu();
            }
        );


        trigger.addEventListener(
            'keydown',
            event=>{

                const buttons =
                    optionButtons();


                if(
                    event.key
                    ===
                    'ArrowDown'
                    ||
                    event.key
                    ===
                    'ArrowUp'
                ){

                    event.preventDefault();

                    openMenu();


                    const selectedIndex =
                        Math.max(
                            0,
                            buttons.findIndex(
                                button=>
                                    button.dataset.value
                                    ===
                                    select.value
                            )
                        );


                    const index =
                        event.key
                        ===
                        'ArrowDown'
                        ?
                        selectedIndex
                        :
                        Math.max(
                            0,
                            selectedIndex
                        );


                    buttons[
                        index
                    ]?.focus();


                    return;
                }


                if(
                    event.key
                    ===
                    'Escape'
                ){

                    event.preventDefault();
                    closeMenu();

                    return;
                }


                if(
                    event.key
                    ===
                    'Enter'
                    ||
                    event.key
                    ===
                    ' '
                ){

                    event.preventDefault();
                    toggleMenu();
                }
            }
        );


        menu.addEventListener(
            'keydown',
            event=>{

                const buttons =
                    optionButtons();


                const index =
                    buttons.indexOf(
                        document.activeElement
                    );


                if(
                    event.key
                    ===
                    'Escape'
                ){

                    event.preventDefault();

                    closeMenu();
                    trigger.focus();

                    return;
                }


                if(
                    event.key
                    ===
                    'ArrowDown'
                    ||
                    event.key
                    ===
                    'ArrowUp'
                ){

                    event.preventDefault();


                    const step =
                        event.key
                        ===
                        'ArrowDown'
                        ?
                        1
                        :
                        -1;


                    const next =
                        (
                            index
                            +
                            step
                            +
                            buttons.length
                        )
                        %
                        buttons.length;


                    buttons[
                        next
                    ]?.focus();
                }
            }
        );


        /*
         * Close when clicking anywhere else.
         */
        document.addEventListener(
            'pointerdown',
            event=>{

                if(
                    root.contains(
                        event.target
                    )
                    ||
                    menu.contains(
                        event.target
                    )
                ){
                    return;
                }


                closeMenu();
            }
        );


        /*
         * If existing dashboard code changes the real select through
         * its normal event path, keep the presentation synchronized.
         */
        select.addEventListener(
            'change',
            sync
        );


        window.addEventListener(
            'resize',
            positionMenu
        );


        window.addEventListener(
            'scroll',
            positionMenu,
            true
        );


        sync();
    }


    if(
        document.readyState
        ===
        'loading'
    ){

        document.addEventListener(
            'DOMContentLoaded',
            initHealthDropdownV174,
            {
                once:
                    true
            }
        );

    }
    else{

        initHealthDropdownV174();
    }

})();

/* ================================================================
   STITCH_SECTION_TITLES_V182

   One-time presentation tagging only.

   Targets ONLY:
       CAMERA MULTIVIEW
       MODE
       CONTROLLER PROCESS
       HANDS
       SELECTED JOINT

   No MutationObserver.
   No interval.
   No polling.
   ================================================================ */

(function(){

    function normalizeTitleV182(value){

        return String(value || '')
            .replace(/[·•]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }


    function directTextV182(element){

        return normalizeTitleV182(
            [...element.childNodes]
                .filter(node => node.nodeType === Node.TEXT_NODE)
                .map(node => node.nodeValue)
                .join(' ')
        );
    }


    const targets = [

        [
            '.camera-panel',
            'camera multiview'
        ],

        [
            '.stitch-mode-section',
            'mode'
        ],

        [
            '.stitch-controller-section',
            'controller process'
        ],

        [
            '.stitch-hands-section',
            'hands'
        ],

        [
            '.stitch-joint-section',
            'selected joint'
        ],

    ];


    for(const [scopeSelector, title] of targets){

        const scope =
            document.querySelector(
                `#view-live ${scopeSelector}`
            );

        if(!scope){
            continue;
        }


        const candidates = [
            scope,
            ...scope.querySelectorAll(
                'h1,h2,h3,h4,h5,h6,div,span,strong,p'
            )
        ];


        const match =
            candidates.find(element =>
                directTextV182(element) === title
            );


        if(match){

            match.classList.add(
                'stitch-section-title-v182'
            );
        }
    }

})();

/* ================================================================
   STITCH_SECTION_TITLES_V184

   Reliable one-time section-title detection.

   V1.8.2 depended on direct text nodes. Some real title elements
   contain nested markup, so the class was never attached.

   This version:
     - uses rendered textContent
     - finds deepest matching element
     - tags only the five requested section titles

   No MutationObserver.
   No interval.
   No polling.
   ================================================================ */

(function(){

    function normalizeTitleV184(value){

        return String(value || '')
            .replace(/[·•]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }


    const requestedTitlesV184 = new Set([
        'camera multiview',
        'mode',
        'controller process',
        'hands',
        'selected joint'
    ]);


    function installSectionTitlesV184(){

        const root =
            document.getElementById(
                'view-live'
            );


        if(!root){
            return;
        }


        /*
         * Remove the old class first in case any previous attempt
         * tagged a wrapper rather than the actual text element.
         */
        root.querySelectorAll(
            '.stitch-section-title-v182'
        ).forEach(
            element =>
                element.classList.remove(
                    'stitch-section-title-v182'
                )
        );


        const all =
            [
                ...root.querySelectorAll(
                    'h1,h2,h3,h4,h5,h6,div,span,strong,p'
                )
            ];


        for(
            const wanted
            of requestedTitlesV184
        ){

            const matches =
                all.filter(
                    element =>
                        normalizeTitleV184(
                            element.textContent
                        )
                        ===
                        wanted
                );


            if(!matches.length){
                continue;
            }


            /*
             * Choose the deepest match.
             *
             * Example:
             *   div
             *     span "HANDS"
             *
             * Both div and span may have textContent "HANDS".
             * The span is the title we actually want to resize.
             */
            const match =
                matches.sort(
                    (a,b)=>{

                        function depth(element){

                            let d = 0;

                            while(element){

                                d += 1;
                                element = element.parentElement;
                            }

                            return d;
                        }


                        return depth(b) - depth(a);
                    }
                )[0];


            match.classList.add(
                'stitch-section-title-v184'
            );
        }
    }


    if(
        document.readyState
        ===
        'loading'
    ){

        document.addEventListener(
            'DOMContentLoaded',
            installSectionTitlesV184,
            {
                once:
                    true
            }
        );

    }
    else{

        installSectionTitlesV184();
    }

})();


/* ================================================================
   STITCH_SECTION_TITLES_V185

   Force the ACTUAL rendered title text elements.

   Previous class-based attempts were not affecting the element
   carrying the visible glyphs.

   Targets only:
       CAMERA MULTIVIEW
       MODE
       CONTROLLER PROCESS
       HANDS
       SELECTED JOINT

   One execution only.
   No MutationObserver.
   No interval.
   No polling.
   ================================================================ */

(function(){

    const TITLE_SPECS_V185 = [

        {
            scope: '.camera-panel',
            text: 'camera multiview'
        },

        {
            scope: '.stitch-mode-section',
            text: 'mode'
        },

        {
            scope: '.stitch-controller-section',
            text: 'controller process'
        },

        {
            scope: '.stitch-hands-section',
            text: 'hands'
        },

        {
            scope: '.stitch-joint-section',
            text: 'selected joint'
        },

    ];


    function normalizeV185(value){

        return String(value || '')
            .replace(/[·•]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }


    function findExactTextElementV185(
        scope,
        wanted
    ){

        const walker =
            document.createTreeWalker(
                scope,
                NodeFilter.SHOW_TEXT
            );


        let node;


        while(
            (
                node =
                    walker.nextNode()
            )
        ){

            if(
                normalizeV185(
                    node.nodeValue
                )
                !==
                wanted
            ){
                continue;
            }


            const element =
                node.parentElement;


            if(!element){
                continue;
            }


            return element;
        }


        return null;
    }


    function styleTitleV185(
        element
    ){

        element.dataset.stitchSectionTitleV185 =
            'true';


        element.style.setProperty(
            'font-family',
            '"Space Mono", monospace',
            'important'
        );


        element.style.setProperty(
            'font-size',
            '14px',
            'important'
        );


        element.style.setProperty(
            'line-height',
            '20px',
            'important'
        );


        element.style.setProperty(
            'font-weight',
            '700',
            'important'
        );


        element.style.setProperty(
            'letter-spacing',
            '0.025em',
            'important'
        );


        element.style.setProperty(
            'text-transform',
            'uppercase',
            'important'
        );


        element.style.setProperty(
            'color',
            '#c9cdd3',
            'important'
        );


        element.style.setProperty(
            'opacity',
            '1',
            'important'
        );


        element.style.setProperty(
            'transform',
            'none',
            'important'
        );


        element.style.setProperty(
            'zoom',
            '1',
            'important'
        );


        element.style.setProperty(
            'white-space',
            'nowrap',
            'important'
        );
    }


    function installTitlesV185(){

        for(
            const spec
            of TITLE_SPECS_V185
        ){

            const scope =
                document.querySelector(
                    `#view-live ${spec.scope}`
                )
                ||
                document.querySelector(
                    spec.scope
                );


            if(!scope){
                continue;
            }


            const title =
                findExactTextElementV185(
                    scope,
                    spec.text
                );


            if(!title){
                continue;
            }


            styleTitleV185(
                title
            );
        }
    }


    if(
        document.readyState
        ===
        'loading'
    ){

        document.addEventListener(
            'DOMContentLoaded',
            installTitlesV185,
            {
                once:
                    true
            }
        );

    }
    else{

        installTitlesV185();
    }

})();


/* ================================================================
   STITCH_SECTION_TITLES_V186

   Final title scale:
       16px
       22px line height

   Uses the already verified V1.8.5 title elements.
   No observer.
   No interval.
   No polling.
   ================================================================ */

(function(){

    document
        .querySelectorAll(
            '[data-stitch-section-title-v185="true"]'
        )
        .forEach(element => {

            element.style.setProperty(
                'font-size',
                '16px',
                'important'
            );

            element.style.setProperty(
                'line-height',
                '22px',
                'important'
            );

        });

})();

/* ================================================================
   STITCH_SECTION_TITLE_ALIGNMENT_V189

   HANDS is the visual reference.

   Every main section title receives the exact same distance from
   its section's top border as HANDS currently has.

   One-time layout calculation.
   No MutationObserver.
   No interval.
   No polling.
   ================================================================ */

(function(){

    const specsV189 = [

        {
            scope:
                '.camera-panel',
            title:
                'camera multiview'
        },

        {
            scope:
                '.stitch-mode-section',
            title:
                'mode'
        },

        {
            scope:
                '.stitch-controller-section',
            title:
                'controller process'
        },

        {
            scope:
                '.stitch-hands-section',
            title:
                'hands'
        },

        {
            scope:
                '.stitch-joint-section',
            title:
                'selected joint'
        },

    ];


    function normalizeV189(value){

        return String(value || '')
            .replace(/[·•]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }


    function findTitleV189(
        scope,
        wanted
    ){

        /*
         * Prefer the already verified V1.8.5 title element.
         */
        const tagged =
            scope.querySelector(
                '[data-stitch-section-title-v185="true"]'
            );


        if(
            tagged
            &&
            normalizeV189(
                tagged.textContent
            )
            ===
            wanted
        ){
            return tagged;
        }


        /*
         * Safe fallback.
         */
        const walker =
            document.createTreeWalker(
                scope,
                NodeFilter.SHOW_TEXT
            );


        let node;


        while(
            (
                node =
                    walker.nextNode()
            )
        ){

            if(
                normalizeV189(
                    node.nodeValue
                )
                ===
                wanted
            ){
                return node.parentElement;
            }
        }


        return null;
    }


    function alignTitlesV189(){

        const live =
            document.getElementById(
                'view-live'
            );


        if(!live){
            return;
        }


        const entries =
            specsV189
                .map(spec => {

                    const scope =
                        live.querySelector(
                            spec.scope
                        );


                    if(!scope){
                        return null;
                    }


                    const title =
                        findTitleV189(
                            scope,
                            spec.title
                        );


                    if(!title){
                        return null;
                    }


                    return {
                        ...spec,
                        scope,
                        title
                    };

                })
                .filter(Boolean);


        const hands =
            entries.find(
                entry =>
                    entry.title
                    &&
                    entry.scope.matches(
                        '.stitch-hands-section'
                    )
            );


        if(!hands){
            return;
        }


        const handsScopeRect =
            hands.scope.getBoundingClientRect();


        const handsTitleRect =
            hands.title.getBoundingClientRect();


        const referenceOffset =
            handsTitleRect.top
            -
            handsScopeRect.top;


        for(
            const entry
            of entries
        ){

            const scopeRect =
                entry.scope.getBoundingClientRect();


            const titleRect =
                entry.title.getBoundingClientRect();


            const currentOffset =
                titleRect.top
                -
                scopeRect.top;


            const correction =
                referenceOffset
                -
                currentOffset;


            entry.title.style.setProperty(
                'position',
                'relative',
                'important'
            );


            entry.title.style.setProperty(
                'top',
                `${correction.toFixed(2)}px`,
                'important'
            );
        }
    }


    if(
        document.readyState
        ===
        'loading'
    ){

        document.addEventListener(
            'DOMContentLoaded',
            alignTitlesV189,
            {
                once:
                    true
            }
        );

    }
    else{

        alignTitlesV189();
    }

})();


/* ================================================================
   STITCH_CENTER_PINKY_SIZE_V191

   Use the ACTUAL rendered Pinky label as the size reference.

   Changes size only:
       font-size
       line-height

   Existing family / weight / color remain untouched.

   One-time application.
   No MutationObserver.
   No interval.
   No polling.
   ================================================================ */

(function(){

    function applyCenterPinkySizeV191(){

        const pinky =
            document.querySelector(
                '#view-live .stitch-hands-section .hand-finger-name'
            );

        if(!pinky){
            return;
        }

        const pinkyStyle =
            getComputedStyle(pinky);

        const fontSize =
            pinkyStyle.fontSize;

        const lineHeight =
            pinkyStyle.lineHeight;


        const selectors = [

            /* POSE / RX / RENDER / SEQ */
            '#view-live .stitch-performance-group span',
            '#view-live .stitch-performance-group strong',

            /* legacy in-viewport performance HUD */
            '#view-live .twin-perf span',
            '#view-live .twin-perf strong',

            /* bottom-left legend */
            '#view-live .twin-legend span',

            /* bottom-right health legend */
            '#view-live .twin-health-legend span',
            '#view-live .twin-health-legend small',

            /* six bottom statistic cells */
            '#view-live .robot-mini-grid.twin-stats > div > span',
            '#view-live .robot-mini-grid.twin-stats > div > strong',
        ];


        document
            .querySelectorAll(
                selectors.join(',')
            )
            .forEach(element => {

                element.style.setProperty(
                    'font-size',
                    fontSize,
                    'important'
                );

                element.style.setProperty(
                    'line-height',
                    lineHeight,
                    'important'
                );

            });


        console.debug(
            'STITCH V1.9.1 center text matched Pinky:',
            fontSize,
            lineHeight
        );
    }


    if(document.readyState === 'loading'){

        document.addEventListener(
            'DOMContentLoaded',
            applyCenterPinkySizeV191,
            {
                once: true
            }
        );

    }else{

        applyCenterPinkySizeV191();
    }

})();


/* ================================================================
   STITCH_CENTER_HUD_COMPACT_V192

   Compact telemetry/HUD typography:
       10px
       13px line-height

   Runs after the previous V1.9.1 sizing logic.

   No MutationObserver.
   No interval.
   No polling.
   ================================================================ */

(function(){

    function applyCompactHudV192(){

        const selectors = [

            /* POSE / RX / RENDER / SEQ */
            '#view-live .stitch-performance-group span',
            '#view-live .stitch-performance-group strong',
            '#view-live #stitchPoseAge',
            '#view-live #stitchPoseRx',
            '#view-live #stitchPoseFps',
            '#view-live #stitchPoseSeq',

            /* legacy performance HUD */
            '#view-live .twin-perf span',
            '#view-live .twin-perf strong',

            /* bottom-left legend */
            '#view-live .twin-legend span',

            /* bottom-right health legend */
            '#view-live .twin-health-legend span',
            '#view-live .twin-health-legend small',

            /* bottom six statistics */
            '#view-live .robot-mini-grid.twin-stats > div > span',
            '#view-live .robot-mini-grid.twin-stats > div > strong'
        ];


        document
            .querySelectorAll(
                selectors.join(',')
            )
            .forEach(element => {

                element.style.setProperty(
                    'font-size',
                    '10px',
                    'important'
                );

                element.style.setProperty(
                    'line-height',
                    '13px',
                    'important'
                );

            });
    }


    if(document.readyState === 'loading'){

        document.addEventListener(
            'DOMContentLoaded',
            applyCompactHudV192,
            {
                once: true
            }
        );

    }else{

        applyCompactHudV192();
    }

})();


/* ================================================================
   STITCH_CONTROL_STYLE_V193

   Use an ACTIVE camera-view icon (04 / 05) as the actual visual
   reference for interactive controls.

   Green:
       YOLO
       Composite
       Configure
       Enter Teleop
       selected top tab

   Amber equivalent:
       Stop

   Presentation only.

   No MutationObserver.
   No interval.
   No polling.
   ================================================================ */

(function(){

    function normalizeV193(value){

        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }


    /* ------------------------------------------------------------
       FIND THE REAL 04 / 05 CAMERA ICON BUTTON
       ------------------------------------------------------------ */

    function findCameraReferenceV193(){

        const panel =
            document.querySelector(
                '#view-live .camera-panel'
            )
            ||
            document.querySelector(
                '.camera-panel'
            );


        if(!panel){
            return null;
        }


        const walker =
            document.createTreeWalker(
                panel,
                NodeFilter.SHOW_TEXT
            );


        let node;


        while(
            (
                node =
                    walker.nextNode()
            )
        ){

            const value =
                normalizeV193(
                    node.nodeValue
                );


            if(
                value !== '04'
                &&
                value !== '05'
            ){
                continue;
            }


            let element =
                node.parentElement;


            while(
                element
                &&
                panel.contains(element)
            ){

                const rect =
                    element.getBoundingClientRect();


                const style =
                    getComputedStyle(element);


                const hasBorder =
                    parseFloat(
                        style.borderTopWidth
                    ) > 0;


                const correctSize =
                    rect.width >= 30
                    &&
                    rect.width <= 100
                    &&
                    rect.height >= 25
                    &&
                    rect.height <= 80;


                if(
                    hasBorder
                    &&
                    correctSize
                ){
                    return element;
                }


                element =
                    element.parentElement;
            }
        }


        /*
         * Fallback: look for a small active/selected item.
         */
        const candidates =
            panel.querySelectorAll(
                '.active, .selected, [aria-pressed="true"]'
            );


        for(
            const element
            of candidates
        ){

            const rect =
                element.getBoundingClientRect();


            if(
                rect.width >= 30
                &&
                rect.width <= 100
                &&
                rect.height >= 25
                &&
                rect.height <= 80
            ){
                return element;
            }
        }


        return null;
    }


    /* ------------------------------------------------------------
       COLOR HELPERS
       ------------------------------------------------------------ */

    function alphaFromColorV193(
        color,
        fallback
    ){

        const match =
            String(color)
                .match(
                    /rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/
                );


        if(!match){
            return fallback;
        }


        const value =
            Number(
                match[1]
            );


        return Number.isFinite(value)
            ? value
            : fallback;
    }


    function amberV193(
        alpha
    ){

        return `rgba(245, 158, 11, ${alpha})`;
    }


    /* ------------------------------------------------------------
       EXACT-TEXT BUTTON FINDER
       ------------------------------------------------------------ */

    function findButtonV193(
        scope,
        wanted
    ){

        if(!scope){
            return null;
        }


        const candidates =
            [
                ...scope.querySelectorAll(
                    'button, a, label, [role="button"], [role="tab"]'
                )
            ];


        return (
            candidates.find(
                element =>
                    normalizeV193(
                        element.textContent
                    )
                    ===
                    wanted
            )
            ||
            null
        );
    }


    /* ------------------------------------------------------------
       APPLY CLASSES
       ------------------------------------------------------------ */

    function installControlStyleV193(){

        const root =
            document.documentElement;


        const reference =
            findCameraReferenceV193();


        if(reference){

            const style =
                getComputedStyle(
                    reference
                );


            root.style.setProperty(
                '--stitch-v193-green-bg',
                style.backgroundColor
            );


            root.style.setProperty(
                '--stitch-v193-green-border',
                style.borderColor
            );


            root.style.setProperty(
                '--stitch-v193-green-text',
                style.color
            );


            root.style.setProperty(
                '--stitch-v193-radius',
                style.borderRadius
            );


            root.style.setProperty(
                '--stitch-v193-shadow',
                style.boxShadow
            );


            root.style.setProperty(
                '--stitch-v193-transition',
                style.transition
            );


            const bgAlpha =
                alphaFromColorV193(
                    style.backgroundColor,
                    .10
                );


            const borderAlpha =
                alphaFromColorV193(
                    style.borderColor,
                    .38
                );


            root.style.setProperty(
                '--stitch-v193-amber-bg',
                amberV193(
                    bgAlpha
                )
            );


            root.style.setProperty(
                '--stitch-v193-amber-border',
                amberV193(
                    borderAlpha
                )
            );

        }
        else{

            /*
             * Safe Bacalbasa fallback if the camera icon reference
             * cannot be resolved for some reason.
             */

            root.style.setProperty(
                '--stitch-v193-green-bg',
                'rgba(142, 203, 127, .10)'
            );

            root.style.setProperty(
                '--stitch-v193-green-border',
                'rgba(142, 203, 127, .38)'
            );

            root.style.setProperty(
                '--stitch-v193-green-text',
                '#8ecb7f'
            );

            root.style.setProperty(
                '--stitch-v193-radius',
                '7px'
            );

            root.style.setProperty(
                '--stitch-v193-shadow',
                'none'
            );

            root.style.setProperty(
                '--stitch-v193-transition',
                'background-color 140ms ease, border-color 140ms ease, color 140ms ease'
            );

            root.style.setProperty(
                '--stitch-v193-amber-bg',
                'rgba(245, 158, 11, .10)'
            );

            root.style.setProperty(
                '--stitch-v193-amber-border',
                'rgba(245, 158, 11, .38)'
            );
        }


        const controller =
            document.querySelector(
                '#view-live .stitch-controller-section'
            )
            ||
            document.getElementById(
                'view-live'
            );


        const greenTargets = [

            document.getElementById(
                'cameraYoloControl'
            ),

            document.querySelector(
                '.stitch-health-trigger-v174'
            ),

            document.getElementById(
                'controllerConfigureBtn'
            ),

            findButtonV193(
                controller,
                'configure'
            ),

            findButtonV193(
                controller,
                'enter teleop'
            ),

        ].filter(Boolean);


        for(
            const element
            of new Set(greenTargets)
        ){

            element.classList.add(
                'stitch-active-green-v193'
            );
        }


        const stop =
            document.getElementById(
                'controllerStopBtn'
            )
            ||
            findButtonV193(
                controller,
                'stop'
            );


        if(stop){

            stop.classList.add(
                'stitch-active-amber-v193'
            );
        }


        /* --------------------------------------------------------
           TOP NAV

           The selected tab receives the same green treatment.
           Clicking a different top tab moves the class there.
           -------------------------------------------------------- */

        const navNames =
            new Set([
                'live',
                'slam',
                'inspect',
                'camera teleop'
            ]);


        const navItems =
            [
                ...document.querySelectorAll(
                    'header button, header a, header [role="tab"], nav button, nav a, nav [role="tab"]'
                )
            ]
            .filter(
                element =>
                    navNames.has(
                        normalizeV193(
                            element.textContent
                        )
                    )
            );


        function setSelectedNavV193(
            selected
        ){

            for(
                const item
                of navItems
            ){

                item.classList.toggle(
                    'stitch-active-green-v193',
                    item === selected
                );
            }
        }


        let selected =
            navItems.find(
                element =>
                    element.classList.contains(
                        'active'
                    )
                    ||
                    element.classList.contains(
                        'selected'
                    )
                    ||
                    element.getAttribute(
                        'aria-selected'
                    )
                    ===
                    'true'
                    ||
                    element.getAttribute(
                        'aria-current'
                    )
                    ===
                    'page'
            );


        if(!selected){

            selected =
                navItems.find(
                    element =>
                        normalizeV193(
                            element.textContent
                        )
                        ===
                        'live'
                );
        }


        if(selected){

            setSelectedNavV193(
                selected
            );
        }


        for(
            const item
            of navItems
        ){

            item.addEventListener(
                'click',
                ()=>{

                    setSelectedNavV193(
                        item
                    );
                }
            );
        }
    }


    if(
        document.readyState
        ===
        'loading'
    ){

        document.addEventListener(
            'DOMContentLoaded',
            installControlStyleV193,
            {
                once:
                    true
            }
        );

    }
    else{

        installControlStyleV193();
    }

})();


/* ================================================================
   STITCH_CONTROL_PARITY_V194

   Exact visual clone of an ACTIVE camera-view icon (04 / 05).

   GREEN:
       YOLO
       Composite
       Configure
       Enter Teleop
       Reset view
       selected top navigation tab

   AMBER EQUIVALENT:
       Stop

   Copies the real computed:
       background
       border color / width / style
       border radius
       text color
       opacity
       box shadow
       transition

   Inline !important is deliberate so old dashboard rules cannot
   make individual controls more/less green than the reference.

   No MutationObserver.
   No interval.
   No backend changes.
   ================================================================ */

(function(){

    const VISUAL_PROPERTIES_V194 = [
        'background-color',
        'border-top-color',
        'border-right-color',
        'border-bottom-color',
        'border-left-color',
        'border-top-width',
        'border-right-width',
        'border-bottom-width',
        'border-left-width',
        'border-top-style',
        'border-right-style',
        'border-bottom-style',
        'border-left-style',
        'border-top-left-radius',
        'border-top-right-radius',
        'border-bottom-right-radius',
        'border-bottom-left-radius',
        'box-shadow',
        'color',
        'opacity',
        'transition'
    ];


    function normalizeV194(value){

        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }


    /* ------------------------------------------------------------
       FIND THE ACTUAL ACTIVE 04 / 05 BUTTON
       ------------------------------------------------------------ */

    function findReferenceV194(){

        const panel =
            document.querySelector(
                '#view-live .camera-panel'
            )
            ||
            document.querySelector(
                '.camera-panel'
            );


        if(!panel){
            return null;
        }


        const walker =
            document.createTreeWalker(
                panel,
                NodeFilter.SHOW_TEXT
            );


        let node;


        while(
            (
                node =
                    walker.nextNode()
            )
        ){

            const text =
                normalizeV194(
                    node.nodeValue
                );


            if(
                text !== '04'
                &&
                text !== '05'
            ){
                continue;
            }


            let element =
                node.parentElement;


            while(
                element
                &&
                panel.contains(element)
            ){

                const rect =
                    element.getBoundingClientRect();


                const style =
                    getComputedStyle(
                        element
                    );


                const validSize =
                    rect.width >= 30
                    &&
                    rect.width <= 90
                    &&
                    rect.height >= 25
                    &&
                    rect.height <= 80;


                const hasBorder =
                    parseFloat(
                        style.borderTopWidth
                    ) > 0;


                if(
                    validSize
                    &&
                    hasBorder
                ){
                    return element;
                }


                element =
                    element.parentElement;
            }
        }


        return null;
    }


    /* ------------------------------------------------------------
       TARGET FINDERS
       ------------------------------------------------------------ */

    function exactInteractiveV194(
        wanted,
        scope = document
    ){

        const candidates =
            [
                ...scope.querySelectorAll(
                    'button,a,label,[role="button"],[role="tab"]'
                )
            ];


        return (
            candidates.find(
                element =>
                    normalizeV194(
                        element.textContent
                    )
                    ===
                    wanted
            )
            ||
            null
        );
    }


    function resetViewV194(){

        return (
            document.getElementById(
                'resetView'
            )
            ||
            document.getElementById(
                'twinResetView'
            )
            ||
            exactInteractiveV194(
                'reset view',
                document.getElementById('view-live')
                    || document
            )
        );
    }


    function compositeV194(){

        return (
            document.querySelector(
                '.stitch-health-trigger-v174'
            )
            ||
            exactInteractiveV194(
                'composite',
                document.getElementById('view-live')
                    || document
            )
        );
    }


    /* ------------------------------------------------------------
       EXACT GREEN CLONE
       ------------------------------------------------------------ */

    function copyGreenV194(
        reference,
        target
    ){

        if(
            !reference
            ||
            !target
        ){
            return;
        }


        const style =
            getComputedStyle(
                reference
            );


        for(
            const property
            of VISUAL_PROPERTIES_V194
        ){

            target.style.setProperty(
                property,
                style.getPropertyValue(
                    property
                ),
                'important'
            );
        }


        target.dataset.stitchControlParityV194 =
            'green';


        /*
         * Some controls contain nested labels which had their own
         * legacy color rules.
         */

        target
            .querySelectorAll(
                'span,strong'
            )
            .forEach(
                child => {

                    child.style.setProperty(
                        'color',
                        style.color,
                        'important'
                    );

                    child.style.setProperty(
                        'opacity',
                        '1',
                        'important'
                    );
                }
            );


        /*
         * YOLO keeps its real checkbox.
         */

        target
            .querySelectorAll(
                'input[type="checkbox"]'
            )
            .forEach(
                input => {

                    input.style.setProperty(
                        'accent-color',
                        style.color,
                        'important'
                    );
                }
            );
    }


    /* ------------------------------------------------------------
       AMBER VERSION WITH THE SAME ALPHAS
       ------------------------------------------------------------ */

    function parseColorV194(
        value
    ){

        const match =
            String(value).match(
                /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/
            );


        if(!match){
            return null;
        }


        return {
            r: Number(match[1]),
            g: Number(match[2]),
            b: Number(match[3]),
            a:
                match[4] === undefined
                ? 1
                : Number(match[4])
        };
    }


    function amberColorV194(
        source,
        fallbackAlpha = 1
    ){

        const parsed =
            parseColorV194(
                source
            );


        const alpha =
            parsed
            ? parsed.a
            : fallbackAlpha;


        return `rgba(245, 158, 11, ${alpha})`;
    }


    function copyAmberV194(
        reference,
        target
    ){

        if(
            !reference
            ||
            !target
        ){
            return;
        }


        const style =
            getComputedStyle(
                reference
            );


        /*
         * First copy every structural visual property exactly.
         */

        copyGreenV194(
            reference,
            target
        );


        /*
         * Then change only the hue.
         */

        target.style.setProperty(
            'background-color',
            amberColorV194(
                style.backgroundColor,
                .1
            ),
            'important'
        );


        for(
            const side
            of [
                'top',
                'right',
                'bottom',
                'left'
            ]
        ){

            target.style.setProperty(
                `border-${side}-color`,
                amberColorV194(
                    style.getPropertyValue(
                        `border-${side}-color`
                    ),
                    .35
                ),
                'important'
            );
        }


        target.style.setProperty(
            'color',
            '#f59e0b',
            'important'
        );


        target.dataset.stitchControlParityV194 =
            'amber';


        target
            .querySelectorAll(
                'span,strong'
            )
            .forEach(
                child => {

                    child.style.setProperty(
                        'color',
                        '#f59e0b',
                        'important'
                    );
                }
            );
    }


    /* ------------------------------------------------------------
       NAVIGATION
       ------------------------------------------------------------ */

    function navItemsV194(){

        const allowed =
            new Set([
                'live',
                'slam',
                'inspect',
                'camera teleop'
            ]);


        return [
            ...document.querySelectorAll(
                'header button,header a,header [role="tab"],nav button,nav a,nav [role="tab"]'
            )
        ].filter(
            element =>
                allowed.has(
                    normalizeV194(
                        element.textContent
                    )
                )
        );
    }


    function clearCopiedVisualV194(
        element
    ){

        if(!element){
            return;
        }


        for(
            const property
            of VISUAL_PROPERTIES_V194
        ){

            element.style.removeProperty(
                property
            );
        }


        element.removeAttribute(
            'data-stitch-control-parity-v194'
        );
    }


    function styleSelectedNavV194(
        reference,
        selected
    ){

        for(
            const item
            of navItemsV194()
        ){

            if(
                item === selected
            ){

                copyGreenV194(
                    reference,
                    item
                );

            }
            else{

                /*
                 * Only remove properties that THIS V1.9.4 patch
                 * previously added.
                 */

                if(
                    item.dataset.stitchControlParityV194
                ){

                    clearCopiedVisualV194(
                        item
                    );
                }
            }
        }
    }


    /* ------------------------------------------------------------
       MAIN INSTALL
       ------------------------------------------------------------ */

    function installParityV194(){

        const reference =
            findReferenceV194();


        if(!reference){

            console.warn(
                'V1.9.4: active camera icon reference not found'
            );

            return;
        }


        const liveRoot =
            document.getElementById(
                'view-live'
            )
            ||
            document;


        const controller =
            document.querySelector(
                '#view-live .stitch-controller-section'
            )
            ||
            liveRoot;


        const greenTargets = [

            document.getElementById(
                'cameraYoloControl'
            ),

            compositeV194(),

            document.getElementById(
                'controllerConfigureBtn'
            )
            ||
            exactInteractiveV194(
                'configure',
                controller
            ),

            exactInteractiveV194(
                'enter teleop',
                controller
            ),

            resetViewV194(),

        ].filter(Boolean);


        for(
            const target
            of new Set(
                greenTargets
            )
        ){

            copyGreenV194(
                reference,
                target
            );
        }


        const stop =
            document.getElementById(
                'controllerStopBtn'
            )
            ||
            exactInteractiveV194(
                'stop',
                controller
            );


        copyAmberV194(
            reference,
            stop
        );


        /*
         * Initial selected top tab.
         */

        const nav =
            navItemsV194();


        let selected =
            nav.find(
                element =>
                    element.classList.contains(
                        'active'
                    )
                    ||
                    element.classList.contains(
                        'selected'
                    )
                    ||
                    element.getAttribute(
                        'aria-selected'
                    )
                    ===
                    'true'
                    ||
                    element.getAttribute(
                        'aria-current'
                    )
                    ===
                    'page'
            );


        if(!selected){

            selected =
                nav.find(
                    element =>
                        normalizeV194(
                            element.textContent
                        )
                        ===
                        'live'
                );
        }


        if(selected){

            styleSelectedNavV194(
                reference,
                selected
            );
        }


        /*
         * Preserve visual parity when another top tab is clicked.
         */

        for(
            const item
            of nav
        ){

            item.addEventListener(
                'click',
                ()=>{

                    requestAnimationFrame(
                        ()=>{

                            styleSelectedNavV194(
                                reference,
                                item
                            );
                        }
                    );
                }
            );
        }
    }


    /*
     * Two RAFs ensure all earlier dashboard initialization and
     * presentation code has finished before we take the computed
     * style sample.
     */

    function startV194(){

        /*
         * LIVE STARTUP CLEANUP 3B
         *
         * Preserve the historical presentation installer,
         * but remove its artificial multi-frame startup delay.
         */
        installParityV194();
    }


    if(
        document.readyState
        ===
        'loading'
    ){

        document.addEventListener(
            'DOMContentLoaded',
            startV194,
            {
                once:
                    true
            }
        );

    }
    else{

        startV194();
    }

})();


/* ================================================================
   STITCH_BRIDGE_CONTROL_STYLE_V195

   BRIDGE OFFLINE is now the visual reference.

   GREEN equivalent:
       YOLO
       Composite
       Configure
       Enter Teleop
       Reset view
       selected navigation tab

   AMBER exact reference:
       Stop

   Copies:
       background opacity
       border opacity
       border width/style
       radius
       shadow
       transition
       overall opacity

   Existing size/layout/functionality remains untouched.

   No MutationObserver.
   No interval.
   No polling.
   ================================================================ */

(function(){

    const GREEN_V195 = {
        r: 142,
        g: 203,
        b: 127
    };


    function normalizeV195(value){

        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }


    /* ------------------------------------------------------------
       FIND BRIDGE OFFLINE CHIP
       ------------------------------------------------------------ */

    function findBridgeChipV195(){

        const root =
            document.getElementById('view-live')
            || document;


        const candidates = [
            ...root.querySelectorAll(
                'span,strong,div,button'
            )
        ];


        return candidates.find(element =>
            normalizeV195(element.textContent)
                === 'bridge offline'
        ) || null;
    }


    /* ------------------------------------------------------------
       RGB / RGBA PARSER
       ------------------------------------------------------------ */

    function parseColorV195(value){

        const raw =
            String(value || '').trim();


        let match = raw.match(
            /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/
        );


        if(!match){
            return null;
        }


        return {
            r: Number(match[1]),
            g: Number(match[2]),
            b: Number(match[3]),
            a:
                match[4] === undefined
                    ? 1
                    : Number(match[4])
        };
    }


    function greenEquivalentV195(
        source,
        fallbackAlpha
    ){

        const parsed =
            parseColorV195(source);


        const alpha =
            parsed && Number.isFinite(parsed.a)
                ? parsed.a
                : fallbackAlpha;


        return `rgba(${GREEN_V195.r}, ${GREEN_V195.g}, ${GREEN_V195.b}, ${alpha})`;
    }


    /* ------------------------------------------------------------
       FIND INTERACTIVE CONTROL BY EXACT TEXT
       ------------------------------------------------------------ */

    function exactControlV195(
        wanted,
        scope = document
    ){

        const candidates = [
            ...scope.querySelectorAll(
                'button,a,label,[role="button"],[role="tab"]'
            )
        ];


        return candidates.find(element =>
            normalizeV195(element.textContent)
                === wanted
        ) || null;
    }


    /* ------------------------------------------------------------
       COPY STRUCTURAL APPEARANCE
       ------------------------------------------------------------ */

    const STRUCTURE_V195 = [
        'border-top-width',
        'border-right-width',
        'border-bottom-width',
        'border-left-width',

        'border-top-style',
        'border-right-style',
        'border-bottom-style',
        'border-left-style',

        'border-top-left-radius',
        'border-top-right-radius',
        'border-bottom-right-radius',
        'border-bottom-left-radius',

        'box-shadow',
        'opacity',
        'transition'
    ];


    function copyStructureV195(
        referenceStyle,
        target
    ){

        for(const property of STRUCTURE_V195){

            target.style.setProperty(
                property,
                referenceStyle.getPropertyValue(property),
                'important'
            );
        }
    }


    /* ------------------------------------------------------------
       GREEN VERSION OF BRIDGE CHIP
       ------------------------------------------------------------ */

    function makeGreenV195(
        referenceStyle,
        target
    ){

        if(!target){
            return;
        }


        copyStructureV195(
            referenceStyle,
            target
        );


        target.style.setProperty(
            'background-color',
            greenEquivalentV195(
                referenceStyle.backgroundColor,
                0.08
            ),
            'important'
        );


        for(const side of [
            'top',
            'right',
            'bottom',
            'left'
        ]){

            target.style.setProperty(
                `border-${side}-color`,
                greenEquivalentV195(
                    referenceStyle.getPropertyValue(
                        `border-${side}-color`
                    ),
                    0.30
                ),
                'important'
            );
        }


        target.style.setProperty(
            'color',
            '#8ecb7f',
            'important'
        );


        target.dataset.stitchBridgeStyleV195 =
            'green';


        target
            .querySelectorAll('span,strong')
            .forEach(child => {

                child.style.setProperty(
                    'color',
                    '#8ecb7f',
                    'important'
                );

                child.style.setProperty(
                    'opacity',
                    '1',
                    'important'
                );
            });


        target
            .querySelectorAll(
                'input[type="checkbox"]'
            )
            .forEach(input => {

                input.style.setProperty(
                    'accent-color',
                    '#8ecb7f',
                    'important'
                );
            });
    }


    /* ------------------------------------------------------------
       STOP = EXACT BRIDGE OFFLINE AMBER TREATMENT
       ------------------------------------------------------------ */

    function makeAmberV195(
        referenceStyle,
        target
    ){

        if(!target){
            return;
        }


        copyStructureV195(
            referenceStyle,
            target
        );


        target.style.setProperty(
            'background-color',
            referenceStyle.backgroundColor,
            'important'
        );


        for(const side of [
            'top',
            'right',
            'bottom',
            'left'
        ]){

            target.style.setProperty(
                `border-${side}-color`,
                referenceStyle.getPropertyValue(
                    `border-${side}-color`
                ),
                'important'
            );
        }


        target.style.setProperty(
            'color',
            referenceStyle.color,
            'important'
        );


        target.dataset.stitchBridgeStyleV195 =
            'amber';


        target
            .querySelectorAll('span,strong')
            .forEach(child => {

                child.style.setProperty(
                    'color',
                    referenceStyle.color,
                    'important'
                );

                child.style.setProperty(
                    'opacity',
                    '1',
                    'important'
                );
            });
    }


    /* ------------------------------------------------------------
       NAV
       ------------------------------------------------------------ */

    function navItemsV195(){

        const names = new Set([
            'live',
            'slam',
            'inspect',
            'camera teleop'
        ]);


        return [
            ...document.querySelectorAll(
                'header button,header a,header [role="tab"],nav button,nav a,nav [role="tab"]'
            )
        ].filter(element =>
            names.has(
                normalizeV195(
                    element.textContent
                )
            )
        );
    }


    function clearV195(element){

        if(!element){
            return;
        }


        if(
            !element.dataset.stitchBridgeStyleV195
        ){
            return;
        }


        const properties = [
            ...STRUCTURE_V195,

            'background-color',
            'border-top-color',
            'border-right-color',
            'border-bottom-color',
            'border-left-color',
            'color'
        ];


        for(const property of properties){

            element.style.removeProperty(
                property
            );
        }


        delete element.dataset.stitchBridgeStyleV195;
    }


    function applySelectedNavV195(
        referenceStyle,
        selected
    ){

        for(const item of navItemsV195()){

            if(item === selected){

                makeGreenV195(
                    referenceStyle,
                    item
                );

            }else{

                clearV195(item);
            }
        }
    }


    /* ------------------------------------------------------------
       INSTALL
       ------------------------------------------------------------ */

    function installV195(){

        const bridge =
            findBridgeChipV195();


        if(!bridge){

            console.warn(
                'V1.9.5: BRIDGE OFFLINE reference not found'
            );

            return;
        }


        const referenceStyle =
            getComputedStyle(bridge);


        const live =
            document.getElementById('view-live')
            || document;


        const controller =
            document.querySelector(
                '#view-live .stitch-controller-section'
            )
            || live;


        const greenTargets = [

            document.getElementById(
                'cameraYoloControl'
            ),

            document.querySelector(
                '.stitch-health-trigger-v174'
            )
            ||
            exactControlV195(
                'composite',
                live
            ),

            document.getElementById(
                'controllerConfigureBtn'
            )
            ||
            exactControlV195(
                'configure',
                controller
            ),

            exactControlV195(
                'enter teleop',
                controller
            ),

            document.getElementById(
                'resetView'
            )
            ||
            document.getElementById(
                'twinResetView'
            )
            ||
            exactControlV195(
                'reset view',
                live
            )

        ].filter(Boolean);


        for(
            const target
            of new Set(greenTargets)
        ){

            makeGreenV195(
                referenceStyle,
                target
            );
        }


        const stop =
            document.getElementById(
                'controllerStopBtn'
            )
            ||
            exactControlV195(
                'stop',
                controller
            );


        makeAmberV195(
            referenceStyle,
            stop
        );


        /* Initial selected nav */

        const nav =
            navItemsV195();


        let selected =
            nav.find(element =>
                element.classList.contains('active')
                ||
                element.classList.contains('selected')
                ||
                element.getAttribute('aria-selected')
                    === 'true'
                ||
                element.getAttribute('aria-current')
                    === 'page'
            );


        if(!selected){

            selected =
                nav.find(element =>
                    normalizeV195(
                        element.textContent
                    )
                    === 'live'
                );
        }


        if(selected){

            applySelectedNavV195(
                referenceStyle,
                selected
            );
        }


        /*
         * When changing tabs, run after the older V1.9.4 handler.
         */

        for(const item of nav){

            item.addEventListener(
                'click',
                ()=>{

                    requestAnimationFrame(
                        ()=>{

                            requestAnimationFrame(
                                ()=>{

                                    applySelectedNavV195(
                                        referenceStyle,
                                        item
                                    );
                                }
                            );
                        }
                    );
                }
            );
        }
    }


    /*
     * Run AFTER older presentation patches.
     */

    function startV195(){

        /*
         * LIVE STARTUP CLEANUP 3B
         *
         * Preserve the historical presentation installer,
         * but remove its artificial multi-frame startup delay.
         */
        installV195();
    }


    if(document.readyState === 'loading'){

        document.addEventListener(
            'DOMContentLoaded',
            startV195,
            {
                once: true
            }
        );

    }else{

        startV195();
    }

})();


/* ================================================================
   STITCH_GREEN_CONTROLS_V196

   Correct green equivalent of BRIDGE OFFLINE.

   IMPORTANT:
   - preserves the dark bridge-chip background
   - does NOT turn that background into opaque green
   - green is used only for line/text/accent treatment
   - STOP is intentionally untouched because it is correct now

   Targets:
       YOLO
       Composite
       Configure
       Enter Teleop
       Reset view
       selected navigation tab

   No MutationObserver.
   No interval.
   No polling.
   ================================================================ */

(function(){

    const GREEN_V196 =
        '#8ecb7f';

    const GREEN_BORDER_V196 =
        'rgba(142, 203, 127, 0.38)';


    function normalizeV196(value){

        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }


    function exactControlV196(
        wanted,
        scope = document
    ){

        return [
            ...scope.querySelectorAll(
                'button,a,label,[role="button"],[role="tab"]'
            )
        ].find(
            element =>
                normalizeV196(
                    element.textContent
                )
                ===
                wanted
        ) || null;
    }


    /* ============================================================
       BRIDGE REFERENCE
       ============================================================ */

    function runtimeReferenceV196() {
    return (
        document.getElementById(
            "stitchCtrlChip"
        )
        || document.getElementById(
            "controllerProcessChip"
        )
    );
}



    /* ============================================================
       GREEN CONTROL STYLE
       ============================================================ */

    function applyGreenV196(
        bridgeStyle,
        target
    ){

        if(!target){
            return;
        }


        /*
         * FIRST:
         * overwrite the bad solid green background from V1.9.5.
         *
         * We use the bridge's actual dark background unchanged.
         */

        /*
         * Preserve the BRIDGE OFFLINE fill OPACITY,
         * but use the Bacalbasa green hue instead of amber.
         */
        const bridgeBgV197 =
            String(
                bridgeStyle.backgroundColor || ''
            );

        const alphaMatchV197 =
            bridgeBgV197.match(
                /rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/
            );

        const greenAlphaV197 =
            alphaMatchV197
            ? Number(alphaMatchV197[1])
            : 0.08;

        target.style.setProperty(
            'background-color',
            `rgba(142, 203, 127, ${greenAlphaV197})`,
            'important'
        );


        target.style.setProperty(
            'background-image',
            'none',
            'important'
        );


        /*
         * Copy bridge geometry / subtlety.
         */

        const structural = [

            'border-top-width',
            'border-right-width',
            'border-bottom-width',
            'border-left-width',

            'border-top-style',
            'border-right-style',
            'border-bottom-style',
            'border-left-style',

            'border-top-left-radius',
            'border-top-right-radius',
            'border-bottom-right-radius',
            'border-bottom-left-radius',

            'box-shadow',
            'opacity',
            'transition'
        ];


        for(
            const property
            of structural
        ){

            target.style.setProperty(
                property,
                bridgeStyle.getPropertyValue(
                    property
                ),
                'important'
            );
        }


        /*
         * Same restrained line strength,
         * but in Bacalbasa green.
         */

        for(
            const side
            of [
                'top',
                'right',
                'bottom',
                'left'
            ]
        ){

            target.style.setProperty(
                `border-${side}-color`,
                GREEN_BORDER_V196,
                'important'
            );
        }


        target.style.setProperty(
            'color',
            GREEN_V196,
            'important'
        );


        /*
         * Explicitly restore visible labels.
         */

        target
            .querySelectorAll(
                'span,strong'
            )
            .forEach(
                child => {

                    child.style.setProperty(
                        'color',
                        GREEN_V196,
                        'important'
                    );

                    child.style.setProperty(
                        'opacity',
                        '1',
                        'important'
                    );
                }
            );


        /*
         * YOLO checkbox stays fully functional and visible.
         */

        target
            .querySelectorAll(
                'input[type="checkbox"]'
            )
            .forEach(
                input => {

                    input.style.setProperty(
                        'accent-color',
                        GREEN_V196,
                        'important'
                    );

                    input.style.setProperty(
                        'opacity',
                        '1',
                        'important'
                    );
                }
            );


        target.dataset.stitchGreenV196 =
            'true';
    }


    /* ============================================================
       SELECTED NAV
       ============================================================ */

    function navItemsV196(){

        const allowed =
            new Set([
                'live',
                'slam',
                'inspect',
                'camera teleop'
            ]);


        return [
            ...document.querySelectorAll(
                'header button,header a,header [role="tab"],nav button,nav a,nav [role="tab"]'
            )
        ].filter(
            element =>
                allowed.has(
                    normalizeV196(
                        element.textContent
                    )
                )
        );
    }


    function clearGreenV196(
        element
    ){

        if(
            !element
            ||
            !element.dataset.stitchGreenV196
        ){
            return;
        }


        const properties = [

            'background-color',
            'background-image',

            'border-top-color',
            'border-right-color',
            'border-bottom-color',
            'border-left-color',

            'border-top-width',
            'border-right-width',
            'border-bottom-width',
            'border-left-width',

            'border-top-style',
            'border-right-style',
            'border-bottom-style',
            'border-left-style',

            'border-top-left-radius',
            'border-top-right-radius',
            'border-bottom-right-radius',
            'border-bottom-left-radius',

            'box-shadow',
            'opacity',
            'transition',
            'color'
        ];


        for(
            const property
            of properties
        ){

            element.style.removeProperty(
                property
            );
        }


        delete element.dataset.stitchGreenV196;
    }


    function selectNavV196(
        bridgeStyle,
        selected
    ){

        for(
            const item
            of navItemsV196()
        ){

            if(
                item === selected
            ){

                applyGreenV196(
                    bridgeStyle,
                    item
                );

            }
            else{

                clearGreenV196(
                    item
                );
            }
        }
    }


    /* ============================================================
       INSTALL
       ============================================================ */

    function installV196(){

        const bridge =
            runtimeReferenceV196();


        if(!bridge){

            console.warn(
                'V1.9.6: BRIDGE OFFLINE reference not found'
            );

            return;
        }


        const bridgeStyle =
            getComputedStyle(
                bridge
            );


        const live =
            document.getElementById(
                'view-live'
            )
            || document;


        const controller =
            document.querySelector(
                '#view-live .stitch-controller-section'
            )
            || live;


        const greenTargets = [

            document.getElementById(
                'cameraYoloControl'
            ),

            document.querySelector(
                '.stitch-health-trigger-v174'
            )
            ||
            exactControlV196(
                'composite',
                live
            ),

            document.getElementById(
                'controllerConfigureBtn'
            )
            ||
            exactControlV196(
                'configure',
                controller
            ),

            exactControlV196(
                'enter teleop',
                controller
            ),

            document.getElementById(
                'resetView'
            )
            ||
            document.getElementById(
                'twinResetView'
            )
            ||
            exactControlV196(
                'reset view',
                live
            )

        ].filter(Boolean);


        for(
            const target
            of new Set(
                greenTargets
            )
        ){

            applyGreenV196(
                bridgeStyle,
                target
            );
        }


        /*
         * STOP IS DELIBERATELY NOT MODIFIED.
         * V1.9.5 already has it correct.
         */


        const nav =
            navItemsV196();


        let selected =
            nav.find(
                element =>
                    element.classList.contains(
                        'active'
                    )
                    ||
                    element.classList.contains(
                        'selected'
                    )
                    ||
                    element.getAttribute(
                        'aria-selected'
                    )
                    ===
                    'true'
                    ||
                    element.getAttribute(
                        'aria-current'
                    )
                    ===
                    'page'
            );


        if(!selected){

            selected =
                nav.find(
                    element =>
                        normalizeV196(
                            element.textContent
                        )
                        ===
                        'live'
                );
        }


        if(selected){

            selectNavV196(
                bridgeStyle,
                selected
            );
        }


        /*
         * Maintain selected-tab appearance after clicks.
         *
         * Not continuous; runs only on an actual navigation click.
         */

        for(
            const item
            of nav
        ){

            item.addEventListener(
                'click',
                ()=>{

                    requestAnimationFrame(
                        ()=>{

                            requestAnimationFrame(
                                ()=>{

                                    selectNavV196(
                                        bridgeStyle,
                                        item
                                    );
                                }
                            );
                        }
                    );
                }
            );
        }
    }


    /*
     * V1.9.5 uses several RAFs.
     * Run after it once so V1.9.6 is authoritative.
     */

    function startV196(){

        /*
         * LIVE STARTUP CLEANUP 3B
         *
         * Preserve the historical presentation installer,
         * but remove its artificial multi-frame startup delay.
         */
        installV196();
    }


    if(
        document.readyState
        ===
        'loading'
    ){

        document.addEventListener(
            'DOMContentLoaded',
            startV196,
            {
                once:
                    true
            }
        );

    }
    else{

        startV196();
    }

})();

/* ================================================================
   STITCH_CONTROL_FILL_V198

   Background tint intensity comes from the ACTUAL active 04/05
   camera icon.

   Only background-color changes.

   GREEN:
       YOLO
       Composite
       Configure
       Enter Teleop
       Reset view
       selected navigation tab

   AMBER:
       Stop
       Bridge Offline
       Ctrl Offline

   Borders / text / dimensions / functionality remain untouched.

   No MutationObserver.
   No interval.
   No polling.
   ================================================================ */

(function(){

    function normalizeV198(value){

        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }


    function exactControlV198(
        wanted,
        scope = document
    ){

        return [
            ...scope.querySelectorAll(
                'button,a,label,[role="button"],[role="tab"]'
            )
        ].find(
            element =>
                normalizeV198(
                    element.textContent
                ) === wanted
        ) || null;
    }


    /* ------------------------------------------------------------
       FIND REAL ACTIVE 04 / 05 ICON
       ------------------------------------------------------------ */

    function activeIconV198(){

        const panel =
            document.querySelector(
                '#view-live .camera-panel'
            );

        if(!panel){
            return null;
        }


        const walker =
            document.createTreeWalker(
                panel,
                NodeFilter.SHOW_TEXT
            );


        let node;


        while(
            (
                node =
                    walker.nextNode()
            )
        ){

            const text =
                normalizeV198(
                    node.nodeValue
                );


            if(
                text !== '04'
                &&
                text !== '05'
            ){
                continue;
            }


            let element =
                node.parentElement;


            while(
                element
                &&
                panel.contains(element)
            ){

                const rect =
                    element.getBoundingClientRect();


                const style =
                    getComputedStyle(
                        element
                    );


                if(
                    rect.width >= 30
                    &&
                    rect.width <= 90
                    &&
                    rect.height >= 25
                    &&
                    rect.height <= 80
                    &&
                    parseFloat(
                        style.borderTopWidth
                    ) > 0
                ){
                    return element;
                }


                element =
                    element.parentElement;
            }
        }


        return null;
    }


    /* ------------------------------------------------------------
       GET ONLY THE REFERENCE BACKGROUND ALPHA
       ------------------------------------------------------------ */

    function backgroundAlphaV198(
        color
    ){

        const value =
            String(color || '');


        let match =
            value.match(
                /rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/
            );


        if(match){

            const alpha =
                Number(
                    match[1]
                );


            if(Number.isFinite(alpha)){
                return alpha;
            }
        }


        /*
         * If the icon's computed color is returned as opaque RGB,
         * use the restrained visual equivalent we already see in
         * the icon bar rather than creating another solid fill.
         */
        return 0.055;
    }


    function applyFillV198(
        element,
        rgb,
        alpha
    ){

        if(!element){
            return;
        }


        element.style.setProperty(
            'background-color',
            `rgba(${rgb}, ${alpha})`,
            'important'
        );


        element.style.setProperty(
            'background-image',
            'none',
            'important'
        );
    }


    /* ------------------------------------------------------------
       INSTALL
       ------------------------------------------------------------ */

    function installV198(){

        const reference =
            activeIconV198();


        if(!reference){

            console.warn(
                'V1.9.8: active 04/05 icon not found'
            );

            return;
        }


        const alpha =
            backgroundAlphaV198(
                getComputedStyle(
                    reference
                ).backgroundColor
            );


        const live =
            document.getElementById(
                'view-live'
            )
            || document;


        const controller =
            document.querySelector(
                '#view-live .stitch-controller-section'
            )
            || live;


        /* ---------------- GREEN ---------------- */

        const green = [

            document.getElementById(
                'cameraYoloControl'
            ),

            document.querySelector(
                '.stitch-health-trigger-v174'
            )
            ||
            exactControlV198(
                'composite',
                live
            ),

            document.getElementById(
                'controllerConfigureBtn'
            )
            ||
            exactControlV198(
                'configure',
                controller
            ),

            exactControlV198(
                'enter teleop',
                controller
            ),

            document.getElementById(
                'resetView'
            )
            ||
            document.getElementById(
                'twinResetView'
            )
            ||
            exactControlV198(
                'reset view',
                live
            )

        ].filter(Boolean);


        for(
            const element
            of new Set(green)
        ){

            applyFillV198(
                element,
                '142, 203, 127',
                alpha
            );
        }


        /* selected top navigation item */

        const navNames =
            new Set([
                'live',
                'slam',
                'inspect',
                'camera teleop'
            ]);


        const nav =
            [
                ...document.querySelectorAll(
                    'header button,header a,header [role="tab"],nav button,nav a,nav [role="tab"]'
                )
            ].filter(
                element =>
                    navNames.has(
                        normalizeV198(
                            element.textContent
                        )
                    )
            );


        let selected =
            nav.find(
                element =>
                    element.classList.contains('active')
                    ||
                    element.classList.contains('selected')
                    ||
                    element.getAttribute('aria-selected') === 'true'
                    ||
                    element.getAttribute('aria-current') === 'page'
            );


        if(!selected){

            selected =
                nav.find(
                    element =>
                        normalizeV198(
                            element.textContent
                        ) === 'live'
                );
        }


        if(selected){

            applyFillV198(
                selected,
                '142, 203, 127',
                alpha
            );
        }


        /* ---------------- AMBER ---------------- */

        const amber = [

            document.getElementById(
                'controllerStopBtn'
            )
            ||
            exactControlV198(
                'stop',
                controller
            ),

            document.getElementById(
                'stitchCtrlChip'
            )

        ].filter(Boolean);


        for(
            const element
            of new Set(amber)
        ){

            applyFillV198(
                element,
                '245, 158, 11',
                alpha
            );
        }


        /*
         * Navigation only needs updating on a real tab click.
         */

        for(const item of nav){

            item.addEventListener(
                'click',
                ()=>{

                    requestAnimationFrame(
                        ()=>{

                            for(const other of nav){

                                if(other !== item){

                                    other.style.removeProperty(
                                        'background-color'
                                    );

                                    other.style.removeProperty(
                                        'background-image'
                                    );
                                }
                            }


                            applyFillV198(
                                item,
                                '142, 203, 127',
                                alpha
                            );
                        }
                    );
                }
            );
        }


        console.debug(
            'V1.9.8 icon-equivalent fill alpha:',
            alpha
        );
    }


    /*
     * Run after the previous presentation patches.
     */

    function startV198(){

        /*
         * LIVE STARTUP CLEANUP 3B
         *
         * Preserve the historical presentation installer,
         * but remove its artificial multi-frame startup delay.
         */
        installV198();
    }


    if(document.readyState === 'loading'){

        document.addEventListener(
            'DOMContentLoaded',
            startV198,
            {
                once: true
            }
        );

    }else{

        startV198();
    }

})();


/* ================================================================
   STITCH_RESET_COMPOSITE_PARITY_V199

   Reset View copies the ACTUAL rendered Composite control.

   Copies visual language + dimensions only.
   Does NOT replace either element.
   Does NOT alter click handlers.

   No MutationObserver.
   No interval.
   No polling.
   ================================================================ */

(function(){

    function normalizeV199(value){

        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }


    function exactControlV199(
        wanted,
        scope = document
    ){

        return [
            ...scope.querySelectorAll(
                'button,a,label,[role="button"],[role="tab"]'
            )
        ].find(
            element =>
                normalizeV199(
                    element.textContent
                ) === wanted
        ) || null;
    }


    function installV199(){

        const live =
            document.getElementById('view-live')
            || document;


        const composite =
            document.querySelector(
                '#view-live .stitch-health-trigger-v174'
            )
            ||
            exactControlV199(
                'composite',
                live
            );


        const reset =
            document.getElementById(
                'resetView'
            )
            ||
            document.getElementById(
                'twinResetView'
            )
            ||
            exactControlV199(
                'reset view',
                live
            );


        if(!composite){

            console.warn(
                'V1.9.9: Composite control not found'
            );

            return;
        }


        if(!reset){

            console.warn(
                'V1.9.9: Reset View control not found'
            );

            return;
        }


        /*
         * V1.9.10:
         * Compact both controls horizontally.
         *
         * Composite is resized first, then Reset samples the
         * resulting rendered dimensions.
         */
        const compactWidthV1910 =
            106;


        composite.style.setProperty(
            'width',
            `${compactWidthV1910}px`,
            'important'
        );

        composite.style.setProperty(
            'min-width',
            `${compactWidthV1910}px`,
            'important'
        );

        composite.style.setProperty(
            'max-width',
            `${compactWidthV1910}px`,
            'important'
        );

        composite.style.setProperty(
            'flex',
            `0 0 ${compactWidthV1910}px`,
            'important'
        );

        composite.style.setProperty(
            'box-sizing',
            'border-box',
            'important'
        );


        const style =
            getComputedStyle(
                composite
            );


        const rect =
            composite.getBoundingClientRect();


        /*
         * Exact external dimensions.
         */

        reset.style.setProperty(
            'width',
            `${rect.width}px`,
            'important'
        );

        reset.style.setProperty(
            'min-width',
            `${rect.width}px`,
            'important'
        );

        reset.style.setProperty(
            'max-width',
            `${rect.width}px`,
            'important'
        );

        reset.style.setProperty(
            'height',
            `${rect.height}px`,
            'important'
        );

        reset.style.setProperty(
            'min-height',
            `${rect.height}px`,
            'important'
        );

        reset.style.setProperty(
            'max-height',
            `${rect.height}px`,
            'important'
        );


        /*
         * Typography.
         */

        const typography = [

            'font-family',
            'font-size',
            'font-weight',
            'font-style',
            'line-height',
            'letter-spacing',
            'text-transform',
            'color',

        ];


        for(
            const property
            of typography
        ){

            reset.style.setProperty(
                property,
                style.getPropertyValue(
                    property
                ),
                'important'
            );
        }


        /*
         * Interior sizing/alignment.
         */

        const box = [

            'padding-top',
            'padding-right',
            'padding-bottom',
            'padding-left',

            'border-top-width',
            'border-right-width',
            'border-bottom-width',
            'border-left-width',

            'border-top-style',
            'border-right-style',
            'border-bottom-style',
            'border-left-style',

            'border-top-color',
            'border-right-color',
            'border-bottom-color',
            'border-left-color',

            'border-top-left-radius',
            'border-top-right-radius',
            'border-bottom-right-radius',
            'border-bottom-left-radius',

            'background-color',
            'background-image',

            'box-shadow',
            'opacity',

        ];


        for(
            const property
            of box
        ){

            reset.style.setProperty(
                property,
                style.getPropertyValue(
                    property
                ),
                'important'
            );
        }


        /*
         * Keep Reset View's own text centered.
         */

        reset.style.setProperty(
            'display',
            'inline-flex',
            'important'
        );

        reset.style.setProperty(
            'align-items',
            'center',
            'important'
        );

        reset.style.setProperty(
            'justify-content',
            'center',
            'important'
        );

        reset.style.setProperty(
            'white-space',
            'nowrap',
            'important'
        );


        /*
         * Composite has intentionally asymmetric padding because
         * it contains the dropdown arrow.
         *
         * Reset does not, so give it symmetric padding to center
         * the wording inside the full button rectangle.
         */
        reset.style.setProperty(
            'padding-left',
            '10px',
            'important'
        );

        reset.style.setProperty(
            'padding-right',
            '10px',
            'important'
        );

        reset.style.setProperty(
            'text-align',
            'center',
            'important'
        );

        reset.style.setProperty(
            'text-indent',
            '0',
            'important'
        );

        reset.style.setProperty(
            'box-sizing',
            'border-box',
            'important'
        );

        reset.style.setProperty(
            'flex',
            `0 0 ${compactWidthV1910}px`,
            'important'
        );


        reset.dataset.stitchResetCompositeV199 =
            'true';
    }


    /*
     * Run after the earlier control-style patches have completed,
     * so Composite is sampled in its FINAL rendered appearance.
     */

    function startV199(){

        /*
         * LIVE STARTUP CLEANUP 3B
         *
         * Preserve the historical presentation installer,
         * but remove its artificial multi-frame startup delay.
         */
        installV199();
    }


    if(document.readyState === 'loading'){

        document.addEventListener(
            'DOMContentLoaded',
            startV199,
            {
                once: true
            }
        );

    }else{

        startV199();
    }

})();

/* ================================================================
   STITCH_UI_PARITY_V1911

   1. Configure / Stop / Enter Teleop:
      typography matches Reset View exactly.
      Existing green / amber colors remain unchanged.

   2. LEFT ARM:
      exact typography/color parity with ARM OWNERSHIP.

   3. YOLO:
      becomes plain checkbox + text like Health.
      Existing checkbox functionality is preserved.

   One-time presentation adjustment.
   No MutationObserver.
   No interval.
   No polling.
   ================================================================ */

(function(){

    function normalizeV1911(value){

        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }


    function exactElementV1911(
        wanted,
        scope = document
    ){

        const candidates = [
            ...scope.querySelectorAll(
                'button,a,label,span,strong,div,p,[role="button"],[role="tab"]'
            )
        ];

        /*
         * Prefer the deepest exact text match.
         */
        return candidates
            .filter(
                element =>
                    normalizeV1911(
                        element.textContent
                    ) === wanted
            )
            .sort(
                (a,b) => {

                    function depth(element){

                        let d = 0;

                        while(element){
                            d += 1;
                            element = element.parentElement;
                        }

                        return d;
                    }

                    return depth(b) - depth(a);
                }
            )[0] || null;
    }


    function exactInteractiveV1911(
        wanted,
        scope = document
    ){

        return [
            ...scope.querySelectorAll(
                'button,a,label,[role="button"],[role="tab"]'
            )
        ].find(
            element =>
                normalizeV1911(
                    element.textContent
                ) === wanted
        ) || null;
    }


    /* ============================================================
       1. BUTTON TEXT -> RESET VIEW TYPOGRAPHY
       ============================================================ */

    function applyResetTypographyV1911(){

        const live =
            document.getElementById('view-live')
            || document;


        const reset =
            document.getElementById('resetView')
            ||
            document.getElementById('twinResetView')
            ||
            exactInteractiveV1911(
                'reset view',
                live
            );


        if(!reset){
            console.warn(
                'V1.9.11: Reset View reference not found'
            );
            return;
        }


        const resetStyle =
            getComputedStyle(reset);


        const controller =
            document.querySelector(
                '#view-live .stitch-controller-section'
            )
            || live;


        const configure =
            document.getElementById(
                'controllerConfigureBtn'
            )
            ||
            exactInteractiveV1911(
                'configure',
                controller
            );


        const stop =
            document.getElementById(
                'controllerStopBtn'
            )
            ||
            exactInteractiveV1911(
                'stop',
                controller
            );


        const enter =
            exactInteractiveV1911(
                'enter teleop',
                controller
            );


        const typography = [
            'font-family',
            'font-size',
            'font-weight',
            'font-style',
            'line-height',
            'letter-spacing',
            'text-transform',
            'text-decoration',
            'font-variant',
            'font-variant-numeric'
        ];


        for(
            const target
            of [configure, stop, enter].filter(Boolean)
        ){

            for(
                const property
                of typography
            ){

                target.style.setProperty(
                    property,
                    resetStyle.getPropertyValue(
                        property
                    ),
                    'important'
                );
            }


            /*
             * Keep wording visually centered.
             */

            target.style.setProperty(
                'text-align',
                'center',
                'important'
            );

            target.style.setProperty(
                'align-items',
                'center',
                'important'
            );

            target.style.setProperty(
                'justify-content',
                'center',
                'important'
            );


            /*
             * Do NOT copy Reset View's color.
             *
             * Configure / Enter remain green.
             * Stop remains amber.
             */
        }
    }


    /* ============================================================
       2. LEFT ARM -> ARM OWNERSHIP TYPOGRAPHY
       ============================================================ */

    function applyArmOwnershipParityV1911(){

        const live =
            document.getElementById('view-live')
            || document;


        const mode =
            document.querySelector(
                '#view-live .stitch-mode-section'
            )
            || live;


        const joint =
            document.querySelector(
                '#view-live .stitch-joint-section'
            )
            || live;


        const reference =
            exactElementV1911(
                'arm ownership',
                mode
            );


        const leftArm =
            exactElementV1911(
                'left arm',
                joint
            );


        if(!reference){

            console.warn(
                'V1.9.11: ARM OWNERSHIP reference not found'
            );

            return;
        }


        if(!leftArm){

            console.warn(
                'V1.9.11: LEFT ARM element not found'
            );

            return;
        }


        const style =
            getComputedStyle(
                reference
            );


        const properties = [
            'font-family',
            'font-size',
            'font-weight',
            'font-style',
            'line-height',
            'letter-spacing',
            'text-transform',
            'color',
            'opacity',
            'text-shadow'
        ];


        for(
            const property
            of properties
        ){

            leftArm.style.setProperty(
                property,
                style.getPropertyValue(
                    property
                ),
                'important'
            );
        }
    }


    /* ============================================================
       3. YOLO -> HEALTH CHECKBOX PRESENTATION
       ============================================================ */

    function checkboxControlV1911(
        wanted,
        scope
    ){

        const labels = [
            ...scope.querySelectorAll(
                'label'
            )
        ];


        let match =
            labels.find(
                label =>
                    normalizeV1911(
                        label.textContent
                    ) === wanted
                    &&
                    label.querySelector(
                        'input[type="checkbox"]'
                    )
            );


        if(match){
            return match;
        }


        /*
         * Fallback for wrappers that are not labels.
         */

        const all = [
            ...scope.querySelectorAll(
                'div,span,strong'
            )
        ];


        return all.find(
            element =>
                normalizeV1911(
                    element.textContent
                ) === wanted
                &&
                element.querySelector(
                    'input[type="checkbox"]'
                )
        ) || null;
    }


    function applyYoloHealthParityV1911(){

        const live =
            document.getElementById('view-live')
            || document;


        const health =
            checkboxControlV1911(
                'health',
                live
            );


        const yolo =
            document.getElementById(
                'cameraYoloControl'
            )
            ||
            checkboxControlV1911(
                'yolo',
                live
            );


        if(!health){

            console.warn(
                'V1.9.11: Health checkbox reference not found'
            );

            return;
        }


        if(!yolo){

            console.warn(
                'V1.9.11: YOLO control not found'
            );

            return;
        }


        const healthStyle =
            getComputedStyle(
                health
            );


        /*
         * Remove ALL button/card appearance from YOLO.
         */

        yolo.style.setProperty(
            'background',
            'transparent',
            'important'
        );

        yolo.style.setProperty(
            'background-color',
            'transparent',
            'important'
        );

        yolo.style.setProperty(
            'background-image',
            'none',
            'important'
        );

        yolo.style.setProperty(
            'border',
            '0',
            'important'
        );

        yolo.style.setProperty(
            'border-radius',
            '0',
            'important'
        );

        yolo.style.setProperty(
            'box-shadow',
            'none',
            'important'
        );

        yolo.style.setProperty(
            'width',
            'auto',
            'important'
        );

        yolo.style.setProperty(
            'min-width',
            '0',
            'important'
        );

        yolo.style.setProperty(
            'max-width',
            'none',
            'important'
        );

        yolo.style.setProperty(
            'height',
            'auto',
            'important'
        );

        yolo.style.setProperty(
            'min-height',
            '0',
            'important'
        );

        yolo.style.setProperty(
            'padding',
            '0',
            'important'
        );


        /*
         * Copy Health's plain checkbox-label layout.
         */

        const layout = [
            'display',
            'align-items',
            'justify-content',
            'gap',
            'column-gap',
            'row-gap',

            'font-family',
            'font-size',
            'font-weight',
            'font-style',
            'line-height',
            'letter-spacing',
            'text-transform',
            'color',
            'opacity'
        ];


        for(
            const property
            of layout
        ){

            yolo.style.setProperty(
                property,
                healthStyle.getPropertyValue(
                    property
                ),
                'important'
            );
        }


        /*
         * Match the actual Health checkbox itself.
         */

        const healthInput =
            health.querySelector(
                'input[type="checkbox"]'
            );


        const yoloInput =
            yolo.querySelector(
                'input[type="checkbox"]'
            );


        if(
            healthInput
            &&
            yoloInput
        ){

            const inputStyle =
                getComputedStyle(
                    healthInput
                );


            const inputProperties = [
                'width',
                'height',
                'margin-top',
                'margin-right',
                'margin-bottom',
                'margin-left',
                'accent-color',
                'opacity'
            ];


            for(
                const property
                of inputProperties
            ){

                yoloInput.style.setProperty(
                    property,
                    inputStyle.getPropertyValue(
                        property
                    ),
                    'important'
                );
            }
        }


        /*
         * Older YOLO styling used pseudo-elements.
         * Tag the corrected element so CSS can neutralize them.
         */

        yolo.dataset.stitchYoloHealthV1911 =
            'true';
    }


    /* ============================================================
       INSTALL AFTER EXISTING PRESENTATION PATCHES
       ============================================================ */

    function installV1911(){

        applyResetTypographyV1911();

        applyArmOwnershipParityV1911();

        applyYoloHealthParityV1911();
    }


    function startV1911(){

        /*
         * LIVE STARTUP CLEANUP 3B
         *
         * Preserve the historical presentation installer,
         * but remove its artificial multi-frame startup delay.
         */
        installV1911();
    }


    if(document.readyState === 'loading'){

        document.addEventListener(
            'DOMContentLoaded',
            startV1911,
            {
                once: true
            }
        );

    }else{

        startV1911();
    }

})();


/* ================================================================
   STITCH_UI_ALIGNMENT_V1912

   1. YOLO typography = Health typography
      + shift 12px right.

   2. ENTER TELEOP -> Enter Teleop.

   3. ARM OWNERSHIP + its underline are vertically aligned
      with MODE.

   Presentation only.
   No MutationObserver.
   No interval.
   No polling.
   ================================================================ */

(function(){

    function normalizeV1912(value){

        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }


    function exactElementV1912(
        wanted,
        scope = document
    ){

        return [
            ...scope.querySelectorAll(
                'button,a,label,span,strong,div,p,[role="button"],[role="tab"]'
            )
        ]
        .filter(
            element =>
                normalizeV1912(
                    element.textContent
                ) === wanted
        )
        .sort(
            (a,b)=>{

                function depth(element){

                    let result = 0;

                    while(element){
                        result += 1;
                        element = element.parentElement;
                    }

                    return result;
                }

                return depth(b) - depth(a);
            }
        )[0] || null;
    }


    function checkboxLabelV1912(
        wanted,
        scope
    ){

        return [
            ...scope.querySelectorAll(
                'label,div,span'
            )
        ].find(
            element =>
                normalizeV1912(
                    element.textContent
                ) === wanted
                &&
                element.querySelector(
                    'input[type="checkbox"]'
                )
        ) || null;
    }


    /* ============================================================
       YOLO = HEALTH TYPOGRAPHY
       ============================================================ */

    function fixYoloV1912(){

        const live =
            document.getElementById('view-live')
            || document;


        const health =
            checkboxLabelV1912(
                'health',
                live
            );


        const yolo =
            document.getElementById(
                'cameraYoloControl'
            )
            ||
            checkboxLabelV1912(
                'yolo',
                live
            );


        if(!health || !yolo){
            return;
        }


        const healthStyle =
            getComputedStyle(
                health
            );


        const typography = [
            'font-family',
            'font-size',
            'font-weight',
            'font-style',
            'line-height',
            'letter-spacing',
            'text-transform',
            'color',
            'opacity',
            'text-shadow'
        ];


        for(const property of typography){

            yolo.style.setProperty(
                property,
                healthStyle.getPropertyValue(
                    property
                ),
                'important'
            );
        }


        /*
         * Make any nested YOLO text inherit the Health appearance.
         */

        yolo.querySelectorAll(
            'span,strong'
        ).forEach(child => {

            for(const property of typography){

                child.style.setProperty(
                    property,
                    healthStyle.getPropertyValue(
                        property
                    ),
                    'important'
                );
            }

        });


        /*
         * Copy Health checkbox dimensions too.
         */

        const healthInput =
            health.querySelector(
                'input[type="checkbox"]'
            );


        const yoloInput =
            yolo.querySelector(
                'input[type="checkbox"]'
            );


        if(healthInput && yoloInput){

            const inputStyle =
                getComputedStyle(
                    healthInput
                );


            for(const property of [
                'width',
                'height',
                'margin-top',
                'margin-right',
                'margin-bottom',
                'margin-left',
                'accent-color',
                'opacity'
            ]){

                yoloInput.style.setProperty(
                    property,
                    inputStyle.getPropertyValue(
                        property
                    ),
                    'important'
                );
            }
        }


        /*
         * Move the complete YOLO checkbox/label slightly right.
         */

        yolo.style.setProperty(
            'position',
            'relative',
            'important'
        );

        yolo.style.setProperty(
            'left',
            '12px',
            'important'
        );

        yolo.style.setProperty(
            'top',
            '0',
            'important'
        );
    }


    /* ============================================================
       ENTER TELEOP -> Enter Teleop
       ============================================================ */

    function fixEnterTextV1912(){

        const controller =
            document.querySelector(
                '#view-live .stitch-controller-section'
            )
            ||
            document.getElementById(
                'view-live'
            )
            ||
            document;


        const button =
            [
                ...controller.querySelectorAll(
                    'button,[role="button"]'
                )
            ].find(
                element =>
                    normalizeV1912(
                        element.textContent
                    ) === 'enter teleop'
            );


        if(!button){
            return;
        }


        const directTextNodes =
            [...button.childNodes]
                .filter(
                    node =>
                        node.nodeType === Node.TEXT_NODE
                        &&
                        normalizeV1912(
                            node.nodeValue
                        ) === 'enter teleop'
                );


        if(directTextNodes.length){

            directTextNodes.forEach(
                node => {
                    node.nodeValue =
                        'Enter Teleop';
                }
            );

        }else{

            const textElement =
                exactElementV1912(
                    'enter teleop',
                    button
                );


            if(
                textElement
                &&
                textElement !== button
            ){

                textElement.textContent =
                    'Enter Teleop';

            }else{

                /*
                 * Button listener remains attached because the
                 * actual button element itself is not replaced.
                 */
                button.textContent =
                    'Enter Teleop';
            }
        }


        /*
         * Prevent older all-uppercase presentation rules.
         */

        button.style.setProperty(
            'text-transform',
            'none',
            'important'
        );
    }


    /* ============================================================
       ARM OWNERSHIP ALIGNMENT
       ============================================================ */

    function fixOwnershipAlignmentV1912(){

        const modeSection =
            document.querySelector(
                '#view-live .stitch-mode-section'
            );


        if(!modeSection){
            return;
        }


        const modeTitle =
            exactElementV1912(
                'mode',
                modeSection
            );


        const ownership =
            exactElementV1912(
                'arm ownership',
                modeSection
            );


        if(!modeTitle || !ownership){
            return;
        }


        const modeRect =
            modeTitle.getBoundingClientRect();


        const ownershipRect =
            ownership.getBoundingClientRect();


        /*
         * Positive value moves ARM OWNERSHIP downward.
         */

        const delta =
            modeRect.top
            -
            ownershipRect.top;


        ownership.style.setProperty(
            'position',
            'relative',
            'important'
        );

        ownership.style.setProperty(
            'top',
            `${delta.toFixed(2)}px`,
            'important'
        );


        /*
         * Find the small ownership header container so its
         * underline moves by the exact same amount.
         */

        let ownerBox =
            ownership.parentElement;


        while(
            ownerBox
            &&
            ownerBox !== modeSection
        ){

            const rect =
                ownerBox.getBoundingClientRect();


            const text =
                normalizeV1912(
                    ownerBox.textContent
                );


            if(
                rect.width >= 60
                &&
                rect.width <= 190
                &&
                rect.height >= 20
                &&
                rect.height <= 90
                &&
                text.includes(
                    'arm ownership'
                )
                &&
                !text.includes('xr')
            ){
                break;
            }


            ownerBox =
                ownerBox.parentElement;
        }


        if(
            ownerBox
            &&
            ownerBox !== modeSection
            &&
            ownerBox !== ownership
        ){

            /*
             * Move the entire little ownership header cluster
             * instead of double-moving the text.
             */

            ownership.style.removeProperty(
                'top'
            );


            ownerBox.style.setProperty(
                'position',
                'relative',
                'important'
            );

            ownerBox.style.setProperty(
                'top',
                `${delta.toFixed(2)}px`,
                'important'
            );

        }else{

            /*
             * Fallback: move a nearby thin horizontal line.
             */

            const parent =
                ownership.parentElement;


            if(parent){

                const siblings =
                    [...parent.children];


                const line =
                    siblings.find(element => {

                        if(element === ownership){
                            return false;
                        }

                        const rect =
                            element.getBoundingClientRect();

                        return (
                            rect.width >= 40
                            &&
                            rect.height <= 5
                        );
                    });


                if(line){

                    line.style.setProperty(
                        'position',
                        'relative',
                        'important'
                    );

                    line.style.setProperty(
                        'top',
                        `${delta.toFixed(2)}px`,
                        'important'
                    );
                }
            }
        }
    }


    /* ============================================================
       INSTALL AFTER EXISTING PRESENTATION PATCHES
       ============================================================ */

    function installV1912(){

        fixYoloV1912();

        fixEnterTextV1912();

        fixOwnershipAlignmentV1912();
    }


    function startV1912(){

        /*
         * LIVE STARTUP CLEANUP 3B
         *
         * Preserve the historical presentation installer,
         * but remove its artificial multi-frame startup delay.
         */
        installV1912();
    }


    if(document.readyState === 'loading'){

        document.addEventListener(
            'DOMContentLoaded',
            startV1912,
            {
                once: true
            }
        );

    }else{

        startV1912();
    }

})();


/* ================================================================
   STITCH_TOP_ALIGNMENT_V1913

   1. YOLO right spacing = icon tray left spacing.
   2. ARM OWNERSHIP cluster aligns vertically with MODE.
   3. Composite widened to 122px.

   One-time presentation adjustment only.
   No MutationObserver.
   No interval.
   No polling.
   ================================================================ */

(function(){

    function normalizeV1913(value){

        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }


    function deepestExactV1913(
        wanted,
        scope
    ){

        return [
            ...scope.querySelectorAll(
                'div,span,strong,p,h1,h2,h3,h4,h5,h6,label'
            )
        ]
        .filter(
            element =>
                normalizeV1913(
                    element.textContent
                ) === wanted
        )
        .sort(
            (a,b)=>{

                function depth(element){

                    let d = 0;

                    while(element){
                        d += 1;
                        element = element.parentElement;
                    }

                    return d;
                }

                return depth(b) - depth(a);
            }
        )[0] || null;
    }


    /* ============================================================
       COMPOSITE WIDTH
       ============================================================ */

    function fixCompositeV1913(){

        const live =
            document.getElementById('view-live')
            || document;


        const composite =
            document.querySelector(
                '#view-live .stitch-health-trigger-v174'
            )
            ||
            [
                ...live.querySelectorAll(
                    'button,[role="button"]'
                )
            ].find(
                element =>
                    normalizeV1913(
                        element.textContent
                    ) === 'composite'
            );


        if(!composite){
            return;
        }


        const width =
            122;


        composite.style.setProperty(
            'width',
            `${width}px`,
            'important'
        );

        composite.style.setProperty(
            'min-width',
            `${width}px`,
            'important'
        );

        composite.style.setProperty(
            'max-width',
            `${width}px`,
            'important'
        );

        composite.style.setProperty(
            'flex',
            `0 0 ${width}px`,
            'important'
        );

        composite.style.setProperty(
            'box-sizing',
            'border-box',
            'important'
        );
    }


    /* ============================================================
       YOLO RIGHT GAP

       Match:
           camera border -> icon tray

       with:
           YOLO -> camera border
       ============================================================ */

    function fixYoloV1913(){

        const panel =
            document.querySelector(
                '#view-live .camera-panel'
            );


        const yolo =
            document.getElementById(
                'cameraYoloControl'
            );


        if(!panel || !yolo){
            return;
        }


        const panelRect =
            panel.getBoundingClientRect();


        /*
         * Find the compact tray containing the 01–06 controls.
         */

        const candidates =
            [...panel.querySelectorAll('div')]
            .filter(element => {

                const text =
                    normalizeV1913(
                        element.textContent
                    );

                const rect =
                    element.getBoundingClientRect();

                return (
                    text.includes('01')
                    &&
                    text.includes('04')
                    &&
                    text.includes('05')
                    &&
                    text.includes('06')
                    &&
                    rect.width >= 180
                    &&
                    rect.width <= 400
                    &&
                    rect.height >= 30
                    &&
                    rect.height <= 80
                );
            })
            .sort(
                (a,b)=>
                    a.getBoundingClientRect().width
                    -
                    b.getBoundingClientRect().width
            );


        const tray =
            candidates[0];


        if(!tray){
            return;
        }


        const trayRect =
            tray.getBoundingClientRect();


        const yoloRect =
            yolo.getBoundingClientRect();


        /*
         * Reference gap = left edge of icon tray from section edge.
         */

        const desiredRightGap =
            trayRect.left
            -
            panelRect.left;


        const currentRightGap =
            panelRect.right
            -
            yoloRect.right;


        const delta =
            currentRightGap
            -
            desiredRightGap;


        /*
         * Preserve previous positioning and shift only on X.
         */

        yolo.style.setProperty(
            'position',
            'relative',
            'important'
        );

        yolo.style.setProperty(
            'left',
            `${delta.toFixed(2)}px`,
            'important'
        );

        yolo.style.setProperty(
            'top',
            '0',
            'important'
        );
    }


    /* ============================================================
       ARM OWNERSHIP -> MODE ALIGNMENT
       ============================================================ */

    function fixOwnershipV1913(){

        const section =
            document.querySelector(
                '#view-live .stitch-mode-section'
            );


        if(!section){
            return;
        }


        const mode =
            deepestExactV1913(
                'mode',
                section
            );


        const ownership =
            deepestExactV1913(
                'arm ownership',
                section
            );


        if(!mode || !ownership){
            return;
        }


        /*
         * Find the smallest ownership header container that includes
         * the text and its local underline, but not the telemetry rows.
         */

        let cluster =
            ownership;


        while(
            cluster.parentElement
            &&
            cluster.parentElement !== section
        ){

            const parent =
                cluster.parentElement;


            const rect =
                parent.getBoundingClientRect();


            const text =
                normalizeV1913(
                    parent.textContent
                );


            if(
                rect.height <= 65
                &&
                rect.width <= 230
                &&
                text.includes('arm ownership')
                &&
                !text.includes('lowstate')
                &&
                !text.includes('finger worker')
            ){

                cluster =
                    parent;

            }else{

                break;
            }
        }


        /*
         * Compare visible text positions.
         */

        const modeRect =
            mode.getBoundingClientRect();


        const ownerRect =
            ownership.getBoundingClientRect();


        const delta =
            modeRect.top
            -
            ownerRect.top;


        /*
         * Move the cluster, not only the text, so the underline follows.
         */

        cluster.style.setProperty(
            'position',
            'relative',
            'important'
        );

        cluster.style.setProperty(
            'top',
            `${delta.toFixed(2)}px`,
            'important'
        );


        /*
         * Remove any old direct shift from V1.9.12 so it cannot
         * double-apply.
         */

        if(cluster !== ownership){

            ownership.style.removeProperty(
                'top'
            );
        }
    }


    function installV1913(){

        fixCompositeV1913();

        fixYoloV1913();

        fixOwnershipV1913();
    }


    /*
     * Run after all the older one-time presentation patches.
     */

    function startV1913(){

        /*
         * LIVE STARTUP CLEANUP 3B
         *
         * Preserve the historical presentation installer,
         * but remove its artificial multi-frame startup delay.
         */
        installV1913();
    }


    if(document.readyState === 'loading'){

        document.addEventListener(
            'DOMContentLoaded',
            startV1913,
            {
                once: true
            }
        );

    }else{

        startV1913();
    }

})();


/* ================================================================
   STITCH_LIVE_GEOMETRY_V1914

   - Expand Camera Multiview.
   - Narrow robot/twin center moderately.
   - Keep right rail width unchanged.
   - YOLO right gap = Disconnect right gap.
   - ARM OWNERSHIP aligns with MODE.
   - Composite width = 128px.

   Presentation only.

   No MutationObserver.
   No interval.
   No polling.
   ================================================================ */

(function(){

    function normalizeV1914(value){

        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }


    function deepestExactV1914(
        wanted,
        scope
    ){

        return [
            ...scope.querySelectorAll(
                'div,span,strong,p,h1,h2,h3,h4,h5,h6,label'
            )
        ]
        .filter(
            element =>
                normalizeV1914(
                    element.textContent
                ) === wanted
        )
        .sort(
            (a,b)=>{

                function depth(element){

                    let result = 0;

                    while(element){

                        result += 1;
                        element =
                            element.parentElement;
                    }

                    return result;
                }

                return depth(b) - depth(a);
            }
        )[0] || null;
    }


    /* ============================================================
       FIND TOP-LEVEL LIVE GRID
       ============================================================ */

    function findLiveGridV1914(){

        const camera =
            document.querySelector(
                '#view-live .camera-panel'
            );


        const mode =
            document.querySelector(
                '#view-live .stitch-mode-section'
            );


        if(!camera || !mode){
            return null;
        }


        let ancestor =
            camera.parentElement;


        while(
            ancestor
            &&
            ancestor.id !== 'view-live'
        ){

            const style =
                getComputedStyle(
                    ancestor
                );


            if(
                style.display === 'grid'
                &&
                ancestor.contains(mode)
                &&
                ancestor.children.length >= 3
            ){

                return ancestor;
            }


            ancestor =
                ancestor.parentElement;
        }


        /*
         * #view-live itself can also be the grid.
         */

        const live =
            document.getElementById(
                'view-live'
            );


        if(
            live
            &&
            getComputedStyle(live).display === 'grid'
            &&
            live.contains(camera)
            &&
            live.contains(mode)
        ){

            return live;
        }


        return null;
    }


    /* ============================================================
       EXPAND CAMERA / NARROW CENTER
       ============================================================ */

    function resizeMainColumnsV1914(){

        const grid =
            findLiveGridV1914();


        const camera =
            document.querySelector(
                '#view-live .camera-panel'
            );


        const mode =
            document.querySelector(
                '#view-live .stitch-mode-section'
            );


        if(!grid || !camera || !mode){

            console.warn(
                'V1.9.14: main live grid not resolved'
            );

            return;
        }


        const children =
            [...grid.children];


        const cameraColumn =
            children.find(
                child =>
                    child === camera
                    ||
                    child.contains(camera)
            );


        const rightColumn =
            children.find(
                child =>
                    child === mode
                    ||
                    child.contains(mode)
            );


        if(
            !cameraColumn
            ||
            !rightColumn
        ){

            console.warn(
                'V1.9.14: camera/right grid columns unresolved'
            );

            return;
        }


        const centerCandidates =
            children.filter(
                child =>
                    child !== cameraColumn
                    &&
                    child !== rightColumn
            );


        if(!centerCandidates.length){

            console.warn(
                'V1.9.14: center column unresolved'
            );

            return;
        }


        /*
         * The robot column should be the widest remaining child.
         */

        const centerColumn =
            centerCandidates
                .sort(
                    (a,b)=>
                        b.getBoundingClientRect().width
                        -
                        a.getBoundingClientRect().width
                )[0];


        const cameraWidth =
            cameraColumn
                .getBoundingClientRect()
                .width;


        const centerWidth =
            centerColumn
                .getBoundingClientRect()
                .width;


        /*
         * Move a meaningful but restrained amount of width:
         *
         * normally ~105–115 px at the current viewport.
         */

        const transfer =
            Math.min(
                120,
                Math.max(
                    100,
                    centerWidth * 0.13
                )
            );


        const newCameraWidth =
            cameraWidth
            +
            transfer;


        const newCenterWidth =
            Math.max(
                560,
                centerWidth
                -
                transfer
            );


        /*
         * Preserve all child order and all unrelated columns.
         */

        const widths =
            children.map(child => {

                if(child === cameraColumn){

                    return (
                        `${newCameraWidth.toFixed(2)}px`
                    );
                }


                if(child === centerColumn){

                    return (
                        `${newCenterWidth.toFixed(2)}px`
                    );
                }


                return (
                    `${
                        child
                            .getBoundingClientRect()
                            .width
                            .toFixed(2)
                    }px`
                );
            });


        grid.style.setProperty(
            'grid-template-columns',
            widths.join(' '),
            'important'
        );


        cameraColumn.style.setProperty(
            'min-width',
            '0',
            'important'
        );


        centerColumn.style.setProperty(
            'min-width',
            '0',
            'important'
        );


        /*
         * Let the Three.js canvas / other responsive components
         * recalculate once after the grid changes.
         */

        requestAnimationFrame(
            ()=>{

                window.dispatchEvent(
                    new Event('resize')
                );
            }
        );
    }


    /* ============================================================
       COMPOSITE -> 128PX
       ============================================================ */

    function resizeCompositeV1914(){

        const live =
            document.getElementById(
                'view-live'
            )
            || document;


        const composite =
            document.querySelector(
                '#view-live .stitch-health-trigger-v174'
            )
            ||
            [
                ...live.querySelectorAll(
                    'button,[role="button"]'
                )
            ].find(
                element =>
                    normalizeV1914(
                        element.textContent
                    ) ===
                    'composite'
            );


        if(!composite){
            return;
        }


        const width =
            128;


        for(
            const property
            of [
                'width',
                'min-width',
                'max-width'
            ]
        ){

            composite.style.setProperty(
                property,
                `${width}px`,
                'important'
            );
        }


        composite.style.setProperty(
            'flex',
            `0 0 ${width}px`,
            'important'
        );


        composite.style.setProperty(
            'box-sizing',
            'border-box',
            'important'
        );
    }


    /* ============================================================
       YOLO RIGHT GAP = DISCONNECT RIGHT GAP
       ============================================================ */

    function alignYoloV1914(){

        const panel =
            document.querySelector(
                '#view-live .camera-panel'
            );


        const yolo =
            document.getElementById(
                'cameraYoloControl'
            );


        const disconnect =
            document.getElementById(
                'cameraStopBtn'
            );


        if(
            !panel
            ||
            !yolo
            ||
            !disconnect
        ){
            return;
        }


        /*
         * First neutralize the previous V1.9.12 / V1.9.13 X shifts.
         */

        yolo.style.setProperty(
            'left',
            '0px',
            'important'
        );


        yolo.style.setProperty(
            'transform',
            'none',
            'important'
        );


        const panelRect =
            panel.getBoundingClientRect();


        const disconnectRect =
            disconnect.getBoundingClientRect();


        const yoloRect =
            yolo.getBoundingClientRect();


        const desiredGap =
            panelRect.right
            -
            disconnectRect.right;


        const currentGap =
            panelRect.right
            -
            yoloRect.right;


        /*
         * Positive delta means YOLO must move RIGHT.
         */

        const deltaX =
            currentGap
            -
            desiredGap;


        yolo.style.setProperty(
            'position',
            'relative',
            'important'
        );


        yolo.style.setProperty(
            'left',
            '0px',
            'important'
        );


        yolo.style.setProperty(
            'transform',
            `translateX(${deltaX.toFixed(2)}px)`,
            'important'
        );
    }


    /* ============================================================
       ARM OWNERSHIP HEADER CLUSTER -> MODE Y
       ============================================================ */

    function alignOwnershipV1914(){

        const section =
            document.querySelector(
                '#view-live .stitch-mode-section'
            );


        if(!section){
            return;
        }


        const mode =
            deepestExactV1914(
                'mode',
                section
            );


        const ownership =
            deepestExactV1914(
                'arm ownership',
                section
            );


        if(
            !mode
            ||
            !ownership
        ){
            return;
        }


        /*
         * Remove old vertical offsets from ownership and the small
         * ancestor chain created by V1.9.12 / V1.9.13.
         */

        let element =
            ownership;


        const chain = [];


        while(
            element
            &&
            element !== section
        ){

            chain.push(
                element
            );


            if(
                element.style
                    .getPropertyValue('top')
            ){

                element.style.removeProperty(
                    'top'
                );
            }


            /*
             * Only clear transforms on tiny ownership-header
             * ancestors, not general dashboard containers.
             */

            const rect =
                element.getBoundingClientRect();


            if(
                rect.height <= 80
                &&
                rect.width <= 280
            ){

                element.style.removeProperty(
                    'transform'
                );
            }


            element =
                element.parentElement;
        }


        /*
         * Let browser settle after removing old offsets.
         */

        requestAnimationFrame(
            ()=>{

                const modeRect =
                    mode.getBoundingClientRect();


                const ownerRect =
                    ownership
                        .getBoundingClientRect();


                const deltaY =
                    modeRect.top
                    -
                    ownerRect.top;


                /*
                 * Select the smallest ancestor that contains
                 * ARM OWNERSHIP and its short underline/header
                 * decoration, but not XR/LOWSTATE telemetry.
                 */

                let cluster =
                    ownership;


                for(
                    const candidate
                    of chain
                ){

                    const text =
                        normalizeV1914(
                            candidate.textContent
                        );


                    const rect =
                        candidate
                            .getBoundingClientRect();


                    if(
                        rect.height <= 70
                        &&
                        rect.width <= 280
                        &&
                        text.includes(
                            'arm ownership'
                        )
                        &&
                        !text.includes('xr')
                        &&
                        !text.includes('lowstate')
                        &&
                        !text.includes('hands')
                    ){

                        cluster =
                            candidate;
                    }
                }


                cluster.style.setProperty(
                    'position',
                    'relative',
                    'important'
                );


                cluster.style.setProperty(
                    'transform',
                    `translateY(${deltaY.toFixed(2)}px)`,
                    'important'
                );
            }
        );
    }


    /* ============================================================
       INSTALL
       ============================================================ */

    function installV1914(){

        /*
         * LIVE STARTUP CLEANUP 2
         *
         * Major Camera / Twin / Rail width ownership belongs to
         * stitch_layout_v1924.js.
         *
         * The historical V1.9.14 resizeMainColumnsV1914() call is
         * intentionally retired because it rewrote
         * grid-template-columns after the final layout had already
         * initialized, producing a visible startup width jump.
         *
         * Keep the remaining V1.9.14 presentation work temporarily.
         */

        resizeCompositeV1914();


        /*
         * Geometry relying on final positions runs afterward.
         */

        requestAnimationFrame(
            ()=>requestAnimationFrame(
                ()=>{

                    alignYoloV1914();

                    alignOwnershipV1914();
                }
            )
        );
    }


    /*
     * Run after all previous presentation patches.
     */

    function startV1914(){

        /*
         * LIVE STARTUP CLEANUP 3B
         *
         * Preserve the historical presentation installer,
         * but remove its artificial multi-frame startup delay.
         */
        installV1914();
    }


    if(
        document.readyState
        ===
        'loading'
    ){

        document.addEventListener(
            'DOMContentLoaded',
            startV1914,
            {
                once:
                    true
            }
        );

    }
    else{

        startV1914();
    }

})();


/* ================================================================
   STITCH_FINAL_GEOMETRY_V1915

   1. YOLO wrapper:
      right gap = Disconnect right gap.

   2. ARM OWNERSHIP:
      actual text top = MODE actual text top.
      Old V1.9.12 / V1.9.13 / V1.9.14 offsets are neutralized.

   3. Outer right rail:
      visual surface copies Camera Multiview outer panel.

   No column resizing.
   No MutationObserver.
   No interval.
   No polling.
   ================================================================ */

(function(){

    function normV1915(value){

        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }


    function deepestExactV1915(
        wanted,
        scope
    ){

        return [
            ...scope.querySelectorAll(
                'div,span,strong,p,h1,h2,h3,h4,h5,h6,label'
            )
        ]
        .filter(
            element =>
                normV1915(
                    element.textContent
                ) === wanted
        )
        .sort(
            (a,b)=>{

                function depth(element){

                    let d = 0;

                    while(element){
                        d++;
                        element =
                            element.parentElement;
                    }

                    return d;
                }

                return depth(b) - depth(a);
            }
        )[0] || null;
    }


    /* ============================================================
       YOLO — MOVE THE WHOLE WRAPPER, NOT THE LABEL
       ============================================================ */

    function fixYoloV1915(){

        const panel =
            document.querySelector(
                '#view-live .camera-panel'
            );

        const yolo =
            document.getElementById(
                'cameraYoloControl'
            );

        const disconnect =
            document.getElementById(
                'cameraStopBtn'
            );


        if(
            !panel
            ||
            !yolo
            ||
            !disconnect
        ){
            return;
        }


        const wrapper =
            yolo.closest(
                '.camera-mode-options'
            )
            ||
            yolo.parentElement
            ||
            yolo;


        /*
         * Neutralize OLD horizontal changes first.
         */

        for(
            const element
            of new Set([
                yolo,
                wrapper
            ])
        ){

            element.style.removeProperty(
                'left'
            );

            element.style.removeProperty(
                'right'
            );

            element.style.removeProperty(
                'transform'
            );

            element.style.removeProperty(
                'margin-left'
            );

            element.style.removeProperty(
                'margin-right'
            );
        }


        /*
         * Force layout after removing old offsets.
         */

        void wrapper.offsetWidth;


        const panelRect =
            panel.getBoundingClientRect();

        const disconnectRect =
            disconnect.getBoundingClientRect();

        const wrapperRect =
            wrapper.getBoundingClientRect();


        const desiredRightGap =
            panelRect.right
            -
            disconnectRect.right;


        const currentRightGap =
            panelRect.right
            -
            wrapperRect.right;


        /*
         * Example:
         *
         * current gap  = 55
         * desired gap  = 12
         * shift right  = 43
         */

        const moveRight =
            currentRightGap
            -
            desiredRightGap;


        wrapper.style.setProperty(
            'position',
            'relative',
            'important'
        );

        wrapper.style.setProperty(
            'transform',
            `translateX(${moveRight.toFixed(2)}px)`,
            'important'
        );


        console.debug(
            'V1.9.15 YOLO:',
            {
                desiredRightGap,
                currentRightGap,
                moveRight
            }
        );
    }


    /* ============================================================
       ARM OWNERSHIP — ACTUAL TEXT Y = MODE TEXT Y
       ============================================================ */

    function fixOwnershipV1915(){

        const section =
            document.querySelector(
                '#view-live .stitch-mode-section'
            );


        if(!section){
            return;
        }


        const mode =
            deepestExactV1915(
                'mode',
                section
            );


        const ownership =
            deepestExactV1915(
                'arm ownership',
                section
            );


        if(
            !mode
            ||
            !ownership
        ){
            return;
        }


        /*
         * Previous versions moved various small ancestors.
         *
         * Clear ONLY inline top/transform values in the ownership
         * header chain. These are presentation offsets added by our
         * earlier patches.
         */

        let node =
            ownership;


        let levels = 0;


        while(
            node
            &&
            node !== section
            &&
            levels < 5
        ){

            node.style.removeProperty(
                'top'
            );

            node.style.removeProperty(
                'transform'
            );

            node.style.removeProperty(
                'bottom'
            );


            node =
                node.parentElement;

            levels++;
        }


        void ownership.offsetWidth;


        const modeRect =
            mode.getBoundingClientRect();


        const ownershipRect =
            ownership.getBoundingClientRect();


        const moveDown =
            modeRect.top
            -
            ownershipRect.top;


        /*
         * This time move ONLY the text element.
         *
         * The horizontal divider already spans the MODE header
         * correctly, so there is no reason to move parent cards.
         */

        ownership.style.setProperty(
            'position',
            'relative',
            'important'
        );

        ownership.style.setProperty(
            'top',
            `${moveDown.toFixed(2)}px`,
            'important'
        );

        ownership.style.setProperty(
            'transform',
            'none',
            'important'
        );


        console.debug(
            'V1.9.15 ownership:',
            {
                modeTop:
                    modeRect.top,

                ownershipTop:
                    ownershipRect.top,

                moveDown
            }
        );
    }


    /* ============================================================
       FIND COMMON RIGHT SIDEBAR
       ============================================================ */

    function commonAncestorV1915(
        elements
    ){

        if(!elements.length){
            return null;
        }


        let ancestor =
            elements[0];


        while(ancestor){

            if(
                elements.every(
                    element =>
                        ancestor.contains(
                            element
                        )
                )
            ){
                return ancestor;
            }


            ancestor =
                ancestor.parentElement;
        }


        return null;
    }


    /* ============================================================
       RIGHT SIDEBAR = CAMERA PANEL OUTER SURFACE
       ============================================================ */

    function fixRightRailV1915(){

        const camera =
            document.querySelector(
                '#view-live .camera-panel'
            );


        const mode =
            document.querySelector(
                '#view-live .stitch-mode-section'
            );


        const controller =
            document.querySelector(
                '#view-live .stitch-controller-section'
            );


        const hands =
            document.querySelector(
                '#view-live .stitch-hands-section'
            );


        const joint =
            document.querySelector(
                '#view-live .stitch-joint-section'
            );


        if(
            !camera
            ||
            !mode
            ||
            !controller
            ||
            !hands
            ||
            !joint
        ){
            return;
        }


        const rail =
            commonAncestorV1915([
                mode,
                controller,
                hands,
                joint
            ]);


        if(!rail){
            return;
        }


        /*
         * Safety:
         * do not accidentally style the whole Live page/grid.
         */

        const railRect =
            rail.getBoundingClientRect();


        if(
            rail.id === 'view-live'
            ||
            railRect.width > 450
        ){

            console.warn(
                'V1.9.15: right rail candidate rejected',
                rail
            );

            return;
        }


        const source =
            getComputedStyle(
                camera
            );


        const properties = [

            'background-color',

            'border-top-width',
            'border-right-width',
            'border-bottom-width',
            'border-left-width',

            'border-top-style',
            'border-right-style',
            'border-bottom-style',
            'border-left-style',

            'border-top-color',
            'border-right-color',
            'border-bottom-color',
            'border-left-color',

            'border-top-left-radius',
            'border-top-right-radius',
            'border-bottom-right-radius',
            'border-bottom-left-radius',

            'box-shadow'
        ];


        for(
            const property
            of properties
        ){

            rail.style.setProperty(
                property,
                source.getPropertyValue(
                    property
                ),
                'important'
            );
        }


        /*
         * Ensure an old right-rail background image/gradient cannot
         * keep the surface visually different.
         */

        rail.style.setProperty(
            'background-image',
            'none',
            'important'
        );


        rail.dataset.stitchRightRailV1915 =
            'true';


        console.debug(
            'V1.9.15 right rail:',
            rail
        );
    }


    /* ============================================================
       INSTALL
       ============================================================ */

    function installV1915(){

        fixRightRailV1915();


        /*
         * Surface first, geometry after browser settles.
         */

        requestAnimationFrame(
            ()=>{

                fixYoloV1915();

                fixOwnershipV1915();
            }
        );
    }


    /*
     * Existing file contains many older one-time presentation
     * patches. Run this last so V1.9.15 is authoritative.
     */

    function startV1915(){

        /*
         * LIVE STARTUP CLEANUP 3B
         *
         * Preserve the historical presentation installer,
         * but remove its artificial multi-frame startup delay.
         */
        installV1915();
    }


    if(
        document.readyState
        ===
        'loading'
    ){

        document.addEventListener(
            'DOMContentLoaded',
            startV1915,
            {
                once: true
            }
        );

    }
    else{

        startV1915();
    }

})();

/* ================================================================
   STITCH_MODE_MACHINE_NOWRAP

   Presentation only.
   Keep the bottom MODE MACHINE label intact and on one line.

   No MutationObserver.
   No interval.
   No polling.
   ================================================================ */

(function(){

    function installModeMachineNoWrap(){

        const root =
            document.getElementById('view-live')
            || document.body;

        const candidates = [
            ...root.querySelectorAll(
                'span,div,p,strong,label'
            )
        ];

        const target =
            candidates.find(element =>
                String(element.textContent || '')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .toUpperCase()
                === 'MODE MACHINE'
            );

        if(target){
            target.classList.add(
                'stitch-mode-machine-nowrap'
            );

            /*
             * Explicitly restore the complete wording in case an
             * older responsive presentation rule shortened it.
             */
            target.textContent = 'MODE MACHINE';
        }
    }

    if(document.readyState === 'loading'){
        document.addEventListener(
            'DOMContentLoaded',
            installModeMachineNoWrap,
            { once:true }
        );
    }
    else{
        installModeMachineNoWrap();
    }

})();
