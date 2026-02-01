import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENCODING_UTF8 = "utf8";
const HELP_SHORT = "-h";
const HELP_LONG = "--help";

const SCOPE = Object.freeze({
    app: "app",
    extension: "extension",
    all: "all"
});

const BUMP = Object.freeze({
    major: "major",
    minor: "minor",
    patch: "patch",
    fix: "fix"
});

const TARGET_KIND = Object.freeze({
    json: "json",
    cargo: "cargo"
});

const PATHS = Object.freeze({
    packageJson: "package.json",
    cargoToml: "app/backend/Cargo.toml",
    manifestChrome: "extension/manifest.json",
    manifestFirefox: "extension/manifest.firefox.json"
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TARGETS = [
    { path: PATHS.packageJson, scope: SCOPE.app, kind: TARGET_KIND.json },
    { path: PATHS.cargoToml, scope: SCOPE.app, kind: TARGET_KIND.cargo },
    { path: PATHS.manifestChrome, scope: SCOPE.extension, kind: TARGET_KIND.json },
    { path: PATHS.manifestFirefox, scope: SCOPE.extension, kind: TARGET_KIND.json }
];

const BUMP_KINDS = new Set(Object.values(BUMP));
const SCOPE_KINDS = new Set(Object.values(SCOPE));

function usage() {
    return [
        "Usage:",
        "  node scripts/bump-version.mjs <bump>",
        "  node scripts/bump-version.mjs <scope> <bump>",
        "",
        `Scope: ${SCOPE.app} | ${SCOPE.extension} | ${SCOPE.all} (default)`,
        `Bump: ${BUMP.major} | ${BUMP.minor} | ${BUMP.patch} | ${BUMP.fix}`
    ].join("\n");
}

function parseArgs(args) {
    if (args.length === 0 || args[0] === HELP_SHORT || args[0] === HELP_LONG) {
        return { help: true };
    }

    if (args.length > 2) {
        throw new Error(`Too many arguments.\n${usage()}`);
    }

    let scope = SCOPE.all;
    let bump = args[0];

    if (BUMP_KINDS.has(bump) && args.length === 2) {
        throw new Error(`Too many arguments.\n${usage()}`);
    }

    if (!BUMP_KINDS.has(bump)) {
        if (!SCOPE_KINDS.has(args[0])) {
            throw new Error(`Unknown scope or bump: ${args[0]}\n${usage()}`);
        }
        scope = args[0];
        bump = args[1];
    }

    if (!bump || !BUMP_KINDS.has(bump)) {
        throw new Error(`Unknown bump: ${bump ?? ""}\n${usage()}`);
    }

    if (!SCOPE_KINDS.has(scope)) {
        throw new Error(`Unknown scope: ${scope}\n${usage()}`);
    }

    if (scope !== SCOPE.all && (bump === BUMP.major || bump === BUMP.minor)) {
        throw new Error(`Major/minor bumps require scope ${SCOPE.all}.`);
    }

    return { scope, bump };
}

function parseVersion(version) {
    const match = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(version);
    if (!match) {
        throw new Error(`Unsupported version format: ${version}`);
    }
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3])
    };
}

function bumpVersion(version, bump) {
    const normalizedBump = bump === BUMP.fix ? BUMP.patch : bump;
    const { major, minor, patch } = parseVersion(version);

    switch (normalizedBump) {
        case BUMP.major:
            return `${major + 1}.0.0`;
        case BUMP.minor:
            return `${major}.${minor + 1}.0`;
        case BUMP.patch:
            return `${major}.${minor}.${patch + 1}`;
        default:
            throw new Error(`Unsupported bump: ${bump}`);
    }
}

function readJsonVersion(contents, filePath) {
    const match = /"version"\s*:\s*"([0-9]+\.[0-9]+\.[0-9]+)"/.exec(contents);
    if (!match) {
        throw new Error(`Missing version in ${filePath}`);
    }
    return match[1];
}

function writeJsonVersion(contents, newVersion, filePath) {
    const replaced = contents.replace(
        /("version"\s*:\s*")([0-9]+\.[0-9]+\.[0-9]+)(")/,
        `$1${newVersion}$3`
    );
    if (replaced === contents) {
        throw new Error(`Failed to update version in ${filePath}`);
    }
    return replaced;
}

function readCargoVersion(contents, filePath) {
    const lines = contents.split(/\r?\n/);
    let inPackage = false;
    let hasPackage = false;

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
            inPackage = trimmed === "[package]";
            if (inPackage) {
                hasPackage = true;
            }
            continue;
        }
        if (!inPackage) {
            continue;
        }
        const match = /^\s*version\s*=\s*"([0-9]+\.[0-9]+\.[0-9]+)"\s*$/.exec(line);
        if (match) {
            return match[1];
        }
    }

    if (!hasPackage) {
        throw new Error(`Missing [package] section in ${filePath}`);
    }
    throw new Error(`Missing package version in ${filePath}`);
}

function writeCargoVersion(contents, newVersion, filePath) {
    const lineEnding = contents.includes("\r\n") ? "\r\n" : "\n";
    const lines = contents.split(/\r?\n/);
    let inPackage = false;
    let hasPackage = false;
    let updated = false;

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const trimmed = line.trim();
        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
            inPackage = trimmed === "[package]";
            if (inPackage) {
                hasPackage = true;
            }
            continue;
        }
        if (!inPackage) {
            continue;
        }
        const match = /^(\s*version\s*=\s*")([0-9]+\.[0-9]+\.[0-9]+)("\s*)$/.exec(line);
        if (match) {
            lines[index] = `${match[1]}${newVersion}${match[3]}`;
            updated = true;
            break;
        }
    }

    if (!hasPackage) {
        throw new Error(`Missing [package] section in ${filePath}`);
    }
    if (!updated) {
        throw new Error(`Failed to update package version in ${filePath}`);
    }

    return lines.join(lineEnding);
}

