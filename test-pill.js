// Renders ProjectCard with the collapsed state forced on, across all four
// live states, and verifies the pill control's target, icon, and label.
var fs=require('fs'), vm=require('vm');
var src=fs.readFileSync('time-tracker.jsx','utf8')
  .replace(/^import[^\n]*\n/,'').replace(/^export default /m,'');
var patched=src.replace(
  'var cardCollapsedS=useState(function(){ var c=load("tt_cardcollapse",{}); return !!c[proj.id]; });',
  'var cardCollapsedS=useState(true);');
if(patched===src){ console.log('FAIL: collapse force anchor'); process.exit(1); }

function ce(type,props){
  var kids=Array.prototype.slice.call(arguments,2);
  if(typeof type==='function'){ var p=Object.assign({},props||{});
    if(kids.length) p.children=kids.length===1?kids[0]:kids; return type(p); }
  return {type:type,props:props||{},children:kids};
}
function useState(i){ var v=typeof i==='function'?i():i; return [v,function(){}]; }
var sb={ React:{createElement:ce,useState:useState,useEffect:function(){},useRef:function(v){return{current:v===undefined?null:v};},Fragment:'fragment'},
  useState:useState, useEffect:function(){}, useRef:function(v){return{current:v===undefined?null:v};},
  console:console,Math:Math,Date:Date,Object:Object,Array:Array,JSON:JSON,String:String,Number:Number,
  isNaN:isNaN,parseInt:parseInt,parseFloat:parseFloat,setTimeout:setTimeout,
  setInterval:function(){},clearInterval:function(){},Promise:Promise,
  navigator:{vibrate:function(){},clipboard:{writeText:function(){return Promise.resolve();}}},
  localStorage:{getItem:function(){return null;},setItem:function(){}},
  document:{addEventListener:function(){},removeEventListener:function(){},
    documentElement:{style:{setProperty:function(){}}},getElementById:function(){return null;},
    head:{appendChild:function(){}},createElement:function(){return{style:{},setAttribute:function(){}};}},
  window:{addEventListener:function(){},removeEventListener:function(){},dispatchEvent:function(){},
    matchMedia:function(){return{matches:false,addEventListener:function(){}};}} };
sb.globalThis=sb; vm.createContext(sb);
vm.runInContext(patched, sb, {filename:'patched.js'});
var C=sb;
C.applyTokens({ layout:'comfortable', tracking:'timer', colorScheme:'bright-pastels', theme:'neon-dream',
  schemes:{}, fonts:{}, mode:'dark', handedness:'right', headerPos:'top',
  workSchedule:C.DEFAULT_SCHEDULE(), timeInc:'standard' });

var pass=0,fail=0;
function ok(n,c,x){ if(c){pass++;console.log('  PASS  '+n);} else {fail++;console.log('  FAIL  '+n+(x!==undefined?'  -> '+JSON.stringify(x):''));} }
function eq(n,a,b){ ok(n, a===b, {got:a,want:b}); }
function flat(n,out){ out=out||[];
  if(n==null||n===false||n===true) return out;
  if(Array.isArray(n)){ n.forEach(function(x){flat(x,out);}); return out; }
  if(typeof n!=='object'){ out.push(n); return out; }
  out.push(n); flat(n.children,out); return out; }
function textOf(nodes){ return nodes.filter(function(n){ return typeof n==='string'; }).join(' | '); }

var parent={ id:1, name:'Line 4 Rebuild', lane:'Projects', parentId:null, notes:'', order:0 };
var sub={ id:2, name:'Teardown', lane:'Projects', parentId:1, notes:'', order:0 };
var meta={ Projects:{label:'Projects',accent:'#4B8EC8',bg:'#182430',dim:'#28405a'} };

function card(over){
  var toggled=[];
  var p=Object.assign({
    proj:parent, subTasks:[sub], isActive:false, interrupting:false, elapsed:0,
    todayMs:0, distCount:0, projDisruptions:[],
    onToggle:function(id){ toggled.push(id); }, onEdit:function(){}, onStages:function(){},
    onStageToggle:function(){}, onAddSub:function(){},
    activeId:null, todayLogs:[], todayDist:[], allProjects:[parent,sub],
    editMode:false, laneMeta:meta, dragHandleProps:{onMouseDown:function(){},onTouchStart:function(){}}
  }, over||{});
  var tree=C.ProjectCard(p);
  var nodes=flat(tree);
  var ctl=nodes.filter(function(n){ return n.props && n.props['data-pillctl']; })[0];
  return { nodes:nodes, txt:textOf(nodes), ctl:ctl, toggled:toggled,
    svg:ctl?flat(ctl).filter(function(n){ return n.type==='svg'; })[0]:null };
}
function shapes(svg){
  return flat(svg).filter(function(n){ return n.type==='rect'||n.type==='path'; })
    .map(function(n){ return n.type; }).join(',');
}
var stub={ stopPropagation:function(){} };

