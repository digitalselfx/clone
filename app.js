const INTERVIEW = [
  { key: "name", prompt: "What should your clone call you?", placeholder: "Your name" },
  { key: "background", prompt: "Give me the short version of your story — where you're from, what you do, how you got here.", placeholder: "A few sentences about your background..." },
  { key: "goals", prompt: "What are you working toward right now, personally or professionally?", placeholder: "What you're building toward..." },
  { key: "values", prompt: "What matters most to you — the principles you try not to compromise on?", placeholder: "The things you won't budge on..." },
  { key: "skills", prompt: "What are you genuinely good at?", placeholder: "Your real strengths..." },
  { key: "aspirations", prompt: "If things go well, where are you in five years?", placeholder: "The version of your life you're aiming for..." },
  { key: "voice", prompt: "How would a close friend describe the way you talk — direct, warm, dry humor, something else?", placeholder: "Your communication style..." },
];

const TRAITS = [
  { key: "O", label: "Openness" },
  { key: "C", label: "Conscientiousness" },
  { key: "E", label: "Extraversion" },
  { key: "A", label: "Agreeableness" },
  { key: "N", label: "Neuroticism" },
];

const STATEMENTS = [
  { trait: "O", text: "I enjoy exploring new ideas even if they upend how I usually think." },
  { trait: "O", text: "I'm drawn to novelty over routine." },
  { trait: "C", text: "I follow through on plans once I've made them." },
  { trait: "C", text: "I keep my commitments organized and rarely let things slip." },
  { trait: "E", text: "Being around people energizes me more than it drains me." },
  { trait: "E", text: "I speak up readily in group settings." },
  { trait: "A", text: "I go out of my way to consider how others are feeling." },
  { trait: "A", text: "I find it easy to trust people's intentions." },
  { trait: "N", text: "Small setbacks can throw off my mood for a while." },
  { trait: "N", text: "I tend to worry about things before they happen." },
];

const SCALE = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"];
const TOTAL_NODES = INTERVIEW.length + TRAITS.length;
const BOOTSTRAP_MESSAGE = "Begin our first reflection session.";

const state = {
  phase: "loading",       // loading | claim | interview | assessment | chat
  user: null,             // { id, name, slug }
  qIndex: 0,
  draft: "",
  sIndex: 0,
  scores: {},             // { O: [..], C: [..], ... } while assessing
  messages: [],
  chatDraft: "",
  loading: false,
  claimName: "",
};

const app = document.getElementById("app");

// --- API helpers ---------------------------------------------------------

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok && res.status !== 404) throw new Error(`API error ${res.status} on ${path}`);
  return res;
}

function getSlugFromHost() {
  const host = window.location.hostname;
  const parts = host.split(".");
  // e.g. vladimir.digital-selfx.com -> 3 parts, slug is parts[0]
  // localhost or the bare root domain -> no slug
  return parts.length >= 3 ? parts[0] : null;
}

// --- Boot ------------------------------------------------------------------

async function boot() {
  const params = new URLSearchParams(window.location.search);
  const prefillName = params.get("name") || "";

  const meRes = await api("/api/me");
  if (meRes.status === 404) {
    state.phase = "claim";
    state.claimName = prefillName;
    render();
    return;
  }
  const user = await meRes.json();
  state.user = user;

  const [profileRes, personalityRes] = await Promise.all([
    api(`/api/profile/${user.id}`),
    api(`/api/personality/${user.id}`),
  ]);
  const profile = await profileRes.json();
  const personality = await personalityRes.json();

  const answeredCount = INTERVIEW.filter((q) => profile[q.key]).length;
  const traitCount = Object.keys(personality).length;

  if (answeredCount < INTERVIEW.length) {
    state.phase = "interview";
    state.qIndex = answeredCount;
  } else if (traitCount < TRAITS.length) {
    state.phase = "assessment";
    state.sIndex = 0;
  } else {
    state.phase = "chat";
    const chatRes = await api(`/api/chat/${user.id}`);
    const history = await chatRes.json();
    state.messages = history
      .filter((m) => !(m.role === "user" && m.content === BOOTSTRAP_MESSAGE))
      .map((m) => ({ role: m.role, content: m.content }));
    if (state.messages.length === 0) {
      state.loading = true;
      render();
      const reply = await sendMessage(BOOTSTRAP_MESSAGE);
      state.messages = [{ role: "assistant", content: reply }];
      state.loading = false;
    }
  }
  render();
}

