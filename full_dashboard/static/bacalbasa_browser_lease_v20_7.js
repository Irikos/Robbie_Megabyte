(() => {
    "use strict";

    const sessionId = (
        globalThis.crypto
        && typeof globalThis.crypto.randomUUID === "function"
    )
        ? globalThis.crypto.randomUUID()
        : (
            Date.now().toString(36)
            + "-"
            + Math.random()
                .toString(36)
                .slice(2)
        );

    const streamUrl =
        "/api/session/stream"
        + "?session_id="
        + encodeURIComponent(
            sessionId
        );

    const stream =
        new EventSource(
            streamUrl,
            {
                withCredentials:
                    true,
            },
        );


    stream.addEventListener(
        "open",
        () => {
            console.debug(
                "Full Dash lifecycle stream connected",
                sessionId,
            );
        },
    );


    /*
     * EventSource is network-backed rather than timer-backed.
     * Firefox may throttle JavaScript timers in background tabs;
     * that does not terminate this HTTP connection.
     *
     * Closing or navigating away from the page closes the stream.
     */
    window.addEventListener(
        "pagehide",
        () => {
            stream.close();
        },
        {
            once:
                true,
        },
    );
})();
