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
function d(s){ return new Date(s+'T12:00:00'); }
function iso(ms){ return C.isoDate(new Date(ms)); }

section('normalization');
var def=C.DEFAULT_SCHEDULE();
ok('default ships payroll', !!def.payroll);
eq('default week start', def.payroll.weekStart, 'mon');
eq('default OT kind', def.payroll.ot.kind, '1.5x');
eq('default flat extra', def.payroll.ot.flatExtra, 6.25);
eq('default cycle', def.payroll.cycle.period, 'weekly');
ok('default cycle start is today ISO', /^\d{4}-\d{2}-\d{2}$/.test(def.payroll.cycle.start), def.payroll.cycle.start);
eq('default OT days empty', def.payroll.otDays.length, 0);
var junk=C.normalizeSchedule({ payroll:{ weekStart:'xyz', otDays:['sat','nope','sun'],
  ot:{kind:'triple',flatExtra:-3}, cycle:{period:'hourly'} } });
eq('bad week start falls back', junk.payroll.weekStart, 'mon');
eq('bad OT day filtered', junk.payroll.otDays.join(','), 'sat,sun');
eq('bad OT kind falls back', junk.payroll.ot.kind, '1.5x');
eq('bad flat extra falls back', junk.payroll.ot.flatExtra, 6.25);
eq('bad cycle falls back', junk.payroll.cycle.period, 'weekly');
var keep=C.normalizeSchedule({ payroll:{ weekStart:'fri', otDays:['sat'],
  ot:{kind:'flat',flatExtra:6.25}, cycle:{period:'biweekly',start:'2026-08-03'} } });
eq('valid week start kept', keep.payroll.weekStart, 'fri');
eq('valid kind kept', keep.payroll.ot.kind, 'flat');
eq('valid cycle kept', keep.payroll.cycle.period+' '+keep.payroll.cycle.start, 'biweekly 2026-08-03');
var pre=C.normalizeSchedule({ mon:{on:true,start:'08:00',end:'16:30'} });
ok('pre-payroll schedule gains the shape', !!pre.payroll && pre.payroll.weekStart==='mon');

section('week start boundary (ref = Wed 2026-08-12)');
var REF=new Date(2026,7,12,14,0,0);
eq('default week starts Mon 10th', new Date(C.periodRange('week',0,REF).start).getDate(), 10);
var wFri=C.periodRange('week',0,REF,'fri');
eq('fri-start week begins Fri 7th', new Date(wFri.start).getDate(), 7);
eq('fri-start week is 7 days', Math.round((wFri.end-wFri.start)/86400000), 7);
eq('fri-start week ends Thu (day 4)', new Date(wFri.end-1).getDay(), 4);
eq('sun-start week begins Sun 9th', new Date(C.periodRange('week',0,REF,'sun').start).getDate(), 9);
eq('wed-start week begins today', new Date(C.periodRange('week',0,REF,'wed').start).getDate(), 12);
eq('prev fri-start week', new Date(C.periodRange('week',-1,REF,'fri').start).getDate(), 31);
var wsSat=new Date(2026,7,15,12,0,0); // Saturday
eq('fri-start on a Saturday still last Friday', new Date(C.periodRange('week',0,wsSat,'fri').start).getDate(), 14);
eq('garbage week start falls back to Monday', new Date(C.periodRange('week',0,REF,'xyz').start).getDate(), 10);

section('pay cycles - weekly/biweekly');
function pay(period,start){ return { cycle:{period:period,start:start} }; }
var w=C.payCycleRange(pay('weekly','2026-07-31'), 0, REF);   // anchor Fri
eq('weekly cycle containing Wed 12th starts Fri 7th', iso(w.start), '2026-08-07');
eq('weekly cycle ends Fri 14th', iso(w.end), '2026-08-14');
eq('weekly offset -1', iso(C.payCycleRange(pay('weekly','2026-07-31'),-1,REF).start), '2026-07-31');
var bi=C.payCycleRange(pay('biweekly','2026-08-03'), 0, REF);
eq('biweekly containing the 12th starts the 3rd', iso(bi.start), '2026-08-03');
eq('biweekly runs 14 days', iso(bi.end), '2026-08-17');
eq('biweekly parity holds back an offset', iso(C.payCycleRange(pay('biweekly','2026-08-03'),-2,REF).start), '2026-07-06');
var fut=C.payCycleRange(pay('weekly','2026-12-04'), 0, REF);
ok('future anchor still brackets today', fut.start<=REF.getTime() && REF.getTime()<fut.end,
   iso(fut.start)+' .. '+iso(fut.end));
