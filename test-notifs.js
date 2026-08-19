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

var HR=3600000;
function LG(id,start,ms,type){ return { id:id, projectId:1, projectName:'Line 4', lane:'Projects',
  type:type||'project', startTime:start, endTime:start+ms, duration:ms, parentId:null, parentName:null }; }

section('normalizeNotifs');
var d=C.normalizeNotifs(null);
ok('default: all scopes off', !d.day.on && !d.cycle.on && !d.period.on);
eq('default period kind', d.period.kind, 'week');
ok('two leads per scope with sane defaults', ['day','cycle','period'].every(function(k){
  return d[k].leads.length===2 && d[k].leads[0].hrs===1 && d[k].leads[1].hrs===24 &&
         !d[k].leads[0].on && !d[k].leads[1].on; }));
var j=C.normalizeNotifs({ day:{on:true,leads:[{on:true,hrs:60},{on:true,hrs:-3}]},
                          period:{on:true,kind:'decade'} });
eq('lead hours cap at 48', j.day.leads[0].hrs, 48);
eq('bad lead hours fall back', j.day.leads[1].hrs, 24);
eq('bad period kind falls back', j.period.kind, 'week');
ok('valid states survive', j.day.on===true && j.day.leads[0].on===true && j.period.on===true);

section('workday met (Wed 2026-08-12, 8:00-16:30 net 8.5h)');
var SCH=C.DEFAULT_SCHEDULE();
function cfgOn(over){ return C.normalizeNotifs(Object.assign({ day:{on:true} }, over||{})); }
var wed9=new Date(2026,7,12,9,0,0).getTime();
var NOW=new Date(2026,7,12,14,0,0).getTime();
var metLogs=[ LG('a', wed9, 9*HR) ];
var due=C.evalNotifications(cfgOn(), SCH, metLogs, NOW, {});
eq('met fires once', due.length, 1);
ok('met title and totals', due[0].title==='Workday target met' && due[0].body.indexOf('9h 00m')>=0
   && due[0].body.indexOf('8h 30m')>=0, due[0]);
ok('key is period-scoped', due[0].key.indexOf('day|met|')===0);
var fired={}; fired[due[0].key]=1;
eq('fired map suppresses a repeat', C.evalNotifications(cfgOn(), SCH, metLogs, NOW, fired).length, 0);
eq('under target: nothing fires', C.evalNotifications(cfgOn(), SCH, [LG('a',wed9,2*HR)], NOW, {}).length, 0);
ok('atwork never counts toward the target',
   C.evalNotifications(cfgOn(), SCH, [LG('a',wed9,9*HR,'atwork')], NOW, {}).length===0);
var sat=new Date(2026,7,15,14,0,0).getTime();
eq('day off: met cannot fire (sched 0)', C.evalNotifications(cfgOn(), SCH, [LG('a',sat-5*HR,9*HR)], sat, {}).length, 0);
eq('scope off: silent', C.evalNotifications(C.normalizeNotifs(null), SCH, metLogs, NOW, {}).length, 0);

section('workday leads peg to the shift end (16:30)');
function dayLead(hrs){ return cfgOn({ day:{on:true,leads:[{on:true,hrs:hrs},{on:false,hrs:24}]} }); }
var at=function(h,m){ return new Date(2026,7,12,h,m,0).getTime(); };
eq('before the window: silent', C.evalNotifications(dayLead(2), SCH, [], at(14,0), {}).length, 0);
var lead1=C.evalNotifications(dayLead(2), SCH, [LG('a',wed9,3*HR)], at(14,45), {});
eq('inside the window: fires', lead1.length, 1);
ok('lead title names the horizon', lead1[0].title==='Workday ends in 2h', lead1[0].title);
ok('lead body reports the shortfall (8.5h - 3h)', lead1[0].body.indexOf('5h 30m')>=0, lead1[0].body);
eq('after the end: silent', C.evalNotifications(dayLead(2), SCH, [], at(17,0), {}).length, 0);
var metBody=C.evalNotifications(dayLead(2), SCH, [LG('a',wed9,9*HR)], at(15,0), {})
  .filter(function(n){ return n.key.indexOf('lead')>=0; })[0];
ok('lead reads already-met when covered', metBody && metBody.body==='Scheduled time already met.');
var both=C.evalNotifications(cfgOn({ day:{on:true,leads:[{on:true,hrs:3},{on:true,hrs:1}]} }),
  SCH, [], at(15,45), {});
eq('both leads can be due at once', both.length, 2);
eq('half-hour leads format cleanly',
   C.evalNotifications(dayLead(0.5), SCH, [], at(16,15), {})[0].title, 'Workday ends in 0.5h');
eq('off day: no lead end, silent', C.evalNotifications(dayLead(2), SCH, [], sat, {}).length, 0);
eq('lead off: silent', C.evalNotifications(cfgOn({ day:{on:true,leads:[{on:false,hrs:2},{on:false,hrs:24}]} }),
   SCH, [], at(15,0), {}).length, 0);

