var H=require('./harness.js');
var C=H.ctx;

var pass=0, fail=0;
function ok(name, cond, extra){
  if(cond){ pass++; console.log('  PASS  '+name); }
  else { fail++; console.log('  FAIL  '+name+(extra!==undefined?('   -> '+JSON.stringify(extra)):'')); }
}
function eq(name,a,b){ ok(name, a===b, {got:a, want:b}); }
function section(t){ console.log('\n== '+t+' =='); }

// ---------- setup ----------
C.applyTokens({ layout:'comfortable', tracking:'timer', colorScheme:'bright-pastels',
  theme:'neon-dream', schemes:{}, fonts:{}, mode:'dark', handedness:'right', headerPos:'top',
  workSchedule:C.DEFAULT_SCHEDULE(), timeInc:'standard' });

var SCH = C.DEFAULT_SCHEDULE();           // Mon-Fri 08:00-16:30 => 510 min/day
var D = function(s){ return new Date(s).getTime(); };

section('period ranges (ref = Wed 2026-08-12 14:00 local)');
var REF = new Date(2026,7,12,14,0,0);     // August is month 7; a Wednesday

var rDay = C.periodRange('day', 0, REF);
eq('day start is local midnight', new Date(rDay.start).getHours(), 0);
eq('day is 24h', (rDay.end-rDay.start)/3600000, 24);
eq('day label', C.periodLabel(rDay).indexOf('Wednesday'), 0);

var rWeek = C.periodRange('week', 0, REF);
eq('week starts Monday', new Date(rWeek.start).getDay(), 1);
eq('week start date', new Date(rWeek.start).getDate(), 10);
eq('week is 7 days', Math.round((rWeek.end-rWeek.start)/86400000), 7);
eq('prev week start date', new Date(C.periodRange('week',-1,REF).start).getDate(), 3);

var rMonth = C.periodRange('month', 0, REF);
eq('month start day', new Date(rMonth.start).getDate(), 1);
eq('month start month', new Date(rMonth.start).getMonth(), 7);
eq('month end month', new Date(rMonth.end).getMonth(), 8);
eq('month label', C.periodLabel(rMonth).indexOf('August'), 0);

var rQ = C.periodRange('quarter', 0, REF);
eq('quarter start month (Q3 -> July)', new Date(rQ.start).getMonth(), 6);
eq('quarter label', C.periodLabel(rQ), 'Q3 2026');
eq('prev quarter is Q2', C.periodLabel(C.periodRange('quarter',-1,REF)), 'Q2 2026');
eq('back 3 quarters crosses the year', C.periodLabel(C.periodRange('quarter',-3,REF)), 'Q4 2025');

var rY = C.periodRange('year', 0, REF);
eq('year label', C.periodLabel(rY), '2026');
eq('year start is Jan 1', new Date(rY.start).getMonth()+':'+new Date(rY.start).getDate(), '0:1');
eq('prev year label', C.periodLabel(C.periodRange('year',-1,REF)), '2025');

section('month arithmetic never spills (the 31st problem)');
// Jan 31 stepping back a month must land in December, not slide to Mar 3.
var jan31 = new Date(2026,0,31,10,0,0);
eq('Jan 31 -> this month', C.periodLabel(C.periodRange('month',0,jan31)), 'January 2026');
eq('Jan 31 -> last month', C.periodLabel(C.periodRange('month',-1,jan31)), 'December 2025');
eq('Mar 31 -> last month is February', C.periodLabel(C.periodRange('month',-1,new Date(2026,2,31,10,0,0))), 'February 2026');
eq('May 31 -> last quarter', C.periodLabel(C.periodRange('quarter',-1,new Date(2026,4,31,10,0,0))), 'Q1 2026');

section('ranges are half-open and contiguous');
var a=C.periodRange('month',-1,REF), b=C.periodRange('month',0,REF);
eq('prev month end == this month start', a.end, b.start);
var w1=C.periodRange('week',-1,REF), w2=C.periodRange('week',0,REF);
eq('prev week end == this week start', w1.end, w2.start);

section('scheduled minutes');
eq('one work week = 5 x 510', C.scheduledMinutes(SCH, rWeek.start, rWeek.end), 2550);
eq('a Wednesday', C.scheduledMinutes(SCH, rDay.start, rDay.end), 510);
var sat=C.periodRange('day',0,new Date(2026,7,15,12,0,0));
eq('a Saturday is off', C.scheduledMinutes(SCH, sat.start, sat.end), 0);
eq('August 2026 (21 weekdays)', C.scheduledMinutes(SCH, rMonth.start, rMonth.end), 21*510);
eq('empty schedule is zero', C.scheduledMinutes(null, rWeek.start, rWeek.end), 0);
eq('inverted range is zero', C.scheduledMinutes(SCH, rWeek.end, rWeek.start), 0);
var full2026=C.periodRange('year',0,REF);
ok('a full year sums (no guard cutoff)', C.scheduledMinutes(SCH, full2026.start, full2026.end)===261*510,
   C.scheduledMinutes(SCH, full2026.start, full2026.end)/510);

