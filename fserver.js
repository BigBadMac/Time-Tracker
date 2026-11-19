// A stand-in for the fb_* functions in db/06_support.sql, written from those
// rules (not from the app). Used by e2e.js and the screenshot script.
function FServer(){
  const users = {}, staff = {}, items = [], msgs = [], seen = {};
  let clock = Date.parse("2026-11-17T09:00:00Z"), nid = 1, mid = 1;
  const iso = () => new Date(clock).toISOString();
  const tick = (ms) => { clock += ms || 1000; };
  const err = (status, code, message) => ({ status, body: { code, message } });
  const role = (u) => staff[u] ? staff[u].role : null;
  const access = (f, u) => { const r = role(u); if (r === "owner") return "owner"; if (r === "helper" && f.assignee === u) return "helper"; if (f.user_id === u) return "reporter"; return null; };
  const seenAt = (u, id) => seen[u + "|" + id] || "";
  const unread = (f, viewer, u) => {
    const at = seenAt(u, f.id);
    if (viewer !== "reporter" && f.user_id !== u && f.created_at > at) return true;
    return msgs.some((m) => m.feedback_id === f.id && m.created_at > at && m.author !== u &&
      (viewer === "reporter" ? (m.by_staff && !m.internal) : (!m.by_staff || !m.event)));
  };
  const itemJson = (f, viewer, u) => {
    const o = { id: f.id, kind: f.kind, body: f.body, status: f.status, fixed_in: f.fixed_in, created_at: f.created_at, last_at: f.last_at,
      unread: unread(f, viewer, u), replies: msgs.filter((m) => m.feedback_id === f.id && !m.event && (viewer !== "reporter" || !m.internal)).length, app: f.app };
    if (viewer !== "reporter") Object.assign(o, { priority: f.priority, tags: f.tags, assignee: f.assignee, assignee_name: f.assignee && staff[f.assignee] ? staff[f.assignee].name : null,
      reporter: users[f.user_id] && users[f.user_id].email, mine: f.user_id === u });
    return o;
  };
  const who = (m, viewer) => m.by_staff ? (staff[m.author] ? staff[m.author].name : "Hiatt Studios") : (viewer === "reporter" ? "You" : (users[m.author] && users[m.author].email) || "Reporter");
  const mark = (u, id) => { tick(1); seen[u + "|" + id] = iso(); };
  const addMsg = (o) => { tick(1); const m = Object.assign({ id: mid++, internal: false, event: null, body: "", created_at: iso() }, o); msgs.push(m); return m; };
  const faq = [], votes = {}, sugs = [];
  const faqJson = (f, isStaff, u) => {
    const o = { id: f.id, question: f.question, answer: f.answer, topic: f.topic, guide: f.guide, updated_at: f.updated_at, my: (u && (u + "|" + f.id) in votes) ? votes[u + "|" + f.id] : null };
    if (isStaff) Object.assign(o, { published: f.published, sort: f.sort, source: f.source,
      yes: Object.keys(votes).filter((k) => k.endsWith("|" + f.id) && votes[k]).length, no: Object.keys(votes).filter((k) => k.endsWith("|" + f.id) && !votes[k]).length });
    return o;
  };
  const api = {
    items, msgs, staff, users, tick, faq, sugs, votes,
    // as Claude would, through the database connector (support.suggest)
    suggest(question, answer, topic, asked, guide){ const sg = { id: "sg" + (nid++), question, answer, topic: topic || "General", guide: guide || null, asked: asked || 1, sources: [], status: "suggested", created_by: "claude", created_at: iso() }; sugs.push(sg); return sg.id; },
    user(tok, id, email){ users[id] = { id, email }; api.toks[tok] = id; }, toks: {},
    setStaff(id, r, name){ if (r) staff[id] = { role: r, name }; else delete staff[id]; },
    // what a staff member would do from the inbox, done directly for tests
    staffReply(sid, id, body, internal){ const f = items.find((x) => x.id === id); addMsg({ feedback_id: id, author: sid, by_staff: true, internal: !!internal, body });
      if (!internal) { if (f.status === "new") f.status = "open"; f.last_at = iso(); } },
    staffStatus(sid, id, st, fixedIn){ const f = items.find((x) => x.id === id); if (f.status !== st) { f.status = st; f.last_at = iso(); addMsg({ feedback_id: id, author: sid, by_staff: true, event: "status:" + st }); } if (fixedIn !== undefined) f.fixed_in = fixedIn; },
    handle(u, path, body){
      const name = path.replace("/rest/v1/rpc/", ""); body = body || {};
      if (name === "faq_list") return { status: 200, body: faq.filter((f) => f.published).sort((x, y) => (x.topic + x.sort + x.question) < (y.topic + y.sort + y.question) ? -1 : 1).map((f) => faqJson(f, false, u)) };
      if (!u) return { status: 401, body: null };
      tick(1);
      if (name === "fb_unread") {
        const r = role(u);
        return { status: 200, body: { mine: items.filter((f) => f.user_id === u && unread(f, "reporter", u)).length, staff: r,
          inbox: r ? items.filter((f) => f.user_id !== u && ["owner", "helper"].includes(access(f, u)) && unread(f, "staff", u)).length : 0 } };
      }
      if (name === "fb_send") {
        const b = String(body.body || "").trim();
        if (!b) return err(400, "22023", "write something first");
        if (b.length > 4000) return err(400, "22001", "too long");
        if (!["problem", "idea", "question", "praise"].includes(body.kind)) return err(400, "23514", "check");
        if (items.filter((f) => f.user_id === u && clock - Date.parse(f.created_at) < 3600e3).length >= 5) return err(400, "54000", "too many sent for now - try again later");
        const f = { id: "f" + (nid++), user_id: u, kind: body.kind, body: b, app: body.app || null, status: "new", priority: "normal", assignee: null, tags: [], fixed_in: null, created_at: iso(), last_at: iso() };
        items.push(f); mark(u, f.id); return { status: 200, body: f.id };
      }
      if (name === "fb_mine") return { status: 200, body: items.filter((f) => f.user_id === u).sort((a, b) => b.last_at < a.last_at ? -1 : 1).map((f) => itemJson(f, "reporter", u)) };
      if (name === "fb_thread") {
        const f = items.find((x) => x.id === body.id), a = f && access(f, u);
        if (!a) return err(400, "P0002", "not found");
        const out = { item: itemJson(f, a, u), as: a, messages: msgs.filter((m) => m.feedback_id === f.id && (a !== "reporter" || !m.internal))
          .map((m) => ({ id: m.id, by_staff: m.by_staff, internal: m.internal, event: m.event, body: m.body, at: m.created_at, who: who(m, a), mine: m.author === u })) };
        mark(u, f.id); return { status: 200, body: out };
      }
      if (name === "fb_reply") {
        const f = items.find((x) => x.id === body.id), a = f && access(f, u), b = String(body.body || "").trim();
        if (!a) return err(400, "P0002", "not found");
        if (!b) return err(400, "22023", "write something first");
        if (a === "reporter" && body.internal) return err(403, "42501", "not allowed");
        const m = addMsg({ feedback_id: f.id, author: u, by_staff: a !== "reporter", internal: !!body.internal && a !== "reporter", body: b });
        if (a === "reporter" && ["waiting", "fixed", "closed"].includes(f.status)) { f.status = "open"; addMsg({ feedback_id: f.id, author: u, by_staff: false, event: "status:open" }); }
        else if (a !== "reporter" && f.status === "new" && !body.internal) f.status = "open";
        if (!(body.internal && a !== "reporter")) f.last_at = iso();
        mark(u, f.id); return { status: 200, body: m.id };
      }
      if (/^fb_(inbox|update|delete|team|team_set)$/.test(name) && !role(u)) return err(403, "42501", "not allowed");
      if (name === "fb_inbox") {
        const q = body.q || {}, who = q.who || "all", t = String(q.text || "").toLowerCase();
        return { status: 200, body: items.filter((f) => ["owner", "helper"].includes(access(f, u)))
          .filter((f) => who === "all" || (who === "me" && f.assignee === u) || (who === "none" && !f.assignee))
          .filter((f) => !t || f.body.toLowerCase().includes(t) || msgs.some((m) => m.feedback_id === f.id && m.body.toLowerCase().includes(t)))
          .sort((a, b) => b.last_at < a.last_at ? -1 : 1).map((f) => itemJson(f, role(u), u)) };
      }
      if (name === "fb_update") {
        const f = items.find((x) => x.id === body.id), a = f && access(f, u), ch = body.ch || {};
        if (!a || a === "reporter") return err(400, "P0002", "not found");
        if ("status" in ch && ch.status !== f.status) { f.status = ch.status; f.last_at = iso(); addMsg({ feedback_id: f.id, author: u, by_staff: true, event: "status:" + ch.status }); }
        if ("fixed_in" in ch) f.fixed_in = String(ch.fixed_in || "").trim() || null;
        if ("priority" in ch) f.priority = ch.priority;
        if ("assignee" in ch) {
          if (a !== "owner") return err(403, "42501", "only an owner assigns");
          const nv = ch.assignee || null;
          if (nv && !staff[nv]) return err(400, "22023", "not on the team");
          if (nv !== f.assignee) { f.assignee = nv; addMsg({ feedback_id: f.id, author: u, by_staff: true, internal: true, event: "assign:" + (nv || "none") }); }
        }
        return { status: 200, body: itemJson(f, a, u) };
      }
      if (name === "fb_delete") {
        if (role(u) !== "owner") return err(403, "42501", "not allowed");
        const i = items.findIndex((x) => x.id === body.id); if (i >= 0) items.splice(i, 1);
        return { status: 200, body: i >= 0 };
      }
      if (name === "fb_team") return { status: 200, body: Object.keys(staff).map((id) => ({ user_id: id, role: staff[id].role, name: staff[id].name, email: users[id] && users[id].email, me: id === u })) };
      if (name === "fb_team_set") {
        if (role(u) !== "owner") return err(403, "42501", "not allowed");
        const id = Object.keys(users).find((k) => users[k].email.toLowerCase() === String(body.email || "").trim().toLowerCase());
        if (!id) return err(400, "P0002", "nobody has signed in with that email yet");
        if (body.role) staff[id] = { role: body.role, name: body.name || (staff[id] && staff[id].name) || body.email.split("@")[0] };
        else { if (staff[id] && staff[id].role === "owner") return err(400, "22023", "the team needs an owner"); items.forEach((f) => { if (f.assignee === id) f.assignee = null; }); delete staff[id]; }
        return api.handle(u, "/rest/v1/rpc/fb_team", {});
      }
      // ---- FAQ, from db/08_faq.sql ----
      if (name === "faq_vote") {
        const f = faq.find((x) => x.id === body.id && x.published); if (!f) return err(400, "P0002", "not found");
        const k = u + "|" + f.id; if (body.helpful == null) delete votes[k]; else votes[k] = !!body.helpful;
        return { status: 200, body: true };
      }
      if (/^faq_(all|save|delete|suggestions|suggestion_set)$/.test(name) && !role(u)) return err(403, "42501", "not allowed");
      if (name === "faq_all") return { status: 200, body: faq.map((f) => faqJson(f, true, u)) };
      if (name === "faq_save") {
        const e = body.e || {}, q = String(e.question || "").trim(), a = String(e.answer || "").trim();
        if (q.length < 3 || !a) return err(400, "22023", "a question and an answer are both needed");
        let f = body.id ? faq.find((x) => x.id === body.id) : null;
        if (body.id && !f) return err(400, "P0002", "not found");
        if ("published" in e && role(u) !== "owner" && !!e.published !== !!(f && f.published)) return err(403, "42501", "only an owner publishes");
        let src = null;
        if (e.source) { src = items.find((x) => x.id === e.source); if (!src || !["owner", "helper"].includes(access(src, u))) return err(400, "P0002", "not found"); }
        const pub = ("published" in e && role(u) === "owner") ? !!e.published : !!(f && f.published);
        if (!f) { f = { id: "faq" + (nid++), created_at: iso() }; faq.push(f); }
        Object.assign(f, { question: q, answer: a, topic: String(e.topic || "").trim() || "General", guide: e.guide || null, sort: e.sort || 0, published: pub, source: src ? src.id : (f.source || null), updated_at: iso() });
        if (e.notify && f.published && f.source && !msgs.some((m) => m.feedback_id === f.source && m.event === "faq:added")) {
          addMsg({ feedback_id: f.source, author: u, by_staff: true, event: "faq:added", body: "Thanks for asking. It’s now in the FAQ: “" + f.question + "”" });
          items.find((x) => x.id === f.source).last_at = iso();
        }
        if (e.suggestion) { const sg = sugs.find((x) => x.id === e.suggestion); if (sg) { sg.status = "accepted"; sg.faq_id = f.id; } }
        return { status: 200, body: faqJson(f, true, u) };
      }
      if (name === "faq_delete") {
        if (role(u) !== "owner") return err(403, "42501", "only an owner deletes");
        const i = faq.findIndex((x) => x.id === body.id); if (i >= 0) faq.splice(i, 1);
        return { status: 200, body: i >= 0 };
      }
      if (name === "faq_suggestions") return { status: 200, body: sugs.filter((x) => x.status === "suggested").sort((a, b) => b.asked - a.asked) };
      if (name === "faq_suggestion_set") {
        if (!["suggested", "dismissed"].includes(body.status)) return err(400, "22023", "not allowed");
        const sg = sugs.find((x) => x.id === body.id && x.status !== "accepted"); if (sg) sg.status = body.status;
        return { status: 200, body: !!sg };
      }
      return { status: 404, body: { code: "PGRST202", message: "Could not find the function" } };
    }
  };
  return api;
}
if (typeof module !== "undefined") module.exports = FServer;
