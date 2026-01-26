import { readFile, stat, readdir } from 'fs/promises';
import path from 'path';
import jsdom from 'jsdom';

// -----------------------------------------------------------------------------
// add global DOM stuff for compiler. Needs to be in a separate file so rollup
// doesn't hoist the owl imports above this block of code.
// -----------------------------------------------------------------------------
var document$1 = new jsdom.JSDOM("", {});
var window = document$1.window;
global.document = window.document;
global.window = window;
global.DOMParser = window.DOMParser;
global.Element = window.Element;
global.Node = window.Node;

// Custom error class that wraps error that happen in the owl lifecycle
class OwlError extends Error {
}

/**
 * Owl QWeb Expression Parser
 *
 * Owl needs in various contexts to be able to understand the structure of a
 * string representing a javascript expression.  The usual goal is to be able
 * to rewrite some variables.  For example, if a template has
 *
 *  ```xml
 *  <t t-if="computeSomething({val: state.val})">...</t>
 * ```
 *
 * this needs to be translated in something like this:
 *
 * ```js
 *   if (context["computeSomething"]({val: context["state"].val})) { ... }
 * ```
 *
 * This file contains the implementation of an extremely naive tokenizer/parser
 * and evaluator for javascript expressions.  The supported grammar is basically
 * only expressive enough to understand the shape of objects, of arrays, and
 * various operators.
 */
//------------------------------------------------------------------------------
// Misc types, constants and helpers
//------------------------------------------------------------------------------
const RESERVED_WORDS = "true,false,NaN,null,undefined,debugger,console,window,in,instanceof,new,function,return,eval,void,Math,RegExp,Array,Object,Date,__globals__".split(",");
const WORD_REPLACEMENT = Object.assign(Object.create(null), {
    and: "&&",
    or: "||",
    gt: ">",
    gte: ">=",
    lt: "<",
    lte: "<=",
});
const STATIC_TOKEN_MAP = Object.assign(Object.create(null), {
    "{": "LEFT_BRACE",
    "}": "RIGHT_BRACE",
    "[": "LEFT_BRACKET",
    "]": "RIGHT_BRACKET",
    ":": "COLON",
    ",": "COMMA",
    "(": "LEFT_PAREN",
    ")": "RIGHT_PAREN",
});
// note that the space after typeof is relevant. It makes sure that the formatted
// expression has a space after typeof. Currently we don't support delete and void
const OPERATORS = "...,.,===,==,+,!==,!=,!,||,&&,>=,>,<=,<,?,-,*,/,%,typeof ,=>,=,;,in ,new ,|,&,^,~".split(",");
let tokenizeString = function (expr) {
    let s = expr[0];
    let start = s;
    if (s !== "'" && s !== '"' && s !== "`") {
        return false;
    }
    let i = 1;
    let cur;
    while (expr[i] && expr[i] !== start) {
        cur = expr[i];
        s += cur;
        if (cur === "\\") {
            i++;
            cur = expr[i];
            if (!cur) {
                throw new OwlError("Invalid expression");
            }
            s += cur;
        }
        i++;
    }
    if (expr[i] !== start) {
        throw new OwlError("Invalid expression");
    }
    s += start;
    if (start === "`") {
        return {
            type: "TEMPLATE_STRING",
            value: s,
            replace(replacer) {
                return s.replace(/\$\{(.*?)\}/g, (match, group) => {
                    return "${" + replacer(group) + "}";
                });
            },
        };
    }
    return { type: "VALUE", value: s };
};
let tokenizeNumber = function (expr) {
    let s = expr[0];
    if (s && s.match(/[0-9]/)) {
        let i = 1;
        while (expr[i] && expr[i].match(/[0-9]|\./)) {
            s += expr[i];
            i++;
        }
        return { type: "VALUE", value: s };
    }
    else {
        return false;
    }
};
let tokenizeSymbol = function (expr) {
    let s = expr[0];
    if (s && s.match(/[a-zA-Z_\$]/)) {
        let i = 1;
        while (expr[i] && expr[i].match(/[\w\$]/)) {
            s += expr[i];
            i++;
        }
        if (s in WORD_REPLACEMENT) {
            return { type: "OPERATOR", value: WORD_REPLACEMENT[s], size: s.length };
        }
        return { type: "SYMBOL", value: s };
    }
    else {
        return false;
    }
};
const tokenizeStatic = function (expr) {
    const char = expr[0];
    if (char && char in STATIC_TOKEN_MAP) {
        return { type: STATIC_TOKEN_MAP[char], value: char };
    }
    return false;
};
const tokenizeOperator = function (expr) {
    for (let op of OPERATORS) {
        if (expr.startsWith(op)) {
            return { type: "OPERATOR", value: op };
        }
    }
    return false;
};
const TOKENIZERS = [
    tokenizeString,
    tokenizeNumber,
    tokenizeOperator,
    tokenizeSymbol,
    tokenizeStatic,
];
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
function tokenize(expr) {
    const result = [];
    let token = true;
    let error;
    let current = expr;
    try {
        while (token) {
            current = current.trim();
            if (current) {
                for (let tokenizer of TOKENIZERS) {
                    token = tokenizer(current);
                    if (token) {
                        result.push(token);
                        current = current.slice(token.size || token.value.length);
                        break;
                    }
                }
            }
            else {
                token = false;
            }
        }
    }
    catch (e) {
        error = e; // Silence all errors and throw a generic error below
    }
    if (current.length || error) {
        throw new OwlError(`Tokenizer error: could not tokenize \`${expr}\``);
    }
    return result;
}
//------------------------------------------------------------------------------
// Expression "evaluator"
//------------------------------------------------------------------------------
const isLeftSeparator = (token) => token && (token.type === "LEFT_BRACE" || token.type === "COMMA");
const isRightSeparator = (token) => token && (token.type === "RIGHT_BRACE" || token.type === "COMMA");
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
function compileExprToArray(expr) {
    const localVars = new Set();
    const tokens = tokenize(expr);
    let i = 0;
    let stack = []; // to track last opening (, [ or {
    while (i < tokens.length) {
        let token = tokens[i];
        let prevToken = tokens[i - 1];
        let nextToken = tokens[i + 1];
        let groupType = stack[stack.length - 1];
        switch (token.type) {
            case "LEFT_BRACE":
            case "LEFT_BRACKET":
            case "LEFT_PAREN":
                stack.push(token.type);
                break;
            case "RIGHT_BRACE":
            case "RIGHT_BRACKET":
            case "RIGHT_PAREN":
                stack.pop();
        }
        let isVar = token.type === "SYMBOL" && !RESERVED_WORDS.includes(token.value);
        if (isVar) {
            if (prevToken) {
                // normalize missing tokens: {a} should be equivalent to {a:a}
                if (groupType === "LEFT_BRACE" &&
                    isLeftSeparator(prevToken) &&
                    isRightSeparator(nextToken)) {
                    tokens.splice(i + 1, 0, { type: "COLON", value: ":" }, { ...token });
                    nextToken = tokens[i + 1];
                }
                if (prevToken.type === "OPERATOR" && prevToken.value === ".") {
                    isVar = false;
                }
                else if (prevToken.type === "LEFT_BRACE" || prevToken.type === "COMMA") {
                    if (nextToken && nextToken.type === "COLON") {
                        isVar = false;
                    }
                }
            }
        }
        if (token.type === "TEMPLATE_STRING") {
            token.value = token.replace((expr) => compileExpr(expr));
        }
        if (nextToken && nextToken.type === "OPERATOR" && nextToken.value === "=>") {
            if (token.type === "RIGHT_PAREN") {
                let j = i - 1;
                while (j > 0 && tokens[j].type !== "LEFT_PAREN") {
                    if (tokens[j].type === "SYMBOL" && tokens[j].originalValue) {
                        tokens[j].value = tokens[j].originalValue;
                        localVars.add(tokens[j].value); //] = { id: tokens[j].value, expr: tokens[j].value };
                    }
                    j--;
                }
            }
            else {
                localVars.add(token.value); //] = { id: token.value, expr: token.value };
            }
        }
        if (isVar) {
            token.varName = token.value;
            if (!localVars.has(token.value)) {
                token.originalValue = token.value;
                token.value = `ctx['${token.value}']`;
            }
        }
        i++;
    }
    // Mark all variables that have been used locally.
    // This assumes the expression has only one scope (incorrect but "good enough for now")
    for (const token of tokens) {
        if (token.type === "SYMBOL" && token.varName && localVars.has(token.value)) {
            token.originalValue = token.value;
            token.value = `_${token.value}`;
            token.isLocal = true;
        }
    }
    return tokens;
}
// Leading spaces are trimmed during tokenization, so they need to be added back for some values
const paddedValues = new Map([["in ", " in "]]);
function compileExpr(expr) {
    return compileExprToArray(expr)
        .map((t) => paddedValues.get(t.value) || t.value)
        .join("");
}
const INTERP_REGEXP = /\{\{.*?\}\}|\#\{.*?\}/g;
function replaceDynamicParts(s, replacer) {
    let matches = s.match(INTERP_REGEXP);
    if (matches && matches[0].length === s.length) {
        return `(${replacer(s.slice(2, matches[0][0] === "{" ? -2 : -1))})`;
    }
    let r = s.replace(INTERP_REGEXP, (s) => "${" + replacer(s.slice(2, s[0] === "{" ? -2 : -1)) + "}");
    return "`" + r + "`";
}
function interpolate(s) {
    return replaceDynamicParts(s, compileExpr);
}

const whitespaceRE = /\s+/g;
// using a non-html document so that <inner/outer>HTML serializes as XML instead
// of HTML (as we will parse it as xml later)
const xmlDoc = document.implementation.createDocument(null, null, null);
const MODS = new Set(["stop", "capture", "prevent", "self", "synthetic"]);
let nextDataIds = {};
function generateId(prefix = "") {
    nextDataIds[prefix] = (nextDataIds[prefix] || 0) + 1;
    return prefix + nextDataIds[prefix];
}
function isProp(tag, key) {
    switch (tag) {
        case "input":
            return (key === "checked" ||
                key === "indeterminate" ||
                key === "value" ||
                key === "readonly" ||
                key === "readOnly" ||
                key === "disabled");
        case "option":
            return key === "selected" || key === "disabled";
        case "textarea":
            return key === "value" || key === "readonly" || key === "readOnly" || key === "disabled";
        case "select":
            return key === "value" || key === "disabled";
        case "button":
        case "optgroup":
            return key === "disabled";
    }
    return false;
}
/**
 * Returns a template literal that evaluates to str. You can add interpolation
 * sigils into the string if required
 */
