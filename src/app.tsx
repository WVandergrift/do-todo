import React, { useEffect, useMemo, useRef, useState } from "react";

// --- Types ---------------------------------------------------------------
/** @typedef {Object} Todo */

/**
 * @typedef Todo
 * @property {string} id
 * @property {string} title
 * @property {string} notes
 * @property {boolean} completed
 * @property {number|null} completedAt
 * @property {number} createdAt
 * @property {boolean} running
 * @property {number} elapsedMs // accumulated time when not running
 * @property {number|null} startedAt // timestamp when started (if running)
 * @property {number|null} warningMinutes // warn at X minutes
 * @property {boolean} warned // whether we've already alerted for this run
 */

// --- Utilities -----------------------------------------------------------
const STORAGE_KEY = "do-todo-v1";

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function msToHMS(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

function loadTodos() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

function saveTodos(todos) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
}

// --- Small UI helpers ----------------------------------------------------
function Badge({ children, color = "bg-indigo-100 text-indigo-700 border-indigo-300" }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${color}`}>
      {children}
    </span>
  );
}

function IconButton({ title, onClick, children, className = "" }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1 text-sm transition-colors hover:shadow hover:bg-indigo-50 active:bg-indigo-100 ${className}`}
    >
      {children}
    </button>
  );
}

function TextButton({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      className="text-sm text-indigo-600 underline underline-offset-4 hover:opacity-80"
    >
      {children}
    </button>
  );
}

// --- Toasts --------------------------------------------------------------
function useToasts() {
  const [toasts, setToasts] = useState([]);
  function pushToast(msg) {
    const id = uid();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 4000);
  }
  return { toasts, pushToast };
}

