import { jest } from "@jest/globals";

export const mockStorage = {};

export const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

export function mockChrome(storageInitial = {}) {
    for (const key in mockStorage) {
        delete mockStorage[key];
    }
    Object.assign(mockStorage, storageInitial);

    global.chrome = {
        runtime: {
            onMessage: { addListener: jest.fn() },
            onMessageExternal: { addListener: jest.fn() },
            sendMessage: jest.fn(),
            getManifest: () => ({ version: "1.0.0" }),
            id: "test-extension-id",
            lastError: null
        },
        tabs: {
            onRemoved: { addListener: jest.fn() },
            sendMessage: jest.fn(),
            create: jest.fn(),
            get: jest.fn().mockImplementation((tabId) => Promise.resolve({ id: tabId, windowId: 1 })),
            update: jest.fn().mockImplementation(() => Promise.resolve())
        },
        windows: {
            update: jest.fn().mockImplementation(() => Promise.resolve())
        },
        action: {
            onClicked: { addListener: jest.fn() },
            setIcon: jest.fn()
        },
        scripting: {
            executeScript: jest.fn()
        },
        storage: {
            session: {
                get: jest.fn().mockImplementation(() => Promise.resolve({ ...mockStorage })),
                set: jest.fn().mockImplementation((val) => {
                    Object.assign(mockStorage, val);
                    return Promise.resolve();
                })
            },
            local: {
                get: jest.fn().mockImplementation((defaults, callback) => {
                    let result = {};
                    if (!defaults) {
                        result = { ...mockStorage };
                    } else if (Array.isArray(defaults)) {
                        for (const key of defaults) {
                            result[key] = mockStorage[key];
                        }
                    } else if (typeof defaults === "string") {
                        result[defaults] = mockStorage[defaults];
                    } else {
                        result = { ...defaults, ...mockStorage };
                    }
                    if (callback) {
                        callback(result);
                    }
                    return Promise.resolve(result);
                }),
                set: jest.fn().mockImplementation((val) => {
                    Object.assign(mockStorage, val);
                    return Promise.resolve();
                })
            },
            onChanged: {
                addListener: jest.fn()
            }
        },
        commands: {
            onCommand: {
                addListener: jest.fn()
            }
        },
        alarms: {
            onAlarm: { addListener: jest.fn() },
            create: jest.fn(),
            clear: jest.fn()
        }
    };

    return mockStorage;
}

export function mockWebSocket() {
    global.mockSockets = [];
    class MockWebSocket {
        constructor(url) {
            this.url = url;
            this.readyState = 0; // CONNECTING
            global.mockSockets.push(this);
            setTimeout(() => {
                this.readyState = 1; // OPEN
                if (this.onopen) {
                    this.onopen();
                }
            }, 0);
        }
        send = jest.fn();
        close = jest.fn().mockImplementation(() => {
            this.readyState = 3; // CLOSED
            if (this.onclose) {
                this.onclose({ code: 1000, reason: "Test closed" });
            }
        });
        binaryType = "blob";
    }
    MockWebSocket.CONNECTING = 0;
    MockWebSocket.OPEN = 1;
    MockWebSocket.CLOSING = 2;
    MockWebSocket.CLOSED = 3;
    global.WebSocket = MockWebSocket;
}
