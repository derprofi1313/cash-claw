// Cash-Claw Dashboard – Inline HTML/CSS/JS served from HttpGateway
// Clean/Modern theme with live WebSocket updates

export function getDashboardHtml(port: number, authToken: string | null): string {
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cash-Claw Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#f8f9fc;--card:#fff;--border:#e5e7eb;--text:#1f2937;--muted:#6b7280;
--accent:#4f46e5;--accent-light:#eef2ff;--green:#10b981;--red:#ef4444;--orange:#f59e0b;
--shadow:0 1px 3px rgba(0,0,0,.08);--radius:12px;font-size:15px}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;min-height:100vh}
header{background:var(--card);border-bottom:1px solid var(--border);padding:16px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10}
header h1{font-size:1.25rem;font-weight:700;display:flex;align-items:center;gap:8px}
header h1 span{font-size:1.5rem}
.status-dot{width:10px;height:10px;border-radius:50%;display:inline-block;margin-left:8px}
.status-dot.ok{background:var(--green)}.status-dot.off{background:var(--red)}.status-dot.paused{background:var(--orange)}
.header-right{display:flex;align-items:center;gap:12px;font-size:.85rem;color:var(--muted)}
main{max-width:1280px;margin:0 auto;padding:24px;display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:20px}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:20px;box-shadow:var(--shadow)}
.card h2{font-size:.9rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:12px;display:flex;align-items:center;gap:6px}
.card h2 .icon{font-size:1.1rem}
.metric{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px}
.metric .label{color:var(--muted);font-size:.85rem}
.metric .value{font-size:1.3rem;font-weight:700}
.metric .value.green{color:var(--green)}.metric .value.red{color:var(--red)}.metric .value.accent{color:var(--accent)}
.pill{display:inline-block;padding:2px 10px;border-radius:20px;font-size:.75rem;font-weight:600}
.pill.running{background:#d1fae5;color:#065f46}.pill.paused{background:#fef3c7;color:#92400e}.pill.stopped{background:#fee2e2;color:#991b1b}
.task-list{list-style:none;max-height:260px;overflow-y:auto}
.task-list li{padding:8px 0;border-bottom:1px solid var(--border);font-size:.85rem;display:flex;justify-content:space-between;align-items:center}
.task-list li:last-child{border-bottom:none}
.task-list .task-status{font-size:.7rem;padding:2px 8px;border-radius:12px}
.task-list .task-status.ok{background:#d1fae5;color:#065f46}.task-list .task-status.fail{background:#fee2e2;color:#991b1b}
.tool-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}
.tool-chip{background:var(--accent-light);color:var(--accent);padding:6px 10px;border-radius:8px;font-size:.78rem;font-weight:500;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.skill-item{padding:8px 0;border-bottom:1px solid var(--border);font-size:.85rem}
.skill-item:last-child{border-bottom:none}
.skill-item .revenue{color:var(--green);font-weight:600;float:right}
.controls{display:flex;gap:8px;flex-wrap:wrap}
.btn{padding:8px 16px;border:1px solid var(--border);border-radius:8px;background:var(--card);cursor:pointer;font-size:.82rem;font-weight:500;transition:all .15s}
.btn:hover{background:var(--accent-light);border-color:var(--accent);color:var(--accent)}
.btn.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
.btn.primary:hover{opacity:.9}
.btn.danger{color:var(--red);border-color:var(--red)}
.btn.danger:hover{background:#fee2e2}
.log-box{background:#f1f5f9;border-radius:8px;padding:12px;font-family:'Fira Code',monospace;font-size:.75rem;max-height:200px;overflow-y:auto;color:var(--muted);line-height:1.6}
.log-box .event{color:var(--accent)}.log-box .error{color:var(--red)}.log-box .ok{color:var(--green)}
.ws-status{font-size:.75rem;padding:3px 10px;border-radius:12px;font-weight:600}
.ws-status.connected{background:#d1fae5;color:#065f46}.ws-status.disconnected{background:#fee2e2;color:#991b1b}
.full-width{grid-column:1/-1}
@media(max-width:720px){main{grid-template-columns:1fr;padding:12px}header{padding:12px 16px}}
</style>
</head>
<body>
<header>
  <h1><span>🦀</span> Cash-Claw <span class="status-dot off" id="agentDot"></span></h1>
  <div class="header-right">
    <span id="uptimeLabel">Uptime: --</span>
    <span class="ws-status disconnected" id="wsStatus">Disconnected</span>
  </div>
</header>
<main>
  <!-- Agent Status -->
  <div class="card">
    <h2><span class="icon">📊</span> Agent Status</h2>
    <div class="metric"><span class="label">Status</span><span id="agentState" class="pill stopped">Offline</span></div>
    <div class="metric"><span class="label">Zyklen heute</span><span class="value accent" id="cycleCount">0</span></div>
    <div class="metric"><span class="label">Aktionen heute</span><span class="value" id="actionsToday">0</span></div>
    <div class="metric"><span class="label">Letzter Plan</span><span class="value" style="font-size:.9rem" id="lastPlan">--</span></div>
  </div>

  <!-- Costs -->
  <div class="card">
    <h2><span class="icon">💰</span> Kosten</h2>
    <div class="metric"><span class="label">Heute</span><span class="value red" id="costToday">$0.00</span></div>
    <div class="metric"><span class="label">Verbleibend</span><span class="value green" id="costRemaining">$0.00</span></div>
    <div class="metric"><span class="label">API Calls</span><span class="value" id="totalCalls">0</span></div>
    <div class="metric"><span class="label">Token (In/Out)</span><span class="value" style="font-size:.9rem" id="tokenCount">0 / 0</span></div>
  </div>

  <!-- Current Task -->
  <div class="card">
    <h2><span class="icon">⚡</span> Aktuelle Aufgabe</h2>
    <div id="currentTask" style="font-size:.9rem;color:var(--muted)">Keine aktive Aufgabe</div>
  </div>

  <!-- Controls -->
  <div class="card">
    <h2><span class="icon">🎮</span> Steuerung</h2>
    <div class="controls">
      <button class="btn primary" onclick="doAction('cycle')">▶ Zyklus starten</button>
      <button class="btn" onclick="doAction('pause')">⏸ Pause</button>
      <button class="btn" onclick="doAction('resume')">▶ Fortsetzen</button>
      <button class="btn" onclick="doAction('reflect')">🔍 Reflexion</button>
      <button class="btn danger" onclick="doAction('stop')">⏹ Stoppen</button>
    </div>
    <div style="margin-top:12px">
      <div style="display:flex;gap:8px">
        <input id="chatInput" type="text" placeholder="Nachricht an Agent..." style="flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:.85rem" onkeydown="if(event.key==='Enter')sendChat()">
        <button class="btn primary" onclick="sendChat()">Senden</button>
      </div>
      <div id="chatReply" style="margin-top:8px;font-size:.82rem;color:var(--muted);display:none"></div>
    </div>
  </div>

  <!-- Completed Tasks -->
  <div class="card">
    <h2><span class="icon">✅</span> Erledigte Aufgaben</h2>
    <ul class="task-list" id="taskList"><li style="color:var(--muted)">Keine Aufgaben</li></ul>
  </div>

  <!-- Skills -->
  <div class="card">
    <h2><span class="icon">🎯</span> Skills</h2>
    <div id="skillList" style="color:var(--muted);font-size:.85rem">Lade...</div>
  </div>

  <!-- Tools -->
  <div class="card full-width">
    <h2><span class="icon">🔧</span> Tools <span id="toolCount" style="font-weight:400;color:var(--muted)">(0)</span></h2>
    <div class="tool-grid" id="toolGrid">Lade...</div>
  </div>

  <!-- Live Log -->
  <div class="card full-width">
    <h2><span class="icon">📋</span> Live Events</h2>
    <div class="log-box" id="logBox">Warte auf Verbindung...</div>
  </div>
</main>

<script>
const PORT = ${port};
const AUTH = ${authToken ? JSON.stringify(authToken) : "null"};
const BASE = "http://127.0.0.1:" + PORT;
let ws = null;
let reconnectTimer = null;

function $(id) { return document.getElementById(id); }

function formatTime(iso) {
  if (!iso) return "--";
  const d = new Date(iso);
  return d.toLocaleTimeString("de-DE", {hour:"2-digit",minute:"2-digit",second:"2-digit"});
}

function formatUptime(s) {
  const h = Math.floor(s/3600);
  const m = Math.floor((s%3600)/60);
  return h > 0 ? h+"h "+m+"m" : m+"m";
}

function log(text, cls) {
  const box = $("logBox");
  const line = document.createElement("div");
  line.className = cls || "";
  line.textContent = "[" + new Date().toLocaleTimeString("de-DE") + "] " + text;
  box.appendChild(line);
  if (box.children.length > 200) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
}

function headers() {
  const h = {"Content-Type":"application/json"};
  if (AUTH) h["Authorization"] = "Bearer " + AUTH;
  return h;
}

// ─── REST helpers ─────────────────────────────────────────
async function fetchJson(path) {
  const r = await fetch(BASE + path, {headers: headers()});
  return r.json();
}

async function loadState() {
  try {
    const s = await fetchJson("/api/state");
    updateState(s);
  } catch(e) { log("State-Fehler: " + e.message, "error"); }
}

async function loadCosts() {
  try {
    const c = await fetchJson("/api/costs");
    updateCosts(c);
  } catch(e) { log("Kosten-Fehler: " + e.message, "error"); }
}

async function loadTools() {
  try {
    const t = await fetchJson("/api/tools");
    $("toolCount").textContent = "(" + t.total + ")";
    $("toolGrid").innerHTML = t.tools.map(function(tool) {
      return '<div class="tool-chip" title="' + tool.description + '">' + tool.name + '</div>';
    }).join("");
  } catch(e) { log("Tools-Fehler: " + e.message, "error"); }
}

async function loadSkills() {
  try {
    const s = await fetchJson("/api/skills");
    if (!s.skills || s.skills.length === 0) {
      $("skillList").innerHTML = '<span style="color:var(--muted)">Keine Skills konfiguriert</span>';
      return;
    }
    $("skillList").innerHTML = s.skills.map(function(sk) {
      return '<div class="skill-item">' + sk.name + ' <span class="revenue">~€' + (sk.estimatedRevenue||0) + '</span><br><small style="color:var(--muted)">' + sk.description + '</small></div>';
    }).join("");
  } catch(e) { log("Skills-Fehler: " + e.message, "error"); }
}

function updateState(s) {
  const dot = $("agentDot");
  const label = $("agentState");
  if (s.running && !s.paused) {
    dot.className = "status-dot ok";
    label.className = "pill running";
    label.textContent = "Running";
  } else if (s.paused) {
    dot.className = "status-dot paused";
    label.className = "pill paused";
    label.textContent = "Paused";
  } else {
    dot.className = "status-dot off";
    label.className = "pill stopped";
    label.textContent = "Stopped";
  }
  $("cycleCount").textContent = s.cycleCount || 0;
  $("actionsToday").textContent = s.actionsToday || 0;
  $("lastPlan").textContent = formatTime(s.lastPlanTime);
  $("costToday").textContent = "$" + (s.costToday || 0).toFixed(4);

  if (s.currentTask) {
    $("currentTask").innerHTML = '<strong>' + s.currentTask.title + '</strong><br><small style="color:var(--muted)">' + (s.currentTask.type||"task") + '</small>';
  } else {
    $("currentTask").innerHTML = '<span style="color:var(--muted)">Keine aktive Aufgabe</span>';
  }

  if (s.tasksCompleted && s.tasksCompleted.length > 0) {
    $("taskList").innerHTML = s.tasksCompleted.slice(-15).reverse().map(function(t) {
      return '<li>' + t.title + ' <span class="task-status ' + (t.success?"ok":"fail") + '">' + (t.success?"✓":"✗") + '</span></li>';
    }).join("");
  }
}

function updateCosts(c) {
  $("costToday").textContent = "$" + (c.todayCost || 0).toFixed(4);
  $("costRemaining").textContent = "$" + (c.remaining || 0).toFixed(2);
  $("totalCalls").textContent = c.session?.totalCalls || 0;
  $("tokenCount").textContent = ((c.session?.totalInputTokens||0)/1000).toFixed(1) + "k / " + ((c.session?.totalOutputTokens||0)/1000).toFixed(1) + "k";
}

async function doAction(action) {
  try {
    await fetch(BASE + "/api/control", {method:"POST", headers: headers(), body: JSON.stringify({action: action})});
    log("Aktion: " + action, "ok");
    setTimeout(loadState, 500);
  } catch(e) { log("Aktion fehlgeschlagen: " + e.message, "error"); }
}

async function sendChat() {
  const input = $("chatInput");
  const msg = input.value.trim();
  if (!msg) return;
  input.value = "";
  $("chatReply").style.display = "block";
  $("chatReply").textContent = "Sende...";
  try {
    const r = await fetch(BASE + "/api/chat", {method:"POST", headers: headers(), body: JSON.stringify({message: msg})});
    const d = await r.json();
    $("chatReply").textContent = d.reply || d.error || "Keine Antwort";
  } catch(e) { $("chatReply").textContent = "Fehler: " + e.message; }
}

// ─── WebSocket ────────────────────────────────────────────
function connectWs() {
  if (ws && ws.readyState <= 1) return;
  ws = new WebSocket("ws://127.0.0.1:" + PORT + "/ws");

  ws.onopen = function() {
    $("wsStatus").className = "ws-status connected";
    $("wsStatus").textContent = "Live";
    log("WebSocket verbunden", "ok");
    // Handshake
    ws.send(JSON.stringify({type:"connect", version:1, token: AUTH || undefined}));
  };

  ws.onmessage = function(evt) {
    try {
      const msg = JSON.parse(evt.data);
      if (msg.type === "event") {
        handleEvent(msg);
      }
    } catch(e) {}
  };

  ws.onclose = function() {
    $("wsStatus").className = "ws-status disconnected";
    $("wsStatus").textContent = "Disconnected";
    log("WebSocket getrennt – reconnect in 3s...", "error");
    reconnectTimer = setTimeout(connectWs, 3000);
  };

  ws.onerror = function() {};
}

function handleEvent(msg) {
  const evt = msg.event;
  const p = msg.payload || {};
  switch(evt) {
    case "cycle_start":
      log("Zyklus gestartet (#" + (p.cycle||"?") + ")", "event");
      break;
    case "plan_complete":
      log("Plan erstellt: " + (p.taskCount||0) + " Aufgaben", "event");
      break;
    case "task_start":
      log("Aufgabe: " + (p.title||"?"), "event");
      break;
    case "task_complete":
      log("Erledigt: " + (p.title||"?") + " " + (p.success?"✓":"✗"), p.success?"ok":"error");
      break;
    case "review_complete":
      log("Review abgeschlossen", "event");
      break;
    case "cost_update":
      $("costToday").textContent = "$" + (p.todayCost||0).toFixed(4);
      break;
    default:
      log(evt + ": " + JSON.stringify(p), "event");
  }
  // Refresh state on relevant events
  if (["cycle_start","task_complete","review_complete","plan_complete"].includes(evt)) {
    loadState();
    loadCosts();
  }
}

// ─── Init ─────────────────────────────────────────────────
(function init() {
  loadState();
  loadCosts();
  loadTools();
  loadSkills();
  connectWs();
  // Periodic refresh
  setInterval(function() {
    loadState();
    loadCosts();
    $("uptimeLabel").textContent = "Uptime: " + formatUptime(performance.now()/1000);
  }, 10000);

  // Refresh uptime from /health
  fetchJson("/health").then(function(h) {
    $("uptimeLabel").textContent = "Uptime: " + formatUptime(h.uptime || 0);
  }).catch(function(){});
})();
</script>
</body>
</html>`;
}
