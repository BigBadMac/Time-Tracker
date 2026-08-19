// Renders the real App with the settings menu and Reports forced open, to prove
// the menu entry, the state and the modal render path are actually connected.
var fs=require('fs'), vm=require('vm');
var src=fs.readFileSync('time-tracker.jsx','utf8')
  .replace(/^import[^\n]*\n/,'').replace(/^export default /m,'');

var patched=src
  .replace('var menuOpenS=useState(false);','var menuOpenS=useState(true);')
  .replace('var showReportsS=useState(false);','var showReportsS=useState(true);');
if(patched===src){ console.log('FAIL: could not force state'); process.exit(1); }

function ce(type,props){
  var kids=Array.prototype.slice.call(arguments,2);
  if(typeof type==='function'){ var p=Object.assign({},props||{});
    if(kids.length) p.children=kids.length===1?kids[0]:kids; return type(p); }
  return {type:type,props:props||{},children:kids};
}
var store={};
function useState(i){ var v=typeof i==='function'?i():i; return [v,function(){}]; }
var sb={ React:{createElement:ce,useState:useState,useEffect:function(){},useRef:function(v){return{current:v||null};}},
  useState:useState, useEffect:function(){}, useRef:function(v){return{current:v===undefined?null:v};},
  console:console,Math:Math,Date:Date,Object:Object,Array:Array,JSON:JSON,String:String,Number:Number,
  isNaN:isNaN,parseInt:parseInt,parseFloat:parseFloat,setTimeout:setTimeout,
  setInterval:function(){},clearInterval:function(){},Promise:Promise,
  navigator:{vibrate:function(){},clipboard:{writeText:function(){return Promise.resolve();}}},
  localStorage:{getItem:function(k){return store[k]||null;},setItem:function(k,v){store[k]=v;}},
  document:{addEventListener:function(){},removeEventListener:function(){},
    documentElement:{style:{setProperty:function(){}}},getElementById:function(){return null;},
    head:{appendChild:function(){}},createElement:function(){return{style:{},setAttribute:function(){}};}},
  window:{addEventListener:function(){},removeEventListener:function(){},dispatchEvent:function(){},
    matchMedia:function(){return{matches:false,addEventListener:function(){}};}} };
sb.globalThis=sb; vm.createContext(sb);
vm.runInContext(patched, sb, {filename:'patched.js'});

// A day of logs so the modal has something to roll up.
var t9=new Date(); t9.setHours(9,0,0,0); var T=t9.getTime(), HR=3600000;
store['tt_logs']=JSON.stringify([
  {id:'a',projectId:1,projectName:'Line 4 Rebuild',lane:'Projects',type:'project',
   startTime:T,endTime:T+2*HR,duration:2*HR,parentId:null,parentName:null},
  {id:'b',projectId:null,projectName:'At Work',lane:null,type:'atwork',
   startTime:T,endTime:T+8*HR,duration:8*HR,parentId:null,parentName:null}
]);
store['tt_projects']=JSON.stringify([{id:1,name:'Line 4 Rebuild',lane:'Projects',parentId:null,order:0,notes:''}]);

var pass=0,fail=0;
function ok(n,c,x){ if(c){pass++;console.log('  PASS  '+n);} else {fail++;console.log('  FAIL  '+n+(x!==undefined?'  -> '+JSON.stringify(x):''));} }

var threw=null,tree=null;
try{ tree=sb.App({}); }catch(e){ threw=e; }
ok('App renders with Reports open', !threw, threw&&(threw.message+' @ '+String(threw.stack).split('\n')[1]));

function flat(n,out){ out=out||[];
  if(n==null||n===false||n===true) return out;
  if(Array.isArray(n)){ n.forEach(function(x){flat(x,out);}); return out; }
  if(typeof n!=='object'){ out.push(String(n)); return out; }
  out.push(n); flat(n.children,out); return out; }
var nodes=threw?[]:flat(tree);
var txt=nodes.filter(function(n){return typeof n==='string';}).join(' | ');

ok('menu shows a Reports entry', txt.indexOf('Reports')>=0);
ok('Reports modal is titled', (txt.match(/Reports/g)||[]).length>=2, (txt.match(/Reports/g)||[]).length);
ok('modal shows the period picker', txt.indexOf('Qtr')>=0 && txt.indexOf('Year')>=0);
ok('modal rolls up the logged project', txt.indexOf('Line 4 Rebuild')>=0);
ok('modal totals tracked time', txt.indexOf('2h 00m')>=0, txt.slice(0,120));
ok('modal reports clocked time separately', txt.indexOf('8h 00m')>=0);
ok('modal measures against the schedule', txt.indexOf('scheduled')>=0);
ok('Summary entry still present', txt.indexOf('Summary')>=0);
ok('Work Schedule entry untouched', txt.indexOf('Work Schedule')>=0 || txt.indexOf('Time Settings')>=0);

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
