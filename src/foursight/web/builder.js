var graph = {nodes:{}, edges:[]};
var nodePositions = {};
var svg, svgEl;
var viewX=0, viewY=0, viewW=1200, viewH=800, viewScale=1;
var draggingNode=null, dragOffX=0, dragOffY=0;
var panning=false, panStart={x:0,y:0}, panView={x:0,y:0};
var selectedNode=null, currentRoot=null;
var portDrag=null, portLine=null;
var creatingKind=null;
var layerStack=[];
var NODE_W=180, NODE_H=60, PORT_R=7;

var COLORS={critical:"#dc2626",high:"#ea580c",medium:"#ca8a04",low:"#16a34a",none:"#9ca3af",
  edgeDecomp:"#86a886",edgeDep:"#7b8cc4",bg:"#f8f9fa",text:"#1f2937",textDim:"#6b7280",cardBg:"#ffffff",cardStroke:"#d1d5db"};

function sevColor(s){return COLORS[s]||COLORS.none;}

function init(){
  svgEl=document.getElementById("svg-canvas");
  svg=svgEl;
  svgEl.addEventListener("wheel",onWheel,{passive:false});
  svgEl.addEventListener("mousedown",onMouseDown);
  svgEl.addEventListener("mousemove",onMouseMove);
  svgEl.addEventListener("mouseup",onMouseUp);
  svgEl.addEventListener("dblclick",onDblClick);
  svgEl.addEventListener("contextmenu",function(e){e.preventDefault();});
  window.addEventListener("resize",resizeSVG);
  resizeSVG();
  loadGraph();
}

function resizeSVG(){
  var rect=svgEl.parentElement.getBoundingClientRect();
  viewW=Math.max(rect.width, 400); viewH=Math.max(rect.height, 300);
  fitAllNodes();
}

function fitAllNodes(){
  var minX=0, minY=0, maxX=viewW, maxY=viewH;
  var hasNodes=false;
  Object.keys(nodePositions).forEach(function(nid){
    var p=nodePositions[nid];
    if(!hasNodes){minX=p.x;minY=p.y;maxX=p.x+NODE_W;maxY=p.y+NODE_H;hasNodes=true;}
    else{minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x+NODE_W);maxY=Math.max(maxY,p.y+NODE_H);}
  });
  if(hasNodes){
    minX-=60; minY-=60; maxX+=60; maxY+=60;
    viewX=minX; viewY=minY;
    viewW=Math.max(maxX-minX, 400); viewH=Math.max(maxY-minY, 300);
  }
  updateViewBox();
}

function updateViewBox(){
  svgEl.setAttribute("viewBox",viewX+" "+viewY+" "+viewW+" "+viewH);
  svgEl.setAttribute("width","100%"); svgEl.setAttribute("height","100%");
  svgEl.style.width="100%"; svgEl.style.height="100%"; svgEl.style.display="block";
}

function toSVG(mx,my){
  var pt=svgEl.createSVGPoint();
  pt.x=mx; pt.y=my;
  var ctm=svgEl.getScreenCTM();
  if(!ctm) return {x:mx+viewX,y:my+viewY};
  var inv=ctm.inverse();
  var svgp=pt.matrixTransform(inv);
  return {x:svgp.x, y:svgp.y};
}

function onWheel(e){
  e.preventDefault();
  if(e.ctrlKey||e.metaKey){
    var p=toSVG(e.clientX,e.clientY);
    var ds=e.deltaY>0?0.9:1.1;
    var newScale=Math.max(0.3,Math.min(3,viewScale*ds));
    var cx=viewX+viewW/2, cy=viewY+viewH/2;
    viewW=viewW*viewScale/newScale; viewH=viewH*viewScale/newScale;
    viewScale=newScale;
    viewX=cx-viewW/2; viewY=cy-viewH/2;
    updateViewBox();
  }
}

