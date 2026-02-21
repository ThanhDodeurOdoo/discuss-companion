/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
    preset: "ts-jest/presets/default-esm",
    testEnvironment: "jsdom",
    extensionsToTreatAsEsm: [".ts", ".xml"],
    globals: {
        __APP_VERSION__: "0.0.0"
    },
    moduleNameMapper: {
        "^@odoo/owl$": "<rootDir>/node_modules/@odoo/owl/dist/owl.es.js",
        "^@root/(.*)\\.js$": "<rootDir>/$1",
        "^@root/(.*)$": "<rootDir>/$1",
        "^@extension/(.*)\\.js$": "<rootDir>/extension/$1",
        "^@extension/(.*)$": "<rootDir>/extension/$1",
        // Map .js imports to .ts for FlatBuffers generated code
        "^(\\.{1,2}/.*)\\.js$": "$1",
        "(.+)\\?raw$": "$1",
        "\\.css$": "<rootDir>/app/frontend/tests/styleMock.js"
    },
    transform: {
        "^.+\\.tsx?$": [
            "ts-jest",
            {
                useESM: true
            }
        ],
        "^.+\\.xml$": "<rootDir>/jest.xmlTransformer.js"
    },
    setupFilesAfterEnv: ["<rootDir>/jest.setup.js"]
};