function ToastLayer({ toasts }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-50 flex justify-center">
      <div className="flex w-full max-w-xl flex-col gap-2 px-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto rounded-2xl border bg-indigo-600/90 text-white p-3 shadow-lg backdrop-blur"
          >
            <div className="text-sm">{t.msg}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Main App ------------------------------------------------------------
export default function DoTodoApp() {
  const [todos, setTodos] = useState(() => loadTodos());
  const [query, setQuery] = useState("");
  const [showCompleted, setShowCompleted] = useState(true);
  const [sort, setSort] = useState("created-desc");
  const [nowTick, setNowTick] = useState(Date.now());
  const { toasts, pushToast } = useToasts();

  // Persist
  useEffect(() => {
    saveTodos(todos);
  }, [todos]);

  // Global ticker: update every second if any timers are running
  const anyRunning = useMemo(() => todos.some((t) => t.running), [todos]);
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyRunning]);

  // Warning checks
  useEffect(() => {
    todos.forEach((t) => {
      if (!t.running || !t.warningMinutes || t.warned) return;
      const elapsed = t.elapsedMs + (t.startedAt ? nowTick - t.startedAt : 0);
      const warnMs = t.warningMinutes * 60 * 1000;
      if (elapsed >= warnMs) {
        setTodos((prev) =>
          prev.map((x) => (x.id === t.id ? { ...x, warned: true } : x))
        );
        // Attempt Notification API, fall back to toast
        if (typeof window !== "undefined" && "Notification" in window) {
          if (Notification.permission === "granted") {
            new Notification("Do Todo — Time Alert", {
              body: `"${t.title}" reached ${t.warningMinutes} min`,
            });
          } else if (Notification.permission !== "denied") {
            Notification.requestPermission().then((perm) => {
              if (perm === "granted") {
                new Notification("Do Todo — Time Alert", {
                  body: `"${t.title}" reached ${t.warningMinutes} min`,
                });
              } else {
                pushToast(`⏰ ${t.title} reached ${t.warningMinutes} min`);
              }
            });
          } else {
            pushToast(`⏰ ${t.title} reached ${t.warningMinutes} min`);
          }
        } else {
          pushToast(`⏰ ${t.title} reached ${t.warningMinutes} min`);
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowTick, todos]);

  // Derived lists
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? todos.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            (t.notes || "").toLowerCase().includes(q)
        )
      : todos.slice();

    list.sort((a, b) => {
      switch (sort) {
        case "alpha":
          return a.title.localeCompare(b.title);
        case "time-desc": {
          const at = a.elapsedMs + (a.running ? nowTick - (a.startedAt || 0) : 0);
          const bt = b.elapsedMs + (b.running ? nowTick - (b.startedAt || 0) : 0);
          return bt - at;
        }
        case "created-asc":
          return a.createdAt - b.createdAt;
        case "created-desc":
        default:
          return b.createdAt - a.createdAt;
      }
    });

    return list;
  }, [todos, query, sort, nowTick]);

  const active = filtered.filter((t) => !t.completed);
  const completed = filtered.filter((t) => t.completed);

  // Actions
  function addTodo({ title, notes, warningMinutes }) {
    const newTodo = {
      id: uid(),
      title: title.trim(),
      notes: (notes || "").trim(),
      completed: false,
      completedAt: null,
      createdAt: Date.now(),
      running: false,
      elapsedMs: 0,
      startedAt: null,
      warningMinutes: warningMinutes ? Number(warningMinutes) : null,
      warned: false,
    };
    setTodos((t) => [newTodo, ...t]);
  }

  function toggleRun(id) {
    setTodos((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        if (t.completed) return t; // no running completed
        if (t.running) {
          // stop
          const now = Date.now();
          const extra = t.startedAt ? now - t.startedAt : 0;
          return {
            ...t,
            running: false,
            elapsedMs: t.elapsedMs + extra,
            startedAt: null,
          };
        } else {
          // start
          return {
            ...t,
            running: true,
            startedAt: Date.now(),
            warned: false, // reset warning for new run
          };
        }
      })
    );
  }

  function markComplete(id) {
    setTodos((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        let elapsedMs = t.elapsedMs;
        if (t.running && t.startedAt) {
          elapsedMs += Date.now() - t.startedAt;
        }
        return {
          ...t,
          running: false,
          startedAt: null,
          elapsedMs,
          completed: true,
          completedAt: Date.now(),
        };
      })
    );
  }

  function undoComplete(id) {
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: false, completedAt: null } : t))
    );
  }

  function removeTodo(id) {
    setTodos((prev) => prev.filter((t) => t.id !== id));
  }

  function updateTodo(id, patch) {
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function clearCompleted() {
    setTodos((prev) => prev.filter((t) => !t.completed));
  }

  // --- Layout ------------------------------------------------------------
  return (
    <div className="min-h-dvh bg-gradient-to-br from-indigo-50 via-pink-50 to-yellow-50 text-slate-900">
      <ToastLayer toasts={toasts} />

      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b bg-gradient-to-r from-indigo-500 to-pink-500 text-white backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-2xl border bg-white text-indigo-600 shadow-sm">
              <span className="text-lg">✅</span>
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Do Todo</h1>
              <p className="text-xs text-white/80">Fast. Local. No sign-in.</p>
            </div>
          </div>
          <div className="hidden flex-1 items-center justify-center lg:flex">
            {/* Top banner ad placeholder */}
            <div className="h-12 w-full max-w-xl rounded-2xl border bg-white/80 p-2 text-center text-sm text-slate-700 shadow-inner">
              Ad space — 970×90 / responsive
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="rounded-xl border bg-white text-slate-700 px-2 py-1 text-sm"
            >
              <option value="created-desc">Newest</option>
              <option value="created-asc">Oldest</option>
              <option value="alpha">A–Z</option>
              <option value="time-desc">Most Time</option>
            </select>
            <div className="relative">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="w-36 rounded-xl border bg-white text-slate-800 placeholder-slate-400 px-3 py-1.5 text-sm focus:outline-none sm:w-56"
              />
              {query && (
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-indigo-500"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Content grid */}
      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-12">
        <section className="lg:col-span-8 xl:col-span-9">
          <CreateTodoCard onCreate={addTodo} />

          <section className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-indigo-700">Active</h2>
              <div className="flex items-center gap-2 text-sm">
                <Badge color="bg-green-100 text-green-700 border-green-300">
                  {active.length} {active.length === 1 ? "task" : "tasks"}
                </Badge>
              </div>
            </div>
            {active.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="flex flex-col gap-3">
                {active.map((t) => (
                  <TodoRow
                    key={t.id}
                    todo={t}
                    now={nowTick}
                    onToggleRun={() => toggleRun(t.id)}
                    onComplete={() => markComplete(t.id)}
                    onRemove={() => removeTodo(t.id)}
                    onUpdate={(patch) => updateTodo(t.id, patch)}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="mt-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-pink-700">Completed</h2>
              <div className="flex items-center gap-2">
                <IconButton
                  title={showCompleted ? "Hide completed" : "Show completed"}
                  onClick={() => setShowCompleted((v) => !v)}
                >
                  {showCompleted ? "Hide" : "Show"}
                </IconButton>
                {completed.length > 0 && (
                  <TextButton onClick={clearCompleted}>Clear all</TextButton>
                )}
              </div>
            </div>
            {showCompleted && (
              <div className="flex flex-col gap-2">
                {completed.length === 0 ? (
                  <div className="rounded-2xl border bg-white p-4 text-sm text-slate-500">
                    No completed tasks yet.
                  </div>
                ) : (
                  completed.map((t) => (
                    <CompletedRow
                      key={t.id}
                      todo={t}
                      onUndo={() => undoComplete(t.id)}
                      onRemove={() => removeTodo(t.id)}
                    />
                  ))
                )}
              </div>
            )}
          </section>
        </section>

        {/* Right column: stats + ads */}
        <aside className="lg:col-span-4 xl:col-span-3">
          <StatsCard todos={todos} now={nowTick} />

          {/* Ad blocks */}
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <div className="h-40 rounded-2xl border bg-gradient-to-r from-indigo-100 to-pink-100 p-3 text-center text-sm text-slate-700 shadow-inner">
              Ad space — 300×250
            </div>
            <div className="h-40 rounded-2xl border bg-gradient-to-r from-yellow-100 to-green-100 p-3 text-center text-sm text-slate-700 shadow-inner">
              Ad space — 300×250
            </div>
          </div>
        </aside>
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-10 pt-4 text-center text-xs text-slate-500">
        <p>
          <strong>Do Todo</strong> — stored locally in your browser.
        </p>
      </footer>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border bg-white p-6 text-center">
      <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-2xl border bg-white shadow-sm">
        <span>📝</span>
      </div>
      <h3 className="text-base font-medium">No active tasks</h3>
      <p className="mt-1 text-sm text-slate-500">Add your first to-do above.</p>
    </div>
  );
}

// --- Create Card ---------------------------------------------------------
function CreateTodoCard({ onCreate }) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [warningMinutes, setWarningMinutes] = useState("");
  const titleRef = useRef(null);

  function submit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    onCreate({ title, notes, warningMinutes: warningMinutes || null });
    setTitle("");
    setNotes("");
    setWarningMinutes("");
    titleRef.current?.focus();
  }

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 md:grid-cols-12">
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a task…"
          className="md:col-span-5 rounded-xl border bg-white px-3 py-2"
        />
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          className="md:col-span-4 rounded-xl border bg-white px-3 py-2"
        />
        <div className="md:col-span-2 flex items-center gap-2">
          <input
            type="number"
            min={1}
            step={1}
            value={warningMinutes}
            onChange={(e) => setWarningMinutes(e.target.value)}
            placeholder="Warn at (min)"
            className="w-full rounded-xl border bg-white px-3 py-2"
          />
        </div>
        <button
          type="submit"
          className="md:col-span-1 rounded-xl bg-slate-900 px-4 py-2 text-white hover:opacity-90"
        >
          Add
        </button>
      </form>
    </div>
  );
}

// --- Todo Row ------------------------------------------------------------
function TodoRow({ todo, now, onToggleRun, onComplete, onRemove, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [tempTitle, setTempTitle] = useState(todo.title);
  const [tempNotes, setTempNotes] = useState(todo.notes || "");
  const [tempWarn, setTempWarn] = useState(todo.warningMinutes ?? "");

  useEffect(() => {
    setTempTitle(todo.title);
    setTempNotes(todo.notes || "");
    setTempWarn(todo.warningMinutes ?? "");
  }, [todo.id]);

  const elapsed = todo.elapsedMs + (todo.running && todo.startedAt ? now - todo.startedAt : 0);

  function saveEdits() {
    const patch = {
      title: tempTitle.trim() || todo.title,
      notes: tempNotes,
      warningMinutes: tempWarn === "" ? null : Number(tempWarn),
    };
    onUpdate(patch);
    setEditing(false);
  }

  const warnMs = (todo.warningMinutes ?? 0) * 60 * 1000;
  const warnActive = todo.warningMinutes && elapsed >= warnMs;

  return (
    <div
      className={`grid grid-cols-1 gap-3 rounded-2xl border bg-white p-3 shadow-sm md:grid-cols-12 ${
        warnActive ? "ring-2 ring-amber-400" : ""
      }`}
    >
      <div className="md:col-span-6">
        {editing ? (
          <div className="flex flex-col gap-2">
            <input
              value={tempTitle}
              onChange={(e) => setTempTitle(e.target.value)}
              className="w-full rounded-xl border px-3 py-2"
            />
            <textarea
              value={tempNotes}
              onChange={(e) => setTempNotes(e.target.value)}
              className="w-full rounded-xl border px-3 py-2"
              placeholder="Notes…"
              rows={2}
            />
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-medium">{todo.title}</h3>
              {todo.warningMinutes ? (
                <Badge>Warn {todo.warningMinutes}m</Badge>
              ) : null}
              {todo.running && <Badge color="bg-sky-100 text-sky-700 border-sky-300">Running</Badge>}
            </div>
            {todo.notes && (
              <p className="mt-1 text-sm text-slate-600 whitespace-pre-wrap">{todo.notes}</p>
            )}
          </div>
        )}
      </div>

      <div className="md:col-span-3 flex items-center gap-3">
        <div className="rounded-xl border bg-slate-50 px-3 py-2 font-mono text-sm">
          {msToHMS(elapsed)}
        </div>
        <IconButton title={todo.running ? "Stop" : "Start"} onClick={onToggleRun}>
          {todo.running ? "Stop" : "Start"}
        </IconButton>
      </div>

      <div className="md:col-span-3 flex items-center justify-end gap-2">
        {editing ? (
          <>
            <IconButton title="Save" onClick={saveEdits} className="bg-slate-900 text-white">
              Save
            </IconButton>
            <IconButton title="Cancel" onClick={() => setEditing(false)}>
              Cancel
            </IconButton>
          </>
        ) : (
          <>
            <IconButton title="Edit" onClick={() => setEditing(true)}>
              Edit
            </IconButton>
            <IconButton title="Complete" onClick={onComplete}>
              Complete
            </IconButton>
            <IconButton title="Delete" onClick={onRemove}>
              Delete
            </IconButton>
          </>
        )}
      </div>

      {editing && (
        <div className="md:col-span-12">
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600">Warn at (min)</label>
            <input
              type="number"
              min={1}
              step={1}
              value={tempWarn}
              onChange={(e) => setTempWarn(e.target.value)}
              className="w-28 rounded-xl border px-3 py-1.5"
            />
            <TextButton onClick={() => setTempWarn("")}>Clear</TextButton>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Completed Row -------------------------------------------------------
function CompletedRow({ todo, onUndo, onRemove }) {
  return (
    <div className="grid grid-cols-1 items-center gap-3 rounded-2xl border bg-white p-3 shadow-sm md:grid-cols-12">
      <div className="md:col-span-7">
        <div className="flex items-center gap-2">
          <h3 className="line-through">{todo.title}</h3>
          <Badge color="bg-emerald-100 text-emerald-700 border-emerald-300">Done</Badge>
        </div>
        {todo.notes && (
          <p className="mt-1 text-sm text-slate-600 whitespace-pre-wrap">{todo.notes}</p>
        )}
      </div>
      <div className="md:col-span-2">
        <div className="rounded-xl border bg-slate-50 px-3 py-2 font-mono text-sm">
          {msToHMS(todo.elapsedMs)}
        </div>
      </div>
      <div className="md:col-span-3 flex items-center justify-end gap-2">
        <IconButton title="Undo" onClick={onUndo}>Undo</IconButton>
        <IconButton title="Delete" onClick={onRemove}>Delete</IconButton>
      </div>
    </div>
  );
}

// --- Stats Card ----------------------------------------------------------
function StatsCard({ todos, now }) {
  const active = todos.filter((t) => !t.completed);
  const completed = todos.filter((t) => t.completed);

  const totalActiveMs = active.reduce(
    (acc, t) => acc + t.elapsedMs + (t.running && t.startedAt ? now - t.startedAt : 0),
    0
  );
  const totalCompletedMs = completed.reduce((acc, t) => acc + t.elapsedMs, 0);

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <h3 className="text-base font-semibold">Overview</h3>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Stat label="Active" value={active.length} />
        <Stat label="Completed" value={completed.length} />
        <Stat label="Time (active)" value={msToHMS(totalActiveMs)} mono />
        <Stat label="Time (done)" value={msToHMS(totalCompletedMs)} mono />
      </div>
    </div>
  );
}

function Stat({ label, value, mono = false }) {
  return (
    <div className="rounded-xl border bg-slate-50 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`${mono ? "font-mono" : "font-semibold"} text-lg`}>{value}</div>
    </div>
  );
}

// --- Inline self-tests (dev only) ---------------------------------------
(function runSelfTests() {
  if (typeof window === "undefined") return; // don't run in SSR
  if (window.__DO_TODO_TESTED__) return;
  window.__DO_TODO_TESTED__ = true;

  const tests = [];
  function assertEqual(name, got, expected) {
    const pass = got === expected;
    tests.push({ name, pass, got, expected });
  }
  function assert(name, cond) {
    const pass = Boolean(cond);
    tests.push({ name, pass, got: cond, expected: true });
  }

  // msToHMS tests (existing)
  assertEqual("msToHMS 0", msToHMS(0), "00:00:00");
  assertEqual("msToHMS 1s", msToHMS(1000), "00:00:01");
  assertEqual("msToHMS 61s", msToHMS(61_000), "00:01:01");
  assertEqual("msToHMS 3661s", msToHMS(3_661_000), "01:01:01");

  // Additional tests
  assertEqual("msToHMS negative clamps to zero", msToHMS(-1000), "00:00:00");
  assertEqual("msToHMS 24h+", msToHMS(24 * 3600 * 1000 + 42 * 1000), "24:00:42");

  // uid sanity (not equal sequentially)
  const a = uid();
  const b = uid();
  assert("uid generates different ids", a !== b);

  // Report
  const failed = tests.filter((t) => !t.pass);
  if (failed.length) {
    // eslint-disable-next-line no-console
    console.warn("Do Todo self-tests failed:", failed);
  } else {
    // eslint-disable-next-line no-console
    console.log("Do Todo self-tests passed (", tests.length, ")");
  }
})();