async function loadGraph(){
  var r=await fetch("/builder/graph"); var d=await r.json();
  d.nodes.forEach(function(n){graph.nodes[n.id]=n;});
  graph.edges=d.edges;
  Object.keys(graph.nodes).forEach(function(nid,i){
    if(!nodePositions[nid]) nodePositions[nid]={x:100+(i%4)*250, y:100+Math.floor(i/4)*150};
  });
  if(!currentRoot){
    var rr=await fetch("/root"); currentRoot=(await rr.json()).node_id;
    layerStack=[currentRoot];
  }
  fitAllNodes();
  render();
}

function onMouseDown(e){
  var p=toSVG(e.clientX,e.clientY);
  var target=e.target;

  // Port drag
  if(target.classList.contains("node-port")){
    var nid=target.getAttribute("data-node");
    portDrag={from:nid, x:p.x, y:p.y};
    portLine=document.createElementNS("http://www.w3.org/2000/svg","line");
    portLine.setAttribute("x1",p.x); portLine.setAttribute("y1",p.y);
    portLine.setAttribute("x2",p.x); portLine.setAttribute("y2",p.y);
    portLine.classList.add("edge-line","edge-dragging");
    svgEl.appendChild(portLine);
    svgEl.classList.add("dragging");
    return;
  }

  // Node drag
  var card=target.closest(".node-card");
  if(card){
    var nid=card.getAttribute("data-node");
    if(nid&&nodePositions[nid]){
      draggingNode=nid;
      var np=nodePositions[nid];
      dragOffX=p.x-np.x; dragOffY=p.y-np.y;
      selectNode(nid);
      svgEl.classList.add("dragging");
      return;
    }
  }

  // Click on empty space - deselect
  selectNode(null);
}

function onMouseMove(e){
  var p=toSVG(e.clientX,e.clientY);
  if(draggingNode){
    nodePositions[draggingNode]={x:p.x-dragOffX, y:p.y-dragOffY};
    render();
  }else if(portDrag){
    portLine.setAttribute("x2",p.x); portLine.setAttribute("y2",p.y);
    var snap=findSnapNode(e.clientX,e.clientY);
    if(snap&&snap!==portDrag.from){
      var np=nodePositions[snap]; if(!np) return;
      portLine.setAttribute("x2",np.x+NODE_W/2); portLine.setAttribute("y2",np.y+NODE_H/2);
    }
  }
}

function onMouseUp(e){
  if(draggingNode){ draggingNode=null; svgEl.classList.remove("dragging"); render(); }
  if(portDrag){
    var snap=findSnapNode(e.clientX,e.clientY);
    if(snap&&snap!==portDrag.from){
      addDependencyEdge(portDrag.from,snap);
    }
    if(portLine){ portLine.remove(); portLine=null; }
    portDrag=null; svgEl.classList.remove("dragging");
  }
}

function onDblClick(e){
  var card=e.target.closest(".node-card");
  if(!card) return;
  var nid=card.getAttribute("data-node");
  if(!nid||!graph.nodes[nid]) return;
  var n=graph.nodes[nid];
  if(n.kind==="task"||(graph.nodes[nid]&&childrenOf(nid).length>0)){
    layerStack.push(nid);
    currentRoot=nid;
    render();
    updateLayerLabel();
  }
}

function findSnapNode(mx,my){
  var p=toSVG(mx,my);
  var best=null, bestDist=60;
  Object.keys(nodePositions).forEach(function(nid){
    var np=nodePositions[nid];
    var cx=np.x+NODE_W/2, cy=np.y+NODE_H/2;
    var dx=p.x-cx, dy=p.y-cy, dist=Math.sqrt(dx*dx+dy*dy);
    if(dist<bestDist){bestDist=dist;best=nid;}
  });
  return best;
}

function childrenOf(nid){
  var kids=[];
  (graph.edges||[]).forEach(function(e){if(e.src===nid&&e.type==="decomposition") kids.push(e.dst);});
  return kids;
}

function parentOf(nid){
  var p=null;
  (graph.edges||[]).forEach(function(e){if(e.dst===nid&&e.type==="decomposition") p=e.src;});
  return p;
}

