var graph = {nodes:{}, edges:[]};
var nodePositions = {};
var svgEl;
var viewX=0, viewY=0, viewW=1200, viewH=800, viewScale=1;
var draggingNode=null, dragOffX=0, dragOffY=0;
var selectedNode=null;
var portDrag=null, portLine=null;
var creatingKind=null;
var NODE_W=150, NODE_H=52, PORT_R=6;

var COLORS={critical:"#dc2626",high:"#ea580c",medium:"#ca8a04",low:"#16a34a",none:"#9ca3af",
  edge:"#3b82f6",bg:"#f8f9fa",text:"#1f2937",textDim:"#6b7280",cardBg:"#ffffff",cardStroke:"#d1d5db"};

function sevColor(s){return COLORS[s]||COLORS.none;}

function init(){
  svgEl=document.getElementById("svg-canvas");
  svgEl.addEventListener("wheel",onWheel,{passive:false});
  svgEl.addEventListener("mousedown",onMouseDown);
  svgEl.addEventListener("mousemove",onMouseMove);
  svgEl.addEventListener("mouseup",onMouseUp);
  svgEl.addEventListener("contextmenu",onContextMenu);
  window.addEventListener("resize",resizeSVG);
  resizeSVG();
  loadGraph();
}

function resizeSVG(){
  var rect=svgEl.parentElement.getBoundingClientRect();
  viewW=Math.max(rect.width,600); viewH=Math.max(rect.height,400);
  updateViewBox();
}
function updateViewBox(){
  svgEl.setAttribute("viewBox",viewX+" "+viewY+" "+viewW+" "+viewH);
  svgEl.setAttribute("width","100%"); svgEl.setAttribute("height","100%");
  svgEl.style.width="100%"; svgEl.style.height="100%"; svgEl.style.display="block";
}

function toSVG(mx,my){
  var pt=svgEl.createSVGPoint(); pt.x=mx; pt.y=my;
  var ctm=svgEl.getScreenCTM();
  if(!ctm) return null;
  var svgp=pt.matrixTransform(ctm.inverse());
  return {x:svgp.x, y:svgp.y};
}

