let treeData = null;
let path = [];
let rootId = null;

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
  if (!rootId) {
    const rr = await fetch("/root");
    rootId = (await rr.json()).node_id;
  }
}

function renderBreadcrumb() {
  const el = document.getElementById("breadcrumb");
  let html = "";
  path.forEach((nid, i) => {
    const n = treeData[nid] || {title: nid};
    if (i > 0) html += '<span class="sep"> > </span>';
    html += `<span onclick="navigateTo(${i}, '${nid}')">${n.title}</span>`;
  });
  el.innerHTML = html;
}

function navigateTo(index, nid) {
  path = path.slice(0, index + 1);
  renderLayer(nid);
}

function renderLayer(nodeId) {
  const n = treeData[nodeId];
  if (!n) return;

  renderBreadcrumb();

  const layer = document.getElementById("layer");
  const currentDot = sevDot(n.severity);
  const hasChildren = (n.children || []).length > 0;
  const deps = (n.dependencies || []).filter(d => d !== nodeId);

  let html = `
    <div class="layer-title">
      <span class="sev-dot ${currentDot}" style="display:inline-block;vertical-align:middle;margin-right:8px;"></span>
      ${n.title}
      <span class="kind">${n.kind || ""}</span>
      ${n.severity ? `<span class="sev ${sevClass(n.severity)}" style="margin-left:8px;">${n.severity.toUpperCase()}</span>` : ""}
    </div>`;

  if (hasChildren) {
    html += `<p style="font-size:12px;opacity:0.5;margin-bottom:8px;">Decomposition (sub-tasks)</p>`;
    n.children.forEach(cid => {
      const c = treeData[cid];
      if (!c) return;
      const dot = sevDot(c.severity);
      const isLeaf = c.kind === "leaf";
      const hasGrandchildren = (c.children || []).length > 0;
      const canDrill = isLeaf || hasGrandchildren;
      html += `<div class="node-card" onclick="nodeClick('${cid}', ${canDrill})">
        <span class="sev-dot ${dot}"></span>
        <div class="info">
          <span class="title">${c.title}</span>
          <span class="kind">${c.kind || ""}</span>
          ${c.severity ? `<span class="sev ${sevClass(c.severity)}" style="float:right;">${c.severity.toUpperCase()}</span>` : ""}
        </div>
        ${canDrill ? '<span class="arrow">&rsaquo;</span>' : ""}
      </div>`;
    });
  }

  if (deps.length) {
    html += `<div class="dep-section">
      <div class="dep-label">Dependencies (influences this node)</div>`;
    deps.forEach(did => {
      const d = treeData[did];
      if (!d) return;
      const dot = sevDot(d.severity);
      html += `<div class="dep-card" onclick="jumpTo('${did}')">
        <span class="dep-tag">DEP</span>
        <span class="sev-dot ${dot}"></span>
        <div class="info">
          <span class="title">${d.title}</span>
          <span class="kind">${d.kind || ""}</span>
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  if (!hasChildren && !deps.length) {
    html += `<p style="opacity:0.4;">Leaf node. No sub-tasks or dependencies.</p>`;
  }

  layer.innerHTML = html;
  loadDetail(nodeId);
}

async function loadDetail(nodeId) {
  const r = await fetch(`/report/${nodeId}?role=${role()}`);
  const rep = await r.json();
  const det = document.getElementById("detail");
  if (!rep) { det.style.display = "none"; return; }
  det.style.display = "block";
  const sc = sevClass(rep.severity);
  det.innerHTML = `
    <h3>${rep.node_id} <span class="sev ${sc}">${rep.severity.toUpperCase()}</span></h3>
    <p style="line-height:1.5;">${rep.overall}</p>
    ${rep.drivers && rep.drivers.length
      ? "<p style='opacity:0.6;'>Drivers: " + rep.drivers.map(d => d.line).join("; ") + "</p>"
      : ""}`;
}

async function nodeClick(nodeId, canDrill) {
  if (canDrill) {
    path.push(nodeId);
    renderLayer(nodeId);
  } else {
    loadDetail(nodeId);
  }
}

function jumpTo(nodeId) {
  path.push(nodeId);
  renderLayer(nodeId);
}

async function injectAll() {
  const scenarios = [
    {source: "Bunker Fuel Index", node_id: "bunker_fuel", effect_score: 50, kind: "supply"},
    {source: "SUMCO Fab", node_id: "sumco_yield", effect_score: 95, kind: "supply"},
    {source: "Leave Calendar", node_id: "alice_chen", effect_score: 85, kind: "leave"},
    {source: "Warehouse", node_id: "buffer_stock", effect_score: 60, kind: "supply"},
  ];
  for (const s of scenarios) {
    await fetch("/simulate-change", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(s),
    });
  }
  refresh();
}

function refresh() {
  loadTree().then(() => {
    if (!path.length) path = [rootId];
    renderLayer(path[path.length - 1]);
  });
}

function boot() {
  loadTree().then(() => {
    path = [rootId];
    renderLayer(rootId);
  });
}
