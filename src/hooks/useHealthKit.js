import { useEffect, useRef, useCallback } from "react";
import { App as CapApp } from "@capacitor/app";
import { RitmolHealth } from "../plugins/RitmolHealth.js";
import { localDateFromUTC } from "../utils/db";

function localYesterdayStr() {
  const t = localDateFromUTC();
  const [y, m, d] = t.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function useHealthKit({ latestStateRef, setState, showBanner }) {
  const pulledTodayRef = useRef(null);

  const pullSleepData = useCallback(async () => {
    const yesterday = localYesterdayStr();
    if (pulledTodayRef.current === yesterday) return;
    const st = latestStateRef?.current;
    if (st?.sleepLog?.[yesterday] != null) return;

    try {
      const result = await RitmolHealth.getSleepData({ date: yesterday });
      if (result.durationMinutes == null) return;
      pulledTodayRef.current = yesterday;
      const hours = Math.round((result.durationMinutes / 60) * 10) / 10;
      setState((s) => ({
        ...s,
        sleepLog: {
          ...(s.sleepLog || {}),
          [yesterday]: {
            hours,
            quality: result.quality ?? "fair",
            rested: result.quality === "good" || result.quality === "excellent",
            source: "healthkit",
          },
        },
      }));
      showBanner("Sleep data synced from Health.", "success");
    } catch {
      /* native unavailable — manual modal remains */
    }
  }, [latestStateRef, setState, showBanner]);

  useEffect(() => {
    void pullSleepData();
  }, [pullSleepData]);

  useEffect(() => {
    let h;
    (async () => {
      h = await CapApp.addListener("appStateChange", ({ isActive }) => {
        if (isActive) void pullSleepData();
      });
    })();
    return () => {
      try {
        h?.remove?.();
      } catch { /* ignore */ }
    };
  }, [pullSleepData]);
}