eq('future anchor keeps the weekday (Fri)', new Date(fut.start).getDay(), 5);

section('pay cycles - daily/monthly');
var dy=C.payCycleRange(pay('daily','2026-01-01'), 0, REF);
eq('daily is today', iso(dy.start), '2026-08-12');
eq('daily offset -1 is yesterday', iso(C.payCycleRange(pay('daily','2026-01-01'),-1,REF).start), '2026-08-11');
var mo=C.payCycleRange(pay('monthly','2026-01-15'), 0, REF);
eq('monthly from the 15th brackets Aug 12', iso(mo.start)+' .. '+iso(mo.end), '2026-07-15 .. 2026-08-15');
var mo31=C.payCycleRange(pay('monthly','2026-01-31'), 0, new Date(2026,1,15,12,0,0)); // ref Feb 15
eq('31st anchor clamps in February', iso(mo31.start)+' .. '+iso(mo31.end), '2026-01-31 .. 2026-02-28');
var mo31b=C.payCycleRange(pay('monthly','2026-01-31'), 1, new Date(2026,1,15,12,0,0));
eq('cycles stay contiguous through the clamp', iso(mo31b.start), '2026-02-28');
var early=C.payCycleRange(pay('monthly','2026-01-15'), 0, new Date(2026,7,3,12,0,0)); // Aug 3 < the 15th
eq('before the cycle day, prior month cycle', iso(early.start), '2026-07-15');
var bad=C.payCycleRange(pay('weekly','garbage'), 0, REF);
ok('garbage start date still yields a 7-day range', Math.round((bad.end-bad.start)/86400000)===7 &&
   bad.start<=REF.getTime() && REF.getTime()<bad.end);
eq('missing payroll defaults weekly', C.payCycleRange(null,0,REF).period, 'weekly');

section('Reports follows the week start');
var HR=3600000;
var t9=new Date(); t9.setHours(9,0,0,0);
var logsToday=[{ id:'a',projectId:1,projectName:'Line 4',lane:'Projects',type:'project',
  startTime:t9.getTime(),endTime:t9.getTime()+2*HR,duration:2*HR,parentId:null,parentName:null }];
var friSch=C.normalizeSchedule({ payroll:{ weekStart:'fri' } });
var rep=C.ReportsModal({ logs:logsToday, projects:[{id:1,name:'Line 4',lane:'Projects',parentId:null}],
  disruptions:[], breaks:[], laneMeta:{Projects:{label:'Projects',accent:'#4B8EC8'}},
  laneOrder:['Projects'], schedule:friSch, liveLogs:[], initialKind:'week', onClose:function(){} });
var repTxt=textOf(flat(rep));
var expectFri=C.periodRange('week',0,null,'fri');
var lbl=C.periodLabel(expectFri);
ok('week label matches the fri-start range', repTxt.indexOf(lbl)>=0, {label:lbl});
eq('and that range starts a Friday', new Date(expectFri.start).getDay(), 5);

section('PayWorkWeekModal renders');
var pv={ weekStart:'fri', otDays:['sat','sun'], ot:{kind:'1.5x',flatExtra:6.25},
         cycle:{period:'biweekly',start:'2026-08-03'} };
var pm=C.PayWorkWeekModal({ value:pv, onDone:function(){}, onClose:function(){} });
var pn=flat(pm), pt=textOf(pn);
ok('titled Pay & Work Week', pt.indexOf('Pay & Work Week')>=0);
ok('all four sections present', ['Week Starts On','Overtime Days','Overtime Rate','Pay Cycle']
   .every(function(s){ return pt.indexOf(s)>=0; }));