function depsOf(nid){
  var deps=[];
  (graph.edges||[]).forEach(function(e){
    if(e.dst===nid&&e.type==="dependency") deps.push(e.src);
    if(e.src===nid&&e.type==="dependency") deps.push(e.dst);
  });
  return deps;
}

function render(){
  // Compute which nodes are in the "active" layer (full opacity)
  var activeIds={};
  if(currentRoot){
    activeIds[currentRoot]=true;
    childrenOf(currentRoot).forEach(function(c){activeIds[c]=true;});
    // Direct dependency connections from active layer nodes
    var depIds={};
    Object.keys(activeIds).forEach(function(nid){
      depsOf(nid).forEach(function(d){depIds[d]=true;});
    });
    Object.keys(depIds).forEach(function(d){activeIds[d]=true;});
  }

  // Build SVG
  var html='';

  // Edges -- show all, dim ones not in active layer
  var drawnEdges={};
  (graph.edges||[]).forEach(function(e){
    var key=e.src+"-"+e.dst+"-"+e.type;
    if(drawnEdges[key]) return; drawnEdges[key]=true;
    var from=nodePositions[e.src], to=nodePositions[e.dst];
    if(!from||!to) return;
    var isDep=e.type==="dependency";
    var inLayer=activeIds[e.src]||activeIds[e.dst];
    var strokeCol=inLayer?(isDep?COLORS.edgeDep:COLORS.edgeDecomp):"#d1d5db";
    var edgeOpacity=inLayer?1:0.3;
    var x1=from.x+NODE_W/2, y1=from.y+NODE_H;
    var x2=to.x+NODE_W/2, y2=to.y;
    var mx=(x1+x2)/2, my=(y1+y2)/2;
    var d="M"+x1+" "+y1+" Q"+x1+" "+my+","+mx+" "+my+" Q"+x2+" "+my+","+x2+" "+y2;
    html+='<path d="'+d+'" fill="none" stroke="'+strokeCol+'" stroke-width="'+(isDep?1.5:2)+'" stroke-dasharray="'+(isDep?"6 3":"none")+'" opacity="'+edgeOpacity+'"/>';
    if(inLayer){
      var ang=Math.atan2(y2-y1,x2-x1);
      var s=6, ax=mx, ay=my;
      var points=(ax-s*Math.cos(ang-0.6))+","+(ay-s*Math.sin(ang-0.6))+" "+(ax-s*Math.cos(ang+0.6))+","+(ay-s*Math.sin(ang+0.6))+" "+ax+","+ay;
      html+='<polygon points="'+points+'" fill="'+strokeCol+'"/>';
    }
  });

  // Nodes -- show ALL, dim inactive ones
  var allIds=Object.keys(graph.nodes);
  allIds.forEach(function(nid){
    var n=graph.nodes[nid], pos=nodePositions[nid];
    if(!n||!pos) return;
    var inLayer=activeIds[nid];
    var col=inLayer?sevColor(n.severity):"#9ca3af";
    var opacity=inLayer?1:0.55;
    var ptrEvents=inLayer?"auto":"auto"; // all clickable
    html+='<g data-node="'+nid+'" transform="translate('+pos.x+','+pos.y+')" opacity="'+opacity+'" style="pointer-events:'+ptrEvents+';cursor:pointer;">';
    if(inLayer){
      // Card shadow
      html+='<rect x="2" y="3" width="'+NODE_W+'" height="'+NODE_H+'" rx="8" fill="#00000010"/>';
    }
    // Card body
    html+='<rect class="node-rect" x="0" y="0" width="'+NODE_W+'" height="'+NODE_H+'" rx="8" fill="'+COLORS.cardBg+'" stroke="'+(nid===selectedNode?col:inLayer?COLORS.cardStroke:"#e5e7eb")+'" stroke-width="'+(nid===selectedNode?2:1)+'"/>';
    // Left accent bar
    html+='<rect x="0" y="4" width="4" height="'+(NODE_H-8)+'" rx="2" fill="'+col+'"/>';
    // Severity dot
    if(n.severity||!inLayer) html+='<circle cx="18" cy="18" r="5" fill="'+col+'"/>';
    // Title
    var title=(n.title||nid); if(title.length>20) title=title.slice(0,18)+"..";
    html+='<text x="30" y="22" fill="'+(inLayer?COLORS.text:"#9ca3af")+'" font-size="13" font-family="system-ui" font-weight="600">'+esc(title)+'</text>';
    // Kind badge
    html+='<text x="30" y="40" fill="'+(inLayer?COLORS.textDim:"#c7cbd3")+'" font-size="11" font-family="system-ui">'+(n.kind||"task")+'</text>';
    // Severity badge
    if(n.severity) html+='<text x="'+(NODE_W-12)+'" y="22" fill="'+col+'" font-size="10" font-weight="bold" text-anchor="end" font-family="system-ui">'+n.severity.toUpperCase()+'</text>';
    // Ports only for active layer
    if(inLayer){
      html+='<circle class="node-port" data-node="'+nid+'" cx="'+NODE_W+'" cy="'+NODE_H/2+'" r="'+PORT_R+'" fill="'+col+'" stroke="'+col+'" stroke-width="1.5"/>';
      html+='<circle cx="0" cy="'+NODE_H/2+'" r="'+PORT_R+'" fill="none" stroke="'+COLORS.cardStroke+'" stroke-width="1"/>';
    }
    html+='</g>';
  });

  svgEl.innerHTML=html;
  updateLayerLabel();
}

