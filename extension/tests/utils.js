import { jest } from "@jest/globals";

export function mockChrome(storageInitial = {}) {
    const mockStorage = {
        ...storageInitial
    };

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
            create: jest.fn()
        },
        action: {
            onClicked: { addListener: jest.fn() },
            setIcon: jest.fn()
        },
        storage: {
            session: {
                get: jest.fn().mockImplementation(() => Promise.resolve(mockStorage)),
                set: jest.fn().mockImplementation((val) => {
                    Object.assign(mockStorage, val);
                    return Promise.resolve();
                })
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
    class MockWebSocket {
        constructor(url) {
            this.url = url;
            this.readyState = 0; // CONNECTING
            setTimeout(() => {
                this.readyState = 1; // OPEN
                if (this.onopen) {
                    this.onopen();
                }
            }, 0);
        }
        send = jest.fn();
        close = jest.fn();
    }
    global.WebSocket = MockWebSocket;
}
