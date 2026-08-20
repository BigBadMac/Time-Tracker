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

// minimal Storage-shaped fake
function fakeStorage(init){
  var st={ _m:{} };
  Object.keys(init||{}).forEach(function(k){ st._m[k]=String(init[k]); });
  Object.defineProperty(st,'length',{ get:function(){ return Object.keys(st._m).length; } });
  st.key=function(i){ return Object.keys(st._m)[i]||null; };
  st.getItem=function(k){ return st._m.hasOwnProperty(k)?st._m[k]:null; };
  st.setItem=function(k,v){ st._m[k]=String(v); };
  st.removeItem=function(k){ delete st._m[k]; };
  return st;
}

section('backupBuild');
var logs=[{id:'a',projectId:1,projectName:'Line 4',lane:'Projects',type:'project',
  startTime:1000000000000,endTime:1000003600000,duration:3600000,parentId:null,parentName:null},
  {id:'b',projectId:1,projectName:'Line 4',lane:'Projects',type:'project',
  startTime:1000090000000,endTime:1000093600000,duration:3600000,parentId:null,parentName:null}];
var st=fakeStorage({
  'tt_logs':JSON.stringify(logs),
  'tt_projects':JSON.stringify([{id:1,name:'Line 4'}]),
  'tt_settings':JSON.stringify({tracking:'timer'}),
  'tt_mod_tools_items':JSON.stringify([{id:'t1',name:'Impact driver'}]),
  'unrelated_key':'"should not export"'
});
var b=C.backupBuild(st);
eq('marker set', b.ttBackup, 1);
ok('exportedAt is ISO', /^\d{4}-\d{2}-\d{2}T/.test(b.exportedAt), b.exportedAt);
eq('captures every tt_ key incl. future module keys', Object.keys(b.data).length, 4);
ok('non-tt keys excluded', !('unrelated_key' in b.data));
eq('values pass through raw, no double-encode', b.data['tt_settings'], JSON.stringify({tracking:'timer'}));

section('backupValidate');
eq('null rejected', C.backupValidate(null), 'Not a Time Tracker backup file.');
eq('wrong marker rejected', C.backupValidate({ttBackup:2,data:{'tt_x':'1'}}), 'Not a Time Tracker backup file.');
eq('array data rejected', C.backupValidate({ttBackup:1,data:[]}), 'Not a Time Tracker backup file.');
eq('empty data rejected', C.backupValidate({ttBackup:1,data:{}}), 'Backup contains no data.');
eq('foreign key rejected', C.backupValidate({ttBackup:1,data:{'evil_key':'1'}}), 'Backup contains unexpected keys.');
eq('non-string value rejected', C.backupValidate({ttBackup:1,data:{'tt_x':5}}), 'Backup data is malformed.');
eq('non-JSON value rejected', C.backupValidate({ttBackup:1,data:{'tt_x':'not json'}}), 'Backup data is malformed.');
eq('a real backup validates clean', C.backupValidate(b), null);

section('backupSummary');
var sm=C.backupSummary(b);
eq('key count', sm.keys, 4);
eq('log count', sm.logs, 2);
eq('project count', sm.projects, 1);
ok('date range spans the logs', sm.range && sm.range.min===1000000000000 && sm.range.max===1000090000000);
var sm2=C.backupSummary({ttBackup:1,data:{'tt_settings':'{}'}});
ok('summary tolerates missing logs', sm2.logs===null && sm2.range===null && sm2.keys===1);

section('backupApply - replace-all round trip');
var target=fakeStorage({
  'tt_logs':JSON.stringify([{id:'old'}]),
  'tt_stale_key':'"about to vanish"',
  'unrelated_key':'"survives untouched"'
});
var res=C.backupApply(b, target);
ok('apply reports ok', res.ok===true && res.keys===4 && res.removed===2, res);
eq('backed-up logs landed', target.getItem('tt_logs'), JSON.stringify(logs));
eq('module key landed', target.getItem('tt_mod_tools_items'), JSON.stringify([{id:'t1',name:'Impact driver'}]));
ok('stale tt_ key removed (replace-all)', target.getItem('tt_stale_key')===null);
eq('non-tt keys untouched', target.getItem('unrelated_key'), '"survives untouched"');
var rt=C.backupBuild(target);
eq('round trip is byte-identical', JSON.stringify(rt.data), JSON.stringify(b.data));
var bad=C.backupApply({ttBackup:1,data:{'evil':'1'}}, target);
ok('invalid backup never touches storage', bad.ok===false && target.getItem('tt_logs')===JSON.stringify(logs));

section('BackupModal renders');
var bm=C.BackupModal({ onClose:function(){} });
var bn=flat(bm), bt=textOf(bn);
ok('titled Backup & Restore', bt.indexOf('Backup & Restore')>=0);
ok('warns about home-screen deletion', bt.indexOf('deletes your tracked time')>=0);
ok('export button present', bn.some(function(n){ return n.type==='button' && n.children && n.children[0]==='Export Backup'; }));
ok('restore section warns replace-all', bt.indexOf('replaces everything')>=0);
var fileIn=bn.filter(function(n){ return n.type==='input' && n.props.type==='file'; })[0];
ok('file input accepts json', !!fileIn && fileIn.props.accept.indexOf('json')>=0);
ok('file input wrapped in a tappable label', bn.some(function(n){ return n.type==='label'; }));
ok('no confirm button before a file is picked', bt.indexOf('Replace All Data')<0);

section('App wiring shipped');
var src=require('fs').readFileSync('time-tracker.jsx','utf8');
ok('menu entry present', src.indexOf('"Backup & Restore"')>=0);
ok('modal mounted', src.indexOf('React.createElement(BackupModal')>=0);
ok('closeAllPopups covers it', src.indexOf('setShowBackup(false);')>=0);
ok('restore reloads through the normalizers', src.indexOf('location.reload()')>=0);
ok('share-sheet path guarded for iOS', src.indexOf('navigator.canShare')>=0);

console.log('\n----------------------------------------');
console.log(pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
