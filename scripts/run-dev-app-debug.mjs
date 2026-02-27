/**
 * File used to run the debug mode of the app.
 * It is used to run the app in debug mode with the RUST_LOG environment variable set to "debug" in
 * a way that is compatible across OSes (windows uses npm.cmd which needs different handling)
 */
import { spawn } from "node:child_process";

const npmCommand = "npm";
const forwardedArgs = process.argv.slice(2);
const npmArgs = ["run", "dev:app"];

if (forwardedArgs.length > 0) {
    npmArgs.push("--", ...forwardedArgs);
}

const child = spawn(npmCommand, npmArgs, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
        ...process.env,
        RUST_LOG: "debug"
    }
});

child.on("exit", (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code ?? 1);
});

child.on("error", (error) => {
    console.error(error);
    process.exit(1);
});
