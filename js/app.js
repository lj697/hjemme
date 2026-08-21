let state = loadState();
let view = "home";
let sheet = null;
let photoId = null;
let selectedDay = todayIso();
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
let calMode = "days";
let boughtOpen = false;
let paperPeekId = null;
let keepShopFocus = false;
let setupPanel = "start";
let showShareCode = false;
let setupBusy = false;
let setupError = "";
let copiedCode = false;
let joinCodeDraft = "";

const app = document.getElementById("app");

function persist() {
  try {
    saveState(state);
  } catch {
    window.alert("Der er ikke plads til flere billeder i denne prototype. Slet et listebillede og prøv igen.");
  }
  HjemmeSync.push(state);
}

function syncStatus() {
  return HjemmeSync.getStatus();
}

function isTyping() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function applyCloudData(data) {
  const memberId = state.currentMemberId;
  const photos = state.listPhotos || [];
  state = migrate({
    ...data,
    listPhotos: photos,
    currentMemberId: memberId,
    householdId: data.householdId || state.householdId,
    setupDone: true
  });
  if (state.currentMemberId && !memberById(state.currentMemberId)) {
    state.currentMemberId = null;
  }
  saveState(state);
}

function firebaseErrorText(err, fallback) {
  const code = err?.message || err?.code || "";
  if (code === "not-found" || code === "bad-code") return "Koden findes ikke. Tjek at den er skrevet rigtigt.";
  if (code === "not-ready") return "Firebase er ikke klar endnu. Tjek js/firebase-config.js.";
  return syncStatus().message || fallback;
}

function memberById(id) {
  return state.members.find((m) => m.id === id) || null;
}

