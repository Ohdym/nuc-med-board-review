import { CATEGORY_CONFIG, IMPORT_TEMPLATE, QUESTION_BANK } from "./data.js";

const STORAGE_KEYS = {
  importedQuestions: "nmb-review-imported-questions",
  performance: "nmb-review-performance",
  liveProfile: "nmb-review-live-profile",
  liveAuth: "nmb-review-live-auth",
  sharedUserId: "nmb-review-shared-user-id",
};

const BOARD_VALUES = [100, 200, 300, 400, 500];

const app = document.querySelector("#app");

function loadSharedUserId() {
  const existing = localStorage.getItem(STORAGE_KEYS.sharedUserId);
  if (existing) {
    return existing;
  }

  const generated =
    window.crypto && window.crypto.randomUUID
      ? window.crypto.randomUUID()
      : `user-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(STORAGE_KEYS.sharedUserId, generated);
  return generated;
}

const state = {
  activeView: "dashboard",
  sharedUserId: loadSharedUserId(),
  importedQuestions: loadJSON(STORAGE_KEYS.importedQuestions, []),
  performance: loadJSON(STORAGE_KEYS.performance, []),
  quizConfig: {
    category: "all",
    count: 10,
    adaptive: true,
  },
  quizSession: null,
  mockConfig: {
    count: 25,
    durationMinutes: 32,
    adaptive: true,
  },
  mockSession: null,
  jeopardy: {
    mode: "solo",
    categories: [],
    board: [],
    answered: {},
    activeTile: null,
    score: 0,
  },
  live: {
    username: loadJSON(STORAGE_KEYS.liveProfile, { username: "" }).username || "",
    joinCode: "",
    auth: loadJSON(STORAGE_KEYS.liveAuth, null),
    session: null,
    page: "board",
    answerIndex: null,
    lastQuestionKey: null,
    connectionStatus: "idle",
    error: "",
    info: "Host a live multiplayer board with a join code and rotating chooser turns.",
    busy: false,
    ws: null,
    manualDisconnect: false,
  },
  importDraft: "",
  importFeedback: {
    tone: "info",
    message: "Import JSON or CSV to add your own board-style questions.",
  },
};

let mockTimerHandle = null;

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.warn(`Failed to load ${key}`, error);
    return fallback;
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return null;
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return "0%";
  }
  return `${Math.round(value)}%`;
}

function shuffle(list) {
  const next = [...list];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function uniqueById(questions) {
  const seen = new Set();
  return questions.filter((question) => {
    if (seen.has(question.id)) {
      return false;
    }
    seen.add(question.id);
    return true;
  });
}

function getAllQuestions() {
  return uniqueById([...QUESTION_BANK, ...state.importedQuestions]);
}

function getCategories() {
  const known = new Map(CATEGORY_CONFIG.map((item) => [item.name, item]));
  for (const name of [...new Set(getAllQuestions().map((question) => question.category))]) {
    if (!known.has(name)) {
      known.set(name, {
        id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        name,
        shortName: name,
        description: "Imported content",
      });
    }
  }
  return [...known.values()];
}

function groupAttempts(entries, key) {
  const map = {};
  for (const entry of entries) {
    const bucket = entry[key];
    if (!bucket) {
      continue;
    }
    if (!map[bucket]) {
      map[bucket] = { attempts: 0, correct: 0 };
    }
    map[bucket].attempts += 1;
    map[bucket].correct += entry.correct ? 1 : 0;
  }
  for (const stats of Object.values(map)) {
    stats.accuracy = stats.attempts ? (stats.correct / stats.attempts) * 100 : 0;
    stats.missRate = 1 - stats.correct / stats.attempts;
  }
  return map;
}

function getWeakSet(map) {
  return new Set(
    Object.entries(map)
      .filter(([, stats]) => stats.attempts >= 2 || stats.correct === 0)
      .sort((first, second) => {
        const accuracyDelta = first[1].accuracy - second[1].accuracy;
        if (accuracyDelta !== 0) {
          return accuracyDelta;
        }
        return second[1].attempts - first[1].attempts;
      })
      .slice(0, 3)
      .map(([name]) => name),
  );
}

function computePerformanceSummary() {
  const total = state.performance.length;
  const correct = state.performance.filter((entry) => entry.correct).length;
  const accuracy = total ? (correct / total) * 100 : 0;
  const categoryMap = groupAttempts(state.performance, "category");
  const topicMap = groupAttempts(state.performance, "topic");
  const typeMap = groupAttempts(state.performance, "type");
  const weakCategories = getWeakSet(categoryMap);
  const weakTopics = getWeakSet(topicMap);
  const weakTypes = getWeakSet(typeMap);
  const weakestCategoryEntry = Object.entries(categoryMap).sort((a, b) => a[1].accuracy - b[1].accuracy)[0];
  const weakestTopicEntry = Object.entries(topicMap).sort((a, b) => a[1].accuracy - b[1].accuracy)[0];
  const weakestCategory = weakestCategoryEntry ? weakestCategoryEntry[0] : null;
  const weakestTopic = weakestTopicEntry ? weakestTopicEntry[0] : null;
  const uniqueAnswered = new Set(state.performance.map((entry) => entry.questionId)).size;
  const totalQuestions = getAllQuestions().length;
  const coverage = totalQuestions ? (uniqueAnswered / totalQuestions) * 100 : 0;
  const readiness = clamp(Math.round(accuracy * 0.7 + coverage * 0.3), 0, 100);

  return {
    total,
    correct,
    accuracy,
    coverage,
    readiness,
    categoryMap,
    topicMap,
    typeMap,
    weakCategories,
    weakTopics,
    weakTypes,
    weakestCategory,
    weakestTopic,
  };
}

function getQuestionWeight(question, summary, adaptive) {
  let weight = 1;

  if (!adaptive) {
    return weight;
  }

  const categoryMissRate = summary.categoryMap[question.category]
    ? summary.categoryMap[question.category].missRate
    : 0;
  const topicMissRate = summary.topicMap[question.topic]
    ? summary.topicMap[question.topic].missRate
    : 0;
  const typeMissRate = summary.typeMap[question.type]
    ? summary.typeMap[question.type].missRate
    : 0;

  weight += categoryMissRate * 2.5;
  weight += topicMissRate * 3.5;
  weight += typeMissRate * 1.5;

  if (summary.weakCategories.has(question.category)) {
    weight += 1.25;
  }
  if (summary.weakTopics.has(question.topic)) {
    weight += 1.75;
  }
  if (summary.weakTypes.has(question.type)) {
    weight += 0.75;
  }

  return weight;
}

function pickWeightedQuestion(pool, summary, options = {}) {
  const { adaptive = true, targetDifficulty = null, allowUsedIds = new Set() } = options;
  const eligible = pool.filter((question) => !allowUsedIds.has(question.id));

  if (!eligible.length) {
    return null;
  }

  const scored = eligible.map((question) => {
    let weight = getQuestionWeight(question, summary, adaptive);

    if (targetDifficulty !== null) {
      const difficultyGap = Math.abs(question.difficulty - targetDifficulty);
      weight += Math.max(0, 3 - difficultyGap) * 1.4;
      if (
        (summary.weakCategories.has(question.category) ||
          summary.weakTopics.has(question.topic) ||
          summary.weakTypes.has(question.type)) &&
        question.difficulty >= targetDifficulty
      ) {
        weight += 1.2;
      }
    }

    return { question, weight };
  });

  const totalWeight = scored.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = Math.random() * totalWeight;

  for (const entry of scored) {
    cursor -= entry.weight;
    if (cursor <= 0) {
      return entry.question;
    }
  }

  return scored[scored.length - 1].question;
}

function selectQuestions(pool, count, summary, adaptive) {
  const selected = [];
  const usedIds = new Set();
  const maxCount = Math.min(count, pool.length);

  while (selected.length < maxCount) {
    const question = pickWeightedQuestion(pool, summary, { adaptive, allowUsedIds: usedIds });
    if (!question) {
      break;
    }
    usedIds.add(question.id);
    selected.push(question);
  }

  return selected;
}

function buildMockExamQuestions(count, summary, adaptive) {
  const categories = [...new Set(getAllQuestions().map((question) => question.category))];
  const buckets = new Map();

  for (const category of categories) {
    buckets.set(
      category,
      shuffle(getAllQuestions().filter((question) => question.category === category)),
    );
  }

  const selected = [];
  const usedIds = new Set();
  let categoryIndex = 0;

  while (selected.length < Math.min(count, getAllQuestions().length)) {
    const category = categories[categoryIndex % categories.length];
    const categoryBucket = buckets.get(category);
    const categoryPool = categoryBucket
      ? categoryBucket.filter((question) => !usedIds.has(question.id))
      : [];
    const overallPool = getAllQuestions().filter((question) => !usedIds.has(question.id));
    const pool = categoryPool.length ? categoryPool : overallPool;
    const question = pickWeightedQuestion(pool, summary, { adaptive, allowUsedIds: usedIds });

    if (!question) {
      break;
    }

    usedIds.add(question.id);
    selected.push(question);
    categoryIndex += 1;
  }

  return selected;
}

function recordAttempt(question, correct, mode) {
  state.performance.push({
    questionId: question.id,
    category: question.category,
    topic: question.topic,
    type: question.type,
    difficulty: question.difficulty,
    mode,
    correct,
    timestamp: Date.now(),
  });
  saveJSON(STORAGE_KEYS.performance, state.performance);
  reportSharedAttempt(question, correct, mode);
}

function reportSharedAttempt(question, correct, mode) {
  fetch(getLiveServerHttpUrl("/api/attempts"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userId: state.sharedUserId,
      attempts: [
        {
          questionId: question.id,
          correct,
          mode,
        },
      ],
    }),
    keepalive: true,
  }).catch(() => {
    // Shared difficulty sync is best-effort when the multiplayer server is reachable.
  });
}

function startQuiz() {
  const summary = computePerformanceSummary();
  const pool =
    state.quizConfig.category === "all"
      ? getAllQuestions()
      : getAllQuestions().filter((question) => question.category === state.quizConfig.category);
  const questions = selectQuestions(pool, state.quizConfig.count, summary, state.quizConfig.adaptive);

  state.quizSession = {
    questions,
    index: 0,
    selectedIndex: null,
    submitted: false,
    results: [],
    finished: false,
  };
}

function startMock() {
  const summary = computePerformanceSummary();
  const questions = buildMockExamQuestions(
    state.mockConfig.count,
    summary,
    state.mockConfig.adaptive,
  );

  state.mockSession = {
    questions,
    currentIndex: 0,
    answers: {},
    submitted: false,
    startedAt: Date.now(),
    durationMinutes: state.mockConfig.durationMinutes,
    results: null,
  };

  ensureMockTimer();
}

function getRemainingMockSeconds() {
  if (!state.mockSession || state.mockSession.submitted) {
    return 0;
  }

  const totalSeconds = state.mockSession.durationMinutes * 60;
  const elapsedSeconds = Math.floor((Date.now() - state.mockSession.startedAt) / 1000);
  return Math.max(0, totalSeconds - elapsedSeconds);
}

function clearMockTimer() {
  if (mockTimerHandle) {
    window.clearInterval(mockTimerHandle);
    mockTimerHandle = null;
  }
}

function ensureMockTimer() {
  clearMockTimer();
  if (!state.mockSession || state.mockSession.submitted) {
    return;
  }

  mockTimerHandle = window.setInterval(() => {
    if (!state.mockSession || state.mockSession.submitted) {
      clearMockTimer();
      return;
    }
    if (getRemainingMockSeconds() <= 0) {
      finalizeMockExam();
      return;
    }
    renderApp();
  }, 1000);
}

function finalizeMockExam() {
  if (!state.mockSession || state.mockSession.submitted) {
    return;
  }

  const results = state.mockSession.questions.map((question) => {
    const selectedIndex = state.mockSession.answers[question.id];
    const correct = selectedIndex === question.answerIndex;
    recordAttempt(question, correct, "mock");
    return {
      question,
      selectedIndex,
      correct,
    };
  });

  state.mockSession.submitted = true;
  state.mockSession.results = results;
  clearMockTimer();
  renderApp();
}

function chooseJeopardyCategories(summary) {
  const categoryCounts = getAllQuestions().reduce((map, question) => {
    map[question.category] = (map[question.category] || 0) + 1;
    return map;
  }, {});
  const allCategories = [...new Set(getAllQuestions().map((question) => question.category))];
  const preferredCategories = allCategories.filter((category) => (categoryCounts[category] || 0) >= 5);
  const categories = preferredCategories.length >= 5 ? preferredCategories : allCategories;
  const weighted = categories.map((category) => {
    const missRate = summary.categoryMap[category] ? summary.categoryMap[category].missRate : 0;
    const attempts = summary.categoryMap[category] ? summary.categoryMap[category].attempts : 0;
    return {
      category,
      weight: 1 + missRate * 3 + Math.min(attempts / 3, 2),
    };
  });

  const chosen = [];
  const available = [...weighted];

  while (chosen.length < Math.min(5, categories.length) && available.length) {
    const totalWeight = available.reduce((sum, entry) => sum + entry.weight, 0);
    let cursor = Math.random() * totalWeight;
    let pickIndex = available.length - 1;

    for (let index = 0; index < available.length; index += 1) {
      cursor -= available[index].weight;
      if (cursor <= 0) {
        pickIndex = index;
        break;
      }
    }

    chosen.push(available[pickIndex].category);
    available.splice(pickIndex, 1);
  }

  return shuffle(chosen);
}

function buildJeopardyBoard() {
  const summary = computePerformanceSummary();
  const categories = chooseJeopardyCategories(summary);
  const usedIds = new Set();
  const board = categories.map((category) =>
    BOARD_VALUES.map((value, valueIndex) => {
      const targetDifficulty = valueIndex + 1;
      const categoryPool = getAllQuestions().filter((question) => question.category === category);
      const question = pickWeightedQuestion(categoryPool, summary, {
        adaptive: true,
        allowUsedIds: usedIds,
        targetDifficulty,
      });

      if (question) {
        usedIds.add(question.id);
      }

      return {
        value,
        targetDifficulty,
        question,
      };
    }),
  );

  state.jeopardy = {
    categories,
    board,
    answered: {},
    activeTile: null,
    score: 0,
  };
}

function openJeopardyTile(columnIndex, rowIndex) {
  const column = state.jeopardy.board[columnIndex];
  const tile = column ? column[rowIndex] : null;
  if (!tile || !tile.question || state.jeopardy.answered[tile.question.id]) {
    return;
  }
  state.jeopardy.activeTile = {
    columnIndex,
    rowIndex,
    selectedIndex: null,
    submitted: false,
  };
}

function finalizeJeopardyTile() {
  const activeTile = state.jeopardy.activeTile;
  if (!activeTile) {
    return;
  }

  const tile = state.jeopardy.board[activeTile.columnIndex][activeTile.rowIndex];
  const question = tile.question;
  const correct = activeTile.selectedIndex === question.answerIndex;

  recordAttempt(question, correct, "jeopardy");
  state.jeopardy.answered[question.id] = {
    correct,
    value: tile.value,
  };
  if (correct) {
    state.jeopardy.score += tile.value;
  }
  state.jeopardy.activeTile.submitted = true;
}

function closeJeopardyTile() {
  state.jeopardy.activeTile = null;
}

function normalizeQuestion(raw, index) {
  const options = Array.isArray(raw.options)
    ? raw.options
    : [raw.optionA, raw.optionB, raw.optionC, raw.optionD].filter(Boolean);

  const answerToken = firstDefined(
    raw.answerIndex,
    raw.correctAnswer,
    raw.answer,
    raw.correct_index,
    raw.correctOption,
  );

  let answerIndex =
    String(answerToken === undefined || answerToken === null ? "" : answerToken).trim() === ""
      ? -1
      : Number(answerToken);

  if (!Number.isInteger(answerIndex)) {
    const letters = { a: 0, b: 1, c: 2, d: 3 };
    const letterKey = String(answerToken === undefined || answerToken === null ? "" : answerToken)
      .trim()
      .toLowerCase();
    answerIndex = Object.prototype.hasOwnProperty.call(letters, letterKey) ? letters[letterKey] : -1;
  }

  if (answerIndex < 0 && options.length) {
    answerIndex = options.findIndex(
      (option) =>
        String(option).trim() ===
        String(answerToken === undefined || answerToken === null ? "" : answerToken).trim(),
    );
  }

  const difficulty = clamp(Number(raw.difficulty) || 1, 1, 5);
  const category = String(firstDefined(raw.category, "")).trim();
  const topic = String(firstDefined(raw.topic, "Imported Topic")).trim();
  const type = String(firstDefined(raw.type, "concept")).trim();
  const question = String(firstDefined(raw.question, raw.prompt, "")).trim();

  if (!category || !question || options.length < 2 || answerIndex < 0 || answerIndex >= options.length) {
    return null;
  }

  return {
    id: String(firstDefined(raw.id, `imported-${Date.now()}-${index}`)),
    category,
    topic,
    type,
    difficulty,
    question,
    options: options.map((option) => String(option)),
    answerIndex,
    explanation: String(firstDefined(raw.explanation, "Imported question with no explanation provided.")),
  };
}

function parseCSV(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      if (current.length || row.length) {
        row.push(current);
        rows.push(row);
      }
      current = "";
      row = [];
      continue;
    }

    current += char;
  }

  if (current.length || row.length) {
    row.push(current);
    rows.push(row);
  }

  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((values) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = values[index] ? values[index].trim() : "";
    });
    return record;
  });
}

function parseImportedText(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    const records = Array.isArray(parsed) ? parsed : parsed.questions || [];
    return records.map(normalizeQuestion).filter(Boolean);
  }

  return parseCSV(trimmed).map(normalizeQuestion).filter(Boolean);
}

function importQuestions() {
  try {
    const parsedQuestions = parseImportedText(state.importDraft);

    if (!parsedQuestions.length) {
      state.importFeedback = {
        tone: "error",
        message:
          "No valid questions were found. Confirm the data includes category, topic, type, difficulty, question, options, and the correct answer.",
      };
      return;
    }

    const merged = uniqueById([...state.importedQuestions, ...parsedQuestions]);
    state.importedQuestions = merged;
    saveJSON(STORAGE_KEYS.importedQuestions, state.importedQuestions);
    state.importFeedback = {
      tone: "success",
      message: `${parsedQuestions.length} question${parsedQuestions.length === 1 ? "" : "s"} imported successfully.`,
    };
    buildJeopardyBoard();
  } catch (error) {
    state.importFeedback = {
      tone: "error",
      message: `Import failed: ${error.message}`,
    };
  }
}

function clearImportedQuestions() {
  state.importedQuestions = [];
  saveJSON(STORAGE_KEYS.importedQuestions, state.importedQuestions);
  state.importFeedback = {
    tone: "info",
    message: "Imported questions cleared. Seeded study bank remains available.",
  };
  buildJeopardyBoard();
}

function getActiveQuizQuestion() {
  return state.quizSession ? state.quizSession.questions[state.quizSession.index] : null;
}

function submitQuizQuestion() {
  const session = state.quizSession;
  const question = getActiveQuizQuestion();

  if (!session || !question || session.selectedIndex === null) {
    return;
  }

  const correct = session.selectedIndex === question.answerIndex;
  session.submitted = true;
  session.results.push({
    questionId: question.id,
    selectedIndex: session.selectedIndex,
    correct,
  });
  recordAttempt(question, correct, "quiz");
}

function advanceQuizQuestion() {
  const session = state.quizSession;
  if (!session) {
    return;
  }

  if (session.index >= session.questions.length - 1) {
    session.finished = true;
    return;
  }

  session.index += 1;
  session.selectedIndex = null;
  session.submitted = false;
}

function resetQuiz() {
  state.quizSession = null;
}

function resetMock() {
  state.mockSession = null;
  clearMockTimer();
}

function getQuizSummary() {
  if (!state.quizSession) {
    return null;
  }

  const total = state.quizSession.results.length;
  const correct = state.quizSession.results.filter((result) => result.correct).length;
  return {
    total,
    correct,
    accuracy: total ? (correct / total) * 100 : 0,
  };
}

function getMockSummary() {
  if (!state.mockSession || !state.mockSession.results) {
    return null;
  }

  const total = state.mockSession.results.length;
  const correct = state.mockSession.results.filter((result) => result.correct).length;
  return {
    total,
    correct,
    accuracy: total ? (correct / total) * 100 : 0,
  };
}

function normalizeLiveCode(value) {
  return String(value || "").replace(/[^0-9]/g, "").slice(0, 6);
}

function getLiveServerHttpUrl(path) {
  return `${window.location.origin}${path}`;
}

function getLiveServerWsUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

function persistLiveProfile() {
  saveJSON(STORAGE_KEYS.liveProfile, { username: state.live.username });
}

function persistLiveAuth() {
  if (state.live.auth) {
    saveJSON(STORAGE_KEYS.liveAuth, state.live.auth);
    return;
  }
  localStorage.removeItem(STORAGE_KEYS.liveAuth);
}

function setLiveMessage(tone, message) {
  if (tone === "error") {
    state.live.error = message;
    return;
  }
  state.live.error = "";
  state.live.info = message;
}

async function apiRequest(path, method, payload) {
  const response = await fetch(getLiveServerHttpUrl(path), {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  let body = null;
  try {
    body = await response.json();
  } catch (error) {
    body = null;
  }

  if (!response.ok) {
    const message = body && body.error ? body.error : `Request failed with status ${response.status}.`;
    throw new Error(message);
  }

  return body;
}

function getSelfPlayer() {
  if (!state.live.session || !state.live.auth) {
    return null;
  }
  return state.live.session.players.find((player) => player.id === state.live.auth.playerId) || null;
}

function isMyTurn() {
  return (
    state.live.session &&
    state.live.auth &&
    state.live.session.currentTurnPlayerId === state.live.auth.playerId
  );
}

function getLiveQuestionKey(session) {
  if (!session || !session.activeQuestion) {
    return null;
  }
  return `${session.activeQuestion.columnIndex}-${session.activeQuestion.rowIndex}-${session.status}`;
}

function closeLiveSocket(resetState) {
  if (state.live.ws) {
    state.live.manualDisconnect = true;
    state.live.ws.close();
    state.live.ws = null;
  }
  state.live.connectionStatus = "idle";
  if (resetState) {
    state.live.session = null;
    state.live.answerIndex = null;
    state.live.lastQuestionKey = null;
  }
}

function leaveLiveGame() {
  closeLiveSocket(true);
  state.live.auth = null;
  state.live.page = "board";
  persistLiveAuth();
  setLiveMessage("info", "You have left the live game.");
}

function sendLiveAction(action, payload) {
  if (!state.live.ws || state.live.ws.readyState !== WebSocket.OPEN) {
    setLiveMessage("error", "Live connection is not open.");
    renderApp();
    return;
  }

  state.live.ws.send(JSON.stringify({ action, ...payload }));
}

function connectLiveSocket() {
  if (!state.live.auth) {
    return;
  }

  if (state.live.ws) {
    state.live.manualDisconnect = true;
    state.live.ws.close();
  }

  const url = `${getLiveServerWsUrl()}?code=${encodeURIComponent(
    state.live.auth.code,
  )}&token=${encodeURIComponent(state.live.auth.playerToken)}`;

  state.live.connectionStatus = "connecting";
  state.live.manualDisconnect = false;
  setLiveMessage("info", "Connecting to the live game...");

  const socket = new WebSocket(url);
  state.live.ws = socket;

  socket.addEventListener("open", () => {
    state.live.connectionStatus = "connected";
    setLiveMessage("info", "Connected to the live game.");
    renderApp();
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);

    if (message.type === "error") {
      setLiveMessage("error", message.message);
      renderApp();
      return;
    }

    if (message.type === "state") {
      state.live.session = message.session;
      const nextKey = getLiveQuestionKey(message.session);
      if (state.live.lastQuestionKey !== nextKey) {
        state.live.answerIndex = null;
      }
      if (message.session.activeQuestion && message.session.status === "question") {
        state.live.answerIndex =
          message.session.activeQuestion.selectedIndex !== null &&
          message.session.activeQuestion.selectedIndex !== undefined
            ? message.session.activeQuestion.selectedIndex
            : state.live.answerIndex;
      }
      state.live.lastQuestionKey = nextKey;
      if (!message.session.activeQuestion || message.session.status !== "question") {
        state.live.answerIndex = null;
      }
      renderApp();
    }
  });

  socket.addEventListener("close", () => {
    state.live.ws = null;
    state.live.connectionStatus = "disconnected";
    if (!state.live.manualDisconnect) {
      setLiveMessage("error", "Live connection lost. Rejoin or reconnect to continue.");
    }
    renderApp();
  });

  socket.addEventListener("error", () => {
    state.live.connectionStatus = "disconnected";
    setLiveMessage("error", "Could not reach the multiplayer server. Start `python3 server.py` first.");
    renderApp();
  });
}

async function createLiveGame() {
  if (state.live.busy) {
    return;
  }

  const username = state.live.username.trim();
  if (username.length < 2) {
    setLiveMessage("error", "Enter a username with at least 2 characters.");
    renderApp();
    return;
  }

  state.live.busy = true;
  persistLiveProfile();

  try {
    const data = await apiRequest("/api/games/create", "POST", { username });
    state.live.auth = {
      code: data.code,
      playerId: data.playerId,
      playerToken: data.playerToken,
      host: data.host,
    };
    persistLiveAuth();
    state.activeView = "jeopardy";
    setJeopardyMode("online");
    setLiveMessage("info", `Game ${data.code} created. Share the code so others can join.`);
    connectLiveSocket();
  } catch (error) {
    setLiveMessage("error", error.message || "Could not create the live game.");
  } finally {
    state.live.busy = false;
    renderApp();
  }
}

async function joinLiveGame() {
  if (state.live.busy) {
    return;
  }

  const username = state.live.username.trim();
  const code = normalizeLiveCode(state.live.joinCode);

  if (username.length < 2) {
    setLiveMessage("error", "Enter a username with at least 2 characters.");
    renderApp();
    return;
  }

  if (code.length !== 6) {
    setLiveMessage("error", "Enter a 6-digit join code.");
    renderApp();
    return;
  }

  state.live.busy = true;
  persistLiveProfile();

  try {
    const data = await apiRequest("/api/games/join", "POST", { username, code });
    state.live.auth = {
      code: data.code,
      playerId: data.playerId,
      playerToken: data.playerToken,
      host: data.host,
    };
    persistLiveAuth();
    state.activeView = "jeopardy";
    setJeopardyMode("online");
    setLiveMessage("info", `Joined game ${data.code}. Waiting for the host to start.`);
    connectLiveSocket();
  } catch (error) {
    setLiveMessage("error", error.message || "Could not join the live game.");
  } finally {
    state.live.busy = false;
    renderApp();
  }
}

function reconnectLiveGame() {
  if (!state.live.auth) {
    setLiveMessage("error", "No saved live game session was found.");
    renderApp();
    return;
  }
  connectLiveSocket();
  renderApp();
}

function setJeopardyMode(mode) {
  state.jeopardy.mode = mode === "online" ? "online" : "solo";
  if (state.jeopardy.mode === "online" && state.live.page !== "leaderboard") {
    state.live.page = "board";
  }
}

function formatOnlineCategoryLabel(category) {
  return category === "Radiopharmaceuticals" ? "Radiopharm" : category;
}

function renderMetric(label, value, tone = "default") {
  return `
    <article class="metric-card metric-card--${tone}">
      <span class="metric-card__label">${escapeHtml(label)}</span>
      <strong class="metric-card__value">${escapeHtml(value)}</strong>
    </article>
  `;
}

function renderSectionIntro(eyebrow, title, body) {
  return `
    <div class="section-intro">
      <span class="section-intro__eyebrow">${escapeHtml(eyebrow)}</span>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(body)}</p>
    </div>
  `;
}

function renderAppChrome(summary) {
  const liveCode = state.live.auth ? state.live.auth.code : "No live game";
  return `
    <header class="topbar">
      <div class="brand">
        <div class="brand__mark">NM</div>
        <div class="brand__copy">
          <strong>Nuclear Medicine Boards Review</strong>
          <span>Solo prep, mock exams, and live multiplayer Jeopardy</span>
        </div>
      </div>
      <div class="topbar__meta">
        <article class="status-chip">
          <span>Readiness</span>
          <strong>${formatPercent(summary.readiness)}</strong>
        </article>
        <article class="status-chip">
          <span>Question Bank</span>
          <strong>${getAllQuestions().length}</strong>
        </article>
        <article class="status-chip ${state.live.auth ? "status-chip--live" : ""}">
          <span>Last live code used</span>
          <strong>${escapeHtml(liveCode)}</strong>
        </article>
      </div>
    </header>
    <section class="headline">
      <div class="headline__copy">
        <span class="headline__eyebrow">Professional Review App</span>
        <h1>Board-focused study with a tighter workflow and live join-code gameplay.</h1>
        <p>Move between adaptive study modes and a Kahoot-style live board flow with randomized chooser turns and synchronized scoring.</p>
      </div>
      <div class="headline__actions">
        <button type="button" class="button button--primary" data-action="set-jeopardy-mode" data-mode="online">Open Online Jeopardy</button>
        <button type="button" class="button button--ghost" data-view="quiz">Start Quiz</button>
      </div>
    </section>
  `;
}

function renderDashboard(summary) {
  const categories = getCategories();
  const weakAreas = [...summary.weakTopics].slice(0, 3);

  return `
    <section class="view view--dashboard">
      ${renderSectionIntro(
        "Board Review",
        "Focused Nuclear Medicine preparation",
        "Train by registry-style content areas, close knowledge gaps with adaptive practice, and move into live recall sessions with shared Jeopardy play.",
      )}
      <div class="card-grid card-grid--metrics">
        ${renderMetric("Readiness", formatPercent(summary.readiness), "gold")}
        ${renderMetric("Overall Accuracy", formatPercent(summary.accuracy), "blue")}
        ${renderMetric("Question Bank", `${getAllQuestions().length} total`, "default")}
        ${renderMetric("Weakest Category", summary.weakestCategory || "Not enough data yet", "default")}
      </div>
      <div class="split-layout">
        <section class="panel">
          <div class="panel__header">
            <h3>ARRT / NM Board-style categories</h3>
            <p>Organized for quick topic selection, targeted drilling, and full-board review.</p>
          </div>
          <div class="category-list">
            ${categories
              .map((category) => {
                const count = getAllQuestions().filter((question) => question.category === category.name).length;
                const accuracy = summary.categoryMap[category.name]
                  ? summary.categoryMap[category.name].accuracy
                  : undefined;
                return `
                  <article class="category-card">
                    <div>
                      <h4>${escapeHtml(category.shortName)}</h4>
                      <p>${escapeHtml(category.description)}</p>
                    </div>
                    <div class="category-card__meta">
                      <span>${count} questions</span>
                      <span>${accuracy !== undefined ? formatPercent(accuracy) : "No attempts yet"}</span>
                    </div>
                  </article>
                `;
              })
              .join("")}
          </div>
        </section>
        <section class="panel">
          <div class="panel__header">
            <h3>Study signals</h3>
            <p>Solo modes build your accuracy profile, while live play adds shared recall and fast answer pacing.</p>
          </div>
          <div class="insight-stack">
            <article class="insight-card">
              <span class="insight-card__label">Weak topics</span>
              <strong>${weakAreas.length ? escapeHtml(weakAreas.join(", ")) : "Build a few sessions to surface weak topics."}</strong>
            </article>
            <article class="insight-card">
              <span class="insight-card__label">Coverage</span>
              <strong>${formatPercent(summary.coverage)} of the question bank seen</strong>
            </article>
            <article class="insight-card">
              <span class="insight-card__label">Live play</span>
              <strong>Host with a join code, let everyone answer, and rotate the chooser every round.</strong>
            </article>
          </div>
        </section>
      </div>
    </section>
  `;
}

function renderQuizView(summary) {
  const categories = getCategories();
  const session = state.quizSession;

  if (!session) {
    return `
      <section class="view">
        ${renderSectionIntro(
          "Quiz Builder",
          "Target a domain and get immediate feedback",
          "Use short adaptive sets to sharpen one category at a time, with explanations after every item.",
        )}
        <div class="panel panel--form">
          <div class="form-grid">
            <label class="field">
              <span>Category</span>
              <select id="quiz-category">
                <option value="all" ${state.quizConfig.category === "all" ? "selected" : ""}>All categories</option>
                ${categories
                  .map(
                    (category) =>
                      `<option value="${escapeHtml(category.name)}" ${
                        state.quizConfig.category === category.name ? "selected" : ""
                      }>${escapeHtml(category.name)}</option>`,
                  )
                  .join("")}
              </select>
            </label>
            <label class="field">
              <span>Question count</span>
              <select id="quiz-count">
                ${[5, 10, 15]
                  .map(
                    (count) =>
                      `<option value="${count}" ${state.quizConfig.count === count ? "selected" : ""}>${count}</option>`,
                  )
                  .join("")}
              </select>
            </label>
            <label class="field field--toggle">
              <span>Adaptive focus</span>
              <button type="button" class="toggle ${state.quizConfig.adaptive ? "is-on" : ""}" data-action="toggle-quiz-adaptive">
                ${state.quizConfig.adaptive ? "On" : "Off"}
              </button>
            </label>
          </div>
          <div class="panel__footer">
            <p>Current weak topic: <strong>${escapeHtml(summary.weakestTopic || "None yet")}</strong></p>
            <button type="button" class="button button--primary" data-action="start-quiz">Start quiz</button>
          </div>
        </div>
      </section>
    `;
  }

  if (session.finished) {
    const quizSummary = getQuizSummary();
    return `
      <section class="view">
        ${renderSectionIntro(
          "Quiz Review",
          "Immediate feedback complete",
          "Use the explanation-driven format to convert misses into retrieval strength before your next mock exam.",
        )}
        <div class="panel result-panel">
          <div class="result-panel__score">
            <span>Score</span>
            <strong>${quizSummary.correct}/${quizSummary.total}</strong>
            <p>${formatPercent(quizSummary.accuracy)} accuracy</p>
          </div>
          <div class="result-panel__actions">
            <button type="button" class="button button--primary" data-action="restart-quiz">Build another quiz</button>
            <button type="button" class="button button--ghost" data-action="set-jeopardy-mode" data-mode="online">Open online Jeopardy</button>
          </div>
        </div>
      </section>
    `;
  }

  const question = getActiveQuizQuestion();
  const result = session.results.find((item) => item.questionId === question.id);

  return `
    <section class="view">
      ${renderSectionIntro(
        "Quiz In Progress",
        `${question.category}`,
        `${question.topic} • Difficulty ${question.difficulty}`,
      )}
      <div class="progress-row">
        <span>Question ${session.index + 1} of ${session.questions.length}</span>
        <span>${state.quizConfig.adaptive ? "Adaptive weighting active" : "Standard random draw"}</span>
      </div>
      <article class="question-card">
        <div class="question-card__meta">
          <span class="pill">${escapeHtml(question.type)}</span>
          <span class="pill">${escapeHtml(question.topic)}</span>
        </div>
        <h3>${escapeHtml(question.question)}</h3>
        <div class="option-list">
          ${question.options
            .map((option, index) => {
              const isSelected = session.selectedIndex === index;
              const isCorrect = question.answerIndex === index;
              const isWrongChoice = session.submitted && isSelected && !isCorrect;
              const classes = [
                "option",
                isSelected ? "is-selected" : "",
                session.submitted && isCorrect ? "is-correct" : "",
                isWrongChoice ? "is-wrong" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return `
                <button
                  type="button"
                  class="${classes}"
                  data-action="select-quiz-option"
                  data-index="${index}"
                  ${session.submitted ? "disabled" : ""}
                >
                  <span>${String.fromCharCode(65 + index)}</span>
                  <strong>${escapeHtml(option)}</strong>
                </button>
              `;
            })
            .join("")}
        </div>
        ${
          session.submitted
            ? `
              <div class="feedback ${result && result.correct ? "feedback--correct" : "feedback--wrong"}">
                <strong>${result && result.correct ? "Correct" : "Not quite"}</strong>
                <p>${escapeHtml(question.explanation)}</p>
              </div>
            `
            : ""
        }
        <div class="question-card__actions">
          ${
            session.submitted
              ? `<button type="button" class="button button--primary" data-action="next-quiz">Next question</button>`
              : `<button type="button" class="button button--primary" data-action="submit-quiz" ${
                  session.selectedIndex === null ? "disabled" : ""
                }>Check answer</button>`
          }
          <button type="button" class="button button--ghost" data-action="restart-quiz">End quiz</button>
        </div>
      </article>
    </section>
  `;
}

function renderMockView() {
  const session = state.mockSession;

  if (!session) {
    return `
      <section class="view">
        ${renderSectionIntro(
          "Mock Exam",
          "Timed full-board rehearsal",
          "Run a balanced exam set across major Nuclear Medicine domains and review your misses after submission.",
        )}
        <div class="panel panel--form">
          <div class="form-grid">
            <label class="field">
              <span>Exam length</span>
              <select id="mock-count">
                ${[20, 25, 35]
                  .map(
                    (count) =>
                      `<option value="${count}" ${state.mockConfig.count === count ? "selected" : ""}>${count} questions</option>`,
                  )
                  .join("")}
              </select>
            </label>
            <label class="field">
              <span>Timer</span>
              <select id="mock-duration">
                ${[25, 32, 45]
                  .map(
                    (minutes) =>
                      `<option value="${minutes}" ${state.mockConfig.durationMinutes === minutes ? "selected" : ""}>${minutes} minutes</option>`,
                  )
                  .join("")}
              </select>
            </label>
            <label class="field field--toggle">
              <span>Adaptive weighting</span>
              <button type="button" class="toggle ${state.mockConfig.adaptive ? "is-on" : ""}" data-action="toggle-mock-adaptive">
                ${state.mockConfig.adaptive ? "On" : "Off"}
              </button>
            </label>
          </div>
          <div class="panel__footer">
            <p>Mixes categories for a board-style review run, then feeds your weaker topics back into solo board practice.</p>
            <button type="button" class="button button--primary" data-action="start-mock">Start mock exam</button>
          </div>
        </div>
      </section>
    `;
  }

  if (session.submitted) {
    const summary = getMockSummary();
    return `
      <section class="view">
        ${renderSectionIntro(
          "Mock Exam Review",
          "Timed session complete",
          "Review the explanations below and note which topics the solo board will now push harder.",
        )}
        <div class="panel result-panel">
          <div class="result-panel__score">
            <span>Final Score</span>
            <strong>${summary.correct}/${summary.total}</strong>
            <p>${formatPercent(summary.accuracy)} accuracy</p>
          </div>
          <div class="result-panel__actions">
            <button type="button" class="button button--primary" data-action="restart-mock">Build another mock exam</button>
          </div>
        </div>
        <div class="review-list">
          ${session.results
            .map(
              ({ question, selectedIndex, correct }) => `
                <article class="review-card ${correct ? "is-correct" : "is-wrong"}">
                  <div class="review-card__header">
                    <span>${escapeHtml(question.category)}</span>
                    <strong>${correct ? "Correct" : "Missed"}</strong>
                  </div>
                  <h4>${escapeHtml(question.question)}</h4>
                  <p><strong>Your answer:</strong> ${
                    selectedIndex !== undefined
                      ? escapeHtml(question.options[selectedIndex] || "No answer")
                      : "No answer"
                  }</p>
                  <p><strong>Correct answer:</strong> ${escapeHtml(question.options[question.answerIndex])}</p>
                  <p>${escapeHtml(question.explanation)}</p>
                </article>
              `,
            )
            .join("")}
        </div>
      </section>
    `;
  }

  const currentQuestion = session.questions[session.currentIndex];
  const selectedIndex = session.answers[currentQuestion.id];
  const remainingSeconds = getRemainingMockSeconds();
  const minutes = Math.floor(remainingSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (remainingSeconds % 60).toString().padStart(2, "0");

  return `
    <section class="view">
      ${renderSectionIntro(
        "Mock Exam In Progress",
        currentQuestion.category,
        `${currentQuestion.topic} • Difficulty ${currentQuestion.difficulty}`,
      )}
      <div class="progress-row">
        <span>Question ${session.currentIndex + 1} of ${session.questions.length}</span>
        <span class="timer">Time remaining ${minutes}:${seconds}</span>
      </div>
      <article class="question-card">
        <h3>${escapeHtml(currentQuestion.question)}</h3>
        <div class="option-list">
          ${currentQuestion.options
            .map(
              (option, index) => `
                <button
                  type="button"
                  class="option ${selectedIndex === index ? "is-selected" : ""}"
                  data-action="select-mock-option"
                  data-index="${index}"
                >
                  <span>${String.fromCharCode(65 + index)}</span>
                  <strong>${escapeHtml(option)}</strong>
                </button>
              `,
            )
            .join("")}
        </div>
        <div class="question-card__actions">
          <button type="button" class="button button--ghost" data-action="mock-prev" ${session.currentIndex === 0 ? "disabled" : ""}>Previous</button>
          <button type="button" class="button button--ghost" data-action="submit-mock">Submit exam</button>
          <button type="button" class="button button--primary" data-action="mock-next">
            ${session.currentIndex === session.questions.length - 1 ? "Review and submit" : "Next question"}
          </button>
        </div>
      </article>
    </section>
  `;
}

function renderJeopardyModeSwitch() {
  return `
    <section class="panel mode-panel">
      <div class="mode-switch">
        <button
          type="button"
          class="mode-switch__button ${state.jeopardy.mode === "solo" ? "is-active" : ""}"
          data-action="set-jeopardy-mode"
          data-mode="solo"
        >
          Solo
        </button>
        <button
          type="button"
          class="mode-switch__button ${state.jeopardy.mode === "online" ? "is-active" : ""}"
          data-action="set-jeopardy-mode"
          data-mode="online"
        >
          Online
        </button>
      </div>
      <p>${state.jeopardy.mode === "solo" ? "Practice by yourself with the adaptive board." : "Host or join a live board and track the leaderboard in real time."}</p>
    </section>
  `;
}

function renderSoloJeopardyView(summary) {
  const answeredCount = Object.keys(state.jeopardy.answered).length;
  const weakTopics = [...summary.weakTopics].slice(0, 2).join(", ") || "No weak topics detected yet";

  return `
    <section class="view">
      ${renderSectionIntro(
        "Solo Jeopardy",
        "Adaptive practice board with escalating difficulty",
        "Use the solo board for targeted board review, or switch to online mode for shared multiplayer play with join codes and a live leaderboard.",
      )}
      <div class="card-grid card-grid--metrics">
        ${renderMetric("Board Score", `${state.jeopardy.score} pts`, "gold")}
        ${renderMetric("Tiles Cleared", `${answeredCount} / ${state.jeopardy.categories.length * BOARD_VALUES.length}`, "blue")}
        ${renderMetric("Adaptive Focus", weakTopics, "default")}
      </div>
      <div class="panel">
        <div class="panel__footer panel__footer--top">
          <p>Weak areas receive a higher chance of appearing with equal or harder-than-target difficulty.</p>
          <button type="button" class="button button--primary" data-action="refresh-jeopardy">Generate new board</button>
        </div>
        <div class="jeopardy-board">
          ${state.jeopardy.categories
            .map((category, columnIndex) => {
              const categoryMatch = getCategories().find((item) => item.name === category);
              const shortName = categoryMatch ? categoryMatch.shortName : category;
              return `
                <section class="jeopardy-column">
                  <header>${escapeHtml(shortName)}</header>
                  ${state.jeopardy.board[columnIndex]
                    .map((tile, rowIndex) => {
                      const answered = tile.question && state.jeopardy.answered[tile.question.id];
                      const classes = [
                        "jeopardy-tile",
                        answered ? "is-answered" : "",
                        !tile.question ? "is-empty" : "",
                      ]
                        .filter(Boolean)
                        .join(" ");
                      return `
                        <button
                          type="button"
                          class="${classes}"
                          data-action="open-jeopardy"
                          data-column="${columnIndex}"
                          data-row="${rowIndex}"
                          ${!tile.question || answered ? "disabled" : ""}
                        >
                          ${
                            answered
                              ? answered.correct
                                ? "Correct"
                                : "Reviewed"
                              : `$${tile.value}`
                          }
                        </button>
                      `;
                    })
                    .join("")}
                </section>
              `;
            })
            .join("")}
        </div>
      </div>
      ${renderJeopardyModal()}
    </section>
  `;
}

function renderJeopardyView(summary) {
  if (state.jeopardy.mode === "online") {
    return `${renderJeopardyModeSwitch()}${renderLiveView()}`;
  }

  return `${renderJeopardyModeSwitch()}${renderSoloJeopardyView(summary)}`;
}

function renderJeopardyModal() {
  const activeTile = state.jeopardy.activeTile;
  if (!activeTile) {
    return "";
  }

  const tile = state.jeopardy.board[activeTile.columnIndex][activeTile.rowIndex];
  const question = tile.question;
  const selectedIndex = activeTile.selectedIndex;
  const submitted = activeTile.submitted;
  const correct = selectedIndex === question.answerIndex;

  return `
    <div class="modal-backdrop">
      <article class="modal">
        <div class="modal__header">
          <div>
            <span class="pill">$${tile.value}</span>
            <span class="pill">${escapeHtml(question.topic)}</span>
          </div>
          <button type="button" class="icon-button" data-action="close-jeopardy">&times;</button>
        </div>
        <h3>${escapeHtml(question.question)}</h3>
        <div class="option-list">
          ${question.options
            .map((option, index) => {
              const classes = [
                "option",
                selectedIndex === index ? "is-selected" : "",
                submitted && question.answerIndex === index ? "is-correct" : "",
                submitted && selectedIndex === index && selectedIndex !== question.answerIndex ? "is-wrong" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return `
                <button
                  type="button"
                  class="${classes}"
                  data-action="select-jeopardy-option"
                  data-index="${index}"
                  ${submitted ? "disabled" : ""}
                >
                  <span>${String.fromCharCode(65 + index)}</span>
                  <strong>${escapeHtml(option)}</strong>
                </button>
              `;
            })
            .join("")}
        </div>
        ${
          submitted
            ? `
              <div class="feedback ${correct ? "feedback--correct" : "feedback--wrong"}">
                <strong>${correct ? "Correct" : "Use this miss for review"}</strong>
                <p>${escapeHtml(question.explanation)}</p>
              </div>
            `
            : ""
        }
        <div class="question-card__actions">
          ${
            submitted
              ? `<button type="button" class="button button--primary" data-action="close-jeopardy">Return to board</button>`
              : `<button type="button" class="button button--primary" data-action="submit-jeopardy" ${
                  selectedIndex === null ? "disabled" : ""
                }>Lock in answer</button>`
          }
        </div>
      </article>
    </div>
  `;
}

function renderImportView() {
  const feedbackClass = `import-feedback import-feedback--${state.importFeedback.tone}`;

  return `
    <section class="view">
      ${renderSectionIntro(
        "Import Your Bank",
        "Bring in your own board-review questions",
        "Paste JSON or CSV, keep the structure simple, and the app will merge imported items into quiz, mock exam, and solo board selection.",
      )}
      <div class="split-layout">
        <section class="panel">
          <div class="panel__header">
            <h3>Paste or load question data</h3>
            <p>Supported fields: category, topic, type, difficulty, question, options, answerIndex, explanation.</p>
          </div>
          <textarea id="import-text" class="import-textarea" placeholder='Paste JSON array or CSV rows here'>${escapeHtml(state.importDraft)}</textarea>
          <div class="${feedbackClass}">
            <strong>${escapeHtml(state.importFeedback.message)}</strong>
          </div>
          <div class="question-card__actions">
            <label class="button button--ghost file-button">
              Load file
              <input id="import-file" type="file" accept=".json,.csv,text/csv,application/json" />
            </label>
            <button type="button" class="button button--ghost" data-action="load-import-template">Load sample template</button>
            <button type="button" class="button button--primary" data-action="run-import">Import questions</button>
          </div>
        </section>
        <section class="panel">
          <div class="panel__header">
            <h3>Current import status</h3>
            <p>Imported questions stay local to this browser. Live multiplayer uses the shared server-side bank so every player sees the same board.</p>
          </div>
          <div class="insight-stack">
            <article class="insight-card">
              <span class="insight-card__label">Imported questions</span>
              <strong>${state.importedQuestions.length}</strong>
            </article>
            <article class="insight-card">
              <span class="insight-card__label">Accepted formats</span>
              <strong>JSON array or CSV with option columns</strong>
            </article>
            <article class="insight-card">
              <span class="insight-card__label">Quick CSV header</span>
              <strong>category,topic,type,difficulty,question,optionA,optionB,optionC,optionD,correctAnswer,explanation</strong>
            </article>
          </div>
          <div class="question-card__actions">
            <button type="button" class="button button--ghost" data-action="clear-imported">Clear imported bank</button>
          </div>
        </section>
      </div>
    </section>
  `;
}

function renderLiveBoard(session, allowPicking) {
  return `
    <div class="jeopardy-board jeopardy-board--live">
      ${session.board
        .map(
          (column) => `
            <section class="jeopardy-column">
              <header>${escapeHtml(formatOnlineCategoryLabel(column.category))}</header>
              ${column.tiles
                .map(
                  (tile) => `
                    <button
                      type="button"
                    class="jeopardy-tile ${tile.answered ? "is-answered" : ""}"
                      data-action="live-pick-tile"
                      data-column="${tile.columnIndex}"
                      data-row="${tile.rowIndex}"
                      ${tile.answered || !allowPicking ? "disabled" : ""}
                    >
                      ${tile.answered ? "Played" : `$${tile.value}`}
                    </button>
                  `,
                )
                .join("")}
            </section>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderLiveScoreboard(session) {
  const selfPlayer = getSelfPlayer();

  return `
    <section class="panel live-scoreboard">
      <div class="panel__header">
        <h3>Players</h3>
        <p>Scores update instantly after every reveal.</p>
      </div>
      <div class="player-list">
        ${session.players
          .map((player) => {
            const classes = [
              "player-row",
              selfPlayer && selfPlayer.id === player.id ? "is-self" : "",
              session.currentTurnPlayerId === player.id ? "is-turn" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return `
              <article class="${classes}">
                <div>
                  <strong>${escapeHtml(player.username)}</strong>
                  <span>${player.isHost ? "Host" : "Player"}${player.connected ? " • Connected" : " • Offline"}</span>
                </div>
                <strong>${player.score}</strong>
              </article>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderLivePageTabs() {
  return `
    <div class="subnav-tabs">
      <button
        type="button"
        class="subnav-tab ${state.live.page === "board" ? "is-active" : ""}"
        data-action="set-live-page"
        data-page="board"
      >
        Board
      </button>
      <button
        type="button"
        class="subnav-tab ${state.live.page === "leaderboard" ? "is-active" : ""}"
        data-action="set-live-page"
        data-page="leaderboard"
      >
        Leaderboard
      </button>
    </div>
  `;
}

function renderLiveLeaderboard(session) {
  const selfPlayer = getSelfPlayer();
  const winnerText =
    session.status === "finished" && session.winnerNames.length
      ? `Winner${session.winnerNames.length > 1 ? "s" : ""}: ${session.winnerNames.join(", ")}`
      : session.status === "board_complete"
      ? "All clues have been used. The host can end the game."
      : `${session.currentTurnUsername || "Waiting"} ${session.status === "picking" ? "has the next pick" : "is active"}`;

  return `
    <section class="view">
      ${renderSectionIntro(
        "Live Jeopardy",
        "Leaderboard",
        "Track everyone in the live room from a dedicated ranking page while the board stays active on other devices.",
      )}
      ${renderLivePageTabs()}
      <div class="card-grid card-grid--metrics">
        ${renderMetric("Join Code", session.code, "gold")}
        ${renderMetric(
          "Status",
          session.status === "finished" ? "Finished" : session.status === "board_complete" ? "Board Complete" : "In Progress",
          "blue",
        )}
        ${renderMetric("Summary", winnerText, "default")}
      </div>
      <section class="panel">
        <div class="panel__header">
          <h3>Ranking</h3>
          <p>Participants are sorted by score, with live connection and turn status shown for each player.</p>
        </div>
        <div class="leaderboard-list">
          ${session.players
            .map((player, index) => {
              const classes = [
                "leaderboard-row",
                selfPlayer && selfPlayer.id === player.id ? "is-self" : "",
                session.currentTurnPlayerId === player.id ? "is-turn" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return `
                <article class="${classes}">
                  <div class="leaderboard-row__rank">${index + 1}</div>
                  <div class="leaderboard-row__player">
                    <strong>${escapeHtml(player.username)}</strong>
                    <span>${player.isHost ? "Host" : "Player"}${player.connected ? " • Connected" : " • Offline"}</span>
                  </div>
                  <div class="leaderboard-row__score">${player.score}</div>
                </article>
              `;
            })
            .join("")}
        </div>
        <div class="question-card__actions">
          <button type="button" class="button button--ghost" data-action="set-live-page" data-page="board">Back to board</button>
          <button type="button" class="button button--ghost" data-action="live-leave">Leave game</button>
        </div>
      </section>
    </section>
  `;
}

function renderLiveQuestionPanel(session) {
  const active = session.activeQuestion;
  if (!active) {
    return "";
  }

  if (session.status === "question") {
    const hasAnswered = active.hasAnswered;
    const selfPlayer = getSelfPlayer();
    const isHost = selfPlayer && selfPlayer.isHost;

    return `
      <div class="modal-backdrop modal-backdrop--live">
        <article class="modal live-modal">
          <div class="modal__header">
            <div>
              <span class="pill">$${active.value}</span>
              <span class="pill">${escapeHtml(active.topic)}</span>
            </div>
            <div class="pill">Host controlled</div>
          </div>
          <div class="progress-row">
            <span>${escapeHtml(active.openedByUsername)} chose this clue.</span>
            <span>${active.answerCount} selection(s) ready</span>
          </div>
          <div class="question-card question-card--live">
            <div class="question-card__meta">
              <span class="pill">${escapeHtml(formatOnlineCategoryLabel(active.category))}</span>
            </div>
            <h3>${escapeHtml(active.question)}</h3>
            <div class="option-list">
              ${active.options
                .map(
                  (option, index) => `
                    <button
                      type="button"
                      class="option ${state.live.answerIndex === index ? "is-selected" : ""}"
                      data-action="select-live-answer"
                      data-index="${index}"
                    >
                      <span>${String.fromCharCode(65 + index)}</span>
                      <strong>${escapeHtml(option)}</strong>
                    </button>
                  `,
                )
                .join("")}
            </div>
            <div class="question-card__actions">
              <p>${
                isHost
                  ? hasAnswered
                    ? "Your selection is ready. Press submit when you want to lock all players' choices."
                    : "Choose your answer, then submit to lock in everyone's current selections."
                  : hasAnswered
                  ? "Your current selection is saved. The host will submit the round."
                  : "Choose an answer. You can change it until the host submits the round."
              }</p>
              ${
                isHost
                  ? `<button
                      type="button"
                      class="button button--primary"
                      data-action="submit-live-answer"
                      ${state.live.answerIndex === null ? "disabled" : ""}
                    >
                      Submit answers
                    </button>`
                  : `<span class="pill">Waiting for host submission</span>`
              }
            </div>
          </div>
        </article>
      </div>
    `;
  }

  if (session.status === "reveal") {
    const selfPlayer = getSelfPlayer();
    const isHost = selfPlayer && selfPlayer.isHost;
    const viewerResult = active.viewerResult || { selectedIndex: null, correct: false };
    const selectedAnswer =
      viewerResult.selectedIndex === null || viewerResult.selectedIndex === undefined
        ? "No answer selected"
        : active.options[viewerResult.selectedIndex];

    return `
      <div class="modal-backdrop modal-backdrop--live">
        <article class="modal live-modal">
          <div class="modal__header">
            <div>
              <span class="pill">$${active.value}</span>
              <span class="pill">${escapeHtml(active.topic)}</span>
            </div>
            <div class="pill">Reveal</div>
          </div>
          <div class="feedback feedback--${viewerResult.correct ? "correct" : "wrong"}">
            <strong>Correct answer: ${escapeHtml(active.options[active.correctAnswerIndex])}</strong>
            <p>${escapeHtml(active.explanation)}</p>
          </div>
          <div class="player-results">
            <article class="player-result ${viewerResult.correct ? "is-correct" : "is-wrong"}">
              <strong>Your answer</strong>
              <span>${escapeHtml(selectedAnswer)}</span>
              <span>${viewerResult.correct ? "Correct" : "Missed"}</span>
            </article>
          </div>
          <div class="question-card__actions">
            ${
              isHost
                ? `<button type="button" class="button button--primary" data-action="advance-live-round">Continue</button>`
                : `<span class="pill">Waiting for the host to continue</span>`
            }
          </div>
        </article>
      </div>
    `;
  }

  return "";
}

function renderLiveLobby(session) {
  const selfPlayer = getSelfPlayer();
  const isHost = selfPlayer && selfPlayer.isHost;

  return `
    <section class="view">
      ${renderSectionIntro(
        "Live Jeopardy",
        "Join with a code and play on any device",
        "Players enter a username, join the same code, and a random connected player gets each turn to choose the next tile. Everyone answers every clue, and disconnected players can rejoin with the same username.",
      )}
      <div class="card-grid card-grid--metrics">
        ${renderMetric("Join Code", session.code, "gold")}
        ${renderMetric("Players", `${session.players.length}`, "blue")}
        ${renderMetric("Status", "Lobby", "default")}
      </div>
      <div class="split-layout">
        <section class="panel">
          <div class="panel__header">
            <h3>Lobby</h3>
            <p>Share the 6-digit code. Friends can join from laptops or phones, and offline players can rejoin with the same username and code.</p>
          </div>
          <div class="live-banner">
            <strong>Join Code ${escapeHtml(session.code)}</strong>
            <span>${escapeHtml(state.live.info)}</span>
          </div>
          <div class="player-list">
            ${session.players
              .map(
                (player) => `
                  <article class="player-row ${player.isHost ? "is-turn" : ""}">
                    <div>
                      <strong>${escapeHtml(player.username)}</strong>
                      <span>${player.isHost ? "Host" : "Player"}${player.connected ? " • Connected" : " • Offline"}</span>
                    </div>
                    <strong>${player.score}</strong>
                  </article>
                `,
              )
              .join("")}
          </div>
          <div class="question-card__actions">
            ${isHost ? `<button type="button" class="button button--primary" data-action="live-start-game">Start live game</button>` : ""}
            <button type="button" class="button button--ghost" data-action="live-leave">Leave game</button>
          </div>
        </section>
        <section class="panel">
          <div class="panel__header">
            <h3>How it works</h3>
            <p>The live game follows a join-code format similar to Kahoot’s shared game PIN pattern, but with a Jeopardy board and rotating chooser turns.</p>
          </div>
          <div class="insight-stack">
            <article class="insight-card">
              <span class="insight-card__label">Round flow</span>
              <strong>Random chooser picks a tile, everyone answers, then a new chooser is selected.</strong>
            </article>
            <article class="insight-card">
              <span class="insight-card__label">Scoring</span>
              <strong>Each correct answer earns the tile value.</strong>
            </article>
            <article class="insight-card">
              <span class="insight-card__label">Server</span>
              <strong>Run the app through <code>python3 server.py</code> so all devices can sync.</strong>
            </article>
          </div>
        </section>
      </div>
    </section>
  `;
}

function renderLiveGame(session) {
  if (state.live.page === "leaderboard") {
    return renderLiveLeaderboard(session);
  }

  const selfPlayer = getSelfPlayer();
  const allowPicking = session.status === "picking" && isMyTurn();
  const isHost = selfPlayer && selfPlayer.isHost;

  return `
    <section class="view">
      ${renderSectionIntro(
        "Live Jeopardy",
        "Shared board play with rotating turns",
        "The next chooser is randomized after each clue, every player answers on their own device, and the scoreboard updates in real time.",
      )}
      ${renderLivePageTabs()}
      <div class="card-grid card-grid--metrics">
        ${renderMetric("Join Code", session.code, "gold")}
        ${renderMetric("Currently Choosing", session.currentTurnUsername || "Waiting", "blue")}
        ${renderMetric("Your Seat", selfPlayer ? selfPlayer.username : "Spectator", "default")}
      </div>
      <div class="split-layout split-layout--live">
        <section class="panel">
          <div class="panel__footer panel__footer--top">
            <p>
              ${
                session.status === "finished"
                  ? `Winner${session.winnerNames.length > 1 ? "s" : ""}: ${escapeHtml(session.winnerNames.join(", "))}`
                  : session.status === "board_complete"
                  ? "All clues have been used. The host can end the game when everyone is ready."
                  : isMyTurn()
                  ? "It is your turn to choose the next tile."
                  : `${escapeHtml(session.currentTurnUsername || "Another player")} is choosing the next tile.`
              }
            </p>
            <div class="button-row">
              ${
                isHost && session.status !== "finished"
                  ? `<button type="button" class="button button--ghost" data-action="terminate-live-game">End game</button>`
                  : ""
              }
              <button type="button" class="button button--ghost" data-action="live-leave">Leave game</button>
            </div>
          </div>
          ${renderLiveBoard(session, allowPicking)}
        </section>
        ${renderLiveScoreboard(session)}
      </div>
      ${renderLiveQuestionPanel(session)}
    </section>
  `;
}

function renderLiveEntry() {
  const connectionClass = `import-feedback import-feedback--${state.live.error ? "error" : "info"}`;

  return `
    <section class="view">
      ${renderSectionIntro(
        "Live Jeopardy",
        "Host or join with a code",
        "Create a shared board session, hand out the join code, and let everyone answer from their own device while chooser turns rotate automatically. If someone drops, they can rejoin with the same username and code.",
      )}
      <div class="split-layout">
        <section class="panel panel--form">
          <div class="panel__header">
            <h3>Enter your player name</h3>
            <p>Use the same name for hosting or joining. This is what everyone will see on the scoreboard.</p>
          </div>
          <div class="form-grid form-grid--two">
            <label class="field">
              <span>Username</span>
              <input id="live-username" type="text" maxlength="20" placeholder="Enter your name" value="${escapeHtml(state.live.username)}" />
            </label>
            <label class="field">
              <span>Join code</span>
              <input id="live-code" type="text" inputmode="numeric" maxlength="6" placeholder="6 digits" value="${escapeHtml(state.live.joinCode)}" />
            </label>
          </div>
          <div class="${connectionClass}">
            <strong>${escapeHtml(state.live.error || state.live.info)}</strong>
          </div>
          <div class="question-card__actions">
            <button type="button" class="button button--primary" data-action="live-create" ${state.live.busy ? "disabled" : ""}>Host live game</button>
            <button type="button" class="button button--ghost" data-action="live-join" ${state.live.busy ? "disabled" : ""}>Join with code</button>
            ${state.live.auth ? `<button type="button" class="button button--ghost" data-action="live-reconnect">Reconnect saved game</button>` : ""}
          </div>
        </section>
        <section class="panel">
          <div class="panel__header">
            <h3>Multiplayer flow</h3>
            <p>Built for phones and laptops with synchronized board state over a lightweight Python server.</p>
          </div>
          <div class="insight-stack">
            <article class="insight-card">
              <span class="insight-card__label">Chooser logic</span>
              <strong>A random connected player chooses each new tile.</strong>
            </article>
            <article class="insight-card">
              <span class="insight-card__label">Answering</span>
              <strong>Everyone answers the same clue from their own screen.</strong>
            </article>
            <article class="insight-card">
              <span class="insight-card__label">Run mode</span>
              <strong>Use <code>python3 server.py</code> instead of a plain static server for live play.</strong>
            </article>
          </div>
        </section>
      </div>
    </section>
  `;
}

function renderLiveView() {
  if (!state.live.auth || !state.live.session) {
    return renderLiveEntry();
  }

  if (state.live.session.status === "lobby") {
    return renderLiveLobby(state.live.session);
  }

  return renderLiveGame(state.live.session);
}

function renderApp() {
  const summary = computePerformanceSummary();
  const viewMap = {
    dashboard: renderDashboard(summary),
    quiz: renderQuizView(summary),
    mock: renderMockView(),
    jeopardy: renderJeopardyView(summary),
    live: renderLiveView(),
    import: renderImportView(),
  };

  app.innerHTML = `
    <div class="shell">
      ${renderAppChrome(summary)}
      <nav class="nav-tabs" aria-label="Primary">
        ${[
          ["dashboard", "Dashboard"],
          ["quiz", "Quiz"],
          ["mock", "Mock Exam"],
          ["jeopardy", "Jeopardy"],
          ["import", "Import Bank"],
        ]
          .map(
            ([view, label]) => `
              <button type="button" class="nav-tab ${state.activeView === view ? "is-active" : ""}" data-view="${view}">
                ${escapeHtml(label)}
              </button>
            `,
          )
          .join("")}
      </nav>
      <main>
        ${viewMap[state.activeView] || viewMap.dashboard}
      </main>
    </div>
  `;
}

app.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action], [data-view]");
  if (!button) {
    return;
  }

  const view = button.dataset.view;
  if (view) {
    if (view === "live") {
      state.activeView = "jeopardy";
      setJeopardyMode("online");
      renderApp();
      return;
    }
    state.activeView = view;
    renderApp();
    return;
  }

  const action = button.dataset.action;

  if (action === "set-jeopardy-mode") {
    setJeopardyMode(button.dataset.mode);
    state.activeView = "jeopardy";
  }

  if (action === "set-live-page") {
    state.live.page = button.dataset.page === "leaderboard" ? "leaderboard" : "board";
  }

  if (action === "toggle-quiz-adaptive") {
    state.quizConfig.adaptive = !state.quizConfig.adaptive;
  }

  if (action === "toggle-mock-adaptive") {
    state.mockConfig.adaptive = !state.mockConfig.adaptive;
  }

  if (action === "start-quiz") {
    startQuiz();
  }

  if (action === "select-quiz-option" && state.quizSession && !state.quizSession.submitted) {
    state.quizSession.selectedIndex = Number(button.dataset.index);
  }

  if (action === "submit-quiz") {
    submitQuizQuestion();
  }

  if (action === "next-quiz") {
    advanceQuizQuestion();
  }

  if (action === "restart-quiz") {
    resetQuiz();
  }

  if (action === "start-mock") {
    startMock();
  }

  if (action === "select-mock-option" && state.mockSession && !state.mockSession.submitted) {
    const question = state.mockSession.questions[state.mockSession.currentIndex];
    state.mockSession.answers[question.id] = Number(button.dataset.index);
  }

  if (action === "mock-prev" && state.mockSession) {
    state.mockSession.currentIndex = Math.max(0, state.mockSession.currentIndex - 1);
  }

  if (action === "mock-next" && state.mockSession) {
    if (state.mockSession.currentIndex === state.mockSession.questions.length - 1) {
      finalizeMockExam();
      return;
    }
    state.mockSession.currentIndex = Math.min(
      state.mockSession.questions.length - 1,
      state.mockSession.currentIndex + 1,
    );
  }

  if (action === "submit-mock") {
    finalizeMockExam();
  }

  if (action === "restart-mock") {
    resetMock();
  }

  if (action === "refresh-jeopardy") {
    buildJeopardyBoard();
  }

  if (action === "open-jeopardy") {
    openJeopardyTile(Number(button.dataset.column), Number(button.dataset.row));
  }

  if (action === "select-jeopardy-option" && state.jeopardy.activeTile && !state.jeopardy.activeTile.submitted) {
    state.jeopardy.activeTile.selectedIndex = Number(button.dataset.index);
  }

  if (action === "submit-jeopardy") {
    finalizeJeopardyTile();
  }

  if (action === "close-jeopardy") {
    closeJeopardyTile();
  }

  if (action === "live-create") {
    createLiveGame();
    return;
  }

  if (action === "live-join") {
    joinLiveGame();
    return;
  }

  if (action === "live-reconnect") {
    reconnectLiveGame();
    return;
  }

  if (action === "live-start-game") {
    sendLiveAction("start_game", {});
  }

  if (action === "live-pick-tile") {
    sendLiveAction("pick_tile", {
      columnIndex: Number(button.dataset.column),
      rowIndex: Number(button.dataset.row),
    });
  }

  if (action === "select-live-answer") {
    state.live.answerIndex = Number(button.dataset.index);
    sendLiveAction("select_answer", { answerIndex: state.live.answerIndex });
  }

  if (action === "submit-live-answer") {
    sendLiveAction("submit_answer", {});
  }

  if (action === "advance-live-round") {
    sendLiveAction("advance_round", {});
  }

  if (action === "terminate-live-game") {
    sendLiveAction("terminate_game", {});
  }

  if (action === "live-leave") {
    leaveLiveGame();
  }

  if (action === "load-import-template") {
    state.importDraft = JSON.stringify(IMPORT_TEMPLATE, null, 2);
    state.importFeedback = {
      tone: "info",
      message: "Sample JSON template loaded into the editor.",
    };
  }

  if (action === "run-import") {
    importQuestions();
  }

  if (action === "clear-imported") {
    clearImportedQuestions();
  }

  renderApp();
});

app.addEventListener("input", (event) => {
  const target = event.target;

  if (target.id === "import-text") {
    state.importDraft = target.value;
  }

  if (target.id === "live-username") {
    state.live.username = target.value;
    persistLiveProfile();
  }

  if (target.id === "live-code") {
    state.live.joinCode = normalizeLiveCode(target.value);
  }
});

app.addEventListener("change", (event) => {
  const target = event.target;

  if (target.id === "quiz-category") {
    state.quizConfig.category = target.value;
  }

  if (target.id === "quiz-count") {
    state.quizConfig.count = Number(target.value);
  }

  if (target.id === "mock-count") {
    state.mockConfig.count = Number(target.value);
  }

  if (target.id === "mock-duration") {
    state.mockConfig.durationMinutes = Number(target.value);
  }

  if (target.id === "import-file" && target.files && target.files[0]) {
    const reader = new FileReader();
    reader.onload = () => {
      state.importDraft = String(reader.result || "");
      state.importFeedback = {
        tone: "info",
        message: `Loaded ${target.files[0].name}. Review the content and click Import questions.`,
      };
      renderApp();
    };
    reader.readAsText(target.files[0]);
    return;
  }

  renderApp();
});

window.setInterval(() => {
  if (
    (state.activeView === "jeopardy" && state.jeopardy.mode === "online" && state.live.session) ||
    (state.activeView === "live" && state.live.session) ||
    (state.activeView === "mock" && state.mockSession && !state.mockSession.submitted)
  ) {
    renderApp();
  }
}, 1000);

buildJeopardyBoard();
renderApp();

if (state.live.auth) {
  connectLiveSocket();
}
