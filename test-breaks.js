var H=require('./harness.js'); var C=H.ctx;
C.applyTokens({ layout:'comfortable', tracking:'timer', colorScheme:'bright-pastels', theme:'neon-dream',
  schemes:{}, fonts:{}, mode:'dark', handedness:'right', headerPos:'top',
  workSchedule:C.DEFAULT_SCHEDULE(), timeInc:'standard' });

var pass=0,fail=0;
function ok(n,c,x){ if(c){pass++;console.log('  PASS  '+n);} else {fail++;console.log('  FAIL  '+n+(x!==undefined?'  -> '+JSON.stringify(x):''));} }
function eq(n,a,b){ ok(n, a===b, {got:a,want:b}); }
function section(t){ console.log('\n== '+t+' =='); }
function flat(n,out){ out=out||[];
  if(n==null||n===false||n===true) return out;
  if(Array.isArray(n)){ n.forEach(function(x){flat(x,out);}); return out; }
  if(typeof n!=='object'){ out.push(n); return out; }
  out.push(n); flat(n.children,out); return out; }
function textOf(nodes){ return nodes.filter(function(n){ return typeof n==='string'; }).join(' | '); }

function BR(name,start,mins){ return { id:name, name:name, note:'', start:start, mins:mins }; }
function schWith(weekly, custom, enabled){
  var s=C.DEFAULT_SCHEDULE();
  s.unpaidBreaks={ enabled:enabled!==false, weekly:weekly||[], custom:custom||{} };
  return C.normalizeSchedule(s);
}

section('normalization');
var legacy={ mon:{on:true,start:'08:00',end:'16:30'}, tue:{on:true,start:'08:00',end:'16:30'},
  wed:{on:true,start:'08:00',end:'16:30'}, thu:{on:true,start:'08:00',end:'16:30'},
  fri:{on:true,start:'08:00',end:'16:30'}, sat:{on:false,start:'08:00',end:'16:30'},
  sun:{on:false,start:'08:00',end:'16:30'} };
var norm=C.normalizeSchedule(legacy);
ok('pre-break schedule gains the shape', !!norm.unpaidBreaks);
eq('gained shape is disabled', norm.unpaidBreaks.enabled, false);
ok('gained shape has all 7 custom slots', ['mon','tue','wed','thu','fri','sat','sun']
  .every(function(k){ return Array.isArray(norm.unpaidBreaks.custom[k]); }));
ok('days survive normalization', norm.mon.on===true && norm.sat.on===false && norm.mon.end==='16:30');
var def=C.DEFAULT_SCHEDULE();
ok('default schedule ships the shape, disabled', def.unpaidBreaks && def.unpaidBreaks.enabled===false);
var src=schWith([BR('Lunch','12:00',30)]);
var copy=C.normalizeSchedule(src);
copy.unpaidBreaks.weekly[0].mins=99;
eq('normalize deep-copies breaks', src.unpaidBreaks.weekly[0].mins, 30);

section('break math');
var lunch=schWith([BR('Lunch','12:00',30)]);
eq('one weekly lunch nets a day to 480', C.schNetMinutes(lunch,'mon'), 480);
eq('off day stays 0', C.schNetMinutes(lunch,'sat'), 0);
var both=schWith([BR('Lunch','12:00',30)], { wed:[BR('Cleanup','15:00',15)] });
eq('custom stacks on weekly (wed)', C.schNetMinutes(both,'wed'), 465);
eq('other days unaffected by wed custom', C.schNetMinutes(both,'thu'), 480);
var off=schWith([BR('Lunch','12:00',30)], {}, false);
eq('disabled deducts nothing', C.schNetMinutes(off,'mon'), 510);
var outside=schWith([BR('Evening','18:00',30)]);
eq('break outside the shift deducts nothing', C.schNetMinutes(outside,'mon'), 510);
var straddle=schWith([BR('Late','16:00',60)]);
eq('break straddling the end is clipped', C.schNetMinutes(straddle,'mon'), 480);
var early=schWith([BR('Early','07:30',60)]);
eq('break straddling the start is clipped', C.schNetMinutes(early,'mon'), 480);
var offDayCustom=schWith([], { sat:[BR('Sat','12:00',30)] });
eq('custom break on an off day is inert', C.schNetMinutes(offDayCustom,'sat'), 0);
var swallow=schWith([BR('All','08:00',600)]);
eq('breaks longer than the shift floor at 0', C.schNetMinutes(swallow,'mon'), 0);
var badStart=schWith([BR('Bad','',30)]);
eq('malformed start is ignored', C.schNetMinutes(badStart,'mon'), 510);
var badMins=schWith([BR('Bad','12:00','')]);
eq('malformed mins is ignored', C.schNetMinutes(badMins,'mon'), 510);