function me() {
  return memberById(state.currentMemberId) || state.members[0] || null;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function initials(name) {
  const parts = String(name).trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

function avatar(member, size = "") {
  if (!member) return `<span class="avatar avatar-empty ${size}">?</span>`;
  return `<span class="avatar ${size}" style="background:${member.color}">${escapeHtml(initials(member.name))}</span>`;
}

function eventAssigneeIds(event) {
  if (Array.isArray(event.assigneeIds) && event.assigneeIds.length) return event.assigneeIds;
  if (event.assigneeId) return [event.assigneeId];
  return [];
}

function eventPeople(event) {
  return eventAssigneeIds(event).map(memberById).filter(Boolean);
}

function eventPeopleLabel(event) {
  return eventPeople(event)
    .map((p) => p.name)
    .join(", ");
}

function avatarStack(event) {
  const people = eventPeople(event);
  if (!people.length) return `<span class="avatar avatar-empty sm">?</span>`;
  return `<span class="avatars">${people.map((p) => avatar(p, "sm")).join("")}</span>`;
}

function eventForPerson(event, memberId) {
  if (!memberId) return true;
  const ids = eventAssigneeIds(event);
  if (!ids.length) return true;
  return ids.includes(memberId);
}

function dayMarkerDots(iso) {
  const events = eventsOn(state, iso);
  if (!events.length) return "";
  const involved = new Set();
  let unassigned = false;
  for (const event of events) {
    const ids = eventAssigneeIds(event);
    if (!ids.length) unassigned = true;
    ids.forEach((id) => involved.add(id));
  }
  const dots = state.members
    .filter((m) => involved.has(m.id))
    .map((m) => `<span class="cal-dot" style="background:${m.color}"></span>`);
  if (unassigned) dots.push('<span class="cal-dot empty"></span>');
  return `<span class="cal-dots">${dots.join("")}</span>`;
}

function openCount(list, pred) {
  return list.filter(pred).length;
}

function addShopItem(text, assigneeId = null) {
  const name = text.trim();
  if (!name) return false;
  const existing = state.shopping.find((s) => s.text.toLowerCase() === name.toLowerCase());
  if (existing) {
    existing.done = false;
    if (assigneeId) existing.assigneeId = assigneeId;
    return true;
  }
  state.shopping.unshift({
    id: uid(),
    text: name,
    done: false,
    assigneeId,
    createdAt: Date.now()
  });
  return true;
}

function toggleNamedShopItem(text) {
  const name = text.trim();
  const open = state.shopping.find((s) => s.text.toLowerCase() === name.toLowerCase() && !s.done);
  if (open) {
    state.shopping = state.shopping.filter((s) => s.id !== open.id);
    return;
  }
  addShopItem(name);
}

function render() {
  if (!state.setupDone) {
    app.innerHTML = renderSetup();
    bindSetup();
    return;
  }
  if (showShareCode && state.householdId) {
    app.innerHTML = renderShareCode();
    bindShareCode();
    return;
  }
  if (!memberById(state.currentMemberId) && state.members.length) {
    app.innerHTML = renderPickMe();
    bindPickMe();
    return;
  }
  app.innerHTML = `
    <div class="shell">
      ${renderHeader()}
      <main class="main">${renderView()}</main>
      ${renderNav()}
    </div>
    ${sheet ? renderSheet() : ""}
  `;
  bindMain();
}

function renderSetup() {
  if (setupPanel === "join") return renderJoin();
  if (setupPanel === "help") return renderFirebaseHelp();
  if (setupPanel === "create") return renderCreate();
  const configured = HjemmeSync.isConfigured();
  const status = syncStatus();
  return `
    <section class="setup">
      <p class="eyebrow">Husstand</p>
      <h1>Hjemme</h1>
      <p class="lede">Indkøb, pligter og en fælles kalender I begge kan bruge.</p>
      <div class="setup-actions">
        <button type="button" class="btn btn-primary" id="go-create">Opret husstand</button>
        <button type="button" class="btn" id="go-join">Tilslut med kode</button>
        <button type="button" class="text-btn" id="use-demo">Prøv med eksempel på denne telefon</button>
      </div>
      ${
        configured
          ? `<p class="sync-line ${status.kind === "error" ? "warn" : status.kind === "live" || status.kind === "ready" ? "live" : ""}">${escapeHtml(status.message || "Firebase er sat op.")}</p>`
          : `<div class="setup-note">
              <p class="hint">For at dele listen mellem telefoner skal Firebase sættes op én gang.</p>
              <button type="button" class="text-btn" id="go-help">Vis hvordan</button>
            </div>`
      }
    </section>
  `;
}

function renderCreate() {
  const rows = state.members
    .map(
      (m) => `
      <li class="chip-row">
        ${avatar(m)}
        <span>${escapeHtml(m.name)}</span>
        <button type="button" class="icon-btn" data-remove-member="${m.id}" aria-label="Fjern">×</button>
      </li>`
    )
    .join("");
  return `
    <section class="setup">
      <p class="eyebrow">Ny husstand</p>
      <h1>Hvem bor her?</h1>
      <p class="lede">Tilføj jer selv, så I kan fordele indkøb og pligter.</p>
      <label>
        Husstandens navn
        <input id="house-name" value="${escapeHtml(state.householdName === "Hjemme" ? "" : state.householdName)}" placeholder="fx Familien">
      </label>
      <label>
        Tilføj person
        <div class="add-row">
          <input id="member-name" placeholder="Navn">
          <button type="button" class="btn" id="add-member">Tilføj</button>
        </div>
      </label>
      <ul class="chip-list">${rows || `<li class="hint">Tilføj mindst to personer.</li>`}</ul>
      ${setupError ? `<p class="sync-line warn">${escapeHtml(setupError)}</p>` : ""}
      <button type="button" class="btn btn-primary" id="start-empty" ${state.members.length < 2 || setupBusy ? "disabled" : ""}>${setupBusy ? "Opretter…" : "Kom i gang"}</button>
      <button type="button" class="text-btn" id="back-start">Tilbage</button>
    </section>
  `;
}

function renderJoin() {
  const ready = HjemmeSync.isReady();
  const configured = HjemmeSync.isConfigured();
  return `
    <section class="setup">
      <p class="eyebrow">Tilslut</p>
      <h1>Indtast koden</h1>
      <p class="lede">Den står under Husstand og data på den anden telefon.</p>
      ${
        configured
          ? `<label>
        Husstandskode
        <input id="join-code" class="code-input" maxlength="8" autocapitalize="characters" autocomplete="off" placeholder="XXXXXX" value="${escapeHtml(joinCodeDraft)}">
      </label>
      ${setupError ? `<p class="sync-line warn">${escapeHtml(setupError)}</p>` : ""}
      ${!ready ? `<p class="sync-line">${escapeHtml(syncStatus().message || "Forbinder til Firebase…")}</p>` : ""}
      <button type="button" class="btn btn-primary" id="do-join" ${setupBusy || !ready ? "disabled" : ""}>${setupBusy ? "Tilslutter…" : "Tilslut"}</button>`
          : `<p class="hint">Firebase er ikke sat op på denne enhed endnu. Brug den samme firebase-config som den anden telefon.</p>
             <button type="button" class="text-btn" id="go-help">Vis hvordan</button>`
      }
      <button type="button" class="text-btn" id="back-start">Tilbage</button>
    </section>
  `;
}

function renderFirebaseHelp() {
  return `
    <section class="setup">
      <p class="eyebrow">Firebase</p>
      <h1>Sæt deling op</h1>
      <p class="lede">Det gøres én gang på computeren. Bagefter kan I begge bruge samme husstand.</p>
      <div class="setup-note">
        <ol>
          <li>Gå til <strong>console.firebase.google.com</strong> og opret et projekt.</li>
          <li>Tilføj en <strong>web-app</strong> og kopier <code>firebaseConfig</code> ind i <code>js/firebase-config.js</code>.</li>
          <li>Slå <strong>Authentication → Anonymous</strong> til.</li>
          <li>Opret <strong>Firestore Database</strong> og indsæt reglerne fra filen <code>firestore.rules</code>.</li>
        </ol>
      </div>
      <p class="hint">Genindlæs appen, når værdierne er gemt. Localhost virker til test; på telefonerne skal appen ligge på HTTPS.</p>
      <button type="button" class="text-btn" id="back-start">Tilbage</button>
    </section>
  `;
}

function renderShareCode() {
  return `
    <section class="setup">
      <p class="eyebrow">Klar</p>
      <h1>Inviter den anden telefon</h1>
      <p class="lede">Åbn Hjemme dér, og vælg Tilslut med kode.</p>
      <div class="code-box">
        <strong>${escapeHtml(state.householdId)}</strong>
        <button type="button" class="btn" id="copy-code">${copiedCode ? "Kopieret" : "Kopiér"}</button>
      </div>
      <p class="hint">Papirfotos af indkøbslister bliver på den telefon, der tager billedet. Alt andet deles.</p>
      <button type="button" class="btn btn-primary" id="continue-share">Fortsæt</button>
    </section>
  `;
}

function renderPickMe() {
  return `
    <section class="setup">
      <p class="eyebrow">${escapeHtml(state.householdName)}</p>
      <h1>Hvem er du?</h1>
      <p class="lede">Valget gemmes kun på denne telefon.</p>
      <div class="setup-actions">
        ${state.members
          .map(
            (m) =>
              `<button type="button" class="btn" data-pick-me="${m.id}">${avatar(m)} ${escapeHtml(m.name)}</button>`
          )
          .join("")}
      </div>
    </section>
  `;
}

function bindSetup() {
  document.getElementById("go-create")?.addEventListener("click", () => {
    setupPanel = "create";
    setupError = "";
    render();
  });
  document.getElementById("go-join")?.addEventListener("click", () => {
    setupPanel = "join";
    setupError = "";
    render();
  });
  document.getElementById("go-help")?.addEventListener("click", () => {
    setupPanel = "help";
    render();
  });
  document.getElementById("back-start")?.addEventListener("click", () => {
    setupPanel = "start";
    setupError = "";
    render();
  });
  document.getElementById("use-demo")?.addEventListener("click", () => {
    state = demoState();
    persist();
    view = "home";
    selectedDay = todayIso();
    render();
  });
  document.getElementById("add-member")?.addEventListener("click", addSetupMember);
  document.getElementById("member-name")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addSetupMember();
  });
  document.getElementById("start-empty")?.addEventListener("click", startHousehold);
  document.getElementById("do-join")?.addEventListener("click", joinHouseholdFromSetup);
  document.getElementById("join-code")?.addEventListener("input", (e) => {
    joinCodeDraft = HjemmeSync.normalizeCode(e.target.value);
    e.target.value = joinCodeDraft;
  });
  document.getElementById("join-code")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinHouseholdFromSetup();
  });
  app.querySelectorAll("[data-remove-member]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.members = state.members.filter((m) => m.id !== btn.dataset.removeMember);
      persist();
      render();
    });
  });
}

