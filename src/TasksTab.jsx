import { useState } from "react";
import { today } from "../utils/storage";
import { primaryBtn, inputStyle } from "../components/Onboarding";
import { STYLE_CSS } from "../constants";

const inputStyleDefault = {
  width: "100%", background: "rgba(0,0,0,0.6)", border: "1px solid #444",
  color: "#e8e8e8", padding: "10px", fontSize: "14px",
  fontFamily: "'Share Tech Mono', monospace", outline: "none", resize: "none",
  borderRadius: "0",
};

export default function TasksTab({ state, setState, awardXP, showBanner, checkMissions, actionLocksRef }) {
  const [newTask, setNewTask] = useState("");
  const [newPriority, setNewPriority] = useState("medium");
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [goalForm, setGoalForm] = useState({ title: "", course: "", due: "" });
  const [activeSection, setActiveSection] = useState("tasks");

  const activeTasks = (state.tasks || []).filter((t) => !t.done);
  const doneTasks = (state.tasks || []).filter((t) => t.done);
  const activeGoals = (state.goals || []).filter((g) => !g.done);

  function addTask() {
    if (!newTask.trim()) return;
    setState((s) => ({
      ...s,
      // Fix #10 (bug): use the same "t_<timestamp>_<random>" string format as AI-created tasks
      // (executeCommands "add_task" case). Using Date.now() as a plain number caused a type
      // mismatch when the AI tried to complete a user-created task via its string ID validator.
      tasks: [...(s.tasks || []), { id: `t_${crypto.randomUUID()}`, text: newTask, priority: newPriority, done: false, addedBy: "user" }],
    }));
    setNewTask("");
  }

  function completeTask(id, event) {
    if (actionLocksRef.current.has(id)) return;
    actionLocksRef.current.add(id);
    setTimeout(() => actionLocksRef.current.delete(id), 500);

    const task = (state.tasks || []).find(t => t.id === id);
    if (!task || task.done) return;

    const doneDate = today(); // Fix: capture outside updater — clock call is impure
    setState((s) => ({
      ...s,
      tasks: s.tasks.map((t) => t.id === id ? { ...t, done: true, doneDate } : t),
    }));
    awardXP(25, event);
    checkMissions("task");
    showBanner("Task complete. +25 XP", "success");
  }

  function deleteTask(id) {
    setState((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== id) }));
  }

  function addGoal() {
    if (!goalForm.title) return;
    setState((s) => ({
      ...s,
      goals: [...(s.goals || []), { id: `g_${crypto.randomUUID()}`, ...goalForm, done: false, addedBy: "user", submissionCount: 0 }],
    }));
    setGoalForm({ title: "", course: "", due: "" });
    setShowGoalForm(false);
    showBanner(`Goal logged: ${goalForm.title}`, "success");
  }

  function submitGoal(id) {
    if (actionLocksRef.current.has(id)) return;
    actionLocksRef.current.add(id);
    setTimeout(() => actionLocksRef.current.delete(id), 500);

    const doneDate = today(); // Fix: capture outside updater — clock call is impure
    setState((s) => ({
      ...s,
      goals: s.goals.map((g) => g.id === id ? { ...g, submissionCount: (g.submissionCount || 0) + 1, done: true, doneDate } : g),
    }));
    awardXP(50, null, true);
    showBanner("Goal submitted. +50 XP", "success");
  }

  const priorityColor = { low: "#444", medium: "#888", high: "#fff" };
  const priorityLabel = { low: "▁", medium: "▃", high: "█" };

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ fontFamily: "'Share Tech Mono', monospace" }}>
        <div style={{ fontSize: "10px", color: "#555", letterSpacing: "3px" }}>MISSION CONTROL</div>
        <div style={{ fontSize: "20px", fontWeight: "bold", marginTop: "2px" }}>TASKS & GOALS</div>
      </div>

      {/* Section toggle */}
      <div style={{ display: "flex", gap: "0", border: "1px solid #333" }}>
        {["tasks", "goals"].map((s) => (
          <button key={s} onClick={() => setActiveSection(s)} style={{
            flex: 1, padding: "8px",
            background: activeSection === s ? "#fff" : "transparent",
            color: activeSection === s ? "#000" : "#666",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", letterSpacing: "2px",
            border: "none", cursor: "pointer",
          }}>
            {s.toUpperCase()}
          </button>
        ))}
      </div>

      {activeSection === "tasks" && (
        <>
          {/* Add task */}
          <div style={{ display: "flex", gap: "6px" }}>
            <input
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTask()}
              placeholder="New task..."
              style={{ flex: 1, background: "#111", border: "1px solid #333", color: "#e8e8e8", padding: "8px", fontFamily: "'Share Tech Mono', monospace", fontSize: "13px", outline: "none" }}
            />
            <select
              value={newPriority}
              onChange={(e) => setNewPriority(e.target.value)}
              style={{ background: "#111", border: "1px solid #333", color: "#aaa", padding: "8px", fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", outline: "none" }}
            >
              <option value="low">LOW</option>
              <option value="medium">MED</option>
              <option value="high">HIGH</option>
            </select>
            <button onClick={addTask} style={{ padding: "8px 14px", background: "#fff", color: "#000", fontFamily: "'Share Tech Mono', monospace", fontSize: "13px", border: "none" }}>+</button>
          </div>

          {/* Active tasks */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {activeTasks.length === 0 && (
              <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", color: "#444", padding: "12px", border: "1px dashed #222", textAlign: "center" }}>
                No active tasks. RITMOL will assign missions.
              </div>
            )}
            {activeTasks.map((task) => (
              <div key={task.id} style={{
                border: "1px solid #222", padding: "10px 12px",
                fontFamily: "'Share Tech Mono', monospace",
                display: "flex", alignItems: "center", gap: "10px",
                background: "#0d0d0d",
              }}>
                <button onClick={(e) => completeTask(task.id, e)} style={{ color: "#555", fontSize: "16px", background: "none", border: "1px solid #333", width: "24px", height: "24px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  ○
                </button>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "13px", color: "#e8e8e8" }}>{task.text}</div>
                  <div style={{ fontSize: "9px", color: "#444", marginTop: "2px" }}>
                    {priorityLabel[task.priority]} {task.priority?.toUpperCase()} {task.due ? `· due ${task.due}` : ""} {task.addedBy === "ritmol" ? "· RITMOL" : ""}
                  </div>
                </div>
                <button onClick={() => deleteTask(task.id)} style={{ color: "#333", fontSize: "14px", background: "none", border: "none" }}>×</button>
              </div>
            ))}
          </div>

          {/* Done tasks */}
          {doneTasks.length > 0 && (
            <div>
              <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "9px", color: "#333", letterSpacing: "2px", marginBottom: "6px" }}>COMPLETED</div>
              {doneTasks.slice(-5).map((task) => (
                <div key={task.id} style={{ padding: "8px 0", borderBottom: "1px solid #111", fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", color: "#444", display: "flex", justifyContent: "space-between" }}>
                  <span style={{ textDecoration: "line-through" }}>✓ {task.text}</span>
                  <button onClick={() => deleteTask(task.id)} style={{ color: "#333", background: "none", border: "none", fontSize: "12px" }}>×</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {activeSection === "goals" && (
        <>
          <button onClick={() => setShowGoalForm(!showGoalForm)} style={{ padding: "10px", border: "1px solid #333", background: "transparent", color: "#888", fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", letterSpacing: "1px" }}>
            {showGoalForm ? "CANCEL" : "+ ADD GOAL / HOMEWORK"}
          </button>

          {showGoalForm && (
            <div style={{ border: "1px solid #333", padding: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <input
                value={goalForm.title}
                onChange={(e) => setGoalForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Assignment / goal title..."
                style={{ background: "#111", border: "1px solid #222", color: "#e8e8e8", padding: "8px", fontFamily: "'Share Tech Mono', monospace", fontSize: "13px", outline: "none" }}
              />
              <input
                value={goalForm.course}
                onChange={(e) => setGoalForm((f) => ({ ...f, course: e.target.value }))}
                placeholder="Course name..."
                style={{ background: "#111", border: "1px solid #222", color: "#e8e8e8", padding: "8px", fontFamily: "'Share Tech Mono', monospace", fontSize: "13px", outline: "none" }}
              />
              <input
                type="date"
                value={goalForm.due}
                onChange={(e) => setGoalForm((f) => ({ ...f, due: e.target.value }))}
                style={{ background: "#111", border: "1px solid #222", color: "#e8e8e8", padding: "8px", fontFamily: "'Share Tech Mono', monospace", fontSize: "13px", outline: "none" }}
              />
              <button onClick={addGoal} style={primaryBtn}>ADD GOAL</button>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {activeGoals.length === 0 && (
              <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", color: "#444", padding: "12px", border: "1px dashed #222", textAlign: "center" }}>
                No active goals. Tell RITMOL about your homework.
              </div>
            )}
            {activeGoals.map((goal) => {
              const daysLeft = goal.due ? Math.ceil((new Date(goal.due) - Date.now()) / 86400000) : null;
              return (
                <div key={goal.id} style={{
                  border: "1px solid #333", padding: "12px",
                  fontFamily: "'Share Tech Mono', monospace",
                  background: "#0d0d0d",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "13px", marginBottom: "2px" }}>{goal.title}</div>
                      <div style={{ fontSize: "10px", color: "#555" }}>
                        {goal.course && `${goal.course} · `}
                        {daysLeft !== null && (daysLeft <= 0 ? "OVERDUE" : `${daysLeft}d left`)}
                      </div>
                      {goal.submissionCount > 0 && (
                        <div style={{ fontSize: "9px", color: "#444", marginTop: "2px" }}>
                          Submissions: {goal.submissionCount} {goal.submissionCount >= 2 ? "· TA visit recommended" : ""}
                        </div>
                      )}
                    </div>
                    <button onClick={() => submitGoal(goal.id)} style={{ padding: "4px 8px", border: "1px solid #555", background: "transparent", color: "#888", fontFamily: "'Share Tech Mono', monospace", fontSize: "10px" }}>
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

// ═══════════════════════════════════════════════════════════════
// CHAT TAB (RITMOL)
// ═══════════════════════════════════════════════════════════════
