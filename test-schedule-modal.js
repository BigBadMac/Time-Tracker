// Verifies the schedule row layout invariants: fixed Wednesday-sized name
// column, right-justified labels, equal-flex inputs, pinned dash/hours.
var H=require('./harness.js'); var C=H.ctx;
C.applyTokens({ layout:'comfortable', tracking:'timer', colorScheme:'bright-pastels', theme:'neon-dream',
  schemes:{}, fonts:{}, mode:'dark', handedness:'right', headerPos:'top',
  workSchedule:C.DEFAULT_SCHEDULE(), timeInc:'standard' });

var pass=0,fail=0;
function ok(n,c,x){ if(c){pass++;console.log('  PASS  '+n);} else {fail++;console.log('  FAIL  '+n+(x!==undefined?'  -> '+JSON.stringify(x):''));} }
function flat(n,out){ out=out||[];
  if(n==null||n===false||n===true) return out;
  if(Array.isArray(n)){ n.forEach(function(x){flat(x,out);}); return out; }
  if(typeof n!=='object'){ out.push(n); return out; }
  out.push(n); flat(n.children,out); return out; }

var threw=null,tree=null;
try{ tree=C.WorkScheduleModal({ schedule:C.DEFAULT_SCHEDULE(), onSave:function(){}, onClose:function(){} }); }
catch(e){ threw=e; }
ok('modal renders', !threw, threw&&threw.message);
var nodes=threw?[]:flat(tree);

var inputs=nodes.filter(function(n){ return n.type==='input' && n.props.type==='time'; });
ok('14 time inputs', inputs.length===14, inputs.length);
ok('every input shares one flex basis', inputs.every(function(i){ return i.props.style.flex==='0 1 94px'; }));
ok('every input has the iOS value floor', inputs.every(function(i){ return i.props.style.minWidth==='80px'; }));
ok('no input sets textAlign (hides the value on iOS)', inputs.every(function(i){ return i.props.style.textAlign===undefined; }));
ok('appearance reset rides inline on every input', inputs.every(function(i){ return i.props.style.WebkitAppearance==='none' && i.props.style.appearance==='none'; }));
ok('value color pinned with text-fill-color', inputs.every(function(i){ return i.props.style.WebkitTextFillColor===i.props.style.color; }));
ok('color-scheme follows the app mode', inputs.every(function(i){ return i.props.style.colorScheme==='dark'||i.props.style.colorScheme==='light'; }));
ok('explicit height replaces the native bubble', inputs.every(function(i){ return i.props.style.minHeight==='2.1rem'; }));
ok('every input carries a value', inputs.every(function(i){ return /^\d\d:\d\d$/.test(i.props.value); }),
   inputs.map(function(i){ return i.props.value; }).join(','));

var toggles=nodes.filter(function(n){ return n.type==='button' && n.props['aria-pressed']!==undefined; });
ok('8 dot toggles (7 days + unpaid breaks)', toggles.length===8, toggles.length);
// the day buttons are the right-justified ones; the breaks toggle is flex:1 left
var dayBtns=toggles.filter(function(b){ return b.props.style.justifyContent==='flex-end'; });
ok('7 day buttons', dayBtns.length===7, dayBtns.length);
var brkToggle=toggles.filter(function(b){ return b.props.style.flex===1; });
ok('breaks toggle present and left-aligned', brkToggle.length===1, brkToggle.length);
ok('name column cannot shrink', dayBtns.every(function(b){ return b.props.style.flexShrink===0; }));
ok('names pushed to the right edge', dayBtns.every(function(b){ return b.props.style.justifyContent==='flex-end'; }));

var sizers=nodes.filter(function(n){ return n.type==='span' && n.props['aria-hidden']==='true'; });
ok('7 hidden sizers', sizers.length===7, sizers.length);
ok('every sizer is Wednesday', sizers.every(function(s){ return s.children[0]==='Wednesday'; }));
ok('sizers use the heavy weight', sizers.every(function(s){ return s.props.style.fontWeight===600; }));
ok('sizers are invisible, not display:none', sizers.every(function(s){ return s.props.style.visibility==='hidden'; }));

var labels=nodes.filter(function(n){ return n.type==='span' && n.props.style &&
  n.props.style.position==='absolute' && n.props.style.right===0; });
ok('7 visible labels overlay right-aligned', labels.length===7, labels.length);
ok('labels cover all seven days',
   ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].every(function(d){
     return labels.some(function(l){ return l.children[0]===d; }); }));

var dashes=nodes.filter(function(n){ return n.type==='span' && n.children && n.children[0]==='-'; });
ok('dash removed to fund the value floor', dashes.length===0, dashes.length);

var hours=nodes.filter(function(n){ return n.type==='span' && n.props.style &&
  n.props.style.marginLeft==='auto'; });
ok('7 hours cells hug the right edge', hours.length===7, hours.length);
ok('hours cells pinned at 46px', hours.every(function(h){ return h.props.style.width==='46px' && h.props.style.flexShrink===0; }));

var txt=nodes.filter(function(n){ return typeof n==='string'; }).join(' | ');
ok('weekday hours still live', txt.indexOf('8h 30m')>=0);
ok('weekend still reads off', (txt.match(/\boff\b/g)||[]).length===2, (txt.match(/\boff\b/g)||[]).length);
ok('weekly total intact', txt.indexOf('42h 30m')>=0);

console.log('\n'+pass+' passed, '+fail+' failed');

// --- the global CSS actually ships the iOS value rules ---
(function(){
  var p=0,f=0;
  function ok2(n,c,x){ if(c){p++;console.log('  PASS  '+n);} else {f++;console.log('  FAIL  '+n+(x!==undefined?'  -> '+JSON.stringify(x):''));} }
  var fs=require('fs');
  var src=fs.readFileSync('time-tracker.jsx','utf8');
  var i=src.indexOf('React.createElement("style"');
  var block=src.slice(i, src.indexOf('S.themeCss', i));
  ok2('style block neutralizes native time chrome', block.indexOf("-webkit-appearance:none")>=0);
  ok2('style block aligns the value via its pseudo', block.indexOf("::-webkit-date-and-time-value")>=0);
  ok2('pseudo gets min-height so it cannot collapse', block.indexOf("min-height:1.15em")>=0);
  ok2('shadow parts are transparent', block.indexOf("::-webkit-datetime-edit")>=0 && block.indexOf("background:transparent")>=0);
  ok2('shadow parts inherit the color', block.indexOf("-webkit-text-fill-color:currentColor")>=0);
  console.log('  (css) '+p+' passed, '+f+' failed');
  if(f) fail+=f;
})();
process.exit(fail?1:0);
