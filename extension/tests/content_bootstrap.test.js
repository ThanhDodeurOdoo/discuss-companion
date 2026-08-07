/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://odoo.com/"}
 */
import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import { flushPromises } from "./utils.js";
import { isSupportedOdooRuntime, startContentBootstrap } from "../src/content/bootstrap";

describe("content bootstrap", () => {
    let readyState = "complete";

    beforeEach(() => {
        readyState = "complete";
        Object.defineProperty(document, "readyState", {
            configurable: true,
            get: () => readyState
        });
    });

    test.each([
        {
            name: "saas-19.2 Owl 2",
            runtime: { hasOdoo: true, owlVersion: "2.8.4", hasOwl3ObservationApi: false },
            supported: true
        },
        {
            name: "Owl 3",
            runtime: {
                hasOdoo: true,
                owlVersion: "3.0.0-alpha.45",
                hasOwl3ObservationApi: true
            },
            supported: true
        },
        {
            name: "Owl 3 without effect support",
            runtime: {
                hasOdoo: true,
                owlVersion: "3.0.0-alpha.45",
                hasOwl3ObservationApi: false
            },
            supported: false
        },
        {
            name: "missing Owl version",
            runtime: { hasOdoo: true, owlVersion: null, hasOwl3ObservationApi: false },
            supported: false
        },
        {
            name: "malformed Owl version",
            runtime: { hasOdoo: true, owlVersion: "3", hasOwl3ObservationApi: true },
            supported: false
        },
        {
            name: "future Owl version",
            runtime: { hasOdoo: true, owlVersion: "4.0.0", hasOwl3ObservationApi: true },
            supported: false
        },
        {
            name: "non-Odoo page",
            runtime: { hasOdoo: false, owlVersion: "3.0.0", hasOwl3ObservationApi: true },
            supported: false
        }
    ])("classifies $name", ({ runtime, supported }) => {
        expect(isSupportedOdooRuntime(runtime)).toBe(supported);
    });

    test("loads the runtime immediately when a supported Odoo runtime is detected", async () => {
        const loadContentRuntime = jest.fn().mockResolvedValue(undefined);
        const probeRuntimeSupport = jest.fn().mockResolvedValue(true);

        startContentBootstrap({ loadContentRuntime, probeRuntimeSupport });
        await flushPromises();

        expect(probeRuntimeSupport).toHaveBeenCalledTimes(1);
        expect(loadContentRuntime).toHaveBeenCalledTimes(1);
    });

    test("retries on document readiness events before loading the runtime", async () => {
        readyState = "loading";
        const loadContentRuntime = jest.fn().mockResolvedValue(undefined);
        const probeRuntimeSupport = jest
            .fn()
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);

        startContentBootstrap({ loadContentRuntime, probeRuntimeSupport });
        await flushPromises();

        document.dispatchEvent(new Event("DOMContentLoaded"));
        await flushPromises();
        expect(loadContentRuntime).not.toHaveBeenCalled();

        readyState = "complete";
        window.dispatchEvent(new Event("load"));
        await flushPromises();

        expect(probeRuntimeSupport).toHaveBeenCalledTimes(3);
        expect(loadContentRuntime).toHaveBeenCalledTimes(1);
    });

    test("stops without loading after unknown runtime retries", async () => {
        jest.useFakeTimers();
        try {
            const loadContentRuntime = jest.fn().mockResolvedValue(undefined);
            const probeRuntimeSupport = jest.fn().mockResolvedValue(false);

            startContentBootstrap({ loadContentRuntime, probeRuntimeSupport });
            await Promise.resolve();
            await jest.advanceTimersByTimeAsync(10000);

            expect(probeRuntimeSupport).toHaveBeenCalledTimes(5);
            expect(loadContentRuntime).not.toHaveBeenCalled();

            await jest.advanceTimersByTimeAsync(2000);
            expect(probeRuntimeSupport).toHaveBeenCalledTimes(5);
        } finally {
            jest.useRealTimers();
        }
    });
});