section('pace (scheduledToDate)');
var wedNoon = new Date(2026,7,12,12,0,0).getTime();   // 4h into Wednesday
eq('mid-week, mid-day', C.scheduledToDate(SCH, rWeek.start, rWeek.end, wedNoon), 510*2 + 240);
var wedEarly = new Date(2026,7,12,6,0,0).getTime();
eq('before the shift starts', C.scheduledToDate(SCH, rWeek.start, rWeek.end, wedEarly), 510*2);
var wedLate = new Date(2026,7,12,22,0,0).getTime();
eq('after the shift ends', C.scheduledToDate(SCH, rWeek.start, rWeek.end, wedLate), 510*3);
eq('period already over returns the full total',
   C.scheduledToDate(SCH, w1.start, w1.end, wedNoon), 2550);
eq('period not started yet returns zero',
   C.scheduledToDate(SCH, C.periodRange('week',1,REF).start, C.periodRange('week',1,REF).end, wedNoon), 0);
var satNoon = new Date(2026,7,15,12,0,0).getTime();
eq('a day off adds nothing mid-day', C.scheduledToDate(SCH, rWeek.start, rWeek.end, satNoon), 510*5);

section('rollup aggregation');
var projects=[
  { id:1, name:'Line 4 Rebuild', lane:'Projects', parentId:null },
  { id:2, name:'Teardown',       lane:'Projects', parentId:1 },
  { id:3, name:'Reassembly',     lane:'Projects', parentId:1 },
  { id:4, name:'Deep Nest',      lane:'Projects', parentId:2 },
  { id:5, name:'Paperwork',      lane:'Daily Activity', parentId:null },
  { id:6, name:'Prototype Rig',  lane:'Side Projects', parentId:null }
];
var HR=3600000;
var mon = new Date(2026,7,10,9,0,0).getTime();
var tue = new Date(2026,7,11,9,0,0).getTime();
function L(id,pid,name,lane,parentId,parentName,start,ms,type){
  return { id:id, projectId:pid, projectName:name, lane:lane, type:type||'project',
           startTime:start, endTime:start+ms, duration:ms, parentId:parentId, parentName:parentName };
}
var logs=[
  L('a',1,'Line 4 Rebuild','Projects',null,null, mon, 2*HR),
  L('b',2,'Teardown','Projects',1,'Line 4 Rebuild', mon, 3*HR),
  L('c',3,'Reassembly','Projects',1,'Line 4 Rebuild', tue, 1*HR),
  L('d',4,'Deep Nest','Projects',2,'Teardown', tue, 30*60000),
  L('e',5,'Paperwork','Daily Activity',null,null, mon, 45*60000),
  L('f',6,'Prototype Rig','Side Projects',null,null, tue, 90*60000),
  L('g',null,'At Work',null,null,null, mon, 8*HR, 'atwork'),
  L('h',1,'Line 4 Rebuild','Projects',null,null, new Date(2026,7,3,9,0,0).getTime(), 5*HR), // last week
  L('i',1,'Line 4 Rebuild','Projects',null,null, tue, 0)  // zero-length, ignored
];
var meta={ 'Daily Activity':{label:'Daily Activities',accent:'#4A9C6B'},
           'Projects':{label:'Projects',accent:'#4B8EC8'},
           'Side Projects':{label:'Side Projects',accent:'#9B6DD6'} };
var order=['Daily Activity','Projects','Side Projects'];

var R=C.buildRollup({ logs:logs, projects:projects, disruptions:[], breaks:[],
  laneMeta:meta, laneOrder:order, range:rWeek });

eq('tracked excludes atwork, last week and zero-length', R.trackedMs/HR, 2+3+1+0.5+0.75+1.5);
eq('clocked is separate', R.clockedMs/HR, 8);
eq('active days', R.activeDays, 2);
eq('lane count', R.lanes.length, 3);
eq('lanes follow laneOrder', R.lanes.map(function(l){ return l.key; }).join(','),
   'Daily Activity,Projects,Side Projects');

