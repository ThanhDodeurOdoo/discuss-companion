export const BROWSER_TARGET =
    typeof __BROWSER_TARGET__ === "string" ? __BROWSER_TARGET__ : "chrome";

export const IS_FIREFOX_BUILD = BROWSER_TARGET === "firefox";