var wsChips=pn.filter(function(n){ return n.type==='button' && String(n.props['data-chip']||'').indexOf('ws:')===0; });
eq('7 week-start chips', wsChips.length, 7);
eq('exactly one week-start chip selected', wsChips.filter(function(c){ return c.props['aria-pressed']==='true'; }).length, 1);
ok('fri chip is the selected one', wsChips.filter(function(c){ return c.props['data-chip']==='ws:fri'; })[0].props['aria-pressed']==='true');
var otChips=pn.filter(function(n){ return n.type==='button' && String(n.props['data-chip']||'').indexOf('ot:')===0; });
eq('7 overtime chips', otChips.length, 7);
eq('sat+sun selected', otChips.filter(function(c){ return c.props['aria-pressed']==='true'; }).length, 2);
var otSegs=pn.filter(function(n){ return n.type==='button' && String(n.props['data-seg']||'').indexOf('otk:')===0; });
eq('3 OT rate options', otSegs.length, 3);
ok('rate options read 1.5x / 2x / +$/hr', pt.indexOf('1.5x')>=0 && pt.indexOf('2x')>=0 && pt.indexOf('+$/hr')>=0);
// multiplier mode still has base-rate and hours-excluded number fields, just no flat-extra one
ok('no flat-extra field in multiplier mode', pn.filter(function(n){ return n.type==='input' &&
   n.props.type==='number' && String(n.props.value)==='6.25'; }).length===0);
var cycSegs=pn.filter(function(n){ return n.type==='button' && String(n.props['data-seg']||'').indexOf('cyc:')===0; });
eq('4 cycle options', cycSegs.length, 4);
var dateIns=pn.filter(function(n){ return n.type==='input' && n.props.type==='date'; });
eq('one cycle start date field', dateIns.length, 1);
eq('date field carries the value', dateIns[0].props.value, '2026-08-03');
ok('date field is iOS-safe', dateIns[0].props.style.WebkitAppearance==='none' &&
   dateIns[0].props.style.WebkitTextFillColor===dateIns[0].props.style.color &&
   dateIns[0].props.style.minHeight==='2.1rem');
ok('biweekly hint shown', pt.indexOf('Two-week periods')>=0);

section('PayWorkWeekModal - flat OT and daily cycle');
var pv2={ weekStart:'mon', otDays:[], ot:{kind:'flat',flatExtra:6.25}, cycle:{period:'daily',start:'2026-08-03'} };
var pm2=C.PayWorkWeekModal({ value:pv2, onDone:function(){}, onClose:function(){} });
var pn2=flat(pm2), pt2=textOf(pn2);
var flatIns=pn2.filter(function(n){ return n.type==='input' && n.props.type==='number' && String(n.props.value)==='6.25'; });
eq('flat mode shows the dollar field', flatIns.length, 1);
ok('decimal keyboard on the dollar field', flatIns[0].props.inputMode==='decimal');
ok('flat hint shown', pt2.indexOf('plus this amount')>=0);
ok('daily hides the start date', pn2.filter(function(n){ return n.type==='input' && n.props.type==='date'; }).length===0);
ok('daily hint explains why', pt2.indexOf('no start date is needed')>=0);

section('Done path');
var done=null;
var pm3=C.PayWorkWeekModal({ value:pv, onDone:function(v){ done=v; }, onClose:function(){} });
var doneBtn=flat(pm3).filter(function(n){ return n.type==='button' && n.children && n.children[0]==='Done'; })[0];
ok('Done button found', !!doneBtn);
if(doneBtn){
  doneBtn.props.onClick();
  ok('Done returns the payroll set', !!(done && done.cycle && done.ot));
  eq('week start preserved', done.weekStart, 'fri');
  eq('OT days preserved', done.otDays.join(','), 'sat,sun');
  done.otDays.push('mon');
  eq('Done handed out a copy, not the prop', pv.otDays.length, 2);
}

section('WorkScheduleModal pay row');
var schFri=C.normalizeSchedule({ payroll:{ weekStart:'fri', otDays:['sat'],
  ot:{kind:'flat',flatExtra:6.25}, cycle:{period:'biweekly',start:'2026-08-03'} } });
var wm=C.WorkScheduleModal({ schedule:schFri, onSave:function(){}, onClose:function(){} });
var wn=flat(wm), wt=textOf(wn);
ok('pay row present', wt.indexOf('Pay & Work Week')>=0);
ok('summary shows the week start', wt.indexOf('Friday start')>=0, wt.slice(wt.indexOf('Friday')-20, wt.indexOf('Friday')+60));
ok('summary shows the cycle', wt.indexOf('Biweekly pay')>=0);
ok('summary shows flat OT with the amount', wt.indexOf('OT +$6.25/hr')>=0);
ok('summary lists the OT days', wt.indexOf('(Sa)')>=0);
var editBtns=wn.filter(function(n){ return n.type==='button' && n.children && n.children[0]==='Edit'; });
eq('one Edit button for pay', editBtns.length, 1);
var saved=null;
var wm2=C.WorkScheduleModal({ schedule:schFri, onSave:function(s){ saved=s; }, onClose:function(){} });
var sBtn=flat(wm2).filter(function(n){ return n.type==='button' && n.children && n.children[0]==='Save Schedule'; })[0];
if(sBtn){ sBtn.props.onClick(); }
ok('save carries payroll through', !!(saved && saved.payroll));
eq('saved week start intact', saved && saved.payroll.weekStart, 'fri');
eq('saved cycle intact', saved && saved.payroll.cycle.start, '2026-08-03');