async function startHousehold() {
  if (setupBusy || state.members.length < 2) return;
  const name = document.getElementById("house-name")?.value.trim() || "Hjemme";
  state.householdName = name;
  state.currentMemberId = state.members[0]?.id || null;
  setupBusy = true;
  setupError = "";
  render();
  try {
    state.setupDone = true;
    if (HjemmeSync.isReady()) {
      await HjemmeSync.createHousehold(state);
      showShareCode = true;
    }
    persist();
  } catch (err) {
    setupError = firebaseErrorText(err, "Husstanden er oprettet her, men deling fejlede.");
    persist();
    window.alert(setupError);
  }
  setupBusy = false;
  render();
}

async function joinHouseholdFromSetup() {
  if (setupBusy) return;
  const code = document.getElementById("join-code")?.value || "";
  setupBusy = true;
  setupError = "";
  const btn = document.getElementById("do-join");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Tilslutter…";
  }
  try {
    if (!HjemmeSync.isReady()) throw new Error("not-ready");
    const data = await HjemmeSync.joinHousehold(code);
    applyCloudData({ ...data, householdId: HjemmeSync.normalizeCode(code) });
    state.currentMemberId = null;
    persist();
    setupPanel = "start";
    joinCodeDraft = "";
  } catch (err) {
    setupError = firebaseErrorText(err, "Kunne ikke tilslutte husstanden.");
  }
  setupBusy = false;
  render();
}

function bindShareCode() {
  document.getElementById("copy-code")?.addEventListener("click", async () => {
    await copyHouseholdCode();
    render();
  });
  document.getElementById("continue-share")?.addEventListener("click", () => {
    showShareCode = false;
    copiedCode = false;
    render();
  });
}

function bindPickMe() {
  app.querySelectorAll("[data-pick-me]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.currentMemberId = btn.dataset.pickMe;
      persist();
      render();
    });
  });
}

async function copyHouseholdCode() {
  const code = state.householdId;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    copiedCode = true;
    setTimeout(() => {
      copiedCode = false;
      if (showShareCode || sheet === "settings") render();
    }, 1600);
  } catch {
    window.prompt("Kopiér koden:", code);
  }
}

function addSetupMember() {
  const input = document.getElementById("member-name");
  const name = input.value.trim();
  if (!name) return;
  state.members.push({ id: uid(), name, color: memberColor(state.members.length) });
  const house = document.getElementById("house-name").value.trim();
  if (house) state.householdName = house;
  input.value = "";
  persist();
  render();
  document.getElementById("member-name")?.focus();
}

function renderHeader() {
  const current = me();
  const options = state.members
    .map(
      (m) =>
        `<option value="${m.id}" ${m.id === current?.id ? "selected" : ""}>${escapeHtml(m.name)}</option>`
    )
    .join("");
  return `
    <header class="top">
      <div>
        <p class="eyebrow">${escapeHtml(weekdayLabel())}</p>
        <h1>${escapeHtml(state.householdName)}</h1>
        ${syncLine()}
      </div>
      <label class="who">
        <span>Jeg er</span>
        <select id="who-am-i">${options}</select>
      </label>
    </header>
  `;
}

function syncLine() {
  if (state.householdId && syncStatus().kind === "live") {
    return `<p class="sync-line live">Delt · ${escapeHtml(state.householdId)}</p>`;
  }
  if (syncStatus().kind === "error") {
    return `<p class="sync-line warn">${escapeHtml(syncStatus().message)}</p>`;
  }
  if (state.householdId && HjemmeSync.isConfigured()) {
    return `<p class="sync-line">Forbinder…</p>`;
  }
  return "";
}

function renderNav() {
  const shop = openCount(state.shopping, (i) => !i.done);
  const chores = openCount(state.chores, (c) => !choreIsDone(c));
  const todayMine = eventsOn(state, todayIso()).filter((e) => eventForPerson(e, me()?.id)).length;
  const items = [
    ["home", "Hjem", null],
    ["shop", "Indkøb", shop],
    ["chores", "Pligter", chores],
    ["cal", "Kalender", todayMine || null]
  ];
  return `
    <nav class="tabbar">
      ${items
        .map(
          ([id, label, count]) => `
        <button type="button" class="tab ${view === id ? "active" : ""}" data-view="${id}">
          <span class="tab-icon" data-icon="${id}"></span>
          <span>${label}</span>
          ${count ? `<em>${count}</em>` : ""}
        </button>`
        )
        .join("")}
    </nav>
  `;
}

function renderView() {
  switch (view) {
    case "shop":
      return renderShop();
    case "chores":
      return renderChores();
    case "cal":
      return renderCalendar();
    default:
      return renderHome();
  }
}

