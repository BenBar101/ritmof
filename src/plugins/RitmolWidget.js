import { registerPlugin } from "@capacitor/core";

export const RitmolWidget = registerPlugin("RitmolWidget", {
  web: () => ({
    updateWidgetData: async () => {},
  }),
});
