import { IS_FIREFOX_BUILD } from "../env";

const PTT_PRESSED_THROTTLE_MS = 150;

type ShortcutCommand = "ptt-pressed" | "toggle-voice";

export function createShortcutController(deps: {
    log: (...args: unknown[]) => void;
    getIsTalkingByTabId: () => Promise<Record<string, boolean>>;
}) {
    const { log, getIsTalkingByTabId } = deps;
    let lastPttPressedAt = -PTT_PRESSED_THROTTLE_MS;

    async function handleCommand(command: string): Promise<void> {
        if (IS_FIREFOX_BUILD) {
            return;
        }

        if (command !== "ptt-pressed" && command !== "toggle-voice") {
            return;
        }

        if (command === "ptt-pressed") {
            const now = Date.now();
            if (now - lastPttPressedAt < PTT_PRESSED_THROTTLE_MS) {
                return;
            }
            lastPttPressedAt = now;
        }

        log("[BG] onCommand", command);
        const isTalkingByTabId = await getIsTalkingByTabId();
        const tabIds = Object.keys(isTalkingByTabId);
        for (const tabIdStr of tabIds) {
            const tabId = Number(tabIdStr);
            switch (command as ShortcutCommand) {
                case "toggle-voice":
                    chrome.tabs.sendMessage(tabId, {
                        type: "content-ptt-command",
                        value: { command: "toggle-voice" }
                    });
                    break;
                case "ptt-pressed":
                    chrome.tabs.sendMessage(tabId, {
                        type: "content-ptt-command",
                        value: { command: "ptt-down" }
                    });
                    break;
            }
        }
    }

    return {
        handleCommand
    };
}