function onWheel(e){
  e.preventDefault();
  if(e.ctrlKey||e.metaKey){
    var p=toSVG(e.clientX,e.clientY); if(!p) return;
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
  if(Object.keys(nodePositions).length===0){
    layoutGraph();
  }
  render();
}

// --- Topological layout ---
function layoutGraph(){
  var allNids=Object.keys(graph.nodes);
  if(allNids.length===0) return;

  // Assign layers via reverse BFS: sinks (root) at top, sources (leaves) at bottom
  var layers={};
  allNids.forEach(function(nid){
    var hasOutgoing=(graph.edges||[]).some(function(e){return e.src===nid;});
    if(!hasOutgoing) layers[nid]=0; // sinks = layer 0 (top)
  });
  if(Object.keys(layers).length===0) layers[allNids[0]]=0;

  var changed=true;
  while(changed){ changed=false;
    allNids.forEach(function(nid){
      if(layers[nid]!==undefined) return;
      var maxSrc=-1, allDone=true;
      (graph.edges||[]).forEach(function(e){
        if(e.src===nid && layers[e.dst]!==undefined){
          maxSrc=Math.max(maxSrc,layers[e.dst]);
        }else if(e.src===nid && layers[e.dst]===undefined){
          allDone=false;
        }
      });
      if(allDone&&maxSrc>=0){layers[nid]=maxSrc+1;changed=true;}
    });
  }
  allNids.forEach(function(nid){if(layers[nid]===undefined) layers[nid]=0;});

  var layerGroups={};
  allNids.forEach(function(nid){
    var l=layers[nid];
    if(!layerGroups[l]) layerGroups[l]=[];
    layerGroups[l].push(nid);
  });

  var keys=Object.keys(layerGroups).map(Number).sort(function(a,b){return a-b;});
  var spacing=200, rowH=120, startY=80;
  keys.forEach(function(l){
    var nodes=layerGroups[l];
    var totalW=nodes.length*spacing;
    var startX=Math.max(60,(600-totalW)/2);
    nodes.forEach(function(nid,i){
      nodePositions[nid]={x:startX+i*spacing, y:startY+l*rowH};
    });
  });

  var maxX=0,maxY=0;
  allNids.forEach(function(nid){
    var p=nodePositions[nid]; if(!p) return;
    maxX=Math.max(maxX,p.x+NODE_W); maxY=Math.max(maxY,p.y+NODE_H);
  });
  viewW=Math.max(maxX+120,600); viewH=Math.max(maxY+120,400);
  viewX=-60; viewY=-20;
  updateViewBox();
}

// --- Event handlers ---
function getNodeFromEvent(e){var el=e.target.closest('[data-node]');return el?el.getAttribute("data-node"):null;}

function onMouseDown(e){
  var p=toSVG(e.clientX,e.clientY); if(!p) return;
  if(e.target.classList.contains("node-port")){
    portDrag={from:e.target.getAttribute("data-node"),x:p.x,y:p.y};
    portLine=document.createElementNS("http://www.w3.org/2000/svg","line");
    portLine.setAttribute("x1",p.x);portLine.setAttribute("y1",p.y);
    portLine.setAttribute("x2",p.x);portLine.setAttribute("y2",p.y);
    portLine.setAttribute("stroke","#1d4ed8");portLine.setAttribute("stroke-width","2");
    portLine.setAttribute("stroke-dasharray","4 2");
    svgEl.appendChild(portLine); svgEl.classList.add("dragging"); return;
  }
  var nid=getNodeFromEvent(e);
  if(nid&&nodePositions[nid]){
    draggingNode=nid; var np=nodePositions[nid];
    dragOffX=p.x-np.x; dragOffY=p.y-np.y;
    selectNode(nid); svgEl.classList.add("dragging"); return;
  }
  selectNode(null);
}

function onMouseMove(e){
  var p=toSVG(e.clientX,e.clientY); if(!p) return;
  if(draggingNode){
    nodePositions[draggingNode]={x:p.x-dragOffX,y:p.y-dragOffY}; render();
  }else if(portDrag&&portLine){
    portLine.setAttribute("x2",p.x);portLine.setAttribute("y2",p.y);
    var snap=findSnapNode(e.clientX,e.clientY);
    if(snap&&snap!==portDrag.from){
      var np=nodePositions[snap]; if(!np) return;
      portLine.setAttribute("x2",np.x+NODE_W/2);portLine.setAttribute("y2",np.y+NODE_H/2);
    }
  }
}

function onMouseUp(e){
  if(draggingNode){draggingNode=null;svgEl.classList.remove("dragging");}
  if(portDrag){
    var snap=findSnapNode(e.clientX,e.clientY);
    if(snap&&snap!==portDrag.from) addEdge(portDrag.from,snap);
    if(portLine){portLine.remove();portLine=null;}
    portDrag=null;svgEl.classList.remove("dragging");render();
  }
}

var contextNodeId=null;
function onContextMenu(e){
  e.preventDefault(); var nid=getNodeFromEvent(e); if(!nid) return;
  contextNodeId=nid;
  var menu=document.createElement("div");
  menu.style.cssText="position:fixed;background:#fff;border:1px solid #d1d5db;border-radius:8px;padding:4px 0;z-index:300;min-width:200px;box-shadow:0 4px 12px rgba(0,0,0,0.15);";
  menu.style.left=e.clientX+"px";menu.style.top=e.clientY+"px";
  menu.innerHTML=
    '<div style="padding:8px 16px;cursor:pointer;font-size:13px;">'+nid+'</div>'+
    '<div style="padding:8px 16px;cursor:pointer;font-size:13px;color:#3b82f6;">Add edge from...</div>';
  menu.children[1].onclick=function(){
    var target=prompt("Create edge FROM node (ID):");
    if(target&&graph.nodes[target]&&target!==nid) addEdge(target,nid);
    menu.remove();
  };
  document.body.appendChild(menu);
  setTimeout(function(){menu.remove();},5000);
  document.addEventListener("click",function rm(){menu.remove();document.removeEventListener("click",rm);},{once:true});
}

function findSnapNode(mx,my){
  var p=toSVG(mx,my); if(!p) return null;
  var best=null,bestDist=60;
  Object.keys(nodePositions).forEach(function(nid){
    var np=nodePositions[nid];
    var dx=p.x-(np.x+NODE_W/2),dy=p.y-(np.y+NODE_H/2);
    var dist=Math.sqrt(dx*dx+dy*dy);
    if(dist<bestDist){bestDist=dist;best=nid;}
  });
  return best;
}

// --- Edge helpers ---
function neighborsOf(nid){
  var nb={};
  (graph.edges||[]).forEach(function(e){
    if(e.src===nid) nb[e.dst]=true;
    if(e.dst===nid) nb[e.src]=true;
  });
  return Object.keys(nb);
}

function addEdge(fromId,toId){
  var exists=(graph.edges||[]).some(function(e){return e.src===fromId&&e.dst===toId;});
  if(exists) return;
  graph.edges.push({src:fromId,dst:toId});
  fetch("/builder/edges",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({src:fromId,dst:toId,type:"dependency"})});
  layoutGraph(); render();
}

