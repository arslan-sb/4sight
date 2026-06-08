let stack = ["root"];
function role() { return document.getElementById("role").value; }

function sevClass(severity) {
  const map = {critical:"sev-critical", high:"sev-high", medium:"sev-medium", low:"sev-low"};
  return map[severity] || "";
}

function drvClass(severity) {
  const map = {critical:"sev-critical", high:"sev-high", medium:"sev-medium", low:"sev-low"};
  return map[severity] || "";
}

async function load(nodeId) {
  const r = await fetch(`/report/${nodeId}?role=${role()}`);
  render(nodeId, await r.json());
}

function render(nodeId, rep) {
  document.getElementById("crumb").textContent = stack.join("  >  ");
  const el = document.getElementById("report");
  if (!rep) { el.innerHTML = "<p>No report yet.</p>"; return; }
  const sc = sevClass(rep.severity);
  el.innerHTML =
    `<h2>${rep.node_id} <span class="sev ${sc}">${rep.severity.toUpperCase()}</span></h2>` +
    `<p style="line-height:1.6;">${rep.overall}</p><h4>Top drivers</h4>` +
    rep.drivers.map(d => {
      const dc = drvClass(d.severity);
      return `<div class="driver" onclick="drill('${d.node_id}')">
        <span>${d.line}</span>
        <span class="driver-sev ${dc}">${d.severity.toUpperCase()}</span>
      </div>`;
    }).join("") +
    (rep.changed_since && rep.changed_since.length
      ? `<p style="opacity:0.6;margin-top:14px;">Changed since: ${rep.changed_since.join(", ")}</p>`
      : "");
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
