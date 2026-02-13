const ACTIVE_ONLINE_ICON = "/assets/icons/active_online_icon.png";
const INACTIVE_ONLINE_ICON = "/assets/icons/inactive_online_icon.png";
const INACTIVE_OFFLINE_ICON = "/assets/icons/inactive_offline_icon.png";

export function createIconStateController(deps: {
    getAppConnected: () => Promise<boolean>;
    getIsTalkingByTabId: () => Promise<Record<string, boolean>>;
}) {
    const { getAppConnected, getIsTalkingByTabId } = deps;

    async function updateAppIcon(): Promise<void> {
        const connected = await getAppConnected();
        if (!connected) {
            chrome.action.setIcon({ path: INACTIVE_OFFLINE_ICON });
            return;
        }

        const isTalkingByTabId = await getIsTalkingByTabId();
        const isTalking = Object.values(isTalkingByTabId).some(Boolean);
        chrome.action.setIcon({ path: isTalking ? ACTIVE_ONLINE_ICON : INACTIVE_ONLINE_ICON });
    }

    return {
        updateAppIcon
    };
}
