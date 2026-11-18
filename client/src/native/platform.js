/**
 * When NavNet runs as the installed Android app (Capacitor), a few things work better than in
 * a browser: GPS keeps running with the screen locked, and the next turn shows on the lock
 * screen. Everything here is a no-op in the browser.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

export const isNativeApp = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // "web" | "android" | "ios"

/** @capacitor-community/background-geolocation (Android foreground service). */
export const BackgroundGeolocation = registerPlugin("BackgroundGeolocation");
