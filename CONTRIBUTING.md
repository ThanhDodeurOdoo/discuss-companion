# Contributing to Discuss Companion

### General Rules

- **No Low-Value Comments**: Avoid trivial comments that describe obvious code or that is just a rephrase of a function/varbiable name. Only write comments for necessary complex logic or obscure implementation. Or the standard docstring.
- **Justify Overrides**: Any override of a linter rule (ESLint, Clippy) or the use of `unsafe` code MUST be justified with a descriptive comment.

### Rust (Backend)

The backend is located in `app/backend`. We follow standard Rust idioms and enforce strict safety.

- **Formatting**: Always run `cargo fmt` before committing.
- **Linting**: We use Clippy with warnings denied (`cargo clippy -- -D warnings`).
- **Unsafe Code**: Use of `unsafe` is discouraged. If absolutely necessary, it must be locally scoped and justified.
  ```rs
  #[allow(
      unsafe_code,
      reason = "
      SAFETY: Interacting with macOS ApplicationServices to check accessibility permissions.
      We create valid CFString and CFBoolean objects using safe wrappers (core_foundation crate).
      The CFDictionary is constructed from these valid safe types.
      The raw pointer passed to `AXIsProcessTrustedWithOptions` comes from `as_concrete_TypeRef()`,
      which is guaranteed to be a valid CFDictionaryRef by the type system."
  )]
  unsafe {
      // The actual key string for kAXTrustedCheckOptionPrompt
      let key = CFString::from_static_string("AXTrustedCheckOptionPrompt");
      let value = CFBoolean::true_value();
      let options = CFDictionary::from_CFType_pairs(&[(key.as_CFType(), value.as_CFType())]);
      let trusted = AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef()) != 0;
      debug!("Accessibility permission check: {}", trusted);
      trusted
  }
  ```
- **Tests**: Every new feature must include corresponding tests.

### TypeScript & JavaScript (Frontend & Extension)

The frontend uses Owl v3 and is in `app/frontend`. The extension is in the `extension` folder.

- **No `any` (or lazy typing)**: The use of the `any` type is strictly forbidden. Use proper interfaces or types.
- **Type Assertions**: Avoid `as unknown as...`. If you must use it, provide a justifying comment.
- **Defined Assertions**: Use the `!` operator only when you are absolutely certain the value is neither `null` nor `undefined`.

## What do to when you modify something:

### If you modify `protocol.fbs`, you must regenerate the code:

1.  **Install flatc**:
    ```bash
    brew install flatbuffers
    ```
2.  **Generate Code**:
    ```bash
    npm run build:flatbuffers:ws
    npm run build:flatbuffers:ipc
    npm run build:flatbuffers # does both of the above
    ```

### If you modify the extension

```bash
npm run build:extension
```

### If you modify the app


> [!WARNING]
>On **Windows** you may need the C++ linker that comes with [C++ Visual Studio tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/).
>
>On **Linux** you may have to install the following libraries:
>
>
>```bash
>sudo apt-get update
>sudo apt-get install -y \
>            libglib2.0-dev \
>            libgtk-3-dev \
>            libwebkit2gtk-4.1-dev \
>            pkg-config
>```

Then:

```bash
npm run dev # for development
# OR
npm run build:app # for deployment
```

## Profiling

To capture a CPU flamegraph and a DHAT heap profile:

```bash
npm run dev:profiling
```

Prerequisites:

- `npm install` (for the Tauri CLI in `node_modules/.bin`)
- `flamegraph` available in `PATH` (install with `cargo install flamegraph`)

Outputs are written to:

- `app/profiling/flamegraph.svg`
- `app/profiling/dhat-heap.json`

Notes:

- Quit the app via the tray "Quit" action to flush the DHAT output file.
- The flamegraph capture stops automatically when the app exits.


## Verification

Before submitting a Pull Request, ensure all lints and tests pass locally:

you can run them individually:

```bash
npm run lint:extension
npm run lint:frontend
npm run lint:backend
npm run test:extension
npm run test:frontend
npm run test:backend
npm run test:api:ipc
npm run test:api:ws
```
by group:

```bash
npm run lint # all 3 lints
npm run test # all test suites (including API tests)
```

or all at the same time:

```bash
npm run verify
```

## Versioning

The repo keeps app and extension versions in sync for major/minor bumps. Patch/fix bumps can diverge.

```bash
# bump both app + extension (major/minor only allowed in all scope)
npm run bump major
npm run bump minor

# bump app + extension independently (patch/fix allowed)
npm run bump fix
npm run bump patch

# bump a single scope (patch/fix only)
npm run bump app fix
npm run bump extension fix
```
