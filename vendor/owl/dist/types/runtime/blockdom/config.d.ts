export declare function filterOutModifiersFromData(dataList: any[]): {
    modifiers: string[];
    data: any[];
};
export declare const config: {
    shouldNormalizeDom: boolean;
    mainEventHandler: (data: any, ev: Event, currentTarget?: EventTarget | null) => boolean;
};