function renderHome() {
  const today = todayIso();
  const current = me();
  const todaysEvents = eventsOn(state, today).filter((e) => e.kind !== "marker" && eventForPerson(e, current?.id));
  const choreLeft = state.chores.filter((c) => !choreIsDone(c));
  const shopLeft = state.shopping.filter((i) => !i.done);
  const upcoming = todaysEvents.length
    ? []
    : nextEvents(state, addDays(today, 1), 5).filter((e) => eventForPerson(e, current?.id)).slice(0, 2);
  const upcomingMarkersList = upcomingMarkers(state);
  const who = current?.name || "dig";

  return `
    <section class="stack">
      <div class="hero-card" data-view="cal" data-jump-today="1" role="link">
        <p class="eyebrow">${escapeHtml(who)} · ${escapeHtml(formatDayHeading(today))}</p>
        ${
          todaysEvents.length
            ? `<ul class="today-list">${todaysEvents.map(homeEventLine).join("")}</ul>`
            : `<h2>Ingen aftaler for ${escapeHtml(who)} i dag</h2>`
        }
        ${
          upcoming.length
            ? `<p class="hint">Næste: ${upcoming
                .map((e) => `${escapeHtml(e.title)} · ${escapeHtml(formatEventWhen(e))}`)
                .join(" · ")}</p>`
            : todaysEvents.length
              ? `<p class="hint">Åbn kalenderen for hele husstanden</p>`
              : `<p class="hint">Skift person øverst, eller tilføj en aftale</p>`
        }
      </div>
      <div class="grid">
        <button type="button" class="mini-card" data-view="shop">
          <p class="eyebrow">Indkøb</p>
          <strong>${shopLeft.length}</strong>
          <span>${shopLeft.length === 1 ? "vare tilbage" : "varer tilbage"}</span>
        </button>
        <button type="button" class="mini-card" data-view="chores">
          <p class="eyebrow">Pligter</p>
          <strong>${choreLeft.length}</strong>
          <span>ikke klaret</span>
        </button>
      </div>
      ${
        choreLeft.length
          ? `<div class="list-card static">
              <div>
                <p class="eyebrow">I dag derhjemme</p>
                <ul class="plain">${choreLeft
                  .map(
                    (c) =>
                      `<li>${escapeHtml(c.text)} · ${escapeHtml(memberById(c.assigneeId)?.name || "")}</li>`
                  )
                  .join("")}</ul>
              </div>
            </div>`
          : ""
      }
      <div class="list-card ${upcomingMarkersList.length ? "" : "static"}" ${upcomingMarkersList.length ? 'data-view="cal"' : ""}>
        <div>
          <p class="eyebrow">Mærkedage</p>
          ${
            upcomingMarkersList.length
              ? `<ul class="plain marker-list">${upcomingMarkersList
                  .map(
                    ({ event, when }) => `
                <li>
                  <span>
                    <strong>${escapeHtml(event.title)}</strong>
                    ${eventPeopleLabel(event) ? `<em>${escapeHtml(eventPeopleLabel(event))}</em>` : ""}
                  </span>
                  <span class="hint">${escapeHtml(formatMarkerDate(when))} · ${escapeHtml(formatAhead(when))}</span>
                </li>`
                  )
                  .join("")}</ul>`
              : `<p class="hint">Fødselsdage og andre årlige dage, der ligger lidt ude i fremtiden.</p>`
          }
        </div>
      </div>
      <button type="button" class="text-btn" id="open-settings">Husstand og data</button>
    </section>
  `;
}

function homeEventLine(event) {
  const names = eventPeopleLabel(event);
  return `
    <li>
      <strong>${event.time || "Hele dagen"}</strong>
      <span>${escapeHtml(event.title)}${names ? ` · ${escapeHtml(names)}` : ""}</span>
    </li>
  `;
}

function renderShop() {
  const open = state.shopping.filter((i) => !i.done);
  const done = state.shopping.filter((i) => i.done);
  const peek = state.listPhotos.find((p) => p.id === paperPeekId);
  const leftLabel = open.length === 1 ? "1 vare tilbage" : `${open.length} varer tilbage`;
  return `
    <section class="shop">
      <header class="shop-head">
        <div>
          <h2>Indkøb</h2>
          <p class="hint">${open.length ? leftLabel : "Listen er klar — tilføj varer nedenunder"}</p>
        </div>
        <div class="shop-tools">
          <button type="button" class="tool ${sheet === "suggest" ? "on" : ""}" data-sheet="suggest">Forslag</button>
          <button type="button" class="tool ${sheet === "paper" || peek ? "on" : ""}" data-sheet="paper">Papir</button>
        </div>
      </header>
      ${
        peek
          ? `<div class="paper-peek">
              <img src="${peek.src}" alt="Skrevet indkøbsliste" id="peek-image">
              <div class="paper-peek-bar">
                <span>Papirliste</span>
                <button type="button" class="text-btn" id="close-peek">Skjul</button>
              </div>
            </div>`
          : ""
      }
      ${
        open.length
          ? `<ul class="shop-list">${open.map(shopRow).join("")}</ul>`
          : `<div class="shop-empty">
              <p>Intet at hente endnu.</p>
              <p class="hint">Skriv en vare, tryk Forslag, eller fotografer en papirliste.</p>
            </div>`
      }
      ${
        done.length
          ? `<div class="bought">
              <button type="button" class="bought-toggle" id="toggle-bought">
                ${done.length} købt ${boughtOpen ? "▾" : "▸"}
              </button>
              ${
                boughtOpen
                  ? `<ul class="shop-list dim">${done.map(shopRow).join("")}</ul>
              <button type="button" class="text-btn" id="clear-bought">Tøm købte</button>`
                  : ""
              }
            </div>`
          : ""
      }
      <form class="shop-add" id="shop-form">
        <input name="text" placeholder="Tilføj vare" autocomplete="off" enterkeyhint="done" required>
        <button type="submit" class="add-plus" aria-label="Tilføj">+</button>
      </form>
    </section>
  `;
}

