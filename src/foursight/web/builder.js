var graph = {nodes:{}, edges:[]};
var nodePositions = {};
var canvas, ctx;
var offsetX=0, offsetY=0, scale=1;
var dragging=null, dragStartX=0, dragStartY=0;
var panning=false, panStartX=0, panStartY=0, panOffX=0, panOffY=0;
var selectedNode=null, contextNode=null;
var NODE_R=28, LEAF_R=20;
var COLORS={critical:"#ff6b6b",high:"#ffb347",medium:"#ffd700",low:"#4caf50",none:"#4a4e56",
  edgeDecomp:"#3a5a3a",edgeDep:"#3a3a6b",bg:"#0a0c10",text:"#e6e6e6"};

function init() {
  canvas=document.getElementById("canvas"); ctx=canvas.getContext("2d");
  resizeCanvas(); window.onresize=resizeCanvas;
  loadGraph();
  canvas.onmousedown=onMouseDown; canvas.onmouseup=onMouseUp;
  canvas.onmousemove=onMouseMove;
  canvas.oncontextmenu=function(e){e.preventDefault();onRightClick(e);};
  document.onclick=function(e){if(e.target===canvas)return;document.getElementById("context-menu").style.display="none";};
}

function resizeCanvas() { canvas.width=window.innerWidth; canvas.height=window.innerHeight-80; draw(); }

function sevColor(s){return COLORS[s]||COLORS.none;}

async function loadGraph() {
  var r=await fetch("/builder/graph"); var d=await r.json();
  d.nodes.forEach(function(n){graph.nodes[n.id]=n;});
  graph.edges=d.edges;
  Object.keys(graph.nodes).forEach(function(nid,i){
    if(!nodePositions[nid]) nodePositions[nid]={x:200+Math.random()*400,y:150+i*90};
  });
  draw();
}