function esc(s){ return (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

// --- Node creation in sidebar ---
function startCreate(kind){
  creatingKind=kind;
  document.getElementById("panel-title").textContent="New "+(kind==="leaf"?"Data Source":"Task");
  document.getElementById("panel-name").value="";
  document.getElementById("panel-desc").value="";
  document.getElementById("panel-kind").value=kind;
  document.getElementById("panel-threshold").value=25;
  document.getElementById("panel-threshold-val").textContent="25";
  document.getElementById("panel-adapter").value="";
  document.getElementById("panel-query").value="";
  document.getElementById("panel-relations").style.display="none";
  onKindChange();
}

function onKindChange(){
  var k=document.getElementById("panel-kind").value;
  document.getElementById("panel-leaf-fields").style.display=k==="leaf"?"block":"none";
}

async function hashId(name){
  var data=new TextEncoder().encode(name+Date.now());
  var hash=await crypto.subtle.digest("SHA-256",data);
  return Array.from(new Uint8Array(hash)).map(function(b){return b.toString(16).padStart(2,"0");}).join("").slice(0,12);
}

async function saveNodePanel(){
  var name=document.getElementById("panel-name").value.trim();
  if(!name){alert("Name required");return;}
  var kind=document.getElementById("panel-kind").value;
  var desc=document.getElementById("panel-desc").value;
  var thr=parseFloat(document.getElementById("panel-threshold").value);
  var nid=creatingKind?await hashId(name):selectedNode;

  var body={id:nid,kind:kind,title:name,description:desc,trigger_threshold:thr};
  if(kind==="leaf"){
    body.adapter_id=document.getElementById("panel-adapter").value||"generic";
    body.query=document.getElementById("panel-query").value||"";
  }

  if(creatingKind){
    // Place near current root
    var cx=currentRoot&&nodePositions[currentRoot]?nodePositions[currentRoot].x+300:200;
    var cy=currentRoot&&nodePositions[currentRoot]?nodePositions[currentRoot].y+80*(Object.keys(graph.nodes).length%5):200;
    nodePositions[nid]={x:cx,y:cy};
    // Auto-wire: link to current root as decomposition
    if(currentRoot&&kind!=="leaf"){
      graph.edges.push({src:currentRoot,dst:nid,type:"decomposition"});
      fetch("/builder/edges",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({src:currentRoot,dst:nid,type:"decomposition"})});
    }
  }

  fetch("/builder/nodes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(function(r){return r.json();}).then(function(d){
    if(d.deduped){nid=d.id;}
    body.id=nid;
    graph.nodes[nid]=body;
    if(creatingKind){
      selectedNode=nid;
      document.getElementById("panel-title").textContent=name+" ("+kind+")";
      document.getElementById("panel-relations").style.display="block";
      creatingKind=null;
    }
    render();
  });
}

