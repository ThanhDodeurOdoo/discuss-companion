/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
    preset: "ts-jest/presets/default-esm",
    testEnvironment: "jsdom",
    moduleNameMapper: {
        "^@odoo/owl$": "<rootDir>/vendor/owl/dist/owl.es.js",
        // Map .js imports to .ts for FlatBuffers generated code
        "^(\\.{1,2}/.*)\\.js$": "$1",
        "(.+)\\?raw$": "$1"
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
