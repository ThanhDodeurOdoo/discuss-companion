# Contributing to Discuss Companion

### General Rules

- **No Low-Value Comments**: Avoid trivial comments that describe obvious code or that is just a rephrase of a function/varbiable name. Only write comments for necessary complex logic or obscure implementation. Or the standard docstring.
- **Justify Overrides**: Any override of a linter rule (ESLint, Clippy) or the use of `unsafe` code MUST be justified with a descriptive comment.

### Rust (Backend)

The backend is located in `src-tauri`. We follow standard Rust idioms and enforce strict safety.

- **Formatting**: Always run `cargo fmt` before committing.
- **Linting**: We use Clippy with warnings denied (`cargo clippy -- -D warnings`).
- **Unsafe Code**: Use of `unsafe` is discouraged. If absolutely necessary, it must be locally scoped and justified.
  ```rust
  // SAFETY: This is required because [reasoning]. We ensure [guarantee].
  unsafe {
      // ...
  }
  ```
- **Tests**: Every new feature must include corresponding tests.

### TypeScript & JavaScript (Frontend & Extension)

The frontend uses Owl v3 and is in `src`. The extension is in the `extension` folder.

- **No `any` (or lazy typing)**: The use of the `any` type is strictly forbidden. Use proper interfaces or types.
- **Type Assertions**: Avoid `as unknown as...`. If you must use it, provide a justifying comment.
- **Defined Assertions**: Use the `!` operator only when you are absolutely certain the value is neither `null` nor `undefined`.

## Testing

Before submitting a Pull Request, ensure all tests pass locally.

- **Frontend Tests**: `npm run test`
- **Backend Tests**: `cd src-tauri && cargo test`