// --- Render ---
function render(){
  var highlight={};
  if(selectedNode){
    highlight[selectedNode]=true;
    neighborsOf(selectedNode).forEach(function(n){highlight[n]=true;});
  }
  var anySelected=selectedNode!=null;

  var html='';
  var drawn={};
  (graph.edges||[]).forEach(function(e){
    var key=e.src+"-"+e.dst; if(drawn[key]) return; drawn[key]=true;
    var from=nodePositions[e.src],to=nodePositions[e.dst];
    if(!from||!to) return;
    var active=anySelected?(highlight[e.src]&&highlight[e.dst]):true;
    var strokeCol=active?COLORS.edge:"#d1d5db";
    var opacity=active?1:0.15;
    var x1=from.x+NODE_W/2,y1=from.y; // source top-center (exit, lower node)
    var x2=to.x+NODE_W/2,y2=to.y+NODE_H; // target bottom-center (enter, upper node)
    var dy=Math.max(Math.abs(y2-y1)/3,20);
    var d="M"+x1+" "+y1+" C"+x1+" "+(y1-dy)+" "+x2+" "+(y2+dy)+" "+x2+" "+y2;
    html+='<path d="'+d+'" fill="none" stroke="'+strokeCol+'" stroke-width="2" opacity="'+opacity+'"/>';
    if(active){
      var ang=Math.atan2(y1-y2,x1-x2),s=5;
      var mx=(x1+x2)/2,my=(y1+y2)/2;
      var pts=(mx-s*Math.cos(ang-0.5))+","+(my-s*Math.sin(ang-0.5))+" "+(mx-s*Math.cos(ang+0.5))+","+(my-s*Math.sin(ang+0.5))+" "+mx+","+my;
      html+='<polygon points="'+pts+'" fill="'+strokeCol+'"/>';
    }
  });

  Object.keys(graph.nodes).forEach(function(nid){
    var n=graph.nodes[nid],pos=nodePositions[nid];
    if(!n||!pos) return;
    var inHighlight=!anySelected||highlight[nid];
    var col=inHighlight?sevColor(n.severity):"#9ca3af";
    var opacity=inHighlight?1:0.3;
    html+='<g data-node="'+nid+'" transform="translate('+pos.x+','+pos.y+')" opacity="'+opacity+'" style="cursor:pointer;">';
    if(inHighlight) html+='<rect x="2" y="3" width="'+NODE_W+'" height="'+NODE_H+'" rx="8" fill="#00000010"/>';
    html+='<rect class="node-rect" x="0" y="0" width="'+NODE_W+'" height="'+NODE_H+'" rx="8" fill="'+COLORS.cardBg+'" stroke="'+(nid===selectedNode?col:inHighlight?COLORS.cardStroke:"#e5e7eb")+'" stroke-width="'+(nid===selectedNode?2:1)+'"/>';
    html+='<rect x="0" y="6" width="3" height="'+(NODE_H-12)+'" rx="1.5" fill="'+col+'"/>';
    var title=(n.title||nid);
    var maxChars=Math.floor((NODE_W-50)/7);
    if(title.length>maxChars) title=title.slice(0,maxChars-2)+"…";
    html+='<text x="28" y="21" fill="'+(inHighlight?COLORS.text:"#9ca3af")+'" font-size="12" font-family="system-ui" font-weight="600" style="user-select:none;pointer-events:none;">'+esc(title)+'</text>';
    var badge=(n.kind||"task");
    if(n.severity){
      html+='<text x="28" y="38" fill="'+COLORS.textDim+'" font-size="10" font-family="system-ui" style="user-select:none;pointer-events:none;">'+badge+'</text>';
      html+='<text x="'+(NODE_W-10)+'" y="38" fill="'+col+'" font-size="10" font-weight="bold" text-anchor="end" font-family="system-ui" style="user-select:none;pointer-events:none;">'+n.severity.toUpperCase()+'</text>';
    }else{
      html+='<text x="28" y="38" fill="'+COLORS.textDim+'" font-size="10" font-family="system-ui" style="user-select:none;pointer-events:none;">'+badge+'</text>';
    }
    if(inHighlight){
      html+='<circle class="node-port" data-node="'+nid+'" cx="'+NODE_W+'" cy="'+NODE_H/2+'" r="'+PORT_R+'" fill="'+col+'" stroke="'+col+'" stroke-width="1.5"/>';
      html+='<circle cx="0" cy="'+NODE_H/2+'" r="'+PORT_R+'" fill="none" stroke="'+COLORS.cardStroke+'" stroke-width="1"/>';
    }
    html+='</g>';
  });

  svgEl.innerHTML=html;
}