function readVersion(target, contents) {
    switch (target.kind) {
        case TARGET_KIND.json:
            return readJsonVersion(contents, target.path);
        case TARGET_KIND.cargo:
            return readCargoVersion(contents, target.path);
        default:
            throw new Error(`Unknown kind: ${target.kind}`);
    }
}

function writeVersion(target, contents, newVersion) {
    switch (target.kind) {
        case TARGET_KIND.json:
            return writeJsonVersion(contents, newVersion, target.path);
        case TARGET_KIND.cargo:
            return writeCargoVersion(contents, newVersion, target.path);
        default:
            throw new Error(`Unknown kind: ${target.kind}`);
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log(usage());
        return;
    }

    const { scope, bump } = args;
    const scopeTargets = TARGETS.filter((target) =>
        scope === SCOPE.all ? true : target.scope === scope
    );

    if (scopeTargets.length === 0) {
        throw new Error(`No targets for scope: ${scope}`);
    }

    const contentsByPath = new Map();
    const versionsByFile = new Map();

    for (const target of scopeTargets) {
        const filePath = path.join(ROOT, target.path);
        const contents = await readFile(filePath, ENCODING_UTF8);
        contentsByPath.set(target.path, contents);
        versionsByFile.set(target.path, readVersion(target, contents));
    }

    const versionsByScope = new Map();
    for (const [filePath, version] of versionsByFile.entries()) {
        const targetScope = scopeTargets.find((target) => target.path === filePath)?.scope;
        if (!targetScope) {
            continue;
        }
        const scopeVersions = versionsByScope.get(targetScope) ?? new Map();
        const list = scopeVersions.get(version) ?? [];
        list.push(filePath);
        scopeVersions.set(version, list);
        versionsByScope.set(targetScope, scopeVersions);
    }

    for (const [scopeKey, scopeVersionMap] of versionsByScope.entries()) {
        if (scopeVersionMap.size === 1) {
            continue;
        }
        const details = Array.from(scopeVersionMap.entries())
            .map(([version, files]) => `- ${version}: ${files.join(", ")}`)
            .join("\n");
        throw new Error(`Versions are out of sync for scope ${scopeKey}:\n${details}`);
    }

    const scopeVersions = new Map();
    for (const [scopeKey, scopeMap] of versionsByScope.entries()) {
        scopeVersions.set(scopeKey, Array.from(scopeMap.keys())[0]);
    }

    const isPatchBump = bump === BUMP.patch || bump === BUMP.fix;
    const enforceAllSync = scope === SCOPE.all && !isPatchBump;

    if (enforceAllSync) {
        let sharedMajor = null;
        let sharedMinor = null;
        const scopeMajorMinor = new Map();

        for (const [scopeKey, version] of scopeVersions.entries()) {
            const parsed = parseVersion(version);
            if (sharedMajor === null) {
                sharedMajor = parsed.major;
                sharedMinor = parsed.minor;
            }
            if (parsed.major !== sharedMajor || parsed.minor !== sharedMinor) {
                scopeMajorMinor.set(scopeKey, `${parsed.major}.${parsed.minor}`);
            } else {
                scopeMajorMinor.set(scopeKey, `${sharedMajor}.${sharedMinor}`);
            }
        }

        if (scopeMajorMinor.size > 0) {
            const uniqueMajorMinor = new Map();
            for (const [scopeKey, value] of scopeMajorMinor.entries()) {
                const list = uniqueMajorMinor.get(value) ?? [];
                list.push(scopeKey);
                uniqueMajorMinor.set(value, list);
            }
            if (uniqueMajorMinor.size !== 1) {
                const details = Array.from(uniqueMajorMinor.entries())
                    .map(([version, scopes]) => `- ${version}: ${scopes.join(", ")}`)
                    .join("\n");
                throw new Error(
                    `Major/minor versions are out of sync for scope ${scope}:\n${details}`
                );
            }
        }
    }

    const scopeNextVersions = new Map();
    if (scope === SCOPE.all && !enforceAllSync) {
        for (const [scopeKey, current] of scopeVersions.entries()) {
            scopeNextVersions.set(scopeKey, bumpVersion(current, bump));
        }
    } else {
        const currentVersion = Array.from(scopeVersions.values())[0];
        const nextVersion = bumpVersion(currentVersion, bump);
        for (const scopeKey of scopeVersions.keys()) {
            scopeNextVersions.set(scopeKey, nextVersion);
        }
    }

    for (const target of scopeTargets) {
        const filePath = path.join(ROOT, target.path);
        const contents = contentsByPath.get(target.path);
        const nextVersion = scopeNextVersions.get(target.scope);
        const updated = writeVersion(target, contents, nextVersion);
        if (updated !== contents) {
            await writeFile(filePath, updated, ENCODING_UTF8);
        }
    }

    const filesList = scopeTargets.map((target) => target.path).join(", ");
    if (scope === SCOPE.all && !enforceAllSync) {
        for (const [scopeKey, currentVersion] of scopeVersions.entries()) {
            const nextVersion = scopeNextVersions.get(scopeKey);
            console.log(`Bumped ${scopeKey} version ${currentVersion} -> ${nextVersion}`);
        }
    } else {
        const currentVersion = Array.from(scopeVersions.values())[0];
        const nextVersion = scopeNextVersions.get(Array.from(scopeVersions.keys())[0]);
        console.log(`Bumped ${scope} version ${currentVersion} -> ${nextVersion}`);
    }
    console.log(`Updated: ${filesList}`);
}

try {
    await main();
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
}
