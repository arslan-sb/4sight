let treeData = null;
let expanded = new Set();
let currentRole = "reviewer";

function role() { return document.getElementById("role").value; }

function sevDot(severity) {
  if (!severity) return "sev-dot-none";
  const map = {critical:"sev-dot-critical", high:"sev-dot-high", medium:"sev-dot-medium", low:"sev-dot-low"};
  return map[severity] || "sev-dot-none";
}

function sevClass(severity) {
  const map = {critical:"sev-critical", high:"sev-high", medium:"sev-medium", low:"sev-low"};
  return map[severity] || "";
}

async function loadTree() {
  const r = await fetch(`/graph-data?role=${role()}`);
  treeData = await r.json();
}

function buildNode(nodeId, depth) {
  if (!treeData || !treeData[nodeId]) return "";
  const n = treeData[nodeId];
  const isExpanded = expanded.has(nodeId);
  const hasChildren = (n.children || []).length > 0;
  const dot = sevDot(n.severity);
  const deps = (n.dependencies || []).filter(d => d !== nodeId);
  const title = n.title || nodeId;

  let html = `<div class="node" onclick="nodeClick(event, '${nodeId}')" data-node="${nodeId}">
    <span class="expand">${hasChildren ? (isExpanded ? "&#9660;" : "&#9654;") : ""}</span>
    <span class="sev-dot ${dot}"></span>
    <span class="node-label">${title} <span class="node-kind">${n.kind || ""}</span></span>`;

  if (deps.length) {
    deps.forEach(d => {
      const depTitle = treeData[d] ? treeData[d].title : d;
      html += `<span class="dep-tag" title="Depends on: ${depTitle}" onclick="event.stopPropagation();nodeClick(event,'${d}')">&#8594; ${depTitle}</span>`;
    });
  }
  html += `</div>`;

  if (hasChildren && isExpanded) {
    html += `<div class="children">`;
    n.children.forEach(c => { html += buildNode(c, depth + 1); });
    html += `</div>`;
  }
  return html;
}

function renderTree(rootId) {
  document.getElementById("crumb").textContent = rootId === "fab17_output"
    ? "Graph root: Fab 17 Output" : `Focus: ${rootId}`;
  const el = document.getElementById("tree");
  el.innerHTML = buildNode(rootId, 0);
}

async function nodeClick(ev, nodeId) {
  const n = treeData[nodeId];
  const hasChildren = (n.children || []).length > 0;

  if (hasChildren) {
    if (expanded.has(nodeId)) {
      expanded.delete(nodeId);
    } else {
      expanded.add(nodeId);
    }
    renderTree("fab17_output");
  }

  // Load report detail
  const r = await fetch(`/report/${nodeId}?role=${role()}`);
  const rep = await r.json();
  const det = document.getElementById("detail");
  if (!rep) { det.style.display = "none"; return; }
  det.style.display = "block";
  const sc = sevClass(rep.severity);
  det.innerHTML = `<h3>${rep.node_id} <span class="sev ${sc}">${rep.severity.toUpperCase()}</span></h3>
    <p>${rep.overall}</p>
    ${rep.drivers && rep.drivers.length ? "<p style='opacity:0.7;'>Drivers: " + rep.drivers.map(d => d.line).join("; ") + "</p>" : ""}`;
}

function reload() { currentRole = role(); loadTree().then(() => { renderTree("fab17_output"); }); }

function boot() {
  loadTree().then(() => {
    expanded.add("fab17_output");
    expanded.add("eng_ops");
    expanded.add("supply_chain");
    renderTree("fab17_output");
  });
}
