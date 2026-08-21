const FIREBASE_SDK = "https://www.gstatic.com/firebasejs/11.10.0";
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

const HjemmeSync = (() => {
  let app = null;
  let db = null;
  let unsub = null;
  let ready = false;
  let lastWriteId = null;
  let saveTimer = null;
  let applyingRemote = false;
  let status = { kind: "off", message: "" };
  let hooks = { onRemote: null, onStatus: null };

  function isConfigured() {
    const c = window.FIREBASE_CONFIG;
    return Boolean(c?.apiKey && c?.projectId && c?.appId);
  }

  function isReady() {
    return ready;
  }

  function getStatus() {
    return status;
  }

  function setStatus(kind, message = "") {
    status = { kind, message };
    hooks.onStatus?.(status);
  }

  function makeCode() {
    let code = "";
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < 6; i += 1) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    return code;
  }

  function normalizeCode(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
  }

  function cloudPayload(state) {
    lastWriteId = uid();
    return {
      householdId: state.householdId,
      householdName: state.householdName,
      members: state.members,
      suggestions: state.suggestions,
      shopping: state.shopping,
      chores: state.chores,
      events: state.events,
      setupDone: true,
      updatedAt: Date.now(),
      writeId: lastWriteId
    };
  }

  async function loadSdk() {
    const [{ initializeApp }, { getAuth, signInAnonymously }, firestore] = await Promise.all([
      import(`${FIREBASE_SDK}/firebase-app.js`),
      import(`${FIREBASE_SDK}/firebase-auth.js`),
      import(`${FIREBASE_SDK}/firebase-firestore.js`)
    ]);
    return { initializeApp, getAuth, signInAnonymously, ...firestore };
  }

  async function connect(nextHooks = {}) {
    hooks = { ...hooks, ...nextHooks };
    if (!isConfigured()) {
      setStatus("local", "Firebase er ikke sat op endnu.");
      return false;
    }
    setStatus("connecting", "Forbinder…");
    try {
      const sdk = await loadSdk();
      app = sdk.initializeApp(window.FIREBASE_CONFIG);
      db = sdk.getFirestore(app);
      HjemmeSync._sdk = sdk;
      await sdk.signInAnonymously(sdk.getAuth(app));
      ready = true;
      setStatus("ready", "Klar til at dele.");
      return true;
    } catch (err) {
      ready = false;
      setStatus("error", firebaseError(err));
      return false;
    }
  }

  function attach(householdId) {
    if (!ready || !householdId || !db) return;
    const sdk = HjemmeSync._sdk;
    unsub?.();
    const ref = sdk.doc(db, "households", householdId);
    unsub = sdk.onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        if (data.writeId && data.writeId === lastWriteId) return;
        applyingRemote = true;
        setStatus("live", "Delt husstand");
        hooks.onRemote?.(data);
        applyingRemote = false;
      },
      (err) => {
        setStatus("error", firebaseError(err));
      }
    );
    setStatus("live", "Delt husstand");
  }

  function leave() {
    unsub?.();
    unsub = null;
    lastWriteId = null;
    if (ready) setStatus("ready", "Klar til at dele.");
  }

  async function writeHousehold(state) {
    if (!ready || !state.householdId) return;
    const sdk = HjemmeSync._sdk;
    const ref = sdk.doc(db, "households", state.householdId);
    await sdk.setDoc(ref, JSON.parse(JSON.stringify(cloudPayload(state))));
  }

  function push(state) {
    if (applyingRemote || !ready || !state.householdId) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      writeHousehold(state).catch((err) => setStatus("error", firebaseError(err)));
    }, 400);
  }

  async function createHousehold(state) {
    if (!ready) throw new Error("not-ready");
    const sdk = HjemmeSync._sdk;
    let code = makeCode();
    for (let i = 0; i < 6; i += 1) {
      const snap = await sdk.getDoc(sdk.doc(db, "households", code));
      if (!snap.exists()) break;
      code = makeCode();
    }
    state.householdId = code;
    await writeHousehold(state);
    attach(code);
    return code;
  }

  async function joinHousehold(code) {
    if (!ready) throw new Error("not-ready");
    const id = normalizeCode(code);
    if (id.length !== 6) throw new Error("bad-code");
    const sdk = HjemmeSync._sdk;
    const snap = await sdk.getDoc(sdk.doc(db, "households", id));
    if (!snap.exists()) throw new Error("not-found");
    attach(id);
    return snap.data();
  }

  function firebaseError(err) {
    const code = err?.code || "";
    if (code.includes("permission-denied")) {
      return "Firebase afviser skrivning. Tjek Authentication (anonym) og Firestore-reglerne.";
    }
    if (code.includes("unavailable") || code.includes("network")) {
      return "Ingen forbindelse til Firebase lige nu.";
    }
    if (code.includes("invalid-api-key") || code.includes("api-key")) {
      return "Firebase-nøglen ser forkert ud. Tjek js/firebase-config.js.";
    }
    if (code.includes("operation-not-allowed")) {
      return "Anonym login er ikke slået til i Firebase Authentication.";
    }
    return err?.message || "Firebase fejlede.";
  }

  return {
    isConfigured,
    isReady,
    getStatus,
    normalizeCode,
    connect,
    attach,
    leave,
    push,
    createHousehold,
    joinHousehold
  };
})();