function toStringExpression(str) {
    return `\`${str.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/, "\\${")}\``;
}
// -----------------------------------------------------------------------------
// BlockDescription
// -----------------------------------------------------------------------------
class BlockDescription {
    constructor(target, type) {
        this.dynamicTagName = null;
        this.isRoot = false;
        this.hasDynamicChildren = false;
        this.children = [];
        this.data = [];
        this.childNumber = 0;
        this.parentVar = "";
        this.id = BlockDescription.nextBlockId++;
        this.varName = "b" + this.id;
        this.blockName = "block" + this.id;
        this.target = target;
        this.type = type;
    }
    insertData(str, prefix = "d") {
        const id = generateId(prefix);
        this.target.addLine(`let ${id} = ${str};`);
        return this.data.push(id) - 1;
    }
    insert(dom) {
        if (this.currentDom) {
            this.currentDom.appendChild(dom);
        }
        else {
            this.dom = dom;
        }
    }
    generateExpr(expr) {
        if (this.type === "block") {
            const hasChildren = this.children.length;
            let params = this.data.length ? `[${this.data.join(", ")}]` : hasChildren ? "[]" : "";
            if (hasChildren) {
                params += ", [" + this.children.map((c) => c.varName).join(", ") + "]";
            }
            if (this.dynamicTagName) {
                return `toggler(${this.dynamicTagName}, ${this.blockName}(${this.dynamicTagName})(${params}))`;
            }
            return `${this.blockName}(${params})`;
        }
        else if (this.type === "list") {
            return `list(c_block${this.id})`;
        }
        return expr;
    }
    asXmlString() {
        // Can't use outerHTML on text/comment nodes
        // append dom to any element and use innerHTML instead
        const t = xmlDoc.createElement("t");
        t.appendChild(this.dom);
        return t.innerHTML;
    }
}
BlockDescription.nextBlockId = 1;
function createContext(parentCtx, params) {
    return Object.assign({
        block: null,
        index: 0,
        forceNewBlock: true,
        translate: parentCtx.translate,
        translationCtx: parentCtx.translationCtx,
        tKeyExpr: null,
        nameSpace: parentCtx.nameSpace,
        tModelSelectedExpr: parentCtx.tModelSelectedExpr,
    }, params);
}
class CodeTarget {
    constructor(name, on) {
        this.indentLevel = 0;
        this.loopLevel = 0;
        this.code = [];
        this.hasRoot = false;
        this.hasCache = false;
        this.shouldProtectScope = false;
        this.name = name;
        this.on = on || null;
    }
    addLine(line, idx) {
        const prefix = new Array(this.indentLevel + 2).join("  ");
        if (idx === undefined) {
            this.code.push(prefix + line);
        }
        else {
            this.code.splice(idx, 0, prefix + line);
        }
    }
    generateCode() {
        let result = [];
        result.push(`function ${this.name}(ctx, node, key = "") {`);
        if (this.shouldProtectScope) {
            result.push(`  ctx = Object.create(ctx);`);
            result.push(`  ctx[isBoundary] = 1`);
        }
        if (this.hasCache) {
            result.push(`  let cache = ctx.cache || {};`);
            result.push(`  let nextCache = ctx.cache = {};`);
        }
        for (let line of this.code) {
            result.push(line);
        }
        if (!this.hasRoot) {
            result.push(`return text('');`);
        }
        result.push(`}`);
        return result.join("\n  ");
    }
    currentKey(ctx) {
        let key = this.loopLevel ? `key${this.loopLevel}` : "key";
        if (ctx.tKeyExpr) {
            key = `${ctx.tKeyExpr} + ${key}`;
        }
        return key;
    }
}
const TRANSLATABLE_ATTRS = [
    "alt",
    "aria-label",
    "aria-placeholder",
    "aria-roledescription",
    "aria-valuetext",
    "label",
    "placeholder",
    "title",
];
const translationRE = /^(\s*)([\s\S]+?)(\s*)$/;
class CodeGenerator {
    constructor(ast, options) {
        this.blocks = [];
        this.nextBlockId = 1;
        this.isDebug = false;
        this.targets = [];
        this.target = new CodeTarget("template");
        this.translatableAttributes = TRANSLATABLE_ATTRS;
        this.staticDefs = [];
        this.slotNames = new Set();
        this.helpers = new Set();
        this.translateFn = options.translateFn || ((s) => s);
        if (options.translatableAttributes) {
            const attrs = new Set(TRANSLATABLE_ATTRS);
            for (let attr of options.translatableAttributes) {
                if (attr.startsWith("-")) {
                    attrs.delete(attr.slice(1));
                }
                else {
                    attrs.add(attr);
                }
            }
            this.translatableAttributes = [...attrs];
        }
        this.hasSafeContext = options.hasSafeContext || false;
        this.dev = options.dev || false;
        this.ast = ast;
        this.templateName = options.name;
        if (options.hasGlobalValues) {
            this.helpers.add("__globals__");
        }
    }
    generateCode() {
        const ast = this.ast;
        this.isDebug = ast.type === 11 /* ASTType.TDebug */;
        BlockDescription.nextBlockId = 1;
        nextDataIds = {};
        this.compileAST(ast, {
            block: null,
            index: 0,
            forceNewBlock: false,
            isLast: true,
            translate: true,
            translationCtx: "",
            tKeyExpr: null,
        });
        // define blocks and utility functions
        let mainCode = [`  let { text, createBlock, list, multi, html, toggler, comment } = bdom;`];
        if (this.helpers.size) {
            mainCode.push(`let { ${[...this.helpers].join(", ")} } = helpers;`);
        }
        if (this.templateName) {
            mainCode.push(`// Template name: "${this.templateName}"`);
        }
        for (let { id, expr } of this.staticDefs) {
            mainCode.push(`const ${id} = ${expr};`);
        }
        // define all blocks
        if (this.blocks.length) {
            mainCode.push(``);
            for (let block of this.blocks) {
                if (block.dom) {
                    let xmlString = toStringExpression(block.asXmlString());
                    if (block.dynamicTagName) {
                        xmlString = xmlString.replace(/^`<\w+/, `\`<\${tag || '${block.dom.nodeName}'}`);
                        xmlString = xmlString.replace(/\w+>`$/, `\${tag || '${block.dom.nodeName}'}>\``);
                        mainCode.push(`let ${block.blockName} = tag => createBlock(${xmlString});`);
                    }
                    else {
                        mainCode.push(`let ${block.blockName} = createBlock(${xmlString});`);
                    }
                }
            }
        }
        // define all slots/defaultcontent function
        if (this.targets.length) {
            for (let fn of this.targets) {
                mainCode.push("");
                mainCode = mainCode.concat(fn.generateCode());
            }
        }
        // generate main code
        mainCode.push("");
        mainCode = mainCode.concat("return " + this.target.generateCode());
        const code = mainCode.join("\n  ");
        if (this.isDebug) {
            const msg = `[Owl Debug]\n${code}`;
            console.log(msg);
        }
        return code;
    }
    compileInNewTarget(prefix, ast, ctx, on) {
        const name = generateId(prefix);
        const initialTarget = this.target;
        const target = new CodeTarget(name, on);
        this.targets.push(target);
        this.target = target;
        this.compileAST(ast, createContext(ctx));
        this.target = initialTarget;
        return name;
    }
    addLine(line, idx) {
        this.target.addLine(line, idx);
    }
    define(varName, expr) {
        this.addLine(`const ${varName} = ${expr};`);
    }
    insertAnchor(block, index = block.children.length) {
        const tag = `block-child-${index}`;
        const anchor = xmlDoc.createElement(tag);
        block.insert(anchor);
    }
    createBlock(parentBlock, type, ctx) {
        const hasRoot = this.target.hasRoot;
        const block = new BlockDescription(this.target, type);
        if (!hasRoot) {
            this.target.hasRoot = true;
            block.isRoot = true;
        }
        if (parentBlock) {
            parentBlock.children.push(block);
            if (parentBlock.type === "list") {
                block.parentVar = `c_block${parentBlock.id}`;
            }
        }
        return block;
    }
    insertBlock(expression, block, ctx) {
        let blockExpr = block.generateExpr(expression);
        if (block.parentVar) {
            let key = this.target.currentKey(ctx);
            this.helpers.add("withKey");
            this.addLine(`${block.parentVar}[${ctx.index}] = withKey(${blockExpr}, ${key});`);
            return;
        }
        if (ctx.tKeyExpr) {
            blockExpr = `toggler(${ctx.tKeyExpr}, ${blockExpr})`;
        }
        if (block.isRoot) {
            if (this.target.on) {
                blockExpr = this.wrapWithEventCatcher(blockExpr, this.target.on);
            }
            this.addLine(`return ${blockExpr};`);
        }
        else {
            this.define(block.varName, blockExpr);
        }
    }
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
    captureExpression(expr, forceCapture = false) {
        if (!forceCapture && !expr.includes("=>")) {
            return compileExpr(expr);
        }
        const tokens = compileExprToArray(expr);
        const mapping = new Map();
        return tokens
            .map((tok) => {
            if (tok.varName && !tok.isLocal) {
                if (!mapping.has(tok.varName)) {
                    const varId = generateId("v");
                    mapping.set(tok.varName, varId);
                    this.define(varId, tok.value);
                }
                tok.value = mapping.get(tok.varName);
            }
            return tok.value;
        })
            .join("");
    }
    translate(str, translationCtx) {
        const match = translationRE.exec(str);
        return match[1] + this.translateFn(match[2], translationCtx) + match[3];
    }
    /**
     * @returns the newly created block name, if any
     */
    compileAST(ast, ctx) {
        switch (ast.type) {
            case 1 /* ASTType.Comment */:
                return this.compileComment(ast, ctx);
            case 0 /* ASTType.Text */:
                return this.compileText(ast, ctx);
            case 2 /* ASTType.DomNode */:
                return this.compileTDomNode(ast, ctx);
            case 7 /* ASTType.TOut */:
                return this.compileTOut(ast, ctx);
            case 4 /* ASTType.TIf */:
                return this.compileTIf(ast, ctx);
            case 8 /* ASTType.TForEach */:
                return this.compileTForeach(ast, ctx);
            case 9 /* ASTType.TKey */:
                return this.compileTKey(ast, ctx);
            case 3 /* ASTType.Multi */:
                return this.compileMulti(ast, ctx);
            case 6 /* ASTType.TCall */:
                return this.compileTCall(ast, ctx);
            case 14 /* ASTType.TCallBlock */:
                return this.compileTCallBlock(ast, ctx);
            case 5 /* ASTType.TSet */:
                return this.compileTSet(ast, ctx);
            case 10 /* ASTType.TComponent */:
                return this.compileComponent(ast, ctx);
            case 11 /* ASTType.TDebug */:
                return this.compileDebug(ast, ctx);
            case 12 /* ASTType.TLog */:
                return this.compileLog(ast, ctx);
            case 13 /* ASTType.TCallSlot */:
                return this.compileTCallSlot(ast, ctx);
            case 15 /* ASTType.TTranslation */:
                return this.compileTTranslation(ast, ctx);
            case 16 /* ASTType.TTranslationContext */:
                return this.compileTTranslationContext(ast, ctx);
            case 17 /* ASTType.TPortal */:
                return this.compileTPortal(ast, ctx);
        }
    }
    compileDebug(ast, ctx) {
        this.addLine(`debugger;`);
        if (ast.content) {
            return this.compileAST(ast.content, ctx);
        }
        return null;
    }
    compileLog(ast, ctx) {
        this.addLine(`console.log(${compileExpr(ast.expr)});`);
        if (ast.content) {
            return this.compileAST(ast.content, ctx);
        }
        return null;
    }
    compileComment(ast, ctx) {
        let { block, forceNewBlock } = ctx;
        const isNewBlock = !block || forceNewBlock;
        if (isNewBlock) {
            block = this.createBlock(block, "comment", ctx);
            this.insertBlock(`comment(${toStringExpression(ast.value)})`, block, {
                ...ctx,
                forceNewBlock: forceNewBlock && !block,
            });
        }
        else {
            const text = xmlDoc.createComment(ast.value);
            block.insert(text);
        }
        return block.varName;
    }
    compileText(ast, ctx) {
        let { block, forceNewBlock } = ctx;
        let value = ast.value;
        if (value && ctx.translate !== false) {
            value = this.translate(value, ctx.translationCtx);
        }
        if (!ctx.inPreTag) {
            value = value.replace(whitespaceRE, " ");
        }
        if (!block || forceNewBlock) {
            block = this.createBlock(block, "text", ctx);
            this.insertBlock(`text(${toStringExpression(value)})`, block, {
                ...ctx,
                forceNewBlock: forceNewBlock && !block,
            });
        }
        else {
            const createFn = ast.type === 0 /* ASTType.Text */ ? xmlDoc.createTextNode : xmlDoc.createComment;
            block.insert(createFn.call(xmlDoc, value));
        }
        return block.varName;
    }
    generateHandlerCode(rawEvent, handler) {
        const modifiers = rawEvent
            .split(".")
            .slice(1)
            .map((m) => {
            if (!MODS.has(m)) {
                throw new OwlError(`Unknown event modifier: '${m}'`);
            }
            return `"${m}"`;
        });
        let modifiersCode = "";
        if (modifiers.length) {
            modifiersCode = `${modifiers.join(",")}, `;
        }
        return `[${modifiersCode}${this.captureExpression(handler)}, ctx]`;
    }
    compileTDomNode(ast, ctx) {
        var _a;
        let { block, forceNewBlock } = ctx;
        const isNewBlock = !block || forceNewBlock || ast.dynamicTag !== null || ast.ns;
        let codeIdx = this.target.code.length;
        if (isNewBlock) {
            if ((ast.dynamicTag || ctx.tKeyExpr || ast.ns) && ctx.block) {
                this.insertAnchor(ctx.block);
            }
            block = this.createBlock(block, "block", ctx);
            this.blocks.push(block);
            if (ast.dynamicTag) {
                const tagExpr = generateId("tag");
                this.define(tagExpr, compileExpr(ast.dynamicTag));
                block.dynamicTagName = tagExpr;
            }
        }
        // attributes
        const attrs = {};
        for (let key in ast.attrs) {
            let expr, attrName;
            if (key.startsWith("t-attf")) {
                expr = interpolate(ast.attrs[key]);
                const idx = block.insertData(expr, "attr");
                attrName = key.slice(7);
                attrs["block-attribute-" + idx] = attrName;
            }
            else if (key.startsWith("t-att")) {
                attrName = key === "t-att" ? null : key.slice(6);
                expr = compileExpr(ast.attrs[key]);
                if (attrName && isProp(ast.tag, attrName)) {
                    if (attrName === "readonly") {
                        // the property has a different name than the attribute
                        attrName = "readOnly";
                    }
                    // we force a new string or new boolean to bypass the equality check in blockdom when patching same value
                    if (attrName === "value") {
                        // When the expression is falsy (except 0), fall back to an empty string
                        expr = `new String((${expr}) === 0 ? 0 : ((${expr}) || ""))`;
                    }
                    else {
                        expr = `new Boolean(${expr})`;
                    }
                    const idx = block.insertData(expr, "prop");
                    attrs[`block-property-${idx}`] = attrName;
                }
                else {
                    const idx = block.insertData(expr, "attr");
                    if (key === "t-att") {
                        attrs[`block-attributes`] = String(idx);
                    }
                    else {
                        attrs[`block-attribute-${idx}`] = attrName;
                    }
                }
            }
            else if (this.translatableAttributes.includes(key)) {
                const attrTranslationCtx = ((_a = ast.attrsTranslationCtx) === null || _a === void 0 ? void 0 : _a[key]) || ctx.translationCtx;
                attrs[key] = this.translateFn(ast.attrs[key], attrTranslationCtx);
            }
            else {
                expr = `"${ast.attrs[key]}"`;
                attrName = key;
                attrs[key] = ast.attrs[key];
            }
            if (attrName === "value" && ctx.tModelSelectedExpr) {
                let selectedId = block.insertData(`${ctx.tModelSelectedExpr} === ${expr}`, "attr");
                attrs[`block-attribute-${selectedId}`] = "selected";
            }
        }
        // t-model
        let tModelSelectedExpr;
        if (ast.model) {
            const { hasDynamicChildren, expr, eventType, shouldNumberize, shouldTrim, targetAttr, specialInitTargetAttr, } = ast.model;
            const expression = compileExpr(expr);
            const exprId = generateId("expr");
            this.helpers.add("modelExpr");
            this.define(exprId, `modelExpr(${expression})`);
            let idx;
            if (specialInitTargetAttr) {
                let targetExpr = targetAttr in attrs && `'${attrs[targetAttr]}'`;
                if (!targetExpr && ast.attrs) {
                    // look at the dynamic attribute counterpart
                    const dynamicTgExpr = ast.attrs[`t-att-${targetAttr}`];
                    if (dynamicTgExpr) {
                        targetExpr = compileExpr(dynamicTgExpr);
                    }
                }
                idx = block.insertData(`${exprId}() === ${targetExpr}`, "prop");
                attrs[`block-property-${idx}`] = specialInitTargetAttr;
            }
            else if (hasDynamicChildren) {
                const bValueId = generateId("bValue");
                tModelSelectedExpr = `${bValueId}`;
                this.define(tModelSelectedExpr, `${exprId}()`);
            }
            else {
                idx = block.insertData(`${exprId}()`, "prop");
                attrs[`block-property-${idx}`] = targetAttr;
            }
            this.helpers.add("toNumber");
            let valueCode = `ev.target.${targetAttr}`;
            valueCode = shouldTrim ? `${valueCode}.trim()` : valueCode;
            valueCode = shouldNumberize ? `toNumber(${valueCode})` : valueCode;
            const handler = `[(ev) => { ${exprId}.set(${valueCode}); }]`;
            idx = block.insertData(handler, "hdlr");
            attrs[`block-handler-${idx}`] = eventType;
        }
        // event handlers
        for (let ev in ast.on) {
            const name = this.generateHandlerCode(ev, ast.on[ev]);
            const idx = block.insertData(name, "hdlr");
            attrs[`block-handler-${idx}`] = ev;
        }
        // t-ref
        if (ast.ref) {
            const refExpr = compileExpr(ast.ref);
            this.helpers.add("createRef");
            const setRefStr = `createRef(${refExpr})`;
            const idx = block.insertData(setRefStr, "ref");
            attrs["block-ref"] = String(idx);
        }
        const nameSpace = ast.ns || ctx.nameSpace;
        const dom = nameSpace
            ? xmlDoc.createElementNS(nameSpace, ast.tag)
            : xmlDoc.createElement(ast.tag);
        for (const [attr, val] of Object.entries(attrs)) {
            if (!(attr === "class" && val === "")) {
                dom.setAttribute(attr, val);
            }
        }
        block.insert(dom);
        if (ast.content.length) {
            const initialDom = block.currentDom;
            block.currentDom = dom;
            const children = ast.content;
            for (let i = 0; i < children.length; i++) {
                const child = ast.content[i];
                const subCtx = createContext(ctx, {
                    block,
                    index: block.childNumber,
                    forceNewBlock: false,
                    isLast: ctx.isLast && i === children.length - 1,
                    tKeyExpr: ctx.tKeyExpr,
                    nameSpace,
                    tModelSelectedExpr,
                    inPreTag: ctx.inPreTag || ast.tag === "pre",
                });
                this.compileAST(child, subCtx);
            }
            block.currentDom = initialDom;
        }
        if (isNewBlock) {
            this.insertBlock(`${block.blockName}(ddd)`, block, ctx);
            // may need to rewrite code!
            if (block.children.length && block.hasDynamicChildren) {
                const code = this.target.code;
                const children = block.children.slice();
                let current = children.shift();
                for (let i = codeIdx; i < code.length; i++) {
                    if (code[i].trimStart().startsWith(`const ${current.varName} `)) {
                        code[i] = code[i].replace(`const ${current.varName}`, current.varName);
                        current = children.shift();
                        if (!current)
                            break;
                    }
                }
                this.addLine(`let ${block.children.map((c) => c.varName).join(", ")};`, codeIdx);
            }
        }
        return block.varName;
    }
    compileTOut(ast, ctx) {
        let { block } = ctx;
        if (block) {
            this.insertAnchor(block);
        }
        block = this.createBlock(block, "html", ctx);
        let blockStr;
        if (ast.expr === "0") {
            this.helpers.add("zero");
            blockStr = `ctx[zero]`;
        }
        else if (ast.body) {
            let bodyValue = null;
            bodyValue = BlockDescription.nextBlockId;
            const subCtx = createContext(ctx);
            this.compileAST({ type: 3 /* ASTType.Multi */, content: ast.body }, subCtx);
            this.helpers.add("safeOutput");
            blockStr = `safeOutput(${compileExpr(ast.expr)}, b${bodyValue})`;
        }
        else {
            this.helpers.add("safeOutput");
            blockStr = `safeOutput(${compileExpr(ast.expr)})`;
        }
        this.insertBlock(blockStr, block, ctx);
        return block.varName;
    }
    compileTIfBranch(content, block, ctx) {
        this.target.indentLevel++;
        let childN = block.children.length;
        this.compileAST(content, createContext(ctx, { block, index: ctx.index }));
        if (block.children.length > childN) {
            // we have some content => need to insert an anchor at correct index
            this.insertAnchor(block, childN);
        }
        this.target.indentLevel--;
    }
    compileTIf(ast, ctx, nextNode) {
        let { block, forceNewBlock } = ctx;
        const codeIdx = this.target.code.length;
        const isNewBlock = !block || (block.type !== "multi" && forceNewBlock);
        if (block) {
            block.hasDynamicChildren = true;
        }
        if (!block || (block.type !== "multi" && forceNewBlock)) {
            block = this.createBlock(block, "multi", ctx);
        }
        this.addLine(`if (${compileExpr(ast.condition)}) {`);
        this.compileTIfBranch(ast.content, block, ctx);
        if (ast.tElif) {
            for (let clause of ast.tElif) {
                this.addLine(`} else if (${compileExpr(clause.condition)}) {`);
                this.compileTIfBranch(clause.content, block, ctx);
            }
        }
        if (ast.tElse) {
            this.addLine(`} else {`);
            this.compileTIfBranch(ast.tElse, block, ctx);
        }
        this.addLine("}");
        if (isNewBlock) {
            // note: this part is duplicated from end of compiledomnode:
            if (block.children.length) {
                const code = this.target.code;
                const children = block.children.slice();
                let current = children.shift();
                for (let i = codeIdx; i < code.length; i++) {
                    if (code[i].trimStart().startsWith(`const ${current.varName} `)) {
                        code[i] = code[i].replace(`const ${current.varName}`, current.varName);
                        current = children.shift();
                        if (!current)
                            break;
                    }
                }
                this.addLine(`let ${block.children.map((c) => c.varName).join(", ")};`, codeIdx);
            }
            // note: this part is duplicated from end of compilemulti:
            const args = block.children.map((c) => c.varName).join(", ");
            this.insertBlock(`multi([${args}])`, block, ctx);
        }
        return block.varName;
    }
    compileTForeach(ast, ctx) {
        let { block } = ctx;
        if (block) {
            this.insertAnchor(block);
        }
        block = this.createBlock(block, "list", ctx);
        this.target.loopLevel++;
        const loopVar = `i${this.target.loopLevel}`;
        this.addLine(`ctx = Object.create(ctx);`);
        const vals = `v_block${block.id}`;
        const keys = `k_block${block.id}`;
        const l = `l_block${block.id}`;
        const c = `c_block${block.id}`;
        this.helpers.add("prepareList");
        this.define(`[${keys}, ${vals}, ${l}, ${c}]`, `prepareList(${compileExpr(ast.collection)});`);
        // Throw errors on duplicate keys in dev mode
        if (this.dev) {
            this.define(`keys${block.id}`, `new Set()`);
        }
        this.addLine(`for (let ${loopVar} = 0; ${loopVar} < ${l}; ${loopVar}++) {`);
        this.target.indentLevel++;
        this.addLine(`ctx[\`${ast.elem}\`] = ${keys}[${loopVar}];`);
        if (!ast.hasNoFirst) {
            this.addLine(`ctx[\`${ast.elem}_first\`] = ${loopVar} === 0;`);
        }
        if (!ast.hasNoLast) {
            this.addLine(`ctx[\`${ast.elem}_last\`] = ${loopVar} === ${keys}.length - 1;`);
        }
        if (!ast.hasNoIndex) {
            this.addLine(`ctx[\`${ast.elem}_index\`] = ${loopVar};`);
        }
        if (!ast.hasNoValue) {
            this.addLine(`ctx[\`${ast.elem}_value\`] = ${vals}[${loopVar}];`);
        }
        this.define(`key${this.target.loopLevel}`, ast.key ? compileExpr(ast.key) : loopVar);
        if (this.dev) {
            // Throw error on duplicate keys in dev mode
            this.helpers.add("OwlError");
            this.addLine(`if (keys${block.id}.has(String(key${this.target.loopLevel}))) { throw new OwlError(\`Got duplicate key in t-foreach: \${key${this.target.loopLevel}}\`)}`);
            this.addLine(`keys${block.id}.add(String(key${this.target.loopLevel}));`);
        }
        let id;
        if (ast.memo) {
            this.target.hasCache = true;
            id = generateId();
            this.define(`memo${id}`, compileExpr(ast.memo));
            this.define(`vnode${id}`, `cache[key${this.target.loopLevel}];`);
            this.addLine(`if (vnode${id}) {`);
            this.target.indentLevel++;
            this.addLine(`if (shallowEqual(vnode${id}.memo, memo${id})) {`);
            this.target.indentLevel++;
            this.addLine(`${c}[${loopVar}] = vnode${id};`);
            this.addLine(`nextCache[key${this.target.loopLevel}] = vnode${id};`);
            this.addLine(`continue;`);
            this.target.indentLevel--;
            this.addLine("}");
            this.target.indentLevel--;
            this.addLine("}");
        }
        const subCtx = createContext(ctx, { block, index: loopVar });
        this.compileAST(ast.body, subCtx);
        if (ast.memo) {
            this.addLine(`nextCache[key${this.target.loopLevel}] = Object.assign(${c}[${loopVar}], {memo: memo${id}});`);
        }
        this.target.indentLevel--;
        this.target.loopLevel--;
        this.addLine(`}`);
        if (!ctx.isLast) {
            this.addLine(`ctx = ctx.__proto__;`);
        }
        this.insertBlock("l", block, ctx);
        return block.varName;
    }
    compileTKey(ast, ctx) {
        const tKeyExpr = generateId("tKey_");
        this.define(tKeyExpr, compileExpr(ast.expr));
        ctx = createContext(ctx, {
            tKeyExpr,
            block: ctx.block,
            index: ctx.index,
        });
        return this.compileAST(ast.content, ctx);
    }
    compileMulti(ast, ctx) {
        let { block, forceNewBlock } = ctx;
        const isNewBlock = !block || forceNewBlock;
        let codeIdx = this.target.code.length;
        if (isNewBlock) {
            const n = ast.content.filter((c) => !c.hasNoRepresentation).length;
            let result = null;
            if (n <= 1) {
                for (let child of ast.content) {
                    const blockName = this.compileAST(child, ctx);
                    result = result || blockName;
                }
                return result;
            }
            block = this.createBlock(block, "multi", ctx);
        }
        let index = 0;
        for (let i = 0, l = ast.content.length; i < l; i++) {
            const child = ast.content[i];
            const forceNewBlock = !child.hasNoRepresentation;
            const subCtx = createContext(ctx, {
                block,
                index,
                forceNewBlock,
                isLast: ctx.isLast && i === l - 1,
            });
            this.compileAST(child, subCtx);
            if (forceNewBlock) {
                index++;
            }
        }
        if (isNewBlock) {
            if (block.hasDynamicChildren && block.children.length) {
                const code = this.target.code;
                const children = block.children.slice();
                let current = children.shift();
                for (let i = codeIdx; i < code.length; i++) {
                    if (code[i].trimStart().startsWith(`const ${current.varName} `)) {
                        code[i] = code[i].replace(`const ${current.varName}`, current.varName);
                        current = children.shift();
                        if (!current)
                            break;
                    }
                }
                this.addLine(`let ${block.children.map((c) => c.varName).join(", ")};`, codeIdx);
            }
            const args = block.children.map((c) => c.varName).join(", ");
            this.insertBlock(`multi([${args}])`, block, ctx);
        }
        return block.varName;
    }
    compileTCall(ast, ctx) {
        let { block, forceNewBlock } = ctx;
        let ctxVar = ctx.ctxVar || "ctx";
        if (ast.context) {
            ctxVar = generateId("ctx");
            this.addLine(`let ${ctxVar} = {this: ${compileExpr(ast.context)}, __owl__: this.__owl__};`);
        }
        const isDynamic = INTERP_REGEXP.test(ast.name);
        const subTemplate = isDynamic ? interpolate(ast.name) : "`" + ast.name + "`";
        if (block && !forceNewBlock) {
            this.insertAnchor(block);
        }
        block = this.createBlock(block, "multi", ctx);
        if (ast.body) {
            this.addLine(`${ctxVar} = Object.create(${ctxVar});`);
            this.addLine(`${ctxVar}[isBoundary] = 1;`);
            this.helpers.add("isBoundary");
            const subCtx = createContext(ctx, { ctxVar });
            const bl = this.compileMulti({ type: 3 /* ASTType.Multi */, content: ast.body }, subCtx);
            if (bl) {
                this.helpers.add("zero");
                this.addLine(`${ctxVar}[zero] = ${bl};`);
            }
        }
        const key = this.generateComponentKey();
        if (isDynamic) {
            const templateVar = generateId("template");
            if (!this.staticDefs.find((d) => d.id === "call")) {
                this.staticDefs.push({ id: "call", expr: `app.callTemplate.bind(app)` });
            }
            this.define(templateVar, subTemplate);
            this.insertBlock(`call(this, ${templateVar}, ${ctxVar}, node, ${key})`, block, {
                ...ctx,
                forceNewBlock: !block,
            });
        }
        else {
            const id = generateId(`callTemplate_`);
            this.staticDefs.push({ id, expr: `app.getTemplate(${subTemplate})` });
            this.insertBlock(`${id}.call(this, ${ctxVar}, node, ${key})`, block, {
                ...ctx,
                forceNewBlock: !block,
            });
        }
        if (ast.body && !ctx.isLast) {
            this.addLine(`${ctxVar} = ${ctxVar}.__proto__;`);
        }
        return block.varName;
    }
    compileTCallBlock(ast, ctx) {
        let { block, forceNewBlock } = ctx;
        if (block) {
            if (!forceNewBlock) {
                this.insertAnchor(block);
            }
        }
        block = this.createBlock(block, "multi", ctx);
        this.insertBlock(compileExpr(ast.name), block, { ...ctx, forceNewBlock: !block });
        return block.varName;
    }
    compileTSet(ast, ctx) {
        this.target.shouldProtectScope = true;
        this.helpers.add("isBoundary").add("withDefault");
        const expr = ast.value ? compileExpr(ast.value || "") : "null";
        if (ast.body) {
            this.helpers.add("LazyValue");
            const bodyAst = { type: 3 /* ASTType.Multi */, content: ast.body };
            const name = this.compileInNewTarget("value", bodyAst, ctx);
            let key = this.target.currentKey(ctx);
            let value = `new LazyValue(${name}, ctx, this, node, ${key})`;
            value = ast.value ? (value ? `withDefault(${expr}, ${value})` : expr) : value;
            this.addLine(`ctx[\`${ast.name}\`] = ${value};`);
        }
        else {
            let value;
            if (ast.defaultValue) {
                const defaultValue = toStringExpression(ctx.translate ? this.translate(ast.defaultValue, ctx.translationCtx) : ast.defaultValue);
                if (ast.value) {
                    value = `withDefault(${expr}, ${defaultValue})`;
                }
                else {
                    value = defaultValue;
                }
            }
            else {
                value = expr;
            }
            this.helpers.add("setContextValue");
            this.addLine(`setContextValue(${ctx.ctxVar || "ctx"}, "${ast.name}", ${value});`);
        }
        return null;
    }
    generateComponentKey(currentKey = "key") {
        const parts = [generateId("__")];
        for (let i = 0; i < this.target.loopLevel; i++) {
            parts.push(`\${key${i + 1}}`);
        }
        return `${currentKey} + \`${parts.join("__")}\``;
    }
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
    formatProp(name, value, attrsTranslationCtx, translationCtx) {
        if (name.endsWith(".translate")) {
            const attrTranslationCtx = (attrsTranslationCtx === null || attrsTranslationCtx === void 0 ? void 0 : attrsTranslationCtx[name]) || translationCtx;
            value = toStringExpression(this.translateFn(value, attrTranslationCtx));
        }
        else {
            value = this.captureExpression(value);
        }
        if (name.includes(".")) {
            let [_name, suffix] = name.split(".");
            name = _name;
            switch (suffix) {
                case "bind":
                    value = `(${value}).bind(this)`;
                    break;
                case "alike":
                case "translate":
                    break;
                default:
                    throw new OwlError(`Invalid prop suffix: ${suffix}`);
            }
        }
        name = /^[a-z_]+$/i.test(name) ? name : `'${name}'`;
        return `${name}: ${value || undefined}`;
    }
    formatPropObject(obj, attrsTranslationCtx, translationCtx) {
        return Object.entries(obj).map(([k, v]) => this.formatProp(k, v, attrsTranslationCtx, translationCtx));
    }
    getPropString(props, dynProps) {
        let propString = `{${props.join(",")}}`;
        if (dynProps) {
            propString = `Object.assign({}, ${compileExpr(dynProps)}${props.length ? ", " + propString : ""})`;
        }
        return propString;
    }
    compileComponent(ast, ctx) {
        let { block } = ctx;
        // props
        const hasSlotsProp = "slots" in (ast.props || {});
        const props = ast.props
            ? this.formatPropObject(ast.props, ast.propsTranslationCtx, ctx.translationCtx)
            : [];
        // slots
        let slotDef = "";
        if (ast.slots) {
            let ctxStr = "ctx";
            if (this.target.loopLevel || !this.hasSafeContext) {
                ctxStr = generateId("ctx");
                this.helpers.add("capture");
                this.define(ctxStr, `capture(ctx)`);
            }
            let slotStr = [];
            for (let slotName in ast.slots) {
                const slotAst = ast.slots[slotName];
                const params = [];
                if (slotAst.content) {
                    const name = this.compileInNewTarget("slot", slotAst.content, ctx, slotAst.on);
                    params.push(`__render: ${name}.bind(this), __ctx: ${ctxStr}`);
                }
                const scope = ast.slots[slotName].scope;
                if (scope) {
                    params.push(`__scope: "${scope}"`);
                }
                if (ast.slots[slotName].attrs) {
                    params.push(...this.formatPropObject(ast.slots[slotName].attrs, ast.slots[slotName].attrsTranslationCtx, ctx.translationCtx));
                }
                const slotInfo = `{${params.join(", ")}}`;
                slotStr.push(`'${slotName}': ${slotInfo}`);
            }
            slotDef = `{${slotStr.join(", ")}}`;
        }
        if (slotDef && !(ast.dynamicProps || hasSlotsProp)) {
            this.helpers.add("markRaw");
            props.push(`slots: markRaw(${slotDef})`);
        }
        let propString = this.getPropString(props, ast.dynamicProps);
        let propVar;
        if ((slotDef && (ast.dynamicProps || hasSlotsProp)) || this.dev) {
            propVar = generateId("props");
            this.define(propVar, propString);
            propString = propVar;
        }
        if (slotDef && (ast.dynamicProps || hasSlotsProp)) {
            this.helpers.add("markRaw");
            this.addLine(`${propVar}.slots = markRaw(Object.assign(${slotDef}, ${propVar}.slots))`);
        }
        // cmap key
        let expr;
        if (ast.isDynamic) {
            expr = generateId("Comp");
            this.define(expr, compileExpr(ast.name));
        }
        else {
            expr = `\`${ast.name}\``;
        }
        if (block && (ctx.forceNewBlock === false || ctx.tKeyExpr)) {
            // todo: check the forcenewblock condition
            this.insertAnchor(block);
        }
        let keyArg = this.generateComponentKey();
        if (ctx.tKeyExpr) {
            keyArg = `${ctx.tKeyExpr} + ${keyArg}`;
        }
        let id = generateId("comp");
        const propList = [];
        for (let p in ast.props || {}) {
            let [name, suffix] = p.split(".");
            if (!suffix) {
                propList.push(`"${name}"`);
            }
        }
        this.staticDefs.push({
            id,
            expr: `app.createComponent(${ast.isDynamic ? null : expr}, ${!ast.isDynamic}, ${!!ast.slots}, ${!!ast.dynamicProps}, [${propList}])`,
        });
        if (ast.isDynamic) {
            // If the component class changes, this can cause delayed renders to go
            // through if the key doesn't change. Use the component name for now.
            // This means that two component classes with the same name isn't supported
            // in t-component. We can generate a unique id per class later if needed.
            keyArg = `(${expr}).name + ${keyArg}`;
        }
        let blockExpr = `${id}(${propString}, ${keyArg}, node, this, ${ast.isDynamic ? expr : null})`;
        if (ast.isDynamic) {
            blockExpr = `toggler(${expr}, ${blockExpr})`;
        }
        // event handling
        if (ast.on) {
            blockExpr = this.wrapWithEventCatcher(blockExpr, ast.on);
        }
        block = this.createBlock(block, "multi", ctx);
        this.insertBlock(blockExpr, block, ctx);
        return block.varName;
    }
    wrapWithEventCatcher(expr, on) {
        this.helpers.add("createCatcher");
        let name = generateId("catcher");
        let spec = {};
        let handlers = [];
        for (let ev in on) {
            let handlerId = generateId("hdlr");
            let idx = handlers.push(handlerId) - 1;
            spec[ev] = idx;
            const handler = this.generateHandlerCode(ev, on[ev]);
            this.define(handlerId, handler);
        }
        this.staticDefs.push({ id: name, expr: `createCatcher(${JSON.stringify(spec)})` });
        return `${name}(${expr}, [${handlers.join(",")}])`;
    }
    compileTCallSlot(ast, ctx) {
        this.helpers.add("callSlot");
        let { block } = ctx;
        let blockString;
        let slotName;
        let dynamic = false;
        let isMultiple = false;
        if (ast.name.match(INTERP_REGEXP)) {
            dynamic = true;
            isMultiple = true;
            slotName = interpolate(ast.name);
        }
        else {
            slotName = "'" + ast.name + "'";
            isMultiple = isMultiple || this.slotNames.has(ast.name);
            this.slotNames.add(ast.name);
        }
        const attrs = { ...ast.attrs };
        const dynProps = attrs["t-props"];
        delete attrs["t-props"];
        let key = this.target.loopLevel ? `key${this.target.loopLevel}` : "key";
        if (isMultiple) {
            key = this.generateComponentKey(key);
        }
        const props = ast.attrs
            ? this.formatPropObject(attrs, ast.attrsTranslationCtx, ctx.translationCtx)
            : [];
        const scope = this.getPropString(props, dynProps);
        if (ast.defaultContent) {
            const name = this.compileInNewTarget("defaultContent", ast.defaultContent, ctx);
            blockString = `callSlot(ctx, node, ${key}, ${slotName}, ${dynamic}, ${scope}, ${name}.bind(this))`;
        }
        else {
            if (dynamic) {
                let name = generateId("slot");
                this.define(name, slotName);
                blockString = `toggler(${name}, callSlot(ctx, node, ${key}, ${name}, ${dynamic}, ${scope}))`;
            }
            else {
                blockString = `callSlot(ctx, node, ${key}, ${slotName}, ${dynamic}, ${scope})`;
            }
        }
        // event handling
        if (ast.on) {
            blockString = this.wrapWithEventCatcher(blockString, ast.on);
        }
        if (block) {
            this.insertAnchor(block);
        }
        block = this.createBlock(block, "multi", ctx);
        this.insertBlock(blockString, block, { ...ctx, forceNewBlock: false });
        return block.varName;
    }
    compileTTranslation(ast, ctx) {
        if (ast.content) {
            return this.compileAST(ast.content, Object.assign({}, ctx, { translate: false }));
        }
        return null;
    }
    compileTTranslationContext(ast, ctx) {
        if (ast.content) {
            return this.compileAST(ast.content, Object.assign({}, ctx, { translationCtx: ast.translationCtx }));
        }
        return null;
    }
    compileTPortal(ast, ctx) {
        if (!this.staticDefs.find((d) => d.id === "Portal")) {
            this.staticDefs.push({ id: "Portal", expr: `app.Portal` });
        }
        let { block } = ctx;
        const name = this.compileInNewTarget("slot", ast.content, ctx);
        let ctxStr = "ctx";
        if (this.target.loopLevel || !this.hasSafeContext) {
            ctxStr = generateId("ctx");
            this.helpers.add("capture");
            this.define(ctxStr, `capture(ctx)`);
        }
        let id = generateId("comp");
        this.staticDefs.push({
            id,
            expr: `app.createComponent(null, false, true, false, false)`,
        });
        const target = compileExpr(ast.target);
        const key = this.generateComponentKey();
        const blockString = `${id}({target: ${target},slots: {'default': {__render: ${name}.bind(this), __ctx: ${ctxStr}}}}, ${key}, node, ctx, Portal)`;
        if (block) {
            this.insertAnchor(block);
        }
        block = this.createBlock(block, "multi", ctx);
        this.insertBlock(blockString, block, { ...ctx, forceNewBlock: false });
        return block.varName;
    }
}

