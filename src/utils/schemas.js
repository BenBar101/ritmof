import { z } from 'zod'
import { todayUTC } from './db'

// ── Primitives ─────────────────────────────────────────────────
const dateStr       = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const pastDateStr   = dateStr.refine(v => v <= todayUTC(), { message: 'Date is in the future' })
const nullOrDate    = z.union([z.null(), pastDateStr])

// Grapheme-cluster-aware icon: allow up to 2 visible characters.
// Intl.Segmenter is available in all modern browsers (Chrome 87+, Firefox 116+, Safari 16.4+).
const iconStr = z.string().refine(
  (s) => {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return [...new Intl.Segmenter().segment(s)].length <= 2
    }
    return s.length <= 4 // fallback: allow 4 UTF-16 units (~2 emoji)
  },
  { message: 'Icon must be at most 2 visible characters' }
).optional()

// ── Schemas ────────────────────────────────────────────────────
export const ProfileSchema = z.object({
  name:         z.string().max(60).optional(),
  major:        z.string().max(80).optional(),
  interests:    z.string().max(200).optional(),
  books:        z.string().max(200).optional(),
  semesterGoal: z.string().max(300).optional(),
  // geminiKey must never appear in sync payload
  geminiKey:    z.undefined({ message: 'geminiKey must not be in sync payload' }),
  googleClientId: z.undefined({ message: 'googleClientId must not be in sync payload' }),
}).strip().nullable()

// Relax ProfileSchema for partial profile objects (geminiKey may simply be absent)
export const SafeProfileSchema = ProfileSchema.omit({ geminiKey: true, googleClientId: true })

export const HabitSchema = z.object({
  id:       z.string().max(64).regex(/^[\w-]+$/),
  label:    z.string().max(200),
  xp:       z.number().int().min(1).max(200),
  category: z.enum(['body', 'mind', 'work']),
  icon:     iconStr,
  style:    z.enum(['ascii', 'dots', 'geometric', 'typewriter']).optional(),
  addedBy:  z.string().optional(),
})