section('engine goes net');
var REF=new Date(2026,7,12,14,0,0);
var rWeek=C.periodRange('week',0,REF);
eq('week: 5 days minus 5 lunches', C.scheduledMinutes(lunch, rWeek.start, rWeek.end), 2550-150);
eq('week: weekly + one custom', C.scheduledMinutes(both, rWeek.start, rWeek.end), 2550-150-15);
eq('week: disabled unchanged', C.scheduledMinutes(off, rWeek.start, rWeek.end), 2550);

section('pace respects breaks');
function at(h,m){ return new Date(2026,7,12,h,m,0).getTime(); }  // a Wednesday
var W=rWeek.start, E=rWeek.end;
eq('before the break, gross pace', C.scheduledToDate(lunch,W,E,at(11,0)), 480*2 + 180);
eq('mid-break, pace holds still', C.scheduledToDate(lunch,W,E,at(12,15)), 480*2 + 240);
eq('at break end, exactly the window', C.scheduledToDate(lunch,W,E,at(12,30)), 480*2 + 240);
eq('after the break, net resumes', C.scheduledToDate(lunch,W,E,at(13,0)), 480*2 + 270);
eq('after the shift, the full net day', C.scheduledToDate(lunch,W,E,at(20,0)), 480*3);
eq('custom day break also paces (wed 15:30)', C.scheduledToDate(both,W,E,at(15,30)), 480*2 + 240+150+15);

section('WorkScheduleModal - breaks off');
var offTree=C.WorkScheduleModal({ schedule:C.DEFAULT_SCHEDULE(), onSave:function(){}, onClose:function(){} });
var offNodes=flat(offTree), offTxt=textOf(offNodes);
ok('toggle row present', offTxt.indexOf('Unpaid Breaks')>=0);
ok('Edit Breaks hidden while off', offTxt.indexOf('Edit Breaks')<0);
ok('no deduction line while off', offTxt.indexOf('Unpaid breaks per week')<0);
ok('weekly total is gross', offTxt.indexOf('42h 30m')>=0);
var togglesOff=offNodes.filter(function(n){ return n.type==='button' && n.props['aria-pressed']!==undefined; });
eq('8 dot toggles (7 days + breaks)', togglesOff.length, 8);

section('WorkScheduleModal - breaks on');
var onSch=schWith([BR('Lunch','12:00',30)]);
var onTree=C.WorkScheduleModal({ schedule:onSch, onSave:function(){}, onClose:function(){} });
var onNodes=flat(onTree), onTxt=textOf(onNodes);
ok('Edit Breaks shown while on', onTxt.indexOf('Edit Breaks')>=0);
ok('deduction line shows', onTxt.indexOf('Unpaid breaks per week')>=0 && onTxt.indexOf('-2h 30m')>=0, onTxt.slice(0,80));
ok('weekly total is net', onTxt.indexOf('40h')>=0);
ok('per-day hours are net (8h not 8h 30m)', onTxt.indexOf('8h 30m')<0);
var inputsOn=onNodes.filter(function(n){ return n.type==='input' && n.props.type==='time'; });
eq('still 14 schedule time inputs (breaks modal closed)', inputsOn.length, 14);
ok('schedule inputs keep the iOS reset', inputsOn.every(function(i){ return i.props.style.WebkitAppearance==='none' &&
  i.props.style.WebkitTextFillColor===i.props.style.color && i.props.style.minHeight==='2.1rem'; }));

section('save path carries breaks through');
var saved=null;
var saveTree=C.WorkScheduleModal({ schedule:onSch, onSave:function(s){ saved=s; }, onClose:function(){} });
var saveBtn=flat(saveTree).filter(function(n){ return n.type==='button' && n.children && n.children[0]==='Save Schedule'; })[0];
ok('save button found', !!saveBtn);
if(saveBtn){
  saveBtn.props.onClick();
  ok('saved draft includes unpaidBreaks', !!(saved && saved.unpaidBreaks));
  eq('saved breaks still enabled', saved.unpaidBreaks.enabled, true);
  eq('saved weekly break intact', saved.unpaidBreaks.weekly[0].name, 'Lunch');
  ok('saved draft has all 7 days', ['mon','tue','wed','thu','fri','sat','sun'].every(function(k){ return saved[k]; }));
}