/**
 * Parses an XML string into an XML document, throwing errors on parser errors
 * instead of returning an XML document containing the parseerror.
 *
 * @param xml the string to parse
 * @returns an XML document corresponding to the content of the string
 */
function parseXML(xml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "text/xml");
    if (doc.getElementsByTagName("parsererror").length) {
        let msg = "Invalid XML in template.";
        const parsererrorText = doc.getElementsByTagName("parsererror")[0].textContent;
        if (parsererrorText) {
            msg += "\nThe parser has produced the following error message:\n" + parsererrorText;
            const re = /\d+/g;
            const firstMatch = re.exec(parsererrorText);
            if (firstMatch) {
                const lineNumber = Number(firstMatch[0]);
                const line = xml.split("\n")[lineNumber - 1];
                const secondMatch = re.exec(parsererrorText);
                if (line && secondMatch) {
                    const columnIndex = Number(secondMatch[0]) - 1;
                    if (line[columnIndex]) {
                        msg +=
                            `\nThe error might be located at xml line ${lineNumber} column ${columnIndex}\n` +
                                `${line}\n${"-".repeat(columnIndex - 1)}^`;
                    }
                }
            }
        }
        throw new OwlError(msg);
    }
    return doc;
}

// -----------------------------------------------------------------------------
// Parser
// -----------------------------------------------------------------------------
const cache = new WeakMap();
function parse(xml, customDir) {
    const ctx = {
        inPreTag: false,
        customDirectives: customDir,
    };
    if (typeof xml === "string") {
        const elem = parseXML(`<t>${xml}</t>`).firstChild;
        return _parse(elem, ctx);
    }
    let ast = cache.get(xml);
    if (!ast) {
        // we clone here the xml to prevent modifying it in place
        ast = _parse(xml.cloneNode(true), ctx);
        cache.set(xml, ast);
    }
    return ast;
}
function _parse(xml, ctx) {
    normalizeXML(xml);
    return parseNode(xml, ctx) || { type: 0 /* ASTType.Text */, value: "" };
}
function parseNode(node, ctx) {
    if (!(node instanceof Element)) {
        return parseTextCommentNode(node, ctx);
    }
    return (parseTCustom(node, ctx) ||
        parseTDebugLog(node, ctx) ||
        parseTForEach(node, ctx) ||
        parseTIf(node, ctx) ||
        parseTPortal(node, ctx) ||
        parseTCall(node, ctx) ||
        parseTCallBlock(node) ||
        parseTTranslation(node, ctx) ||
        parseTTranslationContext(node, ctx) ||
        parseTKey(node, ctx) ||
        parseTOutNode(node, ctx) ||
        parseTCallSlot(node, ctx) ||
        parseComponent(node, ctx) ||
        parseDOMNode(node, ctx) ||
        parseTSetNode(node, ctx) ||
        parseTNode(node, ctx));
}
// -----------------------------------------------------------------------------
// <t /> tag
// -----------------------------------------------------------------------------
function parseTNode(node, ctx) {
    if (node.tagName !== "t") {
        return null;
    }
    return parseChildNodes(node, ctx);
}
// -----------------------------------------------------------------------------
// Text and Comment Nodes
// -----------------------------------------------------------------------------
const lineBreakRE = /[\r\n]/;
function parseTextCommentNode(node, ctx) {
    if (node.nodeType === Node.TEXT_NODE) {
        let value = node.textContent || "";
        if (!ctx.inPreTag && lineBreakRE.test(value) && !value.trim()) {
            return null;
        }
        return { type: 0 /* ASTType.Text */, value };
    }
    else if (node.nodeType === Node.COMMENT_NODE) {
        return { type: 1 /* ASTType.Comment */, value: node.textContent || "" };
    }
    return null;
}
function parseTCustom(node, ctx) {
    if (!ctx.customDirectives) {
        return null;
    }
    const nodeAttrsNames = node.getAttributeNames();
    for (let attr of nodeAttrsNames) {
        if (attr === "t-custom" || attr === "t-custom-") {
            throw new OwlError("Missing custom directive name with t-custom directive");
        }
        if (attr.startsWith("t-custom-")) {
            const directiveName = attr.split(".")[0].slice(9);
            const customDirective = ctx.customDirectives[directiveName];
            if (!customDirective) {
                throw new OwlError(`Custom directive "${directiveName}" is not defined`);
            }
            const value = node.getAttribute(attr);
            const modifiers = attr.split(".").slice(1);
            node.removeAttribute(attr);
            try {
                customDirective(node, value, modifiers);
            }
            catch (error) {
                throw new OwlError(`Custom directive "${directiveName}" throw the following error: ${error}`);
            }
            return parseNode(node, ctx);
        }
    }
    return null;
}
// -----------------------------------------------------------------------------
// debugging
// -----------------------------------------------------------------------------
function parseTDebugLog(node, ctx) {
    if (node.hasAttribute("t-debug")) {
        node.removeAttribute("t-debug");
        const content = parseNode(node, ctx);
        const ast = {
            type: 11 /* ASTType.TDebug */,
            content,
        };
        if (content === null || content === void 0 ? void 0 : content.hasNoRepresentation) {
            ast.hasNoRepresentation = true;
        }
        return ast;
    }
    if (node.hasAttribute("t-log")) {
        const expr = node.getAttribute("t-log");
        node.removeAttribute("t-log");
        const content = parseNode(node, ctx);
        const ast = {
            type: 12 /* ASTType.TLog */,
            expr,
            content,
        };
        if (content === null || content === void 0 ? void 0 : content.hasNoRepresentation) {
            ast.hasNoRepresentation = true;
        }
        return ast;
    }
    return null;
}
// -----------------------------------------------------------------------------
// Regular dom node
// -----------------------------------------------------------------------------
const ROOT_SVG_TAGS = new Set(["svg", "g", "path"]);
function parseDOMNode(node, ctx) {
    const { tagName } = node;
    const dynamicTag = node.getAttribute("t-tag");
    node.removeAttribute("t-tag");
    if (tagName === "t" && !dynamicTag) {
        return null;
    }
    if (tagName.startsWith("block-")) {
        throw new OwlError(`Invalid tag name: '${tagName}'`);
    }
    ctx = Object.assign({}, ctx);
    if (tagName === "pre") {
        ctx.inPreTag = true;
    }
    let ns = !ctx.nameSpace && ROOT_SVG_TAGS.has(tagName) ? "http://www.w3.org/2000/svg" : null;
    const ref = node.getAttribute("t-ref");
    node.removeAttribute("t-ref");
    const nodeAttrsNames = node.getAttributeNames();
    let attrs = null;
    let attrsTranslationCtx = null;
    let on = null;
    let model = null;
    for (let attr of nodeAttrsNames) {
        const value = node.getAttribute(attr);
        if (attr === "t-on" || attr === "t-on-") {
            throw new OwlError("Missing event name with t-on directive");
        }
        if (attr.startsWith("t-on-")) {
            on = on || {};
            on[attr.slice(5)] = value;
        }
        else if (attr.startsWith("t-model")) {
            if (!["input", "select", "textarea"].includes(tagName)) {
                throw new OwlError("The t-model directive only works with <input>, <textarea> and <select>");
            }
            const typeAttr = node.getAttribute("type");
            const isInput = tagName === "input";
            const isSelect = tagName === "select";
            const isCheckboxInput = isInput && typeAttr === "checkbox";
            const isRadioInput = isInput && typeAttr === "radio";
            const hasTrimMod = attr.includes(".trim");
            const hasLazyMod = hasTrimMod || attr.includes(".lazy");
            const hasNumberMod = attr.includes(".number");
            const eventType = isRadioInput ? "click" : isSelect || hasLazyMod ? "change" : "input";
            model = {
                expr: value,
                targetAttr: isCheckboxInput ? "checked" : "value",
                specialInitTargetAttr: isRadioInput ? "checked" : null,
                eventType,
                hasDynamicChildren: false,
                shouldTrim: hasTrimMod,
                shouldNumberize: hasNumberMod,
            };
            if (isSelect) {
                // don't pollute the original ctx
                ctx = Object.assign({}, ctx);
                ctx.tModelInfo = model;
            }
        }
        else if (attr.startsWith("block-")) {
            throw new OwlError(`Invalid attribute: '${attr}'`);
        }
        else if (attr === "xmlns") {
            ns = value;
        }
        else if (attr.startsWith("t-translation-context-")) {
            const attrName = attr.slice(22);
            attrsTranslationCtx = attrsTranslationCtx || {};
            attrsTranslationCtx[attrName] = value;
        }
        else if (attr !== "t-name") {
            if (attr.startsWith("t-") && !attr.startsWith("t-att")) {
                throw new OwlError(`Unknown QWeb directive: '${attr}'`);
            }
            const tModel = ctx.tModelInfo;
            if (tModel && ["t-att-value", "t-attf-value"].includes(attr)) {
                tModel.hasDynamicChildren = true;
            }
            attrs = attrs || {};
            attrs[attr] = value;
        }
    }
    if (ns) {
        ctx.nameSpace = ns;
    }
    const children = parseChildren(node, ctx);
    return {
        type: 2 /* ASTType.DomNode */,
        tag: tagName,
        dynamicTag,
        attrs,
        attrsTranslationCtx,
        on,
        ref,
        content: children,
        model,
        ns,
    };
}
// -----------------------------------------------------------------------------
// t-out
// -----------------------------------------------------------------------------
function parseTOutNode(node, ctx) {
    if (!node.hasAttribute("t-out") && !node.hasAttribute("t-esc")) {
        return null;
    }
    if (node.hasAttribute("t-esc")) {
        console.warn(`t-esc has been deprecated in favor of t-out. If the value to render is not wrapped by the "markup" function, it will be escaped`);
    }
    const expr = (node.getAttribute("t-out") || node.getAttribute("t-esc"));
    node.removeAttribute("t-out");
    node.removeAttribute("t-esc");
    const tOut = { type: 7 /* ASTType.TOut */, expr, body: null };
    const ref = node.getAttribute("t-ref");
    node.removeAttribute("t-ref");
    const ast = parseNode(node, ctx);
    if (!ast) {
        return tOut;
    }
    if (ast.type === 2 /* ASTType.DomNode */) {
        tOut.body = ast.content.length ? ast.content : null;
        return {
            ...ast,
            ref,
            content: [tOut],
        };
    }
    return tOut;
}
// -----------------------------------------------------------------------------
// t-foreach and t-key
// -----------------------------------------------------------------------------
function parseTForEach(node, ctx) {
    if (!node.hasAttribute("t-foreach")) {
        return null;
    }
    const html = node.outerHTML;
    const collection = node.getAttribute("t-foreach");
    node.removeAttribute("t-foreach");
    const elem = node.getAttribute("t-as") || "";
    node.removeAttribute("t-as");
    const key = node.getAttribute("t-key");
    if (!key) {
        throw new OwlError(`"Directive t-foreach should always be used with a t-key!" (expression: t-foreach="${collection}" t-as="${elem}")`);
    }
    node.removeAttribute("t-key");
    const memo = node.getAttribute("t-memo") || "";
    node.removeAttribute("t-memo");
    const body = parseNode(node, ctx);
    if (!body) {
        return null;
    }
    const hasNoTCall = !html.includes("t-call");
    const hasNoFirst = hasNoTCall && !html.includes(`${elem}_first`);
    const hasNoLast = hasNoTCall && !html.includes(`${elem}_last`);
    const hasNoIndex = hasNoTCall && !html.includes(`${elem}_index`);
    const hasNoValue = hasNoTCall && !html.includes(`${elem}_value`);
    return {
        type: 8 /* ASTType.TForEach */,
        collection,
        elem,
        body,
        memo,
        key,
        hasNoFirst,
        hasNoLast,
        hasNoIndex,
        hasNoValue,
    };
}
function parseTKey(node, ctx) {
    if (!node.hasAttribute("t-key")) {
        return null;
    }
    const key = node.getAttribute("t-key");
    node.removeAttribute("t-key");
    const content = parseNode(node, ctx);
    if (!content) {
        return null;
    }
    const ast = {
        type: 9 /* ASTType.TKey */,
        expr: key,
        content,
    };
    if (content.hasNoRepresentation) {
        ast.hasNoRepresentation = true;
    }
    return ast;
}
// -----------------------------------------------------------------------------
// t-call
// -----------------------------------------------------------------------------
function parseTCall(node, ctx) {
    if (!node.hasAttribute("t-call")) {
        return null;
    }
    const subTemplate = node.getAttribute("t-call");
    const context = node.getAttribute("t-call-context");
    node.removeAttribute("t-call");
    node.removeAttribute("t-call-context");
    if (node.tagName !== "t") {
        const ast = parseNode(node, ctx);
        const tcall = { type: 6 /* ASTType.TCall */, name: subTemplate, body: null, context };
        if (ast && ast.type === 2 /* ASTType.DomNode */) {
            ast.content = [tcall];
            return ast;
        }
        if (ast && ast.type === 10 /* ASTType.TComponent */) {
            return {
                ...ast,
                slots: {
                    default: {
                        content: tcall,
                        scope: null,
                        on: null,
                        attrs: null,
                        attrsTranslationCtx: null,
                    },
                },
            };
        }
    }
    const body = parseChildren(node, ctx);
    return {
        type: 6 /* ASTType.TCall */,
        name: subTemplate,
        body: body.length ? body : null,
        context,
    };
}
// -----------------------------------------------------------------------------
// t-call-block
// -----------------------------------------------------------------------------
function parseTCallBlock(node, ctx) {
    if (!node.hasAttribute("t-call-block")) {
        return null;
    }
    const name = node.getAttribute("t-call-block");
    return {
        type: 14 /* ASTType.TCallBlock */,
        name,
    };
}
// -----------------------------------------------------------------------------
// t-if
// -----------------------------------------------------------------------------
function parseTIf(node, ctx) {
    if (!node.hasAttribute("t-if")) {
        return null;
    }
    const condition = node.getAttribute("t-if");
    node.removeAttribute("t-if");
    const content = parseNode(node, ctx) || { type: 0 /* ASTType.Text */, value: "" };
    let nextElement = node.nextElementSibling;
    // t-elifs
    const tElifs = [];
    while (nextElement && nextElement.hasAttribute("t-elif")) {
        const condition = nextElement.getAttribute("t-elif");
        nextElement.removeAttribute("t-elif");
        const tElif = parseNode(nextElement, ctx);
        const next = nextElement.nextElementSibling;
        nextElement.remove();
        nextElement = next;
        if (tElif) {
            tElifs.push({ condition, content: tElif });
        }
    }
    // t-else
    let tElse = null;
    if (nextElement && nextElement.hasAttribute("t-else")) {
        nextElement.removeAttribute("t-else");
        tElse = parseNode(nextElement, ctx);
        nextElement.remove();
    }
    return {
        type: 4 /* ASTType.TIf */,
        condition,
        content,
        tElif: tElifs.length ? tElifs : null,
        tElse,
    };
}
// -----------------------------------------------------------------------------
// t-set directive
// -----------------------------------------------------------------------------
function parseTSetNode(node, ctx) {
    if (!node.hasAttribute("t-set")) {
        return null;
    }
    const name = node.getAttribute("t-set");
    const value = node.getAttribute("t-value") || null;
    const defaultValue = node.innerHTML === node.textContent ? node.textContent || null : null;
    let body = null;
    if (node.textContent !== node.innerHTML) {
        body = parseChildren(node, ctx);
    }
    return { type: 5 /* ASTType.TSet */, name, value, defaultValue, body, hasNoRepresentation: true };
}
// -----------------------------------------------------------------------------
// Components
// -----------------------------------------------------------------------------
// Error messages when trying to use an unsupported directive on a component
const directiveErrorMap = new Map([
    [
        "t-ref",
        "t-ref is no longer supported on components. Consider exposing only the public part of the component's API through a callback prop.",
    ],
    ["t-att", "t-att makes no sense on component: props are already treated as expressions"],
    [
        "t-attf",
        "t-attf is not supported on components: use template strings for string interpolation in props",
    ],
]);
function parseComponent(node, ctx) {
    let name = node.tagName;
    const firstLetter = name[0];
    let isDynamic = node.hasAttribute("t-component");
    if (isDynamic && name !== "t") {
        throw new OwlError(`Directive 't-component' can only be used on <t> nodes (used on a <${name}>)`);
    }
    if (!(firstLetter === firstLetter.toUpperCase() || isDynamic)) {
        return null;
    }
    if (isDynamic) {
        name = node.getAttribute("t-component");
        node.removeAttribute("t-component");
    }
    const dynamicProps = node.getAttribute("t-props");
    node.removeAttribute("t-props");
    const defaultSlotScope = node.getAttribute("t-slot-scope");
    node.removeAttribute("t-slot-scope");
    let on = null;
    let props = null;
    let propsTranslationCtx = null;
    for (let name of node.getAttributeNames()) {
        const value = node.getAttribute(name);
        if (name.startsWith("t-translation-context-")) {
            const attrName = name.slice(22);
            propsTranslationCtx = propsTranslationCtx || {};
            propsTranslationCtx[attrName] = value;
        }
        else if (name.startsWith("t-")) {
            if (name.startsWith("t-on-")) {
                on = on || {};
                on[name.slice(5)] = value;
            }
            else {
                const message = directiveErrorMap.get(name.split("-").slice(0, 2).join("-"));
                throw new OwlError(message || `unsupported directive on Component: ${name}`);
            }
        }
        else {
            props = props || {};
            props[name] = value;
        }
    }
    let slots = null;
    if (node.hasChildNodes()) {
        const clone = node.cloneNode(true);
        // named slots
        const slotNodes = Array.from(clone.querySelectorAll("[t-set-slot]"));
        for (let slotNode of slotNodes) {
            if (slotNode.tagName !== "t") {
                throw new OwlError(`Directive 't-set-slot' can only be used on <t> nodes (used on a <${slotNode.tagName}>)`);
            }
            const name = slotNode.getAttribute("t-set-slot");
            // check if this is defined in a sub component (in which case it should
            // be ignored)
            let el = slotNode.parentElement;
            let isInSubComponent = false;
            while (el && el !== clone) {
                if (el.hasAttribute("t-component") || el.tagName[0] === el.tagName[0].toUpperCase()) {
                    isInSubComponent = true;
                    break;
                }
                el = el.parentElement;
            }
            if (isInSubComponent || !el) {
                continue;
            }
            slotNode.removeAttribute("t-set-slot");
            slotNode.remove();
            const slotAst = parseNode(slotNode, ctx);
            let on = null;
            let attrs = null;
            let attrsTranslationCtx = null;
            let scope = null;
            for (let attributeName of slotNode.getAttributeNames()) {
                const value = slotNode.getAttribute(attributeName);
                if (attributeName === "t-slot-scope") {
                    scope = value;
                    continue;
                }
                else if (attributeName.startsWith("t-translation-context-")) {
                    const attrName = attributeName.slice(22);
                    attrsTranslationCtx = attrsTranslationCtx || {};
                    attrsTranslationCtx[attrName] = value;
                }
                else if (attributeName.startsWith("t-on-")) {
                    on = on || {};
                    on[attributeName.slice(5)] = value;
                }
                else {
                    attrs = attrs || {};
                    attrs[attributeName] = value;
                }
            }
            slots = slots || {};
            slots[name] = { content: slotAst, on, attrs, attrsTranslationCtx, scope };
        }
        // default slot
        const defaultContent = parseChildNodes(clone, ctx);
        slots = slots || {};
        // t-set-slot="default" has priority over content
        if (defaultContent && !slots.default) {
            slots.default = {
                content: defaultContent,
                on,
                attrs: null,
                attrsTranslationCtx: null,
                scope: defaultSlotScope,
            };
        }
    }
    return {
        type: 10 /* ASTType.TComponent */,
        name,
        isDynamic,
        dynamicProps,
        props,
        propsTranslationCtx,
        slots,
        on,
    };
}
// -----------------------------------------------------------------------------
// Slots
// -----------------------------------------------------------------------------
function parseTCallSlot(node, ctx) {
    if (!node.hasAttribute("t-call-slot") && !node.hasAttribute("t-slot")) {
        return null;
    }
    if (node.hasAttribute("t-slot")) {
        console.warn(`t-slot has been renamed t-call-slot.`);
    }
    const name = (node.getAttribute("t-call-slot") || node.getAttribute("t-slot"));
    node.removeAttribute("t-call-slot");
    node.removeAttribute("t-slot");
    let attrs = null;
    let attrsTranslationCtx = null;
    let on = null;
    for (let attributeName of node.getAttributeNames()) {
        const value = node.getAttribute(attributeName);
        if (attributeName.startsWith("t-on-")) {
            on = on || {};
            on[attributeName.slice(5)] = value;
        }
        else if (attributeName.startsWith("t-translation-context-")) {
            const attrName = attributeName.slice(22);
            attrsTranslationCtx = attrsTranslationCtx || {};
            attrsTranslationCtx[attrName] = value;
        }
        else {
            attrs = attrs || {};
            attrs[attributeName] = value;
        }
    }
    return {
        type: 13 /* ASTType.TCallSlot */,
        name,
        attrs,
        attrsTranslationCtx,
        on,
        defaultContent: parseChildNodes(node, ctx),
    };
}
// -----------------------------------------------------------------------------
// Translation
// -----------------------------------------------------------------------------
function wrapInTTranslationAST(r) {
    const ast = { type: 15 /* ASTType.TTranslation */, content: r };
    if (r === null || r === void 0 ? void 0 : r.hasNoRepresentation) {
        ast.hasNoRepresentation = true;
    }
    return ast;
}
function parseTTranslation(node, ctx) {
    if (node.getAttribute("t-translation") !== "off") {
        return null;
    }
    node.removeAttribute("t-translation");
    const result = parseNode(node, ctx);
    if ((result === null || result === void 0 ? void 0 : result.type) === 3 /* ASTType.Multi */) {
        const children = result.content.map(wrapInTTranslationAST);
        return makeASTMulti(children);
    }
    return wrapInTTranslationAST(result);
}
// -----------------------------------------------------------------------------
// Translation Context
// -----------------------------------------------------------------------------
function wrapInTTranslationContextAST(r, translationCtx) {
    const ast = {
        type: 16 /* ASTType.TTranslationContext */,
        content: r,
        translationCtx,
    };
    if (r === null || r === void 0 ? void 0 : r.hasNoRepresentation) {
        ast.hasNoRepresentation = true;
    }
    return ast;
}
function parseTTranslationContext(node, ctx) {
    const translationCtx = node.getAttribute("t-translation-context");
    if (!translationCtx) {
        return null;
    }
    node.removeAttribute("t-translation-context");
    const result = parseNode(node, ctx);
    if ((result === null || result === void 0 ? void 0 : result.type) === 3 /* ASTType.Multi */) {
        const children = result.content.map((c) => wrapInTTranslationContextAST(c, translationCtx));
        return makeASTMulti(children);
    }
    return wrapInTTranslationContextAST(result, translationCtx);
}
// -----------------------------------------------------------------------------
// Portal
// -----------------------------------------------------------------------------
function parseTPortal(node, ctx) {
    if (!node.hasAttribute("t-portal")) {
        return null;
    }
    const target = node.getAttribute("t-portal");
    node.removeAttribute("t-portal");
    const content = parseNode(node, ctx);
    if (!content) {
        return {
            type: 0 /* ASTType.Text */,
            value: "",
        };
    }
    return {
        type: 17 /* ASTType.TPortal */,
        target,
        content,
    };
}
// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------
/**
 * Parse all the child nodes of a given node and return a list of ast elements
 */
