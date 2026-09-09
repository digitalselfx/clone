import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";
import { query } from "./db.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TRAIT_LABELS = {
  O: "Openness",
  C: "Conscientiousness",
  E: "Extraversion",
  A: "Agreeableness",
  N: "Neuroticism",
};

// Wraps an async route/middleware handler so a rejected promise is passed to
// Express's error handler instead of crashing the whole Node process.
// Without this, one failed query (e.g. a missing table) takes the entire
// app down for every user, not just the one request that failed.
function wrapAsync(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// --- Users -----------------------------------------------------------

app.post("/api/users", wrapAsync(async (req, res) => {
  const { name, slug } = req.body;
  if (!slug) return res.status(400).json({ error: "slug required" });

  const clean = slug.toLowerCase().trim().replace(/[^a-z0-9-]/g, "");
  try {
    const { rows } = await query(
      "INSERT INTO users (name, slug) VALUES ($1, $2) RETURNING id, name, slug",
      [name || null, clean]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "slug already taken" });
    throw err;
  }
}));

// Resolves the user from the request's subdomain, e.g. vladimir.digital-selfx.com -> slug 'vladimir'.
// Attaches req.cloneUser if found. Requests to the bare domain or unknown subdomains pass through unresolved.
const ROOT_DOMAIN = process.env.ROOT_DOMAIN || "digital-selfx.com";

app.use(wrapAsync(async (req, res, next) => {
  const host = (req.hostname || "").toLowerCase();
  if (host === ROOT_DOMAIN || host === `www.${ROOT_DOMAIN}`) return next();

  const slug = host.endsWith(`.${ROOT_DOMAIN}`)
    ? host.slice(0, -1 * (ROOT_DOMAIN.length + 1))
    : null;
  if (!slug) return next();

  const { rows } = await query("SELECT id, name, slug FROM users WHERE slug = $1", [slug]);
  if (rows[0]) req.cloneUser = rows[0];
  next();
}));

// Subdomain-based endpoints — no userId needed in the path, resolved from the Host header.
app.get("/api/me", (req, res) => {
  if (!req.cloneUser) return res.status(404).json({ error: "no clone found for this subdomain" });
  res.json(req.cloneUser);
});

app.post("/api/me/chat", wrapAsync(async (req, res) => {
  if (!req.cloneUser) return res.status(404).json({ error: "no clone found for this subdomain" });
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "message required" });
  const reply = await handleChat(req.cloneUser.id, message);
  res.json({ reply });
}));

// --- Profile answers ---------------------------------------------------

app.post("/api/profile/:userId", wrapAsync(async (req, res) => {
  const { userId } = req.params;
  const { key, value } = req.body;
  if (!key || !value) return res.status(400).json({ error: "key and value required" });

  await query(
    `INSERT INTO profile_answers (user_id, key, value, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id, key) DO UPDATE SET value = $3, updated_at = now()`,
    [userId, key, value]
  );
  res.json({ ok: true });
}));

app.get("/api/profile/:userId", wrapAsync(async (req, res) => {
  const { rows } = await query(
    "SELECT key, value FROM profile_answers WHERE user_id = $1",
    [req.params.userId]
  );
  const profile = {};
  rows.forEach((r) => (profile[r.key] = r.value));
  res.json(profile);
}));

// --- Personality (Big Five) --------------------------------------------

app.post("/api/personality/:userId", wrapAsync(async (req, res) => {
  const { userId } = req.params;
  const { scores } = req.body; // { O: 3.5, C: 4.0, E: 2.5, A: 4.5, N: 2.0 }
  if (!scores) return res.status(400).json({ error: "scores required" });

  const entries = Object.entries(scores);
  for (const [trait, score] of entries) {
    await query(
      `INSERT INTO personality (user_id, trait, score, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id, trait) DO UPDATE SET score = $3, updated_at = now()`,
      [userId, trait, score]
    );
  }
  res.json({ ok: true });
}));

app.get("/api/personality/:userId", wrapAsync(async (req, res) => {
  const { rows } = await query(
    "SELECT trait, score FROM personality WHERE user_id = $1",
    [req.params.userId]
  );
  const scores = {};
  rows.forEach((r) => (scores[r.trait] = Number(r.score)));
  res.json(scores);
}));

// --- Chat ----------------------------------------------------------------

async function buildSystemPrompt(userId) {
  const { rows: profileRows } = await query(
    "SELECT key, value FROM profile_answers WHERE user_id = $1",
    [userId]
  );
  const profile = {};
  profileRows.forEach((r) => (profile[r.key] = r.value));

  const { rows: traitRows } = await query(
    "SELECT trait, score FROM personality WHERE user_id = $1",
    [userId]
  );
  const traitSummary = traitRows
    .map((r) => `${TRAIT_LABELS[r.trait] || r.trait} ${Number(r.score).toFixed(1)}`)
    .join(", ");

  return `You are ${profile.name || "the user"}'s personal reflective journaling companion — a clone of their voice, values, and current focus, built from an interview they completed.

Their profile:
Background: ${profile.background || "not provided"}
Current goals: ${profile.goals || "not provided"}
Core values: ${profile.values || "not provided"}
Strengths: ${profile.skills || "not provided"}
Five-year aspirations: ${profile.aspirations || "not provided"}
Self-described communication style: ${profile.voice || "not provided"}

Personality (Big Five, 1-5 scale, higher = more of the trait): ${traitSummary || "not yet assessed"}.

Your role is to be a warm, reflective conversational partner for their journaling practice. Ask thoughtful follow-up questions, gently mirror back patterns you notice across what they've told you, and match the tone of their described communication style. Keep responses conversational and fairly short. Never invent facts about them beyond this profile or what they tell you in conversation.`;
}

async function handleChat(userId, message) {
  await query(
    "INSERT INTO messages (user_id, role, content) VALUES ($1, 'user', $2)",
    [userId, message]
  );

  const { rows: history } = await query(
    "SELECT role, content FROM messages WHERE user_id = $1 ORDER BY created_at ASC",
    [userId]
  );

  const system = await buildSystemPrompt(userId);
  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1000,
    system,
    messages: history.map((m) => ({ role: m.role, content: m.content })),
  });

  const reply = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  await query(
    "INSERT INTO messages (user_id, role, content) VALUES ($1, 'assistant', $2)",
    [userId, reply]
  );

  return reply;
}

app.post("/api/chat/:userId", wrapAsync(async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "message required" });
  const reply = await handleChat(req.params.userId, message);
  res.json({ reply });
}));

app.get("/api/chat/:userId", wrapAsync(async (req, res) => {
  const { rows } = await query(
    "SELECT role, content, created_at FROM messages WHERE user_id = $1 ORDER BY created_at ASC",
    [req.params.userId]
  );
  res.json(rows);
}));

// --- Health check (for debugging deploys separately from the app logic) ---

app.get("/healthz", (req, res) => res.json({ ok: true }));

// --- Static frontend (served identically on every subdomain) -----------

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- Error handler (must be last) ---------------------------------------
// Catches anything passed to next(err) by wrapAsync, logs it, and returns a
// normal 500 response instead of letting the failure crash the process.
app.use((err, req, res, next) => {
  console.error("Request failed:", err);
  res.status(500).json({ error: "Something went wrong. Check the server logs." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Reflection backend listening on ${PORT}`));
