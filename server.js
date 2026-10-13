"use strict";

const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "tasks.json");

if (ADMIN_PASSWORD.length < 14) throw new Error("Set ADMIN_PASSWORD to a password of at least 14 characters.");
if (SESSION_SECRET.length < 32) throw new Error("Set SESSION_SECRET to a random secret of at least 32 characters.");

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]\n", { mode: 0o600 });

function readTasks() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("Could not read task database:", err.message);
    throw new Error("Task database could not be read.");
  }
}
function saveTasks(tasks) {
  const temp = DATA_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(tasks, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(temp, DATA_FILE);
}
function clean(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function safeEqual(a, b) {
  const aa = crypto.createHash("sha256").update(String(a)).digest();
  const bb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(aa, bb);
}
function validate(body, existing) {
  const title = clean(body.title, 160);
  const description = clean(body.description, 2000);
  const category = clean(body.category, 48) || "General";
  const priority = clean(body.priority, 10) || "medium";
  const dueDate = clean(body.dueDate, 10);
  if (!title) throw new Error("Task title is required.");
  if (!["low", "medium", "high", "urgent"].includes(priority)) throw new Error("Invalid priority.");
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error("Due date must use YYYY-MM-DD.");
  return {
    id: existing ? existing.id : crypto.randomUUID(),
    title, description, category, priority, dueDate: dueDate || "",
    completed: existing ? Boolean(existing.completed) : false,
    createdAt: existing ? existing.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "1" ? 1 : false);
app.use(helmet({ contentSecurityPolicy: {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:"],
    connectSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    frameAncestors: ["'none'"]
  }
}}));
app.use(express.json({ limit: "24kb" }));
app.use(session({
  name: "shadow_todo_admin",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000
  }
}));

// Basic login throttling: no more than 8 attempts per IP in 15 minutes.
const attempts = new Map();
app.use("/api/admin/login", (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const entry = attempts.get(ip);
  if (entry && entry.until > now && entry.count >= 8) {
    return res.status(429).json({ error: "Too many login attempts. Try again in 15 minutes." });
  }
  if (!entry || entry.until <= now) attempts.set(ip, { count: 1, until: now + 15 * 60 * 1000 });
  else entry.count++;
  if (attempts.size > 2000) {
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
  }
  next();
});

function sameOrigin(req, res, next) {
  const origin = req.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== req.get("host")) return res.status(403).json({ error: "Cross-origin request blocked." });
    } catch {
      return res.status(403).json({ error: "Invalid origin." });
    }
  }
  next();
}
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin === true) return next();
  return res.status(401).json({ error: "Admin sign-in required." });
}

app.get("/api/tasks", (req, res) => {
  const tasks = readTasks().map(({ id, title, description, category, priority, dueDate, completed, createdAt, updatedAt }) =>
    ({ id, title, description, category, priority, dueDate, completed, createdAt, updatedAt }));
  tasks.sort((a, b) => Number(a.completed) - Number(b.completed)
    || ({urgent:0,high:1,medium:2,low:3}[a.priority] - {urgent:0,high:1,medium:2,low:3}[b.priority])
    || (a.dueDate || "9999-99-99").localeCompare(b.dueDate || "9999-99-99")
    || b.createdAt.localeCompare(a.createdAt));
  res.set("Cache-Control", "no-store");
  res.json({ tasks });
});

app.get("/api/admin/session", (req, res) => {
  res.json({ authenticated: Boolean(req.session && req.session.isAdmin === true) });
});
app.post("/api/admin/login", sameOrigin, (req, res, next) => {
  if (!req.is("application/json")) return res.status(415).json({ error: "JSON required." });
  const password = req.body && typeof req.body.password === "string" ? req.body.password : "";
  if (!safeEqual(password, ADMIN_PASSWORD)) return res.status(401).json({ error: "Incorrect password." });
  req.session.regenerate(err => {
    if (err) return next(err);
    req.session.isAdmin = true;
    req.session.save(err2 => {
      if (err2) return next(err2);
      res.json({ ok: true });
    });
  });
});
app.post("/api/admin/logout", sameOrigin, requireAdmin, (req, res, next) => {
  req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie("shadow_todo_admin", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production" });
    res.json({ ok: true });
  });
});

app.post("/api/tasks", sameOrigin, requireAdmin, (req, res) => {
  try {
    const tasks = readTasks();
    const task = validate(req.body || {});
    tasks.push(task);
    saveTasks(tasks);
    res.status(201).json({ task });
  } catch (err) {
    res.status(400).json({ error: err.message || "Invalid task." });
  }
});
app.put("/api/tasks/:id", sameOrigin, requireAdmin, (req, res) => {
  try {
    const tasks = readTasks();
    const index = tasks.findIndex(task => task.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: "Task not found." });
    const current = tasks[index];
    const task = validate({ ...current, ...(req.body || {}) }, current);
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "completed")) {
      if (typeof req.body.completed !== "boolean") return res.status(400).json({ error: "completed must be true or false." });
      task.completed = req.body.completed;
    }
    tasks[index] = task;
    saveTasks(tasks);
    res.json({ task });
  } catch (err) {
    res.status(400).json({ error: err.message || "Invalid task." });
  }
});
app.delete("/api/tasks/:id", sameOrigin, requireAdmin, (req, res) => {
  const tasks = readTasks();
  const next = tasks.filter(task => task.id !== req.params.id);
  if (next.length === tasks.length) return res.status(404).json({ error: "Task not found." });
  saveTasks(next);
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"], maxAge: "1h" }));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Unexpected server error." });
});

app.listen(PORT, "127.0.0.1", () => console.log("Task list listening on 127.0.0.1:" + PORT));
