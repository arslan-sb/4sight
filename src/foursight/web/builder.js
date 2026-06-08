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
var NODE_W=150, NODE_H=52, PORT_R=6;

var COLORS={critical:"#dc2626",high:"#ea580c",medium:"#ca8a04",low:"#16a34a",none:"#9ca3af",
  edgeDecomp:"#22c55e",edgeDep:"#3b82f6",bg:"#f8f9fa",text:"#1f2937",textDim:"#6b7280",cardBg:"#ffffff",cardStroke:"#d1d5db"};

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
  viewW=Math.max(rect.width, 600); viewH=Math.max(rect.height, 400);
  updateViewBox();
}

function layoutGraph(){
  // Compute decomposition layers (topological sort by decomposition edges)
  var decompLayers={};
  var allNids=Object.keys(graph.nodes);
  if(allNids.length===0) return;

  // Find roots: nodes with no decomposition parent
  allNids.forEach(function(nid){
    var hasParent=false;
    (graph.edges||[]).forEach(function(e){
      if(e.dst===nid&&e.type==="decomposition") hasParent=true;
    });
    if(!hasParent) decompLayers[nid]=0;
  });
  // If no roots found, pick first node as root
  if(Object.keys(decompLayers).length===0){
    decompLayers[allNids[0]]=0;
  }

  // BFS: assign layers = max(parent layer) + 1
  var changed=true;
  while(changed){
    changed=false;
    allNids.forEach(function(nid){
      if(decompLayers[nid]!==undefined) return;
      var maxParent=-1;
      var allAssigned=true;
      (graph.edges||[]).forEach(function(e){
        if(e.dst===nid&&e.type==="decomposition"){
          if(decompLayers[e.src]===undefined) allAssigned=false;
          else maxParent=Math.max(maxParent, decompLayers[e.src]);
        }
      });
      if(allAssigned&&maxParent>=0){
        decompLayers[nid]=maxParent+1;
        changed=true;
      }
    });
  }
  // Assign layer 0 to any remaining unassigned
  allNids.forEach(function(nid){
    if(decompLayers[nid]===undefined) decompLayers[nid]=0;
  });

  // Group by layer
  var layerGroups={};
  allNids.forEach(function(nid){
    var l=decompLayers[nid];
    if(!layerGroups[l]) layerGroups[l]=[];
    layerGroups[l].push(nid);
  });

  // Position nodes: each layer is a row, nodes spread horizontally
  var layerKeys=Object.keys(layerGroups).map(Number).sort(function(a,b){return a-b;});
  var layerSpacing=120;
  var nodeSpacing=200;
  var startY=80;
  layerKeys.forEach(function(l){
    var nodes=layerGroups[l];
    var totalWidth=Math.max(nodes.length*nodeSpacing, 200);
    var startX=Math.max(60, (viewW-totalWidth)/2);
    nodes.forEach(function(nid,i){
      nodePositions[nid]={x:startX+i*nodeSpacing, y:startY+l*layerSpacing};
    });
  });

  // Fit view to contain all positioned nodes
  var maxX=0, maxY=0;
  allNids.forEach(function(nid){
    var p=nodePositions[nid];
    if(!p) return;
    maxX=Math.max(maxX, p.x+NODE_W);
    maxY=Math.max(maxY, p.y+NODE_H);
  });
  viewW=Math.max(maxX+120, 600);
  viewH=Math.max(maxY+120, 400);
  viewX=-60; viewY=-20;
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
  if(!ctm){ return null; }
  var svgp=pt.matrixTransform(ctm.inverse());
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
  layoutGraph();
  render();
}

function getNodeFromEvent(e){
  var el=e.target.closest('[data-node]');
  return el?el.getAttribute("data-node"):null;
}

function isPortTarget(e){
  return e.target.classList.contains("node-port");
}

function onMouseDown(e){
  var p=toSVG(e.clientX,e.clientY);
  if(!p) return;

  // Port drag
  if(isPortTarget(e)){
    var pid=e.target.getAttribute("data-node");
    portDrag={from:pid, x:p.x, y:p.y};
    portLine=document.createElementNS("http://www.w3.org/2000/svg","line");
    portLine.setAttribute("x1",p.x); portLine.setAttribute("y1",p.y);
    portLine.setAttribute("x2",p.x); portLine.setAttribute("y2",p.y);
    portLine.setAttribute("stroke","#1d4ed8"); portLine.setAttribute("stroke-width","2");
    portLine.setAttribute("stroke-dasharray","4 2");
    svgEl.appendChild(portLine);
    svgEl.classList.add("dragging");
    return;
  }

  // Node drag
  var nid=getNodeFromEvent(e);
  if(nid&&nodePositions[nid]){
    draggingNode=nid;
    var np=nodePositions[nid];
    dragOffX=p.x-np.x; dragOffY=p.y-np.y;
    selectNode(nid);
    svgEl.classList.add("dragging");
    return;
  }

  selectNode(null);
}

