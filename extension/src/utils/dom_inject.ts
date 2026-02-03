export type ScriptInjectionOptions = {
    type?: "module" | "text/javascript";
    crossOrigin?: "anonymous" | "use-credentials";
    async?: boolean;
};

export function injectScriptOnce(
    src: string,
    id: string,
    options: ScriptInjectionOptions = {}
): Promise<void> {
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    if (existing) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const { type = "module", crossOrigin = "anonymous", async = false } = options;
        const script = document.createElement("script");
        script.id = id;
        script.src = src;
        script.type = type;
        script.crossOrigin = crossOrigin;
        script.async = async;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        (document.head || document.documentElement).appendChild(script);
    });
}
