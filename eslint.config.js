import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import nodePlugin from "eslint-plugin-node";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

export default defineConfig([
    {
        extends: compat.extends(
            "eslint:recommended",
            "plugin:@typescript-eslint/recommended",
            "plugin:prettier/recommended"
        ),
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: "module",
            parserOptions: {
                project: "./tsconfig.json",
                tsconfigRootDir: __dirname
            },
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.webextensions,
                __APP_VERSION__: "readonly",
                __EXTENSION_VERSION__: "readonly",
                __BROWSER_TARGET__: "readonly"
            },
            parser: tsParser
        },
        plugins: {
            "@typescript-eslint": typescriptEslint,
            node: nodePlugin
        },
        rules: {
            "prettier/prettier": [
                "error",
                {
                    tabWidth: 4,
                    semi: true,
                    singleQuote: false,
                    printWidth: 100,
                    endOfLine: "auto",
                    trailingComma: "none"
                }
            ],
            "node/no-unsupported-features/es-syntax": "off",
            "node/no-missing-import": "off",
            "comma-dangle": "off",
            "no-console": "off",
            "no-undef": "error",
            "no-restricted-globals": ["error", "event", "self"],
            "no-const-assign": ["error"],
            "no-debugger": ["error"],
            "no-dupe-class-members": ["error"],
            "no-dupe-keys": ["error"],
            "no-dupe-args": ["error"],
            "no-dupe-else-if": ["error"],
            "no-unsafe-negation": ["error"],
            "no-duplicate-imports": ["error"],
            "valid-typeof": ["error"],
            "@typescript-eslint/no-unused-vars": [
                "error",
                { vars: "all", args: "none", ignoreRestSiblings: false, caughtErrors: "all" }
            ],
            curly: ["error", "all"],
            "no-restricted-syntax": ["error", "PrivateIdentifier"],
            "prefer-const": [
                "error",
                {
                    destructuring: "all",
                    ignoreReadBeforeAssign: true
                }
            ]
        }
    },
    globalIgnores(["**/dist/", "src-tauri/target/"]),
    {
        files: [
            "eslint.config.js",
            "**/.eslintrc.cjs",
            "**/vite.config.ts",
            "scripts/**/*.mjs",
            "scripts/**/*.js",
            "extension/**/*.js",
            "app/frontend/tests/styleMock.js",
            "**/jest.config.js",
            "**/jest.setup.js",
            "**/jest.xmlTransformer.js",
            "src/tests/extension/**/*.js"
        ],
        languageOptions: {
            parserOptions: {
                project: null
            }
        }
    },
    {
        files: ["extension/**/*.js", "src/tests/extension/**/*.js"],
        languageOptions: {
            globals: {
                ...globals.webextensions,
                ...globals.jest,
                chrome: "readonly",
                browser: "readonly"
            }
        },
        rules: {
            "no-console": "off"
        }
    },
    globalIgnores([
        "**/dist",
        "**/node_modules",
        "extension/src/discuss",
        "app/frontend/flatbuffers",
        "src-tauri/target"
    ])
]);
