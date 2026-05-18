import { readLocalSettings } from "@extension/src/storage/local_settings";
import type { ContentRuntimeState } from "@extension/src/content/runtime_state";
import type { RefreshWsConnectionOptions } from "@extension/src/content/ws_runtime";

const mutedLog = (..._args: unknown[]) => {};

export async function initializeContentSettingsRuntime(deps: {
    state: ContentRuntimeState;
    setLoggerTarget: (target: (...args: unknown[]) => void) => void;
    maybeStartStoreWatch: () => Promise<void>;
    maybeStopStoreWatch: () => Promise<void>;
    refreshWsConnection: (options?: RefreshWsConnectionOptions) => void;
    disconnectWs: () => void;
}) {
    const {
        state,
        setLoggerTarget,
        maybeStartStoreWatch,
        maybeStopStoreWatch,
        refreshWsConnection,
        disconnectWs
    } = deps;

    const settings = await readLocalSettings();
    state.wsPort = settings.wsPort;
    state.isCompanionEnabled = settings.isCompanionEnabled;
    setLoggerTarget(settings.isLoggingEnabled ? console.log : mutedLog);

    await maybeStartStoreWatch();

    window.addEventListener(
        "load",
        () => {
            void maybeStartStoreWatch();
        },
        { once: true }
    );

    window.addEventListener("focus", () => {
        void maybeStartStoreWatch();
    });

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
            void maybeStartStoreWatch();
        }
    });

    window.addEventListener("beforeunload", () => {
        void maybeStopStoreWatch();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") {
            return;
        }

        if (changes.wsPort) {
            state.wsPort = changes.wsPort.newValue as number;
            disconnectWs();
            refreshWsConnection({ resetAttemptLimit: true });
        }
        if (changes.isLoggingEnabled) {
            setLoggerTarget(changes.isLoggingEnabled.newValue ? console.log : mutedLog);
        }
        if (changes.isCompanionEnabled) {
            state.isCompanionEnabled = Boolean(changes.isCompanionEnabled.newValue);
            refreshWsConnection({ resetAttemptLimit: state.isCompanionEnabled });
        }
        if (changes.wsReconnectRequestId) {
            refreshWsConnection({ resetAttemptLimit: true });
        }
    });
}