console.log('\n== idle pill ==');
var idle=card();
ok('pill renders the project name', idle.txt.indexOf('Line 4 Rebuild')>=0);
ok('pill control exists', !!idle.ctl);
eq('idle reads Start', idle.ctl.props['aria-label'], 'Start');
eq('idle icon is the play triangle', shapes(idle.svg), 'path');
ok('control is icon+text, not a button element', idle.ctl.type==='span' && idle.ctl.props.role==='button');
idle.ctl.props.onClick(stub);
eq('tap starts the parent', idle.toggled.join(','), '1');
ok('control swallows swipe starts', typeof idle.ctl.props.onMouseDown==='function' &&
   typeof idle.ctl.props.onTouchStart==='function');

console.log('\n== active pill ==');
var act=card({ isActive:true, activeId:1, todayMs:3600000, elapsed:0 });
eq('active reads Stop', act.ctl.props['aria-label'], 'Stop');
eq('active icon is the stop square', shapes(act.svg), 'rect');
ok('time shown while running', act.txt.indexOf('1h 00m')>=0);
act.ctl.props.onClick(stub);
eq('tap stops the parent', act.toggled.join(','), '1');

console.log('\n== interrupted pill ==');
var intr=card({ isActive:true, interrupting:true, activeId:1, todayMs:3600000 });
eq('interrupted reads Paused', intr.ctl.props['aria-label'], 'Paused');
eq('interrupted icon is the pause bars', shapes(intr.svg), 'rect,rect');
ok('Paused text visible in the pill', intr.txt.indexOf('Paused')>=0);

console.log('\n== active sub-task under a collapsed parent ==');
var subAct=card({ isActive:false, activeId:2, todayMs:1800000 });
eq('sub-active reads Stop', subAct.ctl.props['aria-label'], 'Stop');
subAct.ctl.props.onClick(stub);
eq('tap stops the SUB, never starts the parent', subAct.toggled.join(','), '2');
var subIntr=card({ isActive:false, activeId:2, interrupting:true, todayMs:1800000 });
eq('interrupted sub reads Paused through the parent pill', subIntr.ctl.props['aria-label'], 'Paused');

console.log('\n== expanded card untouched ==');
var expSrc=fs.readFileSync('time-tracker.jsx','utf8');
ok('expanded start button still present', expSrc.indexOf('// Start/Stop button')>=0);


console.log('\n== pill layout: title left, control right ==');
var lay=card();
var pill=lay.nodes.filter(function(n){ return n.props && n.props.style && n.props.style.borderRadius==='999px'; })[0];
ok('pill found', !!pill);
if(pill){
  var kids=pill.children.filter(function(k){ return k && typeof k==='object'; });
  ok('title is the first child, flexed left', kids[0].type==='span' &&
     kids[0].props.style.flex==='1 1 auto' && kids[0].props.style.textAlign==='left');
  ok('control is the last child', !!kids[kids.length-1].props['data-pillctl']);
  ok('pill no longer center-justified', pill.props.style.justifyContent===undefined);
}

console.log('\n== pulse wiring ==');
eq('hexBrighten brightens', C.hexBrighten('#000000',0.5), '#808080');
eq('hexBrighten passes garbage through', C.hexBrighten('red',0.5), 'red');
ok('css ships the pulse animation', fs.readFileSync('time-tracker.jsx','utf8').indexOf('@keyframes ttPulse')>=0
   && fs.readFileSync('time-tracker.jsx','utf8').indexOf("[data-pulse='1']")>=0);