function shopRow(item) {
  return `
    <li class="shop-item ${item.done ? "done" : ""}">
      <label class="shop-check">
        <input type="checkbox" data-toggle-shop="${item.id}" ${item.done ? "checked" : ""}>
        <span class="box"></span>
        <span class="name">${escapeHtml(item.text)}</span>
      </label>
      <button type="button" class="item-x" data-delete-shop="${item.id}" aria-label="Fjern">×</button>
    </li>
  `;
}

function renderChores() {
  const open = state.chores.filter((c) => !choreIsDone(c));
  const done = state.chores.filter((c) => choreIsDone(c));
  return `
    <section class="stack">
      <div class="section-head">
        <h2>Pligter</h2>
        <button type="button" class="btn" data-sheet="chore">Ny pligt</button>
      </div>
      <ul class="rows">${open.map(choreRow).join("") || empty("Ingen åbne pligter.")}</ul>
      ${done.length ? `<p class="eyebrow">Klaret</p><ul class="rows dim">${done.map(choreRow).join("")}</ul>` : ""}
    </section>
  `;
}

function cadenceLabel(cadence) {
  return { once: "Én gang", daily: "Hver dag", weekly: "Hver uge", monthly: "Hver måned" }[cadence] || cadence;
}

function choreRow(chore) {
  const person = memberById(chore.assigneeId);
  const done = choreIsDone(chore);
  return `
    <li class="row ${done ? "done" : ""}">
      <label class="check">
        <input type="checkbox" data-toggle-chore="${chore.id}" ${done ? "checked" : ""}>
        <span>
          ${escapeHtml(chore.text)}
          <small>${cadenceLabel(chore.cadence)}</small>
        </span>
      </label>
      ${avatar(person, "sm")}
    </li>
  `;
}

function renderCalendar() {
  const modes = [
    ["days", "Dage"],
    ["month", "Måned"]
  ];
  return `
    <section class="stack">
      <div class="section-head">
        <h2>Kalender</h2>
        <div class="cal-add">
          <button type="button" class="btn" data-sheet="event">Ny aftale</button>
          <button type="button" class="btn" data-sheet="marker">Mærkedag</button>
        </div>
      </div>
      <div class="cal-switch" role="tablist">
        ${modes
          .map(
            ([id, label]) =>
              `<button type="button" class="cal-switch-btn ${calMode === id ? "on" : ""}" data-cal-mode="${id}">${label}</button>`
          )
          .join("")}
      </div>
      ${calMode === "month" ? renderMonthCal() : renderDaysCal()}
    </section>
  `;
}

function renderDaysCal() {
  const start = todayIso();
  const days = Array.from({ length: 14 }, (_, i) => addDays(start, i));
  return `<div class="week">${days.map(weekDayBlock).join("")}</div>`;
}

function weekDayBlock(iso) {
  const items = eventsOn(state, iso);
  const today = iso === todayIso();
  const selected = iso === selectedDay;
  return `
    <section class="week-day ${today ? "today" : ""} ${selected ? "selected" : ""}">
      <header class="week-day-head">
        <button type="button" data-day="${iso}">
          ${today ? `<span class="eyebrow">I dag</span>` : ""}
          <strong>${escapeHtml(formatWeekDayName(iso))}</strong>
        </button>
        <button type="button" class="icon-btn" data-add-on="${iso}" aria-label="Ny aftale">+</button>
      </header>
      ${
        items.length
          ? `<ul class="week-events">${items.map(weekEventLine).join("")}</ul>`
          : `<p class="week-empty">Ingen aftaler</p>`
      }
    </section>
  `;
}

function weekEventLine(event) {
  const names = eventPeopleLabel(event);
  const when = event.kind === "marker" ? "Mærkedag" : event.time || "Hele dagen";
  return `
    <li class="week-event ${event.kind === "marker" ? "marker" : ""}">
      <strong>${when}</strong>
      <span>${escapeHtml(event.title)}${names ? ` · ${escapeHtml(names)}` : ""}</span>
      ${avatarStack(event)}
      <button type="button" class="item-x" data-delete-event="${event.id}" aria-label="Fjern">×</button>
    </li>
  `;
}

function renderMonthCal() {
  const cells = monthCells(calYear, calMonth);
  const dayEvents = eventsOn(state, selectedDay);
  return `
    <div class="cal-nav">
      <button type="button" class="icon-btn" id="cal-prev" aria-label="Forrige måned">‹</button>
      <strong>${escapeHtml(formatMonthTitle(calYear, calMonth))}</strong>
      <button type="button" class="icon-btn" id="cal-next" aria-label="Næste måned">›</button>
    </div>
    <div class="cal-grid">
      <span class="cal-wn" aria-hidden="true"></span>
      ${WEEKDAYS.map((d) => `<span class="cal-dow">${d}</span>`).join("")}
      ${cells
        .reduce((rows, cell, index) => {
          if (index % 7 === 0) rows.push([]);
          rows[rows.length - 1].push(cell);
          return rows;
        }, [])
        .map((row) => {
          const week = isoWeekNumber(row[0].iso);
          const days = row
            .map((cell) => {
              const selected = cell.iso === selectedDay;
              const today = cell.iso === todayIso();
              return `<button type="button" class="cal-day ${cell.mute ? "mute" : ""} ${selected ? "selected" : ""} ${today ? "today" : ""}" data-day="${cell.iso}"><span class="cal-num">${Number(cell.iso.slice(8))}</span>${dayMarkerDots(cell.iso)}</button>`;
            })
            .join("");
          return `<span class="cal-wn">u.${week}</span>${days}`;
        })
        .join("")}
    </div>
    <div>
      <p class="eyebrow">${escapeHtml(formatDayHeading(selectedDay))}</p>
      <ul class="cards">
        ${dayEvents.map(eventCard).join("") || empty("Ingen aftaler denne dag.")}
      </ul>
    </div>
  `;
}