function parseChildren(node, ctx) {
    const children = [];
    for (let child of node.childNodes) {
        const childAst = parseNode(child, ctx);
        if (childAst) {
            if (childAst.type === 3 /* ASTType.Multi */) {
                children.push(...childAst.content);
            }
            else {
                children.push(childAst);
            }
        }
    }
    return children;
}
function makeASTMulti(children) {
    const ast = { type: 3 /* ASTType.Multi */, content: children };
    if (children.every((c) => c.hasNoRepresentation)) {
        ast.hasNoRepresentation = true;
    }
    return ast;
}
/**
 * Parse all the child nodes of a given node and return an ast if possible.
 * In the case there are multiple children, they are wrapped in a astmulti.
 */
function parseChildNodes(node, ctx) {
    const children = parseChildren(node, ctx);
    switch (children.length) {
        case 0:
            return null;
        case 1:
            return children[0];
        default:
            return makeASTMulti(children);
    }
}
/**
 * Normalizes the content of an Element so that t-if/t-elif/t-else directives
 * immediately follow one another (by removing empty text nodes or comments).
 * Throws an error when a conditional branching statement is malformed. This
 * function modifies the Element in place.
 *
 * @param el the element containing the tree that should be normalized
 */
function normalizeTIf(el) {
    let tbranch = el.querySelectorAll("[t-elif], [t-else]");
    for (let i = 0, ilen = tbranch.length; i < ilen; i++) {
        let node = tbranch[i];
        let prevElem = node.previousElementSibling;
        let pattr = (name) => prevElem.getAttribute(name);
        let nattr = (name) => +!!node.getAttribute(name);
        if (prevElem && (pattr("t-if") || pattr("t-elif"))) {
            if (pattr("t-foreach")) {
                throw new OwlError("t-if cannot stay at the same level as t-foreach when using t-elif or t-else");
            }
            if (["t-if", "t-elif", "t-else"].map(nattr).reduce(function (a, b) {
                return a + b;
            }) > 1) {
                throw new OwlError("Only one conditional branching directive is allowed per node");
            }
            // All text (with only spaces) and comment nodes (nodeType 8) between
            // branch nodes are removed
            let textNode;
            while ((textNode = node.previousSibling) !== prevElem) {
                if (textNode.nodeValue.trim().length && textNode.nodeType !== 8) {
                    throw new OwlError("text is not allowed between branching directives");
                }
                textNode.remove();
            }
        }
        else {
            throw new OwlError("t-elif and t-else directives must be preceded by a t-if or t-elif directive");
        }
    }
}
/**
 * Normalizes the content of an Element so that t-out directives on components
 * are removed and instead places a <t t-out=""> as the default slot of the
 * component. Also throws if the component already has content. This function
 * modifies the Element in place.
 *
 * @param el the element containing the tree that should be normalized
 */