section('rollup splits overtime');
var HR2=3600000;
var REF2=new Date(2026,7,12,14,0,0);
var rw=C.periodRange('week',0,REF2);
function LG(id,start,ms,type){ return { id:id, projectId:1, projectName:'Line 4', lane:'Projects',
  type:type||'project', startTime:start, endTime:start+ms, duration:ms, parentId:null, parentName:null }; }
var mon2=new Date(2026,7,10,9,0,0).getTime();   // Monday
var sat2=new Date(2026,7,15,9,0,0).getTime();   // Saturday
var lgs=[ LG('a',mon2,2*HR2), LG('b',sat2,3*HR2), LG('c',sat2,8*HR2,'atwork') ];
var prj=[{id:1,name:'Line 4',lane:'Projects',parentId:null}];
var meta2={Projects:{label:'Projects',accent:'#4B8EC8'}};
var rSat=C.buildRollup({ logs:lgs, projects:prj, laneMeta:meta2, laneOrder:['Projects'], range:rw, otDays:['sat'] });
eq('sat log lands in overtime', rSat.otMs/HR2, 3);
eq('regular is the remainder', rSat.regMs/HR2, 2);
eq('atwork never counts as OT', rSat.trackedMs/HR2, 5);
var rNone=C.buildRollup({ logs:lgs, projects:prj, laneMeta:meta2, laneOrder:['Projects'], range:rw, otDays:[] });
eq('no OT days means no OT', rNone.otMs, 0);
eq('regMs equals tracked with no OT days', rNone.regMs, rNone.trackedMs);
var rAll=C.buildRollup({ logs:lgs, projects:prj, laneMeta:meta2, laneOrder:['Projects'], range:rw,
  otDays:['mon','tue','wed','thu','fri','sat','sun'] });
eq('all-OT flips the whole total', rAll.otMs, rAll.trackedMs);

section('Reports pay tab');
// day-independent fixtures: pin OT to whatever day today is
var t9b=new Date(); t9b.setHours(9,0,0,0);
var todayKey=C.dayKeyOf(new Date());
var payLogs=[ LG('p1', t9b.getTime(), 2*HR2), LG('p2', t9b.getTime()+3*HR2, 1*HR2) ];
function paySch(otDays, otCfg, cycle){
  return C.normalizeSchedule({ payroll:{ weekStart:'mon', otDays:otDays, ot:otCfg,
    cycle:cycle||{period:'biweekly',start:'2020-01-06'} } });
}
function payProps(sch){ return { logs:payLogs, projects:prj, disruptions:[], breaks:[], laneMeta:meta2,
  laneOrder:['Projects'], schedule:sch, liveLogs:[], initialKind:'pay', onClose:function(){} }; }

var flatSch=paySch([todayKey], {kind:'flat',flatExtra:6.25});
var fr=C.ReportsModal(payProps(flatSch));
var fn=flat(fr), ft=textOf(fn);
ok('picker offers six tabs incl Pay', ['Day','Week','Month','Qtr','Year','Pay']
   .every(function(l){ return ft.indexOf(l)>=0; }));
ok('relative label reads pay period', ft.indexOf('pay period')>=0);
ok('regular row present', ft.indexOf('Regular')>=0);
ok('overtime shows the flat rate tag', ft.indexOf('Overtime (+$6.25/hr)')>=0, ft.slice(0,200));
ok('all 3h are OT today', ft.indexOf('3h 00m')>=0);
ok('premium priced: 3h x $6.25', ft.indexOf('$18.75')>=0);
ok('no weighted row in flat mode', ft.indexOf('Pay-weighted')<0);
ok('no missing-OT-days hint when set', ft.indexOf('No overtime days set')<0);

