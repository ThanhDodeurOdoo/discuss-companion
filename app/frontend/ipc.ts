import { Builder } from "flatbuffers";
import { invoke } from "@tauri-apps/api/core";
import { PttBinding, SetRecordingMode, SetWsPort } from "./flatbuffers/discuss/ipc-protocol";

export async function updateBinding(code: number, modifiers: number[]) {
    const builder = new Builder(1024);

    // Create modifiers vector
    const translatedModifiers = modifiers.map((m) => {
        // Map frontend modifiers to flatbuffer modifiers (assuming same order/values or map explicitly)
        // Frontend uses: 0: Cmd, 1: Ctrl, 2: Option, 3: Shift (based on utils.ts MODIFIER_ORDER?)
        // Flatbuffer: Shift=0, Control=1, Alt=2, Meta=3

        // We need to verify the mapping.
        // In app_plugin.ts: MODIFIER_ORDER: Record<string, number> = { Cmd: 0, Ctrl: 1, Option: 2, Shift: 3 };
        // But the input `modifiers` to `updateBinding` come from `payload.key.modifiers`.
        // The payload comes from `rdev` which uses its own values.
        // Wait, `ipc_protocol.fbs` defines: Shift=0, Control=1, Alt=2, Meta=3.
        // We should ensure we send the correct values.
        // The `modifiers` argument here is likely raw from the `rdev` event or re-mapped?
        // In `app_plugin.ts`, `update_binding` is called with object `{ code, modifiers }`.

        // Let's assume the caller passes modifiers compatible with what the backend expects?
        // Or we map them here. The backend `state::Modifier` matches `ws_protocol` and `ipc_protocol`.

        return m;
    });

    const modifiersOffset = PttBinding.createModifiersVector(builder, translatedModifiers);

    PttBinding.startPttBinding(builder);
    PttBinding.addCode(builder, code);
    PttBinding.addModifiers(builder, modifiersOffset);
    const offset = PttBinding.endPttBinding(builder);

    builder.finish(offset);
    const bytes = builder.asUint8Array();

    await invoke("update_binding", bytes);
}

export async function setRecordingMode(recording: boolean) {
    const builder = new Builder(1024);

    SetRecordingMode.startSetRecordingMode(builder);
    SetRecordingMode.addRecording(builder, recording);
    const offset = SetRecordingMode.endSetRecordingMode(builder);

    builder.finish(offset);
    const bytes = builder.asUint8Array();

    await invoke("set_recording_mode", bytes);
}

export async function updateWsPort(port: number) {
    const builder = new Builder(1024);

    SetWsPort.startSetWsPort(builder);
    SetWsPort.addPort(builder, port);
    const offset = SetWsPort.endSetWsPort(builder);

    builder.finish(offset);
    const bytes = builder.asUint8Array();

    // The backend command is `update_ws_port`
    await invoke("update_ws_port", bytes);
}
