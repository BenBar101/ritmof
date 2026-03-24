import { registerPlugin } from "@capacitor/core";

/** @typedef {{ durationMinutes: number | null, quality: "poor" | "fair" | "good" | "excellent" | null }} SleepResult */

export const RitmolHealth = registerPlugin("RitmolHealth", {
  web: () => ({
    getSleepData: async () => ({ durationMinutes: null, quality: null }),
    checkPermission: async () => ({ granted: false }),
    requestPermission: async () => ({ granted: false }),
  }),
});