var pl=R.lanes.filter(function(l){ return l.key==='Projects'; })[0];
eq('Projects lane total', pl.ms/HR, 6.5);
eq('one root project in the lane', pl.projects.length, 1);
eq('root name', pl.projects[0].name, 'Line 4 Rebuild');
eq('root total covers all descendants', pl.projects[0].ms/HR, 6.5);
eq('children listed', pl.projects[0].children.length, 3);
eq('children sorted by size', pl.projects[0].children.map(function(c){ return c.name; }).join(','),
   'Teardown,Reassembly,Deep Nest');
eq('grandchild rolls to the root, not the middle',
   pl.projects[0].children.filter(function(c){ return c.name==='Deep Nest'; })[0].ms/60000, 30);
var childSum=pl.projects[0].children.reduce(function(a,c){ return a+c.ms; },0);
eq('root own time + children == root total', (childSum + 2*HR)/HR, 6.5);
eq('lane totals sum to tracked',
   R.lanes.reduce(function(a,l){ return a+l.ms; },0), R.trackedMs);

section('rollup edge cases');
var orphan=C.buildRollup({ logs:[ L('x',99,'Ghost Task','Projects',77,'Ghost Parent', mon, HR) ],
  projects:[], laneMeta:meta, laneOrder:order, range:rWeek });
eq('deleted project still reports', orphan.trackedMs/HR, 1);
eq('deleted project keeps its logged lane', orphan.lanes[0].key, 'Projects');
eq('deleted project falls back to the log name', orphan.lanes[0].projects[0].name, 'Ghost Task');
ok('deleted project is flagged', orphan.lanes[0].projects[0].gone===true);

var laneless=C.buildRollup({ logs:[ L('y',50,'No Lane',null,null,null, mon, HR) ],
  projects:[], laneMeta:meta, laneOrder:order, range:rWeek });
eq('missing lane buckets as Unassigned', laneless.lanes[0].label, 'Unassigned');

var cyc=[{id:1,name:'A',lane:'Projects',parentId:2},{id:2,name:'B',lane:'Projects',parentId:1}];
var cycR=C.buildRollup({ logs:[ L('z',1,'A','Projects',2,'B', mon, HR) ], projects:cyc,
  laneMeta:meta, laneOrder:order, range:rWeek });
eq('a parent cycle terminates', cycR.trackedMs/HR, 1);

var boundary=C.buildRollup({ logs:[
    L('s1',5,'Paperwork','Daily Activity',null,null, rWeek.start, HR),        // first ms of the week
    L('s2',5,'Paperwork','Daily Activity',null,null, rWeek.end, HR),          // first ms of next week
    L('s3',5,'Paperwork','Daily Activity',null,null, rWeek.end-1, HR)         // last ms of the week
  ], projects:projects, laneMeta:meta, laneOrder:order, range:rWeek });
eq('half-open boundaries include start, exclude end', boundary.trackedMs/HR, 2);

var empty=C.buildRollup({ logs:[], projects:projects, laneMeta:meta, laneOrder:order, range:rWeek });
eq('empty period tracks nothing', empty.trackedMs, 0);
eq('empty period has no lanes', empty.lanes.length, 0);

var withNoise=C.buildRollup({ logs:logs, projects:projects,
  disruptions:[ {id:'d1',startTime:mon,endTime:mon+600000,duration:600000},
                {id:'d2',startTime:mon,endTime:null,duration:0},
                {id:'d3',startTime:D('2026-01-05T09:00:00'),endTime:D('2026-01-05T09:10:00'),duration:600000} ],
  breaks:[ {id:'b1',startTime:mon,endTime:mon+1800000,duration:1800000},
           {id:'b2',startTime:mon,endTime:null,duration:0} ],
  laneMeta:meta, laneOrder:order, range:rWeek });
eq('open disruptions are not counted', withNoise.distCount, 1);
eq('out-of-period disruptions are not counted', withNoise.distMs/60000, 10);
eq('open breaks are not counted', withNoise.breakCount, 1);
eq('break minutes', withNoise.breakMs/60000, 30);

section('ReportsModal renders');
// The modal anchors to the real clock, so these fixtures are dated to today -
// otherwise every period would render the empty state and prove nothing.
var t9=new Date(); t9.setHours(9,0,0,0);
var TODAY=t9.getTime();
var liveLogs=[
  L('a',1,'Line 4 Rebuild','Projects',null,null, TODAY, 2*HR),
  L('b',2,'Teardown','Projects',1,'Line 4 Rebuild', TODAY, 3*HR),
  L('c',3,'Reassembly','Projects',1,'Line 4 Rebuild', TODAY, 1*HR),
  L('d',4,'Deep Nest','Projects',2,'Teardown', TODAY, 30*60000),
  L('e',5,'Paperwork','Daily Activity',null,null, TODAY, 45*60000),
  L('f',6,'Prototype Rig','Side Projects',null,null, TODAY, 90*60000),
  L('g',null,'At Work',null,null,null, TODAY, 8*HR, 'atwork')
];
var baseProps={ logs:liveLogs, projects:projects, disruptions:[], breaks:[], laneMeta:meta,
  laneOrder:order, schedule:SCH, testMode:false, liveLogs:[], onClose:function(){} };