section('pay cycle and period scopes');
var cycSch=C.normalizeSchedule({ payroll:{ cycle:{period:'biweekly',start:'2020-01-06'} } });
var cyc=C.payCycleRange(cycSch.payroll, 0, new Date(NOW));
var cycCfg=C.normalizeNotifs({ cycle:{on:true,leads:[{on:true,hrs:48},{on:false,hrs:24}]} });
var nearEnd=cyc.end - 24*HR;
var cycDue=C.evalNotifications(cycCfg, cycSch, [], nearEnd, {});
eq('48h cycle lead fires a day out', cycDue.length, 1);
ok('cycle lead names the cycle', cycDue[0].title==='Pay cycle ends in 48h');
var cycMet=[ LG('m', cyc.start+2*86400000+HR, 86*HR) ];   // > 85h scheduled
var cycMetDue=C.evalNotifications(C.normalizeNotifs({cycle:{on:true}}), cycSch, cycMet, nearEnd, {});
eq('cycle met fires', cycMetDue.length, 1);
ok('cycle met title', cycMetDue[0].title==='Pay cycle target met');
var perCfg=C.normalizeNotifs({ period:{on:true,kind:'week',leads:[{on:true,hrs:48},{on:false,hrs:24}]} });
var wkRange=C.periodRange('week',0,new Date(NOW),'mon');
var perDue=C.evalNotifications(perCfg, SCH, [], wkRange.end-3*HR, {});
eq('week-period lead fires near Sunday midnight', perDue.length, 1);
ok('period lead names the kind', perDue[0].title==='Week ends in 48h');
var perMet=C.evalNotifications(C.normalizeNotifs({period:{on:true,kind:'week'}}), SCH,
  [ LG('w', wkRange.start+86400000+HR, 43*HR) ], NOW, {});
ok('week met fires vs 42.5h schedule', perMet.length===1 && perMet[0].title==='Week target met');

section('TrackingModal UI');
var settings={ tracking:'timer', timeInc:'standard',
  notifs:C.normalizeNotifs({ day:{on:true,leads:[{on:true,hrs:2},{on:false,hrs:24}]},
                             period:{on:true,kind:'month'} }) };
var changed=null;
var tm=C.TrackingModal({ settings:settings, onChange:function(sx){ changed=sx; }, onClose:function(){} });
var tn=flat(tm), tt=textOf(tn);
ok('Notifications section present', tt.indexOf('Notifications')>=0);
ok('note explains the trigger and the 48h cap', tt.indexOf('48h max')>=0 && tt.indexOf('while the app is open')>=0);
ok('all three scopes listed', tt.indexOf('Workday')>=0 && tt.indexOf('Pay Cycle')>=0 && tt.indexOf('Time Period')>=0);
var scopes=tn.filter(function(n){ return n.props && n.props['data-notifscope']; });
eq('three scope toggles', scopes.length, 3);
eq('day scope reads on', scopes.filter(function(x){ return x.props['data-notifscope']==='day'; })[0].props['aria-pressed'], 'true');
eq('cycle scope reads off', scopes.filter(function(x){ return x.props['data-notifscope']==='cycle'; })[0].props['aria-pressed'], 'false');
var leadsUI=tn.filter(function(n){ return n.props && n.props['data-notiflead']; });
eq('lead toggles only under open scopes (day 2 + period 2)', leadsUI.length, 4);
var kindBtns=tn.filter(function(n){ return n.props && n.props['data-notifkind']; });
eq('period kind picker shows four options', kindBtns.length, 4);
ok('leads label the mechanics', tt.indexOf('h before the end')>=0);
ok('permission line present', tt.indexOf('System banners')>=0);
// toggling the cycle scope round-trips through settings
scopes.filter(function(x){ return x.props['data-notifscope']==='cycle'; })[0].props.onClick();
ok('scope toggle writes back to settings', !!(changed && changed.notifs && changed.notifs.cycle.on===true));
ok('write preserved the other scopes', changed.notifs.day.on===true && changed.notifs.day.leads[0].hrs===2);

section('App wiring shipped');
var src=require('fs').readFileSync('time-tracker.jsx','utf8');
ok('boot normalizes notifs', src.indexOf('st.notifs = normalizeNotifs(st.notifs)')>=0);
ok('tick effect evaluates and dedupes', src.indexOf('tt_notif_fired')>=0 && src.indexOf('evalNotifications(cfg, settings.workSchedule')>=0);
ok('live timer counts toward targets', src.indexOf('logs.concat(liveLogs())')>=0);
ok('system banner attempted only when granted', src.indexOf('Notification.permission==="granted"')>=0);
ok('toast renders above the board', src.indexOf('role:"status"')>=0 && src.indexOf('zIndex:950')>=0);

console.log('\n----------------------------------------');
console.log(pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