var multSch=paySch([todayKey], {kind:'2x',flatExtra:6.25});
var mr=C.ReportsModal(payProps(multSch));
var mt=textOf(flat(mr));
ok('multiplier tag shows x2', mt.indexOf('Overtime (x2)')>=0);
ok('weighted hours double the OT (3h -> 6h)', mt.indexOf('6h 00m')>=0, mt.slice(0,160));
ok('no premium row in multiplier mode', mt.indexOf('OT premium')<0);

var noneSch=paySch([], {kind:'1.5x',flatExtra:6.25});
var nr=C.ReportsModal(payProps(noneSch));
var nt=textOf(flat(nr));
ok('no OT days: everything regular', nt.indexOf('Overtime (x1.5)')>=0);
ok('hint points at Pay & Work Week', nt.indexOf('No overtime days set')>=0);

var otherTab=C.ReportsModal(Object.assign({}, payProps(flatSch), {initialKind:'week'}));
ok('pay card only on the pay tab', textOf(flat(otherTab)).indexOf('OT premium')<0);

section('pay tab copy text');
var captured2=null;
C.navigator.clipboard.writeText=function(t){ captured2=t; return Promise.resolve(); };
var cr=C.ReportsModal(payProps(flatSch));
var copyBtn2=flat(cr).filter(function(n){ return n.type==='button' && n.children &&
  String(n.children[0]).indexOf('Copy report')>=0; })[0];
ok('copy button on pay tab', !!copyBtn2);
if(copyBtn2){
  copyBtn2.props.onClick();
  ok('copy includes the regular line', captured2.indexOf('Regular:')>=0);
  ok('copy includes overtime with the rate', captured2.indexOf('Overtime:')>=0 && captured2.indexOf('+$6.25/hr')>=0);
  ok('copy includes the premium', captured2.indexOf('OT premium: $18.75')>=0);
}

section('pay tab navigation');
var navR=C.ReportsModal(payProps(paySch([todayKey], {kind:'flat',flatExtra:6.25},
  {period:'weekly',start:'2020-01-06'})));
var arrows2=flat(navR).filter(function(n){ return n && n.type==='button' && n.children &&
  (n.children[0]==='\u2039' || n.children[0]==='\u203a'); });
eq('pay tab has both nav arrows', arrows2.length, 2);
ok('forward disabled on the current cycle', arrows2[1].props.disabled===true);
ok('pay label is a date range', textOf(flat(navR)).indexOf(' - ')>=0);

section('base pay + exclusion normalization');
var d2=C.DEFAULT_SCHEDULE();
eq('default basis hourly', d2.payroll.pay.basis, 'hourly');
eq('default rate unset', d2.payroll.pay.rate, 0);
eq('default salary unset', d2.payroll.pay.salary, 0);
eq('default exclusion zero', d2.payroll.ot.excludeHrs, 0);
var j2=C.normalizeSchedule({ payroll:{ pay:{basis:'weird',rate:-5,salary:'x'}, ot:{excludeHrs:-4} } });
eq('bad basis falls back', j2.payroll.pay.basis, 'hourly');
eq('bad rate falls back', j2.payroll.pay.rate, 0);
eq('bad exclusion falls back', j2.payroll.ot.excludeHrs, 0);
var k2=C.normalizeSchedule({ payroll:{ pay:{basis:'salary',rate:25,salary:850}, ot:{kind:'2x',excludeHrs:4} } });
eq('salary basis kept', k2.payroll.pay.basis, 'salary');
eq('salary amount kept', k2.payroll.pay.salary, 850);
eq('rate survives alongside', k2.payroll.pay.rate, 25);
eq('exclusion kept', k2.payroll.ot.excludeHrs, 4);

section('pay tab - hourly with exclusion');
// payLogs = 3h today, all OT via todayKey
function paySch2(otCfg, payCfg){
  return C.normalizeSchedule({ payroll:{ weekStart:'mon', otDays:[todayKey], ot:otCfg, pay:payCfg,
    cycle:{period:'biweekly',start:'2020-01-06'} } });
}
var exSch=paySch2({kind:'flat',flatExtra:6.25,excludeHrs:2}, {basis:'hourly',rate:25});
var er=C.ReportsModal(payProps(exSch));
var et=textOf(flat(er));
ok('base rate row', et.indexOf('Base rate')>=0 && et.indexOf('$25.00/hr')>=0);
ok('excluded row labels the threshold', et.indexOf('OT excluded (first 2h, base rate)')>=0, et.slice(0,240));
ok('excluded row shows 2h', et.indexOf('2h 00m')>=0);
ok('effective OT is the remainder (1h)', et.indexOf('1h 00m')>=0);
ok('premium prices only effective OT: 1h x 6.25', et.indexOf('$6.25')>=0 && et.indexOf('$18.75')<0);
// gross: (0 reg + 2 excl)*25 + 1*(25+6.25) = 81.25
ok('gross pay computed', et.indexOf('Gross pay')>=0 && et.indexOf('$81.25')>=0, et.slice(-260));
ok('gross disclaimer on the card', et.indexOf('All pay figures are gross and do not include any state or federal deductions.')>=0);
ok('no set-your-rate hint when set', et.indexOf('to see gross pay')<0);

