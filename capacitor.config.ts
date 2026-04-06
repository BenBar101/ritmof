import type { CapacitorConfig } from "@capacitor/cli";
import { APP_BUNDLE_ID } from "./src/config.js";

const config: CapacitorConfig = {
  appId: APP_BUNDLE_ID,
  appName: "RITMOL",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  plugins: {
    LocalNotifications: {
      smallIcon: "ic_stat_ritmol",
      iconColor: "#FFFFFF",
    },
    Browser: {
      presentationStyle: "popover",
    },
    SocialLogin: {
      providers: {
        google: true,
        facebook: false,
        apple: false,
        twitter: false,
      },
    },
  },
};

export default config;
