// db.js
//
// Deliberately simple: a debounced JSON-file store. For this exercise it
// gives us real cross-session, cross-device persistence without pulling in
// infrastructure. It is NOT what you'd run in production -- see README for
// the swap-in plan (Postgres for user/watchlist rows, Redis for the hot
// per-symbol quote cache, so N users watching the same symbol share one
// upstream subscription instead of N).

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'data', 'store.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    return { users: {} };
  }
}

let state = load();
let saveTimer = null;

function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
  }, 250);
}

const WORDS_A = ['SWIFT', 'QUIET', 'BOLD', 'CALM', 'SHARP', 'AMBER', 'CORAL', 'NORTH', 'RAPID', 'STEADY'];
const WORDS_B = ['FALCON', 'HARBOR', 'MAPLE', 'ORBIT', 'CINDER', 'LANTERN', 'RIVER', 'SIGNAL', 'GRANITE', 'ZENITH'];

function generateCode() {
  const a = WORDS_A[Math.floor(Math.random() * WORDS_A.length)];
  const b = WORDS_B[Math.floor(Math.random() * WORDS_B.length)];
  const n = Math.floor(10 + Math.random() * 89);
  return `${a}-${b}-${n}`;
}

function createUser() {
  let code;
  do { code = generateCode(); } while (state.users[code]);
  state.users[code] = {
    code,
    createdAt: Date.now(),
    watchlist: [],
    settings: {},        // symbol -> { sensitivity }
    theses: {},          // symbol -> { text, stance, addedAt, addedPrice }
    lastSeen: null,
    lastSnapshot: null,  // symbol -> { price, attentionScore, thesisStatus } at last ack
  };
  persist();
  return state.users[code];
}

function getUser(code) {
  const u = state.users[code] || null;
  if (u && !u.theses) u.theses = {}; // backward-compat for users created before thesis tracking
  return u;
}

function saveUser(user) {
  state.users[user.code] = user;
  persist();
}

// --- per-user serialization ---
//
// Requests are mostly synchronous, but a thesis save can trigger an LLM
// call that takes several real seconds (see llmAdvocate.js). During that
// await, Node's event loop is free to run other requests -- including a
// second request for the *same* user (two browser tabs, a settings change
// racing a thesis save, etc). Without this, two such requests could read
// and mutate the same in-memory user object in an interleaved, undefined
// order. withUserLock serializes all mutating operations for a given
// watchlist code into a single queue, so they always run one at a time in
// the order they arrived - cheap (no real lock/semaphore needed, just a
// promise chain) and invisible to the caller.
const userLocks = new Map(); // code -> tail promise of the queue

function withUserLock(code, fn) {
  const prevTail = userLocks.get(code) || Promise.resolve();
  const result = prevTail.then(fn, fn); // run fn next regardless of the previous op's outcome
  // Store a settled marker (never rejects) as the new tail, so one failed
  // operation can't permanently jam the queue for this user; the actual
  // result/error for THIS call still flows to the caller via `result`.
  userLocks.set(code, result.then(() => {}, () => {}));
  return result;
}

module.exports = { createUser, getUser, saveUser, withUserLock };