function eventCard(event) {
  const names = eventPeopleLabel(event);
  return `
    <li class="pickup">
      <div class="pickup-top">
        <div>
          <h3>${escapeHtml(event.title)}</h3>
          <p class="hint">${event.kind === "marker" ? "Mærkedag" : event.time || "Hele dagen"}</p>
        </div>
        ${avatarStack(event)}
      </div>
      <p class="hint">${names || "Ingen tilknyttet"}</p>
      <div class="actions">
        <button type="button" class="text-btn danger" data-delete-event="${event.id}">Fjern</button>
      </div>
    </li>
  `;
}

function empty(text) {
  return `<li class="empty">${escapeHtml(text)}</li>`;
}

function memberSelect(name, selected = "", emptyLabel = "Vælg") {
  const options = state.members
    .map((m) => `<option value="${m.id}" ${m.id === selected ? "selected" : ""}>${escapeHtml(m.name)}</option>`)
    .join("");
  return `<select name="${name}"><option value="">${emptyLabel}</option>${options}</select>`;
}

function memberChecks(selectedIds) {
  return `
    <div class="who-picks">
      ${state.members
        .map(
          (m) => `
        <label class="who-chip" style="--who:${m.color}">
          <input type="checkbox" name="who" value="${m.id}" ${selectedIds.includes(m.id) ? "checked" : ""}>
          ${avatar(m)}
          <span class="who-label">${escapeHtml(m.name)}</span>
        </label>`
        )
        .join("")}
    </div>`;
}

function renderSheet() {
  const title = {
    chore: "Ny pligt",
    event: "Ny aftale",
    marker: "Ny mærkedag",
    settings: "Husstand",
    photo: "Skrevet liste",
    suggest: "Hurtige varer",
    paper: "Papirlister"
  }[sheet];
  return `
    <div class="overlay" id="overlay">
      <div class="sheet" role="dialog" aria-modal="true">
        <div class="sheet-bar"></div>
        <div class="section-head">
          <h2>${title}</h2>
          <button type="button" class="icon-btn" id="close-sheet" aria-label="Luk">×</button>
        </div>
        ${sheetMarkup()}
      </div>
    </div>
  `;
}

function sheetMarkup() {
  if (sheet === "suggest") {
    const onList = new Set(
      state.shopping.filter((i) => !i.done).map((i) => i.text.toLowerCase())
    );
    return `
      <p class="hint">Tryk for at lægge på listen. Tryk igen for at tage af.</p>
      <div class="suggest-pad">
        ${
          state.suggestions
            .map((text, index) => {
              const on = onList.has(text.toLowerCase());
              return `
                <div class="suggest-item ${on ? "on" : ""}">
                  <button type="button" data-suggest="${escapeHtml(text)}">${escapeHtml(text)}</button>
                  <button type="button" class="item-x" data-remove-suggest="${index}" aria-label="Fjern forslag">×</button>
                </div>`;
            })
            .join("") || `<p class="hint">Ingen faste varer endnu.</p>`
        }
      </div>
      <form class="add-row" id="suggest-form">
        <input name="text" placeholder="Ny fast vare" autocomplete="off" required>
        <button type="submit" class="btn">Gem</button>
      </form>
    `;
  }
  if (sheet === "paper") {
    return `
      <p class="hint">Læg et foto af en håndskrevet liste op, og vis det over indkøbslisten mens I handler.</p>
      <div class="photos">
        ${
          state.listPhotos
            .map(
              (p) => `
            <button type="button" class="photo-thumb ${p.id === paperPeekId ? "picked" : ""}" data-use-photo="${p.id}">
              <img src="${p.src}" alt="Skrevet indkøbsliste">
            </button>`
            )
            .join("") || `<p class="hint">Ingen papirlister endnu.</p>`
        }
      </div>
      <label class="btn btn-primary photo-btn">
        Tag billede
        <input id="list-photo" type="file" accept="image/*" capture="environment" hidden>
      </label>
    `;
  }
  if (sheet === "chore") {
    return `
      <form class="form" id="chore-form">
        <label>Hvad <input name="text" required placeholder="fx Tøm skrald"></label>
        <label>Hvem ${memberSelect("assigneeId", me()?.id || "", "Vælg person")}</label>
        <label>Hvor ofte
          <select name="cadence">
            <option value="once">Én gang</option>
            <option value="daily">Hver dag</option>
            <option value="weekly" selected>Hver uge</option>
            <option value="monthly">Hver måned</option>
          </select>
        </label>
        <button type="submit" class="btn btn-primary">Gem pligt</button>
      </form>
    `;
  }
  if (sheet === "event" || sheet === "marker") {
    const marker = sheet === "marker";
    return `
      <form class="form" id="event-form">
        <label>${marker ? "Hvad" : "Hvad"} <input name="title" required placeholder="${marker ? "fx Mias fødselsdag" : "fx Hent Noah"}"></label>
        <label>Dato <input name="date" type="date" value="${selectedDay}" required></label>
        ${
          marker
            ? `<label class="tick inline">
                <input type="checkbox" name="yearly" checked>
                Gentages hvert år
              </label>`
            : `<label>Tid <input name="time" type="time" value="16:00"></label>
        <label class="tick inline">
          <input type="checkbox" name="allDay">
          Hele dagen
        </label>`
        }
        <p class="eyebrow">Hvem</p>
        ${memberChecks(me()?.id ? [me().id] : [])}
        <button type="submit" class="btn btn-primary">${marker ? "Gem mærkedag" : "Gem aftale"}</button>
      </form>
    `;
  }
  if (sheet === "photo") {
    const photo = state.listPhotos.find((p) => p.id === photoId);
    if (!photo) return `<p class="hint">Billedet findes ikke.</p>`;
    const person = memberById(photo.addedBy);
    return `
      <img class="photo-full" src="${photo.src}" alt="Skrevet indkøbsliste">
      <p class="hint">${person ? `Tilføjet af ${escapeHtml(person.name)}` : "Fælles listebillede"}</p>
      <button type="button" class="btn btn-primary" id="use-photo-peek">Vis over listen</button>
      <button type="button" class="text-btn danger" id="delete-photo">Slet billede</button>
    `;
  }
  return `
    <div class="form">
      <label>Husstandens navn <input id="rename-house" value="${escapeHtml(state.householdName)}"></label>
      <button type="button" class="btn" id="save-house">Gem navn</button>
      <p class="eyebrow">Personer</p>
      <ul class="chip-list">
        ${state.members.map((m) => `<li class="chip-row">${avatar(m)} ${escapeHtml(m.name)}</li>`).join("")}
      </ul>
      <div class="add-row">
        <input id="extra-member" placeholder="Tilføj person">
        <button type="button" class="btn" id="add-extra">Tilføj</button>
      </div>
      <p class="eyebrow">Deling</p>
      ${renderShareSettings()}
      <button type="button" class="text-btn danger" id="reset-demo">Nulstil denne telefon</button>
    </div>
  `;
}

