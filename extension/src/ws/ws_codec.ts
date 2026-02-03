import * as flatbuffers from "flatbuffers";
import { Message } from "../discuss/ws-protocol/message";
import { MessageBody } from "../discuss/ws-protocol/message-body";
import { Ping } from "../discuss/ws-protocol/ping";
import { Status } from "../discuss/ws-protocol/status";
import { CallState as WsCallState } from "../discuss/ws-protocol/call-state";

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

export function parseWsMessage(data: Uint8Array): WsIncomingMessage | null {
    try {
        const buf = new flatbuffers.ByteBuffer(data);
        const message = Message.getRootAsMessage(buf);
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
    } catch {
        return null;
    }
}
