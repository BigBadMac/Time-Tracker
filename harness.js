// Loads the app source with stubbed React/DOM so the rollup engine and the
// Reports render path can be exercised in node.
var fs=require('fs'), vm=require('vm');

var src=fs.readFileSync('/home/claude/work/time-tracker.jsx','utf8')
  .replace(/^import[^\n]*\n/, '')
  .replace(/^export default /m, '');

var elCount=0;
function createElement(type, props){
  var kids=Array.prototype.slice.call(arguments,2);
  elCount++;
  if(typeof type==='function'){
    var p=Object.assign({}, props||{});
    if(kids.length) p.children = kids.length===1?kids[0]:kids;
    return type(p);
  }
  return { type:type, props:props||{}, children:kids };
}
var hookSeq=0;
function useState(init){
  hookSeq++;
  var v = typeof init==='function' ? init() : init;
  return [v, function(){}];
}
function useEffect(){}
function useRef(v){ return {current:v===undefined?null:v}; }

var sandbox={
  React:{ createElement:createElement, useState:useState, useEffect:useEffect, useRef:useRef, Fragment:"fragment" },
  useState:useState, useEffect:useEffect, useRef:useRef,
  console:console, Math:Math, Date:Date, Object:Object, Array:Array, JSON:JSON, String:String,
  Number:Number, isNaN:isNaN, parseInt:parseInt, parseFloat:parseFloat, setTimeout:setTimeout,
  setInterval:function(){}, clearInterval:function(){},
  navigator:{ vibrate:function(){}, clipboard:{ writeText:function(){ return Promise.resolve(); } } },
  localStorage:{ getItem:function(){ return null; }, setItem:function(){} },
  document:{ addEventListener:function(){}, removeEventListener:function(){},
             documentElement:{ style:{ setProperty:function(){} } },
             getElementById:function(){ return null; },
             head:{ appendChild:function(){} }, createElement:function(){ return { style:{}, setAttribute:function(){} }; } },
  window:{ addEventListener:function(){}, removeEventListener:function(){}, dispatchEvent:function(){},
           matchMedia:function(){ return {matches:false, addEventListener:function(){}}; } },
  Promise:Promise
};
sandbox.globalThis=sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, {filename:'time-tracker.jsx'});

module.exports = { ctx:sandbox, elCount:function(){ return elCount; } };
