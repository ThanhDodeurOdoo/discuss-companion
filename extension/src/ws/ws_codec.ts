import * as flatbuffers from "flatbuffers";
import { Message } from "../discuss/ws-protocol/message";
import { MessageBody } from "../discuss/ws-protocol/message-body";
import { Ping } from "../discuss/ws-protocol/ping";
import { Status } from "../discuss/ws-protocol/status";
import { CallState as WsCallState } from "../discuss/ws-protocol/call-state";
import { IS_FIREFOX_BUILD } from "../env";

export type CallStateSnapshot = {
    hasCall: boolean;
    hasState: boolean;
    isMute: boolean;
    isDeaf: boolean;
    isCameraOn: boolean;
    isScreenOn: boolean;
};

export type WsIncomingMessage =
    | { type: "ptt-down" }
    | { type: "ptt-up" }
    | { type: "status"; state?: string | null }
    | { type: "pong" };

export function buildPingMessage(): Uint8Array {
    const builder = new flatbuffers.Builder(64);
    Ping.startPing(builder);
    const pingOffset = Ping.endPing(builder);

    Message.startMessage(builder);
    Message.addBodyType(builder, MessageBody.Ping);
    Message.addBody(builder, pingOffset);
    const messageOffset = Message.endMessage(builder);
    builder.finish(messageOffset);

    return builder.asUint8Array();
}

export function buildCallStateMessage(snapshot: CallStateSnapshot): Uint8Array {
    const builder = new flatbuffers.Builder(64);
    const offset = WsCallState.createCallState(
        builder,
        BigInt(Date.now()),
        snapshot.hasCall,
        snapshot.hasState,
        snapshot.isMute,
        snapshot.isDeaf,
        snapshot.isCameraOn,
        snapshot.isScreenOn
    );
    Message.startMessage(builder);
    Message.addBodyType(builder, MessageBody.CallState);
    Message.addBody(builder, offset);
    const messageOffset = Message.endMessage(builder);
    builder.finish(messageOffset);
    return builder.asUint8Array();
}

function formatBytes(data: Uint8Array, max = 32): string {
    const slice = data.slice(0, max);
    return Array.from(slice, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

function safeLog(log: ((...args: unknown[]) => void) | undefined, ...args: unknown[]) {
    if (!log) {
        return;
    }
    try {
        log(...args);
    } catch {
        // Ignore logging errors in constrained environments (e.g. Firefox content scripts).
    }
}

function parseMessageFrom(
    buffer: flatbuffers.ByteBuffer,
    getRoot: (bb: flatbuffers.ByteBuffer) => Message
): WsIncomingMessage | null {
    const message = getRoot(buffer);
    switch (message.bodyType()) {
        case MessageBody.PttDown:
            return { type: "ptt-down" };
        case MessageBody.PttUp:
            return { type: "ptt-up" };
        case MessageBody.Status: {
            const status = message.body(new Status()) as Status | null;
            return { type: "status", state: status?.state() };
        }
        case MessageBody.Pong:
            return { type: "pong" };
        default:
            return null;
    }
}

function readInt16(view: DataView, offset: number): number {
    return view.getInt16(offset, true);
}

function readInt32(view: DataView, offset: number): number {
    return view.getInt32(offset, true);
}

function readUint8(view: DataView, offset: number): number {
    return view.getUint8(offset);
}

function readString(view: DataView, offset: number): string | null {
    const stringOffset = readInt32(view, offset);
    const start = offset + stringOffset;
    const length = readInt32(view, start);
    const bytes = new Uint8Array(view.buffer, view.byteOffset + start + 4, length);
    return new TextDecoder().decode(bytes);
}

// Firefox content scripts can throw cross-compartment errors during FlatBuffers decoding
// (observed as "Permission denied to access property \"constructor\"" when parsing Status).
// This only affected app-driven call commands carried in Status messages; PTT frames still
// decoded correctly. We avoid the runtime by manually reading the Message table from a DataView.
//
// Scope is intentionally narrow: only Message.bodyType and Status.state are decoded.
// The wire format remains FlatBuffers; this is just a defensive decoder for Firefox.
function parseFlatbufferMessageFirefox(view: DataView): WsIncomingMessage | null {
    if (view.byteLength < 8) {
        return null;
    }
    const rootOffset = readInt32(view, 0);
    const root = rootOffset;
    if (root <= 0 || root + 4 > view.byteLength) {
        return null;
    }
    const vtableOffset = readInt32(view, root);
    const vtable = root - vtableOffset;
    if (vtable < 0 || vtable + 6 > view.byteLength) {
        return null;
    }
    const bodyTypeField = readInt16(view, vtable + 4);
    const bodyField = readInt16(view, vtable + 6);
    if (bodyTypeField === 0) {
        return null;
    }
    const bodyType = readUint8(view, root + bodyTypeField);
    if (bodyType === MessageBody.PttDown) {
        return { type: "ptt-down" };
    }
    if (bodyType === MessageBody.PttUp) {
        return { type: "ptt-up" };
    }
    if (bodyType === MessageBody.Pong) {
        return { type: "pong" };
    }
    if (bodyType !== MessageBody.Status || bodyField === 0) {
        return null;
    }
    const bodyOffset = root + bodyField;
    const bodyTableOffset = readInt32(view, bodyOffset);
    const bodyTable = bodyOffset + bodyTableOffset;
    if (bodyTable <= 0 || bodyTable + 4 > view.byteLength) {
        return null;
    }
    const statusVtableOffset = readInt32(view, bodyTable);
    const statusVtable = bodyTable - statusVtableOffset;
    if (statusVtable < 0 || statusVtable + 8 > view.byteLength) {
        return { type: "status", state: null };
    }
    const stateField = readInt16(view, statusVtable + 6);
    if (stateField === 0) {
        return { type: "status", state: null };
    }
    const state = readString(view, bodyTable + stateField);
    return { type: "status", state };
}

export function parseWsMessage(
    data: Uint8Array,
    log?: (...args: unknown[]) => void
): WsIncomingMessage | null {
    if (IS_FIREFOX_BUILD) {
        // Firefox-only fallback to avoid FlatBuffers runtime cross-compartment errors.
        try {
            const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
            return parseFlatbufferMessageFirefox(view);
        } catch {
            return null;
        }
    }
    try {
        const buffer = new flatbuffers.ByteBuffer(data);
        try {
            const parsed = parseMessageFrom(buffer, Message.getRootAsMessage);
            if (parsed) {
                return parsed;
            }
        } catch {
            safeLog(log, "[Content] WS parse failed (root)");
        }
        try {
            const parsed = parseMessageFrom(buffer, Message.getSizePrefixedRootAsMessage);
            if (parsed) {
                safeLog(log, "[Content] WS parsed as size-prefixed");
                return parsed;
            }
        } catch {
            safeLog(log, "[Content] WS parse failed (size-prefixed)");
        }
        safeLog(log, "[Content] WS parse bytes", data.length, formatBytes(data));
        return null;
    } catch {
        safeLog(log, "[Content] WS parse failed (init)");
        return null;
    }
}