function draw() {
  if(!ctx) return;
  ctx.fillStyle=COLORS.bg; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.save(); ctx.translate(offsetX,offsetY); ctx.scale(scale,scale);

  graph.edges.forEach(function(e){
    var from=nodePositions[e.src], to=nodePositions[e.dst];
    if(!from||!to) return;
    var isDep=e.type==="dependency";
    ctx.strokeStyle=isDep?COLORS.edgeDep:COLORS.edgeDecomp;
    ctx.lineWidth=isDep?1.2:1.8;
    if(isDep) ctx.setLineDash([5,4]); else ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(from.x,from.y+NODE_R); ctx.lineTo(to.x,to.y-NODE_R); ctx.stroke();
    ctx.setLineDash([]);
    var ang=Math.atan2(to.y-from.y,to.x-from.x);
    var ax=to.x-Math.cos(ang)*NODE_R, ay=to.y-Math.sin(ang)*NODE_R, s=7;
    ctx.fillStyle=isDep?COLORS.edgeDep:COLORS.edgeDecomp;
    ctx.beginPath(); ctx.moveTo(ax,ay); ctx.lineTo(ax-s*Math.cos(ang-0.5),ay-s*Math.sin(ang-0.5)); ctx.lineTo(ax-s*Math.cos(ang+0.5),ay-s*Math.sin(ang+0.5)); ctx.closePath(); ctx.fill();
  });

  Object.keys(graph.nodes).forEach(function(nid){
    var n=graph.nodes[nid], pos=nodePositions[nid];
    if(!pos) return;
    var r=n.kind==="task"?NODE_R:LEAF_R, col=sevColor(n.severity);
    var g=ctx.createRadialGradient(pos.x,pos.y,r*0.3,pos.x,pos.y,r*2.2);
    g.addColorStop(0,col+"30"); g.addColorStop(1,"transparent");
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(pos.x,pos.y,r*2.2,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=col; ctx.strokeStyle=col; ctx.lineWidth=nid===selectedNode?3:2;
    ctx.beginPath(); ctx.arc(pos.x,pos.y,r,0,Math.PI*2); ctx.fill(); ctx.stroke();
    if(n.kind==="task"){ctx.fillStyle=COLORS.bg; ctx.beginPath(); ctx.arc(pos.x,pos.y,6,0,Math.PI*2); ctx.fill();}
    ctx.fillStyle=COLORS.text; ctx.font="12px system-ui"; ctx.textAlign="center";
    ctx.fillText((n.title||nid).length>16?(n.title||nid).slice(0,14)+"..":(n.title||nid),pos.x,pos.y-r-8);
    if(n.severity){ctx.fillStyle=col; ctx.font="bold 9px system-ui"; ctx.fillText(n.severity.toUpperCase(),pos.x,pos.y-r-20);}
  });
  ctx.restore();
}

function onMouseDown(e){
  var mx=e.clientX, my=e.clientY-80;
  var hit=hitTest(mx,my);
  if(hit){ selectedNode=hit; dragging=hit; dragStartX=nodePositions[hit].x; dragStartY=nodePositions[hit].y; openPanel(hit); draw(); return; }
  panning=true; selectedNode=null; closePanel(); panOffX=offsetX; panOffY=offsetY; panStartX=e.clientX; panStartY=e.clientY-80; draw();
}
function onMouseUp(e){ dragging=null; panning=false; }
function onMouseMove(e){
  var mx=e.clientX, my=e.clientY-80;
  if(dragging){ nodePositions[dragging]={x:(mx-panStartX)/scale+dragStartX,y:(my-panStartY)/scale+dragStartY}; draw(); }
  else if(panning){ offsetX=panOffX+(mx-panStartX); offsetY=panOffY+(my-panStartY); draw(); }
}
function onRightClick(e){
  var mx=e.clientX, my=e.clientY-80;
  var hit=hitTest(mx,my);
  if(!hit) return;
  contextNode=hit;
  var menu=document.getElementById("context-menu");
  menu.style.left=e.clientX+"px"; menu.style.top=(e.clientY-48)+"px"; menu.style.display="block";
  setTimeout(function(){menu.style.display="none";},4000);
}
function hitTest(mx,my){
  var best=null, bestDist=35;
  Object.keys(nodePositions).forEach(function(nid){
    var p=nodePositions[nid], n=graph.nodes[nid], r=n.kind==="task"?NODE_R:LEAF_R;
    var sx=(p.x+offsetX)*scale, sy=(p.y+offsetY)*scale;
    var dx=mx-sx, dy=my-sy, dist=Math.sqrt(dx*dx+dy*dy);
    if(dist<bestDist&&dist<r*scale+10){bestDist=dist;best=nid;}
  });
  return best;
}

function addNode(kind){
  var nid=prompt("Node ID:",kind+"_"+Date.now());
  if(!nid) return;
  graph.nodes[nid]={id:nid,kind:kind,title:nid,description:"",severity:null,trigger_threshold:25,delta_accumulator:0};
  nodePositions[nid]={x:200+Math.random()*300,y:150+Math.random()*300};
  saveNode(nid); draw();
}
function saveNode(nid){
  var n=graph.nodes[nid];
  fetch("/builder/nodes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(n)});
}
function openPanel(nid){
  var n=graph.nodes[nid];
  document.getElementById("node-panel").style.display="block";
  document.getElementById("panel-title").textContent=n.title+" ("+n.kind+")";
  document.getElementById("panel-title-input").value=n.title||"";
  document.getElementById("panel-desc").value=n.description||"";
  document.getElementById("panel-threshold").value=n.trigger_threshold||25;
  document.getElementById("panel-threshold-val").textContent=n.trigger_threshold||25;
  document.getElementById("panel-threshold").oninput=function(){document.getElementById("panel-threshold-val").textContent=this.value;};
  fetch("/builder/nodes/"+nid).then(function(r){return r.json();}).then(function(d){
    document.getElementById("panel-dependents").innerHTML=d.dependents.map(function(c){return "<div class='rel-item'>"+c+"</div>";}).join("");
    document.getElementById("panel-dependencies").innerHTML=d.dependencies.map(function(c){return "<div class='rel-item'>"+c+"</div>";}).join("");
  });
  selectedNode=nid;
}
function saveNodePanel(){
  if(!selectedNode) return;
  var n=graph.nodes[selectedNode];
  n.title=document.getElementById("panel-title-input").value;
  n.description=document.getElementById("panel-desc").value;
  n.trigger_threshold=parseFloat(document.getElementById("panel-threshold").value);
  fetch("/builder/nodes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(n)});
  draw();
}
function closePanel(){document.getElementById("node-panel").style.display="none";selectedNode=null;draw();}
function deleteNode(){
  if(!contextNode) return;
  var nid=contextNode;
  fetch("/builder/nodes/"+nid,{method:"DELETE"}).then(function(){
    delete graph.nodes[nid]; delete nodePositions[nid];
    graph.edges=graph.edges.filter(function(e){return e.src!==nid&&e.dst!==nid;});
    contextNode=null; closePanel(); draw();
  });
}
function addDependency(){
  if(!contextNode) return;
  var target=prompt("Add dependency FROM node (ID):");
  if(!target||!graph.nodes[target]) return;
  var body={src:target,dst:contextNode,type:"dependency"};
  fetch("/builder/edges",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(function(r){
    if(!r.ok) return r.json().then(function(d){alert(d.error);});
    graph.edges.push(body); draw();
  });
}
function resetView(){offsetX=0;offsetY=0;scale=1;loadGraph();}
async function runBatchAssess(){
  var r=await fetch("/builder/batch-assess",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"full"})});
  var data=await r.json();
  data.forEach(function(a){if(graph.nodes[a.node_id]){graph.nodes[a.node_id].severity=a.severity;}});
  draw(); alert("Assessment complete. "+data.length+" nodes assessed.");
}