function normalizeTOut(el) {
    const elements = [...el.querySelectorAll(`[t-out]`)].filter((el) => el.tagName[0] === el.tagName[0].toUpperCase() || el.hasAttribute("t-component"));
    for (const el of elements) {
        if (el.childNodes.length) {
            throw new OwlError(`Cannot have t-out on a component that already has content`);
        }
        const value = el.getAttribute("t-out");
        el.removeAttribute("t-out");
        const t = el.ownerDocument.createElement("t");
        if (value != null) {
            t.setAttribute("t-out", value);
        }
        el.appendChild(t);
    }
}
/**
 * Normalizes the tree inside a given element and do some preliminary validation
 * on it. This function modifies the Element in place.
 *
 * @param el the element containing the tree that should be normalized
 */
function normalizeXML(el) {
    normalizeTIf(el);
    normalizeTOut(el);
}

function compile(template, options = {
    hasGlobalValues: false,
}) {
    // parsing
    const ast = parse(template, options.customDirectives);
    // some work
    const hasSafeContext = template instanceof Node
        ? !(template instanceof Element) || template.querySelector("[t-set], [t-call]") === null
        : !template.includes("t-set=") && !template.includes("t-call=");
    // code generation
    const codeGenerator = new CodeGenerator(ast, { ...options, hasSafeContext });
    const code = codeGenerator.generateCode();
    // template function
    try {
        return new Function("app, bdom, helpers", code);
    }
    catch (originalError) {
        const { name } = options;
        const nameStr = name ? `template "${name}"` : "anonymous template";
        const err = new OwlError(`Failed to compile ${nameStr}: ${originalError.message}\n\ngenerated code:\nfunction(app, bdom, helpers) {\n${code}\n}`);
        err.cause = originalError;
        throw err;
    }
}

