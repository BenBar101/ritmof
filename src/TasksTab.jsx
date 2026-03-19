import { useAppContext } from "./context/AppContext";
import { useState } from "react";
import { localDateFromUTC } from "./utils/db";
import { primaryBtn } from "./Onboarding";
import { sanitizeForPrompt } from "./api/systemPrompt";

export default function TasksTab() {
  const { state, setState, awardXP, showBanner, checkMissions, actionLocksRef } = useAppContext();

  // ── Add-task form state ──────────────────────────────────────
  const [newTask, setNewTask]         = useState("");
  const [newPriority, setNewPriority] = useState("medium");
  const [newDue, setNewDue]           = useState("");
  const [newGoalId, setNewGoalId]     = useState("");

  // ── Goals tab state ─────────────────────────────────────────
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [goalForm, setGoalForm]         = useState({ title: "", course: "", due: "" });
  const [activeSection, setActiveSection] = useState("tasks");

  // ── Derived lists ────────────────────────────────────────────
  const allTasks    = state.tasks  || [];
  const allGoals    = state.goals  || [];
  const activeGoals = allGoals.filter((g) => !g.done);
  const activeTasks = allTasks.filter((t) => !t.done);

  // Timed = has a due date, sorted closest first
  const timedTasks = activeTasks
    .filter((t) => t.due)
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));

  // Untimed = no due date
  const untimedTasks = activeTasks.filter((t) => !t.due);
  const doneTasks    = allTasks.filter((t) => t.done);

  // ── Helpers ──────────────────────────────────────────────────
  function sanitizeText(str, maxLen = 300) {
    return sanitizeForPrompt(str ?? "", maxLen);
  }

  function goalTitle(goalId) {
    const g = allGoals.find((g) => g.id === goalId);
    return g ? g.title : null;
  }

  function dueBadge(due) {
    if (!due) return null;
    const daysLeft = Math.ceil((new Date(due) - Date.now()) / 86400000);
    if (daysLeft < 0)   return { label: "OVERDUE",      urgent: true  };
    if (daysLeft === 0) return { label: "DUE TODAY",    urgent: true  };
    if (daysLeft === 1) return { label: "DUE TOMORROW", urgent: false };
    return { label: daysLeft + "d left", urgent: false };
  }

  // ── Task actions ─────────────────────────────────────────────
  function addTask() {
    if (!newTask.trim()) return;
    const safeText = sanitizeText(newTask, 500);
    if (!safeText) return;
    const total = allTasks.length;
    if (total >= 480 && total < 500) showBanner("Approaching task capacity (500). Consider clearing completed tasks.", "warning");
    if (total >= 500) { showBanner("Task limit reached (500). Clear completed tasks first.", "alert"); return; }

    const safeDue    = typeof newDue === "string" && /^\d{4}-\d{2}-\d{2}$/.test(newDue) ? newDue : null;
    const safeGoalId = newGoalId && allGoals.some((g) => g.id === newGoalId) ? newGoalId : null;

    setState((s) => ({
      ...s,
      tasks: [
        ...(s.tasks || []),
        { id: "t_" + crypto.randomUUID(), text: safeText, priority: newPriority, done: false, addedBy: "user", due: safeDue, goalId: safeGoalId },
      ],
    }));
    setNewTask("");
    setNewDue("");
    setNewGoalId("");
  }

  function completeTask(id, event) {
    if (actionLocksRef.current.has(id)) return;
    actionLocksRef.current.add(id);
    setTimeout(() => actionLocksRef.current.delete(id), 500);
    const alreadyDone = allTasks.find((t) => t.id === id)?.done ?? true;
    if (alreadyDone) return;
    setState((s) => {
      const doneDate = localDateFromUTC();
      return { ...s, tasks: s.tasks.map((t) => (t.id === id ? { ...t, done: true, doneDate } : t)) };
    });
    queueMicrotask(() => {
      awardXP(25, event);
      checkMissions("task");
      showBanner("Task complete. +25 XP", "success");
    });
  }

  function deleteTask(id) {
    setState((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== id) }));
  }

  // ── Goal actions ─────────────────────────────────────────────
  function addGoal() {
    if (!goalForm.title) return;
    const safeTitle  = sanitizeText(goalForm.title, 200);
    const safeCourse = sanitizeText(goalForm.course, 100);
    const safeDue    = typeof goalForm.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(goalForm.due) ? goalForm.due : "";
    if (!safeTitle) return;
    setState((s) => ({
      ...s,
      goals: [
        ...(s.goals || []),
        { id: "g_" + crypto.randomUUID(), title: safeTitle, course: safeCourse, due: safeDue, done: false, addedBy: "user", submissionCount: 0 },
      ],
    }));
    setGoalForm({ title: "", course: "", due: "" });
    setShowGoalForm(false);
    showBanner("Goal logged: " + safeTitle, "success");
  }

  function submitGoal(id) {
    if (actionLocksRef.current.has(id)) return;
    actionLocksRef.current.add(id);
    setTimeout(() => actionLocksRef.current.delete(id), 500);
    const currentGoal = allGoals.find((g) => g.id === id);
    const isFirstSubmission = currentGoal ? (currentGoal.submissionCount || 0) === 0 : false;
    setState((s) => {
      const doneDate = localDateFromUTC();
      return {
        ...s,
        goals: s.goals.map((g) => {
          if (g.id !== id) return g;
          return { ...g, submissionCount: (g.submissionCount || 0) + 1, done: true, doneDate };
        }),
      };
    });
    queueMicrotask(() => {
      if (isFirstSubmission) { awardXP(50, null, true); showBanner("Goal submitted. +50 XP", "success"); }
      else showBanner("Goal re-submitted. XP already awarded.", "info");
    });
  }

  // ── Shared styles ────────────────────────────────────────────
  const mono = "'Share Tech Mono', monospace";
  const inputStyle = { background: "#000", border: "2px solid #fff", color: "#fff", padding: "12px", fontFamily: mono, fontSize: "16px", outline: "none" };
  const priorityLabel = { low: "▁", medium: "▃", high: "█" };

  function SubHeader({ children, count }) {
    return (
      <div className="system-header" style={{ fontSize: "13px", marginBottom: "8px" }}>
        <span>{children}</span>
        {count !== undefined && (
          <span style={{ fontSize: "11px", fontWeight: "normal", letterSpacing: "1px" }}>
            [{count}]
          </span>
        )}
        <div className="system-divider" />
      </div>
    );
  }

  function TaskCard({ task }) {
    const badge  = dueBadge(task.due);
    const linked = task.goalId ? goalTitle(task.goalId) : null;
    return (
      <div className="system-frame" style={{ padding: "14px 16px", marginBottom: "6px", display: "flex", alignItems: "center", gap: "12px" }}>
        <button type="button" onClick={(e) => completeTask(task.id, e)} data-testid="complete-task"
          style={{ color: "#fff", fontSize: "20px", background: "none", border: "2px solid #fff", width: "48px", height: "48px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          ○
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "17px", color: "#fff", lineHeight: "1.5" }}>{task.text}</div>
          <div style={{ fontSize: "13px", color: "#fff", marginTop: "4px", display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
            <span>{priorityLabel[task.priority]} {task.priority?.toUpperCase()}</span>
            {badge && (
              <span className="status-badge" data-urgent={badge.urgent ? "true" : undefined}>
                {badge.label}
              </span>
            )}
            {linked && (
              <span style={{ border: "1px solid #fff", padding: "1px 6px", fontSize: "11px", letterSpacing: "1px", maxWidth: "180px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                ⬡ {linked}
              </span>
            )}
            {task.addedBy === "ritmol" && <span style={{ fontSize: "11px", opacity: 0.6 }}>· RITMOL</span>}
          </div>
        </div>
        <button type="button" onClick={() => deleteTask(task.id)} style={{ color: "#fff", fontSize: "22px", background: "none", border: "none", minHeight: "48px", minWidth: "48px" }}>×</button>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────
  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>

      {/* Header */}
      <div style={{ fontFamily: mono, borderBottom: "4px double #fff", paddingBottom: "16px" }}>
        <div className="system-header" style={{ fontSize: "13px", marginBottom: "4px" }}>
          <span>[ MISSION CONTROL ]</span>
          <div className="system-divider" />
        </div>
        <div style={{ fontSize: "28px", fontWeight: "bold", marginTop: "4px" }}>TASKS & GOALS</div>
      </div>

      {/* Section toggle */}
      <div style={{ display: "flex", border: "2px solid #fff" }}>
        {["tasks", "goals"].map((s) => (
          <button type="button" key={s} onClick={() => setActiveSection(s)} style={{
            flex: 1, padding: "12px",
            background: activeSection === s ? "#fff" : "transparent",
            color: activeSection === s ? "#000" : "#fff",
            fontFamily: mono, fontSize: "15px", letterSpacing: "2px", fontWeight: "bold",
            border: "none", cursor: "pointer", minHeight: "48px",
          }}>
            {s.toUpperCase()}
          </button>
        ))}
      </div>

      {/* ════════════ TASKS SECTION ════════════ */}
      {activeSection === "tasks" && (
        <>
          {/* Add task form */}
          <div className="system-frame" style={{ padding: "14px", marginBottom: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
            {/* Row 1: text + priority + add */}
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <input
                value={newTask} onChange={(e) => setNewTask(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTask()}
                placeholder="New task..." maxLength={500} data-testid="add-task-input"
                style={{ ...inputStyle, flex: "1 1 160px", minWidth: 0 }}
              />
              <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                <select value={newPriority} onChange={(e) => setNewPriority(e.target.value)} style={{ ...inputStyle, fontSize: "14px" }}>
                  <option value="low">LOW</option>
                  <option value="medium">MED</option>
                  <option value="high">HIGH</option>
                </select>
                <button type="button" onClick={addTask} data-testid="add-task"
                  style={{ padding: "12px 18px", background: "#fff", color: "#000", fontFamily: mono, fontSize: "18px", border: "none", minHeight: "48px", minWidth: "48px", fontWeight: "bold" }}>
                  +
                </button>
              </div>
            </div>

            {/* Row 2: due date + goal link */}
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "3px", flex: "1 1 150px" }}>
                <label style={{ fontFamily: mono, fontSize: "11px", color: "#fff", letterSpacing: "1px", opacity: 0.6 }}>
                  DUE DATE — optional (makes it timed)
                </label>
                <input type="date" value={newDue} onChange={(e) => setNewDue(e.target.value)}
                  style={{ ...inputStyle, fontSize: "14px" }} />
              </div>

              {activeGoals.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "3px", flex: "1 1 150px" }}>
                  <label style={{ fontFamily: mono, fontSize: "11px", color: "#fff", letterSpacing: "1px", opacity: 0.6 }}>
                    LINK TO GOAL — optional
                  </label>
                  <select value={newGoalId} onChange={(e) => setNewGoalId(e.target.value)} style={{ ...inputStyle, fontSize: "14px" }}>
                    <option value="">— none —</option>
                    {activeGoals.map((g) => (
                      <option key={g.id} value={g.id}>{g.title.length > 38 ? g.title.slice(0, 36) + "…" : g.title}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Timed tasks */}
          <div>
            <SubHeader count={timedTasks.length}>[ TIMED TASKS ]</SubHeader>
            {timedTasks.length === 0 ? (
              <div style={{ fontFamily: mono, fontSize: "13px", color: "#fff", padding: "16px", border: "1px solid #fff", textAlign: "center" }}>
                No timed tasks — add a due date when creating a task.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {timedTasks.map((task) => <TaskCard key={task.id} task={task} />)}
              </div>
            )}
          </div>

          {/* Untimed / open tasks */}
          <div>
            <SubHeader count={untimedTasks.length}>[ OPEN TASKS ]</SubHeader>
            {untimedTasks.length === 0 ? (
              <div style={{ fontFamily: mono, fontSize: "13px", color: "#fff", padding: "16px", border: "1px solid #fff", textAlign: "center" }}>
                No open tasks. RITMOL will assign missions.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {untimedTasks.map((task) => <TaskCard key={task.id} task={task} />)}
              </div>
            )}
          </div>

          {/* Completed */}
          {doneTasks.length > 0 && (
            <div>
              <div style={{ fontFamily: mono, fontSize: "13px", color: "#fff", letterSpacing: "2px", marginBottom: "10px", borderTop: "2px solid #fff", paddingTop: "12px", fontWeight: "bold" }}>
                [ COMPLETED ]
              </div>
              <button type="button"
                onClick={() => setState((s) => ({ ...s, tasks: (s.tasks || []).filter((t) => !t.done) }))}
                style={{ marginBottom: "12px", padding: "12px 16px", border: "2px solid #fff", background: "transparent", color: "#fff", fontFamily: mono, fontSize: "14px", letterSpacing: "1px", cursor: "pointer", minHeight: "48px" }}>
                CLEAR ALL COMPLETED ({doneTasks.length})
              </button>
              {doneTasks.slice(-5).map((task) => (
                <div key={task.id} style={{ padding: "12px 0", borderBottom: "2px solid #fff", fontFamily: mono, fontSize: "16px", color: "#fff", textDecoration: "line-through", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>✓ {task.text}</span>
                  <button type="button" onClick={() => deleteTask(task.id)} style={{ color: "#fff", background: "none", border: "none", fontSize: "20px", minHeight: "48px", minWidth: "48px" }}>×</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ════════════ GOALS SECTION ════════════ */}
      {activeSection === "goals" && (
        <>
          <button type="button" onClick={() => setShowGoalForm(!showGoalForm)}
            style={{ padding: "12px 16px", border: "2px solid #fff", background: "transparent", color: "#fff", fontFamily: mono, fontSize: "14px", letterSpacing: "1px", minHeight: "48px" }}>
            {showGoalForm ? "CANCEL" : "+ ADD GOAL / HOMEWORK"}
          </button>

          {showGoalForm && (
            <div style={{ border: "2px solid #fff", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <input value={goalForm.title} onChange={(e) => setGoalForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Assignment / goal title..." maxLength={200} style={inputStyle} />
              <input value={goalForm.course} onChange={(e) => setGoalForm((f) => ({ ...f, course: e.target.value }))}
                placeholder="Course name..." maxLength={100} style={inputStyle} />
              <input type="date" value={goalForm.due} onChange={(e) => setGoalForm((f) => ({ ...f, due: e.target.value }))} style={inputStyle} />
              <button type="button" onClick={addGoal} style={primaryBtn}>ADD GOAL</button>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {activeGoals.length === 0 && (
              <div style={{ fontFamily: mono, fontSize: "16px", color: "#fff", padding: "20px", border: "2px solid #fff", textAlign: "center" }}>
                No active goals. Tell RITMOL about your homework.
              </div>
            )}
            {activeGoals.map((goal) => {
              const daysLeft    = goal.due ? Math.ceil((new Date(goal.due) - Date.now()) / 86400000) : null;
              const linkedCount = allTasks.filter((t) => t.goalId === goal.id && !t.done).length;
              return (
                <div key={goal.id} style={{ border: "2px solid #fff", padding: "14px", fontFamily: mono, background: "#000" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "17px", marginBottom: "4px", fontWeight: "bold" }}>{goal.title}</div>
                      <div style={{ fontSize: "13px", color: "#fff" }}>
                        {goal.course && goal.course + " · "}
                        {daysLeft !== null && (daysLeft <= 0 ? "OVERDUE" : daysLeft + "d left")}
                      </div>
                      {linkedCount > 0 && (
                        <div style={{ fontSize: "11px", color: "#fff", marginTop: "4px", opacity: 0.7, letterSpacing: "1px" }}>
                          ⬡ {linkedCount} linked task{linkedCount !== 1 ? "s" : ""}
                        </div>
                      )}
                      {goal.submissionCount > 0 && (
                        <div style={{ fontSize: "13px", color: "#fff", marginTop: "4px" }}>
                          Submissions: {goal.submissionCount}{goal.submissionCount >= 2 ? " · TA visit recommended" : ""}
                        </div>
                      )}
                    </div>
                    <button type="button" onClick={() => submitGoal(goal.id)}
                      style={{ padding: "12px 16px", border: "2px solid #fff", background: "transparent", color: "#fff", fontFamily: mono, fontSize: "14px", minHeight: "48px", fontWeight: "bold" }}>
                      SUBMIT
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
