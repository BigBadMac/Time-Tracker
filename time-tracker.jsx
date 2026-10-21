import { useState, useEffect, useRef } from "react";

// ---- CONSTANTS ---------------------------------------------------------------
var LANES = {
  ACTIVITY: "Daily Activity",
  MAIN:     "Projects",
  SIDE:     "Side Projects"
};
var DEFAULT_META = {
  "Daily Activity":  { label:"First Lane",  accent:"#4A9C6B", bg:"#0A1A0A", dim:"#1A3A1A" },
  "Projects":        { label:"Second Lane", accent:"#4B8EC8", bg:"#0A141F", dim:"#1A3050" }
};
// Working names for the tutorial: generic enough for a shop floor, an office
// or a workshop to recognise, and specific enough to read as real work.
var TEST_META = {
  "Daily Activity":  { label:"Daily Routine",    accent:"#4A9C6B", bg:"#0A1A0A", dim:"#1A3A1A" },
  "Projects":        { label:"Current Jobs",     accent:"#4B8EC8", bg:"#0A141F", dim:"#1A3050" },
  "Side Projects":   { label:"When Time Allows", accent:"#9B6DD6", bg:"#140A1F", dim:"#3A1A5C" }
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
// First run: two lanes, named after what they are. A new board arrives almost
// empty, and the names teach the vocabulary before any examples do.
var DEFAULT_ORDER = ["Daily Activity","Projects"];
// The tutorial has its own lanes, so learning in it cannot touch a real board.
var TEST_ORDER = ["Daily Activity","Projects","Side Projects"];
var PRESET_BREAKS = ["Morning Break","Lunch","Afternoon Break","End of Day"];
var DEFAULT_DIST_PRESETS = ["Phone Call","Walk-in Visitor","Crew Question","Machine Issue"];

// ---- HELPERS -----------------------------------------------------------------
function pad(n){ return String(n).padStart(2,"0"); }
// A record id. LONG and random, so ids made on different phones never meet -
// the shared board needs that (HANDOVER: multi-user). A standard UUID where
// the browser has one, otherwise 24 random base-36 characters. Ids made before
// 10-20 are 7 characters and keep working: nothing reads an id's shape.
function uid(){
  try{ if(typeof crypto!=="undefined" && crypto && typeof crypto.randomUUID==="function") return crypto.randomUUID(); }catch(e){}
  var s=""; while(s.length<24) s+=Math.random().toString(36).slice(2);
  return s.slice(0,24);
}
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
// ---- WORK DAY ---------------------------------------------------------------
// Which work day a moment belongs to. Right now that is the calendar day, which
// is what every surface has always assumed. It lives in one function so the
// rule can become shift-relative without hunting down date maths everywhere:
// nothing else in the app is allowed to call toDateString() on a record.
function workDayOf(ts){ return new Date(ts).toDateString(); }
function todayStr(){ return workDayOf(Date.now()); }
function sameWorkDay(ts, dayKey){ return !!ts && workDayOf(ts)===dayKey; }
function haptic(pattern){ try{ if(navigator&&navigator.vibrate) navigator.vibrate(pattern||10); }catch(e){} }
// ---------------- The store: one doorway to the board's data ----------------
// Every core read and write of the board goes through ttDb, never straight to
// localStorage. The backend is anything shaped like localStorage (getItem,
// setItem, removeItem, key, length) - the browser's own by default. A sync
// layer, or a test, swaps it with ttDbUse(); nothing above this line knows.
// This is the seam the shared board is built on (HANDOVER: multi-user).
var TT_DB_BACKEND = null;          // null = the browser's localStorage
function ttDbBackend(){
  if(TT_DB_BACKEND) return TT_DB_BACKEND;
  try{ return localStorage; }catch(e){ return null; }
}
function ttDbUse(backend){ TT_DB_BACKEND = backend || null; return ttDbBackend(); }
var ttDb = {
  backend: ttDbBackend,
  // Raw strings: for the few keys stored as plain text rather than JSON.
  getRaw: function(k){ try{ var b=ttDbBackend(); return b ? b.getItem(k) : null; }catch(e){ return null; } },
  setRaw: function(k, v){ try{ var b=ttDbBackend(); if(!b) return false; b.setItem(k, v); return true; }catch(e){ return false; } },
  remove: function(k){ try{ var b=ttDbBackend(); if(b) b.removeItem(k); }catch(e){} }
};
// JSON reads and writes. A missing, empty or corrupt value reads as the
// default; a failed write (quota, private mode) is swallowed, as it always was.
function load(key, def){ try{ var v=ttDb.getRaw(key); return v?JSON.parse(v):def; }catch(e){ return def; } }
function save(key, val){ try{ ttDb.setRaw(key, JSON.stringify(val)); }catch(e){} }

// ---------------- Change tracking (the shared board, step 2) ----------------
// A sync layer has to know what changed and what went. Both are worked out
// HERE, at save time, against what is already stored - so not one of the
// app's setters has to remember to stamp anything:
//   - a record that is new, or whose content changed, gets updatedAt = now;
//   - an unchanged record is written back exactly as stored (its updatedAt,
//     or none: absent means "not changed since tracking began");
//   - a record that has gone leaves a tombstone { id, at } under tt_gone.
// Only the real board is tracked. The Practice Board is never shared.
// Record-level for now; a field-level merge (the agreed "later edit wins per
// field") can diff two versions when the sync layer exists.
var TT_TRACKED = ["tt_projects","tt_logs","tt_disruptions","tt_breaks"];
var TT_GONE_KEY = "tt_gone", TT_GONE_MAX = 1000;   // per collection, oldest dropped
function ttContent(r){ var c=Object.assign({}, r); delete c.updatedAt; return JSON.stringify(c); }
function ttStamp(prev, next, now){
  var before={};
  (prev||[]).forEach(function(r){ if(r && r.id!=null) before[String(r.id)]=r; });
  var kept={};
  var list=(next||[]).map(function(r){
    if(!r || typeof r!=="object" || r.id==null) return r;
    var k=String(r.id), old=before[k]; kept[k]=true;
    if(old && ttContent(old)===ttContent(r)) return old;
    return Object.assign({}, r, { updatedAt:now });
  });
  var gone=Object.keys(before).filter(function(k){ return !kept[k]; })
                 .map(function(k){ return { id:before[k].id, at:now }; });
  return { list:list, gone:gone };
}
// save() for a tracked collection. Anything else goes through plain save().
function saveTracked(key, list){
  var prev=load(key, null);
  var res=ttStamp(Array.isArray(prev) ? prev : [], list, Date.now());
  save(key, res.list);
  if(res.gone.length){
    var all=load(TT_GONE_KEY, {});
    if(!all || typeof all!=="object" || Array.isArray(all)) all={};
    all[key]=(Array.isArray(all[key]) ? all[key] : []).concat(res.gone).slice(-TT_GONE_MAX);
    save(TT_GONE_KEY, all);
  }
}

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
// ---------------- Saves: automatic backups and save slots ----------------
// A save is a copy of the REAL board at one moment: every tt_ key except the
// practice board (tt_test*), and the live clock (tt_session, which says what
// is running now, not what the board holds). They live in IndexedDB, not
// localStorage: localStorage is capped near 5 MB in Safari and the board
// itself lives there, while each copy carries the whole history. Copies are
// deflated when the browser can (CompressionStream), about twelve-fold on
// this data.
//
// Automatic tiers (Brent, 10-10): Latest, then the last of each day for the
// last 7 days, of each week for 4 weeks, of each month for 12 months - each
// rolling off its oldest. Clock-out writes them; so does opening the app when
// the newest copy is over a day old (a forgotten clock-out). A reset or load
// first writes Latest plus its own daily entry, so it can always be undone and
// a later clock-out never overwrites it. Manual saves (5) never roll off.
//
// MULTI-USER HURDLE: copies are per device and a load replaces the whole
// board. With a shared board both must become per person or admin-only, and
// copies move server-side. See HANDOVER, "Multi-user hurdles".
var SNAP_DB="tt-saves", SNAP_STORE="snaps", SNAP_MANUAL_MAX=5;
var SNAP_KEEP={ daily:7, weekly:4, monthly:12 };
var SNAP_SETTINGS_KEYS=["tt_settings","tt_distpresets","tt_modules"];
function snapIsBoardKey(k){ return !!k && k.indexOf(TT_KEY_PREFIX)===0 && k.indexOf("tt_test")!==0 && k!=="tt_session"; }
function snapCollect(storage){
  var data={};
  try{ for(var i=0;i<storage.length;i++){ var k=storage.key(i); if(snapIsBoardKey(k)) data[k]=storage.getItem(k); } }catch(e){}
  return data;
}
function snapParse(data, key, def){ try{ return data[key]!=null ? JSON.parse(data[key]) : def; }catch(e){ return def; } }
function snapSummary(data){
  var ps=snapParse(data,"tt_projects",null), ls=snapParse(data,"tt_logs",[])||[];
  var n=(ps||REAL_PROJECTS).filter(function(p){ return isProjectRole(p) && !isClosed(p); }).length;
  var ms=0; ls.forEach(function(l){ if(l && l.type==="project" && l.duration>0) ms+=l.duration; });
  return { projects:n, loggedMs:ms };
}
function snapModuleOf(k){
  if(k.indexOf(TT_MOD_PREFIX)!==0) return null;
  var rest=k.slice(TT_MOD_PREFIX.length), cut=rest.indexOf("_");
  return cut>0 ? rest.slice(0,cut) : null;
}
// The ids a copy is filed under. Auto copies overwrite the period they fall
// in, so each tier holds the LAST copy of its day, week or month.
function snapIdsFor(why, at, weekStart){
  var d=new Date(at), day=isoDate(d);
  if(why==="manual") return [{ id:"save-"+at, kind:"manual" }];
  var out=[{ id:"latest", kind:"latest" }];
  if(why==="before-reset" || why==="before-load") out.push({ id:"daily-"+day+"-"+at, kind:"daily" });
  else {
    out.push({ id:"daily-"+day, kind:"daily" });
    out.push({ id:"weekly-"+isoDate(periodRange("week",0,d,weekStart||"mon").startDate), kind:"weekly" });
    out.push({ id:"monthly-"+day.slice(0,7), kind:"monthly" });
  }
  return out;
}
// What rolls off. Daily keeps every copy from its 7 most recent days; weekly
// and monthly keep their newest 4 and 12. Manual and Latest never roll.
function snapPrune(recs){
  var drop=[];
  var daily=recs.filter(function(r){ return r.kind==="daily"; });
  var days=[]; daily.forEach(function(r){ if(days.indexOf(r.day)<0) days.push(r.day); });
  days.sort().reverse();
  var keepDays=days.slice(0, SNAP_KEEP.daily);
  daily.forEach(function(r){ if(keepDays.indexOf(r.day)<0) drop.push(r.id); });
  ["weekly","monthly"].forEach(function(kind){
    recs.filter(function(r){ return r.kind===kind; }).sort(function(a,b){ return b.at-a.at; })
      .slice(SNAP_KEEP[kind]).forEach(function(r){ drop.push(r.id); });
  });
  return drop;
}
// ---- storage (IndexedDB), every call resolves or rejects, never throws ----
var snapDbP=null;
function snapDb(){
  if(snapDbP) return snapDbP;
  snapDbP=new Promise(function(res, rej){
    try{
      if(typeof indexedDB==="undefined" || !indexedDB) return rej(new Error("no IndexedDB"));
      var r=indexedDB.open(SNAP_DB, 1);
      r.onupgradeneeded=function(){ try{ r.result.createObjectStore(SNAP_STORE, { keyPath:"id" }); }catch(e){} };
      r.onsuccess=function(){ res(r.result); };
      r.onerror=function(){ rej(r.error||new Error("IndexedDB open failed")); };
    }catch(e){ rej(e); }
  });
  snapDbP.catch(function(){ snapDbP=null; });
  return snapDbP;
}
function snapTx(mode, fn){
  return snapDb().then(function(db){ return new Promise(function(res, rej){
    try{
      var tx=db.transaction(SNAP_STORE, mode), st=tx.objectStore(SNAP_STORE), out={};
      fn(st, out);
      tx.oncomplete=function(){ res(out.v); };
      tx.onerror=function(){ rej(tx.error); }; tx.onabort=function(){ rej(tx.error); };
    }catch(e){ rej(e); }
  }); });
}
function snapList(){
  return snapTx("readonly", function(st, out){ var q=st.getAll(); q.onsuccess=function(){ out.v=(q.result||[]).map(function(r){
    return { id:r.id, kind:r.kind, why:r.why, at:r.at, day:r.day, name:r.name||"", summary:r.summary, bytes:r.bytes }; }); }; });
}
function snapGet(id){ return snapTx("readonly", function(st, out){ var q=st.get(id); q.onsuccess=function(){ out.v=q.result||null; }; }); }
function snapDelete(id){ return snapTx("readwrite", function(st){ st.delete(id); }); }
function snapPack(str){
  try{
    if(typeof CompressionStream!=="undefined"){
      var s=new Blob([str]).stream().pipeThrough(new CompressionStream("deflate-raw"));
      return new Response(s).arrayBuffer().then(function(buf){ return { enc:"deflate-raw", data:buf }; },
        function(){ return { enc:"none", data:str }; });
    }
  }catch(e){}
  return Promise.resolve({ enc:"none", data:str });
}
function snapUnpack(rec){
  if(!rec) return Promise.reject(new Error("That copy is gone."));
  if(rec.enc!=="deflate-raw") return Promise.resolve(String(rec.data));
  try{
    var s=new Blob([rec.data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(s).text();
  }catch(e){ return Promise.reject(e); }
}
// Take a copy of the board as it is in storage now. why: clockout | open |
// before-reset | before-load | manual. opts: { name, replaceId }.
function snapTake(why, opts, storage){
  opts=opts||{};
  var st=storage||ttDb.backend(), at=Date.now();
  var data=snapCollect(st), json=JSON.stringify(data);
  var sched=snapParse(data,"tt_settings",{}); sched=sched&&sched.workSchedule;
  var ids=snapIdsFor(why, at, weekStartOf(sched));
  var base={ why:why, at:at, day:isoDate(new Date(at)), name:String(opts.name||"").slice(0,40),
             summary:snapSummary(data), bytes:json.length };
  return snapPack(json).then(function(p){
    return snapTx("readwrite", function(s){
      if(opts.replaceId) s.delete(opts.replaceId);
      ids.forEach(function(x){ s.put(Object.assign({}, base, { id:x.id, kind:x.kind, enc:p.enc, data:p.data })); });
    });
  }).then(snapList).then(function(list){
    var drop=snapPrune(list);
    if(!drop.length) return list;
    return snapTx("readwrite", function(s){ drop.forEach(function(id){ s.delete(id); }); }).then(snapList);
  });
}
function snapNewestAuto(list){
  return (list||[]).filter(function(r){ return r.kind!=="manual"; })
    .reduce(function(a,r){ return (!a||r.at>a.at) ? r : a; }, null);
}
// ---- applying a copy or a reset (pure on a storage object) ----
// Running timers in a copy (an open entry, saved mid-shift) are dropped: the
// copy holds finished time, and the clock itself is never part of it.
function snapCloseOpen(json){
  try{ var a=JSON.parse(json); if(!Array.isArray(a)) return json;
    return JSON.stringify(a.filter(function(x){ return !(x && x.startTime && !x.endTime); })); }catch(e){ return json; }
}
function snapApplyLoad(data, storage, opts){
  opts=opts||{};
  var mods=opts.modules||{};
  function keep(k){
    if(opts.keepSettings && SNAP_SETTINGS_KEYS.indexOf(k)>=0) return true;
    var m=snapModuleOf(k); return !!(m && mods[m]===false);
  }
  var cur=[]; for(var i=0;i<storage.length;i++){ var k=storage.key(i); if(snapIsBoardKey(k)) cur.push(k); }
  cur.forEach(function(k){ if(!keep(k)) storage.removeItem(k); });
  Object.keys(data).forEach(function(k){
    if(!snapIsBoardKey(k) || keep(k)) return;
    var v=data[k];
    if(k==="tt_logs" || k==="tt_disruptions" || k==="tt_breaks") v=snapCloseOpen(v);
    storage.setItem(k, v);
  });
}
function settingsFactory(){
  return { layout:"comfortable", tracking:"timer", colorScheme:"bright-pastels", theme:"neon-dream", schemes:{}, fonts:{}, mode:"dark", handedness:"right", headerPos:"top" };
}
// What a reset can clear. Projects takes time, ticks and the Archive with it.
var RESET_PICKS={
  state:   { time:true, ticks:true },
  factory: { time:true, ticks:true, projects:true, archive:true, look:true, schedule:true, presets:true }
};
function resetNormalize(sel){
  var s=Object.assign({}, sel, { modules:Object.assign({}, sel.modules||{}) });
  if(s.projects){ s.time=true; s.ticks=true; s.archive=true; }
  return s;
}
function resetApply(sel, storage){
  sel=resetNormalize(sel);
  function get(k, d){ try{ var v=storage.getItem(k); return v!=null?JSON.parse(v):d; }catch(e){ return d; } }
  if(sel.time){
    ["tt_logs","tt_disruptions","tt_breaks"].forEach(function(k){ storage.setItem(k,"[]"); });
    storage.removeItem("tt_notif_fired");
  }
  if(sel.projects){
    ["tt_projects","tt_laneorder","tt_lanemeta","tt_lanecollapse","tt_cardcollapse"].forEach(function(k){ storage.removeItem(k); });
  } else if((sel.ticks || sel.archive) && storage.getItem("tt_projects")!=null){
    var ps=get("tt_projects", []);
    if(sel.archive){
      var gone={}, grew=true;
      ps.forEach(function(p){ if(isClosed(p)) gone[p.id]=true; });
      while(grew){ grew=false; ps.forEach(function(p){ if(!gone[p.id] && p.parentId!=null && gone[p.parentId]){ gone[p.id]=true; grew=true; } }); }
      ps=ps.filter(function(p){ return !gone[p.id]; }).map(function(p){
        if(!p.milestones) return p;
        return Object.assign({}, p, { milestones:p.milestones.map(function(m){
          return Object.assign({}, m, { targets:(m.targets||[]).filter(function(t){ return !(t && gone[t.id]); }) }); }) });
      });
    }
    if(sel.ticks){
      ps=ps.map(function(p){
        var q=Object.assign({}, p);
        if(p.stages) q.stages=p.stages.map(function(st){ return Object.assign({}, st, { done:false, doneAt:null }); });
        if(p.milestones) q.milestones=p.milestones.map(function(m){ return Object.assign({}, m, { doneAt:null }); });
        return q;
      });
    }
    storage.setItem("tt_projects", JSON.stringify(ps));
  }
  if(sel.look && sel.schedule) storage.removeItem("tt_settings");
  else if(sel.look){
    var keepSch=get("tt_settings",{}).workSchedule;
    var fresh=settingsFactory(); if(keepSch) fresh.workSchedule=keepSch;
    storage.setItem("tt_settings", JSON.stringify(fresh));
  } else if(sel.schedule && storage.getItem("tt_settings")!=null){
    var cur=get("tt_settings",{}); delete cur.workSchedule;
    storage.setItem("tt_settings", JSON.stringify(cur));
  }
  if(sel.presets) storage.removeItem("tt_distpresets");
  ttModules().forEach(function(m){ if(sel.modules[m.id]) ttClearModuleData(m.id, storage); });
  return sel;
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
// ---- NESTING ----------------------------------------------------------------
// A project can sit inside another project, not just tasks inside a project:
// some work genuinely cannot start until a different project is finished, and
// flattening that into a task loses the fact that it is a project in its own
// right. Depth is capped because indentation runs out of phone before the
// structure runs out of ideas.
var MAX_NEST_DEPTH = 4;

function projDepth(projects, id){
  var d=0, cur=findProj(projects||[], id);
  while(cur && cur.parentId!=null && d<32){ cur=findProj(projects, cur.parentId); d++; }
  return d;
}
// How many levels hang below this one. A leaf is 0.
function subtreeDepth(projects, id){
  var kids=getChildren(projects||[], id), best=0;
  for(var i=0;i<kids.length;i++) best=Math.max(best, 1+subtreeDepth(projects, kids[i].id));
  return best;
}
// Whether `self` may be nested under `targetId`. Guards the three ways this
// goes wrong: nesting something inside itself, inside its own descendant -
// which would cut the whole branch off the board with no way back - or deeper
// than the cap once its own subtree is carried along with it.
function canNestUnder(projects, self, targetId){
  if(targetId==null) return true;
  var target=findProj(projects||[], targetId);
  if(!target) return false;
  if(self){
    if(targetId===self.id) return false;
    if(getDescendantIds(projects||[], self.id).indexOf(targetId)>=0) return false;
  }
  var carried = self ? subtreeDepth(projects, self.id) : 0;
  return projDepth(projects, targetId) + 1 + carried <= MAX_NEST_DEPTH - 1;
}
// Every project in a lane that `self` could legally be nested under, depth-first
// in board order, each tagged with how far to indent it in the picker.
function nestTargets(projects, self, lane){
  var out=[];
  function walk(parentId, depth){
    if(depth>MAX_NEST_DEPTH) return;
    (projects||[]).filter(function(p){
      return (p.parentId==null?null:p.parentId)===parentId && p.lane===lane && isOpen(p);
    }).sort(function(a,b){ return (a.order||0)-(b.order||0); })
      .forEach(function(p){
        if(canNestUnder(projects, self, p.id)) out.push({ p:p, depth:depth });
        walk(p.id, depth+1);
      });
  }
  walk(null, 0);
  return out;
}

// Depth-first order over a project and the projects nested inside it. That
// order is exactly the order the cards appear down the screen, so using it as a
// descending z-index makes every card paint over everything below it - parents
// over their children, and an earlier sibling over a later one. Depth alone was
// not enough: two siblings share a depth, and equal z-index falls back to DOM
// order, which put the second sibling on top of the first.
function projectStackOrder(projects, rootId){
  var order={}, n=0;
  (function walk(id){
    order[id]=n++;
    (projects||[]).filter(function(p){ return p.parentId===id && isOpen(p) && isProjectRole(p); })
      .sort(function(a,b){ return (a.order||0)-(b.order||0); })
      .forEach(function(c){ walk(c.id); });
  })(rootId);
  return order;
}
// 60 down to 2. The floor matters only past 58 nested cards, where the tail
// ties instead of going negative and falling behind the lane itself.
function stackZ(order, id){ return Math.max(2, 60 - (order[id]||0)); }

// ---- PROJECT LIFECYCLE ------------------------------------------------------
// A project is either ongoing - a daily task that repeats and never finishes -
// or finite, with a beginning and an end. Either can be closed out at any time.
//
// Both facts are read through functions, never off the record directly, because
// every project that already exists has neither field. An absent kind is
// ongoing, which is exactly how they have always behaved, and an absent
// closedAt is open. So there is no migration and nothing moves.
// Project or task is its own fact, not something inferred from having a parent.
// Inferring it meant nesting a project demoted it to a task, which is exactly
// backwards: a project that has to happen before another project is still a
// project. Records written before this field existed fall back to the old rule,
// which was right for them - a child was a task, a root was a project.
function projRole(p){
  if(p && (p.role==="project" || p.role==="task")) return p.role;
  return (p && p.parentId!=null) ? "task" : "project";
}
function isTaskRole(p){ return projRole(p)==="task"; }
function isProjectRole(p){ return projRole(p)==="project"; }
function projKind(p){ return (p && p.kind==="finite") ? "finite" : "ongoing"; }
function isFinite_(p){ return projKind(p)==="finite"; }
function isClosed(p){ return !!(p && typeof p.closedAt==="number" && p.closedAt>0); }
function isOpen(p){ return !isClosed(p); }
// When a project began, and - if it has an end - when that end falls. Read
// through functions for the same reason as kind and role: every project
// written before these existed has neither, and absent has to mean "not
// recorded" rather than the epoch. So there is no migration and nothing moves.
// An end only belongs to a finite project; an ongoing one having a due date
// would be a contradiction, so the form clears it when the type changes.
function projStart(p){
  var t = p && p.startAt;
  return (typeof t==="number" && !isNaN(t) && t>0) ? t : null;
}
function projEnd(p){
  var t = p && p.endAt;
  return (typeof t==="number" && !isNaN(t) && t>0) ? t : null;
}
// A moment split across a date field and a time field. iOS renders those two
// reliably and TIME_FIELD_STYLE already carries the appearance reset that keeps
// their values visible; datetime-local has neither behind it here.
function tsDateStr(ts){ return ts==null ? "" : isoDate(new Date(ts)); }
function tsTimeStr(ts){ if(ts==null) return ""; var d=new Date(ts); return pad(d.getHours())+":"+pad(d.getMinutes()); }
// No date means no moment - an empty pair of fields is "not recorded", not
// midnight today. A date the calendar does not have is refused rather than
// rolled forward, which is what `new Date(2026,1,31)` would quietly do. The
// time is applied with setHours so a moment on a DST changeover day lands on
// the wall clock the user typed.
function joinDateTime(dateStr, timeStr){
  var a=String(dateStr||"").split("-");
  if(a.length!==3) return null;
  var y=+a[0], mo=+a[1], da=+a[2];
  if(isNaN(y) || isNaN(mo) || isNaN(da)) return null;
  var d=new Date(y, mo-1, da, 0, 0, 0, 0);
  if(d.getFullYear()!==y || d.getMonth()!==mo-1 || d.getDate()!==da) return null;
  var mins=toMin(timeStr);
  if(mins==null || mins<0 || mins>1439) mins=0;
  d.setHours(Math.floor(mins/60), mins%60, 0, 0);
  return d.getTime();
}
// A start still in the future means the project has not begun. Its Start
// button greys out rather than disappearing: pressing it is how you get the
// question about starting early, and a greyed control that does nothing at all
// would just look broken.
function isPending(p, now){
  var s=projStart(p);
  return s!=null && s > (now==null ? Date.now() : now);
}
// An end that has passed on a project still open. Closed projects are history,
// so they are never overdue however long ago the date was.
function isOverdue(p, now){
  var e=projEnd(p);
  return e!=null && isOpen(p) && e < (now==null ? Date.now() : now);
}
// The one place a project's dates are put into words, so the card, the row and
// the Archive all read the same. Nothing renders for a project with no dates,
// which is every project that predates the fields.
function schedText(p, now){
  var t=now==null ? Date.now() : now;
  var s=projStart(p), e=projEnd(p), out=[];
  if(s!=null) out.push((s>t ? "Starts " : "Started ")+fmtDate(s)+(s>t ? " at "+fmtTime(s) : ""));
  if(e!=null) out.push((e<t && isOpen(p) ? "Overdue " : "Due ")+fmtDate(e));
  return out;
}
// What a press on a project's Start should do. Kept out of the component and
// returning the decision rather than acting on it, so the rule is testable
// without mounting the board. Stopping and resuming are never gated - only
// starting something that has not reached its scheduled time.
function startAction(projects, activeId, id, force, now){
  if(force) return "run";
  if(activeId===id) return "run";
  return isPending(findProj(projects||[], id), now) ? "ask" : "run";
}
function SchedChip(props){
  var p=props.proj, small=props.small;
  var parts=schedText(p);
  if(!parts.length) return null;
  var pend=isPending(p), late=isOverdue(p);
  return React.createElement("span", { "data-sched":true,
    style:{fontSize:small?"0.7rem":"0.74rem", fontWeight:pend||late?700:600,
           color: late ? S.dangerText : (pend ? S.textDim : S.textMuted),
           fontFamily:S.fontBody, whiteSpace:"nowrap"} },
    parts.join("  \u00B7  "));
}

// is the one moment worth offering to close, so that is what "done" means here.
function stagesAllDone(p){
  var st = (p && Array.isArray(p.stages)) ? p.stages : [];
  return st.length>0 && st.every(function(s){ return s && s.done; });
}
function readyToClose(p){ return isOpen(p) && isFinite_(p) && stagesAllDone(p); }
// Closing a parent while work still hangs off it would hide those tasks with no
// way back to them, so it is refused and the blockers are named.
function closeBlockers(projects, p){
  if(!p) return [];
  return getChildren(projects||[], p.id).filter(isOpen);
}
function canClose(projects, p){
  if(!p) return { ok:false, blockers:[] };
  if(isClosed(p)) return { ok:false, blockers:[] };
  var b=closeBlockers(projects, p);
  return { ok:b.length===0, blockers:b };
}
// A task belongs to its project, so it starts out the same type. Independent
// afterwards - a one-off audit can sit under an ongoing daily task - but the
// project is the sensible starting point rather than a blanket default.
function inheritedKind(projects, parentId){
  var parent = parentId!=null ? findProj(projects||[], parentId) : null;
  return parent ? projKind(parent) : "ongoing";
}
// Open tasks under a project whose type no longer matches its own. Closed ones
// are left alone: their type is history now and changing it says nothing.
function mismatchedTasks(projects, proj){
  if(!proj) return [];
  var want=projKind(proj);
  return getDescendantIds(projects||[], proj.id).map(function(id){
    return findProj(projects, id);
  }).filter(function(t){ return t && isOpen(t) && projKind(t)!==want; });
}
// The board shows open work only. Closed projects keep every log they ever had
// - Reports and history are untouched - they simply stop being startable.
function openProjects(projects){ return (projects||[]).filter(isOpen); }

function getChildren(projects, parentId){ return projects.filter(function(p){ return p.parentId===parentId; }); }
function getDescendantIds(projects, id){
  var result=[], queue=getChildren(projects,id);
  while(queue.length){ var p=queue.shift(); result.push(p.id); queue=queue.concat(getChildren(projects,p.id)); }
  return result;
}

// ---- SAMPLE DATA -------------------------------------------------------------
// Two baselines, with different jobs.
//
// FIRST RUN is deliberately almost empty, and its records are named after
// WHAT THEY ARE. A new board should not arrive full of someone else's work to
// delete, and a first-time user needs the vocabulary before the examples:
// seeing "First Stage" sitting under "First Project" inside "First Lane"
// teaches the nesting in one glance. Two lanes, so a lane reads as one of
// several rather than as the whole screen.
var REAL_PROJECTS = [
  { id:1, name:"First Project",  lane:"Daily Activity", notes:"", order:0, parentId:null,
    role:"project", kind:"ongoing",
    stages:[ {id:"fs1", label:"First Stage", done:false, doneAt:null, note:""} ] },
  { id:2, name:"Second Project", lane:"Projects", notes:"", order:0, parentId:null,
    role:"project", kind:"ongoing",
    stages:[ {id:"ss1", label:"Second Stage", done:false, doneAt:null, note:""} ] },
  { id:3, name:"Second Task",    lane:"Projects", notes:"", order:0, parentId:2,
    role:"task", kind:"ongoing", stages:[] }
];

// THE TUTORIAL is the full demonstration: one clear example of every feature
// and nothing duplicated. Names are generic on purpose - a shop floor, an
// office and a workshop should all recognise them.
//
// Times are relative to now, so the tutorial always looks current whoever
// opens it and whenever. That means help pages must not quote specific
// figures, because the numbers move with the day.
var DAY_MS = 86400000;
function tutAt(daysAgo, hour, min){
  var d=new Date(); d.setDate(d.getDate()-daysAgo); d.setHours(hour, min||0, 0, 0);
  return d.getTime();
}
// Bumped whenever the tutorial baseline changes: the tutorial's stores are
// only seeded when empty, so without a version a device that ran the tutorial
// once would keep its first copy forever.
var TUTORIAL_SEED = "2026-09-milestones";
var TEST_PROJECTS = [
  // The simplest thing there is: no stages, no end, just work you start.
  { id:101, name:"Start-of-day checks", lane:"Daily Activity", notes:"Walk the floor before anything else",
    order:0, parentId:null, role:"project", kind:"ongoing", stages:[] },
  // Scheduled later today, so the greyed Start and the "Starts at" chip show.
  { id:102, name:"Shift handover", lane:"Daily Activity", notes:"Hand the board to the next shift",
    order:1, parentId:null, role:"project", kind:"ongoing",
    startAt:(function(){ var d=new Date(); d.setHours(23,30,0,0); return d.getTime(); })(), stages:[] },
  // Finite, with an end date and a part-finished run of stages.
  { id:103, name:"Install new workbench", lane:"Projects", notes:"Bay 2, replacing the old one",
    order:0, parentId:null, role:"project", kind:"finite",
    startAt:tutAt(4, 8, 0), endAt:tutAt(-6, 17, 0),
    // A milestone tracker, so the tutorial shows one in every state at once:
    // met early, met late, missed, and still to come - and one step that is
    // met automatically because its target (Clear the old bench) is closed.
    milestones:[
      { id:"tm1", label:"Bay cleared",  dueAt:tutAt(3, 12, 0), targets:[{kind:"project", id:105}], doneAt:null, note:"Old bench out and the floor swept" },
      { id:"tm2", label:"Parts arrive", dueAt:tutAt(2, 9, 0),  targets:[], doneAt:tutAt(1, 15, 30), note:"" },
      { id:"tm3", label:"Frame up",     dueAt:tutAt(1, 17, 0), targets:[], doneAt:null, note:"Needs the sparky on site" },
      { id:"tm4", label:"Fit and level",dueAt:tutAt(-4, 17, 0),targets:[], doneAt:null, note:"" },
      { id:"tm5", label:"Sign-off",     dueAt:tutAt(-9, 12, 0),targets:[], doneAt:null, note:"" }
    ],
    stages:[
      {id:"t1", label:"Measure up",  done:true,  doneAt:tutAt(4, 9, 30), note:"2.4m x 900"},
      {id:"t2", label:"Order parts", done:true,  doneAt:tutAt(3, 11, 0), note:""},
      {id:"t3", label:"Build",       done:false, doneAt:null, note:""},
      {id:"t4", label:"Fit and level", done:false, doneAt:null, note:""}
    ]},
  // A nested PROJECT and a nested TASK, side by side - the only way the
  // difference between the two is visible on screen.
  { id:104, name:"Electrical hookup", lane:"Projects", notes:"Needs the sparky booked",
    order:0, parentId:103, role:"project", kind:"finite", stages:[],
    // A nested tracker: its steps roll up onto the parent's line, the lane's
    // and the board's, which is what makes those lines worth looking at.
    milestones:[
      { id:"te1", label:"Sparky booked", dueAt:tutAt(0, 16, 0), targets:[], doneAt:null, note:"" },
      { id:"te2", label:"First fix",     dueAt:tutAt(-6, 12, 0),targets:[], doneAt:null, note:"" }
    ] },
  // Closed out: this is what makes the "Bay cleared" milestone read as met
  // without anyone touching the milestone itself - the everyday path.
  { id:105, name:"Clear the old bench", lane:"Projects", notes:"",
    order:1, parentId:103, role:"task", kind:"ongoing", stages:[],
    closedAt:tutAt(3, 10, 15), closedNote:"Bench out, floor swept", closedOutcome:"done" },
  { id:106, name:"Weekly inspection", lane:"Projects", notes:"Every Friday",
    order:1, parentId:null, role:"project", kind:"ongoing", stages:[] },
  { id:107, name:"Sort the tool wall", lane:"Side Projects", notes:"When there is a quiet hour",
    order:0, parentId:null, role:"project", kind:"ongoing", stages:[] }
];
// Seeded history, so Reports, the Day Summary and the disruption badges have
// real numbers in the one place meant for demonstrating them. Without this the
// tutorial shows every screen empty.
function tutLog(id, pid, name, lane, day, h, m, mins, parentId, parentName){
  var st=tutAt(day, h, m);
  return { id:id, type:"project", projectId:pid, projectName:name, lane:lane,
           startTime:st, endTime:st+mins*60000, duration:mins*60000,
           day:new Date(st).toDateString(), parentId:parentId||null, parentName:parentName||null };
}
var TEST_LOGS = [
  tutLog("tl1", 101, "Start-of-day checks", "Daily Activity", 1, 7, 5, 25),
  tutLog("tl2", 103, "Install new workbench", "Projects",      1, 7, 40, 145),
  tutLog("tl3", 105, "Clear the old bench", "Projects",        1, 13, 0, 50, 103, "Install new workbench"),
  tutLog("tl4", 106, "Weekly inspection", "Projects",          1, 14, 10, 35),
  tutLog("tl5", 101, "Start-of-day checks", "Daily Activity",  0, 7, 10, 20),
  tutLog("tl6", 103, "Install new workbench", "Projects",      0, 7, 45, 95)
];
var TEST_DIST = [
  { id:"td1", projectId:103, projectName:"Install new workbench",
    startTime:tutAt(1, 9, 20), endTime:tutAt(1, 9, 32), duration:12*60000, note:"Machine Issue" },
  { id:"td2", projectId:101, projectName:"Start-of-day checks",
    startTime:tutAt(1, 7, 15), endTime:tutAt(1, 7, 19), duration:4*60000, note:"Phone Call" },
  { id:"td3", projectId:103, projectName:"Install new workbench",
    startTime:tutAt(0, 8, 30), endTime:tutAt(0, 8, 52), duration:22*60000, note:"Walk-in Visitor" }
];
var TEST_BREAKS = [
  { id:"tb1", label:"Lunch", startTime:tutAt(1, 12, 0), endTime:tutAt(1, 12, 30), duration:30*60000,
    day:new Date(tutAt(1,12,0)).toDateString() }
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
// Tap or hold. A tap fires onTap on release; holding past holdMs fires
// onHold instead and the release is swallowed, so a hold never also taps.
// Pointer events cover mouse and touch alike. Movement past a few px cancels
// the hold, so a scroll that starts on the button is not read as one.
// Every hold shows the same charging fill (HoldFill): a hold with no feedback
// feels broken for the half-second before anything happens, and people let
// go; the fill says it is working and how much longer to hold. An accidental
// brush starts it, lifting empties it, nothing happened. The hook reports
// `holding` so the control it is on can draw the fill - no control decides
// for itself whether to show one.
function useHold(onTap, onHold, holdMs){
  holdMs = holdMs || 500;
  var timer=useRef(null), held=useRef(false), start=useRef(null);
  var tapRef=useRef(onTap), holdRef=useRef(onHold);
  var holdingS=useState(false); var setHolding=holdingS[1]; var holding=holdingS[0];
  tapRef.current=onTap; holdRef.current=onHold;
  function clear(){ if(timer.current){ clearTimeout(timer.current); timer.current=null; } setHolding(false); }
  return {
    holding:holding, holdMs:holdMs,
    handlers:{
      onPointerDown:function(e){
        held.current=false; start.current={ x:e.clientX, y:e.clientY };
        clear(); setHolding(true);
        timer.current=setTimeout(function(){ timer.current=null; held.current=true; setHolding(false); haptic(18); if(holdRef.current) holdRef.current(); }, holdMs);
      },
      onPointerMove:function(e){
        if(!start.current || !timer.current) return;
        if(Math.abs(e.clientX-start.current.x)>8 || Math.abs(e.clientY-start.current.y)>8) clear();
      },
      onPointerUp:function(){ var wasTimed=!!timer.current; clear(); if(wasTimed && !held.current && tapRef.current) tapRef.current(); },
      onPointerLeave:function(){ clear(); },
      onPointerCancel:function(){ clear(); },
      // the click that follows a pointer sequence is handled above; swallow it
      onClick:function(e){ if(e && e.preventDefault) e.preventDefault(); },
      onContextMenu:function(e){ if(e && e.preventDefault) e.preventDefault(); }
    }
  };
}
// A control that is worked by holding. One component, so every hold in the
// app looks and behaves the same: the fill charges for holdMs, a release
// before that is a tap (which may do nothing, for a Delete), a release after
// it never also taps. Content sits above the fill.
var HOLD_DELETE_MS = 1500;   // "a couple of seconds" before a Delete opens
function HoldButton(props){
  var hold=useHold(props.onTap||null, props.onHold, props.holdMs);
  var style=Object.assign({ position:"relative",overflow:"hidden",cursor:"pointer",
    touchAction:"manipulation",userSelect:"none",WebkitUserSelect:"none",WebkitTouchCallout:"none" }, props.style||{});
  var attrs=Object.assign({ style:style, disabled:!!props.disabled }, props.attrs||{}, props.disabled?{}:hold.handlers);
  return React.createElement("button", attrs,
    React.createElement(HoldFill, { holding:hold.holding, ms:hold.holdMs, color:props.fill }),
    React.createElement("span", { style:{position:"relative",display:"block"} }, props.children));
}
// The fill. Sits behind a control's content (the control must be
// position:relative with overflow hidden) and grows across it for the length
// of the hold; snaps back to nothing when the hold is released or cancelled.
function HoldFill(props){
  return React.createElement("div", { "data-holdfill":props.holding?"1":"0", "aria-hidden":true,
    style:{position:"absolute",left:0,top:0,bottom:0,pointerEvents:"none",
           width:props.holding?"100%":"0%",background:props.color||S.successBg,
           transition:props.holding?("width "+props.ms+"ms linear"):"none"} });
}
// ---- SWIPE -------------------------------------------------------------------
// The one swipe: lanes, project cards and task rows all collapse with it. It
// used to be written out six times, once per place and state.
//
// Read on RELEASE only. It never tries to stop the page scrolling, which is
// why it survives on iOS where drag-to-reorder never did: Safari claims a
// moving finger for scrolling before any script sees it, but it cannot stop
// us comparing where the finger went down with where it came up.
//
// `open` is for an expanded name: past SWIPE_MIN_PX either way, onSwipe gets
// "left" or "right". `pill` is for a collapsed pill: only a right swipe counts,
// so a left swipe on something already shut does nothing. `guard(fn)` wraps
// the name's click so the tap a swipe would otherwise end in never opens the
// menu as well.
var SWIPE_MIN_PX = 50;
function useSwipe(onSwipe){
  var x=useRef(null), swiped=useRef(false), cb=useRef(onSwipe);
  cb.current=onSwipe;
  function make(rightOnly){
    function begin(cx){ x.current=cx; swiped.current=false; }
    function end(cx){
      var from=x.current; x.current=null;
      if(from===null) return;
      var dx=cx-from;
      if(rightOnly ? dx>SWIPE_MIN_PX : Math.abs(dx)>SWIPE_MIN_PX){
        swiped.current=true; haptic(8); cb.current(dx<0 ? "left" : "right");
      }
    }
    return {
      onMouseDown:function(e){ begin(e.clientX); },
      onMouseUp:function(e){ end(e.clientX); },
      onTouchStart:function(e){ if(e.touches&&e.touches.length) begin(e.touches[0].clientX); },
      onTouchEnd:function(e){ if(e.changedTouches&&e.changedTouches.length) end(e.changedTouches[0].clientX); else x.current=null; }
    };
  }
  return { open:make(false), pill:make(true),
    guard:function(fn){ return function(e){ if(swiped.current){ swiped.current=false; return; } fn(e); }; } };
}
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
  // Everything but style and children is forwarded, so callers can hang a
  // data- attribute or an aria label on a Mono span. Dropping them silently is
  // how a data-glow ends up doing nothing at all.
  var out = {};
  Object.keys(props).forEach(function(k){ if(k!=="style" && k!=="children") out[k]=props[k]; });
  out.style = Object.assign({ fontFamily:S.fontMono }, props.style||{});
  return React.createElement("span", out, props.children);
}

// Floating modal action bar. Sticky inside the scrolling shell, so it stays
// visible however long the content is. It mirrors the app chrome: header at
// the bottom puts the bar at the bottom, left-handed mode reverses the button
// order so the primary lands under the thumb.
// Save sits under the thumb and Cancel away from it: Save right in right-handed
// mode, Save left in left-handed. Children are always written Save first and
// Cancel second, and the direction does the mirroring - so reading the source
// never depends on which hand is set.
//
// This used to be the other way round, which put Cancel under the thumb on
// both settings.
// Always row-reverse. The app root flips to dir="rtl" for a left-hander, and
// that ALREADY mirrors every flex row; flipping here as well cancelled it out,
// so Save sat on the right for both hands. Children are written Save, Cancel,
// Delete: row-reverse puts Save at the end the thumb is on under either
// direction, and Delete at the far corner.
function ACTION_DIR(){ return "row-reverse"; }
function ACTION_ROW(){ return { display:"flex", gap:"0.5rem", flexDirection: ACTION_DIR() }; }
function ModalActions(props){
  var st={ position:"sticky", zIndex:5, display:"flex", gap:"0.6rem", alignItems:"stretch",
           flexDirection: ACTION_DIR(),
           background:S.menuBg, border:"1px solid "+S.border, borderRadius:S.radius,
           padding:"0.55rem", boxShadow:"0 8px 32px rgba(0,0,0,0.45)" };
  if(UI.bottom){ st.bottom="-1.25rem"; st.order=9999; st.marginTop="0.9rem"; }
  else { st.top="-1.25rem"; st.order=-1; st.marginBottom="0.9rem"; }
  return React.createElement("div", { "data-surface":"menu", style:st }, props.children);
}
// Built per render: a module-level constant would freeze the tokens of
// whatever palette was active at load time and ignore every later theme or
// mode switch - exactly how the Settings cancel went wrong in light mode.
function MODAL_CANCEL(){ return { flex:1,background:S.bg1,border:"1px solid "+S.border,borderRadius:S.radius,padding:"0.85rem",color:S.textDim,cursor:"pointer",fontFamily:S.fontBody,fontWeight:700,fontSize:MODAL_BTN_FONT }; }
// One size for every modal action button. Cancel was inheriting the browser
// default at normal weight and sat too light against the panel to find quickly.
var MODAL_BTN_FONT = "1.05rem";
function MODAL_SAVE(){ return { flex:1,background:S.infoBg,border:"2.5px solid "+S.actionBdr,borderRadius:S.radius,padding:"0.85rem",color:S.infoText,fontWeight:700,cursor:"pointer",fontFamily:S.fontBody,fontSize:MODAL_BTN_FONT }; }

// A sheet drawn as a miniature inside a guide is not a live sheet: it must not
// answer to [data-modal-panel], which tests and the app use to find the sheet
// on top. The guide's stage provides this context; everywhere else it is false.
var StageCtx = (React && React.createContext) ? React.createContext(false) : null;
function Modal(props){
  var wide = props.wide;
  var staged = (StageCtx && React.useContext) ? React.useContext(StageCtx) : false;
  return (
    React.createElement("div", {
      onClick: function(e){ if(e.target===e.currentTarget) props.onClose(); },
      style:{ position:"fixed",inset:0,background:S.scrim,zIndex:900,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem",
              backdropFilter:S.scrimBlur,WebkitBackdropFilter:S.scrimBlur }
    },
      React.createElement("div", { "data-surface":"modal",
        // overscroll-behavior:contain stops the sheet handing a gesture to the
        // page when it has nowhere left to scroll.
        "data-modal-panel":staged?undefined:true, "data-staged":staged?true:undefined,
        // shrinkBy: while an overlay sits over the foot of the viewport (the
        // outline's controller), the sheet gives up that height rather than
        // padding under it - so a sticky action row lands ABOVE the overlay.
        style:{ background:S.modalBg,border:"2px solid "+S.border,borderRadius:S.radius2,
                padding:"1.25rem",
                width:"100%",maxWidth:wide?"520px":"400px",
                // A staged sheet marked full shows its whole height in the
                // manual, so a long settings sheet can be pictured end to end.
                maxHeight:(staged&&staged.full)?"none":props.shrinkBy?("calc(85vh - "+props.shrinkBy+")"):"85vh",
                // fill: a full-height sheet, so a box pinned to its foot never moves.
                height:(props.fill&&!staged)?"85vh":undefined,
                alignSelf:props.shrinkBy?"flex-start":undefined,
                marginTop:props.shrinkBy?"1.5rem":undefined,
                overflowY:"auto",overscrollBehavior:"contain",
                display:"flex",flexDirection:"column" }
      },
        React.createElement("div", { style:{display:"flex",justifyContent:UI.left?"flex-end":"flex-start",alignItems:"center",gap:"0.5rem",marginBottom:"1rem"} },
          React.createElement(ModalGlyph, { title:props.title }),
          React.createElement("span", { style:{fontWeight:700,fontSize:"1rem",color:S.text} }, props.title)
        ),
        props.children,
        // Modals that keep their own action row pass ownActions; every other
        // modal gets a floating bar with Save (when provided) and Cancel.
        // A sheet's own buttons - Save, Cancel, Delete, a hold - ride in the
        // same sticky, mirrored, header-following box as the built-in pair.
        // The rule: no sheet draws an action row inline any more.
        props.actions && React.createElement(ModalActions, null, props.actions),
        !props.ownActions && React.createElement(ModalActions, null,
          props.onSave && React.createElement("button", { onClick:props.onSave, "data-anchor":props.saveAnchor, style:MODAL_SAVE() }, props.saveLabel||"Save"),
          React.createElement("button", { onClick:props.onClose, style:MODAL_CANCEL() }, props.cancelLabel||"Cancel")
        )
      )
    )
  );
}

// 16px, not 0.92rem. Safari on iOS zooms the whole page in when a field with
// text under 16px takes focus, and it never zooms back out when the field goes
// away - so closing a modal left the app stuck larger than it started, needing
// a manual pinch. Every focusable field in the app is pinned at 16px for that
// reason; the stylesheet enforces it for any that set their own size.
// border-box, or width:100% plus the padding and border overflows its
// container by ~30px - every text input in the app ran past its sheet's edge.
var INPUT_STYLE = { direction:"ltr",textAlign:"left",width:"100%",boxSizing:"border-box",background:"#0A0A16",border:"2px solid "+S.border,borderRadius:S.radius3,padding:"0.65rem 0.85rem",color:S.text,fontFamily:S.fontBody,fontSize:"16px",outline:"none" };
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
      // Milestone statuses, and the off-day band on a milestone line. Darker
      // in light mode: the dark-mode green and amber wash out on a pale surface.
      msMet:"#4A9C6B", msLate:"#C8A030", msMissed:"#CC5050", msUpcoming:"#6A6A8A", msOffDay:"rgba(255,255,255,0.05)",
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
      // Milestone statuses, and the off-day band on a milestone line. Darker
      // in light mode: the dark-mode green and amber wash out on a pale surface.
      msMet:"#2E7D4F", msLate:"#9A7A10", msMissed:"#B23A3A", msUpcoming:"#7A7A9A", msOffDay:"rgba(0,0,0,0.08)",
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
      msMet:"#4A9C6B", msLate:"#C8A030", msMissed:"#CC5050", msUpcoming:"#6A6A8A", msOffDay:"rgba(255,255,255,0.05)",
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
      msMet:"#2E7D4F", msLate:"#9A7A10", msMissed:"#B23A3A", msUpcoming:"#7A7A9A", msOffDay:"rgba(0,0,0,0.08)",
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
      // Milestone statuses, and the off-day band on a milestone line. Darker
      // in light mode: the dark-mode green and amber wash out on a pale surface.
      msMet:"#4A9C6B", msLate:"#C8A030", msMissed:"#CC5050", msUpcoming:"#6A6A8A", msOffDay:"rgba(255,255,255,0.05)",
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
      // Milestone statuses, and the off-day band on a milestone line. Darker
      // in light mode: the dark-mode green and amber wash out on a pale surface.
      msMet:"#2E7D4F", msLate:"#9A7A10", msMissed:"#B23A3A", msUpcoming:"#7A7A9A", msOffDay:"rgba(0,0,0,0.08)",
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
      // Milestone statuses, and the off-day band on a milestone line. Darker
      // in light mode: the dark-mode green and amber wash out on a pale surface.
      msMet:"#4A9C6B", msLate:"#C8A030", msMissed:"#CC5050", msUpcoming:"#6A6A8A", msOffDay:"rgba(255,255,255,0.05)",
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
      // Milestone statuses, and the off-day band on a milestone line. Darker
      // in light mode: the dark-mode green and amber wash out on a pale surface.
      msMet:"#2E7D4F", msLate:"#9A7A10", msMissed:"#B23A3A", msUpcoming:"#7A7A9A", msOffDay:"rgba(0,0,0,0.08)",
      addDisabled:"#8E8185", runningTint:"#A8A2A6"
    }
  }
};
// Stone, built from reference rather than a single speckle tile. Real rocks read
// as rock because of three things: an edge that rolls away into shadow instead
// of an outline, variation at several scales at once (broad mineral mottling
// under fine grain), and one consistent light source across every stone in the
// scene. A single uniform speckle gives you sandpaper.
// ---- READABLE INK --------------------------------------------------------
// A lane accent is chosen to work as a border and a fill. That is a different
// job from being read as text: measured on the painted result, the accents sit
// around 5.1-5.7:1 on the dark card and only 3.2-3.6:1 on the light one, which
// is under AA for anything smaller than 18.66px bold - both title sizes.
//
// So the accent is nudged toward the surface's own text colour, one step at a
// time, and stopped the moment it clears the target. In dark mode nothing
// moves at all; in light mode it darkens just enough to read.
function relLum(c){
  var f=function(v){ v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); };
  return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]);
}
function contrastOf(a,b){
  var L1=relLum(a), L2=relLum(b), hi=Math.max(L1,L2), lo=Math.min(L1,L2);
  return (hi+0.05)/(lo+0.05);
}
function hexRGB(h){
  var x=String(h||"").replace("#","");
  if(x.length===3) x=x[0]+x[0]+x[1]+x[1]+x[2]+x[2];
  if(x.length!==6 || /[^0-9a-fA-F]/.test(x)) return null;
  return [parseInt(x.slice(0,2),16),parseInt(x.slice(2,4),16),parseInt(x.slice(4,6),16)];
}
function rgbHex(c){
  return "#"+c.map(function(v){
    var n=Math.max(0,Math.min(255,Math.round(v))).toString(16);
    return n.length<2 ? "0"+n : n;
  }).join("");
}
function readableInk(accent, surface, text, target){
  var a=hexRGB(accent), s=hexRGB(surface), t=hexRGB(text);
  // Anything unparseable is left exactly as it was rather than guessed at.
  if(!a || !s || !t) return accent;
  var goal=target||4.5;
  if(contrastOf(a,s)>=goal) return accent;
  for(var k=1;k<=12;k++){
    var m=[a[0]+(t[0]-a[0])*k/12, a[1]+(t[1]-a[1])*k/12, a[2]+(t[2]-a[2])*k/12];
    if(contrastOf(m,s)>=goal) return rgbHex(m);
  }
  return text;
}
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
  // Milestone statuses and the off-day band. applyTokens copies keys by name,
  // so a token added to the scheme tables is invisible until it is copied
  // here too - the line drew black the first time for exactly that reason.
  S.msMet=c.msMet; S.msLate=c.msLate; S.msMissed=c.msMissed; S.msUpcoming=c.msUpcoming; S.msOffDay=c.msOffDay;
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

// ---- MENU GLYPHS -------------------------------------------------------------
// One table, one component, so the settings menu cannot drift into a mix of
// styles. Every glyph is stroked line art on a 28-unit grid at 2.5 weight with
// round caps and joins and no fills - the clock is the reference and the rest
// of the set was drawn to match it.
//
// Weights under 2.5 are deliberate, never decoration: a part that should sit
// behind the main shape - a road's far dashes, a ripple spreading out - is
// drawn lighter so it recedes instead of competing with the thing in front.
//
// Every glyph must fit 0..28 including its stroke. A composition of rotated or
// arced parts has a bounding box nowhere near the numbers in its path data, so
// measure a render rather than trusting the coordinates. The Interface glyph
// shipped clipped once because it was eyeballed. See HANDOVER.
//
// Entries: ["p", d, width] path, ["c", cx, cy, r, width] circle,
//          ["r", x, y, w, h, rx, width] rect.
var MENU_GLYPHS = {
  // A plus in a ring, rather than a bare plus that reads as a maths symbol.
  add: [["c",14,14,10.5,2.5], ["p","M14 9V19 M9 14H19",2.5]],
  // A road running to the horizon. The dashes shorten, their gaps tighten and
  // each is lighter than the one below: evenly spaced dashes read as a ladder
  // and fight the perspective the converging edges build.
  lanes: [["p","M3.6 25.6 Q4.8 14.9 11.2 4.2",2.5], ["p","M24.4 25.6 Q18.0 14.9 16.8 4.2",2.5],
          ["p","M13.8 24.7 L12.9 19.2",2.3], ["p","M12.7 16.7 L12.8 12.2",2.1],
          ["p","M13.0 10.0 L13.5 6.3",1.9]],
  clock: [["c",14,14,11,2.5], ["p","M14 8 L14 14 L18 17",2.5]],
  summary: [["r",5,3,18,22,2.5,2.5], ["p","M9.5 9.5H18.5 M9.5 14H18.5 M9.5 18.5H15",2.5]],
  reports: [["r",3,3,22,22,3.5,2.5], ["p","M9 19V12 M14 19V8.5 M19 19V15",2.5]],
  archive: [["r",3,4,22,5.5,1.8,2.5], ["p","M5 9.5V23A1 1 0 0 0 6 24H22A1 1 0 0 0 23 23V9.5",2.5],
            ["p","M11 14.5H17",2.5]],
  // A disk, not a cloud: the backup is a file through the share sheet, and a
  // cloud would promise storage this app does not have.
  backup: [["r",3.5,3.5,21,21,3,2.5], ["r",9,3.5,10,8,1,2.5], ["p","M8 24V17H20V24",2.5]],
  extensions: [["r",3.5,3.5,9.5,9.5,2,2.5], ["r",15,3.5,9.5,9.5,2,2.5],
               ["r",3.5,15,9.5,9.5,2,2.5], ["p","M19.75 16.5V23 M16.5 19.75H23",2.5]],
  arrange: [["p","M10 9H24 M10 14H24 M10 19H24",2.5],
            ["p","M5 6.5V21.5 M2.5 9L5 6.5L7.5 9 M2.5 19L5 21.5L7.5 19",2.5]],
  test: [["p","M10.5 3.5V11L4 22A1.5 1.5 0 0 0 5.3 24.3H22.7A1.5 1.5 0 0 0 24 22L17.5 11V3.5",2.5],
         ["p","M9 3.5H19",2.5], ["p","M8.5 17H19.5",2.5]],
  "break": [["c",14,14,10.5,2.5], ["p","M11 9.5V18.5 M17 9.5V18.5",2.5]],
  more: [["p","M4 8H24 M4 14H24 M4 20H24",2.5]],
  // A clipboard with the set square marked on its sheet. The square is drawn
  // on the board rather than beside it: two separate objects at this size and
  // the triangle collapses into a pennant.
  project: [["p","M4 8.9A2.4 2.4 0 0 1 6.4 6.5H21.6A2.4 2.4 0 0 1 24 8.9V22.6A2.4 2.4 0 0 1 21.6 25H6.4A2.4 2.4 0 0 1 4 22.6Z",2.4],
            ["p","M10.6 6.5V5.1A1.5 1.5 0 0 1 12.1 3.6h3.8A1.5 1.5 0 0 1 17.4 5.1V6.5",2.1],
            ["p","M8.5 20.5 L19.5 20.5 L19.5 11.5 Z",2.2]],
  // One job, ticked.
  task: [["r",4,4,20,20,3.5,2.5], ["p","M9 14.2 L12.6 17.8 L19.4 11",2.5]],
  // A gauge part filled, the run ahead marked off in divisions. Square corners
  // and a level that nearly fills the height, or it reads as a toggle switch;
  // a gap between level and outline, or the two merge into one blob.
  stages: [["r",2.6,8,22.8,12,2,2.5], ["f",4.85,10.25,10.45,7.5,0.6],
           ["p","M18.02 10.75V17.25 M21.58 10.75V17.25",1.5]],
  // A road sign on a post, planted on a ground line with two ticks - the
  // ticks a milestone line carries along its whole length.
  milestone: [["p","M3.5 24.5H24.5",2.5], ["p","M8 24.5V21 M20 24.5V21",2.2],
              ["p","M14 24.5V14",2.4], ["p","M14 3.5L19.5 9L14 14.5L8.5 9Z",2.4]],
  // The User Manual: an open book. Chosen over a ringed "?" because it does not
  // share the clock's silhouette, and the two sit next to each other.
  manual: [["p","M14 8 C11.5 6.2 7 5.8 3.5 6.8 V21.8 C7 20.8 11.5 21.2 14 23 C16.5 21.2 21 20.8 24.5 21.8 V6.8 C21 5.8 16.5 6.2 14 8 Z",2.5],
           ["p","M14 8 V23",2.5]]
};
// A modal that lands you where a menu row pointed shows that row's glyph beside
// its title, so the screen is visibly the one you tapped. Keyed by exact title.
// Three titles are worded differently from their row but are the same
// destination - Day Summary from Summary, Start Break from Break, Exit Test
// Mode from Test Mode - and are mapped deliberately rather than by accident.
//
// Titles absent from here render with no glyph, which is the right answer for
// the ones that never came from a menu row: confirmations, pickers, prompts.
// Some titles carry the record's name, so they can only be matched on their
// opening. Checked after the exact table, longest first, so a specific title
// always beats a prefix that happens to cover it.
var MODAL_GLYPH_PREFIX = [["Stages - ","stages"], ["Add to ","project"]];
var MODAL_GLYPHS = {
  "Edit Project":"project", "Edit Task":"task", "Add Task":"task",
  "Edit Lanes":"lanes", "Time Settings":"clock",
  "Interface":"interface", "Day Summary":"summary", "Reports":"reports",
  "Archive":"archive", "Backup & Saves":"backup", "Extensions":"extensions",
  "Leave Practice Board":"test", "Start Break":"break",
  "User Manual":"manual", "Guides":"manual"
};
// A glyph in front of a title. The board is inside dir=rtl when left-handed,
// so a flex row already lays its children right to left there - writing the
// glyph first is all that is needed for it to land after the title on that
// hand. An explicit UI.left conditional here would cancel the mirror out and
// pin the glyph on one side.
function TitleGlyph(props){
  return React.createElement(MenuIcon, { name:props.name, size:props.size||18,
    col:props.col||S.chromeText });
}
function ModalGlyph(props){
  var title=String(props.title||"");
  var name=MODAL_GLYPHS[title];
  if(!name){
    for(var i=0;i<MODAL_GLYPH_PREFIX.length;i++){
      if(title.indexOf(MODAL_GLYPH_PREFIX[i][0])===0){ name=MODAL_GLYPH_PREFIX[i][1]; break; }
    }
  }
  if(!name) return null;
  // 20px against a 1rem title: the menu's 28 would tower over it.
  if(name==="interface") return React.createElement(TouchSVG, { size:20, col:S.chromeText });
  return React.createElement(MenuIcon, { name:name, size:20, col:S.chromeText });
}
function MenuIcon(props){
  var size=props.size||MENU_ICON, col=props.col||S.chromeText;
  var parts=MENU_GLYPHS[props.name]||[];
  return React.createElement("svg", { width:size, height:size, viewBox:"0 0 28 28", fill:"none" },
    parts.map(function(el, i){
      var w=String(el[el.length-1]);
      if(el[0]==="c") return React.createElement("circle", { key:i, cx:el[1], cy:el[2], r:el[3],
        stroke:col, strokeWidth:w, fill:"none" });
      if(el[0]==="r") return React.createElement("rect", { key:i, x:el[1], y:el[2], width:el[3],
        height:el[4], rx:el[5], stroke:col, strokeWidth:w, fill:"none" });
      // "f" is a solid area, not an outline - the one thing in the set that is
      // filled, because a gauge level cannot be drawn as a stroke.
      if(el[0]==="f") return React.createElement("rect", { key:i, x:el[1], y:el[2], width:el[3],
        height:el[4], rx:el[5], fill:col, stroke:"none" });
      return React.createElement("path", { key:i, d:el[1], stroke:col, strokeWidth:w,
        strokeLinecap:"round", strokeLinejoin:"round", fill:"none" });
    })
  );
}

// A hand tapping: index extended at 45\u00B0 with two ripples spreading off the
// fingertip. The Interface group, where everything about how the app looks and
// is reached lives.
//
// Construction notes, because several of them are load-bearing:
//   - The ripples are concentric with the fingertip and each one is opened
//     along the hand's own axis, so it dies exactly where the hand begins
//     rather than crossing it.
//   - The underside runs straight from the heel to the thumb. An earlier
//     version curved back into the heel to open a pocket under the thumb; at
//     28px that pocket closed into a smudge, and the open crotch above the
//     thumb already carries its shape.
//   - No knuckle scallops on the trailing edge. Three bumps at this size fill
//     in and read as a lump rather than as fingers.
//   - The hand is drawn on its own 28-unit grid and scaled by 0.78, so its
//     stroke is pre-divided (2.5 / 0.78) to land back on the shared 2.5.
//     Changing the scale means changing that number too.
// Fitted to the 28-unit box by measuring the rendered artwork and solving for
// the scale, not by eye - the composition is a rotated hand plus two ripples,
// and its bounding box is nowhere near the paths' own coordinates. An earlier
// version overflowed to 28.1 x 23.3 units and shipped clipped at the corner.
// Geometry scales; the stroke weights do not, because they are the shared
// house weights and must land where the clock's do.
var TOUCH_SCALE = 0.6786;
function TouchSVG(props){
  var size=props.size||14, col=props.col||S.chromeText;
  var sw=(2.5/TOUCH_SCALE).toFixed(3);
  return (
    React.createElement("svg", { width:size, height:size, viewBox:"0 0 28 28", fill:"none" },
      React.createElement("path", { d:"M8.72 15.88 A4.176 4.176 0 1 1 13.73 10.87",
        stroke:col, strokeWidth:"2.2", strokeLinecap:"round", fill:"none" }),
      React.createElement("path", { d:"M8.06 18.76 A7.134 7.134 0 1 1 16.61 10.21",
        stroke:col, strokeWidth:"1.8", strokeLinecap:"round", fill:"none" }),
      React.createElement("g", { transform:"translate(9.66,11.81) rotate(-45) scale("+TOUCH_SCALE+") translate(-11.65,-0.9)" },
        React.createElement("path", { d:"M9.3 3.2a2.35 2.35 0 0 1 4.7 0V12.4h3.4a5.6 5.6 0 0 1 5.6 5.6v1.2"+
          "a6.2 6.2 0 0 1-6.2 6.2h-2.6L3.6 16.2A2.1 2.1 0 0 1 6.4 13.3C7.6 14.3 8.7 15.7 9.1 16.8"+
          "C9.2 17.2 9.3 17.6 9.3 18.0V3.2Z",
          stroke:col, strokeWidth:sw, strokeLinecap:"round", strokeLinejoin:"round", fill:"none" })
      )
    )
  );
}

// The settings menu reads at the size of the header buttons it drops out of:
// 1rem labels and 28px glyphs, the same as the Clock and Disruption buttons.
// A thumb moving from the header into the menu keeps aiming at the same target.
var MENU_FONT = "1rem";
var MENU_ICON = 28;

// ---- MENU GROUP MODAL --------------------------------------------------------
// A group of screens in the settings menu. These used to expand in place, which
// pushed everything below them down and, in a 72vh scroller on a phone, off the
// bottom - opening a group meant losing sight of the rest of the menu. A modal
// puts the choice on its own, at full size, and closes back to the board.
//
// It takes a list rather than knowing its contents so both groups - and any
// later one - are the same screen. Two hand-built versions would drift.
function MenuGroupModal(props){
  var title=props.title, items=props.items, onClose=props.onClose;
  return React.createElement(Modal, { title:title, onClose:onClose, ownActions:true },
    React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.5rem",marginBottom:"1rem"} },
      items.map(function(it){
        return React.createElement("button", { key:it.label, "data-groupitem":true, onClick:it.onSelect,
          style:{display:"flex",alignItems:"center",gap:"0.6rem",width:"100%",textAlign:"left",
                 background:S.bg1,border:"2px solid "+S.border,borderRadius:S.radius,
                 padding:"0.9rem 1rem",color:S.text,cursor:"pointer",
                 fontFamily:S.fontBody,fontWeight:700,fontSize:MENU_FONT,whiteSpace:"nowrap"} },
          it.label);
      })
    ),
    React.createElement("button", { onClick:onClose,
      style:{width:"100%",background:S.bg1,border:"1px solid "+S.border,borderRadius:S.radius,
             padding:"0.85rem",color:S.textDim,cursor:"pointer",fontFamily:S.fontBody,
             fontWeight:600,fontSize:MENU_FONT} }, "Close")
  );
}

// ---- HEADER BUTTONS ----------------------------------------------------------
// The Clock and Disruption buttons and the disruption reasons list. Components
// rather than inline so the User Manual can stage them exactly as the header
// draws them: state in, picture out. What a press DOES stays in the header.
function ClockButton(props){
  var clocked=!!props.clocked;
  var ckBg = clocked ? S.successBg2 : S.successBg;
  var ckBdr = clocked ? S.clockBdrOn : S.clockBdr;
  var ckIcon = clocked ? S.successText : S.successMid;
  var ckLblC = clocked ? S.successText : S.successMid;
  var ckSubC = S.successDim;
  return React.createElement("button", { "data-anchor":"hdr-clock", onClick:props.onClick,
      style:{flex:1,minHeight:"56px",display:"flex",alignItems:"center",justifyContent:"center",gap:"0.55rem",background:ckBg,border:"2.5px solid "+ckBdr,borderRadius:S.radius2,cursor:"pointer"} },
    React.createElement("svg", { width:28, height:28, viewBox:"0 0 28 28", fill:"none" },
      React.createElement("circle", { cx:"14", cy:"14", r:"11", stroke:ckIcon, strokeWidth:"2.5" }),
      React.createElement("path", { d:"M14 8 L14 14 L18 17", stroke:ckIcon, strokeWidth:"2.5", strokeLinecap:"round", strokeLinejoin:"round" })
    ),
    React.createElement("div", { style:{display:"flex",flexDirection:"column",alignItems:"flex-start",gap:"0.08rem"} },
      React.createElement("span", { style:{fontSize:"1rem",fontWeight:700,color:ckLblC,fontFamily:S.fontBody,lineHeight:1,whiteSpace:"nowrap"} }, clocked ? "Clock Out" : "Clock In"),
      React.createElement(Mono, { style:{fontSize:"0.72rem",color:ckSubC,lineHeight:1,whiteSpace:"nowrap"} }, props.sub)
    )
  );
}
// mode: "idle" (log one), "active" (a running job is paused - Resume), or
// "standalone" (a disruption with nothing running - End).
function DisruptButton(props){
  var dActive=props.mode==="active", dStandalone=props.mode==="standalone";
  var dBg = dActive ? S.dangerBg2 : S.dangerBg;
  var dBdr = dActive ? S.distBdrLive : (dStandalone ? S.distBdrOpen : S.distBdr);
  var dBangCol = dActive ? S.dangerBright : S.bang;
  var dLbl = dActive ? "Resume" : (dStandalone ? "End" : "Disruption");
  return React.createElement("button", { "data-anchor":"hdr-disrupt", onClick:props.onClick,
      style:{width:"100%",minHeight:"56px",display:"flex",alignItems:"center",justifyContent:"center",gap:"0.55rem",background:dBg,border:"2.5px solid "+dBdr,borderRadius:S.radius2,cursor:"pointer"} },
    React.createElement("span", { style:{fontSize:"1.6rem",fontWeight:900,color:dBangCol,letterSpacing:"-0.08em",lineHeight:1,fontFamily:S.fontBody} }, "!!"),
    React.createElement("div", { style:{display:"flex",flexDirection:"column",alignItems:"flex-start",gap:"0.1rem"} },
      React.createElement("span", { style:{fontSize:"1rem",fontWeight:700,color:S.dangerText,fontFamily:S.fontBody,lineHeight:1,whiteSpace:"nowrap"} }, dLbl),
      React.createElement(Mono, { style:{fontSize:"0.72rem",color:S.dangerText,opacity:0.75,lineHeight:1,whiteSpace:"nowrap"} }, props.sub)
    )
  );
}
// The reasons list the Disruption button drops. `place` is where the header
// pins it; the list owns how it looks.
function DisruptPresetList(props){
  return React.createElement("div", { "data-anchor":"disrupt-list",
      style:Object.assign({minWidth:"250px",background:S.menuBg,border:"1px solid #4A1A1A",borderRadius:S.radius2,boxShadow:"0 8px 32px rgba(0,0,0,0.6)",padding:"0.5rem",display:"flex",flexDirection:"column",gap:"0.4rem"}, props.place||{}) },
    (props.presets||[]).map(function(label,i){
      return React.createElement("button", { key:i, "data-distpreset":i, onClick:function(){ props.onPick(label); },
        style:{display:"flex",alignItems:"center",gap:"0.55rem",width:"100%",textAlign:"left",background:S.dangerBg,border:"2.5px solid #AA4040",borderRadius:"10px",padding:"0.6rem 0.85rem",cursor:"pointer",fontFamily:S.fontBody} },
        React.createElement("span", { style:{fontSize:"1.25rem",fontWeight:900,color:S.bang,letterSpacing:"-0.08em",lineHeight:1,flexShrink:0} }, "!!"),
        React.createElement("span", { style:{fontSize:"0.95rem",fontWeight:700,color:S.dangerText,whiteSpace:"nowrap"} }, label)
      );
    }),
    React.createElement("button", { onClick:props.onCustom,
      style:{display:"flex",alignItems:"center",gap:"0.55rem",width:"100%",textAlign:"left",background:S.bg1,border:"2px solid #5A3030",borderRadius:"10px",padding:"0.55rem 0.85rem",cursor:"pointer",fontFamily:S.fontBody} },
      React.createElement("span", { style:{fontSize:"1.1rem",fontWeight:700,color:S.distNote,flexShrink:0,lineHeight:1} }, "+"),
      React.createElement("span", { style:{fontSize:"0.9rem",fontWeight:600,color:S.distNote,whiteSpace:"nowrap"} }, "Custom note...")
    ),
    React.createElement("button", { onClick:props.onEdit,
      style:{display:"flex",alignItems:"center",gap:"0.55rem",width:"100%",textAlign:"left",background:S.bg1,border:"2px solid "+S.borderBright,borderRadius:"10px",padding:"0.55rem 0.85rem",cursor:"pointer",fontFamily:S.fontBody} },
      React.createElement(GearSVG, { size:14, col:S.chromeText }),
      React.createElement("span", { style:{fontSize:"0.9rem",fontWeight:600,color:S.chromeText,whiteSpace:"nowrap"} }, "Edit List")
    )
  );
}

// The ticker under (or over) the header buttons: date and time fixed on the
// left, then what is happening now. A component so the manual can stage it;
// the board hands it the state.
function HeaderTicker(props){
  var interrupting=props.interrupting, activeProj=props.activeProj, intElapsed=props.intElapsed;
  var wsActive=props.wsActive, elapsed=props.elapsed, onBreak=props.onBreak, breakLabel=props.breakLabel;
  var breakElapsed=props.breakElapsed, clocked=props.clocked, atWorkElapsed=props.atWorkElapsed;
  var nowTick=props.nowTick, hdrBottom=!!props.bottom;
  var tickerStatus = null;
  if(interrupting && activeProj){
    // No flashing labels. The disrupted project's own name breathes red on the
    // same slow cycle a running project's border uses, so the cue reads as the
    // counterpart of the green one rather than as an alarm.
    tickerStatus = React.createElement("span", { style:{display:"flex",alignItems:"center",gap:"0.5rem",minWidth:0} },
      React.createElement("span", { "data-glow":"1",
        style:Object.assign(glowVars(S.dangerText),
          {fontWeight:700,fontSize:"0.85rem",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}) },
        activeProj.name),
      React.createElement(Mono, { "data-glow":"1",
        style:Object.assign(glowVars(S.dangerText),
          {fontWeight:700,fontSize:"0.85rem",whiteSpace:"nowrap",flexShrink:0}) },
        fmtDur(intElapsed,true))
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
    // Clocked in with nothing running. The day clock keeps its green because
    // the day really is running; the label says what is not.
    tickerStatus = React.createElement("span", { style:{display:"flex",alignItems:"center",gap:"0.5rem"} },
      React.createElement("span", { style:{color:S.textDim,fontWeight:700,fontSize:"0.85rem",whiteSpace:"nowrap"} }, "No Activity"),
      React.createElement(Mono, { style:{color:S.successDim,fontWeight:500,fontSize:"0.8rem",whiteSpace:"nowrap"} }, fmtDur(atWorkElapsed,true))
    );
  } else {
    tickerStatus = React.createElement("span", { style:{display:"flex",alignItems:"center",gap:"0.5rem"} },
      React.createElement("span", { style:{color:S.textMuted,fontWeight:700,fontSize:"0.85rem",whiteSpace:"nowrap"} }, "No Activity")
    );
  }
  var tickerDate = React.createElement("span", { "data-anchor":"hdr-when", style:{color:S.titleText,fontWeight:700,fontSize:"0.88rem",fontFamily:S.fontBody,whiteSpace:"nowrap"} },
    new Date(nowTick).toLocaleDateString([],{weekday:"short",month:"short",day:"numeric"})
  );
  var tickerTime = React.createElement(Mono, { "data-anchor":"hdr-when", style:{color:S.text,fontSize:"0.88rem",fontWeight:700,whiteSpace:"nowrap"} }, fmtTime(nowTick));
  // Static, not scrolling. The date and time are fixed on the left where the
  // eye can find them without waiting for them to come round again; the status
  // takes the rest of the bar and truncates rather than moving.
  return React.createElement("div", { dir:"ltr", style:{display:"flex",alignItems:"center",gap:"0.75rem",padding:"0.25rem 0.85rem",minHeight:"28px",background:S.bg2,borderBottom:hdrBottom?"none":"1px solid "+S.border,boxShadow:hdrBottom?"inset 0 1px 0 "+S.border:"none",overflow:"hidden",whiteSpace:"nowrap"} },
    tickerDate, tickerTime,
    tickerStatus && React.createElement("span", { "data-anchor":"hdr-status", style:{display:"flex",alignItems:"center",flex:1,minWidth:0,overflow:"hidden"} }, tickerStatus)
  );

}
// The settings menu's button. The dropdown it opens stays in the header.
function HeaderMenuButton(props){
  var open=!!props.open;
  return React.createElement("button", { "data-anchor":"hdr-menu", onClick:props.onClick,
      style:{width:"100%",minHeight:"56px",display:"flex",alignItems:"center",justifyContent:"center",background:open?S.bg3:S.bg0,border:"2.5px solid "+(open?S.chromeBdrOn:S.chromeBdr),borderRadius:S.radius2,cursor:"pointer"} },
    React.createElement(MenuIcon, { name:"more", size:30, col:open?S.chromeIconOn:S.chromeText }));
}

// ---- USER MANUAL: GUIDES -----------------------------------------------------
// The manual's Guides: an index with two ways in, annotated PICTURES ("What's
// on my screen?") and STEP-THROUGHS ("How do I...?"). A picture's part can
// carry How >, which opens the step-through for it, so each one is written once.
//
// Content is DATA, here beside the features it describes, so it ships with
// every build and the freshness checks can hold it to the app: every anchor a
// guide rings must exist in what its stage renders, every practice record it
// names must exist in TEST_PROJECTS, and no prose quotes a figure - the
// practice board's numbers are relative to today and move every day.
//
// A STAGE is a live render of the real component, from the practice board's
// SHIPPED seed (never the user's practice edits, so the words always match the
// picture), scaled to fit and made inert. A position:fixed sheet inside a
// transformed box is contained by that box, so a sheet stages the same way a
// card does.
var HELP_PICTURES = {
  card: { title:"A card", back:"Back to card", stage:{ kind:"card", id:101 },
    blurb:"Every project and task on the board is a card. Tap a number to see what that part does.",
    parts:[
      { anchor:'[data-anchor="card-title"]', side:"above", label:"Its name",
        text:"One tap opens its menu. Two taps edit it. Swipe left to tuck it away.", guide:"collapse" },
      { anchor:'[data-anchor="card-start"]', side:"left", label:"Start",
        text:"Starts the clock on this job. Tap again to stop.", guide:"clock" },
      { anchor:'[data-anchor="card-time"]', side:"right", label:"Time logged",
        text:"Time recorded against it so far today." },
      { anchor:'[data-anchor="disruptions"]', side:"below", label:"Disruptions",
        text:"Interruptions today on the left. All of them, and the time they cost, on the right.", guide:"disrupt" },
      { anchor:"[data-complete]", side:"below", label:"Complete",
        text:"Finishes the job.", guide:"finish" }
    ] },
  header: { title:"The header", back:"Back to the header", stage:{ kind:"headerfull" }, padTop:26,
    blurb:"The bar that stays in view while the board scrolls. It can sit at the top or the bottom, under Interface and Layout.",
    parts:[
      { anchor:'[data-anchor="hdr-when"]', side:"above", label:"Date and time",
        text:"Always the current day and time." },
      { anchor:'[data-anchor="hdr-status"]', side:"above", label:"What is happening",
        text:"The job that is running and how long it has run. On a break it says so, and with nothing running it reads No Activity." },
      { anchor:'[data-anchor="hdr-disrupt"]', side:"below", label:"Disruption",
        text:"Log an interruption. While one is running this reads Resume.", guide:"disrupt" },
      { anchor:'[data-anchor="hdr-clock"]', side:"below", label:"Clock in and out",
        text:"Starts and ends the work day, with the day\u2019s time under it.", guide:"clock" },
      { anchor:'[data-anchor="hdr-menu"]', side:"below", label:"The menu",
        text:"The User Manual, Edit, the settings, Reports and the rest." }
    ] },
  reports: { title:"Reports", covers:["Reports"], back:"Back to Reports", stage:{ kind:"reports" }, padTop:16,
    blurb:"Clocking out opens it on the day you just finished. Further down it lists every lane and project with its time, and Copy report puts the lot on the clipboard.",
    parts:[
      { anchor:'[data-anchor="rep-period"]', side:"right", label:"How much time",
        text:"A day, a week, a month or a pay period. Pay period follows the pay cycle set in Time Settings." },
      { anchor:'[data-anchor="rep-nav"]', side:"right", label:"Back and forward",
        text:"The arrows step to the period before or after." },
      { anchor:'[data-anchor="rep-summary"]', side:"right", label:"The headline",
        text:"What the period came to, against the hours you were scheduled for." },
      { anchor:'[data-anchor="rep-stats"]', side:"right", label:"The detail",
        text:"Time clocked, breaks, disruptions and the rest, side by side." },
      { anchor:"[data-msreport]", side:"corner", label:"Milestones",
        text:"Steps that fell due in the period: met on time, late or missed, and what is coming next." }
    ] },
  schedule: { title:"Work Schedule", covers:["Work Schedule"], back:"Back to the schedule", stage:{ kind:"schedule", day:true, full:true }, padTop:16,
    blurb:"Under Time Settings in the menu. The days and hours you normally work: Reports measure your time against it, and clocking in outside it asks which shift the time belongs to.",
    parts:[
      { anchor:'[data-anchor="sch-pay"]', side:"right", label:"Pay & Work Week", guide:"setpay",
        text:"A one-line summary of how you are paid and when your week starts. Edit opens the full sheet." },
      { anchor:'[data-schedday="mon"]', side:"right", label:"Your days",
        text:"Tap a day\u2019s name to switch it on or off, then set its start and end. Its hours, after unpaid breaks, show on the right.", guide:"setschedule" },
      { anchor:'[data-anchor="sch-overnight"]', side:"right", label:"Overnight shifts", guide:"night",
        text:"An end earlier than the start runs into the next morning. The row is marked and the whole shift counts as one work day." },
      { anchor:'[data-anchor="sch-unpaid"]', side:"right", label:"Unpaid Breaks", guide:"setunpaid",
        text:"Switch it on to take lunches and other unpaid time off the scheduled hours. Edit Breaks says which and when." },
      { anchor:'[data-anchor="sch-total"]', side:"right", label:"Scheduled per week",
        text:"Every day added up, less the unpaid breaks. This is the figure Reports measure your week against. Save keeps your changes." }
    ] },
  paywork: { title:"Pay & Work Week", covers:["Pay & Work Week"], back:"Back to Pay & Work Week", stage:{ kind:"paywork", full:true }, padTop:16,
    blurb:"Work Schedule, then Edit beside Pay & Work Week. What Reports need to turn hours into pay. Every amount is gross, before deductions.",
    parts:[
      { anchor:'[data-anchor="pay-base"]', side:"corner", label:"Base Pay", guide:"setpay",
        text:"Hourly with a rate, or salary with an amount per pay period. On salary, overtime uses the salary spread over the scheduled hours." },
      { anchor:'[data-anchor="pay-week"]', side:"corner", label:"Week Starts On",
        text:"The day a week begins, for weekly Reports and weekly pay." },
      { anchor:'[data-anchor="pay-otdays"]', side:"corner", label:"Overtime Days", guide:"setpay",
        text:"Tick the days where any time worked counts as overtime, such as weekends." },
      { anchor:'[data-anchor="pay-otrate"]', side:"corner", label:"Overtime Rate", guide:"setpay",
        text:"Time and a half, double time, or the regular rate plus a set amount per hour." },
      { anchor:'[data-anchor="pay-exclude"]', side:"corner", label:"Hours excluded",
        text:"The first overtime hours each week or each pay cycle that pay the base rate instead. On salary they are covered by the salary." },
      { anchor:'[data-anchor="pay-cycle"]', side:"corner", label:"Pay Cycle",
        text:"Daily, weekly, biweekly or monthly, counted from the start date. The Pay period in Reports follows it. Done keeps your changes." }
    ] },
  unpaid: { title:"Unpaid Breaks", covers:["Unpaid Breaks","Edit Breaks"], back:"Back to Unpaid Breaks", stage:{ kind:"unpaid", full:true }, padTop:16,
    blurb:"Work Schedule, then Edit Breaks. Time that comes off your scheduled hours.",
    parts:[
      { anchor:'[data-anchor="ub-every"]', side:"corner", label:"Every Work Day", guide:"setunpaid",
        text:"Breaks taken on every scheduled day, like lunch: a name, when it starts and how many minutes. Add Break adds another." },
      { anchor:'[data-anchor="ub-custom"]', side:"corner", label:"Custom Daily Breaks", guide:"setunpaid",
        text:"Extra breaks on one day of the week, on top of the ones above. Tap a day to open it; the badge counts its breaks." },
      { anchor:'[data-anchor="ub-total"]', side:"corner", label:"Unpaid per week",
        text:"Everything that comes off the week. Done keeps it, and Save on the schedule makes it stick." }
    ] },
  tracking: { title:"Tracking", back:"Back to Tracking", stage:{ kind:"tracking" }, padTop:16, covers:["Tracking"],
    blurb:"Under Time Settings in the menu. How time is captured and shown.",
    parts:[
      { anchor:'[data-anchor="set-tracking"]', side:"right", label:"Capture",
        text:"Timers runs a clock while you work. Manual Entry is for putting time on a job by hand instead." },
      { anchor:'[data-anchor="set-timeinc"]', side:"right", label:"Time increments",
        text:"Hours, minutes and seconds, or decimal hours for a timesheet that wants them. It changes every figure in the app at once." },
      { anchor:'[data-anchor="set-shiftgrace"]', side:"right", label:"Shift boundary",
        text:"How early or late you can clock in before it asks which shift the time belongs to." }
    ] },
  themes: { title:"Themes", covers:["Interface","Themes"], back:"Back to Themes", stage:{ kind:"themes" }, padTop:16,
    blurb:"Under Interface in the menu. How the app looks; none of it changes your data.",
    parts:[
      { anchor:'[data-anchor="set-theme"]', side:"right", label:"Theme",
        text:"Shape, texture and type together. Swipe or use the arrows to go through them." },
      { anchor:'[data-anchor="set-palette"]', side:"right", label:"Palette",
        text:"The colours, from the ones this theme allows." },
      { anchor:'[data-anchor="set-typeface"]', side:"right", label:"Typeface",
        text:"Each theme remembers the one you picked for it." },
      { anchor:'[data-anchor="set-mode"]', side:"right", label:"Dark or light",
        text:"Tap a side or slide the thumb across." }
    ] },
  layout: { title:"Layout", covers:["Layout"], back:"Back to Layout", stage:{ kind:"layout" }, padTop:16,
    blurb:"Under Interface in the menu. Where the controls sit, so they fall under your thumb.",
    parts:[
      { anchor:'[data-anchor="set-hand"]', side:"right", label:"Handedness",
        text:"Mirrors the whole app for a left or right hand: the menu, the Save buttons, the board." },
      { anchor:'[data-anchor="set-header"]', side:"right", label:"Header position",
        text:"Puts the header at the top or the bottom of the screen. Swipe up or down on it, or tap." }
    ] },
  summary: { title:"Day Summary", covers:["Summary"], back:"Back to the summary", stage:{ kind:"summary" }, padTop:16,
    blurb:"Summary in the menu. The day so far as plain text, ready to paste into a log or a message.",
    parts:[
      { anchor:'[data-anchor="sum-copy"]', side:"corner", label:"Copy",
        text:"Puts the whole summary on the clipboard." },
      { anchor:'[data-anchor="sum-lines"]', side:"right", label:"The day",
        text:"Each job once, with its nested work indented under it. A job\u2019s time includes what sits under it, so the top lines add up to the total. Then breaks and the time lost to disruptions." }
    ] },
  archive: { title:"The Archive", covers:["Archive"], back:"Back to the Archive", stage:{ kind:"archive" }, padTop:16,
    blurb:"Archive in the menu. Everything that has been completed, abandoned or superseded, newest first, with all of its history kept.",
    parts:[
      { anchor:'[data-anchor="arch-time"]', first:true, side:"above", label:"Its time",
        text:"Everything logged against it and its tasks, all-time." },
      { anchor:'[data-anchor="arch-meta"]', first:true, side:"right", label:"Where it was",
        text:"Its lane, whether it had an end, its tasks, and when it was closed." },
      { anchor:'[data-anchor="arch-reopen"]', first:true, side:"left", label:"Reopen",
        text:"Puts it back on the board where it was. Holding the grey pill on the board does the same." }
    ] },
  extensions: { title:"Extensions", covers:["Extensions"], back:"Back to Extensions", stage:{ kind:"extensions" }, padTop:16,
    blurb:"Extensions in the menu. Extra kinds of record that ship inside the app and switch on here, like the Tool Tracker. Off, they are hidden everywhere and keep their data.",
    parts:[
      { anchor:'[data-anchor="ext-version"]', first:true, side:"above", label:"Which one",
        text:"Its name and version." },
      { anchor:'[data-anchor="set-Tool Tracker"]', side:"right", label:"On or off",
        text:"Switching on adds its row to the menu under Modules. Switching off hides it and keeps everything." },
      { anchor:'[data-anchor="ext-data"]', first:true, side:"below", label:"Its data",
        text:"What it has stored. Delete data asks first, and only a backup brings it back. All of it is in Backup and Saves." }
    ] },
  msline: { title:"A milestone line", back:"Back to the line", stage:{ kind:"msline" }, padTop:52, tryit:"msline",
    blurb:"A project\u2019s milestones laid out in time. Each sign is a step, coloured by how it stands. Lanes and the board carry the same line, gathered from everything beneath them.",
    parts:[
      { anchor:'[data-msstatus="met"]', first:true, side:"above", label:"Met",
        text:"Solid green: the step happened by its date. Completing the job it was waiting on is enough." },
      { anchor:"[data-driftarc]", first:true, side:"above2", label:"Slipped",
        text:"A step met late. A faint sign stays on the date it was due, the arc runs to where it really happened, and its sign there is amber. Signs that land close together share one post, with a dot for each." },
      { anchor:'[data-msstatus="missed"]', first:true, side:"below", label:"Missed",
        text:"Red: its date has passed and it is still open." },
      { anchor:'[data-msstatus="upcoming"]', first:true, side:"above", label:"Still to come",
        text:"Hollow grey. It fills in when it is met." },
      { anchor:"[data-msnow]", side:"below", label:"Now",
        text:"The small pointer under the line. Everything left of it has happened." },
      { anchor:"[data-mszoom]", side:"below", label:"Zoom",
        text:"Tap to step closer. Hold to see the whole line again. Zoomed in, drag the line sideways." }
    ] }
};
var HELP_GUIDES = {
  clock: { title:"Start and stop the clock",
    steps:[
      { stage:{ kind:"header", clocked:false, dmode:"idle" }, ring:'[data-anchor="hdr-clock"]', title:"Clock in",
        text:"Tap Clock In when your day starts. If it is outside your scheduled shift, it asks which shift the time belongs to." },
      { stage:{ kind:"card", id:101 }, ring:'[data-anchor="card-start"]', side:"left", title:"Start a job",
        text:"Tap Start on a card. If you have not clocked in yet, this clocks you in as well. Starting another job stops this one, so only one ever runs." },
      { stage:{ kind:"card", id:101, state:"running" }, ring:'[data-anchor="card-start"]', side:"left", title:"Stop it",
        text:"A running card lights up and its button reads Stop. Tap it when you are done, and the time goes into the day\u2019s log." },
      { stage:{ kind:"header", clocked:true, dmode:"idle" }, ring:'[data-anchor="hdr-clock"]', title:"Clock out",
        text:"At the end of the day, tap Clock Out. Whatever is running stops, and Reports opens on the day you just finished." }
    ] },
  disrupt: { title:"Log a disruption",
    steps:[
      { stage:{ kind:"header", clocked:true, dmode:"idle" }, ring:'[data-anchor="hdr-disrupt"]', title:"Tap Disruption",
        text:"When something pulls you off the job, tap Disruption in the header. A list of reasons drops down." },
      { stage:{ kind:"presets" }, ring:"[data-distpreset]", side:"right", title:"Pick the reason",
        text:"Tap the one that fits. Custom note lets you type your own, and Edit List changes the choices." },
      { stage:{ kind:"card", id:101, state:"disrupted" }, ring:'[data-anchor="card-start"]', side:"left", title:"The job is paused",
        text:"The running job stops counting and its button reads Paused. The time you lose is counted against that job, in its red badge." },
      { stage:{ kind:"header", clocked:true, dmode:"active" }, ring:'[data-anchor="hdr-disrupt"]', title:"Get back to it",
        text:"Tap Resume in the header, or Paused on the card, and the job carries on. With nothing running, a disruption is logged on its own and the button reads End." }
    ] },
  finish: { title:"Finish a job",
    steps:[
      { stage:{ kind:"card", id:101 }, ring:"[data-complete]", title:"Hold Complete", tryit:"hold",
        text:"Press and keep pressing until the bar fills. A quick tap does nothing, so it can never happen by accident." },
      { stage:{ kind:"close", id:101 }, ring:"[data-closeopt]", title:"Say how it ended",
        text:"Done, abandoned or superseded. Then when it finished, and a note on where things were left." },
      { stage:{ kind:"close", id:103 }, ring:"[data-closekids]", title:"Settle anything still open",
        text:"Every open task or nested project inside it must be moved somewhere else or deleted. Complete stays locked until each one is decided." },
      { stage:{ kind:"card", id:103 }, ring:"[data-donerow]", title:"It stays on the board",
        text:"It shrinks to a grey pill below your live work, so you can see it happened. Hold the pill to reopen it." }
    ] },
  night: { title:"Clock in for a night shift", covers:["Time Settings","Work Schedule","Logging to"],
    steps:[
      { stage:{ kind:"schedule" }, ring:'[data-schedday="mon"]', side:"right", title:"Set the shift",
        text:"In Time Settings, Work Schedule, give the day an end earlier than its start. The row is marked as running into the next day, and the whole shift counts as one work day." },
      { stage:{ kind:"header", clocked:true, dmode:"idle" }, ring:'[data-anchor="hdr-clock"]', title:"Clock in as normal",
        text:"Clock in when the shift starts. Everything you log after midnight still belongs to the day the shift began, so the board and Reports keep the night together. While you are clocked in, Logging to in the menu shows which day that is; tap it to change shift." },
      { stage:{ kind:"shiftask" }, ring:"[data-shiftchoice]", side:"right", title:"Outside the shift, it asks",
        text:"Start early, late or between shifts and it asks which shift the time belongs to: the one that just ended or the one coming up." },
      { stage:{ kind:"shiftask", ot:true }, ring:"[data-shiftchoice]", side:"right", title:"A day off asks one more thing",
        text:"Working a day that is not on your schedule? Say whether it is regular time or overtime. Reports uses that answer for pay." }
    ] },
  backup: { title:"Back up, save and start over", covers:["Backup & Saves"],
    steps:[
      { stage:{ kind:"backup", only:"auto" }, ring:'[data-anchor="saves-auto"]', side:"below", title:"Automatic backups",
        text:"Every clock-out keeps a copy of the whole board. It holds the last of each of the last seven days, four weeks and twelve months, and the oldest rolls off as new ones come in. Load puts the board back to that copy." },
      { stage:{ kind:"backup", only:"saves" }, ring:'[data-anchor="saves-save"]', side:"below", title:"Save before you try something",
        text:"Save the board now keeps this exact moment until you delete it. Give it a name if you like, so you know later why you made it. There is room for five." },
      { stage:{ kind:"backup", only:"reset" }, ring:'[data-anchor="saves-reset"]', side:"below", title:"Start over",
        text:"Reset clears only what you tick. Reset state keeps your projects and clears the time; Factory reset puts everything back to how the app ships. A backup is taken first, so it can be undone." },
      { stage:{ kind:"backup", only:"file" }, ring:'[data-anchor="backup-export"]', side:"right", title:"Export a backup file",
        text:"Everything, saves included, lives on this phone, so deleting the app deletes it. Tap Export Backup now and then. On a phone it offers to share the file: save it to Files or send it to yourself." },
      { stage:{ kind:"backup", only:"file" }, ring:'[data-anchor="backup-choose"]', side:"right", title:"Restore from a file",
        text:"Choose Backup File and pick the file you saved. Nothing changes yet." },
      { stage:{ kind:"backup", only:"file", preview:true }, ring:'[data-anchor="backup-replace"]', side:"right", title:"Check it, then replace",
        text:"It shows when the backup was made and what is in it. Replace All Data and Restore swaps everything in the app for the backup and reloads. Pick a Different File backs out." }
    ] },
  outline: { title:"Rearrange with Edit\u2026", covers:["Edit\u2026"],
    steps:[
      { stage:{ kind:"outline" }, ring:'[data-outlinekey="L:Projects"]', side:"corner", title:"Everything in one list",
        text:"Edit in the menu opens the outline: every lane, with its projects, tasks and stages beneath it, in the order they sit on the board." },
      { stage:{ kind:"outline" }, ring:'[data-outlinepick="P:102"]', side:"left", title:"Pick a row",
        text:"Tap the glyph at the start of a row to pick it up. Tap its name once for its menu, twice to edit its details; moves you have made are kept." },
      { stage:{ kind:"outline", sel:"P:102" }, ring:"[data-pad]", side:"left", title:"Move it with the arrows",
        text:"Up and down move it among its neighbours. At the end of its group, one more step takes it out, and asks first. Left and right change how deep it sits." },
      { stage:{ kind:"outline", sel:"P:102" }, ring:"[data-role]", side:"left", title:"Task or project",
        text:"When a row steps inside another, choose here whether it goes in as a task or as a nested project. A task can only hold tasks." },
      { stage:{ kind:"outline" }, ring:'[data-anchor="outline-save"]', side:"left", title:"Save puts it on the board",
        text:"Nothing on the board changes until you Save. Cancel throws the moves away. Done puts the arrows away when you have finished moving." },
      { stage:null, title:"Try it here", tryit:"outline",
        text:"A practice copy of the outline. Move rows as much as you like; Save here only tells you what would happen." }
    ] },
  milestone: { title:"Set up a milestone",
    steps:[
      { stage:{ kind:"msline" }, ring:"[data-msstrip]", side:"corner", title:"Open the milestones",
        text:"Tap a project\u2019s milestone line, or choose Milestones from the project\u2019s menu. A project with none yet starts from the menu." },
      { stage:{ kind:"msedit" }, ring:"[data-msadd]", side:"left", title:"Add a step",
        text:"The project\u2019s steps in the order they fall, with its line across the top. Add step makes a new one; tap a step to change it." },
      { stage:{ kind:"msstep" }, ring:"[data-mslabel]", side:"corner", title:"Name it and date it",
        text:"A short name, and the day and time it is due." },
      { stage:{ kind:"msstep" }, ring:"[data-mstarget]", side:"left", title:"Say what it waits for",
        text:"Under Expects these closed out, pick the jobs it depends on. When they are completed, the step turns green by itself." },
      { stage:{ kind:"msstep", step:"tm3" }, ring:"[data-msmarkmet]", side:"corner", title:"Or mark it by hand",
        text:"Nothing to wait for? Tap Mark met now when it happens. Hold it instead to say when it really happened, so a step met on time does not read late." },
      { stage:{ kind:"msedit" }, ring:"[data-mssaveall]", side:"left", title:"Save",
        text:"Save keeps the steps on the project and its line updates. Cancel drops what you changed." }
    ] },
  setschedule: { title:"Set my work schedule", covers:["Work Schedule"],
    steps:[
      { stage:{ kind:"schedule", day:true }, ring:'[data-schedday="sat"]', side:"right", title:"Turn days on and off",
        text:"Time Settings, then Work Schedule. Tap a day\u2019s name to switch it on or off. A day that is off counts nothing." },
      { stage:{ kind:"schedule", day:true }, ring:'[data-schedday="tue"]', side:"below", title:"Set the hours",
        text:"Set when the day starts and ends. Its hours, after any unpaid breaks, show at the end of the row." },
      { stage:{ kind:"schedule" }, ring:'[data-schedday="mon"]', side:"below", title:"Shifts that run past midnight",
        text:"An end earlier than the start is an overnight shift: it is marked as ending the next day, and the whole shift counts as one work day." },
      { stage:{ kind:"schedule", day:true, full:true }, ring:'[data-anchor="sch-total"]', side:"corner", title:"Check the week, then Save",
        text:"Scheduled per week adds it all up, less unpaid breaks. Reports measure your time against it. Save keeps it." }
    ] },
  setpay: { title:"Set up pay and overtime", covers:["Pay & Work Week"],
    steps:[
      { stage:{ kind:"schedule", day:true }, ring:'[data-anchor="sch-pay"]', side:"below", title:"Open Pay & Work Week",
        text:"In Work Schedule, the top row sums up your pay. Tap Edit beside it." },
      { stage:{ kind:"paywork", full:true }, ring:'[data-anchor="pay-base"]', side:"below", title:"Hourly or salary",
        text:"Pick one and enter the rate or the salary per pay period. Everything is gross, before any deductions." },
      { stage:{ kind:"paywork", full:true }, ring:'[data-anchor="pay-otdays"]', side:"below", title:"Days that pay overtime",
        text:"Tick the days where any time worked counts as overtime." },
      { stage:{ kind:"paywork", full:true }, ring:'[data-anchor="pay-otrate"]', side:"corner", title:"How overtime pays",
        text:"Time and a half, double time, or a set amount more per hour. Hours excluded lets the first overtime hours each week or pay cycle pay the base rate instead." },
      { stage:{ kind:"paywork", full:true }, ring:'[data-anchor="pay-cycle"]', side:"corner", title:"When you are paid",
        text:"Daily, weekly, biweekly or monthly, from the start date. Reports\u2019 Pay period follows it. Done, then Save on the schedule." }
    ] },
  setunpaid: { title:"Add unpaid breaks", covers:["Unpaid Breaks","Edit Breaks"],
    steps:[
      { stage:{ kind:"schedule", day:true, full:true }, ring:'[data-anchor="sch-unpaid"]', side:"corner", title:"Switch them on",
        text:"In Work Schedule, tap Unpaid Breaks to switch it on, then Edit Breaks." },
      { stage:{ kind:"unpaid", full:true }, ring:'[data-anchor="ub-every"]', side:"below", title:"Breaks every day",
        text:"Every Work Day holds breaks taken on each scheduled day. Give each a name, a start and its minutes; Add Break adds another." },
      { stage:{ kind:"unpaid", full:true }, ring:'[data-anchor="ub-custom"]', side:"corner", title:"Breaks on one day",
        text:"Custom Daily Breaks adds extras on a single day of the week, on top of the ones above. Tap the day to open it." },
      { stage:{ kind:"unpaid", full:true }, ring:'[data-anchor="ub-total"]', side:"corner", title:"Check the total",
        text:"Unpaid per week shows what comes off. Done, then Save on the schedule." }
    ] },
  breaks: { title:"Take a break", covers:["Break","End Break"],
    steps:[
      { stage:{ kind:"breaks" }, ring:"[data-breakpreset]", side:"right", title:"Start a break",
        text:"While you are clocked in, the menu opens with Break near the top. It offers the usual ones, or type your own. Whatever job is running stops, and the break is kept out of your worked time." },
      { stage:{ kind:"ticker" }, ring:'[data-anchor="hdr-status"]', title:"While you are on it",
        text:"The header says On Break, with how long it has run. When you are back, End Break in the same menu stops it; then start your job again from its card." }
    ] },
  collapse: { title:"Collapse and expand",
    steps:[
      { stage:{ kind:"card", id:101 }, ring:'[data-anchor="card-title"]', side:"above", title:"Swipe left on its name", tryit:"swipe",
        text:"Swipe left across a card\u2019s name and it shrinks to a slim pill. Lanes and task rows work the same way." },
      { stage:{ kind:"card", id:101, collapsed:true }, ring:'[data-anchor="card-pill"]', title:"Swipe right to open it",
        text:"A pill only opens to the right, so a stray swipe cannot shut anything. A running job still shows its time on the pill." }
    ] }
};
// Practice pages: the Try it panels gathered in one place, no reading needed.
var HELP_PRACTICE = {
  gestures: { title:"Tap, double tap, hold and swipe", panels:["taps","hold","swipe","msline","outline"],
    blurb:"Every gesture the board uses, to try right here. Nothing you do on this page changes anything." }
};
// By topic (Brent, 10-10: layout B). Each topic holds its pictures and its
// step-throughs together; a guide may sit under more than one topic. A
// `flat` topic draws its rows straight on the index, no group to open.
var HELP_INDEX = [
  { id:"board", topic:"The board", items:[["picture","header"],["picture","card"],["picture","msline"],
      ["guide","collapse"],["guide","outline"],["guide","milestone"],["guide","finish"]] },
  { id:"day", topic:"My day: clock, breaks, disruptions", items:[["guide","clock"],["guide","breaks"],["guide","disrupt"],["guide","night"]] },
  { id:"time", topic:"Time Settings", items:[["picture","schedule"],["picture","paywork"],["picture","unpaid"],["picture","tracking"],
      ["guide","setschedule"],["guide","setpay"],["guide","setunpaid"],["guide","night"]] },
  { id:"reports", topic:"Reports & records", items:[["picture","reports"],["picture","summary"],["picture","archive"]] },
  { id:"data", topic:"Your data", items:[["guide","backup"]] },
  { id:"look", topic:"Look & add-ons", items:[["picture","themes"],["picture","layout"],["picture","extensions"]] },
  { id:"practice", topic:"Practise", flat:true, items:[["practice","gestures"]] }
];
// Every registry the manual reads: the core's, then each ENABLED module's. A
// module's keys arrive already namespaced (`tools:screen`), so the merge cannot
// collide with a core id, and a module that is switched off is simply not here.
// Module topics go after the core topics and before the flat Practise topic.
function helpAll(){
  var pictures=Object.assign({}, HELP_PICTURES), guides=Object.assign({}, HELP_GUIDES);
  var topics=HELP_INDEX.filter(function(t){ return !t.flat; });
  var flat=HELP_INDEX.filter(function(t){ return t.flat; });
  ttEnabledModules().forEach(function(m){
    var h=m.help; if(!h) return;
    var items=[];
    Object.keys(h.pictures||{}).forEach(function(id){ pictures[id]=helpTagPicture(m.id, h.pictures[id]); items.push(["picture", id]); });
    Object.keys(h.guides||{}).forEach(function(id){ guides[id]=helpTagGuide(m.id, h.guides[id]); items.push(["guide", id]); });
    if(items.length) topics.push({ id:"module-"+m.id, topic:h.topic, items:items });
  });
  return { pictures:pictures, guides:guides, practice:HELP_PRACTICE, index:topics.concat(flat), panels:HELP_PANELS };
}
// A module's stages are tagged with its id so the manual can hand them to that
// module's own stage renderer. The tag is added here; a module never writes it.
function helpTagStage(id, st){ return st ? Object.assign({ module:id }, st) : st; }
function helpTagPicture(id, p){ return Object.assign({}, p, { stage:helpTagStage(id, p.stage) }); }
function helpTagGuide(id, g){
  return Object.assign({}, g, { steps:g.steps.map(function(st){ return Object.assign({}, st, { stage:helpTagStage(id, st.stage) }); }) });
}
function helpEntry(kind, id){ var A=helpAll(); return kind==="picture" ? A.pictures[id] : kind==="practice" ? A.practice[id] : A.guides[id]; }
function helpCount(kind, d){ return kind==="picture" ? d.parts.length+" parts" : kind==="practice" ? d.panels.length+" to try" : d.steps.length+" steps"; }
// ---- search -----------------------------------------------------------------
// Every title, picture part and step, read off the registries - so a new
// picture or guide is searchable the moment it exists.
function helpSearchDocs(){
  var out=[], A=helpAll();
  Object.keys(A.pictures).forEach(function(id){
    var pic=A.pictures[id];
    out.push({ kind:"picture", id:id, at:0, title:pic.title, where:"What\u2019s on screen", text:pic.blurb||"" });
    pic.parts.forEach(function(pt, i){ out.push({ kind:"picture", id:id, at:i, title:pt.label, where:pic.title+" \u00B7 part "+(i+1), text:pt.text }); });
  });
  Object.keys(A.guides).forEach(function(id){
    var g=A.guides[id];
    out.push({ kind:"guide", id:id, at:0, title:g.title, where:"How do I\u2026?", text:g.steps[0] ? g.steps[0].text : "" });
    g.steps.forEach(function(st, i){ out.push({ kind:"guide", id:id, at:i, title:st.title, where:g.title+" \u00B7 step "+(i+1), text:st.text }); });
  });
  Object.keys(A.practice).forEach(function(id){
    var pr=A.practice[id]; out.push({ kind:"practice", id:id, at:0, title:pr.title, where:"Practise", text:pr.blurb||"" });
  });
  return out;
}
function helpSearch(q){
  var words=String(q||"").toLowerCase().split(/\s+/).filter(Boolean);
  if(!words.length) return [];
  return helpSearchDocs().map(function(d){
    var t=d.title.toLowerCase(), x=d.text.toLowerCase(), w=d.where.toLowerCase(), score=0;
    for(var i=0;i<words.length;i++){
      var inT=t.indexOf(words[i])>=0, inX=x.indexOf(words[i])>=0, inW=w.indexOf(words[i])>=0;
      if(!inT && !inX && !inW) return null;
      score+=(inT?3:0)+(inX?1:0)+(inW?1:0);
    }
    return { d:d, score:score };
  }).filter(Boolean).sort(function(a,b){ return b.score-a.score; }).slice(0,40).map(function(r){ return r.d; });
}
// A slice of the text around the first word found, with every word marked.
function helpSnippet(text, q){
  var words=String(q||"").toLowerCase().split(/\s+/).filter(Boolean), low=text.toLowerCase(), at=-1;
  words.forEach(function(w){ var i=low.indexOf(w); if(i>=0 && (at<0 || i<at)) at=i; });
  var from=Math.max(0, at-40), to=Math.min(text.length, from+130);
  // Start and end on whole words.
  if(from>0){ var sp=text.indexOf(" ", from); if(sp>=0 && sp<at) from=sp+1; }
  if(to<text.length){ var sp2=text.lastIndexOf(" ", to); if(sp2>from) to=sp2; }
  var cut=(from>0?"\u2026":"")+text.slice(from,to)+(to<text.length?"\u2026":"");
  if(!words.length) return cut;
  var re=new RegExp("("+words.map(function(w){ return w.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"); }).join("|")+")","ig");
  return cut.split(re).map(function(piece, i){
    return i%2 ? React.createElement("mark", { key:i, style:{ background:rgba(S.infoText,0.22), color:S.infoText, borderRadius:"3px", padding:"0 1px" } }, piece) : piece;
  });
}
// The search field, pinned under the action bar on every page of the manual.
function HelpSearchBar(props){
  var ref=useRef(null);
  var topS=useState(0); var setTop=topS[1]; var top=topS[0];
  useEffect(function(){
    var el=ref.current, panel=el&&el.closest("[data-modal-panel]");
    var bar=panel&&panel.querySelector(":scope > [data-surface=\"menu\"]");
    setTop(!UI.bottom && bar ? bar.offsetHeight-HELP_BAR_OVERHANG : -HELP_BAR_OVERHANG);
  }, []);
  return React.createElement("div", { ref:ref, "data-helpsearch":true, "data-stucktop":top,
      style:{ position:"sticky", top:top+"px", zIndex:4, background:S.modalBg, margin:"0 -0.4rem 0.6rem", padding:(top<0?"1.6rem":"0.35rem")+" 0.4rem 0.5rem",
              flexShrink:0 } },
    React.createElement("div", { style:{ position:"relative" } },
      React.createElement("input", { "data-helpquery":true, type:"text", enterKeyHint:"search", autoComplete:"off", value:props.query, placeholder:"Search the manual",
        "aria-label":"Search the manual", onChange:function(e){ props.setQuery(e.target.value); },
        style:Object.assign({}, INPUT_STYLE, { paddingLeft:"2.1rem", paddingRight:"2.2rem" }) }),
      React.createElement("span", { "aria-hidden":true, style:{ position:"absolute", left:"0.75rem", top:"50%", transform:"translateY(-50%)",
        color:S.textMuted, fontSize:"1rem", pointerEvents:"none" } }, "\u2315"),
      props.query ? React.createElement("button", { "data-helpclear":true, "aria-label":"Clear search", onClick:function(){ props.setQuery(""); },
        style:{ position:"absolute", right:"0.4rem", top:"50%", transform:"translateY(-50%)", background:"none", border:"none",
                color:S.textDim, fontSize:"1rem", padding:"0.3rem 0.45rem", cursor:"pointer" } }, "\u2715") : null));
}
function HelpSearchResults(props){
  var hits=helpSearch(props.query);
  return React.createElement("div", { "data-helpresults":hits.length },
    React.createElement("div", { style:Object.assign({}, LABEL_STYLE, { margin:"0.3rem 0 0.5rem" }) },
      hits.length ? (hits.length===1 ? "One match" : hits.length+" matches") : "Nothing matches that. Try a shorter word."),
    hits.map(function(d, i){
      return React.createElement("button", { key:d.kind+d.id+d.at+"-"+i, "data-helphit":d.kind+":"+d.id+":"+(d.at+1),
          onClick:function(){ props.onPick(d); },
          style:{ display:"block", width:"100%", textAlign:"left", background:S.bg1, border:"1px solid "+S.border, borderRadius:S.radius,
                  padding:"0.6rem 0.75rem", marginBottom:"0.45rem", cursor:"pointer", fontFamily:S.fontBody } },
        React.createElement("div", { style:{ display:"flex", alignItems:"center", gap:"0.55rem" } },
          React.createElement(MenuIcon, { name:d.kind==="picture"?"project":d.kind==="practice"?"test":"manual", size:20, col:S.chromeText }),
          React.createElement("span", { style:{ color:S.text, fontWeight:700, fontSize:"0.95rem" } }, d.title)),
        React.createElement("div", { style:{ color:S.textMuted, fontSize:"0.74rem", margin:"0.2rem 0 0.15rem 1.8rem" } }, d.where),
        React.createElement("div", { style:{ color:S.textDim, fontSize:"0.82rem", lineHeight:1.4, marginLeft:"1.8rem" } }, helpSnippet(d.text, props.query)));
    }));
}


// Nights, finishing the next morning. `every` puts a shift on all seven days.
function HELP_NIGHTS(every){
  var on={ on:true, start:"21:00", end:"05:30" }, off={ on:false };
  return normalizeSchedule({ mon:on, tue:on, wed:on, thu:on, fri:on, sat:every?on:off, sun:every?on:off });
}
// A plain day-shift week with a lunch break and an example pay setup, for
// the Time Settings pictures. Shape comes from normalizeSchedule.
function HELP_DAYSCHED(){
  var sch=normalizeSchedule({});
  sch.unpaidBreaks=Object.assign({}, sch.unpaidBreaks, { enabled:true,
    weekly:[{ id:"hl1", name:"Lunch", start:"12:00", mins:30, note:"" }],
    custom:Object.assign({}, sch.unpaidBreaks.custom, { fri:[{ id:"hl2", name:"Safety meeting", start:"14:00", mins:15, note:"" }] }) });
  sch.payroll=Object.assign({}, sch.payroll, { otDays:["sat","sun"],
    pay:Object.assign({}, sch.payroll.pay, { basis:"hourly", rate:30 }),
    cycle:{ period:"biweekly", start:isoDate(new Date()) } });
  return sch;
}
function helpSeedProject(id){ return TEST_PROJECTS.filter(function(p){ return p.id===id; })[0]||null; }
// The element a stage draws. Pure apart from React.createElement, so the boot
// harness can render every stage statically and look for its anchors.
// `on` lets a LIVE practice copy (the outline Try it) hear its own Save and
// Cancel; a staged picture passes nothing and everything is wired to nop.
// The context a module's stage is drawn with. Its storage is MEMORY, seeded by
// the module from sample data: a picture can show a module's screen without a
// byte reaching localStorage, so staging writes nothing, as for the core.
function helpStageCtx(moduleId){
  var nop=function(){};
  return { moduleId:moduleId, storage:ttMemoryStorage(), api:TT, projects:TEST_PROJECTS, logs:[],
           laneMeta:TEST_META, laneOrder:TEST_ORDER, testMode:true, schedule:null,
           activeId:null, activeName:"", onClose:nop };
}
function helpStageEl(stage, on){
  // A module's own stage: its renderer draws it from its own sample data.
  if(stage.module){
    var owner=ttModule(stage.module);
    return owner && owner.help && owner.help.stage ? owner.help.stage(stage, helpStageCtx(owner.id)) : null;
  }
  var P=TEST_PROJECTS, nop=function(){}; on=on||{};
  // The outline, on the practice board's lanes and records, optionally with a
  // row already picked so the arrow pad shows.
  if(stage.kind==="outline")
    return React.createElement(OutlineModal, { laneOrder:TEST_ORDER, laneMeta:TEST_META, projects:P, msProjects:P,
      offDays:[], initialSel:stage.sel||null, onOpen:on.open||nop, onSave:on.save||nop, onClose:on.close||nop });
  if(stage.kind==="msedit")
    return React.createElement(MilestoneEditModal, { project:helpSeedProject(103), projects:P, offDays:[], onSave:nop, onClose:nop });
  // A step sheet: a new step, or one of the workbench's own.
  if(stage.kind==="msstep"){
    var host=helpSeedProject(103), beneath=[];
    (function walk(pid){ P.filter(function(c){ return c.parentId===pid; }).forEach(function(c){ beneath.push(c); walk(c.id); }); })(host.id);
    var step=stage.step ? (host.milestones||[]).filter(function(m){ return m.id===stage.step; })[0] : {};
    return React.createElement(MilestoneStepModal, { step:step||{}, records:beneath, onSave:nop, onDelete:nop, onCancel:nop });
  }
  // Settings sheets on default settings, not the viewer's: the picture is of
  // the sheet, and it must read the same for everyone.
  if(stage.kind==="themes" || stage.kind==="layout")
    return React.createElement(stage.kind==="themes" ? ThemesModal : LayoutModal, { onChange:nop, onClose:nop,
      settings:{ layout:"comfortable", tracking:"timer", colorScheme:"bright-pastels", theme:"neon-dream", schemes:{}, fonts:{}, mode:"dark", handedness:"right", headerPos:"top" } });
  // Yesterday on the practice board: the fullest day it has.
  if(stage.kind==="summary"){
    var yday=recordDay(TEST_BREAKS[0]);
    return React.createElement(DaySummary, { dayKey:yday, testMode:true, onClose:nop, projects:TEST_PROJECTS,
      logs:TEST_LOGS.filter(function(l){ return recordDay(l)===yday; }),
      disruptions:TEST_DIST.filter(function(d){ return recordDay(d)===yday; }),
      breaks:TEST_BREAKS.filter(function(b){ return recordDay(b)===yday; }) });
  }
  if(stage.kind==="tracking")
    return React.createElement(TrackingModal, { onChange:nop, onClose:nop,
      settings:{ layout:"comfortable", tracking:"timer", colorScheme:"bright-pastels", theme:"neon-dream", schemes:{}, fonts:{}, mode:"dark", handedness:"right", headerPos:"top" } });
  if(stage.kind==="breaks")
    return React.createElement(BreakModal, { onStart:nop, onCancel:nop });
  // The ticker alone, on a break.
  if(stage.kind==="ticker")
    return React.createElement(HeaderTicker, { interrupting:false, activeProj:null, intElapsed:0, wsActive:null, elapsed:0,
      onBreak:true, breakLabel:PRESET_BREAKS[1], breakElapsed:12*60000, clocked:true, atWorkElapsed:3*3600000, nowTick:Date.now(), bottom:false });
  if(stage.kind==="archive")
    return React.createElement(ArchiveModal, { projects:P, logs:TEST_LOGS, laneMeta:TEST_META, onReopen:nop, onClose:nop });
  // The real module registry; a staged sheet only reads it.
  if(stage.kind==="extensions")
    return React.createElement(ExtensionsModal, { onClose:nop, onChange:nop });
  if(stage.kind==="reports")
    return React.createElement(ReportsModal, { logs:TEST_LOGS, projects:P, disruptions:TEST_DIST, breaks:TEST_BREAKS,
      laneMeta:TEST_META, laneOrder:TEST_ORDER, schedule:null, testMode:true, liveLogs:[], initialKind:"week", onClose:nop });
  // The header's two buttons, side by side as the header lays them out.
  if(stage.kind==="header")
    return React.createElement("div", { style:{display:"flex",gap:"0.5rem",padding:"0.5rem 0.75rem",background:S.bg1,borderRadius:S.radius2} },
      React.createElement("div", { style:{position:"relative",flex:1} },
        React.createElement(DisruptButton, { mode:stage.dmode||"idle", onClick:nop,
          sub:stage.dmode==="active" ? fmtDur(4*60000,true) : "log one" })),
      React.createElement(ClockButton, { clocked:!!stage.clocked, onClick:nop,
        sub:stage.clocked ? fmtDur(3*3600000+20*60000,true) : "start day" }));
  if(stage.kind==="presets")
    return React.createElement(DisruptPresetList, { presets:DEFAULT_DIST_PRESETS, onPick:nop, onCustom:nop, onEdit:nop });
  // The whole header as a right-handed user sees it at the top: the ticker,
  // then Menu | Clock | Disruption painted in reverse, mid-shift with a job running.
  if(stage.kind==="headerfull"){
    var job=helpSeedProject(101);
    return React.createElement("div", { style:{ background:S.bg1 } },
      React.createElement(HeaderTicker, { interrupting:false, activeProj:job, intElapsed:0,
        wsActive:getMeta(TEST_META, job.lane), elapsed:25*60000, onBreak:false, breakLabel:"", breakElapsed:0,
        clocked:true, atWorkElapsed:3*3600000+20*60000, nowTick:Date.now(), bottom:false }),
      React.createElement("div", { style:{display:"flex",flexDirection:"row-reverse",alignItems:"stretch",background:S.bg1,borderBottom:"2px solid "+S.border,padding:"0.5rem 0.75rem",gap:"0.5rem"} },
        React.createElement("div", { style:{position:"relative",flex:"0 0 64px"} }, React.createElement(HeaderMenuButton, { open:false, onClick:nop })),
        React.createElement(ClockButton, { clocked:true, onClick:nop, sub:fmtDur(3*3600000+20*60000,true) }),
        React.createElement("div", { style:{position:"relative",flex:1} }, React.createElement(DisruptButton, { mode:"idle", onClick:nop, sub:"log one" }))));
  }
  // A night roster, Monday to Friday, as the Work Schedule sheet shows it.
  if(stage.kind==="schedule")
    return React.createElement(WorkScheduleModal, { schedule:stage.day ? HELP_DAYSCHED() : HELP_NIGHTS(), onSave:nop, onClose:nop });
  if(stage.kind==="paywork")
    return React.createElement(PayWorkWeekModal, { value:HELP_DAYSCHED().payroll, onDone:nop, onClose:nop });
  if(stage.kind==="unpaid"){
    var dsch=HELP_DAYSCHED();
    return React.createElement(UnpaidBreaksModal, { value:dsch.unpaidBreaks, schedule:dsch, onDone:nop, onClose:nop, initialOpenDay:"fri" });
  }
  // The question a clock-in outside the shift asks: an early-morning tap on a
  // roster of nights every day (so it reads the same on any weekday), or the
  // pay question a day off adds.
  if(stage.kind==="shiftask"){
    if(stage.ot)
      return React.createElement(ClockDayModal, { stage:"ot", title:"Regular or Overtime?", choices:OT_CHOICES, onPick:nop, onCancel:nop });
    var t=new Date(); t.setHours(6, 30, 0, 0);
    var ctx=shiftContext(HELP_NIGHTS(true), t.getTime(), 0);
    return React.createElement(ClockDayModal, { when:t.getTime(), position:ctx.position, choices:shiftChoices(ctx), onPick:nop, onCancel:nop });
  }
  if(stage.kind==="backup")
    return React.createElement(BackupModal, { onClose:nop, only:stage.only||null,
      preview:stage.preview ? { exportedAt:new Date().toISOString(), projects:TEST_PROJECTS.length, logs:TEST_LOGS.length } : null });
  // A project's milestone line, as its card carries it: the practice
  // workbench, whose steps are in every state at once.
  if(stage.kind==="msline")
    return React.createElement("div", { style:{ padding:"0 0.3rem" } },
      React.createElement(MilestoneStrip, { kind:"project", points:subtreePoints(P, 103, Date.now()), width:300, offDays:[], tight:true, onOpen:nop }));
  var proj=helpSeedProject(stage.id);
  if(!proj) return null;
  if(stage.kind==="close")
    return React.createElement(CloseProjectModal, { proj:proj, blockers:closeBlockers(P, proj), onClose:nop, onConfirm:nop });
  var ids=[proj.id].concat(getDescendantIds(P, proj.id));
  // Today through the one work-day function, like every other surface.
  var today=todayStr();
  var todayLogs=TEST_LOGS.filter(function(l){ return recordDay(l)===today; });
  var todayDist=TEST_DIST.filter(function(d){ return recordDay(d)===today; });
  var mine=function(r){ return ids.indexOf(r.projectId)>=0; };
  var live=stage.state==="running"||stage.state==="disrupted";
  return React.createElement(ProjectCard, { proj:proj, still:true, stillCollapsed:!!stage.collapsed,
    subTasks:P.filter(function(p){ return p.parentId===proj.id; }),
    isActive:live, interrupting:stage.state==="disrupted", elapsed:live?25*60000:0,
    todayMs:todayLogs.filter(mine).reduce(function(a,l){ return a+l.duration; },0),
    distToday:distStats(todayDist, ids), distTotal:distStats(TEST_DIST, ids),
    projDisruptions:TEST_DIST.filter(mine),
    onCloseOut:nop, onToggle:nop, onEdit:nop, onStages:nop, onStageToggle:nop, onAddSub:nop,
    onReopen:nop, msProjects:P, offDays:[], schedule:null, activeId:live?proj.id:null,
    todayLogs:todayLogs, todayDist:todayDist, allDist:TEST_DIST, allProjects:P,
    editMode:false, laneMeta:TEST_META, dragHandleProps:{} });
}

// One staged picture. `marks` are the numbered parts (picture pages) or the
// single ringed control (steps); each is { anchor, n, side, on }. Positions are
// MEASURED from the live render, never typed in, so a layout change moves the
// marks with it. A mark whose anchor is missing draws nothing.
var HELP_CARD_W = 366, HELP_SHEET_W = 390, HELP_MARK = 22;
var HELP_STAGE_FULL = { full:true };
var HELP_STAGE_W = { paywork:400, unpaid:400, card:366, close:390, header:366, presets:300, headerfull:390, msline:366,
                     schedule:470, shiftask:390, backup:390, outline:390, msedit:400, msstep:390, reports:400,
                     themes:400, layout:400, summary:400, archive:390, extensions:390, tracking:400, breaks:390, ticker:390 };
// Kinds that stage a whole sheet: measured off the staged panel, not the content.
var HELP_SHEETS = { paywork:true, unpaid:true, close:true, schedule:true, shiftask:true, backup:true, outline:true, msedit:true, msstep:true, reports:true,
                    themes:true, layout:true, summary:true, archive:true, extensions:true, tracking:true, breaks:true };
function HelpStage(props){
  // A module's stage never reads the core's tables - its kinds are its own and
  // could share a name with a core kind. Every module screen is a sheet
  // (ui.Modal), so it stages as one at phone width unless it says otherwise.
  // Treated as a card, its fixed-position sheet measured zero tall and the
  // visible-area cut removed every mark.
  var stage=props.stage, mod=!!stage.module;
  var sheet=mod ? stage.sheet!==false : !!HELP_SHEETS[stage.kind];
  var natW=mod ? (stage.width||HELP_SHEET_W) : (HELP_STAGE_W[stage.kind]||HELP_CARD_W), dispW=props.width||300, k=dispW/natW;
  var boxRef=useRef(null), innerRef=useRef(null);
  var measS=useState({ h:sheet?640:0, rects:[] }); var setMeas=measS[1]; var meas=measS[0];
  var padTop=props.padTop||0;
  var marks=props.marks||[];
  var key=JSON.stringify(stage)+"|"+marks.map(function(m){ return m.anchor; }).join(",");
  useEffect(function(){
    function measure(){
      var box=boxRef.current, inner=innerRef.current; if(!box||!inner) return;
      var B=box.getBoundingClientRect(), h;
      // The staged panel caps itself at 85vh and scrolls inside; its own
      // height (not its scroll height) is what shows.
      if(sheet){ var pan=inner.querySelector("[data-staged]"); h=pan ? Math.ceil(pan.offsetHeight)+34 : 640; }
      else h=Math.ceil(inner.scrollHeight);
      // What is actually visible: a staged sheet scrolls inside its own
      // panel, so a part can run on below what shows. A ring drawn to the
      // part's full height ran down into the legend (the Reports milestones
      // section did), so every box is cut to what can be seen.
      var vis=(sheet && inner.querySelector("[data-staged]") ? inner.querySelector("[data-staged]") : inner).getBoundingClientRect();
      var rects=marks.map(function(m){
        var els=inner.querySelectorAll(m.anchor); if(!els.length) return null;
        if(m.first) els=[els[0]];
        var x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
        Array.prototype.forEach.call(els, function(el){ var r=el.getBoundingClientRect();
          x0=Math.min(x0,r.left); y0=Math.min(y0,r.top); x1=Math.max(x1,r.right); y1=Math.max(y1,r.bottom); });
        x0=Math.max(x0,vis.left); y0=Math.max(y0,vis.top); x1=Math.min(x1,vis.right); y1=Math.min(y1,vis.bottom);
        if(x1<=x0 || y1<=y0) return null;   // nothing of it shows: no mark, no ring
        return { x:x0-B.left, y:y0-B.top, w:x1-x0, h:y1-y0 };
      });
      setMeas({ h:h, rects:rects });
    }
    measure();
    var a=setTimeout(measure, 60), b=setTimeout(measure, 380);
    return function(){ clearTimeout(a); clearTimeout(b); };
  },[key]);
  var M=HELP_MARK;
  function at(r, side){
    // Above a wide target the mark sits toward its start; above a narrow one
    // (a sign on a line) it is centred, or it lands on the neighbour.
    if(side==="above") return [r.w<40 ? r.x+r.w/2-M/2 : r.x+r.w*0.35, r.y-M-3];
    // On the top edge at the far end: for a full-width block with no room beside it.
    if(side==="corner") return [r.x+r.w-M-6, r.y-M/2];
    // A second row up, for parts that sit too close together to share one.
    if(side==="above2") return [r.x+r.w/2-M/2, r.y-2*M-8];
    if(side==="left")  return [r.x-M-4, r.y+r.h/2-M/2];
    if(side==="right") return [r.x+r.w+4, r.y+r.h/2-M/2];
    return [r.x+r.w/2-M/2, r.y+r.h+3];
  }
  // Where each numbered mark lands, then nudged apart. The practice board is
  // dated relative to today, so on a milestone line the signs - and "now" -
  // sit in different places at different hours; no fixed layout stays clear.
  // Each mark that would overlap one already placed slides sideways (right
  // first, then left) until it is clear.
  var spots=marks.map(function(m, i){ var r=meas.rects[i]; return r ? at(r, m.side||"below") : null; });
  spots.forEach(function(p, i){
    if(!p) return;
    var clash=function(x){ return spots.slice(0, i).some(function(q){ return q && Math.abs(q[1]-p[1])<M && Math.abs(q[0]-x)<M+2; }); };
    for(var d=0; d<=6*M && clash(p[0]); d+=4){
      if(!clash(p[0]+d) && p[0]+d+M<=dispW+M){ p[0]+=d; break; }
      if(!clash(p[0]-d) && p[0]-d>=-M){ p[0]-=d; break; }
    }
  });
  return React.createElement("div", { ref:boxRef, "data-helpstage":stage.kind+":"+(stage.id||stage.dmode||""),
      // flexShrink:0 - the sheet is a flex column and everything in a stage is
      // absolutely placed, so without it the box collapsed to a sliver and the
      // legend slid up under the picture.
      style:{ position:"relative", flexShrink:0, boxSizing:"content-box", width:dispW+"px", height:(Math.ceil(meas.h*k)+padTop)+"px", margin:"0 auto",
              paddingBottom:props.pad||0 } },
    React.createElement("div", { ref:innerRef, inert:!props.live, "aria-hidden":!props.live,
      style:{ position:"absolute", left:0, top:padTop+"px", width:natW+"px", height:sheet?meas.h+"px":undefined,
              transform:"scale("+k+")", transformOrigin:"0 0", pointerEvents:props.live?"auto":"none",
              overflow:"hidden", background:sheet?S.bg0:"transparent", borderRadius:S.radius3 } },
      StageCtx ? React.createElement(StageCtx.Provider, { value:stage.full ? HELP_STAGE_FULL : true }, helpStageEl(stage, props.on)) : helpStageEl(stage, props.on)),
    marks.map(function(m, i){
      var r=meas.rects[i]; if(!r) return null;
      var p=spots[i];
      return React.createElement(React.Fragment, { key:i },
        m.on && React.createElement("div", { "data-helpring":true, style:{ position:"absolute",
          left:(r.x-4)+"px", top:(r.y-4)+"px", width:(r.w+8)+"px", height:(r.h+8)+"px",
          border:"2.5px solid "+S.infoText, borderRadius:"10px", pointerEvents:"none",
          boxShadow:"0 0 0 4px rgba(0,0,0,0.4), 0 0 14px "+S.infoText } }),
        m.n!=null && React.createElement("button", { "data-helpmark":m.n,
          onClick:m.onPick||undefined, "aria-label":"Part "+m.n,
          style:{ position:"absolute", left:p[0]+"px", top:p[1]+"px", width:M+"px", height:M+"px",
            padding:0, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center",
            border:"2px solid "+S.infoText, background:m.on?S.infoText:S.bg0, color:m.on?S.bg0:S.infoText,
            fontWeight:800, fontSize:"0.72rem", fontFamily:S.fontBody, cursor:m.onPick?"pointer":"default",
            boxSizing:"border-box", WebkitTapHighlightColor:"transparent" } }, m.n));
    }));
}

// THE STEADY-BOX RULE (Brent, 10-09): an inline box whose words change, with
// anything below it, is always as tall as its LONGEST content - so nothing
// under it jumps as the words change. Every variant is laid in the same grid
// cell; only the shown one is visible, the rest hold the height. The ghosts
// are aria-hidden and drawn with ghost=true, so they carry no data- hooks and
// no live buttons. No measuring, so it holds at any width or text size.
function SteadyBox(props){
  var at=props.at;
  return React.createElement("div", Object.assign({ style:Object.assign({ display:"grid" }, props.style) }, props.attrs||{}),
    Array.from({ length:props.count }, function(_, i){
      var ghost=i!==at;
      return React.createElement("div", { key:i, "data-steadyghost":ghost?true:undefined, "aria-hidden":ghost?true:undefined,
          style:{ gridArea:"1 / 1", minWidth:0, visibility:ghost?"hidden":"visible", pointerEvents:ghost?"none":undefined } },
        props.render(i, ghost));
    }));
}
function HelpNum(props){
  // done: a step already passed in a guide - filled softly, so progress shows.
  return React.createElement("span", { style:{ flex:"0 0 auto", width:"26px", height:"26px", borderRadius:"50%",
    display:"inline-flex", alignItems:"center", justifyContent:"center", border:"2px solid "+S.infoText,
    background:props.on?S.infoText:props.done?rgba(S.infoText,0.35):S.infoBg, color:props.on?S.bg0:S.infoText, fontWeight:800,
    fontSize:"0.82rem", fontFamily:S.fontBody } }, props.n);
}
function HelpCrumb(props){
  return React.createElement("div", { "data-helpcrumb":true,
    style:{ color:S.textMuted, fontSize:"0.8rem", margin:"-0.6rem 0 0.8rem" } }, props.parts.join(" › "));
}

// TRY IT HERE: the real HoldButton, wired to nothing. It answers back and it
// writes nothing - no storage, no record - which e2e checks byte for byte.
// The frame every practice panel sits in, so they read as one family.
function HelpTryBox(props){
  var keys=Object.keys(props.msgs);
  return React.createElement("div", { "data-tryit":props.kind,
      style:{ background:S.bg1, border:"1px dashed "+S.borderBright, borderRadius:S.radius,
              padding:"0.75rem 0.8rem", marginTop:"0.9rem" } },
    React.createElement("div", { style:Object.assign({}, LABEL_STYLE, { marginBottom:"0.55rem" }) }, props.label||"Try it here"),
    props.children,
    // Every message the panel can say is held in one SteadyBox, so the
    // panels under it never move as the reply changes.
    React.createElement(SteadyBox, { count:keys.length, at:keys.indexOf(props.res||"none"),
      attrs:{ "data-tryresult":props.res||"none", "aria-live":"polite" },
      style:{ marginTop:"0.55rem", fontSize:"0.88rem", lineHeight:1.4,
              color:props.good?S.successText:props.warn?S.warnText:S.textDim },
      render:function(i){ return props.msgs[keys[i]]; } }));
}
function HelpTryHold(props){
  var resS=useState(null); var setRes=resS[1]; var res=resS[0];
  var msgs={ none:"Hold it until the bar fills.",
              held:"That’s it. On a real job, that opens the sheet in the next step.",
              early:"Let go too soon. Nothing happened — that’s the safety catch." };
  return React.createElement(HelpTryBox, { kind:"hold", label:(props&&props.label)||"Try it here", res:res, msgs:msgs,
      good:res==="held", warn:res==="early" },
    React.createElement(HoldButton, { onTap:function(){ setRes("early"); }, onHold:function(){ setRes("held"); },
      holdMs:HOLD_DELETE_MS, fill:rgba(S.successText,0.35), attrs:{ "data-tryhold":true, "aria-label":"Practice hold" },
      style:{ width:"100%", display:"flex", alignItems:"center", justifyContent:"center",
              background:S.bg0, border:"2px solid "+S.chromeBdr, borderRadius:S.radius3, padding:"0.7rem 0.6rem",
              color:S.chromeText, fontFamily:S.fontBody, fontWeight:700, fontSize:"0.95rem" } },
      React.createElement("span", { style:{ display:"flex", alignItems:"center", gap:"0.45rem" } },
        React.createElement(MenuIcon, { name:"task", size:18, col:S.chromeText }), "Complete",
        React.createElement("span", { style:{ fontSize:"0.72rem", fontWeight:600, opacity:0.7 } }, "hold"))));
}
// One tap or two: the real useTaps, so the timing is the board's own.
function HelpTryTaps(props){
  var resS=useState(null); var setRes=resS[1]; var res=resS[0];
  var taps=useTaps(function(){ setRes("one"); }, function(){ setRes("two"); });
  var msgs={ none:"Tap the name once, then try two quick taps.",
              one:"One tap. On the board, that opens its menu.",
              two:"Two taps. On the board, that opens its editor." };
  return React.createElement(HelpTryBox, { kind:"taps", label:(props&&props.label)||"Try it here", res:res, msgs:msgs, good:!!res },
    React.createElement("button", { "data-trytaps":true, onClick:function(){ taps(); },
        style:{ width:"100%", display:"flex", alignItems:"center", gap:"0.45rem", background:S.bg0,
                border:"2px solid "+S.chromeBdr, borderRadius:S.radius3, padding:"0.7rem 0.8rem", cursor:"pointer",
                color:S.text, fontFamily:S.fontBody, fontWeight:700, fontSize:"1rem", userSelect:"none",
                WebkitUserSelect:"none", touchAction:"manipulation", WebkitTapHighlightColor:"transparent" } },
      React.createElement(MenuIcon, { name:"project", size:18, col:S.chromeText }), "Practice job"));
}
// Swipe to tuck away and bring back: the real useSwipe, the same threshold,
// the same rule that a pill only opens to the right.
function HelpTrySwipe(props){
  var shutS=useState(false); var setShut=shutS[1]; var shut=shutS[0];
  var resS=useState(null); var setRes=resS[1]; var res=resS[0];
  var sw=useSwipe(function(dir){ var s2=dir==="left"; setShut(s2); setRes(s2?"shut":"open"); });
  var msgs={ none:"Swipe left across the name.",
              shut:"Tucked away. Now swipe right on the pill to open it.",
              open:"Open again. A left swipe on a pill does nothing \u2014 try it." };
  var base={ width:"100%", boxSizing:"border-box", display:"flex", alignItems:"center", gap:"0.45rem",
             cursor:"grab", userSelect:"none", WebkitUserSelect:"none", touchAction:"pan-y", fontFamily:S.fontBody };
  return React.createElement(HelpTryBox, { kind:"swipe", label:(props&&props.label)||"Try it here", res:res, msgs:msgs, good:!!res },
    shut
      ? React.createElement("div", Object.assign({ "data-tryswipe":"pill",
          style:Object.assign({}, base, { height:"22px", justifyContent:"center", border:"2.5px solid "+S.chromeBdr,
            borderRadius:"999px", background:S.bg0, color:S.chromeText, fontSize:"0.72rem", fontWeight:700 }) }, sw.pill),
          "Practice job")
      : React.createElement("div", Object.assign({ "data-tryswipe":"open", onClick:sw.guard(function(){}),
          style:Object.assign({}, base, { background:S.bg0, border:"2px solid "+S.chromeBdr, borderRadius:S.radius3,
            padding:"0.8rem", color:S.text, fontWeight:700, fontSize:"1rem" }) }, sw.open),
          React.createElement(MenuIcon, { name:"project", size:18, col:S.chromeText }), "Practice job"));
}

function HelpIndexRow(props){
  return React.createElement("button", { "data-helprow":props.kind+":"+props.id, onClick:props.onOpen,
      style:{ display:"flex", alignItems:"center", gap:"0.65rem", width:"100%", textAlign:"left",
              background:S.bg1, border:"2px solid "+S.border, borderRadius:S.radius, padding:"0.75rem 0.9rem",
              marginBottom:"0.45rem", cursor:"pointer", fontFamily:S.fontBody } },
    React.createElement(MenuIcon, { name:props.kind==="picture"?"project":props.kind==="practice"?"test":"manual", size:24, col:S.chromeText }),
    React.createElement("span", { style:{ flex:1, color:S.text, fontWeight:700, fontSize:MENU_FONT } }, props.title),
    React.createElement("span", { style:{ color:S.textMuted, fontSize:"0.8rem", whiteSpace:"nowrap" } }, props.count),
    React.createElement("span", { style:{ color:S.textDim } }, "›"));
}

// Scroll the sheet so part i's ring and number sit in the middle of the
// clear band between the sticky action bar and the sticky instruction box.
// A part taller than the band is shown from its top. Smooth unless the
// device asks for reduced motion.
var HELP_BAR_OVERHANG=20;   // ModalActions sticks at -1.25rem
function helpCentrePart(box, i, onlyIfHidden){
  var panel=box && box.closest("[data-modal-panel]"); if(!panel) return;
  var stage=panel.querySelector("[data-helpstage]"); if(!stage) return;
  var els=[stage.querySelector("[data-helpring]"), stage.querySelector("[data-helpmark=\""+(i+1)+"\"]")].filter(Boolean);
  if(!els.length) return;
  var top=Infinity, bot=-Infinity;
  els.forEach(function(e){ var r=e.getBoundingClientRect(); top=Math.min(top,r.top); bot=Math.max(bot,r.bottom); });
  var P=panel.getBoundingClientRect();
  var bar=panel.querySelector(":scope > [data-surface=\"menu\"]");
  var barSpan=bar ? Math.max(0, bar.offsetHeight-HELP_BAR_OVERHANG) : 0;
  var sticky=parseFloat(box.style.bottom)||0;
  var srch=panel.querySelector("[data-helpsearch]");
  var srchBot=srch ? (parseFloat(srch.getAttribute("data-stucktop"))||0)+srch.offsetHeight : 0;
  var bandTop=P.top+panel.clientTop+Math.max(UI.bottom?0:barSpan, srchBot);
  var bandBot=P.top+panel.clientTop+panel.clientHeight-sticky-box.offsetHeight;
  var room=bandBot-bandTop, h=bot-top;
  // On opening a picture, leave it alone if part one already shows.
  if(onlyIfHidden && top>=bandTop && bot<=bandBot) return;
  var want = h<=room-16 ? bandTop+(room-h)/2 : bandTop+8;
  var reduce=window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  panel.scrollTo({ top:panel.scrollTop+(top-want), behavior:reduce?"auto":"smooth" });
}
// ---- THE WALK ---------------------------------------------------------------
// One page for both kinds of help (Brent, 10-10): the whole screen staged and
// scrollable, the item being explained ringed and brought to the middle, and
// a floating box at the foot with the words and a numbered chip per item.
// A picture is items on ONE stage, all numbered at once. A guide is items
// (steps) that may each have their own stage; the steps sharing the stage on
// show are numbered on it together, so a guide reads like a picture that
// moves on. Every hook below is shared, so the two cannot drift apart.
function helpStageKey(st){ return st ? JSON.stringify(st) : ""; }
function helpStageWidth(st){ return !st ? 300 : st.kind==="close" ? 250 : st.kind==="presets" ? 220 : 300; }
function HelpWalk(props){
  var items=props.items, n=items.length, guide=props.kind==="guide";
  var onS=useState(Math.min(props.start||0, n-1)); var setOn=onS[1]; var on=onS[0];
  var barS=useState(0); var setBarH=barS[1]; var barH=barS[0];
  var boxRef=useRef(null), wantScroll=useRef(props.start ? "open" : "ifHidden"), lastStage=useRef(null);
  var cur=items[on], curKey=helpStageKey(cur.stage);
  // Picked from the box (chips, arrows): bring that item to the middle of
  // what shows between the bars and the box. A tapped number is already on
  // screen, so a mark tap never scrolls - unless it moves to a new stage.
  var pick=function(i){ wantScroll.current=true; setOn(i); };
  // With the header at the bottom the action bar sticks to the sheet's foot
  // too; the box sits just above it rather than under it.
  useEffect(function(){
    var b=boxRef.current, panel=b&&b.closest("[data-modal-panel]");
    var bar=panel&&panel.querySelector(":scope > [data-surface=\"menu\"]");
    setBarH(UI.bottom&&bar ? bar.offsetHeight : 0);
  }, []);
  useEffect(function(){
    var moved=lastStage.current!==null && lastStage.current!==curKey;
    lastStage.current=curKey;
    if(moved && !wantScroll.current) wantScroll.current="open";
    if(!wantScroll.current) return;
    var how=wantScroll.current; wantScroll.current=false;
    // A stage that has just mounted is still measuring: give it a moment.
    var wait=(how==="open" || how==="ifHidden" || moved) ? 350 : 0;
    var raf=0, t=setTimeout(function(){
      // Two frames: the stage draws the new ring after it measures.
      raf=requestAnimationFrame(function(){ raf=requestAnimationFrame(function(){ helpCentrePart(boxRef.current, on, how==="ifHidden"); }); });
    }, wait);
    return function(){ clearTimeout(t); cancelAnimationFrame(raf); };
  }, [on]);
  var marks=[];
  items.forEach(function(it, i){
    if(cur.stage && helpStageKey(it.stage)===curKey && it.anchor)
      marks.push({ anchor:it.anchor, side:it.side||"below", first:!!it.first, n:i+1, on:on===i, onPick:function(){ setOn(i); } });
  });
  var last=on===n-1;
  var arrow=function(dir, label){
    var to=on+dir, done=guide && dir>0 && last, off=!done && (to<0||to>=n);
    return React.createElement("button", Object.assign({ "data-helpdetailnav":dir>0?"next":"prev", "aria-label":done?"Done":label, disabled:off,
        onClick:function(){ if(done) props.onBack(); else if(!off) pick(to); },
        style:{ flex:"none", width:"32px", height:"36px", borderRadius:S.radius3,
                border:done?"2px solid "+S.actionBdr:"1px solid "+S.borderBright, background:done?S.infoBg:S.bg2,
                color:off?S.textMuted:done?S.infoText:S.text, opacity:off?0.4:1, fontSize:"1.2rem", fontWeight:700,
                fontFamily:S.fontBody, cursor:off?"default":"pointer", display:"inline-flex", alignItems:"center", justifyContent:"center" } },
        guide && dir>0 ? { "data-helpnext":done?"done":"next" } : {}),
      done ? "✓" : dir>0 ? "›" : "‹");
  };
  var Try=cur.tryit && HELP_PANELS[cur.tryit];
  return React.createElement(Modal, { title:props.title, onClose:props.onClose, ownActions:true, fill:true,
      actions:[React.createElement("button", { key:"b", "data-helpback":true, onClick:props.onBack, style:MODAL_CANCEL() }, props.backLabel||"Back")] },
    props.setQuery ? React.createElement(HelpSearchBar, props) : null,
    props.query ? React.createElement(HelpSearchResults, props) : React.createElement(React.Fragment, null,
    React.createElement(HelpCrumb, { parts:props.crumb }),
    props.blurb ? React.createElement("p", { style:{ color:S.textDim, fontSize:"0.95rem", lineHeight:1.5, margin:"0 0 1rem" } }, props.blurb) : null,
    cur.stage ? React.createElement(HelpStage, { key:curKey, stage:cur.stage, marks:marks, width:helpStageWidth(cur.stage), pad:"30px", padTop:props.padTop||0 }) : null,
    Try ? React.createElement(Try, { key:"try"+on }) : null,
    React.createElement("div", { style:{ height:"0.6rem", flexShrink:0 } }),
    React.createElement("div", { "data-helpdetail":on+1, "data-helpstep":guide?on+1:undefined, ref:boxRef,
        // Sticky to the foot of the sheet, and pushed to the foot when the
        // page is short (the sheet is full height): the box never moves.
        style:{ position:"sticky", bottom:barH?(barH-20+8)+"px":0, zIndex:4, marginTop:"auto", background:S.bg3,
                border:"1px solid "+S.borderBright, borderRadius:S.radius, boxShadow:"0 -6px 18px rgba(0,0,0,0.35)",
                padding:"0.7rem 0.75rem 0.8rem", boxSizing:"border-box", flexShrink:0 } },
      // Fixed controls on top so they never move under a thumb as the text below changes length.
      React.createElement("div", { style:{ display:"flex", alignItems:"center", gap:"0.5rem", marginBottom:"0.6rem" } },
        arrow(-1, guide?"Previous step":"Previous part"),
        React.createElement("div", { style:{ flex:1, display:"flex", justifyContent:"center", flexWrap:"wrap", gap:"4px" } },
          items.map(function(_, i){
            return React.createElement("button", { key:i, "data-helppart":i+1, "aria-label":(guide?"Step ":"Part ")+(i+1),
                onClick:function(){ pick(i); },
                style:{ border:"none", background:"transparent", padding:0, cursor:"pointer", display:"inline-flex" } },
              React.createElement(HelpNum, { n:i+1, on:on===i, done:guide && i<on }));
          })),
        arrow(1, guide?"Next step":"Next part")),
      // Steady-box rule: as tall as the longest item, so nothing moves as you step through.
      React.createElement(SteadyBox, { count:n, at:on, render:function(i, ghost){
        var p=items[i], how=p.guide && helpAll().guides[p.guide];
        return React.createElement("div", { style:{ display:"flex", gap:"0.7rem", alignItems:"flex-start" } },
          React.createElement("div", { style:{ flex:1 } },
            React.createElement("div", { "data-helpdetaillabel":ghost?undefined:true, style:{ color:S.text, fontWeight:700, fontSize:"1.02rem", marginBottom:"0.2rem" } }, p.label),
            React.createElement("div", { style:{ color:S.textDim, fontSize:"0.92rem", lineHeight:1.45 } }, p.text)),
          how && props.onHow && React.createElement("button", { "data-helphow":ghost?undefined:p.guide, tabIndex:ghost?-1:undefined,
              onClick:function(){ props.onHow(p.guide, p.label); },
              style:{ flex:"none", border:"2px solid "+S.actionBdr, background:S.infoBg, color:S.infoText,
                      borderRadius:S.radius3, padding:"0.4rem 0.65rem", fontWeight:700, fontSize:"0.88rem",
                      fontFamily:S.fontBody, cursor:"pointer" } }, "How ›"));
      } })),
    props.pageTry ? React.createElement(props.pageTry) : null));
}
function HelpPicture(props){
  var pic=helpAll().pictures[props.id];
  var items=pic.parts.map(function(p){ return { stage:pic.stage, anchor:p.anchor, side:p.side, first:p.first, label:p.label, text:p.text, guide:p.guide }; });
  return React.createElement(HelpWalk, Object.assign({}, props, { kind:"picture", title:pic.title, items:items,
    crumb:["Guides", "What’s on my screen?"], blurb:pic.blurb, padTop:pic.padTop||0,
    pageTry:pic.tryit && HELP_PANELS[pic.tryit] ? HELP_PANELS[pic.tryit] : null }));
}
function HelpSteps(props){
  var A=helpAll();
  var g=A.guides[props.id];
  var from=props.from;   // { picture, part } when reached through How >, else null
  var items=g.steps.map(function(st){ return { stage:st.stage||null, anchor:st.ring, side:st.side||"below", label:st.title, text:st.text, tryit:st.tryit||null }; });
  return React.createElement(HelpWalk, Object.assign({}, props, { kind:"guide", title:g.title, items:items, onHow:null,
    crumb: from ? ["Guides", A.pictures[from.picture].title, from.part] : ["Guides", "How do I…?"],
    backLabel: from ? (A.pictures[from.picture].back||"Back") : "Back" }));
}

// The real MilestoneStrip on the practice workbench's steps. Its zoom and pan
// are its own state, so nothing here can reach a record; a tap that does not
// move would open the milestones sheet, and here it only says so.
function HelpTryLine(props){
  var resS=useState(null); var setRes=resS[1]; var res=resS[0];
  var msgs={ none:"Tap the zoom button to step closer, hold it to see everything, and drag the line once you are zoomed in.",
              open:"A tap that does not move opens that project\u2019s milestones." };
  return React.createElement(HelpTryBox, { kind:"msline", label:(props&&props.label)||"Try it here", res:res, msgs:msgs, good:!!res },
    React.createElement(MilestoneStrip, { kind:"practice", points:subtreePoints(TEST_PROJECTS, 103, Date.now()), width:250,
      offDays:[], tight:true, onOpen:function(){ setRes("open"); } }));
}
// The outline itself, LIVE, on a copy of the practice board: pick, move, nest,
// open the controller and Save - and Save only says so. Its rows are its own
// state, so nothing reaches a record.
function HelpTryOutline(props){
  var resS=useState(null); var setRes=resS[1]; var res=resS[0];
  var msgs={ none:"Tap a row\u2019s glyph to pick it, then move it with the arrows.",
              save:"Saved. On the real outline, your moves would land on the board now.",
              close:"Cancelled. On the real outline, every move would be thrown away.",
              open:"That would open the row\u2019s details, and keep your moves." };
  return React.createElement(HelpTryBox, { kind:"outline", label:(props&&props.label)||"Try it here", res:res, msgs:msgs, good:!!res },
    React.createElement(HelpStage, { live:true, stage:{ kind:"outline" }, width:282, marks:[],
      on:{ save:function(){ setRes("save"); }, close:function(){ setRes("close"); }, open:function(){ setRes("open"); } } }));
}
var HELP_PANELS = { taps:HelpTryTaps, hold:HelpTryHold, swipe:HelpTrySwipe, msline:HelpTryLine, outline:HelpTryOutline };
var HELP_PANEL_LABELS = { taps:"One tap, two taps", hold:"Hold", swipe:"Swipe", msline:"Zoom and pan", outline:"The arrow pad" };
function HelpPractice(props){
  var pr=HELP_PRACTICE[props.id];
  return React.createElement(Modal, { title:pr.title, onClose:props.onClose, ownActions:true,
      actions:[React.createElement("button", { key:"b", "data-helpback":true, onClick:props.onBack, style:MODAL_CANCEL() }, "Back")] },
    props.setQuery ? React.createElement(HelpSearchBar, props) : null,
    props.query ? React.createElement(HelpSearchResults, props) : React.createElement(React.Fragment, null,
    React.createElement(HelpCrumb, { parts:["Guides", "Practise the gestures"] }),
    React.createElement("p", { style:{ color:S.textDim, fontSize:"0.95rem", lineHeight:1.5, margin:"0 0 0.2rem" } }, pr.blurb),
    pr.panels.map(function(k){ return React.createElement(HELP_PANELS[k], { key:k, label:HELP_PANEL_LABELS[k] }); })));
}

// The Guides sheet. One mount, four views; each view is its own component so
// every hook sits at the top of a component, never in a loop or a branch.
function GuidesModal(props){
  var viewS=useState({ kind:"index" }); var setView=viewS[1]; var view=viewS[0];
  var openS=useState({}); var setOpenT=openS[1]; var openT=openS[0];
  var qS=useState(""); var setQuery=qS[1]; var query=qS[0];
  var home=function(){ setView({ kind:"index" }); };
  // A search hit opens its picture on that part, or its guide on that step.
  var pick=function(d){ setQuery(""); setView({ kind:d.kind, id:d.id, start:d.at, from:null, k:Date.now() }); };
  var search={ query:query, setQuery:setQuery, onPick:pick };
  if(view.kind==="picture")
    return React.createElement(HelpPicture, Object.assign({ key:"p"+view.id+(view.k||""), id:view.id, start:view.start||0, onClose:props.onClose, onBack:home,
      onHow:function(gid, part){ setView({ kind:"guide", id:gid, from:{ picture:view.id, part:part } }); } }, search));
  if(view.kind==="practice")
    return React.createElement(HelpPractice, Object.assign({ id:view.id, onClose:props.onClose, onBack:home }, search));
  if(view.kind==="guide")
    return React.createElement(HelpSteps, Object.assign({ key:"g"+view.id+(view.k||""), id:view.id, start:view.start||0, from:view.from||null, onClose:props.onClose,
      onBack:function(){ if(view.from) setView({ kind:"picture", id:view.from.picture }); else home(); } }, search));
  var row=function(it, key){
    var d=helpEntry(it[0], it[1]);
    return React.createElement(HelpIndexRow, { key:key, kind:it[0], id:it[1], title:d.title, count:helpCount(it[0], d),
      onOpen:function(){ setView({ kind:it[0], id:it[1] }); } });
  };
  return React.createElement(Modal, { title:"Guides", onClose:props.onClose, cancelLabel:"Close" },
    React.createElement(HelpSearchBar, search),
    query ? React.createElement(HelpSearchResults, search) : React.createElement("div", null,
    React.createElement("p", { style:{ color:S.textDim, fontSize:"0.95rem", lineHeight:1.5, margin:"0 0 0.6rem" } },
      "Pick a topic. Pictures show what is on screen; guides walk you through it step by step."),
    helpAll().index.map(function(t){
      if(t.flat) return React.createElement("div", { key:t.id, style:{ marginTop:"0.9rem" } }, t.items.map(function(it, i){ return row(it, t.id+i); }));
      var on=!!openT[t.id];
      var pics=t.items.filter(function(it){ return it[0]==="picture"; }), how=t.items.filter(function(it){ return it[0]!=="picture"; });
      var sub=function(label){ return React.createElement("div", { style:Object.assign({}, LABEL_STYLE, { margin:"0.55rem 0 0.35rem 0.9rem", fontSize:"0.68rem" }) }, label); };
      return React.createElement("div", { key:t.id, "data-helptopicwrap":t.id },
        React.createElement("button", { "data-helptopic":t.id, "aria-expanded":on?"true":"false",
            onClick:function(){ haptic(6); setOpenT(function(o){ var n=Object.assign({}, o); n[t.id]=!o[t.id]; return n; }); },
            style:{ display:"flex", alignItems:"center", gap:"0.55rem", width:"100%", textAlign:"left", background:"none", border:"none",
                    borderBottom:"1px solid "+S.border, padding:"0.75rem 0.2rem", cursor:"pointer", fontFamily:S.fontBody } },
          React.createElement("span", { style:{ color:S.textDim, width:"0.9rem", fontSize:"0.8rem" } }, on?"\u25BE":"\u25B8"),
          React.createElement("span", { style:{ flex:1, color:S.text, fontWeight:700, fontSize:MENU_FONT } }, t.topic),
          React.createElement("span", { style:{ color:S.textMuted, fontSize:"0.8rem" } }, String(t.items.length))),
        on && React.createElement("div", { style:{ paddingLeft:"0.9rem", paddingTop:"0.3rem" } },
          pics.length ? sub("What\u2019s on screen") : null, pics.map(function(it, i){ return row(it, t.id+"p"+i); }),
          how.length ? sub("How do I\u2026?") : null, how.map(function(it, i){ return row(it, t.id+"g"+i); })));
    })));
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
        React.createElement("button", { onClick:save, style:{flex:1,background:meta.accent+"22",border:"2.5px solid "+meta.accent,borderRadius:S.radius,padding:"0.85rem",color:meta.accent,fontWeight:700,cursor:"pointer",fontFamily:S.fontBody,fontSize:MODAL_BTN_FONT} }, "Save"),
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
  var kindS = useState(function(){
    return project ? projKind(project) : inheritedKind(parents, defaultParentId||null);
  });
  var setKind=kindS[1]; var kind=kindS[0];
  // Until the type is set by hand, it tracks whichever project is selected as
  // the parent. Touch the toggle once and it stops moving underneath you.
  var kindTouched=useRef(false);
  // An existing project keeps whatever it already is, so moving it under
  // another project does not quietly turn it into a task.
  var roleS = useState(function(){
    // A caller can ask for one or the other - "add a project here" and "add a
    // task here" are different requests, and nesting alone cannot tell them
    // apart. Without a request, nesting still implies a task.
    if(project) return projRole(project);
    if(props.defaultRole) return props.defaultRole;
    return (defaultParentId||null)!=null ? "task" : "project";
  });
  var setRole=roleS[1]; var role=roleS[0];
  // When it starts. A new project starts the moment it is added unless told
  // otherwise. An existing one opens on whatever it already has and is never
  // silently stamped - so it lands on Pick, with the fields empty if it has no
  // start on record, and empty stays empty.
  var startModeS = useState(function(){ return project ? "pick" : "now"; });
  var startMode=startModeS[0]; var setStartMode=startModeS[1];
  var startDateS = useState(function(){ return tsDateStr(projStart(project)); });
  var startDate=startDateS[0]; var setStartDate=startDateS[1];
  var startTimeS = useState(function(){ return tsTimeStr(projStart(project)); });
  var startTime=startTimeS[0]; var setStartTime=startTimeS[1];
  var endDateS = useState(function(){ return tsDateStr(projEnd(project)); });
  var endDate=endDateS[0]; var setEndDate=endDateS[1];
  var endTimeS = useState(function(){ return tsTimeStr(projEnd(project)); });
  var endTime=endTimeS[0]; var setEndTime=endTimeS[1];
  // A select hands back a string; project ids are numbers, and every child
  // lookup in the app is a strict ===. Storing the raw value here would file
  // the project under a parent nothing can match, so it is resolved back to the
  // real id before it goes anywhere.
  function resolveParentId(v){
    if(v==null || v==="") return null;
    var hit=(parents||[]).filter(function(p){ return String(p.id)===String(v); })[0];
    return hit ? hit.id : null;
  }
  function pickParent(v){
    var id=resolveParentId(v);
    setParentId(id);
    if(!project && !kindTouched.current) setKind(inheritedKind(parents, id));
  }

  // Any project in the lane, not just the top-level ones, minus anything that
  // would make a loop or bust the depth cap.
  var eligibleParents = nestTargets(parents, project||null, lane);
  // A project with a parent is a task. The form reads that off its own live
  // selection rather than off how it was opened, so choosing a parent from the
  // dropdown relabels the buttons with it.
  var noun = (parentId!=null && role==="task") ? "Task" : "Project";
  var laneKeys = laneOrder.filter(function(k){ return getMeta(laneMeta,k); });

  // The picked start, and the end, as they stand right now. "Now" is not
  // resolved here - it is read off the clock at submit, so a form left open
  // for ten minutes stamps the moment you pressed the button, not the moment
  // you opened it.
  var pickedStart = joinDateTime(startDate, startTime);
  var pickedEnd   = kind==="finite" ? joinDateTime(endDate, endTime) : null;
  var startBad = startMode==="pick" && startDate!=="" && pickedStart==null;
  var endBad   = endDate!=="" && kind==="finite" && pickedEnd==null;
  // Against the clock while the start is Now, so the warning is honest either
  // way rather than only appearing once a start has been picked by hand.
  var startRef = startMode==="now" ? Date.now() : pickedStart;
  var endBackwards = !endBad && pickedEnd!=null && startRef!=null && pickedEnd < startRef;

  function submit(){
    if(!name.trim()) return;
    var pid=resolveParentId(parentId);
    // An ongoing project has no end by definition, so switching the type away
    // from finite clears one rather than leaving it behind to reappear later.
    var out={ name:name.trim(), notes:notes.trim(), kind:kind,
              startAt: startMode==="now" ? Date.now() : joinDateTime(startDate, startTime),
              endAt: kind==="finite" ? joinDateTime(endDate, endTime) : null };
    // With the placement controls hidden these keys are omitted entirely
    // rather than written back unchanged, so the panel cannot overwrite an
    // arrangement the outline is still holding.
    if(props.structure!==false){
      out.lane=lane; out.parentId=pid; out.role = pid==null ? "project" : role;
    }
    onSave(out);
  }

  var hintStyle = { fontSize:"0.74rem", color:S.textMuted, lineHeight:1.4, marginTop:"0.35rem" };
  function dtRow(key, dateVal, timeVal, setDate, setTime, bad){
    var col = bad ? S.dangerText : S.text;
    var bdr = bad ? S.dangerText : S.border;
    return React.createElement("div", { key:key,
      style:{display:"flex",alignItems:"center",gap:"0.5rem",marginTop:"0.5rem"} },
      React.createElement("input", { type:"date", value:dateVal,
        onChange:function(e){ setDate(e.target.value); },
        style:Object.assign(TIME_FIELD_STYLE(col, bdr), { flex:"1 1 auto", minWidth:"130px" }) }),
      React.createElement("input", { type:"time", value:timeVal,
        onChange:function(e){ setTime(e.target.value); },
        style:Object.assign(TIME_FIELD_STYLE(col, bdr), { flex:"0 1 94px", minWidth:"80px" }) })
    );
  }

  return (
    React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.85rem"} },
      React.createElement("div", null,
        React.createElement("label", { style:LABEL_STYLE }, "Name"),
        React.createElement("input", { value:name, onChange:function(e){ setName(e.target.value); }, placeholder:parentId?"Task Name":"Project Name", style:INPUT_STYLE,
          onKeyDown:function(e){ if(e.key==="Enter") submit(); } })
      ),
      // Lane, Nested under and Nested as are where a record SITS. Opened from
      // the outline those are the outline's job - it is holding an unsaved
      // arrangement of exactly these - so the panel shows details only and
      // leaves placement alone. Everywhere else the form still owns them.
      props.structure!==false && React.createElement("div", null,
        React.createElement("label", { style:LABEL_STYLE }, "Lane"),
        React.createElement("select", { value:lane, onChange:function(e){ setLane(e.target.value); pickParent(null); }, style:Object.assign({},INPUT_STYLE,{cursor:"pointer"}) },
          laneKeys.map(function(k){
            var m=getMeta(laneMeta,k);
            return React.createElement("option", { key:k, value:k }, m.label);
          })
        )
      ),
      props.structure!==false && eligibleParents.length>0 && React.createElement("div", null,
        React.createElement("label", { style:LABEL_STYLE }, "Nested under (optional)"),
        React.createElement("select", { value:parentId==null?"":String(parentId), onChange:function(e){ pickParent(e.target.value||null); }, style:Object.assign({},INPUT_STYLE,{cursor:"pointer"}) },
          React.createElement("option", { value:"" }, "-- Nothing, top level --"),
          // Indented with figure spaces so the shape of the tree survives in a
          // native select, which will not render markup.
          eligibleParents.map(function(e){
            return React.createElement("option", { key:e.p.id, value:String(e.p.id) },
              (e.depth ? new Array(e.depth+1).join("\u2007\u2007\u2007")+"\u2514 " : "")+e.p.name);
          })
        ),
        React.createElement("div", { style:{fontSize:"0.74rem",color:S.textMuted,lineHeight:1.4,marginTop:"0.35rem"} },
          project ? "Change this to move it in or out of another project."
                  : "Leave empty for a project of its own.")
      ),
      // Only meaningful once something is nested: at the top level everything
      // is a project by definition.
      props.structure!==false && parentId!=null && React.createElement("div", null,
        React.createElement("label", { style:LABEL_STYLE }, "Nested as"),
        React.createElement(Toggle, { name:"projrole", keys:["task","project"], value:role,
          labelOf:function(k){ return k==="task" ? "A task" : "A project"; },
          onChange:function(v){ setRole(v); } }),
        React.createElement("div", { style:{fontSize:"0.74rem",color:S.textMuted,lineHeight:1.4,marginTop:"0.35rem"} },
          role==="task"
            ? "A step within the project above. Shown as a row inside it."
            : "A project in its own right that the one above depends on. Shown as its own card, tucked under it.")
      ),
      React.createElement("div", null,
        React.createElement("label", { style:LABEL_STYLE }, "Type"),
        React.createElement(Toggle, { name:"projkind", keys:["ongoing","finite"], value:kind,
          labelOf:function(k){ return k==="ongoing" ? "Ongoing" : "Has an end"; },
          onChange:function(v){ kindTouched.current=true; setKind(v); } }),
        React.createElement("div", { style:{fontSize:"0.74rem",color:S.textMuted,lineHeight:1.4,marginTop:"0.4rem"} },
          kind==="ongoing"
            ? "Repeats and never finishes. You can still close it out whenever you want."
            : "Has a beginning and an end. Tick off every stage and it will offer to close itself out.")
      ),
      React.createElement("div", null,
        React.createElement("label", { style:LABEL_STYLE }, "Starts"),
        React.createElement(Toggle, { name:"projstart", keys:["now","pick"], value:startMode,
          labelOf:function(k){ return k==="now" ? "Now" : "Pick a date"; },
          onChange:function(v){
            // Moving to Pick with nothing filled in lands on today rather than
            // on two empty boxes to fight with on a phone.
            if(v==="pick" && !startDate){
              var d=new Date();
              setStartDate(isoDate(d));
              setStartTime(pad(d.getHours())+":"+pad(d.getMinutes()));
            }
            setStartMode(v);
          } }),
        startMode==="pick" ? dtRow("start", startDate, startTime, setStartDate, setStartTime, startBad) : null,
        React.createElement("div", { style:Object.assign({}, hintStyle, startBad?{color:S.dangerText}:null) },
          startMode==="now"
            ? (project ? "Stamped with the moment you save." : "Stamped with the moment you add it.")
            : (startBad ? "That is not a date on the calendar."
              : (pickedStart!=null ? "Starts "+fmtDate(pickedStart)+" at "+fmtTime(pickedStart)
                                   : "Clear the date to record no start at all.")))
      ),
      // Only a finite project has an end to set. Switching back to Ongoing
      // takes the fields away and clears the value on save.
      kind==="finite" && React.createElement("div", null,
        React.createElement("label", { style:LABEL_STYLE }, "Ends"),
        dtRow("end", endDate, endTime, setEndDate, setEndTime, endBad||endBackwards),
        React.createElement("div", { style:Object.assign({}, hintStyle, (endBad||endBackwards)?{color:S.dangerText}:null) },
          endBad ? "That is not a date on the calendar."
            : (endBackwards ? "That is before it starts."
              : (pickedEnd!=null ? "Ends "+fmtDate(pickedEnd)+" at "+fmtTime(pickedEnd)
                                 : "Optional. Leave it empty if the end is not fixed yet.")))
      ),
      React.createElement("div", null,
        React.createElement("label", { style:LABEL_STYLE }, "Notes"),
        React.createElement("textarea", { value:notes, onChange:function(e){ setNotes(e.target.value); }, placeholder:"Optional details", rows:2, style:Object.assign({},INPUT_STYLE,{resize:"vertical"}) })
      ),
      // Destructive action stays in the body - the floating bar is Save/Cancel.
      // Held, not tapped: a couple of seconds of fill before the confirmation
      // even opens, so a stray tap on the way to Save cannot start a delete.
      project&&onDelete && React.createElement(HoldButton, { onHold:onDelete, holdMs:HOLD_DELETE_MS, fill:rgba(S.dangerText,0.38),
        attrs:{ "data-holddelete":true },
        style:{width:"100%",background:S.dangerBg,border:"1px solid "+S.dangerText,borderRadius:S.radius,padding:"0.7rem",color:S.dangerText,fontFamily:S.fontBody,fontWeight:600} },
        "Delete "+noun),
      React.createElement(ModalActions, null,
        React.createElement("button", { onClick:submit, disabled:!name.trim(), style:{flex:1,background:name.trim()?S.infoBg:S.bg2,border:"2.5px solid "+(name.trim()?S.actionBdr:S.border),borderRadius:S.radius,padding:"0.85rem",color:name.trim()?S.infoText:S.textMuted,fontWeight:700,cursor:name.trim()?"pointer":"default",fontFamily:S.fontBody,fontSize:MODAL_BTN_FONT} },
          project?"Save":("Add "+noun)
        ),
        React.createElement("button", { onClick:onCancel, style:MODAL_CANCEL() }, "Cancel")
      )
    )
  );
}

// ---- CLOSE-OUT MODAL --------------------------------------------------------
// Closing keeps everything. The point of saying so plainly here is that the
// button sits where Delete used to be the only ending a project had, and the
// two need to be obviously different things.
// ---- THE CLOSURE SHEET -------------------------------------------------------
// Reached by HOLDING Complete on a card with no stages, by Close Out in a
// card's menu, or by the offer that follows the last stage being ticked. It
// asks what happened (outcome), when (defaulting to now, editable - the same
// reason a milestone mark can be backdated), and for a closing note. Open
// children used to be a refusal; they are a choice here - close them with it,
// or move them up a level - because the sheet is the confirmation and can
// carry the decision.
var CLOSE_OUTCOMES = [["done","Done"],["abandoned","Abandoned"],["superseded","Superseded"]];
function CloseProjectModal(props){
  var proj=props.proj, blockers=props.blockers||[], onClose=props.onClose, onConfirm=props.onConfirm;
  var noun = proj && proj.parentId ? "Task" : "Project";
  var outcomeS=useState("done"); var setOutcome=outcomeS[1]; var outcome=outcomeS[0];
  var dateS=useState(toDateInput(Date.now())); var setDate=dateS[1]; var date=dateS[0];
  var timeS=useState(toTimeInput(Date.now())); var setTime=timeS[1]; var time=timeS[0];
  var noteS=useState(""); var setNote=noteS[1]; var note=noteS[0];
  // Every open child must be MOVED to a chosen parent or DELETED before the
  // record can be completed. Nothing is ever closed over them silently.
  // resolutions: { childId: { kind:"move", lane, parentId, label } | { kind:"delete" } }
  var resS=useState({}); var setRes=resS[1]; var res=resS[0];
  var pickS=useState(null); var setPick=pickS[1]; var pick=pickS[0];   // "all" or a child id
  var unresolved=blockers.filter(function(b){ return !res[b.id]; });
  var at=joinDateTime(date, time);
  var future = at!==null && at>Date.now()+60000;
  var ok = at!==null && !future && unresolved.length===0;
  function resolve(ids, r){ setRes(function(prev){ var n=Object.assign({},prev); ids.forEach(function(id){ n[id]=r; }); return n; }); }
  function submit(){ if(ok) onConfirm({ at:at, outcome:outcome, note:note.trim(), resolutions:res }); }
  var segBtn=function(on, label, fn, key){
    return React.createElement("button", { key:key, "data-closeopt":key, onClick:fn,
      style:{flex:1,padding:"0.6rem 0.4rem",borderRadius:S.radius3,background:on?S.infoBg:S.bg1,
             border:"2px solid "+(on?S.actionBdr:S.border),color:on?S.infoText:S.textDim,cursor:"pointer",
             fontFamily:S.fontBody,fontWeight:700,fontSize:"0.82rem",WebkitTapHighlightColor:"transparent"} }, label);
  };
  return React.createElement(Modal, { actions:[React.createElement("button", { key:"a0", "data-closeconfirm":true, onClick:submit, disabled:!ok,
          style:Object.assign({}, MODAL_SAVE(), ok?null:{opacity:0.5,cursor:"default"}) }, "Complete"),
        React.createElement("button", { key:"a1", onClick:onClose, style:MODAL_CANCEL() }, "Cancel")], title:"Complete \u00b7 "+proj.name, onClose:onClose, ownActions:true },
    React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.9rem"} },
      React.createElement("div", null,
        React.createElement("label", { style:LABEL_STYLE }, "Outcome"),
        React.createElement("div", { style:{display:"flex",gap:"0.4rem"} },
          CLOSE_OUTCOMES.map(function(o){ return segBtn(outcome===o[0], o[1], function(){ setOutcome(o[0]); }, "outcome-"+o[0]); }))),
      React.createElement("div", null,
        React.createElement("label", { style:LABEL_STYLE }, "Completed"),
        React.createElement("div", { style:{display:"flex",gap:"0.5rem"} },
          React.createElement("input", { "data-closedate":true, type:"date", value:date, onChange:function(e){ setDate(e.target.value); }, style:Object.assign({},INPUT_STYLE,{flex:1.4,minWidth:0}) }),
          React.createElement("input", { "data-closetime":true, type:"time", value:time, onChange:function(e){ setTime(e.target.value); }, style:Object.assign({},INPUT_STYLE,{flex:1,minWidth:0}) })),
        // On the time alone - not on the children being undecided.
        future && React.createElement("div", { style:{fontSize:"0.76rem",color:S.warnText,marginTop:"0.35rem"} },
          "That is in the future. Completion records something that has happened.")),
      React.createElement("div", null,
        React.createElement("label", { style:LABEL_STYLE }, "Closure notes"),
        React.createElement("textarea", { "data-closenote":true, value:note, onChange:function(e){ setNote(e.target.value); },
          rows:3, placeholder:"What was the state at the end", style:Object.assign({},INPUT_STYLE,{resize:"vertical",minHeight:"4.2rem"}) })),
      // Open children: each is moved to a chosen parent or deleted, one at a
      // time or all at once. Until every one is decided, Complete is blocked.
      blockers.length>0 && React.createElement("div", { "data-closekids":true,
        style:{background:S.warnBg,border:"1px solid "+S.warnText,borderRadius:S.radius3,padding:"0.7rem 0.8rem"} },
        React.createElement("div", { style:{color:S.warnText,fontWeight:700,fontSize:"0.86rem",marginBottom:"0.2rem"} },
          blockers.length+" open "+(blockers.length===1?"task":"tasks")+" under this "+noun.toLowerCase()),
        React.createElement("div", { style:{color:S.textDim,fontSize:"0.76rem",marginBottom:"0.55rem"} },
          "Each must be moved to another parent, or deleted, before this can be completed."),
        blockers.length>1 && React.createElement("div", { style:{display:"flex",alignItems:"center",gap:"0.4rem",marginBottom:"0.5rem"} },
          React.createElement("span", { style:{fontSize:"0.62rem",fontWeight:800,letterSpacing:"0.1em",color:S.textDim,marginRight:"0.2rem"} }, "ALL"),
          React.createElement("button", { "data-kidsall":"move", onClick:function(){ setPick("all"); },
            style:{padding:"0.4rem 0.7rem",borderRadius:S.radius3,background:S.bg1,border:"1px solid "+S.border,color:S.textDim,cursor:"pointer",fontFamily:S.fontBody,fontWeight:700,fontSize:"0.78rem"} }, "Move all to\u2026"),
          React.createElement("button", { "data-kidsall":"delete", onClick:function(){ resolve(blockers.map(function(b){ return b.id; }), { kind:"delete" }); },
            style:{padding:"0.4rem 0.7rem",borderRadius:S.radius3,background:S.dangerBg,border:"1px solid "+S.dangerText,color:S.dangerText,cursor:"pointer",fontFamily:S.fontBody,fontWeight:700,fontSize:"0.78rem"} }, "Delete all")),
        React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.4rem"} },
          blockers.map(function(b){
            var r=res[b.id];
            var standing = !r ? "not yet decided" : r.kind==="move" ? "\u2192 "+r.label : "will be deleted";
            var stColor = !r ? S.warnText : r.kind==="move" ? S.msMet : S.dangerText;
            return React.createElement("div", { key:b.id, "data-closekid":b.id, "data-resolved":r?r.kind:"no",
              style:{display:"flex",alignItems:"center",gap:"0.5rem",background:S.bg1,
                     border:"1px solid "+(r?S.border:S.warnText),borderRadius:S.radius3,padding:"0.45rem 0.55rem"} },
              React.createElement(MenuIcon, { name:projRole(b)==="task"?"task":"project", size:15, col:r&&r.kind==="delete"?S.dangerText:S.chromeText }),
              React.createElement("span", { style:{flex:1,minWidth:0} },
                React.createElement("span", { style:{display:"block",color:r&&r.kind==="delete"?S.textMuted:S.text,fontWeight:700,fontSize:"0.84rem",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"} }, b.name),
                React.createElement("span", { style:{display:"block",color:stColor,fontSize:"0.7rem",fontWeight:600} }, standing)),
              React.createElement("button", { "data-kidmove":b.id, onClick:function(){ setPick(b.id); },
                style:{padding:"0.35rem 0.6rem",borderRadius:S.radius3,background:(r&&r.kind==="move")?S.infoBg:S.bg2,
                       border:"1px solid "+((r&&r.kind==="move")?S.actionBdr:S.border),color:(r&&r.kind==="move")?S.infoText:S.textDim,
                       cursor:"pointer",fontFamily:S.fontBody,fontWeight:700,fontSize:"0.76rem",whiteSpace:"nowrap"} }, (r&&r.kind==="move")?"Moved \u25BE":"Move \u25BE"),
              React.createElement("button", { "data-kiddelete":b.id, onClick:function(){ resolve([b.id], { kind:"delete" }); },
                style:{padding:"0.35rem 0.6rem",borderRadius:S.radius3,background:(r&&r.kind==="delete")?S.dangerBg:S.bg2,
                       border:"1px solid "+((r&&r.kind==="delete")?S.dangerText:S.border),color:(r&&r.kind==="delete")?S.dangerText:S.textDim,
                       cursor:"pointer",fontFamily:S.fontBody,fontWeight:700,fontSize:"0.76rem"} }, "Delete"));
          })),
        unresolved.length>0 && React.createElement("div", { "data-kidsleft":unresolved.length,
          style:{color:S.warnText,fontSize:"0.74rem",fontWeight:700,textAlign:"center",marginTop:"0.5rem"} },
          unresolved.length+" still to decide"))),
    pick!==null && React.createElement(MoveTargetModal, { projects:props.allProjects||[], laneMeta:props.laneMeta, laneOrder:props.laneOrder,
      exclude:proj.id, count: pick==="all" ? blockers.length : 1,
      onPick:function(target){ resolve(pick==="all" ? blockers.map(function(b){ return b.id; }) : [pick], Object.assign({ kind:"move" }, target)); setPick(null); },
      onCancel:function(){ setPick(null); } }));
}
// Where a child can go: the top of any lane, or under any open project that
// is not the record being closed nor anything beneath it.
function MoveTargetModal(props){
  var projects=props.projects||[], laneMeta=props.laneMeta, laneOrder=props.laneOrder||[], exclude=props.exclude;
  var banned=getDescendantIds(projects, exclude).concat([exclude]);
  var targets=[];
  laneOrder.forEach(function(k){ targets.push({ key:"lane:"+k, lane:k, parentId:null, label:"Top of "+getMeta(laneMeta,k).label, glyph:"lanes", accent:getMeta(laneMeta,k).accent }); });
  projects.filter(function(p){ return isOpen(p) && banned.indexOf(p.id)<0 && projRole(p)==="project"; })
    .forEach(function(p){ targets.push({ key:"proj:"+p.id, lane:p.lane, parentId:p.id, label:p.name, glyph:"project", accent:getMeta(laneMeta,p.lane).accent, sub:getMeta(laneMeta,p.lane).label }); });
  return React.createElement(Modal, { actions:[React.createElement("button", { key:"a0", onClick:props.onCancel, style:MODAL_CANCEL() }, "Cancel")], title:"Move "+(props.count>1?props.count+" tasks":"task")+" to\u2026", onClose:props.onCancel, ownActions:true },
    React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.4rem"} },
      targets.map(function(t){
        return React.createElement("button", { key:t.key, "data-movetarget":t.key,
          onClick:function(){ props.onPick({ lane:t.lane, parentId:t.parentId, label:t.label }); },
          style:{display:"flex",alignItems:"center",gap:"0.6rem",width:"100%",textAlign:"left",background:S.bg1,
                 border:"1px solid "+S.border,borderRadius:S.radius3,padding:"0.6rem 0.7rem",cursor:"pointer",fontFamily:S.fontBody} },
          React.createElement(MenuIcon, { name:t.glyph, size:18, col:t.accent }),
          React.createElement("span", { style:{flex:1,minWidth:0} },
            React.createElement("span", { style:{display:"block",color:S.text,fontWeight:700,fontSize:"0.88rem"} }, t.label),
            t.sub && React.createElement("span", { style:{display:"block",color:S.textDim,fontSize:"0.7rem"} }, t.sub)));
      })));
}
// All stages ticked: an offer, not an action. Close it out, or there is more
// to do and the stages should say so.
function StagesDoneModal(props){
  var proj=props.proj;
  return React.createElement(Modal, { title:"All stages done", onClose:props.onLater, ownActions:true },
    React.createElement("p", { style:{color:S.textDim,fontSize:"0.9rem",lineHeight:1.5,marginBottom:"1rem"} },
      "Every stage of "+proj.name+" is ticked. Complete it, or add the stages that are still to come."),
    React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.5rem"} },
      React.createElement("button", { "data-stagesdone":"close", onClick:props.onCloseOut,
        style:Object.assign({}, MODAL_SAVE(), {width:"100%",flex:"none"}) }, "Complete it"),
      React.createElement("button", { "data-stagesdone":"more", onClick:props.onMoreStages,
        style:Object.assign({}, MODAL_CANCEL(), {width:"100%",flex:"none"}) }, "Add more stages"),
      React.createElement("button", { "data-stagesdone":"later", onClick:props.onLater,
        style:{width:"100%",background:"none",border:"none",padding:"0.6rem",color:S.textMuted,cursor:"pointer",fontFamily:S.fontBody,fontWeight:600} }, "Not now")));
}


// ---- STARTING AHEAD OF SCHEDULE ---------------------------------------------
// Raised when the greyed Start on a project scheduled for later is pressed.
// Three answers, because all three are things people actually mean: the job
// came forward, the plan was wrong, or the press was a mistake. Waiting is the
// quiet one, so it is the plain button rather than the loud one.
function StartAheadModal(props){
  var proj=props.proj, onStartNow=props.onStartNow, onReschedule=props.onReschedule, onWait=props.onWait;
  var when=projStart(proj);
  var stageS=useState(null); var stage=stageS[0]; var setStage=stageS[1];
  var dateS=useState(function(){ return tsDateStr(when); }); var date=dateS[0]; var setDate=dateS[1];
  var timeS=useState(function(){ return tsTimeStr(when); }); var time=timeS[0]; var setTime=timeS[1];
  var picked=joinDateTime(date, time);
  var bad = date!=="" && picked==null;

  if(stage==="when"){
    return React.createElement(Modal, { actions:[React.createElement("button", { key:"a0", onClick:function(){ if(!bad) onReschedule(picked); },
          style:{flex:1,background:bad?S.bg2:S.infoBg,border:"2px solid "+(bad?S.border:S.actionBdr),
                 borderRadius:S.radius,padding:"0.85rem",color:bad?S.textMuted:S.infoText,
                 cursor:bad?"default":"pointer",fontWeight:700,fontFamily:S.fontBody,fontSize:MODAL_BTN_FONT} }, "Save"),
        React.createElement("button", { key:"a1", onClick:function(){ setStage(null); }, style:MODAL_CANCEL() }, "Back")], title:"New Start Time", onClose:onWait, ownActions:true },
      React.createElement("p", { style:{color:S.textDim,fontSize:"0.88rem",lineHeight:1.5,marginBottom:"0.8rem"} },
        "When should "+proj.name+" start instead?"),
      React.createElement("div", { style:{display:"flex",alignItems:"center",gap:"0.5rem",marginBottom:"0.5rem"} },
        React.createElement("input", { type:"date", value:date,
          onChange:function(e){ setDate(e.target.value); },
          style:Object.assign(TIME_FIELD_STYLE(bad?S.dangerText:S.text, bad?S.dangerText:S.border),
            { flex:"1 1 auto", minWidth:"130px" }) }),
        React.createElement("input", { type:"time", value:time,
          onChange:function(e){ setTime(e.target.value); },
          style:Object.assign(TIME_FIELD_STYLE(bad?S.dangerText:S.text, bad?S.dangerText:S.border),
            { flex:"0 1 94px", minWidth:"80px" }) })
      ),
      React.createElement("div", { style:{fontSize:"0.74rem",color:bad?S.dangerText:S.textMuted,lineHeight:1.4,marginBottom:"1rem"} },
        bad ? "That is not a date on the calendar."
          : (picked==null ? "Clear the date to leave it with no scheduled start."
            : (picked>Date.now() ? "It will stay greyed out until then."
                                 : "That is in the past, so it will be startable straight away.")))
    );
  }

  return React.createElement(Modal, { title:"Not Started Yet", onClose:onWait, ownActions:true },
    React.createElement("p", { style:{color:S.textDim,fontSize:"0.88rem",lineHeight:1.5,marginBottom:"0.9rem"} },
      proj.name+" isn\u2019t scheduled to start till "+fmtDate(when)+" at "+fmtTime(when)+"."),
    React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.5rem"} },
      React.createElement("button", { onClick:onStartNow,
        style:{width:"100%",background:S.successBg2,border:"2px solid "+S.successBorder,borderRadius:S.radius,
               padding:"0.85rem",color:S.successText,cursor:"pointer",fontWeight:700,fontFamily:S.fontBody} },
        "Start It Now"),
      React.createElement("div", { style:{fontSize:"0.74rem",color:S.textMuted,lineHeight:1.4,marginTop:"-0.2rem"} },
        "The start on record moves to now, so it stops reading as scheduled."),
      React.createElement("button", { onClick:function(){ setStage("when"); },
        style:{width:"100%",background:S.infoBg,border:"2px solid "+S.actionBdr,borderRadius:S.radius,
               padding:"0.85rem",color:S.infoText,cursor:"pointer",fontWeight:700,fontFamily:S.fontBody} },
        "Pick a New Date & Time"),
      React.createElement("button", { onClick:onWait, style:Object.assign({}, MODAL_CANCEL(), {width:"100%",flex:"none"}) },
        "Wait Till Then")
    )
  );
}

// ---- ADD NEW ----------------------------------------------------------------
// One entry point for everything that can be created, asked as a question
// rather than buried in a nested menu. Two steps at most: what, then where.
// A task needs a project to hang off, so if there are none it says so instead
// of offering an empty list.

// ---- MATCH TASKS ------------------------------------------------------------
// Raised when a project's type changes and its tasks no longer agree. Asked
// rather than done, because the tasks are independently settable on purpose -
// silently rewriting them would throw away a deliberate choice.
function MatchTasksModal(props){
  var proj=props.proj, tasks=props.tasks||[], onMatch=props.onMatch, onLeave=props.onLeave;
  var want = isFinite_(proj) ? "Has an end" : "Ongoing";
  var other = isFinite_(proj) ? "Ongoing" : "Has an end";
  var n = tasks.length;

  // Everything starts ticked: following the project is the usual intent, and
  // the previous version of this prompt was all-or-nothing in that direction.
  // Untick what should keep its own setting; untick everything and nothing
  // changes at all.
  var selS=useState(function(){ var m={}; tasks.forEach(function(t){ m[t.id]=true; }); return m; });
  var sel=selS[0], setSel=selS[1];
  var chosen=tasks.filter(function(t){ return sel[t.id]; });
  var allOn = chosen.length===n && n>0;
  var noneOn = chosen.length===0;
  function flip(id){ var next=Object.assign({},sel); next[id]=!next[id]; setSel(next); haptic(6); }
  function flipAll(){ var v=!allOn, next={}; tasks.forEach(function(t){ next[t.id]=v; }); setSel(next); haptic(8); }

  function box(on, partial){
    return React.createElement("span", { style:{width:"22px",height:"22px",borderRadius:"6px",flexShrink:0,
      background:on?S.successBg2:S.bg0, border:"2px solid "+(on||partial?S.successText:S.borderBright),
      display:"flex",alignItems:"center",justifyContent:"center",
      color:S.successText,fontSize:"0.8rem",fontWeight:800,lineHeight:1} },
      on ? "\u2713" : (partial ? "\u2013" : ""));
  }
  function row(key, on, partial, label, sub, onClick, top){
    return React.createElement("button", { key:key, "data-flat":true, onClick:onClick,
      style:{display:"flex",alignItems:"center",gap:"0.6rem",width:"100%",textAlign:"left",
             background:"none",border:"none",borderTop:top?"none":"1px solid "+S.border,
             padding:"0.55rem 0.2rem",cursor:"pointer",fontFamily:S.fontBody} },
      box(on, partial),
      React.createElement("span", { style:{flex:1,minWidth:0} },
        React.createElement("span", { style:{display:"block",color:S.text,fontSize:"0.88rem",fontWeight:top?700:600,
          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"} }, label),
        sub ? React.createElement("span", { style:{display:"block",color:S.textMuted,fontSize:"0.72rem",marginTop:"0.1rem"} }, sub) : null
      )
    );
  }

  return React.createElement(Modal, { actions:[React.createElement("button", { key:"a0", onClick:function(){ onMatch(chosen); },
        style:{flex:1,background:noneOn?S.bg2:S.infoBg,border:"2px solid "+(noneOn?S.border:S.actionBdr),
               borderRadius:S.radius,padding:"0.85rem",color:noneOn?S.textDim:S.infoText,
               cursor:"pointer",fontWeight:700,fontFamily:S.fontBody,fontSize:MODAL_BTN_FONT} },
        noneOn ? "Leave All As Is" : (chosen.length===1 ? "Change 1 Task" : "Change "+chosen.length+" Tasks")),
      React.createElement("button", { key:"a1", onClick:onLeave, style:MODAL_CANCEL() }, "Cancel")], title:"Match Tasks?", onClose:onLeave, ownActions:true },
    React.createElement("p", { style:{color:S.textDim,fontSize:"0.88rem",lineHeight:1.5,marginBottom:"0.7rem"} },
      proj.name+" is now set to \u201C"+want+"\u201D. "+n+" of its task"+(n!==1?"s are":" is")+
      " still set to \u201C"+other+"\u201D. Tick the ones that should follow."),
    React.createElement("div", { style:{background:S.bg1,border:"1px solid "+S.border,borderRadius:S.radius3,
      padding:"0.1rem 0.75rem",marginBottom:"1rem",maxHeight:"240px",overflowY:"auto"} },
      n>1 ? row("__all", allOn, !allOn && !noneOn, allOn?"Deselect all":"Select all", null, flipAll, true) : null,
      tasks.map(function(t, i){
        return row(t.id, !!sel[t.id], false, t.name, null, function(){ flip(t.id); }, n>1?false:(i===0));
      })
    )
  );
}

// ---- ARCHIVE ----------------------------------------------------------------
// Everything that has been closed out, newest first. This is the historical
// record: time totals are computed from the logs, which closing never touched.
function ArchiveModal(props){
  var projects=props.projects||[], logs=props.logs||[], laneMeta=props.laneMeta;
  var onReopen=props.onReopen, onClose=props.onClose;
  var closed=projects.filter(isClosed).sort(function(a,b){ return b.closedAt-a.closedAt; });

  var msById={};
  logs.forEach(function(l){
    if(!l || l.type==="atwork" || l.projectId==null) return;
    msById[l.projectId]=(msById[l.projectId]||0)+(l.duration||0);
  });

  return React.createElement(Modal, { title:"Archive", onClose:onClose, cancelLabel:"Close" },
    closed.length===0
      ? React.createElement("div", { style:{border:"2px dashed "+S.borderBright,borderRadius:S.radius,
          padding:"1.4rem 1rem",textAlign:"center"} },
          React.createElement("div", { style:{color:S.text,fontWeight:700,fontSize:"0.92rem",marginBottom:"0.3rem"} },
            "Nothing closed out yet"),
          React.createElement("div", { style:{color:S.textDim,fontSize:"0.8rem",lineHeight:1.45} },
            "Close a project from its menu and it lands here, with all of its history."))
      : React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.5rem"} },
          closed.map(function(p){
            var meta=getMeta(laneMeta,p.lane);
            var kids=getChildren(projects,p.id);
            var ms=(msById[p.id]||0)+getDescendantIds(projects,p.id).reduce(function(a,id){ return a+(msById[id]||0); },0);
            return React.createElement("div", { key:p.id, "data-anchor":"arch-row", style:{background:S.bg1,border:"1px solid "+S.border,
              borderRadius:S.radius,padding:"0.7rem 0.85rem"} },
              React.createElement("div", { style:{display:"flex",alignItems:"center",gap:"0.5rem"} },
                React.createElement("span", { style:{width:"8px",height:"8px",borderRadius:"50%",flexShrink:0,background:meta.accent} }),
                React.createElement("span", { style:{flex:1,minWidth:0,color:S.text,fontWeight:700,fontSize:"0.92rem",
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"} }, p.name),
                React.createElement(Mono, { "data-anchor":"arch-time", style:{color:S.textDim,fontSize:"0.8rem",fontWeight:700,flexShrink:0} }, fmtDur(ms,true))
              ),
              React.createElement("div", { "data-anchor":"arch-meta", style:{fontSize:"0.72rem",color:S.textMuted,marginTop:"0.25rem"} },
                meta.label+"  \u00B7  "+(isFinite_(p)?"Has an end":"Ongoing")
                  +(p.parentId?"  \u00B7  task":"")
                  +(kids.length?"  \u00B7  "+kids.length+" task"+(kids.length!==1?"s":""):"")
                  +"  \u00B7  closed "+fmtDate(p.closedAt)
                  +(projStart(p)!=null ? "  \u00B7  started "+fmtDate(projStart(p)) : "")
                  +(projEnd(p)!=null ? "  \u00B7  due "+fmtDate(projEnd(p)) : "")),
              p.closedNote ? React.createElement("div", { style:{fontSize:"0.78rem",color:S.textDim,marginTop:"0.3rem",lineHeight:1.35} }, p.closedNote) : null,
              React.createElement("div", { style:{display:"flex",justifyContent:"flex-end",marginTop:"0.5rem"} },
                React.createElement("button", { "data-flat":true, "data-anchor":"arch-reopen", onClick:function(){ onReopen(p); },
                  style:{background:"none",border:"1.5px solid "+S.actionBdr,borderRadius:S.radius3,
                         padding:"0.4rem 0.7rem",color:S.actionText,cursor:"pointer",fontWeight:700,
                         fontFamily:S.fontBody,fontSize:"0.78rem"} }, "Reopen")
              )
            );
          })
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
          React.createElement("button", { onClick:function(){ onStart(note.trim()); }, style:{flex:1,background:S.dangerBg2,border:"2px solid #CC3030",borderRadius:S.radius,padding:"0.85rem",color:S.dangerBright,cursor:"pointer",fontWeight:700,fontFamily:S.fontBody,fontSize:MODAL_BTN_FONT} }, "!! Start Disruption"),
          React.createElement("button", { onClick:onCancel, style:MODAL_CANCEL() }, "Cancel")
        )
      )
    )
  );
}

// ---- CLOCK-IN DAY PROMPT ----------------------------------------------------
// Shown when the clock starts outside the scheduled window. There is no default
// and no dismissal: the app cannot know whether 21:40 is a long Wednesday or an
// early Thursday, and quietly guessing wrong silently misfiles a whole shift.
// Two answers, worded as shifts rather than dates, with the date underneath.
function ClockDayModal(props){
  var choices=props.choices||[], onPick=props.onPick, onCancel=props.onCancel;
  var when=props.when||Date.now();
  var why = props.position==="before" ? "before your scheduled start"
          : props.position==="after"  ? "after your scheduled finish"
          : "on a day you are not scheduled to work";
  var ask = props.stage==="ot"
    ? "This day is not on your schedule, so there are no rostered hours to measure it against. How should it be paid?"
    : "It is "+fmtTime(when)+", "+why+". Which shift should this time be logged against?";
  return React.createElement(Modal, { title:props.title||"Which Shift?", onClose:onCancel, ownActions:true },
    React.createElement("div", { style:{color:S.textDim,fontSize:"0.85rem",lineHeight:1.45,marginBottom:"0.9rem"} },
      ask),
    React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.55rem"} },
      choices.map(function(c){
        return React.createElement("button", { key:c.key, "data-shiftchoice":c.key, onClick:function(){ haptic(12); onPick(c); },
          style:{display:"flex",flexDirection:"column",alignItems:"flex-start",gap:"0.1rem",
                 width:"100%",textAlign:"left",background:S.bg1,border:"2px solid "+S.actionBdr,
                 borderRadius:S.radius,padding:"0.8rem 0.9rem",cursor:"pointer",fontFamily:S.fontBody} },
          React.createElement("span", { style:{color:S.actionText,fontWeight:700,fontSize:"0.95rem"} }, c.label),
          React.createElement("span", { style:{color:S.textDim,fontSize:"0.78rem"} },
            c.note!=null ? c.note
              : new Date(c.when).toLocaleDateString([], {weekday:"long",month:"short",day:"numeric"})
                + (c.unscheduled ? "  \u00B7  not on your schedule" : ""))
        );
      })
    ),
    React.createElement("button", { onClick:onCancel,
      style:Object.assign({}, MODAL_CANCEL(), {width:"100%",marginTop:"0.9rem",flex:"none"}) },
      props.cancelLabel||"Cancel")
  );
}

// ---- DISRUPTION BADGE -------------------------------------------------------
// Two data points, always in the same order and the same colours: the running
// day first, bright, because that is the number you act on; the project's
// lifetime total behind a divider, dimmed. The badge shows whenever the project
// has ever been disrupted, so a clean day still carries its history instead of
// vanishing at midnight and looking like nothing ever happened.
// Counts and totals a list of disruptions against a set of project ids. Day
// scoping is the caller's job - it hands in either today's list or all of them
// - so there is exactly one place that decides what "today" means.
function distStats(list, ids){
  var n=0, ms=0;
  (list||[]).forEach(function(d){
    if(!d.endTime) return;
    if(ids.indexOf(d.projectId)<0) return;
    n++; ms+=d.duration;
  });
  return { n:n, ms:ms };
}
function DistBadge(props){
  var today=props.today||{n:0,ms:0}, total=props.total||{n:0,ms:0};
  if(!total.n) return null;
  var live = today.n>0;
  var fs = props.small ? "0.7rem" : "0.74rem";
  return React.createElement("button", { onClick:props.onClick, "data-anchor":"disruptions",
    "aria-label":"Disruptions: "+today.n+" today, "+total.n+" in total",
    style:{display:"flex",alignItems:"center",gap:"0.32rem",
           background:live?S.dangerTint:S.bg1,
           border:"2px solid "+(live?"#CC3030":S.border),
           borderRadius:"8px",cursor:"pointer",padding:"0 0.5rem",
           height:"30px",minHeight:"30px",flexShrink:0} },
    React.createElement("span", { style:{fontSize:props.small?"0.8rem":"0.86rem",fontWeight:900,
      color:live?S.distBadge:S.distDim,letterSpacing:"-0.05em",lineHeight:1} }, "!!"),
    React.createElement(Mono, { style:{fontSize:fs,fontWeight:700,whiteSpace:"nowrap",
      color:live?S.distBadge:S.textMuted,lineHeight:1} },
      live ? today.n+" "+fmtDur(today.ms,true) : "0"),
    React.createElement("span", { style:{width:"1px",height:"14px",flexShrink:0,
      background:live?S.distEdge:S.border} }),
    React.createElement(Mono, { style:{fontSize:fs,fontWeight:700,whiteSpace:"nowrap",
      color:S.distDim,lineHeight:1} }, total.n+" "+fmtDur(total.ms,true))
  );
}

// ---- DISRUPTION POPUP -------------------------------------------------------
function DisruptionPopup(props){
  var disruptions=props.disruptions||[], projName=props.projName, onClose=props.onClose;
  var done=disruptions.filter(function(d){ return d.endTime; })
                      .sort(function(a,b){ return b.startTime-a.startTime; });
  var dayKey=todayStr();
  var today=done.filter(function(d){ return sameWorkDay(d.startTime,dayKey); });
  var earlier=done.filter(function(d){ return !sameWorkDay(d.startTime,dayKey); });
  var sum=function(a){ return a.reduce(function(t,d){ return t+d.duration; },0); };

  function head(label, list, bright){
    return React.createElement("div", { style:{display:"flex",justifyContent:"space-between",
        background:bright?S.dangerBg:S.bg2,border:"1px solid "+(bright?S.dangerText:S.border),
        borderRadius:S.radius3,padding:"0.6rem 0.85rem",marginBottom:"0.25rem"} },
      React.createElement("span", { style:{color:bright?S.dangerText:S.textDim,fontWeight:700,fontSize:"0.85rem"} },
        label+" - "+list.length+" disruption"+(list.length!==1?"s":"")),
      React.createElement(Mono, { style:{color:bright?S.dangerText:S.textDim,fontWeight:700,fontSize:"0.85rem"} },
        fmtDur(sum(list),true)+" lost")
    );
  }
  function row(d,i){
    return React.createElement("div", { key:i, style:{background:S.bg1,border:"1px solid "+S.border,borderRadius:S.radius3,padding:"0.6rem 0.85rem"} },
      React.createElement("div", { style:{display:"flex",justifyContent:"space-between",gap:"0.5rem"} },
        React.createElement("span", { style:{color:S.text,fontSize:"0.88rem",flex:1} }, d.note||"(no note)"),
        React.createElement(Mono, { style:{color:S.dangerText,fontSize:"0.82rem",fontWeight:700,flexShrink:0} }, fmtDur(d.duration,true))
      ),
      React.createElement("div", { style:{fontSize:"0.72rem",color:S.textMuted,marginTop:"0.2rem"} },
        fmtDate(d.startTime)+"  "+fmtTime(d.startTime)+" to "+fmtTime(d.endTime)
          +(d.projectName&&d.projectName!==projName?" - "+d.projectName:"")
      )
    );
  }

  return (
    React.createElement(Modal, { title:"Disruptions - "+projName, onClose:onClose },
      done.length===0
        ? React.createElement("div", { style:{color:S.textMuted,textAlign:"center",padding:"1.5rem 0"} }, "No disruptions logged.")
        : React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.5rem"} },
            head("Today", today, true),
            today.length===0
              ? React.createElement("div", { style:{color:S.textMuted,fontSize:"0.8rem",padding:"0.1rem 0 0.35rem"} },
                  "Nothing lost today.")
              : today.map(row),
            earlier.length>0 && React.createElement("div", { style:{marginTop:"0.5rem"} }, head("Earlier", earlier, false)),
            earlier.map(row)
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
          return React.createElement("button", { key:label, "data-breakpreset":label, onClick:function(){ onStart(label); },
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

// ---- EDIT ONE LANE -----------------------------------------------------------
// The edit twin of New Lane: the same name field, the same eight swatches, the
// same live preview - so renaming or recolouring a lane is the full-size form,
// not a dot to cycle and a cramped input in a list.
//
// The preview sits directly under the name, where a rename shows immediately.
// Delete stands alone below the action row rather than beside Save: it is the
// one control here whose mis-tap costs a lane and everything in it.
//
// It owns the delete conversation too - what to do with the projects inside -
// because that question belongs to the lane being deleted, not to a list.
function LaneEditModal(props){
  var laneKey=props.laneKey, laneMeta=props.laneMeta, projects=props.projects||[];
  var onSave=props.onSave, onCancel=props.onCancel, onDeleteLane=props.onDeleteLane;
  var laneOrder=props.laneOrder||[];
  var start=getMeta(laneMeta, laneKey);
  var labelS=useState(start.label||laneKey); var setLabel=labelS[1]; var label=labelS[0];
  var pickedS=useState(function(){
    var hit=laneColors().filter(function(c){ return c.accent===start.accent; })[0];
    return hit || { label:"Custom", accent:start.accent, bg:start.bg, dim:start.dim };
  });
  var setPicked=pickedS[1]; var picked=pickedS[0];
  var confirmS=useState(false); var setConfirm=confirmS[1]; var confirm=confirmS[0];
  var inside=projects.filter(function(p){ return p.lane===laneKey; });
  var moveTargets=laneOrder.filter(function(k){ return k!==laneKey; });

  if(confirm){
    return React.createElement(Modal, { title:"Delete Lane", onClose:function(){ setConfirm(false); }, ownActions:true },
      React.createElement("div", { style:{background:S.dangerBg,border:"2px solid "+S.dangerText,borderRadius:S.radius,padding:"0.85rem 1rem",marginBottom:"0.9rem"} },
        React.createElement("div", { style:{fontWeight:700,fontSize:"1rem",color:S.dangerText,marginBottom:"0.3rem"} },
          "Delete \u201c"+(label.trim()||start.label)+"\u201d?"),
        React.createElement("div", { style:{fontSize:"0.85rem",color:S.textDim} },
          inside.length===0 ? "This lane is empty."
            : "This lane holds "+inside.length+" project"+(inside.length!==1?"s":"")+".")),
      inside.length>0 && moveTargets.length>0 && React.createElement("div", { style:{marginBottom:"0.9rem"} },
        React.createElement("div", { style:{fontSize:"0.78rem",color:S.textDim,marginBottom:"0.45rem"} }, "Move them to:"),
        React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.4rem"} },
          moveTargets.map(function(k){
            var m=getMeta(laneMeta,k);
            return React.createElement("button", { key:k, "data-movelane":k,
              onClick:function(){ onDeleteLane(laneKey,"move",k); },
              style:{width:"100%",textAlign:"left",background:S.bg1,border:"1px solid "+m.accent,
                     borderRadius:S.radius3,padding:"0.7rem 0.9rem",color:m.accent,cursor:"pointer",
                     fontFamily:S.fontBody,fontWeight:700,fontSize:MODAL_BTN_FONT} }, m.label);
          }))),
      React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.5rem"} },
        React.createElement("button", { "data-deleteall":true, onClick:function(){ onDeleteLane(laneKey,"delete",null); },
          style:{width:"100%",background:S.dangerBg,border:"2px solid "+S.dangerText,borderRadius:S.radius,
                 padding:"0.85rem",color:S.dangerText,cursor:"pointer",fontFamily:S.fontBody,
                 fontWeight:700,fontSize:MODAL_BTN_FONT} },
          inside.length===0 ? "Delete Lane" : "Delete the lane and its "+inside.length+" project"+(inside.length!==1?"s":"")),
        React.createElement("button", { onClick:function(){ setConfirm(false); },
          style:Object.assign({}, MODAL_CANCEL(), {width:"100%",flex:"none"}) }, "Keep it")));
  }

  var name=label.trim();
  return React.createElement(Modal, { actions:[React.createElement("button", { key:"a0", "data-lanesave":true, onClick:function(){ if(name) onSave(laneKey, name, picked); },
          disabled:!name, style:Object.assign({}, MODAL_SAVE(), name?null:{opacity:0.5,cursor:"default"}) }, "Save"),
        React.createElement("button", { key:"a1", onClick:onCancel, style:MODAL_CANCEL() }, "Cancel"),
        React.createElement(HoldButton, { key:"a2", onHold:function(){ setConfirm(true); }, holdMs:HOLD_DELETE_MS, fill:rgba(S.dangerText,0.38),
          attrs:{ "data-lanedelete":true, "data-holddelete":true },
          style:{flex:"0 0 auto",background:S.dangerBg,border:"1px solid "+S.dangerText,
                 borderRadius:S.radius,padding:"0.85rem 0.9rem",color:S.dangerText,
                 fontFamily:S.fontBody,fontWeight:700,fontSize:MODAL_BTN_FONT} }, "Delete")], title:"Edit Lane", onClose:onCancel, ownActions:true },
    React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"1rem"} },
      React.createElement("div", null,
        React.createElement("label", { style:LABEL_STYLE }, "Lane Name"),
        React.createElement("input", { "data-lanename":true, value:label,
          onChange:function(e){ setLabel(e.target.value); }, style:INPUT_STYLE,
          onKeyDown:function(e){ if(e.key==="Enter"&&name) onSave(laneKey, name, picked); } })),
      // Straight under the name, so a rename shows as it is typed.
      React.createElement("div", { "data-lanepreview":true,
        style:{background:picked.bg,border:"1px solid "+picked.accent,borderRadius:S.radius,padding:"0.65rem 1rem"} },
        React.createElement("div", { style:{fontSize:"0.7rem",textTransform:"uppercase",letterSpacing:"0.1em",
               color:picked.accent,fontWeight:700} }, name||start.label||"Lane Name")),
      React.createElement("div", null,
        React.createElement("label", { style:LABEL_STYLE }, "Color"),
        React.createElement("div", { style:{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"0.5rem"} },
          laneColors().map(function(col){
            var on=picked.accent===col.accent;
            return React.createElement("button", { key:col.label, "data-lanecolor":col.label,
              onClick:function(){ setPicked(col); },
              style:{background:col.bg,border:(on?"2px solid ":"1px solid ")+(on?col.accent:col.dim),
                     borderRadius:S.radius,padding:"0.6rem 0.4rem",cursor:"pointer",display:"flex",
                     flexDirection:"column",alignItems:"center",gap:"0.3rem"} },
              React.createElement("div", { style:{width:"20px",height:"20px",borderRadius:"50%",
                     background:col.accent,boxShadow:on&&S.glow?("0 0 8px "+col.accent):"none"} }),
              React.createElement("span", { style:{fontSize:"0.68rem",color:col.accent,fontWeight:600,
                     fontFamily:S.fontBody} }, col.label));
          }))),
      // One row: Save under the thumb, Cancel beside it, Delete at the far
      // end. Children are written Save, Cancel, Delete and ACTION_ROW reverses
      // them for handedness, so Delete is always the corner furthest from
      // Save - the two should never be neighbours.
    ));
}

// ---- EDIT LANES MODAL -------------------------------------------------------
function moveItem(arr, from, to){
  var out=(arr||[]).slice();
  if(from===to || from<0 || to<0 || from>=out.length || to>=out.length) return out;
  out.splice(to, 0, out.splice(from,1)[0]);
  return out;
}
// ---- MILESTONES --------------------------------------------------------------
// A milestone tracker is a list of STEPS on a project - and only on a project.
// A step is a point in time: a target (dueAt) and an expectation, the records
// that should be closed out by then. Its ACTUAL time is when that expectation
// was satisfied: the moment its last target closed, or the moment someone
// marked it by hand, whichever came first. From target and actual fall four
// statuses - met, late, missed, upcoming - and a variance.
//
// Lanes and the board own nothing. Their lines are computed by ROLLING UP the
// level directly beneath them: a project's line shows its own steps plus one
// mark per sub-project at that child's current point; a lane's line one mark
// per project; the board's one mark per lane. Same rule, applied recursively,
// nothing stored that could drift from the steps that drive it.
//
// A step: { id, label, dueAt, targets:[{kind:"project", id}], doneAt|null, note }

// Worst wins: a missed step outranks everything, a met one nothing.
var MS_RANK = { missed:3, late:2, upcoming:1, met:0 };
function worstStatus(list){
  var w="met";
  (list||[]).forEach(function(s){ if((MS_RANK[s]||0)>(MS_RANK[w]||0)) w=s; });
  return w;
}
// A record is complete when it has been closed out. Not when its stages are
// done - that prompts a close-out, but the close-out is the completion.
function recordClosedAt(projects, id){
  var p=findProj(projects, id);
  return (p && p.closedAt) ? p.closedAt : null;
}
// When a step's expectation was met: every target closed, at the time the
// last one did - or a hand-marked time, if that came first. Null while open.
function stepActual(step, projects){
  var byHand = step.doneAt || null;
  var targets = step.targets || [];
  var byTargets = null;
  if(targets.length){
    var latest=0, all=true;
    targets.forEach(function(t){
      var at=recordClosedAt(projects, t.id);
      if(at===null) all=false; else if(at>latest) latest=at;
    });
    if(all) byTargets=latest;
  }
  if(byHand!==null && byTargets!==null) return Math.min(byHand, byTargets);
  return byHand!==null ? byHand : byTargets;
}
function stepStatus(step, projects, now){
  var actual=stepActual(step, projects);
  if(actual!==null) return actual<=step.dueAt ? "met" : "late";
  return now>step.dueAt ? "missed" : "upcoming";
}
// A point is what goes on a line: where, what colour, and by how much it
// missed or beat its target.
function stepPoint(step, projects, now){
  var actual=stepActual(step, projects), status=stepStatus(step, projects, now);
  return { id:step.id, label:step.label, at:step.dueAt, actual:actual, status:status,
           variance: actual===null ? null : actual-step.dueAt };
}
// A tracker's current point, from the points beneath it. Outstanding points
// (missed or upcoming) decide it: the earliest sets WHERE, the worst sets the
// COLOUR. Once nothing is outstanding it rests at the last target, met.
function aggregatePoint(points){
  var open=(points||[]).filter(function(p){ return p.status==="missed" || p.status==="upcoming"; });
  if(!points || !points.length) return null;
  if(open.length){
    var at=Math.min.apply(null, open.map(function(p){ return p.at; }));
    return { at:at, status:worstStatus(open.map(function(p){ return p.status; })), open:open.length, total:points.length };
  }
  return { at:Math.max.apply(null, points.map(function(p){ return p.at; })), status:"met", open:0, total:points.length };
}
// Does anything under this record carry steps? Decides whether a record earns
// a line at all: a strip only appears where there is something to show.
function hasMilestonesBeneath(projects, id){
  var p=findProj(projects, id);
  if(!p) return false;
  if(p.milestones && p.milestones.length) return true;
  return projects.some(function(c){ return c.parentId===id && hasMilestonesBeneath(projects, c.id); });
}
// Every step anywhere beneath a record, as points. A parent shows the FULL
// extent of what is coming, not one mark per child: a lane line that collapses
// each project to its current point hides most of the future. The aggregate
// (projectCurrent / laneCurrent) is still what colours a collapsed lane and
// what the report summarises - it is a summary, not the line.
function subtreePoints(projects, id, now){
  var out=[];
  (function walk(pid){
    var p=findProj(projects, pid);
    if(p) (p.milestones||[]).forEach(function(st){
      var pt=stepPoint(st, projects, now);
      pt.ownerId=pid; pt.owner=p.name; pt.own=(pid===id);
      out.push(pt);
    });
    projects.filter(function(c){ return c.parentId===pid; }).forEach(function(c){ walk(c.id); });
  })(id);
  return out.sort(function(a,b){ return a.at-b.at; });
}
// A project's line: its own step points, plus one point per child that has
// milestones beneath it, at that child's current point.
function projectLine(projects, id, now){
  var p=findProj(projects, id);
  if(!p) return { own:[], children:[] };
  var own=(p.milestones||[]).map(function(st){ return stepPoint(st, projects, now); });
  var children=projects.filter(function(c){ return c.parentId===id && hasMilestonesBeneath(projects, c.id); })
    .map(function(c){ var cp=projectCurrent(projects, c.id, now); return cp ? Object.assign({ id:c.id, label:c.name, child:true }, cp) : null; })
    .filter(function(x){ return !!x; });
  return { own:own, children:children };
}
function projectCurrent(projects, id, now){
  return aggregatePoint(subtreePoints(projects, id, now));
}
// A lane's line: every step under every open project in it.
function laneLine(projects, lane, now){
  var out=[];
  projects.filter(function(p){ return p.lane===lane && !p.parentId && !p.closedAt; })
    .forEach(function(p){ out=out.concat(subtreePoints(projects, p.id, now)); });
  return out.sort(function(a,b){ return a.at-b.at; });
}
// The summary, not the line: what colours a collapsed lane, and what the
// report quotes. Built from every step beneath it.
function laneCurrent(projects, lane, now){ return aggregatePoint(laneLine(projects, lane, now)); }
// The board's line: every step in every lane.
function boardLine(projects, laneOrder, laneMeta, now){
  var out=[];
  (laneOrder||[]).forEach(function(k){ out=out.concat(laneLine(projects, k, now)); });
  return out.sort(function(a,b){ return a.at-b.at; });
}
// ---- laying a line out ----
// The axis spans the earliest and latest point on it, stretched to include
// now, with a little room either side. Ticks are days when the span is under
// a month and weeks past that, so a three-month line does not get ninety.
var MS_DAY = 86400000;
function lineSpan(points, now){
  // ACTUAL dates count towards the extent too, not just targets: a step
  // finished well before the earliest target fell off the left edge, and its
  // bright mark with it - leaving a lone ghost that read as still to come.
  var ats=[];
  (points||[]).forEach(function(p){ ats.push(p.at); if(p.actual!=null) ats.push(p.actual); });
  ats.push(now);
  var lo=Math.min.apply(null, ats), hi=Math.max.apply(null, ats);
  if(hi-lo < 7*MS_DAY){ var mid=(lo+hi)/2; lo=mid-3.5*MS_DAY; hi=mid+3.5*MS_DAY; }
  var pad=(hi-lo)*0.06;
  return { lo:lo-pad, hi:hi+pad };
}
// What the milestones did over a period. The line shows the shape; this is
// the account of it: what was due in the window, what was met and how late or
// early, what was missed, and what is coming next after it. Steps are matched
// to the window by their TARGET, because that is what the period was supposed
// to deliver - a step met in June against a May target belongs to May's
// report, counted late.
function milestoneReport(projects, laneOrder, from, to, now){
  var all=[];
  (laneOrder||[]).forEach(function(k){
    projects.filter(function(p){ return p.lane===k && !p.parentId; }).forEach(function(p){
      subtreePoints(projects, p.id, now).forEach(function(pt){ all.push(Object.assign({ lane:k }, pt)); });
    });
  });
  var due=all.filter(function(p){ return p.at>=from && p.at<=to; });
  var met=due.filter(function(p){ return p.status==="met"; });
  var late=due.filter(function(p){ return p.status==="late"; });
  var missed=due.filter(function(p){ return p.status==="missed"; });
  var open=due.filter(function(p){ return p.status==="upcoming"; });
  // Only steps actually met carry a variance; late ones are the interesting
  // half of that, so both slips and gains are reported separately.
  var slips=late.map(function(p){ return p.variance; });
  var gains=met.map(function(p){ return -p.variance; }).filter(function(v){ return v>0; });
  function avg(a){ return a.length ? Math.round(a.reduce(function(x,y){ return x+y; },0)/a.length) : null; }
  var ahead=all.filter(function(p){ return p.at>to && (p.status==="upcoming"||p.status==="missed"); })
               .sort(function(a,b){ return a.at-b.at; });
  return {
    due:due.length, met:met.length, late:late.length, missed:missed.length, open:open.length,
    onTimePct: (met.length+late.length)>0 ? Math.round(100*met.length/(met.length+late.length)) : null,
    worstSlip: slips.length ? Math.max.apply(null, slips) : null,
    avgSlip: avg(slips), avgGain: avg(gains),
    missedList: missed.sort(function(a,b){ return a.at-b.at; }),
    lateList: late.sort(function(a,b){ return b.variance-a.variance; }),
    next: ahead.slice(0,3), points: due.sort(function(a,b){ return a.at-b.at; })
  };
}
// ---- ZOOM --------------------------------------------------------------------
// A parent line showing every step beneath it can run for months, and at
// fit-to-width the marks crowd. Zoom steps through real units rather than an
// arbitrary scale: Fit shows everything, then a fixed window of months, weeks
// or days centred on where you are. Tapping the control steps to the next
// level and wraps; holding it snaps back to Fit.
//
// Deliberately NOT a charge-and-slide: in this app a charging fill means
// something irreversible is about to happen (Delete, Complete). Zoom is
// harmless, and borrowing the signal would blunt it.
var MS_ZOOMS = [
  { id:"fit",    label:"Fit",    ms:null },
  { id:"months", label:"3 months", ms:92*MS_DAY },
  { id:"weeks",  label:"4 weeks",  ms:28*MS_DAY },
  { id:"days",   label:"7 days",   ms:7*MS_DAY },
  // One day: the tick unit is still a day, so this level shows a single tick
  // with the hours around it - the only level where two steps on the same
  // morning and afternoon separate.
  { id:"day",    label:"1 day",    ms:MS_DAY }
];
function zoomAt(i){ return MS_ZOOMS[((i % MS_ZOOMS.length) + MS_ZOOMS.length) % MS_ZOOMS.length]; }
function nextZoom(i){ return (i+1) % MS_ZOOMS.length; }
// The span actually drawn: Fit is the whole line; any other level is a window
// of that width centred on `centre`, clamped so it never runs past the line's
// own extent (panning past the ends shows nothing and feels broken).
function zoomSpan(points, now, zoomIdx, centre){
  var full=lineSpan(points, now), z=zoomAt(zoomIdx||0);
  if(!z.ms || (full.hi-full.lo)<=z.ms) return full;
  var c = centre==null ? now : centre;
  var half=z.ms/2, lo=c-half, hi=c+half;
  if(lo<full.lo){ lo=full.lo; hi=lo+z.ms; }
  if(hi>full.hi){ hi=full.hi; lo=hi-z.ms; }
  return { lo:lo, hi:hi };
}
// How far a drag of `dx` px moves the window, in ms - and clamped to the line.
function panSpan(span, points, now, dx, widthPx){
  // No Fit special case: a Fit window is already the full extent, so the
  // clamps below put it straight back where it was. (An early-out for it was
  // dead code - the mutation test proved removing it changed nothing.)
  var full=lineSpan(points, now), w=span.hi-span.lo;
  var shift=-dx*(w/widthPx), lo=span.lo+shift, hi=span.hi+shift;
  if(lo<full.lo){ lo=full.lo; hi=lo+w; }
  if(hi>full.hi){ hi=full.hi; lo=hi-w; }
  return { lo:lo, hi:hi };
}
// The day the user's own week begins, from Work Schedule > Pay & Work Week.
// Milestone week boundaries follow it rather than an assumed Monday.
function weekStartOf(schedule){
  var pr=schedule&&schedule.payroll;
  return (pr&&pr.weekStart) || "mon";
}
function tickUnit(span){ return (span.hi-span.lo) > 31*MS_DAY ? "week" : "day"; }
// Two tick sizes at every zoom: a MINOR tick for the small unit and a MAJOR
// one for the big. What each means slides with the window, so the line always
// carries a readable amount of them rather than a solid comb or a bare rule:
//   over a month   minor = a week,  major = a month
//   a week to a month  minor = a day,   major = the week start
//   under two days     minor = an hour, major = the day
// The major tick is taller AND thicker so it reads as a boundary, not just a
// longer scratch.
var MS_HOUR = 3600000;
// ---- DRIFT: where a step was due against where it actually landed ----------
// The bright sign sits on the ACTUAL date, because that is what happened; a
// ghost is left at the target, and an arc joins them. Arc height is the
// overrun, so the worst slip is the tallest thing on the line and can be
// ranked without reading a date.
//
// Height is sqrt-compressed and CAPPED: straight proportional let a six-week
// slip eat the whole panel, and a flat cap made every long drift look alike.
// sqrt keeps a two-day drift visibly bowed while a six-week one stays inside
// the ceiling.
var DRIFT_MIN_PX = 7;      // below this, target and actual are the same mark
var DRIFT_MAX_H  = 34;     // ceiling, whatever the overrun
function arcHeight(spanPx){
  return Math.min(DRIFT_MAX_H, 9 + Math.sqrt(Math.abs(spanPx))*3.4);
}
// The arcs a line should draw, widest first so short ones sit on top rather
// than being buried, plus the headroom the tallest needs. A line with only
// small drifts asks for only a little; one with none asks for nothing at all,
// so the strip carries no fixed gap for this.
function driftArcs(points, span, widthPx, all){
  var scale = widthPx/Math.max(1, span.hi-span.lo);
  var out=(points||[]).filter(function(p){
    if(p.actual==null || (p.status!=="met" && p.status!=="late")) return false;
    if(Math.abs((p.actual-p.at)*scale) < DRIFT_MIN_PX) return false;
    // An arc is drawn whenever any PART of it falls in the window, not only
    // when its target does: a drift whose target sits just off the left edge
    // still has its arc and its bright mark on screen, and dropping it made
    // arcs wink out as you panned towards them. Off-screen ends are clipped
    // by the viewBox, which reads correctly as a line heading out of view.
    if(all) return true;
    var a=Math.min(p.at, p.actual), b=Math.max(p.at, p.actual);
    return b>=span.lo && a<=span.hi;
  }).map(function(p){
    var x=(p.at-span.lo)*scale, ax=(p.actual-span.lo)*scale;
    return { id:p.id, status:p.status, x:x, ax:ax, h:arcHeight(ax-x), late:p.actual>p.at };
  });
  out.sort(function(a,b){ return Math.abs(b.ax-b.x)-Math.abs(a.ax-a.x); });
  return out;
}
// The room the tallest arc needs: its peak plus the 9px it starts above the
// axis. A quadratic peaks at half its control offset, so the drawn control is
// 2h and the peak is h - reserve exactly that and nothing clips.
function driftHeadroom(arcs){
  if(!arcs || !arcs.length) return 0;
  return arcs.reduce(function(m,a){ return Math.max(m, a.h); }, 0) + 9;
}
function tickScale(span){
  var w=span.hi-span.lo;
  if(w > 31*MS_DAY)  return { minor:"week", major:"month" };
  if(w > 2*MS_DAY)   return { minor:"day",  major:"week"  };
  return { minor:"hour", major:"day" };
}
// Every minor tick in the window, each flagged as major or not. weekStart is
// the day the user's own pay week begins, so the week boundaries on the line
// land where their week actually starts - not on an assumed Monday.
function lineTicks(span, weekStart){
  var sc=tickScale(span), out=[];
  var step = sc.minor==="hour" ? MS_HOUR : sc.minor==="day" ? MS_DAY : 7*MS_DAY;
  var c=new Date(span.lo);
  if(sc.minor==="hour") c.setMinutes(0,0,0);
  else { c.setHours(0,0,0,0); if(sc.minor==="week") c=startOfWeek(c, weekStart); }
  // Guard: a window of months at hour steps would be tens of thousands of
  // ticks. The scale above cannot produce that, but a bad span could.
  var guard=0;
  for(var t=c.getTime(); t<=span.hi && guard<2000; t+=step, guard++){
    if(t<span.lo) continue;
    var d=new Date(t), major;
    if(sc.major==="month") major = d.getDate()<=7;                       // first week of a month
    else if(sc.major==="week") major = startOfWeek(d, weekStart).getTime()===new Date(t).setHours(0,0,0,0);
    else major = d.getHours()===0;
    out.push({ at:t, major:!!major });
  }
  return out;
}
// Marks that would land within `minPx` of each other share one signpost.
// Each group keeps every member, so the dots above it can show every colour,
// and the sign itself takes the worst.
function groupMarks(points, span, widthPx, minPx){
  var scale = widthPx/(span.hi-span.lo);
  var sorted=(points||[]).slice().sort(function(a,b){ return a.at-b.at; });
  var groups=[];
  sorted.forEach(function(p){
    var x=(p.at-span.lo)*scale;
    var g=groups.length ? groups[groups.length-1] : null;
    if(g && x-g.x < minPx){ g.members.push(p); g.status=worstStatus(g.members.map(function(m){ return m.status; })); }
    else groups.push({ x:x, at:p.at, members:[p], status:p.status });
  });
  return groups;
}

// ---- THE MILESTONE LINE ------------------------------------------------------
// One drawing, used everywhere a milestone line appears: the strips on the
// board and in the outline, the editor, the lane view, the report. Marks only,
// placed by date. Ticks stand ABOVE the line, taller every week; off days are
// shaded from the work schedule; the axis is tinted up to now, with the now
// marker below. Own steps and rolled-up children use the SAME signpost. Marks
// that share a day become one signpost in the worst colour with a dot per
// member above it - no count badges anywhere.
var MS_STATUS_COLOR = function(status){
  return { met:S.msMet, late:S.msLate, missed:S.msMissed, upcoming:S.msUpcoming }[status] || S.msUpcoming;
};
// Which weekdays (0=Sun..6=Sat) the schedule has off.
function offDaysOf(schedule){
  var map={ sun:0, mon:1, tue:2, wed:3, thu:4, fri:5, sat:6 }, out=[];
  DAY_KEYS.forEach(function(k){ if(schedule && schedule[k] && schedule[k].on===false) out.push(map[k]); });
  return out;
}
function MilestoneLine(props){
  var points=props.points||[], now=props.now||Date.now(), width=props.width||320;
  var labels=!!props.labels, offDays=props.offDays||[];
  var bar = !!props.fullSpan;
  var left=10, right=10, w=width-left-right;
  // Drift arcs are measured FIRST, because the line grows by exactly what the
  // tallest one needs and by nothing when there are none: a couple of short
  // moves barely lift it, a six-week slip lifts it to the ceiling.
  var drawSpan = props.span || lineSpan(points, now);
  var arcs = props.drift===false ? [] : driftArcs(points, drawSpan, w);
  // Headroom is measured over EVERY drift at this zoom, not just the ones on
  // screen, so the line keeps one height while you pan and does not jump each
  // time an arc scrolls in or out. It still changes between zoom LEVELS,
  // because the arcs themselves genuinely change size there.
  var head = props.drift===false ? 0 : Math.round(driftHeadroom(
    driftArcs(points, { lo:drawSpan.lo, hi:drawSpan.hi }, w, true)));
  var H = (labels ? 58 : 34) + (bar?6:0) + head, axisY = (labels ? 34 : 26) + head;
  // The caller may hand in a zoomed and panned window; without one, Fit.
  var span=props.span || lineSpan(points, now), unit=tickUnit(span), scale=w/(span.hi-span.lo);
  var xOf=function(t){ return left+(t-span.lo)*scale; };
  var kids=[];
  // off-day bands, one per calendar day in the span
  if(offDays.length){
    var d=new Date(span.lo); d.setHours(0,0,0,0);
    for(var t=d.getTime(); t<span.hi; t+=MS_DAY){
      if(offDays.indexOf(new Date(t).getDay())>=0){
        var x0=Math.max(left, xOf(t)), x1=Math.min(left+w, xOf(t+MS_DAY));
        if(x1>x0) kids.push(React.createElement("rect", { key:"off"+t, x:x0, y:axisY-22, width:x1-x0, height:22, fill:S.msOffDay }));
      }
    }
  }
  kids.push(React.createElement("line", { key:"axis", x1:left, y1:axisY, x2:left+w, y2:axisY, stroke:S.border, strokeWidth:2 }));
  var nowX=Math.max(left, Math.min(left+w, xOf(now)));
  kids.push(React.createElement("line", { key:"elapsed", x1:left, y1:axisY, x2:nowX, y2:axisY, stroke:S.textDim, strokeWidth:2 }));
  // Ticks: a short minor one for the small unit and a taller, thicker major
  // for the boundary. What each unit IS slides with the window (see
  // tickScale), and the week boundary follows the user's own pay week.
  lineTicks(span, props.weekStart||"mon").forEach(function(k){
    var x=xOf(k.at);
    kids.push(React.createElement("line", { key:"tk"+k.at, "data-tick":k.major?"major":"minor",
      x1:x, y1:axisY, x2:x, y2:axisY-(k.major?8:3),
      stroke:k.major?S.textMuted:S.border, strokeWidth:k.major?2:1 }));
  });
  // The arcs, drawn before the marks so a sign always sits on top of them.
  // Widest first (driftArcs sorts), so a short arc is never buried.
  arcs.forEach(function(a){
    var x=left+a.x, ax=left+a.ax, mid=(x+ax)/2, c=MS_STATUS_COLOR(a.status);
    kids.push(React.createElement("path", { key:"arc"+a.id, "data-driftarc":a.id,
      d:"M"+x+" "+(axisY-9)+"Q"+mid+" "+(axisY-9-a.h*2)+" "+ax+" "+(axisY-9),
      fill:"none", stroke:c, strokeWidth:1.5, strokeDasharray:"3 3", opacity:0.72 }));
    // The ghost: where it was DUE. Hollow head, dashed post, so the bright
    // sign at the actual date is unmistakably the thing that happened.
    kids.push(React.createElement("g", { key:"gh"+a.id, "data-driftghost":a.id, opacity:0.42 },
      React.createElement("line", { x1:x, y1:axisY, x2:x, y2:axisY-8, stroke:c, strokeWidth:2.1,
        strokeLinecap:"round", strokeDasharray:"2.5 2.5" }),
      React.createElement("path", { d:"M"+x+" "+(axisY-8)+"L"+(x+4.4)+" "+(axisY-12.4)+"L"+x+" "+(axisY-16.8)+"L"+(x-4.4)+" "+(axisY-12.4)+"Z",
        stroke:c, strokeWidth:2.1, strokeLinejoin:"round", fill:"none" })));
  });
  // marks
  // Only what is inside the window: groupMarks places by date, so a mark
  // outside it would be drawn off the end of the axis.
  // Placed on the date that HAPPENED where there is one: a met or late step
  // belongs on its actual date, with the ghost above marking the target. A
  // missed or upcoming step has no actual, so it stays on its target.
  var visible=points.filter(function(p){ return p.at>=span.lo && p.at<=span.hi; })
    .map(function(p){
      var real = (p.actual!=null && (p.status==="met"||p.status==="late")) ? p.actual : p.at;
      return (real===p.at) ? p : Object.assign({}, p, { at:real });
    })
    .filter(function(p){ return p.at>=span.lo && p.at<=span.hi; });
  var groups=groupMarks(visible, span, w, 10);
  groups.forEach(function(g, i){
    var x=left+g.x, c=MS_STATUS_COLOR(g.status), filled=g.status!=="upcoming";
    kids.push(React.createElement("g", { key:"m"+i, "data-msmark":g.members.map(function(m){ return m.id; }).join(","), "data-msstatus":g.status },
      React.createElement("line", { x1:x, y1:axisY, x2:x, y2:axisY-8, stroke:c, strokeWidth:2.1, strokeLinecap:"round" }),
      React.createElement("path", { d:"M"+x+" "+(axisY-8)+"L"+(x+4.4)+" "+(axisY-12.4)+"L"+x+" "+(axisY-16.8)+"L"+(x-4.4)+" "+(axisY-12.4)+"Z",
        stroke:c, strokeWidth:2.1, strokeLinejoin:"round", fill:filled?c:S.bg1 }),
      g.members.length>1 ? g.members.map(function(m, k){
        return React.createElement("circle", { key:k, cx:x+8+k*5, cy:axisY-21, r:2, fill:MS_STATUS_COLOR(m.status) });
      }) : null,
      labels ? React.createElement("text", { x:x, y:axisY+16, fill:S.textDim, fontSize:8, fontWeight:600,
        textAnchor:"middle", fontFamily:S.fontBody }, g.members.length>1 ? (g.members[0].label+" +"+(g.members.length-1)) : g.members[0].label) : null
    ));
  });
  kids.push(React.createElement("path", { key:"now", "data-msnow":true, d:"M"+(nowX-4.5)+" "+(axisY+8)+"L"+nowX+" "+(axisY+2)+"L"+(nowX+4.5)+" "+(axisY+8)+"Z", fill:S.text }));
  // Two signals that the line runs past what is shown, and only when it does:
  // the edges FADE, so the line visibly continues; and a scrollbar says where
  // this window sits in the whole and how much of it you are seeing. The fade
  // alone reads as decoration; the bar alone does not show continuation.
  var full=props.fullSpan;
  if(full && (full.hi-full.lo) > (span.hi-span.lo)+1){
    var fid="msfade"+Math.round(width);
    kids.push(React.createElement("defs", { key:"defs" },
      React.createElement("linearGradient", { id:fid+"l" },
        React.createElement("stop", { offset:"0", stopColor:S.bg1 }),
        React.createElement("stop", { offset:"1", stopColor:S.bg1, stopOpacity:0 })),
      React.createElement("linearGradient", { id:fid+"r" },
        React.createElement("stop", { offset:"0", stopColor:S.bg1, stopOpacity:0 }),
        React.createElement("stop", { offset:"1", stopColor:S.bg1 }))));
    var fadeW=Math.min(26, w*0.12);
    kids.push(React.createElement("rect", { key:"fl", x:left, y:0, width:fadeW, height:axisY+2, fill:"url(#"+fid+"l)" }));
    kids.push(React.createElement("rect", { key:"fr", x:left+w-fadeW, y:0, width:fadeW, height:axisY+2, fill:"url(#"+fid+"r)" }));
    // The bar: its width is the share of the line in view, its position where.
    var fw=full.hi-full.lo;
    var thumbW=Math.max(16, w*((span.hi-span.lo)/fw));
    var thumbX=left+(w-thumbW)*Math.max(0, Math.min(1, (span.lo-full.lo)/Math.max(1, fw-(span.hi-span.lo))));
    kids.push(React.createElement("rect", { key:"track", x:left, y:H-4, width:w, height:3, rx:1.5, fill:S.border }));
    kids.push(React.createElement("rect", { key:"thumb", "data-msthumb":Math.round(thumbW), x:thumbX, y:H-4, width:thumbW, height:3, rx:1.5, fill:S.infoText }));
  }
  return React.createElement("svg", { width:"100%", height:H, viewBox:"0 0 "+width+" "+H, preserveAspectRatio:"none",
    style:{display:"block"}, "data-msline":points.length }, kids);
}

// ---- MILESTONE EDITORS -------------------------------------------------------
// The project editor: the line at full width with labels, then the steps as
// rows; tap a row for its sheet. Steps are drafted here and written on Save,
// so a wrong edit can be Cancelled like anything else.
function fmtMsWhen(ms){
  var d=new Date(ms);
  return d.toLocaleDateString(undefined,{month:"short",day:"numeric"})+" \u00b7 "+
    d.toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"});
}
// "late by 1d 3h", "met, 2h early", "missed", "in 5 days"
function fmtMsStanding(pt, now){
  if(pt.status==="met"){ var e=-(pt.variance||0); return e>0 ? "met, "+fmtDur(e,true)+" early" : "met"; }
  if(pt.status==="late") return "late by "+fmtDur(pt.variance,true);
  if(pt.status==="missed") return "missed";
  var ahead=pt.at-now; return "in "+fmtDur(ahead,true);
}
function toDateInput(ms){ var d=new Date(ms); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function toTimeInput(ms){ var d=new Date(ms); return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0"); }

function MilestoneStepModal(props){
  var step=props.step, records=props.records||[], onSave=props.onSave, onDelete=props.onDelete, onCancel=props.onCancel;
  var isNew=!step.id;
  var labelS=useState(step.label||""); var setLabel=labelS[1]; var label=labelS[0];
  var dateS=useState(toDateInput(step.dueAt||Date.now())); var setDate=dateS[1]; var date=dateS[0];
  var timeS=useState(toTimeInput(step.dueAt||Date.now())); var setTime=timeS[1]; var time=timeS[0];
  var tgtS=useState((step.targets||[]).map(function(t){ return t.id; })); var setTgt=tgtS[1]; var tgt=tgtS[0];
  var doneS=useState(step.doneAt||null); var setDone=doneS[1]; var done=doneS[0];
  var noteS=useState(step.note||""); var setNote=noteS[1]; var note=noteS[0];
  // Holding the mark opens a sheet to set WHEN it was met. A mark made after
  // the fact would otherwise record the tap, not the moment, and turn an
  // on-time step amber for no reason.
  var whenS=useState(null); var setWhen=whenS[1]; var when=whenS[0];

  var dueAt=joinDateTime(date, time);
  var ok=label.trim() && dueAt!==null;
  function submit(){
    if(!ok) return;
    onSave(Object.assign({}, step, { id:step.id||uid(), label:label.trim(), dueAt:dueAt,
      targets:tgt.map(function(id){ return { kind:"project", id:id }; }), doneAt:done, note:note.trim() }));
  }
  // A hand mark, for expectations the app cannot see. Whichever comes first -
  // the mark or the last target closing - is the actual. It rides in the
  // sheet's sticky box, its own row above Save / Cancel / Delete, so the
  // buttons a step is worked with are never scrolled out of reach - and it is
  // never next to Delete.
  var markBtn=React.createElement(HoldButton, { attrs:{ "data-msmarkmet":true }, fill:rgba(S.actionBdr,0.38),
    onTap:function(){ setDone(done?null:Date.now()); },
    onHold:function(){ setWhen({ date:toDateInput(done||Date.now()), time:toTimeInput(done||Date.now()) }); },
    style:{width:"100%",background:done?S.infoBg:S.bg1,border:"2px solid "+(done?S.actionBdr:S.border),
           borderRadius:S.radius,padding:"0.85rem",color:done?S.infoText:S.textDim,
           fontFamily:S.fontBody,fontWeight:700,fontSize:MODAL_BTN_FONT} },
    React.createElement("span", { style:{display:"block"} }, done ? "Marked met "+fmtMsWhen(done) : "Mark met now"),
    React.createElement("span", { style:{display:"block",fontSize:"0.68rem",fontWeight:600,opacity:0.75,marginTop:"0.15rem"} },
      done ? "tap to unmark \u00b7 hold to change when" : "hold to set when it was met"));
  return React.createElement(React.Fragment, null,
    React.createElement(Modal, { actions:[
      React.createElement("div", { key:"col", style:{display:"flex",flexDirection:"column",gap:"0.5rem",flex:1} },
        markBtn,
        React.createElement("div", { style:{display:"flex",gap:"0.6rem",flexDirection:ACTION_DIR()} },
          React.createElement("button", { "data-mssave":true, onClick:submit, disabled:!ok,
          style:Object.assign({}, MODAL_SAVE(), ok?null:{opacity:0.5,cursor:"default"}) }, "Save"),
        React.createElement("button", { onClick:onCancel, style:MODAL_CANCEL() }, "Cancel"),
        !isNew && React.createElement(HoldButton, { onHold:function(){ onDelete(step.id); }, holdMs:HOLD_DELETE_MS, fill:rgba(S.dangerText,0.38),
          attrs:{ "data-msdelete":true, "data-holddelete":true },
          style:{flex:"0 0 auto",background:S.dangerBg,border:"1px solid "+S.dangerText,borderRadius:S.radius,
                 padding:"0.85rem 0.9rem",color:S.dangerText,fontFamily:S.fontBody,
                 fontWeight:700,fontSize:MODAL_BTN_FONT} }, "Delete")))],
      title:isNew?"New Step":"Step \u00b7 "+(step.label||""), onClose:onCancel, ownActions:true },
    React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.9rem"} },
      React.createElement("div", null,
        React.createElement("label", { style:LABEL_STYLE }, "Label"),
        React.createElement("input", { "data-mslabel":true, value:label, onChange:function(e){ setLabel(e.target.value); },
          placeholder:"What is reached at this point", style:INPUT_STYLE })),
      React.createElement("div", null,
        React.createElement("label", { style:LABEL_STYLE }, "Due"),
        React.createElement("div", { style:{display:"flex",gap:"0.5rem"} },
          // minWidth:0 - date and time inputs carry a large intrinsic minimum
          // that flex cannot shrink past, and the row ran off the sheet.
          React.createElement("input", { "data-msdate":true, type:"date", value:date, onChange:function(e){ setDate(e.target.value); }, style:Object.assign({},INPUT_STYLE,{flex:1.4,minWidth:0}) }),
          React.createElement("input", { "data-mstime":true, type:"time", value:time, onChange:function(e){ setTime(e.target.value); }, style:Object.assign({},INPUT_STYLE,{flex:1,minWidth:0}) }))),
      // The expectation: which records under this project should be closed
      // out by then. The step becomes actual when the last of them closes.
      records.length>0 && React.createElement("div", null,
        React.createElement("label", { style:LABEL_STYLE }, "Expects these closed out"),
        React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.3rem"} },
          records.map(function(r){
            var on=tgt.indexOf(r.id)>=0;
            return React.createElement("button", { key:r.id, "data-mstarget":r.id,
              onClick:function(){ setTgt(on ? tgt.filter(function(x){ return x!==r.id; }) : tgt.concat([r.id])); },
              style:{display:"flex",alignItems:"center",gap:"0.5rem",textAlign:"left",width:"100%",
                     background:on?S.infoBg:S.bg1,border:"1px solid "+(on?S.actionBdr:S.border),
                     borderRadius:S.radius3,padding:"0.55rem 0.7rem",color:S.text,cursor:"pointer",
                     fontFamily:S.fontBody,fontWeight:600,fontSize:"0.84rem"} },
              React.createElement(MenuIcon, { name:projRole(r)==="task"?"task":"project", size:16, col:on?S.infoText:S.chromeText }),
              React.createElement("span", { style:{flex:1} }, r.name),
              r.closedAt ? React.createElement("span", { style:{fontSize:"0.7rem",color:S.msMet,fontWeight:700} }, "closed") : null);
          }))),
      React.createElement("div", null,
        React.createElement("label", { style:LABEL_STYLE }, "Notes"),
        React.createElement("textarea", { "data-msnote":true, value:note, onChange:function(e){ setNote(e.target.value); },
          rows:3, placeholder:"Anything worth knowing about this point",
          style:Object.assign({},INPUT_STYLE,{resize:"vertical",minHeight:"4.2rem"}) })))),
    // A sibling of the step sheet, never inside it.
    when && React.createElement(MilestoneWhenModal, { when:when,
      onSave:function(ms){ setDone(ms); setWhen(null); }, onCancel:function(){ setWhen(null); } }));
}
// When was it met? Date and time, defaulting to the existing mark or now.
function MilestoneWhenModal(props){
  var dS=useState(props.when.date); var setD=dS[1]; var d=dS[0];
  var tS=useState(props.when.time); var setT=tS[1]; var t=tS[0];
  var ms=joinDateTime(d, t), ok=ms!==null && ms<=Date.now()+60000;
  return React.createElement(Modal, { actions:[React.createElement("button", { key:"a0", "data-mswhensave":true, onClick:function(){ if(ok) props.onSave(ms); }, disabled:!ok,
          style:Object.assign({}, MODAL_SAVE(), ok?null:{opacity:0.5,cursor:"default"}) }, "Save"),
        React.createElement("button", { key:"a1", onClick:props.onCancel, style:MODAL_CANCEL() }, "Cancel")], title:"When was it met?", onClose:props.onCancel, ownActions:true },
    React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.9rem"} },
      React.createElement("div", { style:{fontSize:"0.8rem",color:S.textDim,lineHeight:1.4} },
        "Set the moment it was actually reached - not when you got round to marking it."),
      React.createElement("div", { style:{display:"flex",gap:"0.5rem"} },
        React.createElement("input", { "data-mswhendate":true, type:"date", value:d, onChange:function(e){ setD(e.target.value); }, style:Object.assign({},INPUT_STYLE,{flex:1.4,minWidth:0}) }),
        React.createElement("input", { "data-mswhentime":true, type:"time", value:t, onChange:function(e){ setT(e.target.value); }, style:Object.assign({},INPUT_STYLE,{flex:1,minWidth:0}) })),
      !ok && ms!==null && React.createElement("div", { style:{fontSize:"0.76rem",color:S.warnText} }, "That is in the future. A mark records something that has happened.")));
}

function MilestoneEditModal(props){
  var proj=props.project, projects=props.projects||[], onSave=props.onSave, onClose=props.onClose;
  var now=props.now||Date.now(), offDays=props.offDays||[];
  var stepsS=useState(function(){ return (proj.milestones||[]).slice(); }); var setSteps=stepsS[1]; var steps=stepsS[0];
  var editS=useState(null); var setEdit=editS[1]; var edit=editS[0];   // a step being edited, or {} for new
  // Drafted steps are scored against the live projects, so the line and the
  // standings update as they are edited.
  var draftProj=Object.assign({}, proj, { milestones:steps });
  var scored=projects.map(function(p){ return p.id===proj.id ? draftProj : p; });
  var line=projectLine(scored, proj.id, now);            // own steps drive the rows
  var points=subtreePoints(scored, proj.id, now);        // the line shows everything beneath
  // Records a step may expect: everything beneath this project.
  var beneath=[];
  (function walk(pid){ projects.filter(function(c){ return c.parentId===pid; }).forEach(function(c){ beneath.push(c); walk(c.id); }); })(proj.id);
  function stepRow(pt, st){
    var c=MS_STATUS_COLOR(pt.status);
    return React.createElement("button", { key:st.id, "data-msstep":st.id, onClick:function(){ setEdit(st); },
      style:{display:"flex",alignItems:"center",gap:"0.6rem",width:"100%",textAlign:"left",
             background:S.bg1,border:"1px solid "+S.border,borderRadius:S.radius3,padding:"0.6rem 0.7rem",
             cursor:"pointer",fontFamily:S.fontBody} },
      React.createElement("svg", { width:16, height:22, viewBox:"0 0 16 22" },
        React.createElement("line", { x1:8, y1:21, x2:8, y2:13, stroke:c, strokeWidth:2.1, strokeLinecap:"round" }),
        React.createElement("path", { d:"M8 13L12.4 8.6L8 4.2L3.6 8.6Z", stroke:c, strokeWidth:2.1, strokeLinejoin:"round", fill:pt.status==="upcoming"?S.bg1:c })),
      React.createElement("span", { style:{flex:1,minWidth:0} },
        React.createElement("span", { style:{display:"block",color:S.text,fontWeight:700,fontSize:"0.9rem"} }, st.label),
        React.createElement("span", { style:{display:"block",color:S.textDim,fontSize:"0.72rem",marginTop:"0.1rem"} },
          fmtMsWhen(st.dueAt)+"  \u00b7  "+fmtMsStanding(pt, now)),
        st.note ? React.createElement("span", { style:{display:"block",color:S.textMuted,fontSize:"0.7rem",marginTop:"0.15rem",
          whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"} }, st.note) : null),
      React.createElement("span", { style:{color:S.textMuted,fontSize:"1.1rem",fontWeight:700} }, "\u203a"));
  }
  return React.createElement(React.Fragment, null,
    React.createElement(Modal, { actions:[React.createElement("button", { key:"a0", "data-mssaveall":true, onClick:function(){ onSave(proj.id, steps); }, style:MODAL_SAVE() }, "Save"),
          React.createElement("button", { key:"a1", onClick:onClose, style:MODAL_CANCEL() }, "Cancel")], title:"Milestones \u00b7 "+proj.name, onClose:onClose, wide:true, ownActions:true },
      React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.6rem"} },
        points.length>0 && React.createElement("div", { style:{background:S.bg1,border:"1px solid "+S.border,borderRadius:S.radius3,padding:"0.4rem 0.3rem 0"} },
          React.createElement(MilestoneLine, { weekStart:(props.weekStart||"mon"), points:points, now:now, width:420, labels:true, offDays:offDays })),
        // Rows in the order the line shows them, not the order they were typed.
        line.own.slice().sort(function(a,b){ return a.at-b.at; })
          .map(function(pt){ var st=steps.filter(function(x){ return x.id===pt.id; })[0]; return st ? stepRow(pt, st) : null; }),
        line.children.length>0 && React.createElement("div", { style:{fontSize:"0.72rem",color:S.textMuted,padding:"0.2rem 0.3rem"} },
          line.children.length+" nested project"+(line.children.length!==1?"s":"")+" with milestones roll up onto this line"),
        React.createElement("button", { "data-msadd":true, onClick:function(){ setEdit({}); },
          style:{width:"100%",background:"none",border:"1px solid "+S.border,borderRadius:S.radius3,
                 padding:"0.7rem",color:S.infoText,cursor:"pointer",fontFamily:S.fontBody,fontWeight:700,fontSize:"0.9rem"} },
          "+ Add step"))),
    edit && React.createElement(MilestoneStepModal, { step:edit, records:beneath,
      onSave:function(st){ setSteps(function(prev){ var i=prev.findIndex(function(x){ return x.id===st.id; });
        return i>=0 ? prev.map(function(x){ return x.id===st.id ? st : x; }) : prev.concat([st]); }); setEdit(null); },
      onDelete:function(id){ setSteps(function(prev){ return prev.filter(function(x){ return x.id!==id; }); }); setEdit(null); },
      onCancel:function(){ setEdit(null); } }));
}

// The lane view. A lane owns no steps: its line is its projects at their
// current points, and each row opens that project's editor. Done, not Save -
// there is nothing here to save.
function LaneMilestonesModal(props){
  var lane=props.lane, laneMeta=props.laneMeta, projects=props.projects||[], now=props.now||Date.now();
  var onOpenProject=props.onOpenProject, onClose=props.onClose, offDays=props.offDays||[];
  var meta=getMeta(laneMeta, lane);
  var points=laneLine(projects, lane, now);
  var tops=projects.filter(function(p){ return p.lane===lane && !p.parentId && !p.closedAt && projRole(p)==="project"; });
  return React.createElement(Modal, { actions:[React.createElement("button", { key:"a0", onClick:onClose, style:MODAL_SAVE() }, "Done")], title:"Milestones \u00b7 "+meta.label, onClose:onClose, wide:true, ownActions:true },
    React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.6rem"} },
      React.createElement("div", { style:{fontSize:"0.72rem",color:S.textMuted} },
        "Lanes own no steps. Each mark is a project at its current point."),
      points.length>0 && React.createElement("div", { style:{background:S.bg1,border:"1px solid "+S.border,borderRadius:S.radius3,padding:"0.4rem 0.3rem 0"} },
        React.createElement(MilestoneLine, { weekStart:(props.weekStart||"mon"), points:points, now:now, width:420, labels:true, offDays:offDays })),
      tops.map(function(p){
        var cp=projectCurrent(projects, p.id, now), c=cp?MS_STATUS_COLOR(cp.status):S.textMuted;
        var sub = !cp ? "no milestones yet \u00b7 tap to add"
          : cp.open===0 ? "all "+cp.total+" met"
          : cp.open+" of "+cp.total+" open \u00b7 "+(cp.status==="missed" ? "one missed" : "next "+fmtMsWhen(cp.at));
        return React.createElement("button", { key:p.id, "data-mslaneproj":p.id, onClick:function(){ onOpenProject(p); },
          style:{display:"flex",alignItems:"center",gap:"0.6rem",width:"100%",textAlign:"left",
                 background:S.bg1,border:"1px solid "+S.border,borderRadius:S.radius3,padding:"0.6rem 0.7rem",
                 cursor:"pointer",fontFamily:S.fontBody,opacity:cp?1:0.7} },
          React.createElement("svg", { width:16, height:22, viewBox:"0 0 16 22" },
            React.createElement("line", { x1:8, y1:21, x2:8, y2:13, stroke:c, strokeWidth:2.1, strokeLinecap:"round" }),
            React.createElement("path", { d:"M8 13L12.4 8.6L8 4.2L3.6 8.6Z", stroke:c, strokeWidth:2.1, strokeLinejoin:"round", fill:(cp&&cp.status!=="upcoming")?c:S.bg1 })),
          React.createElement("span", { style:{flex:1,minWidth:0} },
            React.createElement("span", { style:{display:"block",color:cp?S.text:S.textMuted,fontWeight:700,fontSize:"0.9rem"} }, p.name),
            React.createElement("span", { style:{display:"block",color:S.textDim,fontSize:"0.72rem",marginTop:"0.1rem"} }, sub)),
          React.createElement("span", { style:{color:S.textMuted,fontSize:"1.1rem",fontWeight:700} }, "\u203a"));
      })));
}

// The board view. One level above the lanes: its line is each lane at its
// current point, and each row opens that lane's view. Done, not Save.
function BoardMilestonesModal(props){
  var laneOrder=props.laneOrder||[], laneMeta=props.laneMeta, projects=props.projects||[], now=props.now||Date.now();
  var onOpenLane=props.onOpenLane, onClose=props.onClose, offDays=props.offDays||[];
  var points=boardLine(projects, laneOrder, laneMeta, now);
  return React.createElement(Modal, { actions:[React.createElement("button", { key:"a0", onClick:onClose, style:MODAL_SAVE() }, "Done")], title:"Milestones \u00b7 Board", onClose:onClose, wide:true, ownActions:true },
    React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.6rem"} },
      React.createElement("div", { style:{fontSize:"0.72rem",color:S.textMuted} },
        "Each mark is a lane at its current point. Lanes roll up from their projects."),
      points.length>0 && React.createElement("div", { style:{background:S.bg1,border:"1px solid "+S.border,borderRadius:S.radius3,padding:"0.4rem 0.3rem 0"} },
        React.createElement(MilestoneLine, { weekStart:(props.weekStart||"mon"), points:points, now:now, width:420, labels:true, offDays:offDays })),
      laneOrder.map(function(k){
        var meta=getMeta(laneMeta,k), cp=laneCurrent(projects, k, now), c=cp?MS_STATUS_COLOR(cp.status):S.textMuted;
        var sub = !cp ? "no milestones in this lane"
          : cp.open===0 ? "all met" : cp.open+" open \u00b7 "+(cp.status==="missed" ? "one missed" : "next "+fmtMsWhen(cp.at));
        return React.createElement("button", { key:k, "data-msboardlane":k, onClick:function(){ onOpenLane(k); },
          style:{display:"flex",alignItems:"center",gap:"0.6rem",width:"100%",textAlign:"left",
                 background:S.bg1,border:"1px solid "+(cp?meta.accent:S.border),borderRadius:S.radius3,padding:"0.6rem 0.7rem",
                 cursor:"pointer",fontFamily:S.fontBody,opacity:cp?1:0.6} },
          React.createElement(MenuIcon, { name:"lanes", size:18, col:meta.accent }),
          React.createElement("span", { style:{flex:1,minWidth:0} },
            React.createElement("span", { style:{display:"block",color:meta.accent,fontWeight:700,fontSize:"0.88rem",letterSpacing:"0.06em",textTransform:"uppercase"} }, meta.label),
            React.createElement("span", { style:{display:"block",color:S.textDim,fontSize:"0.72rem",marginTop:"0.1rem"} }, sub)),
          cp && React.createElement("span", { style:{width:"10px",height:"10px",borderRadius:"50%",background:c,flexShrink:0} }),
          React.createElement("span", { style:{color:S.textMuted,fontSize:"1.1rem",fontWeight:700} }, "\u203a"));
      })));
}

// ---- THE MILESTONE STRIP -----------------------------------------------------
// The line, as it sits under a component on the board and in the outline: no
// labels, tap to open. One component for lane, project and board so the three
// cannot drift; what differs is only the points handed in and what a tap opens.
function MilestoneStrip(props){
  var points=props.points||[], now=props.now||Date.now(), width=props.width||360;
  var zoomS=useState(0); var setZoom=zoomS[1]; var zoom=zoomS[0];
  var spanS=useState(null); var setSpan=spanS[1]; var span=spanS[0];
  var drag=useRef(null);
  var shown = span || zoomSpan(points, now, zoom, null);
  function step(){ var z=nextZoom(zoom); setZoom(z); setSpan(zoomSpan(points, now, z, (shown.lo+shown.hi)/2)); haptic(8); }
  function toFit(){ setZoom(0); setSpan(null); haptic(12); }
  var zoomed = zoom!==0;
  // The line pans by dragging it, but only when zoomed in: at Fit there is
  // nowhere to go, and a vertically scrolling page should not swallow a
  // horizontal drag it cannot use. A drag that never moved is a tap.
  var panHandlers = zoomed ? {
    onPointerDown:function(e){ drag.current={ x:e.clientX, span:shown, moved:false }; },
    onPointerMove:function(e){
      if(!drag.current) return;
      var dx=e.clientX-drag.current.x;
      if(Math.abs(dx)>4){ drag.current.moved=true; setSpan(panSpan(drag.current.span, points, now, dx, width)); }
    },
    onPointerUp:function(){ var d=drag.current; drag.current=null; if(d && !d.moved && props.onOpen) props.onOpen(); },
    onPointerCancel:function(){ drag.current=null; },
    onPointerLeave:function(){ drag.current=null; }
  } : { onClick:props.onOpen };
  if(!points.length) return null;
  return React.createElement("div", { "data-msstrip":props.kind,
    style:{display:"flex",alignItems:"stretch",gap:"0.3rem",background:S.bg1,
           border:"1px solid "+S.border,borderRadius:S.radius3,padding:"0.15rem 0.2rem 0",
           marginTop:props.tight?"0.35rem":"0.5rem"} },
    React.createElement("div", Object.assign({ "data-mspan":true,
      style:{flex:1,minWidth:0,cursor:zoomed?"grab":"pointer",touchAction:zoomed?"pan-y":"auto"} }, panHandlers),
      React.createElement(MilestoneLine, { weekStart:(props.weekStart||"mon"), points:points, now:now, width:width, span:shown,
        fullSpan: zoomed ? lineSpan(points, now) : null,
        labels:false, offDays:props.offDays||[] })),
    // The zoom control LAST, so it sits at the trailing edge: the right for a
    // right-hander, and the root's dir="rtl" moves it to the left for a
    // left-hander - the thumb edge either way. The strip sets no
    // flexDirection of its own: the root already mirrors this row, and doing
    // it here too cancelled out and put the control left of the line for BOTH
    // hands. Tap steps the level and wraps; hold snaps back to Fit.
    React.createElement(HoldButton, { onTap:step, onHold:toFit, holdMs:HOLD_DELETE_MS, fill:rgba(S.actionBdr,0.3),
      attrs:{ "data-mszoom":zoomAt(zoom).id, "aria-label":"Zoom: "+zoomAt(zoom).label },
      style:{flex:"0 0 auto",alignSelf:"center",display:"flex",alignItems:"center",
             background:S.infoBg,border:"1px solid "+S.actionBdr,
             borderRadius:S.radius3,padding:"0.2rem 0.4rem",color:S.infoText,
             fontFamily:S.fontBody,fontWeight:700,fontSize:"0.6rem",letterSpacing:"0.04em",whiteSpace:"nowrap"} },
      // dir="ltr": the root is rtl for a left-hander, which reverses the words
      // inside the label - "3 months" came out as "months 3". The control's
      // PLACEMENT should mirror; its text should not.
      React.createElement("span", { dir:"ltr" }, zoomAt(zoom).label)));
}

// ---- THE OUTLINE -------------------------------------------------------------
// One list holding lanes, the projects and tasks inside them, and the stages
// hanging off those. Position and indent together say where a row belongs: a
// row's parent is the nearest row above it with a smaller indent. That is the
// entire model. There is no separate parent field kept alongside, so a move
// cannot leave position and parentage disagreeing with each other.
//
// The drag is free; the drop is checked. The hierarchy is typed - a lane
// cannot sit inside a project, a stage cannot hold anything, a node has to
// live in a lane - so some drops are refused outright and the row springs
// back. Refusing visibly beats silently correcting to something legal that
// the user did not ask for.

// Flatten the board into rows. Stages come directly after their own node and
// before that node's children, so a node's own detail reads before its
// sub-tree.
function outlineRows(laneOrder, laneMeta, projects){
  var rows=[], all=projects||[];
  (laneOrder||[]).forEach(function(lane){
    var meta=(laneMeta&&laneMeta[lane])||{};
    rows.push({ key:"L:"+lane, kind:"lane", id:lane, name:meta.label||lane, level:0, accent:meta.accent });
    (function walk(parentId, level){
      all.filter(function(p){ return p.lane===lane && (p.parentId||null)===parentId; })
         .sort(function(a,b){ return (a.order||0)-(b.order||0); })
         .forEach(function(p){
           rows.push({ key:"P:"+p.id, kind:"node", id:p.id, name:p.name, level:level,
                       role:projRole(p), accent:meta.accent });
           (p.stages||[]).forEach(function(st){
             rows.push({ key:"S:"+p.id+":"+st.id, kind:"stage", id:st.id, hostId:p.id,
                         name:st.label||st.name||"", level:level+1, done:!!st.done, accent:meta.accent });
           });
           walk(p.id, level+1);
         });
    })(null, 1);
  });
  return rows;
}
// Fold a freshly-read board back into an outline that is already being
// edited. The editor holds unsaved moves in its own state, so it cannot
// simply rebuild when a name is changed in a child editor - that would throw
// the moves away. Content comes from the fresh rows, sequence and indent from
// the ones on screen.
//
// Rows created by a conversion have no counterpart in the fresh read yet, so
// they are kept on their own account. Rows whose record has gone are dropped.
function mergeOutline(existing, fresh){
  var byKey={}; (fresh||[]).forEach(function(r){ byKey[r.key]=r; });
  var out=[], seen={};
  // A conversion has not been saved yet, so the record it came from is still
  // in the fresh read. Without this the outline would show both the new lane
  // and the project it was made from.
  (existing||[]).forEach(function(r){
    if(!r.fresh) return;
    if(r.fromProject!==undefined) seen["P:"+r.fromProject]=true;
    if(r.fromLane!==undefined) seen["L:"+r.fromLane]=true;
  });
  (existing||[]).forEach(function(r){
    var f=byKey[r.key];
    if(!f){ if(r.fresh){ out.push(r); seen[r.key]=true; } return; }
    out.push(Object.assign({}, f, { level:r.level, role:r.role||f.role }));
    seen[r.key]=true;
  });
  // Anything new - a stage added while the sheet was open - goes in after
  // whichever of its fresh neighbours is already on screen.
  (fresh||[]).forEach(function(f, i){
    if(seen[f.key]) return;
    var at=out.length;
    for(var j=i-1;j>=0;j--){
      var pos=-1;
      for(var k=0;k<out.length;k++) if(out[k].key===fresh[j].key){ pos=k; break; }
      if(pos>=0){ at=pos+1; break; }
    }
    out.splice(at, 0, f); seen[f.key]=true;
  });
  return out;
}
// ---- STEPPING THE OUTLINE --------------------------------------------------
// Rows move by buttons, not by dragging. Up and down move a row among its
// siblings; at the first or last position one more step takes it out of its
// parent into the neighbouring one, which is the only move that asks first.
// Left and right change indent, and type follows depth: level 0 is a lane,
// level 1 a project, deeper is nested. Every function is pure and returns
// either the new rows - with a note of what crossed - or null when the step
// is not possible, so a button can be disabled rather than dead.

function blockEnd(rows, i){ return i+outlineSpan(rows, i); }
// The row that owns this one: nearest above with a smaller indent.
function parentIndex(rows, i){
  for(var j=i-1;j>=0;j--) if(rows[j].level<rows[i].level) return j;
  return -1;
}
// Siblings share a parent, a level and a kind. Stages sit at the same level
// as their host's child nodes, so kind has to match too.
function prevSibling(rows, i){
  var L=rows[i].level, K=rows[i].kind;
  for(var j=i-1;j>=0;j--){
    if(rows[j].level<L) return -1;
    if(rows[j].level===L && rows[j].kind===K) return j;
  }
  return -1;
}
function nextSibling(rows, i){
  var L=rows[i].level, K=rows[i].kind;
  for(var j=blockEnd(rows,i);j<rows.length;j++){
    if(rows[j].level<L) return -1;
    if(rows[j].level===L && rows[j].kind===K) return j;
  }
  return -1;
}
// Lift a block out and put it back at `at` (an index into the list WITHOUT the
// block), shifting its indent by `dl`.
function replant(rows, i, at, dl){
  var span=outlineSpan(rows,i);
  var block=rows.slice(i,i+span).map(function(r){ return dl ? Object.assign({},r,{level:r.level+dl}) : r; });
  var rest=rows.slice(0,i).concat(rows.slice(i+span));
  return rest.slice(0,at).concat(block, rest.slice(at));
}
// Where a first child of `target` would go: after the target's own stages.
function firstChildAt(rows, ti){
  var at=ti+1;
  while(at<rows.length && rows[at].kind==="stage" && rows[at].level===rows[ti].level+1) at++;
  return at;
}
function stepUp(rows, i){
  if(!rows || i<=0 || i>=rows.length) return null;
  var r=rows[i], p=prevSibling(rows,i);
  if(p>=0) return { rows:replant(rows,i,p,0), crossed:null };
  if(r.kind!=="node") return null;                  // lanes and stages stay in their run
  var P=parentIndex(rows,i); if(P<0) return null;
  var Q=prevSibling(rows,P); if(Q<0) return null;   // parent is first: nowhere to go
  // become the last child of Q; Q's subtree is above, so its indices hold
  var span=outlineSpan(rows,i), rest=rows.slice(0,i).concat(rows.slice(i+span));
  return { rows:replant(rows,i,blockEnd(rest,Q),0), crossed:{ from:rows[P], into:rows[Q] } };
}
function stepDown(rows, i){
  if(!rows || i<0 || i>=rows.length) return null;
  var r=rows[i], span=outlineSpan(rows,i), n=nextSibling(rows,i);
  if(n>=0){
    var rest=rows.slice(0,i).concat(rows.slice(i+span));
    return { rows:replant(rows,i,blockEnd(rest,n-span),0), crossed:null };
  }
  if(r.kind!=="node") return null;
  var P=parentIndex(rows,i); if(P<0) return null;
  var R=nextSibling(rows,P); if(R<0) return null;
  var rest2=rows.slice(0,i).concat(rows.slice(i+span));
  return { rows:replant(rows,i,firstChildAt(rest2,R-span),0), crossed:{ from:rows[P], into:rows[R] } };
}
// What a row could become if it nested under the row above. A task holds only
// tasks; a project holds either. Returned as a list so the controller can
// offer exactly the choices that exist and grey the rest, rather than the
// caller inferring a role and being corrected afterwards.
function nestRoles(rows, i){
  if(!rows || i<0 || i>=rows.length) return [];
  var r=rows[i];
  if(r.kind!=="node") return [];
  var p=prevSibling(rows,i); if(p<0) return [];
  var host=rows[p];
  if(host.kind!=="node") return [];
  return host.role==="task" ? ["task"] : ["task","project"];
}
// Nest under the row above, as the role asked for. A lane becomes a project
// inside the lane above, its projects nesting one deeper.
function stepIn(rows, i, asRole){
  if(!rows || i<0 || i>=rows.length) return null;
  var r=rows[i];
  if(r.kind==="stage") return null;
  var p=prevSibling(rows,i); if(p<0) return null;
  if(r.kind==="lane"){
    var span=outlineSpan(rows,i);
    var block=rows.slice(i,i+span).map(function(x,k){
      if(k===0) return { key:"P:new-"+x.id, kind:"node", id:"new-"+x.id, name:x.name, level:1,
                         role:"project", accent:x.accent, fresh:true, fromLane:x.id };
      return Object.assign({},x,{level:x.level+1});
    });
    return { rows:rows.slice(0,i).concat(block, rows.slice(i+span)), converted:{ lane:r, intoLane:rows[p] } };
  }
  // The role is chosen, not inferred. Refused outright when the host cannot
  // hold it - a project inside a task has no meaning.
  var roles=nestRoles(rows,i);
  var want=asRole||roles[0];
  if(!roles.length || roles.indexOf(want)<0) return null;
  var span2=outlineSpan(rows,i), rest=rows.slice(0,i).concat(rows.slice(i+span2));
  var out=replant(rows,i,blockEnd(rest,p),1);
  var at=blockEnd(rest,p);
  out[at]=Object.assign({},out[at],{ role:want });
  return { rows:out, crossed:null };
}
// Un-nest. A task becomes a project beside its old parent. A top-level
// project gets a NEW LANE of its own, after the one it was in, and moves into
// it whole - itself, its stages and everything under it (Brent, 10-20: keep
// the project). Nothing is retired, so its logs, milestones and tool
// checkouts still point at a record that exists.
function stepOut(rows, i){
  if(!rows || i<0 || i>=rows.length) return null;
  var r=rows[i];
  if(r.kind!=="node") return null;
  var P=parentIndex(rows,i); if(P<0) return null;
  var span=outlineSpan(rows,i), rest=rows.slice(0,i).concat(rows.slice(i+span));
  if(r.level>=2){
    var out=replant(rows,i,blockEnd(rest,P),-1);
    var at=blockEnd(rest,P);
    if(r.level-1===1) out[at]=Object.assign({},out[at],{ role:"project" });
    return { rows:out, crossed:null };
  }
  // level 1 -> a lane of its own, with the project as its first record. The
  // lane's id is temporary; Save gives it a real key and a colour.
  var lane={ key:"L:new-"+r.id, kind:"lane", id:"new-lane-"+r.id, name:r.name, level:0,
             accent:r.accent, fresh:true, fromProject:r.id };
  var block=[lane].concat(rows.slice(i,i+span));
  return { rows:rest.slice(0,blockEnd(rest,P)).concat(block, rest.slice(blockEnd(rest,P))), converted:{ project:r, outOfLane:rows[P] } };
}
// What each button can do for a row, so the UI disables rather than guesses.
function stepOptions(rows, i, asRole){
  return { up:!!stepUp(rows,i), down:!!stepDown(rows,i),
           in_:!!stepIn(rows,i,asRole), out:!!stepOut(rows,i), roles:nestRoles(rows,i) };
}

// How many rows a row owns: itself plus everything indented under it.
function outlineSpan(rows, at){
  var lvl=rows[at].level, n=1;
  while(at+n<rows.length && rows[at+n].level>lvl) n++;
  return n;
}
// A new project's id. ONE place makes them (Add, and a lane turned into a
// project in Edit...). Since 10-20 it is a long random id like every other
// record's, not "highest number + 1": two phones counting up would hand out
// the same number. Projects made before keep their numbers - ids are only
// ever compared, never counted or sorted, so the two live side by side.
function newProjectId(projects){ return uid(); }
// A saved outline, applied: the board's new lane order, lane meta and
// projects. Pure, so lifecycle holds it to the rules - every row lands, a
// conversion creates a REAL record, and nothing points at an id that does not
// exist. (Until 10-20 the board applied moves only: a project turned into a
// lane showed up as a lane called NEW-LANE-2 and never moved, and a lane
// turned into a project left its projects under a parent that was never made.)
//   newLaneKey() -> a fresh lane key, as Add Lane makes one.
function outlineApply(rows, projects, laneMeta, newLaneKey){
  var c=outlineCommit(rows), all=projects||[];
  // Stage rows carry only what the outline needed; the real stage objects
  // are looked up by id so notes and done-state survive a move.
  var stageById={};
  all.forEach(function(p){ (p.stages||[]).forEach(function(st){ stageById[st.id]=st; }); });
  var stagesFor=function(id){ return (c.stagesOf[id]||[]).map(function(r){ return stageById[r.id]; }).filter(function(x){ return !!x; }); };
  // A lane made by a conversion: a real key, the project's name as its label,
  // and the first lane colour no other lane is using.
  var meta=Object.assign({}, laneMeta||{}), realLane={};
  var used=c.laneOrder.map(function(k){ var m=(laneMeta&&laneMeta[k])||DEFAULT_META[k]; return m ? String(m.accent).toUpperCase() : ""; });
  c.newLanes.forEach(function(nl){
    var col=LANE_COLORS.filter(function(x){ return used.indexOf(x.accent.toUpperCase())<0; })[0] || LANE_COLORS[0];
    used.push(col.accent.toUpperCase());
    realLane[nl.id]=newLaneKey();
    meta[realLane[nl.id]]={ label:nl.label, accent:col.accent, bg:col.bg, dim:col.dim };
  });
  var laneKey=function(k){ return Object.prototype.hasOwnProperty.call(realLane, k) ? realLane[k] : k; };
  // A project made by a conversion (a lane stepped in): a real id, as Add
  // makes one, and its children are re-pointed at it.
  var realProj={};
  c.newProjects.forEach(function(np){ realProj[np.id]=newProjectId(all); });
  var pid=function(id){ return (id!=null && Object.prototype.hasOwnProperty.call(realProj, id)) ? realProj[id] : id; };
  var out=all.map(function(p){
    if(c.laneOf[p.id]===undefined) return p;   // untouched by this outline
    return Object.assign({}, p, { lane:laneKey(c.laneOf[p.id]), parentId:pid(c.parentOf[p.id]),
                                  order:c.orderOf[p.id], stages:stagesFor(p.id) });
  });
  c.newProjects.forEach(function(np){
    out.push({ id:realProj[np.id], name:np.name, lane:laneKey(c.laneOf[np.id]), notes:"", parentId:pid(c.parentOf[np.id]),
               order:c.orderOf[np.id], role:np.role||"project", stages:stagesFor(np.id) });
  });
  // A lane that became a project is retired, and its colour entry with it.
  c.dropLanes.forEach(function(k){ if(c.laneOrder.indexOf(k)<0) delete meta[k]; });
  return { laneOrder:c.laneOrder.map(laneKey), laneMeta:meta, projects:out };
}
// Read the tree back out of the flat list. Lane order, each record's lane,
// parent and order, and each node's stages - all derived from position and
// indent, never from a field that could have drifted.
function outlineCommit(rows){
  // `orders` is the answer, `counts` is the running tally per sibling set.
  // One map for both would collide the moment a record id matched a key.
  var laneOrder=[], byLane={}, parents={}, orders={}, counts={}, stages={};
  // Records created or retired by a conversion. A lane stepped in becomes a
  // fresh project and its old lane goes; a project stepped out gets a fresh
  // lane and stays a project inside it, so nothing is dropped for it.
  var newLanes=[], newProjects=[], dropLanes=[], dropProjects=[];
  var laneOf=null, stack=[];
  (rows||[]).forEach(function(r){
    if(r.kind==="lane"){
      laneOrder.push(r.id); laneOf=r.id; stack=[];
      if(r.fresh) newLanes.push({ id:r.id, label:r.name, accent:r.accent, fromProject:r.fromProject });
      return;
    }
    if(r.kind==="node" && r.fresh){
      newProjects.push({ id:r.id, name:r.name, role:r.role||"project" });
      if(r.fromLane!==undefined) dropLanes.push(r.fromLane);
    }
    if(laneOf===null) return;                       // orphan guard
    while(stack.length && stack[stack.length-1].level>=r.level) stack.pop();
    var host=stack.length ? stack[stack.length-1] : null;
    if(r.kind==="stage"){
      if(!host) return;
      (stages[host.id]=stages[host.id]||[]).push(r);
      return;
    }
    byLane[r.id]=laneOf;
    parents[r.id]=host?host.id:null;
    var k=laneOf+"/"+(host?host.id:"root");
    orders[r.id]=(counts[k]===undefined?(counts[k]=0):++counts[k]);
    stack.push(r);
  });
  return { laneOrder:laneOrder, laneOf:byLane, parentOf:parents, orderOf:orders, stagesOf:stages,
           newLanes:newLanes, newProjects:newProjects, dropLanes:dropLanes, dropProjects:dropProjects };
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
  return React.createElement("div", { dir:"ltr", "data-anchor":props.name ? "set-"+props.name : undefined },
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

  return React.createElement("div", { dir:"ltr", ref:track, role:"radiogroup", "data-anchor":props.name ? "set-"+props.name : undefined,
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
// A shift as an offset and a length, in minutes. An end earlier than its start
// means the shift runs past midnight: 21:00 to 05:30 is eight and a half hours
// on the day it started, not an error and not a 15-hour negative. An end equal
// to its start is still nothing, because 24-hour shifts are not a thing here.
// Every other piece of schedule maths is built on this one function.
function shiftSpan(day){
  if(!day || !day.on) return null;
  var s=toMin(day.start), e=toMin(day.end);
  if(s==null || e==null) return null;
  var len=e-s; if(len<0) len+=1440;
  return len>0 ? { start:s, len:len, wraps:e<s } : null;
}
function schWraps(day){ var sp=shiftSpan(day); return !!(sp && sp.wraps); }
function schMinutes(day){
  var sp=shiftSpan(day);
  return sp ? sp.len : 0;
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
function hexDarken(hex, amt){
  var m=/^#([0-9a-fA-F]{6})$/.exec(String(hex||""));
  if(!m) return hex;
  var n=parseInt(m[1],16), r=(n>>16)&255, g=(n>>8)&255, b=n&255;
  function ch(c){ return Math.round(c*(1-amt)); }
  return "#"+((1<<24)+(ch(r)<<16)+(ch(g)<<8)+ch(b)).toString(16).slice(1);
}
// A breathing halo behind text. The text colour itself never moves - only the
// glow does - so the word stays legible and the motion reads as a soft bloom
// rather than the letters changing colour.
//
// The halo has to move away from the page, not toward it. On a dark theme that
// means a lighter tint spilling outward; on a light one a lighter tint is
// invisible, so it goes darker instead and reads as a soft shadow. Same cue,
// opposite direction, because contrast is what makes it discernible.
function glowVars(col){
  var tint = S.mode==="light" ? hexDarken(col,0.35) : hexBrighten(col,0.45);
  return { "--glow-s1":tint+"55", "--glow-s2":tint+"E6", color:col };
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
  var sp=shiftSpan(day); if(!sp) return 0;
  var bs=toMin(br.start), d=Math.min(1440, Math.max(0, +br.mins||0));
  if(bs==null||d<=0) return 0;
  // Work in minutes from the start of the shift rather than from midnight, so
  // a 01:00 lunch on a 21:00 shift lands four hours in instead of twenty hours
  // before. uptoMin is a wall-clock minute and gets the same treatment.
  var hi=sp.len;
  if(uptoMin!=null){
    var rel=uptoMin-sp.start; if(rel<0) rel+=1440;
    hi=Math.min(hi, Math.max(0, rel));
  }
  var off=((bs-sp.start)%1440+1440)%1440;
  // Two candidate placements: this shift, and the same clock time one turn of
  // the dial earlier - that second one is how a break starting just before the
  // shift still deducts its tail.
  var total=0;
  [off, off-1440].forEach(function(o){
    var lo=Math.max(0,o), top=Math.min(hi, o+d);
    if(top>lo) total+=top-lo;
  });
  return total;
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
           fontSize:"16px", boxSizing:"border-box" };
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
// ---- WHICH SHIFT DOES THIS MOMENT BELONG TO ---------------------------------
// A work day is a shift, not a calendar square. Clock in at 21:40 on a Tuesday
// and everything you log until you go home belongs to Tuesday's shift, midnight
// or no midnight. The app never guesses which shift you meant: if you clock in
// outside the scheduled window it asks, and the answer is stored on the session.
//
// shiftWindow(schedule, date) -> { start, end } in ms for that calendar date, or
// null when that weekday is not worked.
function shiftWindow(schedule, date){
  if(!schedule) return null;
  var d=startOfDay(date);
  var sp=shiftSpan(schedule[dayKeyOf(d)]);
  if(!sp) return null;
  var start=d.getTime()+sp.start*60000;
  // The end can land on the following date. The window still belongs to the
  // day it started on - that is what makes a night shift one work day.
  return { start:start, end:start+sp.len*60000, wraps:sp.wraps };
}
// Nearest worked day strictly before / after the given date. Bounded at 14 days
// so a schedule with every day switched off terminates instead of spinning.
function adjacentShiftDay(schedule, date, dir){
  var d=startOfDay(date);
  for(var i=1;i<=14;i++){
    var cand=addDays(d, dir*i);
    if(shiftWindow(schedule, cand)) return cand;
  }
  return null;
}
// What the clock-in prompt needs to know. `position` is where `ts` sits
// relative to the scheduled shift on its own calendar date:
//   "inside"  - within the window (grace included); no question to ask
//   "before"  - earlier than start; the choice is previous shift vs this one
//   "after"   - later than end;    the choice is this shift vs the next one
//   "off"     - that weekday is not worked; previous shift vs next one
function shiftContext(schedule, ts, graceMin){
  var now=new Date(ts);
  var grace=(typeof graceMin==="number" && graceMin>0 ? graceMin : 0)*60000;
  var thisDay=startOfDay(now), yesterday=addDays(now,-1);

  // Yesterday first. A shift that wraps past midnight is still running on this
  // calendar date, and it owns the moment - 02:00 on Thursday is Wednesday's
  // shift, not an early start on Thursday's. Checking today's window first
  // would call that "before" and ask a question with an obvious answer.
  var prevWin=shiftWindow(schedule, yesterday);
  if(prevWin && prevWin.wraps && ts>=prevWin.start-grace && ts<=prevWin.end+grace)
    return { position:"inside", inside:true, shift:prevWin, owner:yesterday,
             thisDay:yesterday, prevDay:adjacentShiftDay(schedule, yesterday, -1),
             nextDay:adjacentShiftDay(schedule, now, 1) };

  var win=shiftWindow(schedule, now);
  var prev=adjacentShiftDay(schedule, now, -1);
  var next=adjacentShiftDay(schedule, now, 1);
  // ownDay is this calendar day standing on its own: no roster, no shift, just
  // the day you turned up. thisDay stays null because there is no shift here.
  if(!win) return { position:"off", inside:false, shift:null, owner:null,
                    thisDay:null, ownDay:thisDay, prevDay:prev, nextDay:next };
  if(ts >= win.start-grace && ts <= win.end+grace)
    return { position:"inside", inside:true, shift:win, owner:thisDay,
             thisDay:thisDay, prevDay:prev, nextDay:next };
  return { position: ts < win.start ? "before" : "after", inside:false, shift:win,
           owner:null, thisDay:thisDay, prevDay:prev, nextDay:next };
}
// The two answers the prompt offers, in the order they are shown. Each is
// { key, label, when, day } where `day` is the work-day stamp that answer sets.
// Never more than two: the question is always "this shift or the neighbouring
// one", which is the only thing a person standing at the clock can actually know.
function shiftChoices(ctx){
  function opt(key, label, date, unscheduled){
    return date ? { key:key, label:label, when:date.getTime(),
                    day:workDayOf(date.getTime()), unscheduled:!!unscheduled } : null;
  }
  var out;
  if(ctx.position==="before")     out=[opt("prev","Previous shift",ctx.prevDay), opt("this","Upcoming shift",ctx.thisDay)];
  else if(ctx.position==="after") out=[opt("this","This shift",ctx.thisDay),     opt("next","Next shift",ctx.nextDay)];
  // On a day you are not rostered, the likeliest answer is that today is its
  // own work day - a call-out, not a continuation of Friday. It leads, and the
  // neighbouring shifts stay available for the times it really is a carry-over.
  else if(ctx.position==="off")   out=[opt("own","This day",ctx.ownDay,true),
                                       opt("prev","Previous shift",ctx.prevDay),
                                       opt("next","Next shift",ctx.nextDay)];
  else                            out=[opt("this","This shift",ctx.thisDay)];
  return out.filter(Boolean);
}
// A day worked outside the roster has no scheduled hours to tell regular time
// from overtime, and the otDays setting cannot know about a one-off Saturday.
// So it is asked, and the answer is stored on the records rather than inferred.
var OT_CHOICES = [
  { key:"reg", label:"Regular time", note:"Paid at the normal rate", ot:false },
  { key:"ot",  label:"Overtime",     note:"Paid at the overtime rate", ot:true }
];
// The work day a clock-in resolves to with no question asked. Inside the window
// it is simply today; outside it there is no safe default, so this returns null
// and the caller must ask.
function autoWorkDay(schedule, ts, graceMin){
  var ctx=shiftContext(schedule, ts, graceMin);
  // The stamp is the day the shift started, which on a wrapped shift is not
  // the day the clock says.
  return (ctx.inside && ctx.owner) ? workDayOf(ctx.owner.getTime()) : null;
}
// Grace is minutes either side of the scheduled window in which the prompt is
// skipped. Zero means always ask, which is the default: a wrong silent guess
// costs a whole shift of misfiled time, a prompt costs one tap.
function normalizeGrace(v){
  var n = (typeof v==="number" && isFinite(v)) ? Math.floor(v) : 0;
  if(!(n>0)) return 0;
  return Math.min(n, 240);
}
// A record's work day: the stamp it was filed under, or - for anything logged
// before stamping existed - the calendar day it started on, which is exactly
// where the old code filed it. Backfill therefore moves nothing.
function recordDay(r){
  return (r && typeof r.day==="string" && r.day) ? r.day : workDayOf(r.startTime);
}

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
// Whether a log is overtime. An explicit answer given at clock-in wins: a
// called-in Saturday is overtime even when Saturday is not an overtime day, and
// a rostered-day-off shift covered as straight time is not overtime even when
// it is. With no answer stored it falls back to the weekday rule, read off the
// work day the log was filed under rather than the calendar date its clock
// happened to land on - those differ on a night shift.
function logIsOt(l, otSet){
  if(l && typeof l.ot==="boolean") return l.ot;
  if(!l) return false;
  return !!otSet[dayKeyOf(new Date(recordDay(l)))];
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
    if(!logIsOt(l, otSet)) return;
    var d=new Date(l.startTime);
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
  var dk=dayKeyOf(midnight), sp=shiftSpan(schedule[dk]);
  if(sp){
    var t=new Date(nowMs), cur=t.getHours()*60+t.getMinutes();
    // Today's shift has not begun until its start time even when it wraps: at
    // 03:00 on a 21:00 shift the hours behind you belong to yesterday's shift,
    // which the whole-days sum above has already counted.
    var gross = cur<=sp.start ? 0 : Math.min(cur-sp.start, sp.len);
    // minus the part of each break already behind us - sitting inside the
    // lunch window, pace holds still
    if(gross>0) mins += Math.max(0, gross - schDayBreakMins(schedule, dk, cur));
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
    if(logIsOt(l, otSet)) otMs+=dur;
    days[workDayOf(l.startTime)]=1;
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
    React.createElement("div", { style:sectionWrap, "data-anchor":"pay-base" },
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
    React.createElement("div", { style:sectionWrap, "data-anchor":"pay-week" },
      React.createElement("div", { style:sectionHead }, "Week Starts On"),
      React.createElement("div", { style:sectionNote }, "Sets the week boundary for reports and weekly pay."),
      chipRow("ws", function(k){ return pr.weekStart===k; },
        function(k){ mutate(function(n){ n.weekStart=k; }); })
    ),
    React.createElement("div", { style:sectionWrap, "data-anchor":"pay-otdays" },
      React.createElement("div", { style:sectionHead }, "Overtime Days"),
      React.createElement("div", { style:sectionNote }, "Days where worked time counts as overtime."),
      chipRow("ot", function(k){ return pr.otDays.indexOf(k)>=0; },
        function(k){ mutate(function(n){
          var i=n.otDays.indexOf(k);
          if(i>=0) n.otDays.splice(i,1); else n.otDays.push(k);
        }); })
    ),
    React.createElement("div", { style:sectionWrap, "data-anchor":"pay-otrate" },
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
      React.createElement("div", { "data-anchor":"pay-exclude", style:{display:"flex",alignItems:"center",gap:"0.5rem",marginTop:"0.55rem"} },
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
    React.createElement("div", { style:{marginBottom:"0.4rem"}, "data-anchor":"pay-cycle" },
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
    return React.createElement("input", { type:"time", value:draft[k][field], disabled:!draft[k].on, "data-schedtime":k+"-"+field,
      onChange:function(e){ patch(k, field, e.target.value); },
      style:Object.assign(TIME_FIELD_STYLE(col, invalid?S.dangerText:S.border),
        { flex:"0 1 94px", minWidth:"80px", opacity:draft[k].on?1:0.45 }) });
  };
  return React.createElement(React.Fragment, null,
    React.createElement(Modal, { title:"Work Schedule", onClose:props.onClose, wide:true,
    onSave:function(){ props.onSave(draft); }, saveLabel:"Save" },
    React.createElement("div", { style:{fontSize:"0.8rem",color:S.textDim,marginBottom:"0.9rem"} },
      "Days and hours you normally work. Reports will measure tracked time against this."),
    // ---- pay & work week ----
    React.createElement("div", { "data-anchor":"sch-pay", style:{display:"flex",alignItems:"center",gap:"0.6rem",padding:"0.15rem 0 0.7rem",
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
    React.createElement("div", { "data-anchor":"sch-overnight", style:{fontSize:"0.76rem",color:S.textMuted,lineHeight:1.4,
      padding:"0.15rem 0 0.5rem"} },
      "Set an end earlier than the start for an overnight shift - 21:00 to 05:30 is "+
      "marked +1d and counts as one work day."),
    DAY_KEYS.map(function(k){
      var d=draft[k];
      var invalid = d.on && schMinutes(d)===0;
      return React.createElement("div", { key:k, "data-schedday":k,
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
        // An end earlier than its start is now a legitimate overnight shift
        // rather than an error, so the wrap has to be visible - otherwise a
        // fat-fingered 08:00 reads as a silent 23-hour day.
        React.createElement("span", { "aria-label": schWraps(d) ? "ends the next day" : "",
          style:{width:"22px",flexShrink:0,textAlign:"center",fontSize:"0.62rem",fontWeight:700,
                 fontFamily:S.fontMono,letterSpacing:"-0.03em",
                 color: schWraps(d) ? S.chromeSubTask : "transparent"} },
          schWraps(d) ? "+1d" : ""),
        React.createElement("span", { style:{width:"46px",flexShrink:0,marginLeft:"auto",textAlign:"right",fontSize:"0.74rem",fontFamily:S.fontMono,
          color: invalid?S.dangerText:(d.on?S.textDim:S.textMuted)} },
          d.on ? (invalid?"end?":fmtHours(schNetMinutes(draft,k))) : "off")
      );
    }),
    // ---- unpaid breaks ----
    React.createElement("div", { "data-anchor":"sch-unpaid", style:{display:"flex",alignItems:"center",gap:"0.6rem",padding:"0.7rem 0",
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
    React.createElement("div", { "data-anchor":"sch-total", style:{display:"flex",justifyContent:"space-between",padding:"0.85rem 0 0.2rem",fontFamily:S.fontBody} },
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
// ---- BACKUP & SAVES ---------------------------------------------------------
function snapWhen(at){
  try{ var d=new Date(at);
    return d.toLocaleDateString([], {weekday:"short",month:"short",day:"numeric"})+" · "+
           d.toLocaleTimeString([], {hour:"numeric",minute:"2-digit"}); }catch(e){ return ""; }
}
var SNAP_WHY = { clockout:"At clock-out", open:"When the app opened", "before-reset":"Before reset",
                 "before-load":"Before load", manual:"" };
function snapWhat(r){
  var s=r.summary||{}, h=Math.round((s.loggedMs||0)/3600000);
  return (s.projects||0)+" project"+(s.projects===1?"":"s")+" · "+
         ((s.loggedMs||0)>0 ? (h<1?"under 1h":h+"h")+" logged" : "nothing logged");
}
function SnapRow(props){
  var r=props.rec, tag=SNAP_WHY[r.why];
  return React.createElement("div", { "data-snaprow":r.id,
      style:Object.assign({ display:"flex", alignItems:"center", gap:"0.6rem", background:S.bg1, border:"1px solid "+S.border,
              borderRadius:S.radius, padding:"0.6rem 0.7rem", marginBottom:"0.45rem" }, props.style||{}) },
    React.createElement("div", { style:{ flex:1, minWidth:0 } },
      React.createElement("div", { style:{ color:S.text, fontWeight:700, fontSize:"0.92rem", fontFamily:S.fontBody } },
        r.name || snapWhen(r.at)),
      React.createElement("div", { style:{ color:S.textDim, fontSize:"0.78rem", fontFamily:S.fontBody, marginTop:"0.1rem" } },
        (r.name ? snapWhen(r.at)+" · " : (tag && props.showWhy ? tag+" · " : ""))+snapWhat(r))),
    props.children);
}
function snapBtn(extra){
  return Object.assign({ flex:"none", border:"2px solid "+S.actionBdr, background:S.infoBg, color:S.infoText,
    borderRadius:S.radius3, padding:"0.4rem 0.7rem", fontWeight:700, fontSize:"0.84rem", fontFamily:S.fontBody,
    cursor:"pointer" }, extra||{});
}
function BackupModal(props){
  var staged = (StageCtx && React.useContext) ? React.useContext(StageCtx) : false;
  var statusS=useState(null); var setStatus=statusS[1]; var status=statusS[0];
  // `preview` is the manual staging this sheet: it opens on the "check it"
  // stage with a summary and NO backup object, so there is nothing to apply.
  var pendingS=useState(props.preview ? { obj:null, summary:props.preview } : null); var setPending=pendingS[1]; var pending=pendingS[0];
  var listS=useState(null); var setList=listS[1]; var list=listS[0];
  var nameS=useState(""); var setName=nameS[1]; var name=nameS[0];
  var subS=useState(null); var setSub=subS[1]; var sub=subS[0];     // { kind:"load"|"reset"|"tier"|"full", ... }
  var busyS=useState(false); var setBusy=busyS[1]; var busy=busyS[0];
  var clocked=!!props.clocked;
  var only=props.only||null;   // a staged picture shows one section

  function refresh(){
    if(staged) return Promise.resolve();
    return snapList().then(function(l){ setList(l); }, function(){ setList([]); });
  }
  useEffect(function(){ refresh(); }, []);
  var all=list||[];
  var manual=all.filter(function(r){ return r.kind==="manual"; }).sort(function(a,b){ return b.at-a.at; });
  var latest=all.filter(function(r){ return r.kind==="latest"; })[0]||null;
  function tier(kind){ return all.filter(function(r){ return r.kind===kind; }).sort(function(a,b){ return b.at-a.at; }); }

  function saveNow(replaceId){
    if(busy) return;
    if(!replaceId && manual.length>=SNAP_MANUAL_MAX){ setSub({ kind:"full" }); return; }
    haptic(10); setBusy(true);
    snapTake("manual", { name:name.trim(), replaceId:replaceId||null }).then(function(l){
      setList(l); setName(""); setSub(null); setBusy(false);
      setStatus({ ok:true, msg:"Saved." });
    }, function(){ setBusy(false); setStatus({ ok:false, msg:"Could not save on this device." }); });
  }
  function delSave(id){
    haptic([20,50,20]);
    snapDelete(id).then(refresh, refresh);
  }

  function doExport(){
    haptic(10);
    var obj=backupBuild(ttDb.backend());
    var json=JSON.stringify(obj);
    var fname="time-tracker-backup-"+isoDate(new Date())+".json";
    try{
      if(typeof File!=="undefined" && navigator.share && navigator.canShare &&
         navigator.canShare({ files:[new File([json],fname,{type:"application/json"})] })){
        navigator.share({ files:[new File([json],fname,{type:"application/json"})], title:fname })
          .then(function(){ setStatus({ok:true,msg:"Backup shared."}); })
          .catch(function(){ setStatus(null); });
        return;
      }
    }catch(e){}
    try{
      var url=URL.createObjectURL(new Blob([json],{type:"application/json"}));
      var a=document.createElement("a");
      a.href=url; a.download=fname;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function(){ URL.revokeObjectURL(url); },5000);
      setStatus({ok:true,msg:"Backup downloaded as "+fname+"."});
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
    if(!pending || !pending.obj) return;
    haptic([20,50,20]);
    var res=backupApply(pending.obj, ttDb.backend());
    if(!res.ok){ setStatus({ok:false,msg:res.error}); setPending(null); return; }
    setStatus({ok:true,msg:"Restored. Reloading..."});
    try{ setTimeout(function(){ location.reload(); }, 400); }catch(e){}
  }

  function fmtStamp(iso){
    try{ return new Date(iso).toLocaleDateString([], {month:"short",day:"numeric",year:"numeric"}); }
    catch(e){ return String(iso||""); }
  }
  var note={fontSize:"0.78rem",color:S.textDim,fontFamily:S.fontBody,marginBottom:"0.7rem",lineHeight:1.45};
  var btn={display:"block",width:"100%",background:S.bg1,border:"1.5px solid "+S.borderBright,
           borderRadius:S.radius,padding:"0.75rem",color:S.text,cursor:"pointer",
           fontFamily:S.fontBody,fontWeight:700,fontSize:"0.9rem"};
  var head=function(text, right){
    return React.createElement("div", { style:{ display:"flex", justifyContent:"space-between", margin:"1.1rem 0 0.45rem",
        fontSize:"0.72rem", textTransform:"uppercase", letterSpacing:"0.08em", color:S.textDim, fontWeight:700, fontFamily:S.fontBody } },
      React.createElement("span", null, text), right ? React.createElement("span", null, right) : null);
  };
  var show=function(sec){ return !only || only===sec; };
  var held=clocked ? React.createElement("div", { "data-clockedout":"needed", style:Object.assign({}, note, { color:S.warnText, marginBottom:"0.4rem" }) },
    "Clock out to load a copy or reset the board.") : null;

  var autoSec = show("auto") && React.createElement("div", { "data-anchor":"saves-auto" },
    head("Automatic backups"),
    held,
    latest
      ? React.createElement(SnapRow, { rec:latest, showWhy:true,
          style:{ border:"2px solid "+S.successText, background:S.successBg } },
          React.createElement("button", { "data-snapload":"latest", disabled:clocked,
            onClick:function(){ setSub({ kind:"load", id:"latest", rec:latest }); },
            style:snapBtn({ opacity:clocked?0.4:1 }) }, "Load"))
      : React.createElement("div", { "data-snapnone":true, style:note },
          staged ? "Made for you at every clock-out." : (list ? "None yet. The first is made when you clock out." : "Reading…")),
    React.createElement("div", { style:{ display:"flex", gap:"0.45rem" } },
      ["daily","weekly","monthly"].map(function(k){
        var n=tier(k).length;
        return React.createElement("button", { key:k, "data-snaptier":k, onClick:function(){ if(n) setSub({ kind:"tier", tier:k }); },
            style:Object.assign({}, btn, { flex:1, padding:"0.55rem 0.3rem", opacity:n?1:0.55, cursor:n?"pointer":"default" }) },
          React.createElement("div", null, k.charAt(0).toUpperCase()+k.slice(1)),
          React.createElement("div", { style:{ fontWeight:500, color:S.textDim, fontSize:"0.75rem" } }, n+" of "+SNAP_KEEP[k]));
      })));

  var saveSec = show("saves") && React.createElement("div", { "data-anchor":"saves-save" },
    head("Saves", manual.length+" of "+SNAP_MANUAL_MAX),
    React.createElement("div", { style:note }, "A save keeps this exact moment until you delete it. Use one before trying something new."),
    React.createElement("input", { "data-savename":true, value:name, maxLength:40, placeholder:"Name (optional)",
      onChange:function(e){ setName(e.target.value); }, style:Object.assign({}, INPUT_STYLE, { marginBottom:"0.45rem" }) }),
    React.createElement("button", { "data-savenow":true, disabled:busy, onClick:function(){ saveNow(null); },
      style:Object.assign({}, btn, { background:S.infoBg, border:"2px solid "+S.actionBdr, color:S.infoText, marginBottom:"0.55rem" }) },
      "+ Save the board now"),
    manual.map(function(r){
      return React.createElement(SnapRow, { key:r.id, rec:r },
        React.createElement("button", { "data-snapload":r.id, disabled:clocked,
          onClick:function(){ setSub({ kind:"load", id:r.id, rec:r }); }, style:snapBtn({ opacity:clocked?0.4:1 }) }, "Load"),
        React.createElement(HoldButton, { onHold:function(){ delSave(r.id); }, holdMs:HOLD_DELETE_MS, fill:rgba(S.dangerText,0.38),
          attrs:{ "data-snapdelete":r.id, "aria-label":"Delete this save (hold)" },
          style:{ flex:"none", width:"34px", height:"34px", borderRadius:S.radius3, border:"1px solid "+S.borderBright,
                  background:S.bg2, color:S.textMuted, fontWeight:700, fontFamily:S.fontBody, padding:0 } }, "✕"));
    }));

  var resetSec = show("reset") && React.createElement("div", { "data-anchor":"saves-reset" },
    head("Start over"),
    React.createElement("button", { "data-resetopen":true, disabled:clocked, onClick:function(){ setSub({ kind:"reset" }); },
      style:Object.assign({}, btn, { background:S.dangerBg, border:"1.5px solid "+S.dangerText, color:S.dangerText, opacity:clocked?0.45:1 }) },
      "Reset…"));

  var fileSec = show("file") && React.createElement("div", null,
    head("Backup file"),
    React.createElement("div", { style:note },
      "Saves live on this phone: deleting the app from the home screen deletes them and your tracked time with it. Export a backup file regularly and keep it somewhere safe."),
    React.createElement("button", { "data-flat":true, "data-anchor":"backup-export", onClick:doExport, style:btn }, "Export Backup"),
    React.createElement("div", { style:Object.assign({}, note, { margin:"0.7rem 0 0.5rem" }) },
      "Restoring from a file replaces everything in the app, practice board included."),
    !pending && React.createElement("label", { "data-anchor":"backup-choose", style:Object.assign({},btn,{textAlign:"center"}) },
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
      React.createElement("button", { "data-flat":true, "data-anchor":"backup-replace", onClick:doRestore,
        style:Object.assign({},btn,{marginTop:"0.6rem",background:S.dangerBg2,
          border:"1.5px solid "+S.dangerText,color:S.dangerText}) },
        "Replace All Data & Restore"),
      React.createElement("button", { "data-flat":true, onClick:function(){ setPending(null); setStatus(null); },
        style:Object.assign({},btn,{marginTop:"0.45rem",fontWeight:600,color:S.textDim}) },
        "Pick a Different File")
    ));

  var main=React.createElement(Modal, { title:"Backup & Saves", onClose:props.onClose, cancelLabel:"Close" },
    autoSec, saveSec, resetSec, fileSec,
    status && React.createElement("div", { "data-snapstatus":status.ok?"ok":"bad", style:{marginTop:"0.6rem",fontSize:"0.8rem",fontFamily:S.fontBody,
      color:status.ok?S.successText:S.dangerText} }, status.msg)
  );
  var close=function(){ setSub(null); };
  var subEl=null;
  if(sub && sub.kind==="load") subEl=React.createElement(SnapLoadSheet, { rec:sub.rec, onClose:close });
  else if(sub && sub.kind==="reset") subEl=React.createElement(ResetSheet, { onClose:close });
  else if(sub && sub.kind==="tier") subEl=React.createElement(SnapTierSheet, { tier:sub.tier, recs:tier(sub.tier), clocked:clocked, onClose:close,
    onPick:function(r){ setSub({ kind:"load", id:r.id, rec:r }); } });
  else if(sub && sub.kind==="full") subEl=React.createElement(SnapFullSheet, { recs:manual, onClose:close,
    onReplace:function(id){ saveNow(id); } });
  return React.createElement(React.Fragment, null, main, subEl);
}
// Taking a copy first, then writing, then reloading: the board state lives
// in React and only a reload re-reads storage, exactly as Restore does.
function snapThenReload(why, write, setMsg){
  return snapTake(why).then(function(){
    write(ttDb.backend());
    setMsg({ ok:true, msg:"Done. Reloading…" });
    setTimeout(function(){ try{ location.reload(); }catch(e){} }, 400);
  }, function(){ setMsg({ ok:false, msg:"Could not take a backup first, so nothing was changed." }); });
}
function SnapTierSheet(props){
  var names={ daily:"Daily backups", weekly:"Weekly backups", monthly:"Monthly backups" };
  var words={ daily:"The last copy of each of the last seven days.", weekly:"The last copy of each of the last four weeks.",
              monthly:"The last copy of each of the last twelve months." };
  return React.createElement(Modal, { title:names[props.tier], onClose:props.onClose, cancelLabel:"Back" },
    React.createElement("div", { style:{ color:S.textDim, fontSize:"0.85rem", fontFamily:S.fontBody, marginBottom:"0.8rem", lineHeight:1.45 } },
      words[props.tier]+" The oldest rolls off as a new one comes in."),
    props.recs.map(function(r){
      return React.createElement(SnapRow, { key:r.id, rec:r, showWhy:true },
        React.createElement("button", { "data-snapload":r.id, disabled:props.clocked, onClick:function(){ props.onPick(r); },
          style:snapBtn({ opacity:props.clocked?0.4:1 }) }, "Load"));
    }));
}
function SnapFullSheet(props){
  var pickS=useState(null); var setPick=pickS[1]; var pick=pickS[0];
  var oldest=props.recs.length ? props.recs[props.recs.length-1].id : null;
  return React.createElement(Modal, { title:"Saves are full", onClose:props.onClose,
      actions:[React.createElement("button", { key:"c", onClick:props.onClose, style:MODAL_CANCEL() }, "Cancel")], ownActions:true },
    React.createElement("div", { style:{ color:S.textDim, fontSize:"0.88rem", fontFamily:S.fontBody, marginBottom:"0.8rem", lineHeight:1.45 } },
      "You have "+SNAP_MANUAL_WORD+" of "+SNAP_MANUAL_WORD+". Pick the one to replace with the board as it is now."),
    props.recs.map(function(r){
      var on=pick===r.id;
      return React.createElement("div", { key:r.id, "data-snappick":r.id, onClick:function(){ setPick(r.id); }, style:{ cursor:"pointer" } },
        React.createElement(SnapRow, { rec:r, style:{ border:on?"2px solid "+S.warnText:"1px solid "+S.border } },
          r.id===oldest ? React.createElement("span", { style:{ color:S.textMuted, fontSize:"0.72rem", fontWeight:700 } }, "OLDEST") : null));
    }),
    React.createElement(HoldButton, { disabled:!pick, onHold:function(){ props.onReplace(pick); }, holdMs:HOLD_DELETE_MS,
      fill:rgba(S.dangerText,0.38), attrs:{ "data-snapreplace":true },
      style:{ width:"100%", marginTop:"0.5rem", background:S.dangerBg, border:"1px solid "+S.dangerText, borderRadius:S.radius,
              padding:"0.7rem", color:S.dangerText, fontFamily:S.fontBody, fontWeight:700, fontSize:"0.9rem", opacity:pick?1:0.45 } },
      pick ? "Replace it · hold" : "Pick one to replace"));
}
var SNAP_MANUAL_WORD="five";
function snapCheck(on, locked, label, sub, onTap, attr){
  return React.createElement("div", { key:attr, "data-resetpick":attr, "data-on":on?"1":"0", "data-locked":locked?"1":"0",
      onClick:locked?null:onTap, style:{ display:"flex", gap:"0.6rem", alignItems:"flex-start", padding:"0.45rem 0.1rem",
      cursor:locked?"default":"pointer", opacity:locked?0.65:1 } },
    React.createElement("span", { style:{ width:"20px", height:"20px", flex:"none", marginTop:"1px", borderRadius:"5px",
        border:"2px solid "+(on?S.dangerText:S.borderBright), background:on&&!locked?S.dangerText:"transparent",
        color:on&&!locked?S.dangerBg:S.dangerText, display:"inline-flex", alignItems:"center", justifyContent:"center",
        fontSize:"0.8rem", fontWeight:900 } }, on?"✓":""),
    React.createElement("span", { style:{ flex:1 } },
      React.createElement("span", { style:{ display:"block", color:S.text, fontWeight:700, fontSize:"0.92rem", fontFamily:S.fontBody } }, label),
      sub ? React.createElement("span", { style:{ display:"block", color:S.textDim, fontSize:"0.76rem", fontFamily:S.fontBody, marginTop:"0.1rem" } }, sub) : null));
}
function snapGroup(title, kids){
  return React.createElement("div", null,
    React.createElement("div", { style:Object.assign({}, LABEL_STYLE, { margin:"0.8rem 0 0.35rem", fontWeight:700 }) }, title),
    React.createElement("div", { style:{ background:S.bg1, border:"1px solid "+S.border, borderRadius:S.radius, padding:"0.15rem 0.7rem" } }, kids));
}
function resetPickOf(sel, mods){
  function same(p){
    var want=Object.assign({ time:false, ticks:false, projects:false, archive:false, look:false, schedule:false, presets:false }, RESET_PICKS[p]);
    var allMods=p==="factory";
    return Object.keys(want).every(function(k){ return !!sel[k]===!!want[k]; }) &&
           mods.every(function(m){ return !!sel.modules[m.id]===allMods; });
  }
  return same("state") ? "state" : same("factory") ? "factory" : "custom";
}
function resetFromPick(p, mods){
  var sel=Object.assign({ modules:{} }, RESET_PICKS[p]);
  mods.forEach(function(m){ sel.modules[m.id]=p==="factory"; });
  return sel;
}
function ResetSheet(props){
  var mods=ttModules();
  var selS=useState(function(){ return resetFromPick("state", mods); }); var setSel=selS[1]; var sel=selS[0];
  var msgS=useState(null); var setMsg=msgS[1]; var msg=msgS[0];
  var eff=resetNormalize(sel), pick=resetPickOf(sel, mods);
  function flip(k){ setSel(function(s){ var n=Object.assign({}, s); n[k]=!s[k]; return n; }); }
  function flipMod(id){ setSel(function(s){ var m=Object.assign({}, s.modules); m[id]=!m[id]; return Object.assign({}, s, { modules:m }); }); }
  var lockByProj=!!sel.projects;
  var n=["time","ticks","projects","archive","look","schedule","presets"].filter(function(k){ return eff[k]; }).length +
        mods.filter(function(m){ return eff.modules[m.id]; }).length;
  var chip=function(p, label){
    var on=pick===p;
    return React.createElement("button", { key:p, "data-resetchip":p, onClick:function(){ haptic(8); setSel(resetFromPick(p, mods)); },
      style:{ flex:1, borderRadius:"999px", padding:"0.55rem 0.4rem", fontFamily:S.fontBody, fontWeight:700, fontSize:"0.86rem", cursor:"pointer",
              border:on?"2px solid "+S.actionBdr:"1px solid "+S.borderBright, background:on?S.infoBg:S.bg1, color:on?S.infoText:S.textDim } }, label);
  };
  function go(){
    haptic([20,50,20]);
    snapThenReload("before-reset", function(st){ resetApply(sel, st); }, setMsg);
  }
  return React.createElement(Modal, { title:"Reset", onClose:props.onClose, cancelLabel:"Cancel" },
    React.createElement("div", { style:{ display:"flex", gap:"0.45rem", marginBottom:"0.2rem" } },
      chip("state","Reset state"), chip("factory","Factory reset")),
    React.createElement("div", { "data-resetmode":pick, style:{ color:S.textDim, fontSize:"0.78rem", fontFamily:S.fontBody, margin:"0.45rem 0 0", minHeight:"2.3em", lineHeight:1.4 } },
      pick==="state" ? "Keeps your projects and setup. Clears the time so you can start recording clean."
      : pick==="factory" ? "Everything back to how the app ships."
      : "Your own mix. Tick what should go."),
    snapGroup("Board", [
      snapCheck(eff.time, lockByProj, "Logged time", lockByProj?"Goes with the projects":"Every entry, break and disruption", function(){ flip("time"); }, "time"),
      snapCheck(eff.ticks, lockByProj, "Finished ticks & milestone marks", lockByProj?"Goes with the projects":"Stages and steps go back to open", function(){ flip("ticks"); }, "ticks"),
      snapCheck(eff.projects, false, "Projects & lanes", "Back to the starter board", function(){ flip("projects"); }, "projects"),
      snapCheck(eff.archive, lockByProj, "The Archive", lockByProj?"Goes with the projects":"Closed projects are deleted", function(){ flip("archive"); }, "archive")
    ]),
    snapGroup("Settings", [
      snapCheck(eff.look, false, "Look & layout", "Theme, header, hand, tracking, alerts", function(){ flip("look"); }, "look"),
      snapCheck(eff.schedule, false, "Work schedule & pay cycle", null, function(){ flip("schedule"); }, "schedule"),
      snapCheck(eff.presets, false, "Disruption presets", null, function(){ flip("presets"); }, "presets")
    ]),
    mods.length ? snapGroup("Modules", mods.map(function(m){
      return snapCheck(!!eff.modules[m.id], false, m.title, "Its data only. It stays installed.", function(){ flipMod(m.id); }, "mod:"+m.id);
    })) : null,
    React.createElement("div", { style:{ display:"flex", gap:"0.5rem", color:S.textDim, fontSize:"0.78rem", fontFamily:S.fontBody, lineHeight:1.45,
        background:S.bg1, border:"1px dashed "+S.borderBright, borderRadius:S.radius, padding:"0.6rem 0.7rem", margin:"0.9rem 0 0.7rem" } },
      "A “Before reset” backup is taken first, so loading it puts everything back if this was a mistake. The practice board and your saves are never touched."),
    React.createElement(HoldButton, { disabled:n===0, onHold:go, holdMs:HOLD_DELETE_MS, fill:rgba(S.dangerText,0.38),
      attrs:{ "data-resetgo":n, "data-holddelete":true },
      style:{ width:"100%", background:S.dangerBg, border:"1px solid "+S.dangerText, borderRadius:S.radius, padding:"0.75rem",
              color:S.dangerText, fontFamily:S.fontBody, fontWeight:700, fontSize:"0.92rem", opacity:n?1:0.45 } },
      n ? "Reset "+(n===1?"one thing":n+" things")+" · hold" : "Tick something to reset"),
    msg && React.createElement("div", { "data-snapstatus":msg.ok?"ok":"bad", style:{ marginTop:"0.6rem", fontSize:"0.8rem", fontFamily:S.fontBody,
      color:msg.ok?S.successText:S.dangerText } }, msg.msg));
}
function SnapLoadSheet(props){
  var r=props.rec, mods=ttModules();
  var setS=useState("keep"); var setSet=setS[1]; var settingsPick=setS[0];
  var modS=useState(function(){ var o={}; mods.forEach(function(m){ o[m.id]=true; }); return o; }); var setModPick=modS[1]; var modPick=modS[0];
  var msgS=useState(null); var setMsg=msgS[1]; var msg=msgS[0];
  function go(){
    haptic([20,50,20]);
    snapGet(r.id).then(snapUnpack).then(function(json){
      var data=JSON.parse(json);
      return snapThenReload("before-load", function(st){
        snapApplyLoad(data, st, { keepSettings:settingsPick==="keep", modules:modPick });
      }, setMsg);
    }).catch(function(){ setMsg({ ok:false, msg:"That copy could not be read, so nothing was changed." }); });
  }
  return React.createElement(Modal, { title:r.kind==="manual"?"Load this save?":"Load this backup?", onClose:props.onClose, cancelLabel:"Cancel" },
    React.createElement(SnapRow, { rec:r, showWhy:true }),
    React.createElement("div", { style:{ color:S.textDim, fontSize:"0.88rem", fontFamily:S.fontBody, margin:"0.4rem 0 0.8rem" } },
      "Your board becomes exactly this copy."),
    React.createElement("div", { style:{ background:S.bg1, border:"1px solid "+S.border, borderRadius:S.radius, padding:"0.7rem 0.8rem" } },
      React.createElement("div", { style:{ color:S.text, fontWeight:700, fontSize:"0.92rem", fontFamily:S.fontBody, marginBottom:"0.45rem" } }, "Settings"),
      React.createElement(Toggle, { name:"loadsettings", keys:["keep","use"], value:settingsPick, onChange:setSet,
        labelOf:function(k){ return k==="keep" ? "Keep mine" : "Use the copy’s"; } }),
      mods.length ? React.createElement("div", { style:{ color:S.text, fontWeight:700, fontSize:"0.92rem", fontFamily:S.fontBody, margin:"0.8rem 0 0.1rem" } }, "Modules") : null,
      mods.map(function(m){
        return React.createElement("div", { key:m.id }, snapCheck(!!modPick[m.id], false, m.title,
          modPick[m.id] ? "Load its data from the copy too" : "Keep its data as it is now",
          function(){ setModPick(function(o){ var n=Object.assign({}, o); n[m.id]=!o[m.id]; return n; }); }, "loadmod:"+m.id));
      })),
    React.createElement("div", { style:{ color:S.textDim, fontSize:"0.78rem", fontFamily:S.fontBody, lineHeight:1.45,
        background:S.bg1, border:"1px dashed "+S.borderBright, borderRadius:S.radius, padding:"0.6rem 0.7rem", margin:"0.9rem 0 0.7rem" } },
      "A “Before load” backup is taken first, so you can come straight back."),
    React.createElement(HoldButton, { onHold:go, holdMs:HOLD_DELETE_MS, fill:rgba(S.infoText,0.3), attrs:{ "data-loadgo":r.id },
      style:{ width:"100%", background:S.infoBg, border:"2px solid "+S.actionBdr, borderRadius:S.radius, padding:"0.75rem",
              color:S.infoText, fontFamily:S.fontBody, fontWeight:700, fontSize:"0.92rem" } }, "Load · hold"),
    msg && React.createElement("div", { "data-snapstatus":msg.ok?"ok":"bad", style:{ marginTop:"0.6rem", fontSize:"0.8rem", fontFamily:S.fontBody,
      color:msg.ok?S.successText:S.dangerText } }, msg.msg));
}

// ---- EXTENSIONS MODAL -------------------------------------------------------
// Phase 2: the à la carte switchboard. Every registered module is listed here
// whether it is on or off - this screen is the only place enablement changes.
// Switching a module off hides it everywhere but keeps its data, so the choice
// is always reversible; throwing the data away is a separate, deliberate act.
function fmtBytes(n){
  if(n<1024) return n+" B";
  if(n<1024*1024) return (n/1024).toFixed(n<10240?1:0)+" KB";
  return (n/1048576).toFixed(1)+" MB";
}
function ExtensionsModal(props){
  var tickS=useState(0); var setTick=tickS[1]; var tick=tickS[0];
  var confirmS=useState(null); var setConfirm=confirmS[1]; var confirm=confirmS[0];
  var mods=ttModules();

  function refresh(){ setTick(function(x){ return x+1; }); if(props.onChange) props.onChange(); }
  function flip(m, on){
    haptic(10);
    ttSetModuleEnabled(m.id, on);
    setConfirm(null);
    refresh();
  }
  function wipe(m){
    haptic([12,40,12]);
    ttClearModuleData(m.id);
    setConfirm(null);
    refresh();
  }

  var rowBox={ background:S.bg1, border:"1px solid "+S.border, borderRadius:S.radius,
               padding:"0.8rem 0.9rem", marginBottom:"0.7rem" };
  var titleRow={ display:"flex", alignItems:"baseline", gap:"0.5rem", marginBottom:"0.2rem" };
  var summary={ fontSize:"0.8rem", color:S.textDim, marginBottom:"0.6rem", lineHeight:1.35 };
  var metaRow={ display:"flex", alignItems:"center", justifyContent:"space-between",
                gap:"0.5rem", marginTop:"0.55rem", fontSize:"0.72rem", color:S.textDim };

  var body = mods.length===0
    ? React.createElement("div", { style:{ border:"2px dashed "+S.borderBright, borderRadius:S.radius,
        padding:"1.1rem 0.9rem", textAlign:"center" } },
        React.createElement("div", { style:{ color:S.text, fontWeight:700, fontSize:"0.92rem", marginBottom:"0.35rem" } },
          "No extensions yet"),
        React.createElement("div", { style:{ color:S.textDim, fontSize:"0.82rem", lineHeight:1.4 } },
          "Extensions add new kinds of record beside the timer - tools, materials, "+
          "build steps. They ship inside the app and switch on here.")
      )
    : React.createElement("div", null,
        mods.map(function(m){
          var on=ttModuleEnabled(m.id);
          var use=ttModuleUsage(m.id);
          var asking=confirm===m.id;
          return React.createElement("div", { key:m.id, style:rowBox },
            React.createElement("div", { style:titleRow },
              React.createElement("span", { style:{ flex:1, minWidth:0, color:S.text, fontWeight:700,
                fontSize:"0.95rem", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" } }, m.title),
              React.createElement(Mono, { "data-anchor":"ext-version", style:{ fontSize:"0.7rem", color:S.textMuted, flexShrink:0 } }, "v"+m.version)
            ),
            m.summary && React.createElement("div", { style:summary }, m.summary),
            React.createElement(Toggle, {
              name:m.title, keys:["off","on"], value:on?"on":"off",
              labelOf:function(k){ return k==="on" ? "On" : "Off"; },
              onChange:function(v){ flip(m, v==="on"); }
            }),
            React.createElement("div", { "data-anchor":"ext-data", style:metaRow },
              React.createElement("span", null,
                use.keys ? (use.keys+(use.keys===1?" key":" keys")+" \u00B7 "+fmtBytes(use.bytes)) : "no data stored"),
              use.keys>0 && !asking && React.createElement("button", { "data-flat":true,
                onClick:function(){ haptic(8); setConfirm(m.id); },
                style:{ background:"none", border:"none", padding:"0.2rem 0.1rem", color:S.dangerText,
                        cursor:"pointer", fontFamily:S.fontBody, fontWeight:600, fontSize:"0.72rem" } },
                "Delete data")
            ),
            // Deleting is destructive and irreversible, so it asks - and says
            // plainly that a backup is the way back.
            asking && React.createElement("div", { style:{ marginTop:"0.55rem", background:S.dangerBg2,
                border:"1px solid "+S.dangerTint, borderRadius:S.radius3, padding:"0.65rem 0.7rem" } },
              React.createElement("div", { style:{ color:S.dangerText, fontSize:"0.78rem", marginBottom:"0.55rem", lineHeight:1.35 } },
                "Delete everything "+m.title+" has stored? This cannot be undone except from a backup."),
              React.createElement("div", { style:{ display:"flex", gap:"0.45rem" } },
                React.createElement("button", { onClick:function(){ wipe(m); },
                  style:{ flex:1, background:S.dangerBg, border:"1px solid "+S.dangerBright, borderRadius:S.radius3,
                          padding:"0.6rem", color:S.dangerText, cursor:"pointer", fontWeight:700,
                          fontFamily:S.fontBody, fontSize:"0.82rem" } }, "Delete"),
                React.createElement("button", { onClick:function(){ setConfirm(null); },
                  style:{ flex:1, background:S.bg1, border:"1px solid "+S.border, borderRadius:S.radius3,
                          padding:"0.6rem", color:S.textDim, cursor:"pointer",
                          fontFamily:S.fontBody, fontSize:"0.82rem" } }, "Keep")
              )
            )
          );
        })
      );

  return React.createElement(Modal, { title:"Extensions", onClose:props.onClose, cancelLabel:"Close" },
    React.createElement("div", { style:{ fontSize:"0.8rem", color:S.textDim, marginBottom:"0.85rem", lineHeight:1.4 } },
      "Switching one off hides it everywhere and keeps its data. Everything here "+
      "is included in Backup & Saves."),
    body
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
    React.createElement("div", { style:{marginBottom:"1.1rem"}, "data-anchor":"ub-every" },
      React.createElement("div", { style:sectionHead }, "Every Work Day"),
      React.createElement("div", { style:sectionNote }, "Deducted from each scheduled day."),
      ub.weekly.map(function(b){ return breakCard(null, b); }),
      addBtn(null)
    ),
    // custom daily
    React.createElement("div", { style:{marginBottom:"0.9rem"}, "data-anchor":"ub-custom" },
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
    weekDeduct>0 && React.createElement("div", { "data-anchor":"ub-total", style:{display:"flex",justifyContent:"space-between",
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
    React.createElement("div", { style:sectionBox },
      React.createElement("div", { style:sectionHead }, "Shift Boundary"),
      React.createElement("div", { style:note },
        "Clocking in outside your scheduled hours asks which shift the time belongs to, "+
        "because there is no safe way to guess. Grace silences that question near the "+
        "edges of the shift - at 15 minutes, arriving at 05:50 for a 06:00 start files "+
        "under today without asking."),
      React.createElement(Toggle, {
        name:"shiftgrace", keys:["0","15","30","60"],
        value:String(normalizeGrace(settings.shiftGrace)),
        labelOf:function(k){ return k==="0" ? "Always ask" : k+" min"; },
        onChange:function(v){ set("shiftGrace", parseInt(v,10)); }
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

// ---- THEMES MODAL -----------------------------------------------------------
// Appearance only: what the app looks like. Split from Layout because the two
// are chosen at different moments - a theme is picked once and left alone,
// while handedness and header position get moved around as the job does.
// The shared section furniture lives in SETTINGS_BOXES so the two modals cannot
// drift into looking like different apps.
function SETTINGS_BOXES(){
  return {
    head:{fontSize:"0.75rem",textTransform:"uppercase",letterSpacing:"0.1em",color:S.textDim,fontWeight:700,marginBottom:"0.4rem"},
    box:{background:S.bg1,border:"1px solid "+S.border,borderRadius:S.radius,padding:"0.75rem 0.9rem",marginBottom:"0.85rem"},
    placeholder:{border:"2px dashed "+S.borderBright,borderRadius:S.radius3,padding:"0.6rem 0.8rem",color:S.textMuted,fontSize:"0.82rem",textAlign:"center"},
    subHead:{fontSize:"0.72rem",textTransform:"uppercase",letterSpacing:"0.08em",color:S.textMuted,fontWeight:700,margin:"0.95rem 0 0.35rem"},
    note:{fontSize:"0.78rem",color:S.textDim,marginBottom:"0.5rem"},
    closeBtn:{width:"100%",background:S.bg1,border:"1px solid "+S.border,borderRadius:S.radius,padding:"0.85rem",color:S.textDim,cursor:"pointer",fontFamily:S.fontBody,fontWeight:600}
  };
}
function ThemesModal(props){
  var settings=props.settings, onChange=props.onChange, onClose=props.onClose;
  var B=SETTINGS_BOXES();
  function set(key, val){ var n=Object.assign({},settings); n[key]=val; onChange(n); }
  var themeKey=themeKeyOf(settings);

  return (
    React.createElement(Modal, { title:"Themes", onClose:onClose, onSave:onClose, wide:true },
      // Ordered the way it is chosen: theme first, then the palette and type
      // that theme allows, then the mode it renders in.
      React.createElement("div", { style:B.box },
        React.createElement("div", { style:B.head }, "Theme"),
        React.createElement("div", { style:B.note }, "Shape, texture and type. Each theme carries its own palettes and faces."),
        React.createElement(Carousel, {
          name:"theme", keys:Object.keys(THEMES), value:themeKey,
          labelOf:function(k){ return THEMES[k].label; },
          onChange:function(v){ set("theme", v); }
        }),

        React.createElement("div", { style:B.subHead }, "Colour palette"),
        React.createElement("div", { style:B.note }, "Only the palettes this theme allows."),
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

        React.createElement("div", { style:B.subHead }, "Typeface"),
        React.createElement("div", { style:B.note }, "Shown in its own face. Each theme remembers the one you picked for it."),
        React.createElement(Carousel, {
          name:"typeface", keys:Object.keys(THEMES[themeKey].fonts), value:fontKeyOf(settings),
          labelOf:function(k){ return THEMES[themeKey].fonts[k].label; },
          fontOf: function(k){ return THEMES[themeKey].fonts[k].body; },
          onChange:function(v){
            var n=Object.assign({}, settings.fonts||{}); n[themeKey]=v;
            set("fonts", n);
          }
        }),

        React.createElement("div", { style:B.subHead }, "Mode"),
        React.createElement(Toggle, {
          name:"mode", keys:["dark","light"], value:settings.mode==="light"?"light":"dark",
          labelOf:function(k){ return k==="dark"?"Dark":"Light"; },
          onChange:function(v){ set("mode", v); }
        })
      ),

      React.createElement("button", { onClick:onClose, style:B.closeBtn }, "Close")
    )
  );
}

// ---- LAYOUT MODAL -----------------------------------------------------------
// Where things sit and how they are reached. Module settings panels land here
// rather than in Themes: a module's options are about how it behaves, which is
// nearer to layout than to palette. The contract field is still the single
// `settingsPanel`, so no module has to change - if one ever needs the Themes
// side instead, that is a new optional field rather than a rearrangement.
function LayoutModal(props){
  var settings=props.settings, onChange=props.onChange, onClose=props.onClose;
  var B=SETTINGS_BOXES();
  function set(key, val){ var n=Object.assign({},settings); n[key]=val; onChange(n); }

  return (
    React.createElement(Modal, { title:"Layout", onClose:onClose, onSave:onClose, wide:true },
      React.createElement("div", { style:B.box },
        React.createElement("div", { style:B.head }, "Density"),
        React.createElement("div", { style:{fontSize:"0.8rem",color:S.textDim,marginBottom:"0.55rem"} },
          "Card sizes, spacing, and what shows on each row."),
        React.createElement("div", { style:B.placeholder }, "Options coming soon")
      ),

      // Reach: which hand holds the phone, and which end of the screen the bar sits at.
      React.createElement("div", { style:B.box },
        React.createElement("div", { style:B.head }, "Handedness"),
        React.createElement("div", { style:B.note }, "Mirrors the whole layout so controls fall under your thumb."),
        React.createElement(Toggle, {
          name:"hand", keys:["left","right"], value:settings.handedness==="left"?"left":"right",
          labelOf:function(k){ return k==="left"?"Left Hand":"Right Hand"; },
          onChange:function(v){ set("handedness", v); }
        })
      ),
      React.createElement("div", { style:B.box },
        React.createElement("div", { style:B.head }, "Header Position"),
        React.createElement("div", { style:B.note }, "Swipe up or down to move the control bar to that end of the screen."),
        React.createElement(Toggle, {
          name:"header", axis:"y", keys:["top","bottom"], value:settings.headerPos==="bottom"?"bottom":"top",
          labelOf:function(k){ return k==="top"?"Top":"Bottom"; },
          onChange:function(v){ set("headerPos", v); }
        })
      ),

      // Module panels, each in the same section box the core uses, so a module
      // cannot drift from the settings language. None registered yet.
      ttSettingsPanels().map(function(m){
        return React.createElement("div", { key:m.id, style:B.box },
          React.createElement("div", { style:B.head }, m.title),
          React.createElement(m.settingsPanel, ttModuleContext(m.id, { settings:settings, onChange:onChange }))
        );
      }),

      React.createElement("button", { onClick:onClose, style:B.closeBtn }, "Close")
    )
  );
}

// ---- THE OUTLINE EDITOR ------------------------------------------------------
// One screen for the whole board: lanes, the projects and tasks inside them,
// and the stages hanging off those.
//
// Tap a row's glyph to select it; a controller rises from the bottom with a
// d-pad and, where it means something, a choice of how the row should nest.
// Tap a row's name to open that item's own editor instead.
//
// Buttons rather than dragging. Dragging on iOS lost a week to Safari
// claiming the gesture for scrolling before the first touchmove, with
// touch-action ignored. Buttons have no gesture to lose, work the same in a
// list long enough to scroll, and make nesting explicit: the role a row takes
// when it nests is chosen, not inferred from where it landed.
// ---- ROW MENUS ---------------------------------------------------------------
// One menu per kind, built here and used by BOTH the outline and the board -
// so a lane's menu offers the same things in the same order whichever screen
// it is opened from. Edit first, then what can be added from here, from the
// same level inward. "Add project" / "Add task" on a record is a SIBLING;
// "Add nested" goes inside. Stages are a list on their host, so both stage
// entries open that list.
//
// `a` is the set of actions the caller can perform; an entry whose action is
// missing is left out rather than rendered dead.
function rowMenuItems(kind, role, a){
  var out=[];
  function add(label, glyph, fn){ if(fn) out.push({ label:label, glyph:glyph, go:fn }); }
  if(kind==="lane"){
    add("Edit lane",   "lanes",     a.edit);
    add("New lane",    "lanes",     a.newLane);
    add("New project", "project",   a.newProject);
    add("Milestones",  "milestone", a.milestones);
  } else if(kind==="stage"){
    add("Edit stage",  "stages",  a.edit);
    add("Add stage",   "stages",  a.edit);
  } else if(role==="task"){
    add("Edit task",        "task",   a.edit);
    add("Add task",         "task",   a.addSibling);
    add("Add nested task",  "task",   a.addNestedTask);
    add("Add stages",       "stages", a.stages);
  } else {
    add("Edit project",       "project", a.edit);
    add("Add project",        "project", a.addSibling);
    add("Add nested project", "project", a.addNestedProject);
    add("Add task",           "task",    a.addTask);
    add("Add stages",         "stages",  a.stages);
    add("Milestones",         "milestone", a.milestones);
  }
  return out;
}
// The rows of a menu, drawn the same way everywhere: glyph, label, a rule
// between. `after` is an optional array of extra elements the caller appends
// (the board's Close Out, for one) so the shared part stays identical.
function MenuRows(props){
  var items=props.items||[], onPick=props.onPick;
  return items.map(function(it, n){
    return React.createElement("button", { key:it.label, "data-flat":true, "data-rowmenuitem":it.label,
      onClick:function(){ if(onPick) onPick(); it.go(); },
      style:{display:"flex",alignItems:"center",gap:"0.65rem",width:"100%",textAlign:"left",
             background:"none",border:"none",borderBottom:"1px solid "+S.border,
             padding:"0.8rem 1rem",color:S.text,cursor:"pointer",
             fontFamily:S.fontBody,fontWeight:600,fontSize:"0.92rem",
             WebkitTapHighlightColor:"transparent"} },
      React.createElement(MenuIcon, { name:it.glyph, size:20, col:S.chromeText }),
      React.createElement("span", { style:{flex:1} }, it.label));
  });
}
var OUTLINE_INDENT = 15;   // px per level
// A miniature of the controller itself, sitting outside each row on the
// trailing edge. Tapping it selects the row exactly as the row's own glyph
// does - one more place to reach for, and the one that looks like what it
// opens. Four separate keys with chevrons, the same shape as the real pad.
//
// It lives in a fixed box and scales inside it, so growing on selection does
// not reflow the row. Written after the row, so dir mirrors it to the left in
// left-handed mode with no conditional.
var GRIP_BOX = 40, GRIP_REST = 32, GRIP_SEL = 38;
// A row's name, with single tap for its menu and double tap to edit. It is a
// component of its own for one reason: useTaps is a hook, and a hook called
// inside rows.map() is a hook inside a loop. That rendered fine right up until
// the number of rows changed - which is what adding a record does - and then
// React threw #310 ("rendered more hooks than during the previous render")
// and took the whole app down. Every add in the app looked broken because of
// one hook in the wrong place.
function OutlineName(props){
  var r=props.row, isLane=r.kind==="lane";
  var onTap=useTaps(props.onSingle, props.onDouble);
  return React.createElement("button", { "data-outlineopen":r.key, onClick:onTap,
    style:{flex:1,textAlign:"left",background:"none",border:"none",padding:"0.4rem 0",cursor:"pointer",
           fontFamily:S.fontBody,minWidth:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",
           fontWeight:isLane?700:600, fontSize:isLane?"0.88rem":"0.85rem",
           letterSpacing:isLane?"0.06em":"normal", textTransform:isLane?"uppercase":"none",
           color:r.kind==="stage"?S.textDim:(r.accent||S.text)} },
    r.name || "(untitled)");
}
function RowGrip(props){
  var size=props.on?GRIP_SEL:GRIP_REST, col=props.on?S.text:S.textDim;
  // Every key must fit the 28-unit box INCLUDING its stroke. The first
  // version reached -1.85 to 29.85 and had all four outer walls clipped off,
  // which turned the cross into what looked like a lattice. Reach is
  // offset + half the key + half the stroke: 8.2 + 4.8 + 0.9 = 13.9, inside 14.
  var GRIP_OFF = 8.2, GRIP_KEY = 9.6, GRIP_SW = 1.8;
  var h=GRIP_KEY/2;
  var keys=[["up",14,14-GRIP_OFF],["down",14,14+GRIP_OFF],
            ["left",14-GRIP_OFF,14],["right",14+GRIP_OFF,14]];
  var chev={ up:"M-2 1.15 L0 -1.15 L2 1.15", down:"M-2 -1.15 L0 1.15 L2 -1.15",
             left:"M1.15 -2 L-1.15 0 L1.15 2", right:"M-1.15 -2 L1.15 0 L-1.15 2" };
  return React.createElement("button", { "data-rowgrip":props.rowKey, onClick:props.onPick,
    "aria-label":"Move this row", "aria-pressed":props.on?"true":"false",
    style:{width:GRIP_BOX+"px",height:GRIP_BOX+"px",flexShrink:0,padding:0,background:"none",
           border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
           WebkitTapHighlightColor:"transparent"} },
    React.createElement("svg", { width:size, height:size, viewBox:"0 0 28 28", fill:"none" },
      keys.map(function(k){
        return React.createElement(React.Fragment, { key:k[0] },
          React.createElement("rect", { x:k[1]-h, y:k[2]-h, width:GRIP_KEY, height:GRIP_KEY,
            rx:GRIP_KEY*0.29, fill:"none", stroke:col, strokeWidth:String(GRIP_SW) }),
          React.createElement("path", { d:chev[k[0]], stroke:col, strokeWidth:"1.45",
            strokeLinecap:"round", strokeLinejoin:"round", fill:"none",
            transform:"translate("+k[1]+","+k[2]+")" }));
      })));
}
function OutlineModal(props){
  var laneOrder=props.laneOrder, laneMeta=props.laneMeta, projects=props.projects;
  var onOpen=props.onOpen, onSave=props.onSave, onClose=props.onClose;
  var rowsS=useState(function(){ return outlineRows(laneOrder, laneMeta, projects); });
  var setRows=rowsS[1]; var rows=rowsS[0];
  // Editing a row's details happens in a child sheet on top of this one, and
  // this one stays mounted so its unsaved moves survive. When the board comes
  // back changed - a rename, a deletion, a stage added - the new content is
  // folded in without disturbing the arrangement being worked on.
  var firstS=useRef(true);
  useEffect(function(){
    if(firstS.current){ firstS.current=false; return; }
    setRows(function(prev){ return mergeOutline(prev, outlineRows(laneOrder, laneMeta, projects)); });
  }, [projects, laneMeta, laneOrder]);
  var selS=useState(props.initialSel||null); var setSel=selS[1]; var sel=selS[0];          // row key
  var roleS=useState("task"); var setRole=roleS[1]; var role=roleS[0];   // how it would nest
  var askS=useState(null); var setAsk=askS[1]; var ask=askS[0];
  // Single tap on a name opens that row's menu, double tap edits it - the same
  // pair the board uses, so the gesture means one thing wherever you are.
  var menuS=useState(null); var setRowMenu=menuS[1]; var rowMenu=menuS[0];

  var idx=-1;
  for(var n=0;n<rows.length;n++) if(rows[n].key===sel) idx=n;
  var cur=idx>=0 ? rows[idx] : null;
  var can=cur ? stepOptions(rows, idx, role) : null;
  var roles=can ? can.roles : [];
  // The chosen role has to stay one the host can actually hold: selecting a
  // new row, or moving this one, can take "project" off the table.
  useEffect(function(){
    if(roles.length && roles.indexOf(role)<0) setRole(roles[0]);
  }, [sel, roles.join(",")]);
  // Keep the selected row in view: the controller covers the bottom of the
  // sheet, and a row stepped past that edge would vanish behind it.
  // Not when staged in a guide: there it would scroll the GUIDE, and the app
  // drops taps while anything scrolls - Back and Next went dead.
  var stagedOutline = (StageCtx && React.useContext) ? React.useContext(StageCtx) : false;
  useEffect(function(){
    if(stagedOutline) return;
    if(!sel || typeof document==="undefined" || !document.querySelector) return;
    var el=document.querySelector('[data-outlinekey="'+sel+'"]');
    if(el && el.scrollIntoView) el.scrollIntoView({ block:"nearest", behavior:"smooth" });
  }, [sel, rows]);

  // The same entries the board's popups offer, so nothing new has to be
  // learned: a lane can take a project or a new lane beside it, a project can
  // take a task or stages, and everything can be edited.
  // Each kind's menu, in a fixed order: edit first, then the things that can
  // be added from here, from the same level inward. "Add project" on a
  // project is a SIBLING - another beside this one, at the same level; "Add
  // nested project" goes inside it. Tasks follow the same pattern. Stages
  // are a list on their host, so both of theirs open that list.
  function outlineMenuItems(r){
    var edit=function(){ onOpen(r); };
    return rowMenuItems(r.kind, r.role, {
      edit:edit,
      newLane:function(){ props.onNewLane(); },
      newProject:function(){ props.onAddProject(r.id); },
      addSibling:function(){ props.onAddSibling(r.id); },
      addNestedProject:function(){ props.onAddProjectUnder(r.id); },
      addNestedTask:function(){ props.onAddTask(r.id); },
      addTask:function(){ props.onAddTask(r.id); },
      stages:function(){ props.onEditStages(r.id); },
      milestones: r.kind==="lane" ? function(){ props.onLaneMilestones(r.id); }
                : (r.role!=="task" ? function(){ props.onMilestones(r.id); } : null)
    });
  }
  function apply(res){
    if(!res || !cur) return;
    var commit=function(){ setRows(res.rows); setAsk(null); haptic(14); };
    if(res.crossed){
      setAsk({ apply:commit, label:"Move \u201c"+cur.name+"\u201d out of \u201c"+res.crossed.from.name+"\u201d into \u201c"+res.crossed.into.name+"\u201d?" });
      return;
    }
    if(res.converted && res.converted.lane){
      setAsk({ apply:commit, label:"Turn the lane \u201c"+cur.name+"\u201d into a project inside \u201c"+res.converted.intoLane.name+"\u201d? Its projects become nested under it." });
      return;
    }
    if(res.converted && res.converted.project){
      setAsk({ apply:commit, label:"Give \u201c"+cur.name+"\u201d a lane of its own, after \u201c"+res.converted.outOfLane.name+"\u201d? It moves into the new lane with everything under it, and stays a project." });
      return;
    }
    commit();
  }
  var glyphFor=function(r){
    if(r.kind==="lane") return "lanes";
    if(r.kind==="stage") return "stages";
    return r.role==="task" ? "task" : "project";
  };
  // The parent a row sits in, for the controller's subtitle.
  function parentName(i){
    var P=parentIndex(rows,i);
    if(P<0) return null;
    return rows[P].name;
  }
  // The pad: four separate keys, so an impossible direction is plainly absent
  // rather than a greyed arm of one shape.
  function padKey(dir, on, fn){
    var d={ up:"M-4.2 2.5 L0 -2.5 L4.2 2.5", down:"M-4.2 -2.5 L0 2.5 L4.2 -2.5",
            left:"M2.5 -4.2 L-2.5 0 L2.5 4.2", right:"M-2.5 -4.2 L2.5 0 L-2.5 4.2" }[dir];
    var pos={ up:[38,10], down:[38,66], left:[10,38], right:[66,38] }[dir];
    return React.createElement("button", { key:dir, "data-pad":dir, onClick:on?fn:undefined, disabled:!on,
      "aria-label":{up:"Move up",down:"Move down",left:"Lift out",right:"Nest in"}[dir],
      // A live key is a filled square with a bright border; a dead one keeps
      // its outline but loses the fill. The difference is the fill and the
      // colour, not dimness - at 0.28 with no border the pad stopped reading
      // as a pad at all once most directions were unavailable.
      style:{position:"absolute",left:pos[0]+"px",top:pos[1]+"px",width:"32px",height:"32px",
             display:"flex",alignItems:"center",justifyContent:"center",padding:0,
             background:on?S.bg3:"transparent",border:"2px solid "+(on?S.textDim:S.textMuted),
             borderRadius:"9px",cursor:on?"pointer":"default",opacity:on?1:0.6,
             WebkitTapHighlightColor:"transparent"} },
      React.createElement("svg", { width:16, height:16, viewBox:"-8 -8 16 16", fill:"none" },
        React.createElement("path", { d:d, stroke:on?S.text:S.textMuted, strokeWidth:"2.5",
          strokeLinecap:"round", strokeLinejoin:"round" })));
  }
  function rolePill(kind, label){
    var on=roles.indexOf(kind)>=0, picked=role===kind && on;
    return React.createElement("button", { key:kind, "data-role":kind,
      onClick:on?function(){ setRole(kind); }:undefined, disabled:!on,
      style:{flex:1,padding:"0.55rem 0.4rem",borderRadius:S.radius3,
             background:picked?S.infoBg:S.bg1, border:"2px solid "+(picked?S.actionBdr:S.border),
             color:on?(picked?S.infoText:S.text):S.textMuted, opacity:on?1:0.4,
             cursor:on?"pointer":"default", fontFamily:S.fontBody, fontWeight:700,
             fontSize:"0.8rem", WebkitTapHighlightColor:"transparent"} }, label);
  }
  // Why a choice is missing, said plainly rather than left as a dead control.
  var roleNote = !cur ? "" :
    cur.kind!=="node" ? (cur.kind==="lane" ? "Lanes move up and down only." : "Stages stay with their project.")
    : !roles.length ? "Nothing above this to nest into."
    : roles.length===1 ? "A task can only hold tasks." : "";

  return React.createElement(React.Fragment, null,
    // The controller floats OVER the foot of the sheet, Save/Cancel included,
    // rather than the sheet shrinking to make room. Moving and saving are two
    // separate moments: Done puts the controller away, and the action row is
    // there underneath it.
    React.createElement(Modal, { actions:[React.createElement("button", { key:"a0", "data-anchor":"outline-save", onClick:function(){ onSave(rows); }, style:MODAL_SAVE() }, "Save"),
          React.createElement("button", { key:"a1", onClick:onClose, style:MODAL_CANCEL() }, "Cancel")], title:"Edit\u2026", onClose:onClose, wide:true, ownActions:true },
      React.createElement("div", { style:{fontSize:"0.72rem",color:S.textMuted,marginBottom:"0.8rem",lineHeight:1.4} },
        "Tap a row\u2019s icon to move it. Tap its name for its menu, twice to edit it."),
      React.createElement("div", { style:{display:"flex",flexDirection:"column",gap:"0.3rem",
             marginBottom:cur?"11rem":"0.5rem"} },
        rows.map(function(r, i){
          var isLane=r.kind==="lane", picked=r.key===sel;
          var pick=function(){ setSel(picked?null:r.key); haptic(10); };
          // A column: the row line - box plus grip beside it, outside the
          // border - and under it the row's own menu when it is open.
          // The row line is the popup's anchor: the menu hangs off it the way
          // a lane header's does on the board, rather than pushing the rows
          // below it down the list.
          return React.createElement("div", { key:r.key,
            style:{position:"relative", zIndex:rowMenu===r.key?60:undefined} },
          React.createElement("div", { style:{display:"flex",alignItems:"center",gap:"0.15rem"} },
          React.createElement("div", { "data-outlinekey":r.key,
            style:{display:"flex",alignItems:"center",gap:"0.5rem",flex:1,minWidth:0,
                   marginLeft:(r.level*OUTLINE_INDENT)+"px",
                   background:picked?S.infoBg:(isLane?rgba(r.accent||S.border,0.14):S.bg1),

                   border:"2px solid "+(picked?S.actionBdr:(isLane?(r.accent||S.border):S.border)),
                   borderRadius:S.radius3, padding:"0.35rem 0.5rem"} },
            React.createElement("button", { "data-outlinepick":r.key, onClick:pick,
              "aria-pressed":picked?"true":"false",
              style:{width:"38px",height:"38px",display:"flex",alignItems:"center",justifyContent:"center",
                     flexShrink:0,padding:0,borderRadius:S.radius3,cursor:"pointer",
                     background:picked?rgba(S.actionBdr,0.25):"transparent",
                     border:"1px solid "+(picked?S.actionBdr:"transparent"),
                     WebkitTapHighlightColor:"transparent"} },
              React.createElement(MenuIcon, { name:glyphFor(r), size:isLane?20:18, col:r.accent||S.chromeText })),
            React.createElement(OutlineName, { row:r,
              onSingle:function(){ setRowMenu(function(x){ return x===r.key ? null : r.key; }); },
              onDouble:function(){ setRowMenu(null); onOpen(r); } })
          ),
          React.createElement(RowGrip, { rowKey:r.key, on:picked, onPick:pick })
          ),
          // The row's milestone line, when it has one. A lane's is its roll-up,
          // a project's its own steps plus children; a task has none.
          (r.kind==="lane" || (r.kind==="node" && r.role!=="task")) && (function(){
            // The FULL record set, closed ones included - targets are closed
            // records, and the outline is otherwise handed only what is open.
            var all=props.msProjects||projects;
            var pts = r.kind==="lane" ? laneLine(all, r.id, Date.now())
                    : subtreePoints(all, r.id, Date.now());
            if(!pts.length) return null;
            return React.createElement("div", { style:{marginLeft:(r.level*OUTLINE_INDENT)+"px",marginRight:(GRIP_BOX+2)+"px"} },
              React.createElement(MilestoneStrip, { weekStart:weekStartOf(props.schedule), kind:r.kind==="lane"?"lane":"project", points:pts, tight:true,
                offDays:props.offDays, onOpen:function(){ r.kind==="lane" ? props.onLaneMilestones(r.id) : props.onMilestones(r.id); } }));
          })(),
          // Same shape as the board's popups: absolute, hanging under its
          // anchor, above the rows beneath it rather than shoving them aside.
          // Deliberately NOT data-surface="menu": that rule makes a menu glass,
          // which works over the board but reads as muddy over the rows of the
          // sheet it is inside. Same shape, solid fill.
          rowMenu===r.key && React.createElement("div", { "data-rowmenu":r.key,
            style:{position:"absolute",top:"calc(100% + 4px)",
                   left:UI.left?"auto":((r.level*OUTLINE_INDENT)+12)+"px",
                   right:UI.left?((r.level*OUTLINE_INDENT)+12)+"px":"auto",
                   minWidth:"210px",background:S.bg2,border:"1px solid "+S.borderBright,
                   borderRadius:S.radius2,overflow:"hidden",
                   boxShadow:"0 8px 32px rgba(0,0,0,0.6)"} },
            React.createElement(MenuRows, { items:outlineMenuItems(r), onPick:function(){ setRowMenu(null); } }))
          );
        })
      ),
      // The action row rides in the Modal's sticky box (actions:), the same
      // as every other sheet, so an edit at the top of a long list saves
      // without scrolling. The controller floats over it while a row is
      // selected; DONE puts the controller away.
    ),
    // The controller. Pinned to the bottom of the sheet, above everything in
    // it, and mirrored with handedness so the pad is always under the thumb.
    cur && !props.suspended && React.createElement("div", { "data-controller":true,
      style:{position:"fixed",left:"50%",transform:"translateX(-50%)",bottom:"1rem",
             width:"min(520px, calc(100vw - 1.5rem))",zIndex:920,
             background:S.modalBg,border:"2px solid "+S.actionBdr,borderRadius:S.radius2,
             boxShadow:"0 10px 34px rgba(0,0,0,0.6)",padding:"0.7rem 0.85rem",
             display:"flex",flexDirection:UI.left?"row-reverse":"row",alignItems:"stretch",gap:"0.8rem"} },
      React.createElement("div", { style:{flex:1,minWidth:0,display:"flex",flexDirection:"column",gap:"0.45rem"} },
        React.createElement("div", { style:{display:"flex",alignItems:"center",gap:"0.45rem"} },
          React.createElement(MenuIcon, { name:glyphFor(cur), size:18, col:cur.accent||S.chromeText }),
          React.createElement("div", { style:{minWidth:0,flex:1} },
            React.createElement("div", { style:{fontWeight:700,fontSize:"0.86rem",color:S.text,
                   whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"} }, cur.name),
            parentName(idx) && React.createElement("div", { style:{fontSize:"0.7rem",color:S.textMuted,
                   whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"} }, "in "+parentName(idx))),
          // A bordered button, so it reads as the way out of the controller
          // rather than a label - the same treatment as the tutorial's EXIT.
          React.createElement("button", { "data-ctrldone":true, onClick:function(){ setSel(null); },
            style:{flexShrink:0,background:"none",border:"1.5px solid "+S.infoText,
                   borderRadius:S.radius3,padding:"0.3rem 0.75rem",cursor:"pointer",
                   color:S.infoText,fontFamily:S.fontBody,fontWeight:800,fontSize:"0.72rem",
                   letterSpacing:"0.08em",WebkitTapHighlightColor:"transparent"} }, "DONE")),
        roles.length>0 && React.createElement("div", { style:{fontSize:"0.62rem",color:S.textMuted,letterSpacing:"0.08em"} }, "NESTED AS"),
        roles.length>0 && React.createElement("div", { style:{display:"flex",gap:"0.4rem"} },
          rolePill("task","Task"), rolePill("project","Project")),
        roleNote && React.createElement("div", { style:{fontSize:"0.66rem",color:S.textMuted,lineHeight:1.35} }, roleNote)
      ),
      React.createElement("div", { style:{position:"relative",width:"108px",height:"108px",flexShrink:0} },
        padKey("up",   can.up,   function(){ apply(stepUp(rows, idx)); }),
        padKey("down", can.down, function(){ apply(stepDown(rows, idx)); }),
        padKey("left", can.out,  function(){ apply(stepOut(rows, idx)); }),
        padKey("right",can.in_,  function(){ apply(stepIn(rows, idx, role)); })
      )
    ),
    ask && React.createElement(Modal, { actions:[React.createElement("button", { key:"a0", "data-outlineconfirm":true, onClick:ask.apply, style:MODAL_SAVE() }, "Move"),
        React.createElement("button", { key:"a1", onClick:function(){ setAsk(null); }, style:MODAL_CANCEL() }, "Cancel")], title:"Move it?", onClose:function(){ setAsk(null); }, ownActions:true },
      React.createElement("p", { style:{color:S.textDim,fontSize:"0.9rem",lineHeight:1.5,marginBottom:"1rem"} }, ask.label)
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
          style:{flex:1,background:S.infoBg,border:"2.5px solid "+S.actionBdr,borderRadius:S.radius,padding:"0.85rem",color:S.infoText,fontWeight:700,cursor:"pointer",fontFamily:S.fontBody,fontSize:"0.95rem"} }, "Save"),
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
// The day's work as the project tree: each job once, under its own parent,
// deeper levels indented further. A parent that logged nothing itself still
// appears so its children have somewhere to sit, and every line is that job's
// time INCLUDING what sits under it - so the top-level lines add up to the
// Total. (It used to print every nested job under every top-level job.)
function daySummaryTree(projectLogs, projects){
  var byId={}; (projects||[]).forEach(function(p){ byId[p.id]=p; });
  var node={};
  function get(id, name, parentId){
    if(!node[id]) node[id]={ id:id, name:name||"", parentId:parentId, own:0, kids:[], total:0 };
    else if(!node[id].name && name) node[id].name=name;
    return node[id];
  }
  projectLogs.forEach(function(l){
    var p=byId[l.projectId];
    var n=get(l.projectId, p ? p.name : l.projectName, p ? p.parentId : l.parentId);
    n.own+=(l.duration||0);
    if(!p && l.parentId!=null) get(l.parentId, l.parentName, null);
  });
  // Walk every logged job up to its root, adding parents that logged nothing.
  Object.keys(node).forEach(function(k){
    var n=node[k], guard=0;
    while(n.parentId!=null && guard++<50){
      var pp=byId[n.parentId];
      var par=get(n.parentId, pp ? pp.name : null, pp ? pp.parentId : null);
      n=par;
    }
  });
  var all=Object.keys(node).map(function(k){ return node[k]; });
  all.forEach(function(n){ if(n.parentId!=null && node[n.parentId] && node[n.parentId]!==n) node[n.parentId].kids.push(n); });
  function sum(n, d){ if(d>50) return 0; n.total=n.own+n.kids.reduce(function(a,c){ return a+sum(c, d+1); },0); return n.total; }
  var roots=all.filter(function(n){ return n.parentId==null || !node[n.parentId] || node[n.parentId]===n; });
  roots.forEach(function(r){ sum(r, 0); });
  function order(a,b){ return (b.total-a.total) || String(a.name).localeCompare(String(b.name)); }
  var out=[];
  function emit(n, d){
    if(n.total<=0 || d>50) return;
    var pre=d===0 ? "" : new Array(d+1).join("  ")+"> ";
    out.push(pre+String(n.name||"(parent job)").padEnd(Math.max(1,36-pre.length))+fmtDur(n.total,true).padStart(8));
    n.kids.sort(order).forEach(function(c){ emit(c, d+1); });
  }
  roots.sort(order).forEach(function(r){ emit(r, 0); });
  return out;
}
function DaySummary(props){
  var logs=props.logs, disruptions=props.disruptions, breaks=props.breaks, onClose=props.onClose, testMode=props.testMode;
  var copiedS = useState(false); var setCopied=copiedS[1]; var copied=copiedS[0];
  // The shift being summarised, not the wall-clock date: after midnight on a
  // night shift those differ, and heading Wednesday's work "Thursday" is how
  // a summary ends up pasted into the wrong row of the log.
  var today=new Date(props.dayKey||Date.now()).toLocaleDateString([],{weekday:"long",month:"long",day:"numeric",year:"numeric"});
  var done=disruptions.filter(function(d){ return d.endTime; });
  var distTotal=done.reduce(function(a,d){ return a+d.duration; },0);
  var breakTotal=breaks.filter(function(b){ return b.endTime; }).reduce(function(a,b){ return a+b.duration; },0);
  var projectLogs=logs.filter(function(l){ return l.type!=="atwork"; });
  var totalMs=projectLogs.reduce(function(a,l){ return a+l.duration; },0);

  var lines=["Day Summary - "+today+(testMode?" [PRACTICE]":""),""].concat(daySummaryTree(projectLogs, props.projects));
  lines.push("","Total: "+fmtDur(totalMs,true));
  if(breakTotal>0) lines.push("Breaks: "+fmtDur(breakTotal,true));
  if(distTotal>0) lines.push("Disruptions ("+done.length+"): "+fmtDur(distTotal,true)+" lost");

  function copy(){ navigator.clipboard.writeText(lines.join("\n")).then(function(){ setCopied(true); setTimeout(function(){ setCopied(false); },2000); }); }

  return (
    React.createElement(Modal, { title:"Day Summary", onClose:onClose, wide:true },
      React.createElement("div", { style:{display:"flex",gap:"0.5rem",marginBottom:"1rem"} },
        React.createElement("button", { "data-anchor":"sum-copy", onClick:copy, style:{flex:1,background:copied?S.successBg2:S.bg1,border:"1px solid "+(copied?S.successBorder:S.border),borderRadius:S.radius,padding:"0.7rem",color:copied?S.successText:S.textDim,cursor:"pointer",fontFamily:S.fontBody,fontWeight:600} }, copied?"Copied!":"Copy")
      ),
      React.createElement("div", { "data-anchor":"sum-lines", style:{background:S.bg0,borderRadius:S.radius,padding:"0.85rem",maxHeight:"400px",overflowY:"auto"} },
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
    var out=["Time Report - "+periodLabel(range)+(props.testMode?" [PRACTICE]":""),""];
    if(msRep.due>0 || msRep.next.length>0){
      out.push("MILESTONES");
      if(msRep.due>0) out.push("  Due "+msRep.due+"  -  met "+msRep.met+", late "+msRep.late+", missed "+msRep.missed
        +(msRep.onTimePct!=null?"  ("+msRep.onTimePct+"% on time)":""));
      msRep.missedList.forEach(function(pt){ out.push("  MISSED  "+pt.label+" - "+pt.owner+" - due "+fmtMsWhen(pt.at)); });
      msRep.lateList.forEach(function(pt){ out.push("  LATE    "+pt.label+" - "+pt.owner+" - +"+fmtDur(pt.variance,true)); });
      msRep.next.forEach(function(pt){ out.push("  NEXT    "+pt.label+" - "+pt.owner+" - "+fmtMsWhen(pt.at)); });
      out.push("");
    }
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
  var seg=React.createElement("div", { "data-anchor":"rep-period", style:{display:"flex",gap:"0.3rem",marginBottom:"0.7rem"} },
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
  var nav=React.createElement("div", { "data-anchor":"rep-nav", style:{display:"flex",alignItems:"center",gap:"0.5rem",marginBottom:"0.85rem"} },
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

  var summary=React.createElement("div", { "data-anchor":"rep-summary", style:{background:S.bg1,border:"1px solid "+S.border,
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
  var stats=React.createElement("div", { "data-anchor":"rep-stats", style:{display:"flex",gap:"0.4rem",flexWrap:"wrap",marginBottom:"1rem"} },
    stat("Clocked", roll.clockedMs>0?fmtDur(roll.clockedMs,true):"--"),
    stat("Breaks", roll.breakMs>0?fmtDur(roll.breakMs,true):"--", roll.breakMs>0?S.warnText:S.textMuted),
    stat("Disrupt", roll.distCount>0?(fmtDur(roll.distMs,true)+" x"+roll.distCount):"--", roll.distCount>0?S.dangerText:S.textMuted),
    stat("Days", String(roll.activeDays))
  );

  // Milestones over the period. The line at full width with labels, then the
  // account of it: what was due, how it went, and what is next. Only drawn
  // when the period actually had milestones in it.
  // A range carries start/end (end is exclusive), NOT from/to - passing the
  // wrong names made the window undefined and the section never appeared.
  var msRep=milestoneReport(props.projects||[], props.laneOrder||[], range.start, range.end-1, now);
  function msStat(label, value, col){
    return React.createElement("div", { key:label, style:{flex:"1 1 30%",minWidth:"74px",background:S.bg1,
      border:"1px solid "+S.border,borderRadius:S.radius3,padding:"0.4rem 0.5rem"} },
      React.createElement("div", { style:{fontSize:"0.6rem",color:S.textMuted,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase"} }, label),
      React.createElement(Mono, { style:{fontSize:"0.82rem",fontWeight:600,color:col||S.text} }, value));
  }
  function msLine(pt, tone){
    return React.createElement("div", { key:pt.id, style:{display:"flex",alignItems:"baseline",gap:"0.5rem",padding:"0.22rem 0"} },
      React.createElement("span", { style:{width:"8px",height:"8px",borderRadius:"50%",background:MS_STATUS_COLOR(pt.status),flexShrink:0} }),
      React.createElement("span", { style:{flex:1,minWidth:0,color:S.text,fontSize:"0.82rem",fontWeight:600,
        overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"} }, pt.label),
      React.createElement("span", { style:{fontSize:"0.7rem",color:S.textMuted,flexShrink:0,
        overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"38%"} }, pt.owner),
      React.createElement(Mono, { style:{fontSize:"0.72rem",color:tone||S.textDim,flexShrink:0} },
        pt.status==="late" ? "+"+fmtDur(pt.variance,true)
        : pt.status==="missed" ? fmtMsWhen(pt.at)
        : pt.status==="met" ? (pt.variance<0 ? "-"+fmtDur(-pt.variance,true) : "on time")
        : fmtMsWhen(pt.at)));
  }
  var milestones = msRep.due===0 && msRep.next.length===0 ? null : React.createElement("div", { "data-msreport":msRep.due,
    style:{marginBottom:"1rem"} },
    React.createElement("div", { style:{display:"flex",alignItems:"center",gap:"0.4rem",marginBottom:"0.5rem"} },
      React.createElement(MenuIcon, { name:"milestone", size:16, col:S.chromeText }),
      React.createElement("span", { style:{fontSize:"0.68rem",fontWeight:800,letterSpacing:"0.12em",color:S.chromeText} }, "MILESTONES")),
    msRep.points.length>0 && React.createElement("div", { style:{background:S.bg1,border:"1px solid "+S.border,
      borderRadius:S.radius3,padding:"0.3rem 0.2rem 0",marginBottom:"0.5rem"} },
      React.createElement(MilestoneLine, { weekStart:weekStartOf(props.schedule), points:msRep.points, now:now, width:420, labels:true,
        span:{ lo:range.start, hi:range.end-1 }, offDays:offDaysOf(props.schedule) })),
    msRep.due>0 && React.createElement("div", { style:{display:"flex",gap:"0.4rem",flexWrap:"wrap",marginBottom:"0.6rem"} },
      msStat("Due", String(msRep.due)),
      msStat("On time", msRep.onTimePct==null?"--":msRep.onTimePct+"%", msRep.onTimePct==null?S.textMuted:(msRep.onTimePct>=80?S.msMet:S.msLate)),
      msStat("Missed", String(msRep.missed), msRep.missed>0?S.msMissed:S.textMuted),
      msRep.late>0 && msStat("Worst slip", fmtDur(msRep.worstSlip,true), S.msLate),
      msRep.avgGain!=null && msStat("Avg early", fmtDur(msRep.avgGain,true), S.msMet)),
    msRep.missedList.length>0 && React.createElement("div", { style:{marginBottom:"0.5rem"} },
      React.createElement("div", { style:{fontSize:"0.64rem",color:S.msMissed,fontWeight:700,letterSpacing:"0.06em",marginBottom:"0.15rem"} }, "MISSED"),
      msRep.missedList.map(function(pt){ return msLine(pt, S.msMissed); })),
    msRep.lateList.length>0 && React.createElement("div", { style:{marginBottom:"0.5rem"} },
      React.createElement("div", { style:{fontSize:"0.64rem",color:S.msLate,fontWeight:700,letterSpacing:"0.06em",marginBottom:"0.15rem"} }, "MET LATE"),
      msRep.lateList.map(function(pt){ return msLine(pt, S.msLate); })),
    msRep.next.length>0 && React.createElement("div", null,
      React.createElement("div", { style:{fontSize:"0.64rem",color:S.textMuted,fontWeight:700,letterSpacing:"0.06em",marginBottom:"0.15rem"} }, "NEXT UP"),
      msRep.next.map(function(pt){ return msLine(pt, S.textDim); })));
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
    seg, nav, summary, payCard, stats, milestones, body, modSections,
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
  var todayMs=props.todayMs, todayDist=props.todayDist, allDist=props.allDist||[];
  var onCloseOut=props.onCloseOut;
  var distToday=props.distToday, distTotal=props.distTotal;
  // A nested row is a project in its own right when something hangs off it.
  // Nothing declares that; the structure does, so it stays true as work moves.
  var kids=props.kids||[], depth=props.depth||1;
  var isNest=kids.length>0;
  var onAddSub=props.onAddSub;
  // Room for one more level below this row, or not.
  var canNest=depth < MAX_NEST_DEPTH-1;

  var hintS=useState(false); var setHint=hintS[1]; var hint=hintS[0];
  var kidsOpenS=useState(true); var setKidsOpen=kidsOpenS[1]; var kidsOpen=kidsOpenS[0];
  var menuS=useState(false); var setMenu=menuS[1]; var menu=menuS[0];
  var distPopupS=useState(false); var setDistPopup=distPopupS[1]; var distPopup=distPopupS[0];
  var menuRef=useRef(null);
  var stagesMenuS=useState(false); var setStagesMenu=stagesMenuS[1]; var stagesMenu=stagesMenuS[0];
  var stagesRef=useRef(null);
  var taps=useTaps(
    function(){ if(!menu){ try{ window.dispatchEvent(new Event("ttCloseMenus")); }catch(e){} } setMenu(function(x){ return !x; }); },
    function(){ setMenu(false); setHint(false); onEdit(sub); }
  );
  var sw=useSwipe(function(dir){ setRowCollapsedPersist(dir==="left"); });
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

  // Finished tasks stay as a greyed line rather than vanishing - the same
  // rule the cards follow. Held to reopen. (After the hooks above, never
  // before them.)
  if(isClosed(sub)){
    return React.createElement("div", { "data-donerow":sub.id, key:sub.id,
      style:{display:"flex",alignItems:"center",gap:"0.45rem",opacity:0.62,
             marginLeft:(depth*0.9)+"rem",padding:"0.3rem 0.5rem",
             background:S.bg1,border:"1px dashed "+S.border,borderRadius:S.radius3,marginBottom:"0.25rem"} },
      React.createElement(MenuIcon, { name:"task", size:12, col:S.textMuted }),
      React.createElement("span", { style:{color:S.textDim,fontWeight:600,fontSize:"0.78rem",
        textDecoration:"line-through",textDecorationColor:S.textMuted,
        overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,minWidth:0} }, sub.name),
      React.createElement("span", { "data-donetag":true, style:{flexShrink:0,fontSize:"0.56rem",fontWeight:800,
        letterSpacing:"0.08em",color:S.msMet,textTransform:"uppercase"} },
        sub.closedOutcome==="abandoned" ? "Abandoned" : sub.closedOutcome==="superseded" ? "Superseded" : "Completed"),
      React.createElement(HoldButton, { onHold:function(){ if(props.onReopen) props.onReopen(sub); },
        holdMs:HOLD_DELETE_MS, fill:rgba(S.actionBdr,0.32),
        attrs:{ "data-reopen":sub.id, "aria-label":"Hold to reopen" },
        style:{flex:"0 0 auto",background:S.bg2,border:"1px solid "+S.border,borderRadius:S.radius3,
               padding:"0.18rem 0.4rem",color:S.textDim,fontFamily:S.fontBody,fontWeight:700,fontSize:"0.58rem"} },
        React.createElement("span", null, "Reopen")));
  }
  var hasStages=sub.stages&&sub.stages.length>0;
  var stagesDone=hasStages?sub.stages.filter(function(s){ return s.done; }).length:0;
  var stagesPct=hasStages?Math.round((stagesDone/sub.stages.length)*100):0;
  var stagesAllDone=hasStages&&stagesDone===sub.stages.length;
  var ACCENT=props.accent||S.chromeSubTask;
  var LANECOL=readableInk(ACCENT, S.bg1, S.text);

  // Precompute styles
  var activeTint = S.fill==="solid" ? ACCENT+"55"
    : S.fill==="glass" ? ACCENT+"3D"
    : (S.mode==="light" ? ACCENT+"26" : S.runningTint);
  var rowBg = isActive ? (isInterrupted ? S.dangerBg2 : activeTint)
    : (S.fill==="solid" ? ACCENT+"2E" : S.fill==="glass" ? ACCENT+"1F" : S.bg1);
  var rowBdr = isInterrupted ? S.distEdge : ACCENT;
  var glow = (isActive && S.glow) ? ("0 0 8px "+(isInterrupted?S.distGlow:ACCENT)+"33") : "none";
  var barBg = isActive ? (isInterrupted ? S.distTrack : S.chromeTrackOn) : S.chromeTrack;
  // The title and its glyph carry the lane's accent, so a row reads as
  // belonging to its lane without tracing the border.
  //
  // Except while it is running. A running row is filled with that same accent,
  // and accent on accent is barely legible - that is why an earlier attempt at
  // this was reverted outright. A running row keeps the high-contrast colour
  // and lets the fill carry the lane, which is louder anyway.
  //
  // The press affordance dims the title, but never below readable: textMuted
  // vanished against the glass card tint the moment it was touched.
  var titleCol = hint ? S.textDim : (isActive ? S.titleText : LANECOL);
  // Scheduled for later: greyed, but still pressable - the press is what opens
  // the question. Stopping is never gated, only starting.
  var pending = !isActive && isPending(sub);
  var startBg = pending ? S.bg0 : (isActive ? (isInterrupted ? S.dangerBg2 : activeTint) : S.bg1);
  var startBdr = pending ? S.border : (isActive ? (isInterrupted ? S.distStartBdr : ACCENT) : S.chromeBdr);
  var startIconCol = pending ? S.textMuted : (isActive ? (isInterrupted ? S.distIcon : ACCENT) : S.chromeIcon);
  var startPlay = pending ? S.mutedGlyph : S.chromeIcon;
  var startLbl = isActive ? (isInterrupted ? "Paused" : "Stop") : "Start";
  var timCol = isActive ? (isInterrupted ? S.distDim : ACCENT) : S.chromeTime;

  if(rowCollapsed){
    return (
      React.createElement("div", {
        onMouseDown:sw.pill.onMouseDown, onMouseUp:sw.pill.onMouseUp, onTouchStart:sw.pill.onTouchStart, onTouchEnd:sw.pill.onTouchEnd,
        style:{height:"20px",border:"2.5px solid "+rowBdr,borderRadius:"999px",background:rowBg,cursor:"grab",opacity:0.9,marginBottom:"0.35rem",display:"flex",alignItems:"center",justifyContent:"center",gap:"0.5rem",overflow:"hidden",boxShadow:glow,touchAction:"pan-y",WebkitUserSelect:"none",userSelect:"none"} },
        React.createElement("span", { style:{fontSize:"0.68rem",fontWeight:700,color:ACCENT,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",fontFamily:S.fontBody} }, sub.name),
        (isActive||todayMs>0) && React.createElement(Mono, { style:{fontSize:"0.66rem",color:timCol,fontWeight:700,whiteSpace:"nowrap"} }, fmtDur(todayMs,true))
      )
    );
  }

  return (
    React.createElement("div", { "data-draggable":true, "data-surface":"panel", "data-menu-open":(menu||stagesMenu)?"1":undefined, style:{background:rowBg,border:(isNest?"3px":"2.5px")+" solid "+rowBdr,borderRadius:isNest?"12px":"10px",marginBottom:"0.35rem",position:"relative",zIndex:(menu||stagesMenu)?80:"auto",boxShadow:glow,transition:"all 0.15s"} },
      React.createElement("div", { style:{display:"flex",alignItems:"center",gap:"0.45rem",padding:"0.55rem 0.7rem 0.3rem"} },
        editMode&&React.createElement("span", { onMouseDown:function(e){ onDragStart(e,idx); }, onTouchStart:function(e){ onDragStart(e,idx); }, style:{cursor:"grab",color:S.dragGlyph,fontSize:"0.95rem",userSelect:"none",touchAction:"none",flexShrink:0} }, "\u283f"),
        React.createElement("div", { style:{width:"3px",alignSelf:"stretch",background:barBg,borderRadius:"2px",flexShrink:0,minHeight:"22px"} }),
        React.createElement("div", { style:{flex:1,minWidth:0,cursor:"pointer",WebkitUserSelect:"none",userSelect:"none",touchAction:"pan-y",position:"relative"},
          onMouseDown:sw.open.onMouseDown, onMouseUp:sw.open.onMouseUp, onTouchStart:sw.open.onTouchStart, onTouchEnd:sw.open.onTouchEnd,
          onMouseLeave:function(){ setHint(false); },
          onClick:sw.guard(function(){ taps(); }),
          onMouseEnter:function(){ setHint(true); } },
          React.createElement("div", { style:{display:"flex",alignItems:"center",gap:"0.35rem",fontWeight:600,fontSize:"0.92rem",color:titleCol,lineHeight:1.25,wordBreak:"break-word"} },
            React.createElement(TitleGlyph, { name:"task", size:17, col:titleCol }),
            React.createElement("span", { style:{minWidth:0,wordBreak:"break-word"} }, sub.name)
          ),
          hint && React.createElement("div", { style:{fontSize:"0.66rem",color:S.titleText,marginTop:"0.1rem"} }, "tap: menu / double-tap: edit"),
          menu && React.createElement("div", { ref:menuAutoScroll, "data-surface":"menu", style:{position:"absolute",top:"calc(100% + 4px)",left:UI.left?"auto":0,right:UI.left?0:"auto",background:S.menuBg,border:"1px solid "+S.border,borderRadius:S.radius,minWidth:"160px",boxShadow:"0 8px 32px rgba(0,0,0,0.6)",zIndex:70,overflow:"hidden"} },
            // The same rows the outline offers for a task. Nesting deeper is
            // withheld at the depth cap, as it was.
            React.createElement(MenuRows, { onPick:function(){ setMenu(false); },
              items:rowMenuItems("node", projRole(sub), {
                edit:function(){ onEdit(sub); },
                addSibling:props.onAddSibling ? function(){ props.onAddSibling(sub.id); } : null,
                addNestedTask:(canNest && onAddSub) ? function(){ onAddSub(sub.id); } : null,
                addNestedProject:(canNest && props.onAddNested) ? function(){ props.onAddNested(sub.id); } : null,
                addTask:(canNest && onAddSub) ? function(){ onAddSub(sub.id); } : null,
                stages:function(){ onStages(sub); }
              }) }),
            React.createElement("button", { "data-flat":true, onClick:function(){ onCloseOut(sub); setMenu(false); }, style:{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"0.6rem",width:"100%",textAlign:"left",background:readyToClose(sub)?S.successBg:"none",border:"none",padding:"0.6rem 0.9rem",color:readyToClose(sub)?S.successText:S.text,cursor:"pointer",fontFamily:S.fontBody,fontSize:"0.88rem"} },
              "Close Out",
              readyToClose(sub) ? React.createElement("span", { style:{fontSize:"0.64rem",fontWeight:800,letterSpacing:"0.05em"} }, "READY") : null)
          )
        ),
        // Start/Stop
        React.createElement("button", { onClick:function(){ onToggle(sub.id); },
          "aria-disabled": pending ? "true" : undefined,
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
                  React.createElement("path", { d:"M4 3 L15 9 L4 15 Z", fill:startPlay })
                ),
          React.createElement("span", { style:{fontSize:"0.73rem",fontWeight:700,color:startIconCol,fontFamily:S.fontBody,lineHeight:1} }, startLbl)
        )
      ),
      // Row 2: meta
      React.createElement("div", { style:{display:"flex",alignItems:"center",gap:"0.45rem",padding:"0 0.7rem 0.5rem 2.2rem",flexWrap:"wrap"} },
        sub.notes && !hint && React.createElement("span", { style:{fontSize:"0.76rem",color:S.textDim} }, sub.notes),
        React.createElement(SchedChip, { proj:sub, small:true }),
        todayMs>0 && React.createElement(Mono, { style:{fontSize:"0.76rem",color:timCol,fontWeight:700} }, fmtDur(todayMs,true)),
        React.createElement(DistBadge, { today:distToday, total:distTotal, small:true,
          onClick:function(){ try{ window.dispatchEvent(new Event("ttCloseMenus")); }catch(e){} setDistPopup(true); } }),
        // The same Complete a project card has, sized for a task row.
        !hasStages && isOpen(sub) && onCloseOut && React.createElement(HoldButton, {
          onHold:function(){ onCloseOut(sub); }, holdMs:HOLD_DELETE_MS, fill:rgba(S.successText,0.35),
          attrs:{ "data-complete":sub.id, "aria-label":"Hold to complete" },
          style:{flex:1,minWidth:"90px",display:"flex",alignItems:"center",justifyContent:"center",gap:"0.3rem",
                 background:S.bg1,border:"2px solid "+S.chromeBdr,borderRadius:S.radius3,padding:"0.25rem 0.5rem",
                 color:S.chromeText,fontFamily:S.fontBody,fontWeight:700,fontSize:"0.72rem"} },
          React.createElement("span", { style:{display:"flex",alignItems:"center",gap:"0.3rem"} },
            React.createElement(MenuIcon, { name:"task", size:13, col:S.chromeText }),
            "Complete",
            React.createElement("span", { style:{fontSize:"0.6rem",fontWeight:600,opacity:0.7,marginLeft:"0.2rem"} }, "hold"))),
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
        distPopup && React.createElement(DisruptionPopup, { disruptions:allDist.filter(function(d){ return d.projectId===sub.id; }), projName:sub.name, onClose:function(){ setDistPopup(false); } })
      ),
      // The nested projects and tasks under this one. Same component all the
      // way down, so a project three levels in behaves like one at the top.
      isNest && React.createElement("div", { style:{padding:"0 0 0.1rem 0.9rem",marginTop:"-0.1rem",
        borderLeft:"2px solid "+ACCENT+"55",marginLeft:"0.7rem"} },
        React.createElement("button", { "data-flat":true,
          onClick:function(){ haptic(6); setKidsOpen(function(x){ return !x; }); },
          style:{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",
                 padding:"0.3rem 0 0.35rem",cursor:"pointer",fontFamily:S.fontBody,
                 fontSize:"0.72rem",fontWeight:700,color:S.chromeText,whiteSpace:"nowrap"} },
          (kidsOpen?"\u2228 ":"\u203a ")+kids.length+" nested"),
        kidsOpen && props.renderKids && props.renderKids(kids, depth+1)
      )
    )
  );
}

// ---- PROJECT CARD -----------------------------------------------------------
function ProjectCard(props){
  var proj=props.proj, isActive=props.isActive, interrupting=props.interrupting;
  var todayMs=props.todayMs, distToday=props.distToday, distTotal=props.distTotal;
  var projDisruptions=props.projDisruptions;
  var onToggle=props.onToggle, onEdit=props.onEdit, onStages=props.onStages, onStageToggle=props.onStageToggle;
  var onAddSub=props.onAddSub, editMode=props.editMode, dragHandleProps=props.dragHandleProps;
  var subTasks=props.subTasks||[], activeId=props.activeId;
  var todayLogs=props.todayLogs, todayDist=props.todayDist, allDist=props.allDist||[];
  var allProjects=props.allProjects, onCloseOut=props.onCloseOut;
  var laneMeta=props.laneMeta, elapsed=props.elapsed;
  var nestDepth=props.nestDepth||0;
  var isNestedCard=nestDepth>0;
  // The top card of a tree works the ranking out once and hands it down, so
  // every card in the stack is ranked against the same walk.
  var stackOrder=props.stackOrder || projectStackOrder(props.allProjects, props.proj.id);

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
  var sw=useSwipe(function(dir){ setCardCollapsedPersist(dir==="left"); });
  // `still` is a card staged inside a guide: always drawn open, whatever the
  // board remembers for that id, so the picture matches the guide's words.
  var cardCollapsedS=useState(function(){ if(props.still) return !!props.stillCollapsed; var c=load("tt_cardcollapse",{}); return !!c[proj.id]; });
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
  var pending = !isActive && isPending(proj);
  var startBg = pending ? S.bg0 : (isActive ? (isInterrupted ? S.dangerBg2 : laneTint) : S.bg1);
  var startBdr = pending ? S.border : (isActive ? (isInterrupted ? S.distStartBdr : meta.accent) : S.chromeBdr);
  var startGlow = (isActive && S.glow) ? ("0 0 10px "+(isInterrupted?S.distGlow:meta.accent)+"44") : "none";
  var startIconCol = pending ? S.textMuted : (isActive ? (isInterrupted ? S.distIcon : meta.accent) : S.chromeIcon);
  var LANECOL=readableInk(meta.accent, S.bg1, S.text);
  var startLblCol = pending ? S.textMuted : (isActive ? (isInterrupted ? S.distLbl : meta.accent) : S.chromeText);
  var startPlay = pending ? S.mutedGlyph : S.chromeIcon;
  var startLbl = isActive ? (isInterrupted ? "Paused" : "Stop") : "Start";
  var timCol = isActive ? (isInterrupted ? S.distDim : meta.accent) : S.chromeTime;
  // Lane accent for the title and its glyph; high-contrast while running,
  // where the card is already filled with that same accent. See the sub-task
  // row for the full reasoning.
  // The press affordance dims the title, but never below readable: textMuted
  // vanished against the glass card tint the moment it was touched.
  var titleCol = hint ? S.textDim : (isActive ? S.titleText : LANECOL);
  var stageBdr = stagesAllDone ? S.stageDoneBdr : meta.accent;
  var stageCol = stagesAllDone ? S.stageDoneText : meta.accent;

  // Two different things hang off a project and they are drawn differently: a
  // task is a step inside it, a nested project is work in its own right that
  // this one depends on.
  //
  // Declared above the collapsed early return, not below it: the collapsed pill
  // reads childTasks and countLabel too, and `var` hoists the name without the
  // value, so from down there they were plain undefined.
  // Counts are of LIVE work: a finished task still on the board as a pill is
  // not outstanding, and counting it would overstate what is left.
  function sinkClosed(a,b){
    var ac=isClosed(a)?1:0, bc=isClosed(b)?1:0;
    if(ac!==bc) return ac-bc;
    if(ac) return (b.closedAt||0)-(a.closedAt||0);
    return (a.order||0)-(b.order||0);
  }
  // Two lists on purpose: what is DRAWN (finished work included, at the end)
  // and what is COUNTED (live work only - a finished task is not outstanding).
  var childTasksAll=subTasks.filter(isTaskRole).slice().sort(sinkClosed);
  var childTasks=childTasksAll.filter(isOpen);
  var childProjects=subTasks.filter(isProjectRole).slice().sort(sinkClosed);
  var deepAll=getDescendantIds(allProjects||[], proj.id).filter(function(id){
    var d=findProj(allProjects||[], id); return d && isTaskRole(d);
  });
  var deepCount=deepAll.filter(function(id){ return isOpen(findProj(allProjects||[], id)); }).length;
  var nested = deepAll.length > childTasksAll.length;
  // The count is of what is THERE, not what is left: once every task is done
  // an outstanding-only count read "0 tasks", the expander disappeared, and
  // the finished tasks it was hiding could never be opened again. How many
  // are done is said alongside it, so the pill still answers "what is left".
  var totalTasks = nested ? deepAll.length : childTasksAll.length;
  var openTasks  = nested ? deepCount : childTasks.length;
  var doneTasks  = totalTasks - openTasks;
  var countLabel = (nested ? (totalTasks+" nested") : (totalTasks+" task"+(totalTasks!==1?"s":"")))
                 + (doneTasks>0 ? " \u00b7 "+doneTasks+" done" : "");

  // ---- COMPLETED: minimised, greyed, held to reopen ----------------------
  // A finished record stays where it was instead of disappearing: the same
  // minimised shape a swipe gives, drained of colour, saying so next to its
  // name. Reopening is HELD, like every other change that undoes something.
  if(isClosed(proj)){
    // No -12px tuck here: that headroom exists so a nested CARD can sit under
    // its parent's title, and on a slim pill it pulled the pill onto the
    // parent's bottom border.
    return React.createElement("div", { "data-donecard":proj.id,
      style:{ marginBottom:isNestedCard?"0.3rem":"0.45rem", opacity:0.62 } },
      React.createElement("div", { style:{display:"flex",alignItems:"center",gap:"0.5rem",
        background:S.bg1, border:"1px dashed "+S.border, borderRadius:S.radius3,
        padding:"0.42rem 0.6rem", marginLeft:isNestedCard?"0.9rem":0 } },
        React.createElement(MenuIcon, { name:isProjectRole(proj)?"project":"task", size:14, col:S.textMuted }),
        React.createElement("span", { style:{flex:1,minWidth:0,display:"flex",alignItems:"baseline",gap:"0.4rem",minWidth:0} },
          React.createElement("span", { style:{color:S.textDim,fontWeight:700,fontSize:"0.84rem",
            textDecoration:"line-through",textDecorationColor:S.textMuted,
            overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"} }, proj.name),
          React.createElement("span", { "data-donetag":true, style:{flexShrink:0,fontSize:"0.6rem",fontWeight:800,
            letterSpacing:"0.08em",color:S.msMet,textTransform:"uppercase"} },
            proj.closedOutcome==="abandoned" ? "Abandoned" : proj.closedOutcome==="superseded" ? "Superseded" : "Completed")),
        React.createElement(HoldButton, { onHold:function(){ if(props.onReopen) props.onReopen(proj); },
          holdMs:HOLD_DELETE_MS, fill:rgba(S.actionBdr,0.32),
          attrs:{ "data-reopen":proj.id, "aria-label":"Hold to reopen" },
          style:{flex:"0 0 auto",background:S.bg2,border:"1px solid "+S.border,borderRadius:S.radius3,
                 padding:"0.22rem 0.45rem",color:S.textDim,fontFamily:S.fontBody,fontWeight:700,fontSize:"0.62rem"} },
          React.createElement("span", null, "Reopen"))));
  }
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
      // Pulled up 12px, exactly the headroom the pill grew by, so what goes
      // under the parent is empty space and the title stays clear.
      React.createElement("div", { "data-draggable":true,
        style:{ marginBottom:isNestedCard?0:"0.45rem",
                marginTop:isNestedCard?"-12px":0 } },
        React.createElement("div", {
          "data-pulse": pillPulse ? "1" : undefined, "data-anchor":"card-pill",
          onMouseDown:sw.pill.onMouseDown, onMouseUp:sw.pill.onMouseUp, onTouchStart:sw.pill.onTouchStart, onTouchEnd:sw.pill.onTouchEnd,
          // A nested pill is 12px taller and spends all of it above the text,
          // so the text keeps its original position relative to the bottom and
          // the extra 12px is what slides under the parent.
          //
          // The radius stays a flat 999px. Squaring the top corners is what
          // turned this into a bucket last time - a lozenge only reads as a
          // lozenge while every corner matches. border-box too, or the padding
          // would be added to the height instead of taken out of it.
          style:Object.assign({
            height:isNestedCard?"36px":"24px",
            boxSizing:"border-box",
            border:"2.5px solid "+cardBdr,borderRadius:"999px",
            // Opaque, not tinted: the pill overlaps the card tucked beneath it,
            // and a translucent fill let that card's top border read straight
            // through as a stray line. An opaque base with the themed tint
            // painted over it keeps the colour and stops the bleed. The blanket
            // 0.92 had to go too - no fill can fix a translucent element.
            backgroundColor:isNestedCard?S.bg0:cardBg,
            backgroundImage:isNestedCard?("linear-gradient("+cardBg+","+cardBg+")"):"none",
            opacity:isNestedCard?1:0.92,
            cursor:"grab",display:"flex",alignItems:"center",gap:"0.6rem",overflow:"hidden",
            // Centred inside the padded box, which leaves the same 19px of
            // content at the bottom the pill has always had.
            padding:isNestedCard?"12px 0.35rem 0 0.75rem":"0 0.35rem 0 0.75rem",
            boxShadow:cardGlow,touchAction:"pan-y",WebkitUserSelect:"none",userSelect:"none",
            position:"relative",zIndex:stackZ(stackOrder, proj.id)}, pulseVars(cardBdr)) },
          // Title anchored left, control anchored right - the pill's Stop
          // lands on the same edge as every expanded card's Start button.
          React.createElement("span", { style:{flex:"1 1 auto",textAlign:"left",fontSize:"0.74rem",fontWeight:700,color:meta.accent,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",minWidth:0,fontFamily:S.fontBody} }, proj.name),
          childTasksAll.length>0 && React.createElement("span", { style:{fontSize:"0.66rem",color:meta.accent,opacity:0.7,whiteSpace:"nowrap",fontFamily:S.fontBody} }, countLabel),
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
        ),
        // Collapsing hides this project's own steps, which is the point of it.
        // It must not hide the projects nested under it: those are separate
        // work, and dropping them off the board would lose them entirely.
        renderNestedProjects()
      )
    );
  }

  // One renderer for every level below the card. A row's own children come from
  // the same list it did, so nesting is a matter of who points at whom rather
  // than of how deep the render happens to have got.
  // "3 tasks" is a lie once one of them is a project with work under it, so the
  // label counts everything below and changes word when the tree is deeper.
  function renderKids(list, depth){
    return list.slice().sort(function(a,b){ return (a.order||0)-(b.order||0); }).map(function(sub,idx){
      var subIsActive=activeId===sub.id;
      // A nested project's own time is its own; the roll-up of everything
      // beneath it stays on the card at the top, which is where it belongs.
      var subTodayMs=todayLogs.filter(function(l){ return l.projectId===sub.id; }).reduce(function(a,l){ return a+l.duration; },0)+(subIsActive?elapsed:0);
      var subKids=(allProjects||[]).filter(function(p){ return p.parentId===sub.id && isOpen(p); });
      var subIds=[sub.id].concat(getDescendantIds(allProjects||[], sub.id));
      return React.createElement(SubRow, {
        key:sub.id, sub:sub, idx:idx, kids:subKids, depth:depth, renderKids:renderKids, onReopen:props.onReopen,
        onAddSub:onAddSub, onAddSibling:props.onAddSibling, onAddNested:props.onAddNested,
        onEdit:onEdit, onStages:onStages, onStageToggle:onStageToggle, onToggle:onToggle,
        onCloseOut:onCloseOut,
        editMode:editMode, onDragStart:function(e,i){ /* drag placeholder */ },
        isActive:subIsActive, isInterrupted:subIsActive&&interrupting,
        elapsed:elapsed, todayMs:subTodayMs, todayDist:todayDist, allDist:allDist,
        distToday:distStats(todayDist, subIds), distTotal:distStats(allDist, subIds),
        accent:meta.accent
      });
    });
  }

  // A nested project is drawn as a card of its own, indented and pulled up so
  // its top edge sits under the parent's bottom edge. No gap anywhere in the
  // chain: the absence of open space is the thing that reads as "attached",
  // which a connector line alone never quite does.
  function renderNestedProjects(){
    if(!childProjects.length) return null;
    return React.createElement("div", { style:{marginLeft:"0.9rem"} },
      childProjects.map(function(child){
        // Everything under it, finished included - the rule the parent uses.
        var kidTasksAll=(allProjects||[]).filter(function(p){ return p.parentId===child.id; });
        var kidTasks=kidTasksAll.filter(isOpen);
        var kidIds=[child.id].concat(getDescendantIds(allProjects||[], child.id));
        var kidActive=activeId===child.id;
        var kidToday=todayLogs.filter(function(l){ return kidIds.indexOf(l.projectId)>=0; })
          .reduce(function(a,l){ return a+l.duration; },0)+(kidActive?elapsed:0);
        return React.createElement(ProjectCard, {
          key:child.id, proj:child, nestDepth:nestDepth+1, stackOrder:stackOrder,
          isActive:kidActive, interrupting:interrupting, elapsed:elapsed,
          todayMs:kidToday,
          distToday:distStats(todayDist, kidIds), distTotal:distStats(allDist, kidIds),
          projDisruptions:allDist.filter(function(d){ return kidIds.indexOf(d.projectId)>=0; }),
          onToggle:onToggle, onEdit:onEdit, onStages:onStages, onStageToggle:onStageToggle,
          onAddSub:onAddSub, onAddSibling:props.onAddSibling, onAddNested:props.onAddNested, onCloseOut:onCloseOut,
          onMilestones:props.onMilestones, msProjects:props.msProjects, offDays:props.offDays,
          editMode:editMode, dragHandleProps:{},
          subTasks:kidTasksAll, activeId:activeId, schedule:props.schedule,
          todayLogs:todayLogs, todayDist:todayDist, allDist:allDist,
          allProjects:allProjects, laneMeta:laneMeta
        });
      })
    );
  }

  return (
    React.createElement("div", { "data-draggable":true,
      // The pull had a matching padding cancelling it out, so the tuck was
      // only ever the absence of a gap. No compensation now: the top of a
      // nested card really does slide up behind its parent's bottom edge.
      // Deliberately no z-index here - a stacking context on this wrapper
      // would trap the nested card's own menu underneath the parent.
      style:{ marginBottom:isNestedCard?0:"0.45rem",
              marginTop:isNestedCard?"-12px":0 } },
      // A themed card is its own stacking context (backdrop-filter or texture),
      // so a menu inside it cannot outrank a later sibling card. Lift the whole
      // card for as long as its menu is open.
      React.createElement("div", { "data-surface":"panel", "data-menu-open":(menu||stagesMenu)?"1":undefined,
        "data-pulse": ((isActive||!!subActive)&&!interrupting) ? "1" : undefined,
        style:Object.assign({background:cardBg,border:"3px solid "+cardBdr,
          borderRadius:S.radius2,
          borderTopLeftRadius:isNestedCard?"4px":S.radius2,
          borderTopRightRadius:isNestedCard?"4px":S.radius2,
          overflow:"visible",position:"relative",
          // Ranked by position down the stack, not by depth: siblings share a
          // depth, and two cards with the same z-index fall back to DOM order,
          // which puts the lower one on top. All below the lifted-row layer at
          // 70; an open menu still lifts a card to 80.
          zIndex:(menu||stagesMenu)?80:stackZ(stackOrder, proj.id),transition:"all 0.15s",boxShadow:cardGlow}, pulseVars(cardBdr)) },
        // Row 1: drag + title + gear + start
        React.createElement("div", { ref:menuRef, style:{display:"flex",alignItems:"center",gap:"0.5rem",padding:"0.75rem 0.75rem 0.4rem 1rem"} },
          editMode && React.createElement("span", { onMouseDown:dragHandleProps.onMouseDown, onTouchStart:dragHandleProps.onTouchStart, style:{cursor:"grab",color:S.mutedGlyph,fontSize:"1.3rem",userSelect:"none",touchAction:"none",flexShrink:0} }, "\u283f"),
          // Title
          React.createElement("div", { style:{flex:1,minWidth:0,cursor:"pointer",WebkitUserSelect:"none",userSelect:"none",touchAction:"pan-y",position:"relative"},
            onMouseDown:sw.open.onMouseDown, onMouseUp:sw.open.onMouseUp, onTouchStart:sw.open.onTouchStart, onTouchEnd:sw.open.onTouchEnd,
            onClick:sw.guard(function(){ taps(); }),
            onMouseEnter:function(){ setHint(true); }, onMouseLeave:function(){ setHint(false); } },
            React.createElement("div", { style:{display:"flex",alignItems:"center",gap:"0.4rem",fontWeight:700,fontSize:"1.05rem",color:titleCol,lineHeight:1.25,wordBreak:"break-word"} },
              React.createElement(TitleGlyph, { name:"project", size:19, col:titleCol }),
              React.createElement("span", { "data-anchor":"card-title", style:{minWidth:0,wordBreak:"break-word"} }, proj.name)
            ),
            hint && React.createElement("div", { style:{fontSize:"0.7rem",color:S.titleText,marginTop:"0.12rem"} }, "tap: menu / double-tap: edit"),
            menu && React.createElement("div", {
              ref:menuAutoScroll,
              "data-surface":"menu",
              style:{position:"absolute",top:"calc(100% + 4px)",left:UI.left?"auto":0,right:UI.left?0:"auto",background:S.menuBg,border:"1px solid "+S.border,borderRadius:S.radius,minWidth:"190px",boxShadow:"0 8px 32px rgba(0,0,0,0.6)",zIndex:70,overflow:"hidden"} },
              childTasksAll.length>0 && React.createElement("button", { "data-flat":true, onClick:function(){ setExpanded(function(x){ return !x; }); setMenu(false); }, style:{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.65rem 1rem",color:S.text,cursor:"pointer",fontFamily:S.fontBody,fontSize:"0.9rem"} }, (expanded?"Collapse ":"Expand ")+(nested?"Nested":"Tasks")),
              // The same rows the outline offers for a project, from the same
              // builder, so the two screens cannot drift. Close Out stays below:
              // it is a board action the outline does not have.
              React.createElement(MenuRows, { onPick:function(){ setMenu(false); },
                items:rowMenuItems("node", projRole(proj), {
                  edit:function(){ onEdit(proj); },
                  addSibling:props.onAddSibling ? function(){ props.onAddSibling(proj.id); } : null,
                  addNestedProject:props.onAddNested ? function(){ props.onAddNested(proj.id); } : null,
                  addTask:function(){ onAddSub(proj.id); },
                  stages:function(){ onStages(proj); },
                  milestones:props.onMilestones ? function(){ props.onMilestones(proj.id); } : null
                }) }),
              // Closing out is not deleting, so it sits with the ordinary rows
              // and reads in the project's own colour, not the danger one.
              React.createElement("button", { "data-flat":true, onClick:function(){ onCloseOut(proj); setMenu(false); }, style:{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"0.6rem",width:"100%",textAlign:"left",background:readyToClose(proj)?S.successBg:"none",border:"none",padding:"0.65rem 1rem",color:readyToClose(proj)?S.successText:S.text,cursor:"pointer",fontFamily:S.fontBody,fontSize:"0.9rem"} },
                "Close Out",
                readyToClose(proj) ? React.createElement("span", { style:{fontSize:"0.66rem",fontWeight:800,letterSpacing:"0.05em"} }, "READY") : null)
            )
          ),
          // Start/Stop button
          React.createElement("button", { "data-anchor":"card-start", onClick:function(){ onToggle(proj.id); },
            "aria-disabled": pending ? "true" : undefined,
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
                    React.createElement("path", { d:"M6 4 L18 11 L6 18 Z", fill:startPlay })
                  ),
            React.createElement("span", { style:{fontSize:"0.82rem",fontWeight:700,color:startLblCol,fontFamily:S.fontBody,lineHeight:1} }, startLbl)
          )
        ),
        // Row 2: notes + meta + stages
        React.createElement("div", { style:{display:"flex",alignItems:"center",gap:"0.5rem",padding:"0 1rem 0.75rem",flexWrap:"wrap"} },
          proj.notes && React.createElement("span", { style:{fontSize:"0.82rem",color:S.textDim} }, proj.notes),
          React.createElement(SchedChip, { proj:proj }),
          subActive&&!isActive && React.createElement("span", { style:{fontSize:"0.76rem",color:meta.accent,fontWeight:600} }, "> "+subActive.name),
          childTasksAll.length>0 && React.createElement("button", { onClick:function(){ setExpanded(function(x){ return !x; }); },
            style:{display:"flex",alignItems:"center",justifyContent:"center",gap:"0.3rem",background:S.bg0,border:"2px solid "+S.chromeBdr,borderRadius:"8px",cursor:"pointer",padding:"0 0.55rem",height:"30px",minHeight:"30px",flexShrink:0} },
            React.createElement("span", { style:{fontSize:"0.76rem",color:S.chromeText,fontWeight:700} }, (expanded?"\u2228 ":"\u203a ")+countLabel)
          ),
          todayMs>0 && React.createElement(Mono, { "data-anchor":"card-time", style:{fontSize:"0.82rem",color:timCol,fontWeight:700} }, fmtDur(todayMs,true)),
          React.createElement(DistBadge, { today:distToday, total:distTotal,
            onClick:function(){ try{ window.dispatchEvent(new Event("ttCloseMenus")); }catch(e){} setDistPopup(true); } }),
          // No stages: Complete sits where the gauge would. HELD, not tapped -
          // the fill charges across it, and a release before it is full does
          // nothing. Reaches the closure sheet, the same as Close Out does.
          !hasStages && isOpen(proj) && onCloseOut && React.createElement(HoldButton, {
            onHold:function(){ onCloseOut(proj); }, holdMs:HOLD_DELETE_MS, fill:rgba(S.successText,0.35),
            attrs:{ "data-complete":proj.id, "aria-label":"Hold to complete" },
            style:{flex:1,minWidth:"110px",display:"flex",alignItems:"center",justifyContent:"center",gap:"0.38rem",
                   background:S.bg1,border:"2px solid "+S.chromeBdr,borderRadius:S.radius3,padding:"0.3rem 0.6rem",
                   color:S.chromeText,fontFamily:S.fontBody,fontWeight:700,fontSize:"0.76rem"} },
            React.createElement("span", { style:{display:"flex",alignItems:"center",gap:"0.38rem"} },
              React.createElement(MenuIcon, { name:"task", size:15, col:S.chromeText }),
              "Complete",
              React.createElement("span", { style:{fontSize:"0.64rem",fontWeight:600,opacity:0.7,marginLeft:"0.3rem"} }, "hold"))),
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
        // The milestone line, under the chips, when anything beneath this
        // project carries steps. Tap opens the project's milestone editor.
        (function(){
          // msProjects is the FULL record set, closed ones included. The board
          // hands cards only what is open, and a milestone's targets are the
          // records that have been closed - filter them out and a met step
          // could never register as met.
          var all=props.msProjects||allProjects||[];
          if(!props.onMilestones || !hasMilestonesBeneath(all, proj.id)) return null;
          // Every step beneath it, the same rule a lane follows - not one
          // aggregate mark per child, which hid the children's own steps.
          var pts=subtreePoints(all, proj.id, Date.now());
          return React.createElement("div", { style:{padding:"0 0.6rem"} },
            React.createElement(MilestoneStrip, { weekStart:weekStartOf(props.schedule), kind:"project", points:pts,
              offDays:props.offDays, onOpen:function(){ props.onMilestones(proj.id); } }));
        })(),
        // Sub-tasks INSIDE the parent border
        expanded && childTasksAll.length>0 && React.createElement("div", { style:{padding:"0.15rem 0.6rem 0.6rem 1.4rem",borderTop:"1px solid "+meta.dim,marginTop:"0.1rem",paddingTop:"0.55rem"} },
          renderKids(childTasksAll, 1)
        )
      ),
      renderNestedProjects(),
      distPopup && React.createElement(DisruptionPopup, { disruptions:projDisruptions||[], projName:proj.name, onClose:function(){ setDistPopup(false); } })
    )
  );
}

// ---- LANE SECTION -----------------------------------------------------------
function LaneSection(props){
  var lane=props.lane, allProjects=props.allProjects, activeId=props.activeId;
  var interrupting=props.interrupting, elapsed=props.elapsed;
  var todayLogs=props.todayLogs, todayDist=props.todayDist, allDist=props.allDist||[];
  var onToggle=props.onToggle, onEdit=props.onEdit, onStages=props.onStages, onStageToggle=props.onStageToggle;
  var editMode=props.editMode, laneHandle=props.laneHandle;
  var laneMeta=props.laneMeta, onDeleteLane=props.onDeleteLane, onCloseOut=props.onCloseOut;

  var meta=getMeta(laneMeta,lane);
  var isBuiltin=DEFAULT_ORDER.indexOf(lane)>=0 || TEST_ORDER.indexOf(lane)>=0;
  var laneTaps=useTaps(
    function(){ if(!addOpen){ try{ window.dispatchEvent(new Event("ttCloseMenus")); }catch(e){} } setAddOpen(function(x){ return !x; }); },
    // Double tap edits THIS lane, in the same form the outline opens. It used
    // to open the all-lanes list, so the same gesture gave two different
    // editors depending on where you started from.
    function(){ setAddOpen(false); props.onEditLane(lane); }
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
  var sw=useSwipe(function(dir){ setCollapsedPersist(dir==="left"); });
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
  // Completed ones sink to the bottom of the lane: still there, out of the way.
  var topLevel=allProjects.filter(function(p){ return p.lane===lane&&p.parentId===null; })
    .sort(function(a,b){
      var ac=isClosed(a)?1:0, bc=isClosed(b)?1:0;
      if(ac!==bc) return ac-bc;
      if(ac) return (b.closedAt||0)-(a.closedAt||0);   // most recently finished first
      return (a.order||0)-(b.order||0);
    });
  // The running project (or sub-task) inside this lane, for the collapsed
  // oval: it names the timer and drives the border pulse.
  var laneActiveProj = activeId!=null ? allProjects.find(function(p){ return p.id===activeId && p.lane===lane; }) : null;
  var lanePulse = !!laneActiveProj && !interrupting;

  return (
    React.createElement("div", { "data-surface":"lane", style:{marginBottom:"1.25rem",position:"relative",zIndex:addOpen?90:"auto"} },
      React.createElement("div", { ref:addRef, style:{position:"relative",fontSize:"1.05rem",textTransform:"uppercase",letterSpacing:"0.1em",color:meta.accent,fontWeight:700,marginBottom:"0.6rem",display:"flex",alignItems:"center",gap:"0.5rem"} },
        editMode && React.createElement("span", { onMouseDown:laneHandle.onMouseDown, onTouchStart:laneHandle.onTouchStart, style:{cursor:"grab",color:S.dragGlyph,fontSize:"1.3rem",userSelect:"none",touchAction:"none"} }, "\u283f"),
        React.createElement(TitleGlyph, { name:"lanes", size:19, col:meta.accent }),
        React.createElement("span", {
          style:{flex:1,cursor:"pointer",WebkitUserSelect:"none",userSelect:"none",touchAction:"pan-y"},
          onMouseDown:sw.open.onMouseDown, onMouseUp:sw.open.onMouseUp, onTouchStart:sw.open.onTouchStart, onTouchEnd:sw.open.onTouchEnd,
          onClick:sw.guard(function(){ laneTaps(); })
        }, meta.label),
        // The same rule the cards follow: count what is THERE, and say how
        // many are finished. A count of only what is left read "0" for a lane
        // full of completed work, which is not what the lane holds.
        React.createElement("span", { "data-lanecount":topLevel.length, style:{flexShrink:0,fontSize:"0.78rem",fontWeight:700,
          color:meta.accent,opacity:0.65,fontFamily:S.fontMono,letterSpacing:"normal",textTransform:"none"} },
          (function(){ var done=topLevel.filter(isClosed).length;
            return done>0 ? (topLevel.length+" \u00b7 "+done+" done") : String(topLevel.length); })()),
        editMode&&!isBuiltin && React.createElement("button", { onClick:function(){ if(removeArm){ setRemoveArm(false); onDeleteLane(lane); } else { setRemoveArm(true); } },
          style:{background:removeArm?S.dangerBg2:"none",border:"1px solid "+(removeArm?S.dangerBright:S.dangerText),borderRadius:"6px",padding:"0.15rem 0.5rem",color:removeArm?S.dangerBright:S.dangerText,cursor:"pointer",fontSize:"0.72rem",fontWeight:removeArm?700:600,fontFamily:S.fontBody,textTransform:"none",letterSpacing:"normal"} }, removeArm?"Confirm remove?":"Remove"),
        addOpen && React.createElement("div", { ref:menuAutoScroll, "data-surface":"menu", "data-menu-open":"1", style:{position:"absolute",top:"calc(100% + 4px)",left:UI.left?"auto":0,right:UI.left?0:"auto",minWidth:"240px",background:S.menuBg,border:"1px solid "+S.border,borderRadius:S.radius2,overflow:"hidden",boxShadow:"0 8px 32px rgba(0,0,0,0.6)",zIndex:150,textTransform:"none",letterSpacing:"normal"} },
          // The same three the outline offers for a lane, in the same order.
          React.createElement(MenuRows, { onPick:function(){ setAddOpen(false); },
            items:rowMenuItems("lane", null, {
              edit:function(){ props.onEditLane(lane); },
              newLane:function(){ props.onNewLane(); },
              newProject:function(){ props.onPickLane(lane); },
              milestones:props.onLaneMilestones ? function(){ props.onLaneMilestones(lane); } : null
            }) })
        )
      ),
      // The lane's line: one mark per project in it with milestones beneath.
      // Under the header, above the cards, and only when there is something.
      !collapsed && props.onLaneMilestones && (function(){
        var pts=laneLine(props.msProjects||allProjects||[], lane, Date.now());
        return React.createElement(MilestoneStrip, { weekStart:weekStartOf(props.schedule), kind:"lane", points:pts, offDays:props.offDays,
          onOpen:function(){ props.onLaneMilestones(lane); } });
      })(),
      collapsed
        ? React.createElement("div", {
            "data-pulse": lanePulse ? "1" : undefined,
            "data-laneoval":lane,
            onMouseDown:sw.pill.onMouseDown, onMouseUp:sw.pill.onMouseUp, onTouchStart:sw.pill.onTouchStart, onTouchEnd:sw.pill.onTouchEnd,
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
            // Two figures, from two different lists: today's comes from the
            // day-scoped collection, the running total from every disruption
            // ever logged against this project or anything beneath it.
            var distToday=distStats(todayDist, allIds);
            var distTotal=distStats(allDist, allIds);
            var projDisruptions=allDist.filter(function(d){ return allIds.indexOf(d.projectId)>=0; });
            return React.createElement(ProjectCard, {
              key:proj.id, proj:proj, subTasks:subTasks, onReopen:props.onReopen, schedule:props.schedule,
              isActive:activeId===proj.id, interrupting:interrupting, elapsed:elapsed,
              todayMs:todayMs, distToday:distToday, distTotal:distTotal, projDisruptions:projDisruptions,
              onCloseOut:onCloseOut,
              onToggle:onToggle, onEdit:onEdit, onStages:onStages, onStageToggle:props.onStageToggle,
              onAddSub:props.onAddSub, onAddSibling:props.onAddSibling, onAddNested:props.onAddNested,
              onMilestones:props.onMilestones, msProjects:props.msProjects, offDays:props.offDays, msProjects:props.msProjects, offDays:props.offDays,
              activeId:activeId, todayLogs:todayLogs, todayDist:todayDist, allDist:allDist, allProjects:allProjects,
              onCloseOut:onCloseOut,
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
//   Reports, Backup & Saves, themes and tokens, settings.
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
//   settingsPanel  optional  Component rendered inside the Layout screen.
//   reports        optional  { section(ctx), text(ctx) } - an extra Reports
//                            block and extra lines in the copied report.
//   Any other field is rejected: an unknown key is a typo, not a feature.
//
// RULES a module lives by:
//   - Storage only through ctx.storage. Never touch localStorage directly -
//     that is what keeps Backup & Saves whole and enable/disable reversible.
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
                 "screens","storage","settingsPanel","reports","help"];
var TT_HELP_FIELDS = ["topic","pictures","guides","stage"];

var TT_REGISTRY = [];   // registration order
var TT_BY_ID    = {};
var TT_BOOTED   = {};

function ttStore(storage){
  if(storage) return storage;
  // The core's doorway when it is there; the platform also runs lifted out on
  // its own (the static suite), where only localStorage exists.
  if(typeof ttDbBackend==="function") return ttDbBackend();
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

// A staged module draws from memory, so its storage here is the only one it can
// reach while a picture is drawn. Same five calls as ctx.storage, nothing else.
function ttMemoryStorage(){
  var data={};
  var copy=function(v){ return JSON.parse(JSON.stringify(v)); };
  return {
    get: function(k, def){ return Object.prototype.hasOwnProperty.call(data,k) ? copy(data[k]) : def; },
    set: function(k, val){ data[k]=copy(val); return true; },
    remove: function(k){ delete data[k]; },
    keys: function(){ return Object.keys(data); },
    clear: function(){ data={}; }
  };
}

// ---- registration -----------------------------------------------------------
// The manual's entries for a module. Keys are namespaced `<id>:<key>` so they
// cannot collide with the core's ids; every entry carries what the manual needs.
function ttValidateHelp(spec){
  var errs=[], h=spec.help, id=String(spec.id);
  if(typeof h!=="object" || h===null || Array.isArray(h)) return ["help must be an object"];
  Object.keys(h).forEach(function(k){
    if(TT_HELP_FIELDS.indexOf(k)<0) errs.push("unknown help field: "+k);
  });
  if(typeof h.topic!=="string" || !h.topic.trim()) errs.push("help.topic is required");
  if(h.stage!==undefined && typeof h.stage!=="function") errs.push("help.stage must be a function");
  var entries=0;
  [["pictures","parts"],["guides","steps"]].forEach(function(pair){
    var kind=pair[0], listKey=pair[1], reg=h[kind];
    if(reg===undefined) return;
    if(typeof reg!=="object" || reg===null || Array.isArray(reg)){ errs.push("help."+kind+" must be an object"); return; }
    Object.keys(reg).forEach(function(k){
      entries++;
      var bare=k.slice(id.length+1);
      if(k.indexOf(id+":")!==0 || !TT_KEY_RE.test(bare)) errs.push("help."+kind+" key must be "+id+":<slug>: "+k);
      var e=reg[k];
      if(!e || typeof e!=="object" || typeof e.title!=="string" || !e.title.trim())
        errs.push(k+" needs a title");
      else if(!Array.isArray(e[listKey]) || !e[listKey].length) errs.push(k+" needs "+listKey);
      else if(kind==="pictures" && (!e.stage || typeof e.stage!=="object")) errs.push(k+" needs a stage");
      else if(kind==="guides") e.steps.forEach(function(st, i){
        if(!st || typeof st!=="object" || !st.stage || typeof st.stage!=="object" ||
           typeof st.ring!=="string" || typeof st.title!=="string" || typeof st.text!=="string")
          errs.push(k+" step "+(i+1)+" needs stage, ring, title and text");
      });
    });
  });
  if(entries && typeof h.stage!=="function") errs.push("help.stage is required when there are pictures or guides");
  return errs;
}

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
  if(spec.help!==undefined) errs=errs.concat(ttValidateHelp(spec));
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
    settingsPanel:spec.settingsPanel||null, reports:spec.reports||null,
    help:spec.help||null
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

// ---- data accounting --------------------------------------------------------
// What a module is costing in storage, so the Extensions screen can show it and
// the user can decide whether to keep it. Bytes are the stored JSON length,
// which is what actually counts against the localStorage quota.
function ttModuleUsage(id, storage){
  var store=ttModStorage(id, storage), st=ttStore(storage);
  var keys=store.keys(), bytes=0;
  keys.forEach(function(k){
    try{ var v=st.getItem(ttModKey(id,k)); if(v) bytes+=v.length; }catch(e){}
  });
  return { keys:keys.length, bytes:bytes };
}
// Deleting a module's data is separate from switching it off: off is
// reversible and keeps everything, this is the deliberate throw-away.
function ttClearModuleData(id, storage){
  if(!TT_BY_ID[id]) return 0;
  var store=ttModStorage(id, storage), n=store.keys().length;
  store.clear();
  return n;
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
// Reports hooks are handed the same context shape screens get - the report
// window plus ctx.storage and ctx.api - so a module reads its own data the one
// documented way instead of reaching for TT.storage() by hand.
function ttReportSections(ctx, storage){
  var out=[];
  ttEnabledModules(storage).forEach(function(m){
    if(!m.reports || !m.reports.section) return;
    try{ var el=m.reports.section(ttModuleContext(m.id, ctx)); if(el) out.push({ id:m.id, el:el }); }catch(e){}
  });
  return out;
}
function ttReportText(ctx, storage){
  var out=[];
  ttEnabledModules(storage).forEach(function(m){
    if(!m.reports || !m.reports.text) return;
    try{
      var lines=m.reports.text(ttModuleContext(m.id, ctx));
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

  usage: ttModuleUsage,
  clearData: ttClearModuleData,

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

  data: { uid: uid, findProj: findProj, getChildren: getChildren, getDescendantIds: getDescendantIds,
          getMeta: getMeta }
};
try{ window.TT = TT; }catch(e){}
// ==== TT PLATFORM END ====

// ==== TT MODULE tools BEGIN ====
// Tool Tracker - the first module built entirely against contract v1. It adds
// a new kind of record beside the timer (a tool, and a checkout of that tool)
// without touching the timer at all: no core state, no core keys, nothing on
// the board. Off until the user switches it on in Extensions.
//
//   tools     [{ id, name, tag, category, notes, createdAt }]
//   checkouts [{ id, toolId, toolName, holder, projectId, projectName,
//                note, out, in }]   - `in` is null while the tool is out
//   prefs     { holder }            - remembers who checked the last one out
//   schema    1
//
// The tool catalogue and the checkout log are kept apart on purpose. A checkout
// snapshots the tool's name and the job's name, so deleting a tool or renaming
// a project leaves the history readable instead of full of dangling ids.

var TOOLS_ID = "tools";

function toolsText(v, max){
  return typeof v === "string" ? v.slice(0, max || 120) : "";
}
function toolsStamp(v){
  return (typeof v === "number" && isFinite(v) && v > 0) ? v : 0;
}

// ---- normalizer -------------------------------------------------------------
// Idempotent, never throws, runs before first paint whether the module is on or
// off. Anything it cannot make sense of is dropped rather than left to blow up
// a render three screens later.
function toolsNormalize(store){
  var raw = store.get("tools", []);
  if(!Array.isArray(raw)) raw = [];
  var seen = {}, tools = [];
  raw.forEach(function(t){
    if(!t || typeof t !== "object" || Array.isArray(t)) return;
    var id = (typeof t.id === "string" && t.id) ? t.id : uid();
    if(seen[id]) return;
    var name = toolsText(t.name).trim();
    if(!name) return;                       // a nameless tool cannot be picked
    seen[id] = 1;
    tools.push({ id:id, name:name,
                 tag:toolsText(t.tag, 40).trim(),
                 category:toolsText(t.category, 40).trim(),
                 notes:toolsText(t.notes, 400),
                 createdAt: toolsStamp(t.createdAt) || Date.now() });
  });

  var rawCos = store.get("checkouts", []);
  if(!Array.isArray(rawCos)) rawCos = [];
  var byId = {}; tools.forEach(function(t){ byId[t.id] = t; });
  var seenCo = {}, cos = [];
  rawCos.forEach(function(c){
    if(!c || typeof c !== "object" || Array.isArray(c)) return;
    var id = (typeof c.id === "string" && c.id) ? c.id : uid();
    if(seenCo[id]) return;
    var out = toolsStamp(c.out);
    if(!out) return;                        // no start, no record
    seenCo[id] = 1;
    var toolId = typeof c.toolId === "string" ? c.toolId : "";
    var back = (typeof c["in"] === "number" && isFinite(c["in"]) && c["in"] >= out) ? c["in"] : null;
    cos.push({ id:id, toolId:toolId,
               toolName: toolsText(c.toolName).trim() || (byId[toolId] ? byId[toolId].name : "Removed tool"),
               holder: toolsText(c.holder, 60).trim(),
               projectId: (c.projectId === undefined) ? null : c.projectId,
               projectName: toolsText(c.projectName, 120).trim(),
               note: toolsText(c.note, 200),
               out: out, "in": back });
  });
  cos.sort(function(a, b){ return a.out - b.out; });

  // A tool cannot be out twice. If a write was interrupted mid-checkout the
  // older record is closed at the moment the newer one opened - the tool was
  // evidently handed on - rather than deleted, which would lose the history.
  var open = {};
  cos.forEach(function(c){
    if(c["in"] !== null) return;
    var prev = open[c.toolId];
    if(prev) prev["in"] = c.out;
    open[c.toolId] = c;
  });
  // And a checkout whose tool is gone cannot stay open: nothing can check it in.
  cos.forEach(function(c){ if(c["in"] === null && !byId[c.toolId]) c["in"] = c.out; });

  var prefs = store.get("prefs", null);
  if(!prefs || typeof prefs !== "object" || Array.isArray(prefs)) prefs = {};

  store.set("tools", tools);
  store.set("checkouts", cos);
  store.set("prefs", { holder: toolsText(prefs.holder, 60) });
  store.set("schema", 1);
}

// ---- shared queries ---------------------------------------------------------
function toolsOpenMap(cos){
  var m = {};
  (cos || []).forEach(function(c){ if(c["in"] === null) m[c.toolId] = c; });
  return m;
}
function toolsOpenList(cos){
  return (cos || []).filter(function(c){ return c["in"] === null; })
                    .sort(function(a, b){ return a.out - b.out; });
}
// How long a checkout sat inside a reporting window. An open record runs to now.
function toolsSpan(c, range, now){
  var a = c.out, b = (c["in"] === null ? (now || Date.now()) : c["in"]);
  if(range && range.start != null) a = Math.max(a, range.start);
  if(range && range.end != null)   b = Math.min(b, range.end);
  return Math.max(0, b - a);
}
function toolsInWindow(c, range, now){
  if(!range || range.start == null || range.end == null) return true;
  var b = (c["in"] === null ? (now || Date.now()) : c["in"]);
  return c.out < range.end && b > range.start;
}
// Depth-first project list for the picker, sorted the way the board is.
function toolsProjectList(projects){
  var out = [];
  function walk(parentId, depth){
    if(depth > 6) return;
    (projects || []).filter(function(p){ return (p.parentId == null ? null : p.parentId) === parentId; })
      .sort(function(a, b){ return (a.order || 0) - (b.order || 0); })
      .forEach(function(p){ out.push({ p:p, depth:depth }); walk(p.id, depth + 1); });
  }
  walk(null, 0);
  return out;
}

// ---- screen -----------------------------------------------------------------
function ToolsScreen(ctx){
  var api = ctx.api, store = ctx.storage, UIkit = api.ui;
  var S = api.tokens();                       // live: read every render

  var toolsS = useState(function(){ return store.get("tools", []); });
  var tools = toolsS[0], setToolsState = toolsS[1];
  var cosS = useState(function(){ return store.get("checkouts", []); });
  var cos = cosS[0], setCosState = cosS[1];
  var prefsS = useState(function(){ return store.get("prefs", {}); });
  var prefs = prefsS[0], setPrefsState = prefsS[1];

  // A staged picture may open on another tab; the live screen always opens on Out.
  var viewS = useState(ctx.initialView || "out"); var view = viewS[0], setView = viewS[1];
  var editorS = useState(null); var editor = editorS[0], setEditor = editorS[1];
  var sheetS = useState(null); var sheet = sheetS[0], setSheet = sheetS[1];
  var askS = useState(null); var ask = askS[0], setAsk = askS[1];
  var nowS = useState(Date.now()); var now = nowS[0], setNow = nowS[1];

  // Elapsed times tick while the screen is open, and only while it is open.
  useEffect(function(){
    var t = setInterval(function(){ setNow(Date.now()); }, 1000);
    return function(){ clearInterval(t); };
  }, []);

  function putTools(next){ setToolsState(next); store.set("tools", next); }
  function putCos(next){ setCosState(next); store.set("checkouts", next); }
  function putPrefs(next){ setPrefsState(next); store.set("prefs", next); }

  var openBy = toolsOpenMap(cos);
  var outNow = toolsOpenList(cos);
  var history = cos.filter(function(c){ return c["in"] !== null; })
                   .sort(function(a, b){ return b["in"] - a["in"]; }).slice(0, 60);

  // ---- actions ----
  function checkOut(tool, holder, projectId, projectName, note){
    api.haptic(12);
    var at = Date.now();
    var next = cos.map(function(c){
      return (c["in"] === null && c.toolId === tool.id) ? Object.assign({}, c, { "in": at }) : c;
    });
    next.push({ id:api.data.uid(), toolId:tool.id, toolName:tool.name,
                holder:holder, projectId:projectId, projectName:projectName,
                note:note, out:at, "in":null });
    putCos(next);
    if(holder !== prefs.holder) putPrefs(Object.assign({}, prefs, { holder:holder }));
    setSheet(null);
    setView("out");
  }
  function checkIn(rec){
    api.haptic(10);
    var at = Date.now();
    putCos(cos.map(function(c){ return c.id === rec.id ? Object.assign({}, c, { "in": at }) : c; }));
  }
  function saveTool(draft){
    api.haptic(10);
    var name = (draft.name || "").trim();
    if(!name) return;
    if(draft.id){
      putTools(tools.map(function(t){ return t.id === draft.id ? Object.assign({}, t, {
        name:name, tag:(draft.tag || "").trim(), category:(draft.category || "").trim(),
        notes:draft.notes || "" }) : t; }));
    } else {
      putTools(tools.concat([{ id:api.data.uid(), name:name, tag:(draft.tag || "").trim(),
        category:(draft.category || "").trim(), notes:draft.notes || "", createdAt:Date.now() }]));
    }
    setEditor(null);
  }
  // Removing a tool keeps its history - the records carry their own names -
  // and closes anything still open, because nothing could check it back in.
  function deleteTool(tool){
    api.haptic([12, 40, 12]);
    var at = Date.now();
    putCos(cos.map(function(c){
      return (c["in"] === null && c.toolId === tool.id) ? Object.assign({}, c, { "in": at }) : c;
    }));
    putTools(tools.filter(function(t){ return t.id !== tool.id; }));
    setAsk(null); setEditor(null);
  }

  // ---- styles ----
  var card = { background:S.bg1, border:"1px solid " + S.border, borderRadius:S.radius,
               padding:"0.7rem 0.8rem", marginBottom:"0.55rem" };
  var nameStyle = { flex:1, minWidth:0, color:S.text, fontWeight:700, fontSize:"0.93rem",
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" };
  var subStyle = { fontSize:"0.74rem", color:S.textDim, marginTop:"0.15rem",
                   overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" };
  var headStyle = { fontSize:"0.7rem", textTransform:"uppercase", letterSpacing:"0.08em",
                    color:S.textDim, fontWeight:700, fontFamily:S.fontBody, margin:"0.2rem 0 0.5rem" };
  function chip(text, bg, fg){
    return React.createElement("span", { style:{ background:bg, color:fg, borderRadius:S.radius3,
      padding:"0.12rem 0.42rem", fontSize:"0.68rem", fontWeight:700, whiteSpace:"nowrap",
      fontFamily:S.fontBody, flexShrink:0 } }, text);
  }
  function actionBtn(label, onClick, tone, anchor){
    var fg = tone === "warn" ? S.warnText : S.actionText;
    var bdr = tone === "warn" ? S.warnText : S.actionBdr;
    return React.createElement("button", { onClick:onClick, "data-flat":true, "data-anchor":anchor,
      style:{ background:"none", border:"1.5px solid " + bdr, borderRadius:S.radius3,
              padding:"0.42rem 0.7rem", color:fg, cursor:"pointer", fontWeight:700,
              fontFamily:S.fontBody, fontSize:"0.78rem", whiteSpace:"nowrap", flexShrink:0 } },
      label);
  }
  function jobChip(c){
    if(!c.projectName) return chip("No job", S.bg3, S.textDim);
    var proj = api.data.findProj(ctx.projects || [], c.projectId);
    var meta = proj ? api.data.getMeta(ctx.laneMeta, proj.lane) : null;
    return chip(c.projectName, meta ? meta.bg : S.bg3, meta ? meta.accent : S.textDim);
  }

  // ---- out view ----
  var outBody = outNow.length === 0
    ? React.createElement("div", { style:{ border:"2px dashed " + S.borderBright, borderRadius:S.radius,
        padding:"1.1rem 0.9rem", textAlign:"center" } },
        React.createElement("div", { style:{ color:S.text, fontWeight:700, fontSize:"0.92rem", marginBottom:"0.3rem" } },
          "Everything is in the shop"),
        React.createElement("div", { style:{ color:S.textDim, fontSize:"0.8rem", lineHeight:1.4 } },
          tools.length ? "Check a tool out from the All tab." : "Add a tool on the All tab to get started."))
    : React.createElement("div", null, outNow.map(function(c){
        return React.createElement("div", { key:c.id, style:card, "data-anchor":"tools-record" },
          React.createElement("div", { style:{ display:"flex", alignItems:"center", gap:"0.5rem" } },
            React.createElement("span", { style:nameStyle }, c.toolName),
            React.createElement(UIkit.Mono, { style:{ fontSize:"0.82rem", color:S.warnText, flexShrink:0 } },
              api.fmt.dur(now - c.out, true))
          ),
          React.createElement("div", { style:{ display:"flex", alignItems:"center", gap:"0.4rem", marginTop:"0.4rem", flexWrap:"wrap" } },
            jobChip(c),
            c.holder ? chip(c.holder, S.bg3, S.textDim) : null
          ),
          c.note ? React.createElement("div", { style:subStyle }, c.note) : null,
          React.createElement("div", { style:{ display:"flex", justifyContent:"space-between",
              alignItems:"center", gap:"0.5rem", marginTop:"0.55rem" } },
            React.createElement("span", { style:{ fontSize:"0.7rem", color:S.textMuted } },
              "Out " + api.fmt.date(c.out) + " " + api.fmt.time(c.out)),
            actionBtn("Check in", function(){ checkIn(c); }, null, "tools-checkin")
          )
        );
      }));

  // ---- all view ----
  var allBody = React.createElement("div", null,
    React.createElement("button", { onClick:function(){ api.closeMenus(); api.haptic(8);
        setEditor({ id:null, name:"", tag:"", category:"", notes:"" }); }, "data-flat":true, "data-anchor":"tools-add",
      style:{ width:"100%", background:S.bg1, border:"2px dashed " + S.actionBdr, borderRadius:S.radius,
              padding:"0.7rem", color:S.actionText, cursor:"pointer", fontWeight:700,
              fontFamily:S.fontBody, fontSize:"0.85rem", marginBottom:"0.7rem" } },
      "+ Add tool"),
    tools.length === 0
      ? React.createElement("div", { style:{ color:S.textDim, fontSize:"0.82rem", textAlign:"center",
          padding:"0.6rem 0", lineHeight:1.4 } },
          "No tools yet. Everything you add here can be checked out against a job.")
      : React.createElement("div", null, tools.slice().sort(function(a, b){
          return a.name.localeCompare(b.name); }).map(function(t){
          var openRec = openBy[t.id];
          return React.createElement("div", { key:t.id, style:card, "data-anchor":"tools-row" },
            React.createElement("div", { style:{ display:"flex", alignItems:"center", gap:"0.5rem" } },
              React.createElement("span", { style:nameStyle }, t.name),
              openRec ? chip("Out", S.warnBg, S.warnText) : chip("In", S.successBg, S.successText)
            ),
            (t.tag || t.category) && React.createElement("div", { style:subStyle },
              [t.tag, t.category].filter(Boolean).join("  \u00B7  ")),
            openRec && React.createElement("div", { style:{ display:"flex", alignItems:"center",
                gap:"0.4rem", marginTop:"0.4rem", flexWrap:"wrap" } },
              jobChip(openRec),
              React.createElement(UIkit.Mono, { style:{ fontSize:"0.74rem", color:S.textDim } },
                api.fmt.dur(now - openRec.out, true))
            ),
            React.createElement("div", { style:{ display:"flex", justifyContent:"space-between",
                alignItems:"center", gap:"0.5rem", marginTop:"0.55rem" } },
              React.createElement("button", { "data-flat":true, "data-anchor":"tools-edit",
                onClick:function(){ api.haptic(8); setEditor(Object.assign({}, t)); },
                style:{ background:"none", border:"none", padding:"0.2rem 0.1rem", color:S.textDim,
                        cursor:"pointer", fontFamily:S.fontBody, fontWeight:600, fontSize:"0.75rem" } },
                "Edit"),
              openRec
                ? actionBtn("Check in", function(){ checkIn(openRec); }, null, "tools-checkin")
                : actionBtn("Check out", function(){
                    api.closeMenus(); api.haptic(8);
                    setSheet({ tool:t, holder:prefs.holder || "",
                               projectId: ctx.activeId == null ? null : ctx.activeId,
                               note:"" });
                  }, "warn", "tools-checkout")
            )
          );
        }))
  );

  // ---- log view ----
  var logBody = history.length === 0
    ? React.createElement("div", { style:{ color:S.textDim, fontSize:"0.82rem", textAlign:"center",
        padding:"0.8rem 0", lineHeight:1.4 } }, "No completed checkouts yet.")
    : React.createElement("div", null, history.map(function(c){
        return React.createElement("div", { key:c.id, style:card, "data-anchor":"tools-log" },
          React.createElement("div", { style:{ display:"flex", alignItems:"center", gap:"0.5rem" } },
            React.createElement("span", { style:nameStyle }, c.toolName),
            React.createElement(UIkit.Mono, { style:{ fontSize:"0.8rem", color:S.textDim, flexShrink:0 } },
              api.fmt.dur(c["in"] - c.out, true))
          ),
          React.createElement("div", { style:{ display:"flex", alignItems:"center", gap:"0.4rem",
              marginTop:"0.35rem", flexWrap:"wrap" } },
            jobChip(c),
            c.holder ? chip(c.holder, S.bg3, S.textDim) : null
          ),
          React.createElement("div", { style:{ fontSize:"0.7rem", color:S.textMuted, marginTop:"0.35rem" } },
            api.fmt.date(c.out) + " " + api.fmt.time(c.out) + " \u2192 " + api.fmt.time(c["in"]))
        );
      }));

  var summary = React.createElement("div", { "data-anchor":"tools-summary", style:{ display:"flex", gap:"0.4rem",
      marginBottom:"0.7rem", flexWrap:"wrap" } },
    chip(outNow.length + (outNow.length === 1 ? " tool out" : " tools out"),
         outNow.length ? S.warnBg : S.successBg, outNow.length ? S.warnText : S.successText),
    chip(tools.length + (tools.length === 1 ? " tool" : " tools") + " tracked", S.bg3, S.textDim)
  );

  var main = React.createElement(UIkit.Modal, { title:"Tools", onClose:ctx.onClose, cancelLabel:"Close" },
    summary,
    React.createElement(UIkit.Toggle, { name:"Tool view", keys:["out", "all", "log"], value:view,
      labelOf:function(k){ return k === "out" ? "Out" : k === "all" ? "All" : "History"; },
      onChange:function(v){ setView(v); } }),
    React.createElement("div", { style:{ marginTop:"0.9rem" } },
      view === "out" ? outBody : view === "all" ? allBody : logBody)
  );

  // Sheets are siblings of the main modal, never children of it: nesting inside
  // a backdrop-filter surface is what breaks the glass themes.
  return React.createElement(React.Fragment, null,
    main,
    sheet && React.createElement(ToolsCheckoutSheet, { ctx:ctx, draft:sheet, projects:ctx.projects || [],
      onChange:setSheet, onCancel:function(){ setSheet(null); },
      onSave:function(d){
        var proj = api.data.findProj(ctx.projects || [], d.projectId);
        checkOut(d.tool, (d.holder || "").trim(), proj ? proj.id : null, proj ? proj.name : "",
                 (d.note || "").trim());
      } }),
    editor && React.createElement(ToolsEditorSheet, { ctx:ctx, draft:editor, onChange:setEditor,
      onCancel:function(){ setEditor(null); }, onSave:saveTool,
      onDelete:editor.id ? function(){ setAsk(editor.id); } : null }),
    ask && React.createElement(ToolsConfirmSheet, { ctx:ctx,
      tool:tools.filter(function(t){ return t.id === ask; })[0] || null,
      onCancel:function(){ setAsk(null); },
      onConfirm:function(){
        var t = tools.filter(function(x){ return x.id === ask; })[0];
        if(t) deleteTool(t);
      } })
  );
}

// ---- checkout sheet ---------------------------------------------------------
function ToolsCheckoutSheet(props){
  var ctx = props.ctx, api = ctx.api, UIkit = api.ui, S = api.tokens();
  var d = props.draft;
  var list = toolsProjectList(props.projects);

  function edit(field, value){
    var next = Object.assign({}, d); next[field] = value; props.onChange(next);
  }
  var input = Object.assign({}, UIkit.inputStyle());
  var label = Object.assign({}, UIkit.labelStyle());

  function projRow(entry){
    var p = entry.p;
    var on = d.projectId === p.id;
    var meta = api.data.getMeta(ctx.laneMeta, p.lane);
    return React.createElement("button", { key:p.id, "data-flat":true,
      onClick:function(){ api.haptic(8); edit("projectId", p.id); },
      style:{ display:"block", width:"100%", textAlign:"left", background:on ? meta.bg : "none",
              border:"none", borderBottom:"1px solid " + S.border,
              padding:"0.6rem 0.7rem", paddingLeft:(0.7 + entry.depth * 0.8) + "rem",
              color:on ? meta.accent : S.text, cursor:"pointer", fontFamily:S.fontBody,
              fontWeight:on ? 700 : 600, fontSize:"0.86rem",
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" } },
      p.name);
  }

  return React.createElement(UIkit.Modal, {
      title:"Check Out \u00B7 " + d.tool.name, onClose:props.onCancel,
      onSave:function(){ props.onSave(d); }, saveLabel:"Check Out", saveAnchor:"tools-save" },
    React.createElement("div", { style:{ marginBottom:"0.8rem" }, "data-anchor":"tools-holder" },
      React.createElement("label", { style:label }, "Who has it"),
      React.createElement("input", { type:"text", value:d.holder, placeholder:"Name",
        onChange:function(e){ edit("holder", e.target.value); }, style:input })
    ),
    React.createElement("div", { style:{ marginBottom:"0.8rem" }, "data-anchor":"tools-job" },
      React.createElement("label", { style:label }, "Against which job"),
      React.createElement("div", { style:{ border:"2px solid " + S.border, borderRadius:S.radius3,
          maxHeight:"190px", overflowY:"auto", background:S.bg2 } },
        React.createElement("button", { "data-flat":true,
          onClick:function(){ api.haptic(8); edit("projectId", null); },
          style:{ display:"block", width:"100%", textAlign:"left",
                  background:d.projectId == null ? S.bg3 : "none", border:"none",
                  borderBottom:"1px solid " + S.border, padding:"0.6rem 0.7rem",
                  color:d.projectId == null ? S.text : S.textDim, cursor:"pointer",
                  fontFamily:S.fontBody, fontWeight:d.projectId == null ? 700 : 600,
                  fontSize:"0.86rem" } },
          "No job"),
        list.map(projRow)
      )
    ),
    React.createElement("div", { style:{ marginBottom:"0.4rem" }, "data-anchor":"tools-note" },
      React.createElement("label", { style:label }, "Note"),
      React.createElement("input", { type:"text", value:d.note, placeholder:"Optional",
        onChange:function(e){ edit("note", e.target.value); }, style:input })
    )
  );
}

// ---- tool editor sheet ------------------------------------------------------
function ToolsEditorSheet(props){
  var ctx = props.ctx, api = ctx.api, UIkit = api.ui, S = api.tokens();
  var d = props.draft;
  function edit(field, value){
    var next = Object.assign({}, d); next[field] = value; props.onChange(next);
  }
  var input = Object.assign({}, UIkit.inputStyle());
  var label = Object.assign({}, UIkit.labelStyle());
  var field = { marginBottom:"0.8rem" };

  return React.createElement(UIkit.Modal, {
      title:d.id ? "Edit Tool" : "Add Tool", onClose:props.onCancel,
      onSave:function(){ props.onSave(d); }, saveLabel:"Save" },
    React.createElement("div", { style:field },
      React.createElement("label", { style:label }, "Name"),
      React.createElement("input", { type:"text", value:d.name, placeholder:"Torque wrench",
        onChange:function(e){ edit("name", e.target.value); }, style:input })
    ),
    React.createElement("div", { style:field },
      React.createElement("label", { style:label }, "Asset tag"),
      React.createElement("input", { type:"text", value:d.tag, placeholder:"Optional",
        onChange:function(e){ edit("tag", e.target.value); }, style:input })
    ),
    React.createElement("div", { style:field },
      React.createElement("label", { style:label }, "Category"),
      React.createElement("input", { type:"text", value:d.category, placeholder:"Optional",
        onChange:function(e){ edit("category", e.target.value); }, style:input })
    ),
    React.createElement("div", { style:field },
      React.createElement("label", { style:label }, "Notes"),
      React.createElement("input", { type:"text", value:d.notes, placeholder:"Optional",
        onChange:function(e){ edit("notes", e.target.value); }, style:input })
    ),
    props.onDelete && React.createElement("button", { "data-flat":true, onClick:props.onDelete,
      style:{ width:"100%", background:"none", border:"1px solid " + S.dangerTint,
              borderRadius:S.radius3, padding:"0.55rem", color:S.dangerText, cursor:"pointer",
              fontFamily:S.fontBody, fontWeight:600, fontSize:"0.8rem" } },
      "Remove this tool")
  );
}

// ---- delete confirmation ----------------------------------------------------
function ToolsConfirmSheet(props){
  var ctx = props.ctx, api = ctx.api, UIkit = api.ui, S = api.tokens();
  var name = props.tool ? props.tool.name : "this tool";
  return React.createElement(UIkit.Modal, { title:"Remove Tool", onClose:props.onCancel, ownActions:true },
    React.createElement("p", { style:{ color:S.textDim, fontSize:"0.85rem", lineHeight:1.4,
        marginBottom:"1rem" } },
      "Remove " + name + " from the list? Its checkout history stays in the log, and anything "
      + "still out is checked back in now."),
    React.createElement("div", { style:{ display:"flex", gap:"0.5rem" } },
      React.createElement("button", { onClick:props.onConfirm,
        style:{ flex:1, background:S.dangerBg, border:"1px solid " + S.dangerBright,
                borderRadius:S.radius, padding:"0.85rem", color:S.dangerText, cursor:"pointer",
                fontWeight:700, fontFamily:S.fontBody } }, "Remove"),
      React.createElement("button", { onClick:props.onCancel, style:UIkit.cancelStyle() }, "Keep")
    )
  );
}

// ---- reports ----------------------------------------------------------------
// Measured against the window the user is already looking at, so the numbers
// line up with the core rollup beside them instead of telling a second story.
function toolsReportStats(ctx){
  var store = ctx.storage || TT.storage(TOOLS_ID);
  var cos = store.get("checkouts", []);
  if(!Array.isArray(cos)) cos = [];
  var range = ctx.range, now = ctx.now || Date.now();
  var window_ = cos.filter(function(c){ return toolsInWindow(c, range, now); });
  var ms = window_.reduce(function(a, c){ return a + toolsSpan(c, range, now); }, 0);
  var still = cos.filter(function(c){ return c["in"] === null; });
  var byTool = {};
  window_.forEach(function(c){
    var k = c.toolName || "Tool";
    byTool[k] = (byTool[k] || 0) + toolsSpan(c, range, now);
  });
  var top = Object.keys(byTool).map(function(k){ return { name:k, ms:byTool[k] }; })
    .sort(function(a, b){ return b.ms - a.ms; }).slice(0, 5);
  return { count:window_.length, ms:ms, still:still, top:top };
}
function toolsReportText(ctx){
  var st = toolsReportStats(ctx);
  if(!st.count && !st.still.length) return [];
  var out = ["Tool checkouts: " + st.count];
  if(st.ms > 0) out.push("Tool time out: " + fmtDur(st.ms, true));
  if(st.still.length) out.push("Still out: " + st.still.length + " ("
    + st.still.slice(0, 4).map(function(c){ return c.toolName; }).join(", ")
    + (st.still.length > 4 ? ", ..." : "") + ")");
  return out;
}
function toolsReportSection(ctx){
  var st = toolsReportStats(ctx);
  if(!st.count && !st.still.length) return null;
  var S = TT.tokens();
  return React.createElement("div", { style:{ background:S.bg1, border:"1px solid " + S.border,
      borderRadius:S.radius, padding:"0.75rem 0.85rem" } },
    React.createElement("div", { style:{ fontSize:"0.7rem", textTransform:"uppercase",
      letterSpacing:"0.08em", color:S.textDim, fontWeight:700, marginBottom:"0.5rem" } }, "Tools"),
    React.createElement("div", { style:{ display:"flex", justifyContent:"space-between",
        alignItems:"baseline", gap:"0.5rem" } },
      React.createElement("span", { style:{ color:S.text, fontSize:"0.85rem", fontWeight:600 } },
        st.count + (st.count === 1 ? " checkout" : " checkouts")),
      React.createElement(Mono, { style:{ fontSize:"0.82rem", color:S.textDim } },
        fmtDur(st.ms, true))
    ),
    st.still.length > 0 && React.createElement("div", { style:{ color:S.warnText,
      fontSize:"0.78rem", marginTop:"0.35rem", fontWeight:600 } },
      st.still.length + " still out"),
    st.top.map(function(row){
      return React.createElement("div", { key:row.name, style:{ display:"flex",
          justifyContent:"space-between", gap:"0.5rem", marginTop:"0.3rem" } },
        React.createElement("span", { style:{ flex:1, minWidth:0, color:S.textDim, fontSize:"0.78rem",
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" } }, row.name),
        React.createElement(Mono, { style:{ fontSize:"0.76rem", color:S.textMuted, flexShrink:0 } },
          fmtDur(row.ms, true))
      );
    })
  );
}

// ---- help -------------------------------------------------------------------
// Tool Tracker's pages in the User Manual. They are drawn from SAMPLE data put
// into the memory store the manual hands over - never the user's own tools -
// so every picture reads the same for everyone and staging writes nothing.
// Times are relative to now, so the picture always looks current; that is also
// why no prose below quotes a figure.
function toolsHelpSample(store){
  var now = Date.now(), H = 3600000, D = 24 * H;
  store.set("tools", [
    { id:"h-torque",  name:"Torque wrench",   tag:"TW-04", category:"Hand tools",  notes:"", createdAt:now - 30 * D },
    { id:"h-caliper", name:"Digital caliper", tag:"DC-01", category:"Measuring",   notes:"", createdAt:now - 30 * D },
    { id:"h-drill",   name:"Cordless drill",  tag:"",      category:"Power tools", notes:"", createdAt:now - 30 * D }
  ]);
  store.set("checkouts", [
    { id:"h-c1", toolId:"h-torque", toolName:"Torque wrench", holder:"Sam", projectId:103,
      projectName:"Install new workbench", note:"Bench bolts", out:now - 2 * H, "in":null },
    { id:"h-c2", toolId:"h-drill", toolName:"Cordless drill", holder:"Alex", projectId:107,
      projectName:"Sort the tool wall", note:"", out:now - D - 3 * H, "in":now - D - H },
    { id:"h-c3", toolId:"h-caliper", toolName:"Digital caliper", holder:"Sam", projectId:null,
      projectName:"", note:"", out:now - 2 * D - 4 * H, "in":now - 2 * D - 3 * H }
  ]);
  store.set("prefs", { holder:"Sam" });
  store.set("schema", 1);
}
function toolsHelpStage(stage, ctx){
  toolsHelpSample(ctx.storage);
  var c = Object.assign({}, ctx, { activeId:103, activeName:"Install new workbench",
                                   initialView:stage.view || "out" });
  var nop = function(){};
  if(stage.kind === "screen") return React.createElement(ToolsScreen, c);
  if(stage.kind === "checkout")
    return React.createElement(ToolsCheckoutSheet, { ctx:c, projects:c.projects || [],
      draft:{ tool:{ id:"h-caliper", name:"Digital caliper" }, holder:"Sam", projectId:103, note:"" },
      onChange:nop, onCancel:nop, onSave:nop });
  return null;
}
var TOOLS_HELP = {
  topic: "Tool Tracker",
  stage: toolsHelpStage,
  pictures: {
    "tools:screen": { title:"The Tools screen", covers:["Tools"], back:"Back to the Tools screen",
      stage:{ kind:"screen", view:"out" }, padTop:16,
      blurb:"Tools in the menu opens it, once Tool Tracker is switched on in Extensions. It shows which tools are on the floor, against which job, and who has them.",
      parts:[
        { anchor:'[data-anchor="tools-summary"]', side:"right", label:"What is out",
          text:"How many tools are out right now, and how many are tracked altogether." },
        { anchor:'[data-anchor="set-Tool view"]', side:"right", label:"Out, All and History",
          text:"Out is what is on the floor. All is the whole catalogue, where tools are added and checked out. History is every checkout that has come back, newest first.",
          guide:"tools:out" },
        { anchor:'[data-anchor="tools-record"]', side:"right", label:"A tool that is out", first:true,
          text:"The tool, how long it has been gone, the job it is against, who has it and any note." },
        { anchor:'[data-anchor="tools-checkin"]', side:"left", label:"Check in", first:true,
          text:"Tap it when the tool comes back. The record moves into History with its times.",
          guide:"tools:back" }
      ] },
    "tools:checkout": { title:"Check Out", back:"Back to Check Out",
      stage:{ kind:"checkout" }, padTop:16,
      blurb:"The sheet Check out opens from the All tab. It names the tool being taken.",
      parts:[
        { anchor:'[data-anchor="tools-holder"]', side:"right", label:"Who has it",
          text:"Remembered from the last checkout, so it is usually filled in already." },
        { anchor:'[data-anchor="tools-job"]', side:"right", label:"Against which job",
          text:"The job that is running is picked for you. No job is a fair answer for a tool taken for general use.",
          guide:"tools:out" },
        { anchor:'[data-anchor="tools-note"]', side:"right", label:"Note",
          text:"Optional. Where it went or what it is for, shown on its card while it is out." },
        { anchor:'[data-anchor="tools-save"]', side:"above", label:"Check Out",
          text:"Records the checkout and opens the Out tab." }
      ] }
  },
  guides: {
    "tools:out": { title:"Check a tool out",
      steps:[
        { stage:{ kind:"screen", view:"all" }, ring:'[data-anchor="set-Tool view"]', side:"right", title:"Open the All tab",
          text:"Tap Tools in the menu, then All. Every tool in the catalogue is listed, marked In or Out." },
        { stage:{ kind:"screen", view:"all" }, ring:'[data-anchor="tools-add"]', side:"right", title:"Add it if it is new",
          text:"A tool that is not listed yet goes in with Add tool. Give it a name, and a tag or category if you use them." },
        { stage:{ kind:"screen", view:"all" }, ring:'[data-anchor="tools-checkout"]', side:"left", title:"Tap Check out",
          text:"On the tool’s card. A tool can only be out once, so one that is already out offers Check in instead." },
        { stage:{ kind:"checkout" }, ring:'[data-anchor="tools-holder"]', side:"right", title:"Say who has it",
          text:"Type the name. It is remembered, so next time it is filled in for you." },
        { stage:{ kind:"checkout" }, ring:'[data-anchor="tools-job"]', side:"right", title:"Pick the job",
          text:"The running job is already picked. Choose another, or No job for general use." },
        { stage:{ kind:"checkout" }, ring:'[data-anchor="tools-save"]', side:"above", title:"Tap Check Out",
          text:"The tool goes onto the Out tab with the time it left, and its clock starts." }
      ] },
    "tools:back": { title:"Check a tool back in",
      steps:[
        { stage:{ kind:"screen", view:"out" }, ring:'[data-anchor="set-Tool view"]', side:"right", title:"Open the Out tab",
          text:"Tools opens on Out: everything that is on the floor right now." },
        { stage:{ kind:"screen", view:"out" }, ring:'[data-anchor="tools-record"]', side:"right", title:"Find the tool",
          text:"Each card shows how long the tool has been gone, the job and who has it." },
        { stage:{ kind:"screen", view:"out" }, ring:'[data-anchor="tools-checkin"]', side:"left", title:"Tap Check in",
          text:"The tool is back in the shop. Check in on the All tab does the same." },
        { stage:{ kind:"screen", view:"log" }, ring:'[data-anchor="tools-log"]', side:"right", title:"It is in History",
          text:"Every checkout that has come back, newest first, with how long it was out. Removing a tool keeps its history." }
      ] }
  }
};

TT.define({
  id: TOOLS_ID,
  title: "Tool Tracker",
  version: 1,
  summary: "Check tools out against a job, see what is still on the floor, and keep the history.",
  nav: { label: "Tools", screen: "main" },
  screens: { main: ToolsScreen },
  storage: { keys: ["tools", "checkouts", "prefs", "schema"], normalize: toolsNormalize },
  reports: { section: toolsReportSection, text: toolsReportText },
  help: TOOLS_HELP
});
// ==== TT MODULE tools END ====

// ---- MAIN APP ---------------------------------------------------------------
// ---- ERROR BOUNDARY ----------------------------------------------------------
// A render crash used to reach window.onerror, which on the phone reported
// "Script error." at line 0:0 and nothing else - unactionable. React hands a
// boundary the real message and the component stack, so a crash now names
// itself on screen and can be read back verbatim. It also keeps the rest of
// the app from disappearing behind a white page.
function TTErrorBoundary(props){ return props.children; }
// ---- THE OPENING SCREEN ------------------------------------------------------
// Name and version, about a second, then gone. Deliberately brief: this is an
// app you open to start a timer, and a splash you have to sit through is a
// splash that gets in the way. A tap dismisses it at once.
//
// APP_VERSION is the public number. The build stamp stays where it has always
// been, in the boot div, because that is the thing that proves which deploy
// landed; this is the thing a person reads.
var APP_VERSION = "1.2";
var SPLASH_SHOW_MS = 2500;   // fully opaque
var SPLASH_FADE_MS = 320;    // then fades out over this
function SplashScreen(props){
  return React.createElement("div", { "data-splash":props.fading?"fading":"shown",
    onPointerDown:props.onDismiss,
    style:{position:"fixed",inset:0,zIndex:1000,background:S.bg0||S.bg1,
           display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
           gap:"0.1rem",opacity:props.fading?0:1,
           transition:"opacity "+SPLASH_FADE_MS+"ms ease-out",
           pointerEvents:props.fading?"none":"auto"} },
    React.createElement(MenuIcon, { name:"task", size:64, col:S.successText }),
    React.createElement("div", { style:{marginTop:"1.1rem",color:S.text,fontFamily:S.fontBody,
      fontWeight:800,fontSize:"1.55rem",letterSpacing:"0.01em"} }, "Time Tracker"),
    React.createElement("div", { dir:"ltr", style:{marginTop:"0.35rem",color:S.textMuted,fontFamily:S.fontBody,
      fontWeight:600,fontSize:"0.72rem",letterSpacing:"0.08em"} }, "v"+APP_VERSION));
}
var TTBoundary = (function(){
  // Only a real React has Component. The test harnesses pass a stub, and a
  // boundary is meaningless there anyway - fall back to drawing the children
  // rather than taking the whole suite down at module load.
  if(!React || typeof React.Component!=="function") return TTErrorBoundary;
  function B(p){ React.Component.call(this, p); this.state={ err:null, info:null }; }
  B.prototype = Object.create(React.Component.prototype);
  B.prototype.constructor = B;
  B.getDerivedStateFromError = function(err){ return { err:err }; };
  B.prototype.componentDidCatch = function(err, info){ this.setState({ err:err, info:info }); };
  B.prototype.render = function(){
    if(!this.state.err) return this.props.children;
    var e=this.state.err, info=this.state.info;
    var text = (e && (e.message || String(e))) + "\n\n"
      + ((e && e.stack) ? e.stack.split("\n").slice(0,6).join("\n") : "(no stack)")
      + ((info && info.componentStack) ? "\n\nin:" + info.componentStack.split("\n").slice(0,6).join("\n") : "");
    return React.createElement("div", { style:{padding:"1rem",fontFamily:"ui-monospace,Menlo,monospace",
        color:"#FFB4B4",background:"#1A0505",minHeight:"100vh",fontSize:"12px",lineHeight:1.5} },
      React.createElement("div", { style:{fontWeight:700,marginBottom:"0.6rem",fontSize:"14px"} },
        "Something broke while drawing the screen"),
      React.createElement("pre", { "data-crash":true,
        style:{whiteSpace:"pre-wrap",wordBreak:"break-word",margin:0} }, text),
      React.createElement("button", { onClick:function(){ location.reload(); },
        style:{marginTop:"1rem",padding:"0.7rem 1rem",background:"#2A1618",border:"1px solid #CC5050",
               borderRadius:"10px",color:"#FFB4B4",fontWeight:700} }, "Reload"));
  };
  return B;
})();
function TTBoard(){
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
  // The tutorial ships with history so Reports, the Day Summary and the
  // disruption badges have something to show. Empty defaults meant the one
  // place built for demonstrating the app demonstrated blank screens.
  var tLogsS=useState(function(){ return load("tt_test_logs",TEST_LOGS); }); var setTestLogs=tLogsS[1]; var testLogs=tLogsS[0];
  var rDistS=useState(function(){ return load("tt_disruptions",[]); }); var setRealDist=rDistS[1]; var realDist=rDistS[0];
  var tDistS=useState(function(){ return load("tt_test_disruptions",TEST_DIST); }); var setTestDist=tDistS[1]; var testDist=tDistS[0];
  var rBreaksS=useState(function(){ return load("tt_breaks",[]); }); var setRealBreaks=rBreaksS[1]; var realBreaks=rBreaksS[0];
  var tBreaksS=useState(function(){ return load("tt_test_breaks",TEST_BREAKS); }); var setTestBreaks=tBreaksS[1]; var testBreaks=tBreaksS[0];

  var projects=testMode?testProjects:realProjects;
  // The board, the pickers and everything that offers a project to start work
  // against see only what is open. Reports, logs and the Archive keep the lot,
  // which is what makes closing out non-destructive.
  // The board KEEPS completed records: they collapse to a greyed pill rather
  // than disappearing, because a record vanishing the moment you finish it
  // gives no confirmation that anything happened. Anything that must ignore
  // them (counts, gauges, timers) filters with isOpen where it is used.
  var liveProjects=projects;
  var setProjects=testMode?setTestProjects:setRealProjects;
  var logs=testMode?testLogs:realLogs;
  var setLogs=testMode?setTestLogs:setRealLogs;
  var disruptions=testMode?testDist:realDist;
  var setDisruptions=testMode?setTestDist:setRealDist;
  var breaks=testMode?testBreaks:realBreaks;
  var setBreaks=testMode?setTestBreaks:setRealBreaks;

  // Lane meta
  // Lanes are per-mode, like projects and logs. They were shared, which meant
  // renaming, recolouring, reordering or deleting a lane while learning in the
  // tutorial did it to the real board as well - the one part of the tutorial
  // that was not a sandbox.
  var laneOrderS=useState(function(){ return load("tt_laneorder",DEFAULT_ORDER); });
  var setRealLaneOrder=laneOrderS[1]; var realLaneOrder=laneOrderS[0];
  var laneMetaS=useState(function(){ return load("tt_lanemeta",DEFAULT_META); });
  var setRealLaneMeta=laneMetaS[1]; var realLaneMeta=laneMetaS[0];
  var tLaneOrderS=useState(function(){ return load("tt_test_laneorder",TEST_ORDER); });
  var setTestLaneOrder=tLaneOrderS[1]; var testLaneOrder=tLaneOrderS[0];
  var tLaneMetaS=useState(function(){ return load("tt_test_lanemeta",TEST_META); });
  var setTestLaneMeta=tLaneMetaS[1]; var testLaneMeta=tLaneMetaS[0];
  // Leaving the tutorial puts it back to the shipped baseline. The exit
  // dialog always claimed this happened and it never did: leaving only
  // flipped the mode flag, so the tutorial kept whatever the last visit left
  // behind - including, after an update, a seed from an older version. A
  // tutorial that has been rummaged through is no longer a demonstration, and
  // the help pages need a state they can describe.
  // The tutorial's stores persist between sessions, and they are only seeded
  // when EMPTY - so a device that ran the tutorial once kept its old copy
  // forever and never saw a single later change to the baseline. Bumping this
  // re-seeds every tutorial store on next load. Bump it whenever TEST_* data
  // changes, or the change reaches new installs only.
  function resetTutorial(){
    setTestProjects(TEST_PROJECTS);
    setTestLogs(TEST_LOGS);
    setTestDist(TEST_DIST);
    setTestBreaks(TEST_BREAKS);
    setTestLaneOrder(TEST_ORDER);
    setTestLaneMeta(TEST_META);
    ttDb.setRaw("tt_test_seed", TUTORIAL_SEED);
    ttDb.remove("tt_test_touched");
  }
  // Leaving KEEPS whatever was built in the tutorial: it is a place to come
  // back to and carry on, not a demo that wipes itself. Resetting is its own
  // deliberate act (held, like every other irreversible one).
  function leaveTutorial(){
    setTestMode(false);
    setShowTestConfirm(false);
    closeAllPopups();
  }
  function resetTutorialNow(){
    resetTutorial();
    setShowTestConfirm(false);
    closeAllPopups();
    haptic(14);
  }
  // Tutorial data from an older build is replaced on load - but ONLY while it
  // is still untouched. Once someone has built something in there it is
  // theirs, and a version bump must never take it: they get the Reset button
  // instead, which says what it will do.
  useEffect(function(){
    var seen=null, touched=null;
    seen=ttDb.getRaw("tt_test_seed"); touched=ttDb.getRaw("tt_test_touched");
    if(seen!==TUTORIAL_SEED && touched!=="1") resetTutorial();
  },[]);
  // Anything changed inside the tutorial marks it as theirs.
  useEffect(function(){
    if(!testMode) return;
    ttDb.setRaw("tt_test_touched","1");
  },[testMode, testProjects, testLogs, testDist, testBreaks, testLaneOrder, testLaneMeta]);
  // Declared AFTER the four states above: `var` hoists the name but not the
  // value, so switching before them read undefined and the board rendered
  // nothing at all.
  var laneOrder=testMode?testLaneOrder:realLaneOrder;
  var setLaneOrder=testMode?setTestLaneOrder:setRealLaneOrder;
  var laneMeta=testMode?testLaneMeta:realLaneMeta;
  var setLaneMeta=testMode?setTestLaneMeta:setRealLaneMeta;

  // ---- Session restore ----
  // Every timer below is stored as an absolute start timestamp, never as an
  // accumulated count, so elapsed time is always recomputed as (now - start).
  // That means a reload, a backgrounded app, or a hard kill all resume at the
  // correct time rather than losing the interval.
  var bootS=useState(function(){
    var s=load("tt_session",{});
    // A session is stale when it has been sitting for longer than any shift
    // could run, not when the calendar date changed. The old rule threw away a
    // live night shift at 00:00; this one keeps it and still refuses to resume
    // a timer somebody left running since last week.
    if(s.savedAt && Date.now()-s.savedAt > 20*3600000) return {};
    // Drop a restored project timer whose project is gone - deleted since, or
    // belonging to the other data set if Test Mode was toggled in between.
    if(s.activeId==null || !s.activeStart || !projects.some(function(p){ return p.id===s.activeId; })){
      s.activeId=null; s.activeStart=null; s.interrupting=false; s.intStart=null;
    }
    return s;
  });
  var boot=bootS[0];
  var bootNow=Date.now();
  // The work day this session is filed under. Set once when the clock starts -
  // by the schedule if the answer is obvious, by the person if it is not - and
  // inherited by every record made until the next clock-in. A ref shadows the
  // state so a record created in the same tick as the answer still gets it.
  var workDayS=useState(function(){ return (typeof boot.workDay==="string" && boot.workDay) ? boot.workDay : null; });
  var setWorkDayState=workDayS[1]; var workDay=workDayS[0];
  var workDayRef=useRef(workDay);
  // Whether this session was declared overtime at the clock. Only set for a day
  // that is not on the roster; null everywhere else, which leaves the otDays
  // setting in charge exactly as before.
  var workDayOtS=useState(function(){ return typeof boot.workDayOt==="boolean" ? boot.workDayOt : null; });
  var setWorkDayOtState=workDayOtS[1]; var workDayOt=workDayOtS[0];
  var workDayOtRef=useRef(workDayOt);
  function setWorkDay(v, ot){
    workDayRef.current=v||null; setWorkDayState(v||null);
    var o = typeof ot==="boolean" ? ot : null;
    workDayOtRef.current=o; setWorkDayOtState(o);
  }
  function curOt(){ return workDayOtRef.current; }
  // What every day-scoped surface means by "today": the shift being worked if
  // there is one, otherwise the calendar day.
  function curDay(){ return workDayRef.current || todayStr(); }
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
  var showAddS=useState(null); var setShowAdd=showAddS[1]; var showAdd=showAddS[0];
  var editProjS=useState(null); var setEditProj=editProjS[1]; var editProj=editProjS[0];
  var stagesProjS=useState(null); var setStagesProj=stagesProjS[1]; var stagesProj=stagesProjS[0];
  var showDisruptS=useState(false); var setShowDisrupt=showDisruptS[1]; var showDisrupt=showDisruptS[0];
  var dayAskS=useState(null); var setDayAsk=dayAskS[1]; var dayAsk=dayAskS[0];
  var disruptTargetS=useState(null); var setDisruptTarget=disruptTargetS[1]; var disruptTarget=disruptTargetS[0];
  var showBreakS=useState(false); var setShowBreak=showBreakS[1]; var showBreak=showBreakS[0];
  var showDayS=useState(false); var setShowDay=showDayS[1]; var showDay=showDayS[0];
  var showReportsS=useState(false); var setShowReports=showReportsS[1]; var showReports=showReportsS[0];
  var showBackupS=useState(false); var setShowBackup=showBackupS[1]; var showBackup=showBackupS[0];
  var showExtensionsS=useState(false); var setShowExtensions=showExtensionsS[1]; var showExtensions=showExtensionsS[0];
  // Whichever module screen is open, as { id, screen }. Null with no modules.
  var modScreenS=useState(null); var setModScreen=modScreenS[1]; var modScreen=modScreenS[0];
  // Enablement lives in storage, not in React state, so a toggle in Extensions
  // would otherwise leave the menu stale. Bumping this forces the re-render
  // that makes ttModuleNav() and the Reports hooks read the store again.
  var modTickS=useState(0); var setModTick=modTickS[1];
  var showNewLaneS=useState(false); var setShowNewLane=showNewLaneS[1]; var showNewLane=showNewLaneS[0];
  var confirmDeleteS=useState(null); var setConfirmDelete=confirmDeleteS[1]; var confirmDelete=confirmDeleteS[0];
  var closeOutS=useState(null); var setCloseOut=closeOutS[1]; var closeOut=closeOutS[0];
  var matchAskS=useState(null); var setMatchAsk=matchAskS[1]; var matchAsk=matchAskS[0];
  var startAskS=useState(null); var setStartAsk=startAskS[1]; var startAsk=startAskS[0];
  // Which period Reports opens on. The modal reads it once on mount, so every
  // entry point states its own rather than inheriting whatever was last used.
  var editLaneS=useState(null); var setEditLane=editLaneS[1]; var editLane=editLaneS[0];
  // Milestones: which project's editor is open, and which lane's roll-up view.
  var msProjS=useState(null); var setMsProj=msProjS[1]; var msProj=msProjS[0];
  var msLaneS=useState(null); var setMsLane=msLaneS[1]; var msLane=msLaneS[0];
  var msBoardS=useState(false); var setMsBoard=msBoardS[1]; var msBoard=msBoardS[0];
  var stagesDoneS=useState(null); var setStagesDone=stagesDoneS[1]; var stagesDone=stagesDoneS[0];
  var showOutlineS=useState(false); var setShowOutline=showOutlineS[1]; var showOutline=showOutlineS[0];
  var reportsKindS=useState("week"); var setReportsKind=reportsKindS[1]; var reportsKind=reportsKindS[0];
  var showArchiveS=useState(false); var setShowArchive=showArchiveS[1]; var showArchive=showArchiveS[0];
  var settingsS=useState(function(){
    var st = load("tt_settings",settingsFactory());
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
  var showThemesS=useState(false); var setShowThemes=showThemesS[1]; var showThemes=showThemesS[0];
  var showLayoutS=useState(false); var setShowLayout=showLayoutS[1]; var showLayout=showLayoutS[0];
  var showScheduleS=useState(false); var setShowSchedule=showScheduleS[1]; var showSchedule=showScheduleS[0];
  var showTrackingS=useState(false); var setShowTracking=showTrackingS[1]; var showTracking=showTrackingS[0];
  // Which menu group is showing its modal, by key, or null. One value rather
  // than a flag per group: only one can be open, and a shared key makes that
  // true by construction instead of by remembering to close the other.
  var menuGroupS=useState(null); var setMenuGroup=menuGroupS[1]; var menuGroup=menuGroupS[0];
  var distPresetsS=useState(function(){ return load("tt_distpresets",DEFAULT_DIST_PRESETS); });
  var setDistPresets=distPresetsS[1]; var distPresets=distPresetsS[0];
  var distMenuOpenS=useState(false); var setDistMenuOpen=distMenuOpenS[1]; var distMenuOpen=distMenuOpenS[0];
  var showEditPresetsS=useState(false); var setShowEditPresets=showEditPresetsS[1]; var showEditPresets=showEditPresetsS[0];
  var distMenuRef=useRef(null);
  var showTestConfirmS=useState(false); var setShowTestConfirm=showTestConfirmS[1]; var showTestConfirm=showTestConfirmS[0];
  var showGuidesS=useState(false); var setShowGuides=showGuidesS[1]; var showGuides=showGuidesS[0];
  var menuRef=useRef(null);
  var interval=useRef(null);

  // Persist
  useEffect(function(){ save("tt_testmode",testMode); },[testMode]);
  useEffect(function(){ saveTracked("tt_projects",realProjects); },[realProjects]);
  useEffect(function(){ save("tt_test_projects",testProjects); },[testProjects]);
  useEffect(function(){ saveTracked("tt_logs",realLogs); },[realLogs]);
  useEffect(function(){ save("tt_test_logs",testLogs); },[testLogs]);
  useEffect(function(){ saveTracked("tt_disruptions",realDist); },[realDist]);
  useEffect(function(){ save("tt_test_disruptions",testDist); },[testDist]);
  useEffect(function(){ saveTracked("tt_breaks",realBreaks); },[realBreaks]);
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
      interrupting:interrupting, intStart:intStart, workDay:workDay, workDayOt:workDayOt });
  },[activeId,activeStart,atWorkStart,breakStart,breakLabel,interrupting,intStart,workDay,workDayOt]);

  // ---- Automatic backups ----
  // After clock-out: this effect runs after the save effects above in the
  // same commit, and a beat later still, so the copy holds the finished day.
  var snapAfterClockOut=useRef(false);
  useEffect(function(){
    if(atWorkStart || !snapAfterClockOut.current) return;
    snapAfterClockOut.current=false;
    var t=setTimeout(function(){ snapTake("clockout").catch(function(){}); }, 600);
    return function(){ clearTimeout(t); };
  },[atWorkStart, realLogs]);
  // Opening the app when the newest automatic copy is over a day old (a
  // forgotten clock-out) takes one then - unless the clock is running, when
  // the clock-out will. Also asks the browser to keep this app's storage.
  useEffect(function(){
    var t=setTimeout(function(){
      try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function(){}); }catch(e){}
      if(load("tt_session",{}).atWorkStart) return;
      snapList().then(function(l){
        var n=snapNewestAuto(l);
        if(!n || Date.now()-n.at > DAY_MS) return snapTake("open");
      }).catch(function(){});
    }, 2500);
    return function(){ clearTimeout(t); };
  },[]);

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
  // The active work day, not the calendar day: on a night shift these differ
  // after midnight, and the board has to keep showing the shift you are on.
  var todayStr2=workDay||todayStr();
  var todayLogs=logs.filter(function(l){ return recordDay(l)===todayStr2; });
  var todayDist=disruptions.filter(function(d){ return d.endTime&&recordDay(d)===todayStr2; });
  var todayBreaks=breaks.filter(function(b){ return recordDay(b)===todayStr2; });
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
    setShowBreak(false); setShowDay(false); setShowNewLane(false);
    setShowReports(false); setShowBackup(false); setShowExtensions(false); setModScreen(null);
    setConfirmDelete(null); setShowTestConfirm(false); setShowGuides(false); setStartAsk(null);
    setMenuOpen(false); setDistMenuOpen(false); setShowEditPresets(false); setShowThemes(false); setShowLayout(false); setShowSchedule(false); setShowTracking(false); setMenuGroup(null); setShowOutline(false); setEditLane(null); setMsProj(null); setMsLane(null); setMsBoard(false); setStagesDone(null);
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
    function closeHeaderMenus(){ setMenuOpen(false); setDistMenuOpen(false); setMenuGroup(null); }
    window.addEventListener("ttCloseMenus",closeHeaderMenus);
    return function(){ window.removeEventListener("ttCloseMenus",closeHeaderMenus); };
  },[]);

  // Actions
  // Starting the clock is the one moment the work day is decided. Inside the
  // scheduled window it is obvious and nothing is asked; outside it the prompt
  // opens and clockIn does nothing at all until an answer comes back, so a
  // half-started session can never exist.
  // Clocking in may need a question answered first. `then` is what the user
  // was actually trying to do, and it runs once the day is settled - on both
  // paths, so the caller never has to know which one it took.
  //
  // Without it, tapping a project outside a shift asked which shift, took the
  // answer, clocked in, and dropped the tap on the floor: the board came back
  // with nothing running and no sign anything had been missed.
  //
  // `then` is handed the clock-in moment, not the moment the question was
  // answered, so the project and the At Work log start on the same timestamp
  // rather than seconds apart.
  function clockIn(then){
    var now=Date.now();
    var auto=autoWorkDay(settings.workSchedule, now, normalizeGrace(settings.shiftGrace));
    if(auto===null){
      askWorkDay(now, function(day, ot){ commitClockIn(now, day, ot); if(then) then(now); });
      return false;
    }
    commitClockIn(now, auto, null);
    if(then) then(now);
    return true;
  }
  function commitClockIn(now, day, ot){
    haptic(20);
    setWorkDay(day, ot);
    setAtWorkStart(now); setAtWorkElapsed(0);
    setLogs(function(prev){ return prev.concat([{id:uid(),day:day,projectId:null,projectName:"At Work",lane:null,type:"atwork",startTime:now,endTime:null,duration:0,parentId:null,parentName:null}]); });
  }
  // Opens the prompt and hands the chosen day to `then`. Kept separate from
  // clockIn so the same question can be re-asked to correct a mis-tap.
  function askWorkDay(now, then, opts){
    var ctx=shiftContext(settings.workSchedule, now, normalizeGrace(settings.shiftGrace));
    var choices=shiftChoices(ctx);
    // Picking a day that is not on the roster raises a second question, because
    // there is no schedule to say whether it is regular time or overtime.
    function resolve(c){
      if(!c.unscheduled){ then(c.day, null); return; }
      closeAllPopups();
      setDayAsk({ when:now, stage:"ot", choices:OT_CHOICES, title:"Regular or Overtime?",
                  then:function(_,ot){ then(c.day, ot); } });
    }
    if(choices.length<2){
      // Only one answer is reachable - a schedule with a single working day, or
      // none at all. Nothing to choose between, but an unscheduled day still
      // has to be classified.
      resolve(choices.length ? choices[0] : { day:workDayOf(now), unscheduled:false });
      return;
    }
    closeAllPopups();
    setDayAsk({ when:now, stage:"day", position:ctx.position, choices:choices, then:then,
                resolve:resolve, title:(opts&&opts.title)||"Which Shift?" });
  }
  function finalizeProject(now){
    if(!activeId||!activeStart) return;
    var proj=projects.find(function(p){ return p.id===activeId; });
    if(!proj) return;
    var dur=now-activeStart;
    var parent=proj.parentId?projects.find(function(p){ return p.id===proj.parentId; }):null;
    setLogs(function(prev){ return prev.concat([{id:uid(),day:curDay(),ot:curOt(),projectId:proj.id,projectName:proj.name,lane:proj.lane,type:"project",startTime:activeStart,endTime:now,duration:dur,parentId:proj.parentId||null,parentName:parent?parent.name:null}]); });
    setActiveId(null); setActiveStart(null); setElapsed(0);
  }
  function toggleProject(id, force){
    haptic(12);
    // A project scheduled to start later is not startable by tapping - the
    // press opens the question instead. Checked before the clock-in prompt so
    // an early tap does not also drag the work day into it. Only starting is
    // gated: whatever is already running can always be stopped.
    if(startAction(projects, activeId, id, force)==="ask"){
      setStartAsk(findProj(projects, id)); return;
    }
    // Not clocked in yet: clock in first and carry the tap through, so that
    // answering the shift question does the thing that was asked for. Both
    // clock-in paths call back, so there is one route through here.
    if(!atWorkStart){ clockIn(function(at){ runToggle(id, at); }); return; }
    runToggle(id, Date.now());
  }
  // The start/stop itself, once the work day is settled.
  function runToggle(id, now){
    if(activeId===id){
      if(interrupting){ resumeProject(); return; }
      finalizeProject(now);
    } else {
      if(activeId) finalizeProject(now);
      setActiveId(id); setActiveStart(now); setElapsed(0); setInterrupting(false);
    }
  }
  // Started early. The start on record moves to now, or the card would go on
  // reading as scheduled while its timer runs, and the button would grey again
  // the moment it was stopped.
  function startPendingNow(p){
    var now=Date.now();
    setProjects(function(prev){ return prev.map(function(x){
      return x.id===p.id ? Object.assign({},x,{ startAt:now }) : x; }); });
    setStartAsk(null);
    toggleProject(p.id, true);
  }
  // The plan was wrong rather than the timing. Nothing starts.
  function reschedulePending(p, ts){
    setProjects(function(prev){ return prev.map(function(x){
      return x.id===p.id ? Object.assign({},x,{ startAt:ts }) : x; }); });
    setStartAsk(null);
    haptic(10);
  }
  function clockOut(){
    haptic([20,50,20]);
    // The day's automatic backup, once the clock-out has been written - the
    // effect below takes it. Never for the practice board.
    if(!testMode) snapAfterClockOut.current=true;
    var now=Date.now();
    if(activeId) finalizeProject(now);
    if(openDist) closeDisruption(now);
    if(onBreak) endBreak();
    setLogs(function(prev){ return prev.map(function(l){ return (!l.endTime&&l.type==="atwork")?Object.assign({},l,{endTime:now,duration:now-l.startTime}):l; }); });
    setAtWorkStart(null); setAtWorkElapsed(0);
    // Land on Reports for the day just finished. The question at the end of a
    // shift is what the day came to, and Reports answers it with the schedule
    // and pay context beside it; the copy-out sheet answered a narrower one.
    // Day Summary is still reachable from the ticker.
    openReports("day");
  }
  // Reports, opened on a stated period.
  function openReports(kind){
    closeAllPopups();
    setReportsKind(kind||"week");
    setShowReports(true);
  }
  // The outline is the source of truth on save: lane, parent and order all
  // come from where each row ended up, so a record cannot keep a lane its
  // position no longer agrees with.
  function saveOutline(rows){
    var res=outlineApply(rows, projects, laneMeta, function(){ return "custom_"+uid(); });
    setLaneOrder(res.laneOrder);
    setLaneMeta(res.laneMeta);
    setProjects(res.projects);
    setShowOutline(false);
    haptic(18);
  }
  // Tapping a row in the outline opens that item's own editor.
  // Tapping a row's name opens that item's own editor ON TOP of the outline,
  // which stays mounted. Closing the editor lands back in the outline with
  // whatever rearranging was already done still there, rather than dumping
  // the user back on the board.
  function openFromOutline(row){
    if(row.kind==="lane"){ setEditLane(row.id); return; }
    var proj=findProj(projects, row.kind==="stage" ? row.hostId : row.id);
    if(!proj) return;
    if(row.kind==="stage"){ setStagesProj(proj); return; }
    setEditProj(proj);
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
    setDisruptions(function(prev){ return prev.concat([{id:uid(),day:curDay(),projectId:tgt?tgt.id:null,projectName:tgt?tgt.name:null,lane:tgt?tgt.lane:null,note:note,startTime:now,endTime:null,duration:0}]); });
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
    setBreaks(function(prev){ return prev.concat([{id:uid(),day:curDay(),label:label,startTime:now,endTime:null,duration:0}]); });
    setOnBreak(true); setBreakStart(now); setBreakElapsed(0); setBreakLabel(label);
  }
  function endBreak(){
    haptic(12);
    var now=Date.now();
    setBreaks(function(prev){ return prev.map(function(b){ return !b.endTime?Object.assign({},b,{endTime:now,duration:now-b.startTime}):b; }); });
    setOnBreak(false); setBreakStart(null); setBreakElapsed(0); setBreakLabel("");
  }
  function addProject(data){
    var id=newProjectId(projects);
    var siblings=projects.filter(function(p){ return p.lane===data.lane&&p.parentId===(data.parentId||null); });
    setProjects(function(prev){ return prev.concat([Object.assign({},data,{id:id,order:siblings.length,stages:[]})]);  });
    setShowAdd(null);
  }
  function saveEdit(data){
    var target=editProj;
    var next=projects.map(function(p){ return p.id===target.id?Object.assign({},p,data):p; });
    setProjects(next);
    setEditProj(null);
    // Changing a project's type leaves its tasks behind. They are independently
    // settable, so this is a question rather than a cascade.
    if(projKind(data)!==projKind(target)){
      var stale=mismatchedTasks(next, findProj(next, target.id));
      if(stale.length) setMatchAsk({ proj:findProj(next, target.id), tasks:stale });
    }
  }
  function doMatchTasks(proj, tasks){
    // An empty selection is a valid answer: leave every task as it is.
    if(!tasks || !tasks.length){ setMatchAsk(null); return; }
    var ids={}; tasks.forEach(function(t){ ids[t.id]=1; });
    var want=projKind(proj);
    setProjects(function(prev){ return prev.map(function(p){
      return ids[p.id] ? Object.assign({},p,{ kind:want }) : p;
    }); });
    haptic(10);
    setMatchAsk(null);
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
  // ---- close out and reopen ----
  // Closing stops the clock if the project being closed is the one running,
  // then stamps it. Nothing is removed and no log is rewritten.
  function askCloseOut(proj){
    closeAllPopups();
    setCloseOut({ proj:proj, blockers:closeBlockers(projects, proj) });
  }
  // opts: { at, outcome, note, children:"close"|"move" }. Closing stamps the
  // record with when it was completed - editable, so a close-out done the
  // next morning can carry yesterday's time - and what the outcome was. Open
  // children are closed with it or moved up a level; never silently hidden.
  // opts: { at, outcome, note, resolutions:{ childId:{kind:"move",lane,parentId}|{kind:"delete"} } }.
  // Every open child has been decided by the sheet: a moved child takes its
  // new lane and parent (its own subtree comes along, parents unchanged); a
  // deleted child goes with its subtree. Nothing is closed over silently, and
  // an undecided child means the sheet never let this run.
  function doCloseOut(proj, opts){
    opts = (opts && typeof opts==="object") ? opts : { note:opts };
    var at = opts.at || Date.now(), res = opts.resolutions || {};
    var kids = getDescendantIds(projects, proj.id);
    var ids = kids.concat([proj.id]);
    if(activeId!==null&&ids.indexOf(activeId)>=0){ finalizeProject(Date.now()); }
    var openKids = kids.filter(function(id){ var k=findProj(projects,id); return k && isOpen(k) && k.parentId===proj.id; });
    if(openKids.some(function(id){ return !res[id]; })) return;   // the sheet blocks this; belt and braces
    var gone = {};
    openKids.forEach(function(id){ if(res[id].kind==="delete"){ gone[id]=true; getDescendantIds(projects,id).forEach(function(d){ gone[d]=true; }); } });
    setProjects(function(prev){ return prev.filter(function(p){ return !gone[p.id]; }).map(function(p){
      if(p.id===proj.id) return Object.assign({},p,{ closedAt:at, closedNote:opts.note||"", closedOutcome:opts.outcome||"done" });
      var r=res[p.id];
      if(r && r.kind==="move" && p.parentId===proj.id) return Object.assign({},p,{ parentId:r.parentId||null, lane:r.lane||p.lane });
      return p;
    }); });
    haptic(14);
    setCloseOut(null); setStagesDone(null);
  }
  // Reopening a task whose parent is closed would put it on a board its parent
  // has left, so the parent comes back with it.
  function doReopen(proj){
    var ids={}; ids[proj.id]=1;
    var cur=proj;
    for(var i=0;i<8 && cur && cur.parentId!=null;i++){
      cur=findProj(projects, cur.parentId);
      if(cur && isClosed(cur)) ids[cur.id]=1; else break;
    }
    setProjects(function(prev){ return prev.map(function(p){
      return ids[p.id] ? Object.assign({},p,{ closedAt:null, closedNote:"" }) : p;
    }); });
    haptic(10);
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
    var next=null;
    setProjects(function(prev){ return prev.map(function(p){
      if(p.id!==projId) return p;
      var updated=Object.assign({},p,{stages:(p.stages||[]).map(function(st){
        if(st.id!==stageId) return st;
        return st.done ? Object.assign({},st,{done:false,doneAt:null,note:""})
                       : Object.assign({},st,{done:true,doneAt:Date.now()});
      })});
      next=updated;
      return updated;
    }); });
    // Ticking the last stage of a finite project is the moment to offer to
    // close it. An offer, not an action: the modal still has to be confirmed,
    // and unticking a stage never asks anything. Ongoing projects never ask,
    // however many stages they have - that is what makes them ongoing.
    // An offer with a choice: complete it, or add the stages still to come.
    // Ongoing or finite alike - all stages ticked is the question either way.
    if(next && isOpen(next) && stagesAllDone(next)){
      setStagesDone(next);
    }
  }
  function addLane(label, col){
    var key="custom_"+uid();
    setLaneMeta(function(prev){ var n=Object.assign({},prev); n[key]={label:label,accent:col.accent,bg:col.bg,dim:col.dim}; return n; });
    setLaneOrder(function(prev){ return prev.concat([key]); });
  }
  // Milestone steps are written to their project. Nothing is written for a
  // lane: its line is computed.
  function saveMilestones(pid, steps){
    setProjects(function(prev){ return prev.map(function(p){ return p.id===pid ? Object.assign({}, p, { milestones:steps }) : p; }); });
    setMsProj(null); haptic(14);
  }
  // One lane, renamed and recoloured in its own editor.
  function saveLaneEdit(key, label, col){
    setLaneMeta(function(prev){
      var n=Object.assign({},prev);
      n[key]=Object.assign({}, n[key]||{}, { label:label, accent:col.accent, bg:col.bg, dim:col.dim });
      return n;
    });
    setEditLane(null); haptic(14);
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


  // Clock header button
  var ckSub = clocked ? fmtDur(atWorkElapsed,true) : "start day";

  // Test-mode frame
  // The tutorial used to be a 24px frame on all four sides, which inset the
  // whole app by 48px each way - so the tutorial and the real board did not
  // lay out identically, and help-page screenshots would not match what a
  // user sees. It is one bar at the head now, and nothing else moves.
  var FW = 0;
  var TUT_H = testMode ? 30 : 0;

  // Handedness + header position
  var isLeft = settings.handedness==="left";
  UI.left = isLeft;
  var hdrBottom = settings.headerPos==="bottom";
  // The header runs opposite to the board behind it. The whole page mirrors on
  // handedness via dir, so the bar is reversed on top of that: the menu button
  // lands on the right for a right-handed user and on the left for a left-
  // handed one. row-reverse achieves it under both dir values, because in RTL
  // a reversed row already reads left-to-right.
  var hdrMenuRight = !isLeft;
  UI.bottom = hdrBottom;
  var hdrStyle = hdrBottom
    ? { position:"fixed", bottom:0, left:0, right:0, zIndex:300, boxShadow:"0 -4px 24px rgba(0,0,0,0.55)" }
    : { position:"fixed", top:TUT_H, left:0, right:0, zIndex:300, boxShadow:"0 4px 24px rgba(0,0,0,0.55)" };
  var spacerH = hdrBottom ? (testMode ? (8+TUT_H)+"px" : "8px") : (testMode ? (104+TUT_H)+"px" : "104px");
  var rootPadBottom = hdrBottom ? "178px" : "4rem";
  var ddTop = hdrBottom ? "auto" : "calc(100% + 6px)";
  var ddBottom = hdrBottom ? "calc(100% + 6px)" : "auto";
  UI.bottomClear = hdrBottom ? 114 : 0;
  UI.topClear = hdrBottom ? FW : (114 + FW);

  // ---- Screen ticker: date/time + live status ----
  var tickerEl = React.createElement(HeaderTicker, { interrupting:interrupting, activeProj:activeProj, intElapsed:intElapsed,
    wsActive:wsActive, elapsed:elapsed, onBreak:onBreak, breakLabel:breakLabel, breakElapsed:breakElapsed,
    clocked:clocked, atWorkElapsed:atWorkElapsed, nowTick:nowTick, bottom:hdrBottom });

  return (
    React.createElement("div", { dir:isLeft?"rtl":"ltr", style:{minHeight:"100vh",background:S.bg0,color:S.text,fontFamily:S.fontBody,paddingBottom:rootPadBottom,paddingLeft:FW,paddingRight:FW} },
      React.createElement("style", null,
        "@import url('"+S.fontImport+"'); "+
        // No elastic bounce at the document edges: in an installed app the
        // bounce is noise, and losing pull-to-refresh is a feature.
        "html,body{overscroll-behavior:none;} "+
        // A disrupted project breathes rather than blinks: same 2.4s cycle as
        // the running-project border, so the two cues feel like one language.
        "@keyframes ttGlow { 0%,100% { text-shadow:0 0 6px var(--glow-s1); } 50% { text-shadow:0 0 22px var(--glow-s2), 0 0 10px var(--glow-s2), 0 0 3px var(--glow-s2); } } "+
        "[data-glow='1']{ animation: ttGlow 2.4s ease-in-out infinite; } "+
        // Running projects breathe: border color and glow ease between the
        // lane accent and a brightened peak. Driven by CSS vars so one rule
        // serves every lane color.
        "@keyframes ttPulse { 0%,100% { border-color:var(--pulse-a); box-shadow:0 0 8px var(--pulse-s1); } 50% { border-color:var(--pulse-b); box-shadow:0 0 20px var(--pulse-s2); } } "+
        "[data-pulse='1']{ animation: ttPulse 2.4s ease-in-out infinite; } "+
        // iOS renders a time input's value inside shadow parts with their own
        // UA background and color. Make every part transparent and force it to
        // carry the input's color; -webkit-text-fill-color outranks UA color.
        // The zoom guard. Inline styles beat ordinary CSS, so this has to
        // outrank them: one field left under 16px is enough to zoom the app
        // and strand it there.
        "input,select,textarea{ font-size:16px !important; } "+
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

      // ---- TUTORIAL BAR ----
      // One bar, always at the head - never mirrored by handedness, never
      // moved by the header-position setting. Two reasons: it is a state you
      // are IN rather than a control you reach for, so it should be somewhere
      // constant; and the head is the one place a thumb does not land while
      // working the board, so Exit cannot be hit by accident.
      testMode && React.createElement("div", { dir:"ltr", "data-tutorialbar":true,
        style:{position:"fixed",top:0,left:0,right:0,height:TUT_H+"px",
               background:S.testFrameBg,borderBottom:"2px solid "+S.testFrameInk,
               zIndex:400,display:"flex",alignItems:"center",
               padding:"0 0.4rem 0 0.85rem",gap:"0.6rem"} },
        React.createElement(MenuIcon, { name:"test", size:17, col:S.testFrameInk }),
        React.createElement("span", { style:{flex:1,color:S.testFrameInk,fontSize:"0.66rem",
               fontWeight:800,letterSpacing:"0.22em",fontFamily:S.fontBody,whiteSpace:"nowrap"} },
          "PRACTICE BOARD"),
        // The manual from inside practice: read a step, close it, try it here.
        React.createElement("button", { "data-tutorialguides":true, "aria-label":"Guides",
          onClick:function(){ closeAllPopups(); setShowGuides(true); },
          style:{flexShrink:0,display:"flex",alignItems:"center",background:"none",border:"1.5px solid "+S.testFrameInk,
                 borderRadius:S.radius3,padding:"0.12rem 0.45rem",cursor:"pointer",WebkitTapHighlightColor:"transparent"} },
          React.createElement(MenuIcon, { name:"manual", size:16, col:S.testFrameInk })),
        React.createElement("button", { "data-tutorialexit":true,
          onClick:function(){ closeAllPopups(); setShowTestConfirm(true); },
          style:{flexShrink:0,background:"none",border:"1.5px solid "+S.testFrameInk,
                 borderRadius:S.radius3,padding:"0.2rem 0.7rem",color:S.testFrameInk,
                 cursor:"pointer",fontFamily:S.fontBody,fontWeight:800,fontSize:"0.64rem",
                 letterSpacing:"0.1em",WebkitTapHighlightColor:"transparent"} }, "EXIT")
      ),

      // ---- STICKY HEADER ----
      React.createElement("div", { style:hdrStyle },
        hdrBottom ? null : tickerEl,
        // Written Menu | Clock | Disruption; row-reverse paints it the other
        // way round, so the menu sits opposite the side the board mirrors to.
        React.createElement("div", { style:{display:"flex",flexDirection:"row-reverse",alignItems:"stretch",background:S.bg1,borderBottom:"2px solid "+S.border,padding:"0.5rem 0.75rem",gap:"0.5rem"} },
          // SETTINGS MENU button (gear) + stacked dropdown
          React.createElement("div", { ref:menuRef, style:{position:"relative",flex:"0 0 64px"} },
            React.createElement(HeaderMenuButton, { open:menuOpen,
              onClick:function(){ if(!menuOpen){ try{ window.dispatchEvent(new Event("ttCloseMenus")); }catch(e){} } setMenuOpen(function(x){ return !x; }); } }),
            menuOpen && React.createElement("div", { dir:"ltr", "data-surface":"menu", "data-menu-open":"1", style:{position:"absolute",top:ddTop,bottom:ddBottom,left:hdrMenuRight?"auto":0,right:hdrMenuRight?0:"auto",minWidth:"290px",maxWidth:"94vw",maxHeight:"72vh",overflowY:"auto",background:S.menuBg,border:"1px solid "+S.border,borderRadius:S.radius2,boxShadow:"0 8px 32px rgba(0,0,0,0.6)",zIndex:200} },
              // USER MANUAL row - at the top, where the tutorial row was. It opens a
              // group: Guides, and the Practice Board (the tutorial, renamed). On
              // the practice board it reads in the warning colour, so the way out
              // is as easy to find as it was when this row said Exit Tutorial.
              React.createElement("button", { "data-flat":true, "data-menugroup":"manual",
                onClick:function(){ setMenuOpen(false); setMenuGroup("manual"); },
                style:{display:"flex",alignItems:"center",gap:"0.5rem",width:"100%",textAlign:"left",background:testMode?S.warnBg:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.8rem 1rem",color:testMode?S.warnText:S.text,cursor:"pointer",fontFamily:S.fontBody,fontWeight:testMode?700:600,fontSize:MENU_FONT,whiteSpace:"nowrap"} },
                React.createElement(MenuIcon, { name:"manual", col:testMode?S.warnText:S.chromeText }),
                React.createElement("span", { style:{flex:1} }, "User Manual"),
                React.createElement("span", { style:{fontSize:"0.9rem",color:testMode?S.warnText:S.textDim} }, "\u203A")
              ),
              // Edit Lanes and Arrange both left this menu when Edit... arrived:
              // the outline lists every lane and reorders everything, so two
              // more ways to do the same thing were two more to keep in step.
              // The lanes list is still reachable from a lane header on the
              // board (long-press, or its + menu).
              React.createElement("button", { "data-flat":true, onClick:function(){ closeAllPopups(); setShowOutline(true); },
                style:{display:"flex",alignItems:"center",gap:"0.5rem",width:"100%",textAlign:"left",background:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.8rem 1rem",color:S.text,cursor:"pointer",fontFamily:S.fontBody,fontWeight:600,fontSize:MENU_FONT,whiteSpace:"nowrap"} },
                React.createElement(MenuIcon, { name:"arrange", col:S.chromeText }),
                React.createElement("span", { style:{flex:1} }, "Edit\u2026")
              ),
              // Time Settings: the schedule and how time is captured. Opens a
              // modal rather than expanding here - see MenuGroupModal.
              React.createElement("button", { "data-flat":true, "data-menugroup":"time",
                onClick:function(){ setMenuOpen(false); setMenuGroup("time"); },
                style:{display:"flex",alignItems:"center",gap:"0.5rem",width:"100%",textAlign:"left",background:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.8rem 1rem",color:S.text,cursor:"pointer",fontFamily:S.fontBody,fontWeight:600,fontSize:MENU_FONT,whiteSpace:"nowrap"} },
                React.createElement(MenuIcon, { name:"clock", col:S.chromeText }),
                React.createElement("span", { style:{flex:1} }, "Time Settings"),
                React.createElement("span", { style:{fontSize:"0.9rem",color:S.textDim} }, "\u203A")
              ),
              // Interface: how the app looks and how it is reached.
              React.createElement("button", { "data-flat":true, "data-menugroup":"interface",
                onClick:function(){ setMenuOpen(false); setMenuGroup("interface"); },
                style:{display:"flex",alignItems:"center",gap:"0.5rem",width:"100%",textAlign:"left",background:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.8rem 1rem",color:S.text,cursor:"pointer",fontFamily:S.fontBody,fontWeight:600,fontSize:MENU_FONT,whiteSpace:"nowrap"} },
                React.createElement(TouchSVG, { size:MENU_ICON, col:S.chromeText }),
                React.createElement("span", { style:{flex:1} }, "Interface"),
                React.createElement("span", { style:{fontSize:"0.9rem",color:S.textDim} }, "\u203A")
              ),
              // Summary
              React.createElement("button", { "data-flat":true, onClick:function(){ if(todayLogs.length){ closeAllPopups(); setShowDay(true); } },
                style:{display:"flex",alignItems:"center",gap:"0.5rem",width:"100%",textAlign:"left",background:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.8rem 1rem",color:summaryCol,cursor:todayLogs.length?"pointer":"default",fontFamily:S.fontBody,fontWeight:600,fontSize:MENU_FONT,whiteSpace:"nowrap"} },
                React.createElement(MenuIcon, { name:"summary", col:summaryCol }),
                "Summary"
              ),
              // Reports
              React.createElement("button", { "data-flat":true, onClick:function(){ openReports("week"); },
                style:{display:"flex",alignItems:"center",gap:"0.5rem",width:"100%",textAlign:"left",background:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.8rem 1rem",color:S.text,cursor:"pointer",fontFamily:S.fontBody,fontWeight:600,fontSize:MENU_FONT,whiteSpace:"nowrap"} },
                React.createElement(MenuIcon, { name:"reports", col:S.text }),
                "Reports"
              ),
              // Archive: everything closed out, with its history intact.
              React.createElement("button", { "data-flat":true, onClick:function(){ closeAllPopups(); setShowArchive(true); },
                style:{display:"flex",alignItems:"center",gap:"0.5rem",width:"100%",textAlign:"left",background:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.8rem 1rem",color:S.text,cursor:"pointer",fontFamily:S.fontBody,fontWeight:600,fontSize:MENU_FONT,whiteSpace:"nowrap"} },
                React.createElement(MenuIcon, { name:"archive", col:S.chromeText }),
                React.createElement("span", { style:{flex:1} }, "Archive"),
                (function(){
                  var n=projects.filter(isClosed).length;
                  return n ? React.createElement(Mono, { style:{color:S.textDim,fontSize:"0.8rem",fontWeight:700} }, String(n)) : null;
                })()
              ),
              // Backup & Saves
              React.createElement("button", { "data-flat":true, onClick:function(){ closeAllPopups(); setShowBackup(true); },
                style:{display:"flex",alignItems:"center",gap:"0.5rem",width:"100%",textAlign:"left",background:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.8rem 1rem",color:S.text,cursor:"pointer",fontFamily:S.fontBody,fontWeight:600,fontSize:MENU_FONT,whiteSpace:"nowrap"} },
                React.createElement(MenuIcon, { name:"backup", col:S.text }),
                "Backup & Saves"
              ),
              // Extensions
              React.createElement("button", { "data-flat":true, onClick:function(){ closeAllPopups(); setShowExtensions(true); },
                style:{display:"flex",alignItems:"center",gap:"0.5rem",width:"100%",textAlign:"left",background:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.8rem 1rem",color:S.text,cursor:"pointer",fontFamily:S.fontBody,fontWeight:600,fontSize:MENU_FONT,whiteSpace:"nowrap"} },
                React.createElement(MenuIcon, { name:"extensions", col:S.text }),
                "Extensions"
              ),
              // Module rows: one group header, then one row per enabled module
              // that declares a nav entry. Renders nothing while none exist.
              modGroups.map(function(g){
                return React.createElement("div", { key:g.name },
                  React.createElement("div", { style:{padding:"0.55rem 1rem 0.35rem",color:S.textDim,fontSize:"0.66rem",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.09em",borderBottom:"1px solid "+S.border,background:rgba(S.bg0,0.5),whiteSpace:"nowrap"} }, g.name),
                  g.items.map(function(entry){
                    return React.createElement("button", { "data-flat":true, key:entry.id+":"+entry.screen,
                      onClick:function(){ openModule(entry); },
                      style:{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.8rem 1rem",color:S.text,cursor:"pointer",fontFamily:S.fontBody,fontWeight:600,fontSize:MENU_FONT,whiteSpace:"nowrap"} },
                      entry.label);
                  })
                );
              }),
              // Work status + break (clock in/out live in header)
              clocked && React.createElement("div", null,
                React.createElement("div", { style:{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"0.75rem",padding:"0.7rem 1rem",borderBottom:"1px solid "+S.border,background:wsBg,whiteSpace:"nowrap"} },
                  React.createElement("div", { style:{minWidth:0} },
                    React.createElement("div", { style:{fontSize:"0.66rem",textTransform:"uppercase",letterSpacing:"0.09em",fontWeight:700,color:wsLblCol} }, wsLabel),
                    React.createElement("div", { style:{fontWeight:700,fontSize:"0.88rem",overflow:"hidden",textOverflow:"ellipsis",color:S.text,maxWidth:"180px"} }, wsName)
                  ),
                  React.createElement(Mono, { style:{fontSize:"1.15rem",fontWeight:500,color:wsTimCol,lineHeight:1,flexShrink:0} }, wsElapsed)
                ),
                // Which shift everything is being filed under, and a way back
                // if the wrong button got tapped at the clock.
                React.createElement("button", { "data-flat":true,
                  onClick:function(){ setMenuOpen(false); askWorkDay(Date.now(), function(day,ot){ setWorkDay(day,ot); },
                    { title:"Change Shift" }); },
                  style:{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"0.75rem",width:"100%",textAlign:"left",background:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.6rem 1rem",cursor:"pointer",fontFamily:S.fontBody,whiteSpace:"nowrap"} },
                  React.createElement("span", { style:{fontSize:"0.66rem",textTransform:"uppercase",letterSpacing:"0.09em",fontWeight:700,color:S.textDim} }, "Logging to"),
                  React.createElement("span", { style:{display:"flex",alignItems:"center",gap:"0.4rem",minWidth:0} },
                    React.createElement("span", { style:{fontSize:"0.82rem",fontWeight:700,color:S.actionText,overflow:"hidden",textOverflow:"ellipsis"} },
                      new Date(todayStr2).toLocaleDateString([], {weekday:"short",month:"short",day:"numeric"})),
                    // An off-roster day was classified by hand at the clock, so
                    // say which way it went - a mis-tap here is worth real money.
                    typeof workDayOt==="boolean" && React.createElement("span", {
                      style:{fontSize:"0.62rem",fontWeight:800,letterSpacing:"0.04em",flexShrink:0,
                             borderRadius:"5px",padding:"0.1rem 0.3rem",
                             background:workDayOt?S.dangerTint:S.bg3,
                             color:workDayOt?S.dangerText:S.textDim} },
                      workDayOt?"OT":"REG")
                  )
                ),
                onBreak
                  ? React.createElement("button", { "data-flat":true, onClick:function(){ endBreak(); },
                      style:{display:"flex",alignItems:"center",gap:"0.5rem",width:"100%",textAlign:"left",background:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.8rem 1rem",color:S.successText,cursor:"pointer",fontFamily:S.fontBody,fontWeight:700,fontSize:MENU_FONT,whiteSpace:"nowrap"} },
                      React.createElement(MenuIcon, { name:"break", col:S.successText }),
                      React.createElement("span", { style:{flex:1} }, "End Break")
                    )
                  : React.createElement("button", { "data-flat":true, onClick:function(){ closeAllPopups(); setShowBreak(true); },
                      style:{display:"flex",alignItems:"center",gap:"0.5rem",width:"100%",textAlign:"left",background:"none",border:"none",borderBottom:"1px solid "+S.border,padding:"0.8rem 1rem",color:S.warnText,cursor:"pointer",fontFamily:S.fontBody,fontWeight:700,fontSize:MENU_FONT,whiteSpace:"nowrap"} },
                      React.createElement(MenuIcon, { name:"break", col:S.warnText }),
                      React.createElement("span", { style:{flex:1} }, "Break")
                    )
              ),
            )
          ),
          // CLOCK button. A component, so the manual can stage it exactly as
          // drawn here; the header still owns what a press does.
          React.createElement(ClockButton, { clocked:clocked, sub:ckSub,
            onClick:function(){ if(clocked){ clockOut(); } else { clockIn(); } setMenuOpen(false); } }),
          // DISRUPTION button + presets dropdown
          React.createElement("div", { ref:distMenuRef, style:{position:"relative",flex:1} },
            React.createElement(DisruptButton, { mode:dActive?"active":(dStandalone?"standalone":"idle"), sub:dSubLbl,
              onClick:function(){
                if(dStandalone){ closeDisruption(); }
                else if(interrupting){ resumeProject(); }
                else if(distMenuOpen){ setDistMenuOpen(false); }
                else { closeAllPopups(); setDistMenuOpen(true); }
              } }),
            distMenuOpen && React.createElement(DisruptPresetList, { presets:distPresets,
              place:{position:"absolute",top:ddTop,bottom:ddBottom,right:hdrMenuRight?"auto":0,left:hdrMenuRight?0:"auto",maxWidth:"94vw",maxHeight:"72vh",overflowY:"auto",zIndex:200},
              onPick:function(label){ setDistMenuOpen(false); startDisruptionWith(label, activeProj||null); },
              onCustom:function(){ setDistMenuOpen(false); openDisrupt(activeProj||null); },
              onEdit:function(){ closeAllPopups(); setShowEditPresets(true); } })
          )
        ),
        hdrBottom ? tickerEl : null
      ),

      // ---- SPACER (reserves room for fixed header) ----
      React.createElement("div", { style:{height:spacerH} }),

      // ---- LANES ----
      React.createElement("div", { style:{padding:"1rem 0.85rem 0"} },
        // The board's own line: one mark per lane, above the first lane, in
        // the board's colour rather than any lane's. Tap opens the board view.
        (function(){
          var pts=boardLine(projects, laneOrder, laneMeta, Date.now());
          if(!pts.length) return null;
          return React.createElement("div", { "data-msboard":true, style:{marginBottom:"0.75rem"} },
            React.createElement("div", { style:{display:"flex",alignItems:"center",gap:"0.4rem",marginBottom:"0.15rem"} },
              React.createElement(MenuIcon, { name:"milestone", size:16, col:S.chromeText }),
              React.createElement("span", { style:{fontSize:"0.64rem",fontWeight:800,letterSpacing:"0.14em",color:S.chromeText} }, "BOARD")),
            React.createElement(MilestoneStrip, { weekStart:weekStartOf(settings.workSchedule), kind:"board", points:pts, offDays:offDaysOf(settings.workSchedule), tight:true,
              onOpen:function(){ closeAllPopups(); setMsBoard(true); } }));
        })(),
        laneOrder.map(function(lane, laneIdx){
          return React.createElement(LaneSection, { schedule:settings.workSchedule,
            key:lane, lane:lane, allProjects:liveProjects, activeId:activeId,
            msProjects:projects, offDays:offDaysOf(settings.workSchedule),
            onCloseOut:askCloseOut, onReopen:doReopen,
            interrupting:interrupting, elapsed:elapsed,
            todayLogs:todayLogs, todayDist:todayDist, allDist:disruptions,
            onToggle:toggleProject,
            onEdit:function(p){ closeAllPopups(); setEditProj(p); },
            onStages:function(p){ closeAllPopups(); setStagesProj(p); },
            onStageToggle:toggleStageInline,
            onAddSub:function(parentId){ closeAllPopups(); setShowAdd({lane:lane,parentId:parentId,role:"task"}); },
            // The same two the outline has: a sibling beside the record, or a
            // project nested inside it.
            onAddSibling:function(pid){ var pr=findProj(projects,pid); closeAllPopups();
              if(pr) setShowAdd({lane:pr.lane,parentId:pr.parentId||null,role:projRole(pr)}); },
            onAddNested:function(pid){ var pr=findProj(projects,pid); closeAllPopups();
              if(pr) setShowAdd({lane:pr.lane,parentId:pid,role:"project"}); },
            onMilestones:function(pid){ closeAllPopups(); setMsProj(pid); },
            onLaneMilestones:function(k){ closeAllPopups(); setMsLane(k); },
            laneOrder:laneOrder,
            onPickLane:function(k){ closeAllPopups(); setShowAdd({lane:k,parentId:null}); },
            onNewLane:function(){ closeAllPopups(); setShowNewLane(true); },
            onEditLane:function(k){ closeAllPopups(); setEditLane(k); },
            editMode:editMode, laneMeta:laneMeta, onDeleteLane:deleteLane,
            onDragStart:function(e,idx){ /* lane-level drag placeholder */ },
            laneHandle:{ onMouseDown:function(e){ e.preventDefault(); }, onTouchStart:function(e){ e.preventDefault(); } }
          });
        })
      ),

      // ---- MODALS ----
      showOutline && React.createElement(OutlineModal, { laneOrder:laneOrder, laneMeta:laneMeta,
        projects:liveProjects, msProjects:projects, offDays:offDaysOf(settings.workSchedule),
        onOpen:openFromOutline, onSave:saveOutline,
        // The row menu's add actions. The outline stays open behind them, the
        // same as its edit actions do.
        onAddProject:function(lane){ setShowAdd({lane:lane,parentId:null}); },
        onAddTask:function(pid){ var pr=findProj(projects,pid); if(pr) setShowAdd({lane:pr.lane,parentId:pid,role:"task"}); },
        onAddProjectUnder:function(pid){ var pr=findProj(projects,pid); if(pr) setShowAdd({lane:pr.lane,parentId:pid,role:"project"}); },
        // A sibling sits beside the record: same lane, same parent, same kind.
        onAddSibling:function(pid){ var pr=findProj(projects,pid);
          if(pr) setShowAdd({lane:pr.lane,parentId:pr.parentId||null,role:projRole(pr)}); },
        onEditStages:function(pid){ var pr=findProj(projects,pid); if(pr) setStagesProj(pr); },
        onNewLane:function(){ setShowNewLane(true); },
        onMilestones:function(pid){ setMsProj(pid); },
        onLaneMilestones:function(k){ setMsLane(k); },
        suspended:!!(editProj||stagesProj||editLane||showAdd||showNewLane||msProj||msLane),
        onClose:function(){ setShowOutline(false); } }),
// Add sheets mount after the outline so they lay over it, not behind.
      showAdd && React.createElement(Modal, { title:!showAdd.parentId ? ("Add to "+(getMeta(laneMeta,showAdd.lane).label))
          : (showAdd.role==="project" ? "Add Nested Project" : "Add Task"),
        onClose:function(){ setShowAdd(null); } , ownActions:true },
        React.createElement(ProjectForm, { onSave:addProject, onCancel:function(){ setShowAdd(null); },
          defaultLane:showAdd.lane, defaultParentId:showAdd.parentId, defaultRole:showAdd.role,
          parents:liveProjects, laneMeta:laneMeta, laneOrder:laneOrder })
      ),
      msBoard && React.createElement(BoardMilestonesModal, { laneOrder:laneOrder, laneMeta:laneMeta, projects:projects,
        offDays:offDaysOf(settings.workSchedule),
        onOpenLane:function(k){ setMsLane(k); }, onClose:function(){ setMsBoard(false); } }),
      msLane && React.createElement(LaneMilestonesModal, { lane:msLane, laneMeta:laneMeta, projects:projects,
        offDays:offDaysOf(settings.workSchedule),
        onOpenProject:function(p){ setMsProj(p.id); }, onClose:function(){ setMsLane(null); } }),
      msProj && findProj(projects,msProj) && React.createElement(MilestoneEditModal, { project:findProj(projects,msProj),
        projects:projects, offDays:offDaysOf(settings.workSchedule),
        onSave:saveMilestones, onClose:function(){ setMsProj(null); } }),
      editLane && React.createElement(LaneEditModal, { laneKey:editLane, laneMeta:laneMeta,
        projects:projects, laneOrder:laneOrder, onSave:saveLaneEdit,
        onDeleteLane:function(key,mode,target){ deleteLaneWithProjects(key,mode,target); setEditLane(null); },
        onCancel:function(){ setEditLane(null); } }),
      editProj && React.createElement(Modal, { title:editProj.parentId?"Edit Task":"Edit Project", onClose:function(){ setEditProj(null); } , ownActions:true },
        React.createElement(ProjectForm, { project:editProj, onSave:saveEdit, onCancel:function(){ setEditProj(null); }, onDelete:deleteProject, parents:liveProjects, laneMeta:laneMeta, laneOrder:laneOrder, structure:!showOutline })
      ),
      stagesProj && React.createElement(StagesModal, { proj:stagesProj, onClose:function(){ setStagesProj(null); }, onUpdate:updateStages }),
      dayAsk && React.createElement(ClockDayModal, { when:dayAsk.when, position:dayAsk.position,
        choices:dayAsk.choices, title:dayAsk.title, stage:dayAsk.stage,
        onPick:function(c){
          var f=dayAsk.then, r=dayAsk.resolve; setDayAsk(null);
          if(r) r(c); else f(c.day, typeof c.ot==="boolean" ? c.ot : null);
        },
        onCancel:function(){ setDayAsk(null); } }),
      showDisrupt && React.createElement(DisruptionModal, { projName:disruptTarget?disruptTarget.name:null, onStart:startDisruption, onCancel:function(){ setShowDisrupt(false); } }),
      showBreak && React.createElement(BreakModal, { onStart:startBreak, onCancel:function(){ setShowBreak(false); } }),
      showDay && React.createElement(DaySummary, { logs:todayLogs, disruptions:todayDist, breaks:todayBreaks, dayKey:todayStr2, projects:projects, onClose:function(){ setShowDay(false); }, testMode:testMode }),
      notifToast && React.createElement("div", { "data-surface":"panel", role:"status",
        onClick:function(){ setNotifToast(null); },
        style:{position:"fixed",left:"50%",transform:"translateX(-50%)",
               top:"calc(env(safe-area-inset-top, 0px) + 3.4rem)",zIndex:950,maxWidth:"min(92vw, 380px)",
               background:S.bg1,border:"2px solid "+S.borderBright,borderRadius:S.radius,
               padding:"0.6rem 0.9rem",boxShadow:"0 6px 24px rgba(0,0,0,0.35)",cursor:"pointer"} },
        React.createElement("div", { style:{color:S.text,fontWeight:700,fontSize:"0.86rem",fontFamily:S.fontBody} }, notifToast.title),
        React.createElement("div", { style:{color:S.textDim,fontSize:"0.78rem",marginTop:"0.15rem",fontFamily:S.fontBody} }, notifToast.body)
      ),
      showBackup && React.createElement(BackupModal, { clocked:!!atWorkStart, onClose:function(){ setShowBackup(false); } }),
      showExtensions && React.createElement(ExtensionsModal, {
        onChange:function(){ setModTick(function(x){ return x+1; }); },
        onClose:function(){ setShowExtensions(false); } }),
      // Module screens mount here: a sibling of the core modals, never nested
      // inside a backdrop-filter surface, so the glass themes stay correct.
      modScreen && ttModuleScreen(modScreen.id, modScreen.screen) &&
        React.createElement(ttModuleScreen(modScreen.id, modScreen.screen),
          ttModuleContext(modScreen.id, {
            settings:settings, projects:liveProjects, logs:logs, laneMeta:laneMeta,
            laneOrder:laneOrder, testMode:testMode, schedule:settings.workSchedule,
            // What is running right now, so a module can default to it rather
            // than making the user pick the job they are already standing in.
            activeId:activeId, activeName:activeProj?activeProj.name:null,
            onClose:function(){ setModScreen(null); }
          })),
      showReports && React.createElement(ReportsModal, { logs:logs, projects:projects, disruptions:disruptions,
        breaks:breaks, laneMeta:laneMeta, laneOrder:laneOrder, schedule:settings.workSchedule, testMode:testMode,
        liveLogs:liveLogs(), initialKind:reportsKind, onClose:function(){ setShowReports(false); } }),
      showNewLane && React.createElement(NewLaneModal, { onSave:function(label,col){ addLane(label,col); setShowNewLane(false); }, onCancel:function(){ setShowNewLane(false); } }),
      matchAsk && React.createElement(MatchTasksModal, { proj:matchAsk.proj, tasks:matchAsk.tasks,
        onMatch:function(chosen){ doMatchTasks(matchAsk.proj, chosen); },
        onLeave:function(){ setMatchAsk(null); } }),
      startAsk && React.createElement(StartAheadModal, { proj:startAsk,
        onStartNow:function(){ startPendingNow(startAsk); },
        onReschedule:function(ts){ reschedulePending(startAsk, ts); },
        onWait:function(){ setStartAsk(null); } }),
      closeOut && React.createElement(CloseProjectModal, { proj:closeOut.proj, blockers:closeOut.blockers,
        allProjects:projects, laneMeta:laneMeta, laneOrder:laneOrder,
        onConfirm:function(opts){ doCloseOut(closeOut.proj, opts); },
        onClose:function(){ setCloseOut(null); } }),
      stagesDone && !closeOut && React.createElement(StagesDoneModal, { proj:stagesDone,
        onCloseOut:function(){ var pr=findProj(projects,stagesDone.id)||stagesDone; setStagesDone(null); askCloseOut(pr); },
        onMoreStages:function(){ var pr=findProj(projects,stagesDone.id)||stagesDone; setStagesDone(null); setStagesProj(pr); },
        onLater:function(){ setStagesDone(null); } }),
      showArchive && React.createElement(ArchiveModal, { projects:projects, logs:logs, laneMeta:laneMeta,
        onReopen:doReopen, onClose:function(){ setShowArchive(false); } }),
      confirmDelete && React.createElement(DeleteProjectModal, { proj:confirmDelete, allProjects:projects, laneMeta:laneMeta, onMoveTasks:doMoveTasks, onDeleteAll:doDeleteAll, onCancel:function(){ setConfirmDelete(null); } }),
      // The menu groups. Selecting an item runs closeAllPopups first, which
      // clears the group itself, then opens the screen that was chosen.
      // Both ways out of the practice board go through the confirm: the bar's
      // EXIT and this group's Leave row.
      menuGroup==="manual" && React.createElement(MenuGroupModal, { title:"User Manual",
        onClose:function(){ setMenuGroup(null); },
        items:[
          { label:"Guides", onSelect:function(){ closeAllPopups(); setShowGuides(true); } },
          testMode
            ? { label:"Leave Practice Board", onSelect:function(){ closeAllPopups(); setShowTestConfirm(true); } }
            : { label:"Practice Board", onSelect:function(){ closeAllPopups(); setTestMode(true); } }
        ] }),
      menuGroup==="time" && React.createElement(MenuGroupModal, { title:"Time Settings",
        onClose:function(){ setMenuGroup(null); },
        items:[
          { label:"Work Schedule", onSelect:function(){ closeAllPopups(); setShowSchedule(true); } },
          { label:"Tracking", onSelect:function(){ closeAllPopups(); setShowTracking(true); } }
        ] }),
      menuGroup==="interface" && React.createElement(MenuGroupModal, { title:"Interface",
        onClose:function(){ setMenuGroup(null); },
        items:[
          { label:"Themes", onSelect:function(){ closeAllPopups(); setShowThemes(true); } },
          { label:"Layout", onSelect:function(){ closeAllPopups(); setShowLayout(true); } }
        ] }),
      showGuides && React.createElement(GuidesModal, { onClose:function(){ setShowGuides(false); } }),
      showThemes && React.createElement(ThemesModal, { settings:settings, onChange:setSettings, onClose:function(){ setShowThemes(false); } }),
      showLayout && React.createElement(LayoutModal, { settings:settings, onChange:setSettings, onClose:function(){ setShowLayout(false); } }),
      showSchedule && React.createElement(WorkScheduleModal, { schedule:settings.workSchedule,
        onSave:function(sch){ setSettings(Object.assign({},settings,{workSchedule:sch})); setShowSchedule(false); },
        onClose:function(){ setShowSchedule(false); } }),
      showTracking && React.createElement(TrackingModal, { settings:settings, onChange:setSettings,
        onClose:function(){ setShowTracking(false); } }),
      showEditPresets && React.createElement(EditDistPresetsModal, { presets:distPresets, onSave:function(items){ setDistPresets(items.length?items:DEFAULT_DIST_PRESETS); setShowEditPresets(false); }, onCancel:function(){ setShowEditPresets(false); } }),
      showTestConfirm && React.createElement(Modal, { title:"Leave Practice Board", onClose:function(){ setShowTestConfirm(false); },
        actions:[
          React.createElement("button", { key:"a0", "data-confirmexit":true, onClick:leaveTutorial, style:MODAL_SAVE() }, "Leave"),
          React.createElement("button", { key:"a1", onClick:function(){ setShowTestConfirm(false); }, style:MODAL_CANCEL() }, "Stay")
        ] },
        React.createElement("p", { style:{color:S.textDim,marginBottom:"0.9rem",fontSize:"0.9rem",lineHeight:1.5} },
          "Leaving keeps everything you have built on the practice board, so you can come back and carry on. Your own board is untouched either way."),
        // Reset is its own act, and held: it throws away practice work.
        React.createElement("div", { style:{background:S.bg1,border:"1px solid "+S.border,borderRadius:S.radius3,padding:"0.7rem 0.8rem"} },
          React.createElement("div", { style:{color:S.textDim,fontSize:"0.78rem",marginBottom:"0.5rem",lineHeight:1.45} },
            "Start the practice board over from how it ships? Everything you added or changed on it goes."),
          React.createElement(HoldButton, { onHold:resetTutorialNow, holdMs:HOLD_DELETE_MS, fill:rgba(S.dangerText,0.38),
            attrs:{ "data-tutorialreset":true, "data-holddelete":true },
            style:{width:"100%",background:S.dangerBg,border:"1px solid "+S.dangerText,borderRadius:S.radius,
                   padding:"0.65rem",color:S.dangerText,fontFamily:S.fontBody,fontWeight:700,fontSize:"0.84rem"} },
            React.createElement("span", null, "Reset practice board \u00b7 hold")))
      )
    )
  );
}

// The exported entry is the boundary, so nothing has to remember to wrap it.
export default function App(){
  // The splash rides OUTSIDE the error boundary's child, so a crash in the
  // board still shows the crash report rather than a frozen opening screen.
  var splashS=useState(true); var setSplash=splashS[1]; var splash=splashS[0];
  var fadeS=useState(false); var setFade=fadeS[1]; var fade=fadeS[0];
  useEffect(function(){
    if(!splash) return;
    var a=setTimeout(function(){ setFade(true); }, SPLASH_SHOW_MS);
    var b=setTimeout(function(){ setSplash(false); }, SPLASH_SHOW_MS+SPLASH_FADE_MS);
    return function(){ clearTimeout(a); clearTimeout(b); };
  },[splash]);
  return React.createElement(React.Fragment, null,
    React.createElement(TTBoundary, null, React.createElement(TTBoard)),
    splash && React.createElement(SplashScreen, { fading:fade,
      onDismiss:function(){ setFade(true); setTimeout(function(){ setSplash(false); }, SPLASH_FADE_MS); } }));
}
