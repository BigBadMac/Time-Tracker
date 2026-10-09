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
  await p6.locator('button').filter({hasText:/^Interactive Tutorial$/}).first().click();
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
  await p6.locator('button').filter({hasText:/^Interactive Tutorial$/}).first().click();
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
  // No Add New row; the tutorial leads.
  await p18.locator('button:has(path[d="M4 8H24 M4 14H24 M4 20H24"])').first().click(); await p18.waitForTimeout(400);
  const rows18=await p18.evaluate(()=>[...document.querySelectorAll('[data-menu-open="1"] button')].map(b=>b.innerText.trim().split("\n")[0]).filter(Boolean));
  t("the settings menu has no Add New row", !rows18.some(r=>/Add New/i.test(r)));
  t("and the tutorial is the first row", /Tutorial/i.test(rows18[0]||''));
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
  await p20.goto('file:///tmp/e2e.html',{waitUntil:'load'}); await dropSplash(p20); await p20.waitForTimeout(900);
  const mine20=()=>p20.evaluate(()=>JSON.parse(localStorage.getItem('tt_test_projects')||'[]').some(x=>x.id===9001));
  await p20.evaluate(()=>{ const P=JSON.parse(localStorage.getItem('tt_test_projects'));
    P.push({id:9001,name:'MY practice job',lane:P[0].lane,notes:'',order:99,parentId:null,role:'project',kind:'finite',stages:[]});
    localStorage.setItem('tt_test_projects', JSON.stringify(P)); });
  await p20.reload({waitUntil:'load'}); await dropSplash(p20); await p20.waitForTimeout(900);
  const openExit20=async()=>{ await p20.locator('button:has(path[d="M4 8H24 M4 14H24 M4 20H24"])').first().click(); await p20.waitForTimeout(350);
    await p20.locator('button').filter({hasText:/Exit Tutorial/}).first().click(); await p20.waitForTimeout(500); };
  await openExit20();
  t("the exit sheet says leaving keeps what you built", /keeps everything you have built/i.test(await p20.locator('[data-modal-panel]').last().innerText()));
  await p20.locator('[data-confirmexit]').click(); await p20.waitForTimeout(600);
  t("leaving the tutorial keeps your work", await mine20());
  await p20.locator('button:has(path[d="M4 8H24 M4 14H24 M4 20H24"])').first().click(); await p20.waitForTimeout(350);
  await p20.locator('button').filter({hasText:/Interactive Tutorial/}).first().click(); await p20.waitForTimeout(700);
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

  await b.close();
  let bad=0; ok.forEach(([l,p])=>{ if(!p){ bad++; console.log("   x "+l); } });
  console.log("e2e        : "+(ok.length-bad)+"/"+ok.length+" passed"+(bad?"  FAILED":""));
  process.exit(bad?1:0);
})();