function selectNode(nid){
  if(!nid){ closePanel(); return; }
  selectedNode=nid; creatingKind=null;
  var n=graph.nodes[nid];
  if(!n){ closePanel(); return; }
  document.getElementById("panel-title").textContent=n.title+" ("+n.kind+")";
  document.getElementById("panel-name").value=n.title||"";
  document.getElementById("panel-desc").value=n.description||"";
  document.getElementById("panel-kind").value=n.kind||"task";
  document.getElementById("panel-threshold").value=n.trigger_threshold||25;
  document.getElementById("panel-threshold-val").textContent=n.trigger_threshold||25;
  document.getElementById("panel-relations").style.display="block";
  document.getElementById("btn-delete").style.display="block";
  onKindChange();
  fetch("/builder/nodes/"+nid).then(function(r){return r.json();}).then(function(d){
    document.getElementById("panel-dependents").innerHTML=(d.dependents||[]).map(function(c){return "<div class='rel-item'>"+c+"</div>";}).join("");
    document.getElementById("panel-dependencies").innerHTML=(d.dependencies||[]).map(function(c){return "<div class='rel-item'>"+c+"</div>";}).join("");
  }).catch(function(){});
}

function closePanel(){ creatingKind=null; selectedNode=null; document.getElementById("panel-title").textContent="New Node"; document.getElementById("panel-relations").style.display="none"; document.getElementById("btn-delete").style.display="none"; render(); }

function deleteSelectedNode(){
  var nid=selectedNode;
  if(!nid) return;
  if(!confirm("Delete node "+nid+"?")) return;
  fetch("/builder/nodes/"+nid,{method:"DELETE"}).then(function(){
    delete graph.nodes[nid]; delete nodePositions[nid];
    graph.edges=graph.edges.filter(function(e){return e.src!==nid&&e.dst!==nid;});
    if(currentRoot===nid){ goUpLayer(); }
    closePanel(); render();
  });
}

function addDependencyEdge(fromId,toId){
  var exists=(graph.edges||[]).some(function(e){return e.src===fromId&&e.dst===toId&&e.type==="dependency";});
  if(exists) return;
  graph.edges.push({src:fromId,dst:toId,type:"dependency"});
  fetch("/builder/edges",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({src:fromId,dst:toId,type:"dependency"})});
  render();
}

function goUpLayer(){
  if(layerStack.length<=1) return;
  layerStack.pop();
  currentRoot=layerStack[layerStack.length-1];
  render();
}

function updateLayerLabel(){
  document.getElementById("layer-label").textContent="Layer: "+(layerStack.length-1)+" | "+currentRoot;
  document.getElementById("btn-up").disabled=layerStack.length<=1;
}

function deleteContextNode(){
  var nid=selectedNode;
  if(!nid) return;
  fetch("/builder/nodes/"+nid,{method:"DELETE"}).then(function(){
    delete graph.nodes[nid]; delete nodePositions[nid];
    graph.edges=graph.edges.filter(function(e){return e.src!==nid&&e.dst!==nid;});
    if(currentRoot===nid){ goUpLayer(); }
    closePanel(); render();
  });
}

function addNode(kind){ startCreate(kind); }

async function runBatchAssess(){
  var r=await fetch("/builder/batch-assess",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"full"})});
  var data=await r.json();
  data.forEach(function(a){if(graph.nodes[a.node_id]){graph.nodes[a.node_id].severity=a.severity;}});
  render();
}

function resetView(){ viewX=0;viewY=0;viewScale=1; currentRoot=null; layerStack=[]; selectedNode=null; loadGraph().then(function(){fitAllNodes();}); }
