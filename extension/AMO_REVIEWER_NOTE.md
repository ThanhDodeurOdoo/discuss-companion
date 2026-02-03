# AMO Reviewer Note

The AMO warnings about `innerHTML` and the `Function` constructor come from the bundled Owl
runtime used to render the popup UI. The templates are precompiled at build time and the
extension does not evaluate or generate code from user-controlled input. The extension’s
CSP does not include `unsafe-eval`, so runtime string evaluation is not permitted.