export const TaskSchema = z.object({
  id:       z.string().max(64).regex(/^[\w-]+$/),
  text:     z.string().max(500),
  done:     z.boolean(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  due:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  doneDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  addedBy:  z.string().optional(),
})

export const GoalSchema = z.object({
  id:      z.string().max(64).regex(/^[\w-]+$/),
  title:   z.string().max(200),
  done:    z.boolean(),
  course:  z.string().max(100).optional(),
  due:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  addedBy: z.enum(['user', 'ritmol', 'system']).optional(),
  tasks:   z.array(z.unknown()).optional(),
})

export const SessionSchema = z.object({
  id:       z.string().max(64).regex(/^[\w-]+$/),
  date:     dateStr.refine(v => v <= todayUTC() && v >= '2020-01-01').optional(),
  course:   z.string().max(100).optional(),
  notes:    z.string().max(300).optional(),
  duration: z.number().min(0).max(600).optional(),
  type:     z.enum(['lecture', 'self_study', 'project', 'exam_prep']).optional(),
  focus:    z.enum(['low', 'medium', 'high']).optional(),
  xp:       z.number().min(0).max(10000).optional(),
})

export const AchievementSchema = z.object({
  id:         z.string().max(100).regex(/^[\w\-.:@]+$/),
  title:      z.string().max(300),
  desc:       z.string().max(300).optional(),
  flavorText: z.string().max(300).optional(),
  icon:       iconStr,
  xp:         z.number().min(0).max(500).optional(),
  unlockedAt: z.number().positive().max(Date.now() + 300_000).optional(),
  rarity:     z.enum(['common', 'rare', 'epic', 'legendary']).optional(),
})

export const GachaCardSchema = z.object({
  id:       z.string().max(80).regex(/^[\w-]+$/),
  type:     z.enum(['rank_cosmetic', 'chronicle']),
  rarity:   z.enum(['common', 'rare', 'epic', 'legendary']),
  content:  z.string().max(1000),
  asciiArt: z.string().max(500).nullable().optional(),
})

export const CalEventSchema = z.object({
  id:    z.string().max(150).regex(/^[\w@._\-:+=]+$/),
  title: z.string().max(200),
  start: z.string().nullable(),
  type:  z.enum(['lecture', 'tirgul', 'exam', 'assignment', 'other']).optional(),
  end:   z.string().nullable().optional(),
})

export const ChatMessageSchema = z.object({
  role:    z.enum(['user', 'assistant']),
  content: z.string().max(4000),
  ts:      z.number().positive().optional(),
  date:    dateStr.optional(),
  seq:     z.number().optional(),
})

const LogEntryValue = z.union([
  z.null(),
  z.boolean(),
  z.number(),
  z.string().max(4096),
  z.array(z.string().max(64)).max(200),
  z.record(z.unknown()),
])
export const LogObjSchema = z.record(
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  LogEntryValue
).refine(v => Object.keys(v).length <= 800, { message: 'Too many log entries' })
 .refine(v => !Object.keys(v).some(k => k > todayUTC()), { message: 'Future log dates not allowed' })

export const MissionSchema = z.object({
  id:     z.string().max(40),
  desc:   z.string().max(200),
  xp:     z.number().min(0).max(2000),
  done:   z.boolean(),
  type:   z.enum(['habits', 'session', 'task', 'chat']),
  target: z.number().min(0).max(100),
})

export const TimerSchema = z.object({
  id:     z.string().max(64),
  label:  z.string().max(100),
  endsAt: z.number().refine(
    v => { const now = Date.now(); return v > now - 3_600_000 && v <= now + 86_400_000 },
    { message: 'Timer endsAt out of valid range' }
  ),
  emoji: iconStr,
})

export const TokenUsageSchema = z.object({
  date:       pastDateStr,
  tokens:     z.number().min(0).max(10_000_000).optional(),
  aiXpToday:  z.number().min(0).max(1_000_000).optional(),
  warnedAt:   z.array(z.number().min(0).max(99)).max(20).optional(),
})

export const DynamicCostsSchema = z.object({
  xpPerLevel:        z.number().min(200).max(10000).optional(),
  gachaCost:         z.number().min(50).max(5000).optional(),
  streakShieldCost:  z.number().min(100).max(5000).optional(),
}).nullable()

// ── Master sync payload schema ─────────────────────────────────
export const SyncPayloadSchema = z.object({
  _schemaVersion: z.number().int().min(1).max(1),
  jv_profile:             SafeProfileSchema.optional(),
  jv_xp:                  z.number().min(0).max(100_000_000).optional(),
  jv_streak:              z.number().min(0).max(1095).optional(),
  jv_shields:             z.number().min(0).max(10000).optional(),
  jv_last_login:          nullOrDate.optional(),
  jv_habits:              z.array(HabitSchema).max(500).optional(),
  jv_habit_log:           LogObjSchema.optional(),
  jv_tasks:               z.array(TaskSchema).max(5000).optional(),
  jv_goals:               z.array(GoalSchema).max(1000).optional(),
  jv_sessions:            z.array(SessionSchema).max(10000).optional(),
  jv_achievements:        z.array(AchievementSchema).max(2000).optional(),
  jv_gacha:               z.array(GachaCardSchema).max(2000).optional(),
  jv_cal_events:          z.array(CalEventSchema).max(2000).optional(),
  jv_chat:                z.array(ChatMessageSchema).max(5000).optional(),
  jv_daily_goal:          z.string().max(500).nullable().optional(),
  jv_timers:              z.array(TimerSchema).max(50).optional(),
  jv_sleep_log:           LogObjSchema.optional(),
  jv_screen_log:          LogObjSchema.optional(),
  jv_missions:            z.array(MissionSchema).max(20).nullable().optional(),
  jv_mission_date:        nullOrDate.optional(),
  jv_habit_suggestions:   z.array(z.string().max(200)).max(200).optional(),
  jv_chronicles:          z.array(z.object({
    id:      z.string().max(80),
    content: z.string().max(2000).optional(),
    date:    dateStr.optional(),
    title:   z.string().max(120).optional(),
    source:  z.string().max(120).optional(),
    xp:      z.number().min(0).max(500).optional(),
  })).max(500).optional(),
  jv_gcal_connected:        z.boolean().optional(),
  jv_token_usage:           TokenUsageSchema.optional(),
  jv_habits_init:           z.boolean().optional(),
  jv_dynamic_costs:         DynamicCostsSchema.optional(),
  jv_last_shield_use_date:  nullOrDate.optional(),
  jv_last_shield_buy_date:  nullOrDate.optional(),
  // geminiKey is allowed in the payload for reading (extracted to sessionStorage)
  // but is never written back out on push
  geminiKey:                z.string().optional(),
})

