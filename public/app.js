"use strict";

const $ = id => document.getElementById(id);
const state = { tasks: [], admin: false, filter: "all", category: "all", query: "" };
let toastTimer;

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) }
  });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
function showToast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}
function showError(message) {
  $("errorMessage").textContent = message;
  $("errorMessage").classList.remove("hidden");
}
function clearError() {
  $("errorMessage").classList.add("hidden");
  $("errorMessage").textContent = "";
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function setAdmin(isAdmin) {
  state.admin = isAdmin;
  $("adminButton").textContent = isAdmin ? "Sign out" : "Admin sign in";
  $("addButton").classList.toggle("hidden", !isAdmin);
  $("publicBadge").innerHTML = "";
  const dot = el("span");
  const label = document.createTextNode(isAdmin ? "Owner mode" : "Public board");
  $("publicBadge").append(dot, label);
  $("publicBadge").style.color = isAdmin ? "#c4baff" : "";
  render();
}
async function refresh() {
  clearError();
  try {
    const [tasksData, sessionData] = await Promise.all([
      api("/api/tasks"),
      api("/api/admin/session")
    ]);
    state.tasks = tasksData.tasks || [];
    setAdmin(Boolean(sessionData.authenticated));
  } catch (err) {
    showError("Could not load tasks. " + err.message);
    $("taskList").replaceChildren(el("div", "loading", "Unable to load the board."));
  }
}
function dueLabel(date) {
  if (!date) return "";
  const d = new Date(date + "T00:00:00");
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function renderCategories() {
  const root = $("categoryChips");
  root.replaceChildren();
  const categories = [...new Set(state.tasks.map(t => t.category || "General"))].sort((a, b) => a.localeCompare(b));
  if (!categories.length) return;
  const addChip = (label, value) => {
    const b = el("button", "chip" + (state.category === value ? " active" : ""), label);
    b.type = "button";
    b.addEventListener("click", () => { state.category = value; render(); });
    root.append(b);
  };
  addChip("All categories", "all");
  categories.forEach(c => addChip(c, c));
}
function filteredTasks() {
  const query = state.query.toLowerCase();
  return state.tasks.filter(task => {
    if (state.filter === "active" && task.completed) return false;
    if (state.filter === "completed" && !task.completed) return false;
    if (state.category !== "all" && task.category !== state.category) return false;
    if (query && ![task.title, task.description, task.category, task.priority].some(s => String(s || "").toLowerCase().includes(query))) return false;
    return true;
  });
}
function render() {
  const tasks = state.tasks;
  const completed = tasks.filter(t => t.completed).length;
  const active = tasks.length - completed;
  const high = tasks.filter(t => !t.completed && ["high", "urgent"].includes(t.priority)).length;
  const percent = tasks.length ? Math.round(completed / tasks.length * 100) : 0;
  $("progressPercent").textContent = percent + "%";
  $("progressBar").style.width = percent + "%";
  $("completedCount").textContent = completed + " completed";
  $("totalCount").textContent = tasks.length + (tasks.length === 1 ? " task" : " tasks");
  $("activeCount").textContent = active;
  $("priorityCount").textContent = high;
  $("doneStat").textContent = completed;
  renderCategories();

  const list = $("taskList");
  list.replaceChildren();
  const visible = filteredTasks();
  if (!visible.length) {
    const empty = el("div", "empty-state");
    empty.append(el("div", "empty-icon", state.tasks.length ? "⌕" : "✦"));
    empty.append(el("strong", "", state.tasks.length ? "No tasks match your filters" : "Nothing on the list yet"));
    empty.append(el("p", "", state.tasks.length ? "Try another search or filter." : (state.admin ? "Add your first task to get started." : "The owner hasn't added any tasks yet.")));
    if (state.admin && !state.tasks.length) {
      const add = el("button", "button button-primary", "＋ Add first task");
      add.type = "button";
      add.style.marginTop = "16px";
      add.addEventListener("click", () => openTaskModal());
      empty.append(add);
    }
    list.append(empty);
    return;
  }
  visible.forEach(task => list.append(makeTaskCard(task)));
}
function makeTaskCard(task) {
  const card = el("article", "task-card" + (task.completed ? " is-completed" : ""));
  const check = el("input", "task-check");
  check.type = "checkbox";
  check.checked = Boolean(task.completed);
  check.disabled = !state.admin;
  check.setAttribute("aria-label", (task.completed ? "Mark incomplete: " : "Complete: ") + task.title);
  if (state.admin) check.addEventListener("change", () => updateTask(task.id, { completed: check.checked }));
  const main = el("div", "task-main");
  main.append(el("div", "task-title", task.title));
  if (task.description) main.append(el("div", "task-description", task.description));
  const meta = el("div", "task-meta");
  meta.append(el("span", "tag", task.category || "General"));
  meta.append(el("span", "tag priority " + task.priority, task.priority.charAt(0).toUpperCase() + task.priority.slice(1)));
  if (task.dueDate) {
    const overdue = !task.completed && task.dueDate < new Date().toISOString().slice(0, 10);
    meta.append(el("span", "due" + (overdue ? " overdue" : ""), (overdue ? "Overdue · " : "Due ") + dueLabel(task.dueDate)));
  }
  main.append(meta);
  const actions = el("div", "task-actions");
  if (state.admin) {
    const edit = el("button", "icon-button", "✎");
    edit.type = "button"; edit.title = "Edit task"; edit.setAttribute("aria-label", "Edit " + task.title);
    edit.addEventListener("click", () => openTaskModal(task));
    const del = el("button", "icon-button", "×");
    del.type = "button"; del.title = "Delete task"; del.setAttribute("aria-label", "Delete " + task.title);
    del.addEventListener("click", () => deleteTask(task));
    actions.append(edit, del);
  }
  card.append(check, main, actions);
  return card;
}
function openLogin() {
  $("loginError").textContent = "";
  $("adminPassword").value = "";
  $("loginModal").classList.remove("hidden");
  setTimeout(() => $("adminPassword").focus(), 30);
}
function closeModal(name) {
  $(name === "login" ? "loginModal" : "taskModal").classList.add("hidden");
}
function openTaskModal(task) {
  if (!state.admin) return;
  $("taskFormError").textContent = "";
  $("taskModalTitle").textContent = task ? "Edit task" : "Add a task";
  $("taskId").value = task ? task.id : "";
  $("taskTitle").value = task ? task.title : "";
  $("taskDescription").value = task ? task.description : "";
  $("taskCategory").value = task ? task.category : "General";
  $("taskPriority").value = task ? task.priority : "medium";
  $("taskDueDate").value = task ? task.dueDate : "";
  $("saveTask").textContent = task ? "Save changes" : "Create task";
  $("taskModal").classList.remove("hidden");
  setTimeout(() => $("taskTitle").focus(), 30);
}
async function updateTask(id, changes) {
  try {
    await api("/api/tasks/" + encodeURIComponent(id), { method: "PUT", body: JSON.stringify(changes) });
    await refresh();
    showToast("Task updated.");
  } catch (err) {
    showToast(err.message);
    await refresh();
  }
}
async function deleteTask(task) {
  if (!confirm('Delete "' + task.title + '"? This cannot be undone.')) return;
  try {
    await api("/api/tasks/" + encodeURIComponent(task.id), { method: "DELETE" });
    await refresh();
    showToast("Task deleted.");
  } catch (err) {
    showToast(err.message);
  }
}

$("adminButton").addEventListener("click", async () => {
  if (!state.admin) return openLogin();
  if (!confirm("Sign out of owner mode?")) return;
  try {
    await api("/api/admin/logout", { method: "POST", body: "{}" });
    setAdmin(false);
    showToast("Signed out.");
  } catch (err) { showToast(err.message); }
});
$("addButton").addEventListener("click", () => openTaskModal());
document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => closeModal(button.dataset.close)));
document.querySelectorAll(".modal-backdrop").forEach(backdrop => backdrop.addEventListener("click", () => closeModal(backdrop.dataset.close)));
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeModal("login");
    closeModal("task");
  }
});
$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  $("loginError").textContent = "";
  $("loginSubmit").disabled = true;
  $("loginSubmit").textContent = "Signing in…";
  try {
    await api("/api/admin/login", { method: "POST", body: JSON.stringify({ password: $("adminPassword").value }) });
    closeModal("login");
    await refresh();
    showToast("Owner mode enabled.");
  } catch (err) {
    $("loginError").textContent = err.message;
  } finally {
    $("loginSubmit").disabled = false;
    $("loginSubmit").textContent = "Sign in securely";
  }
});
$("taskForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!state.admin) return;
  $("taskFormError").textContent = "";
  const id = $("taskId").value;
  const task = {
    title: $("taskTitle").value,
    description: $("taskDescription").value,
    category: $("taskCategory").value || "General",
    priority: $("taskPriority").value,
    dueDate: $("taskDueDate").value
  };
  $("saveTask").disabled = true;
  try {
    await api(id ? "/api/tasks/" + encodeURIComponent(id) : "/api/tasks", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(task)
    });
    closeModal("task");
    await refresh();
    showToast(id ? "Changes saved." : "Task added.");
  } catch (err) {
    $("taskFormError").textContent = err.message;
  } finally {
    $("saveTask").disabled = false;
  }
});
$("searchInput").addEventListener("input", event => {
  state.query = event.target.value.trim();
  render();
});
document.querySelectorAll(".filter").forEach(button => button.addEventListener("click", () => {
  state.filter = button.dataset.filter;
  document.querySelectorAll(".filter").forEach(b => b.classList.toggle("active", b === button));
  render();
}));

refresh();
