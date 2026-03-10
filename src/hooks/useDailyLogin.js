// ═══════════════════════════════════════════════════════════════
// useDailyLogin
//
// Owns the daily login flow: streak math, login XP, modal trigger,
// and shield consumption logic.
//
// Extracted from App.jsx to make the streak rules readable and
// testable in isolation. The math is unchanged from the original —
// only the location changed.
// ═══════════════════════════════════════════════════════════════

import { useEffect, useRef } from "react";
import { todayUTC, getMaxDateSeen, updateMaxDateSeen } from "../utils/storage";
import { getLevel, getRank, getXpPerLevel } from "../utils/xp";
import { getGeminiApiKey } from "../utils/storage";
import { updateDynamicCosts } from "../api/dynamicCosts";

export function useDailyLogin({ profile, setState, setModal, setLevelUpData, showBanner, trackTokens, lastLevelUpXpRef }) {
  const loginInProgressRef = useRef(false);

  useEffect(() => {
    if (!profile) return;
    if (loginInProgressRef.current) return;
    loginInProgressRef.current = true;
    let cancelled = false;

    const getUTCYesterday = (utcDateStr) => {
      const [y, m, d] = utcDateStr.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      dt.setUTCDate(dt.getUTCDate() - 1);
      const yyyy = dt.getUTCFullYear();
      const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(dt.getUTCDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    };

    const parseDateLocal = (utcDateStr) => {
      const [y, m, d] = utcDateStr.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, d));
    };

    const effectiveDate = todayUTC();
    const maxDateSeen = getMaxDateSeen();
    if (maxDateSeen && effectiveDate < maxDateSeen) {
      setState((s) => ({ ...s, lastLoginDate: effectiveDate, streak: 0 }));
      loginInProgressRef.current = false;
      return;
    }
    updateMaxDateSeen(effectiveDate);

    setState((s) => {
      // Reject future-dated lastLoginDate from a crafted sync file
      if (s.lastLoginDate && s.lastLoginDate > effectiveDate) {
        return { ...s, lastLoginDate: effectiveDate, streak: 0 };
      }

      // Compute yesterday string
      const yesterday = getUTCYesterday(effectiveDate);

      let newStreak  = s.streak;
      let newShields = s.streakShields;
      let bannerMsg  = null;

      if (s.lastLoginDate === yesterday) {
        newStreak = s.streak + 1;
      } else if (s.lastLoginDate === effectiveDate) {
        // Already logged in today — no change
      } else {
        const daysSinceLast = (() => {
          if (!s.lastLoginDate) return Infinity;
          const last = parseDateLocal(s.lastLoginDate);
          const now  = parseDateLocal(effectiveDate);
          return Math.round((now - last) / 86400000);
        })();
        const missedExactlyOneDay = daysSinceLast === 2;
        const shieldUsedYesterday = s.lastShieldUseDate === yesterday;
        const canUseShield = missedExactlyOneDay && s.streakShields > 0 && !shieldUsedYesterday;

        if (canUseShield) {
          newShields = s.streakShields - 1;
          bannerMsg  = "Streak shield consumed. One missed day covered. Streak preserved.";
        } else {
          newStreak = 0;
          if (!missedExactlyOneDay && daysSinceLast !== 1) {
            bannerMsg = s.streakShields > 0 ? "Gap too large for a shield. Streak reset." : "Streak reset. Start again.";
          } else if (shieldUsedYesterday) {
            bannerMsg = "Shield already used yesterday. Streak reset.";
          }
        }
      }

      // [A-2] Cap loginXP — a crafted streak of 3650 would award 36 550 XP
      const loginXP  = Math.min(50 + newStreak * 10, 5000);
      const newXP    = s.xp + loginXP;
      const xpPl     = getXpPerLevel(s);
      const oldLevel = getLevel(s.xp, xpPl);
      const newLevel = getLevel(newXP, xpPl);
      const usedShield = newShields < s.streakShields;
      const newLastShieldUseDate = usedShield ? effectiveDate : s.lastShieldUseDate;

      if (newLevel > oldLevel) {
        lastLevelUpXpRef.current = newXP;
        const snapshot = { ...s, xp: newXP, streak: newStreak, streakShields: newShields, lastLoginDate: effectiveDate, lastShieldUseDate: newLastShieldUseDate };
        setTimeout(() => {
          if (cancelled) return;
          setLevelUpData({ level: newLevel, rank: getRank(newLevel) });
          updateDynamicCosts(getGeminiApiKey(), snapshot, "level_up", trackTokens)
            .then((costs) => {
              if (costs && Object.keys(costs).length) {
                setState((prev) => ({ ...prev, dynamicCosts: { ...prev.dynamicCosts, ...costs } }));
              }
            }).catch(() => {});
        }, 300);
      }

      if (bannerMsg) setTimeout(() => showBanner(bannerMsg, "info"), 0);
      if (usedShield) {
        setTimeout(() => {
          if (cancelled) return;
          updateDynamicCosts(getGeminiApiKey(), { ...s, streakShields: newShields, lastShieldUseDate: effectiveDate }, "streak_shield_use", trackTokens)
            .then((costs) => {
              if (costs && Object.keys(costs).length) {
                setState((prev) => ({ ...prev, dynamicCosts: { ...prev.dynamicCosts, ...costs } }));
              }
            }).catch(() => {});
        }, 0);
      }

      setTimeout(() => {
        if (cancelled) return;
        setModal({ type: "daily_login", xp: loginXP, streak: newStreak });
      }, 0);

      return {
        ...s,
        streak:             newStreak,
        streakShields:      newShields,
        lastLoginDate:      effectiveDate,
        lastShieldUseDate:  newLastShieldUseDate,
        xp:                 newXP,
      };
    });
    const resetTimer = setTimeout(() => {
      loginInProgressRef.current = false;
    }, 2000);

    return () => {
      cancelled = true;
      clearTimeout(resetTimer);
      loginInProgressRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!profile]);
}
