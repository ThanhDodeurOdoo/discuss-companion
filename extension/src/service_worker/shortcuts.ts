import { IS_FIREFOX_BUILD } from "@extension/src/env";
import { SwToContentMessageType } from "@extension/src/messaging/sw_channel";
import { PttCommand } from "@extension/src/page_bridge/runtime_types";

const PTT_PRESSED_THROTTLE_MS = 150;

export enum ShortcutCommand {
    PttPressed = "ptt-pressed",
    ToggleVoice = "toggle-voice"
}

const SHORTCUT_COMMANDS = new Set<string>(Object.values(ShortcutCommand));

function isShortcutCommand(command: string): command is ShortcutCommand {
    return SHORTCUT_COMMANDS.has(command);
}

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

        if (!isShortcutCommand(command)) {
            return;
        }

        if (command === ShortcutCommand.PttPressed) {
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
            switch (command) {
                case ShortcutCommand.ToggleVoice:
                    chrome.tabs.sendMessage(tabId, {
                        type: SwToContentMessageType.ContentPttCommand,
                        value: { command: PttCommand.ToggleVoice }
                    });
                    break;
                case ShortcutCommand.PttPressed:
                    chrome.tabs.sendMessage(tabId, {
                        type: SwToContentMessageType.ContentPttCommand,
                        value: { command: PttCommand.PttDown }
                    });
                    break;
            }
        }
    }

    return {
        handleCommand
    };
}
