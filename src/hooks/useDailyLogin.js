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

    setState((s) => {
      const effectiveDate = todayUTC();

      const parseDateLocal = (ds) => {
        if (!ds) return new Date(NaN);
        const [y, m, d] = ds.split("-").map(Number);
        return new Date(y, m - 1, d);
      };

      // Anti-rollback: reject dates that are earlier than the max seen
      const maxDateSeen = getMaxDateSeen();
      if (maxDateSeen && effectiveDate < maxDateSeen) {
        return { ...s, lastLoginDate: effectiveDate, streak: 0 };
      }
      updateMaxDateSeen(effectiveDate);

      // Reject future-dated lastLoginDate from a crafted sync file
      if (s.lastLoginDate && s.lastLoginDate > effectiveDate) {
        return { ...s, lastLoginDate: effectiveDate, streak: 0 };
      }

      // Compute yesterday string
      const d = parseDateLocal(effectiveDate);
      d.setDate(d.getDate() - 1);
      const yesterday = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

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

      // [A-2] Cap loginXP — a crafted streak of 36500 would award 365 050 XP
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
          updateDynamicCosts(getGeminiApiKey(), { ...s, streakShields: newShields, lastShieldUseDate: effectiveDate }, "streak_shield_use", trackTokens)
            .then((costs) => {
              if (costs && Object.keys(costs).length) {
                setState((prev) => ({ ...prev, dynamicCosts: { ...prev.dynamicCosts, ...costs } }));
              }
            }).catch(() => {});
        }, 0);
      }

      setTimeout(() => setModal({ type: "daily_login", xp: loginXP, streak: newStreak }), 0);

      return {
        ...s,
        streak:             newStreak,
        streakShields:      newShields,
        lastLoginDate:      effectiveDate,
        lastShieldUseDate:  newLastShieldUseDate,
        xp:                 newXP,
      };
    });

    queueMicrotask(() => { loginInProgressRef.current = false; });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!profile]);
}
