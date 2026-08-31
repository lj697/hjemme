const FIREBASE_SDK = "https://www.gstatic.com/firebasejs/11.10.0";
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CLOUD_KEYS = [
  "householdName",
  "members",
  "suggestions",
  "shopping",
  "chores",
  "events",
  "notes",
  "meals",
  "money",
  "setupDone"
];

const HjemmeSync = (() => {
  let app = null;
  let db = null;
  let unsub = null;
  let ready = false;
  let lastWriteId = null;
  let saveTimer = null;
  let applyingRemote = false;
  let hydrated = false;
  let lastCloud = {};
  let pendingKeys = new Set();
  let pendingState = null;
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

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value ?? null));
  }

  function fieldFromState(state, key) {
    if (key === "notes") return state.notes || [];
    if (key === "meals") return state.meals || [];
    if (key === "money") return state.money || emptyMoney();
    if (key === "setupDone") return true;
    return state[key];
  }

  function fingerprint(value) {
    return JSON.stringify(value ?? null);
  }

  function rememberCloud(data) {
    lastCloud = {};
    if (!data) return;
    for (const key of CLOUD_KEYS) lastCloud[key] = cloneJson(data[key]);
  }

  function changedKeys(state) {
    return CLOUD_KEYS.filter((key) => fingerprint(fieldFromState(state, key)) !== fingerprint(lastCloud[key]));
  }

  function buildPayload(state, keys) {
    lastWriteId = uid();
    const body = {
      householdId: state.householdId,
      updatedAt: Date.now(),
      writeId: lastWriteId
    };
    for (const key of keys) body[key] = fieldFromState(state, key);
    return cloneJson(body);
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
    hydrated = false;
    pendingKeys.clear();
    pendingState = null;
    clearTimeout(saveTimer);
    const ref = sdk.doc(db, "households", householdId);
    unsub = sdk.onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        rememberCloud(data);
        hydrated = true;
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

  function adopt(state) {
    if (!state) return;
    lastCloud = {};
    for (const key of CLOUD_KEYS) lastCloud[key] = cloneJson(fieldFromState(state, key));
  }

  function leave() {
    unsub?.();
    unsub = null;
    lastWriteId = null;
    hydrated = false;
    lastCloud = {};
    pendingKeys.clear();
    pendingState = null;
    clearTimeout(saveTimer);
    if (ready) setStatus("ready", "Klar til at dele.");
  }

  async function writeHousehold(state, keys, merge) {
    if (!ready || !state.householdId || !keys.length) return;
    const sdk = HjemmeSync._sdk;
    const ref = sdk.doc(db, "households", state.householdId);
    await sdk.setDoc(ref, buildPayload(state, keys), merge ? { merge: true } : {});
    if (!lastCloud) lastCloud = {};
    for (const key of keys) lastCloud[key] = cloneJson(fieldFromState(state, key));
  }

  function push(state) {
    if (applyingRemote || !ready || !state.householdId || !hydrated) return;
    const extra = changedKeys(state);
    extra.forEach((key) => pendingKeys.add(key));
    if (!pendingKeys.size) return;
    pendingState = state;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const keys = [...pendingKeys];
      const snap = pendingState;
      pendingKeys.clear();
      pendingState = null;
      if (!hydrated || !snap || !keys.length) return;
      writeHousehold(snap, keys, true).catch((err) => setStatus("error", firebaseError(err)));
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
    await writeHousehold(state, CLOUD_KEYS, false);
    hydrated = true;
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
    rememberCloud(snap.data());
    hydrated = true;
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
    adopt,
    leave,
    push,
    createHousehold,
    joinHousehold
  };
})();