var mx=paySch2({kind:'2x',excludeHrs:1}, {basis:'hourly',rate:20});
var mxr=C.ReportsModal(payProps(mx));
var mxt=textOf(flat(mxr));
// weighted = 0 + 1 + 2*2 = 5h; gross = 1*20 + 2*40 = 100
ok('multiplier weighted hours honor exclusion (5h)', mxt.indexOf('5h 00m')>=0, mxt.slice(0,200));
ok('multiplier gross honors exclusion ($100.00)', mxt.indexOf('$100.00')>=0);

var unset=paySch2({kind:'1.5x',excludeHrs:0}, {basis:'hourly',rate:0});
var ut=textOf(flat(C.ReportsModal(payProps(unset))));
ok('unset rate reads not set', ut.indexOf('not set')>=0);
ok('unset rate hints instead of gross', ut.indexOf('Set your base rate')>=0 && ut.indexOf('Gross pay')<0);

section('pay tab - salary');
// biweekly Mon-anchored cycle: 10 weekdays x 8.5h = 85h scheduled -> eff rate = salary/85
var sf=paySch2({kind:'flat',flatExtra:6.25,excludeHrs:1}, {basis:'salary',salary:850});
var sft=textOf(flat(C.ReportsModal(payProps(sf))));
ok('salary row shown', sft.indexOf('Salary (per period)')>=0 && sft.indexOf('$850.00')>=0);
ok('salary exclusion reads no extra', sft.indexOf('OT excluded (first 1h, no extra)')>=0);
// OT pay = 2h * 6.25 = 12.50; gross = 862.50
ok('flat salary premium: $12.50', sft.indexOf('$12.50')>=0);
ok('flat salary gross: $862.50', sft.indexOf('$862.50')>=0);
var sm=paySch2({kind:'2x',excludeHrs:1}, {basis:'salary',salary:850});
var smt=textOf(flat(C.ReportsModal(payProps(sm))));
ok('salary multiplier tags the effective rate', smt.indexOf('x2 @ $10.00/hr eff.')>=0, smt.slice(0,240));
// OT pay = 2h * 10 * 2 = 40; gross 890
ok('salary OT pay row: $40.00', smt.indexOf('OT pay')>=0 && smt.indexOf('$40.00')>=0);
ok('salary multiplier gross: $890.00', smt.indexOf('$890.00')>=0);
ok('no weighted-hours row for salary', smt.indexOf('Pay-weighted')<0);
var sun2=paySch2({kind:'2x',excludeHrs:0}, {basis:'salary',salary:0});
var sut=textOf(flat(C.ReportsModal(payProps(sun2))));
ok('unset salary hints', sut.indexOf('Set your salary')>=0);

section('copy text with exclusion and gross');
var captured3=null;
C.navigator.clipboard.writeText=function(t){ captured3=t; return Promise.resolve(); };
var cr2=C.ReportsModal(payProps(exSch));
var cb2=flat(cr2).filter(function(n){ return n.type==='button' && n.children &&
  String(n.children[0]).indexOf('Copy report')>=0; })[0];
if(cb2){ cb2.props.onClick(); }
ok('copy has the excluded line', captured3 && captured3.indexOf('OT excluded (first 2h): 2h 00m')>=0);
ok('copy has gross', captured3 && captured3.indexOf('Gross pay: $81.25')>=0);
ok('copy has the disclaimer', captured3 && captured3.indexOf('gross - no state or federal deductions')>=0);

section('PayWorkWeekModal - base pay UI');
var pvH={ weekStart:'mon', otDays:[], ot:{kind:'flat',flatExtra:6.25,excludeHrs:4},
          pay:{basis:'hourly',rate:25,salary:0}, cycle:{period:'biweekly',start:'2026-08-03'} };
