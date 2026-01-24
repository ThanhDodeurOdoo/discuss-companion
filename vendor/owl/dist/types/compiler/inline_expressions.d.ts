export interface QWebVar {
    id: string;
    expr: string;
    value?: string;
    hasBody?: boolean;
}
type TKind = "LEFT_BRACE" | "RIGHT_BRACE" | "LEFT_BRACKET" | "RIGHT_BRACKET" | "LEFT_PAREN" | "RIGHT_PAREN" | "COMMA" | "VALUE" | "TEMPLATE_STRING" | "SYMBOL" | "OPERATOR" | "COLON";
interface Token {
    type: TKind;
    value: string;
    originalValue?: string;
    size?: number;
    varName?: string;
    replace?: Function;
    isLocal?: boolean;
}
/**
 * Convert a javascript expression (as a string) into a list of tokens. For
 * example: `tokenize("1 + b")` will return:
 * ```js
 *  [
 *   {type: "VALUE", value: "1"},
 *   {type: "OPERATOR", value: "+"},
 *   {type: "SYMBOL", value: "b"}
 * ]
 * ```
 */
export declare function tokenize(expr: string): Token[];
/**
 * This is the main function exported by this file. This is the code that will
 * process an expression (given as a string) and returns another expression with
 * proper lookups in the context.
 *
 * Usually, this kind of code would be very simple to do if we had an AST (so,
 * if we had a javascript parser), since then, we would only need to find the
 * variables and replace them.  However, a parser is more complicated, and there
 * are no standard builtin parser API.
 *
 * Since this method is applied to simple javasript expressions, and the work to
 * be done is actually quite simple, we actually can get away with not using a
 * parser, which helps with the code size.
 *
 * Here is the heuristic used by this method to determine if a token is a
 * variable:
 * - by default, all symbols are considered a variable
 * - unless the previous token is a dot (in that case, this is a property: `a.b`)
 * - or if the previous token is a left brace or a comma, and the next token is
 *   a colon (in that case, this is an object key: `{a: b}`)
 *
 * Some specific code is also required to support arrow functions. If we detect
 * the arrow operator, then we add the current (or some previous tokens) token to
 * the list of variables so it does not get replaced by a lookup in the context
 */
export declare function compileExprToArray(expr: string): Token[];
export declare function compileExpr(expr: string): string;
export declare const INTERP_REGEXP: RegExp;
export declare function replaceDynamicParts(s: string, replacer: (s: string) => string): string;
export declare function interpolate(s: string): string;
export {};