async function claimSubdomain() {
  const slug = getSlugFromHost();
  if (!slug || !state.claimName.trim()) return;
  const res = await api("/api/users", {
    method: "POST",
    body: JSON.stringify({ name: state.claimName.trim(), slug }),
  });
  const user = await res.json();
  state.user = user;
  state.phase = "interview";
  state.qIndex = 0;
  render();
}

// --- Interview ---------------------------------------------------------

async function submitAnswer() {
  if (!state.draft.trim()) return;
  const key = INTERVIEW[state.qIndex].key;
  await api(`/api/profile/${state.user.id}`, {
    method: "POST",
    body: JSON.stringify({ key, value: state.draft.trim() }),
  });
  state.draft = "";
  if (state.qIndex + 1 < INTERVIEW.length) {
    state.qIndex += 1;
  } else {
    state.phase = "assessment";
  }
  render();
}

// --- Assessment ---------------------------------------------------------

async function submitRating(value) {
  const stmt = STATEMENTS[state.sIndex];
  state.scores[stmt.trait] = [...(state.scores[stmt.trait] || []), value];
  if (state.sIndex + 1 < STATEMENTS.length) {
    state.sIndex += 1;
    render();
  } else {
    const averages = {};
    TRAITS.forEach((t) => {
      const vals = state.scores[t.key] || [];
      averages[t.key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 3;
    });
    await api(`/api/personality/${state.user.id}`, {
      method: "POST",
      body: JSON.stringify({ scores: averages }),
    });
    state.phase = "chat";
    state.loading = true;
    render();
    const reply = await sendMessage(BOOTSTRAP_MESSAGE);
    state.messages = [{ role: "assistant", content: reply }];
    state.loading = false;
    render();
  }
}

// --- Chat ---------------------------------------------------------

async function sendMessage(message) {
  const res = await api("/api/me/chat", {
    method: "POST",
    body: JSON.stringify({ message }),
  });
  const data = await res.json();
  return data.reply;
}

async function sendChat() {
  if (!state.chatDraft.trim() || state.loading) return;
  const message = state.chatDraft.trim();
  state.messages.push({ role: "user", content: message });
  state.chatDraft = "";
  state.loading = true;
  render();
  const reply = await sendMessage(message);
  state.messages.push({ role: "assistant", content: reply });
  state.loading = false;
  render();
}

// --- Rendering ---------------------------------------------------------

function constellationSVG(filled) {
  const nodes = Array.from({ length: TOTAL_NODES }, (_, i) => {
    const angle = (i / TOTAL_NODES) * Math.PI * 2 - Math.PI / 2;
    const r = 74 + (i % 3) * 10;
    return { x: 100 + r * Math.cos(angle), y: 100 + r * Math.sin(angle), lit: i < filled };
  });
  let lines = "";
  nodes.forEach((n, i) => {
    nodes.slice(i + 1).forEach((m) => {
      const dist = Math.hypot(n.x - m.x, n.y - m.y);
      if (dist > 70) return;
      const bothLit = n.lit && m.lit;
      lines += `<line x1="${n.x}" y1="${n.y}" x2="${m.x}" y2="${m.y}" stroke="${bothLit ? "#C9A15A" : "#2A2F3D"}" stroke-width="${bothLit ? 0.8 : 0.5}" opacity="${bothLit ? 0.6 : 0.4}" />`;
    });
  });
  const circles = nodes
    .map((n) => `<circle cx="${n.x}" cy="${n.y}" r="${n.lit ? 4.5 : 3}" fill="${n.lit ? "#C9A15A" : "#3A4054"}" />`)
    .join("");
  return `<svg viewBox="0 0 200 200" style="width:100%;max-width:220px;">
    ${lines}${circles}
    <circle cx="100" cy="100" r="30" fill="none" stroke="#7C9885" stroke-width="1" opacity="0.5" />
    <circle cx="100" cy="100" r="6" fill="#7C9885" />
  </svg>`;
}

function progressLabel() {
  switch (state.phase) {
    case "claim": return "Claim this clone";
    case "interview": return `Interview · ${state.qIndex + 1} of ${INTERVIEW.length}`;
    case "assessment": return `Personality · ${state.sIndex + 1} of ${STATEMENTS.length}`;
    case "chat": return "Profile complete — in conversation";
    default: return "Loading…";
  }
}

function filledCount() {
  if (state.phase === "interview") return state.qIndex;
  if (state.phase === "assessment") return INTERVIEW.length;
  if (state.phase === "chat") return TOTAL_NODES;
  return 0;
}

function render() {
  app.innerHTML = `
    <div class="page">
      <div class="sidebar">
        <div class="brand">reflect</div>
        ${constellationSVG(filledCount())}
        <div class="progress-label">${progressLabel()}</div>
      </div>
      <div class="main">${renderMain()}</div>
    </div>
  `;
  attachHandlers();
}

function renderMain() {
  if (state.phase === "loading") {
    return `<div class="center-column fade-in"><p class="lead">Loading your clone…</p></div>`;
  }

  if (state.phase === "claim") {
    return `
      <div class="center-column fade-in">
        <h1>This name is unclaimed.</h1>
        <p class="lead">You're the first to visit ${window.location.hostname}. Tell it your name to start building your clone.</p>
        <label class="field-label">Your name</label>
        <input class="text-input" id="claim-name" placeholder="Your name" value="${state.claimName}" />
        <button class="btn-primary" id="claim-btn" ${!state.claimName.trim() ? "disabled" : ""}>Claim and begin</button>
      </div>
    `;
  }

  if (state.phase === "interview") {
    const q = INTERVIEW[state.qIndex];
    return `
      <div class="center-column fade-in">
        <div class="eyebrow">Question ${state.qIndex + 1} of ${INTERVIEW.length}</div>
        <h2>${q.prompt}</h2>
        <textarea class="field" id="answer-field" rows="4" placeholder="${q.placeholder}">${state.draft}</textarea>
        <div class="row-between">
          <span class="hint">⌘/Ctrl + Enter to continue</span>
          <button class="btn-primary" id="answer-btn" ${!state.draft.trim() ? "disabled" : ""}>
            ${state.qIndex + 1 < INTERVIEW.length ? "Continue" : "Finish interview"}
          </button>
        </div>
      </div>
    `;
  }

  if (state.phase === "assessment") {
    const s = STATEMENTS[state.sIndex];
    return `
      <div class="center-column fade-in">
        <div class="eyebrow">Personality check-in · ${state.sIndex + 1} of ${STATEMENTS.length}</div>
        <h2>${s.text}</h2>
        <div class="scale-row">
          ${SCALE.map((label, i) => `
            <button class="scale-btn" data-rating="${i + 1}">
              <span class="scale-dot"></span>${label}
            </button>
          `).join("")}
        </div>
      </div>
    `;
  }

  if (state.phase === "chat") {
    const bubbles = state.messages
      .map(
        (m) => `
        <div class="bubble ${m.role === "assistant" ? "bubble-clone" : "bubble-user"} fade-in">
          <div class="bubble-label">${m.role === "assistant" ? "your clone" : "you"}</div>
          ${escapeHTML(m.content)}
        </div>`
      )
      .join("");
    return `
      <div class="chat-column">
        <div class="chat-scroll" id="chat-scroll">
          ${bubbles}
          ${state.loading ? `<div class="bubble bubble-clone"><div class="bubble-label">your clone</div>···</div>` : ""}
        </div>
        <div class="chat-input-row">
          <input class="chat-input" id="chat-field" placeholder="Write what's on your mind…" value="${state.chatDraft}" />
          <button class="btn-primary" id="chat-send" ${state.loading || !state.chatDraft.trim() ? "disabled" : ""}>Send</button>
        </div>
      </div>
    `;
  }

  return "";
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function attachHandlers() {
  if (state.phase === "claim") {
    const nameField = document.getElementById("claim-name");
    nameField?.addEventListener("input", (e) => {
      state.claimName = e.target.value;
      document.getElementById("claim-btn").disabled = !state.claimName.trim();
    });
    document.getElementById("claim-btn")?.addEventListener("click", claimSubdomain);
  }

  if (state.phase === "interview") {
    const field = document.getElementById("answer-field");
    field?.focus();
    field?.addEventListener("input", (e) => {
      state.draft = e.target.value;
      document.getElementById("answer-btn").disabled = !state.draft.trim();
    });
    field?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitAnswer();
    });
    document.getElementById("answer-btn")?.addEventListener("click", submitAnswer);
  }

  if (state.phase === "assessment") {
    document.querySelectorAll(".scale-btn").forEach((btn) => {
      btn.addEventListener("click", () => submitRating(Number(btn.dataset.rating)));
    });
  }

  if (state.phase === "chat") {
    const scroll = document.getElementById("chat-scroll");
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
    const field = document.getElementById("chat-field");
    field?.addEventListener("input", (e) => {
      state.chatDraft = e.target.value;
      document.getElementById("chat-send").disabled = state.loading || !state.chatDraft.trim();
    });
    field?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendChat();
    });
    document.getElementById("chat-send")?.addEventListener("click", sendChat);
  }
}

boot();