var hm=C.PayWorkWeekModal({ value:pvH, onDone:function(){}, onClose:function(){} });
var hn=flat(hm), ht=textOf(hn);
ok('Base Pay section present', ht.indexOf('Base Pay')>=0);
ok('gross note verbatim', ht.indexOf('All pay calculations are gross and do not include any state or federal deductions.')>=0);
var basisSegs=hn.filter(function(n){ return n.type==='button' && String(n.props['data-seg']||'').indexOf('basis:')===0; });
eq('two basis options', basisSegs.length, 2);
var rateIn=hn.filter(function(n){ return n.type==='input' && n.props.type==='number' && String(n.props.value)==='25'; });
eq('rate field carries the value', rateIn.length, 1);
ok('per hour label in hourly mode', hn.indexOf('per hour')>=0 && hn.indexOf('per pay period')<0);
var exIn=hn.filter(function(n){ return n.type==='input' && n.props.type==='number' && String(n.props.value)==='4'; });
eq('hours excluded field carries the value', exIn.length, 1);
ok('hours excluded labelled', ht.indexOf('Hours excluded')>=0);
var exuSegs=hn.filter(function(n){ return n.type==='button' && String(n.props['data-seg']||'').indexOf('exu:')===0; });
eq('exclusion unit toggle present', exuSegs.length, 2);
ok('unit options read per cycle / per week', ht.indexOf('Per pay cycle')>=0 && ht.indexOf('Per week')>=0);
ok('hourly exclusion hint', ht.indexOf('pay the base rate, not the overtime rate')>=0);
var pvS=Object.assign({}, pvH, { pay:{basis:'salary',rate:0,salary:850} });
var smm=C.PayWorkWeekModal({ value:pvS, onDone:function(){}, onClose:function(){} });
var smn=flat(smm), smt2=textOf(smn);
ok('salary field carries the amount', smn.filter(function(n){ return n.type==='input' &&
   n.props.type==='number' && String(n.props.value)==='850'; }).length===1);
ok('per pay period label in salary mode', smt2.indexOf('per pay period')>=0);
ok('effective rate hint in salary mode', smt2.indexOf('salary divided by the scheduled hours')>=0);
ok('salary exclusion hint', smt2.indexOf('covered by salary - no extra pay')>=0);
var doneP=null;
var dm=C.PayWorkWeekModal({ value:pvS, onDone:function(v){ doneP=v; }, onClose:function(){} });
var dBtn=flat(dm).filter(function(n){ return n.type==='button' && n.children && n.children[0]==='Done'; })[0];
if(dBtn){ dBtn.props.onClick(); }
ok('Done carries pay + exclusion through', !!(doneP && doneP.pay && doneP.pay.basis==='salary' &&
   doneP.pay.salary===850 && doneP.ot.excludeHrs===4));

section('schedule caption shows basis');
var capSch=C.normalizeSchedule({ payroll:{ weekStart:'fri', otDays:['sat'],
  ot:{kind:'flat',flatExtra:6.25,excludeHrs:4}, pay:{basis:'hourly',rate:25},
  cycle:{period:'biweekly',start:'2026-08-03'} } });
var capT=textOf(flat(C.WorkScheduleModal({ schedule:capSch, onSave:function(){}, onClose:function(){} })));
ok('caption leads with the basis and rate', capT.indexOf('Hourly $25.00/hr')>=0, capT.slice(capT.indexOf('Hourly')-10, capT.indexOf('Hourly')+80));
ok('caption shows the exclusion', capT.indexOf('after 4h')>=0);

section('exclusion unit - normalize + math');
eq('default unit is cycle', C.DEFAULT_SCHEDULE().payroll.ot.excludeUnit, 'cycle');
eq('bad unit falls back', C.normalizeSchedule({payroll:{ot:{excludeUnit:'fortnight'}}}).payroll.ot.excludeUnit, 'cycle');
eq('week unit kept', C.normalizeSchedule({payroll:{ot:{excludeUnit:'week'}}}).payroll.ot.excludeUnit, 'week');

