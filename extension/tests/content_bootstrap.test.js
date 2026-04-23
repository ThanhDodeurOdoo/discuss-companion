/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://odoo.com/"}
 */
import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import { flushPromises } from "./utils.js";
import { startContentBootstrap } from "../src/content/bootstrap";

describe("content bootstrap", () => {
    let readyState = "complete";

    beforeEach(() => {
        readyState = "complete";
        Object.defineProperty(document, "readyState", {
            configurable: true,
            get: () => readyState
        });
    });

    test("loads the runtime immediately when Odoo is detected", async () => {
        const loadContentRuntime = jest.fn().mockResolvedValue(undefined);
        const probePageForOdoo = jest.fn().mockResolvedValue(true);

        startContentBootstrap({ loadContentRuntime, probePageForOdoo });
        await flushPromises();

        expect(probePageForOdoo).toHaveBeenCalledTimes(1);
        expect(loadContentRuntime).toHaveBeenCalledTimes(1);
    });

    test("retries on document readiness events before loading the runtime", async () => {
        readyState = "loading";
        const loadContentRuntime = jest.fn().mockResolvedValue(undefined);
        const probePageForOdoo = jest
            .fn()
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);

        startContentBootstrap({ loadContentRuntime, probePageForOdoo });
        await flushPromises();

        document.dispatchEvent(new Event("DOMContentLoaded"));
        await flushPromises();
        expect(loadContentRuntime).not.toHaveBeenCalled();

        readyState = "complete";
        window.dispatchEvent(new Event("load"));
        await flushPromises();

        expect(probePageForOdoo).toHaveBeenCalledTimes(3);
        expect(loadContentRuntime).toHaveBeenCalledTimes(1);
    });
});