// -----------------------------------------------------------------------------
// This file exports a function that allows compiling templates ahead of time.
// It is used by the "compile_owl_template" command registered in the "bin"
// section of owl's package.json
// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------
async function getXmlFiles(paths) {
    return (await Promise.all(paths.map(async (file) => {
        const stats = await stat(path.join(file));
        if (stats.isDirectory()) {
            return await getXmlFiles((await readdir(file)).map((fileName) => path.join(file, fileName)));
        }
        if (file.endsWith(".xml")) {
            return file;
        }
        return [];
    }))).flat();
}
// adapted from https://medium.com/@mhagemann/the-ultimate-way-to-slugify-a-url-string-in-javascript-b8e4a0d849e1
const a = "·-_,:;";
const p = new RegExp(a.split("").join("|"), "g");
function slugify(str) {
    return str
        .replace(/\//g, "") // remove /
        .replace(/\./g, "_") // Replace . with _
        .replace(p, (c) => "_") // Replace special characters
        .replace(/&/g, "_and_") // Replace & with ‘and’
        .replace(/[^\w\-]+/g, ""); // Remove all non-word characters
}
// -----------------------------------------------------------------------------
// main
// -----------------------------------------------------------------------------
async function compileTemplates(paths) {
    const files = await getXmlFiles(paths);
    process.stdout.write(`Processing ${files.length} files`);
    let xmlStrings = await Promise.all(files.map((file) => readFile(file, "utf8")));
    const templates = [];
    const errors = [];
    for (let i = 0; i < files.length; i++) {
        const fileName = files[i];
        const fileContent = xmlStrings[i];
        process.stdout.write(`.`);
        const parser = new DOMParser();
        const doc = parser.parseFromString(fileContent, "text/xml");
        for (const template of doc.querySelectorAll("[t-name]")) {
            const name = template.getAttribute("t-name");
            if (template.hasAttribute("owl")) {
                template.removeAttribute("owl");
            }
            const fnName = slugify(name);
            try {
                const fn = compile(template).toString().replace("anonymous", fnName);
                templates.push(`"${name}": ${fn},\n`);
            }
            catch (e) {
                errors.push({ name, fileName, e });
            }
        }
    }
    process.stdout.write(`\n`);
    for (let { name, fileName, e } of errors) {
        console.warn(`Error while compiling '${name}' (in file ${fileName})`);
        console.error(e);
    }
    console.log(`${templates.length} templates compiled`);
    return `export const templates = {\n ${templates.join("\n")} \n}`;
}

export { compileTemplates };
