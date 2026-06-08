let stack = ["root"];
function role() { return document.getElementById("role").value; }

async function load(nodeId) {
  const r = await fetch(`/report/${nodeId}?role=${role()}`);
  render(nodeId, await r.json());
}

function render(nodeId, rep) {
  document.getElementById("crumb").textContent = stack.join("  >  ");
  const el = document.getElementById("report");
  if (!rep) { el.textContent = "No report yet."; return; }
  el.innerHTML =
    `<h2>${nodeId} <span class="sev">[${rep.severity.toUpperCase()}]</span></h2>` +
    `<p>${rep.overall}</p><h4>Top drivers</h4>` +
    rep.drivers.map(d => `<div class="driver" onclick="drill('${d.node_id}')">${d.line} &rsaquo;</div>`).join("");
}

function drill(nodeId) { if (!nodeId) return; stack.push(nodeId); load(nodeId); }

async function simulate(kind) {
  await fetch("/simulate-change", { method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ kind }) });
  stack = ["root"]; load("root");
}

function reload() { load(stack[stack.length - 1]); }

function boot() {
  try {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onmessage = () => reload();
  } catch (e) { /* mock server has no ws; ignore */ }
  load("root");
}
