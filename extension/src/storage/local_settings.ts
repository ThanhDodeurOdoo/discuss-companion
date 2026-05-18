export type LocalSettings = {
    wsPort: number;
    isLoggingEnabled: boolean;
    isCompanionEnabled: boolean;
    wsReconnectRequestId: number;
};

export const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
    wsPort: 49152,
    isLoggingEnabled: false,
    isCompanionEnabled: false,
    wsReconnectRequestId: 0
};

export async function readLocalSettings(): Promise<LocalSettings> {
    const items = (await chrome.storage.local.get(DEFAULT_LOCAL_SETTINGS)) as LocalSettings;
    return {
        wsPort: items.wsPort,
        isLoggingEnabled: Boolean(items.isLoggingEnabled),
        isCompanionEnabled: Boolean(items.isCompanionEnabled),
        wsReconnectRequestId: Number(items.wsReconnectRequestId) || 0
    };
}
