import { CustomDirectives } from ".";
export type EventHandlers = {
    [eventName: string]: string;
};
export type Attrs = {
    [attrs: string]: string;
};
export declare const enum ASTType {
    Text = 0,
    Comment = 1,
    DomNode = 2,
    Multi = 3,
    TIf = 4,
    TSet = 5,
    TCall = 6,
    TOut = 7,
    TForEach = 8,
    TKey = 9,
    TComponent = 10,
    TDebug = 11,
    TLog = 12,
    TCallSlot = 13,
    TCallBlock = 14,
    TTranslation = 15,
    TTranslationContext = 16,
    TPortal = 17
}
export interface BaseAST {
    type: ASTType;
    hasNoRepresentation?: true;
}
export interface ASTText extends BaseAST {
    type: ASTType.Text;
    value: string;
}
export interface ASTComment extends BaseAST {
    type: ASTType.Comment;
    value: string;
}
interface TModelInfo {
    expr: string;
    targetAttr: string;
    eventType: "change" | "click" | "input";
    shouldTrim: boolean;
    shouldNumberize: boolean;
    hasDynamicChildren: boolean;
    specialInitTargetAttr: string | null;
}
export interface ASTDomNode extends BaseAST {
    type: ASTType.DomNode;
    tag: string;
    content: AST[];
    attrs: Attrs | null;
    attrsTranslationCtx: Attrs | null;
    ref: string | null;
    on: EventHandlers | null;
    model: TModelInfo | null;
    dynamicTag: string | null;
    ns: string | null;
}
export interface ASTMulti extends BaseAST {
    type: ASTType.Multi;
    content: AST[];
}
export interface ASTTOut extends BaseAST {
    type: ASTType.TOut;
    expr: string;
    body: AST[] | null;
}
export interface ASTTif extends BaseAST {
    type: ASTType.TIf;
    condition: string;
    content: AST;
    tElif: {
        condition: string;
        content: AST;
    }[] | null;
    tElse: AST | null;
}
export interface ASTTSet extends BaseAST {
    type: ASTType.TSet;
    name: string;
    value: string | null;
    defaultValue: string | null;
    body: AST[] | null;
    hasNoRepresentation: true;
}
export interface ASTTForEach extends BaseAST {
    type: ASTType.TForEach;
    collection: string;
    elem: string;
    body: AST;
    memo: string;
    hasNoFirst: boolean;
    hasNoLast: boolean;
    hasNoIndex: boolean;
    hasNoValue: boolean;
    key: string | null;
}
export interface ASTTKey extends BaseAST {
    type: ASTType.TKey;
    expr: string;
    content: AST;
}
export interface ASTTCall extends BaseAST {
    type: ASTType.TCall;
    name: string;
    body: AST[] | null;
    context: string | null;
}
interface SlotDefinition {
    content: AST | null;
    scope: string | null;
    on: EventHandlers | null;
    attrs: Attrs | null;
    attrsTranslationCtx: Attrs | null;
}
export interface ASTComponent extends BaseAST {
    type: ASTType.TComponent;
    name: string;
    isDynamic: boolean;
    dynamicProps: string | null;
    on: EventHandlers | null;
    props: {
        [name: string]: string;
    } | null;
    propsTranslationCtx: {
        [name: string]: string;
    } | null;
    slots: {
        [name: string]: SlotDefinition;
    } | null;
}
export interface ASTTCallSlot extends BaseAST {
    type: ASTType.TCallSlot;
    name: string;
    attrs: Attrs | null;
    attrsTranslationCtx: Attrs | null;
    on: EventHandlers | null;
    defaultContent: AST | null;
}
export interface ASTTCallBlock extends BaseAST {
    type: ASTType.TCallBlock;
    name: string;
}
export interface ASTDebug extends BaseAST {
    type: ASTType.TDebug;
    content: AST | null;
}
export interface ASTLog extends BaseAST {
    type: ASTType.TLog;
    expr: string;
    content: AST | null;
}
export interface ASTTranslation extends BaseAST {
    type: ASTType.TTranslation;
    content: AST | null;
}
export interface ASTTranslationContext extends BaseAST {
    type: ASTType.TTranslationContext;
    content: AST | null;
    translationCtx: string;
}
export interface ASTTPortal extends BaseAST {
    type: ASTType.TPortal;
    target: string;
    content: AST;
}
export type AST = ASTText | ASTComment | ASTDomNode | ASTMulti | ASTTif | ASTTSet | ASTTCall | ASTTOut | ASTTForEach | ASTTKey | ASTComponent | ASTTCallSlot | ASTTCallBlock | ASTLog | ASTDebug | ASTTranslation | ASTTranslationContext | ASTTPortal;
export declare function parse(xml: string | Element, customDir?: CustomDirectives): AST;
export {};