section('UnpaidBreaksModal renders');
var ubVal={ enabled:true, weekly:[BR('Lunch','12:00',30), BR('Stretch','10:00',10)],
            custom:{ wed:[BR('Cleanup','15:00',15)] } };
var bm=C.UnpaidBreaksModal({ value:ubVal, schedule:C.DEFAULT_SCHEDULE(),
  onDone:function(){}, onClose:function(){} });
var bn=flat(bm), bt=textOf(bn);
ok('titled Unpaid Breaks', bt.indexOf('Unpaid Breaks')>=0);
ok('both sections present', bt.indexOf('Every Work Day')>=0 && bt.indexOf('Custom Daily Breaks')>=0);
ok('weekly cards render by value', bn.filter(function(n){ return n.type==='input' && n.props.value==='Lunch'; }).length===1);
var addBtns=bn.filter(function(n){ return n.type==='button' && n.children && n.children[0]==='+ Add Break'; });
eq('one visible add button (days collapsed)', addBtns.length, 1);
var removeBtns=bn.filter(function(n){ return n.type==='button' && n.props['aria-label']==='Remove break'; });
eq('remove per visible card', removeBtns.length, 2);
var timeIns=bn.filter(function(n){ return n.type==='input' && n.props.type==='time'; });
eq('a time field per visible card', timeIns.length, 2);
ok('break time fields carry the iOS reset', timeIns.every(function(i){ return i.props.style.WebkitAppearance==='none' &&
  i.props.style.WebkitTextFillColor===i.props.style.color && i.props.style.minHeight==='2.1rem' &&
  i.props.style.textAlign===undefined; }));
var numIns=bn.filter(function(n){ return n.type==='input' && n.props.type==='number'; });
eq('a duration field per visible card', numIns.length, 2);
ok('duration fields are numeric-keyboard', numIns.every(function(i){ return i.props.inputMode==='numeric'; }));
ok('all 7 day rows listed', ['Monday','Tuesday','Wednesday','Thursday','Friday'].every(function(d){ return bt.indexOf(d)>=0; })
   && bt.indexOf('Saturday (off)')>=0 && bt.indexOf('Sunday (off)')>=0);
ok('wed shows its custom count badge', bn.some(function(n){ return n.type==='span' && n.children && n.children[0]==='1'; }));
ok('deduction preview totals weekly x5 + wed custom', bt.indexOf('-3h 35m')>=0, bt.slice(-120));

section('UnpaidBreaksModal - expanded day');
var bm2=C.UnpaidBreaksModal({ value:ubVal, schedule:C.DEFAULT_SCHEDULE(), initialOpenDay:'wed',
  onDone:function(){}, onClose:function(){} });
var bn2=flat(bm2), bt2=textOf(bn2);
ok('custom card visible when its day is open',
   bn2.filter(function(n){ return n.type==='input' && n.props.value==='Cleanup'; }).length===1);
eq('two add buttons when a day is open',
   bn2.filter(function(n){ return n.type==='button' && n.children && n.children[0]==='+ Add Break'; }).length, 2);
var bm3=C.UnpaidBreaksModal({ value:ubVal, schedule:C.DEFAULT_SCHEDULE(), initialOpenDay:'sat',
  onDone:function(){}, onClose:function(){} });
ok('off day warns that breaks are inert', textOf(flat(bm3)).indexOf('This day is off')>=0);

section('Done path');
var done=null;
var bm4=C.UnpaidBreaksModal({ value:ubVal, schedule:C.DEFAULT_SCHEDULE(),
  onDone:function(v){ done=v; }, onClose:function(){} });
var doneBtn=flat(bm4).filter(function(n){ return n.type==='button' && n.children && n.children[0]==='Done'; })[0];
ok('Done button found', !!doneBtn);
if(doneBtn){
  doneBtn.props.onClick();
  ok('Done returns the break set', !!(done && done.weekly && done.custom));
  eq('weekly preserved through Done', done.weekly.length, 2);
  eq('custom preserved through Done', done.custom.wed.length, 1);
  done.weekly[0].mins=99;
  eq('Done handed out a copy, not the prop', ubVal.weekly[0].mins, 30);
}

console.log('\n----------------------------------------');
console.log(pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