function flatten(node, out){
  out=out||[];
  if(node==null || node===false || node===true) return out;
  if(Array.isArray(node)){ node.forEach(function(n){ flatten(n,out); }); return out; }
  if(typeof node!=='object'){ out.push(String(node)); return out; }
  out.push(node);
  flatten(node.children, out);
  return out;
}
function textOf(tree){
  return flatten(tree).filter(function(n){ return typeof n==='string'; }).join(' | ');
}

['day','week','month','quarter','year'].forEach(function(k){
  var threw=null, tree=null;
  try{ tree=C.ReportsModal(Object.assign({}, baseProps, {initialKind:k})); }catch(e){ threw=e; }
  ok('renders '+k+' without throwing', !threw, threw && threw.message);
  if(threw) return;
  var txt=textOf(tree);
  ok('renders '+k+' shows the tracked total', txt.indexOf('8h 45m')>=0, txt.slice(0,160));
  ok('renders '+k+' lists the lanes', txt.indexOf('Projects')>=0 && txt.indexOf('Side Projects')>=0);
  ok('renders '+k+' is not the empty state', txt.indexOf('No time tracked')<0);
  ok('renders '+k+' offers all five periods',
     ['Day','Week','Month','Qtr','Year'].every(function(lbl){ return txt.indexOf(lbl)>=0; }));
});

section('nothing navigates into the future');
var wk=C.ReportsModal(Object.assign({}, baseProps, {initialKind:'week'}));
var arrows=flatten(wk).filter(function(n){ return n && n.type==='button' && n.children &&
  (n.children[0]==='\u2039' || n.children[0]==='\u203a'); });
eq('two nav arrows', arrows.length, 2);
ok('back arrow is live', arrows[0].props.disabled===false);
ok('forward arrow is disabled on the current period', arrows[1].props.disabled===true);
var threwEmpty=null;
try{ C.ReportsModal(Object.assign({}, baseProps, {logs:[], initialKind:'week'})); }
catch(e){ threwEmpty=e; }
ok('renders the empty state without throwing', !threwEmpty, threwEmpty && threwEmpty.message);

var threwNoSch=null;
try{ C.ReportsModal(Object.assign({}, baseProps, {schedule:null, initialKind:'week'})); }
catch(e){ threwNoSch=e; }
ok('renders with no schedule set', !threwNoSch, threwNoSch && threwNoSch.message);

section('report text');
// Reach the text builder through a render by stubbing the clipboard capture.
var captured=null;
C.navigator.clipboard.writeText=function(t){ captured=t; return Promise.resolve(); };
var tree=C.ReportsModal(Object.assign({}, baseProps, {initialKind:'week'}));
function walk(node, fn){
  if(!node || typeof node!=='object') return;
  if(Array.isArray(node)){ node.forEach(function(n){ walk(n,fn); }); return; }
  fn(node);
  walk(node.children, fn);
  if(node.props && node.props.children) walk(node.props.children, fn);
}
var copyBtn=null;
walk(tree, function(n){
  if(n.type==='button' && n.children && String(n.children[0]).indexOf('Copy report')>=0) copyBtn=n;
});
if(!copyBtn) console.log('     (tree text) '+textOf(tree).slice(0,200));
ok('copy button exists', !!copyBtn);
if(copyBtn){
  copyBtn.props.onClick();
  ok('report text captured', !!captured);
  ok('report names the period', captured.indexOf('Time Report')===0, captured && captured.slice(0,40));
  ok('report includes a lane heading', captured.indexOf('PROJECTS')>=0);
  ok('report indents sub-tasks', captured.indexOf('    > Teardown')>=0);
  ok('report totals tracked time', captured.indexOf('Tracked:')>=0);
  ok('report totals the schedule', captured.indexOf('Scheduled:')>=0);
}

section('tenths mode');
C.TIME_INC='tenths';
var t2=null, threwT=null;
try{ t2=C.ReportsModal(Object.assign({}, baseProps, {initialKind:'week'})); }catch(e){ threwT=e; }
ok('renders in decimal-hours mode', !threwT, threwT && threwT.message);
eq('fmtHours switches to decimals', C.fmtHours(510), '8.50h');
C.TIME_INC='standard';
eq('fmtHours returns to h/m', C.fmtHours(510), '8h 30m');

console.log('\n----------------------------------------');
console.log(pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
