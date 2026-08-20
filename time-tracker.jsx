import { useState, useEffect, useRef } from "react";

// ---- CONSTANTS ---------------------------------------------------------------
var LANES = {
  ACTIVITY: "Daily Activity",
  MAIN:     "Projects",
  SIDE:     "Side Projects"
};
var DEFAULT_META = {
  "Daily Activity":  { label:"Daily Activities", accent:"#4A9C6B", bg:"#0A1A0A", dim:"#1A3A1A" },
  "Projects":        { label:"Projects",          accent:"#4B8EC8", bg:"#0A141F", dim:"#1A3050" },
  "Side Projects":   { label:"Side Projects",     accent:"#9B6DD6", bg:"#140A1F", dim:"#3A1A5C" }
};
var LANE_COLORS = [
  { accent:"#4A9C6B", bg:"#0A1A0A", dim:"#1A3A1A", label:"Green"  },
  { accent:"#4B8EC8", bg:"#0A141F", dim:"#1A3050", label:"Blue"   },
  { accent:"#9B6DD6", bg:"#140A1F", dim:"#3A1A5C", label:"Purple" },
  { accent:"#C8824B", bg:"#1A0A05", dim:"#4A2A10", label:"Orange" },
  { accent:"#C84B7A", bg:"#1A0510", dim:"#4A1030", label:"Pink"   },
  { accent:"#C8C44B", bg:"#1A1A05", dim:"#4A4A10", label:"Yellow" },
  { accent:"#4BC8C4", bg:"#051A1A", dim:"#104A4A", label:"Teal"   },
  { accent:"#C84B4B", bg:"#1A0505", dim:"#4A1010", label:"Red"    }
];
var DEFAULT_ORDER = ["Daily Activity","Projects","Side Projects"];
var PRESET_BREAKS = ["Morning Break","Lunch","Afternoon Break","End of Day"];
var DEFAULT_DIST_PRESETS = ["Phone Call","Walk-in Visitor","Crew Question","Machine Issue"];

// ---- HELPERS -----------------------------------------------------------------
function pad(n){ return String(n).padStart(2,"0"); }
function uid(){ return Math.random().toString(36).slice(2,9); }
function fmtDur(ms, short){
  if(TIME_INC==="tenths"){
    // decimal hours to the hundredth, never days: 1h 30m -> "1.50h"
    return (Math.abs(ms)/3600000).toFixed(2)+"h";
  }
  var s=Math.floor(Math.abs(ms)/1000), d=Math.floor(s/86400),
      h=Math.floor((s%86400)/3600), m=Math.floor((s%3600)/60), sec=s%60;
  if(short){
    if(d>0) return d+"d "+h+"h "+pad(m)+"m";
    if(h>0) return h+"h "+pad(m)+"m";
    if(m>0) return m+"m "+pad(sec)+"s";
    return sec+"s";
  }
  return (d>0 ? d+"d " : "")+pad(h)+":"+pad(m)+":"+pad(sec);
}
function fmtTime(ts){ if(!ts) return "--"; var d=new Date(ts); return pad(d.getHours())+":"+pad(d.getMinutes()); }
function fmtDate(ts){ if(!ts) return "--"; var d=new Date(ts); return (d.getMonth()+1)+"/"+d.getDate()+"/"+d.getFullYear(); }
function todayStr(){ return new Date().toDateString(); }
function haptic(pattern){ try{ if(navigator&&navigator.vibrate) navigator.vibrate(pattern||10); }catch(e){} }
function load(key, def){ try{ var v=localStorage.getItem(key); return v?JSON.parse(v):def; }catch(e){ return def; } }
function save(key, val){ try{ localStorage.setItem(key,JSON.stringify(val)); }catch(e){} }

// ---------------- Backup & restore ----------------
// Every app key is tt_-prefixed, so a backup is simply every tt_* key with its
// raw (already-JSON) string value. Modules that store under tt_mod_* later
// are covered automatically. Restore is replace-all: existing tt_* keys are
// cleared first, so a restore really is the backed-up state.
var TT_KEY_PREFIX="tt_";
function backupBuild(storage){
  var data={};
  try{
    for(var i=0;i<storage.length;i++){
      var k=storage.key(i);
      if(k && k.indexOf(TT_KEY_PREFIX)===0) data[k]=storage.getItem(k);
    }
  }catch(e){}
  return { ttBackup:1, app:"Time Tracker", exportedAt:new Date().toISOString(), data:data };
}
function backupValidate(obj){
  if(!obj || obj.ttBackup!==1 || typeof obj.data!=="object" || obj.data===null || Array.isArray(obj.data))
    return "Not a Time Tracker backup file.";
  var keys=Object.keys(obj.data);
  if(!keys.length) return "Backup contains no data.";
  for(var i=0;i<keys.length;i++){
    if(keys[i].indexOf(TT_KEY_PREFIX)!==0) return "Backup contains unexpected keys.";
    if(typeof obj.data[keys[i]]!=="string") return "Backup data is malformed.";
    try{ JSON.parse(obj.data[keys[i]]); }catch(e){ return "Backup data is malformed."; }
  }
  return null;
}
function backupSummary(obj){
  function count(key){
    try{ var v=JSON.parse(obj.data[key]); return Array.isArray(v)?v.length:null; }catch(e){ return null; }
  }
  var range=null;
  try{
    var ls=JSON.parse(obj.data["tt_logs"])||[];
    var min=Infinity, max=-Infinity;
    ls.forEach(function(l){ if(l&&l.startTime){ if(l.startTime<min)min=l.startTime; if(l.startTime>max)max=l.startTime; } });
    if(min<Infinity) range={min:min,max:max};
  }catch(e){}
  return { keys:Object.keys(obj.data||{}).length, logs:count("tt_logs"),
           projects:count("tt_projects"), range:range, exportedAt:obj.exportedAt||null };
}
function backupApply(obj, storage){
  var err=backupValidate(obj);
  if(err) return { ok:false, error:err };
  try{
    var stale=[];
    for(var i=0;i<storage.length;i++){
      var k=storage.key(i);
      if(k && k.indexOf(TT_KEY_PREFIX)===0) stale.push(k);
    }
    stale.forEach(function(k){ storage.removeItem(k); });
    Object.keys(obj.data).forEach(function(k){ storage.setItem(k, obj.data[k]); });
    return { ok:true, keys:Object.keys(obj.data).length, removed:stale.length };
  }catch(e){
    return { ok:false, error:"Could not write the backup: "+((e&&e.message)||"storage error") };
  }
}
function getMeta(laneMeta, lane){
  var m = (laneMeta&&laneMeta[lane]) || DEFAULT_META[lane] || { label:lane, accent:"#888", bg:"#111", dim:"#333" };
  var set = S.lanes;
  if(set){
    var i = LANE_INDEX[String(m.accent).toUpperCase()];
    if(i!==undefined && set[i]) return { label:m.label, accent:set[i].accent, bg:set[i].bg, dim:set[i].dim };
  }
  return m;
}
function getChildren(projects, parentId){ return projects.filter(function(p){ return p.parentId===parentId; }); }
function getDescendantIds(projects, id){
  var result=[], queue=getChildren(projects,id);
  while(queue.length){ var p=queue.shift(); result.push(p.id); queue=queue.concat(getChildren(projects,p.id)); }
  return result;
}

// ---- SAMPLE DATA -------------------------------------------------------------
var REAL_PROJECTS = [
  { id:1, name:"Label Printing", lane:"Daily Activity", notes:"", order:0, parentId:null, stages:[] },
  { id:2, name:"Laminating",     lane:"Daily Activity", notes:"", order:1, parentId:null, stages:[] },
  { id:3, name:"Crew Training",  lane:"Projects",       notes:"", order:0, parentId:null, stages:[] }
];
var TEST_PROJECTS = [
  { id:101, name:"Morning Standup",     lane:"Daily Activity", notes:"Daily sync",    order:0, parentId:null, stages:[] },
  { id:102, name:"Equipment Check",     lane:"Daily Activity", notes:"Floor walk",    order:1, parentId:null, stages:[] },
  { id:103, name:"Safety Report Q3",    lane:"Projects",       notes:"Quarterly doc", order:0, parentId:null,
    stages:[
      {id:"s1",label:"Gather incident data",   done:true,  doneAt:Date.now()-86400000*3, note:"Pulled from logs"},
      {id:"s2",label:"Risk assessment",         done:true,  doneAt:Date.now()-86400000,   note:""},
      {id:"s3",label:"Management review",       done:false, doneAt:null, note:""},
      {id:"s4",label:"Submit to compliance",    done:false, doneAt:null, note:""}
    ]},
  { id:104, name:"Risk Assessment",     lane:"Projects", notes:"Section 2",    order:0, parentId:103, stages:[] },
  { id:105, name:"Incident Log Review", lane:"Projects", notes:"Last 90 days", order:1, parentId:103, stages:[] },
  { id:106, name:"New Hire Onboarding", lane:"Projects", notes:"3 new hires",  order:1, parentId:null,
    stages:[
      {id:"s5",label:"Paperwork",     done:false,doneAt:null,note:""},
      {id:"s6",label:"Badges issued", done:false,doneAt:null,note:""},
      {id:"s7",label:"Safety walkthrough", done:false,doneAt:null,note:""}
    ]},
  { id:107, name:"Process Improvement", lane:"Side Projects", notes:"Label workflow", order:0, parentId:null, stages:[] }
];

// ---- HOOKS -------------------------------------------------------------------
// Global scroll tracker: while the body (or any inner container) is scrolling,
// long-holds are blocked and clicks are swallowed.
var SCROLL_STATE = { scrolling:false, timer:null };
var UI = { left:false, bottom:false, bottomClear:0, topClear:0 };
// "standard" shows d/h/m/s; "tenths" shows decimal hours to hundredths.
// Set from settings in applyTokens, so a flip reformats everything on the fly.
var TIME_INC = "standard";
// Keeps a freshly opened menu clear of the viewport edges and the floating
// header. Scrolls when there is runway; when the page cannot scroll far
// enough (e.g. the last lane), flips the menu to open upward instead.
function menuAutoScroll(el){
  if(!el) return;
  try{
    var r = el.getBoundingClientRect();
    var limit = window.innerHeight - UI.bottomClear;
    if(r.bottom <= limit) return;
    var need = r.bottom - limit + 12;
    var doc = document.documentElement || document.body;
    var runway = doc.scrollHeight - (window.scrollY + window.innerHeight);
    if(runway >= need){
      window.scrollBy({ top: need, behavior:"smooth" });
    } else {
      // Flip: open upward from the trigger
      el.style.top = "auto";
      el.style.bottom = "calc(100% + 4px)";
      var r2 = el.getBoundingClientRect();
      if(r2.top < UI.topClear){
        window.scrollBy({ top: r2.top - UI.topClear - 12, behavior:"smooth" });
      }
    }
  }catch(e){}
}
function markScrolling(){
  SCROLL_STATE.scrolling = true;
  clearTimeout(SCROLL_STATE.timer);
  SCROLL_STATE.timer = setTimeout(function(){ SCROLL_STATE.scrolling = false; }, 180);
}

// Gesture: distinguishes single tap from double tap.
// Single fires after a short delay if no second tap arrives; double fires immediately.
// Blocked entirely while the page is scrolling.
function useTaps(onSingle, onDouble, delayMs){
  delayMs = delayMs || 300;
  var timer = useRef(null);
  var count = useRef(0);
  var singleRef = useRef(onSingle);
  var doubleRef = useRef(onDouble);
  singleRef.current = onSingle;
  doubleRef.current = onDouble;
  return function(){
    if(SCROLL_STATE.scrolling) return;
    count.current += 1;
    if(count.current === 1){
      timer.current = setTimeout(function(){
        var c = count.current;
        count.current = 0;
        if(c === 1 && singleRef.current) singleRef.current();
      }, delayMs);
    } else {
      clearTimeout(timer.current);
      count.current = 0;
      haptic(20);
      if(doubleRef.current) doubleRef.current();
    }
  };
}

// ---- STYLE CONSTANTS ---------------------------------------------------------
var S = {
  mode:"dark",
  bg0:"#080810", bg1:"#0D0D1A", bg2:"#12121E", bg3:"#1A1A2E", menuBg:"#13131F",
  border:"#252538", borderBright:"#3A3A5A",
  text:"#E8E8F0", textDim:"#9090B0", textMuted:"#5A5A7A",
  radius:"10px", radius2:"12px", radius3:"8px"
};

// ---- PRIMITIVES --------------------------------------------------------------
function Mono(props){
  var style = Object.assign({ fontFamily:S.fontMono }, props.style||{});
  return React.createElement("span", { style:style }, props.children);
}

// Floating modal action bar. Sticky inside the scrolling shell, so it stays
// visible however long the content is. It mirrors the app chrome: header at
// the bottom puts the bar at the bottom, left-handed mode reverses the button
// order so the primary lands under the thumb.
function ModalActions(props){
  var st={ position:"sticky", zIndex:5, display:"flex", gap:"0.6rem", alignItems:"stretch",
           flexDirection: UI.left ? "row-reverse" : "row",
           background:S.menuBg, border:"1px solid "+S.border, borderRadius:S.radius,
           padding:"0.55rem", boxShadow:"0 8px 32px rgba(0,0,0,0.45)" };
  if(UI.bottom){ st.bottom="-1.25rem"; st.order=9999; st.marginTop="0.9rem"; }
  else { st.top="-1.25rem"; st.order=-1; st.marginBottom="0.9rem"; }
  return React.createElement("div", { "data-surface":"menu", style:st }, props.children);
}
// Built per render: a module-level constant would freeze the tokens of
// whatever palette was active at load time and ignore every later theme or
// mode switch - exactly how the Settings cancel went wrong in light mode.
function MODAL_CANCEL(){ return { flex:1,background:S.bg1,border:"1px solid "+S.border,borderRadius:S.radius,padding:"0.85rem",color:S.textDim,cursor:"pointer",fontFamily:S.fontBody }; }
function MODAL_SAVE(){ return { flex:1,background:S.infoBg,border:"2.5px solid "+S.actionBdr,borderRadius:S.radius,padding:"0.85rem",color:S.infoText,fontWeight:700,cursor:"pointer",fontFamily:S.fontBody,fontSize:"0.95rem" }; }

function Modal(props){
  var wide = props.wide;
  return (
    React.createElement("div", {
      onClick: function(e){ if(e.target===e.currentTarget) props.onClose(); },
      style:{ position:"fixed",inset:0,background:S.scrim,zIndex:900,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem",
              backdropFilter:S.scrimBlur,WebkitBackdropFilter:S.scrimBlur }
    },
      React.createElement("div", { "data-surface":"modal",
        style:{ background:S.modalBg,border:"2px solid "+S.border,borderRadius:S.radius2,padding:"1.25rem",width:"100%",maxWidth:wide?"520px":"400px",maxHeight:"85vh",overflowY:"auto",
                display:"flex",flexDirection:"column" }
      },
        React.createElement("div", { style:{display:"flex",justifyContent:UI.left?"flex-end":"flex-start",alignItems:"center",marginBottom:"1rem"} },
          React.createElement("span", { style:{fontWeight:700,fontSize:"1rem",color:S.text} }, props.title)
        ),
        props.children,
        // Modals that keep their own action row pass ownActions; every other
        // modal gets a floating bar with Save (when provided) and Cancel.
        !props.ownActions && React.createElement(ModalActions, null,
          props.onSave && React.createElement("button", { onClick:props.onSave, style:MODAL_SAVE() }, props.saveLabel||"Save"),
          React.createElement("button", { onClick:props.onClose, style:MODAL_CANCEL() }, props.cancelLabel||"Cancel")
        )
      )
    )
  );
}

var INPUT_STYLE = { direction:"ltr",textAlign:"left",width:"100%",background:"#0A0A16",border:"2px solid "+S.border,borderRadius:S.radius3,padding:"0.65rem 0.85rem",color:S.text,fontFamily:S.fontBody,fontSize:"0.92rem",outline:"none" };
var LABEL_STYLE = { display:"block",color:S.textDim,fontSize:"0.75rem",marginBottom:"0.35rem",textTransform:"uppercase",letterSpacing:"0.08em" };

// ---- DESIGN TOKENS -----------------------------------------------------------
// Schemes own color; themes own structure. Every scheme ships dark AND light
// surface variants so any theme x scheme x mode combination works.
var SCHEMES = {
  "bright-pastels": {
    label: "Bright Pastels",
    swatches: ["#4A9C6B","#4B8EC8","#9B6DD6","#CC5050","#C8A030","#4BC8C4"],
    lanes: LANE_COLORS,
    dark: {
      bg0:"#080810", bg1:"#0D0D1A", bg2:"#12121E", bg3:"#1A1A2E", menuBg:"#13131F",
      border:"#252538", borderBright:"#3A3A5A",
      text:"#E8E8F0", textDim:"#9090B0", textMuted:"#5A5A7A", inputBg:"#0A0A16",
      ink:"#04040A", titleText:"#F4F4FF",
      successBg:"#0A180A", successBg2:"#0E200E", successBorder:"#2A6A2A",
      successText:"#4ADF8A", successMid:"#5DC878", successDim:"#4A9C6B",
      dangerBg:"#250A0A", dangerBg2:"#3A0808", dangerTint:"#220808",
      dangerText:"#E87070", dangerBright:"#FF7070", bang:"#CC5050",
      warnBg:"#1F1800", warnText:"#C8A030",
      infoBg:"#1E2A3A", infoText:"#7AB8F0",
      // Chrome: idle control borders, glyphs, labels and rules.
      chromeBdr:"#5858B0", chromeBdrOn:"#8A8AEE", chromeIcon:"#7070AA", chromeIconOn:"#CCCCFF",
      chromeText:"#8888CC", chromeTrack:"#2A2A50", chromeTrackOn:"#2A4A7A",
      chromeTime:"#63639C", chromeSubTask:"#6A8EC8",
      // States, accents and neutrals - see palette-map.html
      distBdr:"#AA4040", distBdrOpen:"#CC2828", distBdrLive:"#FF3030",
      distEdge:"#8A1515", distStartBdr:"#CC3030", distIcon:"#FF6060",
      distBadge:"#FF7070", distLbl:"#FF8080", distGlow:"#C0392B",
      distDim:"#C86B6B", distNote:"#A06060", distChipBg:"#883030",
      distChipMark:"#CC5050", distTrack:"#6A1010", clockBdr:"#4A9A4A",
      clockBdrOn:"#5ADF6A", stageDoneBdr:"#3A9A3A", stageDoneText:"#4ADF8A",
      stageNote:"#5A7A5A", breakGo:"#3A7A3A", actionBdr:"#4B8EC8",
      actionText:"#4B8EC8", arrangeText:"#9B6DD6", arrangeHint:"#7A68C8",
      testFrameBg:"#3A2A00", testFrameInk:"#C8A030", statusEdgeOn:"#1A3050",
      statusEdgeBrk:"#2A2010", mutedGlyph:"#666666", dragGlyph:"#555555",
      onAccent:"#FFFFFF", addDisabled:"#252538", runningTint:"#0A1420"
    },
    light: {
      bg0:"#EEEEF6", bg1:"#FAFAFF", bg2:"#E4E4F0", bg3:"#D6D6E8", menuBg:"#FFFFFF",
      border:"#B8B8D0", borderBright:"#9090B8",
      text:"#16162A", textDim:"#44446A", textMuted:"#8080A0", inputBg:"#FFFFFF",
      ink:"#3A3A55", titleText:"#10102A",
      successBg:"#E2F3E6", successBg2:"#D2ECD8", successBorder:"#3A9A5A",
      successText:"#0E6E34", successMid:"#1E7A3E", successDim:"#2A8A4A",
      dangerBg:"#FBE6E6", dangerBg2:"#F6D4D4", dangerTint:"#FADEDE",
      dangerText:"#A82424", dangerBright:"#C02020", bang:"#C03030",
      warnBg:"#F6EED0", warnText:"#755800",
      infoBg:"#D8E6F6", infoText:"#1E5A9A",
      // Chrome: idle control borders, glyphs, labels and rules.
      chromeBdr:"#8A8AC0", chromeBdrOn:"#5A5AB8", chromeIcon:"#6A6AA8", chromeIconOn:"#4040B8",
      chromeText:"#4A4A80", chromeTrack:"#C8C8DC", chromeTrackOn:"#7A9AD0",
      chromeTime:"#5A5A90", chromeSubTask:"#3A6EA8",
      // States, accents and neutrals
      distBdr:"#C97A6A", distBdrOpen:"#C0402A", distBdrLive:"#D02010",
      distEdge:"#B04030", distStartBdr:"#C24A38", distIcon:"#C0362A",
      distBadge:"#B83020", distLbl:"#A82818", distGlow:"#C0392B",
      distDim:"#A85A4A", distNote:"#9A5A4A", distChipBg:"#C4523C",
      distChipMark:"#B4472C", distTrack:"#E8C4BC", clockBdr:"#4A9A5A",
      clockBdrOn:"#2A8A44", stageDoneBdr:"#3A9A5A", stageDoneText:"#14682E",
      stageNote:"#4A6A50", breakGo:"#2E7A3E", actionBdr:"#4B8EC8",
      actionText:"#1E5A9A", arrangeText:"#6A3EA8", arrangeHint:"#7A5AB8",
      testFrameBg:"#F0E4C0", testFrameInk:"#8A6A10", statusEdgeOn:"#A8BCD8",
      statusEdgeBrk:"#D8C89A", mutedGlyph:"#8A8AA0", dragGlyph:"#9A9AAE",
      onAccent:"#FFFFFF", addDisabled:"#C8C8DC", runningTint:"#E4ECF8"
    }
  },
  "vegas": {
    label: "Vegas Neon",
    swatches: ["#FF2E9E","#4BF0FF","#B8FF2E","#A02EFF","#FFC61E","#FF6A00"],
    lanes: [
      { accent:"#FF2E9E", bg:"#2A0418", dim:"#5A0A34", label:"Magenta" },
      { accent:"#B8FF2E", bg:"#141A02", dim:"#2E4008", label:"Acid" },
      { accent:"#2EE8FF", bg:"#02202A", dim:"#0A4A5A", label:"Cyan" },
      { accent:"#A02EFF", bg:"#160428", dim:"#380A5A", label:"Violet" },
      { accent:"#2EFF8A", bg:"#02200E", dim:"#0A5A28", label:"Laser" },
      { accent:"#2E6EFF", bg:"#040E28", dim:"#0E2A5A", label:"Electric" },
      { accent:"#FFC61E", bg:"#201800", dim:"#4A3A00", label:"Marquee" },
      { accent:"#FF6A00", bg:"#200A00", dim:"#5A2200", label:"Sunset" }
    ],
    dark: {
      bg0:"#0A0410", bg1:"#12061C", bg2:"#180A24",
      bg3:"#221030", menuBg:"#150822", border:"#33184A",
      borderBright:"#5A2A80", text:"#F6E8FF", textDim:"#C09AD8",
      textMuted:"#8058A0", inputBg:"#08030E", ink:"#05000A", titleText:"#FFF0FF",
      successBg:"#06180C", successBg2:"#0A2410", successBorder:"#0A6A8A",
      successText:"#4BF0FF", successMid:"#2ED8F0", successDim:"#22B0C8",
      dangerBg:"#22040E", dangerBg2:"#380818", dangerTint:"#1E0410",
      dangerText:"#FF5FA0", dangerBright:"#FF2E86", bang:"#E02070",
      warnBg:"#201800", warnText:"#FFC61E", infoBg:"#141A02",
      infoText:"#B8FF2E", chromeBdr:"#8A1EC0", chromeBdrOn:"#C64BFF",
      chromeIcon:"#9A5AC8", chromeIconOn:"#F0B0FF", chromeText:"#E08AFF",
      chromeTrack:"#2A1040", chromeTrackOn:"#7A2ECC", chromeTime:"#B060E0",
      chromeSubTask:"#FF6ED0", distBdr:"#C01878", distBdrOpen:"#D0186A",
      distBdrLive:"#FF1E7A", distEdge:"#7A0A34", distStartBdr:"#E01860",
      distIcon:"#FF4A8E", distBadge:"#FF6BA0", distLbl:"#FF8CB8",
      distGlow:"#E0186E", distDim:"#E08AB8", distNote:"#C878A0",
      distChipBg:"#A80858", distChipMark:"#E03878", distTrack:"#6A0A2E",
      clockBdr:"#1EA8C8", clockBdrOn:"#7CF8FF", stageDoneBdr:"#1E9AB8",
      stageDoneText:"#6EF4FF", stageNote:"#6AB8C8", breakGo:"#1888A8",
      actionBdr:"#FF3ECF", actionText:"#FF6EE0", arrangeText:"#A02EFF",
      arrangeHint:"#7A2ECC", testFrameBg:"#2A0A2A", testFrameInk:"#FFC61E",
      statusEdgeOn:"#2A1050", statusEdgeBrk:"#2A2000", mutedGlyph:"#8A5AB8",
      dragGlyph:"#7A4AA8", onAccent:"#FFFFFF", addDisabled:"#2A1240",
      runningTint:"#16062A"
    },
    light: {
      bg0:"#F6EFFA", bg1:"#FFFBFF", bg2:"#EDE0F4",
      bg3:"#E0CCEC", menuBg:"#FFFFFF", border:"#D0B0E0",
      borderBright:"#A870C8", text:"#1A0824", textDim:"#4A2A60",
      textMuted:"#8060A0", inputBg:"#FFFFFF", ink:"#48113A", titleText:"#12001A",
      successBg:"#DEF7E6", successBg2:"#C8F0D6", successBorder:"#0A7A9A",
      successText:"#005A70", successMid:"#006880", successDim:"#007690",
      dangerBg:"#FFE0EE", dangerBg2:"#FFCCE0", dangerTint:"#FFE8F2",
      dangerText:"#B00050", dangerBright:"#D0005E", bang:"#C00058",
      warnBg:"#FFF0C0", warnText:"#B04A00", infoBg:"#F0FAD0",
      infoText:"#4A6000", chromeBdr:"#B478D8", chromeBdrOn:"#8A20C0",
      chromeIcon:"#8A48B0", chromeIconOn:"#6A00A0", chromeText:"#7A2AA0",
      chromeTrack:"#E0B8F8", chromeTrackOn:"#A850E0", chromeTime:"#9A3AC0",
      chromeSubTask:"#C0007A", distBdr:"#D06090", distBdrOpen:"#C00060",
      distBdrLive:"#E00070", distEdge:"#A00048", distStartBdr:"#CE0068",
      distIcon:"#C00060", distBadge:"#B00058", distLbl:"#A00050",
      distGlow:"#D0006A", distDim:"#A85078", distNote:"#9A5070",
      distChipBg:"#C0186A", distChipMark:"#B02068", distTrack:"#FCB0E8",
      clockBdr:"#0A7A9A", clockBdrOn:"#00647E", stageDoneBdr:"#0A7A9A",
      stageDoneText:"#005A70", stageNote:"#3A7A88", breakGo:"#00708A",
      actionBdr:"#C000A0", actionText:"#A00088", arrangeText:"#8000B0",
      arrangeHint:"#9A30C0", testFrameBg:"#FFD6E5", testFrameInk:"#B04A00",
      statusEdgeOn:"#F6A9DC", statusEdgeBrk:"#D2C63C", mutedGlyph:"#9A5AB8",
      dragGlyph:"#A86AC8", onAccent:"#FFFFFF", addDisabled:"#F59ADF",
      runningTint:"#FADEF2"
    }
  },
  "seaglass": {
    label: "Sea Glass",
    swatches: ["#4FB8A8","#4E9AC0","#7E9ED0","#C0A878","#C08098","#B8C070"],
    lanes: [
      { accent:"#4FB8A8", bg:"#00201A", dim:"#1B4740", label:"Seafoam" },
      { accent:"#4E9AC0", bg:"#001D2B", dim:"#254354", label:"Lagoon" },
      { accent:"#7E9ED0", bg:"#0A1A2D", dim:"#334056", label:"Haze" },
      { accent:"#C0A878", bg:"#221800", dim:"#493F2A", label:"Driftglass" },
      { accent:"#C08098", bg:"#2A121C", dim:"#543842", label:"Shell" },
      { accent:"#B8C070", bg:"#1B1B00", dim:"#3F4221", label:"Kelp" },
      { accent:"#5FC0C8", bg:"#001F22", dim:"#1D4649", label:"Aqua" },
      { accent:"#9088C0", bg:"#19172C", dim:"#413D55", label:"Tide" }
    ],
    dark: {
      bg0:"#0C1C1C", bg1:"#142929", bg2:"#173332",
      bg3:"#1C4140", menuBg:"#152E2D", border:"#1F2831",
      borderBright:"#2F3E4E", text:"#E6E9ED", textDim:"#93A3B3",
      textMuted:"#505E6E", inputBg:"#091817", ink:"#090B0E",
      titleText:"#F1F5FB", successBg:"#0D170D", successBg2:"#111F11",
      successBorder:"#386835", successText:"#6EDB96", successMid:"#73C484",
      successDim:"#5B9972", dangerBg:"#220C0C", dangerBg2:"#350E0D",
      dangerTint:"#1F0A0A", dangerText:"#DA7977", dangerBright:"#EE7C79",
      bang:"#BE5B58", warnBg:"#1E1808", warnText:"#C2A152",
      infoBg:"#182C36", infoText:"#6ABDDE", chromeBdr:"#006E9D",
      chromeBdrOn:"#00A3D7", chromeIcon:"#2B7E9B", chromeIconOn:"#A0D9F1",
      chromeText:"#3899BB", chromeTrack:"#003447", chromeTrackOn:"#005363",
      chromeTime:"#267B99", chromeSubTask:"#3E99A9", distBdr:"#9E4A47",
      distBdrOpen:"#BC3F35", distBdrLive:"#EB4E41", distEdge:"#7F261F",
      distStartBdr:"#BC443C", distIcon:"#ED6F6B", distBadge:"#EE7C79",
      distLbl:"#F08A88", distGlow:"#B24838", distDim:"#BC7270",
      distNote:"#986463", distChipBg:"#7E3836", distChipMark:"#BE5B58",
      distTrack:"#611D17", clockBdr:"#5A9757", clockBdrOn:"#78DB7D",
      stageDoneBdr:"#50974B", stageDoneText:"#6EDB96", stageNote:"#5F795F",
      breakGo:"#477845", actionBdr:"#2295AE", actionText:"#2295AE",
      arrangeText:"#0091C3", arrangeHint:"#0084AA", testFrameBg:"#372B0F",
      testFrameInk:"#C2A152", statusEdgeOn:"#173341", statusEdgeBrk:"#2B1F1A",
      mutedGlyph:"#666666", dragGlyph:"#555555", onAccent:"#F6F6F6",
      addDisabled:"#1E2832", runningTint:"#09151A"
    },
    light: {
      bg0:"#DDEEEE", bg1:"#F2FBFB", bg2:"#D0E7E6",
      bg3:"#B6D8D7", menuBg:"#F8FDFD", border:"#B1BBC7",
      borderBright:"#8395A9", text:"#0F1923", textDim:"#37495C",
      textMuted:"#768494", inputBg:"#F8FDFD", ink:"#313E4B",
      titleText:"#051421", successBg:"#E5F2E8", successBg2:"#D6EBDB",
      successBorder:"#509764", successText:"#2B6C3D", successMid:"#367747",
      successDim:"#418754", dangerBg:"#F8E7E7", dangerBg2:"#F1D6D6",
      dangerTint:"#F6DFDF", dangerText:"#9B352E", dangerBright:"#B1382E",
      bang:"#B1423B", warnBg:"#F4EED7", warnText:"#715920",
      infoBg:"#D4E8F1", infoText:"#00618D", chromeBdr:"#5597B2",
      chromeBdrOn:"#0072A5", chromeIcon:"#107A99", chromeIconOn:"#0061A5",
      chromeText:"#005873", chromeTrack:"#B8CDD6", chromeTrackOn:"#56A4B3",
      chromeTime:"#0A6883", chromeSubTask:"#007886", distBdr:"#BF7F71",
      distBdrOpen:"#B24D38", distBdrLive:"#C03B25", distEdge:"#A44A3B",
      distStartBdr:"#B55544", distIcon:"#B24537", distBadge:"#AA402E",
      distLbl:"#9B3826", distGlow:"#B24838", distDim:"#9E5F52",
      distNote:"#925E51", distChipBg:"#B75B48", distChipMark:"#A85039",
      distTrack:"#E3C6BF", clockBdr:"#5A9764", clockBdrOn:"#41874F",
      stageDoneBdr:"#509764", stageDoneText:"#2B6637", stageNote:"#4F6954",
      breakGo:"#3F7848", actionBdr:"#2295AE", actionText:"#006387",
      arrangeText:"#006395", arrangeHint:"#0078A2", testFrameBg:"#EDE4C9",
      testFrameInk:"#866B2E", statusEdgeOn:"#A7BEC9", statusEdgeBrk:"#E0C3B1",
      mutedGlyph:"#818E98", dragGlyph:"#929DA7", onAccent:"#F6F6F6",
      addDisabled:"#C1CBD5", runningTint:"#E3EDF1"
    }
  },
  "frost": {
    label: "Frost",
    swatches: ["#6E8ED8","#8A80D8","#5FA8C8","#A889C8","#C08AA8","#9AA8C0"],
    lanes: [
      { accent:"#6E8ED8", bg:"#061935", dim:"#323F5F", label:"Glacier" },
      { accent:"#8A80D8", bg:"#171537", dim:"#403B61", label:"Iris" },
      { accent:"#0093A9", bg:"#001D26", dim:"#09444E", label:"Meltwater" },
      { accent:"#A889C8", bg:"#20142C", dim:"#483A55", label:"Orchid" },
      { accent:"#C18F75", bg:"#271301", dim:"#50382C", label:"Blush" },
      { accent:"#9AA8C0", bg:"#141A23", dim:"#3A404A", label:"Sleet" },
      { accent:"#83B693", bg:"#031C0C", dim:"#2B4333", label:"Rime" },
      { accent:"#EE86D0", bg:"#310327", dim:"#5D2D4F", label:"Amethyst" }
    ],
    dark: {
      bg0:"#111B22", bg1:"#1A2732", bg2:"#1F303D",
      bg3:"#263E4F", menuBg:"#1C2C37", border:"#29252E",
      borderBright:"#423A49", text:"#EAE8EC", textDim:"#A49CAC",
      textMuted:"#615A69", inputBg:"#0E171D", ink:"#0C0A0D",
      titleText:"#F6F4F9", successBg:"#031106", successBg2:"#001301",
      successBorder:"#002B04", successText:"#1E9261", successMid:"#2C7E50",
      successDim:"#19563C", dangerBg:"#5A4547", dangerBg2:"#72494A",
      dangerTint:"#574446", dangerText:"#FFC2C6", dangerBright:"#FFC7CB",
      bang:"#FFA4A4", warnBg:"#555244", warnText:"#FFECA1",
      infoBg:"#292837", infoText:"#A5B0EC", chromeBdr:"#8B4B82",
      chromeBdrOn:"#C37DBA", chromeIcon:"#90698C", chromeIconOn:"#E7C6E6",
      chromeText:"#AD80A9", chromeTrack:"#40253C", chromeTrackOn:"#564265",
      chromeTime:"#8D6689", chromeSubTask:"#9985AF", distBdr:"#E49091",
      distBdrOpen:"#FF8983", distBdrLive:"#FF9D95", distEdge:"#C56B65",
      distStartBdr:"#FF8E8A", distIcon:"#FFBBBC", distBadge:"#FFC7CB",
      distLbl:"#FFD5D9", distGlow:"#FB8F85", distDim:"#FFB9BC",
      distNote:"#DCA9AB", distChipBg:"#C27B7B", distChipMark:"#FFA4A4",
      distTrack:"#4D1C1C", clockBdr:"#145526", clockBdrOn:"#29924E",
      stageDoneBdr:"#00541E", stageDoneText:"#1E9261", stageNote:"#233A28",
      breakGo:"#033814", actionBdr:"#8684B7", actionText:"#8684B7",
      arrangeText:"#C4648D", arrangeHint:"#AC5C87", testFrameBg:"#342C13",
      testFrameInk:"#FFECA1", statusEdgeOn:"#302E40", statusEdgeBrk:"#242218",
      mutedGlyph:"#A9A9A9", dragGlyph:"#969696", onAccent:"#F6F6F6",
      addDisabled:"#2B252E", runningTint:"#13131A"
    },
    light: {
      bg0:"#E2ECF6", bg1:"#F5FAFF", bg2:"#D7E4F1",
      bg3:"#BFD4E7", menuBg:"#F9FDFF", border:"#BDB8C3",
      borderBright:"#9990A3", text:"#1B161F", textDim:"#4D4456",
      textMuted:"#87808F", inputBg:"#F9FDFF", ink:"#1C080F",
      titleText:"#18101D", successBg:"#EAF7EF", successBg2:"#E4F8EC",
      successBorder:"#95DEB2", successText:"#003113", successMid:"#7ABC92",
      successDim:"#87CEA0", dangerBg:"#AD9FA0", dangerBg2:"#A69091",
      dangerTint:"#AB999A", dangerText:"#4E0000", dangerBright:"#5F0000",
      bang:"#60000F", warnBg:"#F6F4E0", warnText:"#322500",
      infoBg:"#E2E4F2", infoText:"#5E5185", chromeBdr:"#644462",
      chromeBdrOn:"#4D0947", chromeIcon:"#4B2548", chromeIconOn:"#450038",
      chromeText:"#2A0928", chromeTrack:"#8C818C", chromeTrackOn:"#615075",
      chromeTime:"#391836", chromeSubTask:"#36284F", distBdr:"#74403B",
      distBdrOpen:"#63090D", distBdrLive:"#6D0000", distEdge:"#570B0E",
      distStartBdr:"#661616", distIcon:"#62000C", distBadge:"#5C0000",
      distLbl:"#4E0000", distGlow:"#62020D", distDim:"#56241F",
      distNote:"#4B231D", distChipBg:"#691E1A", distChipMark:"#5B120C",
      distTrack:"#98817D", clockBdr:"#9FDFB2", clockBdrOn:"#86CE9C",
      stageDoneBdr:"#95DEB2", stageDoneText:"#002806", stageNote:"#90AB9A",
      breakGo:"#82BC92", actionBdr:"#8684B7", actionText:"#624F83",
      arrangeText:"#94325F", arrangeHint:"#A35077", testFrameBg:"#8DA292",
      testFrameInk:"#C6B077", statusEdgeOn:"#BFAEEA", statusEdgeBrk:"#8EA69A",
      mutedGlyph:"#D8CFDB", dragGlyph:"#E8E0EB", onAccent:"#F6F6F6",
      addDisabled:"#8E8185", runningTint:"#A8A2A6"
    }
  }
};
// Stone, built from reference rather than a single speckle tile. Real rocks read
// as rock because of three things: an edge that rolls away into shadow instead
// of an outline, variation at several scales at once (broad mineral mottling
// under fine grain), and one consistent light source across every stone in the
// scene. A single uniform speckle gives you sandpaper.
function rgba(hex,a){
  hex=String(hex).replace("#","");
  if(hex.length===3) hex=hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  return "rgba("+parseInt(hex.substr(0,2),16)+","+parseInt(hex.substr(2,2),16)+","+
         parseInt(hex.substr(4,2),16)+","+a+")";
}
var STONE_LAYERS = [
  // key light from the upper left, falling away to shade at the lower right
  "radial-gradient(115% 95% at 26% 10%,rgba(255,255,255,.30) 0%,rgba(255,255,255,.10) 26%,rgba(0,0,0,.04) 55%,rgba(0,0,0,.30) 100%)",
  // rim shade - this replaces the border: the edge rolls away, it is not drawn
  "radial-gradient(closest-side,rgba(0,0,0,0) 56%,rgba(0,0,0,.36) 100%)",
  // mineral mottling: broad, soft, overlapping, all larger than the element
  "radial-gradient(58% 52% at 70% 26%,rgba(255,255,255,.10),rgba(255,255,255,0) 62%)",
  "radial-gradient(52% 58% at 22% 70%,rgba(0,0,0,.14),rgba(0,0,0,0) 64%)",
  "radial-gradient(66% 44% at 88% 84%,rgba(255,255,255,.07),rgba(255,255,255,0) 60%)",
  // coarse grain
  "radial-gradient(circle at 38% 62%,rgba(0,0,0,.13) 0 2.6px,rgba(0,0,0,0) 2.9px)",
  "radial-gradient(circle at 76% 20%,rgba(255,255,255,.10) 0 2.1px,rgba(255,255,255,0) 2.4px)",
  // fine speckle
  "radial-gradient(circle at 16% 34%,rgba(255,255,255,.06) 0 1px,rgba(255,255,255,0) 1.2px)",
  "radial-gradient(circle at 64% 80%,rgba(0,0,0,.10) 0 1.2px,rgba(0,0,0,0) 1.4px)"
].join(",");
var STONE_BLEND = "normal,normal,soft-light,multiply,soft-light,multiply,soft-light,overlay,multiply";
var SIZE_BTN  = "100% 100%,100% 100%,210% 180%,170% 230%,240% 160%,41px 47px,59px 53px,13px 17px,19px 23px";
var SIZE_CARD = "100% 100%,100% 100%,230% 200%,190% 250%,260% 180%,53px 61px,71px 67px,17px 23px,29px 31px";
// Light and rim stay pinned at 0 0 so every stone is lit from the same place;
// only the grain shifts, so no two rocks share a pattern.
var PHASE = [
  "0 0,0 0,0 0,0 0,0 0,0 0,0 0,0 0,0 0",
  "0 0,0 0,40% 60%,70% 20%,15% 85%,13px 9px,27px 21px,7px 13px,23px 5px",
  "0 0,0 0,75% 30%,20% 55%,60% 15%,29px 17px,11px 37px,15px 3px,9px 19px",
  "0 0,0 0,15% 80%,55% 35%,35% 65%,7px 31px,43px 13px,21px 9px,3px 27px"
];
// Slab: flatter light (a cut face, not a rounded cobble), saw striations at two
// angles so they never line up, and coarse quarry grit.
var SLAB_LAYERS = [
  "linear-gradient(168deg,rgba(255,255,255,.10) 0%,rgba(255,255,255,.02) 38%,rgba(0,0,0,.10) 100%)",
  "repeating-linear-gradient(97deg,rgba(255,255,255,.035) 0 2px,rgba(0,0,0,0) 2px 9px)",
  "repeating-linear-gradient(84deg,rgba(0,0,0,.05) 0 3px,rgba(0,0,0,0) 3px 14px)",
  "radial-gradient(70% 60% at 18% 22%,rgba(255,255,255,.06),rgba(255,255,255,0) 64%)",
  "radial-gradient(62% 66% at 82% 74%,rgba(0,0,0,.12),rgba(0,0,0,0) 66%)",
  "radial-gradient(circle at 44% 58%,rgba(0,0,0,.11) 0 3px,rgba(0,0,0,0) 3.4px)",
  "radial-gradient(circle at 70% 26%,rgba(255,255,255,.07) 0 2.2px,rgba(255,255,255,0) 2.6px)"
].join(",");
var SLAB_SIZE  = "100% 100%,140px 140px,190px 190px,180% 170%,200% 160%,67px 73px,89px 97px";
var SLAB_BLEND = "normal,soft-light,multiply,soft-light,multiply,multiply,soft-light";
var SLAB_PHASE = [
  "0 0,0 0,0 0,0 0,0 0,0 0,0 0",
  "0 0,37px 21px,53px 11px,60% 30%,25% 70%,19px 31px,41px 13px",
  "0 0,71px 43px,29px 67px,30% 65%,70% 25%,47px 7px,23px 59px"
];
// Chipped edges: vertices sit 1-2% off true, so it reads as cut rather than broken.
var SLAB_CUT = [
  "polygon(1.4% 0.6%,23% 0%,49% 1.4%,75% 0.3%,99.2% 1.8%,100% 27%,98.7% 53%,100% 77%,98.4% 99.2%,73% 100%,47% 98.6%,21% 100%,0.7% 98.2%,1.5% 74%,0% 49%,1.9% 25%)",
  "polygon(0.5% 1.7%,26% 0.4%,52% 0%,78% 1.5%,100% 0.7%,98.6% 24%,100% 51%,98.3% 78%,99.4% 100%,70% 98.7%,44% 100%,18% 98.5%,1.2% 99.4%,0% 73%,1.6% 47%,0.4% 22%)",
  "polygon(2% 0%,28% 1.5%,54% 0.2%,80% 1.8%,98.8% 0.5%,100% 25%,98.4% 50%,99.6% 75%,98% 98.8%,68% 100%,42% 98.4%,16% 99.6%,0.4% 97.8%,1.8% 72%,0.2% 46%,1.1% 21%)"
];
var PEBBLE = [
  "19px 27px 17px 29px/25px 17px 27px 19px",
  "29px 17px 27px 19px/19px 27px 17px 29px",
  "23px 31px 15px 25px/27px 15px 31px 21px",
  "15px 25px 31px 19px/21px 33px 17px 25px"
];
// Frosted glass: real backdrop blur, a matte micro-grain so it is not glossy,
// and edges defined by shadow rather than a drawn line. Everything uniform and
// symmetrical - the deliberate opposite of the stone theme.
// Frosted glass. Two things make it read as glass rather than as a tinted box:
// the material must be identical on every surface, and it must have thickness.
// Uniformity comes from compositing one fixed frost layer OVER whatever colour
// the component supplies, so the hue shows through faintly but the surface is
// always the same. Thickness comes from an inner bevel ring drawn on ::after -
// a bright top-left catch, a darker refracted bottom-right - plus a two-stage
// drop shadow: a tight contact shadow and a wide soft one.
var FROST_GRAIN =
  "radial-gradient(circle at 50% 50%,rgba(255,255,255,.035) 0 .6px,rgba(255,255,255,0) .8px)," +
  "radial-gradient(circle at 20% 70%,rgba(0,0,0,.03) 0 .7px,rgba(0,0,0,0) .9px)";
var FROST_BLUR = "blur(18px) saturate(160%)";
// Neon Dream stays flat on panes, but its dropdowns get the treatment the
// theme is named for: a bright bordered pane with a real glow, translucent
// over a softly defocused board - the same diffusion rules as frosted glass.
function NEON_CSS(c, mode){
  var glow = c.actionBdr;
  return (
    "[data-surface=menu]{background-color:"+rgba(c.menuBg, mode==="light"?0.52:0.44)+"!important;" +
      "backdrop-filter:blur(24px) saturate(120%)!important;" +
      "-webkit-backdrop-filter:blur(24px) saturate(120%)!important;" +
      "border:2px solid "+glow+"!important;" +
      "box-shadow:0 0 3px "+rgba(glow,0.9)+",0 0 16px "+rgba(glow,0.5)+"," +
        "inset 0 0 8px "+rgba(glow,0.18)+",0 8px 32px rgba(0,0,0,0.55)!important;}" +
    // identical focus model to frosted: the owner chain stays sharp, everything
    // else takes a touch of blur while a menu is open
    "body:has([data-menu-open]) [data-surface=lane]:not(:has([data-menu-open])){filter:blur(2px);}" +
    "[data-surface=lane]:has([data-menu-open]) [data-surface=panel]:not([data-menu-open]):not(:has([data-menu-open])){filter:blur(2px);}" +
    // the filtered siblings become stacking contexts, so keep the owner chain
    // lifted the same way the other themes do
    "[data-surface=lane]:has([data-menu-open]){z-index:95!important;}" +
    "[data-surface=panel]:has([data-menu-open]){z-index:80!important;}"
  );
}

function FROST_CSS(c, mode){
  var ink=c.ink, lit=mode==="light";
  // One frost layer, same on every surface. The white veil is what makes the
  // material uniform; the component's own colour sits under it.
  var veil = lit ? "rgba(255,255,255,.58)" : "rgba(255,255,255,.13)";
  var veil2= lit ? "rgba(255,255,255,.40)" : "rgba(255,255,255,.06)";
  // In light mode a pane can fade to shadow at its foot and still be read,
  // because it sits on white. In dark mode that same fade lands on a dark page
  // and the bottom of the pane simply disappears - so the foot stays lit.
  var foot = lit ? "rgba(0,0,0,.07)" : "rgba(255,255,255,.055)";
  var sheen="linear-gradient(157deg,"+veil+" 0%,"+veil2+" 42%,"+foot+" 100%)";
  var face =
    "backdrop-filter:"+FROST_BLUR+"!important;-webkit-backdrop-filter:"+FROST_BLUR+"!important;" +
    "background-image:"+sheen+","+FROST_GRAIN+"!important;" +
    "background-size:100% 100%,4px 4px,7px 7px!important;" +
    "background-blend-mode:normal,overlay,overlay!important;" +
    "border-color:transparent!important;border-style:solid!important;" +
    "position:relative;";
  // The pane edge. Light mode refracts dark at the bottom-right; dark mode has
  // to do the opposite or the lower edge is invisible against the page.
  var edgeLo = lit ? rgba(ink,.30) : "rgba(255,255,255,.16)";
  var edgeHi = lit ? rgba(ink,.45) : "rgba(255,255,255,.34)";
  // Only the masked ring should ever paint. Without the mask this gradient is a
  // full-bleed fill that would cover the content, so it stays transparent until
  // the mask is confirmed available.
  var bevelRing =
    "background:linear-gradient(157deg,rgba(255,255,255,.85) 0%,rgba(255,255,255,.22) 30%," +
      "rgba(255,255,255,0) 55%,"+edgeLo+" 88%,"+edgeHi+" 100%);" +
    "-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);" +
    "-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);" +
    "mask-composite:exclude;";
  var bevel =
    "content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;" +
    "padding:1.5px;background:none;";
  function lift(px){
    var r=function(n){ return Math.round(n*10)/10; };
    // The underside catches light in dark mode instead of deepening into shade.
    var under = lit
      ? "inset 0 -"+r(px*0.5)+"px "+r(px*0.9)+"px -"+px+"px "+rgba(ink,.34)
      : "inset 0 -1.5px 0 rgba(255,255,255,.14),inset 0 -"+r(px*0.5)+"px "+r(px*0.9)+"px -"+px+"px rgba(255,255,255,.07)";
    return "box-shadow:inset 0 1px 0 rgba(255,255,255,.30)," + under + "," +
      "0 1px 2px "+rgba(ink,.30)+"," +
      "0 "+px+"px "+r(px*2.2)+"px -"+r(px*0.7)+"px "+rgba(ink,.42)+"!important;";
  }
  return (
    "button:not([data-flat]){"+face+"border-width:1.5px!important;border-radius:16px!important;"+lift(8)+"}" +
    "button:not([data-flat])::after{"+bevel+"}" +
    "button:not([data-flat]):active{transform:translateY(1.5px);" +
      "box-shadow:inset 0 1px 0 rgba(255,255,255,.20)," +
      "inset 0 -3px 6px -5px "+rgba(ink,.34)+",0 1px 2px "+rgba(ink,.34)+"!important;}" +
    "[data-surface=panel]{"+face+"border-width:1.5px!important;border-radius:20px!important;"+lift(14)+"}" +
    "[data-surface=panel]::after{"+bevel+"}" +
    // A modal keeps the bevel and the shadow but only a whisper of blur, so
    // the page behind it never competes with its text.
    // No shell: the modal contents float directly on the heavy scrim. Buttons
    // keep their full glass treatment and gain breathing room so each reads as
    // its own floating pane.
    "[data-surface=modal]{background:transparent!important;border-color:transparent!important;" +
      "box-shadow:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;}" +
    "[data-surface=modal] button:not([data-flat]){margin:6px 4px!important;}" +
    "[data-surface=lane]{position:relative;padding:14px 12px 18px!important;}" +
    // NB: never z-index the lane children. That makes a stacking context on each
    // one, and a modal opened from inside a card gets trapped beneath it.
    // The lane owns a stacking context, so its decoration can sit at z-index -1
    // behind the content without falling behind the page background. Children
    // get no z-index of their own - that is what trapped popups opened from a
    // card beneath the header.
    "[data-surface=lane]{isolation:isolate;}" +
    "[data-surface=lane]:has([data-menu-open]){z-index:95!important;}" +
    // A themed card is a stacking context, so a sub-task row's own lift cannot
    // escape it: the card must rise too while any menu inside it is open.
    "[data-surface=panel]:has([data-menu-open]){z-index:80!important;}" +
    // Dropdowns are glass too: translucent enough for the card behind to
    // show through, blurred hard enough that it reads as diffusion, never
    // as competing content under the menu items.
    "[data-surface=menu]{background-color:"+rgba(c.menuBg,lit?0.52:0.44)+"!important;" +
      "backdrop-filter:blur(24px) saturate(120%)!important;" +
      "-webkit-backdrop-filter:blur(24px) saturate(120%)!important;" +
      "border-color:"+(lit?"rgba(255,255,255,.55)":"rgba(255,255,255,.16)")+"!important;}" +
    "body:has([data-menu-open]) [data-surface=lane]:not(:has([data-menu-open])){filter:blur(2px);}" +
    "[data-surface=lane]:has([data-menu-open]) [data-surface=panel]:not([data-menu-open]):not(:has([data-menu-open])){filter:blur(2px);}" +
    "[data-surface=lane]::before{content:'';position:absolute;inset:0;z-index:-1;border-radius:24px;" +
      "backdrop-filter:"+FROST_BLUR+";-webkit-backdrop-filter:"+FROST_BLUR+";" +
      "background-color:"+rgba(c.bg2,.38)+";" +
      "background-image:"+sheen+","+FROST_GRAIN+";" +
      "background-size:100% 100%,4px 4px,7px 7px;" +
      "background-blend-mode:normal,overlay,overlay;" +
      "box-shadow:inset 0 1.5px 0 rgba(255,255,255,.26)," +
        (lit ? "inset 0 -10px 18px -14px "+rgba(ink,.34)
             : "inset 0 -1.5px 0 rgba(255,255,255,.12)") + "," +
        "0 2px 3px "+rgba(ink,.24)+",0 18px 38px -18px "+rgba(ink,.42)+";}" +
    "[data-surface=lane]::after{"+bevel+"border-radius:24px;z-index:-1;}" +
    "input,textarea,select{border-radius:14px!important;border-width:1.5px!important;" +
      "border-color:transparent!important;" +
      "backdrop-filter:"+FROST_BLUR+"!important;-webkit-backdrop-filter:"+FROST_BLUR+"!important;" +
      "box-shadow:inset 0 2px 4px "+rgba(ink,.30)+",inset 0 -1px 0 rgba(255,255,255,.22)!important;}" +
    "@supports ((mask-composite:exclude) or (-webkit-mask-composite:xor)){" +
      "button:not([data-flat])::after,[data-surface=panel]::after," +
      "[data-surface=lane]::after{"+bevelRing+"}}"
  );
}

var THEMES = {
  "neon-dream": {
    label:"Neon Dream",
    radiusSm:"8px", radiusMd:"10px", radiusLg:"12px",
    borderW:"2.5px", glow:true, fill:"flat", css:NEON_CSS,
    // Palettes belong to themes: neon glow suits the synthetic ones, and the
    // earth palettes would look washed out under it.
    schemes:["bright-pastels","vegas"], defaultScheme:"bright-pastels",
    defaultFont:"dm",
    // Fonts are per-theme on purpose: a chiselled face under Neon Dream reads
    // as a mistake, and a geometric grotesk under Stoned kills the texture.
    fonts:{
      dm:      { label:"DM",       body:"'DM Sans',system-ui,sans-serif", mono:"'DM Mono',monospace",
                 import:"https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&family=DM+Mono:wght@400;500;700&display=swap" },
      grotesk: { label:"Grotesk",  body:"'Space Grotesk',system-ui,sans-serif", mono:"'Space Mono',monospace",
                 import:"https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Space+Mono:wght@400;700&display=swap" },
      inter:   { label:"Inter",    body:"'Inter',system-ui,sans-serif", mono:"'JetBrains Mono',monospace",
                 import:"https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@400;700&display=swap" }
    }
  },
  "frosted": {
    label:"Frosted",
    // uniform and symmetrical: one radius everywhere, no per-element variation
    radiusSm:"14px", radiusMd:"16px", radiusLg:"20px",
    borderW:"1px", glow:false, fill:"glass", css:FROST_CSS,
    schemes:["seaglass","frost"], defaultScheme:"seaglass",
    defaultFont:"vapour",
    fonts:{
      vapour: { label:"Vapour", body:"'Manrope',system-ui,sans-serif", mono:"'IBM Plex Mono',monospace",
                import:"https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" },
      haze:   { label:"Haze",   body:"'Outfit',system-ui,sans-serif", mono:"'Roboto Mono',monospace",
                import:"https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&family=Roboto+Mono:wght@400;500;700&display=swap" },
      mist:   { label:"Mist",   body:"'Work Sans',system-ui,sans-serif", mono:"'Fira Code',monospace",
                import:"https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;600;700&family=Fira+Code:wght@400;500;700&display=swap" }
    }
  }
};
function themeKeyOf(settings){ return THEMES[settings.theme] ? settings.theme : "neon-dream"; }
function schemeKeyOf(settings){
  var th=THEMES[themeKeyOf(settings)];
  var picked=(settings.schemes||{})[themeKeyOf(settings)];
  if(th.schemes.indexOf(picked)>=0) return picked;
  // a scheme saved before schemes were scoped is honoured if this theme allows it
  if(th.schemes.indexOf(settings.colorScheme)>=0) return settings.colorScheme;
  return th.defaultScheme;
}
function fontKeyOf(settings){
  var th=THEMES[themeKeyOf(settings)];
  var picked=(settings.fonts||{})[themeKeyOf(settings)];
  return th.fonts[picked] ? picked : th.defaultFont;
}
// A lane stores a literal accent, so switching scheme has to translate it. Every
// scheme's lane set is indexed by position: a lane on swatch 3 stays on swatch 3
// and simply takes that slot's colour in the new scheme. Custom picks survive.
var LANE_INDEX = {};
function buildLaneIndex(){
  Object.keys(SCHEMES).forEach(function(k){
    (SCHEMES[k].lanes||[]).forEach(function(col,i){ LANE_INDEX[col.accent.toUpperCase()]=i; });
  });
  LANE_COLORS.forEach(function(col,i){ LANE_INDEX[col.accent.toUpperCase()]=i; });
}
function laneColors(){ return S.lanes || LANE_COLORS; }

function applyTokens(settings){
  if(!LANE_INDEX.__built){ buildLaneIndex(); LANE_INDEX.__built=true; }
  TIME_INC = settings.timeInc==="tenths" ? "tenths" : "standard";
  var sch = SCHEMES[schemeKeyOf(settings)] || SCHEMES["bright-pastels"];
  var mode = settings.mode==="light" ? "light" : "dark";
  var c = sch[mode];
  S.mode=mode;
  S.lanes = sch.lanes || LANE_COLORS;
  S.bg0=c.bg0; S.bg1=c.bg1; S.bg2=c.bg2; S.bg3=c.bg3; S.menuBg=c.menuBg;
  S.border=c.border; S.borderBright=c.borderBright;
  S.text=c.text; S.textDim=c.textDim; S.textMuted=c.textMuted;
  S.titleText=c.titleText; S.ink=c.ink;
  S.successBg=c.successBg; S.successBg2=c.successBg2; S.successBorder=c.successBorder;
  S.successText=c.successText; S.successMid=c.successMid; S.successDim=c.successDim;
  S.dangerBg=c.dangerBg; S.dangerBg2=c.dangerBg2; S.dangerTint=c.dangerTint;
  S.dangerText=c.dangerText; S.dangerBright=c.dangerBright; S.bang=c.bang;
  S.warnBg=c.warnBg; S.warnText=c.warnText;
  S.infoBg=c.infoBg; S.infoText=c.infoText;
  ["chromeBdr", "chromeBdrOn", "chromeIcon", "chromeIconOn", "chromeText", "chromeTrack", "chromeTrackOn", "chromeTime", "chromeSubTask", "distBdr", "distBdrOpen", "distBdrLive", "distEdge", "distStartBdr", "distIcon", "distBadge", "distLbl", "distGlow", "distDim", "distNote", "distChipBg", "distChipMark", "distTrack", "clockBdr", "clockBdrOn", "stageDoneBdr", "stageDoneText", "stageNote", "breakGo", "actionBdr", "actionText", "arrangeText", "arrangeHint", "testFrameBg", "testFrameInk", "statusEdgeOn", "statusEdgeBrk", "mutedGlyph", "dragGlyph", "onAccent", "addDisabled", "runningTint"].forEach(function(k){ S[k]=c[k]; });
  INPUT_STYLE.background=c.inputBg; INPUT_STYLE.border="2px solid "+c.border; INPUT_STYLE.color=c.text;
  LABEL_STYLE.color=c.textDim;
  // Themes own structure: shape, weight, typeface, and whether anything glows.
  var th = THEMES[themeKeyOf(settings)];
  var f  = th.fonts[fontKeyOf(settings)];
  S.fontBody=f.body; S.fontMono=f.mono; S.fontImport=f["import"];
  S.radius3=th.radiusSm; S.radius=th.radiusMd; S.radius2=th.radiusLg;
  S.glow=th.glow; S.fill=th.fill||"flat"; S.solid=S.fill==="solid";
  // The scrim behind a modal belongs to the theme too: glass blurs what is
  // behind it, the opaque themes just darken with the palette's own ink.
  // The scrim has to do real work: whatever is behind a modal must stop
  // competing with the text on it. Heavy blur plus a saturation drop kills the
  // detail; the ink wash sets the contrast floor.
  // A modal must be readable first and translucent second.
  // Frosted modals have no shell: the contents float on the scrim, so the
  // scrim itself must guarantee legibility - a white veil in light mode (dark
  // text needs a light ground), ink in dark.
  S.modalBg = th.fill==="glass" ? "transparent" : c.bg2;
  S.scrim = th.fill==="glass"
    ? (mode==="light" ? "rgba(255,255,255,0.60)" : rgba(c.ink,0.70))
    : rgba(c.ink, mode==="light" ? 0.46 : 0.66);
  S.scrimBlur = "blur(14px) saturate(60%)";
  S.themeCss = typeof th.css==="function" ? th.css(c, mode) : (th.css||"");
  INPUT_STYLE.borderRadius=th.radiusSm; INPUT_STYLE.fontFamily=f.body;
}

// ---- GEAR POINTS (for SVG gear icon) ----------------------------------------
function gearPts(cx, cy, outerR, innerR, teeth, tw){
  var pts=[], step=2*Math.PI/teeth, half=Math.PI/teeth, a1w=Math.PI*tw/teeth, a2w=Math.PI*(1-tw)/teeth;
  for(var i=0;i<teeth;i++){
    var a=step*i;
    var ix0=cx+innerR*Math.cos(a), iy0=cy+innerR*Math.sin(a);
    var ox1=cx+outerR*Math.cos(a+a1w), oy1=cy+outerR*Math.sin(a+a1w);
    var ox2=cx+outerR*Math.cos(a+a2w), oy2=cy+outerR*Math.sin(a+a2w);
    var ix3=cx+innerR*Math.cos(a+half), iy3=cy+innerR*Math.sin(a+half);
    pts.push(ix0+","+iy0); pts.push(ox1+","+oy1); pts.push(ox2+","+oy2); pts.push(ix3+","+iy3);
  }
  return pts.join(" ");
}

function GearSVG(props){
  var size=props.size||24, col=props.col||S.chromeText;
  var c=size/2, outerR=c*0.86, innerR=c*0.62, holeR=c*0.27;
  return (
    React.createElement("svg", { width:size, height:size, viewBox:"0 0 "+size+" "+size, fill:"none" },
      React.createElement("polygon", { points:gearPts(c,c,outerR,innerR,10,0.38), fill:S.bg1, stroke:col, strokeWidth:"1.2", strokeLinejoin:"round" }),
      React.createElement("circle", { cx:c, cy:c, r:holeR, fill:S.bg0, stroke:col, strokeWidth:"1.2" })
    )
  );
}

// ---- STAGES MODAL ------------------------------------------------------------
// The stage dropdown: one flat row per stage (tap to flip open/complete, the
// menu stays open for several flips), then Edit Stages into the full modal.
function stageMenuRows(stages, onFlip, onEditStages){
  return stages.map(function(st){
    return React.createElement("button", { key:st.id, "data-flat":true, onClick:function(){ onFlip(st.id); },
      style:{display:"flex",alignItems:"center",gap:"0.55rem",width:"100%",textAlign:"left",background:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.6rem 0.9rem",cursor:"pointer",fontFamily:S.fontBody,fontSize:"0.88rem",color:S.text} },
      React.createElement("span", { style:{width:"10px",height:"10px",borderRadius:"50%",flexShrink:0,background:st.done?S.successText:"transparent",border:"2px solid "+(st.done?S.successText:S.chromeBdr)} }),
      React.createElement("span", { style:{flex:1,textDecoration:st.done?"line-through":"none",opacity:st.done?0.72:1} }, st.label)
    );
  }).concat([
    React.createElement("button", { key:"__edit", "data-flat":true, onClick:onEditStages,
      style:{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",padding:"0.6rem 0.9rem",cursor:"pointer",fontFamily:S.fontBody,fontSize:"0.88rem",fontWeight:600,color:S.text} },
      "Edit Stages")
  ]);
}

function StagesModal(props){
  var proj = props.proj, onClose = props.onClose, onUpdate = props.onUpdate;
  var initItems = proj.stages||[];
  var items = useState(initItems); var setItems = items[1]; items = items[0];
  var newLabel = useState(""); var setNewLabel = newLabel[1]; newLabel = newLabel[0];
  var noteFor = useState(null); var setNoteFor = noteFor[1]; noteFor = noteFor[0];
  var noteText = useState(""); var setNoteText = noteText[1]; noteText = noteText[0];
  var editId = useState(null); var setEditId = editId[1]; editId = editId[0];
  var editText = useState(""); var setEditText = editText[1]; editText = editText[0];
  var confirmDel = useState(null); var setConfirmDel = confirmDel[1]; confirmDel = confirmDel[0];
  var meta = getMeta(null, proj.lane);

  function toggle(id){
    var now=Date.now();
    var s=items.find(function(x){ return x.id===id; });
    if(!s) return;
    if(!s.done){ setNoteFor(id); setNoteText(""); }
    else setItems(items.map(function(x){ return x.id===id ? Object.assign({},x,{done:false,doneAt:null,note:""}) : x; }));
  }
  function confirmDone(){
    var now=Date.now();
    setItems(items.map(function(x){ return x.id===noteFor ? Object.assign({},x,{done:true,doneAt:now,note:noteText.trim()}) : x; }));
    setNoteFor(null);
  }
  function addStage(){
    if(!newLabel.trim()) return;
    setItems(items.concat([{id:uid(),label:newLabel.trim(),done:false,doneAt:null,note:""}]));
    setNewLabel("");
  }
  function removeStage(id){ setItems(items.filter(function(x){ return x.id!==id; })); }
  function saveEdit(id){ setItems(items.map(function(x){ return x.id===id ? Object.assign({},x,{label:editText.trim()||x.label}) : x; })); setEditId(null); }
  function save(){ onUpdate(Object.assign({},proj,{stages:items})); onClose(); }

  var done=items.filter(function(s){ return s.done; }).length, total=items.length;
  var pct=total>0?Math.round((done/total)*100):0;
  var allDone=total>0&&done===total;

  return (
    React.createElement(Modal, { title:"Stages - "+proj.name, onClose:onClose, wide:true, ownActions:true },
      total>0 && React.createElement("div", { style:{marginBottom:"0.85rem"} },
        React.createElement("div", { style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"0.3rem"} },
          React.createElement("span", { style:{fontSize:"0.75rem",color:allDone?S.successText:meta.accent,fontWeight:700} }, allDone?"All Complete":done+"/"+total+" stages"),
          React.createElement(Mono, { style:{fontSize:"0.75rem",color:allDone?S.successText:meta.accent,fontWeight:700} }, pct+"%")
        ),
        React.createElement("div", { style:{height:"6px",background:S.bg0,borderRadius:"3px",overflow:"hidden"} },
          React.createElement("div", { style:{height:"100%",width:pct+"%",background:allDone?S.successText:meta.accent,borderRadius:"3px",transition:"width 0.3s"} })
        )
      ),
      React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.4rem",marginBottom:"0.75rem",maxHeight:"280px",overflowY:"auto"} },
        items.map(function(stage){
          var stageBg = stage.done ? S.successBg : S.bg1;
          var stageBdr = stage.done ? S.successBorder : S.border;
          var stageCol = stage.done ? S.successDim : S.text;
          return (
            React.createElement("div", { key:stage.id, style:{background:stageBg,border:"1px solid "+stageBdr,borderRadius:S.radius3,padding:"0.5rem 0.7rem"} },
              React.createElement("div", { style:{display:"flex",alignItems:"center",gap:"0.5rem"} },
                React.createElement("button", {
                  onClick: function(){ toggle(stage.id); },
                  style:{width:"24px",height:"24px",borderRadius:"50%",flexShrink:0,background:stage.done?S.successBg2:S.bg0,border:"2px solid "+(stage.done?S.successText:S.borderBright),cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:S.successText,fontSize:"0.8rem"}
                }, stage.done?"v":""),
                editId===stage.id
                  ? React.createElement("input", { value:editText, onChange:function(e){ setEditText(e.target.value); }, onBlur:function(){ saveEdit(stage.id); }, onKeyDown:function(e){ if(e.key==="Enter") saveEdit(stage.id); }, autoFocus:true, style:Object.assign({},INPUT_STYLE,{flex:1,padding:"0.25rem 0.5rem"}) })
                  : React.createElement("span", { onClick:function(){ setEditId(stage.id); setEditText(stage.label); }, style:{flex:1,color:stageCol,fontSize:"0.9rem",cursor:"pointer",textDecoration:stage.done?"line-through":"none"} }, stage.label),
                confirmDel===stage.id
                  ? React.createElement("button", { onClick:function(){ removeStage(stage.id); setConfirmDel(null); },
                      style:{background:S.dangerBg2,border:"1px solid "+S.dangerBright,borderRadius:"6px",color:S.dangerBright,cursor:"pointer",fontSize:"0.64rem",fontWeight:700,padding:"0.25rem 0.45rem",lineHeight:1,fontFamily:S.fontBody,whiteSpace:"nowrap"} }, "delete?")
                  : React.createElement("button", { onClick:function(){ setConfirmDel(stage.id); },
                      style:{background:"none",border:"none",color:S.textMuted,cursor:"pointer",fontSize:"1rem",padding:"0 0.2rem",lineHeight:1} }, "x")
              ),
              stage.done&&stage.note && React.createElement("div", { style:{fontSize:"0.75rem",color:S.stageNote,marginTop:"0.25rem",paddingLeft:"2rem"} }, stage.note)
            )
          );
        })
      ),
      noteFor && React.createElement("div", { style:{background:S.bg1,border:"1px solid "+S.border,borderRadius:S.radius3,padding:"0.75rem",marginBottom:"0.75rem"} },
        React.createElement("label", { style:LABEL_STYLE }, "Completion note (optional)"),
        React.createElement("input", { value:noteText, onChange:function(e){ setNoteText(e.target.value); }, placeholder:"e.g. Filed with HR", style:INPUT_STYLE,
          onKeyDown:function(e){ if(e.key==="Enter") confirmDone(); } }),
        React.createElement("div", { style:{display:"flex",gap:"0.5rem",marginTop:"0.5rem"} },
          React.createElement("button", { onClick:confirmDone, style:{flex:1,background:S.successBg2,border:"1px solid "+S.successBorder,borderRadius:S.radius3,padding:"0.6rem",color:S.successText,cursor:"pointer",fontWeight:700,fontFamily:S.fontBody} }, "Mark Done"),
          React.createElement("button", { onClick:function(){ setNoteFor(null); }, style:{flex:1,background:S.bg2,border:"1px solid "+S.border,borderRadius:S.radius3,padding:"0.6rem",color:S.textDim,cursor:"pointer",fontFamily:S.fontBody} }, "Cancel")
        )
      ),
      React.createElement("div", { style:{display:"flex",gap:"0.5rem",marginBottom:"0.75rem"} },
        React.createElement("input", { value:newLabel, onChange:function(e){ setNewLabel(e.target.value); }, placeholder:"Add a stage...", style:Object.assign({},INPUT_STYLE,{flex:1}),
          onKeyDown:function(e){ if(e.key==="Enter") addStage(); } }),
        React.createElement("button", { onClick:addStage, disabled:!newLabel.trim(), style:{background:newLabel.trim()?meta.accent:S.addDisabled,border:"none",borderRadius:S.radius3,padding:"0 1rem",color:S.onAccent,cursor:newLabel.trim()?"pointer":"default",fontWeight:700,fontFamily:S.fontBody,fontSize:"1.1rem"} }, "+")
      ),
      React.createElement(ModalActions, null,
        React.createElement("button", { onClick:save, style:{flex:1,background:meta.accent+"22",border:"2.5px solid "+meta.accent,borderRadius:S.radius,padding:"0.85rem",color:meta.accent,fontWeight:700,cursor:"pointer",fontFamily:S.fontBody,fontSize:"0.95rem"} }, "Save Stages"),
        React.createElement("button", { onClick:onClose, style:MODAL_CANCEL() }, "Cancel")
      )
    )
  );
}

// ---- PROJECT FORM ------------------------------------------------------------
function ProjectForm(props){
  var project=props.project, onSave=props.onSave, onCancel=props.onCancel, onDelete=props.onDelete;
  var defaultLane=props.defaultLane, defaultParentId=props.defaultParentId;
  var parents=props.parents||[], laneMeta=props.laneMeta||{}, laneOrder=props.laneOrder||DEFAULT_ORDER;

  var nameS = useState(project?project.name:""); var setName=nameS[1]; var name=nameS[0];
  var laneS = useState(project?project.lane:(defaultLane||"Daily Activity")); var setLane=laneS[1]; var lane=laneS[0];
  var notesS = useState(project?project.notes:""); var setNotes=notesS[1]; var notes=notesS[0];
  var parentIdS = useState(project?project.parentId:(defaultParentId||null)); var setParentId=parentIdS[1]; var parentId=parentIdS[0];

  var eligibleParents = parents.filter(function(p){ return p.lane===lane && p.parentId===null && p.id!==(project&&project.id); });
  var laneKeys = laneOrder.filter(function(k){ return getMeta(laneMeta,k); });

  function submit(){
    if(!name.trim()) return;
    onSave({ name:name.trim(), lane:lane, notes:notes.trim(), parentId:parentId||null });
  }

  return (
    React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.85rem"} },
      React.createElement("div", null,
        React.createElement("label", { style:LABEL_STYLE }, "Name"),
        React.createElement("input", { value:name, onChange:function(e){ setName(e.target.value); }, placeholder:parentId?"Task Name":"Project Name", style:INPUT_STYLE,
          onKeyDown:function(e){ if(e.key==="Enter") submit(); } })
      ),
      React.createElement("div", null,
        React.createElement("label", { style:LABEL_STYLE }, "Lane"),
        React.createElement("select", { value:lane, onChange:function(e){ setLane(e.target.value); setParentId(null); }, style:Object.assign({},INPUT_STYLE,{cursor:"pointer"}) },
          laneKeys.map(function(k){
            var m=getMeta(laneMeta,k);
            return React.createElement("option", { key:k, value:k }, m.label);
          })
        )
      ),
      eligibleParents.length>0 && React.createElement("div", null,
        React.createElement("label", { style:LABEL_STYLE }, "Parent project (optional)"),
        React.createElement("select", { value:parentId||"", onChange:function(e){ setParentId(e.target.value||null); }, style:Object.assign({},INPUT_STYLE,{cursor:"pointer"}) },
          React.createElement("option", { value:"" }, "-- None --"),
          eligibleParents.map(function(p){ return React.createElement("option", { key:p.id, value:p.id }, p.name); })
        )
      ),
      React.createElement("div", null,
        React.createElement("label", { style:LABEL_STYLE }, "Notes"),
        React.createElement("textarea", { value:notes, onChange:function(e){ setNotes(e.target.value); }, placeholder:"Optional details", rows:2, style:Object.assign({},INPUT_STYLE,{resize:"vertical"}) })
      ),
      // Destructive action stays in the body - the floating bar is Save/Cancel.
      project&&onDelete && React.createElement("button", { onClick:onDelete, style:{width:"100%",background:S.dangerBg,border:"1px solid "+S.dangerText,borderRadius:S.radius,padding:"0.7rem",color:S.dangerText,cursor:"pointer",fontFamily:S.fontBody,fontWeight:600} }, "Delete Project"),
      React.createElement(ModalActions, null,
        React.createElement("button", { onClick:submit, disabled:!name.trim(), style:{flex:1,background:name.trim()?S.infoBg:S.bg2,border:"2.5px solid "+(name.trim()?S.actionBdr:S.border),borderRadius:S.radius,padding:"0.85rem",color:name.trim()?S.infoText:S.textMuted,fontWeight:700,cursor:name.trim()?"pointer":"default",fontFamily:S.fontBody,fontSize:"0.95rem"} },
          project?"Save Changes":"Add Project"
        ),
        React.createElement("button", { onClick:onCancel, style:MODAL_CANCEL() }, "Cancel")
      )
    )
  );
}

// ---- DISRUPTION MODAL -------------------------------------------------------
function DisruptionModal(props){
  var onStart=props.onStart, onCancel=props.onCancel, projName=props.projName;
  var note = useState(""); var setNote=note[1]; note=note[0];
  return (
    React.createElement(Modal, { title:"Log Disruption", onClose:onCancel, ownActions:true },
      React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.85rem"} },
        projName
          ? React.createElement("div", { style:{background:S.dangerBg,border:"1px solid "+S.dangerText,borderRadius:S.radius3,padding:"0.6rem 0.85rem",color:S.dangerText,fontSize:"0.88rem"} }, "Disruption while: "+projName)
          : React.createElement("div", { style:{background:S.bg1,border:"1px solid "+S.border,borderRadius:S.radius3,padding:"0.6rem 0.85rem",color:S.textDim,fontSize:"0.88rem"} }, "Standalone - not tied to a project"),
        React.createElement("div", null,
          React.createElement("label", { style:LABEL_STYLE }, "What happened? (optional)"),
          React.createElement("textarea", { value:note, onChange:function(e){ setNote(e.target.value); }, placeholder:"e.g. Phone call, unexpected visitor...", rows:2, style:Object.assign({},INPUT_STYLE,{resize:"vertical"}) })
        ),
        React.createElement(ModalActions, null,
          React.createElement("button", { onClick:function(){ onStart(note.trim()); }, style:{flex:1,background:S.dangerBg2,border:"2px solid #CC3030",borderRadius:S.radius,padding:"0.85rem",color:S.dangerBright,cursor:"pointer",fontWeight:700,fontFamily:S.fontBody,fontSize:"0.95rem"} }, "!! Start Disruption"),
          React.createElement("button", { onClick:onCancel, style:MODAL_CANCEL() }, "Cancel")
        )
      )
    )
  );
}

// ---- DISRUPTION POPUP -------------------------------------------------------
function DisruptionPopup(props){
  var disruptions=props.disruptions||[], projName=props.projName, onClose=props.onClose;
  var done=disruptions.filter(function(d){ return d.endTime; });
  var total=done.reduce(function(a,d){ return a+d.duration; }, 0);
  return (
    React.createElement(Modal, { title:"Disruptions - "+projName, onClose:onClose },
      done.length===0
        ? React.createElement("div", { style:{color:S.textMuted,textAlign:"center",padding:"1.5rem 0"} }, "No disruptions logged.")
        : React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.5rem"} },
            React.createElement("div", { style:{display:"flex",justifyContent:"space-between",background:S.dangerBg,border:"1px solid "+S.dangerText,borderRadius:S.radius3,padding:"0.6rem 0.85rem",marginBottom:"0.25rem"} },
              React.createElement("span", { style:{color:S.dangerText,fontWeight:700,fontSize:"0.85rem"} }, "!! "+done.length+" disruption"+(done.length!==1?"s":"")),
              React.createElement(Mono, { style:{color:S.dangerText,fontWeight:700,fontSize:"0.85rem"} }, fmtDur(total,true)+" lost")
            ),
            done.map(function(d,i){
              return React.createElement("div", { key:i, style:{background:S.bg1,border:"1px solid "+S.border,borderRadius:S.radius3,padding:"0.6rem 0.85rem"} },
                React.createElement("div", { style:{display:"flex",justifyContent:"space-between",gap:"0.5rem"} },
                  React.createElement("span", { style:{color:S.text,fontSize:"0.88rem",flex:1} }, d.note||"(no note)"),
                  React.createElement(Mono, { style:{color:S.dangerText,fontSize:"0.82rem",fontWeight:700,flexShrink:0} }, fmtDur(d.duration,true))
                ),
                React.createElement("div", { style:{fontSize:"0.72rem",color:S.textMuted,marginTop:"0.2rem"} },
                  fmtTime(d.startTime)+" to "+fmtTime(d.endTime)+(d.projectName&&d.projectName!==projName?" - "+d.projectName:"")
                )
              );
            })
          )
    )
  );
}

// ---- BREAK MODAL ------------------------------------------------------------
function BreakModal(props){
  var onStart=props.onStart, onCancel=props.onCancel;
  var custom = useState(""); var setCustom=custom[1]; custom=custom[0];
  return (
    React.createElement(Modal, { title:"Start Break", onClose:onCancel },
      React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.5rem"} },
        PRESET_BREAKS.map(function(label){
          return React.createElement("button", { key:label, onClick:function(){ onStart(label); },
            style:{background:S.bg1,border:"1px solid "+S.border,borderRadius:S.radius,padding:"0.85rem 1rem",color:S.text,cursor:"pointer",fontFamily:S.fontBody,fontSize:"0.95rem",textAlign:"left"} },
            label
          );
        }),
        React.createElement("div", { style:{display:"flex",gap:"0.5rem",marginTop:"0.25rem"} },
          React.createElement("input", { value:custom, onChange:function(e){ setCustom(e.target.value); }, placeholder:"Custom label...", style:Object.assign({},INPUT_STYLE,{flex:1}) }),
          React.createElement("button", { onClick:function(){ if(custom.trim()) onStart(custom.trim()); }, disabled:!custom.trim(),
            style:{background:custom.trim()?S.breakGo:S.addDisabled,border:"none",borderRadius:S.radius3,padding:"0 1rem",color:S.onAccent,cursor:custom.trim()?"pointer":"default",fontWeight:700,fontFamily:S.fontBody} }, "Go")
        )
      )
    )
  );
}

// ---- NEW LANE MODAL ---------------------------------------------------------
function NewLaneModal(props){
  var onSave=props.onSave, onCancel=props.onCancel;
  var labelS = useState(""); var setLabel=labelS[1]; var label=labelS[0];
  var pickedS = useState(laneColors()[0]); var setPicked=pickedS[1]; var picked=pickedS[0];
  var prevBdr = "1px solid "+picked.accent;
  return (
    React.createElement(Modal, { title:"New Lane", onClose:onCancel, ownActions:true },
      React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"1rem"} },
        React.createElement("div", null,
          React.createElement("label", { style:LABEL_STYLE }, "Lane Name"),
          React.createElement("input", { value:label, onChange:function(e){ setLabel(e.target.value); }, placeholder:"e.g. Admin, Maintenance...", style:INPUT_STYLE,
            onKeyDown:function(e){ if(e.key==="Enter"&&label.trim()) onSave(label.trim(),picked); } })
        ),
        React.createElement("div", null,
          React.createElement("label", { style:LABEL_STYLE }, "Color"),
          React.createElement("div", { style:{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"0.5rem"} },
            laneColors().map(function(col){
              var isSelected = picked.accent===col.accent;
              var bdr = isSelected ? "2px solid "+col.accent : "1px solid "+col.dim;
              var glow = isSelected ? "0 0 8px "+col.accent : "none";
              return (
                React.createElement("button", { key:col.label, onClick:function(){ setPicked(col); },
                  style:{background:col.bg,border:bdr,borderRadius:S.radius,padding:"0.6rem 0.4rem",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:"0.3rem"} },
                  React.createElement("div", { style:{width:"20px",height:"20px",borderRadius:"50%",background:col.accent,boxShadow:glow} }),
                  React.createElement("span", { style:{fontSize:"0.68rem",color:col.accent,fontWeight:600,fontFamily:S.fontBody} }, col.label)
                )
              );
            })
          )
        ),
        React.createElement("div", { style:{background:picked.bg,border:prevBdr,borderRadius:S.radius,padding:"0.65rem 1rem"} },
          React.createElement("div", { style:{fontSize:"0.7rem",textTransform:"uppercase",letterSpacing:"0.1em",color:picked.accent,fontWeight:700} }, label||"Lane Name")
        ),
        React.createElement(ModalActions, null,
          React.createElement("button", { onClick:function(){ if(label.trim()) onSave(label.trim(),picked); }, disabled:!label.trim(),
            style:{flex:1,background:label.trim()?picked.accent+"22":S.bg2,border:"2.5px solid "+(label.trim()?picked.accent:S.border),borderRadius:S.radius,padding:"0.85rem",color:label.trim()?picked.accent:S.textMuted,fontWeight:700,cursor:label.trim()?"pointer":"default",fontFamily:S.fontBody,fontSize:"0.95rem"} }, "Create Lane"),
          React.createElement("button", { onClick:onCancel, style:MODAL_CANCEL() }, "Cancel")
        )
      )
    )
  );
}

// ---- EDIT LANES MODAL -------------------------------------------------------
function EditLanesModal(props){
  var laneOrder=props.laneOrder, laneMeta=props.laneMeta, projects=props.projects||[];
  var onSave=props.onSave, onCancel=props.onCancel, onDeleteLane=props.onDeleteLane;
  var draftS=useState(function(){
    var d={};
    laneOrder.forEach(function(k){ var m=getMeta(laneMeta,k); d[k]={label:m.label,accent:m.accent,bg:m.bg,dim:m.dim}; });
    return d;
  });
  var setDraft=draftS[1]; var draft=draftS[0];
  var deletingS=useState(null); var setDeleting=deletingS[1]; var deleting=deletingS[0];

  function setLabel(k,v){
    setDraft(function(prev){ var n=Object.assign({},prev); n[k]=Object.assign({},n[k],{label:v}); return n; });
  }
  function cycleColor(k){
    setDraft(function(prev){
      var cur=prev[k], idx=-1;
      var set=laneColors();
      var ci=LANE_INDEX[String(cur.accent).toUpperCase()];
      idx = ci===undefined ? -1 : ci;
      var next=set[(idx+1)%set.length];
      var n=Object.assign({},prev);
      n[k]=Object.assign({},n[k],{accent:next.accent,bg:next.bg,dim:next.dim});
      return n;
    });
  }

  var delMeta = deleting ? (draft[deleting]||getMeta(laneMeta,deleting)) : null;
  var delCount = deleting ? projects.filter(function(p){ return p.lane===deleting; }).length : 0;
  var moveTargets = deleting ? laneOrder.filter(function(k){ return k!==deleting; }) : [];

  return (
    React.createElement(Modal, { title:"Edit Lanes", onClose:onCancel, ownActions:true },
      deleting
        ? React.createElement("div", null,
            React.createElement("div", { style:{background:S.dangerBg,border:"2px solid "+S.dangerText,borderRadius:S.radius,padding:"0.85rem 1rem",marginBottom:"0.85rem"} },
              React.createElement("div", { style:{fontWeight:700,fontSize:"1rem",color:S.dangerText,marginBottom:"0.3rem"} }, "Delete \""+delMeta.label+"\"?"),
              React.createElement("div", { style:{fontSize:"0.85rem",color:S.textDim} },
                delCount===0 ? "This lane is empty." : "This lane contains "+delCount+" project"+(delCount!==1?"s":"")+"."
              )
            ),
            delCount>0 && React.createElement("div", { style:{marginBottom:"0.85rem"} },
              React.createElement("div", { style:{fontSize:"0.75rem",color:S.textDim,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:"0.45rem",fontWeight:700} }, "Move projects to another lane:"),
              React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.4rem"} },
                moveTargets.map(function(k){
                  var m=draft[k]||getMeta(laneMeta,k);
                  return React.createElement("button", { key:k, onClick:function(){ onDeleteLane(deleting,"move",k); setDeleting(null); },
                    style:{display:"flex",alignItems:"center",gap:"0.6rem",background:S.bg1,border:"2px solid "+m.accent,borderRadius:S.radius,padding:"0.7rem 1rem",cursor:"pointer",fontFamily:S.fontBody,textAlign:"left"} },
                    React.createElement("div", { style:{width:"12px",height:"12px",borderRadius:"50%",background:m.accent,flexShrink:0} }),
                    React.createElement("span", { style:{fontSize:"0.92rem",fontWeight:600,color:S.text} }, "Move all to "+m.label)
                  );
                })
              )
            ),
            React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.5rem"} },
              React.createElement("button", { onClick:function(){ onDeleteLane(deleting,"delete",null); setDeleting(null); },
                style:{width:"100%",background:S.dangerBg2,border:"2px solid #AA2020",borderRadius:S.radius,padding:"0.8rem",color:S.dangerBright,cursor:"pointer",fontWeight:700,fontFamily:S.fontBody,fontSize:"0.92rem"} },
                delCount===0 ? "Delete Lane" : "Delete Lane + "+delCount+" Project"+(delCount!==1?"s":"")
              ),
              React.createElement("button", { onClick:function(){ setDeleting(null); },
                style:{width:"100%",background:S.bg1,border:"1px solid "+S.border,borderRadius:S.radius,padding:"0.8rem",color:S.textDim,cursor:"pointer",fontFamily:S.fontBody} }, "Cancel")
            )
          )
        : React.createElement("div", null,
            React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.6rem",marginBottom:"1rem"} },
              laneOrder.map(function(k){
                var d=draft[k]||{label:k,accent:"#888",bg:"#111"};
                return React.createElement("div", { key:k, style:{display:"flex",alignItems:"center",gap:"0.6rem"} },
                  React.createElement("button", { onClick:function(){ cycleColor(k); }, title:"Tap to change color",
                    style:{width:"30px",height:"30px",borderRadius:"50%",background:d.accent,border:"3px solid "+d.bg,cursor:"pointer",flexShrink:0,boxShadow:"0 0 6px "+d.accent} }),
                  React.createElement("input", { value:d.label, onChange:function(e){ setLabel(k,e.target.value); },
                    style:Object.assign({},INPUT_STYLE,{flex:1,borderColor:d.accent}) }),
                  laneOrder.length>1 && React.createElement("button", { onClick:function(){ setDeleting(k); }, title:"Delete lane",
                    style:{width:"30px",height:"30px",borderRadius:"8px",background:S.dangerBg,border:"2px solid "+S.dangerText,color:S.dangerText,cursor:"pointer",flexShrink:0,fontSize:"0.95rem",lineHeight:1,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"} }, "x")
                );
              })
            ),
            React.createElement("div", { style:{fontSize:"0.72rem",color:S.textMuted,marginBottom:"0.85rem"} }, "Tap a color dot to cycle colors. Edit names in the fields. Tap x to delete a lane."),
            React.createElement(ModalActions, null,
              React.createElement("button", { onClick:function(){ onSave(draft); }, style:{flex:1,background:S.infoBg,border:"2.5px solid "+S.actionBdr,borderRadius:S.radius,padding:"0.85rem",color:S.infoText,fontWeight:700,cursor:"pointer",fontFamily:S.fontBody,fontSize:"0.95rem"} }, "Save Lanes"),
              React.createElement("button", { onClick:onCancel, style:MODAL_CANCEL() }, "Cancel")
            )
          )
    )
  );
}

// ---- CAROUSEL ---------------------------------------------------------------
// For choices that can grow past two options. Continuous: swipe past the last
// and it comes round to the first, so there is no dead end and the arrows are
// never disabled. Dots show where you are in the ring.
function Carousel(props){
  var keys=props.keys, value=props.value, onChange=props.onChange, labelOf=props.labelOf;
  var n=keys.length;
  var idx=keys.indexOf(value); if(idx<0) idx=0;
  var dragS=useState(0); var setDrag=dragS[1]; var drag=dragS[0];
  var startX=useRef(null), startY=useRef(null), locked=useRef(null);

  function go(next){
    var wrapped = ((next % n) + n) % n;      // continuous ring
    if(wrapped===idx) return;
    haptic(10); onChange(keys[wrapped]);
  }
  function begin(x,y){ startX.current=x; startY.current=y; locked.current=null; setDrag(0); }
  function move(x,y){
    if(startX.current===null) return;
    var dx=x-startX.current, dy=y-startY.current;
    if(locked.current===null && (Math.abs(dx)>6 || Math.abs(dy)>6))
      locked.current = Math.abs(dx)>Math.abs(dy) ? "on" : "off";
    if(locked.current==="on") setDrag(dx);
  }
  function end(){
    if(locked.current==="on" && Math.abs(drag)>44) go(idx + (drag<0 ? 1 : -1));
    startX.current=null; startY.current=null; locked.current=null; setDrag(0);
  }
  function arrow(dir){
    return React.createElement("button", { onClick:function(){ go(idx+dir); }, "data-flat":true,
      "aria-label": (dir<0?"Previous ":"Next ")+(props.name||"option"),
      style:{width:"38px",minHeight:"46px",flexShrink:0,background:"none",border:"none",
             color:S.chromeText,cursor:"pointer",fontSize:"1.2rem",lineHeight:1,fontFamily:S.fontBody} },
      dir<0 ? "\u2039" : "\u203a");
  }
  return React.createElement("div", { dir:"ltr" },
    React.createElement("div", {
      onMouseDown:function(e){ begin(e.clientX,e.clientY); },
      onMouseMove:function(e){ if(startX.current!==null) move(e.clientX,e.clientY); },
      onMouseUp:end, onMouseLeave:function(){ if(startX.current!==null) end(); },
      onTouchStart:function(e){ if(e.touches&&e.touches.length) begin(e.touches[0].clientX,e.touches[0].clientY); },
      onTouchMove:function(e){ if(e.touches&&e.touches.length) move(e.touches[0].clientX,e.touches[0].clientY); },
      onTouchEnd:end,
      "data-surface":"panel",
      style:{display:"flex",alignItems:"center",background:S.bg2,
             border:"2.5px solid "+S.chromeBdr,borderRadius:S.radius,overflow:"hidden",
             touchAction:"pan-y",WebkitUserSelect:"none",userSelect:"none",cursor:"grab"} },
      arrow(-1),
      React.createElement("div", { style:{flex:1,minWidth:0,textAlign:"center",padding:"0.6rem 0.2rem",
        transform:"translateX("+drag+"px)", transition: drag?"none":"transform 0.18s ease-out"} },
        React.createElement("div", { style:{fontSize:"0.98rem",fontWeight:700,color:S.actionText,
          whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",
          fontFamily: props.fontOf ? props.fontOf(keys[idx]) : S.fontBody} }, labelOf(keys[idx])),
        React.createElement("div", { style:{fontSize:"0.66rem",color:S.textMuted,marginTop:"0.15rem",
          letterSpacing:"0.08em",textTransform:"uppercase"} }, (idx+1)+" of "+n+" \u00b7 swipe")
      ),
      arrow(1)
    ),
    React.createElement("div", { style:{display:"flex",justifyContent:"center",gap:"0.4rem",marginTop:"0.5rem"} },
      keys.map(function(k,i){
        return React.createElement("button", { key:k, onClick:function(){ go(i); }, "data-flat":true,
          "aria-label":labelOf(k), "aria-pressed":i===idx,
          style:{width:i===idx?"22px":"8px",height:"8px",borderRadius:"4px",padding:0,
                 border:"none",cursor:"pointer",transition:"width 0.18s",
                 background:i===idx?S.actionBdr:S.chromeBdr} });
      })
    )
  );
}

// ---- TOGGLE -----------------------------------------------------------------
// A track with a thumb you drag between positions. Every option stays visible,
// so the control shows its own range - no counter, no arrows, no hidden items.
// Tap a cell to jump to it; drag the thumb and it snaps to the nearest.
// axis "y" stacks the cells for choices that are themselves about position.
function Toggle(props){
  var keys=props.keys, value=props.value, onChange=props.onChange, labelOf=props.labelOf;
  var axis = props.axis==="y" ? "y" : "x";
  var n = keys.length;
  var idx = keys.indexOf(value); if(idx<0) idx=0;
  var dragS=useState(0); var setDrag=dragS[1]; var drag=dragS[0];
  var track=useRef(null);
  var startA=useRef(null), startB=useRef(null), locked=useRef(null);

  function cellSize(){
    var el=track.current; if(!el) return 0;
    return (axis==="y" ? el.offsetHeight : el.offsetWidth) / n;
  }
  function go(i){
    if(i<0 || i>=n || i===idx) return;
    haptic(10); onChange(keys[i]);
  }
  function begin(x,y){
    startA.current = axis==="y"?y:x; startB.current = axis==="y"?x:y;
    locked.current=null; setDrag(0);
  }
  function move(x,y){
    if(startA.current===null) return;
    var d   = (axis==="y"?y:x) - startA.current;
    var off = (axis==="y"?x:y) - startB.current;
    if(locked.current===null && (Math.abs(d)>5 || Math.abs(off)>5))
      locked.current = Math.abs(d)>Math.abs(off) ? "on" : "off";
    if(locked.current!=="on") return;
    // the thumb cannot leave the track, so the range is always felt
    var c=cellSize();
    if(c) d = Math.max(-idx*c, Math.min((n-1-idx)*c, d));
    setDrag(d);
  }
  function end(){
    if(locked.current==="on"){
      var c=cellSize();
      if(c) go(Math.max(0, Math.min(n-1, Math.round(idx + drag/c))));
    }
    startA.current=null; startB.current=null; locked.current=null; setDrag(0);
  }

  var pct = 100/n;
  var thumb = { position:"absolute", background:S.bg0, border:"2px solid "+S.actionBdr,
    borderRadius:S.radius3, boxSizing:"border-box", pointerEvents:"none",
    transform: (axis==="y"?"translateY(":"translateX(")+drag+"px)",
    transition: drag ? "none" : "left 0.18s ease-out, top 0.18s ease-out, transform 0.18s ease-out" };
  if(axis==="y"){
    thumb.top="calc("+(idx*pct)+"% + 3px)"; thumb.height="calc("+pct+"% - 6px)";
    thumb.left="3px"; thumb.right="3px";
  } else {
    thumb.left="calc("+(idx*pct)+"% + 3px)"; thumb.width="calc("+pct+"% - 6px)";
    thumb.top="3px"; thumb.bottom="3px";
  }

  return React.createElement("div", { dir:"ltr", ref:track, role:"radiogroup",
    "aria-label": props.name || "option",
    onMouseDown:function(e){ begin(e.clientX,e.clientY); },
    onMouseMove:function(e){ if(startA.current!==null) move(e.clientX,e.clientY); },
    onMouseUp:end, onMouseLeave:function(){ if(startA.current!==null) end(); },
    onTouchStart:function(e){ if(e.touches&&e.touches.length) begin(e.touches[0].clientX,e.touches[0].clientY); },
    onTouchMove:function(e){ if(e.touches&&e.touches.length) move(e.touches[0].clientX,e.touches[0].clientY); },
    onTouchEnd:end,
    "data-surface":"panel",
    style:{position:"relative", display:"flex", flexDirection: axis==="y"?"column":"row",
           background:S.bg2, border:"2.5px solid "+S.chromeBdr, borderRadius:S.radius,
           // claim only our own axis, so the modal can still be scrolled
           touchAction: axis==="y" ? "pan-x" : "pan-y",
           WebkitUserSelect:"none", userSelect:"none", cursor:"grab"} },
    React.createElement("div", { "data-surface":"panel", style:thumb }),
    keys.map(function(k,i){
      var on = i===idx;
      return React.createElement("button", { key:k, onClick:function(){ go(i); },
        role:"radio", "aria-checked":on, "data-flat":true,
        style:{flex:1, minWidth:0, position:"relative", zIndex:1, background:"none",
               border:"none", cursor:"pointer",
               padding: axis==="y" ? "0.55rem 0.4rem" : "0.7rem 0.3rem",
               color: on ? S.actionText : S.textDim,
               fontWeight: on ? 700 : 600,
               fontSize: n>2 ? "0.82rem" : "0.95rem",
               fontFamily: props.fontOf ? props.fontOf(k) : S.fontBody,
               whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"} },
        labelOf(k));
    })
  );
}

// ---- SETTINGS MODAL ---------------------------------------------------------
// ---------------- Work schedule ----------------
// The base of all time cataloguing: which days are worked, and the hours on
// each. Day/week/month/quarter/year rollups will all measure against this.
var DAY_KEYS = ["mon","tue","wed","thu","fri","sat","sun"];
var DAY_LABELS = { mon:"Monday", tue:"Tuesday", wed:"Wednesday", thu:"Thursday", fri:"Friday", sat:"Saturday", sun:"Sunday" };
function DEFAULT_SCHEDULE(){
  // normalizeSchedule(null) is the canonical default shape (declaration is
  // hoisted, so the forward reference is safe)
  return normalizeSchedule(null);
}
function schMinutes(day){
  // minutes worked on a day entry; 0 when off or when the times are invalid
  if(!day || !day.on) return 0;
  var a=day.start.split(":"), b=day.end.split(":");
  var m = (+b[0]*60 + +b[1]) - (+a[0]*60 + +a[1]);
  return m>0 ? m : 0;
}
function fmtHours(mins){
  if(TIME_INC==="tenths") return (mins/60).toFixed(2)+"h";
  var h=Math.floor(mins/60), m=mins%60;
  return m ? h+"h "+String(m).padStart(2,"0")+"m" : h+"h";
}
function fmtMoney(n){ return "$"+(Math.round(n*100)/100).toFixed(2); }
// Mixes a #rrggbb color toward white; non-hex inputs pass through unchanged,
// which just makes the pulse invisible instead of breaking the border.
function hexBrighten(hex, amt){
  var m=/^#([0-9a-fA-F]{6})$/.exec(String(hex||""));
  if(!m) return hex;
  var n=parseInt(m[1],16), r=(n>>16)&255, g=(n>>8)&255, b=n&255;
  function ch(c){ return Math.round(c+(255-c)*amt); }
  return "#"+((1<<24)+(ch(r)<<16)+(ch(g)<<8)+ch(b)).toString(16).slice(1);
}
// The vars a pulsing border needs: base color, brightened peak, and glow
// colors that go transparent when the theme has glow turned off.
function pulseVars(col){
  return { "--pulse-a":col, "--pulse-b":hexBrighten(col,0.55),
           "--pulse-s1": S.glow ? col+"33" : "transparent",
           "--pulse-s2": S.glow ? hexBrighten(col,0.55)+"66" : "transparent" };
}

// ---------------- Unpaid breaks ----------------
// Breaks live on the schedule as { enabled, weekly:[...], custom:{mon:[...]} }.
// Weekly breaks apply to every scheduled day; custom ones stack per day on
// top. Each break is { id, name, note, start:"HH:MM", mins }. Every consumer
// of scheduled time nets these out - that is what makes them unpaid.
function toMin(t){
  var a=String(t||"").split(":");
  if(a.length<2) return null;
  var m=(+a[0])*60+(+a[1]);
  return isNaN(m) ? null : m;
}
function isoDate(d){
  var y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), day=String(d.getDate()).padStart(2,"0");
  return y+"-"+m+"-"+day;
}
// Deep-copies and back-fills any schedule shape - a fresh default, a pre-break
// saved schedule, or a complete one - so consumers can rely on the full shape.
function normalizeSchedule(src){
  var sch={};
  DAY_KEYS.forEach(function(k){
    var d=(src&&src[k])||{};
    sch[k]={ on: d.on!==undefined ? !!d.on : (k!=="sat"&&k!=="sun"),
             start:d.start||"08:00", end:d.end||"16:30" };
  });
  var ub=(src&&src.unpaidBreaks)||{};
  var custom={};
  DAY_KEYS.forEach(function(k){
    custom[k]=((ub.custom&&ub.custom[k])||[]).map(function(b){ return Object.assign({},b); });
  });
  sch.unpaidBreaks={ enabled:!!ub.enabled,
    weekly:(ub.weekly||[]).map(function(b){ return Object.assign({},b); }),
    custom:custom };
  // Payroll: which day the work week starts on, which days count as
  // overtime, how overtime pays, and the pay cycle. Unknown values fall back
  // to safe defaults so a stale or hand-edited save can't wedge the app.
  var pr=(src&&src.payroll)||{};
  var otSrc=Array.isArray(pr.otDays)?pr.otDays:[];
  var otKind=(pr.ot&&(pr.ot.kind==="2x"||pr.ot.kind==="flat"))?pr.ot.kind:"1.5x";
  var flatExtra=(pr.ot&&+pr.ot.flatExtra>0)?+pr.ot.flatExtra:6.25;
  var excludeHrs=(pr.ot&&+pr.ot.excludeHrs>0)?+pr.ot.excludeHrs:0;
  var excludeUnit=(pr.ot&&pr.ot.excludeUnit==="week")?"week":"cycle";
  var period=["daily","weekly","biweekly","monthly"].indexOf(pr.cycle&&pr.cycle.period)>=0?pr.cycle.period:"weekly";
  sch.payroll={
    weekStart: DAY_KEYS.indexOf(pr.weekStart)>=0 ? pr.weekStart : "mon",
    otDays: DAY_KEYS.filter(function(k){ return otSrc.indexOf(k)>=0; }),
    ot: { kind:otKind, flatExtra:flatExtra, excludeHrs:excludeHrs, excludeUnit:excludeUnit },
    pay: { basis:(pr.pay&&pr.pay.basis==="salary")?"salary":"hourly",
           rate:(pr.pay&&+pr.pay.rate>0)?+pr.pay.rate:0,
           salary:(pr.pay&&+pr.pay.salary>0)?+pr.pay.salary:0 },
    cycle: { period:period, start:(pr.cycle&&pr.cycle.start)||isoDate(new Date()) }
  };
  return sch;
}
function dayBreaks(sch,k){
  var ub=sch&&sch.unpaidBreaks;
  if(!ub||!ub.enabled) return [];
  return (ub.weekly||[]).concat((ub.custom&&ub.custom[k])||[]);
}
// Minutes of one break that land inside the day's shift; clipped to the
// window, so a break outside working hours deducts nothing and one straddling
// the end deducts only the part that fits. uptoMin limits the count to time
// already gone by (for pace).
function breakOverlapMins(day, br, uptoMin){
  if(!day||!day.on) return 0;
  var s=toMin(day.start), e=toMin(day.end);
  if(s==null||e==null||e<=s) return 0;
  var bs=toMin(br.start), d=Math.max(0, +br.mins||0);
  if(bs==null||d<=0) return 0;
  var hi=Math.min(e, uptoMin==null ? e : Math.max(s, uptoMin));
  var lo=Math.max(s,bs), top=Math.min(hi, bs+d);
  return Math.max(0, top-lo);
}
function schDayBreakMins(sch,k,uptoMin){
  var day=sch&&sch[k];
  return dayBreaks(sch,k).reduce(function(a,b){ return a+breakOverlapMins(day,b,uptoMin); },0);
}
// Net scheduled minutes for a day: shift length minus unpaid breaks, floor 0.
function schNetMinutes(sch,k){
  var g=schMinutes(sch&&sch[k]);
  if(!g) return 0;
  return Math.max(0, g - schDayBreakMins(sch,k));
}
// The iOS-safe time field, shared by the schedule and breaks modals. The
// appearance reset must ride inline (the stylesheet rule alone did not defeat
// the native bubble) and the value color is pinned with text-fill-color.
function TIME_FIELD_STYLE(col, bdrCol){
  return { WebkitAppearance:"none", appearance:"none", colorScheme:S.mode,
           background:S.inputBg, color:col, WebkitTextFillColor:col,
           border:"1.5px solid "+bdrCol, borderRadius:"10px",
           padding:"0.42rem 0.25rem", minHeight:"2.1rem", fontFamily:S.fontMono,
           fontSize:"0.88rem", boxSizing:"border-box" };
}

// ---------------- Period math ----------------
// Every rollup is a half-open range [start,end) anchored to local midnight, so
// a log lands in exactly one period and a DST shift cannot double-count an
// hour at the seam. Month/quarter/year arithmetic always sets the date to the
// 1st before moving the month, so the 31st never spills into the next month.
var PERIODS = ["day","week","month","quarter","year"];
var PERIOD_LABELS = { day:"Day", week:"Week", month:"Month", quarter:"Qtr", year:"Year", pay:"Pay" };
var PERIOD_LONG   = { day:"day", week:"week", month:"month", quarter:"quarter", year:"year", pay:"pay period" };

function startOfDay(d){ var x=new Date(d); x.setHours(0,0,0,0); return x; }
function addDays(d,n){ var x=new Date(d); x.setDate(x.getDate()+n); x.setHours(0,0,0,0); return x; }
// Weeks default to Monday-first (matching the Work Schedule row order) but the
// boundary follows payroll.weekStart when one is passed - a Friday-to-Thursday
// work week reports as exactly that.
function dayKeyOf(d){ return DAY_KEYS[(d.getDay()+6)%7]; }
function weekStartJsDay(ws){ var i=DAY_KEYS.indexOf(ws); return i<0 ? 1 : (i+1)%7; }
function startOfWeek(d, ws){
  var x=startOfDay(d);
  var wsJs=weekStartJsDay(ws===undefined?"mon":ws);
  return addDays(x, -((x.getDay()-wsJs+7)%7));
}
function startOfMonth(d){ var x=startOfDay(d); x.setDate(1); return x; }
function startOfQuarter(d){ var x=startOfMonth(d); x.setMonth(Math.floor(x.getMonth()/3)*3,1); return x; }
function startOfYear(d){ var x=startOfDay(d); x.setMonth(0,1); return x; }

// offset walks backwards through history: 0 is the current period, -1 the one
// before it. Forward past 0 is never offered. weekStart only affects weeks.
function periodRange(kind, offset, ref, weekStart){
  var now = ref ? new Date(ref) : new Date();
  var s, e;
  if(kind==="day"){ s=addDays(now, offset); e=addDays(s,1); }
  else if(kind==="week"){ s=addDays(startOfWeek(now, weekStart), offset*7); e=addDays(s,7); }
  else if(kind==="month"){ s=startOfMonth(now); s.setMonth(s.getMonth()+offset,1); e=new Date(s); e.setMonth(e.getMonth()+1,1); }
  else if(kind==="quarter"){ s=startOfQuarter(now); s.setMonth(s.getMonth()+offset*3,1); e=new Date(s); e.setMonth(e.getMonth()+3,1); }
  else { s=startOfYear(now); s.setFullYear(s.getFullYear()+offset,0,1); e=new Date(s); e.setFullYear(e.getFullYear()+1,0,1); }
  return { kind:kind, offset:offset, start:s.getTime(), end:e.getTime(), startDate:s, endDate:e };
}
function periodLabel(r){
  var s=r.startDate, last=new Date(r.end-1);
  if(r.kind==="pay"){
    if(r.period==="daily") return s.toLocaleDateString([], {weekday:"long",month:"long",day:"numeric"});
    return s.toLocaleDateString([], {month:"short",day:"numeric"})+" - "+
           last.toLocaleDateString([], {month:"short",day:"numeric",year:"numeric"});
  }
  if(r.kind==="day"){
    var sameYear = s.getFullYear()===new Date().getFullYear();
    return s.toLocaleDateString([], sameYear ? {weekday:"long",month:"long",day:"numeric"}
                                             : {weekday:"short",month:"short",day:"numeric",year:"numeric"});
  }
  if(r.kind==="week") return s.toLocaleDateString([], {month:"short",day:"numeric"})+" - "+
                             last.toLocaleDateString([], {month:"short",day:"numeric",year:"numeric"});
  if(r.kind==="month") return s.toLocaleDateString([], {month:"long",year:"numeric"});
  if(r.kind==="quarter") return "Q"+(Math.floor(s.getMonth()/3)+1)+" "+s.getFullYear();
  return String(s.getFullYear());
}
function periodRel(kind, offset){
  if(offset===0) return kind==="day" ? "Today" : "This "+PERIOD_LONG[kind];
  if(offset===-1) return kind==="day" ? "Yesterday" : "Last "+PERIOD_LONG[kind];
  return null;
}

// ---------------- Pay cycles ----------------
// Half-open [start,end) ranges like periodRange, but anchored to the payroll
// cycle start date. offset 0 is the cycle containing ref, negatives walk back.
function dayDiff(a,b){ return Math.round((a-b)/86400000); }
function clampMonthDay(y,m,day){
  // pin the cycle day into the month: a cycle anchored on the 31st runs from
  // the last day of shorter months instead of spilling over
  var last=new Date(y,m+1,0).getDate();
  var d=new Date(y,m,Math.min(day,last));
  d.setHours(0,0,0,0);
  return d;
}
function payCycleRange(payroll, offset, ref){
  var now=ref?new Date(ref):new Date();
  var c=(payroll&&payroll.cycle)||{};
  var period=["daily","weekly","biweekly","monthly"].indexOf(c.period)>=0?c.period:"weekly";
  var anchor=c.start?new Date(String(c.start)+"T00:00:00"):startOfDay(now);
  if(isNaN(anchor.getTime())) anchor=startOfDay(now);
  anchor.setHours(0,0,0,0);
  var s,e;
  if(period==="daily"){ s=addDays(now,offset); e=addDays(s,1); }
  else if(period==="monthly"){
    var day=anchor.getDate();
    var y=now.getFullYear(), m=now.getMonth();
    var cand=clampMonthDay(y,m,day);
    if(startOfDay(now).getTime()<cand.getTime()) m-=1;
    s=clampMonthDay(y, m+offset, day);
    e=clampMonthDay(y, m+offset+1, day);
  } else {
    var len = period==="weekly" ? 7 : 14;
    // floor keeps this correct on both sides of the anchor, so a start date
    // set in the future still resolves the cycle containing today
    var idx=Math.floor(dayDiff(startOfDay(now), anchor)/len);
    s=addDays(anchor,(idx+offset)*len);
    e=addDays(s,len);
  }
  return { kind:"pay", period:period, offset:offset, start:s.getTime(), end:e.getTime(), startDate:s, endDate:e };
}
// Overtime inside a range grouped by week (weekStart-aligned), for per-week
// exclusion allowances. Same rules as the rollup: start-time assigns the day,
// clocked-in time never counts.
function overtimeByWeek(logs, range, otDays, weekStart){
  var otSet={};
  (otDays||[]).forEach(function(k){ otSet[k]=1; });
  var map={}, keys=[];
  (logs||[]).forEach(function(l){
    if(!l || l.type==="atwork") return;
    var dur=l.duration||0;
    if(dur<=0) return;
    if(!(l.startTime>=range.start && l.startTime<range.end)) return;
    var d=new Date(l.startTime);
    if(!otSet[dayKeyOf(d)]) return;
    var wk=startOfWeek(d, weekStart).getTime();
    if(map[wk]===undefined){ map[wk]=0; keys.push(wk); }
    map[wk]+=dur;
  });
  keys.sort();
  return keys.map(function(k){ return { week:k, otMs:map[k] }; });
}

// ---------------- Tracking notifications ----------------
// Three scopes: today's workday, the current pay cycle, and one chosen report
// period. Each fires when tracked time meets the scheduled amount, plus up to
// two lead warnings pegged to the scope's end time (workday: the shift's end
// clock; cycle/period: the range boundary), each up to 48h ahead.
var NOTIF_SCOPES=["day","cycle","period"];
function normalizeNotifs(src){
  function leads(a){
    var arr=Array.isArray(a)?a:[];
    var out=[];
    for(var i=0;i<2;i++){
      var l=arr[i]||{};
      var hrs=+l.hrs;
      if(!(hrs>0)) hrs=(i===0?1:24);
      out.push({ on:!!l.on, hrs:Math.min(48,hrs) });
    }
    return out;
  }
  var s=src||{};
  var kind=["week","month","quarter","year"].indexOf(s.period&&s.period.kind)>=0?s.period.kind:"week";
  return {
    day:    { on:!!(s.day&&s.day.on),    leads:leads(s.day&&s.day.leads) },
    cycle:  { on:!!(s.cycle&&s.cycle.on), leads:leads(s.cycle&&s.cycle.leads) },
    period: { on:!!(s.period&&s.period.on), kind:kind, leads:leads(s.period&&s.period.leads) }
  };
}
function trackedMsBetween(logs, startMs, endMs){
  var t=0;
  (logs||[]).forEach(function(l){
    if(!l || l.type==="atwork") return;
    if(l.startTime>=startMs && l.startTime<endMs) t+=(l.duration||0);
  });
  return t;
}
function notifScopeRange(scopeKey, cfg, schedule, nowMs){
  if(scopeKey==="day"){
    var d=startOfDay(new Date(nowMs));
    var dk=dayKeyOf(d), day=schedule&&schedule[dk];
    var leadEnd=null;
    if(day && day.on){
      var e=toMin(day.end);
      if(e!=null) leadEnd=d.getTime()+e*60000;
    }
    return { start:d.getTime(), end:addDays(d,1).getTime(), leadEnd:leadEnd,
             schedMs:schNetMinutes(schedule,dk)*60000, label:"Workday" };
  }
  if(scopeKey==="cycle"){
    var r=payCycleRange(schedule&&schedule.payroll, 0, new Date(nowMs));
    return { start:r.start, end:r.end, leadEnd:r.end,
             schedMs:scheduledMinutes(schedule,r.start,r.end)*60000, label:"Pay cycle" };
  }
  var kind=(cfg&&cfg.kind)||"week";
  var ws=(schedule&&schedule.payroll&&schedule.payroll.weekStart)||"mon";
  var r2=periodRange(kind, 0, new Date(nowMs), ws);
  var labels={week:"Week",month:"Month",quarter:"Quarter",year:"Year"};
  return { start:r2.start, end:r2.end, leadEnd:r2.end,
           schedMs:scheduledMinutes(schedule,r2.start,r2.end)*60000, label:labels[kind] };
}
// Returns the notifications due right now that haven't fired for this period
// instance yet. Pure: the caller records keys into `fired` and persists them.
function evalNotifications(cfgAll, schedule, logs, nowMs, fired){
  var out=[];
  if(!cfgAll) return out;
  fired=fired||{};
  NOTIF_SCOPES.forEach(function(sk){
    var cfg=cfgAll[sk];
    if(!cfg || !cfg.on) return;
    var info=notifScopeRange(sk, cfg, schedule, nowMs);
    var tracked=trackedMsBetween(logs, info.start, info.end);
    if(info.schedMs>0 && tracked>=info.schedMs){
      var mk=sk+"|met|"+info.start;
      if(!fired[mk]) out.push({ key:mk, title:info.label+" target met",
        body:"Tracked "+fmtDur(tracked,true)+" of "+fmtDur(info.schedMs,true)+" scheduled." });
    }
    (cfg.leads||[]).forEach(function(ld,i){
      if(!ld || !ld.on) return;
      var hrs=Math.min(48, Math.max(0, +ld.hrs||0));
      if(hrs<=0 || info.leadEnd==null) return;
      var at=info.leadEnd - hrs*3600000;
      if(nowMs>=at && nowMs<info.leadEnd){
        var k=sk+"|lead"+i+"|"+info.start;
        if(!fired[k]){
          var rem=Math.max(0, info.schedMs-tracked);
          out.push({ key:k,
            title:info.label+" ends in "+(hrs%1 ? hrs.toFixed(1) : hrs)+"h",
            body: rem>0 ? fmtDur(rem,true)+" of scheduled time not yet tracked."
                        : "Scheduled time already met." });
        }
      }
    });
  });
  return out;
}

// ---------------- Schedule measurement ----------------
// Sum of the work schedule across every calendar day the range touches, net
// of unpaid breaks. This is the denominator every rollup measures against.
function scheduledMinutes(schedule, startMs, endMs){
  if(!schedule || !(endMs>startMs)) return 0;
  var total=0, d=startOfDay(new Date(startMs)), guard=0;
  while(d.getTime()<endMs && guard++<800){ total+=schNetMinutes(schedule, dayKeyOf(d)); d=addDays(d,1); }
  return total;
}
// How much of the period's schedule has already gone by. Today is pro-rated
// against its own window, so the pace figure moves through the day instead of
// jumping a full shift at midnight.
function scheduledToDate(schedule, startMs, endMs, nowMs){
  if(!schedule) return 0;
  if(nowMs>=endMs) return scheduledMinutes(schedule, startMs, endMs);
  if(nowMs<=startMs) return 0;
  var midnight=startOfDay(new Date(nowMs));
  var mins=scheduledMinutes(schedule, startMs, midnight.getTime());
  var dk=dayKeyOf(midnight), day=schedule[dk];
  if(day && day.on){
    var s0=toMin(day.start), e0=toMin(day.end);
    if(s0!=null && e0!=null && e0>s0){
      var t=new Date(nowMs), cur=t.getHours()*60+t.getMinutes();
      // gross shift time gone by, minus the part of each break already behind
      // us - sitting inside the lunch window, pace holds still
      var gross=Math.max(0, Math.min(cur,e0)-s0);
      if(gross>0) mins += Math.max(0, gross - schDayBreakMins(schedule, dk, cur));
    }
  }
  return mins;
}

// ---------------- Rollup aggregation ----------------
function findProj(projects, id){
  for(var i=0;i<projects.length;i++){ if(projects[i].id===id) return projects[i]; }
  return null;
}
// Walk to the top of the parent chain. Guarded against both a missing link
// (deleted parent) and a cycle, either of which would otherwise spin forever.
function rootOf(projects, id){
  var cur=id, seen={}, guard=0;
  while(guard++<40){
    var p=findProj(projects,cur);
    if(!p || p.parentId==null) return cur;
    if(seen[cur]) return cur;
    seen[cur]=1; cur=p.parentId;
  }
  return cur;
}
function byMsDesc(a,b){ return b.ms-a.ms; }

// Aggregates one period into lane > project > sub-task totals. Sub-task time is
// folded into its root project as well as listed beneath it, so a parent row
// always covers its children and a lane total is never double-counted.
// Logs are matched on startTime: a session belongs to the period it began in.
function buildRollup(o){
  var logs=o.logs||[], projects=o.projects||[], range=o.range;
  function inRange(t){ return t>=range.start && t<range.end; }
  // A log is overtime when it starts on a designated overtime day - the same
  // start-time rule that assigns a session to a period assigns it a day.
  var otSet={};
  (o.otDays||[]).forEach(function(k){ otSet[k]=1; });
  var trackedMs=0, clockedMs=0, otMs=0, days={};
  var buckets={}, keys=[];
  function bucket(k){
    var key = k==null ? "__none" : k;
    if(!buckets[key]){ buckets[key]={ key:key, ms:0, map:{}, ids:[] }; keys.push(key); }
    return buckets[key];
  }
  logs.forEach(function(l){
    if(!l || !inRange(l.startTime)) return;
    var dur=l.duration||0;
    if(l.type==="atwork"){ clockedMs+=dur; return; }
    if(dur<=0) return;
    trackedMs+=dur;
    if(otSet[dayKeyOf(new Date(l.startTime))]) otMs+=dur;
    days[new Date(l.startTime).toDateString()]=1;
    var rid=rootOf(projects, l.projectId);
    var rp=findProj(projects, rid);
    var b=bucket((rp&&rp.lane) || l.lane || null);
    b.ms+=dur;
    if(!b.map[rid]){
      // With the project deleted, the only name left is whatever the log kept.
      // parentName describes the root only when the root really is the parent;
      // for a top-level log it would mislabel the row.
      var fallback = rid===l.projectId ? l.projectName : (l.parentName || l.projectName);
      b.map[rid]={ id:rid, name:(rp&&rp.name) || fallback || "(deleted)",
                   ms:0, kids:{}, kidIds:[], gone:!rp };
      b.ids.push(rid);
    }
    var pe=b.map[rid];
    pe.ms+=dur;
    // A log whose own project is not the root is a sub-task of it.
    if(l.projectId!==rid){
      if(!pe.kids[l.projectId]){
        pe.kids[l.projectId]={ id:l.projectId, name:l.projectName||"(deleted)", ms:0 };
        pe.kidIds.push(l.projectId);
      }
      pe.kids[l.projectId].ms+=dur;
    }
  });
  // Lanes follow the user's lane order; anything left over (a lane deleted
  // since the time was logged) sorts to the end by size.
  var order=o.laneOrder||[];
  keys.sort(function(a,b){
    var ia=order.indexOf(a), ib=order.indexOf(b);
    if(ia<0) ia=999;
    if(ib<0) ib=999;
    if(ia!==ib) return ia-ib;
    return buckets[b].ms-buckets[a].ms;
  });
  var lanes=keys.map(function(k){
    var b=buckets[k];
    var m = k==="__none" ? { label:"Unassigned", accent:S.textMuted } : getMeta(o.laneMeta, k);
    var projs=b.ids.map(function(id){ return b.map[id]; }).sort(byMsDesc);
    projs.forEach(function(p){
      p.children=p.kidIds.map(function(cid){ return p.kids[cid]; }).sort(byMsDesc);
    });
    return { key:k, label:m.label, accent:m.accent, ms:b.ms, projects:projs };
  });
  var dist=(o.disruptions||[]).filter(function(d){ return d.endTime && inRange(d.startTime); });
  var brks=(o.breaks||[]).filter(function(b){ return b.endTime && inRange(b.startTime); });
  return {
    trackedMs:trackedMs, clockedMs:clockedMs, otMs:otMs, regMs:trackedMs-otMs, lanes:lanes,
    distMs:dist.reduce(function(a,d){ return a+(d.duration||0); },0), distCount:dist.length,
    breakMs:brks.reduce(function(a,b){ return a+(b.duration||0); },0), breakCount:brks.length,
    activeDays:Object.keys(days).length
  };
}

// ---- PAY & WORK WEEK MODAL --------------------------------------------------
// Week boundary, overtime days and rate, and the pay cycle. Edits a draft of
// schedule.payroll; Done hands it back to the schedule draft, so nothing
// commits until Save Schedule.
var DAY_CHIP={ mon:"Mo", tue:"Tu", wed:"We", thu:"Th", fri:"Fr", sat:"Sa", sun:"Su" };
function PayWorkWeekModal(props){
  var prS=useState(function(){
    var src=props.value||{};
    return { weekStart:src.weekStart||"mon",
             otDays:(src.otDays||[]).slice(),
             ot:Object.assign({kind:"1.5x",flatExtra:6.25,excludeHrs:0,excludeUnit:"cycle"}, src.ot||{}),
             pay:Object.assign({basis:"hourly",rate:0,salary:0}, src.pay||{}),
             cycle:Object.assign({period:"weekly",start:isoDate(new Date())}, src.cycle||{}) };
  });
  var setPr=prS[1]; var pr=prS[0];
  function mutate(fn){
    setPr(function(prev){
      var next={ weekStart:prev.weekStart, otDays:prev.otDays.slice(),
                 ot:Object.assign({},prev.ot), pay:Object.assign({},prev.pay),
                 cycle:Object.assign({},prev.cycle) };
      fn(next);
      return next;
    });
  }
  var sectionHead={fontSize:"0.72rem",textTransform:"uppercase",letterSpacing:"0.08em",
                   color:S.textDim,fontWeight:700,fontFamily:S.fontBody,marginBottom:"0.15rem"};
  var sectionNote={fontSize:"0.76rem",color:S.textMuted,fontFamily:S.fontBody,marginBottom:"0.55rem"};
  var sectionWrap={marginBottom:"1.1rem"};

  function chipRow(kindLabel, isOn, onPick){
    return React.createElement("div", { style:{display:"flex",gap:"0.3rem"} },
      DAY_KEYS.map(function(k){
        var on=isOn(k);
        return React.createElement("button", { key:k, "data-flat":true, "data-chip":kindLabel+":"+k,
          "aria-pressed":on?"true":"false",
          onClick:function(){ haptic(8); onPick(k); },
          style:{flex:1,minWidth:0,background:on?S.infoBg:S.bg1,
                 border:"1.5px solid "+(on?S.actionBdr:S.border),borderRadius:S.radius3,
                 padding:"0.5rem 0",color:on?S.infoText:S.textDim,fontWeight:on?700:600,
                 fontSize:"0.74rem",fontFamily:S.fontBody,cursor:"pointer"} },
          DAY_CHIP[k]);
      }));
  }
  function segRow(kindLabel, opts, value, onPick){
    return React.createElement("div", { style:{display:"flex",gap:"0.3rem"} },
      opts.map(function(o){
        var on=o.k===value;
        return React.createElement("button", { key:o.k, "data-flat":true, "data-seg":kindLabel+":"+o.k,
          onClick:function(){ haptic(8); onPick(o.k); },
          style:{flex:1,minWidth:0,background:on?S.infoBg:S.bg1,
                 border:"1.5px solid "+(on?S.actionBdr:S.border),borderRadius:S.radius3,
                 padding:"0.5rem 0.1rem",color:on?S.infoText:S.textDim,fontWeight:on?700:600,
                 fontSize:"0.74rem",fontFamily:S.fontBody,cursor:"pointer",whiteSpace:"nowrap"} },
          o.label);
      }));
  }

  var flatBad = pr.ot.kind==="flat" && !(+pr.ot.flatExtra>0);
  var otHint = pr.ot.kind==="flat"
    ? "Overtime hours pay the regular rate plus this amount."
    : "Overtime hours pay "+(pr.ot.kind==="2x"?"double":"1.5 times")+" the regular rate.";
  var cycleHints={ daily:"Each day is its own pay period, so no start date is needed.",
                   weekly:"The pay week runs 7 days from the start date's weekday.",
                   biweekly:"Two-week periods, counted from the start date.",
                   monthly:"Runs monthly from the start date's day of the month; shorter months clamp to their last day." };

  var isSalary = pr.pay.basis==="salary";
  var baseBad = isSalary ? !(+pr.pay.salary>0) : !(+pr.pay.rate>0);
  var moneyField = function(field, width){
    var bad = !(+pr.pay[field]>0);
    return React.createElement("input", { type:"number", inputMode:"decimal", min:0, step:0.25,
      value:pr.pay[field],
      onChange:function(e){ mutate(function(n){ n.pay[field]=e.target.value; }); },
      style:Object.assign({},INPUT_STYLE,{width:width,flexShrink:0,padding:"0.42rem 0.4rem",
        fontFamily:S.fontMono,fontSize:"0.88rem",minHeight:"2.1rem",boxSizing:"border-box",textAlign:"center",
        border:"2px solid "+(bad?S.dangerText:S.border), color:bad?S.dangerText:S.text}) });
  };
  return React.createElement(Modal, { title:"Pay & Work Week", onClose:props.onClose, wide:true,
    onSave:function(){ props.onDone(pr); }, saveLabel:"Done" },
    React.createElement("div", { style:sectionWrap },
      React.createElement("div", { style:sectionHead }, "Base Pay"),
      React.createElement("div", { style:sectionNote },
        "All pay calculations are gross and do not include any state or federal deductions."),
      segRow("basis", [ {k:"hourly",label:"Hourly"}, {k:"salary",label:"Salary"} ],
        pr.pay.basis, function(k){ mutate(function(n){ n.pay.basis=k; }); }),
      React.createElement("div", { style:{display:"flex",alignItems:"center",gap:"0.5rem",marginTop:"0.55rem"} },
        React.createElement("span", { style:{color:S.textDim,fontFamily:S.fontMono,fontSize:"0.95rem",flexShrink:0} }, "$"),
        isSalary ? moneyField("salary","110px") : moneyField("rate","84px"),
        React.createElement("span", { style:{fontSize:"0.8rem",color:S.textDim,fontFamily:S.fontBody} },
          isSalary ? "per pay period" : "per hour")
      ),
      isSalary && React.createElement("div", { style:{marginTop:"0.4rem",fontSize:"0.72rem",
          color:S.textMuted,fontFamily:S.fontBody} },
        "Overtime multipliers use the effective rate: salary divided by the scheduled hours in the pay period.")
    ),
    React.createElement("div", { style:sectionWrap },
      React.createElement("div", { style:sectionHead }, "Week Starts On"),
      React.createElement("div", { style:sectionNote }, "Sets the week boundary for reports and weekly pay."),
      chipRow("ws", function(k){ return pr.weekStart===k; },
        function(k){ mutate(function(n){ n.weekStart=k; }); })
    ),
    React.createElement("div", { style:sectionWrap },
      React.createElement("div", { style:sectionHead }, "Overtime Days"),
      React.createElement("div", { style:sectionNote }, "Days where worked time counts as overtime."),
      chipRow("ot", function(k){ return pr.otDays.indexOf(k)>=0; },
        function(k){ mutate(function(n){
          var i=n.otDays.indexOf(k);
          if(i>=0) n.otDays.splice(i,1); else n.otDays.push(k);
        }); })
    ),
    React.createElement("div", { style:sectionWrap },
      React.createElement("div", { style:sectionHead }, "Overtime Rate"),
      React.createElement("div", { style:sectionNote }, otHint),
      segRow("otk", [ {k:"1.5x",label:"1.5x"}, {k:"2x",label:"2x"}, {k:"flat",label:"+$/hr"} ],
        pr.ot.kind, function(k){ mutate(function(n){ n.ot.kind=k; }); }),
      pr.ot.kind==="flat" && React.createElement("div", { style:{display:"flex",alignItems:"center",gap:"0.5rem",marginTop:"0.55rem"} },
        React.createElement("span", { style:{color:S.textDim,fontFamily:S.fontMono,fontSize:"0.95rem",flexShrink:0} }, "$"),
        React.createElement("input", { type:"number", inputMode:"decimal", min:0.25, step:0.25, value:pr.ot.flatExtra,
          onChange:function(e){ mutate(function(n){ n.ot.flatExtra=e.target.value; }); },
          style:Object.assign({},INPUT_STYLE,{width:"84px",flexShrink:0,padding:"0.42rem 0.4rem",
            fontFamily:S.fontMono,fontSize:"0.88rem",minHeight:"2.1rem",boxSizing:"border-box",textAlign:"center",
            border:"2px solid "+(flatBad?S.dangerText:S.border), color:flatBad?S.dangerText:S.text}) }),
        React.createElement("span", { style:{fontSize:"0.8rem",color:S.textDim,fontFamily:S.fontBody} }, "more per hour")
      ),
      React.createElement("div", { style:{display:"flex",alignItems:"center",gap:"0.5rem",marginTop:"0.55rem"} },
        React.createElement("span", { style:{fontSize:"0.8rem",color:S.textDim,fontFamily:S.fontBody,flexShrink:0} }, "Hours excluded"),
        React.createElement("input", { type:"number", inputMode:"numeric", min:0, step:1, value:pr.ot.excludeHrs,
          onChange:function(e){ mutate(function(n){ n.ot.excludeHrs=e.target.value; }); },
          style:Object.assign({},INPUT_STYLE,{width:"58px",flexShrink:0,padding:"0.42rem 0.4rem",
            fontFamily:S.fontMono,fontSize:"0.88rem",minHeight:"2.1rem",boxSizing:"border-box",textAlign:"center",
            border:"2px solid "+S.border, color:S.text}) }),
        React.createElement("span", { style:{fontSize:"0.8rem",color:S.textDim,fontFamily:S.fontBody} }, "hours")
      ),
      React.createElement("div", { style:{marginTop:"0.45rem"} },
        segRow("exu", [ {k:"cycle",label:"Per pay cycle"}, {k:"week",label:"Per week"} ],
          pr.ot.excludeUnit==="week"?"week":"cycle",
          function(k){ mutate(function(n){ n.ot.excludeUnit=k; }); })
      ),
      React.createElement("div", { style:{marginTop:"0.4rem",fontSize:"0.72rem",color:S.textMuted,fontFamily:S.fontBody} },
        "The first excluded hours of overtime "+
        (pr.ot.excludeUnit==="week" ? "each week " : "each pay cycle ")+
        (pr.pay.basis==="salary"
          ? "are covered by salary - no extra pay."
          : "pay the base rate, not the overtime rate."))
    ),
    React.createElement("div", { style:{marginBottom:"0.4rem"} },
      React.createElement("div", { style:sectionHead }, "Pay Cycle"),
      React.createElement("div", { style:sectionNote }, cycleHints[pr.cycle.period]),
      segRow("cyc", [ {k:"daily",label:"Daily"}, {k:"weekly",label:"Weekly"},
                      {k:"biweekly",label:"Biweekly"}, {k:"monthly",label:"Monthly"} ],
        pr.cycle.period, function(k){ mutate(function(n){ n.cycle.period=k; }); }),
      pr.cycle.period!=="daily" && React.createElement("div", { style:{display:"flex",alignItems:"center",gap:"0.5rem",marginTop:"0.55rem"} },
        React.createElement("span", { style:{fontSize:"0.8rem",color:S.textDim,fontFamily:S.fontBody,flexShrink:0} }, "Cycle start"),
        React.createElement("input", { type:"date", value:pr.cycle.start,
          onChange:function(e){ mutate(function(n){ n.cycle.start=e.target.value; }); },
          style:Object.assign(TIME_FIELD_STYLE(S.text, S.border), { flex:"1 1 auto", minWidth:"130px", maxWidth:"170px" }) })
      )
    )
  );
}

function WorkScheduleModal(props){
  var draftS=useState(function(){
    // normalize doubles as the deep copy, so Cancel discards cleanly and the
    // draft always carries the full shape including unpaidBreaks
    return normalizeSchedule(props.schedule);
  });
  var setDraft=draftS[1]; var draft=draftS[0];
  var showBreaksS=useState(false); var setShowBreaks=showBreaksS[1]; var showBreaks=showBreaksS[0];
  var showPayS=useState(false); var setShowPay=showPayS[1]; var showPay=showPayS[0];
  function patch(k, field, value){
    setDraft(function(prev){
      // day edits only touch the one day; unpaidBreaks rides along by reference
      var next=Object.assign({},prev);
      next[k]=Object.assign({},prev[k]);
      next[k][field]=value;
      return next;
    });
  }
  function setUB(ub){
    setDraft(function(prev){ return Object.assign({},prev,{unpaidBreaks:ub}); });
  }
  function setPR(pr){
    setDraft(function(prev){ return Object.assign({},prev,{payroll:pr}); });
  }
  var ub=draft.unpaidBreaks;
  var pr=draft.payroll;
  var CYCLE_LABELS={daily:"Daily",weekly:"Weekly",biweekly:"Biweekly",monthly:"Monthly"};
  var basisTag = pr.pay.basis==="salary"
    ? "Salary"
    : (+pr.pay.rate>0 ? "Hourly "+fmtMoney(+pr.pay.rate)+"/hr" : "Hourly");
  var paySummary = basisTag+" \u00b7 "+DAY_LABELS[pr.weekStart]+" start \u00b7 "+CYCLE_LABELS[pr.cycle.period]+" pay \u00b7 OT "+
    (pr.ot.kind==="flat" ? "+$"+pr.ot.flatExtra+"/hr" : pr.ot.kind) +
    (+pr.ot.excludeHrs>0 ? " after "+pr.ot.excludeHrs+"h"+(pr.ot.excludeUnit==="week"?"/wk":"") : "") +
    (pr.otDays.length ? " ("+pr.otDays.map(function(k){ return DAY_CHIP[k]; }).join(" ")+")" : "");
  var grossWeek = DAY_KEYS.reduce(function(a,k){ return a+schMinutes(draft[k]); },0);
  var weekMins  = DAY_KEYS.reduce(function(a,k){ return a+schNetMinutes(draft,k); },0);
  var breakWeek = grossWeek - weekMins;
  var timeInput = function(k, field){
    var invalid = draft[k].on && schMinutes(draft[k])===0;
    var col = draft[k].on ? (invalid?S.dangerText:S.text) : S.textMuted;
    return React.createElement("input", { type:"time", value:draft[k][field], disabled:!draft[k].on,
      onChange:function(e){ patch(k, field, e.target.value); },
      style:Object.assign(TIME_FIELD_STYLE(col, invalid?S.dangerText:S.border),
        { flex:"0 1 94px", minWidth:"80px", opacity:draft[k].on?1:0.45 }) });
  };
  return React.createElement(React.Fragment, null,
    React.createElement(Modal, { title:"Work Schedule", onClose:props.onClose, wide:true,
    onSave:function(){ props.onSave(draft); }, saveLabel:"Save Schedule" },
    React.createElement("div", { style:{fontSize:"0.8rem",color:S.textDim,marginBottom:"0.9rem"} },
      "Days and hours you normally work. Reports will measure tracked time against this."),
    // ---- pay & work week ----
    React.createElement("div", { style:{display:"flex",alignItems:"center",gap:"0.6rem",padding:"0.15rem 0 0.7rem",
        borderBottom:"1px solid "+S.border} },
      React.createElement("div", { style:{flex:1,minWidth:0,fontFamily:S.fontBody} },
        React.createElement("div", { style:{color:S.text,fontWeight:600,fontSize:"0.9rem",whiteSpace:"nowrap"} }, "Pay & Work Week"),
        React.createElement("div", { style:{color:S.textMuted,fontSize:"0.72rem",marginTop:"0.1rem",
          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"} }, paySummary)
      ),
      React.createElement("button", { "data-flat":true,
        onClick:function(){ setShowPay(true); },
        style:{flexShrink:0,background:S.bg1,border:"1.5px solid "+S.borderBright,borderRadius:S.radius3,
               padding:"0.45rem 0.8rem",color:S.text,cursor:"pointer",fontFamily:S.fontBody,
               fontWeight:600,fontSize:"0.82rem",whiteSpace:"nowrap"} },
        "Edit")
    ),
    DAY_KEYS.map(function(k){
      var d=draft[k];
      var invalid = d.on && schMinutes(d)===0;
      return React.createElement("div", { key:k,
        style:{display:"flex",alignItems:"center",gap:"0.45rem",padding:"0.5rem 0",borderBottom:"1px solid "+S.border} },
        // Day toggle: tap the name to switch the day on or off. The column is
        // sized by an invisible bold "Wednesday" so every name's right edge
        // lands on the same line, tight against the start field, in any theme
        // font - and the fields themselves all start at the same x.
        React.createElement("button", { "data-flat":true, onClick:function(){ patch(k,"on",!d.on); },
          "aria-pressed":d.on?"true":"false",
          style:{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:"0.4rem",flexShrink:0,background:"none",border:"none",padding:"0.25rem 0",cursor:"pointer",fontFamily:S.fontBody} },
          React.createElement("span", { style:{width:"10px",height:"10px",borderRadius:"50%",flexShrink:0,
            background:d.on?S.successText:"transparent", border:"2px solid "+(d.on?S.successText:S.chromeBdr)} }),
          React.createElement("span", { style:{position:"relative",display:"inline-block",whiteSpace:"nowrap"} },
            // sizer: widest label at the heaviest weight the real one can take
            React.createElement("span", { "aria-hidden":"true", style:{visibility:"hidden",fontWeight:600,fontSize:"0.9rem"} }, DAY_LABELS.wed),
            React.createElement("span", { style:{position:"absolute",right:0,top:0,
              color:d.on?S.text:S.textMuted,fontWeight:d.on?600:400,fontSize:"0.9rem"} }, DAY_LABELS[k])
          )
        ),
        timeInput(k,"start"),
        timeInput(k,"end"),
        React.createElement("span", { style:{width:"46px",flexShrink:0,marginLeft:"auto",textAlign:"right",fontSize:"0.74rem",fontFamily:S.fontMono,
          color: invalid?S.dangerText:(d.on?S.textDim:S.textMuted)} },
          d.on ? (invalid?"end?":fmtHours(schNetMinutes(draft,k))) : "off")
      );
    }),
    // ---- unpaid breaks ----
    React.createElement("div", { style:{display:"flex",alignItems:"center",gap:"0.6rem",padding:"0.7rem 0",
        borderBottom:"1px solid "+S.border} },
      React.createElement("button", { "data-flat":true,
        onClick:function(){ haptic(10); setUB(Object.assign({},ub,{enabled:!ub.enabled})); },
        "aria-pressed":ub.enabled?"true":"false",
        style:{display:"flex",alignItems:"center",gap:"0.55rem",flex:1,minWidth:0,textAlign:"left",
               background:"none",border:"none",padding:"0.25rem 0",cursor:"pointer",fontFamily:S.fontBody} },
        React.createElement("span", { style:{width:"10px",height:"10px",borderRadius:"50%",flexShrink:0,
          background:ub.enabled?S.successText:"transparent", border:"2px solid "+(ub.enabled?S.successText:S.chromeBdr)} }),
        React.createElement("span", { style:{color:ub.enabled?S.text:S.textMuted,fontWeight:ub.enabled?600:400,fontSize:"0.9rem",whiteSpace:"nowrap"} },
          "Unpaid Breaks")
      ),
      ub.enabled && React.createElement("button", { "data-flat":true,
        onClick:function(){ setShowBreaks(true); },
        style:{flexShrink:0,background:S.bg1,border:"1.5px solid "+S.borderBright,borderRadius:S.radius3,
               padding:"0.45rem 0.8rem",color:S.text,cursor:"pointer",fontFamily:S.fontBody,
               fontWeight:600,fontSize:"0.82rem",whiteSpace:"nowrap"} },
        "Edit Breaks")
    ),
    ub.enabled && breakWeek>0 && React.createElement("div", { style:{display:"flex",justifyContent:"space-between",
        padding:"0.6rem 0 0",fontFamily:S.fontBody} },
      React.createElement("span", { style:{color:S.textDim,fontSize:"0.8rem"} }, "Unpaid breaks per week"),
      React.createElement("span", { style:{color:S.warnText,fontSize:"0.8rem",fontFamily:S.fontMono} }, "-"+fmtHours(breakWeek))
    ),
    React.createElement("div", { style:{display:"flex",justifyContent:"space-between",padding:"0.85rem 0 0.2rem",fontFamily:S.fontBody} },
      React.createElement("span", { style:{color:S.textDim,fontSize:"0.85rem"} }, "Scheduled per week"),
      React.createElement("span", { style:{color:S.text,fontWeight:700,fontFamily:S.fontMono} }, fmtHours(weekMins))
    )
    ),
    // Nested as a sibling overlay, never inside the modal card: fixed
    // positioning breaks inside backdrop-filter surfaces (known bug class).
    showBreaks && React.createElement(UnpaidBreaksModal, { value:ub, schedule:draft,
      onDone:function(next){ setUB(next); setShowBreaks(false); },
      onClose:function(){ setShowBreaks(false); } }),
    showPay && React.createElement(PayWorkWeekModal, { value:pr,
      onDone:function(next){ setPR(next); setShowPay(false); },
      onClose:function(){ setShowPay(false); } })
  );
}

// ---- BACKUP & RESTORE MODAL -------------------------------------------------
// Export: every tt_* key as a JSON file, delivered via the share sheet when
// available, a download link otherwise, clipboard as the last resort.
// Restore: pick a file, review the summary, then an explicit replace-all
// confirm. The app reloads afterward so everything re-boots through the
// normalizers.
function BackupModal(props){
  var statusS=useState(null); var setStatus=statusS[1]; var status=statusS[0];
  var pendingS=useState(null); var setPending=pendingS[1]; var pending=pendingS[0];

  function doExport(){
    haptic(10);
    var obj=backupBuild(localStorage);
    var json=JSON.stringify(obj);
    var name="time-tracker-backup-"+isoDate(new Date())+".json";
    try{
      if(typeof File!=="undefined" && navigator.share && navigator.canShare &&
         navigator.canShare({ files:[new File([json],name,{type:"application/json"})] })){
        navigator.share({ files:[new File([json],name,{type:"application/json"})], title:name })
          .then(function(){ setStatus({ok:true,msg:"Backup shared."}); })
          .catch(function(){ setStatus(null); });
        return;
      }
    }catch(e){}
    try{
      var url=URL.createObjectURL(new Blob([json],{type:"application/json"}));
      var a=document.createElement("a");
      a.href=url; a.download=name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function(){ URL.revokeObjectURL(url); },5000);
      setStatus({ok:true,msg:"Backup downloaded as "+name+"."});
      return;
    }catch(e){}
    try{
      navigator.clipboard.writeText(json).then(function(){
        setStatus({ok:true,msg:"Backup JSON copied to the clipboard - paste it somewhere safe."});
      });
    }catch(e){ setStatus({ok:false,msg:"Could not export on this device."}); }
  }

  function onPickFile(e){
    var f=e.target && e.target.files && e.target.files[0];
    if(!f) return;
    setStatus(null);
    try{
      var r=new FileReader();
      r.onload=function(){
        var obj=null;
        try{ obj=JSON.parse(String(r.result)); }catch(err){ setStatus({ok:false,msg:"That file is not valid JSON."}); return; }
        var bad=backupValidate(obj);
        if(bad){ setStatus({ok:false,msg:bad}); return; }
        setPending({ obj:obj, summary:backupSummary(obj) });
      };
      r.onerror=function(){ setStatus({ok:false,msg:"Could not read that file."}); };
      r.readAsText(f);
    }catch(err){ setStatus({ok:false,msg:"Could not read that file."}); }
    try{ e.target.value=""; }catch(err2){}
  }

  function doRestore(){
    if(!pending) return;
    haptic([20,50,20]);
    var res=backupApply(pending.obj, localStorage);
    if(!res.ok){ setStatus({ok:false,msg:res.error}); setPending(null); return; }
    setStatus({ok:true,msg:"Restored. Reloading..."});
    try{ setTimeout(function(){ location.reload(); }, 400); }catch(e){}
  }

  function fmtStamp(iso){
    try{ return new Date(iso).toLocaleDateString([], {month:"short",day:"numeric",year:"numeric"}); }
    catch(e){ return String(iso||""); }
  }
  var note={fontSize:"0.78rem",color:S.textDim,fontFamily:S.fontBody,marginBottom:"0.7rem"};
  var btn={display:"block",width:"100%",background:S.bg1,border:"1.5px solid "+S.borderBright,
           borderRadius:S.radius,padding:"0.75rem",color:S.text,cursor:"pointer",
           fontFamily:S.fontBody,fontWeight:700,fontSize:"0.9rem"};

  return React.createElement(Modal, { title:"Backup & Restore", onClose:props.onClose, cancelLabel:"Close" },
    React.createElement("div", { style:note },
      "Everything lives on this phone: deleting the app from the home screen deletes your tracked time with it. Export a backup regularly and keep it somewhere safe."),
    React.createElement("button", { "data-flat":true, onClick:doExport, style:btn }, "Export Backup"),
    React.createElement("div", { style:{margin:"1rem 0 0.4rem",fontSize:"0.72rem",textTransform:"uppercase",
      letterSpacing:"0.08em",color:S.textDim,fontWeight:700,fontFamily:S.fontBody} }, "Restore"),
    React.createElement("div", { style:note },
      "Restoring replaces everything currently in the app with the backup."),
    !pending && React.createElement("label", { style:Object.assign({},btn,{textAlign:"center"}) },
      "Choose Backup File",
      React.createElement("input", { type:"file", accept:"application/json,.json",
        onChange:onPickFile, style:{display:"none"} })
    ),
    pending && React.createElement("div", { style:{background:S.bg1,border:"1px solid "+S.border,
        borderRadius:S.radius,padding:"0.8rem",marginBottom:"0.6rem"} },
      React.createElement("div", { style:{color:S.text,fontWeight:700,fontSize:"0.88rem",
        fontFamily:S.fontBody,marginBottom:"0.35rem"} }, "Backup from "+fmtStamp(pending.summary.exportedAt)),
      React.createElement("div", { style:{color:S.textDim,fontSize:"0.8rem",fontFamily:S.fontBody} },
        (pending.summary.projects!=null ? pending.summary.projects+" projects, " : "")+
        (pending.summary.logs!=null ? pending.summary.logs+" log entries" : pending.summary.keys+" data sets")+
        (pending.summary.range ? " ("+fmtStamp(new Date(pending.summary.range.min).toISOString())+
          " - "+fmtStamp(new Date(pending.summary.range.max).toISOString())+")" : "")),
      React.createElement("button", { "data-flat":true, onClick:doRestore,
        style:Object.assign({},btn,{marginTop:"0.6rem",background:S.dangerBg2,
          border:"1.5px solid "+S.dangerText,color:S.dangerText}) },
        "Replace All Data & Restore"),
      React.createElement("button", { "data-flat":true, onClick:function(){ setPending(null); setStatus(null); },
        style:Object.assign({},btn,{marginTop:"0.45rem",fontWeight:600,color:S.textDim}) },
        "Pick a Different File")
    ),
    status && React.createElement("div", { style:{marginTop:"0.6rem",fontSize:"0.8rem",fontFamily:S.fontBody,
      color:status.ok?S.successText:S.dangerText} }, status.msg)
  );
}

// ---- UNPAID BREAKS MODAL ----------------------------------------------------
// Edits a draft copy of the schedule's unpaid breaks. "Every work day" breaks
// apply to all scheduled days; custom daily breaks stack per day on top of
// them. Done hands the result back to the schedule draft - nothing commits
// until Save Schedule.
function UnpaidBreaksModal(props){
  var ubS=useState(function(){
    var src=props.value||{}, custom={};
    DAY_KEYS.forEach(function(k){
      custom[k]=((src.custom&&src.custom[k])||[]).map(function(b){ return Object.assign({},b); });
    });
    return { enabled:src.enabled!==false,
             weekly:(src.weekly||[]).map(function(b){ return Object.assign({},b); }),
             custom:custom };
  });
  var setUb=ubS[1]; var ub=ubS[0];
  var openDayS=useState(props.initialOpenDay||null); var setOpenDay=openDayS[1]; var openDay=openDayS[0];

  function mutate(fn){
    setUb(function(prev){
      var next={ enabled:prev.enabled, weekly:prev.weekly.slice(), custom:{} };
      DAY_KEYS.forEach(function(k){ next.custom[k]=prev.custom[k].slice(); });
      fn(next);
      return next;
    });
  }
  function listOf(n, dayKey){ return dayKey ? n.custom[dayKey] : n.weekly; }
  function addBreak(dayKey){
    haptic(10);
    mutate(function(n){ listOf(n,dayKey).push({ id:uid(), name:"", note:"", start:"12:00", mins:30 }); });
    if(dayKey) setOpenDay(dayKey);
  }
  function editBreak(dayKey, id, field, value){
    mutate(function(n){
      var arr=listOf(n,dayKey);
      for(var i=0;i<arr.length;i++){
        if(arr[i].id===id){ arr[i]=Object.assign({},arr[i]); arr[i][field]=value; }
      }
    });
  }
  function removeBreak(dayKey, id){
    haptic(10);
    mutate(function(n){
      var out=listOf(n,dayKey).filter(function(b){ return b.id!==id; });
      if(dayKey) n.custom[dayKey]=out; else n.weekly=out;
    });
  }

  // week deduction preview against the live schedule draft
  var preview=Object.assign({}, props.schedule, { unpaidBreaks:Object.assign({},ub,{enabled:true}) });
  var weekDeduct=DAY_KEYS.reduce(function(a,k){ return a+schDayBreakMins(preview,k); },0);

  var sectionHead={fontSize:"0.72rem",textTransform:"uppercase",letterSpacing:"0.08em",
                   color:S.textDim,fontWeight:700,fontFamily:S.fontBody,marginBottom:"0.15rem"};
  var sectionNote={fontSize:"0.76rem",color:S.textMuted,fontFamily:S.fontBody,marginBottom:"0.55rem"};

  function addBtn(dayKey){
    return React.createElement("button", { "data-flat":true, onClick:function(){ addBreak(dayKey); },
      style:{display:"block",width:"100%",background:"none",border:"1.5px dashed "+S.borderBright,
             borderRadius:S.radius3,padding:"0.55rem",color:S.successMid,cursor:"pointer",
             fontFamily:S.fontBody,fontWeight:700,fontSize:"0.85rem"} },
      "+ Add Break");
  }
  function breakCard(dayKey, b){
    var minsBad = !(+b.mins>0);
    var startBad = toMin(b.start)==null;
    return React.createElement("div", { key:b.id,
      style:{background:S.bg1,border:"1px solid "+S.border,borderRadius:S.radius,
             padding:"0.6rem",marginBottom:"0.5rem"} },
      React.createElement("div", { style:{display:"flex",gap:"0.5rem",marginBottom:"0.45rem"} },
        React.createElement("input", { value:b.name, placeholder:"e.g. Lunch",
          onChange:function(e){ editBreak(dayKey, b.id, "name", e.target.value); },
          style:Object.assign({},INPUT_STYLE,{flex:1,minWidth:0,padding:"0.45rem 0.6rem",fontSize:"0.88rem"}) }),
        React.createElement("button", { "data-flat":true, "aria-label":"Remove break",
          onClick:function(){ removeBreak(dayKey, b.id); },
          style:{flexShrink:0,width:"36px",background:S.bg0,border:"1.5px solid "+S.border,
                 borderRadius:S.radius3,color:S.dangerText,cursor:"pointer",
                 fontFamily:S.fontBody,fontWeight:700,fontSize:"1rem",lineHeight:1} },
          "\u00d7")
      ),
      React.createElement("div", { style:{display:"flex",alignItems:"center",gap:"0.5rem",marginBottom:"0.45rem"} },
        React.createElement("input", { type:"time", value:b.start,
          onChange:function(e){ editBreak(dayKey, b.id, "start", e.target.value); },
          style:Object.assign(TIME_FIELD_STYLE(startBad?S.dangerText:S.text, startBad?S.dangerText:S.border),
            { flex:"0 1 94px", minWidth:"80px" }) }),
        React.createElement("input", { type:"number", inputMode:"numeric", min:1, step:5, value:b.mins,
          onChange:function(e){ editBreak(dayKey, b.id, "mins", e.target.value); },
          style:Object.assign({},INPUT_STYLE,{width:"64px",flexShrink:0,padding:"0.42rem 0.4rem",
            fontFamily:S.fontMono,fontSize:"0.88rem",minHeight:"2.1rem",boxSizing:"border-box",
            textAlign:"center",
            border:"2px solid "+(minsBad?S.dangerText:S.border),
            color:minsBad?S.dangerText:S.text}) }),
        React.createElement("span", { style:{fontSize:"0.78rem",color:S.textDim,fontFamily:S.fontBody,flexShrink:0} }, "min")
      ),
      React.createElement("input", { value:b.note, placeholder:"Description (optional)",
        onChange:function(e){ editBreak(dayKey, b.id, "note", e.target.value); },
        style:Object.assign({},INPUT_STYLE,{padding:"0.42rem 0.6rem",fontSize:"0.8rem",color:S.textDim}) })
    );
  }

  return React.createElement(Modal, { title:"Unpaid Breaks", onClose:props.onClose, wide:true,
    onSave:function(){ props.onDone(ub); }, saveLabel:"Done" },
    // every work day
    React.createElement("div", { style:{marginBottom:"1.1rem"} },
      React.createElement("div", { style:sectionHead }, "Every Work Day"),
      React.createElement("div", { style:sectionNote }, "Deducted from each scheduled day."),
      ub.weekly.map(function(b){ return breakCard(null, b); }),
      addBtn(null)
    ),
    // custom daily
    React.createElement("div", { style:{marginBottom:"0.9rem"} },
      React.createElement("div", { style:sectionHead }, "Custom Daily Breaks"),
      React.createElement("div", { style:sectionNote }, "Extra breaks for specific days, combined with the ones above."),
      DAY_KEYS.map(function(k){
        var d=props.schedule && props.schedule[k];
        var on=!!(d&&d.on);
        var count=ub.custom[k].length;
        var isOpen=openDay===k;
        return React.createElement("div", { key:k, style:{borderBottom:"1px solid "+S.border} },
          React.createElement("button", { "data-flat":true, "data-dayrow":k,
            onClick:function(){ setOpenDay(isOpen?null:k); },
            style:{display:"flex",alignItems:"center",gap:"0.5rem",width:"100%",textAlign:"left",
                   background:"none",border:"none",padding:"0.6rem 0",cursor:"pointer",fontFamily:S.fontBody} },
            React.createElement("span", { style:{flex:1,minWidth:0,color:on?S.text:S.textMuted,
              fontWeight:on?600:400,fontSize:"0.9rem"} },
              DAY_LABELS[k]+(on?"":" (off)")),
            count>0 && React.createElement("span", { style:{flexShrink:0,minWidth:"20px",textAlign:"center",
              background:S.successBg2,border:"1px solid "+S.successBorder,borderRadius:"999px",
              padding:"0.05rem 0.4rem",color:S.successText,fontSize:"0.72rem",fontFamily:S.fontMono,fontWeight:700} },
              String(count)),
            React.createElement("span", { style:{flexShrink:0,fontSize:"0.8rem",color:S.textDim} }, isOpen?"\u2228":"\u203a")
          ),
          isOpen && React.createElement("div", { style:{paddingBottom:"0.6rem"} },
            !on && React.createElement("div", { style:{fontSize:"0.74rem",color:S.textMuted,
              fontFamily:S.fontBody,marginBottom:"0.45rem"} },
              "This day is off in the schedule - breaks here have no effect until it is on."),
            ub.custom[k].map(function(b){ return breakCard(k, b); }),
            addBtn(k)
          )
        );
      })
    ),
    weekDeduct>0 && React.createElement("div", { style:{display:"flex",justifyContent:"space-between",
        padding:"0.7rem 0 0.1rem",fontFamily:S.fontBody} },
      React.createElement("span", { style:{color:S.textDim,fontSize:"0.85rem"} }, "Unpaid per week"),
      React.createElement("span", { style:{color:S.warnText,fontWeight:700,fontFamily:S.fontMono} }, "-"+fmtHours(weekDeduct))
    )
  );
}

function TrackingModal(props){
  var settings=props.settings, onChange=props.onChange;
  function set(key, value){
    var next=Object.assign({},settings); next[key]=value; onChange(next);
  }
  var sectionBox={marginBottom:"1.1rem",paddingBottom:"1rem",borderBottom:"1px solid "+S.border};
  var sectionHead={fontSize:"0.78rem",textTransform:"uppercase",letterSpacing:"0.08em",color:S.textDim,fontWeight:700,marginBottom:"0.35rem"};
  var note={fontSize:"0.8rem",color:S.textDim,marginBottom:"0.7rem"};
  return React.createElement(Modal, { title:"Tracking", onClose:props.onClose, onSave:props.onClose, wide:true },
    // How time is captured. Applies live, like Themes and Layout.
    React.createElement("div", { style:sectionBox },
      React.createElement("div", { style:sectionHead }, "Capture"),
      React.createElement("div", { style:note }, "How time gets onto a project: running timers, or entering it by hand."),
      React.createElement(Toggle, {
        name:"tracking", keys:["timer","manual"], value:settings.tracking==="manual"?"manual":"timer",
        labelOf:function(k){ return k==="timer"?"Timers":"Manual Entry"; },
        onChange:function(v){ set("tracking", v); }
      })
    ),
    React.createElement("div", { style:sectionBox },
      React.createElement("div", { style:sectionHead }, "Time Increments"),
      React.createElement("div", { style:note },
        "Standard shows days, hours, minutes and seconds. Tenths shows decimal hours to the hundredth (1h 30m becomes 1.50h) - no days. Applies everywhere, instantly."),
      React.createElement(Toggle, {
        name:"timeinc", keys:["standard","tenths"], value:settings.timeInc==="tenths"?"tenths":"standard",
        labelOf:function(k){ return k==="standard"?"Standard":"Tenths"; },
        onChange:function(v){ set("timeInc", v); }
      })
    ),
    // ---- notifications ----
    (function(){
      var cfg=normalizeNotifs(settings.notifs);
      function setCfg(next){ set("notifs", next); }
      function patchScope(sk, fields){
        var next=normalizeNotifs(cfg);
        next[sk]=Object.assign({}, next[sk], fields);
        setCfg(next);
      }
      function patchLead(sk, i, fields){
        var next=normalizeNotifs(cfg);
        next[sk].leads=next[sk].leads.map(function(l,j){ return j===i?Object.assign({},l,fields):l; });
        setCfg(next);
      }
      function dot(on){
        return React.createElement("span", { style:{width:"10px",height:"10px",borderRadius:"50%",flexShrink:0,
          background:on?S.successText:"transparent", border:"2px solid "+(on?S.successText:S.chromeBdr)} });
      }
      function leadRow(sk, i){
        var ld=cfg[sk].leads[i];
        var bad=ld.on && !(+ld.hrs>0 && +ld.hrs<=48);
        return React.createElement("div", { key:sk+i, style:{display:"flex",alignItems:"center",gap:"0.5rem",
            padding:"0.3rem 0 0.3rem 1.4rem"} },
          React.createElement("button", { "data-flat":true, "data-notiflead":sk+":"+i,
            "aria-pressed":ld.on?"true":"false",
            onClick:function(){ haptic(8); patchLead(sk,i,{on:!ld.on}); },
            style:{display:"flex",alignItems:"center",gap:"0.5rem",background:"none",border:"none",
                   padding:"0.15rem 0",cursor:"pointer",fontFamily:S.fontBody} },
            dot(ld.on),
            React.createElement("span", { style:{fontSize:"0.8rem",color:ld.on?S.text:S.textMuted} }, "Notify")
          ),
          React.createElement("input", { type:"number", inputMode:"decimal", min:0.5, max:48, step:0.5, value:ld.hrs,
            disabled:!ld.on,
            onChange:function(e){ patchLead(sk,i,{hrs:e.target.value}); },
            style:Object.assign({},INPUT_STYLE,{width:"58px",flexShrink:0,padding:"0.35rem 0.3rem",
              fontFamily:S.fontMono,fontSize:"0.85rem",minHeight:"1.9rem",boxSizing:"border-box",textAlign:"center",
              border:"2px solid "+(bad?S.dangerText:S.border), color:bad?S.dangerText:(ld.on?S.text:S.textMuted),
              opacity:ld.on?1:0.45}) }),
          React.createElement("span", { style:{fontSize:"0.78rem",color:ld.on?S.textDim:S.textMuted,fontFamily:S.fontBody} },
            "h before the end")
        );
      }
      function scopeBlock(sk, title, sub){
        var on=cfg[sk].on;
        return React.createElement("div", { key:sk, style:{padding:"0.45rem 0",borderBottom:"1px solid "+S.border} },
          React.createElement("button", { "data-flat":true, "data-notifscope":sk,
            "aria-pressed":on?"true":"false",
            onClick:function(){ haptic(8); patchScope(sk,{on:!on}); },
            style:{display:"flex",alignItems:"center",gap:"0.55rem",width:"100%",textAlign:"left",
                   background:"none",border:"none",padding:"0.2rem 0",cursor:"pointer",fontFamily:S.fontBody} },
            dot(on),
            React.createElement("span", { style:{flex:1,minWidth:0,color:on?S.text:S.textMuted,
              fontWeight:on?600:400,fontSize:"0.9rem"} }, title),
            React.createElement("span", { style:{flexShrink:0,fontSize:"0.72rem",color:S.textMuted} }, sub)
          ),
          on && sk==="period" && React.createElement("div", { style:{padding:"0.35rem 0 0.15rem 1.4rem",display:"flex",gap:"0.3rem"} },
            ["week","month","quarter","year"].map(function(k){
              var sel=cfg.period.kind===k;
              return React.createElement("button", { key:k, "data-flat":true, "data-notifkind":k,
                onClick:function(){ haptic(8); patchScope("period",{kind:k}); },
                style:{flex:1,minWidth:0,background:sel?S.infoBg:S.bg1,
                       border:"1.5px solid "+(sel?S.actionBdr:S.border),borderRadius:S.radius3,
                       padding:"0.4rem 0",color:sel?S.infoText:S.textDim,fontWeight:sel?700:600,
                       fontSize:"0.72rem",fontFamily:S.fontBody,cursor:"pointer"} },
                {week:"Week",month:"Month",quarter:"Qtr",year:"Year"}[k]);
            })),
          on && leadRow(sk,0),
          on && leadRow(sk,1)
        );
      }
      var perm = (typeof Notification!=="undefined") ? Notification.permission : "unsupported";
      return React.createElement("div", { style:{marginBottom:"0.4rem"} },
        React.createElement("div", { style:sectionHead }, "Notifications"),
        React.createElement("div", { style:note },
          "Fire when tracked time meets the scheduled amount for a scope, plus up to two warnings before its end time (48h max). Notifications fire while the app is open."),
        scopeBlock("day", "Workday", "vs today's schedule"),
        scopeBlock("cycle", "Pay Cycle", "vs cycle schedule"),
        scopeBlock("period", "Time Period", "vs period schedule"),
        React.createElement("div", { style:{display:"flex",alignItems:"center",gap:"0.6rem",paddingTop:"0.7rem"} },
          React.createElement("span", { style:{flex:1,fontSize:"0.76rem",color:S.textMuted,fontFamily:S.fontBody} },
            perm==="granted" ? "System banners: allowed"
            : perm==="denied" ? "System banners: blocked in iOS Settings"
            : perm==="unsupported" ? "System banners: not available here (in-app only)"
            : "System banners: not yet allowed"),
          perm==="default" && React.createElement("button", { "data-flat":true,
            onClick:function(){ try{ Notification.requestPermission(); }catch(e){} },
            style:{flexShrink:0,background:S.bg1,border:"1.5px solid "+S.borderBright,borderRadius:S.radius3,
                   padding:"0.4rem 0.7rem",color:S.text,cursor:"pointer",fontFamily:S.fontBody,
                   fontWeight:600,fontSize:"0.78rem"} },
            "Allow")
        )
      );
    })()
  );
}

function SettingsModal(props){
  var settings=props.settings, onChange=props.onChange, onClose=props.onClose;
  var sectionHead={fontSize:"0.75rem",textTransform:"uppercase",letterSpacing:"0.1em",color:S.textDim,fontWeight:700,marginBottom:"0.4rem"};
  var sectionBox={background:S.bg1,border:"1px solid "+S.border,borderRadius:S.radius,padding:"0.75rem 0.9rem",marginBottom:"0.85rem"};
  var placeholder={border:"2px dashed "+S.borderBright,borderRadius:S.radius3,padding:"0.6rem 0.8rem",color:S.textMuted,fontSize:"0.82rem",textAlign:"center"};

  function set(key, val){
    var n=Object.assign({},settings); n[key]=val; onChange(n);
  }
  function pending(title, desc){
    return React.createElement("div", { key:title, style:sectionBox },
      React.createElement("div", { style:sectionHead }, title),
      React.createElement("div", { style:{fontSize:"0.8rem",color:S.textDim,marginBottom:"0.55rem"} }, desc),
      React.createElement("div", { style:placeholder }, "Options coming soon")
    );
  }

  var subHead={fontSize:"0.72rem",textTransform:"uppercase",letterSpacing:"0.08em",
               color:S.textMuted,fontWeight:700,margin:"0.95rem 0 0.35rem"};
  var note={fontSize:"0.78rem",color:S.textDim,marginBottom:"0.5rem"};
  var themeKey=themeKeyOf(settings);

  return (
    React.createElement(Modal, { title:"Themes and Layout", onClose:onClose, onSave:onClose, wide:true },
      // Appearance, ordered the way it is chosen: theme first, then the palette
      // and type that theme allows, then the mode it renders in.
      React.createElement("div", { style:sectionBox },
        React.createElement("div", { style:sectionHead }, "Theme"),
        React.createElement("div", { style:note }, "Shape, texture and type. Each theme carries its own palettes and faces."),
        React.createElement(Carousel, {
          name:"theme", keys:Object.keys(THEMES), value:themeKey,
          labelOf:function(k){ return THEMES[k].label; },
          onChange:function(v){ set("theme", v); }
        }),

        React.createElement("div", { style:subHead }, "Colour palette"),
        React.createElement("div", { style:note }, "Only the palettes this theme allows."),
        React.createElement(Carousel, {
          name:"palette", keys:THEMES[themeKey].schemes, value:schemeKeyOf(settings),
          labelOf:function(k){ return (SCHEMES[k]||{}).label || k; },
          onChange:function(v){
            var n=Object.assign({}, settings.schemes||{}); n[themeKey]=v;
            var next=Object.assign({}, settings); next.schemes=n; next.colorScheme=v;
            onChange(next);
          }
        }),
        React.createElement("div", { style:{display:"flex",gap:"0.4rem",marginTop:"0.55rem",justifyContent:"center"} },
          ((SCHEMES[schemeKeyOf(settings)]||{}).swatches||[]).map(function(c){
            return React.createElement("div", { key:c, style:{width:"16px",height:"16px",borderRadius:"50%",background:c,boxShadow:S.glow?"0 0 6px "+c:"none"} });
          })
        ),

        React.createElement("div", { style:subHead }, "Typeface"),
        React.createElement("div", { style:note }, "Shown in its own face. Each theme remembers the one you picked for it."),
        React.createElement(Carousel, {
          name:"typeface", keys:Object.keys(THEMES[themeKey].fonts), value:fontKeyOf(settings),
          labelOf:function(k){ return THEMES[themeKey].fonts[k].label; },
          fontOf: function(k){ return THEMES[themeKey].fonts[k].body; },
          onChange:function(v){
            var n=Object.assign({}, settings.fonts||{}); n[themeKey]=v;
            set("fonts", n);
          }
        }),

        React.createElement("div", { style:subHead }, "Mode"),
        React.createElement(Toggle, {
          name:"mode", keys:["dark","light"], value:settings.mode==="light"?"light":"dark",
          labelOf:function(k){ return k==="dark"?"Dark":"Light"; },
          onChange:function(v){ set("mode", v); }
        })
      ),

      pending("Layout", "Density, card sizes, and what shows on each row."),

      // Reach: which hand holds the phone, and which end of the screen the bar sits at.
      React.createElement("div", { style:sectionBox },
        React.createElement("div", { style:sectionHead }, "Handedness"),
        React.createElement("div", { style:note }, "Mirrors the whole layout so controls fall under your thumb."),
        React.createElement(Toggle, {
          name:"hand", keys:["left","right"], value:settings.handedness==="left"?"left":"right",
          labelOf:function(k){ return k==="left"?"Left Hand":"Right Hand"; },
          onChange:function(v){ set("handedness", v); }
        })
      ),
      React.createElement("div", { style:sectionBox },
        React.createElement("div", { style:sectionHead }, "Header Position"),
        React.createElement("div", { style:note }, "Swipe up or down to move the control bar to that end of the screen."),
        React.createElement(Toggle, {
          name:"header", axis:"y", keys:["top","bottom"], value:settings.headerPos==="bottom"?"bottom":"top",
          labelOf:function(k){ return k==="top"?"Top":"Bottom"; },
          onChange:function(v){ set("headerPos", v); }
        })
      ),

      // Module panels, each in the same section box the core uses, so a module
      // cannot drift from the settings language. None registered yet.
      ttSettingsPanels().map(function(m){
        return React.createElement("div", { key:m.id, style:sectionBox },
          React.createElement("div", { style:sectionHead }, m.title),
          React.createElement(m.settingsPanel, ttModuleContext(m.id, { settings:settings, onChange:onChange }))
        );
      }),

      React.createElement("button", { onClick:onClose,
        style:{width:"100%",background:S.bg1,border:"1px solid "+S.border,borderRadius:S.radius,padding:"0.85rem",color:S.textDim,cursor:"pointer",fontFamily:S.fontBody,fontWeight:600} }, "Close")
    )
  );
}

// ---- EDIT DISRUPTION PRESETS MODAL ------------------------------------------
function EditDistPresetsModal(props){
  var presets=props.presets, onSave=props.onSave, onCancel=props.onCancel;
  var itemsS=useState(presets.slice()); var setItems=itemsS[1]; var items=itemsS[0];
  var newItemS=useState(""); var setNewItem=newItemS[1]; var newItem=newItemS[0];
  var confirmIdxS=useState(null); var setConfirmIdx=confirmIdxS[1]; var confirmIdx=confirmIdxS[0];
  function setText(i,v){ setItems(function(prev){ var n=prev.slice(); n[i]=v; return n; }); }
  function move(i,dir){
    setConfirmIdx(null);
    setItems(function(prev){
      var j=i+dir;
      if(j<0||j>=prev.length) return prev;
      var n=prev.slice(); var t=n[i]; n[i]=n[j]; n[j]=t; return n;
    });
  }
  function remove(i){ setConfirmIdx(null); setItems(function(prev){ return prev.filter(function(x,k){ return k!==i; }); }); }
  function add(){
    if(!newItem.trim()) return;
    setItems(function(prev){ return prev.concat([newItem.trim()]); });
    setNewItem("");
  }
  var arrowSt={width:"28px",height:"28px",background:S.bg1,border:"1px solid "+S.borderBright,borderRadius:"6px",color:S.textDim,cursor:"pointer",fontSize:"0.8rem",lineHeight:1,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:S.fontBody};
  return (
    React.createElement(Modal, { title:"Edit Disruption List", onClose:onCancel, ownActions:true },
      React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.5rem",marginBottom:"0.85rem",maxHeight:"320px",overflowY:"auto"} },
        items.map(function(label,i){
          return React.createElement("div", { key:i, style:{display:"flex",alignItems:"center",gap:"0.4rem"} },
            React.createElement("span", { style:{fontSize:"0.85rem",fontWeight:900,color:S.distChipMark,letterSpacing:"-0.05em",flexShrink:0} }, "!!"),
            React.createElement("input", { value:label, onChange:function(e){ setText(i,e.target.value); },
              style:Object.assign({},INPUT_STYLE,{flex:1,padding:"0.45rem 0.65rem"}) }),
            React.createElement("button", { onClick:function(){ move(i,-1); }, style:arrowSt }, "\u25b2"),
            React.createElement("button", { onClick:function(){ move(i,1); }, style:arrowSt }, "\u25bc"),
            confirmIdx===i
              ? React.createElement("button", { onClick:function(){ remove(i); },
                  style:{height:"28px",background:S.dangerBg2,border:"2px solid "+S.dangerBright,borderRadius:"6px",color:S.dangerBright,cursor:"pointer",fontSize:"0.62rem",fontWeight:700,flexShrink:0,padding:"0 0.4rem",fontFamily:S.fontBody,whiteSpace:"nowrap"} }, "delete?")
              : React.createElement("button", { onClick:function(){ setConfirmIdx(i); },
                  style:{width:"28px",height:"28px",background:S.dangerBg,border:"2px solid "+S.dangerText,borderRadius:"6px",color:S.dangerText,cursor:"pointer",fontSize:"0.85rem",lineHeight:1,fontWeight:700,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"} }, "x")
          );
        })
      ),
      React.createElement("div", { style:{display:"flex",gap:"0.5rem",marginBottom:"0.85rem"} },
        React.createElement("input", { value:newItem, onChange:function(e){ setNewItem(e.target.value); }, placeholder:"Add a disruption type...",
          onKeyDown:function(e){ if(e.key==="Enter") add(); },
          style:Object.assign({},INPUT_STYLE,{flex:1}) }),
        React.createElement("button", { onClick:add, disabled:!newItem.trim(),
          style:{background:newItem.trim()?S.distChipBg:S.addDisabled,border:"none",borderRadius:S.radius3,padding:"0 1rem",color:S.onAccent,cursor:newItem.trim()?"pointer":"default",fontWeight:700,fontFamily:S.fontBody,fontSize:"1.1rem"} }, "+")
      ),
      React.createElement("div", { style:{fontSize:"0.72rem",color:S.textMuted,marginBottom:"0.85rem"} }, "Edit names in the fields. Use arrows to reorder. Tap x to remove."),
      React.createElement(ModalActions, null,
        React.createElement("button", { onClick:function(){ onSave(items.filter(function(x){ return x.trim(); })); },
          style:{flex:1,background:S.infoBg,border:"2.5px solid "+S.actionBdr,borderRadius:S.radius,padding:"0.85rem",color:S.infoText,fontWeight:700,cursor:"pointer",fontFamily:S.fontBody,fontSize:"0.95rem"} }, "Save List"),
        React.createElement("button", { onClick:onCancel,
          style:MODAL_CANCEL() }, "Cancel")
      )
    )
  );
}

// ---- DELETE PROJECT MODAL ---------------------------------------------------
function DeleteProjectModal(props){
  var proj=props.proj, allProjects=props.allProjects, laneMeta=props.laneMeta;
  var onMoveTasks=props.onMoveTasks, onDeleteAll=props.onDeleteAll, onCancel=props.onCancel;
  var meta=getMeta(laneMeta,proj.lane);
  var descIds=getDescendantIds(allProjects,proj.id);
  var taskCount=descIds.length;
  var isSub=!!proj.parentId;
  var otherParents=allProjects.filter(function(p){ return p.lane===proj.lane&&p.parentId===null&&p.id!==proj.id; });

  return (
    React.createElement(Modal, { title:isSub?"Delete Task":"Delete Project", onClose:onCancel },
      React.createElement("div", { style:{background:S.dangerBg,border:"2px solid "+S.dangerText,borderRadius:S.radius,padding:"0.85rem 1rem",marginBottom:"0.85rem"} },
        React.createElement("div", { style:{fontWeight:700,fontSize:"1rem",color:S.dangerText,marginBottom:"0.3rem"} }, "Delete \""+proj.name+"\"?"),
        React.createElement("div", { style:{fontSize:"0.85rem",color:S.textDim} },
          taskCount===0 ? "It has no sub-tasks. Its logged time stays in history." : "It contains "+taskCount+" task"+(taskCount!==1?"s":"")+". Logged time stays in history."
        )
      ),
      taskCount>0 && React.createElement("div", { style:{marginBottom:"0.85rem"} },
        React.createElement("div", { style:{fontSize:"0.75rem",color:S.textDim,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:"0.45rem",fontWeight:700} }, "Keep the tasks - move them:"),
        React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.4rem"} },
          React.createElement("button", { onClick:function(){ onMoveTasks(proj,null); },
            style:{display:"flex",alignItems:"center",gap:"0.6rem",background:S.bg1,border:"2px solid "+meta.accent,borderRadius:S.radius,padding:"0.7rem 1rem",cursor:"pointer",fontFamily:S.fontBody,textAlign:"left"} },
            React.createElement("div", { style:{width:"12px",height:"12px",borderRadius:"50%",background:meta.accent,flexShrink:0} }),
            React.createElement("span", { style:{fontSize:"0.92rem",fontWeight:600,color:S.text} }, "Promote to top level of "+meta.label)
          ),
          otherParents.map(function(p){
            return React.createElement("button", { key:p.id, onClick:function(){ onMoveTasks(proj,p.id); },
              style:{display:"flex",alignItems:"center",gap:"0.6rem",background:S.bg1,border:"2px solid "+meta.dim,borderRadius:S.radius,padding:"0.7rem 1rem",cursor:"pointer",fontFamily:S.fontBody,textAlign:"left"} },
              React.createElement("span", { style:{color:meta.accent,fontWeight:700,flexShrink:0} }, ">"),
              React.createElement("span", { style:{fontSize:"0.92rem",fontWeight:600,color:S.text} }, "Move into \""+p.name+"\"")
            );
          })
        )
      ),
      React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.5rem"} },
        React.createElement("button", { onClick:function(){ onDeleteAll(proj); },
          style:{width:"100%",background:S.dangerBg2,border:"2px solid #AA2020",borderRadius:S.radius,padding:"0.8rem",color:S.dangerBright,cursor:"pointer",fontWeight:700,fontFamily:S.fontBody,fontSize:"0.92rem"} },
          taskCount===0 ? (isSub?"Delete Task":"Delete Project") : "Delete Project + "+taskCount+" Task"+(taskCount!==1?"s":"")
        ),
      )
    )
  );
}

// ---- DAY SUMMARY ------------------------------------------------------------
function DaySummary(props){
  var logs=props.logs, disruptions=props.disruptions, breaks=props.breaks, onClose=props.onClose, testMode=props.testMode;
  var copiedS = useState(false); var setCopied=copiedS[1]; var copied=copiedS[0];
  var today=new Date().toLocaleDateString([],{weekday:"long",month:"long",day:"numeric",year:"numeric"});
  var done=disruptions.filter(function(d){ return d.endTime; });
  var distTotal=done.reduce(function(a,d){ return a+d.duration; },0);
  var breakTotal=breaks.filter(function(b){ return b.endTime; }).reduce(function(a,b){ return a+b.duration; },0);
  var projectLogs=logs.filter(function(l){ return l.type!=="atwork"; });
  var totalMs=projectLogs.reduce(function(a,l){ return a+l.duration; },0);

  var byProject={};
  projectLogs.forEach(function(l){
    var k=l.projectId;
    if(!byProject[k]) byProject[k]={name:l.projectName,lane:l.lane,ms:0,parentId:l.parentId};
    byProject[k].ms+=l.duration;
  });

  var lines=["Day Summary - "+today+(testMode?" [TEST]":""),""];
  Object.values(byProject).filter(function(p){ return !p.parentId; }).sort(function(a,b){ return b.ms-a.ms; }).forEach(function(p){
    lines.push(p.name.padEnd(36)+fmtDur(p.ms,true).padStart(8));
    Object.values(byProject).filter(function(c){ return c.parentId; }).forEach(function(c){
      lines.push("  > "+c.name.padEnd(32)+fmtDur(c.ms,true).padStart(8));
    });
  });
  lines.push("","Total: "+fmtDur(totalMs,true));
  if(breakTotal>0) lines.push("Breaks: "+fmtDur(breakTotal,true));
  if(distTotal>0) lines.push("Disruptions ("+done.length+"): "+fmtDur(distTotal,true)+" lost");

  function copy(){ navigator.clipboard.writeText(lines.join("\n")).then(function(){ setCopied(true); setTimeout(function(){ setCopied(false); },2000); }); }

  return (
    React.createElement(Modal, { title:"Day Summary", onClose:onClose, wide:true },
      React.createElement("div", { style:{display:"flex",gap:"0.5rem",marginBottom:"1rem"} },
        React.createElement("button", { onClick:copy, style:{flex:1,background:copied?S.successBg2:S.bg1,border:"1px solid "+(copied?S.successBorder:S.border),borderRadius:S.radius,padding:"0.7rem",color:copied?S.successText:S.textDim,cursor:"pointer",fontFamily:S.fontBody,fontWeight:600} }, copied?"Copied!":"Copy")
      ),
      React.createElement("div", { style:{background:S.bg0,borderRadius:S.radius,padding:"0.85rem",maxHeight:"400px",overflowY:"auto"} },
        lines.map(function(line,i){
          return React.createElement("div", { key:i, style:{fontFamily:S.fontMono,fontSize:"0.8rem",color:line.startsWith("Day")||line.startsWith("Total")?S.text:S.textDim,marginBottom:"0.1rem",whiteSpace:"pre"} }, line||"\u00a0");
        })
      )
    )
  );
}

// ---- REPORTS ----------------------------------------------------------------
// Day / week / month / quarter / year rollups measured against the work
// schedule. Running timers are passed in as synthetic logs so the current
// period never reads lower than the cards on the board.
function ReportsModal(props){
  var kindS=useState(props.initialKind||"week"); var setKind=kindS[1]; var kind=kindS[0];
  var offS=useState(0); var setOff=offS[1]; var off=offS[0];
  var openS=useState({}); var setOpen=openS[1]; var open=openS[0];
  var copiedS=useState(false); var setCopied=copiedS[1]; var copied=copiedS[0];

  var now=Date.now();
  var payroll=(props.schedule&&props.schedule.payroll)||null;
  var weekStart=(payroll&&payroll.weekStart)||"mon";
  var isPay = kind==="pay";
  var range = isPay ? payCycleRange(payroll, off) : periodRange(kind, off, null, weekStart);
  if(isPay) range.kind="pay";
  var allLogs=(props.logs||[]).concat(props.liveLogs||[]);
  var roll=buildRollup({
    logs:allLogs,
    projects:props.projects||[], disruptions:props.disruptions, breaks:props.breaks,
    laneMeta:props.laneMeta, laneOrder:props.laneOrder, range:range,
    otDays:payroll?payroll.otDays:[]
  });
  var ot=(payroll&&payroll.ot)||{kind:"1.5x",flatExtra:6.25};
  var otMult = ot.kind==="2x" ? 2 : 1.5;
  var hasOtDays = !!(payroll && payroll.otDays && payroll.otDays.length);
  var schedMins=scheduledMinutes(props.schedule, range.start, range.end);
  var paceMins=scheduledToDate(props.schedule, range.start, range.end, now);
  var trackedMins=roll.trackedMs/60000;
  var coverPct = schedMins>0 ? Math.round(trackedMins/schedMins*100) : null;
  var pacePct  = paceMins>0  ? Math.round(trackedMins/paceMins*100)  : null;
  var fillPct  = schedMins>0 ? Math.min(100, trackedMins/schedMins*100) : 0;
  var markPct  = schedMins>0 ? Math.min(100, paceMins/schedMins*100)    : 0;
  var partial  = now>range.start && now<range.end;
  var rel=periodRel(kind, off);

  // What a module's reports hook is handed: the window being viewed and the
  // core's own rollup, so a module reports against the same period the user is
  // looking at instead of recomputing one.
  function modReportCtx(){
    return { kind:kind, range:range, rollup:roll, logs:allLogs,
             projects:props.projects||[], schedule:props.schedule,
             testMode:!!props.testMode, now:now };
  }

  function share(ms){ return roll.trackedMs>0 ? (ms/roll.trackedMs*100) : 0; }
  function toggle(key){
    setOpen(function(prev){ var n=Object.assign({},prev); n[key]=!n[key]; return n; });
  }
  function stepTo(next){ setOff(next); setOpen({}); haptic(8); }

  // Plain-text version for pasting into a log or an email.
  function reportText(){
    var out=["Time Report - "+periodLabel(range)+(props.testMode?" [TEST]":""),""];
    roll.lanes.forEach(function(ln){
      out.push(ln.label.toUpperCase()+"  "+fmtDur(ln.ms,true));
      ln.projects.forEach(function(p){
        out.push("  "+String(p.name).slice(0,32).padEnd(34)+fmtDur(p.ms,true).padStart(9));
        p.children.forEach(function(c){
          out.push("    > "+String(c.name).slice(0,28).padEnd(30)+fmtDur(c.ms,true).padStart(9));
        });
      });
      out.push("");
    });
    out.push("Tracked: "+fmtDur(roll.trackedMs,true));
    if(isPay){
      out.push("Regular: "+fmtDur(roll.regMs,true));
      if(excludeHrs>0) out.push("OT excluded (first "+excludeHrs+"h"+(excludeUnit==="week"?" each week":"")+"): "+fmtDur(exclH*3600000,true));
      out.push("Overtime: "+fmtDur(effOtH*3600000,true)+" "+otTag);
      if(ot.kind==="flat") out.push("OT premium: "+fmtMoney(otPremium));
      else if(isSalary && salaryAmt>0) out.push("OT pay: "+fmtMoney(otPay));
      else if(!isSalary) out.push("Pay-weighted hours: "+fmtDur(weightedMs,true));
      if(grossPay!=null) out.push("Gross pay: "+fmtMoney(grossPay));
      out.push("All pay figures are gross - no state or federal deductions.");
    }
    if(schedMins>0) out.push("Scheduled: "+fmtHours(schedMins)+(coverPct!=null?"  ("+coverPct+"% covered)":""));
    if(roll.clockedMs>0) out.push("Clocked in: "+fmtDur(roll.clockedMs,true));
    if(roll.breakMs>0) out.push("Breaks ("+roll.breakCount+"): "+fmtDur(roll.breakMs,true));
    if(roll.distMs>0) out.push("Disruptions ("+roll.distCount+"): "+fmtDur(roll.distMs,true)+" lost");
    out.push("Days with time: "+roll.activeDays);
    // Modules append their own lines to the copied report, after the core's.
    var modLines=ttReportText(modReportCtx());
    if(modLines.length){ out.push(""); out=out.concat(modLines); }
    return out.join("\n");
  }
  function copy(){
    try{
      navigator.clipboard.writeText(reportText()).then(function(){
        setCopied(true); setTimeout(function(){ setCopied(false); },2000);
      });
    }catch(e){}
  }

  // ---- pieces ----
  var seg=React.createElement("div", { style:{display:"flex",gap:"0.3rem",marginBottom:"0.7rem"} },
    PERIODS.concat(["pay"]).map(function(k){
      var on=k===kind;
      return React.createElement("button", { key:k, "data-flat":true,
        onClick:function(){ setKind(k); setOff(0); setOpen({}); haptic(8); },
        style:{flex:1,background:on?S.infoBg:S.bg1,border:"1.5px solid "+(on?S.actionBdr:S.border),
               borderRadius:S.radius3,padding:"0.5rem 0.1rem",color:on?S.infoText:S.textDim,
               fontWeight:on?700:600,fontSize:"0.72rem",fontFamily:S.fontBody,cursor:"pointer",whiteSpace:"nowrap"} },
        PERIOD_LABELS[k]);
    })
  );

  function arrow(glyph, disabled, onClick){
    return React.createElement("button", { "data-flat":true, disabled:disabled,
      onClick:function(){ if(!disabled) onClick(); },
      style:{width:"38px",height:"38px",flexShrink:0,background:S.bg1,
             border:"1.5px solid "+S.border,borderRadius:S.radius3,
             color:disabled?S.textMuted:S.text,fontFamily:S.fontMono,fontSize:"1rem",
             cursor:disabled?"default":"pointer",opacity:disabled?0.4:1} }, glyph);
  }
  var nav=React.createElement("div", { style:{display:"flex",alignItems:"center",gap:"0.5rem",marginBottom:"0.85rem"} },
    arrow("\u2039", false, function(){ stepTo(off-1); }),
    React.createElement("div", { style:{flex:1,minWidth:0,textAlign:"center"} },
      React.createElement("div", { style:{color:S.text,fontWeight:700,fontSize:"0.9rem",
        whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"} }, periodLabel(range)),
      rel && React.createElement("div", { style:{color:S.textDim,fontSize:"0.7rem",
        textTransform:"uppercase",letterSpacing:"0.08em",marginTop:"0.1rem"} }, rel)
    ),
    arrow("\u203a", off>=0, function(){ stepTo(off+1); })
  );

  // Tracked against scheduled, with a tick showing how far into the schedule
  // the period actually is. Behind the tick means behind pace, not behind target.
  var bar=React.createElement("div", { style:{position:"relative",height:"10px",background:S.bg0,
      borderRadius:"999px",overflow:"hidden",border:"1px solid "+S.border} },
    React.createElement("div", { style:{position:"absolute",left:0,top:0,bottom:0,width:fillPct+"%",
      background:S.successText,borderRadius:"999px",transition:"width 0.2s"} }),
    partial && markPct>0 && markPct<100 && React.createElement("div", { style:{position:"absolute",
      left:markPct+"%",top:0,bottom:0,width:"2px",background:S.warnText,opacity:0.9} })
  );

  var summary=React.createElement("div", { style:{background:S.bg1,border:"1px solid "+S.border,
      borderRadius:S.radius,padding:"0.85rem",marginBottom:"0.85rem"} },
    React.createElement("div", { style:{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:"0.5rem",marginBottom:"0.55rem"} },
      React.createElement(Mono, { style:{fontSize:"1.5rem",fontWeight:600,color:S.text,lineHeight:1} }, fmtDur(roll.trackedMs,true)),
      React.createElement("span", { style:{fontSize:"0.78rem",color:S.textDim,fontFamily:S.fontBody,textAlign:"right"} },
        schedMins>0 ? ("of "+fmtHours(schedMins)+" scheduled") : "no schedule set")
    ),
    schedMins>0 && bar,
    schedMins>0 && React.createElement("div", { style:{display:"flex",justifyContent:"space-between",
        marginTop:"0.4rem",fontSize:"0.72rem",fontFamily:S.fontBody} },
      React.createElement("span", { style:{color:S.textDim} }, coverPct+"% of the period"),
      partial && pacePct!=null && React.createElement("span", {
        style:{color: pacePct>=95 ? S.successText : (pacePct>=75 ? S.warnText : S.textDim) } },
        pacePct+"% of pace ("+fmtHours(paceMins)+" so far)")
    )
  );

  // Pay tab math. The exclusion is per pay period: the first excludeHrs of
  // overtime get base treatment - an hourly worker earns the base rate for
  // them, a salaried worker earns nothing extra (the salary covers them).
  // Salary multipliers price OT off the effective rate: salary divided by the
  // scheduled hours in this period. Every dollar figure is gross.
  var payCfg=Object.assign({basis:"hourly",rate:0,salary:0}, (payroll&&payroll.pay)||{});
  var isSalary = payCfg.basis==="salary";
  var baseRate=+payCfg.rate||0, salaryAmt=+payCfg.salary||0;
  var excludeHrs=Math.max(0, +ot.excludeHrs||0);
  var excludeUnit = ot.excludeUnit==="week" ? "week" : "cycle";
  var otRawH=roll.otMs/3600000, regH=roll.regMs/3600000;
  // per-cycle: one allowance for the whole period; per-week: each
  // weekStart-aligned week inside the period gets its own allowance
  var exclH;
  if(excludeUnit==="week" && excludeHrs>0 && isPay){
    exclH=overtimeByWeek(allLogs, range, payroll?payroll.otDays:[], weekStart)
      .reduce(function(a,w){ return a+Math.min(w.otMs/3600000, excludeHrs); },0);
  } else {
    exclH=Math.min(otRawH, excludeHrs);
  }
  var effOtH=otRawH-exclH;
  var effRate = isSalary ? (schedMins>0 ? salaryAmt/(schedMins/60) : 0) : baseRate;
  var flatX=+ot.flatExtra||0;
  var otHourPay = ot.kind==="flat" ? (isSalary ? flatX : baseRate+flatX) : effRate*otMult;
  var otPay = effOtH*otHourPay;
  var otPremium = ot.kind==="flat" ? effOtH*flatX : null;
  var weightedMs = roll.regMs + (exclH + effOtH*otMult)*3600000;
  var baseSet = isSalary ? salaryAmt>0 : baseRate>0;
  var grossPay = baseSet ? (isSalary ? salaryAmt+otPay : (regH+exclH)*baseRate+otPay) : null;
  var otTag = ot.kind==="flat" ? "(+"+fmtMoney(flatX)+"/hr)"
            : (isSalary && salaryAmt>0 ? "(x"+otMult+" @ "+fmtMoney(effRate)+"/hr eff.)" : "(x"+otMult+")");

  function payRow(label, value, col, bold){
    return React.createElement("div", { style:{display:"flex",justifyContent:"space-between",
        alignItems:"baseline",gap:"0.6rem",padding:"0.3rem 0"} },
      React.createElement("span", { style:{color:S.textDim,fontSize:"0.82rem",fontFamily:S.fontBody,minWidth:0} }, label),
      React.createElement(Mono, { style:{fontSize:bold?"0.95rem":"0.88rem",fontWeight:bold?700:600,
        color:col||S.text,flexShrink:0} }, value)
    );
  }
  var payCard = !isPay ? null : React.createElement("div", { style:{background:S.bg1,
      border:"1px solid "+S.border,borderRadius:S.radius,padding:"0.7rem 0.85rem",marginBottom:"0.85rem"} },
    isSalary
      ? payRow("Salary (per period)", salaryAmt>0?fmtMoney(salaryAmt):"not set", salaryAmt>0?S.text:S.textMuted)
      : payRow("Base rate", baseRate>0?fmtMoney(baseRate)+"/hr":"not set", baseRate>0?S.text:S.textMuted),
    payRow("Regular", fmtDur(roll.regMs,true)),
    excludeHrs>0 && payRow("OT excluded (first "+excludeHrs+"h"+(excludeUnit==="week"?" each week":"")+(isSalary?", no extra)":", base rate)"),
      fmtDur(exclH*3600000,true), exclH>0?S.textDim:S.textMuted),
    payRow("Overtime "+otTag, fmtDur(effOtH*3600000,true), effOtH>0?S.warnText:S.textMuted),
    ot.kind==="flat"
      ? payRow("OT premium", fmtMoney(otPremium), otPremium>0?S.successText:S.textMuted)
      : (isSalary
          ? (salaryAmt>0 && payRow("OT pay", fmtMoney(otPay), otPay>0?S.successText:S.textMuted))
          : payRow("Pay-weighted hours", fmtDur(weightedMs,true))),
    grossPay!=null && payRow("Gross pay", fmtMoney(grossPay), S.successText, true),
    !baseSet && React.createElement("div", { style:{marginTop:"0.35rem",fontSize:"0.72rem",
        color:S.textMuted,fontFamily:S.fontBody} },
      isSalary ? "Set your salary in Work Schedule > Pay & Work Week to see gross pay."
               : "Set your base rate in Work Schedule > Pay & Work Week to see gross pay."),
    !hasOtDays && React.createElement("div", { style:{marginTop:"0.35rem",fontSize:"0.72rem",
        color:S.textMuted,fontFamily:S.fontBody} },
      "No overtime days set - pick them in Work Schedule > Pay & Work Week."),
    React.createElement("div", { style:{marginTop:"0.45rem",paddingTop:"0.45rem",
        borderTop:"1px solid "+S.border,fontSize:"0.7rem",color:S.textMuted,fontFamily:S.fontBody} },
      "All pay figures are gross and do not include any state or federal deductions.")
  );

  function stat(label, value, col){
    return React.createElement("div", { style:{flex:"1 1 0",minWidth:"70px",background:S.bg1,
        border:"1px solid "+S.border,borderRadius:S.radius3,padding:"0.5rem 0.4rem",textAlign:"center"} },
      React.createElement("div", { style:{fontSize:"0.62rem",textTransform:"uppercase",letterSpacing:"0.07em",
        color:S.textMuted,fontFamily:S.fontBody,marginBottom:"0.15rem",whiteSpace:"nowrap"} }, label),
      React.createElement(Mono, { style:{fontSize:"0.82rem",fontWeight:600,color:col||S.text} }, value)
    );
  }
  var stats=React.createElement("div", { style:{display:"flex",gap:"0.4rem",flexWrap:"wrap",marginBottom:"1rem"} },
    stat("Clocked", roll.clockedMs>0?fmtDur(roll.clockedMs,true):"--"),
    stat("Breaks", roll.breakMs>0?fmtDur(roll.breakMs,true):"--", roll.breakMs>0?S.warnText:S.textMuted),
    stat("Disrupt", roll.distCount>0?(fmtDur(roll.distMs,true)+" x"+roll.distCount):"--", roll.distCount>0?S.dangerText:S.textMuted),
    stat("Days", String(roll.activeDays))
  );

  function projRow(ln, p){
    var key=ln.key+":"+p.id;
    var hasKids=p.children.length>0;
    var isOpen=!!open[key];
    return React.createElement("div", { key:key },
      React.createElement("button", { "data-flat":true,
        onClick:function(){ if(hasKids){ toggle(key); haptic(6); } },
        style:{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",
               padding:"0.4rem 0",cursor:hasKids?"pointer":"default",fontFamily:S.fontBody} },
        React.createElement("div", { style:{display:"flex",alignItems:"baseline",gap:"0.5rem"} },
          React.createElement("span", { style:{flex:1,minWidth:0,color:p.gone?S.textMuted:S.text,
            fontSize:"0.86rem",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"} },
            (hasKids?(isOpen?"\u2228 ":"\u203a "):"")+p.name),
          React.createElement(Mono, { style:{fontSize:"0.8rem",color:S.text,flexShrink:0} }, fmtDur(p.ms,true)),
          React.createElement("span", { style:{fontSize:"0.7rem",color:S.textMuted,width:"34px",
            textAlign:"right",flexShrink:0,fontFamily:S.fontMono} }, Math.round(share(p.ms))+"%")
        ),
        React.createElement("div", { style:{height:"4px",background:S.bg0,borderRadius:"999px",
          overflow:"hidden",marginTop:"0.25rem"} },
          React.createElement("div", { style:{height:"100%",width:share(p.ms)+"%",background:ln.accent,borderRadius:"999px"} })
        )
      ),
      isOpen && React.createElement("div", { style:{paddingLeft:"0.9rem",borderLeft:"1px solid "+S.border,
        marginLeft:"0.2rem",marginBottom:"0.3rem"} },
        p.children.map(function(c){
          return React.createElement("div", { key:c.id, style:{display:"flex",alignItems:"baseline",
            gap:"0.5rem",padding:"0.22rem 0"} },
            React.createElement("span", { style:{flex:1,minWidth:0,color:S.textDim,fontSize:"0.8rem",
              overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontFamily:S.fontBody} }, c.name),
            React.createElement(Mono, { style:{fontSize:"0.76rem",color:S.textDim,flexShrink:0} }, fmtDur(c.ms,true))
          );
        })
      )
    );
  }

  var body = roll.trackedMs<=0
    ? React.createElement("div", { style:{background:S.bg1,border:"1px solid "+S.border,borderRadius:S.radius,
        padding:"1.6rem 1rem",textAlign:"center",color:S.textDim,fontFamily:S.fontBody,fontSize:"0.85rem"} },
        "No time tracked in this "+PERIOD_LONG[kind]+".")
    : React.createElement("div", null,
        roll.lanes.map(function(ln){
          return React.createElement("div", { key:ln.key, style:{marginBottom:"1rem"} },
            React.createElement("div", { style:{display:"flex",alignItems:"center",gap:"0.5rem",
                paddingBottom:"0.35rem",borderBottom:"1px solid "+S.border,marginBottom:"0.25rem"} },
              React.createElement("div", { style:{width:"10px",height:"10px",borderRadius:"50%",
                background:ln.accent,flexShrink:0} }),
              React.createElement("span", { style:{flex:1,minWidth:0,color:S.text,fontWeight:700,
                fontSize:"0.72rem",textTransform:"uppercase",letterSpacing:"0.08em",
                overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontFamily:S.fontBody} }, ln.label),
              React.createElement(Mono, { style:{fontSize:"0.8rem",color:S.textDim,flexShrink:0} }, fmtDur(ln.ms,true))
            ),
            ln.projects.map(function(p){ return projRow(ln,p); })
          );
        })
      );

  // Module sections sit below the core rollup, above the copy button. Empty
  // list with no modules registered, so the modal is unchanged today.
  var modSections=ttReportSections(modReportCtx()).map(function(sec){
    return React.createElement("div", { key:sec.id, style:{marginTop:"0.9rem"} }, sec.el);
  });

  return React.createElement(Modal, { title:"Reports", onClose:props.onClose, wide:true, cancelLabel:"Close" },
    seg, nav, summary, payCard, stats, body, modSections,
    roll.trackedMs>0 && React.createElement("button", { "data-flat":true, onClick:copy,
      style:{width:"100%",marginTop:"0.4rem",background:copied?S.successBg2:S.bg1,
             border:"1px solid "+(copied?S.successBorder:S.border),borderRadius:S.radius,
             padding:"0.7rem",color:copied?S.successText:S.textDim,cursor:"pointer",
             fontFamily:S.fontBody,fontWeight:600,fontSize:"0.85rem"} },
      copied?"Copied!":"Copy report")
  );
}

// ---- SUB-TASK ROW -----------------------------------------------------------
function SubRow(props){
  var sub=props.sub, idx=props.idx, onEdit=props.onEdit, onStages=props.onStages, onStageToggle=props.onStageToggle;
  var onToggle=props.onToggle, editMode=props.editMode, onDragStart=props.onDragStart;
  var isActive=props.isActive, isInterrupted=props.isInterrupted;
  var todayMs=props.todayMs, distCount=props.distCount, todayDist=props.todayDist;

  var hintS=useState(false); var setHint=hintS[1]; var hint=hintS[0];
  var menuS=useState(false); var setMenu=menuS[1]; var menu=menuS[0];
  var distPopupS=useState(false); var setDistPopup=distPopupS[1]; var distPopup=distPopupS[0];
  var menuRef=useRef(null);
  var stagesMenuS=useState(false); var setStagesMenu=stagesMenuS[1]; var stagesMenu=stagesMenuS[0];
  var stagesRef=useRef(null);
  var taps=useTaps(
    function(){ if(!menu){ try{ window.dispatchEvent(new Event("ttCloseMenus")); }catch(e){} } setMenu(function(x){ return !x; }); },
    function(){ setMenu(false); setHint(false); onEdit(sub); }
  );
  var swipeX=useRef(null);
  var swiped=useRef(false);
  var rowCollapsedS=useState(function(){ var c=load("tt_cardcollapse",{}); return !!c[sub.id]; });
  var setRowCollapsed=rowCollapsedS[1]; var rowCollapsed=rowCollapsedS[0];
  function setRowCollapsedPersist(v){ setRowCollapsed(v); var c=load("tt_cardcollapse",{}); c[sub.id]=v; save("tt_cardcollapse",c); }

  useEffect(function(){
    if(!menu) return;
    function handler(e){ if(menuRef.current&&!menuRef.current.contains(e.target)) setMenu(false); }
    document.addEventListener("mousedown",handler);
    document.addEventListener("touchstart",handler);
    return function(){ document.removeEventListener("mousedown",handler); document.removeEventListener("touchstart",handler); };
  },[menu]);
  useEffect(function(){
    function closeAll(){ setMenu(false); setStagesMenu(false); }
    window.addEventListener("ttCloseMenus",closeAll);
    return function(){ window.removeEventListener("ttCloseMenus",closeAll); };
  },[]);
  useEffect(function(){
    if(!stagesMenu) return;
    function handler(e){ if(stagesRef.current&&!stagesRef.current.contains(e.target)) setStagesMenu(false); }
    document.addEventListener("mousedown",handler);
    document.addEventListener("touchstart",handler);
    return function(){ document.removeEventListener("mousedown",handler); document.removeEventListener("touchstart",handler); };
  },[stagesMenu]);

  var hasStages=sub.stages&&sub.stages.length>0;
  var stagesDone=hasStages?sub.stages.filter(function(s){ return s.done; }).length:0;
  var stagesPct=hasStages?Math.round((stagesDone/sub.stages.length)*100):0;
  var stagesAllDone=hasStages&&stagesDone===sub.stages.length;
  var ACCENT=props.accent||S.chromeSubTask;

  // Precompute styles
  var activeTint = S.fill==="solid" ? ACCENT+"55"
    : S.fill==="glass" ? ACCENT+"3D"
    : (S.mode==="light" ? ACCENT+"26" : S.runningTint);
  var rowBg = isActive ? (isInterrupted ? S.dangerBg2 : activeTint)
    : (S.fill==="solid" ? ACCENT+"2E" : S.fill==="glass" ? ACCENT+"1F" : S.bg1);
  var rowBdr = isInterrupted ? S.distEdge : ACCENT;
  var glow = (isActive && S.glow) ? ("0 0 8px "+(isInterrupted?S.distGlow:ACCENT)+"33") : "none";
  var barBg = isActive ? (isInterrupted ? S.distTrack : S.chromeTrackOn) : S.chromeTrack;
  // A running row is already tinted with its lane accent, so painting the title
  // in that same accent leaves it barely legible. Identity is carried by the
  // border and fill; the title stays high-contrast whatever the state.
  // The press affordance dims the title, but never below readable: textMuted
  // vanished against the glass card tint the moment it was touched.
  var titleCol = hint ? S.textDim : S.titleText;
  var startBg = isActive ? (isInterrupted ? S.dangerBg2 : activeTint) : S.bg1;
  var startBdr = isActive ? (isInterrupted ? S.distStartBdr : ACCENT) : S.chromeBdr;
  var startIconCol = isActive ? (isInterrupted ? S.distIcon : ACCENT) : S.chromeIcon;
  var startLbl = isActive ? (isInterrupted ? "Paused" : "Stop") : "Start";
  var timCol = isActive ? (isInterrupted ? S.distDim : ACCENT) : S.chromeTime;

  if(rowCollapsed){
    return (
      React.createElement("div", {
        onMouseDown:function(e){ swipeX.current=e.clientX; },
        onMouseUp:function(e){ if(swipeX.current!==null){ var dx=e.clientX-swipeX.current; if(dx>50){ haptic(8); setRowCollapsedPersist(false); } } swipeX.current=null; },
        onTouchStart:function(e){ if(e.touches&&e.touches.length) swipeX.current=e.touches[0].clientX; },
        onTouchEnd:function(e){ if(swipeX.current!==null&&e.changedTouches&&e.changedTouches.length){ var dx=e.changedTouches[0].clientX-swipeX.current; if(dx>50){ haptic(8); setRowCollapsedPersist(false); } } swipeX.current=null; },
        style:{height:"20px",border:"2.5px solid "+rowBdr,borderRadius:"999px",background:rowBg,cursor:"grab",opacity:0.9,marginBottom:"0.35rem",display:"flex",alignItems:"center",justifyContent:"center",gap:"0.5rem",overflow:"hidden",boxShadow:glow,touchAction:"pan-y",WebkitUserSelect:"none",userSelect:"none"} },
        React.createElement("span", { style:{fontSize:"0.68rem",fontWeight:700,color:ACCENT,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",fontFamily:S.fontBody} }, sub.name),
        (isActive||todayMs>0) && React.createElement(Mono, { style:{fontSize:"0.66rem",color:timCol,fontWeight:700,whiteSpace:"nowrap"} }, fmtDur(todayMs,true))
      )
    );
  }

  return (
    React.createElement("div", { "data-draggable":true, "data-surface":"panel", "data-menu-open":(menu||stagesMenu)?"1":undefined, style:{background:rowBg,border:"2.5px solid "+rowBdr,borderRadius:"10px",marginBottom:"0.35rem",position:"relative",zIndex:(menu||stagesMenu)?80:"auto",boxShadow:glow,transition:"all 0.15s"} },
      React.createElement("div", { style:{display:"flex",alignItems:"center",gap:"0.45rem",padding:"0.55rem 0.7rem 0.3rem"} },
        editMode&&React.createElement("span", { onMouseDown:function(e){ onDragStart(e,idx); }, onTouchStart:function(e){ onDragStart(e,idx); }, style:{cursor:"grab",color:S.dragGlyph,fontSize:"0.95rem",userSelect:"none",touchAction:"none",flexShrink:0} }, "\u283f"),
        React.createElement("div", { style:{width:"3px",alignSelf:"stretch",background:barBg,borderRadius:"2px",flexShrink:0,minHeight:"22px"} }),
        React.createElement("div", { style:{flex:1,minWidth:0,cursor:"pointer",WebkitUserSelect:"none",userSelect:"none",touchAction:"pan-y",position:"relative"},
          onMouseDown:function(e){ swipeX.current=e.clientX; swiped.current=false; },
          onMouseUp:function(e){
            if(swipeX.current!==null){ var dx=e.clientX-swipeX.current; if(Math.abs(dx)>50){ swiped.current=true; haptic(8); setRowCollapsedPersist(dx<0); } }
            swipeX.current=null;
          },
          onMouseLeave:function(){ setHint(false); },
          onTouchStart:function(e){ if(e.touches&&e.touches.length) swipeX.current=e.touches[0].clientX; swiped.current=false; },
          onTouchEnd:function(e){
            if(swipeX.current!==null&&e.changedTouches&&e.changedTouches.length){ var dx=e.changedTouches[0].clientX-swipeX.current; if(Math.abs(dx)>50){ swiped.current=true; haptic(8); setRowCollapsedPersist(dx<0); } }
            swipeX.current=null;
          },
          onClick:function(e){ if(swiped.current){ swiped.current=false; return; } taps(); },
          onMouseEnter:function(){ setHint(true); } },
          React.createElement("div", { style:{fontWeight:600,fontSize:"0.92rem",color:titleCol,lineHeight:1.25,wordBreak:"break-word"} }, sub.name),
          hint && React.createElement("div", { style:{fontSize:"0.66rem",color:S.titleText,marginTop:"0.1rem"} }, "tap: menu / double-tap: edit"),
          menu && React.createElement("div", { ref:menuAutoScroll, "data-surface":"menu", style:{position:"absolute",top:"calc(100% + 4px)",left:UI.left?"auto":0,right:UI.left?0:"auto",background:S.menuBg,border:"1px solid "+S.border,borderRadius:S.radius,minWidth:"160px",boxShadow:"0 8px 32px rgba(0,0,0,0.6)",zIndex:70,overflow:"hidden"} },
            React.createElement("button", { "data-flat":true, onClick:function(){ onEdit(sub); setMenu(false); }, style:{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.6rem 0.9rem",color:S.text,cursor:"pointer",fontFamily:S.fontBody,fontSize:"0.88rem"} }, "Edit Task"),
            React.createElement("button", { "data-flat":true, onClick:function(){ onStages(sub); setMenu(false); }, style:{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",padding:"0.6rem 0.9rem",color:S.text,cursor:"pointer",fontFamily:S.fontBody,fontSize:"0.88rem"} }, hasStages?"View Stages":"Add Stages")
          )
        ),
        // Start/Stop
        React.createElement("button", { onClick:function(){ onToggle(sub.id); },
          style:{display:"flex",alignItems:"center",justifyContent:"center",gap:"0.3rem",background:startBg,border:"2px solid "+startBdr,borderRadius:"8px",cursor:"pointer",padding:"0.28rem 0.55rem",minHeight:"32px",flexShrink:0,transition:"all 0.15s"} },
          isInterrupted
            ? React.createElement("svg", { width:14,height:14,viewBox:"0 0 18 18",fill:"none" },
                React.createElement("rect", { x:"3",y:"3",width:"4",height:"12",rx:"1",fill:S.distIcon }),
                React.createElement("rect", { x:"11",y:"3",width:"4",height:"12",rx:"1",fill:S.distIcon })
              )
            : isActive
              ? React.createElement("svg", { width:14,height:14,viewBox:"0 0 18 18",fill:"none" },
                  React.createElement("rect", { x:"3",y:"3",width:"12",height:"12",rx:"1.5",fill:ACCENT })
                )
              : React.createElement("svg", { width:14,height:14,viewBox:"0 0 18 18",fill:"none" },
                  React.createElement("path", { d:"M4 3 L15 9 L4 15 Z", fill:S.chromeIcon })
                ),
          React.createElement("span", { style:{fontSize:"0.73rem",fontWeight:700,color:startIconCol,fontFamily:S.fontBody,lineHeight:1} }, startLbl)
        )
      ),
      // Row 2: meta
      React.createElement("div", { style:{display:"flex",alignItems:"center",gap:"0.45rem",padding:"0 0.7rem 0.5rem 2.2rem",flexWrap:"wrap"} },
        sub.notes && !hint && React.createElement("span", { style:{fontSize:"0.76rem",color:S.textDim} }, sub.notes),
        todayMs>0 && React.createElement(Mono, { style:{fontSize:"0.76rem",color:timCol,fontWeight:700} }, fmtDur(todayMs,true)),
        distCount>0 && React.createElement("button", { onClick:function(){ try{ window.dispatchEvent(new Event("ttCloseMenus")); }catch(e){} setDistPopup(true); },
          style:{display:"flex",alignItems:"center",justifyContent:"center",gap:"0.25rem",background:S.dangerTint,border:"2px solid #CC3030",borderRadius:"8px",cursor:"pointer",padding:"0 0.55rem",height:"30px",minHeight:"30px",flexShrink:0} },
          React.createElement("span", { style:{fontSize:"0.88rem",fontWeight:900,color:S.distBadge,letterSpacing:"-0.05em",lineHeight:1} }, "!!"),
          React.createElement("span", { style:{fontSize:"0.76rem",color:S.distBadge,fontFamily:S.fontMono,fontWeight:700} }, distCount)
        ),
        hasStages && React.createElement("div", { ref:stagesRef, style:{position:"relative",flex:1,minWidth:"90px"} },
        React.createElement("button", { onClick:function(){ if(!stagesMenu){ try{ window.dispatchEvent(new Event("ttCloseMenus")); }catch(e){} } setStagesMenu(function(x){ return !x; }); },
          style:{display:"flex",alignItems:"center",justifyContent:"center",gap:"0.35rem",background:stagesAllDone?S.successBg:S.bg1,border:"2px solid "+(stagesAllDone?S.stageDoneBdr:S.chromeBdr),borderRadius:"8px",cursor:"pointer",padding:"0 0.55rem",height:"30px",minHeight:"30px",width:"100%"} },
          React.createElement("span", { style:{fontSize:"0.76rem",color:stagesAllDone?S.successText:S.chromeSubTask,fontWeight:700,whiteSpace:"nowrap"} }, stagesDone+"/"+sub.stages.length+" Stages"),
          React.createElement("div", { style:{flex:1,height:"3px",background:S.bg0,borderRadius:"2px",overflow:"hidden",minWidth:"24px"} },
            React.createElement("div", { style:{height:"100%",width:stagesPct+"%",background:stagesAllDone?S.successText:S.chromeSubTask,borderRadius:"2px",transition:"width 0.3s"} })
          ),
          React.createElement(Mono, { style:{fontSize:"0.68rem",color:stagesAllDone?S.successText:S.chromeSubTask,fontWeight:700,whiteSpace:"nowrap"} }, stagesPct+"%")
        ),
        stagesMenu && React.createElement("div", { ref:menuAutoScroll, "data-surface":"menu", style:{position:"absolute",top:"calc(100% + 4px)",right:0,minWidth:"210px",background:S.menuBg,border:"1px solid "+S.border,borderRadius:S.radius,boxShadow:"0 8px 32px rgba(0,0,0,0.6)",zIndex:70,overflow:"hidden"} },
          stageMenuRows(sub.stages, function(id){ onStageToggle(sub.id,id); }, function(){ setStagesMenu(false); onStages(sub); })
        )
        ),
        distPopup && React.createElement(DisruptionPopup, { disruptions:(todayDist||[]).filter(function(d){ return d.projectId===sub.id; }), projName:sub.name, onClose:function(){ setDistPopup(false); } })
      )
    )
  );
}

// ---- PROJECT CARD -----------------------------------------------------------
function ProjectCard(props){
  var proj=props.proj, isActive=props.isActive, interrupting=props.interrupting;
  var todayMs=props.todayMs, distCount=props.distCount, projDisruptions=props.projDisruptions;
  var onToggle=props.onToggle, onEdit=props.onEdit, onStages=props.onStages, onStageToggle=props.onStageToggle;
  var onAddSub=props.onAddSub, editMode=props.editMode, dragHandleProps=props.dragHandleProps;
  var subTasks=props.subTasks||[], activeId=props.activeId;
  var todayLogs=props.todayLogs, todayDist=props.todayDist, allProjects=props.allProjects;
  var laneMeta=props.laneMeta, elapsed=props.elapsed;

  var expandedS=useState(true); var setExpanded=expandedS[1]; var expanded=expandedS[0];
  var hintS=useState(false); var setHint=hintS[1]; var hint=hintS[0];
  var menuS=useState(false); var setMenu=menuS[1]; var menu=menuS[0];
  var distPopupS=useState(false); var setDistPopup=distPopupS[1]; var distPopup=distPopupS[0];
  var menuRef=useRef(null);
  var stagesMenuS=useState(false); var setStagesMenu=stagesMenuS[1]; var stagesMenu=stagesMenuS[0];
  var stagesRef=useRef(null);
  var taps=useTaps(
    function(){ if(!menu){ try{ window.dispatchEvent(new Event("ttCloseMenus")); }catch(e){} } setMenu(function(x){ return !x; }); },
    function(){ setMenu(false); setHint(false); onEdit(proj); }
  );
  var swipeX=useRef(null);
  var swiped=useRef(false);
  var cardCollapsedS=useState(function(){ var c=load("tt_cardcollapse",{}); return !!c[proj.id]; });
  var setCardCollapsed=cardCollapsedS[1]; var cardCollapsed=cardCollapsedS[0];
  function setCardCollapsedPersist(v){ setCardCollapsed(v); var c=load("tt_cardcollapse",{}); c[proj.id]=v; save("tt_cardcollapse",c); }

  useEffect(function(){
    if(!menu) return;
    function handler(e){ if(menuRef.current&&!menuRef.current.contains(e.target)) setMenu(false); }
    document.addEventListener("mousedown",handler);
    document.addEventListener("touchstart",handler);
    return function(){ document.removeEventListener("mousedown",handler); document.removeEventListener("touchstart",handler); };
  },[menu]);
  useEffect(function(){
    function closeAll(){ setMenu(false); setStagesMenu(false); }
    window.addEventListener("ttCloseMenus",closeAll);
    return function(){ window.removeEventListener("ttCloseMenus",closeAll); };
  },[]);
  useEffect(function(){
    if(!stagesMenu) return;
    function handler(e){ if(stagesRef.current&&!stagesRef.current.contains(e.target)) setStagesMenu(false); }
    document.addEventListener("mousedown",handler);
    document.addEventListener("touchstart",handler);
    return function(){ document.removeEventListener("mousedown",handler); document.removeEventListener("touchstart",handler); };
  },[stagesMenu]);

  var meta=getMeta(laneMeta,proj.lane);
  var isInterrupted=isActive&&interrupting;
  var hasStages=proj.stages&&proj.stages.length>0;
  var stagesDone=hasStages?proj.stages.filter(function(s){ return s.done; }).length:0;
  var stagesPct=hasStages?Math.round((stagesDone/proj.stages.length)*100):0;
  var stagesAllDone=hasStages&&stagesDone===proj.stages.length;
  var descendantIds=getDescendantIds(allProjects,proj.id);
  var subActive=descendantIds.indexOf(activeId)>=0?allProjects.find(function(p){ return p.id===activeId; }):null;

  // Precompute all styles
  var laneTint = S.fill==="solid" ? meta.dim
    : S.fill==="glass" ? meta.accent+"33"
    : (S.mode==="light" ? meta.accent+"22" : meta.bg);
  var cardIdle = S.fill==="solid" ? meta.bg
    : S.fill==="glass" ? (S.mode==="light" ? "rgba(255,255,255,0.46)" : "rgba(255,255,255,0.07)")
    : S.bg1;
  var cardBg = isActive ? (isInterrupted ? S.dangerBg2 : laneTint) : (subActive ? laneTint : cardIdle);
  var cardBdr = isInterrupted ? S.distEdge : meta.accent;
  var cardGlow = (isActive && S.glow) ? ("0 0 14px "+(isInterrupted?S.distGlow:meta.accent)+"22") : "none";
  var startBg = isActive ? (isInterrupted ? S.dangerBg2 : laneTint) : S.bg1;
  var startBdr = isActive ? (isInterrupted ? S.distStartBdr : meta.accent) : S.chromeBdr;
  var startGlow = (isActive && S.glow) ? ("0 0 10px "+(isInterrupted?S.distGlow:meta.accent)+"44") : "none";
  var startIconCol = isActive ? (isInterrupted ? S.distIcon : meta.accent) : S.chromeIcon;
  var startLblCol = isActive ? (isInterrupted ? S.distLbl : meta.accent) : S.chromeText;
  var startLbl = isActive ? (isInterrupted ? "Paused" : "Stop") : "Start";
  var timCol = isActive ? (isInterrupted ? S.distDim : meta.accent) : S.chromeTime;
  // The press affordance dims the title, but never below readable: textMuted
  // vanished against the glass card tint the moment it was touched.
  var titleCol = hint ? S.textDim : S.titleText;
  var stageBdr = stagesAllDone ? S.stageDoneBdr : meta.accent;
  var stageCol = stagesAllDone ? S.stageDoneText : meta.accent;

  if(cardCollapsed){
    // The pill keeps live control: a bare icon+text (no button chrome, per the
    // space budget) mirroring the big card's three start states. When a
    // sub-task is the running timer, the control targets it - tapping Stop on
    // the collapsed parent must never start the parent over the top of it.
    var liveActive = isActive || !!subActive;
    var liveInterrupted = liveActive && interrupting;
    var pillLblCol  = liveActive ? (liveInterrupted ? S.distLbl : meta.accent) : S.chromeText;
    var pillLbl = liveInterrupted ? "Paused" : (liveActive ? "Stop" : "Start");
    var pillTarget = isActive ? proj.id : (subActive ? subActive.id : proj.id);
    var pillPulse = liveActive && !liveInterrupted;
    return (
      React.createElement("div", { "data-draggable":true, style:{marginBottom:"0.45rem"} },
        React.createElement("div", {
          "data-pulse": pillPulse ? "1" : undefined,
          onMouseDown:function(e){ swipeX.current=e.clientX; },
          onMouseUp:function(e){ if(swipeX.current!==null){ var dx=e.clientX-swipeX.current; if(dx>50){ haptic(8); setCardCollapsedPersist(false); } } swipeX.current=null; },
          onTouchStart:function(e){ if(e.touches&&e.touches.length) swipeX.current=e.touches[0].clientX; },
          onTouchEnd:function(e){ if(swipeX.current!==null&&e.changedTouches&&e.changedTouches.length){ var dx=e.changedTouches[0].clientX-swipeX.current; if(dx>50){ haptic(8); setCardCollapsedPersist(false); } } swipeX.current=null; },
          style:Object.assign({height:"24px",border:"2.5px solid "+cardBdr,borderRadius:"999px",background:cardBg,cursor:"grab",opacity:0.92,display:"flex",alignItems:"center",gap:"0.6rem",overflow:"hidden",padding:"0 0.35rem 0 0.75rem",boxShadow:cardGlow,touchAction:"pan-y",WebkitUserSelect:"none",userSelect:"none"}, pulseVars(cardBdr)) },
          // Title anchored left, control anchored right - the pill's Stop
          // lands on the same edge as every expanded card's Start button.
          React.createElement("span", { style:{flex:"1 1 auto",textAlign:"left",fontSize:"0.74rem",fontWeight:700,color:meta.accent,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",minWidth:0,fontFamily:S.fontBody} }, proj.name),
          subTasks.length>0 && React.createElement("span", { style:{fontSize:"0.66rem",color:meta.accent,opacity:0.7,whiteSpace:"nowrap",fontFamily:S.fontBody} }, subTasks.length+" tasks"),
          (liveActive||todayMs>0) && React.createElement(Mono, { style:{fontSize:"0.7rem",color:timCol,fontWeight:700,whiteSpace:"nowrap"} }, fmtDur(todayMs,true)),
          React.createElement("span", { "data-pillctl":true, role:"button", "aria-label":pillLbl,
            onClick:function(e){ e.stopPropagation(); haptic(10); onToggle(pillTarget); },
            onMouseDown:function(e){ e.stopPropagation(); },
            onTouchStart:function(e){ e.stopPropagation(); },
            style:{display:"flex",alignItems:"center",gap:"0.28rem",flexShrink:0,cursor:"pointer",alignSelf:"stretch",padding:"0 0.2rem"} },
            liveInterrupted
              ? React.createElement("svg", { width:11,height:11,viewBox:"0 0 22 22",fill:"none" },
                  React.createElement("rect", { x:"4",y:"4",width:"5",height:"14",rx:"1.5",fill:S.distIcon }),
                  React.createElement("rect", { x:"13",y:"4",width:"5",height:"14",rx:"1.5",fill:S.distIcon })
                )
              : liveActive
                ? React.createElement("svg", { width:11,height:11,viewBox:"0 0 22 22",fill:"none" },
                    React.createElement("rect", { x:"3",y:"3",width:"16",height:"16",rx:"2",fill:meta.accent })
                  )
                : React.createElement("svg", { width:11,height:11,viewBox:"0 0 22 22",fill:"none" },
                    React.createElement("path", { d:"M6 4 L18 11 L6 18 Z", fill:S.chromeIcon })
                  ),
            React.createElement("span", { style:{fontSize:"0.68rem",fontWeight:700,color:pillLblCol,fontFamily:S.fontBody,lineHeight:1,whiteSpace:"nowrap"} }, pillLbl)
          )
        )
      )
    );
  }

  return (
    React.createElement("div", { "data-draggable":true, style:{marginBottom:"0.45rem"} },
      // A themed card is its own stacking context (backdrop-filter or texture),
      // so a menu inside it cannot outrank a later sibling card. Lift the whole
      // card for as long as its menu is open.
      React.createElement("div", { "data-surface":"panel", "data-menu-open":(menu||stagesMenu)?"1":undefined,
        "data-pulse": ((isActive||!!subActive)&&!interrupting) ? "1" : undefined,
        style:Object.assign({background:cardBg,border:"3px solid "+cardBdr,borderRadius:S.radius2,overflow:"visible",position:"relative",zIndex:(menu||stagesMenu)?80:"auto",transition:"all 0.15s",boxShadow:cardGlow}, pulseVars(cardBdr)) },
        // Row 1: drag + title + gear + start
        React.createElement("div", { ref:menuRef, style:{display:"flex",alignItems:"center",gap:"0.5rem",padding:"0.75rem 0.75rem 0.4rem 1rem"} },
          editMode && React.createElement("span", { onMouseDown:dragHandleProps.onMouseDown, onTouchStart:dragHandleProps.onTouchStart, style:{cursor:"grab",color:S.mutedGlyph,fontSize:"1.3rem",userSelect:"none",touchAction:"none",flexShrink:0} }, "\u283f"),
          // Title
          React.createElement("div", { style:{flex:1,minWidth:0,cursor:"pointer",WebkitUserSelect:"none",userSelect:"none",touchAction:"pan-y",position:"relative"},
            onMouseDown:function(e){ swipeX.current=e.clientX; swiped.current=false; },
            onMouseUp:function(e){
              if(swipeX.current!==null){ var dx=e.clientX-swipeX.current; if(Math.abs(dx)>50){ swiped.current=true; haptic(8); setCardCollapsedPersist(dx<0); } }
              swipeX.current=null;
            },
            onTouchStart:function(e){ if(e.touches&&e.touches.length) swipeX.current=e.touches[0].clientX; swiped.current=false; },
            onTouchEnd:function(e){
              if(swipeX.current!==null&&e.changedTouches&&e.changedTouches.length){ var dx=e.changedTouches[0].clientX-swipeX.current; if(Math.abs(dx)>50){ swiped.current=true; haptic(8); setCardCollapsedPersist(dx<0); } }
              swipeX.current=null;
            },
            onClick:function(e){ if(swiped.current){ swiped.current=false; return; } taps(); },
            onMouseEnter:function(){ setHint(true); }, onMouseLeave:function(){ setHint(false); } },
            React.createElement("div", { style:{fontWeight:700,fontSize:"1.05rem",color:titleCol,lineHeight:1.25,wordBreak:"break-word"} }, proj.name),
            hint && React.createElement("div", { style:{fontSize:"0.7rem",color:S.titleText,marginTop:"0.12rem"} }, "tap: menu / double-tap: edit"),
            menu && React.createElement("div", {
              ref:menuAutoScroll,
              "data-surface":"menu",
              style:{position:"absolute",top:"calc(100% + 4px)",left:UI.left?"auto":0,right:UI.left?0:"auto",background:S.menuBg,border:"1px solid "+S.border,borderRadius:S.radius,minWidth:"190px",boxShadow:"0 8px 32px rgba(0,0,0,0.6)",zIndex:70,overflow:"hidden"} },
              subTasks.length>0 && React.createElement("button", { "data-flat":true, onClick:function(){ setExpanded(function(x){ return !x; }); setMenu(false); }, style:{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.65rem 1rem",color:S.text,cursor:"pointer",fontFamily:S.fontBody,fontSize:"0.9rem"} }, expanded?"Collapse Tasks":"Expand Tasks"),
              React.createElement("button", { "data-flat":true, onClick:function(){ onEdit(proj); setMenu(false); }, style:{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.65rem 1rem",color:S.text,cursor:"pointer",fontFamily:S.fontBody,fontSize:"0.9rem"} }, "Edit Project"),
              // Lane identity rides on a dot: raw accents are border colours, and most of
              // them fail as text on the menu surface.
              React.createElement("button", { "data-flat":true, onClick:function(){ onAddSub(proj.id); setMenu(false); }, style:{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.65rem 1rem",color:S.text,cursor:"pointer",fontFamily:S.fontBody,fontSize:"0.9rem"} },
                React.createElement("span", { style:{display:"inline-block",width:"8px",height:"8px",borderRadius:"50%",background:meta.accent,marginRight:"0.55rem"} }),
                "Add Task"),
              React.createElement("button", { "data-flat":true, onClick:function(){ onStages(proj); setMenu(false); }, style:{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",padding:"0.65rem 1rem",color:S.text,cursor:"pointer",fontFamily:S.fontBody,fontSize:"0.9rem"} }, hasStages?"View Stages":"Add Stages")
            )
          ),
          // Start/Stop button
          React.createElement("button", { onClick:function(){ onToggle(proj.id); },
            style:{display:"flex",alignItems:"center",justifyContent:"center",gap:"0.38rem",background:startBg,border:"2px solid "+startBdr,borderRadius:S.radius,cursor:"pointer",padding:"0.38rem 0.65rem",minHeight:"44px",flexShrink:0,transition:"all 0.15s",boxShadow:startGlow} },
            isInterrupted
              ? React.createElement("svg", { width:18,height:18,viewBox:"0 0 22 22",fill:"none" },
                  React.createElement("rect", { x:"4",y:"4",width:"5",height:"14",rx:"1.5",fill:S.distIcon }),
                  React.createElement("rect", { x:"13",y:"4",width:"5",height:"14",rx:"1.5",fill:S.distIcon })
                )
              : isActive
                ? React.createElement("svg", { width:18,height:18,viewBox:"0 0 22 22",fill:"none" },
                    React.createElement("rect", { x:"3",y:"3",width:"16",height:"16",rx:"2",fill:meta.accent })
                  )
                : React.createElement("svg", { width:18,height:18,viewBox:"0 0 22 22",fill:"none" },
                    React.createElement("path", { d:"M6 4 L18 11 L6 18 Z", fill:S.chromeIcon })
                  ),
            React.createElement("span", { style:{fontSize:"0.82rem",fontWeight:700,color:startLblCol,fontFamily:S.fontBody,lineHeight:1} }, startLbl)
          )
        ),
        // Row 2: notes + meta + stages
        React.createElement("div", { style:{display:"flex",alignItems:"center",gap:"0.5rem",padding:"0 1rem 0.75rem",flexWrap:"wrap"} },
          proj.notes && React.createElement("span", { style:{fontSize:"0.82rem",color:S.textDim} }, proj.notes),
          subActive&&!isActive && React.createElement("span", { style:{fontSize:"0.76rem",color:meta.accent,fontWeight:600} }, "> "+subActive.name),
          subTasks.length>0 && React.createElement("button", { onClick:function(){ setExpanded(function(x){ return !x; }); },
            style:{display:"flex",alignItems:"center",justifyContent:"center",gap:"0.3rem",background:S.bg0,border:"2px solid "+S.chromeBdr,borderRadius:"8px",cursor:"pointer",padding:"0 0.55rem",height:"30px",minHeight:"30px",flexShrink:0} },
            React.createElement("span", { style:{fontSize:"0.76rem",color:S.chromeText,fontWeight:700} }, (expanded?"v ":"+ ")+subTasks.length+" task"+(subTasks.length!==1?"s":""))
          ),
          todayMs>0 && React.createElement(Mono, { style:{fontSize:"0.82rem",color:timCol,fontWeight:700} }, fmtDur(todayMs,true)),
          distCount>0 && React.createElement("button", { onClick:function(){ try{ window.dispatchEvent(new Event("ttCloseMenus")); }catch(e){} setDistPopup(true); },
            style:{display:"flex",alignItems:"center",justifyContent:"center",gap:"0.3rem",background:S.dangerTint,border:"2px solid #CC3030",borderRadius:"8px",cursor:"pointer",padding:"0 0.55rem",height:"30px",minHeight:"30px",flexShrink:0} },
            React.createElement("span", { style:{fontSize:"0.88rem",fontWeight:900,color:S.distBadge,letterSpacing:"-0.05em",lineHeight:1} }, "!!"),
            React.createElement("span", { style:{fontSize:"0.76rem",color:S.distBadge,fontFamily:S.fontMono,fontWeight:700} }, distCount)
          ),
          hasStages && React.createElement("div", { ref:stagesRef, style:{position:"relative",flex:1,minWidth:"110px"} },
          React.createElement("button", { onClick:function(){ if(!stagesMenu){ try{ window.dispatchEvent(new Event("ttCloseMenus")); }catch(e){} } setStagesMenu(function(x){ return !x; }); },
            style:{display:"flex",alignItems:"center",justifyContent:"center",gap:"0.38rem",background:stagesAllDone?S.successBg:S.bg1,border:"2px solid "+stageBdr,borderRadius:"8px",cursor:"pointer",padding:"0 0.55rem",height:"30px",minHeight:"30px",width:"100%"} },
            React.createElement("span", { style:{fontSize:"0.76rem",color:stageCol,fontWeight:700,whiteSpace:"nowrap"} }, stagesDone+"/"+proj.stages.length+" Stages"),
            React.createElement("div", { style:{flex:1,height:"4px",background:S.bg0,borderRadius:"2px",overflow:"hidden",minWidth:"28px"} },
              React.createElement("div", { style:{height:"100%",width:stagesPct+"%",background:stageCol,borderRadius:"2px",transition:"width 0.4s"} })
            ),
            React.createElement(Mono, { style:{fontSize:"0.72rem",color:stageCol,fontWeight:700,whiteSpace:"nowrap"} }, stagesPct+"%")
          ),
          stagesMenu && React.createElement("div", { ref:menuAutoScroll, "data-surface":"menu", style:{position:"absolute",top:"calc(100% + 4px)",right:0,minWidth:"210px",background:S.menuBg,border:"1px solid "+S.border,borderRadius:S.radius,boxShadow:"0 8px 32px rgba(0,0,0,0.6)",zIndex:70,overflow:"hidden"} },
            stageMenuRows(proj.stages, function(id){ onStageToggle(proj.id,id); }, function(){ setStagesMenu(false); onStages(proj); })
          )
          )
        ),
        // Sub-tasks INSIDE the parent border
        expanded && subTasks.length>0 && React.createElement("div", { style:{padding:"0.15rem 0.6rem 0.6rem 1.4rem",borderTop:"1px solid "+meta.dim,marginTop:"0.1rem",paddingTop:"0.55rem"} },
          subTasks.sort(function(a,b){ return (a.order||0)-(b.order||0); }).map(function(sub,idx){
            var subIsActive=activeId===sub.id;
            var subTodayMs=todayLogs.filter(function(l){ return l.projectId===sub.id; }).reduce(function(a,l){ return a+l.duration; },0)+(subIsActive?elapsed:0);
            var subDistCount=todayDist.filter(function(d){ return d.projectId===sub.id; }).length;
            return React.createElement(SubRow, {
              key:sub.id, sub:sub, idx:idx,
              onEdit:onEdit, onStages:onStages, onStageToggle:onStageToggle, onToggle:onToggle,
              editMode:editMode, onDragStart:function(e,i){ /* drag placeholder */ },
              isActive:subIsActive, isInterrupted:subIsActive&&interrupting,
              elapsed:elapsed, todayMs:subTodayMs, distCount:subDistCount, todayDist:todayDist,
              accent:meta.accent
            });
          })
        )
      ),
      distPopup && React.createElement(DisruptionPopup, { disruptions:projDisruptions||[], projName:proj.name, onClose:function(){ setDistPopup(false); } })
    )
  );
}

// ---- LANE SECTION -----------------------------------------------------------
function LaneSection(props){
  var lane=props.lane, allProjects=props.allProjects, activeId=props.activeId;
  var interrupting=props.interrupting, elapsed=props.elapsed;
  var todayLogs=props.todayLogs, todayDist=props.todayDist;
  var onToggle=props.onToggle, onEdit=props.onEdit, onStages=props.onStages, onStageToggle=props.onStageToggle;
  var editMode=props.editMode, laneHandle=props.laneHandle;
  var laneMeta=props.laneMeta, onDeleteLane=props.onDeleteLane;

  var meta=getMeta(laneMeta,lane);
  var isBuiltin=DEFAULT_ORDER.indexOf(lane)>=0;
  var laneTaps=useTaps(
    function(){ if(!addOpen){ try{ window.dispatchEvent(new Event("ttCloseMenus")); }catch(e){} } setAddOpen(function(x){ return !x; }); },
    function(){ setAddOpen(false); props.onEditLanes(); }
  );
  var addOpenS=useState(false); var setAddOpen=addOpenS[1]; var addOpen=addOpenS[0];
  var removeArmS=useState(false); var setRemoveArm=removeArmS[1]; var removeArm=removeArmS[0];
  var addRef=useRef(null);
  var collapsedS=useState(function(){ var c=load("tt_lanecollapse",{}); return !!c[lane]; });
  var setCollapsed=collapsedS[1]; var collapsed=collapsedS[0];
  function setCollapsedPersist(v){
    setCollapsed(v);
    var c=load("tt_lanecollapse",{}); c[lane]=v; save("tt_lanecollapse",c);
  }
  var swipeX=useRef(null);
  var swiped=useRef(false);
  useEffect(function(){
    if(!addOpen) return;
    function h(e){ if(addRef.current&&!addRef.current.contains(e.target)) setAddOpen(false); }
    document.addEventListener("mousedown",h); document.addEventListener("touchstart",h);
    return function(){ document.removeEventListener("mousedown",h); document.removeEventListener("touchstart",h); };
  },[addOpen]);
  useEffect(function(){
    function closeAll(){ setAddOpen(false); setRemoveArm(false); }
    window.addEventListener("ttCloseMenus",closeAll);
    return function(){ window.removeEventListener("ttCloseMenus",closeAll); };
  },[]);
  // Never leave Remove armed across an Arrange session - otherwise the next
  // single tap on re-entering Arrange would delete the lane outright.
  useEffect(function(){ if(!editMode) setRemoveArm(false); },[editMode]);
  var laneOrder=props.laneOrder||DEFAULT_ORDER;
  var laneOvalBg = S.fill==="solid" ? meta.accent
    : S.fill==="glass" ? meta.accent+"55"
    : (S.mode==="light" ? meta.accent+"22" : meta.bg);
  var topLevel=allProjects.filter(function(p){ return p.lane===lane&&p.parentId===null; }).sort(function(a,b){ return (a.order||0)-(b.order||0); });
  // The running project (or sub-task) inside this lane, for the collapsed
  // oval: it names the timer and drives the border pulse.
  var laneActiveProj = activeId!=null ? allProjects.find(function(p){ return p.id===activeId && p.lane===lane; }) : null;
  var lanePulse = !!laneActiveProj && !interrupting;

  return (
    React.createElement("div", { "data-surface":"lane", style:{marginBottom:"1.25rem",position:"relative",zIndex:addOpen?90:"auto"} },
      React.createElement("div", { ref:addRef, style:{position:"relative",fontSize:"1.05rem",textTransform:"uppercase",letterSpacing:"0.1em",color:meta.accent,fontWeight:700,marginBottom:"0.6rem",display:"flex",alignItems:"center",gap:"0.5rem"} },
        editMode && React.createElement("span", { onMouseDown:laneHandle.onMouseDown, onTouchStart:laneHandle.onTouchStart, style:{cursor:"grab",color:S.dragGlyph,fontSize:"1.3rem",userSelect:"none",touchAction:"none"} }, "\u283f"),
        React.createElement("span", {
          style:{flex:1,cursor:"pointer",WebkitUserSelect:"none",userSelect:"none",touchAction:"pan-y"},
          onMouseDown:function(e){ swipeX.current=e.clientX; swiped.current=false; },
          onMouseUp:function(e){
            if(swipeX.current!==null){ var dx=e.clientX-swipeX.current; if(Math.abs(dx)>50){ swiped.current=true; haptic(8); setCollapsedPersist(dx<0); } }
            swipeX.current=null;
          },
          onTouchStart:function(e){ if(e.touches&&e.touches.length) swipeX.current=e.touches[0].clientX; swiped.current=false; },
          onTouchEnd:function(e){
            if(swipeX.current!==null&&e.changedTouches&&e.changedTouches.length){ var dx=e.changedTouches[0].clientX-swipeX.current; if(Math.abs(dx)>50){ swiped.current=true; haptic(8); setCollapsedPersist(dx<0); } }
            swipeX.current=null;
          },
          onClick:function(e){ if(swiped.current){ swiped.current=false; return; } laneTaps(); }
        }, meta.label),
        React.createElement("span", { "data-lanecount":true, style:{flexShrink:0,fontSize:"0.78rem",fontWeight:700,
          color:meta.accent,opacity:0.65,fontFamily:S.fontMono,letterSpacing:"normal",textTransform:"none"} },
          topLevel.length),
        editMode&&!isBuiltin && React.createElement("button", { onClick:function(){ if(removeArm){ setRemoveArm(false); onDeleteLane(lane); } else { setRemoveArm(true); } },
          style:{background:removeArm?S.dangerBg2:"none",border:"1px solid "+(removeArm?S.dangerBright:S.dangerText),borderRadius:"6px",padding:"0.15rem 0.5rem",color:removeArm?S.dangerBright:S.dangerText,cursor:"pointer",fontSize:"0.72rem",fontWeight:removeArm?700:600,fontFamily:S.fontBody,textTransform:"none",letterSpacing:"normal"} }, removeArm?"Confirm remove?":"Remove"),
        addOpen && React.createElement("div", { ref:menuAutoScroll, "data-surface":"menu", "data-menu-open":"1", style:{position:"absolute",top:"calc(100% + 4px)",left:UI.left?"auto":0,right:UI.left?0:"auto",minWidth:"240px",background:S.menuBg,border:"1px solid "+S.border,borderRadius:S.radius2,overflow:"hidden",boxShadow:"0 8px 32px rgba(0,0,0,0.6)",zIndex:150,textTransform:"none",letterSpacing:"normal"} },
          laneOrder.map(function(laneKey){
            var m=getMeta(laneMeta,laneKey);
            return React.createElement("button", { "data-flat":true, key:laneKey, onClick:function(){ props.onPickLane(laneKey); setAddOpen(false); },
              style:{display:"flex",alignItems:"center",gap:"0.65rem",width:"100%",background:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.8rem 1rem",cursor:"pointer",fontFamily:S.fontBody,textAlign:"left"} },
              React.createElement("div", { style:{width:"10px",height:"10px",borderRadius:"50%",background:m.accent,flexShrink:0} }),
              React.createElement("span", { style:{fontSize:"0.92rem",fontWeight:600,color:S.text} }, m.label)
            );
          }),
          React.createElement("button", { "data-flat":true, onClick:function(){ props.onNewLane(); setAddOpen(false); },
            style:{display:"flex",alignItems:"center",gap:"0.65rem",width:"100%",background:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.8rem 1rem",cursor:"pointer",fontFamily:S.fontBody,textAlign:"left"} },
            React.createElement("div", { style:{width:"10px",height:"10px",borderRadius:"2px",border:"2px dashed #444",flexShrink:0} }),
            React.createElement("span", { style:{fontSize:"0.92rem",fontWeight:600,color:S.mutedGlyph,whiteSpace:"nowrap"} }, "+ New Lane")
          ),
          React.createElement("button", { "data-flat":true, onClick:function(){ props.onEditLanes(); setAddOpen(false); },
            style:{display:"flex",alignItems:"center",gap:"0.65rem",width:"100%",background:"none",border:"none",padding:"0.8rem 1rem",cursor:"pointer",fontFamily:S.fontBody,textAlign:"left"} },
            React.createElement(GearSVG, { size:12, col:S.mutedGlyph }),
            React.createElement("span", { style:{fontSize:"0.92rem",fontWeight:600,color:S.mutedGlyph,whiteSpace:"nowrap"} }, "Edit Lanes")
          )
        )
      ),
      collapsed
        ? React.createElement("div", {
            "data-pulse": lanePulse ? "1" : undefined,
            "data-laneoval":lane,
            onMouseDown:function(e){ swipeX.current=e.clientX; },
            onMouseUp:function(e){ if(swipeX.current!==null){ var dx=e.clientX-swipeX.current; if(dx>50){ haptic(8); setCollapsedPersist(false); } } swipeX.current=null; },
            onTouchStart:function(e){ if(e.touches&&e.touches.length) swipeX.current=e.touches[0].clientX; },
            onTouchEnd:function(e){ if(swipeX.current!==null&&e.changedTouches&&e.changedTouches.length){ var dx=e.changedTouches[0].clientX-swipeX.current; if(dx>50){ haptic(8); setCollapsedPersist(false); } } swipeX.current=null; },
            style:Object.assign({height:laneActiveProj?"20px":"16px",border:"2.5px solid "+meta.accent,borderRadius:"999px",background:laneOvalBg,cursor:"grab",opacity:laneActiveProj?0.95:0.85,marginTop:"0.15rem",touchAction:"pan-y",display:"flex",alignItems:"center",padding:laneActiveProj?"0 0.75rem":"0",overflow:"hidden"}, pulseVars(meta.accent)) },
            // A collapsed lane still names its running timer, so nothing
            // active is ever fully out of sight.
            laneActiveProj && React.createElement("span", { style:{flex:1,minWidth:0,fontSize:"0.68rem",fontWeight:700,
              color:meta.accent,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",fontFamily:S.fontBody} },
              (interrupting?"Paused: ":"")+laneActiveProj.name),
            laneActiveProj && React.createElement(Mono, { style:{flexShrink:0,fontSize:"0.66rem",fontWeight:700,
              color:interrupting?S.distDim:meta.accent} }, fmtDur(elapsed,true)),
            // Same bare icon+text control as the card pill. toggleProject
            // resumes an interrupted timer and stops a running one - and once
            // stopped, laneActiveProj goes null and the oval empties itself.
            laneActiveProj && React.createElement("span", { "data-ovalctl":true, role:"button",
              "aria-label": interrupting?"Resume":"Stop",
              onClick:function(e){ e.stopPropagation(); haptic(10); onToggle(laneActiveProj.id); },
              onMouseDown:function(e){ e.stopPropagation(); },
              onTouchStart:function(e){ e.stopPropagation(); },
              style:{display:"flex",alignItems:"center",gap:"0.28rem",flexShrink:0,cursor:"pointer",alignSelf:"stretch",padding:"0 0.2rem",marginLeft:"0.5rem"} },
              interrupting
                ? React.createElement("svg", { width:11,height:11,viewBox:"0 0 22 22",fill:"none" },
                    React.createElement("path", { d:"M6 4 L18 11 L6 18 Z", fill:S.distIcon })
                  )
                : React.createElement("svg", { width:11,height:11,viewBox:"0 0 22 22",fill:"none" },
                    React.createElement("rect", { x:"3",y:"3",width:"16",height:"16",rx:"2",fill:meta.accent })
                  ),
              React.createElement("span", { style:{fontSize:"0.66rem",fontWeight:700,
                color:interrupting?S.distLbl:meta.accent,fontFamily:S.fontBody,lineHeight:1,whiteSpace:"nowrap"} },
                interrupting?"Resume":"Stop")
            )
          )
        : topLevel.length===0
        ? React.createElement("div", { style:{color:S.textMuted,fontSize:"0.82rem",padding:"0.5rem 0"} }, "No items yet - use Add to create one.")
        : topLevel.map(function(proj,idx){
            var subTasks=allProjects.filter(function(p){ return p.parentId===proj.id; });
            var descendantIds=getDescendantIds(allProjects,proj.id);
            var allIds=[proj.id].concat(descendantIds);
            var todayMs=todayLogs.filter(function(l){ return allIds.indexOf(l.projectId)>=0; }).reduce(function(a,l){ return a+l.duration; },0)+(activeId===proj.id?elapsed:0);
            var projDisruptions=todayDist.filter(function(d){ return allIds.indexOf(d.projectId)>=0; });
            var distCount=projDisruptions.length;
            return React.createElement(ProjectCard, {
              key:proj.id, proj:proj, subTasks:subTasks,
              isActive:activeId===proj.id, interrupting:interrupting, elapsed:elapsed,
              todayMs:todayMs, distCount:distCount, projDisruptions:projDisruptions,
              onToggle:onToggle, onEdit:onEdit, onStages:onStages, onStageToggle:props.onStageToggle,
              onAddSub:props.onAddSub,
              activeId:activeId, todayLogs:todayLogs, todayDist:todayDist, allProjects:allProjects,
              editMode:editMode, laneMeta:laneMeta,
              dragHandleProps:{ onMouseDown:function(e){ props.onDragStart(e,idx); }, onTouchStart:function(e){ props.onDragStart(e,idx); } }
            });
          })
    )
  );
}

// ---- MODULE PLATFORM ---------------------------------------------------------
// Phase 1 draws the line between the app and the platform it stands on.
//
// CORE - never a module, always present:
//   the timer engine and session restore, lanes / projects / sub-tasks, logs,
//   disruptions and breaks, the schedule + unpaid-break + pay-cycle engine,
//   Reports, Backup & Restore, themes and tokens, settings.
//
// MODULE TERRITORY - anything that introduces a new kind of record alongside
//   the timer: Tool Tracker, Materials Tracker, Project Builder, and whatever
//   comes after. A module ships inside this same index.html - iOS isolates
//   storage per home-screen app, so a separate app could never see these
//   projects - and is switched on or off by the user rather than downloaded.
//
// THE CONTRACT. A module is a plain object passed to TT.define():
//   id             required  slug: lowercase, leading letter, [a-z0-9-], 2-24.
//                            Permanent - it names the module's storage keys.
//   title          required  human name for menus and the Extensions list.
//   version        required  integer >= 1, the module's own schema version.
//   summary        optional  one line of description.
//   defaultEnabled optional  false unless stated. A la carte means off first.
//   nav            optional  { label, screen, group } - one row in the settings
//                            menu that opens screens[screen].
//   screens        optional  { name: Component }. Rendered as sibling overlays,
//                            never nested inside a backdrop-filter surface.
//   storage        optional  { keys:[bare slugs], normalize(store, api) }.
//                            Keys are namespaced tt_mod_<id>_<key>. The
//                            normalizer runs once at boot, before first paint,
//                            for enabled and disabled modules alike, and must
//                            be idempotent and never throw.
//   settingsPanel  optional  Component rendered inside Themes and Layout.
//   reports        optional  { section(ctx), text(ctx) } - an extra Reports
//                            block and extra lines in the copied report.
//   Any other field is rejected: an unknown key is a typo, not a feature.
//
// RULES a module lives by:
//   - Storage only through ctx.storage. Never touch localStorage directly -
//     that is what keeps Backup & Restore whole and enable/disable reversible.
//   - Tokens are live. Call TT.tokens() inside render; never cache S at load
//     time, because the palette changes underneath when the theme does.
//   - Any dropdown a module opens broadcasts TT.closeMenus() first.
//   - Stacking belongs to the core: row 80, lane 95, below-header 300,
//     modals 900. Modules use TT.ui.Modal rather than inventing layers.
//
// Nothing below changes what the app draws. With no modules registered every
// hook in here resolves to an empty list and renders null.
// ==== TT PLATFORM BEGIN ====
var TT_CONTRACT_VERSION = 1;
var TT_MOD_PREFIX   = "tt_mod_";        // every module key starts here
var TT_ENABLED_KEY  = "tt_modules";     // { "<id>": true|false }
var TT_ID_RE        = /^[a-z][a-z0-9-]{1,23}$/;
var TT_KEY_RE       = /^[a-z][a-z0-9-]{0,31}$/;
var TT_FIELDS = ["id","title","version","summary","defaultEnabled","nav",
                 "screens","storage","settingsPanel","reports"];

var TT_REGISTRY = [];   // registration order
var TT_BY_ID    = {};
var TT_BOOTED   = {};

function ttStore(storage){
  if(storage) return storage;
  try{ return localStorage; }catch(e){ return null; }
}

// ---- keys -------------------------------------------------------------------
function ttModKey(id, key){
  // typeof first: String(undefined) is "undefined", which is itself a legal
  // slug, so a regex alone would happily namespace a module that has no id.
  if(typeof id!=="string"  || !TT_ID_RE.test(id))  throw new TypeError("bad module id: "+id);
  if(typeof key!=="string" || !TT_KEY_RE.test(key)) throw new TypeError("bad module key: "+key);
  return TT_MOD_PREFIX + id + "_" + key;
}

// A module never sees localStorage; it gets one of these, bound to its own id.
// Reads that fail - missing, corrupt, quota-blocked - return the default rather
// than throwing, exactly like the core's load().
function ttModStorage(id, storage){
  var st = ttStore(storage);
  var prefix = TT_MOD_PREFIX + id + "_";
  var api = {
    id: id,
    key: function(k){ return ttModKey(id, k); },
    get: function(k, def){
      try{ var v = st.getItem(ttModKey(id,k)); return v==null ? def : JSON.parse(v); }
      catch(e){ return def; }
    },
    set: function(k, val){
      try{ st.setItem(ttModKey(id,k), JSON.stringify(val)); return true; }
      catch(e){ return false; }
    },
    remove: function(k){ try{ st.removeItem(ttModKey(id,k)); }catch(e){} },
    keys: function(){
      var out=[];
      try{
        for(var i=0;i<st.length;i++){
          var k=st.key(i);
          if(k && k.indexOf(prefix)===0) out.push(k.slice(prefix.length));
        }
      }catch(e){}
      return out;
    },
    clear: function(){ api.keys().forEach(function(k){ api.remove(k); }); }
  };
  return api;
}

// ---- registration -----------------------------------------------------------
function ttValidateModule(spec){
  var errs=[];
  if(!spec || typeof spec!=="object" || Array.isArray(spec)) return ["module must be an object"];
  Object.keys(spec).forEach(function(k){
    if(TT_FIELDS.indexOf(k)<0) errs.push("unknown field: "+k);
  });
  if(typeof spec.id!=="string" || !TT_ID_RE.test(spec.id)) errs.push("id must match "+TT_ID_RE);
  else if(TT_BY_ID[spec.id]) errs.push("duplicate id: "+spec.id);
  if(typeof spec.title!=="string" || !spec.title.trim()) errs.push("title is required");
  if(typeof spec.version!=="number" || !isFinite(spec.version) ||
     Math.floor(spec.version)!==spec.version || spec.version<1) errs.push("version must be an integer >= 1");
  if(spec.summary!==undefined && typeof spec.summary!=="string") errs.push("summary must be a string");
  if(spec.defaultEnabled!==undefined && typeof spec.defaultEnabled!=="boolean") errs.push("defaultEnabled must be a boolean");

  if(spec.screens!==undefined){
    if(typeof spec.screens!=="object" || spec.screens===null || Array.isArray(spec.screens)) errs.push("screens must be an object");
    else Object.keys(spec.screens).forEach(function(n){
      if(typeof spec.screens[n]!=="function") errs.push("screen "+n+" must be a component function");
    });
  }
  if(spec.nav!==undefined){
    if(typeof spec.nav!=="object" || spec.nav===null || Array.isArray(spec.nav)) errs.push("nav must be an object");
    else{
      if(typeof spec.nav.label!=="string" || !spec.nav.label.trim()) errs.push("nav.label is required");
      if(typeof spec.nav.screen!=="string" || !spec.nav.screen) errs.push("nav.screen is required");
      else if(!(spec.screens && spec.screens[spec.nav.screen])) errs.push("nav.screen names no screen: "+spec.nav.screen);
      if(spec.nav.group!==undefined && typeof spec.nav.group!=="string") errs.push("nav.group must be a string");
    }
  }
  if(spec.storage!==undefined){
    if(typeof spec.storage!=="object" || spec.storage===null || Array.isArray(spec.storage)) errs.push("storage must be an object");
    else{
      if(!Array.isArray(spec.storage.keys)) errs.push("storage.keys must be an array");
      else spec.storage.keys.forEach(function(k){
        if(typeof k!=="string" || !TT_KEY_RE.test(k)) errs.push("storage key must be a bare slug: "+k);
      });
      if(spec.storage.normalize!==undefined && typeof spec.storage.normalize!=="function")
        errs.push("storage.normalize must be a function");
    }
  }
  if(spec.settingsPanel!==undefined && typeof spec.settingsPanel!=="function") errs.push("settingsPanel must be a component function");
  if(spec.reports!==undefined){
    if(typeof spec.reports!=="object" || spec.reports===null || Array.isArray(spec.reports)) errs.push("reports must be an object");
    else{
      if(spec.reports.section!==undefined && typeof spec.reports.section!=="function") errs.push("reports.section must be a function");
      if(spec.reports.text!==undefined && typeof spec.reports.text!=="function") errs.push("reports.text must be a function");
    }
  }
  return errs;
}

// Registration is strict and loud: a malformed module is a build-time mistake,
// and failing at eval beats shipping a module that half-works on the floor.
function ttDefineModule(spec){
  var errs=ttValidateModule(spec);
  if(errs.length) throw new Error("module "+((spec&&spec.id)||"?")+": "+errs.join("; "));
  var m={
    id:spec.id, title:spec.title, version:spec.version,
    summary:spec.summary||"", defaultEnabled:!!spec.defaultEnabled,
    nav:spec.nav||null, screens:spec.screens||{}, storage:spec.storage||null,
    settingsPanel:spec.settingsPanel||null, reports:spec.reports||null
  };
  TT_REGISTRY.push(m); TT_BY_ID[m.id]=m;
  return m;
}
function ttModules(){ return TT_REGISTRY.slice(); }
function ttModule(id){ return TT_BY_ID[id]||null; }

// ---- enablement -------------------------------------------------------------
// The map only records deliberate choices; a module absent from it falls back
// to its own defaultEnabled, so shipping a new module never rewrites saved state.
function ttEnabledMap(storage){
  var st=ttStore(storage);
  try{
    var v=st.getItem(TT_ENABLED_KEY);
    var o=v?JSON.parse(v):null;
    return (o && typeof o==="object" && !Array.isArray(o)) ? o : {};
  }catch(e){ return {}; }
}
function ttModuleEnabled(id, storage){
  var m=TT_BY_ID[id]; if(!m) return false;
  var map=ttEnabledMap(storage);
  return Object.prototype.hasOwnProperty.call(map,id) ? !!map[id] : !!m.defaultEnabled;
}
function ttSetModuleEnabled(id, on, storage){
  if(!TT_BY_ID[id]) return false;
  var st=ttStore(storage), map=ttEnabledMap(storage);
  map[id]=!!on;
  try{ st.setItem(TT_ENABLED_KEY, JSON.stringify(map)); }catch(e){ return false; }
  return true;
}
function ttEnabledModules(storage){
  return TT_REGISTRY.filter(function(m){ return ttModuleEnabled(m.id, storage); });
}

// ---- boot -------------------------------------------------------------------
// Runs for every registered module, enabled or not: data left by a module the
// user switched off still has to be valid when they switch it back on. One run
// per module per session; a normalizer that throws is contained, not fatal.
function ttBootModules(storage){
  var ran=[];
  TT_REGISTRY.forEach(function(m){
    if(TT_BOOTED[m.id]) return;
    TT_BOOTED[m.id]=true;
    if(!m.storage || typeof m.storage.normalize!=="function") return;
    try{ m.storage.normalize(ttModStorage(m.id, storage), TT); ran.push(m.id); }
    catch(e){}
  });
  return ran;
}

// ---- host hooks -------------------------------------------------------------
// Each returns [] with no modules registered, which is why Phase 1 is invisible.
function ttModuleNav(storage){
  return ttEnabledModules(storage).filter(function(m){ return m.nav; }).map(function(m){
    return { id:m.id, label:m.nav.label, group:m.nav.group||"Modules", screen:m.nav.screen };
  });
}
function ttModuleScreen(id, name){
  var m=TT_BY_ID[id];
  return (m && m.screens && m.screens[name]) || null;
}
function ttModuleContext(id, host){
  var ctx=Object.assign({}, host||{});
  ctx.moduleId=id;
  ctx.storage=ttModStorage(id);
  ctx.api=TT;
  return ctx;
}
function ttSettingsPanels(storage){
  return ttEnabledModules(storage).filter(function(m){ return m.settingsPanel; });
}
function ttReportSections(ctx, storage){
  var out=[];
  ttEnabledModules(storage).forEach(function(m){
    if(!m.reports || !m.reports.section) return;
    try{ var el=m.reports.section(ctx); if(el) out.push({ id:m.id, el:el }); }catch(e){}
  });
  return out;
}
function ttReportText(ctx, storage){
  var out=[];
  ttEnabledModules(storage).forEach(function(m){
    if(!m.reports || !m.reports.text) return;
    try{
      var lines=m.reports.text(ctx);
      if(typeof lines==="string") lines=[lines];
      if(Array.isArray(lines)) lines.forEach(function(l){ if(typeof l==="string") out.push(l); });
    }catch(e){}
  });
  return out;
}

// ---- the API ----------------------------------------------------------------
// Everything a module is allowed to reach for. Style getters are functions, not
// captured objects: S and INPUT_STYLE are mutated in place by applyTokens, and
// a module that snapshots them at load time paints the previous theme.
var TT = {
  version: TT_CONTRACT_VERSION,

  define: ttDefineModule,
  validate: ttValidateModule,
  modules: ttModules,
  module: ttModule,
  enabled: ttEnabledModules,
  isEnabled: ttModuleEnabled,
  setEnabled: ttSetModuleEnabled,
  boot: ttBootModules,
  context: ttModuleContext,

  storage: ttModStorage,
  key: ttModKey,
  prefix: TT_MOD_PREFIX,

  nav: ttModuleNav,
  screen: ttModuleScreen,
  settingsPanels: ttSettingsPanels,
  reportSections: ttReportSections,
  reportText: ttReportText,

  tokens: function(){ return S; },
  rgba: rgba,
  haptic: haptic,
  closeMenus: function(){ try{ window.dispatchEvent(new Event("ttCloseMenus")); }catch(e){} },

  ui: {
    Modal: Modal,
    ModalActions: ModalActions,
    Mono: Mono,
    Toggle: Toggle,
    Carousel: Carousel,
    saveStyle: MODAL_SAVE,
    cancelStyle: MODAL_CANCEL,
    timeFieldStyle: TIME_FIELD_STYLE,
    inputStyle: function(){ return Object.assign({}, INPUT_STYLE); },
    labelStyle: function(){ return Object.assign({}, LABEL_STYLE); }
  },

  fmt: {
    dur: fmtDur, time: fmtTime, date: fmtDate,
    hours: fmtHours, money: fmtMoney, pad: pad
  },

  time: {
    DAY_KEYS: DAY_KEYS, DAY_LABELS: DAY_LABELS,
    dayKeyOf: dayKeyOf, isoDate: isoDate, toMin: toMin,
    startOfDay: startOfDay, addDays: addDays, startOfWeek: startOfWeek,
    startOfMonth: startOfMonth, startOfQuarter: startOfQuarter, startOfYear: startOfYear,
    periodRange: periodRange, periodLabel: periodLabel, payCycleRange: payCycleRange,
    scheduledMinutes: scheduledMinutes, scheduledToDate: scheduledToDate,
    schNetMinutes: schNetMinutes
  },

  data: { uid: uid, findProj: findProj, getChildren: getChildren, getDescendantIds: getDescendantIds }
};
try{ window.TT = TT; }catch(e){}
// ==== TT PLATFORM END ====

// ---- MAIN APP ---------------------------------------------------------------
export default function App(){
  // Module normalizers run once, in a lazy initializer, so every module's
  // saved shape is current before the first paint - the same guarantee
  // normalizeSchedule and normalizeNotifs give the core.
  useState(function(){ return ttBootModules(); });

  // Mode
  var testModeS=useState(function(){ return load("tt_testmode",false); }); var setTestMode=testModeS[1]; var testMode=testModeS[0];
  var editModeS=useState(false); var setEditMode=editModeS[1]; var editMode=editModeS[0];

  // Projects + logs
  var rProjS=useState(function(){ return load("tt_projects",REAL_PROJECTS); }); var setRealProjects=rProjS[1]; var realProjects=rProjS[0];
  var tProjS=useState(function(){ return load("tt_test_projects",TEST_PROJECTS); }); var setTestProjects=tProjS[1]; var testProjects=tProjS[0];
  var rLogsS=useState(function(){ return load("tt_logs",[]); }); var setRealLogs=rLogsS[1]; var realLogs=rLogsS[0];
  var tLogsS=useState(function(){ return load("tt_test_logs",[]); }); var setTestLogs=tLogsS[1]; var testLogs=tLogsS[0];
  var rDistS=useState(function(){ return load("tt_disruptions",[]); }); var setRealDist=rDistS[1]; var realDist=rDistS[0];
  var tDistS=useState(function(){ return load("tt_test_disruptions",[]); }); var setTestDist=tDistS[1]; var testDist=tDistS[0];
  var rBreaksS=useState(function(){ return load("tt_breaks",[]); }); var setRealBreaks=rBreaksS[1]; var realBreaks=rBreaksS[0];
  var tBreaksS=useState(function(){ return load("tt_test_breaks",[]); }); var setTestBreaks=tBreaksS[1]; var testBreaks=tBreaksS[0];

  var projects=testMode?testProjects:realProjects;
  var setProjects=testMode?setTestProjects:setRealProjects;
  var logs=testMode?testLogs:realLogs;
  var setLogs=testMode?setTestLogs:setRealLogs;
  var disruptions=testMode?testDist:realDist;
  var setDisruptions=testMode?setTestDist:setRealDist;
  var breaks=testMode?testBreaks:realBreaks;
  var setBreaks=testMode?setTestBreaks:setRealBreaks;

  // Lane meta
  var laneOrderS=useState(function(){ return load("tt_laneorder",DEFAULT_ORDER); }); var setLaneOrder=laneOrderS[1]; var laneOrder=laneOrderS[0];
  var laneMetaS=useState(function(){ return load("tt_lanemeta",DEFAULT_META); }); var setLaneMeta=laneMetaS[1]; var laneMeta=laneMetaS[0];

  // ---- Session restore ----
  // Every timer below is stored as an absolute start timestamp, never as an
  // accumulated count, so elapsed time is always recomputed as (now - start).
  // That means a reload, a backgrounded app, or a hard kill all resume at the
  // correct time rather than losing the interval.
  var bootS=useState(function(){
    var s=load("tt_session",{});
    // A session from an earlier day is stale: a timer left running overnight
    // should not come back showing a 14-hour count.
    if(s.savedAt && new Date(s.savedAt).toDateString()!==todayStr()) return {};
    // Drop a restored project timer whose project is gone - deleted since, or
    // belonging to the other data set if Test Mode was toggled in between.
    if(s.activeId==null || !s.activeStart || !projects.some(function(p){ return p.id===s.activeId; })){
      s.activeId=null; s.activeStart=null; s.interrupting=false; s.intStart=null;
    }
    return s;
  });
  var boot=bootS[0];
  var bootNow=Date.now();
  function since(t){ return t ? bootNow-t : 0; }

  // Timer state
  var activeIdS=useState(boot.activeId||null); var setActiveId=activeIdS[1]; var activeId=activeIdS[0];
  var activeStartS=useState(boot.activeStart||null); var setActiveStart=activeStartS[1]; var activeStart=activeStartS[0];
  var elapsedS=useState(since(boot.activeStart)); var setElapsed=elapsedS[1]; var elapsed=elapsedS[0];

  // Clock state
  var atWorkStartS=useState(boot.atWorkStart||null); var setAtWorkStart=atWorkStartS[1]; var atWorkStart=atWorkStartS[0];
  var atWorkElapsedS=useState(since(boot.atWorkStart)); var setAtWorkElapsed=atWorkElapsedS[1]; var atWorkElapsed=atWorkElapsedS[0];

  // Break state
  var onBreakS=useState(!!boot.breakStart); var setOnBreak=onBreakS[1]; var onBreak=onBreakS[0];
  var breakStartS=useState(boot.breakStart||null); var setBreakStart=breakStartS[1]; var breakStart=breakStartS[0];
  var breakElapsedS=useState(since(boot.breakStart)); var setBreakElapsed=breakElapsedS[1]; var breakElapsed=breakElapsedS[0];
  var breakLabelS=useState(boot.breakLabel||""); var setBreakLabel=breakLabelS[1]; var breakLabel=breakLabelS[0];

  // Disruption state
  var interruptingS=useState(!!boot.interrupting); var setInterrupting=interruptingS[1]; var interrupting=interruptingS[0];
  var intStartS=useState(boot.intStart||null); var setIntStart=intStartS[1]; var intStart=intStartS[0];
  var intElapsedS=useState(since(boot.intStart)); var setIntElapsed=intElapsedS[1]; var intElapsed=intElapsedS[0];
  var nowTickS=useState(Date.now()); var setNowTick=nowTickS[1]; var nowTick=nowTickS[0];

  // UI state
  var menuOpenS=useState(false); var setMenuOpen=menuOpenS[1]; var menuOpen=menuOpenS[0];
  var addMenuOpenS=useState(false); var setAddMenuOpen=addMenuOpenS[1]; var addMenuOpen=addMenuOpenS[0];
  var showAddS=useState(null); var setShowAdd=showAddS[1]; var showAdd=showAddS[0];
  var editProjS=useState(null); var setEditProj=editProjS[1]; var editProj=editProjS[0];
  var stagesProjS=useState(null); var setStagesProj=stagesProjS[1]; var stagesProj=stagesProjS[0];
  var showDisruptS=useState(false); var setShowDisrupt=showDisruptS[1]; var showDisrupt=showDisruptS[0];
  var disruptTargetS=useState(null); var setDisruptTarget=disruptTargetS[1]; var disruptTarget=disruptTargetS[0];
  var showBreakS=useState(false); var setShowBreak=showBreakS[1]; var showBreak=showBreakS[0];
  var showDayS=useState(false); var setShowDay=showDayS[1]; var showDay=showDayS[0];
  var showReportsS=useState(false); var setShowReports=showReportsS[1]; var showReports=showReportsS[0];
  var showBackupS=useState(false); var setShowBackup=showBackupS[1]; var showBackup=showBackupS[0];
  // Whichever module screen is open, as { id, screen }. Null with no modules.
  var modScreenS=useState(null); var setModScreen=modScreenS[1]; var modScreen=modScreenS[0];
  var showNewLaneS=useState(false); var setShowNewLane=showNewLaneS[1]; var showNewLane=showNewLaneS[0];
  var showEditLanesS=useState(false); var setShowEditLanes=showEditLanesS[1]; var showEditLanes=showEditLanesS[0];
  var confirmDeleteS=useState(null); var setConfirmDelete=confirmDeleteS[1]; var confirmDelete=confirmDeleteS[0];
  var settingsS=useState(function(){
    var st = load("tt_settings",{ layout:"comfortable", tracking:"timer", colorScheme:"bright-pastels", theme:"neon-dream", schemes:{}, fonts:{}, mode:"dark", handedness:"right", headerPos:"top" });
    // Settings saved before the schedule existed get the default merged in, so
    // every consumer can rely on the shape being present.
    // Every saved schedule shape - missing entirely, or from before unpaid
    // breaks existed - is normalized to the full current shape.
    st.workSchedule = normalizeSchedule(st.workSchedule);
    st.notifs = normalizeNotifs(st.notifs);
    if(!st.timeInc) st.timeInc = "standard";
    return st;
  });
  var setSettings=settingsS[1]; var settings=settingsS[0];
  // Must run before ANY colour is derived below - S and C are module-level, so
  // deriving first would paint the previous render's palette. The 1s tick used
  // to mask this; the first paint after a load was still wrong.
  applyTokens(settings);
  var showSettingsS=useState(false); var setShowSettings=showSettingsS[1]; var showSettings=showSettingsS[0];
  var showScheduleS=useState(false); var setShowSchedule=showScheduleS[1]; var showSchedule=showScheduleS[0];
  var showTrackingS=useState(false); var setShowTracking=showTrackingS[1]; var showTracking=showTrackingS[0];
  var timeMenuOpenS=useState(false); var setTimeMenuOpen=timeMenuOpenS[1]; var timeMenuOpen=timeMenuOpenS[0];
  var distPresetsS=useState(function(){ return load("tt_distpresets",DEFAULT_DIST_PRESETS); });
  var setDistPresets=distPresetsS[1]; var distPresets=distPresetsS[0];
  var distMenuOpenS=useState(false); var setDistMenuOpen=distMenuOpenS[1]; var distMenuOpen=distMenuOpenS[0];
  var showEditPresetsS=useState(false); var setShowEditPresets=showEditPresetsS[1]; var showEditPresets=showEditPresetsS[0];
  var distMenuRef=useRef(null);
  var showTestConfirmS=useState(false); var setShowTestConfirm=showTestConfirmS[1]; var showTestConfirm=showTestConfirmS[0];
  var addMenuRef=useRef(null);
  var menuRef=useRef(null);
  var interval=useRef(null);

  // Persist
  useEffect(function(){ save("tt_testmode",testMode); },[testMode]);
  useEffect(function(){ save("tt_projects",realProjects); },[realProjects]);
  useEffect(function(){ save("tt_test_projects",testProjects); },[testProjects]);
  useEffect(function(){ save("tt_logs",realLogs); },[realLogs]);
  useEffect(function(){ save("tt_test_logs",testLogs); },[testLogs]);
  useEffect(function(){ save("tt_disruptions",realDist); },[realDist]);
  useEffect(function(){ save("tt_test_disruptions",testDist); },[testDist]);
  useEffect(function(){ save("tt_breaks",realBreaks); },[realBreaks]);
  useEffect(function(){ save("tt_test_breaks",testBreaks); },[testBreaks]);
  useEffect(function(){ save("tt_laneorder",laneOrder); },[laneOrder]);
  useEffect(function(){ save("tt_lanemeta",laneMeta); },[laneMeta]);
  useEffect(function(){ save("tt_distpresets",distPresets); },[distPresets]);
  useEffect(function(){ save("tt_settings",settings); },[settings]);
  // Only start timestamps are written, never elapsed counters - see the restore
  // block above. This fires on start/stop, not on every tick.
  useEffect(function(){
    save("tt_session",{ savedAt:Date.now(), activeId:activeId, activeStart:activeStart,
      atWorkStart:atWorkStart, breakStart:breakStart, breakLabel:breakLabel,
      interrupting:interrupting, intStart:intStart });
  },[activeId,activeStart,atWorkStart,breakStart,breakLabel,interrupting,intStart]);

  // Timer tick
  useEffect(function(){
    interval.current=setInterval(function(){
      var now=Date.now();
      setNowTick(now);
      if(activeStart) setElapsed(now-activeStart);
      if(atWorkStart) setAtWorkElapsed(now-atWorkStart);
      if(breakStart) setBreakElapsed(now-breakStart);
      if(intStart) setIntElapsed(now-intStart);
    },1000);
    return function(){ clearInterval(interval.current); };
  },[activeStart,atWorkStart,breakStart,intStart]);

  // Close add menu on outside click
  useEffect(function(){
    if(!addMenuOpen) return;
    function h(e){ if(addMenuRef.current&&!addMenuRef.current.contains(e.target)) setAddMenuOpen(false); }
    document.addEventListener("mousedown",h); document.addEventListener("touchstart",h);
    return function(){ document.removeEventListener("mousedown",h); document.removeEventListener("touchstart",h); };
  },[addMenuOpen]);
  // Track scrolling globally and swallow clicks while scrolling
  useEffect(function(){
    function blockClick(e){ if(SCROLL_STATE.scrolling){ e.stopPropagation(); e.preventDefault(); } }
    window.addEventListener("scroll", markScrolling, true);
    document.addEventListener("click", blockClick, true);
    return function(){
      window.removeEventListener("scroll", markScrolling, true);
      document.removeEventListener("click", blockClick, true);
    };
  },[]);

  // Close disruption dropdown on outside click
  useEffect(function(){
    if(!distMenuOpen) return;
    function h(e){ if(distMenuRef.current&&!distMenuRef.current.contains(e.target)) setDistMenuOpen(false); }
    document.addEventListener("mousedown",h); document.addEventListener("touchstart",h);
    return function(){ document.removeEventListener("mousedown",h); document.removeEventListener("touchstart",h); };
  },[distMenuOpen]);

  // Close settings menu on outside click
  useEffect(function(){
    if(!menuOpen) return;
    function h(e){ if(menuRef.current&&!menuRef.current.contains(e.target)) setMenuOpen(false); }
    document.addEventListener("mousedown",h); document.addEventListener("touchstart",h);
    return function(){ document.removeEventListener("mousedown",h); document.removeEventListener("touchstart",h); };
  },[menuOpen]);

  // Derived
  var todayStr2=todayStr();
  var todayLogs=logs.filter(function(l){ return new Date(l.startTime).toDateString()===todayStr2; });
  var todayDist=disruptions.filter(function(d){ return d.endTime&&new Date(d.startTime).toDateString()===todayStr2; });
  var todayBreaks=breaks.filter(function(b){ return new Date(b.startTime).toDateString()===todayStr2; });
  var openDist=disruptions.find(function(d){ return !d.endTime; });
  var activeProj=projects.find(function(p){ return p.id===activeId; });
  var todayDistMs=todayDist.reduce(function(a,d){ return a+d.duration; },0);
  var notifToastS=useState(null); var setNotifToast=notifToastS[1]; var notifToast=notifToastS[0];
  // Checks due notifications once per tick. Fired keys persist per period
  // instance so nothing repeats, and entries older than 8 days are pruned.
  useEffect(function(){
    var cfg=settings.notifs;
    if(!cfg || !(cfg.day&&cfg.day.on || cfg.cycle&&cfg.cycle.on || cfg.period&&cfg.period.on)) return;
    var fired=load("tt_notif_fired",{});
    var due=evalNotifications(cfg, settings.workSchedule, logs.concat(liveLogs()), Date.now(), fired);
    if(!due.length) return;
    var now=Date.now(), cutoff=now-8*86400000, pruned={};
    Object.keys(fired).forEach(function(k){ if(fired[k]>cutoff) pruned[k]=fired[k]; });
    due.forEach(function(d){
      pruned[d.key]=now;
      try{
        if(typeof Notification!=="undefined" && Notification.permission==="granted"){
          new Notification(d.title, { body:d.body });
        }
      }catch(e){}
    });
    save("tt_notif_fired", pruned);
    haptic([30,60,30]);
    var last=due[due.length-1];
    setNotifToast({ title:last.title, body:last.body, at:now });
  },[nowTick]);
  // toast auto-dismiss
  useEffect(function(){
    if(!notifToast) return;
    var t=setTimeout(function(){ setNotifToast(null); }, 8000);
    return function(){ clearTimeout(t); };
  },[notifToast]);
  // Timers that are still running have no log row yet. Reports fold them in as
  // synthetic logs so the current period never reads lower than the board.
  function liveLogs(){
    var out=[];
    if(activeId!=null && activeStart && activeProj){
      var par=activeProj.parentId!=null?projects.find(function(p){ return p.id===activeProj.parentId; }):null;
      out.push({ id:"live", projectId:activeProj.id, projectName:activeProj.name, lane:activeProj.lane,
        type:"project", startTime:activeStart, endTime:null, duration:Math.max(0,nowTick-activeStart),
        parentId:activeProj.parentId||null, parentName:par?par.name:null });
    }
    if(atWorkStart){
      out.push({ id:"live-atwork", projectId:null, projectName:"At Work", lane:null, type:"atwork",
        startTime:atWorkStart, endTime:null, duration:Math.max(0,nowTick-atWorkStart),
        parentId:null, parentName:null });
    }
    return out;
  }
  var clocked=!!atWorkStart;

  // Close every popup - modals and all dropdown menus - before opening a new one
  function closeAllPopups(){
    setShowAdd(null); setEditProj(null); setStagesProj(null); setShowDisrupt(false);
    setShowBreak(false); setShowDay(false); setShowNewLane(false); setShowEditLanes(false);
    setShowReports(false); setShowBackup(false); setModScreen(null);
    setConfirmDelete(null); setShowTestConfirm(false);
    setMenuOpen(false); setAddMenuOpen(false); setDistMenuOpen(false); setShowEditPresets(false); setShowSettings(false); setShowSchedule(false); setShowTracking(false); setTimeMenuOpen(false);
    try{ window.dispatchEvent(new Event("ttCloseMenus")); }catch(e){}
  }
  // ---- Module nav ----
  // Enabled modules that declare a nav entry become rows in the settings menu,
  // bucketed by group in first-registered order. Empty until a module ships,
  // so the menu is byte-identical to the previous build today.
  var modNav=ttModuleNav();
  var modGroups=[];
  modNav.forEach(function(entry){
    var g=modGroups.filter(function(x){ return x.name===entry.group; })[0];
    if(!g){ g={ name:entry.group, items:[] }; modGroups.push(g); }
    g.items.push(entry);
  });
  function openModule(entry){ closeAllPopups(); setModScreen({ id:entry.id, screen:entry.screen }); }

  useEffect(function(){
    function closeHeaderMenus(){ setMenuOpen(false); setAddMenuOpen(false); setDistMenuOpen(false); setTimeMenuOpen(false); }
    window.addEventListener("ttCloseMenus",closeHeaderMenus);
    return function(){ window.removeEventListener("ttCloseMenus",closeHeaderMenus); };
  },[]);

  // Actions
  function clockIn(){
    haptic(20);
    var now=Date.now();
    setAtWorkStart(now); setAtWorkElapsed(0);
    setLogs(function(prev){ return prev.concat([{id:uid(),projectId:null,projectName:"At Work",lane:null,type:"atwork",startTime:now,endTime:null,duration:0,parentId:null,parentName:null}]); });
  }
  function finalizeProject(now){
    if(!activeId||!activeStart) return;
    var proj=projects.find(function(p){ return p.id===activeId; });
    if(!proj) return;
    var dur=now-activeStart;
    var parent=proj.parentId?projects.find(function(p){ return p.id===proj.parentId; }):null;
    setLogs(function(prev){ return prev.concat([{id:uid(),projectId:proj.id,projectName:proj.name,lane:proj.lane,type:"project",startTime:activeStart,endTime:now,duration:dur,parentId:proj.parentId||null,parentName:parent?parent.name:null}]); });
    setActiveId(null); setActiveStart(null); setElapsed(0);
  }
  function toggleProject(id){
    haptic(12);
    if(!atWorkStart) clockIn();
    var now=Date.now();
    if(activeId===id){
      if(interrupting){ resumeProject(); return; }
      finalizeProject(now);
    } else {
      if(activeId) finalizeProject(now);
      setActiveId(id); setActiveStart(now); setElapsed(0); setInterrupting(false);
    }
  }
  function clockOut(){
    haptic([20,50,20]);
    var now=Date.now();
    if(activeId) finalizeProject(now);
    if(openDist) closeDisruption(now);
    if(onBreak) endBreak();
    setLogs(function(prev){ return prev.map(function(l){ return (!l.endTime&&l.type==="atwork")?Object.assign({},l,{endTime:now,duration:now-l.startTime}):l; }); });
    setAtWorkStart(null); setAtWorkElapsed(0);
    closeAllPopups();
    setShowDay(true);
  }
  function openDisrupt(proj){
    closeAllPopups();
    setDisruptTarget(proj||null);
    setShowDisrupt(true);
  }
  function startDisruptionWith(note, tgt){
    haptic([15,40,15]);
    var now=Date.now();
    setShowDisrupt(false);
    setDisruptions(function(prev){ return prev.concat([{id:uid(),projectId:tgt?tgt.id:null,projectName:tgt?tgt.name:null,lane:tgt?tgt.lane:null,note:note,startTime:now,endTime:null,duration:0}]); });
    if(tgt){ setInterrupting(true); setIntStart(now); setIntElapsed(0); }
  }
  function startDisruption(note){ startDisruptionWith(note, disruptTarget); }
  function closeDisruption(now2){
    var t=now2||Date.now();
    setDisruptions(function(prev){ return prev.map(function(d){ return !d.endTime?Object.assign({},d,{endTime:t,duration:t-d.startTime}):d; }); });
  }
  function resumeProject(){
    haptic(12);
    closeDisruption();
    setInterrupting(false); setIntStart(null); setIntElapsed(0);
  }
  function startBreak(label){
    haptic(12);
    var now=Date.now();
    setShowBreak(false);
    if(activeId) finalizeProject(now);
    setBreaks(function(prev){ return prev.concat([{id:uid(),label:label,startTime:now,endTime:null,duration:0}]); });
    setOnBreak(true); setBreakStart(now); setBreakElapsed(0); setBreakLabel(label);
  }
  function endBreak(){
    haptic(12);
    var now=Date.now();
    setBreaks(function(prev){ return prev.map(function(b){ return !b.endTime?Object.assign({},b,{endTime:now,duration:now-b.startTime}):b; }); });
    setOnBreak(false); setBreakStart(null); setBreakElapsed(0); setBreakLabel("");
  }
  function addProject(data){
    var id=Math.max(0,projects.reduce(function(mx,p){ return Math.max(mx,p.id); },0))+1;
    var siblings=projects.filter(function(p){ return p.lane===data.lane&&p.parentId===(data.parentId||null); });
    setProjects(function(prev){ return prev.concat([Object.assign({},data,{id:id,order:siblings.length,stages:[]})]);  });
    setShowAdd(null);
  }
  function saveEdit(data){
    setProjects(function(prev){ return prev.map(function(p){ return p.id===editProj.id?Object.assign({},p,data):p; }); });
    setEditProj(null);
  }
  function deleteProject(){
    var target=editProj;
    closeAllPopups();
    setConfirmDelete(target);
  }
  function doDeleteAll(proj){
    var ids=getDescendantIds(projects,proj.id).concat([proj.id]);
    if(activeId!==null&&ids.indexOf(activeId)>=0){ var now=Date.now(); finalizeProject(now); }
    setProjects(function(prev){ return prev.filter(function(p){ return ids.indexOf(p.id)<0; }); });
    setConfirmDelete(null);
  }
  function doMoveTasks(proj, targetParentId){
    if(activeId===proj.id){ var now=Date.now(); finalizeProject(now); }
    setProjects(function(prev){
      return prev.filter(function(p){ return p.id!==proj.id; }).map(function(p){
        return p.parentId===proj.id ? Object.assign({},p,{parentId:targetParentId||null}) : p;
      });
    });
    setConfirmDelete(null);
  }
  function updateStages(proj){
    setProjects(function(prev){ return prev.map(function(p){ return p.id===proj.id?proj:p; }); });
    setStagesProj(null);
  }
  // Quick toggle from the stage dropdown: flip one stage, keep the menu open.
  function toggleStageInline(projId, stageId){
    setProjects(function(prev){ return prev.map(function(p){
      if(p.id!==projId) return p;
      return Object.assign({},p,{stages:(p.stages||[]).map(function(st){
        if(st.id!==stageId) return st;
        return st.done ? Object.assign({},st,{done:false,doneAt:null,note:""})
                       : Object.assign({},st,{done:true,doneAt:Date.now()});
      })});
    }); });
  }
  function addLane(label, col){
    var key="custom_"+uid();
    setLaneMeta(function(prev){ var n=Object.assign({},prev); n[key]={label:label,accent:col.accent,bg:col.bg,dim:col.dim}; return n; });
    setLaneOrder(function(prev){ return prev.concat([key]); });
  }
  function saveLaneEdits(draft){
    setLaneMeta(function(prev){
      var n=Object.assign({},prev);
      Object.keys(draft).forEach(function(k){
        n[k]=Object.assign({},n[k]||{},{label:draft[k].label.trim()||((n[k]&&n[k].label)||k),accent:draft[k].accent,bg:draft[k].bg,dim:draft[k].dim});
      });
      return n;
    });
    setShowEditLanes(false);
  }
  function deleteLaneWithProjects(key, mode, target){
    var affectedIds = projects.filter(function(p){ return p.lane===key; }).map(function(p){ return p.id; });
    if(activeId!==null && affectedIds.indexOf(activeId)>=0){
      if(mode==="delete"){ var now=Date.now(); finalizeProject(now); }
    }
    if(mode==="move" && target){
      setProjects(function(prev){ return prev.map(function(p){ return p.lane===key?Object.assign({},p,{lane:target}):p; }); });
    } else {
      setProjects(function(prev){ return prev.filter(function(p){ return p.lane!==key; }); });
    }
    setLaneOrder(function(prev){ return prev.filter(function(k){ return k!==key; }); });
    setLaneMeta(function(prev){ var n=Object.assign({},prev); delete n[key]; return n; });
  }
  function deleteLane(key){
    setProjects(function(prev){ return prev.map(function(p){ return p.lane===key?Object.assign({},p,{lane:"Projects"}):p; }); });
    setLaneOrder(function(prev){ return prev.filter(function(k){ return k!==key; }); });
    setLaneMeta(function(prev){ var n=Object.assign({},prev); delete n[key]; return n; });
  }

  // Disruption button state values
  var dActive = interrupting;
  var dStandalone = !!(openDist&&!openDist.projectId);
  var dBg = dActive ? S.dangerBg2 : S.dangerBg;
  var dBdr = dActive ? S.distBdrLive : (dStandalone ? S.distBdrOpen : S.distBdr);
  var dBangCol = dActive ? S.dangerBright : S.bang;
  var dLblCol = S.dangerText;
  var dLbl = dActive ? "Resume" : (dStandalone ? "End" : "Disruption");
  var dSubLbl = dActive ? fmtDur(intElapsed,true) : (todayDist.length>0 ? todayDist.length+"x . "+fmtDur(todayDistMs,true) : "log one");

  // Work status bar values
  var wsActive = activeProj ? getMeta(laneMeta,activeProj.lane) : null;
  var wsBg = onBreak ? S.warnBg : (activeProj ? S.successBg : S.bg1);
  var wsBdr = onBreak ? S.statusEdgeBrk : (activeProj ? S.statusEdgeOn : S.border);
  var wsLblCol = onBreak ? S.warnText : (wsActive ? wsActive.accent : S.successDim);
  var wsTimCol = onBreak ? S.warnText : (wsActive ? wsActive.accent : S.successDim);
  var wsLabel = onBreak ? "On Break" : (activeProj ? "Active" : "At Work");
  var wsName = onBreak ? breakLabel : (activeProj ? activeProj.name : "General time");
  var wsElapsed = onBreak ? fmtDur(breakElapsed) : (activeProj ? fmtDur(elapsed) : fmtDur(atWorkElapsed));

  // Summary item color (mode-aware)
  var summaryCol = todayLogs.length ? S.actionText : S.textMuted;

  // Settings menu gear icon color (mode-aware)
  var mnIcon = menuOpen ? S.chromeIconOn : S.chromeText;

  // Clock header button
  var ckBg = clocked ? S.successBg2 : S.successBg;
  var ckBdr = clocked ? S.clockBdrOn : S.clockBdr;
  var ckIcon = clocked ? S.successText : S.successMid;
  var ckLblC = clocked ? S.successText : S.successMid;
  var ckSubC = S.successDim;
  var ckLbl = clocked ? "Clock Out" : "Clock In";
  var ckSub = clocked ? fmtDur(atWorkElapsed,true) : "start day";

  // Test-mode frame
  var FW = testMode ? 24 : 0;
  var frameLbl = { color:S.testFrameInk, fontSize:"0.66rem", fontWeight:800, letterSpacing:"0.3em", fontFamily:S.fontBody, whiteSpace:"nowrap" };

  // Handedness + header position
  var isLeft = settings.handedness==="left";
  UI.left = isLeft;
  var hdrBottom = settings.headerPos==="bottom";
  UI.bottom = hdrBottom;
  var hdrStyle = hdrBottom
    ? { position:"fixed", bottom:FW, left:FW, right:FW, zIndex:300, boxShadow:"0 -4px 24px rgba(0,0,0,0.55)" }
    : { position:"fixed", top:FW, left:FW, right:FW, zIndex:300, boxShadow:"0 4px 24px rgba(0,0,0,0.55)" };
  var spacerH = hdrBottom ? (testMode ? "32px" : "8px") : (testMode ? "132px" : "104px");
  var rootPadBottom = hdrBottom ? "178px" : "4rem";
  var ddTop = hdrBottom ? "auto" : "calc(100% + 6px)";
  var ddBottom = hdrBottom ? "calc(100% + 6px)" : "auto";
  UI.bottomClear = hdrBottom ? (114 + FW) : 0;
  UI.topClear = hdrBottom ? FW : (114 + FW);

  // ---- Screen ticker: date/time + live status ----
  var tickerStatus = null;
  if(interrupting && activeProj){
    tickerStatus = React.createElement("span", { style:{display:"flex",alignItems:"center",gap:"0.5rem",minWidth:0} },
      React.createElement("span", { style:{color:S.dangerBright,fontWeight:800,fontSize:"0.74rem",letterSpacing:"0.06em",animation:"ttBlink 1s linear infinite",whiteSpace:"nowrap"} }, "DISRUPTED"),
      React.createElement("span", { style:{color:S.dangerText,fontWeight:700,fontSize:"0.85rem",whiteSpace:"nowrap"} }, activeProj.name),
      React.createElement("span", { style:{color:S.dangerBright,fontWeight:800,fontSize:"0.74rem",letterSpacing:"0.06em",animation:"ttBlink 1s linear infinite",whiteSpace:"nowrap"} }, "DISRUPTED")
    );
  } else if(activeProj){
    tickerStatus = React.createElement("span", { style:{display:"flex",alignItems:"center",gap:"0.5rem",minWidth:0} },
      React.createElement("span", { style:{color:wsActive?wsActive.accent:S.text,fontWeight:700,fontSize:"0.85rem",whiteSpace:"nowrap"} }, activeProj.name),
      React.createElement(Mono, { style:{color:wsActive?wsActive.accent:S.text,fontWeight:500,fontSize:"0.8rem",whiteSpace:"nowrap"} }, fmtDur(elapsed,true))
    );
  } else if(onBreak){
    tickerStatus = React.createElement("span", { style:{display:"flex",alignItems:"center",gap:"0.5rem"} },
      React.createElement("span", { style:{color:S.warnText,fontWeight:700,fontSize:"0.85rem",whiteSpace:"nowrap"} }, "On Break - "+breakLabel),
      React.createElement(Mono, { style:{color:S.warnText,fontWeight:500,fontSize:"0.8rem",whiteSpace:"nowrap"} }, fmtDur(breakElapsed,true))
    );
  } else if(clocked){
    tickerStatus = React.createElement("span", { style:{display:"flex",alignItems:"center",gap:"0.5rem"} },
      React.createElement("span", { style:{color:S.successText,fontWeight:700,fontSize:"0.85rem",whiteSpace:"nowrap"} }, "Day Started"),
      React.createElement(Mono, { style:{color:S.successDim,fontWeight:500,fontSize:"0.8rem",whiteSpace:"nowrap"} }, fmtDur(atWorkElapsed,true))
    );
  }
  var tickerDate = React.createElement("span", { style:{color:S.titleText,fontWeight:700,fontSize:"0.88rem",fontFamily:S.fontBody,whiteSpace:"nowrap"} },
    new Date(nowTick).toLocaleDateString([],{weekday:"short",month:"short",day:"numeric"})
  );
  var tickerTime = React.createElement(Mono, { style:{color:S.text,fontSize:"0.88rem",fontWeight:700,whiteSpace:"nowrap"} }, fmtTime(nowTick));
  function tickerUnit(k){
    return React.createElement("span", { key:"tk"+k, style:{display:"inline-flex",alignItems:"center",gap:"0.75rem",paddingRight:"3.5rem",whiteSpace:"nowrap",minWidth:"100vw"} },
      tickerDate, tickerTime, tickerStatus
    );
  }
  var tickerEl = React.createElement("div", { dir:"ltr", style:{display:"flex",alignItems:"center",padding:"0.25rem 0.85rem",minHeight:"28px",background:S.bg2,borderBottom:hdrBottom?"none":"1px solid "+S.border,boxShadow:hdrBottom?"inset 0 1px 0 "+S.border:"none",overflow:"hidden",whiteSpace:"nowrap"} },
    React.createElement("div", { style:{display:"inline-flex",alignItems:"center",whiteSpace:"nowrap",animation:"ttScroll 14s linear infinite",willChange:"transform"} },
      [0,1,2,3,4,5].map(function(k){ return tickerUnit(k); })
    )
  );

  return (
    React.createElement("div", { dir:isLeft?"rtl":"ltr", style:{minHeight:"100vh",background:S.bg0,color:S.text,fontFamily:S.fontBody,paddingBottom:rootPadBottom,paddingLeft:FW,paddingRight:FW} },
      React.createElement("style", null,
        "@import url('"+S.fontImport+"'); "+
        "@keyframes ttBlink { 0%,55% { opacity:1; } 56%,100% { opacity:0.12; } } "+
        "@keyframes ttScroll { 0% { transform:translateX(0); } 100% { transform:translateX(-16.6667%); } } "+
        // Running projects breathe: border color and glow ease between the
        // lane accent and a brightened peak. Driven by CSS vars so one rule
        // serves every lane color.
        "@keyframes ttPulse { 0%,100% { border-color:var(--pulse-a); box-shadow:0 0 8px var(--pulse-s1); } 50% { border-color:var(--pulse-b); box-shadow:0 0 20px var(--pulse-s2); } } "+
        "[data-pulse='1']{ animation: ttPulse 2.4s ease-in-out infinite; } "+
        // iOS renders a time input's value inside shadow parts with their own
        // UA background and color. Make every part transparent and force it to
        // carry the input's color; -webkit-text-fill-color outranks UA color.
        "input[type='time'],input[type='date']{ -webkit-appearance:none; appearance:none; } "+
        "input[type='time']::-webkit-date-and-time-value,input[type='date']::-webkit-date-and-time-value{ text-align:center; min-height:1.15em; margin:0; background:transparent; color:inherit; -webkit-text-fill-color:currentColor; } "+
        "input[type='time']::-webkit-datetime-edit,input[type='date']::-webkit-datetime-edit,"+
        "input[type='time']::-webkit-datetime-edit-fields-wrapper,input[type='date']::-webkit-datetime-edit-fields-wrapper,"+
        "input[type='time']::-webkit-datetime-edit-hour-field,input[type='time']::-webkit-datetime-edit-minute-field,"+
        "input[type='time']::-webkit-datetime-edit-ampm-field,input[type='date']::-webkit-datetime-edit-month-field,"+
        "input[type='date']::-webkit-datetime-edit-day-field,input[type='date']::-webkit-datetime-edit-year-field,"+
        "input[type='time']::-webkit-datetime-edit-text,input[type='date']::-webkit-datetime-edit-text{ "+
        "background:transparent; color:inherit; -webkit-text-fill-color:currentColor; padding:0; } "+
        S.themeCss),

      // ---- TEST MODE FRAME ----
      testMode && React.createElement("div", { style:{pointerEvents:"none"} },
        React.createElement("div", { style:{position:"fixed",top:0,left:0,right:0,height:"24px",background:S.testFrameBg,borderBottom:"2px solid "+S.testFrameInk+"",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center"} },
          React.createElement("span", { style:frameLbl }, "TEST MODE")
        ),
        React.createElement("div", { style:{position:"fixed",bottom:0,left:0,right:0,height:"24px",background:S.testFrameBg,borderTop:"2px solid "+S.testFrameInk+"",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center"} },
          React.createElement("span", { style:frameLbl }, "TEST MODE")
        ),
        React.createElement("div", { style:{position:"fixed",top:0,bottom:0,left:0,width:"24px",background:S.testFrameBg,borderRight:"2px solid "+S.testFrameInk+"",zIndex:399,display:"flex",alignItems:"center",justifyContent:"center"} },
          React.createElement("span", { style:Object.assign({},frameLbl,{transform:"rotate(-90deg)"}) }, "TEST MODE")
        ),
        React.createElement("div", { style:{position:"fixed",top:0,bottom:0,right:0,width:"24px",background:S.testFrameBg,borderLeft:"2px solid "+S.testFrameInk+"",zIndex:399,display:"flex",alignItems:"center",justifyContent:"center"} },
          React.createElement("span", { style:Object.assign({},frameLbl,{transform:"rotate(90deg)"}) }, "TEST MODE")
        )
      ),

      // ---- STICKY HEADER ----
      React.createElement("div", { style:hdrStyle },
        hdrBottom ? null : tickerEl,
        // Top bar: More | Add | Disruption
        React.createElement("div", { style:{display:"flex",alignItems:"stretch",background:S.bg1,borderBottom:"2px solid "+S.border,padding:"0.5rem 0.75rem",gap:"0.5rem"} },
          // SETTINGS MENU button (gear) + stacked dropdown
          React.createElement("div", { ref:menuRef, style:{position:"relative",flex:"0 0 64px"} },
            React.createElement("button", { onClick:function(){ if(!menuOpen){ try{ window.dispatchEvent(new Event("ttCloseMenus")); }catch(e){} } setMenuOpen(function(x){ return !x; }); setAddMenuOpen(false); },
              style:{width:"100%",minHeight:"56px",display:"flex",alignItems:"center",justifyContent:"center",background:menuOpen?S.bg3:S.bg0,border:"2.5px solid "+(menuOpen?S.chromeBdrOn:S.chromeBdr),borderRadius:S.radius2,cursor:"pointer"} },
              React.createElement(GearSVG, { size:30, col:mnIcon })
            ),
            menuOpen && React.createElement("div", { dir:"ltr", "data-surface":"menu", "data-menu-open":"1", style:{position:"absolute",top:ddTop,bottom:ddBottom,left:isLeft?"auto":0,right:isLeft?0:"auto",minWidth:"290px",maxWidth:"94vw",maxHeight:"72vh",overflowY:"auto",background:S.menuBg,border:"1px solid "+S.border,borderRadius:S.radius2,boxShadow:"0 8px 32px rgba(0,0,0,0.6)",zIndex:200} },
              // Add New Item (accordion)
              React.createElement("button", { "data-flat":true, onClick:function(){ if(!addMenuOpen){ try{ window.dispatchEvent(new Event("ttCloseMenus")); }catch(e){} } setAddMenuOpen(function(x){ return !x; }); },
                style:{display:"flex",alignItems:"center",gap:"0.5rem",width:"100%",textAlign:"left",background:addMenuOpen?S.successBg2:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.8rem 1rem",color:S.successMid,cursor:"pointer",fontFamily:S.fontBody,fontWeight:700,fontSize:"0.95rem",whiteSpace:"nowrap"} },
                React.createElement("svg", { width:14, height:14, viewBox:"0 0 14 14", fill:"none" },
                  React.createElement("path", { d:"M7 2 L7 12 M2 7 L12 7", stroke:S.successMid, strokeWidth:"2.5", strokeLinecap:"round" })
                ),
                React.createElement("span", { style:{flex:1} }, "Add New Item"),
                React.createElement("span", { style:{fontSize:"0.8rem",color:S.successDim} }, addMenuOpen?"v":">")
              ),
              addMenuOpen && React.createElement("div", { style:{background:rgba(S.bg0,0.5),borderBottom:"1px solid "+S.border} },
                laneOrder.map(function(laneKey){
                  var m=getMeta(laneMeta,laneKey);
                  return React.createElement("button", { "data-flat":true, key:laneKey, onClick:function(){ closeAllPopups(); setShowAdd({lane:laneKey,parentId:null}); },
                    style:{display:"flex",alignItems:"center",gap:"0.65rem",width:"100%",background:"none",border:"none",padding:"0.7rem 1rem 0.7rem 2rem",cursor:"pointer",fontFamily:S.fontBody,textAlign:"left"} },
                    React.createElement("div", { style:{width:"10px",height:"10px",borderRadius:"50%",background:m.accent,flexShrink:0} }),
                    React.createElement("span", { style:{fontSize:"0.92rem",fontWeight:600,color:S.text,whiteSpace:"nowrap"} }, m.label)
                  );
                }),
                React.createElement("button", { "data-flat":true, onClick:function(){ closeAllPopups(); setShowNewLane(true); },
                  style:{display:"flex",alignItems:"center",gap:"0.65rem",width:"100%",background:"none",border:"none",padding:"0.7rem 1rem 0.7rem 2rem",cursor:"pointer",fontFamily:S.fontBody,textAlign:"left"} },
                  React.createElement("div", { style:{width:"10px",height:"10px",borderRadius:"2px",border:"2px dashed #444",flexShrink:0} }),
                  React.createElement("span", { style:{fontSize:"0.92rem",fontWeight:600,color:S.mutedGlyph,whiteSpace:"nowrap"} }, "+ New Lane")
                ),
                React.createElement("button", { onClick:function(){ closeAllPopups(); setShowEditLanes(true); },
                  style:{display:"flex",alignItems:"center",gap:"0.65rem",width:"100%",background:"none",border:"none",padding:"0.7rem 1rem 0.7rem 2rem",cursor:"pointer",fontFamily:S.fontBody,textAlign:"left"} },
                  React.createElement(GearSVG, { size:12, col:S.mutedGlyph }),
                  React.createElement("span", { style:{fontSize:"0.92rem",fontWeight:600,color:S.mutedGlyph,whiteSpace:"nowrap"} }, "Edit Lanes")
                )
              ),
              // Time Settings (accordion): the schedule and how time is captured
              React.createElement("button", { "data-flat":true, onClick:function(){ setTimeMenuOpen(function(x){ return !x; }); setAddMenuOpen(false); },
                style:{display:"flex",alignItems:"center",gap:"0.5rem",width:"100%",textAlign:"left",background:timeMenuOpen?rgba(S.bg0,0.5):"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.8rem 1rem",color:S.text,cursor:"pointer",fontFamily:S.fontBody,fontWeight:600,fontSize:"0.95rem",whiteSpace:"nowrap"} },
                React.createElement("svg", { width:14, height:14, viewBox:"0 0 28 28", fill:"none" },
                  React.createElement("circle", { cx:"14", cy:"14", r:"11", stroke:S.chromeText, strokeWidth:"2.5" }),
                  React.createElement("path", { d:"M14 8 L14 14 L18 17", stroke:S.chromeText, strokeWidth:"2.5", strokeLinecap:"round", strokeLinejoin:"round" })
                ),
                React.createElement("span", { style:{flex:1} }, "Time Settings"),
                React.createElement("span", { style:{fontSize:"0.8rem",color:S.textDim} }, timeMenuOpen?"v":">")
              ),
              timeMenuOpen && React.createElement("div", { style:{background:rgba(S.bg0,0.5),borderBottom:"1px solid "+S.border} },
                React.createElement("button", { "data-flat":true, onClick:function(){ closeAllPopups(); setShowSchedule(true); },
                  style:{display:"flex",alignItems:"center",gap:"0.65rem",width:"100%",background:"none",border:"none",padding:"0.7rem 1rem 0.7rem 2rem",cursor:"pointer",fontFamily:S.fontBody,textAlign:"left"} },
                  React.createElement("span", { style:{fontSize:"0.92rem",fontWeight:600,color:S.text,whiteSpace:"nowrap"} }, "Work Schedule")
                ),
                React.createElement("button", { "data-flat":true, onClick:function(){ closeAllPopups(); setShowTracking(true); },
                  style:{display:"flex",alignItems:"center",gap:"0.65rem",width:"100%",background:"none",border:"none",padding:"0.7rem 1rem 0.7rem 2rem",cursor:"pointer",fontFamily:S.fontBody,textAlign:"left"} },
                  React.createElement("span", { style:{fontSize:"0.92rem",fontWeight:600,color:S.text,whiteSpace:"nowrap"} }, "Tracking")
                )
              ),
              // Settings
              React.createElement("button", { "data-flat":true, onClick:function(){ closeAllPopups(); setShowSettings(true); },
                style:{display:"flex",alignItems:"center",gap:"0.5rem",width:"100%",textAlign:"left",background:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.8rem 1rem",color:S.text,cursor:"pointer",fontFamily:S.fontBody,fontWeight:600,fontSize:"0.95rem",whiteSpace:"nowrap"} },
                React.createElement(GearSVG, { size:14, col:S.chromeText }),
                React.createElement("span", null, "Themes and Layout")
              ),
              // Summary
              React.createElement("button", { "data-flat":true, onClick:function(){ if(todayLogs.length){ closeAllPopups(); setShowDay(true); } },
                style:{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.8rem 1rem",color:summaryCol,cursor:todayLogs.length?"pointer":"default",fontFamily:S.fontBody,fontWeight:600,fontSize:"0.95rem",whiteSpace:"nowrap"} },
                "Summary"
              ),
              // Reports
              React.createElement("button", { "data-flat":true, onClick:function(){ closeAllPopups(); setShowReports(true); },
                style:{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.8rem 1rem",color:S.text,cursor:"pointer",fontFamily:S.fontBody,fontWeight:600,fontSize:"0.95rem",whiteSpace:"nowrap"} },
                "Reports"
              ),
              // Backup & Restore
              React.createElement("button", { "data-flat":true, onClick:function(){ closeAllPopups(); setShowBackup(true); },
                style:{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.8rem 1rem",color:S.text,cursor:"pointer",fontFamily:S.fontBody,fontWeight:600,fontSize:"0.95rem",whiteSpace:"nowrap"} },
                "Backup & Restore"
              ),
              // Module rows: one group header, then one row per enabled module
              // that declares a nav entry. Renders nothing while none exist.
              modGroups.map(function(g){
                return React.createElement("div", { key:g.name },
                  React.createElement("div", { style:{padding:"0.55rem 1rem 0.35rem",color:S.textDim,fontSize:"0.66rem",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.09em",borderBottom:"1px solid "+S.border,background:rgba(S.bg0,0.5),whiteSpace:"nowrap"} }, g.name),
                  g.items.map(function(entry){
                    return React.createElement("button", { "data-flat":true, key:entry.id+":"+entry.screen,
                      onClick:function(){ openModule(entry); },
                      style:{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.8rem 1rem",color:S.text,cursor:"pointer",fontFamily:S.fontBody,fontWeight:600,fontSize:"0.95rem",whiteSpace:"nowrap"} },
                      entry.label);
                  })
                );
              }),
              // Arrange
              React.createElement("button", { "data-flat":true, onClick:function(){ setEditMode(function(x){ return !x; }); setMenuOpen(false); },
                style:{display:"block",width:"100%",textAlign:"left",background:editMode?S.bg3:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.8rem 1rem",color:editMode?S.arrangeText:S.text,cursor:"pointer",fontFamily:S.fontBody,fontWeight:editMode?700:600,fontSize:"0.95rem",whiteSpace:"nowrap"} },
                editMode?"Done Arranging":"Arrange"
              ),
              // Test mode
              React.createElement("button", { "data-flat":true, onClick:function(){ if(testMode){ closeAllPopups(); setShowTestConfirm(true); } else { setTestMode(true); setMenuOpen(false); } },
                style:{display:"block",width:"100%",textAlign:"left",background:testMode?S.warnBg:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.8rem 1rem",color:testMode?S.warnText:S.text,cursor:"pointer",fontFamily:S.fontBody,fontWeight:testMode?700:600,fontSize:"0.95rem",whiteSpace:"nowrap"} },
                testMode?"Exit Test Mode":"Test Mode"
              ),
              // Work status + break (clock in/out live in header)
              clocked && React.createElement("div", null,
                React.createElement("div", { style:{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"0.75rem",padding:"0.7rem 1rem",borderBottom:"1px solid "+S.border,background:wsBg,whiteSpace:"nowrap"} },
                  React.createElement("div", { style:{minWidth:0} },
                    React.createElement("div", { style:{fontSize:"0.66rem",textTransform:"uppercase",letterSpacing:"0.09em",fontWeight:700,color:wsLblCol} }, wsLabel),
                    React.createElement("div", { style:{fontWeight:700,fontSize:"0.88rem",overflow:"hidden",textOverflow:"ellipsis",color:S.text,maxWidth:"180px"} }, wsName)
                  ),
                  React.createElement(Mono, { style:{fontSize:"1.15rem",fontWeight:500,color:wsTimCol,lineHeight:1,flexShrink:0} }, wsElapsed)
                ),
                onBreak
                  ? React.createElement("button", { "data-flat":true, onClick:function(){ endBreak(); },
                      style:{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.8rem 1rem",color:S.successText,cursor:"pointer",fontFamily:S.fontBody,fontWeight:700,fontSize:"0.95rem",whiteSpace:"nowrap"} },
                      "End Break"
                    )
                  : React.createElement("button", { "data-flat":true, onClick:function(){ closeAllPopups(); setShowBreak(true); },
                      style:{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.8rem 1rem",color:S.warnText,cursor:"pointer",fontFamily:S.fontBody,fontWeight:700,fontSize:"0.95rem",whiteSpace:"nowrap"} },
                      "Break"
                    )
              ),
              editMode && React.createElement("div", { style:{padding:"0.55rem 1rem",background:S.bg3,color:S.arrangeHint,fontSize:"0.74rem",whiteSpace:"nowrap"} }, "Drag handles to reorder lanes and cards")
            )
          ),
          // CLOCK button
          React.createElement("button", { onClick:function(){ if(clocked){ clockOut(); } else { clockIn(); } setMenuOpen(false); setAddMenuOpen(false); },
            style:{flex:1,minHeight:"56px",display:"flex",alignItems:"center",justifyContent:"center",gap:"0.55rem",background:ckBg,border:"2.5px solid "+ckBdr,borderRadius:S.radius2,cursor:"pointer"} },
            React.createElement("svg", { width:28, height:28, viewBox:"0 0 28 28", fill:"none" },
              React.createElement("circle", { cx:"14", cy:"14", r:"11", stroke:ckIcon, strokeWidth:"2.5" }),
              React.createElement("path", { d:"M14 8 L14 14 L18 17", stroke:ckIcon, strokeWidth:"2.5", strokeLinecap:"round", strokeLinejoin:"round" })
            ),
            React.createElement("div", { style:{display:"flex",flexDirection:"column",alignItems:"flex-start",gap:"0.08rem"} },
              React.createElement("span", { style:{fontSize:"1rem",fontWeight:700,color:ckLblC,fontFamily:S.fontBody,lineHeight:1,whiteSpace:"nowrap"} }, ckLbl),
              React.createElement(Mono, { style:{fontSize:"0.72rem",color:ckSubC,lineHeight:1,whiteSpace:"nowrap"} }, ckSub)
            )
          ),
          // DISRUPTION button + presets dropdown
          React.createElement("div", { ref:distMenuRef, style:{position:"relative",flex:1} },
            React.createElement("button", {
              onClick:function(){
                if(dStandalone){ closeDisruption(); }
                else if(interrupting){ resumeProject(); }
                else if(distMenuOpen){ setDistMenuOpen(false); }
                else { closeAllPopups(); setDistMenuOpen(true); }
              },
              style:{width:"100%",minHeight:"56px",display:"flex",alignItems:"center",justifyContent:"center",gap:"0.55rem",background:dBg,border:"2.5px solid "+dBdr,borderRadius:S.radius2,cursor:"pointer"}
            },
              React.createElement("span", { style:{fontSize:"1.6rem",fontWeight:900,color:dBangCol,letterSpacing:"-0.08em",lineHeight:1,fontFamily:S.fontBody} }, "!!"),
              React.createElement("div", { style:{display:"flex",flexDirection:"column",alignItems:"flex-start",gap:"0.1rem"} },
                React.createElement("span", { style:{fontSize:"1rem",fontWeight:700,color:dLblCol,fontFamily:S.fontBody,lineHeight:1,whiteSpace:"nowrap"} }, dLbl),
                React.createElement(Mono, { style:{fontSize:"0.72rem",color:S.dangerText,opacity:0.75,lineHeight:1,whiteSpace:"nowrap"} }, dSubLbl)
              )
            ),
            distMenuOpen && React.createElement("div", { style:{position:"absolute",top:ddTop,bottom:ddBottom,right:isLeft?"auto":0,left:isLeft?0:"auto",minWidth:"250px",maxWidth:"94vw",maxHeight:"72vh",overflowY:"auto",background:S.menuBg,border:"1px solid #4A1A1A",borderRadius:S.radius2,boxShadow:"0 8px 32px rgba(0,0,0,0.6)",zIndex:200,padding:"0.5rem",display:"flex",flexDirection:"column",gap:"0.4rem"} },
              distPresets.map(function(label,i){
                return React.createElement("button", { key:i, onClick:function(){ setDistMenuOpen(false); startDisruptionWith(label, activeProj||null); },
                  style:{display:"flex",alignItems:"center",gap:"0.55rem",width:"100%",textAlign:"left",background:S.dangerBg,border:"2.5px solid #AA4040",borderRadius:"10px",padding:"0.6rem 0.85rem",cursor:"pointer",fontFamily:S.fontBody} },
                  React.createElement("span", { style:{fontSize:"1.25rem",fontWeight:900,color:S.bang,letterSpacing:"-0.08em",lineHeight:1,flexShrink:0} }, "!!"),
                  React.createElement("span", { style:{fontSize:"0.95rem",fontWeight:700,color:S.dangerText,whiteSpace:"nowrap"} }, label)
                );
              }),
              React.createElement("button", { onClick:function(){ setDistMenuOpen(false); openDisrupt(activeProj||null); },
                style:{display:"flex",alignItems:"center",gap:"0.55rem",width:"100%",textAlign:"left",background:S.bg1,border:"2px solid #5A3030",borderRadius:"10px",padding:"0.55rem 0.85rem",cursor:"pointer",fontFamily:S.fontBody} },
                React.createElement("span", { style:{fontSize:"1.1rem",fontWeight:700,color:S.distNote,flexShrink:0,lineHeight:1} }, "+"),
                React.createElement("span", { style:{fontSize:"0.9rem",fontWeight:600,color:S.distNote,whiteSpace:"nowrap"} }, "Custom note...")
              ),
              React.createElement("button", { onClick:function(){ closeAllPopups(); setShowEditPresets(true); },
                style:{display:"flex",alignItems:"center",gap:"0.55rem",width:"100%",textAlign:"left",background:S.bg1,border:"2px solid "+S.borderBright,borderRadius:"10px",padding:"0.55rem 0.85rem",cursor:"pointer",fontFamily:S.fontBody} },
                React.createElement(GearSVG, { size:14, col:S.chromeText }),
                React.createElement("span", { style:{fontSize:"0.9rem",fontWeight:600,color:S.chromeText,whiteSpace:"nowrap"} }, "Edit List")
              )
            )
          )
        ),
        hdrBottom ? tickerEl : null
      ),

      // ---- SPACER (reserves room for fixed header) ----
      React.createElement("div", { style:{height:spacerH} }),

      // ---- LANES ----
      React.createElement("div", { style:{padding:"1rem 0.85rem 0"} },
        laneOrder.map(function(lane, laneIdx){
          return React.createElement(LaneSection, {
            key:lane, lane:lane, allProjects:projects, activeId:activeId,
            interrupting:interrupting, elapsed:elapsed,
            todayLogs:todayLogs, todayDist:disruptions,
            onToggle:toggleProject,
            onEdit:function(p){ closeAllPopups(); setEditProj(p); },
            onStages:function(p){ closeAllPopups(); setStagesProj(p); },
            onStageToggle:toggleStageInline,
            onAddSub:function(parentId){ closeAllPopups(); setShowAdd({lane:lane,parentId:parentId}); },
            laneOrder:laneOrder,
            onPickLane:function(k){ closeAllPopups(); setShowAdd({lane:k,parentId:null}); },
            onNewLane:function(){ closeAllPopups(); setShowNewLane(true); },
            onEditLanes:function(){ closeAllPopups(); setShowEditLanes(true); },
            editMode:editMode, laneMeta:laneMeta, onDeleteLane:deleteLane,
            onDragStart:function(e,idx){ /* lane-level drag placeholder */ },
            laneHandle:{ onMouseDown:function(e){ e.preventDefault(); }, onTouchStart:function(e){ e.preventDefault(); } }
          });
        })
      ),

      // ---- MODALS ----
      showAdd && React.createElement(Modal, { title:showAdd.parentId?"Add Task":"Add to "+(getMeta(laneMeta,showAdd.lane).label), onClose:function(){ setShowAdd(null); } , ownActions:true },
        React.createElement(ProjectForm, { onSave:addProject, onCancel:function(){ setShowAdd(null); }, defaultLane:showAdd.lane, defaultParentId:showAdd.parentId, parents:projects, laneMeta:laneMeta, laneOrder:laneOrder })
      ),
      editProj && React.createElement(Modal, { title:editProj.parentId?"Edit Task":"Edit Project", onClose:function(){ setEditProj(null); } , ownActions:true },
        React.createElement(ProjectForm, { project:editProj, onSave:saveEdit, onCancel:function(){ setEditProj(null); }, onDelete:deleteProject, parents:projects, laneMeta:laneMeta, laneOrder:laneOrder })
      ),
      stagesProj && React.createElement(StagesModal, { proj:stagesProj, onClose:function(){ setStagesProj(null); }, onUpdate:updateStages }),
      showDisrupt && React.createElement(DisruptionModal, { projName:disruptTarget?disruptTarget.name:null, onStart:startDisruption, onCancel:function(){ setShowDisrupt(false); } }),
      showBreak && React.createElement(BreakModal, { onStart:startBreak, onCancel:function(){ setShowBreak(false); } }),
      showDay && React.createElement(DaySummary, { logs:todayLogs, disruptions:disruptions, breaks:todayBreaks, onClose:function(){ setShowDay(false); }, testMode:testMode }),
      notifToast && React.createElement("div", { "data-surface":"panel", role:"status",
        onClick:function(){ setNotifToast(null); },
        style:{position:"fixed",left:"50%",transform:"translateX(-50%)",
               top:"calc(env(safe-area-inset-top, 0px) + 3.4rem)",zIndex:950,maxWidth:"min(92vw, 380px)",
               background:S.bg1,border:"2px solid "+S.borderBright,borderRadius:S.radius,
               padding:"0.6rem 0.9rem",boxShadow:"0 6px 24px rgba(0,0,0,0.35)",cursor:"pointer"} },
        React.createElement("div", { style:{color:S.text,fontWeight:700,fontSize:"0.86rem",fontFamily:S.fontBody} }, notifToast.title),
        React.createElement("div", { style:{color:S.textDim,fontSize:"0.78rem",marginTop:"0.15rem",fontFamily:S.fontBody} }, notifToast.body)
      ),
      showBackup && React.createElement(BackupModal, { onClose:function(){ setShowBackup(false); } }),
      // Module screens mount here: a sibling of the core modals, never nested
      // inside a backdrop-filter surface, so the glass themes stay correct.
      modScreen && ttModuleScreen(modScreen.id, modScreen.screen) &&
        React.createElement(ttModuleScreen(modScreen.id, modScreen.screen),
          ttModuleContext(modScreen.id, {
            settings:settings, projects:projects, logs:logs, laneMeta:laneMeta,
            laneOrder:laneOrder, testMode:testMode, schedule:settings.workSchedule,
            onClose:function(){ setModScreen(null); }
          })),
      showReports && React.createElement(ReportsModal, { logs:logs, projects:projects, disruptions:disruptions,
        breaks:breaks, laneMeta:laneMeta, laneOrder:laneOrder, schedule:settings.workSchedule, testMode:testMode,
        liveLogs:liveLogs(), onClose:function(){ setShowReports(false); } }),
      showNewLane && React.createElement(NewLaneModal, { onSave:function(label,col){ addLane(label,col); setShowNewLane(false); }, onCancel:function(){ setShowNewLane(false); } }),
      showEditLanes && React.createElement(EditLanesModal, { laneOrder:laneOrder, laneMeta:laneMeta, projects:projects, onDeleteLane:deleteLaneWithProjects, onSave:saveLaneEdits, onCancel:function(){ setShowEditLanes(false); } }),
      confirmDelete && React.createElement(DeleteProjectModal, { proj:confirmDelete, allProjects:projects, laneMeta:laneMeta, onMoveTasks:doMoveTasks, onDeleteAll:doDeleteAll, onCancel:function(){ setConfirmDelete(null); } }),
      showSettings && React.createElement(SettingsModal, { settings:settings, onChange:setSettings, onClose:function(){ setShowSettings(false); } }),
      showSchedule && React.createElement(WorkScheduleModal, { schedule:settings.workSchedule,
        onSave:function(sch){ setSettings(Object.assign({},settings,{workSchedule:sch})); setShowSchedule(false); },
        onClose:function(){ setShowSchedule(false); } }),
      showTracking && React.createElement(TrackingModal, { settings:settings, onChange:setSettings,
        onClose:function(){ setShowTracking(false); } }),
      showEditPresets && React.createElement(EditDistPresetsModal, { presets:distPresets, onSave:function(items){ setDistPresets(items.length?items:DEFAULT_DIST_PRESETS); setShowEditPresets(false); }, onCancel:function(){ setShowEditPresets(false); } }),
      showTestConfirm && React.createElement(Modal, { title:"Exit Test Mode", onClose:function(){ setShowTestConfirm(false); } },
        React.createElement("p", { style:{color:S.textDim,marginBottom:"1rem",fontSize:"0.9rem"} }, "Exit test mode? Test data will be cleared."),
        React.createElement("div", { style:{display:"flex",gap:"0.5rem"} },
          React.createElement("button", { onClick:function(){ setTestMode(false); setShowTestConfirm(false); }, style:{flex:1,background:S.warnBg,border:"1px solid "+S.warnText,borderRadius:S.radius,padding:"0.85rem",color:S.warnText,cursor:"pointer",fontWeight:700,fontFamily:S.fontBody} }, "Exit Test Mode"),
          React.createElement("button", { onClick:function(){ setShowTestConfirm(false); }, style:{flex:1,background:S.bg1,border:"1px solid "+S.border,borderRadius:S.radius,padding:"0.85rem",color:S.textDim,cursor:"pointer",fontFamily:S.fontBody} }, "Stay in Test")
        )
      )
    )
  );
}
