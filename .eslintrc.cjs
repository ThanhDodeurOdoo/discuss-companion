module.exports = {
    extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
        "plugin:prettier/recommended"
    ],
    parserOptions: {
        ecmaVersion: 2024,
        sourceType: "module",
        project: "./tsconfig.json",
        tsconfigRootDir: __dirname
    },
    env: {
        browser: true,
        node: true,
        es2024: true
    },
    parser: "@typescript-eslint/parser",
    plugins: ["@typescript-eslint"],
    overrides: [
        {
            files: [".eslintrc.cjs", "vite.config.ts", "extension/**/*.js"],
            parserOptions: {
                project: null
            }
        },
        {
            files: ["extension/**/*.js"],
            env: {
                webextensions: true
            },
            rules: {
                "no-console": "off"
            }
        }
    ],
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
};
