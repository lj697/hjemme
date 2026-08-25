let state = loadState();
let area = "home";
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
let editId = null;
let setupPanel = "start";
let showShareCode = false;
let setupBusy = false;
let setupError = "";
let copiedCode = false;
let joinCodeDraft = "";
let mealWeek = mondayOf(todayIso());
let mealQuery = "";
let keepMealSearch = false;

const SEEN_KEY = "hjemme-seen-v1";
const NAV_SECTIONS = ["shop", "chores", "cal", "meals", "notes"];
let seen = loadSeen();

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
  const notes = Array.isArray(data.notes) ? data.notes : state.notes || [];
  const meals = Array.isArray(data.meals) ? data.meals : state.meals || [];
  const money = data.money != null ? data.money : state.money;
  state = migrate({
    ...data,
    listPhotos: photos,
    notes,
    meals,
    money,
    currentMemberId: memberId,
    householdId: data.householdId || state.householdId,
    setupDone: true
  });
  if (state.currentMemberId && !memberById(state.currentMemberId)) {
    state.currentMemberId = null;
  }
  saveState(state);
}

function loadSeen() {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function saveSeen() {
  localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
}

function clearSeen() {
  seen = {};
  localStorage.removeItem(SEEN_KEY);
}

function sectionStamp(name) {
  const sorted = (list, pick) =>
    JSON.stringify(
      [...list]
        .map(pick)
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    );
  if (name === "shop") {
    return JSON.stringify({
      shopping: sorted(state.shopping || [], (i) => [i.id, i.text, i.done]),
      suggestions: [...(state.suggestions || [])].map((s) => s.toLowerCase()).sort()
    });
  }
  if (name === "chores") {
    return sorted(state.chores || [], (c) => [c.id, c.text, c.cadence, c.doneOn]);
  }
  if (name === "cal") {
    return sorted(state.events || [], (e) => [e.id, e.title, e.date, e.time, e.kind, e.yearly]);
  }
  if (name === "notes") {
    return sorted(state.notes || [], (n) => [n.id, n.title, n.body, n.updatedAt]);
  }
  if (name === "meals") {
    return sorted(state.meals || [], (m) => [m.id, m.date, m.dish]);
  }
  return "";
}

function initSeenIfNeeded() {
  let dirty = false;
  for (const name of NAV_SECTIONS) {
    if (seen[name] == null) {
      seen[name] = sectionStamp(name);
      dirty = true;
    }
  }
  if (dirty) saveSeen();
}

function markSeen(name) {
  if (!NAV_SECTIONS.includes(name)) return;
  const stamp = sectionStamp(name);
  if (seen[name] === stamp) return;
  seen[name] = stamp;
  saveSeen();
}

function hasUnseen(name) {
  return Boolean(seen[name]) && seen[name] !== sectionStamp(name);
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

function dayMarkerDots(iso) {
  const events = eventsOn(state, iso);
  if (!events.length) return "";
  const hasEvent = events.some((e) => e.kind !== "marker");
  const hasMarker = events.some((e) => e.kind === "marker");
  const dots = [];
  if (hasEvent) dots.push('<span class="cal-dot" style="background:var(--clay)"></span>');
  if (hasMarker) dots.push('<span class="cal-dot empty"></span>');
  return `<span class="cal-dots">${dots.join("")}</span>`;
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
  if (area === "money") {
    app.innerHTML = HjemmeMoney.render(state);
    HjemmeMoney.bind(state);
    return;
  }
  if (NAV_SECTIONS.includes(view)) markSeen(view);
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
      <p class="lede">Indkøb, pligter, kalender, noter og madplan, I alle kan bruge.</p>
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
      <p class="lede">Tilføj jer selv, så husstanden er på plads.</p>
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
    area = "home";
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
    clearSeen();
    initSeenIfNeeded();
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
  return `
    <header class="top">
      <div>
        <p class="eyebrow">${escapeHtml(weekdayLabel())}</p>
        <h1>${escapeHtml(state.householdName)}</h1>
        ${syncLine()}
      </div>
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
  const items = [
    ["home", "Hjem"],
    ["shop", "Indkøb"],
    ["chores", "Pligter"],
    ["cal", "Kalender"],
    ["meals", "Madplan"],
    ["notes", "Noter"]
  ];
  return `
    <nav class="tabbar">
      ${items
        .map(
          ([id, label]) => `
        <button type="button" class="tab ${view === id ? "active" : ""}" data-view="${id}">
          <span class="tab-icon" data-icon="${id}"></span>
          <span>${label}</span>
          ${hasUnseen(id) ? `<em aria-label="Ændringer"></em>` : ""}
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
    case "meals":
      return renderMeals();
    case "notes":
      return renderNotes();
    default:
      return renderHome();
  }
}

function renderHome() {
  const today = todayIso();
  const todaysEvents = eventsOn(state, today).filter((e) => e.kind !== "marker");
  const choreLeft = state.chores.filter((c) => !choreIsDone(c));
  const shopLeft = state.shopping.filter((i) => !i.done);
  const upcoming = todaysEvents.length ? [] : nextEvents(state, addDays(today, 1), 2);
  const upcomingMarkersList = upcomingMarkers(state);
  const tonight = mealOn(state, today);

  return `
    <section class="stack">
      <div class="hero-card" data-view="cal" data-jump-today="1" role="link">
        <p class="eyebrow">${escapeHtml(formatDayHeading(today))}</p>
        ${
          todaysEvents.length
            ? `<ul class="today-list">${todaysEvents.map(homeEventLine).join("")}</ul>`
            : `<h2>Ingen aftaler i dag</h2>`
        }
        ${
          upcoming.length
            ? `<p class="hint">Næste: ${upcoming
                .map((e) => `${escapeHtml(e.title)} · ${escapeHtml(formatEventWhen(e))}`)
                .join(" · ")}</p>`
            : `<p class="hint">Åbn kalenderen for at se mere</p>`
        }
      </div>
      <div class="list-card" data-view="meals" data-jump-week="1" role="link">
        <div>
          <p class="eyebrow">I aften</p>
          ${tonight ? `<h2>${escapeHtml(tonight.dish)}</h2>` : `<h2>Ingen ret i dag</h2>`}
          <p class="hint">${tonight ? "Åbn madplanen for at se ugen" : "Skriv ugens madplan"}</p>
        </div>
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
          ? `<div class="list-card" data-view="chores" role="link">
              <div>
                <p class="eyebrow">I dag derhjemme</p>
                <ul class="plain">${choreLeft
                  .map((c) => `<li>${escapeHtml(c.text)}</li>`)
                  .join("")}</ul>
              </div>
            </div>`
          : ""
      }
      <div class="list-card ${upcomingMarkersList.length ? "" : "static"}" ${upcomingMarkersList.length ? 'data-view="cal" role="link"' : ""}>
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
      <button type="button" class="money-door" id="open-money">
        <span class="eyebrow">Afdeling</span>
        <strong>Økonomi</strong>
        <span class="hint">Indtægter, spande og ugen</span>
      </button>
    </section>
  `;
}

function homeEventLine(event) {
  return `
    <li>
      <strong>${event.time || "Hele dagen"}</strong>
      <span>${escapeHtml(event.title)}</span>
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
      </label>
      <button type="button" class="name" data-edit-shop="${item.id}">${escapeHtml(item.text)}</button>
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
  const done = choreIsDone(chore);
  return `
    <li class="row ${done ? "done" : ""}">
      <label class="check">
        <input type="checkbox" data-toggle-chore="${chore.id}" ${done ? "checked" : ""}>
      </label>
      <button type="button" class="row-edit" data-edit-chore="${chore.id}">
        <span>
          ${escapeHtml(chore.text)}
          <small>${cadenceLabel(chore.cadence)}</small>
        </span>
      </button>
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
  const when = event.kind === "marker" ? "Mærkedag" : event.time || "Hele dagen";
  return `
    <li class="week-event ${event.kind === "marker" ? "marker" : ""}">
      <button type="button" class="week-event-main" data-edit-event="${event.id}">
        <strong>${when}</strong>
        <span>${escapeHtml(event.title)}</span>
      </button>
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
  return `
    <li class="pickup">
      <button type="button" class="event-edit" data-edit-event="${event.id}">
        <h3>${escapeHtml(event.title)}</h3>
        <p class="hint">${event.kind === "marker" ? "Mærkedag" : event.time || "Hele dagen"}</p>
      </button>
      <div class="actions">
        <button type="button" class="text-btn" data-edit-event="${event.id}">Rediger</button>
        <button type="button" class="text-btn danger" data-delete-event="${event.id}">Fjern</button>
      </div>
    </li>
  `;
}

function empty(text) {
  return `<li class="empty">${escapeHtml(text)}</li>`;
}

function formatNoteWhen(ts) {
  if (!ts) return "";
  return new Intl.DateTimeFormat("da-DK", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(ts));
}

function renderMeals() {
  const query = mealQuery.trim();
  const hits = query ? searchMeals(state, query) : [];
  const thisMonday = mondayOf(todayIso());
  const days = weekDays(mealWeek);
  return `
    <section class="stack">
      <div class="section-head">
        <h2>Madplan</h2>
      </div>
      <label class="meal-search">
        <span class="eyebrow">Find en ret</span>
        <input id="meal-search" type="search" placeholder="fx frikadeller" value="${escapeHtml(mealQuery)}" autocomplete="off">
      </label>
      ${
        query
          ? `<ul class="cards">
              ${
                hits
                  .map(
                    (meal) => `
                <li>
                  <button type="button" class="note-card" data-meal-jump="${meal.date}">
                    <h3>${escapeHtml(meal.dish)}</h3>
                    <p class="hint">${escapeHtml(formatDayHeading(meal.date))}</p>
                  </button>
                </li>`
                  )
                  .join("") || empty("Ingen retter matcher søgningen.")
              }
            </ul>`
          : `
      <div class="cal-nav">
        <button type="button" class="icon-btn" id="meal-prev" aria-label="Forrige uge">‹</button>
        <strong>${escapeHtml(formatMealWeekHeading(mealWeek))}</strong>
        <button type="button" class="icon-btn" id="meal-next" aria-label="Næste uge">›</button>
      </div>
      ${
        mealWeek !== thisMonday
          ? `<button type="button" class="text-btn" id="meal-this-week">Gå til denne uge</button>`
          : ""
      }
      <form class="meal-week" id="meal-week-form">
        ${days
          .map((iso) => {
            const meal = mealOn(state, iso);
            const today = iso === todayIso();
            const weekdayRaw = new Intl.DateTimeFormat("da-DK", { weekday: "long" }).format(parseIsoDate(iso));
            const weekday = weekdayRaw.charAt(0).toUpperCase() + weekdayRaw.slice(1);
            const dateLabel = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short" }).format(
              parseIsoDate(iso)
            );
            return `
              <label class="meal-day ${today ? "today" : ""}">
                <span>
                  <strong>${escapeHtml(weekday)}</strong>
                  <small>${escapeHtml(dateLabel)}${today ? " · i dag" : ""}</small>
                </span>
                <input name="meal-${iso}" data-meal-date="${iso}" value="${escapeHtml(meal?.dish || "")}" placeholder="Ret" autocomplete="off">
              </label>`;
          })
          .join("")}
      </form>
      <p class="hint">Planerne gemmes automatisk, så I kan bladre tilbage og se, hvad I har spist.</p>`
      }
    </section>
  `;
}

function flushMealWeekForm() {
  const form = document.getElementById("meal-week-form");
  if (!form) return false;
  form.querySelectorAll("[data-meal-date]").forEach((input) => {
    upsertMeal(state, input.dataset.mealDate, input.value);
  });
  return true;
}

function renderNotes() {
  const notes = [...(state.notes || [])].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return `
    <section class="stack">
      <div class="section-head">
        <h2>Noter</h2>
        <button type="button" class="btn" data-sheet="note">Ny note</button>
      </div>
      <ul class="cards">
        ${
          notes
            .map(
              (note) => `
          <li>
            <button type="button" class="note-card" data-edit-note="${note.id}">
              <h3>${escapeHtml(note.title || "Uden titel")}</h3>
              ${note.body ? `<p class="note-preview">${escapeHtml(note.body)}</p>` : ""}
              <p class="hint">${escapeHtml(formatNoteWhen(note.updatedAt))}</p>
            </button>
          </li>`
            )
            .join("") || empty("Ingen noter endnu. Skriv den første.")
        }
      </ul>
    </section>
  `;
}

function renderSheet() {
  const editing = Boolean(editId);
  const title = {
    chore: editing ? "Rediger pligt" : "Ny pligt",
    event: editing ? "Rediger aftale" : "Ny aftale",
    marker: editing ? "Rediger mærkedag" : "Ny mærkedag",
    note: editing ? "Rediger note" : "Ny note",
    shop: "Rediger vare",
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
    const chore = state.chores.find((c) => c.id === editId);
    const cadence = chore?.cadence || "weekly";
    return `
      <form class="form" id="chore-form">
        <label>Hvad <input name="text" required placeholder="fx Tøm skrald" value="${escapeHtml(chore?.text || "")}"></label>
        <label>Hvor ofte
          <select name="cadence">
            <option value="once" ${cadence === "once" ? "selected" : ""}>Én gang</option>
            <option value="daily" ${cadence === "daily" ? "selected" : ""}>Hver dag</option>
            <option value="weekly" ${cadence === "weekly" ? "selected" : ""}>Hver uge</option>
            <option value="monthly" ${cadence === "monthly" ? "selected" : ""}>Hver måned</option>
          </select>
        </label>
        <button type="submit" class="btn btn-primary">${chore ? "Gem ændringer" : "Gem pligt"}</button>
        ${chore ? `<button type="button" class="text-btn danger" id="delete-editing">Slet pligt</button>` : ""}
      </form>
    `;
  }
  if (sheet === "shop") {
    const item = state.shopping.find((s) => s.id === editId);
    if (!item) return `<p class="hint">Varen findes ikke.</p>`;
    return `
      <form class="form" id="shop-edit-form">
        <label>Vare <input name="text" required value="${escapeHtml(item.text)}"></label>
        <button type="submit" class="btn btn-primary">Gem ændringer</button>
        <button type="button" class="text-btn danger" id="delete-editing">Slet vare</button>
      </form>
    `;
  }
  if (sheet === "note") {
    const note = (state.notes || []).find((n) => n.id === editId);
    return `
      <form class="form" id="note-form">
        <label>Overskrift <input name="title" required placeholder="fx Kode til cykelskur" value="${escapeHtml(note?.title || "")}"></label>
        <label>Note <textarea name="body" rows="8" placeholder="Skriv her…">${escapeHtml(note?.body || "")}</textarea></label>
        <button type="submit" class="btn btn-primary">${note ? "Gem ændringer" : "Gem note"}</button>
        ${note ? `<button type="button" class="text-btn danger" id="delete-editing">Slet note</button>` : ""}
      </form>
    `;
  }
  if (sheet === "event" || sheet === "marker") {
    const marker = sheet === "marker";
    const event = state.events.find((e) => e.id === editId);
    const dateValue = event?.date || selectedDay;
    const timeValue = event?.time || "16:00";
    const allDay = event ? !event.time : false;
    const yearly = event ? event.yearly !== false : true;
    return `
      <form class="form" id="event-form">
        <label>Hvad <input name="title" required placeholder="${marker ? "fx Mias fødselsdag" : "fx Hent Noah"}" value="${escapeHtml(event?.title || "")}"></label>
        <label>Dato <input name="date" type="date" value="${dateValue}" required></label>
        ${
          marker
            ? `<label class="tick inline">
                <input type="checkbox" name="yearly" ${yearly ? "checked" : ""}>
                Gentages hvert år
              </label>`
            : `<label>Tid <input name="time" type="time" value="${timeValue}"></label>
        <label class="tick inline">
          <input type="checkbox" name="allDay" ${allDay ? "checked" : ""}>
          Hele dagen
        </label>`
        }
        <button type="submit" class="btn btn-primary">${event ? "Gem ændringer" : marker ? "Gem mærkedag" : "Gem aftale"}</button>
        ${event ? `<button type="button" class="text-btn danger" id="delete-editing">Slet</button>` : ""}
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
    <p class="hint">Del indkøb, pligter, kalender, noter og madplan med den anden telefon.</p>
    <button type="button" class="btn" id="share-house" ${!HjemmeSync.isReady() || setupBusy ? "disabled" : ""}>Opret fælles husstand</button>
    ${status.kind === "error" ? `<p class="sync-line warn">${escapeHtml(status.message)}</p>` : ""}
  `;
}

function bindMain() {
  app.querySelectorAll("[data-view]").forEach((el) => {
    el.addEventListener("click", () => {
      if (flushMealWeekForm()) persist();
      view = el.dataset.view;
      if (el.dataset.jumpToday) {
        selectedDay = todayIso();
        const now = new Date();
        calYear = now.getFullYear();
        calMonth = now.getMonth();
      }
      if (el.dataset.jumpWeek || view === "meals") {
        mealWeek = mondayOf(todayIso());
        mealQuery = "";
      }
      sheet = null;
      editId = null;
      render();
    });
  });
  document.getElementById("open-settings")?.addEventListener("click", () => {
    sheet = "settings";
    editId = null;
    render();
  });
  document.getElementById("open-money")?.addEventListener("click", () => {
    area = "money";
    sheet = null;
    HjemmeMoney.enter(state);
    render();
  });
  document.getElementById("close-sheet")?.addEventListener("click", closeSheet);
  document.getElementById("overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "overlay") closeSheet();
  });
  app.querySelectorAll("[data-sheet]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.sheet;
      const wasEditing = Boolean(editId);
      if (sheet === next && !wasEditing) {
        sheet = null;
      } else {
        sheet = next;
      }
      editId = null;
      render();
    });
  });
  document.getElementById("meal-search")?.addEventListener("input", (e) => {
    if (flushMealWeekForm()) persist();
    mealQuery = e.target.value;
    keepMealSearch = true;
    render();
  });
  document.getElementById("meal-prev")?.addEventListener("click", () => {
    flushMealWeekForm();
    persist();
    mealWeek = addDays(mealWeek, -7);
    render();
  });
  document.getElementById("meal-next")?.addEventListener("click", () => {
    flushMealWeekForm();
    persist();
    mealWeek = addDays(mealWeek, 7);
    render();
  });
  document.getElementById("meal-this-week")?.addEventListener("click", () => {
    flushMealWeekForm();
    persist();
    mealWeek = mondayOf(todayIso());
    render();
  });
  app.querySelectorAll("[data-meal-date]").forEach((input) => {
    input.addEventListener("change", () => {
      upsertMeal(state, input.dataset.mealDate, input.value);
      persist();
    });
  });
  document.getElementById("meal-week-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    flushMealWeekForm();
    persist();
  });
  app.querySelectorAll("[data-meal-jump]").forEach((btn) => {
    btn.addEventListener("click", () => {
      mealWeek = mondayOf(btn.dataset.mealJump);
      mealQuery = "";
      render();
    });
  });
  app.querySelectorAll("[data-edit-shop]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      editId = btn.dataset.editShop;
      sheet = "shop";
      render();
    });
  });
  app.querySelectorAll("[data-edit-chore]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      editId = btn.dataset.editChore;
      sheet = "chore";
      render();
    });
  });
  app.querySelectorAll("[data-edit-event]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const event = state.events.find((ev) => ev.id === btn.dataset.editEvent);
      if (!event) return;
      editId = event.id;
      sheet = event.kind === "marker" ? "marker" : "event";
      selectedDay = event.date;
      render();
    });
  });
  app.querySelectorAll("[data-edit-note]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      editId = btn.dataset.editNote;
      sheet = "note";
      render();
    });
  });
  document.getElementById("delete-editing")?.addEventListener("click", () => {
    if (!editId) return;
    if (sheet === "chore") state.chores = state.chores.filter((c) => c.id !== editId);
    else if (sheet === "shop") state.shopping = state.shopping.filter((s) => s.id !== editId);
    else if (sheet === "note") state.notes = (state.notes || []).filter((n) => n.id !== editId);
    else if (sheet === "event" || sheet === "marker") {
      state.events = state.events.filter((ev) => ev.id !== editId);
    }
    editId = null;
    sheet = null;
    persist();
    render();
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
    const cadence = String(data.get("cadence") || "weekly");
    if (!text) return;
    if (editId) {
      const chore = state.chores.find((c) => c.id === editId);
      if (chore) {
        chore.text = text;
        chore.cadence = cadence;
      }
    } else {
      state.chores.unshift({
        id: uid(),
        text,
        assigneeId: null,
        cadence,
        doneOn: null
      });
    }
    editId = null;
    sheet = null;
    persist();
    render();
  });
  document.getElementById("shop-edit-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = String(new FormData(e.target).get("text") || "").trim();
    if (!text) return;
    const item = state.shopping.find((s) => s.id === editId);
    if (item) item.text = text;
    editId = null;
    sheet = null;
    persist();
    render();
  });
  document.getElementById("note-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const title = String(data.get("title") || "").trim();
    const body = String(data.get("body") || "").trim();
    if (!title) return;
    if (!Array.isArray(state.notes)) state.notes = [];
    if (editId) {
      const note = state.notes.find((n) => n.id === editId);
      if (note) {
        note.title = title;
        note.body = body;
        note.updatedAt = Date.now();
      }
    } else {
      state.notes.unshift({
        id: uid(),
        title,
        body,
        updatedAt: Date.now()
      });
    }
    editId = null;
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
      editId = null;
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
    if (editId) {
      const event = state.events.find((ev) => ev.id === editId);
      if (event) {
        event.title = title;
        event.date = date;
        event.time = time;
        event.kind = kind;
        event.yearly = yearly;
      }
    } else {
      state.events.push({
        id: uid(),
        title,
        date,
        time,
        assigneeIds: [],
        kind,
        yearly
      });
    }
    selectedDay = date;
    const d = parseIsoDate(date);
    calYear = d.getFullYear();
    calMonth = d.getMonth();
    editId = null;
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
    clearSeen();
    state = demoState();
    persist();
    initSeenIfNeeded();
    sheet = null;
    editId = null;
    view = "home";
    area = "home";
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
  if (keepMealSearch) {
    keepMealSearch = false;
    const search = document.getElementById("meal-search");
    if (search) {
      search.focus();
      const end = search.value.length;
      search.setSelectionRange(end, end);
    }
  }
}

function closeSheet() {
  sheet = null;
  photoId = null;
  editId = null;
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

initSeenIfNeeded();
HjemmeMoney.attach({
  persist,
  render,
  leave() {
    area = "home";
    view = "home";
    render();
  }
});
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