function esc(s){return (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

// --- Node creation ---
function addNode(kind){ startCreate(kind); }

function startCreate(kind){
  creatingKind=kind;
  document.getElementById("panel-title").textContent="New "+(kind==="leaf"?"Data Source":"Task");
  document.getElementById("panel-name").value="";
  document.getElementById("panel-desc").value="";
  document.getElementById("panel-kind").value=kind;
  document.getElementById("panel-threshold").value=25;
  document.getElementById("panel-threshold-val").textContent="25";
  document.getElementById("btn-inject").disabled=true;
  document.getElementById("btn-delete").style.display="none";
  document.getElementById("panel-relations").style.display="none";
  onKindChange();
}

function onKindChange(){
  document.getElementById("panel-leaf-fields").style.display=
    document.getElementById("panel-kind").value==="leaf"?"block":"none";
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
  fetch("/builder/nodes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(function(r){return r.json();}).then(function(d){
    if(d.deduped) nid=d.id;
    body.id=nid; graph.nodes[nid]=body;
    if(creatingKind){
      selectedNode=nid; creatingKind=null;
      document.getElementById("panel-title").textContent=name+" ("+kind+")";
      document.getElementById("panel-relations").style.display="block";
      document.getElementById("btn-delete").style.display="block";
    }
    layoutGraph(); render();
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
  var hasRules=n.threshold_rules&&n.threshold_rules.length>0;
  document.getElementById("btn-inject").disabled=!hasRules;
  onKindChange();
  fetch("/builder/nodes/"+nid).then(function(r){return r.json();}).then(function(d){
    n.description=d.description||n.description||"";
    n.threshold_rules=d.threshold_rules||[];
    n.raw_value=d.raw_value;
    n.trigger_threshold=d.trigger_threshold;
    document.getElementById("panel-desc").value=n.description||"";
    document.getElementById("panel-threshold").value=n.trigger_threshold||25;
    document.getElementById("panel-threshold-val").textContent=n.trigger_threshold||25;
    hasRules=n.threshold_rules&&n.threshold_rules.length>0;
    document.getElementById("btn-inject").disabled=!hasRules;
    var iDepend=[], depOnMe=[];
    (d.children||[]).forEach(function(c){iDepend.push({id:c});});
    (d.dependents||[]).forEach(function(c){iDepend.push({id:c});});
    (d.parents||[]).forEach(function(p){depOnMe.push({id:p});});
    (d.dependencies||[]).forEach(function(p){depOnMe.push({id:p});});
    var titleFor=function(nid){return (graph.nodes[nid]&&graph.nodes[nid].title)||nid;};
    document.getElementById("panel-dependencies").innerHTML=iDepend.map(function(r){
      return "<div class='rel-item' style='cursor:pointer;' onclick='drillToNode(\""+r.id+"\")'>"+esc(titleFor(r.id))+"</div>";
    }).join("")||"<span style='opacity:0.4;'>none</span>";
    document.getElementById("panel-dependents").innerHTML=depOnMe.map(function(r){
      return "<div class='rel-item' style='cursor:pointer;' onclick='drillToNode(\""+r.id+"\")'>"+esc(titleFor(r.id))+"</div>";
    }).join("")||"<span style='opacity:0.4;'>none</span>";
  }).catch(function(){});
  render();
}

function drillToNode(nid){
  selectNode(nid);
}

function closePanel(){
  creatingKind=null; selectedNode=null;
  document.getElementById("panel-title").textContent="New Node";
  document.getElementById("panel-relations").style.display="none";
  document.getElementById("btn-delete").style.display="none";
  document.getElementById("btn-inject").disabled=true;
  render();
}

function deleteSelectedNode(){
  if(!selectedNode) return;
  if(!confirm("Delete node "+selectedNode+"?")) return;
  fetch("/builder/nodes/"+selectedNode,{method:"DELETE"}).then(function(){
    delete graph.nodes[selectedNode]; delete nodePositions[selectedNode];
    graph.edges=graph.edges.filter(function(e){return e.src!==selectedNode&&e.dst!==selectedNode;});
    closePanel(); layoutGraph(); render();
  });
}

// --- Actions ---
async function runBatchAssess(){
  var orphans=[];
  Object.keys(graph.nodes).forEach(function(nid){
    var hasEdge=(graph.edges||[]).some(function(e){return e.src===nid||e.dst===nid;});
    if(!hasEdge) orphans.push(nid);
  });
  if(orphans.length>0){
    alert("Cannot run assessment. Orphan nodes:\n"+orphans.join(", ")); return;
  }
  var r=await fetch("/builder/batch-assess",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"full"})});
  var result=await r.json();
  var assessments=result.assessments||result;
  var violations=result.violations||[];
  if(violations.length>0) console.log("Violations:",violations);
  assessments.forEach(function(a){if(graph.nodes[a.node_id]){graph.nodes[a.node_id].severity=a.severity;}});
  layoutGraph(); render();
}

async function injectProblem(nodeId){
  if(!nodeId) return;
  var n=graph.nodes[nodeId];
  if(!n||!n.threshold_rules||!n.threshold_rules.length){alert("No threshold rules.");return;}
  var rule=n.threshold_rules[0];
  var cur=n.raw_value!=null?n.raw_value:rule.value;
  var bad=parseFloat(prompt("Inject problem for "+n.title+"\nRule: "+rule.field+" "+rule.operator+" "+rule.value+"\nCurrent: "+cur,rule.operator==="<"?Math.max(0,rule.value-20):rule.value+20));
  if(isNaN(bad)) return;
  var r=await fetch("/builder/inject",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({node_id:nodeId,raw_value:bad})});
  var d=await r.json();
  n.raw_value=d.raw_value;
  alert("Injected. "+n.title+" raw_value = "+d.raw_value);
}

function resetView(){ nodePositions={}; selectedNode=null; closePanel(); loadGraph(); }