// two OT weeks inside the live biweekly cycle (anchor Mon 2020-01-06, so the
// cycle and its weeks are Monday-aligned regardless of today)
var ALLDAYS=['mon','tue','wed','thu','fri','sat','sun'];
var cyc0=C.payCycleRange({cycle:{period:'biweekly',start:'2020-01-06'}}, 0);
var wk1=cyc0.start + 2*86400000 + 9*3600000;   // day 3 of week 1
var wk2=cyc0.start + 9*86400000 + 9*3600000;   // day 3 of week 2
var splitLogs=[ LG('w1', wk1, 3*HR2), LG('w2', wk2, 1*HR2) ];
function unitSch(unit){
  return C.normalizeSchedule({ payroll:{ weekStart:'mon', otDays:ALLDAYS,
    ot:{kind:'flat',flatExtra:6.25,excludeHrs:2,excludeUnit:unit},
    pay:{basis:'hourly',rate:25},
    cycle:{period:'biweekly',start:'2020-01-06'} } });
}
function unitProps(sch){ return { logs:splitLogs, projects:prj, disruptions:[], breaks:[], laneMeta:meta2,
  laneOrder:['Projects'], schedule:sch, liveLogs:[], initialKind:'pay', onClose:function(){} }; }

var byWeek=C.overtimeByWeek(splitLogs, cyc0, ALLDAYS, 'mon');
eq('two OT weeks found', byWeek.length, 2);
eq('week buckets carry their hours', (byWeek[0].otMs/HR2)+'+'+(byWeek[1].otMs/HR2), '3+1');
ok('buckets are week-aligned Mondays', byWeek.every(function(w){ return new Date(w.week).getDay()===1; }));

// per cycle: excl 2 of 4 -> eff 2h -> premium 12.50; gross (0+2)*25 + 2*31.25 = 112.50
var ct=textOf(flat(C.ReportsModal(unitProps(unitSch('cycle')))));
ok('cycle: label has no week tag', ct.indexOf('OT excluded (first 2h, base rate)')>=0, ct.slice(0,260));
ok('cycle: effective OT 2h', ct.indexOf('$12.50')>=0);
ok('cycle: gross $112.50', ct.indexOf('$112.50')>=0);
// per week: excl min(3,2)+min(1,2)=3 -> eff 1h -> premium 6.25; gross (0+3)*25 + 1*31.25 = 106.25
var wt2=textOf(flat(C.ReportsModal(unitProps(unitSch('week')))));
ok('week: label carries each week', wt2.indexOf('OT excluded (first 2h each week, base rate)')>=0, wt2.slice(0,260));
ok('week: effective OT 1h premium $6.25', wt2.indexOf('$6.25')>=0 && wt2.indexOf('$12.50')<0);
ok('week: gross $106.25', wt2.indexOf('$106.25')>=0);

section('exclusion unit - copy, caption, Done');
var captured4=null;
C.navigator.clipboard.writeText=function(t){ captured4=t; return Promise.resolve(); };
var cw=C.ReportsModal(unitProps(unitSch('week')));
var cwb=flat(cw).filter(function(n){ return n.type==='button' && n.children &&
  String(n.children[0]).indexOf('Copy report')>=0; })[0];
if(cwb){ cwb.props.onClick(); }
ok('copy carries the week tag', captured4 && captured4.indexOf('OT excluded (first 2h each week): 3h 00m')>=0,
   captured4 && captured4.split('\n').filter(function(l){ return l.indexOf('excluded')>=0; }));
var capW=C.normalizeSchedule({ payroll:{ ot:{kind:'1.5x',excludeHrs:4,excludeUnit:'week'} } });
var capWT=textOf(flat(C.WorkScheduleModal({ schedule:capW, onSave:function(){}, onClose:function(){} })));
ok('caption reads after 4h/wk', capWT.indexOf('after 4h/wk')>=0);
var pvU={ weekStart:'mon', otDays:[], ot:{kind:'1.5x',flatExtra:6.25,excludeHrs:4,excludeUnit:'week'},
          pay:{basis:'hourly',rate:25,salary:0}, cycle:{period:'weekly',start:'2026-08-03'} };
var um=C.PayWorkWeekModal({ value:pvU, onDone:function(v){ captured4=v; }, onClose:function(){} });
var ut2=textOf(flat(um));
ok('week hint reads each week', ut2.indexOf('each week pay the base rate')>=0, ut2.slice(ut2.indexOf('each')-30, ut2.indexOf('each')+80));
var udBtn=flat(um).filter(function(n){ return n.type==='button' && n.children && n.children[0]==='Done'; })[0];
if(udBtn){ udBtn.props.onClick(); }
ok('Done carries the unit through', captured4 && captured4.ot && captured4.ot.excludeUnit==='week');

console.log('\n----------------------------------------');
console.log(pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
