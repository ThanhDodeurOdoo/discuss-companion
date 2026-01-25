/**
 * This is a rough approximation of:
 * https://github.com/odoo/odoo/blob/19.0/addons/mail/static/src/discuss/call/common/ptt_extension_service.js
 * The extension should always be compatible with the target extension service.
 */
export class MockPttExtensionService {
    constructor() {
        this.isEnabled = false;
        this.voiceActivated = false;
        this.lastMessageSent = null;

        /**
         * Callbacks to simulate environment interactions
         * messages sent TO the extension
         */
        this.onSendMessage = null;
    }

    start() {
        this._sendMessage("ask-is-enabled");
    }

    /**
     * Simulate receiving a message from the extension (via window/content script)
     * @param {Object} data
     */
    receiveMessage(data) {
        if (data.from !== "discuss-push-to-talk") {
            return;
        }

        switch (data.type) {
            case "push-to-talk-pressed":
                this.voiceActivated = false;
                /**
                 * this is the end-point, where rtc service
                 * is called with the ptt. could trigger something
                 * here so that tests can verify that it's reached.
                 */
                break;
            case "toggle-voice":
                this.voiceActivated = !this.voiceActivated;
                break;
            case "answer-is-enabled":
                this.isEnabled = true;
                break;
        }
    }

    subscribe() {
        this._sendMessage("subscribe");
    }

    unsubscribe() {
        this.voiceActivated = false;
        this._sendMessage("unsubscribe");
    }

    notifyIsTalking(isTalking) {
        this._sendMessage("is-talking", isTalking);
    }

    _sendMessage(type, value) {
        if (!this.isEnabled && type !== "ask-is-enabled") {
            return;
        }
        const message = { type, value };
        this.lastMessageSent = message;

        if (this.onSendMessage) {
            this.onSendMessage(message);
        }
    }
}