var pIdle=card();
var pillIdle=pIdle.nodes.filter(function(n){ return n.props && n.props.style && n.props.style.borderRadius==='999px'; })[0];
ok('idle pill does not pulse', pillIdle.props['data-pulse']===undefined);
var pAct=card({ isActive:true, activeId:1 });
var pillAct=pAct.nodes.filter(function(n){ return n.props && n.props.style && n.props.style.borderRadius==='999px'; })[0];
eq('running pill pulses', pillAct.props['data-pulse'], '1');
ok('pulse vars carry the accent', pillAct.props.style['--pulse-a']==='#4B8EC8' &&
   /^#[0-9a-f]{6}$/i.test(pillAct.props.style['--pulse-b']));
var pInt=card({ isActive:true, activeId:1, interrupting:true });
var pillInt=pInt.nodes.filter(function(n){ return n.props && n.props.style && n.props.style.borderRadius==='999px'; })[0];
ok('interrupted pill does not pulse (paused, not running)', pillInt.props['data-pulse']===undefined);
var pSub=card({ activeId:2 });
var pillSub=pSub.nodes.filter(function(n){ return n.props && n.props.style && n.props.style.borderRadius==='999px'; })[0];
eq('running sub pulses the parent pill', pillSub.props['data-pulse'], '1');

console.log('\n== expanded card pulse (second sandbox, collapse off) ==');
var sb2={}; for(var k in sb) sb2[k]=sb[k];
sb2.globalThis=sb2; vm.createContext(sb2);
vm.runInContext(src, sb2, {filename:'plain.js'});
sb2.applyTokens({ layout:'comfortable', tracking:'timer', colorScheme:'bright-pastels', theme:'neon-dream',
  schemes:{}, fonts:{}, mode:'dark', handedness:'right', headerPos:'top',
  workSchedule:sb2.DEFAULT_SCHEDULE(), timeInc:'standard' });
function card2(over){
  var p=Object.assign({
    proj:parent, subTasks:[sub], isActive:false, interrupting:false, elapsed:0,
    todayMs:0, distCount:0, projDisruptions:[],
    onToggle:function(){}, onEdit:function(){}, onStages:function(){},
    onStageToggle:function(){}, onAddSub:function(){},
    activeId:null, todayLogs:[], todayDist:[], allProjects:[parent,sub],
    editMode:false, laneMeta:meta, dragHandleProps:{onMouseDown:function(){},onTouchStart:function(){}}
  }, over||{});
  return flat(sb2.ProjectCard(p));
}
function panelOf(nodes){ return nodes.filter(function(n){ return n.props && n.props['data-surface']==='panel'; })[0]; }
ok('idle card does not pulse', panelOf(card2()).props['data-pulse']===undefined);
eq('running card pulses', panelOf(card2({isActive:true,activeId:1})).props['data-pulse'], '1');
eq('running sub pulses the parent card', panelOf(card2({activeId:2})).props['data-pulse'], '1');
ok('interrupted card does not pulse', panelOf(card2({isActive:true,activeId:1,interrupting:true})).props['data-pulse']===undefined);
ok('expanded start button still on the card', textOf(card2({isActive:true,activeId:1})).indexOf('Stop')>=0);

console.log('\n== collapsed lane oval ==');
var lanePatched=src.replace(
  'var collapsedS=useState(function(){ var c=load("tt_lanecollapse",{}); return !!c[lane]; });',
  'var collapsedS=useState(true);');
if(lanePatched===src){ console.log('  FAIL  lane collapse force anchor'); fail++; }
var sb3={}; for(var k2 in sb) sb3[k2]=sb[k2];
sb3.globalThis=sb3; vm.createContext(sb3);
vm.runInContext(lanePatched, sb3, {filename:'lane.js'});
sb3.applyTokens({ layout:'comfortable', tracking:'timer', colorScheme:'bright-pastels', theme:'neon-dream',
  schemes:{}, fonts:{}, mode:'dark', handedness:'right', headerPos:'top',
  workSchedule:sb3.DEFAULT_SCHEDULE(), timeInc:'standard' });
function laneRender(over){
  var p=Object.assign({
    lane:'Projects', allProjects:[parent,sub], activeId:null, interrupting:false, elapsed:0,
    todayLogs:[], todayDist:[], onToggle:function(){}, onEdit:function(){}, onStages:function(){},
    onStageToggle:function(){}, onAddSub:function(){}, editMode:false,
    laneHandle:{onMouseDown:function(){},onTouchStart:function(){}},
    laneMeta:meta, laneOrder:['Projects'], onDeleteLane:function(){},
    onPickLane:function(){}, onNewLane:function(){}, onEditLanes:function(){},
    onDragStart:function(){}
  }, over||{});
  return flat(sb3.LaneSection(p));
}
function ovalOf(nodes){ return nodes.filter(function(n){ return n.props && n.props['data-laneoval']; })[0]; }
var idleLane=laneRender();
var idleOval=ovalOf(idleLane);
ok('collapsed oval renders', !!idleOval);
ok('idle oval: no pulse, no name, 16px', idleOval.props['data-pulse']===undefined &&
   textOf(flat(idleOval)).indexOf('Line 4')<0 && idleOval.props.style.height==='16px');
var runLane=laneRender({ activeId:1, elapsed:65*60000 });
var runOval=ovalOf(runLane);
eq('running oval pulses', runOval.props['data-pulse'], '1');
ok('running oval names the project', textOf(flat(runOval)).indexOf('Line 4 Rebuild')>=0);
ok('running oval shows elapsed', textOf(flat(runOval)).indexOf('1h 05m')>=0);
eq('running oval grows to fit the text', runOval.props.style.height, '20px');
var subLane=laneRender({ activeId:2, elapsed:60000 });
ok('running sub names itself in the oval', textOf(flat(ovalOf(subLane))).indexOf('Teardown')>=0);
var intLane=laneRender({ activeId:1, interrupting:true, elapsed:60000 });
var intOval=ovalOf(intLane);
ok('interrupted oval: named but not pulsing', intOval.props['data-pulse']===undefined &&
   textOf(flat(intOval)).indexOf('Paused: Line 4 Rebuild')>=0);
var otherLane=laneRender({ activeId:99 });
ok('a timer in another lane leaves this oval quiet', ovalOf(otherLane).props['data-pulse']===undefined);

console.log('\n== oval start/stop/resume control ==');
function laneRender2(over, toggled){
  var p=Object.assign({
    lane:'Projects', allProjects:[parent,sub], activeId:null, interrupting:false, elapsed:0,
    todayLogs:[], todayDist:[], onToggle:function(id){ (toggled||[]).push(id); }, onEdit:function(){},
    onStages:function(){}, onStageToggle:function(){}, onAddSub:function(){}, editMode:false,
    laneHandle:{onMouseDown:function(){},onTouchStart:function(){}},
    laneMeta:meta, laneOrder:['Projects'], onDeleteLane:function(){},
    onPickLane:function(){}, onNewLane:function(){}, onEditLanes:function(){},
    onDragStart:function(){}
  }, over||{});
  return flat(sb3.LaneSection(p));
}
function ctlOf(nodes){ return nodes.filter(function(n){ return n.props && n.props['data-ovalctl']; })[0]; }
function ctlShapes(ctl){ return flat(ctl).filter(function(n){ return n.type==='rect'||n.type==='path'; })
  .map(function(n){ return n.type; }).join(','); }

ok('idle oval has no control', !ctlOf(laneRender2()));
var togg=[];
var runL=laneRender2({ activeId:1, elapsed:60000 }, togg);
var runCtl=ctlOf(runL);
ok('running oval has the control', !!runCtl);
eq('running control reads Stop', runCtl.props['aria-label'], 'Stop');
eq('running icon is the stop square', ctlShapes(runCtl), 'rect');
runCtl.props.onClick(stub);
eq('tap stops the running project', togg.join(','), '1');
ok('control swallows swipe starts', typeof runCtl.props.onMouseDown==='function' &&
   typeof runCtl.props.onTouchStart==='function');

var togg2=[];
var intL=laneRender2({ activeId:1, interrupting:true, elapsed:60000 }, togg2);
var intCtl=ctlOf(intL);
eq('interrupted control reads Resume', intCtl.props['aria-label'], 'Resume');
eq('resume icon is the play triangle', ctlShapes(intCtl), 'path');
intCtl.props.onClick(stub);
eq('tap resumes via toggle on the active id', togg2.join(','), '1');

var togg3=[];
var subL=laneRender2({ activeId:2, elapsed:60000 }, togg3);
ctlOf(subL).props.onClick(stub);
eq('running sub: control targets the sub', togg3.join(','), '2');

console.log('\n== stopped project leaves the oval ==');
// toggleProject clears activeId -> re-render with activeId null is the after-state
var after=laneRender2({ activeId:null });
var afterOval=ovalOf(after);
ok('after stop: no name, no control, back to 16px',
   !ctlOf(after) && textOf(flat(afterOval)).indexOf('Line 4')<0 && afterOval.props.style.height==='16px');

console.log('\n== lane project count ==');
function countOf(nodes){ return nodes.filter(function(n){ return n.props && n.props['data-lanecount']; })[0]; }
var cColl=countOf(laneRender2());
ok('count shown on a collapsed lane', !!cColl);
eq('count is the top-level project total', cColl.children[0], 1);
// expanded lane (sb2 sandbox, collapse defaults off)
var expLane=flat(sb2.LaneSection({
  lane:'Projects', allProjects:[parent,sub,
    {id:3,name:'Second',lane:'Projects',parentId:null,order:1,notes:''}],
  activeId:null, interrupting:false, elapsed:0,
  todayLogs:[], todayDist:[], onToggle:function(){}, onEdit:function(){}, onStages:function(){},
  onStageToggle:function(){}, onAddSub:function(){}, editMode:false,
  laneHandle:{onMouseDown:function(){},onTouchStart:function(){}},
  laneMeta:meta, laneOrder:['Projects'], onDeleteLane:function(){},
  onPickLane:function(){}, onNewLane:function(){}, onEditLanes:function(){},
  onDragStart:function(){}
}));
var cExp=countOf(expLane);
ok('count shown on an expanded lane', !!cExp);
eq('count excludes sub-tasks (2 top-level, 1 sub)', cExp.children[0], 2);
console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