function renderShareSettings() {
  const status = syncStatus();
  if (!HjemmeSync.isConfigured()) {
    return `<p class="hint">Sæt Firebase op i js/firebase-config.js for at dele mellem telefoner.</p>`;
  }
  if (state.householdId) {
    return `
      <div class="code-box">
        <strong>${escapeHtml(state.householdId)}</strong>
        <button type="button" class="btn" id="copy-code">${copiedCode ? "Kopieret" : "Kopiér"}</button>
      </div>
      <p class="hint">Den anden telefon vælger Tilslut med kode. Papirfotos bliver på denne telefon.</p>
      <p class="sync-line ${status.kind === "live" ? "live" : status.kind === "error" ? "warn" : ""}">${escapeHtml(status.message || "")}</p>
      <button type="button" class="text-btn" id="leave-house">Stop deling på denne telefon</button>
    `;
  }
  return `
    <p class="hint">Del indkøb, pligter og kalender med den anden telefon.</p>
    <button type="button" class="btn" id="share-house" ${!HjemmeSync.isReady() || setupBusy ? "disabled" : ""}>Opret fælles husstand</button>
    ${status.kind === "error" ? `<p class="sync-line warn">${escapeHtml(status.message)}</p>` : ""}
  `;
}

function bindMain() {
  document.getElementById("who-am-i")?.addEventListener("change", (e) => {
    state.currentMemberId = e.target.value;
    persist();
    render();
  });
  app.querySelectorAll("[data-view]").forEach((el) => {
    el.addEventListener("click", () => {
      view = el.dataset.view;
      if (el.dataset.jumpToday) {
        selectedDay = todayIso();
        const now = new Date();
        calYear = now.getFullYear();
        calMonth = now.getMonth();
      }
      sheet = null;
      render();
    });
  });
  document.getElementById("open-settings")?.addEventListener("click", () => {
    sheet = "settings";
    render();
  });
  document.getElementById("close-sheet")?.addEventListener("click", closeSheet);
  document.getElementById("overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "overlay") closeSheet();
  });
  app.querySelectorAll("[data-sheet]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.sheet;
      sheet = sheet === next ? null : next;
      render();
    });
  });

  document.getElementById("shop-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    addShopItem(String(data.get("text") || ""));
    keepShopFocus = true;
    persist();
    render();
  });
  document.getElementById("suggest-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = String(new FormData(e.target).get("text") || "").trim();
    if (!text) return;
    if (!state.suggestions.some((s) => s.toLowerCase() === text.toLowerCase())) {
      state.suggestions.push(text);
      persist();
      render();
    }
  });
  app.querySelectorAll("[data-suggest]").forEach((btn) => {
    btn.addEventListener("click", () => {
      toggleNamedShopItem(btn.dataset.suggest);
      persist();
      render();
    });
  });
  app.querySelectorAll("[data-remove-suggest]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const index = Number(btn.dataset.removeSuggest);
      state.suggestions.splice(index, 1);
      persist();
      render();
    });
  });
  app.querySelectorAll("[data-toggle-shop]").forEach((input) => {
    input.addEventListener("change", () => {
      const item = state.shopping.find((s) => s.id === input.dataset.toggleShop);
      if (item) item.done = input.checked;
      persist();
      render();
    });
  });
  app.querySelectorAll("[data-delete-shop]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.shopping = state.shopping.filter((s) => s.id !== btn.dataset.deleteShop);
      persist();
      render();
    });
  });
  document.getElementById("toggle-bought")?.addEventListener("click", () => {
    boughtOpen = !boughtOpen;
    render();
  });
  document.getElementById("clear-bought")?.addEventListener("click", () => {
    state.shopping = state.shopping.filter((s) => !s.done);
    boughtOpen = false;
    persist();
    render();
  });
  document.getElementById("list-photo")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const src = await compressPhoto(file);
      const id = uid();
      state.listPhotos.unshift({
        id,
        src,
        addedBy: me()?.id || null,
        createdAt: Date.now()
      });
      paperPeekId = id;
      sheet = null;
      persist();
      render();
    } catch {
      window.alert("Billedet kunne ikke læses. Prøv et almindeligt foto.");
    }
  });
  app.querySelectorAll("[data-use-photo]").forEach((btn) => {
    btn.addEventListener("click", () => {
      paperPeekId = btn.dataset.usePhoto;
      sheet = null;
      render();
    });
  });
  app.querySelectorAll("[data-open-photo]").forEach((btn) => {
    btn.addEventListener("click", () => {
      photoId = btn.dataset.openPhoto;
      sheet = "photo";
      render();
    });
  });
  document.getElementById("use-photo-peek")?.addEventListener("click", () => {
    paperPeekId = photoId;
    sheet = null;
    render();
  });
  document.getElementById("close-peek")?.addEventListener("click", () => {
    paperPeekId = null;
    render();
  });
  document.getElementById("delete-photo")?.addEventListener("click", () => {
    state.listPhotos = state.listPhotos.filter((p) => p.id !== photoId);
    if (paperPeekId === photoId) paperPeekId = null;
    photoId = null;
    sheet = null;
    persist();
    render();
  });

  app.querySelectorAll("[data-toggle-chore]").forEach((input) => {
    input.addEventListener("change", () => {
      const chore = state.chores.find((c) => c.id === input.dataset.toggleChore);
      if (!chore) return;
      chore.doneOn = input.checked ? todayIso() : null;
      persist();
      render();
    });
  });
  document.getElementById("chore-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const text = String(data.get("text") || "").trim();
    const assigneeId = String(data.get("assigneeId") || "");
    if (!text || !assigneeId) return;
    state.chores.unshift({
      id: uid(),
      text,
      assigneeId,
      cadence: String(data.get("cadence") || "weekly"),
      doneOn: null
    });
    sheet = null;
    persist();
    render();
  });

  document.getElementById("cal-prev")?.addEventListener("click", () => {
    calMonth -= 1;
    if (calMonth < 0) {
      calMonth = 11;
      calYear -= 1;
    }
    render();
  });
  document.getElementById("cal-next")?.addEventListener("click", () => {
    calMonth += 1;
    if (calMonth > 11) {
      calMonth = 0;
      calYear += 1;
    }
    render();
  });
  app.querySelectorAll("[data-cal-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      calMode = btn.dataset.calMode;
      const d = parseIsoDate(selectedDay);
      calYear = d.getFullYear();
      calMonth = d.getMonth();
      render();
    });
  });
  app.querySelectorAll("[data-add-on]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      selectedDay = btn.dataset.addOn;
      const d = parseIsoDate(selectedDay);
      calYear = d.getFullYear();
      calMonth = d.getMonth();
      sheet = "event";
      render();
    });
  });
  app.querySelectorAll("[data-day]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedDay = btn.dataset.day;
      const d = parseIsoDate(selectedDay);
      calYear = d.getFullYear();
      calMonth = d.getMonth();
      render();
    });
  });
  document.getElementById("event-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const title = String(data.get("title") || "").trim();
    const date = String(data.get("date") || "");
    const kind = sheet === "marker" ? "marker" : "event";
    const yearly = kind === "marker" ? Boolean(data.get("yearly")) : false;
    const allDay = Boolean(data.get("allDay")) || kind === "marker";
    const time = allDay ? null : String(data.get("time") || "") || null;
    if (!title || !date) return;
    const assigneeIds = [...e.target.querySelectorAll('input[name="who"]:checked')].map((i) => i.value);
    state.events.push({
      id: uid(),
      title,
      date,
      time,
      assigneeIds,
      kind,
      yearly
    });
    selectedDay = date;
    const d = parseIsoDate(date);
    calYear = d.getFullYear();
    calMonth = d.getMonth();
    sheet = null;
    persist();
    render();
  });
  app.querySelectorAll("[data-delete-event]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.events = state.events.filter((ev) => ev.id !== btn.dataset.deleteEvent);
      persist();
      render();
    });
  });

  document.getElementById("save-house")?.addEventListener("click", () => {
    const name = document.getElementById("rename-house").value.trim();
    if (name) state.householdName = name;
    persist();
    sheet = null;
    render();
  });
  document.getElementById("add-extra")?.addEventListener("click", () => {
    const input = document.getElementById("extra-member");
    const name = input.value.trim();
    if (!name) return;
    state.members.push({ id: uid(), name, color: memberColor(state.members.length) });
    persist();
    render();
  });
  document.getElementById("copy-code")?.addEventListener("click", async () => {
    await copyHouseholdCode();
    render();
  });
  document.getElementById("share-house")?.addEventListener("click", async () => {
    if (!HjemmeSync.isReady() || setupBusy) return;
    setupBusy = true;
    render();
    try {
      await HjemmeSync.createHousehold(state);
      persist();
      showShareCode = true;
    } catch (err) {
      window.alert(firebaseErrorText(err, "Kunne ikke oprette fælles husstand."));
    }
    setupBusy = false;
    render();
  });
  document.getElementById("leave-house")?.addEventListener("click", () => {
    HjemmeSync.leave();
    state.householdId = null;
    persist();
    sheet = null;
    render();
  });
  document.getElementById("reset-demo")?.addEventListener("click", () => {
    HjemmeSync.leave();
    resetStorage();
    state = demoState();
    persist();
    sheet = null;
    view = "home";
    selectedDay = todayIso();
    render();
  });
  document.getElementById("peek-image")?.addEventListener("click", () => {
    photoId = paperPeekId;
    sheet = "photo";
    render();
  });
  if (keepShopFocus) {
    keepShopFocus = false;
    document.querySelector('#shop-form input[name="text"]')?.focus();
  }
}

function closeSheet() {
  sheet = null;
  photoId = null;
  render();
}

function compressPhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1200;
      let width = img.width;
      let height = img.height;
      if (width > max) {
        height = Math.round((height * max) / width);
        width = max;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image"));
    };
    img.src = url;
  });
}

render();

HjemmeSync.connect({
  onRemote(data) {
    applyCloudData(data);
    if (!isTyping() && !sheet) render();
  }
}).then(() => {
  if (state.householdId) HjemmeSync.attach(state.householdId);
  render();
});

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
