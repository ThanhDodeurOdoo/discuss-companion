export interface ValidationIssue {
    message: string;
    path?: PropertyKey[];
    received?: any;
    [K: string]: any;
}
export interface ValidationContext {
    addIssue(issue: ValidationIssue): void;
    isValid: boolean;
    issueDepth: number;
    mergeIssues(issues: ValidationIssue[]): void;
    path: PropertyKey[];
    validate(type: any): void;
    value: any;
    withIssues(issues: ValidationIssue[]): ValidationContext;
    withKey(key: PropertyKey): ValidationContext;
}
export declare function assertType(value: any, validation: any, errorMessage?: string): void;
export declare function validateType(value: any, validation: any): ValidationIssue[];