function onMouseMove(e){
  var p=toSVG(e.clientX,e.clientY);
  if(!p) return;
  if(draggingNode){
    nodePositions[draggingNode]={x:p.x-dragOffX, y:p.y-dragOffY};
    render();
  }else if(portDrag&&portLine){
    portLine.setAttribute("x2",p.x); portLine.setAttribute("y2",p.y);
    var snap=findSnapNode(e.clientX,e.clientY);
    if(snap&&snap!==portDrag.from){
      var np=nodePositions[snap]; if(!np) return;
      portLine.setAttribute("x2",np.x+NODE_W/2); portLine.setAttribute("y2",np.y+NODE_H/2);
    }
  }
}

function onMouseUp(e){
  if(draggingNode){ draggingNode=null; svgEl.classList.remove("dragging"); }
  if(portDrag){
    var snap=findSnapNode(e.clientX,e.clientY);
    if(snap&&snap!==portDrag.from){
      addDependencyEdge(portDrag.from,snap);
    }
    if(portLine){ portLine.remove(); portLine=null; }
    portDrag=null; svgEl.classList.remove("dragging"); render();
  }
}

function onDblClick(e){
  var nid=getNodeFromEvent(e);
  if(!nid||!graph.nodes[nid]) return;
  // Any node can be drilled into to show its layer
  layerStack.push(nid);
  currentRoot=nid;
  layoutGraph();
  render();
  updateLayerLabel();
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
  // Active layer: only currentRoot + its decomposition children
  var activeIds={};
  if(currentRoot){
    activeIds[currentRoot]=true;
    childrenOf(currentRoot).forEach(function(c){activeIds[c]=true;});
    // Also: dependency edges that originate from active nodes (show the target too)
    var extra={};
    Object.keys(activeIds).forEach(function(nid){
      depsOf(nid).forEach(function(d){extra[d]=true;});
    });
    Object.keys(extra).forEach(function(d){activeIds[d]=true;});
  }

  // Build SVG
  var html='';

  // Edges
  var drawnEdges={};
  (graph.edges||[]).forEach(function(e){
    var key=e.src+"-"+e.dst+"-"+e.type;
    if(drawnEdges[key]) return; drawnEdges[key]=true;
    var from=nodePositions[e.src], to=nodePositions[e.dst];
    if(!from||!to) return;
    var isDep=e.type==="dependency";
    var inLayer=activeIds[e.src]||activeIds[e.dst];
    var strokeCol=inLayer?(isDep?COLORS.edgeDep:COLORS.edgeDecomp):"#d1d5db";
    var edgeOpacity=inLayer?1:0.25;
    var sw=isDep?1.5:2;
    var dash=isDep?"6 3":"none";

    // Outgoing edges start from TOP of source, incoming plug into BOTTOM of target
    // Nodes lower in layout are dependencies; their edges flow upward
    var x1, y1, x2, y2;
    if(!isDep){
      x1=to.x+NODE_W/2; y1=to.y;           // child top-center (outgoing upward)
      x2=from.x+NODE_W/2; y2=from.y+NODE_H; // parent bottom-center (incoming)
    }else{
      x1=from.x+NODE_W/2; y1=from.y;        // src top-center (outgoing)
      x2=to.x+NODE_W/2; y2=to.y+NODE_H;     // dst bottom-center (incoming)
    }

    // Cubic bezier with control points offset vertically
    var dy=Math.max(Math.abs(y2-y1)/3, 20);
    var d="M"+x1+" "+y1+" C"+x1+" "+(y1+dy)+" "+x2+" "+(y2-dy)+" "+x2+" "+y2;
    html+='<path d="'+d+'" fill="none" stroke="'+strokeCol+'" stroke-width="'+sw+'" stroke-dasharray="'+dash+'" opacity="'+edgeOpacity+'"/>';

    // Arrowhead at midpoint (t=0.5 of cubic bezier)
    if(inLayer){
      var t=0.5, mt=1-t;
      var mx=mt*mt*mt*x1 + 3*mt*mt*t*x1 + 3*mt*t*t*x2 + t*t*t*x2;
      var my=mt*mt*mt*y1 + 3*mt*mt*t*(y1+dy) + 3*mt*t*t*(y2-dy) + t*t*t*y2;
      var ang=Math.atan2(y2-y1,x2-x1);
      var s=5;
      var points=(mx-s*Math.cos(ang-0.5))+","+(my-s*Math.sin(ang-0.5))+" "+(mx-s*Math.cos(ang+0.5))+","+(my-s*Math.sin(ang+0.5))+" "+mx+","+my;
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
    var opacity=inLayer?1:0.4;
    var ptrEvents="auto"; // always clickable for double-click navigation
    html+='<g data-node="'+nid+'" transform="translate('+pos.x+','+pos.y+')" opacity="'+opacity+'" style="pointer-events:'+ptrEvents+';cursor:pointer;">';
    if(inLayer){
      // Card shadow
      html+='<rect x="2" y="3" width="'+NODE_W+'" height="'+NODE_H+'" rx="8" fill="#00000010"/>';
    }
    // Card body
    html+='<rect class="node-rect" x="0" y="0" width="'+NODE_W+'" height="'+NODE_H+'" rx="8" fill="'+COLORS.cardBg+'" stroke="'+(nid===selectedNode?col:inLayer?COLORS.cardStroke:"#e5e7eb")+'" stroke-width="'+(nid===selectedNode?2:1)+'"/>';
    // Left accent bar
    html+='<rect x="0" y="6" width="3" height="'+(NODE_H-12)+'" rx="1.5" fill="'+col+'"/>';
    // Title (truncated with ellipsis for the narrower card)
    var title=(n.title||nid);
    var maxChars=Math.floor((NODE_W-50)/7); // ~14 chars for 150px card
    if(title.length>maxChars) title=title.slice(0,maxChars-2)+"…";
    html+='<text x="28" y="21" fill="'+(inLayer?COLORS.text:"#9ca3af")+'" font-size="12" font-family="system-ui" font-weight="600" style="user-select:none;pointer-events:none;">'+esc(title)+'</text>';
    // Kind badge + severity on same line
    var badge=(n.kind||"task");
    if(n.severity){
      html+='<text x="28" y="38" fill="'+COLORS.textDim+'" font-size="10" font-family="system-ui" style="user-select:none;pointer-events:none;">'+badge+'</text>';
      html+='<text x="'+(NODE_W-10)+'" y="38" fill="'+col+'" font-size="10" font-weight="bold" text-anchor="end" font-family="system-ui" style="user-select:none;pointer-events:none;">'+n.severity.toUpperCase()+'</text>';
    }else{
      html+='<text x="28" y="38" fill="'+COLORS.textDim+'" font-size="10" font-family="system-ui" style="user-select:none;pointer-events:none;">'+badge+'</text>';
    }
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
    // Auto-wire: link to current root as decomposition
    if(currentRoot){
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
    layoutGraph();
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
    // "I depend on" = my children (decomp outgoing) + dependency targets (I point dep edges to them)
    var iDepend=[];
    (d.children||[]).forEach(function(c){iDepend.push({id:c,type:"decomp"});});
    (d.dependents||[]).forEach(function(c){iDepend.push({id:c,type:"dep"});});
    // "Depends on me" = my parents (decomp incoming) + dependency sources (they point dep edges to me)
    var depOnMe=[];
    (d.parents||[]).forEach(function(p){depOnMe.push({id:p,type:"decomp"});});
    (d.dependencies||[]).forEach(function(p){depOnMe.push({id:p,type:"dep"});});

    var labelFor=function(r){return r.type==="dep"?"[dep] ":"";};
    document.getElementById("panel-dependencies").innerHTML=iDepend.map(function(r){
      return "<div class='rel-item' style='cursor:pointer;' onclick='selectNode(\""+r.id+"\")'>"+labelFor(r)+r.id+"</div>";
    }).join("")||"<span style='opacity:0.4;'>none</span>";
    document.getElementById("panel-dependents").innerHTML=depOnMe.map(function(r){
      return "<div class='rel-item' style='cursor:pointer;' onclick='selectNode(\""+r.id+"\")'>"+labelFor(r)+r.id+"</div>";
    }).join("")||"<span style='opacity:0.4;'>none</span>";
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

function resetView(){ viewX=0;viewY=0;viewScale=1; currentRoot=null; layerStack=[]; selectedNode=null; loadGraph(); }
