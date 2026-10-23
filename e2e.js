// Drives the real built app in a browser. The bug this covers was invisible to
// every source-level check: the code read correctly and the board simply came
// back with nothing running.
const {chromium}=require('playwright');
const fs=require('fs');
const file=process.argv[2]||'index.html';
const ok=[]; const t=(l,p)=>ok.push([l,p]);
(async()=>{
  // The app's stylesheet link points at Google Fonts. In a sandbox with no
  // egress every page load sat waiting on it, which turned a 90-second suite
  // into a timeout. Resolve it nowhere so it fails instantly; the app's own
  // fallback fonts are what these checks measure anyway.
  const b=await chromium.launch({ args:["--host-resolver-rules=MAP fonts.googleapis.com 127.0.0.1, MAP fonts.gstatic.com 127.0.0.1"] });
  // Every launch now opens on the splash and holds it for 2.5s. A test that
  // starts tapping before then has its first tap eaten dismissing it, which is
  // correct app behaviour and useless test behaviour. So each page drops the
  // splash deterministically after loading: one tap in the corner (consumed by
  // the overlay, so it never reaches the board), then wait for it to be gone.
  // The splash's OWN test does not call this - it is what it is testing.
  const dropSplash=async(pg)=>{
    if(!(await pg.locator('[data-splash]').count())) return;
    await pg.mouse.click(4,4);
    await pg.waitForFunction(()=>!document.querySelector('[data-splash]'), null, { timeout:4000 });
  };
  fs.writeFileSync('/tmp/e2e.html', fs.readFileSync(file,'utf8'));
  // A schedule that is definitely not running now, so the shift question fires.
  const now=new Date();
  const far=(now.getHours()+6)%24;
  const hh=(n)=>String(n).padStart(2,'0')+":00";
  const DAYS=["mon","tue","wed","thu","fri","sat","sun"];
  const sched={}; DAYS.forEach(d=>{ sched[d]={on:true,start:hh(far),end:hh((far+4)%24)}; });
  const page=await b.newPage({viewport:{width:420,height:900}});
  await page.addInitScript((a)=>{
    localStorage.setItem('tt_settings', JSON.stringify({layout:'comfortable',tracking:'timer',
      colorScheme:'bright-pastels',theme:'neon-dream',schemes:{},fonts:{},mode:'dark',
      handedness:'right',headerPos:'top',workSchedule:a.sched,shiftGrace:0}));
    localStorage.setItem('tt_projects', JSON.stringify(
      [{id:1,name:"Line 4 Rebuild",lane:"Daily Activity",notes:"",order:0,parentId:null,role:"project",kind:"ongoing",stages:[]}]));
    localStorage.setItem('tt_laneorder', JSON.stringify(['Daily Activity']));
  }, {sched});
  await page.goto('file:///tmp/e2e.html',{waitUntil:'load'});
  await page.waitForTimeout(500);

  // hasText is a case-insensitive SUBSTRING match: 'Start' also matches the
  // header's "Clock In / start day". Anchor to the card and match exactly.
  const startBtn=page.locator('[data-surface="lane"] button').filter({hasText:/^Start$/}).first();
  t("the board shows a Start button", await startBtn.count()>0);
  await startBtn.click();
  await page.waitForTimeout(350);
  const asked=await page.locator('text=Which Shift?').count();
  t("tapping Start outside a shift asks which shift", asked>0);
  // nothing may be running yet
  const runningBefore=await page.locator('[data-surface="lane"] button').filter({hasText:/^Stop$/}).count();
  t("and nothing starts before the question is answered", runningBefore===0);

  // answer it
  const choice=page.locator('[data-dayask] button, button').filter({hasText:/Previous shift|This day|Upcoming shift|Next shift/}).first();
  t("the question offers an answer", await choice.count()>0);
  await choice.click();
  await page.waitForTimeout(300);
  // an off-roster answer raises the pay question; clear it if present
  if(await page.locator('text=Regular or Overtime?').count()){
    await page.locator('button').filter({hasText:/^Regular$/}).first().click();
    await page.waitForTimeout(300);
  }
  const stopped=await page.locator('[data-surface="lane"] button').filter({hasText:/^Stop$/}).count();
  t("answering starts the thing that was tapped", stopped>0);
  const clocked=await page.locator('button').filter({hasText:/Clock Out/}).count();
  t("and clocks in at the same time", clocked>0);
  await page.waitForTimeout(1200);
  const el=await page.locator('[data-surface="lane"]').first().innerText();
  // The card shows a bare seconds count under a minute, e.g. "2s".
  t("the timer is actually counting", /\b[1-9]\d*s\b/.test(el));
  await page.close();

  // ---- the outline editor ----
  // Rows are selected by their glyph and moved with a controller. Only a
  // browser shows this: the controller is a fixed overlay, the pad's keys are
  // enabled from the model, and the role rule decides what nesting means.
  const p2=await b.newPage({viewport:{width:390,height:820}});
  await p2.addInitScript(()=>{
    localStorage.setItem('tt_settings', JSON.stringify({layout:'comfortable',tracking:'timer',
      colorScheme:'bright-pastels',theme:'neon-dream',schemes:{},fonts:{},mode:'dark',
      handedness:'right',headerPos:'top'}));
    localStorage.setItem('tt_projects', JSON.stringify([
      {id:1,name:'Label Printing',lane:'Daily Activity',notes:'',order:0,parentId:null,role:'project',kind:'finite',stages:[{id:'s1',label:'Set up',done:true}]},
      {id:2,name:'Trim pass',lane:'Daily Activity',notes:'',order:0,parentId:1,role:'task',kind:'finite',stages:[]},
      {id:3,name:'Laminating',lane:'Daily Activity',notes:'',order:1,parentId:null,role:'project',kind:'ongoing',stages:[]},
      {id:4,name:'Crew Training',lane:'Projects',notes:'',order:0,parentId:null,role:'project',kind:'ongoing',stages:[]}]));
    localStorage.setItem('tt_laneorder', JSON.stringify(['Daily Activity','Projects']));
  });
  await p2.goto('file:///tmp/e2e.html',{waitUntil:'load'}); await dropSplash(p2);
  await p2.waitForTimeout(450);
  await p2.locator('button:has(path[d="M4 8H24 M4 14H24 M4 20H24"])').first().click();
  await p2.waitForTimeout(250);
  await p2.locator('button').filter({hasText:/^Edit…$/}).first().click();
  await p2.waitForTimeout(350);
  t("the outline lists the whole board in order",
    (await p2.locator('[data-outlineopen]').allInnerTexts()).join("|")
      === "FIRST LANE|Label Printing|Set up|Trim pass|Laminating|SECOND LANE|Crew Training");
  t("no controller until a row is picked", (await p2.locator('[data-controller]').count())===0);
  // A second target on the trailing edge, shaped like the controller it opens.
  t("every row carries a grip",
    (await p2.locator('[data-rowgrip]').count()) === (await p2.locator('[data-outlinekey]').count()));
  t("the grip is a thumb-sized target", await p2.evaluate(()=>{
    const r=document.querySelector('[data-rowgrip]').getBoundingClientRect();
    return Math.round(r.width)>=40 && Math.round(r.height)>=40; }));
  t("and sits outside the row box, on the trailing edge", await p2.evaluate(()=>{
    const row=document.querySelector('[data-outlinekey]');
    const grip=row && row.parentElement.querySelector('[data-rowgrip]');
    if(!row || !grip) return false;
    return grip.getBoundingClientRect().x > row.getBoundingClientRect().right - 2; }));
  // Tapping it does what tapping the row's own glyph does.
  // Guarded throughout: if the grip stops existing or stops selecting, these
  // must report failed assertions rather than throw and abandon the suite.
  const tapGrip = async (n) => (await p2.locator('[data-rowgrip]').nth(n)
    .click({timeout:3000}).then(()=>true).catch(()=>false));
  t("a grip can be tapped", await tapGrip(1));
  await p2.waitForTimeout(250);
  t("tapping a grip opens the controller", (await p2.locator('[data-controller]').count())===1);
  const ctlText = await p2.locator('[data-controller]').first().innerText().catch(()=>"");
  t("for that row", /Label Printing/.test(ctlText));
  t("and the selected row's grip grows", await p2.evaluate(()=>{
    const g=[...document.querySelectorAll('[data-rowgrip] svg')].map(s=>Number(s.getAttribute('width')));
    return g.length>2 && g[1] > g[0] && g[1] > g[2]; }));
  await tapGrip(1); await p2.waitForTimeout(250);
  t("tapping it again puts the controller away", (await p2.locator('[data-controller]').count())===0);
  // Single tap on a name opens that row's menu; two taps edit it. The same
  // pair the board uses, so the gesture means one thing wherever you are.
  await p2.locator('[data-outlineopen]').nth(0).click(); await p2.waitForTimeout(450);
  t("one tap on a lane opens its menu",
    (await p2.locator('[data-rowmenuitem]').allInnerTexts()).join("|")
      === "Edit lane|New lane|New project|Milestones");
  // The popup overlays the rows beneath it, so close it before reaching for
  // another row - a tap through it would land on a menu item.
  await p2.locator('[data-outlineopen]').nth(0).click(); await p2.waitForTimeout(350);
  t("tapping the same name closes its menu", (await p2.locator('[data-rowmenu]').count())===0);
  await p2.locator('[data-outlineopen]').nth(1).click(); await p2.waitForTimeout(450);
  t("a project offers its own entries",
    (await p2.locator('[data-rowmenuitem]').allInnerTexts()).join("|")
      === "Edit project|Add project|Add nested project|Add task|Add stages|Milestones");
  t("and only one menu is open at a time", (await p2.locator('[data-rowmenu]').count())===1);
  // It hangs off its own row and covers what is under it, rather than pushing
  // the list around.
  t("the menu sits under the row it belongs to", await p2.evaluate(()=>{
    const m=document.querySelector('[data-rowmenu]');
    const row=document.querySelectorAll('[data-outlinekey]')[1];
    if(!m||!row) return false;
    const g=m.getBoundingClientRect(), r=row.getBoundingClientRect();
    return g.y >= r.bottom - 1 && g.y - r.bottom < 12; }));
  t("and overlays the rows beneath it", await p2.evaluate(()=>{
    const m=document.querySelector('[data-rowmenu]'); const b=m.getBoundingClientRect();
    return m.contains(document.elementFromPoint(b.x+b.width/2, b.y+b.height/2)); }));
  t("with a solid fill, not glass", await p2.evaluate(()=>{
    const c=getComputedStyle(document.querySelector('[data-rowmenu]')).backgroundColor;
    const m=/rgba?\(([^)]+)\)/.exec(c); const p=m?m[1].split(',').map(Number):[0,0,0,1];
    return p.length<4 || p[3]===1; }));
  await p2.locator('[data-outlineopen]').nth(1).click(); await p2.waitForTimeout(450);
  t("tapping the same name again closes it", (await p2.locator('[data-rowmenu]').count())===0);
  await p2.locator('[data-outlineopen]').nth(1).dblclick(); await p2.waitForTimeout(600);
  t("two taps open the editor instead", (await p2.locator('[data-modal-panel]').count())===2);
  t("with no menu left behind it", (await p2.locator('[data-rowmenu]').count())===0);
  await p2.locator('[data-modal-panel]').last().locator('button')
    .filter({hasText:/^Cancel$/}).first().click(); await p2.waitForTimeout(400);
  const indents=()=>p2.evaluate(()=>[...document.querySelectorAll('[data-outlinekey]')].map(e=>e.style.marginLeft||'0px'));
  const before=await indents();
  // a lane: up/down only, and no role choice
  await p2.locator('[data-outlinepick]').nth(0).click(); await p2.waitForTimeout(250);
  t("picking a lane raises the controller", (await p2.locator('[data-controller]').count())===1);
  t("a lane cannot nest either way",
    !(await p2.locator('[data-pad="left"]').isEnabled()) && !(await p2.locator('[data-pad="right"]').isEnabled()));
  t("and is offered no role", (await p2.locator('[data-role]').count())===0);
  t("the reason is stated", /Lanes move up and down only/.test(await p2.locator('[data-controller]').innerText()));
  // a stage: never leaves its project
  await p2.locator('[data-outlinepick]').nth(2).click(); await p2.waitForTimeout(250);
  t("a stage cannot nest in or out",
    !(await p2.locator('[data-pad="left"]').isEnabled()) && !(await p2.locator('[data-pad="right"]').isEnabled()));
  // a task under a project: only "task" is on offer once it would sit under a task
  await p2.locator('[data-outlinepick]').nth(4).click(); await p2.waitForTimeout(250);
  t("a project with a project above it may nest either way",
    await p2.locator('[data-role="project"]').isEnabled() && await p2.locator('[data-role="task"]').isEnabled());
  await p2.locator('[data-role="project"]').click(); await p2.waitForTimeout(120);
  await p2.locator('[data-pad="right"]').click(); await p2.waitForTimeout(300);
  const after=await indents();
  t("nesting in indents the row", after[4] !== before[4]);
  t("and only that row", after.filter((v,i)=>v!==before[i]).length===1);
  // The controller floats over the action row by design: DONE first, then Save.
  await p2.locator('[data-ctrldone]').click(); await p2.waitForTimeout(300);
  await p2.locator('[data-modal-panel]').last().locator('button')
    .filter({hasText:/^Save$/}).first().click({timeout:5000});
  await p2.waitForTimeout(400);
  const stored=JSON.parse(await p2.evaluate(()=>localStorage.getItem('tt_projects')));
  const lam=stored.find(x=>x.id===3);
  t("the nested row saved with its new parent", lam && lam.parentId===1);
  t("and the role that was chosen", lam && lam.role==='project');
  t("staying in its lane", lam && lam.lane==='Daily Activity');
  // ---- editing a row's details returns to the outline, not the board ----
  // The outline stays mounted underneath, so an arrangement made but not yet
  // saved is still there afterwards. Closing and reopening the sheet would
  // have thrown it away.
  const p3=await b.newPage({viewport:{width:390,height:860}});
  await p3.addInitScript(()=>{
    localStorage.setItem('tt_settings', JSON.stringify({layout:'comfortable',tracking:'timer',
      colorScheme:'bright-pastels',theme:'neon-dream',schemes:{},fonts:{},mode:'dark',
      handedness:'right',headerPos:'top'}));
    localStorage.setItem('tt_projects', JSON.stringify([
      {id:1,name:'Label Printing',lane:'Daily Activity',notes:'',order:0,parentId:null,role:'project',kind:'finite',stages:[]},
      {id:2,name:'Trim pass',lane:'Daily Activity',notes:'',order:0,parentId:1,role:'task',kind:'finite',stages:[]},
      {id:3,name:'Laminating',lane:'Daily Activity',notes:'',order:1,parentId:null,role:'project',kind:'ongoing',stages:[]}]));
    localStorage.setItem('tt_laneorder', JSON.stringify(['Daily Activity']));
  });
  await p3.goto('file:///tmp/e2e.html',{waitUntil:'load'}); await dropSplash(p3);
  await p3.waitForTimeout(450);
  await p3.locator('button:has(path[d="M4 8H24 M4 14H24 M4 20H24"])').first().click();
  await p3.waitForTimeout(250);
  await p3.locator('button').filter({hasText:/^Edit…$/}).first().click();
  await p3.waitForTimeout(350);
  const ind3=()=>p3.evaluate(()=>[...document.querySelectorAll('[data-outlinekey]')].map(e=>e.style.marginLeft||'0px'));
  const flat=await ind3();
  // an arrangement that has NOT been saved
  await p3.locator('[data-outlinepick]').nth(3).click(); await p3.waitForTimeout(200);
  await p3.locator('[data-pad="right"]').click(); await p3.waitForTimeout(300);
  const nested=await ind3();
  t("a row was nested but not saved", nested[3] !== flat[3]);
  // open that row's own editor
  // Two taps to edit - one opens the row's menu now.
  await p3.locator('[data-outlineopen]').nth(3).dblclick(); await p3.waitForTimeout(500);
  // Two sheets are stacked now, so count panels rather than look for a label.
  t("its editor opens", (await p3.locator('[data-modal-panel]').count())===2);
  // Details only. Lane, Nested under and Nested as are the outline's job -
  // it is holding an unsaved arrangement of exactly those - so the panel
  // must not offer a second, conflicting way to set them.
  const fields=await p3.evaluate(()=>[...document.querySelectorAll('label')].map(e=>e.textContent));
  // Ends only appears on a finite project, so assert the property rather than
  // a fixed list: the details are there, the placement controls are not.
  ["Name","Type","Starts","Notes"].forEach((f)=>
    t("the panel shows " + f, fields.indexOf(f)>=0));
  ["Lane","Nested under (optional)","Nested as"].forEach((f)=>
    t("and not " + f, fields.indexOf(f)<0));
  t("the outline is still mounted underneath", (await p3.locator('[data-outlinekey]').count())>0);
  t("and the controller stands down so it cannot float over the editor",
    (await p3.locator('[data-controller]').count())===0);
  await p3.locator('input[placeholder$="Name"]').first().fill('Laminating II');
  await p3.waitForTimeout(120);
  // Every sheet's primary reads "Save" now, so match within the topmost panel
  // rather than by label alone - the outline's own Save is behind the scrim.
  await p3.locator('[data-modal-panel]').last().locator('button')
    .filter({hasText:/^Save$/}).first().click();
  await p3.waitForTimeout(450);
  t("closing the editor lands back in the outline, not on the board",
    (await p3.locator('[data-outlinekey]').count())>0
    && (await p3.locator('[data-modal-panel]').count())===1);
  t("the rename shows through",
    (await p3.locator('[data-outlineopen]').allInnerTexts()).join("|")
      === "FIRST LANE|Label Printing|Trim pass|Laminating II");
  t("and the unsaved arrangement survived it", (await ind3())[3] === nested[3]);
  // Guarded: if the outline closed behind the editor, Save Layout is not on
  // screen. That must report a failed assertion, not throw and abandon the
  // rest of the suite.
  const savedLayout = await p3.locator('[data-modal-panel]').last().locator('button')
    .filter({hasText:/^Save$/}).first()
    .click({timeout:3000}).then(()=>true).catch(()=>false);
  t("the outline's own Save is still reachable", savedLayout);
  await p3.waitForTimeout(400);
  const st3=JSON.parse(await p3.evaluate(()=>localStorage.getItem('tt_projects')));
  const lam3=st3.find(x=>x.id===3);
  t("both the move and the rename reach the board", !!lam3 && lam3.parentId===1 && lam3.name==='Laminating II');
  // ---- a lane is edited in its own form, and deleting one asks ----
  const p5=await b.newPage({viewport:{width:390,height:900}});
  await p5.addInitScript(()=>{
    localStorage.setItem('tt_settings', JSON.stringify({layout:'comfortable',tracking:'timer',
      colorScheme:'bright-pastels',theme:'neon-dream',schemes:{},fonts:{},mode:'dark',
      handedness:'right',headerPos:'top'}));
    localStorage.setItem('tt_projects', JSON.stringify([
      {id:1,name:'Label Printing',lane:'Daily Activity',notes:'',order:0,parentId:null,role:'project',kind:'finite',stages:[]},
      {id:4,name:'Crew Training',lane:'Projects',notes:'',order:0,parentId:null,role:'project',kind:'ongoing',stages:[]}]));
    localStorage.setItem('tt_laneorder', JSON.stringify(['Daily Activity','Projects']));
  });
  await p5.goto('file:///tmp/e2e.html',{waitUntil:'load'}); await dropSplash(p5);
  await p5.waitForTimeout(450);
  await p5.locator('button:has(path[d="M4 8H24 M4 14H24 M4 20H24"])').first().click();
  await p5.waitForTimeout(250);
  await p5.locator('button').filter({hasText:/^Edit…$/}).first().click();
  await p5.waitForTimeout(300);
  await p5.locator('[data-outlineopen]').nth(0).dblclick(); await p5.waitForTimeout(500);
  t("a lane row opens the lane's own editor", /Edit Lane/.test(await p5.locator('body').innerText()));
  t("with the full swatch grid", (await p5.locator('[data-lanecolor]').count())===8);
  // Delete must sit at the opposite end of the row from Save.
  const order5=await p5.evaluate(()=>{
    const row=document.querySelector('[data-lanesave]').parentElement;
    return [...row.children].map(e=>({t:e.textContent,x:e.getBoundingClientRect().x}))
      .sort((a,b)=>a.x-b.x).map(e=>e.t);
  });
  t("Delete is the far corner from Save", order5[0]==="Delete" && order5[order5.length-1]==="Save");
  t("with Cancel between them", order5[1]==="Cancel");
  // Rename and recolour round-trip.
  await p5.locator('[data-lanename]').fill('Shop Floor'); await p5.waitForTimeout(120);
  const prev=await p5.locator('[data-lanepreview]').innerText();
  t("the preview follows the name as it is typed", /SHOP FLOOR/.test(prev));
  await p5.locator('[data-lanecolor]').nth(1).click(); await p5.waitForTimeout(120);
  await p5.locator('[data-lanesave]').click(); await p5.waitForTimeout(400);
  const rows5=await p5.locator('[data-outlineopen]').allInnerTexts();
  t("the rename lands back in the outline", rows5[0]==="SHOP FLOOR");
  // Deleting asks, and offers the projects somewhere to go.
  await p5.locator('[data-outlineopen]').nth(0).dblclick(); await p5.waitForTimeout(450);
  // Delete is held, not tapped, now.
  { const lb=await p5.locator('[data-lanedelete]').boundingBox();
    await p5.mouse.move(lb.x+lb.width/2, lb.y+lb.height/2); await p5.mouse.down(); await p5.waitForTimeout(1700); await p5.mouse.up(); await p5.waitForTimeout(400); }
  const dtxt=await p5.locator('body').innerText();
  t("deleting a lane asks first", /Delete Lane/.test(dtxt));
  t("and says what is inside it", /holds 1 project/.test(dtxt));
  t("offering to move them to another lane", (await p5.locator('[data-movelane]').count())>0);
  t("or to delete them with it, said plainly",
    /Delete the lane and its 1 project/.test(dtxt));
  await p5.close();

  await p3.close();

  // ---- the tutorial is a sandbox ----
  // Lanes used to be shared between the two modes, so renaming one while
  // learning renamed it on the real board. Every collection is per-mode now.
  const p6=await b.newPage({viewport:{width:390,height:760}});
  await p6.goto('file:///tmp/e2e.html',{waitUntil:'load'}); await dropSplash(p6);
  await p6.waitForTimeout(650);
  const lanes6=()=>p6.evaluate(()=>[...document.querySelectorAll('[data-lanecount]')]
    .map(e=>e.parentElement.innerText.split("\n")[0]));
  const menu6=async()=>{ await p6.locator('button:has(path[d="M4 8H24 M4 14H24 M4 20H24"])').first().click();
                         await p6.waitForTimeout(280); };
  t("a fresh board ships two lanes, named after what they are",
    (await lanes6()).join("|")==="FIRST LANE|SECOND LANE");
  await menu6();
  await p6.locator('[data-menugroup="manual"]').click(); await p6.waitForTimeout(350);
  await p6.locator('[data-groupitem]').filter({hasText:/^Practice Board$/}).click();
  await p6.waitForTimeout(650);
  t("the tutorial has its own lanes", (await lanes6()).join("|")==="DAILY ROUTINE|CURRENT JOBS|WHEN TIME ALLOWS");
  t("and its own history, so nothing is blank",
    (await p6.evaluate(()=>JSON.parse(localStorage.getItem('tt_test_logs')||'[]').length))>0);
  t("with disruption badges on the board",
    (await p6.locator('[aria-label^="Disruptions:"]').count())>0);
  // Rename a lane inside the tutorial.
  await menu6();
  await p6.locator('button').filter({hasText:/^Edit…$/}).first().click(); await p6.waitForTimeout(450);
  await p6.locator('[data-outlineopen]').nth(0).dblclick(); await p6.waitForTimeout(500);
  await p6.locator('[data-lanename]').fill('RENAMED IN TUTORIAL'); await p6.waitForTimeout(150);
  await p6.locator('[data-lanesave]').click(); await p6.waitForTimeout(400);
  await p6.locator('[data-modal-panel]').last().locator('button')
    .filter({hasText:/^Save$/}).first().click(); await p6.waitForTimeout(450);
  t("the rename lands in the tutorial", (await lanes6())[0]==="RENAMED IN TUTORIAL");
  await p6.locator('[data-tutorialexit]').click(); await p6.waitForTimeout(400);
  await p6.locator('[data-confirmexit]').click(); await p6.waitForTimeout(700);
  t("and the real board is untouched", (await lanes6()).join("|")==="FIRST LANE|SECOND LANE");
  t("with nothing leaked into its store", await p6.evaluate(()=>
    !/RENAMED/.test(localStorage.getItem('tt_lanemeta')||"")));
  // Leaving KEEPS the tutorial as you left it - it is somewhere to come back
  // to and carry on, not a demo that wipes itself. (Resetting is its own held
  // control in the exit sheet, covered later in this file.)
  await menu6();
  await p6.locator('[data-menugroup="manual"]').click(); await p6.waitForTimeout(350);
  await p6.locator('[data-groupitem]').filter({hasText:/^Practice Board$/}).click();
  await p6.waitForTimeout(700);
  t("the tutorial comes back as it was left, not reset",
    (await lanes6()).join("|").indexOf("RENAMED")>=0);
  await p6.close();

  // ---- adding from the outline changes the row count, and must not crash ----
  // useTaps inside rows.map() was a hook in a loop: fine until the number of
  // rows changed, then React #310 took the whole app down. Every add in the
  // app looked broken. This adds through every route and watches the count.
  const p7=await b.newPage({viewport:{width:390,height:820}});
  let errs7=0; p7.on('pageerror',()=>{ errs7++; });
  await p7.goto('file:///tmp/e2e.html',{waitUntil:'load'}); await dropSplash(p7); await p7.waitForTimeout(650);
  const top7=()=>p7.locator('[data-modal-panel]').last();
  const rows7=()=>p7.locator('[data-outlineopen]').count();
  const crashed7=async()=>(await p7.locator('[data-crash]').count())>0;
  await p7.locator('button:has(path[d="M4 8H24 M4 14H24 M4 20H24"])').first().click(); await p7.waitForTimeout(280);
  await p7.locator('button').filter({hasText:/^Edit…$/}).first().click(); await p7.waitForTimeout(450);
  const n7=await rows7();
  const addVia=async(rowText, item, name, saveRe)=>{
    const list=await p7.locator('[data-outlineopen]').allInnerTexts();
    await p7.locator('[data-outlineopen]').nth(list.indexOf(rowText)).click(); await p7.waitForTimeout(400);
    await p7.locator('[data-rowmenuitem]').filter({hasText:item}).click(); await p7.waitForTimeout(500);
    await top7().locator('input').first().fill(name);
    await top7().locator('button').filter({hasText:saveRe}).first().click(); await p7.waitForTimeout(600);
  };
  await addVia("FIRST LANE", /^New project$/, "Added A", /^Add Project$/);
  t("adding a project from a lane row does not crash", !(await crashed7()) && (await rows7())===n7+1);
  await addVia("Second Task", /^Add nested task$/, "Task under a task", /^Add Task$/);
  t("adding a task under a task does not crash", !(await crashed7()) && (await rows7())===n7+2);
  await addVia("Second Project", /^Add nested project$/, "Nested Proj", /^Add /);
  t("adding a nested project does not crash", !(await crashed7()) && (await rows7())===n7+3);
  await addVia("FIRST LANE", /^New lane$/, "Lane From Outline", /^Create Lane$/);
  // A sibling sits beside its record - same parent - not inside it.
  await addVia("Task under a task", /^Add task$/, "Sibling task", /^Add Task$/);
  const sib=await p7.evaluate(()=>{ const P=JSON.parse(localStorage.getItem('tt_projects')||'[]');
    const a=P.find(x=>x.name==='Task under a task'), b=P.find(x=>x.name==='Sibling task'); return a&&b&&a.parentId===b.parentId&&b.role==='task'; });
  t("Add task on a task adds a sibling beside it, not inside it", sib);
  t("adding a lane from the outline does not crash", !(await crashed7()) && (await rows7())===n7+5);
  t("and no error reached the page at all", errs7===0);
  const st7=await p7.evaluate(()=>JSON.parse(localStorage.getItem('tt_projects')||'[]').map(x=>x.name));
  t("every add was actually stored", ["Added A","Task under a task","Nested Proj"].every(n=>st7.includes(n)));
  // Save is reachable from the top of a list that scrolls, and clear of the
  // controller when that is up.
  // Resetting scrollTop fires a scroll event, and a tap during the app's
  // scrolling window is dropped - let it settle before the grip is tapped.
  await p7.evaluate(()=>{ document.querySelector('[data-modal-panel]').scrollTop=0; }); await p7.waitForTimeout(700);
  const g7=async()=>p7.evaluate(()=>{
    const panel=document.querySelector('[data-modal-panel]');
    // The outline's buttons ride in the Modal's sticky box now.
    const save=[...panel.querySelectorAll('[data-surface="menu"] button')].find(b=>b.textContent==='Save');
    const sr=save.getBoundingClientRect(); const hit=document.elementFromPoint(sr.x+sr.width/2, sr.y+sr.height/2);
    const ctl=document.querySelector('[data-controller]');
    return { scrollable: panel.scrollHeight>panel.clientHeight, top: panel.scrollTop===0,
             visible: sr.y>=0 && sr.bottom<=window.innerHeight, clickable: save.contains(hit),
             clear: !ctl || sr.bottom <= ctl.getBoundingClientRect().y }; });
  const s1=await g7();
  t("the list is long enough to scroll", s1.scrollable && s1.top);
  t("and Save is visible and clickable without scrolling", s1.visible && s1.clickable);
  // With the controller up it floats over the action row; DONE puts it away
  // and Save is there underneath, exactly where it was.
  // Tapped at coordinates: a pre-click scroll is read as scrolling.
  { const gb=await p7.locator('[data-rowgrip]').nth(1).boundingBox();
    await p7.mouse.click(gb.x+gb.width/2, gb.y+gb.height/2); await p7.waitForTimeout(500); }
  const s2=await g7();
  // With the header at the top the sticky box is at the top too, clear of
  // the controller at the foot - so Save stays reachable while a row is
  // selected. (With the header at the bottom the controller covers it, and
  // DONE puts the controller away first.)
  t("with the controller up and the header at the top, Save is still reachable", s2.visible && s2.clickable);
  const doneBtn=p7.locator('[data-ctrldone]');
  t("DONE is a real bordered button", await doneBtn.evaluate(b=>parseFloat(getComputedStyle(b).borderTopWidth)>=1));
  await doneBtn.click(); await p7.waitForTimeout(350);
  const s3=await g7();
  t("DONE puts the controller away", (await p7.locator('[data-controller]').count())===0);
  t("and Save is clickable again, without scrolling", s3.visible && s3.clickable && s3.top);
  await p7.close();

  // ---- the board's popups are the outline's, from one builder ----
  const p8=await b.newPage({viewport:{width:390,height:900}});
  let errs8=0; p8.on('pageerror',()=>{ errs8++; });
  await p8.addInitScript(()=>{ localStorage.setItem('tt_testmode','true'); });
  await p8.goto('file:///tmp/e2e.html',{waitUntil:'load'}); await dropSplash(p8); await p8.waitForTimeout(650);
  const items8=()=>p8.locator('[data-rowmenuitem]').allInnerTexts();
  const esc8=async()=>{ await p8.mouse.click(5,5); await p8.waitForTimeout(250); };
  await p8.locator('text=DAILY ROUTINE').first().click(); await p8.waitForTimeout(450);
  t("a lane header on the board offers the outline's lane menu",
    (await items8()).join("|")==="Edit lane|New lane|New project|Milestones");
  await esc8();
  // Opening a card popup auto-scrolls it into view (smooth); a tap during
  // that scroll is read as scrolling and dropped. Let it settle.
  await p8.locator('span:text-is("Install new workbench")').first().click({force:true}); await p8.waitForTimeout(1200);
  t("a project card offers the outline's project menu",
    (await items8()).join("|")==="Edit project|Add project|Add nested project|Add task|Add stages|Milestones");
  t("with Close Out still there below it, as a board action",
    (await p8.locator('[data-surface="menu"] button').filter({hasText:/^Close Out/}).count())===1);
  // Tapped at coordinates: Playwright's pre-click scroll trips close-on-scroll.
  { const bb=await p8.locator('[data-rowmenuitem="Add nested project"]').boundingBox();
    await p8.mouse.click(bb.x+bb.width/2, bb.y+bb.height/2); await p8.waitForTimeout(500); }
  await p8.locator('[data-modal-panel]').last().locator('input').first().fill('Board Nested');
  await p8.locator('[data-modal-panel]').last().locator('button').filter({hasText:/^Add /}).first().click(); await p8.waitForTimeout(600);
  const rec8=await p8.evaluate(()=>JSON.parse(localStorage.getItem('tt_test_projects')).find(x=>x.name==='Board Nested'));
  t("a nested project from the board saves as a project under its parent", !!rec8 && rec8.parentId===103 && rec8.role==='project');
  await p8.locator('span:text-is("Install new workbench")').first().dblclick({force:true}); await p8.waitForTimeout(500);
  t("double-tapping a card opens its editor", /Edit Project/.test((await p8.locator('[data-modal-panel]').last().innerText()).split("\n")[0]));
  t("with no page errors", errs8===0);
  await p8.close();

  // ---- milestones: editor, step sheet, lane view ----
  // Popup rows near the foot of the viewport must be tapped at coordinates:
  // Playwright's pre-click scroll trips the app's close-menus-on-scroll.
  const p9=await b.newPage({viewport:{width:390,height:900}});
  let errs9=0; p9.on('pageerror',()=>{ errs9++; });
  await p9.addInitScript(()=>{ localStorage.setItem('tt_testmode','true'); });
  await p9.goto('file:///tmp/e2e.html',{waitUntil:'load'}); await dropSplash(p9); await p9.waitForTimeout(650);
  const top9=()=>p9.locator('[data-modal-panel]').last();
  const tap9=async(sel)=>{ const bb=await p9.locator(sel).first().boundingBox(); await p9.mouse.click(bb.x+bb.width/2, bb.y+bb.height/2); await p9.waitForTimeout(500); };
  await p9.locator('span:text-is("Install new workbench")').first().click({force:true}); await p9.waitForTimeout(1200);
  t("a project's menu offers Milestones", (await p9.locator('[data-rowmenuitem="Milestones"]').count())===1);
  await tap9('[data-rowmenuitem="Milestones"]');
  t("which opens the project's editor", /Milestones/.test((await top9().innerText()).split("\n")[0]));
  // The tutorial's workbench ships with a tracker, so these are relative.
  const base9=await p9.locator('[data-msstep]').count();
  await p9.locator('[data-msadd]').click(); await p9.waitForTimeout(300);
  t("the step sheet offers the records beneath the project as targets", (await p9.locator('[data-mstarget]').count())===2);
  await p9.locator('[data-mslabel]').fill('Frame up'); await p9.locator('[data-msdate]').fill('2026-09-25'); await p9.locator('[data-mstime]').fill('17:00');
  await p9.locator('[data-mstarget]').first().click(); await p9.locator('[data-msnote]').fill('Needs the bay clear first');
  await p9.locator('[data-mssave]').click(); await p9.waitForTimeout(300);
  await p9.locator('[data-msadd]').click(); await p9.waitForTimeout(250);
  await p9.locator('[data-mslabel]').fill('Sign-off'); await p9.locator('[data-msdate]').fill('2026-09-14'); await p9.locator('[data-mstime]').fill('12:00');
  await p9.locator('[data-mssave]').click(); await p9.waitForTimeout(300);
  t("steps appear as rows with the line drawn above them",
    (await p9.locator('[data-msstep]').count())===base9+2 && (await p9.locator('[data-modal-panel] [data-msline]').count())===1);
  t("rows follow the line's order, earliest first", await p9.evaluate(()=>{
    const rows=[...document.querySelectorAll('[data-msstep]')].map(r=>r.innerText);
    const i=rows.findIndex(r=>r.indexOf('Sign-off')===0), j=rows.findIndex(r=>r.indexOf('Frame up')===0);
    return i>=0 && j>=0 && i<j;   // Sign-off (Sep 14) before Frame up (Sep 25)
  }));
  t("a step's note shows in its row", /Needs the bay clear first/.test(await top9().innerText()));
  // Hold the mark to set WHEN it was met: a tap would record now and turn an
  // on-time step amber.
  // .last(): the tutorial's own baseline now has a Sign-off step too.
  await p9.locator('[data-msstep]').filter({hasText:/Sign-off/}).last().click(); await p9.waitForTimeout(400);
  const mk9=await p9.locator('[data-msmarkmet]').boundingBox(); const cx9=mk9.x+mk9.width/2, cy9=mk9.y+mk9.height/2;
  await p9.mouse.move(cx9,cy9); await p9.mouse.down(); await p9.waitForTimeout(700); await p9.mouse.up(); await p9.waitForTimeout(400);
  t("holding the mark opens the when-sheet", /When was it met/.test((await top9().innerText()).split("\n")[0]));
  await p9.locator('[data-mswhendate]').fill('2026-09-13'); await p9.locator('[data-mswhentime]').fill('16:30');
  await p9.locator('[data-mswhensave]').click(); await p9.waitForTimeout(300);
  await p9.locator('[data-mssave]').click(); await p9.waitForTimeout(400);
  t("a step marked at a time before its target reads as met early",
    /Sign-off[\s\S]*met, .* early/.test(await top9().innerText()));
  await p9.locator('[data-mssaveall]').click(); await p9.waitForTimeout(500);
  const ms9=await p9.evaluate(()=>JSON.parse(localStorage.getItem('tt_test_projects')).find(x=>x.id===103).milestones);
  t("Save writes the steps to the project", ms9 && ms9.length===base9+2);
  t("with target, note and due time intact",
    ms9.some(m=>m.label==='Frame up' && m.targets.length===1 && m.note==='Needs the bay clear first' && new Date(m.dueAt).getHours()===17));
  // the lane view
  await p9.locator('text=CURRENT JOBS').first().click(); await p9.waitForTimeout(1200);
  await tap9('[data-rowmenuitem="Milestones"]');
  t("a lane's menu opens the lane view", /Milestones/.test((await top9().innerText()).split("\n")[0]));
  t("which lists the lane's projects", (await p9.locator('[data-mslaneproj]').count())===2);
  // Scoped to the sheet: the board behind it now has strips of its own.
  t("and draws the roll-up line", (await p9.locator('[data-modal-panel] [data-msline]').count())===1);
  await p9.locator('[data-mslaneproj]').first().click(); await p9.waitForTimeout(500);
  t("tapping a project row opens that project's editor", /Install new workbench/.test((await top9().innerText()).split("\n")[0]));
  t("with no page errors", errs9===0);
  await p9.close();

  // ---- milestone strips: card, lane, board, outline - and the tap chain ----
  const p10=await b.newPage({viewport:{width:390,height:900}});
  let errs10=0; p10.on('pageerror',()=>{ errs10++; });
  const D10=86400000, now10=Date.now();
  await p10.addInitScript(({D,now})=>{
    localStorage.setItem('tt_settings', JSON.stringify({layout:'comfortable',tracking:'timer',colorScheme:'bright-pastels',theme:'neon-dream',schemes:{},fonts:{},mode:'dark',handedness:'right',headerPos:'top'}));
    localStorage.setItem('tt_projects', JSON.stringify([
      {id:1,name:'Install new workbench',lane:'Daily Activity',notes:'',order:0,parentId:null,role:'project',kind:'finite',stages:[],
        milestones:[{id:'m1',label:'Measure',dueAt:now-6*D,targets:[{kind:'project',id:2}],doneAt:null,note:''},
                    {id:'m3',label:'Fit',dueAt:now+8*D,targets:[],doneAt:null,note:''}]},
      // the target is CLOSED - and closed records are filtered off the board
      {id:2,name:'Measure up',lane:'Daily Activity',notes:'',order:0,parentId:1,role:'task',kind:'finite',stages:[],closedAt:now-7*D},
      {id:3,name:'Weekly inspection',lane:'Daily Activity',notes:'',order:1,parentId:null,role:'project',kind:'ongoing',stages:[]}]));
    localStorage.setItem('tt_laneorder', JSON.stringify(['Daily Activity','Projects']));
  },{D:D10,now:now10});
  await p10.goto('file:///tmp/e2e.html',{waitUntil:'load'}); await dropSplash(p10); await p10.waitForTimeout(700);
  const kinds=await p10.evaluate(()=>[...document.querySelectorAll('[data-msstrip]')].map(e=>e.getAttribute('data-msstrip')));
  t("a project with steps gets a strip, a lane with such a project gets one, and so does the board",
    kinds.join("|")==="board|lane|project");
  t("a project without steps gets none, and so does an empty lane", kinds.filter(k=>k==='project').length===1 && kinds.filter(k=>k==='lane').length===1);
  // The met step's target is a CLOSED record. If the strip read only open
  // records it would never see the close and would draw the step as missed.
  const metColor=await p10.evaluate(()=>{ const g=document.querySelector('[data-msstrip="project"] [data-msmark="m1"] path'); return g && g.getAttribute('stroke'); });
  const tokens10=await p10.evaluate(()=>({met:getComputedStyle(document.body).getPropertyValue('--x')}));
  t("a step whose closed-out target sits off the board still reads as met",
    metColor && metColor.toUpperCase()==='#4A9C6B');
  await p10.locator('[data-msstrip="board"]').click(); await p10.waitForTimeout(500);
  t("the board strip opens the board view", /Milestones .* Board/.test((await p10.locator('[data-modal-panel]').last().innerText()).split("\n")[0]));
  await p10.locator('[data-msboardlane]').first().click(); await p10.waitForTimeout(500);
  t("a lane row opens the lane view", /Milestones .* First Lane/.test((await p10.locator('[data-modal-panel]').last().innerText()).split("\n")[0]));
  await p10.locator('[data-mslaneproj]').first().click(); await p10.waitForTimeout(500);
  t("a project row opens its editor", /Install new workbench/.test((await p10.locator('[data-modal-panel]').last().innerText()).split("\n")[0]));
  for(let i=0;i<3;i++){ await p10.locator('[data-modal-panel]').last().locator('button').filter({hasText:/^(Cancel|Done)$/}).first().click(); await p10.waitForTimeout(250); }
  await p10.locator('button:has(path[d="M4 8H24 M4 14H24 M4 20H24"])').first().click(); await p10.waitForTimeout(280);
  await p10.locator('button').filter({hasText:/^Edit…$/}).first().click(); await p10.waitForTimeout(500);
  const okinds=await p10.evaluate(()=>[...document.querySelectorAll('[data-modal-panel] [data-msstrip]')].map(e=>e.getAttribute('data-msstrip')));
  t("the outline shows strips under the lane and the project rows", okinds.join("|")==="lane|project");
  t("with no page errors", errs10===0);
  await p10.close();

  // ---- Delete is held, not tapped ----
  // A couple of seconds of fill before the confirmation opens; a tap does
  // nothing; releasing early snaps the fill back with nothing opened.
  const p11=await b.newPage({viewport:{width:390,height:900}});
  let errs11=0; p11.on('pageerror',()=>{ errs11++; });
  await p11.addInitScript(()=>{ localStorage.setItem('tt_testmode','true'); });
  await p11.goto('file:///tmp/e2e.html',{waitUntil:'load'}); await dropSplash(p11); await p11.waitForTimeout(650);
  await p11.locator('span:text-is("Install new workbench")').first().dblclick({force:true}); await p11.waitForTimeout(600);
  const del11=p11.locator('[data-holddelete]').first(); await del11.scrollIntoViewIfNeeded(); await p11.waitForTimeout(300);
  const bd=await del11.boundingBox(); const dx=bd.x+bd.width/2, dy=bd.y+bd.height/2;
  const fillPct=()=>p11.evaluate(()=>{ const f=document.querySelector('[data-holddelete] [data-holdfill]'); if(!f) return -1;
    return Math.round(100*f.getBoundingClientRect().width/f.parentElement.getBoundingClientRect().width); });
  await p11.mouse.move(dx,dy); await p11.mouse.down(); await p11.waitForTimeout(120); await p11.mouse.up(); await p11.waitForTimeout(400);
  t("a tap on Delete opens nothing", /Edit Project/.test((await p11.locator('[data-modal-panel]').last().innerText()).split("\n")[0]));
  await p11.mouse.move(dx,dy); await p11.mouse.down(); await p11.waitForTimeout(600);
  const mid11=await fillPct();
  t("the fill charges while held", mid11>20 && mid11<70);
  await p11.mouse.up(); await p11.waitForTimeout(300);
  t("releasing early snaps it back", (await fillPct())===0);
  t("with nothing opened", /Edit Project/.test((await p11.locator('[data-modal-panel]').last().innerText()).split("\n")[0]));
  await p11.mouse.move(dx,dy); await p11.mouse.down(); await p11.waitForTimeout(1700); await p11.mouse.up(); await p11.waitForTimeout(500);
  t("a full hold opens the delete confirmation", /Delete Project/.test((await p11.locator('[data-modal-panel]').last().innerText()).split("\n")[0]));
  t("with no page errors", errs11===0);
  await p11.close();

  // ---- Complete: held, the closure sheet, the offer, and a step going green ----
  const p12=await b.newPage({viewport:{width:390,height:900}});
  let errs12=0; p12.on('pageerror',()=>{ errs12++; });
  const D12=86400000, now12=Date.now();
  await p12.addInitScript(({D,now})=>{
    localStorage.setItem('tt_settings', JSON.stringify({layout:'comfortable',tracking:'timer',colorScheme:'bright-pastels',theme:'neon-dream',schemes:{},fonts:{},mode:'dark',handedness:'right',headerPos:'top'}));
    localStorage.setItem('tt_projects', JSON.stringify([
      {id:1,name:'Install new workbench',lane:'Daily Activity',notes:'',order:0,parentId:null,role:'project',kind:'finite',stages:[],
        milestones:[{id:'m1',label:'Measure',dueAt:now+2*D,targets:[{kind:'project',id:2}],doneAt:null,note:''}]},
      {id:2,name:'Measure up',lane:'Daily Activity',notes:'',order:0,parentId:1,role:'task',kind:'finite',stages:[]},
      {id:3,name:'Wire',lane:'Daily Activity',notes:'',order:1,parentId:1,role:'task',kind:'finite',stages:[]},
      {id:4,name:'Staged job',lane:'Daily Activity',notes:'',order:1,parentId:null,role:'project',kind:'finite',
        stages:[{id:'s1',label:'A',done:true,doneAt:now-D,note:''},{id:'s2',label:'B',done:false,doneAt:null,note:''}]}]));
    localStorage.setItem('tt_laneorder', JSON.stringify(['Daily Activity']));
  },{D:D12,now:now12});
  await p12.goto('file:///tmp/e2e.html',{waitUntil:'load'}); await dropSplash(p12); await p12.waitForTimeout(700);
  const top12=()=>p12.locator('[data-modal-panel]').last();
  const hold12=async(sel)=>{ const el=p12.locator(sel); await el.scrollIntoViewIfNeeded(); await p12.waitForTimeout(300); const bb=await el.boundingBox();
    await p12.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2); await p12.mouse.down(); await p12.waitForTimeout(1700); await p12.mouse.up(); await p12.waitForTimeout(500); };
  const stroke12=()=>p12.evaluate(()=>{ const g=document.querySelector('[data-msstrip="project"] [data-msmark="m1"] path'); return g&&g.getAttribute('stroke').toUpperCase(); });
  await p12.locator('span:text-is("Install new workbench")').first().click({force:true}); await p12.waitForTimeout(1200);
  { const ex=p12.locator('[data-surface="menu"] button').filter({hasText:/Expand/}); if(await ex.count()){ const eb=await ex.boundingBox(); await p12.mouse.click(eb.x+eb.width/2,eb.y+eb.height/2); await p12.waitForTimeout(500); } else { await p12.mouse.click(5,5); await p12.waitForTimeout(300); } }
  t("a record with no stages gets a Complete control where the gauge would be; a staged one does not",
    (await p12.locator('[data-complete]').count())===3 && (await p12.locator('[data-complete="4"]').count())===0);
  const before12=await stroke12();
  await hold12('[data-complete="2"]');
  t("holding Complete on a task opens the closure sheet", /Complete .* Measure up/.test((await top12().innerText()).split("\n")[0]));
  await p12.locator('[data-closenote]').fill('Measured and marked out'); await p12.locator('[data-closeconfirm]').click(); await p12.waitForTimeout(600);
  const rec12=await p12.evaluate(()=>JSON.parse(localStorage.getItem('tt_projects')).find(x=>x.id===2));
  t("completing stamps when, outcome and the note", !!rec12.closedAt && rec12.closedOutcome==='done' && rec12.closedNote==='Measured and marked out');
  t("and the milestone step that expected it turns green on the board", before12==='#6A6A8A' && (await stroke12())==='#4A9C6B');
  await hold12('[data-complete="1"]');
  t("completing a parent with an open child lists the child", /1 open task/.test(await top12().innerText()) && (await p12.locator('[data-closekid]').count())===1);
  t("and blocks Complete until it is decided", await p12.locator('[data-closeconfirm]').isDisabled());
  t("with no warning about the time, which is fine", !/in the future/.test(await top12().innerText()));
  await p12.locator('[data-kidmove="3"]').click(); await p12.waitForTimeout(400);
  t("Move opens a picker of real destinations", (await p12.locator('[data-movetarget]').count())>=2);
  t("which never offers the closing record itself", (await p12.locator('[data-movetarget="proj:1"]').count())===0);
  await p12.locator('[data-movetarget="proj:4"]').click(); await p12.waitForTimeout(400);
  t("once every child is decided, Complete is allowed", !(await p12.locator('[data-closeconfirm]').isDisabled()));
  await p12.locator('[data-closeconfirm]').click(); await p12.waitForTimeout(600);
  const wire12=await p12.evaluate(()=>JSON.parse(localStorage.getItem('tt_projects')).find(x=>x.id===3));
  t("the moved child took the parent that was chosen, and stays open", wire12.parentId===4 && !wire12.closedAt);
  { const g=p12.locator('button').filter({hasText:/1\/2 Stages/}).first(); await g.scrollIntoViewIfNeeded(); await g.click(); await p12.waitForTimeout(500);
    const sb=await p12.locator('[data-surface="menu"] button').filter({hasText:/^B/}).first().boundingBox(); await p12.mouse.click(sb.x+sb.width/2,sb.y+sb.height/2); await p12.waitForTimeout(600); }
  t("ticking the last stage offers, rather than closing", /All stages done/.test((await top12().innerText()).split("\n")[0]));
  await p12.locator('[data-stagesdone="more"]').click(); await p12.waitForTimeout(500);
  t("Add more stages leads to the stage list", /Stages - Staged job/.test((await top12().innerText()).split("\n")[0]));
  t("with no page errors", errs12===0);
  await p12.close();

  // ---- every sheet's buttons ride in the sticky box, mirrored, header-following ----
  for(const [hand,hdr] of [['right','top'],['left','top'],['right','bottom']]){
    // 640 on purpose: the step sheet has to overflow for these checks.
    const p13=await b.newPage({viewport:{width:390,height:640}});
    await p13.addInitScript(a=>{ localStorage.setItem('tt_settings', JSON.stringify({layout:'comfortable',tracking:'timer',colorScheme:'bright-pastels',theme:'neon-dream',schemes:{},fonts:{},mode:'dark',handedness:a.hand,headerPos:a.hdr})); localStorage.setItem('tt_testmode','true'); },{hand,hdr});
    await p13.goto('file:///tmp/e2e.html',{waitUntil:'load'}); await dropSplash(p13); await p13.waitForTimeout(650);
    // Scrolled in first: the milestone strips make the board taller, and in a
    // 640px viewport the card title now sits below the fold.
    // Scrolled in first (the strips make the board taller, so in a 640px
    // viewport the card title sits below the fold), then settled past the
    // app's scrolling window, then tapped at coordinates.
    // Centred, not just "into view": drift arcs made the strips taller, and a
    // title scrolled to the edge sits under whichever header is there.
    { const ttl=p13.locator('span:text-is("Install new workbench")').first();
      await ttl.evaluate(el=>el.scrollIntoView({block:"center"})); await p13.waitForTimeout(900);
      const tb=await ttl.boundingBox();
      await p13.mouse.click(tb.x+tb.width/2, tb.y+tb.height/2); await p13.waitForTimeout(1200); }
    // The row itself is centred too: with the header at the BOTTOM a menu row
    // near the foot sits underneath it and the tap lands on the header.
    { const it=p13.locator('[data-rowmenuitem="Milestones"]');
      await it.evaluate(el=>el.scrollIntoView({block:"center"})); await p13.waitForTimeout(800);
      const bb=await it.boundingBox(); await p13.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2); await p13.waitForTimeout(500); }
    { const ad=p13.locator('[data-msadd]');
      await ad.evaluate(el=>el.scrollIntoView({block:"center"})); await p13.waitForTimeout(800);
      const ab=await ad.boundingBox(); await p13.mouse.click(ab.x+ab.width/2, ab.y+ab.height/2); await p13.waitForTimeout(600); }
    const g=await p13.evaluate(()=>{ const panel=[...document.querySelectorAll('[data-modal-panel]')].pop(); const pr=panel.getBoundingClientRect();
      const box=panel.querySelector('[data-surface="menu"]'); const br=box.getBoundingClientRect();
      const save=panel.querySelector('[data-mssave]'), mark=panel.querySelector('[data-msmarkmet]'); const sr=save.getBoundingClientRect(), mr=mark.getBoundingClientRect();
      const cancel=[...box.querySelectorAll('button')].find(b=>b.textContent==='Cancel').getBoundingClientRect();
      return { scrollable:panel.scrollHeight>panel.clientHeight+2, boxAt: Math.abs(br.top-pr.top)<40?'top':(Math.abs(br.bottom-pr.bottom)<40?'bottom':'middle'),
               saveVisible: sr.top>=0 && sr.bottom<=window.innerHeight, markInBox: box.contains(mark), markAboveRow: mr.bottom<=sr.top, saveSide: sr.x<cancel.x?'left':'right' }; });
    const tag=hand+'-handed, header '+hdr+': ';
    t(tag+"the step sheet is long enough to scroll", g.scrollable);
    t(tag+"Save is visible without scrolling", g.saveVisible);
    t(tag+"the box follows the header", g.boxAt===hdr);
    t(tag+"the mark rides in the box above the row", g.markInBox && g.markAboveRow);
    t(tag+"Save is under the thumb", g.saveSide===hand);
    await p13.close();
  }

  // ---- parent lines show every step beneath them; zoom and pan ----
  const p14=await b.newPage({viewport:{width:390,height:900}});
  let errs14=0; p14.on('pageerror',()=>{ errs14++; });
  const D14=86400000, now14=Date.now();
  await p14.addInitScript(({D,now})=>{
    localStorage.setItem('tt_settings', JSON.stringify({layout:'comfortable',tracking:'timer',colorScheme:'bright-pastels',theme:'neon-dream',schemes:{},fonts:{},mode:'dark',handedness:'right',headerPos:'top'}));
    const ms=(id,lbl,d)=>({id:id,label:lbl,dueAt:now+d*D,targets:[],doneAt:null,note:''});
    localStorage.setItem('tt_projects', JSON.stringify([
      {id:1,name:'Long build',lane:'Daily Activity',notes:'',order:0,parentId:null,role:'project',kind:'finite',stages:[],
        milestones:[ms('a','Survey',-40),ms('b','Order',-20),ms('c','Frame',5),ms('d','Fit',40),ms('e','Sign-off',95)]},
      {id:2,name:'Electrics',lane:'Daily Activity',notes:'',order:0,parentId:1,role:'project',kind:'finite',stages:[],
        milestones:[ms('f','Rough-in',12),ms('g','Test',60)]}]));
    localStorage.setItem('tt_laneorder', JSON.stringify(['Daily Activity']));
  },{D:D14,now:now14});
  await p14.goto('file:///tmp/e2e.html',{waitUntil:'load'}); await dropSplash(p14); await p14.waitForTimeout(700);
  const ids14=(k)=>p14.evaluate(sel=>{ const s=document.querySelector(sel); return [...s.querySelectorAll('[data-msmark]')].map(e=>e.getAttribute('data-msmark')).join(' '); }, '[data-msstrip="'+k+'"]');
  t("a lane line shows every step beneath it, its own and its children's, by date",
    (await ids14('lane'))==="a b c f d g e");
  const z14=p14.locator('[data-msstrip="lane"] [data-mszoom]');
  t("zoom starts at Fit", (await z14.getAttribute('data-mszoom'))==='fit');
  { const zb=await z14.boundingBox(); await p14.mouse.click(zb.x+zb.width/2, zb.y+zb.height/2); await p14.waitForTimeout(400); }
  t("tapping steps to the next level", (await z14.getAttribute('data-mszoom'))==='months');
  const win=await ids14('lane');
  t("which shows a window, not the whole line", win.split(' ').length < 7 && win.length>0);
  // Zoomed: the edges fade and a scrollbar shows where the window sits.
  const aff=async()=>p14.evaluate(()=>{ const s=document.querySelector('[data-msstrip="lane"]');
    const th=s.querySelector('[data-msthumb]');
    return { fades:s.querySelectorAll('linearGradient').length, thumbW:th?+th.getAttribute('data-msthumb'):null, thumbX:th?Math.round(+th.getAttribute('x')):null }; });
  const a1=await aff();
  t("the edges fade and a scrollbar appears", a1.fades===2 && a1.thumbW>0);
  t("the bar is narrower than the track, because part of the line is in view", a1.thumbW < 300);
  const line14=p14.locator('[data-msstrip="lane"] [data-mspan]'); const lb14=await line14.boundingBox();
  await p14.mouse.move(lb14.x+lb14.width*0.8, lb14.y+lb14.height/2); await p14.mouse.down();
  await p14.mouse.move(lb14.x+lb14.width*0.1, lb14.y+lb14.height/2,{steps:10}); await p14.mouse.up(); await p14.waitForTimeout(400);
  const later=await ids14('lane');
  t("dragging the line pans it later in time", later!==win && later.indexOf('e')>=0);
  const a2=await aff();
  t("and the scrollbar moves with it", a2.thumbX > a1.thumbX && a2.thumbW===a1.thumbW);
  t("and does not open the sheet", (await p14.locator('[data-modal-panel]').count())===0);
  await p14.mouse.move(lb14.x+lb14.width*0.1, lb14.y+lb14.height/2); await p14.mouse.down();
  await p14.mouse.move(lb14.x+lb14.width*0.9, lb14.y+lb14.height/2,{steps:10}); await p14.mouse.up(); await p14.waitForTimeout(400);
  t("and back earlier", (await ids14('lane')).indexOf('a')>=0);
  { const zb=await z14.boundingBox(); await p14.mouse.move(zb.x+zb.width/2, zb.y+zb.height/2); await p14.mouse.down(); await p14.waitForTimeout(1700); await p14.mouse.up(); await p14.waitForTimeout(400); }
  t("holding the control snaps back to Fit", (await z14.getAttribute('data-mszoom'))==='fit' && (await ids14('lane'))==="a b c f d g e");
  const a3=await aff();
  t("and at Fit there is nothing off-screen, so no fades and no bar", a3.fades===0 && a3.thumbW===null);
  t("with no page errors", errs14===0);
  await p14.close();

  // ---- milestones in the report ----
  const p15=await b.newPage({viewport:{width:390,height:900}});
  let errs15=0; p15.on('pageerror',()=>{ errs15++; });
  // Anchored to MIDNIGHT TODAY, not "now minus N days". With day offsets,
  // which steps fall in the report's week window depends on the weekday, and
  // on what side of midnight the clock is - this fixture passed in the
  // afternoon and broke when the container clock rolled over. Due times sit a
  // few seconds after midnight so they are always in the past; the report is
  // switched to Day, whose window is exactly today.
  const D15=86400000, now15=Date.now();
  await p15.addInitScript(({D,now})=>{
    localStorage.setItem('tt_settings', JSON.stringify({layout:'comfortable',tracking:'timer',colorScheme:'bright-pastels',theme:'neon-dream',schemes:{},fonts:{},mode:'dark',handedness:'right',headerPos:'top'}));
    const mid=new Date(now); mid.setHours(0,0,0,0);
    const H=(h)=>mid.getTime()+Math.round(h*3600000);
    const ms=(i,l,due,done)=>({id:i,label:l,dueAt:due,targets:[],doneAt:done==null?null:done,note:''});
    localStorage.setItem('tt_projects', JSON.stringify([
      {id:1,name:'Long build',lane:'Daily Activity',notes:'',order:0,parentId:null,role:'project',kind:'finite',stages:[],
        milestones:[
          ms('a','Survey', H(-40*24), H(-41*24)),   // 40 days back: outside today
          ms('b','Order',  H(0.001),  H(2.001)),    // met 2h after its target
          ms('c','Frame',  H(0.002),  null),        // target passed, not met
          ms('d','Fit',    H(4*24),   null)]},      // still ahead
      {id:2,name:'Electrics',lane:'Daily Activity',notes:'',order:0,parentId:1,role:'project',kind:'finite',stages:[],
        milestones:[
          ms('f','Rough-in', H(0.003), null),       // target passed, not met
          ms('g','Test',     H(6*24),  null)]}]));
    localStorage.setItem('tt_laneorder', JSON.stringify(['Daily Activity']));
  },{D:D15,now:now15});
  await p15.goto('file:///tmp/e2e.html',{waitUntil:'load'}); await dropSplash(p15); await p15.waitForTimeout(700);
  await p15.locator('button:has(path[d="M4 8H24 M4 14H24 M4 20H24"])').first().click(); await p15.waitForTimeout(280);
  await p15.locator('button').filter({hasText:/^Reports$/}).first().click(); await p15.waitForTimeout(800);
  await p15.locator('[data-modal-panel] button').filter({hasText:/^Day$/}).first().click(); await p15.waitForTimeout(700);
  const sec=p15.locator('[data-msreport]');
  t("the report has a milestones section", (await sec.count())===1);
  t("with the line at full width, labelled", (await p15.locator('[data-msreport] [data-msline]').count())===1);
  const txt15=await sec.innerText();
  t("counting what was due in the period", (await sec.getAttribute('data-msreport'))==='3');
  t("naming what was missed, with its owner", /MISSED[\s\S]*Rough-in[\s\S]*Electrics/.test(txt15));
  t("what was met late, with the slip", /MET LATE[\s\S]*Order[\s\S]*\+2h/.test(txt15));
  t("and what is next, beyond the period", /NEXT UP[\s\S]*Fit/.test(txt15));
  t("a step whose target is outside the period is not counted in it", !/Survey/.test(txt15));
  t("with no page errors", errs15===0);
  await p15.close();

  // ---- completing minimises rather than vanishing; hold to reopen ----
  const p16=await b.newPage({viewport:{width:390,height:1000}});
  let errs16=0; p16.on('pageerror',()=>{ errs16++; });
  await p16.addInitScript(()=>{
    localStorage.setItem('tt_settings', JSON.stringify({layout:'comfortable',tracking:'timer',colorScheme:'bright-pastels',theme:'neon-dream',schemes:{},fonts:{},mode:'dark',handedness:'right',headerPos:'top'}));
    localStorage.setItem('tt_projects', JSON.stringify([
      {id:1,name:'Install workbench',lane:'Daily Activity',notes:'',order:0,parentId:null,role:'project',kind:'finite',stages:[]},
      {id:2,name:'Measure up',lane:'Daily Activity',notes:'',order:0,parentId:1,role:'task',kind:'finite',stages:[]},
      {id:3,name:'Wire it in',lane:'Daily Activity',notes:'',order:1,parentId:1,role:'task',kind:'finite',stages:[]},
      {id:4,name:'Old shelving out',lane:'Daily Activity',notes:'',order:1,parentId:null,role:'project',kind:'finite',stages:[]}]));
    localStorage.setItem('tt_laneorder', JSON.stringify(['Daily Activity']));
  });
  await p16.goto('file:///tmp/e2e.html',{waitUntil:'load'}); await dropSplash(p16); await p16.waitForTimeout(700);
  const hold16=async(sel)=>{ const el=p16.locator(sel).first(); await el.scrollIntoViewIfNeeded(); await p16.waitForTimeout(400);
    const bb=await el.boundingBox(); await p16.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2); await p16.mouse.down();
    await p16.waitForTimeout(1700); await p16.mouse.up(); await p16.waitForTimeout(500); };
  await hold16('[data-complete="2"]');
  await p16.locator('[data-closeconfirm]').click(); await p16.waitForTimeout(700);
  const row16=p16.locator('[data-donerow="2"]');
  t("a completed task stays on the board instead of vanishing", (await row16.count())===1);
  t("greyed, struck through, and saying so next to its name", /Measure up[\s\S]*COMPLETED/i.test(await row16.innerText()));
  t("its card is gone, so it cannot be started or completed again", (await p16.locator('[data-complete="2"]').count())===0);
  // The pill says both: how many tasks there are, and how many are finished.
  t("and the pill says how many are done without losing the total",
    /2 tasks[\s\S]*1 done/.test(await p16.locator('button').filter({hasText:/task|nested/}).first().innerText()));
  await hold16('[data-complete="4"]');
  await p16.locator('[data-closeconfirm]').click(); await p16.waitForTimeout(700);
  t("a completed project does the same", (await p16.locator('[data-donecard="4"]').count())===1);
  // Reopening is HELD, never a tap.
  { const el=p16.locator('[data-reopen="4"]'); const bb=await el.boundingBox();
    await p16.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2); await p16.mouse.down(); await p16.waitForTimeout(150); await p16.mouse.up(); await p16.waitForTimeout(400); }
  t("tapping Reopen does nothing", (await p16.locator('[data-donecard="4"]').count())===1);
  await hold16('[data-reopen="4"]');
  const back16=await p16.evaluate(()=>JSON.parse(localStorage.getItem('tt_projects')).find(x=>x.id===4));
  t("holding it reopens the record", !back16.closedAt);
  t("the pill goes and the live card comes back",
    (await p16.locator('[data-donecard="4"]').count())===0 && (await p16.locator('[data-complete="4"]').count())===1);
  // The contents pill must survive every task being finished, or the finished
  // tasks it hides can never be opened again.
  const lbl16=async()=>{ const bt=p16.locator('button').filter({hasText:/task|nested/}).first();
    return (await bt.count()) ? (await bt.innerText()).trim() : '(no expander)'; };
  t("the contents pill counts what is there, and how many are done", /2 tasks[\s\S]*1 done/.test(await lbl16()));
  await hold16('[data-complete="3"]');
  await p16.locator('[data-closeconfirm]').click(); await p16.waitForTimeout(700);
  t("it survives every task being finished", /2 tasks[\s\S]*2 done/.test(await lbl16()));
  t("with both completed rows still shown", (await p16.locator('[data-donerow]').count())===2);
  { const bt=p16.locator('button').filter({hasText:/task|nested/}).first(); const bb=await bt.boundingBox();
    await p16.mouse.click(bb.x+bb.width/2, bb.y+bb.height/2); await p16.waitForTimeout(400); }
  t("collapsing hides them", (await p16.locator('[data-donerow]').count())===0);
  { const bt=p16.locator('button').filter({hasText:/task|nested/}).first(); const bb=await bt.boundingBox();
    await p16.mouse.click(bb.x+bb.width/2, bb.y+bb.height/2); await p16.waitForTimeout(400); }
  t("and re-expanding brings them back", (await p16.locator('[data-donerow]').count())===2);
  t("with no page errors", errs16===0);
  await p16.close();

  // The same rule at project level, on its own page: mutating localStorage
  // mid-test loses the write, because the running app persists its own state
  // over the top.
  const p17=await b.newPage({viewport:{width:390,height:1000}});
  let errs17=0; p17.on('pageerror',()=>{ errs17++; });
  await p17.addInitScript(()=>{
    localStorage.setItem('tt_settings', JSON.stringify({layout:'comfortable',tracking:'timer',colorScheme:'bright-pastels',theme:'neon-dream',schemes:{},fonts:{},mode:'dark',handedness:'right',headerPos:'top'}));
    const t=Date.now();
    localStorage.setItem('tt_projects', JSON.stringify([
      {id:1,name:'Install workbench',lane:'Daily Activity',notes:'',order:0,parentId:null,role:'project',kind:'finite',stages:[]},
      {id:7,name:'Electrical hookup',lane:'Daily Activity',notes:'',order:0,parentId:1,role:'project',kind:'finite',stages:[],closedAt:t-3600000,closedOutcome:'done',closedNote:''},
      {id:8,name:'Old shelving out',lane:'Daily Activity',notes:'',order:1,parentId:null,role:'project',kind:'finite',stages:[],closedAt:t-7200000,closedOutcome:'done',closedNote:''}]));
    localStorage.setItem('tt_laneorder', JSON.stringify(['Daily Activity']));
  });
  await p17.goto('file:///tmp/e2e.html',{waitUntil:'load'}); await dropSplash(p17); await p17.waitForTimeout(700);
  t("a finished nested project stays as a pill under its parent", (await p17.locator('[data-donecard="7"]').count())===1);
  t("a finished top-level project stays as a pill in the lane", (await p17.locator('[data-donecard="8"]').count())===1);
  t("the nested one is indented further than the top-level one", await p17.evaluate(()=>
    document.querySelector('[data-donecard="7"]').getBoundingClientRect().left >
    document.querySelector('[data-donecard="8"]').getBoundingClientRect().left));
  t("and the lane count says what it holds and how many are done",
    /2[\s\S]*1 done/.test((await p17.locator('[data-lanecount]').first().innerText()).trim()));
  t("neither can be started or completed again", (await p17.locator('[data-complete="7"], [data-complete="8"]').count())===0);
  t("both are held to reopen", (await p17.locator('[data-reopen="7"], [data-reopen="8"]').count())===2);
  t("with no page errors", errs17===0);
  await p17.close();

  // ---- ticks slide with the zoom; menu has no Add New and leads with the tutorial ----
  const p18=await b.newPage({viewport:{width:390,height:900}});
  let errs18=0; p18.on('pageerror',()=>{ errs18++; });
  const D18=86400000, now18=Date.now();
  await p18.addInitScript(({D,now})=>{
    localStorage.setItem('tt_settings', JSON.stringify({layout:'comfortable',tracking:'timer',colorScheme:'bright-pastels',theme:'neon-dream',schemes:{},fonts:{},mode:'dark',handedness:'right',headerPos:'top',workSchedule:{payroll:{weekStart:'sun',period:'weekly'}}}));
    const ms=(i,l,d)=>({id:i,label:l,dueAt:now+d*D,targets:[],doneAt:null,note:''});
    localStorage.setItem('tt_projects', JSON.stringify([{id:1,name:'Long build',lane:'Daily Activity',notes:'',order:0,parentId:null,role:'project',kind:'finite',stages:[],
      milestones:[ms('a','A',-30),ms('b','B',3),ms('c','C',60)]}]));
    localStorage.setItem('tt_laneorder', JSON.stringify(['Daily Activity']));
  },{D:D18,now:now18});
  await p18.goto('file:///tmp/e2e.html',{waitUntil:'load'}); await dropSplash(p18); await p18.waitForTimeout(800);
  const tk18=()=>p18.evaluate(()=>{ const st=document.querySelector('[data-msstrip="lane"]');
    const all=[...st.querySelectorAll('[data-tick]')]; const maj=all.filter(t=>t.getAttribute('data-tick')==='major');
    const h=(el)=>Math.abs(+el.getAttribute('y1') - +el.getAttribute('y2'));
    return { minor:all.length-maj.length, major:maj.length,
             majorTaller: maj.length && (all.length-maj.length) ? h(maj[0]) > h(all.find(t=>t.getAttribute('data-tick')==='minor')) : null,
             majorDays:[...new Set(maj.map(t=>t.getAttribute('data-major-day')))] }; });
  const z18=p18.locator('[data-msstrip="lane"] [data-mszoom]');
  const step18=async()=>{ const bb=await z18.boundingBox(); await p18.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2); await p18.waitForTimeout(350); };
  const fit18=await tk18();
  t("the line carries both minor and major ticks", fit18.minor>0 && fit18.major>0);
  t("and the major is taller", fit18.majorTaller===true);
  await step18(); const mo18=await tk18();
  await step18(); const wk18=await tk18();
  t("zooming in to weeks puts a tick on every day", wk18.minor > mo18.minor);
  await step18(); await step18(); const day18=await tk18();
  t("and down at a single day the minor ticks are hours", day18.minor >= 20 && day18.major <= 2);
  // No Add New row; the User Manual (which holds the practice board) leads.
  await p18.locator('button:has(path[d="M4 8H24 M4 14H24 M4 20H24"])').first().click(); await p18.waitForTimeout(400);
  const rows18=await p18.evaluate(()=>[...document.querySelectorAll('[data-menu-open="1"] button')].map(b=>b.innerText.trim().split("\n")[0]).filter(Boolean));
  t("the settings menu has no Add New row", !rows18.some(r=>/Add New/i.test(r)));
  t("and the User Manual is the first row", /^User Manual/.test(rows18[0]||''));
  t("with no page errors", errs18===0);
  await p18.close();

  // ---- stale tutorial data is replaced, so baseline changes actually land ----
  // The tutorial's stores persist and were only seeded when EMPTY, so a device
  // that ran the tutorial once kept its first copy forever and saw none of the
  // later work. This is what "I'm not seeing it in the tutorial" was.
  const p19=await b.newPage({viewport:{width:390,height:1000}});
  let errs19=0; p19.on('pageerror',()=>{ errs19++; });
  await p19.addInitScript(()=>{
    localStorage.setItem('tt_testmode','true');
    localStorage.setItem('tt_test_projects', JSON.stringify([
      {id:900,name:'OLD tutorial job',lane:'Projects',notes:'',order:0,parentId:null,role:'project',kind:'finite',stages:[]}]));
    localStorage.setItem('tt_test_laneorder', JSON.stringify(['Projects']));
  });
  await p19.goto('file:///tmp/e2e.html',{waitUntil:'load'}); await dropSplash(p19); await p19.waitForTimeout(1000);
  const st19=await p19.evaluate(()=>JSON.parse(localStorage.getItem('tt_test_projects')||'[]'));
  t("tutorial data from an older build is replaced on load", !st19.some(x=>x.id===900) && st19.length>1);
  t("and the seed version is stamped so it happens once", !!(await p19.evaluate(()=>localStorage.getItem('tt_test_seed'))));
  t("the current baseline's milestone strips are there", (await p19.locator('[data-msstrip]').count())>=3);
  t("with the tick scale drawn", (await p19.locator('[data-tick]').count())>0);
  t("and its completed record shows as a pill", (await p19.locator('[data-donecard],[data-donerow]').count())>=1);
  t("with no page errors", errs19===0);
  await p19.close();

  // ---- the tutorial is somewhere to come back to: leaving keeps your work ----
  // Its own context: pages share one storage profile, and this test depends on
  // the tutorial's stores starting from the shipped seed.
  const ctx20=await b.newContext({viewport:{width:390,height:900}});
  const p20=await ctx20.newPage();
  let errs20=0; p20.on('pageerror',()=>{ errs20++; });
  await p20.addInitScript(()=>{ localStorage.setItem('tt_testmode','true'); });
  // A real origin, not file://. Under test, Chromium sometimes gave a file://
  // reload an EMPTY storage snapshot (the seed version written seconds before
  // read back null), so the practice job "vanished" - 2-3 runs in 10, with
  // nothing in the app removing it. Served from a pretend origin through
  // Playwright, storage persists across the reload the way it does on a phone.
  const html20=fs.readFileSync('/tmp/e2e.html','utf8');
  await ctx20.route('http://tt.test/**', (r)=>r.fulfill({ status:200, contentType:'text/html', body:html20 }));
  await p20.goto('http://tt.test/',{waitUntil:'load'}); await dropSplash(p20); await p20.waitForTimeout(900);
  const mine20=()=>p20.evaluate(()=>JSON.parse(localStorage.getItem('tt_test_projects')||'[]').some(x=>x.id===9001));
  await p20.evaluate(()=>{ const P=JSON.parse(localStorage.getItem('tt_test_projects'));
    P.push({id:9001,name:'MY practice job',lane:P[0].lane,notes:'',order:99,parentId:null,role:'project',kind:'finite',stages:[]});
    localStorage.setItem('tt_test_projects', JSON.stringify(P)); });
  await p20.reload({waitUntil:'load'}); await dropSplash(p20); await p20.waitForTimeout(900);
  const openExit20=async()=>{ await p20.locator('button:has(path[d="M4 8H24 M4 14H24 M4 20H24"])').first().click(); await p20.waitForTimeout(350);
    await p20.locator('[data-menugroup="manual"]').click(); await p20.waitForTimeout(350);
    await p20.locator('[data-groupitem]').filter({hasText:/^Leave Practice Board$/}).click(); await p20.waitForTimeout(500); };
  await openExit20();
  t("the exit sheet says leaving keeps what you built", /keeps everything you have built/i.test(await p20.locator('[data-modal-panel]').last().innerText()));
  await p20.locator('[data-confirmexit]').click(); await p20.waitForTimeout(600);
  t("leaving the tutorial keeps your work", await mine20());
  await p20.locator('button:has(path[d="M4 8H24 M4 14H24 M4 20H24"])').first().click(); await p20.waitForTimeout(350);
  await p20.locator('[data-menugroup="manual"]').click(); await p20.waitForTimeout(350);
  await p20.locator('[data-groupitem]').filter({hasText:/^Practice Board$/}).click(); await p20.waitForTimeout(700);
  t("and it is still there when you come back", await mine20());
  await openExit20();
  { const r=p20.locator('[data-tutorialreset]'); const bb=await r.boundingBox();
    await p20.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2); await p20.mouse.down(); await p20.waitForTimeout(150); await p20.mouse.up(); await p20.waitForTimeout(400); }
  t("tapping Reset does nothing", await mine20());
  { const r=p20.locator('[data-tutorialreset]'); const bb=await r.boundingBox();
    await p20.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2); await p20.mouse.down(); await p20.waitForTimeout(1700); await p20.mouse.up(); await p20.waitForTimeout(700); }
  t("holding it restores the shipped tutorial", !(await mine20()));
  t("with the baseline back", (await p20.evaluate(()=>JSON.parse(localStorage.getItem('tt_test_projects')).length))>1);
  t("with no page errors", errs20===0);
  await p20.close(); await ctx20.close();

  // ---- drift: bright sign on the actual date, ghost at the target ----
  const ctx21=await b.newContext({viewport:{width:390,height:900}});
  const p21=await ctx21.newPage();
  let errs21=0; p21.on('pageerror',()=>{ errs21++; });
  const D21=86400000, now21=Date.now();
  const load21=async(set)=>{
    await p21.addInitScript(({D,now,set})=>{
      localStorage.setItem('tt_settings', JSON.stringify({layout:'comfortable',tracking:'timer',colorScheme:'bright-pastels',theme:'neon-dream',schemes:{},fonts:{},mode:'dark',handedness:'right',headerPos:'top',workSchedule:{payroll:{weekStart:'mon'}}}));
      const ms=set.map(([id,due,done])=>({id:id,label:id.toUpperCase(),dueAt:now+due*D,targets:[],doneAt:done==null?null:now+done*D,note:''}));
      localStorage.setItem('tt_projects', JSON.stringify([{id:1,name:'Long build',lane:'Daily Activity',notes:'',order:0,parentId:null,role:'project',kind:'finite',stages:[],milestones:ms}]));
      localStorage.setItem('tt_laneorder', JSON.stringify(['Daily Activity']));
    },{D:D21,now:now21,set});
    await p21.goto('file:///tmp/e2e.html',{waitUntil:'load'}); await dropSplash(p21); await p21.waitForTimeout(800);
  };
  const box21=()=>p21.evaluate(()=>{ const st=document.querySelector('[data-msstrip="lane"]');
    const vb=st.querySelector('svg').getAttribute('viewBox').split(' ').map(Number);
    let top=999; st.querySelectorAll('[data-driftarc]').forEach(a=>{ top=Math.min(top, a.getBBox().y); });
    return { h:vb[3], arcs:st.querySelectorAll('[data-driftarc]').length,
             ghosts:st.querySelectorAll('[data-driftghost]').length, arcTop:top===999?null:top }; });
  await load21([['a',-6,-6],['b',-3,-3],['c',4,null]]);
  const none21=await box21();
  t("a line with no drift draws no arcs", none21.arcs===0 && none21.ghosts===0);
  await load21([['a',-8,-7],['b',-3,-2],['c',5,null]]);
  const small21=await box21();
  t("two short drifts draw two arcs, each with a ghost", small21.arcs===2 && small21.ghosts===2);
  t("and the line grows to make room", small21.h > none21.h);
  await load21([['a',-40,2],['b',-10,-9],['c',-2,null],['d',8,null]]);
  const big21=await box21();
  t("a long slip grows it further", big21.h > small21.h);
  t("but the arc is capped, not unbounded", big21.h < none21.h + 60);
  t("and nothing is drawn outside the box", big21.arcTop >= -0.5);
  t("a missed step gets no arc", big21.arcs===1);
  // An early finish before every target must still fit on the line.
  await load21([['a',-20,-24],['b',-12,-4],['c',6,null]]);
  t("an early finish before every target still fits", await p21.evaluate(()=>{
    const st=document.querySelector('[data-msstrip="lane"]');
    let l=999; st.querySelectorAll('[data-driftarc]').forEach(a=>{ l=Math.min(l, a.getBBox().x); });
    return l >= -0.5; }));
  // Panning must not resize the line, and an arc must not vanish just because
  // its target has scrolled off the edge.
  await load21([['a',-50,-10],['b',-6,-4],['c',15,null]]);
  { const z=p21.locator('[data-msstrip="lane"] [data-mszoom]');
    for(let i=0;i<2;i++){ const zb=await z.boundingBox(); await p21.mouse.click(zb.x+zb.width/2,zb.y+zb.height/2); await p21.waitForTimeout(350); } }
  const ln21=p21.locator('[data-msstrip="lane"] [data-mspan]'); const lb21=await ln21.boundingBox();
  const seen21=[];
  for(let i=0;i<5;i++){
    seen21.push(await p21.evaluate(()=>{ const st=document.querySelector('[data-msstrip="lane"]');
      return { h:+st.querySelector('svg').getAttribute('viewBox').split(' ')[3],
               arcs:[...st.querySelectorAll('[data-driftarc]')].map(a=>a.getAttribute('data-driftarc')).join(',') }; }));
    await p21.mouse.move(lb21.x+lb21.width*0.8, lb21.y+lb21.height/2); await p21.mouse.down();
    await p21.mouse.move(lb21.x+lb21.width*0.35, lb21.y+lb21.height/2,{steps:8}); await p21.mouse.up(); await p21.waitForTimeout(320);
  }
  t("the line keeps ONE height across the whole pan", new Set(seen21.map(x=>x.h)).size===1);
  t("even though the arcs on screen change as it moves", new Set(seen21.map(x=>x.arcs)).size>1);
  t("and a long arc stays drawn while its target is off the edge",
    seen21.filter(x=>x.arcs.indexOf('a')>=0).length >= 2);
  t("with no page errors", errs21===0);
  await p21.close(); await ctx21.close();

  // ---- the opening screen ----
  const ctx22=await b.newContext({viewport:{width:390,height:844}});
  const p22=await ctx22.newPage();
  let errs22=0; p22.on('pageerror',()=>{ errs22++; });
  await p22.goto('file:///tmp/e2e.html',{waitUntil:'load'}); await p22.waitForTimeout(200);
  const sp22=await p22.evaluate(()=>{ const e=document.querySelector('[data-splash]');
    return e ? { state:e.getAttribute('data-splash'), text:e.innerText, z:+getComputedStyle(e).zIndex } : null; });
  t("the app opens on a splash", !!sp22);
  t("naming the app and its version", /Time Tracker/.test(sp22.text) && /v\d/.test(sp22.text));
  t("above every other layer", sp22.z >= 1000);
  t("and the board is already built behind it", (await p22.locator('[data-msstrip], button').count()) > 0);
  // Still there at 1.5s - it is a 2.5s hold now, not a flash.
  await p22.waitForTimeout(1300);
  t("it is still up a second and a half in", (await p22.locator('[data-splash]').count())===1);
  await p22.waitForTimeout(1800);
  t("and gone by three", (await p22.locator('[data-splash]').count())===0);
  t("leaving the board usable", await p22.locator('button').first().isVisible());
  // A tap kills it immediately rather than making you wait.
  await p22.reload({waitUntil:'load'}); await p22.waitForTimeout(150);
  t("it is back on the next launch", (await p22.locator('[data-splash]').count())===1);
  await p22.mouse.click(195, 400); await p22.waitForTimeout(450);
  t("and a tap dismisses it at once", (await p22.locator('[data-splash]').count())===0);
  t("with no page errors", errs22===0);
  await p22.close(); await ctx22.close();



  // ---- swipe to collapse and expand: lanes, cards, task rows ----
  // Driven by REAL touch events (CDP), because touch is the path iOS takes:
  // the distance is read on release, never by blocking the scroll. Left
  // collapses, right expands, a pill ignores a left swipe, and the tap that a
  // swipe would otherwise become never opens the row's menu.
  const ctx24=await b.newContext({viewport:{width:390,height:900},hasTouch:true,isMobile:true});
  const p24=await ctx24.newPage();
  let errs24=0; p24.on('pageerror',()=>{ errs24++; });
  await p24.goto('file:///tmp/e2e.html',{waitUntil:'load'}); await dropSplash(p24); await p24.waitForTimeout(700);
  const cdp24=await ctx24.newCDPSession(p24);
  const swipe24=async(loc,dx)=>{ await loc.scrollIntoViewIfNeeded(); await p24.waitForTimeout(250);
    const bb=await loc.boundingBox(); const x=bb.x+bb.width/2+(dx<0?40:-40), y=bb.y+bb.height/2;
    await cdp24.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let i=1;i<=6;i++){ await cdp24.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/6,y}]}); }
    await cdp24.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await p24.waitForTimeout(450); };
  const menus24=()=>p24.evaluate(()=>document.querySelectorAll('[data-surface="menu"]').length);
  // a lane
  const laneTitle24=p24.locator('[data-surface="lane"] span').filter({hasText:/^First Lane$/i}).first();
  await swipe24(laneTitle24, -110);
  t("swiping a lane's name left collapses the lane", (await p24.locator('[data-laneoval="'+(await p24.evaluate(()=>JSON.parse(localStorage.getItem('tt_laneorder')||'[]')[0]||''))+'"]').count())===1);
  t("and the swipe did not open the lane's menu", (await menus24())===0);
  const oval24=p24.locator('[data-laneoval]').first();
  await swipe24(oval24, -110);
  t("a collapsed lane ignores a left swipe", (await p24.locator('[data-laneoval]').count())===1);
  await swipe24(oval24, 110);
  t("and a right swipe opens it again", (await p24.locator('[data-laneoval]').count())===0);
  // a card
  const cardTitle24=p24.locator('[data-anchor="card-title"]').filter({hasText:/^First Project$/}).first();
  await swipe24(cardTitle24, -110);
  t("swiping a card's name left collapses the card", (await p24.locator('[data-anchor="card-title"]').filter({hasText:/^First Project$/}).count())===0);
  t("without opening its menu", (await menus24())===0);
  const pill24=p24.locator('[data-pillctl]').first();
  const pillRow24=pill24.locator('xpath=..');
  await swipe24(pillRow24, -110);
  t("a collapsed card ignores a left swipe", (await p24.locator('[data-anchor="card-title"]').filter({hasText:/^First Project$/}).count())===0);
  await swipe24(pillRow24, 110);
  t("and a right swipe opens it again", (await p24.locator('[data-anchor="card-title"]').filter({hasText:/^First Project$/}).count())===1);
  // a task row - a collapsed row is a 999px-rounded pill holding its name
  const taskPilled24=()=>p24.evaluate(()=>[...document.querySelectorAll('span')].some(e=>e.textContent==='Second Task' &&
    e.parentElement && e.parentElement.style.borderRadius==='999px'));
  const taskName24=p24.locator('span,div').filter({hasText:/^Second Task$/}).last();
  t("the task row starts open", !(await taskPilled24()));
  await swipe24(taskName24, -110);
  t("swiping a task row left shrinks it to a pill", await taskPilled24());
  t("without opening its menu", (await menus24())===0);
  const taskPill24=p24.locator('span').filter({hasText:/^Second Task$/}).first().locator('xpath=..');
  await swipe24(taskPill24, -110);
  t("a task pill ignores a left swipe", await taskPilled24());
  await swipe24(taskPill24, 110);
  t("and a right swipe brings the row back", !(await taskPilled24()));
  // A short drag is not a swipe.
  await swipe24(cardTitle24, -30);
  t("a drag shorter than a swipe changes nothing", (await p24.locator('[data-anchor="card-title"]').filter({hasText:/^First Project$/}).count())===1);
  t("with no page errors", errs24===0);
  await p24.close(); await ctx24.close();


  // ---- Edit...: a conversion SAVES (10-20) ----
  // Until 10-20 the board applied moves only: a project given its own lane
  // showed up as a lane called NEW-LANE-2 and never moved, and a lane turned
  // into a project left its projects under a parent that was never made. No
  // suite had ever saved a conversion. Brent chose to KEEP the project.
  const ctxCv=await b.newContext({viewport:{width:390,height:844}});
  const pCv=await ctxCv.newPage();
  let errsCv=0; pCv.on('pageerror',()=>{ errsCv++; });
  await pCv.addInitScript(()=>{ if(sessionStorage.getItem('cvSeeded')) return; sessionStorage.setItem('cvSeeded','1');
    const P=(id,n,o,pid,role)=>({ id, name:n, lane:'Shop', notes:'', order:o, parentId:pid||null, role:role||'project', kind:'finite', stages:[] });
    localStorage.setItem('tt_projects', JSON.stringify([P(1,'Alpha Job',0), P(2,'Beta Job',1), P(3,'Beta Prep',0,2,'task')]));
    localStorage.setItem('tt_laneorder', JSON.stringify(['Shop'])); });
  await pCv.goto('file:///tmp/e2e.html',{waitUntil:'load'}); await dropSplash(pCv); await pCv.waitForTimeout(600);
  const editCv=async()=>{ await pCv.locator('button:has(path[d="M4 8H24 M4 14H24 M4 20H24"])').first().click(); await pCv.waitForTimeout(300);
    await pCv.locator('button').filter({hasText:/^Edit…$/}).first().click(); await pCv.waitForTimeout(500); };
  const saveCv=async()=>{ if(await pCv.locator('[data-ctrldone]').count()){ await pCv.locator('[data-ctrldone]').click(); await pCv.waitForTimeout(300); }
    await pCv.locator('[data-modal-panel]').last().locator('button').filter({hasText:/^Save$/}).first().click(); await pCv.waitForTimeout(600); };
  const storedCv=()=>pCv.evaluate(()=>({ order:JSON.parse(localStorage.getItem('tt_laneorder')), meta:JSON.parse(localStorage.getItem('tt_lanemeta')||'{}'),
    projects:JSON.parse(localStorage.getItem('tt_projects')) }));
  const pickCv=async(re)=>{ const rows=await pCv.locator('[data-outlineopen]').allInnerTexts();
    await pCv.locator('[data-outlinepick]').nth(rows.findIndex(r=>re.test(r))).click(); await pCv.waitForTimeout(300); };
  // project -> its own lane
  await editCv(); await pickCv(/^Beta Job$/);
  await pCv.locator('[data-pad="left"]').click(); await pCv.waitForTimeout(400);
  t("giving a project its own lane asks, and says the project is kept",
    /stays a project/.test(await pCv.locator('[data-modal-panel]').last().innerText()));
  await pCv.locator('[data-outlineconfirm]').click(); await pCv.waitForTimeout(400);
  await saveCv();
  let sCv=await storedCv();
  const laneCv=sCv.order[1], betaCv=sCv.projects.find(p=>p.id===2), prepCv=sCv.projects.find(p=>p.id===3);
  t("Save stores a real lane, after the one it came from", sCv.order.length===2 && sCv.order[0]==='Shop' && /^custom_/.test(laneCv||''));
  t("labelled with the project's name", !!sCv.meta[laneCv] && sCv.meta[laneCv].label==='Beta Job');
  t("the project moved into it, first in the lane", !!betaCv && betaCv.lane===laneCv && betaCv.parentId===null && betaCv.order===0);
  t("with what was under it still under it", !!prepCv && prepCv.parentId===2 && prepCv.lane===laneCv);
  t("nothing was lost", sCv.projects.length===3);
  const lanesCv=await pCv.evaluate(()=>[...document.querySelectorAll('[data-lanecount]')].map(e=>e.parentElement.innerText.split("\n")[0]));
  t("the board shows the lane by name, never a temporary id", lanesCv.join('|')==='SHOP|BETA JOB');
  // lane -> project, back into Shop
  await editCv(); await pickCv(/^BETA JOB$/);
  await pCv.locator('[data-pad="right"]').click(); await pCv.waitForTimeout(400);
  await pCv.locator('[data-outlineconfirm]').click(); await pCv.waitForTimeout(400);
  await saveCv();
  sCv=await storedCv();
  const madeCv=sCv.projects.find(p=>p.name==='Beta Job' && p.id!==2);
  t("and gives it a long id, not a counted number", !!madeCv && typeof madeCv.id==='string' && madeCv.id.length>=24);
  const idsCv=new Set(sCv.projects.map(p=>p.id));
  t("turning a lane into a project makes a real project", !!madeCv && madeCv.name==='Beta Job' && madeCv.lane==='Shop' && madeCv.parentId===null);
  t("its projects nest under it", !!madeCv && sCv.projects.find(p=>p.id===2).parentId===madeCv.id);
  t("no project points at a parent that does not exist", sCv.projects.every(p=>p.parentId==null || idsCv.has(p.parentId)));
  t("and the old lane is gone, colour entry too", sCv.order.join()==='Shop' && !sCv.meta[laneCv]);
  t("with no page errors", errsCv===0);
  await pCv.close(); await ctxCv.close();

  // ---- every settings-menu row has a help topic ----
  // Read off the REAL menu - clocked in, so the status block's rows (Logging
  // to, Break) are there too - and every group's items, then checked against
  // the `covers` lists in the manual. A new menu row with no topic fails here.
  // Run twice: every module off (the shipped state), then with Tool Tracker
  // on - a module's menu row must be covered by the help the module brings.
  for(const on25 of [false, true]){
  const tag25 = on25 ? " (Tool Tracker on)" : "";
    const ctx25=await b.newContext({viewport:{width:390,height:844}});
    const p25=await ctx25.newPage();
    if(on25) await p25.addInitScript(()=>{ localStorage.setItem('tt_modules', JSON.stringify({ tools:true })); });
    let errs25=0; p25.on('pageerror',()=>{ errs25++; });
    await p25.goto('file:///tmp/e2e.html',{waitUntil:'load'}); await dropSplash(p25); await p25.waitForTimeout(600);
    await p25.locator('[data-anchor="hdr-clock"]').click(); await p25.waitForTimeout(400);
    for(let i=0;i<2;i++){ if(await p25.locator('[data-shiftchoice]').count()){ await p25.locator('[data-shiftchoice]').first().click(); await p25.waitForTimeout(400); } }
    const menu25=async()=>{ await p25.locator('button:has(path[d="M4 8H24 M4 14H24 M4 20H24"])').first().click(); await p25.waitForTimeout(400); };
    await menu25();
    const rows25=await p25.evaluate(()=>[...new Set([...document.querySelectorAll('[data-menu-open="1"] button')].map(b=>b.innerText.trim().split("\n")[0]).filter(Boolean))]);
    const items25=[];
    for(const g of await p25.evaluate(()=>[...document.querySelectorAll('[data-menugroup]')].map(e=>e.getAttribute('data-menugroup')))){
      if(!(await p25.locator('[data-menu-open="1"]').count())) await menu25();
      await p25.locator('[data-menugroup="'+g+'"]').click(); await p25.waitForTimeout(350);
      items25.push(...(await p25.locator('[data-groupitem]').allInnerTexts()));
      await p25.locator('[data-modal-panel]').last().locator('button').filter({hasText:/^Close$/}).click(); await p25.waitForTimeout(300);
    }
    const covers25=await p25.evaluate(()=>[helpAll().pictures,helpAll().guides,helpAll().practice].map(r=>Object.keys(r).map(k=>r[k].covers||[])).flat(2).map(x=>String(x).toLowerCase()));
    // The manual itself, and the way into the practice board, need no topic.
    const exempt25=["user manual","guides","practice board","leave practice board"];
    const missing25=rows25.concat(items25).filter(l=>exempt25.indexOf(l.toLowerCase())<0 && covers25.indexOf(l.toLowerCase())<0);
    t("the menu was read clocked in, status block included"+tag25, rows25.some(r=>/^logging to$/i.test(r)) && rows25.some(r=>/^break$/i.test(r)));
    if(on25){
      t("with Tool Tracker on, its Tools row is in the menu", rows25.concat(items25).some(l=>/^tools$/i.test(l)));
      t("and the manual has its topic", await p25.evaluate(()=>helpAll().index.some(t=>t.id==="module-tools")));
    }
    t("every settings-menu row and group item has a help topic"+tag25, missing25.length===0);
    if(missing25.length) console.log("   no topic for"+tag25+": "+missing25.join(", "));
    t("with no page errors"+tag25, errs25===0);
    await p25.close(); await ctx25.close();
  }

  // ---- the User Manual: Guides, pictures, steps, Try it here ----
  // The stages are LIVE renders of the real card and sheet, so this is the
  // only place that can show the rings actually land on what they name.
  const ctx23=await b.newContext({viewport:{width:390,height:844}});
  const p23=await ctx23.newPage();
  let errs23=0; p23.on('pageerror',()=>{ errs23++; });
  // Tool Tracker on: its topic is walked with the core's, picture by picture
  // and step by step, by the same registry-driven loops below.
  await p23.addInitScript(()=>{ localStorage.setItem('tt_testmode','true'); localStorage.setItem('tt_modules', JSON.stringify({ tools:true })); });
  await p23.goto('file:///tmp/e2e.html',{waitUntil:'load'}); await dropSplash(p23); await p23.waitForTimeout(800);
  const store23=()=>p23.evaluate(()=>JSON.stringify(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)])));
  t("the practice bar names the practice board", /PRACTICE BOARD/.test(await p23.locator('[data-tutorialbar]').innerText()));
  await p23.locator('[data-tutorialguides]').click(); await p23.waitForTimeout(500);
  const panel23=()=>p23.locator('[data-modal-panel]').last();
  t("the bar's book opens the Guides", /Guides/.test(await panel23().innerText()));
  t("and it is still the practice board underneath", (await p23.locator('[data-tutorialbar]').count())===1);
  await panel23().locator('button').filter({hasText:/^Close$/}).click(); await p23.waitForTimeout(400);
  // The same Guides from the menu.
  await p23.locator('button:has(path[d="M4 8H24 M4 14H24 M4 20H24"])').first().click(); await p23.waitForTimeout(350);
  await p23.locator('[data-menugroup="manual"]').click(); await p23.waitForTimeout(350);
  const items23=await p23.locator('[data-groupitem]').allInnerTexts();
  t("the User Manual holds Guides and the way out of practice", items23.join("|")==="Guides|Leave Practice Board");
  await p23.locator('[data-groupitem]').filter({hasText:/^Guides$/}).click(); await p23.waitForTimeout(500);
  const before23=await store23();
  // The index is by topic (layout B): every topic closed until tapped. A row
  // in a closed topic is not drawn, so openRow opens its topic first.
  const rows23=await p23.evaluate(()=>helpAll().index.filter(t=>!t.flat).length);
  const items23n=await p23.evaluate(()=>helpAll().index.reduce((a,t)=>a+t.items.length,0));
  const openRow=async(pg, key)=>{
    if(!(await pg.locator('[data-helprow="'+key+'"]').count())){
      const tid=await pg.evaluate((key)=>{ const t=helpAll().index.find(t=>t.items.some(it=>it[0]+":"+it[1]===key)); return t&&t.id; }, key);
      await pg.locator('[data-helptopic="'+tid+'"]').click(); await pg.waitForTimeout(250);
    }
    await pg.locator('[data-helprow="'+key+'"]').first().click();
  };
  t("Tool Tracker's topic is in the index while it is on", await p23.evaluate(()=>helpAll().index.some(t=>t.id==="module-tools")));
  t("the index starts as one closed heading per topic", (await p23.locator('[data-helptopic]').count())===rows23 &&
    (await p23.locator('[data-helptopic][aria-expanded="true"]').count())===0);
  for(const tid of await p23.evaluate(()=>helpAll().index.filter(t=>!t.flat).map(t=>t.id))){ await p23.locator('[data-helptopic="'+tid+'"]').click(); await p23.waitForTimeout(350); }
  t("opened, the topics offer every picture, guide and practice page", (await p23.locator('[data-helprow]').count())===items23n);
  t("and every one of them is somewhere in the index", await p23.evaluate(()=>{ const keys=new Set(helpAll().index.reduce((a,t)=>a.concat(t.items.map(it=>it[0]+":"+it[1])),[]));
    return Object.keys(helpAll().pictures).every(id=>keys.has("picture:"+id)) && Object.keys(helpAll().guides).every(id=>keys.has("guide:"+id)); }));
  for(const tid of await p23.evaluate(()=>helpAll().index.filter(t=>!t.flat).map(t=>t.id))){ await p23.locator('[data-helptopic="'+tid+'"]').click(); await p23.waitForTimeout(350); }
  // Search, pinned at the top, finds parts and steps and jumps straight there.
  await p23.locator('[data-helpquery]').fill('overtime'); await p23.waitForTimeout(300);
  t("search finds picture parts and guide steps", (await p23.locator('[data-helphit^="picture:paywork:"]').count())>0 && (await p23.locator('[data-helphit^="guide:setpay:"]').count())>0);
  await p23.locator('[data-helphit="picture:paywork:4"]').click(); await p23.waitForTimeout(1300);
  t("a picture hit opens that picture on that part", (await p23.locator('[data-helpdetail]').getAttribute('data-helpdetail'))==="4" &&
    /Overtime Rate/.test(await p23.locator('[data-helpdetaillabel]').innerText()));
  await p23.locator('[data-helpquery]').fill('overnight'); await p23.waitForTimeout(300);
  await p23.locator('[data-helphit="guide:setschedule:3"]').click(); await p23.waitForTimeout(900);
  t("a step hit opens that guide on that step", (await p23.locator('[data-helpstep="3"]').count())===1);
  await p23.evaluate(()=>{ document.querySelector('[data-modal-panel]').scrollTop=9999; }); await p23.waitForTimeout(300);
  t("the search stays pinned at the top as the page scrolls", await p23.evaluate(()=>{ const q=document.querySelector('[data-helpsearch]').getBoundingClientRect(),
    P=document.querySelector('[data-modal-panel]').getBoundingClientRect(); return q.top>=P.top-1 && q.bottom<P.top+200; }));
  await p23.locator('[data-helpquery]').fill('zzzqqq'); await p23.waitForTimeout(250);
  t("and says so when nothing matches", (await p23.locator('[data-helpresults="0"]').count())===1);
  await p23.locator('[data-helpclear]').click(); await p23.waitForTimeout(300);
  t("clearing it goes back to where you were", (await p23.locator('[data-helpstep="3"]').count())===1);
  await panel23().locator('[data-helpback]').click(); await p23.waitForTimeout(400);
  t("Back from a hit is the index", (await p23.locator('[data-helptopic]').count())===rows23);
  await openRow(p23, "picture:card"); await p23.waitForTimeout(900);
  const marks23=await p23.locator('[data-helpmark]').count();
  t("the card picture shows five numbered parts", marks23===5);
  // Every mark sits inside the sheet and no two overlap - they once covered
  // the labels they named.
  const mb23=await p23.evaluate(()=>[...document.querySelectorAll('[data-helpmark]')].map(e=>{ const r=e.getBoundingClientRect(); return [r.left,r.top,r.right,r.bottom]; }));
  const pb23=await panel23().boundingBox();
  t("every mark is inside the sheet", mb23.every(r=>r[0]>=pb23.x && r[2]<=pb23.x+pb23.width));
  t("and no two marks overlap", mb23.every((a,i)=>mb23.every((c,j)=>i===j || a[2]<=c[0]||c[2]<=a[0]||a[3]<=c[1]||c[3]<=a[1])));
  await p23.locator('[data-helpmark="4"]').click(); await p23.waitForTimeout(250);
  const ring23=await p23.evaluate(()=>{ const r=document.querySelector('[data-helpring]'); const a=document.querySelector('[data-helpstage] [data-anchor="disruptions"]');
    if(!r||!a) return null; const R=r.getBoundingClientRect(), A=a.getBoundingClientRect();
    return R.left<=A.left+1 && R.top<=A.top+1 && R.right>=A.right-1 && R.bottom>=A.bottom-1; });
  t("picking a part rings exactly that part on the live card", ring23===true);
  // The box under the picture shows only the picked part: How > for
  // Complete appears once Complete is the part showing.
  t("the box shows the part just picked", (await p23.locator('[data-helpdetail]').getAttribute('data-helpdetail'))==="4");
  t("and only that part's How >", (await p23.locator('[data-helphow]').count())===1 && (await p23.locator('[data-helphow="finish"]').count())===0);
  await p23.locator('[data-helpdetailnav="next"]').click(); await p23.waitForTimeout(250);
  t("the arrow steps the box to the next part", (await p23.locator('[data-helpdetail]').getAttribute('data-helpdetail'))==="5");
  t("and moves the ring with it", await p23.evaluate(()=>{ const r=document.querySelector('[data-helpring]'); const a=document.querySelector('[data-helpstage] [data-complete]');
    if(!r||!a) return false; const R=r.getBoundingClientRect(), A=a.getBoundingClientRect();
    return R.left<=A.left+1 && R.top<=A.top+1 && R.right>=A.right-1 && R.bottom>=A.bottom-1; }));
  t("on the last part the next arrow is off", await p23.locator('[data-helpdetailnav="next"]').isDisabled());
  // How > on Complete lands in the step-through, reached from the picture.
  await p23.locator('[data-helphow="finish"]').click(); await p23.waitForTimeout(900);
  t("How > opens Finish a job at step one", /Finish a job/.test(await panel23().innerText()) &&
    (await p23.locator('[data-helpstep="1"]').count())===1);
  t("with a breadcrumb back through the card", /Guides › A card › Complete/.test(await p23.locator('[data-helpcrumb]').innerText()));
  t("and Back says where it goes", (await panel23().locator('[data-helpback]').innerText())==="Back to card");
  const ringOn=async(sel)=>p23.evaluate((sel)=>{ const r=document.querySelector('[data-helpring]'); const a=document.querySelector('[data-helpstage] '+sel);
    if(!r||!a) return false; const R=r.getBoundingClientRect(), A=a.getBoundingClientRect();
    return A.width>0 && R.left<=A.left+1 && R.top<=A.top+1 && R.right>=A.right-1 && R.bottom>=A.bottom-1; }, sel);
  t("step one rings the real Complete control", await ringOn('[data-complete]'));
  // Try it here: the real hold, wired to nothing.
  const th=await p23.locator('[data-tryhold]').boundingBox();
  await p23.locator('[data-tryhold]').scrollIntoViewIfNeeded(); await p23.waitForTimeout(700);
  const th2=await p23.locator('[data-tryhold]').boundingBox();
  await p23.mouse.move(th2.x+th2.width/2, th2.y+th2.height/2); await p23.mouse.down(); await p23.waitForTimeout(250); await p23.mouse.up(); await p23.waitForTimeout(300);
  t("letting go early says nothing happened", (await p23.locator('[data-tryresult]').getAttribute('data-tryresult'))==="early");
  await p23.mouse.move(th2.x+th2.width/2, th2.y+th2.height/2); await p23.mouse.down(); await p23.waitForTimeout(1750); await p23.mouse.up(); await p23.waitForTimeout(300);
  t("holding it through says that is the gesture", (await p23.locator('[data-tryresult]').getAttribute('data-tryresult'))==="held");
  for(const [n,sel] of [[2,'[data-closeopt]'],[3,'[data-closekids]'],[4,'[data-donerow]']]){
    await panel23().locator('[data-helpnext]').click(); await p23.waitForTimeout(900);
    t("step "+n+" rings "+sel+" on the live render", await ringOn(sel));
  }
  t("on the last step the next arrow is Done", (await panel23().locator('[data-helpnext]').getAttribute('data-helpnext'))==="done" &&
    (await panel23().locator('[data-helpnext]').getAttribute('aria-label'))==="Done");
  await panel23().locator('[data-helpnext]').click(); await p23.waitForTimeout(700);
  t("Done goes back to the card it came from", (await p23.locator('[data-helpmark]').count())===5);
  t("practising and reading changed nothing in storage", (await store23())===before23);
  await panel23().locator('[data-helpback]').click(); await p23.waitForTimeout(500);
  t("and Back from the card is the index", (await p23.locator('[data-helptopic]').count())===rows23);


  // Every picture: each numbered mark inside the sheet, no two overlapping -
  // on a milestone line the signs move with the clock, so this is the check
  // that the nudging holds at whatever hour the suite runs.
  const pics23=await p23.evaluate(()=>Object.keys(helpAll().pictures));
  for(const id of pics23){
    await openRow(p23, "picture:"+id); await p23.waitForTimeout(900);
    const n=await p23.evaluate((id)=>helpAll().pictures[id].parts.length, id);
    const mb=await p23.evaluate(()=>[...document.querySelectorAll('[data-helpmark]')].map(e=>{ const r=e.getBoundingClientRect(); return [r.left,r.top,r.right,r.bottom]; }));
    const pb=await panel23().boundingBox();
    t(id+": every part is numbered on the picture", mb.length===n);
    t(id+": every mark is inside the sheet", mb.every(r=>r[0]>=pb.x-1 && r[2]<=pb.x+pb.width+1));
    const vis=await p23.evaluate(()=>{ const b=document.querySelector('[data-helpstage]').getBoundingClientRect(); return [b.top-60,b.bottom+4]; });
    t(id+": every mark sits on the picture, not off its bottom", mb.every(r=>r[1]>=vis[0] && r[3]<=vis[1]));
    t(id+": and no two marks overlap", mb.every((a,i)=>mb.every((c,j)=>i===j || a[2]<=c[0]+0.5||c[2]<=a[0]+0.5||a[3]<=c[1]+0.5||c[3]<=a[1]+0.5)));
    // The instructions box: on screen the moment the page opens, without a
    // scroll - the reason it replaced the list.
    const boxIn=async()=>p23.evaluate(()=>{ const b=document.querySelector('[data-helpdetail]'); if(!b) return false; const r=b.getBoundingClientRect();
      return r.height>0 && r.top>=0 && r.bottom<=window.innerHeight+1; });
    t(id+": the box opens on part one", (await p23.locator('[data-helpdetail]').getAttribute('data-helpdetail'))==="1");
    t(id+": and is on screen without scrolling", await boxIn());
    // Tap every number: the box follows it and stays on screen, and the ring
    // stays on the picture. The Reports milestones ring once ran off it.
    let ringsOk=true, boxOk=true; const boxH=new Set();
    const parts=await p23.evaluate((id)=>helpAll().pictures[id].parts.map(p=>({label:p.label, how:!!(p.guide&&helpAll().guides[p.guide])})), id);
    for(let k=1;k<=n;k++){
      await p23.locator('[data-helpmark="'+k+'"]').click(); await p23.waitForTimeout(200);
      const shown=await p23.evaluate(()=>{ const b=document.querySelector('[data-helpdetail]'); return { n:b.getAttribute('data-helpdetail'),
        label:b.querySelector('[data-helpdetaillabel]').textContent, how:b.querySelectorAll('[data-helphow]').length }; });
      boxH.add(await p23.evaluate(()=>Math.round(document.querySelector('[data-helpdetail]').getBoundingClientRect().height)));
      if(shown.n!==String(k) || shown.label!==parts[k-1].label || (shown.how===1)!==parts[k-1].how || !(await boxIn())){ boxOk=false; console.log("   box wrong: "+id+" part "+k); }
      const ok=await p23.evaluate(()=>{ const r=document.querySelector('[data-helpring]'); const b=document.querySelector('[data-helpstage]');
        if(!r||!b) return false; const R=r.getBoundingClientRect(), I=b.firstChild.getBoundingClientRect();
        return R.bottom<=I.bottom+8 && R.top>=I.top-8 && R.left>=I.left-8 && R.right<=I.right+8; });
      if(!ok){ ringsOk=false; console.log("   ring off the picture: "+id+" part "+k); }
    }
    t(id+": every part's ring stays on the picture", ringsOk);
    t(id+": the box shows each part as it is picked, on screen", boxOk);
    t(id+": and never changes height from part to part (steady-box rule)", boxH.size===1);
    // Walk back with the arrow: each part must land in the clear band
    // between the action bar and the box - centred when it fits.
    const inBand=async(k)=>p23.evaluate((k)=>{
      const st=document.querySelector('[data-helpstage]'), box=document.querySelector('[data-helpdetail]');
      const panel=box.closest('[data-modal-panel]'), bar=panel.querySelector(':scope > [data-surface="menu"]');
      const els=[st.querySelector('[data-helpring]'), st.querySelector('[data-helpmark="'+k+'"]')].filter(Boolean);
      let top=1e9, bot=-1e9; els.forEach(e=>{ const r=e.getBoundingClientRect(); top=Math.min(top,r.top); bot=Math.max(bot,r.bottom); });
      const P=panel.getBoundingClientRect(), B=box.getBoundingClientRect(), A=bar.getBoundingClientRect();
      const Q=document.querySelector('[data-helpsearch]'); const qb=Q?Q.getBoundingClientRect().bottom:P.top;
      const bandTop=Math.max(A.bottom<P.top+P.height/2 ? Math.max(P.top,A.bottom) : P.top, qb);
      const bandBot=Math.min(B.top, A.top>P.top+P.height/2 ? A.top : 1e9);
      if(bot-top<=bandBot-bandTop) return top>=bandTop-2 && bot<=bandBot+2;
      return top>=bandTop-2 && top<=bandTop+40;   // too tall: its top shows
    }, k);
    let bandOk=true;
    for(let k=n-1;k>=1;k--){
      await p23.locator('[data-helpdetailnav="prev"]').click(); await p23.waitForTimeout(700);
      if(!(await inBand(k))){ bandOk=false; console.log("   not brought into view: "+id+" part "+k); }
    }
    for(let k=2;k<=n;k++){
      await p23.locator('[data-helppart="'+k+'"]').click(); await p23.waitForTimeout(700);
      if(!(await inBand(k))){ bandOk=false; console.log("   not brought into view: "+id+" part "+k+" (chip)"); }
    }
    t(id+": every part picked from the box lands in view, clear of the bar and the box", bandOk);
    await panel23().locator('[data-helpback]').click(); await p23.waitForTimeout(500);
  }
  // Every guide, every step: the ring must CONTAIN the control it names, on
  // the live render. Read off the registry in the page, so a new guide is
  // covered the moment it is added.
  const guides23=await p23.evaluate(()=>Object.keys(helpAll().guides).map(id=>({id, rings:helpAll().guides[id].steps.map(s=>s.ring)})));
  // Next, then wait for the step to change (or the guide to close). A tap that
  // lands while the page is still gliding to the last step is tried again.
  const nextStep23=async()=>{
    const was=await p23.evaluate(()=>{ const d=document.querySelector('[data-helpdetail]'); return d?d.getAttribute('data-helpdetail'):null; });
    for(let k=0;k<2;k++){
      await panel23().locator('[data-helpnext]').click();
      const moved=await p23.waitForFunction((was)=>{ const d=document.querySelector('[data-helpdetail]'); return !d || d.getAttribute('data-helpdetail')!==was; }, was, { timeout:2500 }).then(()=>true, ()=>false);
      if(moved) return;
    }
  };
  for(const g of guides23){
    await openRow(p23, "guide:"+g.id); await p23.waitForTimeout(1000);
    const textH=new Set(), boxTop=new Set(); let shown=true;
    for(let i=0;i<g.rings.length;i++){
      // The same walk as a picture: the box keeps one height and one place,
      // and each step's ring is brought into the band above it.
      const bx=await p23.evaluate(()=>{ const r=document.querySelector('[data-helpdetail]').getBoundingClientRect(); return [Math.round(r.height), Math.round(r.top), r.top>=0 && r.bottom<=window.innerHeight+1]; });
      textH.add(bx[0]); boxTop.add(bx[1]); if(!bx[2]) shown=false;
      if(g.rings[i]){
        t(g.id+" step "+(i+1)+" rings "+g.rings[i], await ringOn(g.rings[i]));
        const vis=await p23.evaluate(()=>{ const r=document.querySelector('[data-helpring]'), b=document.querySelector('[data-helpdetail]');
          if(!r) return false; const R=r.getBoundingClientRect(), B=b.getBoundingClientRect(); return R.top<B.top-4; });
        if(!vis) console.log("   step ring under the box: "+g.id+" "+(i+1));
        t(g.id+" step "+(i+1)+": its ring shows above the box", vis);
      }
      await nextStep23(); await p23.waitForTimeout(1000);
    }
    t(g.id+": the box keeps one height and one place through the guide (steady-box rule)", textH.size===1 && boxTop.size===1);
    t(g.id+": and is on screen at every step", shown);
    t(g.id+": Done lands back on the index", (await p23.locator('[data-helptopic]').count())===rows23);
  }
  // The practice page: tap, hold and swipe, all live, all writing nothing.
  await openRow(p23, "practice:gestures"); await p23.waitForTimeout(700);
  t("the practice page has a panel per gesture", (await p23.locator('[data-tryit]').count())===
    (await p23.evaluate(()=>helpAll().practice.gestures.panels.length)));
  const res23=(k)=>p23.locator('[data-tryit="'+k+'"] [data-tryresult]').getAttribute('data-tryresult');
  await p23.locator('[data-trytaps]').scrollIntoViewIfNeeded(); await p23.waitForTimeout(600);
  const below23=()=>p23.evaluate(()=>{ const a=document.querySelector('[data-tryit="taps"]'), b=document.querySelector('[data-tryit="swipe"]');
    return Math.round(b.getBoundingClientRect().top-a.getBoundingClientRect().top); });
  const gap23=await below23();
  await p23.locator('[data-trytaps]').click(); await p23.waitForTimeout(500);
  t("one tap reads as one tap", (await res23('taps'))==="one");
  t("and the panel under it does not move as the reply changes", (await below23())===gap23);
  await p23.locator('[data-trytaps]').dblclick(); await p23.waitForTimeout(500);
  t("two quick taps read as two", (await res23('taps'))==="two");
  const sw23=async(sel,dx)=>{ const l=p23.locator(sel); await l.scrollIntoViewIfNeeded(); await p23.waitForTimeout(600);
    const bb=await l.boundingBox(); const x=bb.x+bb.width/2+(dx<0?60:-60), y=bb.y+bb.height/2;
    await p23.mouse.move(x,y); await p23.mouse.down(); await p23.mouse.move(x+dx,y,{steps:6}); await p23.mouse.up(); await p23.waitForTimeout(400); };
  await sw23('[data-tryswipe="open"]', -120);
  t("swiping left tucks the practice job away", (await p23.locator('[data-tryswipe="pill"]').count())===1);
  await sw23('[data-tryswipe="pill"]', -120);
  t("a left swipe on the pill does nothing", (await p23.locator('[data-tryswipe="pill"]').count())===1);
  await sw23('[data-tryswipe="pill"]', 120);
  t("and a right swipe opens it", (await p23.locator('[data-tryswipe="open"]').count())===1);
  // The practice outline is LIVE: pick a row, move it, Save - Save only says so.
  const tryOut=p23.locator('[data-tryit="outline"]');
  await tryOut.scrollIntoViewIfNeeded(); await p23.waitForTimeout(700);
  await tryOut.locator('[data-outlinepick="P:106"]').click(); await p23.waitForTimeout(500);
  t("the practice outline picks a row and shows the arrows", (await tryOut.locator('[data-pad]').count())===4);
  const orderBefore=await tryOut.evaluate(e=>[...e.querySelectorAll('[data-outlinekey]')].map(r=>r.getAttribute('data-outlinekey')).join(","));
  await tryOut.locator('[data-pad="up"]').click(); await p23.waitForTimeout(500);
  const orderAfter=await tryOut.evaluate(e=>[...e.querySelectorAll('[data-outlinekey]')].map(r=>r.getAttribute('data-outlinekey')).join(","));
  t("and the arrows really move it", orderAfter!==orderBefore);
  await tryOut.locator('[data-ctrldone]').click(); await p23.waitForTimeout(400);
  await tryOut.locator('[data-anchor="outline-save"]').click(); await p23.waitForTimeout(400);
  t("Save says what would happen", (await tryOut.locator('[data-tryresult]').getAttribute('data-tryresult'))==="save");
  t("practising every gesture changed nothing in storage", (await store23())===before23);
  await panel23().locator('[data-helpback]').click(); await p23.waitForTimeout(500);
  // Straight in from How do I...? - the same steps, a different way back.
  await openRow(p23, "guide:finish"); await p23.waitForTimeout(800);
  t("the index opens the same steps directly", (await p23.locator('[data-helpstep="1"]').count())===1 &&
    /Guides › How do I…\?/.test(await p23.locator('[data-helpcrumb]').innerText()));
  await panel23().locator('[data-helpback]').click(); await p23.waitForTimeout(500);
  t("whose Back is the index", (await p23.locator('[data-helptopic]').count())===rows23);
  t("with no page errors", errs23===0);
  await p23.close(); await ctx23.close();

  // Header at the BOTTOM: the action bar sticks to the sheet's foot too. The
  // instruction box must sit above it, never under it, and picking a part
  // still brings it into the band above the box.
  const ctxHB=await b.newContext({viewport:{width:390,height:844}});
  const pHB=await ctxHB.newPage();
  let errsHB=0; pHB.on('pageerror',()=>{ errsHB++; });
  await pHB.addInitScript(()=>{ localStorage.setItem('tt_testmode','true');
    localStorage.setItem('tt_settings', JSON.stringify({ layout:"comfortable", tracking:"timer", colorScheme:"bright-pastels", theme:"neon-dream", schemes:{}, fonts:{}, mode:"dark", handedness:"right", headerPos:"bottom" })); });
  await pHB.goto('file:///tmp/e2e.html',{waitUntil:'load'}); await dropSplash(pHB); await pHB.waitForTimeout(800);
  await pHB.locator('[data-tutorialguides]').click(); await pHB.waitForTimeout(500);
  await pHB.locator('[data-helptopic="reports"]').click(); await pHB.waitForTimeout(250);
  await pHB.locator('[data-helprow="picture:reports"]').click(); await pHB.waitForTimeout(900);
  const clearHB=()=>pHB.evaluate(()=>{ const box=document.querySelector('[data-helpdetail]'), panel=box.closest('[data-modal-panel]'),
    bar=panel.querySelector(':scope > [data-surface="menu"]'); const B=box.getBoundingClientRect(), A=bar.getBoundingClientRect();
    return { below:A.top>=B.bottom-1, onScreen:B.top>=0 && A.bottom<=window.innerHeight+1 }; });
  let cHB=await clearHB();
  t("header at the bottom: the action bar sits below the instruction box, not over it", cHB.below && cHB.onScreen);
  for(let k=2;k<=5;k++){ await pHB.locator('[data-helpdetailnav="next"]').click(); await pHB.waitForTimeout(700); }
  cHB=await clearHB();
  t("and still does after stepping to the last part", cHB.below && cHB.onScreen);
  t("which is brought into view above the box", await pHB.evaluate(()=>{ const st=document.querySelector('[data-helpstage]'), box=document.querySelector('[data-helpdetail]');
    const r=st.querySelector('[data-helpmark="5"]').getBoundingClientRect(), B=box.getBoundingClientRect(), P=box.closest('[data-modal-panel]').getBoundingClientRect();
    return r.top>=P.top && r.bottom<=B.top; }));
  t("with no page errors", errsHB===0);
  await pHB.close(); await ctxHB.close();

  // ---- Backup & Saves on the REAL board: save, reset state, load it back,
  // nothing while the clock runs, and a backup at clock-out. Served from a
  // real origin so reloads keep their storage (see p20).
  const ctxSV=await b.newContext({viewport:{width:390,height:844}});
  await ctxSV.route('http://tt.test/**', (r)=>r.fulfill({ status:200, contentType:'text/html', body:fs.readFileSync('/tmp/e2e.html','utf8') }));
  const pSV=await ctxSV.newPage();
  let errsSV=0; pSV.on('pageerror',()=>{ errsSV++; });
  await pSV.goto('http://tt.test/',{waitUntil:'load'});
  await pSV.evaluate(()=>{ const now=Date.now(); localStorage.clear();
    localStorage.setItem('tt_projects', JSON.stringify([{id:1,name:"Line 4 Rebuild",lane:"Daily Activity",notes:"",order:0,parentId:null,role:"project",kind:"ongoing",
      stages:[{id:"a",label:"Strip",done:true,doneAt:now-5e6,note:""}]}]));
    localStorage.setItem('tt_laneorder', JSON.stringify(['Daily Activity']));
    localStorage.setItem('tt_logs', JSON.stringify([1,2,3].map(i=>({id:"l"+i,type:"project",projectId:1,projectName:"Line 4 Rebuild",lane:"Daily Activity",startTime:now-i*4e6,endTime:now-i*4e6+3e6,duration:3e6})))); });
  const goSV=async()=>{ await pSV.reload({waitUntil:'load'}); await dropSplash(pSV); await pSV.waitForTimeout(700); };
  await goSV();
  const sheetSV=async()=>{ await pSV.locator('[data-anchor="hdr-menu"]').first().click(); await pSV.waitForTimeout(300);
    await pSV.locator('button').filter({hasText:/^Backup & Saves$/}).click(); await pSV.waitForTimeout(800); };
  const holdSV=async(sel)=>{ const l=pSV.locator(sel); await l.scrollIntoViewIfNeeded(); await pSV.waitForTimeout(400);
    const bb=await l.boundingBox(); await pSV.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2); await pSV.mouse.down(); await pSV.waitForTimeout(1800); await pSV.mouse.up(); };
  const lsSV=()=>pSV.evaluate(()=>({ logs:JSON.parse(localStorage.getItem('tt_logs')||'[]').length,
    done:(JSON.parse(localStorage.getItem('tt_projects')||'[]')[0]||{stages:[{}]}).stages[0].done }));
  const idsSV=()=>pSV.evaluate(()=>snapList().then(l=>l.map(r=>r.id+'|'+r.why)));
  await sheetSV();
  t("the menu row and sheet are Backup & Saves", /Backup & Saves/.test(await pSV.locator('[data-modal-panel]').last().innerText()));
  await pSV.locator('[data-savename]').fill('Clean setup'); await pSV.locator('[data-savenow]').click(); await pSV.waitForTimeout(900);
  t("Save the board now adds a named save", (await pSV.locator('[data-snaprow^="save-"]').count())===1 &&
    /Clean setup/.test(await pSV.locator('[data-snaprow^="save-"]').innerText()));
  await pSV.locator('[data-resetopen]').click(); await pSV.waitForTimeout(500);
  t("Reset opens on Reset state", (await pSV.locator('[data-resetmode]').getAttribute('data-resetmode'))==="state");
  const hReset=await pSV.locator('[data-resetmode]').evaluate(e=>e.getBoundingClientRect().height);
  await pSV.locator('[data-resetchip="factory"]').click(); await pSV.waitForTimeout(250);
  t("Factory reset ticks everything, projects locking the time on", (await pSV.locator('[data-resetmode]').getAttribute('data-resetmode'))==="factory" &&
    (await pSV.locator('[data-resetpick="time"]').getAttribute('data-locked'))==="1");
  t("the words under the picks keep one height (steady-box rule)", Math.abs((await pSV.locator('[data-resetmode]').evaluate(e=>e.getBoundingClientRect().height))-hReset)<1);
  await pSV.locator('[data-resetpick="look"]').click(); await pSV.waitForTimeout(200);
  t("changing a tick makes it a custom mix", (await pSV.locator('[data-resetmode]').getAttribute('data-resetmode'))==="custom");
  await pSV.locator('[data-resetchip="state"]').click(); await pSV.waitForTimeout(250);
  await holdSV('[data-resetgo]'); await pSV.waitForTimeout(1800); await dropSplash(pSV); await pSV.waitForTimeout(500);
  let sv=await lsSV();
  t("reset state clears the time and the ticks, keeping the project", sv.logs===0 && sv.done===false);
  let ids=await idsSV();
  t("and a Before reset backup was taken first", ids.indexOf('latest|before-reset')>=0 && ids.some(x=>/^daily-.*\|before-reset$/.test(x)));
  await sheetSV();
  await pSV.locator('[data-snapload^="save-"]').first().click(); await pSV.waitForTimeout(500);
  await holdSV('[data-loadgo]'); await pSV.waitForTimeout(1800); await dropSplash(pSV); await pSV.waitForTimeout(500);
  sv=await lsSV();
  t("loading the save puts the time and the ticks back", sv.logs===3 && sv.done===true);
  ids=await idsSV();
  t("after its own Before load backup", ids.indexOf('latest|before-load')>=0 && ids.indexOf('latest|before-reset')<0);
  // Clocked in: nothing loads or resets. Clocking out takes the day's copy.
  await pSV.evaluate(()=>{ const s=JSON.parse(localStorage.getItem('tt_session')||'{}'); s.savedAt=Date.now(); s.atWorkStart=Date.now()-3600e3; localStorage.setItem('tt_session', JSON.stringify(s));
    const L=JSON.parse(localStorage.getItem('tt_logs')); L.push({ id:"aw1", type:"atwork", startTime:s.atWorkStart, endTime:null, duration:0 });
    localStorage.setItem('tt_logs', JSON.stringify(L)); });
  await goSV();
  await sheetSV();
  t("while clocked in, Reset and Load are off and it says why", (await pSV.locator('[data-resetopen]').isDisabled()) &&
    (await pSV.locator('[data-snapload="latest"]').isDisabled()) && (await pSV.locator('[data-clockedout]').count())===1);
  await pSV.locator('[data-modal-panel]').last().locator('button').filter({hasText:/^Close$/}).click(); await pSV.waitForTimeout(300);
  await pSV.locator('[data-anchor="hdr-menu"]').first().click(); await pSV.waitForTimeout(300);
  await pSV.locator('button').filter({hasText:/Clock Out/}).first().click(); await pSV.waitForTimeout(2000);
  ids=await idsSV();
  t("clocking out takes the day's automatic backup", ids.indexOf('latest|clockout')>=0 && ids.some(x=>/^weekly-.*\|clockout$/.test(x)) && ids.some(x=>/^monthly-.*\|clockout$/.test(x)));
  t("which holds the finished day", await pSV.evaluate(()=>snapGet('latest').then(snapUnpack).then(j=>JSON.parse(JSON.parse(j).tt_logs).some(l=>l.id==="aw1"&&l.endTime>0))));
  t("with no page errors", errsSV===0);
  await pSV.close(); await ctxSV.close();

  // ---- breaks, 10-22 (v1.3): the header tag, paid/unpaid, missed, overage, resume ----
  {
    const mk=async(seed)=>{
      const pg=await b.newPage({viewport:{width:390,height:900}});
      pg.__errs=0; pg.on('pageerror',()=>{ pg.__errs++; });
      await pg.addInitScript((a)=>{
        if(sessionStorage.getItem('bkSeeded')) return; sessionStorage.setItem('bkSeeded','1');
        const now=Date.now(), day=new Date(now).toDateString();
        const d=new Date(now-a.dueAgo*60000), hhmm=String(d.getHours()).padStart(2,'0')+":"+String(d.getMinutes()).padStart(2,'0');
        const sch={}; ["mon","tue","wed","thu","fri","sat","sun"].forEach(k=>{ sch[k]={on:true,start:"00:00",end:"23:59"}; });
        sch.unpaidBreaks={ enabled:true, weekly:[{ id:"mb", name:"Morning Break", start:hhmm, mins:15, paid:true, note:"" }], custom:{},
          allowMode:"scheduled", allowMins:0, carryOver:false, overStyle:"float" };
        localStorage.setItem('tt_settings', JSON.stringify({layout:'comfortable',tracking:'timer',colorScheme:'bright-pastels',theme:'neon-dream',
          schemes:{},fonts:{},mode:'dark',handedness:'right',headerPos:'top',workSchedule:sch,shiftGrace:0}));
        localStorage.setItem('tt_projects', JSON.stringify([{id:1,name:"Line 4 Rebuild",lane:"Daily Activity",notes:"",order:0,parentId:null,role:"project",kind:"ongoing",stages:[]}]));
        localStorage.setItem('tt_laneorder', JSON.stringify(['Daily Activity']));
        const aw=now-3*3600000;
        localStorage.setItem('tt_logs', JSON.stringify([{ id:"aw1", type:"atwork", day:day, startTime:aw, endTime:null, duration:0 }]));
        const sess={ savedAt:now, atWorkStart:aw, workDay:day, activeId:null, activeStart:null };
        if(a.onBreakMins){
          const bs=now-a.onBreakMins*60000;
          localStorage.setItem('tt_breaks', JSON.stringify([{ id:"ob1", day:day, label:"Morning Break", paid:true, fromId:1, startTime:bs, endTime:null, duration:0 }]));
          sess.breakStart=bs; sess.breakLabel="Morning Break";
        } else {
          sess.activeId=1; sess.activeStart=now-90000;
          localStorage.setItem('tt_logs', JSON.stringify([{ id:"aw1", type:"atwork", day:day, startTime:aw, endTime:null, duration:0 }]));
        }
        localStorage.setItem('tt_session', JSON.stringify(sess));
      }, seed);
      await pg.goto('file:///tmp/e2e.html',{waitUntil:'load'}); await dropSplash(pg); await pg.waitForTimeout(700);
      return pg;
    };
    const brks=async(pg)=>pg.evaluate(()=>JSON.parse(localStorage.getItem('tt_breaks')||'[]'));
    const running=async(pg)=>pg.locator('[data-surface="lane"] button').filter({hasText:/^Stop$/}).count();

    // 1. clocked in with a job running, the scheduled paid break twenty minutes overdue
    const pB=await mk({ dueAgo:20 });
    t("clocked in, the header status line carries Break ›", /Break ›/.test(await pB.locator('[data-breaktag]').innerText().catch(()=>"")));
    t("a scheduled break gone by untaken raises the missed banner", /Morning Break/.test(await pB.locator('[data-missedbreak]').innerText().catch(()=>"")));
    await pB.locator('[data-missedact="skip"]').click(); await pB.waitForTimeout(400);
    t("Skip today clears it", (await pB.locator('[data-missedbreak]').count())===0);
    let L=await brks(pB);
    const miss=L.filter(x=>x.missed)[0];
    t("and records the break as missed", !!miss && miss.missedKey && miss.paid===true && !miss.duration);
    t("a fact, not a personal record", !!miss && !miss.personal);
    await pB.reload({waitUntil:'load'}); await dropSplash(pB); await pB.waitForTimeout(700);
    t("and it stays dismissed after a reload", (await pB.locator('[data-missedbreak]').count())===0);
    t("the job is still running", (await running(pB))>0);
    await pB.locator('[data-statustap]').click(); await pB.waitForTimeout(400);
    t("tapping the status line opens the break sheet", (await pB.locator('[data-breakgo="paid"]').count())===1);
    t("with the usual break tagged PAID from the schedule", /PAID/.test(await pB.locator('[data-breakpreset]').first().innerText().catch(()=>"")));
    await pB.locator('[data-breakgo="paid"]').click(); await pB.waitForTimeout(500);
    L=await brks(pB);
    const open=L.filter(x=>!x.endTime)[0];
    t("Paid break starts a paid break at once", !!open && open.paid===true);
    t("remembering the job it stopped", !!open && open.fromId===1);
    t("and the job stops", (await running(pB))===0);
    t("the tag now reads End ›", /End ›/.test(await pB.locator('[data-breaktag]').innerText().catch(()=>"")));
    await pB.locator('[data-statustap]').click(); await pB.waitForTimeout(500);
    t("ending it, within the paid time, asks nothing about overage", (await pB.locator('[data-overact]').count())===0);
    t("and offers the job back by name", /Line 4 Rebuild/.test(await pB.locator('[data-resume="job"]').innerText().catch(()=>"")));
    await pB.locator('[data-resume="job"]').click(); await pB.waitForTimeout(500);
    t("Resume starts it again", (await running(pB))>0);
    t("and the break is closed", (await brks(pB)).every(x=>!!x.endTime));
    t("with no page errors", pB.__errs===0);
    await pB.close();

    // 2. on a paid break twenty minutes in, with fifteen to spend
    const pO=await mk({ dueAgo:40, onBreakMins:20 });
    t("past the paid time, the overage shows live", (await pO.locator('[data-breakover]').count())===1);
    t("no missed-break banner while on a break", (await pO.locator('[data-missedbreak]').count())===0);
    await pO.locator('[data-statustap]').click(); await pO.waitForTimeout(500);
    t("ending it asks about the overage three ways", (await pO.locator('[data-overact]').count())===3);
    t("beside the rules note", (await pO.locator('[data-modal-panel] [data-breakrules]').count())>=1);
    await pO.locator('[data-overact="unpaid"]').click(); await pO.waitForTimeout(500);
    L=await brks(pO);
    const ob=L.filter(x=>x.id==="ob1")[0];
    t("the overage is recorded", !!ob && ob.overMs>=4*60000 && ob.overMs<=6*60000);
    t("made unpaid, it is a personal record", !!ob && ob.overUnpaid===true && ob.personal===true);
    t("then the job is offered back", (await pO.locator('[data-resume="job"]').count())===1);
    await pO.locator('[data-resume="none"]').click(); await pO.waitForTimeout(300);
    t("Not yet leaves it stopped", (await running(pO))===0 && (await pO.locator('[data-resume]').count())===0);
    // Reports: tagged PERSONAL
    await pO.locator('[data-anchor="hdr-menu"]').first().click(); await pO.waitForTimeout(300);
    await pO.locator('button').filter({hasText:/^Reports$/}).first().click(); await pO.waitForTimeout(700);
    t("Reports split the breaks", /Paid 15m/.test(await pO.locator('[data-breaknote]').innerText().catch(()=>"")));
    t("and tag the personal record", /PERSONAL/.test(await pO.locator('[data-personalnote]').innerText().catch(()=>"")));
    t("with no page errors", pO.__errs===0);
    await pO.close();

    // 3. Change my allowance opens the breaks editor
    const pC=await mk({ dueAgo:40, onBreakMins:20 });
    await pC.locator('[data-statustap]').click(); await pC.waitForTimeout(500);
    await pC.locator('[data-overact="change"]').click(); await pC.waitForTimeout(600);
    t("Change my allowance opens Scheduled Breaks at the paid time", (await pC.locator('[data-anchor="ub-allow"]').count())===1);
    const oc=(await brks(pC)).filter(x=>x.id==="ob1")[0];
    t("and keeps the overage paid for the day", !!oc && oc.overCovered===true && !oc.personal);
    t("with no page errors", pC.__errs===0);
    await pC.close();
  }

  await b.close();
  let bad=0; ok.forEach(([l,p])=>{ if(!p){ bad++; console.log("   x "+l); } });
  console.log("e2e        : "+(ok.length-bad)+"/"+ok.length+" passed"+(bad?"  FAILED":""));
  process.exit(bad?1:0);
})();
