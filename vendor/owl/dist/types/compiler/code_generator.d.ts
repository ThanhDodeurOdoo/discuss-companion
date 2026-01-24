import { AST, ASTComment, ASTComponent, ASTDebug, ASTDomNode, ASTLog, ASTMulti, ASTTCallSlot, ASTTCall, ASTTCallBlock, ASTText, ASTTForEach, ASTTif, ASTTKey, ASTTOut, ASTTPortal, ASTTranslation, ASTTranslationContext, ASTTSet, EventHandlers } from "./parser";
type BlockType = "block" | "text" | "multi" | "list" | "html" | "comment";
export interface Config {
    translateFn?: (s: string, translationCtx: string) => string;
    translatableAttributes?: string[];
    dev?: boolean;
}
export interface CodeGenOptions extends Config {
    hasSafeContext?: boolean;
    name?: string;
    hasGlobalValues: boolean;
}
declare class BlockDescription {
    static nextBlockId: number;
    varName: string;
    blockName: string;
    dynamicTagName: string | null;
    isRoot: boolean;
    hasDynamicChildren: boolean;
    children: BlockDescription[];
    data: string[];
    dom?: Node;
    currentDom?: Element;
    childNumber: number;
    target: CodeTarget;
    type: BlockType;
    parentVar: string;
    id: number;
    constructor(target: CodeTarget, type: BlockType);
    insertData(str: string, prefix?: string): number;
    insert(dom: Node): void;
    generateExpr(expr: string): string;
    asXmlString(): string;
}
interface Context {
    block: BlockDescription | null;
    index: number | string;
    forceNewBlock: boolean;
    isLast?: boolean;
    translate: boolean;
    translationCtx: string;
    tKeyExpr: string | null;
    nameSpace?: string;
    tModelSelectedExpr?: string;
    ctxVar?: string;
    inPreTag?: boolean;
}
declare class CodeTarget {
    name: string;
    indentLevel: number;
    loopLevel: number;
    code: string[];
    hasRoot: boolean;
    hasCache: boolean;
    shouldProtectScope: boolean;
    on: EventHandlers | null;
    constructor(name: string, on?: EventHandlers | null);
    addLine(line: string, idx?: number): void;
    generateCode(): string;
    currentKey(ctx: Context): string;
}
export declare class CodeGenerator {
    blocks: BlockDescription[];
    nextBlockId: number;
    hasSafeContext: boolean;
    isDebug: boolean;
    targets: CodeTarget[];
    target: CodeTarget;
    templateName?: string;
    dev: boolean;
    translateFn: (s: string, translationCtx: string) => string;
    translatableAttributes: string[];
    ast: AST;
    staticDefs: {
        id: string;
        expr: string;
    }[];
    slotNames: Set<String>;
    helpers: Set<string>;
    constructor(ast: AST, options: CodeGenOptions);
    generateCode(): string;
    compileInNewTarget(prefix: string, ast: AST, ctx: Context, on?: EventHandlers | null): string;
    addLine(line: string, idx?: number): void;
    define(varName: string, expr: string): void;
    insertAnchor(block: BlockDescription, index?: number): void;
    createBlock(parentBlock: BlockDescription | null, type: BlockType, ctx: Context): BlockDescription;
    insertBlock(expression: string, block: BlockDescription, ctx: Context): void;
    /**
     * Captures variables that are used inside of an expression. This is useful
     * because in compiled code, almost all variables are accessed through the ctx
     * object. In the case of functions, that lookup in the context can be delayed
     * which can cause issues if the value has changed since the function was
     * defined.
     *
     * @param expr the expression to capture
     * @param forceCapture whether the expression should capture its scope even if
     *  it doesn't contain a function. Useful when the expression will be used as
     *  a function body.
     * @returns a new expression that uses the captured values
     */
    captureExpression(expr: string, forceCapture?: boolean): string;
    translate(str: string, translationCtx: string): string;
    /**
     * @returns the newly created block name, if any
     */
    compileAST(ast: AST, ctx: Context): string | null;
    compileDebug(ast: ASTDebug, ctx: Context): string | null;
    compileLog(ast: ASTLog, ctx: Context): string | null;
    compileComment(ast: ASTComment, ctx: Context): string;
    compileText(ast: ASTText, ctx: Context): string;
    generateHandlerCode(rawEvent: string, handler: string): string;
    compileTDomNode(ast: ASTDomNode, ctx: Context): string;
    compileTOut(ast: ASTTOut, ctx: Context): string;
    compileTIfBranch(content: AST, block: BlockDescription, ctx: Context): void;
    compileTIf(ast: ASTTif, ctx: Context, nextNode?: ASTDomNode): string;
    compileTForeach(ast: ASTTForEach, ctx: Context): string;
    compileTKey(ast: ASTTKey, ctx: Context): string | null;
    compileMulti(ast: ASTMulti, ctx: Context): string | null;
    compileTCall(ast: ASTTCall, ctx: Context): string;
    compileTCallBlock(ast: ASTTCallBlock, ctx: Context): string;
    compileTSet(ast: ASTTSet, ctx: Context): null;
    generateComponentKey(currentKey?: string): string;
    /**
     * Formats a prop name and value into a string suitable to be inserted in the
     * generated code. For example:
     *
     * Name              Value            Result
     * ---------------------------------------------------------
     * "number"          "state"          "number: ctx['state']"
     * "something"       ""               "something: undefined"
     * "some-prop"       "state"          "'some-prop': ctx['state']"
     * "onClick.bind"    "onClick"        "onClick: bind(ctx, ctx['onClick'])"
     */
    formatProp(name: string, value: string, attrsTranslationCtx: {
        [name: string]: string;
    } | null, translationCtx: string): string;
    formatPropObject(obj: {
        [prop: string]: any;
    }, attrsTranslationCtx: {
        [name: string]: string;
    } | null, translationCtx: string): string[];
    getPropString(props: string[], dynProps: string | null): string;
    compileComponent(ast: ASTComponent, ctx: Context): string;
    wrapWithEventCatcher(expr: string, on: EventHandlers): string;
    compileTCallSlot(ast: ASTTCallSlot, ctx: Context): string;
    compileTTranslation(ast: ASTTranslation, ctx: Context): string | null;
    compileTTranslationContext(ast: ASTTranslationContext, ctx: Context): string | null;
    compileTPortal(ast: ASTTPortal, ctx: Context): string;
}
export {};
