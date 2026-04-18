import { CATEGORY_CONFIG, IMPORT_TEMPLATE, QUESTION_BANK } from "./data.js";

const STORAGE_KEYS = {
  importedQuestions: "nmb-review-imported-questions",
  importedFlashcards: "nmb-review-imported-flashcards",
  questionEdits: "nmb-review-question-edits",
  performance: "nmb-review-performance",
  liveProfile: "nmb-review-live-profile",
  liveAuth: "nmb-review-live-auth",
  sharedUserId: "nmb-review-shared-user-id",
  accountAuth: "nmb-review-account-auth",
};

const BOARD_VALUES = [100, 200, 300, 400, 500];
const MOCK_EXAM_OPTIONS = [
  { count: 60, durationMinutes: 60, label: "60 questions • 1 hour" },
  { count: 120, durationMinutes: 120, label: "120 questions • 2 hours" },
  { count: 220, durationMinutes: 240, label: "220 questions • 4 hours" },
];
const SEEDED_QUESTION_IDS = new Set(QUESTION_BANK.map((question) => question.id));
const ISOTOPE_MASSES_BY_SYMBOL = {
  Ac: ["225", "227"],
  At: ["211"],
  Ba: ["133"],
  Bi: ["213"],
  C: ["11", "14"],
  Co: ["57", "60"],
  Cr: ["51"],
  Cs: ["137"],
  Cu: ["62", "64", "67"],
  F: ["18"],
  Ga: ["67", "68"],
  Gd: ["153"],
  Ge: ["68"],
  I: ["123", "124", "125", "131"],
  In: ["111"],
  Ir: ["192"],
  Kr: ["81m", "85"],
  Lu: ["177"],
  Mo: ["99"],
  N: ["13"],
  O: ["15"],
  P: ["32"],
  Ra: ["223"],
  Rb: ["82"],
  Re: ["186", "188"],
  Se: ["75"],
  Sm: ["153"],
  Sr: ["89"],
  Tc: ["99", "99m"],
  Tl: ["201"],
  W: ["188"],
  Xe: ["127", "133"],
  Y: ["90"],
  Zr: ["89"],
};
const ISOTOPE_SYMBOL_PATTERN = Object.keys(ISOTOPE_MASSES_BY_SYMBOL)
  .sort((first, second) => second.length - first.length)
  .join("|");

const app = document.querySelector("#app");
const savedAccountAuth = loadJSON(STORAGE_KEYS.accountAuth, null);

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
  importedFlashcards: loadJSON(STORAGE_KEYS.importedFlashcards, []),
  questionEdits: loadJSON(STORAGE_KEYS.questionEdits, {}),
  performance: loadJSON(STORAGE_KEYS.performance, []),
  account: {
    auth: savedAccountAuth,
    verifying: Boolean(savedAccountAuth && savedAccountAuth.token),
    username: "",
    password: "",
    busy: false,
    message: "Sign in to save and review your quiz history across devices.",
    tone: "info",
    placements: [],
  },
  instructor: {
    data: null,
    selectedUser: "all",
    loading: false,
    message: "Instructor metrics load after an instructor signs in.",
    tone: "info",
  },
  quizConfig: {
    category: "all",
    count: 10,
    adaptive: true,
  },
  quizSession: null,
  mockConfig: {
    count: 60,
    durationMinutes: 60,
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
  flashcards: {
    category: "all",
    shuffled: false,
    deck: [],
    currentIndex: 0,
    showingBack: false,
  },
  questionBank: {
    category: "all",
    exam: "all",
    question: "all",
    source: "all",
    search: "",
    hasUnsavedChanges: false,
    feedback: {
      tone: "info",
      message: "Edit question text directly in the bank, then press Save Changes to keep your updates on this device.",
    },
  },
  live: {
    username: loadJSON(STORAGE_KEYS.liveProfile, { username: "" }).username || "",
    joinCode: "",
    auth: loadJSON(STORAGE_KEYS.liveAuth, null),
    session: null,
    page: "board",
    answerIndex: null,
    lastQuestionKey: null,
    lastRecordedRevealKey: null,
    lastProfileRefreshCode: null,
    connectionStatus: "idle",
    error: "",
    info: "Host a live multiplayer board with a join code and rotating chooser turns.",
    busy: false,
    ws: null,
    manualDisconnect: false,
  },
  importDraft: "",
  importConfig: {
    categoryMode: "auto",
    category: "",
    customCategory: "",
    formatHint: "auto",
  },
  importPreview: null,
  importFeedback: {
    tone: "info",
    message: "Import JSON or CSV to add your own board-style questions.",
  },
};

let mockTimerHandle = null;
const FLASHCARD_IMPORT_TEMPLATE = `Term\tDefinition
Tc-99m MDP\tCommon radiopharmaceutical for routine bone imaging
ALARA\tRadiation safety principle focused on minimizing exposure
Extravasation\tInadvertent infiltration of radiopharmaceutical into surrounding tissue
Photopeak window\tEnergy acceptance range centered on the radionuclide photopeak`;

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

function slugifyCategory(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createStableId(prefix, parts) {
  const source = parts
    .map((part) => String(part === undefined || part === null ? "" : part).trim().toLowerCase())
    .join("|");
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return `${prefix}-${hash.toString(36)}`;
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeIsotopeText(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/\b13lI\b/g, "131I")
    .replace(/\bI-13l\b/g, "I-131")
    .replace(/\b1l1In\b/g, "111In");
}

function isKnownIsotope(symbol, massNumber) {
  const knownMasses = ISOTOPE_MASSES_BY_SYMBOL[symbol];
  return Boolean(knownMasses && knownMasses.includes(String(massNumber).toLowerCase()));
}

function renderIsotope(openBracket, massNumber, symbol, closeBracket) {
  return `${openBracket || ""}<sup>${massNumber}</sup>${symbol}${closeBracket || ""}`;
}

function formatScientificText(value) {
  const escaped = escapeHtml(normalizeIsotopeText(value));
  const massFirstPattern = new RegExp(
    `(\\[?)(\\d{1,3}m?)\\s*[- ]?\\s*(${ISOTOPE_SYMBOL_PATTERN})(\\]?)(?![a-z])`,
    "g"
  );
  const symbolFirstPattern = new RegExp(
    `(\\[?)\\b(${ISOTOPE_SYMBOL_PATTERN})\\s*[- ]\\s*(\\d{1,3}m?)(\\]?)`,
    "g"
  );

  return escaped
    .replace(symbolFirstPattern, (match, openBracket, symbol, massNumber, closeBracket) => {
      if (!isKnownIsotope(symbol, massNumber)) {
        return match;
      }
      return renderIsotope(openBracket, massNumber, symbol, closeBracket);
    })
    .replace(massFirstPattern, (match, openBracket, massNumber, symbol, closeBracket, offset, fullText) => {
      const previous = fullText[offset - 1] || "";
      if (!openBracket && /[A-Za-z0-9]/.test(previous)) {
        return match;
      }
      if (!isKnownIsotope(symbol, massNumber)) {
        return match;
      }
      return renderIsotope(openBracket, massNumber, symbol, closeBracket);
    });
}

const SOURCE_PDF_BOOKS = [
  {
    key: "early-sodee",
    title: "Principles and Practice of Nuclear Medicine",
    authorPattern: /Early and Sodee/i,
    pageOffset: 22,
    minPrintedPage: 3,
    maxPrintedPage: 881,
  },
  {
    key: "waterstram-gilmore",
    title: "Nuclear Medicine and PET/CT Technology and Techniques",
    authorPattern: /Waterstram-Rich|Gilmore/i,
    pageOffset: 15,
    minPrintedPage: 1,
    maxPrintedPage: 689,
  },
  {
    key: "saha",
    title: "Physics and Radiobiology of Nuclear Medicine",
    authorPattern: /Saha/i,
    pageSegments: [
      [1, 45, 15],
      [47, 61, 14],
      [63, 77, 13],
      [79, 151, 12],
      [153, 201, 11],
      [203, 241, 10],
      [243, 261, 9],
      [263, 299, 8],
      [301, 341, 7],
      [343, 356, 6],
    ],
  },
  {
    key: "shackett",
    title: "Nuclear Medicine Technology: Procedures and Quick Reference",
    authorPattern: /Shackett/i,
    pageOffset: 0,
    minPrintedPage: 1,
    maxPrintedPage: 745,
    parts: [
      { key: "shackett-part-1", startPdfPage: 1, endPdfPage: 190 },
      { key: "shackett-part-2", startPdfPage: 191, endPdfPage: 380 },
      { key: "shackett-part-3", startPdfPage: 381, endPdfPage: 570 },
      { key: "shackett-part-4", startPdfPage: 571, endPdfPage: 745 },
    ],
  },
  {
    key: "adler-carlton",
    title: "Introduction to Radiologic Sciences and Patient Care",
    authorPattern: /Adler|Carlton/i,
    pageOffset: 16,
    minPrintedPage: 1,
    maxPrintedPage: 515,
  },
];

const SOURCE_CITATION_PATTERN =
  /(Early and Sodee|Waterstram-Rich\s*(?:and|&)\s*Gilmore(?:,\s*et al\.)?|Christian and Waterstram-Rich|Saha|Shackett|Adler and Carlton)[^.;]*?(?:;|,)?\s*pp?\.?\s*(\d+)(?:\s*[-–]\s*(\d+))?/gi;

function getBookForCitation(authorText) {
  return SOURCE_PDF_BOOKS.find((book) => book.authorPattern.test(authorText)) || null;
}

function getPdfPageForPrintedPage(book, printedPage) {
  if (!book || !Number.isFinite(printedPage)) {
    return null;
  }

  if (book.pageSegments) {
    const segment = book.pageSegments.find(([start, end]) => printedPage >= start && printedPage <= end);
    return segment ? printedPage + segment[2] : null;
  }

  if (printedPage < book.minPrintedPage || printedPage > book.maxPrintedPage) {
    return null;
  }
  return printedPage + book.pageOffset;
}

function buildSourcePdfHref(book, printedPage) {
  const pdfPage = getPdfPageForPrintedPage(book, printedPage);
  if (!pdfPage) {
    return null;
  }
  if (Array.isArray(book.parts)) {
    const part = book.parts.find((entry) => pdfPage >= entry.startPdfPage && pdfPage <= entry.endPdfPage);
    if (!part) {
      return null;
    }
    return {
      href: `/source-pdfs/${part.key}.pdf#page=${pdfPage - part.startPdfPage + 1}`,
      pdfPage,
    };
  }
  return {
    href: `/source-pdfs/${book.key}.pdf#page=${pdfPage}`,
    pdfPage,
  };
}

function buildSourcePdfHrefForRange(book, startPrintedPage, endPrintedPage) {
  const lastPage = Number.isFinite(endPrintedPage) ? endPrintedPage : startPrintedPage;
  for (let printedPage = startPrintedPage; printedPage <= lastPage; printedPage += 1) {
    const link = buildSourcePdfHref(book, printedPage);
    if (link) {
      return {
        ...link,
        printedPage,
      };
    }
  }
  return null;
}

function formatTextWithSourceLinks(value) {
  const normalized = normalizeIsotopeText(value);
  let output = "";
  let lastIndex = 0;

  normalized.replace(SOURCE_CITATION_PATTERN, (match, authorText, pageText, endPageText, offset) => {
    const printedPage = Number(pageText);
    const endPrintedPage = Number(endPageText);
    const book = getBookForCitation(authorText);
    const link = buildSourcePdfHrefForRange(book, printedPage, endPrintedPage);

    output += formatScientificText(normalized.slice(lastIndex, offset));
    if (link) {
      const pageLabel = endPageText ? `${pageText}-${endPageText}` : pageText;
      output += `<a class="source-link" href="${escapeHtml(link.href)}" target="_blank" rel="noopener" title="${escapeHtml(
        `${book.title}, printed page ${link.printedPage} from cited range ${pageLabel} (PDF page ${link.pdfPage})`,
      )}">${formatScientificText(match)}</a>`;
    } else {
      output += formatScientificText(match);
    }
    lastIndex = offset + match.length;
    return match;
  });

  output += formatScientificText(normalized.slice(lastIndex));
  return output;
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

function applyQuestionEdits(question) {
  const edit = state.questionEdits[question.id];
  if (!edit) {
    return question;
  }

  return {
    ...question,
    ...edit,
    options: Array.isArray(edit.options) ? [...edit.options] : question.options,
  };
}

function getAllQuestions() {
  return uniqueById([...QUESTION_BANK, ...state.importedQuestions]).map((question) => applyQuestionEdits(question));
}

function hasStudyQuestions() {
  return getAllQuestions().length > 0;
}

function hasSharedLiveBank() {
  return QUESTION_BANK.length > 0;
}

function getQuestionOrigin(question) {
  return SEEDED_QUESTION_IDS.has(question.id) ? "shared" : "imported";
}

function getQuestionExamInfo(question) {
  const explicitExam = Number(question.examNumber);
  const explicitQuestion = Number(question.questionNumber);

  if (Number.isFinite(explicitExam) && Number.isFinite(explicitQuestion)) {
    return { examNumber: explicitExam, questionNumber: explicitQuestion };
  }

  const idMatch = String(question.id || "").match(/^exam(\d+)-0*(\d+)$/i);
  if (!idMatch) {
    return { examNumber: null, questionNumber: null };
  }

  return {
    examNumber: Number(idMatch[1]),
    questionNumber: Number(idMatch[2]),
  };
}

function formatQuestionBankLabel(question) {
  const { examNumber, questionNumber } = getQuestionExamInfo(question);
  if (!examNumber || !questionNumber) {
    return "Unlabeled question";
  }
  return `Exam ${examNumber} • Question ${questionNumber}`;
}

function getAllFlashcards() {
  return uniqueById(state.importedFlashcards);
}

function getCategories() {
  const known = new Map(CATEGORY_CONFIG.map((item) => [item.name, item]));
  for (const name of [
    ...new Set([...getAllQuestions(), ...getAllFlashcards()].map((item) => item.category).filter(Boolean)),
  ]) {
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

function getImportCategoryChoices() {
  return getCategories().map((category) => category.name);
}

function getImportTargetCategory() {
  if (state.importConfig.categoryMode === "create") {
    return state.importConfig.customCategory.trim();
  }
  if (state.importConfig.categoryMode === "assign") {
    return state.importConfig.category.trim();
  }
  return "";
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

function getQuestionStats(question, summary) {
  return summary && summary.questionMap ? summary.questionMap[question.id] : null;
}

function getEffectiveDifficulty(question, summary, rounded = true) {
  const stats = getQuestionStats(question, summary);
  if (!stats || !stats.attempts) {
    return 1;
  }

  const rawDifficulty = 1 + stats.missRate * 4;
  const difficulty = rounded ? Math.round(rawDifficulty) : rawDifficulty;
  return clamp(difficulty, 1, 5);
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
  const questionMap = groupAttempts(state.performance, "questionId");
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
    questionMap,
    weakCategories,
    weakTopics,
    weakTypes,
    weakestCategory,
    weakestTopic,
  };
}

function getPlacementSummary(placements = state.account.placements) {
  const safePlacements = Array.isArray(placements) ? placements : [];
  const podiumCounts = safePlacements.reduce(
    (counts, placement) => {
      if (placement.placement === 1) {
        counts.first += 1;
      }
      if (placement.placement === 2) {
        counts.second += 1;
      }
      if (placement.placement === 3) {
        counts.third += 1;
      }
      return counts;
    },
    { first: 0, second: 0, third: 0 },
  );
  const bestPlacement = safePlacements.reduce(
    (best, placement) =>
      best === null || Number(placement.placement) < Number(best.placement) ? placement : best,
    null,
  );
  const bestScore = safePlacements.reduce(
    (best, placement) => Math.max(best, Number(placement.score) || 0),
    0,
  );
  const recent = [...safePlacements].sort((first, second) => {
    return Number(second.finishedAt || 0) - Number(first.finishedAt || 0);
  });

  return {
    gamesPlayed: safePlacements.length,
    podiumCounts,
    bestPlacement,
    bestScore,
    recent,
  };
}

function sortStatEntries(statMap, limit = 5, direction = "weak") {
  return Object.entries(statMap)
    .sort((first, second) => {
      const accuracyDelta =
        direction === "strong"
          ? second[1].accuracy - first[1].accuracy
          : first[1].accuracy - second[1].accuracy;
      if (accuracyDelta !== 0) {
        return accuracyDelta;
      }
      return second[1].attempts - first[1].attempts;
    })
    .slice(0, limit);
}

function isInstructor() {
  return Boolean(hasAccountSession() && state.account.auth.role === "instructor");
}

function getSignedInLiveName() {
  return hasAccountSession() ? state.account.auth.displayName || state.account.auth.username : "";
}

function getPreferredLiveUsername() {
  return getSignedInLiveName() || state.live.username.trim();
}

function syncLiveNameToAccount() {
  const signedInName = getSignedInLiveName();
  if (!signedInName) {
    return;
  }
  state.live.username = signedInName;
  persistLiveProfile();
}

function getQuestionWeight(question, summary) {
  let weight = 1;

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
  const { targetDifficulty = null, allowUsedIds = new Set() } = options;
  const eligible = pool.filter((question) => !allowUsedIds.has(question.id));

  if (!eligible.length) {
    return null;
  }

  const scored = eligible.map((question) => {
    let weight = getQuestionWeight(question, summary);

    if (targetDifficulty !== null) {
      const effectiveDifficulty = getEffectiveDifficulty(question, summary, false);
      const difficultyGap = Math.abs(effectiveDifficulty - targetDifficulty);
      weight += Math.max(0, 3 - difficultyGap) * 1.4;
      if (
        (summary.weakCategories.has(question.category) ||
          summary.weakTopics.has(question.topic) ||
          summary.weakTypes.has(question.type)) &&
        effectiveDifficulty >= targetDifficulty
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

function selectQuestions(pool, count, summary) {
  const selected = [];
  const usedIds = new Set();
  const maxCount = Math.min(count, pool.length);

  while (selected.length < maxCount) {
    const question = pickWeightedQuestion(pool, summary, { allowUsedIds: usedIds });
    if (!question) {
      break;
    }
    usedIds.add(question.id);
    selected.push(question);
  }

  return selected;
}

function buildMockExamQuestions(count, summary) {
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
    const question = pickWeightedQuestion(pool, summary, { allowUsedIds: usedIds });

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
  const attempt = savePersonalAttempt(question, correct, mode);
  reportSharedAttempt(attempt);
}

function savePersonalAttempt(question, correct, mode) {
  const summary = computePerformanceSummary();
  const attempt = {
    questionId: question.id,
    category: question.category,
    topic: question.topic,
    type: question.type,
    difficulty: getEffectiveDifficulty(question, summary),
    mode,
    correct,
    timestamp: Date.now(),
    accountUsername: state.account.auth ? state.account.auth.username : null,
  };
  state.performance.push(attempt);
  saveJSON(STORAGE_KEYS.performance, state.performance);
  return attempt;
}

function reportSharedAttempt(attempt) {
  const headers = {
    "Content-Type": "application/json",
  };
  if (state.account.auth && state.account.auth.token) {
    headers.Authorization = `Bearer ${state.account.auth.token}`;
  }

  fetch(getLiveServerHttpUrl("/api/attempts"), {
    method: "POST",
    headers,
    body: JSON.stringify({
      userId: state.account.auth ? state.account.auth.username : state.sharedUserId,
      attempts: [attempt],
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
  const questions = selectQuestions(pool, state.quizConfig.count, summary);

  if (!questions.length) {
    state.quizSession = null;
    return;
  }

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
  const selectedFormat =
    MOCK_EXAM_OPTIONS.find((option) => option.count === state.mockConfig.count) || MOCK_EXAM_OPTIONS[0];
  state.mockConfig.count = selectedFormat.count;
  state.mockConfig.durationMinutes = selectedFormat.durationMinutes;
  const questions = buildMockExamQuestions(selectedFormat.count, summary);

  if (!questions.length) {
    state.mockSession = null;
    clearMockTimer();
    return;
  }

  state.mockSession = {
    questions,
    currentIndex: 0,
    answers: {},
    submitted: false,
    startedAt: Date.now(),
    durationMinutes: selectedFormat.durationMinutes,
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
  if (!hasStudyQuestions()) {
    state.jeopardy = {
      categories: [],
      board: [],
      answered: {},
      activeTile: null,
      score: 0,
    };
    return;
  }

  const summary = computePerformanceSummary();
  const categories = chooseJeopardyCategories(summary);
  const usedIds = new Set();
  const board = categories.map((category) =>
    BOARD_VALUES.map((value, valueIndex) => {
      const targetDifficulty = valueIndex + 1;
      const categoryPool = getAllQuestions().filter((question) => question.category === category);
      const question = pickWeightedQuestion(categoryPool, summary, {
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

  recordAttempt(question, correct, "solo-jeopardy");
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

function normalizeFlashcard(raw, index, importOptions = {}) {
  const category = String(
    firstDefined(importOptions.categoryOverride, raw.category, raw.deck, raw.setCategory, "Imported Flashcards"),
  ).trim();
  const front = String(firstDefined(raw.term, raw.front, raw.word, raw.question, "")).trim();
  const back = String(firstDefined(raw.definition, raw.back, raw.answer, raw.meaning, "")).trim();
  const topic = String(firstDefined(raw.topic, front)).trim();

  if (!front || !back) {
    return null;
  }

  return {
    id: String(firstDefined(raw.id, createStableId("flashcard", [category, topic, front, back]))),
    category,
    topic,
    front,
    back,
  };
}

function normalizeQuestion(raw, index, importOptions = {}) {
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
  const category = String(
    firstDefined(importOptions.categoryOverride, raw.category, raw.deck, raw.setCategory, "Imported Questions"),
  ).trim();
  const topic = String(firstDefined(raw.topic, raw.term, raw.front, "Imported Topic")).trim();
  const type = String(firstDefined(raw.type, importOptions.defaultType, "concept")).trim();
  const question = String(firstDefined(raw.question, raw.prompt, raw.stem, "")).trim();

  if (!category || !question || options.length < 2 || answerIndex < 0 || answerIndex >= options.length) {
    return null;
  }

  return {
    id: String(
      firstDefined(
        raw.id,
        createStableId("question", [category, topic, type, question, options.join("||"), answerIndex]),
      ),
    ),
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

function parseDelimited(text, delimiter) {
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

    if (char === delimiter && !inQuotes) {
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

function parseCSV(text) {
  return parseDelimited(text, ",");
}

function parseTSV(text) {
  return parseDelimited(text, "\t");
}

function normalizeFlashcardPair(record) {
  return normalizeFlashcard(record, 0);
}

function parseQuizletLikePairs(text, importOptions = {}) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return [];
  }

  const records = lines
    .map((line) => {
      const parts = line.split("\t").map((part) => part.trim());
      if (parts.length < 2) {
        return null;
      }
      return {
        term: parts[0],
        definition: parts.slice(1).join(" "),
      };
    })
    .filter(Boolean);

  if (records.length < 2) {
    return [];
  }

  return records
    .map((record, index) => normalizeFlashcard(record, index, importOptions))
    .filter(Boolean);
}

function parsePlainTextQuestions(text, importOptions = {}) {
  const blocks = text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks
    .map((block, index) => {
      const raw = {};
      const options = [];

      block
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line, lineIndex) => {
          if (/^question\s*:/i.test(line)) {
            raw.question = line.replace(/^question\s*:/i, "").trim();
            return;
          }
          if (/^topic\s*:/i.test(line)) {
            raw.topic = line.replace(/^topic\s*:/i, "").trim();
            return;
          }
          if (/^category\s*:/i.test(line)) {
            raw.category = line.replace(/^category\s*:/i, "").trim();
            return;
          }
          if (/^type\s*:/i.test(line)) {
            raw.type = line.replace(/^type\s*:/i, "").trim();
            return;
          }
          if (/^difficulty\s*:/i.test(line)) {
            raw.difficulty = line.replace(/^difficulty\s*:/i, "").trim();
            return;
          }
          if (/^answer\s*:/i.test(line)) {
            raw.correctAnswer = line.replace(/^answer\s*:/i, "").trim();
            return;
          }
          if (/^explanation\s*:/i.test(line)) {
            raw.explanation = line.replace(/^explanation\s*:/i, "").trim();
            return;
          }
          if (/^(option\s*)?[a-d][\)\].:\- ]+/i.test(line)) {
            options.push(line.replace(/^(option\s*)?[a-d][\)\].:\- ]+/i, "").trim());
            return;
          }
          if (lineIndex === 0 && !raw.question) {
            raw.question = line;
          }
        });

      raw.options = options;
      return normalizeQuestion(raw, index, importOptions);
    })
    .filter(Boolean);
}

function parseStructuredRecords(records, importOptions = {}) {
  const questionLike = records.some((record) =>
    firstDefined(record.question, record.prompt, record.options, record.optionA, record.correctAnswer) !== null,
  );
  if (questionLike) {
    return {
      kind: "questions",
      items: records.map((record, index) => normalizeQuestion(record, index, importOptions)).filter(Boolean),
    };
  }

  const flashcardLike = records.some((record) =>
    firstDefined(record.term, record.definition, record.front, record.back, record.word, record.meaning) !== null,
  );
  if (flashcardLike) {
    return {
      kind: "flashcards",
      items: records.map((record, index) => normalizeFlashcard(record, index, importOptions)).filter(Boolean),
    };
  }

  return { kind: null, items: [] };
}

function parseImportedText(text, importOptions = {}) {
  const trimmed = text.trim();
  if (!trimmed) {
    return { kind: null, items: [] };
  }

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    const records = Array.isArray(parsed) ? parsed : parsed.questions || [];
    return parseStructuredRecords(records, importOptions);
  }

  if (importOptions.formatHint === "flashcards") {
    const quizletLike = parseQuizletLikePairs(trimmed, importOptions);
    if (quizletLike.length) {
      return { kind: "flashcards", items: quizletLike };
    }
  }

  if (importOptions.formatHint === "plain") {
    const plain = parsePlainTextQuestions(trimmed, importOptions);
    if (plain.length) {
      return { kind: "questions", items: plain };
    }
  }

  if (trimmed.includes("\t")) {
    const tsvRecords = parseTSV(trimmed);
    const structuredTSV = parseStructuredRecords(tsvRecords, importOptions);
    if (structuredTSV.items.length) {
      return structuredTSV;
    }

    const quizletLike = parseQuizletLikePairs(trimmed, importOptions);
    if (quizletLike.length) {
      return { kind: "flashcards", items: quizletLike };
    }
  }

  const csvRecords = parseCSV(trimmed);
  const structuredCSV = parseStructuredRecords(csvRecords, importOptions);
  if (structuredCSV.items.length) {
    return structuredCSV;
  }

  const plain = parsePlainTextQuestions(trimmed, importOptions);
  if (plain.length) {
    return { kind: "questions", items: plain };
  }

  return { kind: null, items: [] };
}

function clearImportPreview() {
  state.importPreview = null;
}

function previewImport() {
  try {
    const categoryOverride = getImportTargetCategory();
    if ((state.importConfig.categoryMode === "assign" || state.importConfig.categoryMode === "create") && !categoryOverride) {
      state.importFeedback = {
        tone: "error",
        message: "Choose an existing category or enter a new category name before importing.",
      };
      clearImportPreview();
      return;
    }

    const parsed = parseImportedText(state.importDraft, {
      categoryOverride: categoryOverride || null,
      formatHint: state.importConfig.formatHint,
    });

    if (!parsed.items.length || !parsed.kind) {
      state.importFeedback = {
        tone: "error",
        message:
          "No valid import content was found. Try structured question files, Quizlet-style flashcards, or plain text question blocks.",
      };
      clearImportPreview();
      return;
    }

    state.importPreview = {
      kind: parsed.kind,
      items: parsed.items,
      categoryOverride: categoryOverride || "",
      categories: [...new Set(parsed.items.map((item) => item.category).filter(Boolean))],
    };
    state.importFeedback = {
      tone: "info",
      message: `Preview ready: ${parsed.items.length} ${parsed.kind === "flashcards" ? "flashcard" : "question"}${parsed.items.length === 1 ? "" : "s"} detected.`,
    };
  } catch (error) {
    state.importFeedback = {
      tone: "error",
      message: `Import failed: ${error.message}`,
    };
    clearImportPreview();
  }
}

function importQuestions() {
  if (!state.importPreview || !state.importPreview.items.length || !state.importPreview.kind) {
    previewImport();
    return;
  }

  if (state.importPreview.kind === "questions") {
    state.importedQuestions = uniqueById([...state.importedQuestions, ...state.importPreview.items]);
    saveJSON(STORAGE_KEYS.importedQuestions, state.importedQuestions);
    buildJeopardyBoard();
  }

  if (state.importPreview.kind === "flashcards") {
    state.importedFlashcards = uniqueById([...state.importedFlashcards, ...state.importPreview.items]);
    saveJSON(STORAGE_KEYS.importedFlashcards, state.importedFlashcards);
    buildFlashcardDeck();
  }

  const importedCount = state.importPreview.items.length;
  const importedKindLabel = state.importPreview.kind === "flashcards" ? "flashcard" : "question";
  const targetLabel = state.importPreview.categoryOverride ? ` into ${state.importPreview.categoryOverride}` : "";
  state.importFeedback = {
    tone: "success",
    message: `${importedCount} ${importedKindLabel}${importedCount === 1 ? "" : "s"} imported successfully${targetLabel}.`,
  };
  clearImportPreview();
}

function clearImportedFlashcards() {
  state.importedFlashcards = [];
  saveJSON(STORAGE_KEYS.importedFlashcards, state.importedFlashcards);
  buildFlashcardDeck();
  state.importFeedback = {
    tone: "info",
    message: "Imported flashcards cleared from this browser.",
  };
}

function buildFlashcardDeck() {
  const baseCards =
    state.flashcards.category === "all"
      ? getAllFlashcards()
      : getAllFlashcards().filter((card) => card.category === state.flashcards.category);
  state.flashcards.deck = state.flashcards.shuffled ? shuffle(baseCards) : [...baseCards];
  state.flashcards.currentIndex = clamp(state.flashcards.currentIndex, 0, Math.max(0, state.flashcards.deck.length - 1));
  state.flashcards.showingBack = false;
}

function getActiveFlashcard() {
  return state.flashcards.deck[state.flashcards.currentIndex] || null;
}

function renderFlashcardsView() {
  const categories = [...new Set(getAllFlashcards().map((card) => card.category).filter(Boolean))];

  if (!state.flashcards.deck.length && getAllFlashcards().length) {
    buildFlashcardDeck();
  }
  const activeCard = getActiveFlashcard();

  return `
    <section class="view">
      ${renderSectionIntro(
        "Flashcards",
        "Study imported cards in a Quizlet-style review flow",
        "Imported flashcards stay as front-and-back cards. Flip, shuffle, and filter by category without converting them into multiple-choice questions.",
      )}
      ${
        !getAllFlashcards().length
          ? `
            <section class="panel">
              <div class="panel__header">
                <h3>No flashcards imported yet</h3>
                <p>Import Quizlet-style term and definition content from the Import Bank to study it here as flashcards.</p>
              </div>
              <div class="question-card__actions">
                <button type="button" class="button button--primary" data-view="import">Open Import Bank</button>
                <button type="button" class="button button--ghost" data-action="load-flashcard-template">Load flashcard example</button>
              </div>
            </section>
          `
          : `
            <div class="split-layout">
              <section class="panel">
                <div class="form-grid form-grid--two">
                  <label class="field">
                    <span>Category</span>
                    <select id="flashcard-category">
                      <option value="all" ${state.flashcards.category === "all" ? "selected" : ""}>All flashcards</option>
                      ${categories
                        .map(
                          (category) =>
                            `<option value="${escapeHtml(category)}" ${state.flashcards.category === category ? "selected" : ""}>${escapeHtml(category)}</option>`,
                        )
                        .join("")}
                    </select>
                  </label>
                  <label class="field">
                    <span>Deck order</span>
                    <button type="button" class="toggle ${state.flashcards.shuffled ? "is-on" : ""}" data-action="toggle-flashcard-shuffle">
                      ${state.flashcards.shuffled ? "Shuffled" : "In order"}
                    </button>
                  </label>
                </div>
                ${
                  activeCard
                    ? `
                      <button type="button" class="flashcard-stage ${state.flashcards.showingBack ? "is-flipped" : ""}" data-action="flip-flashcard">
                        <div class="flashcard-stage__face flashcard-stage__face--front">
                          <span class="pill">${escapeHtml(activeCard.category)}</span>
                          <h3>${formatScientificText(activeCard.front)}</h3>
                          <p>Tap to reveal answer</p>
                        </div>
                        <div class="flashcard-stage__face flashcard-stage__face--back">
                          <span class="pill">${escapeHtml(activeCard.topic)}</span>
                          <h3>${formatScientificText(activeCard.back)}</h3>
                          <p>Tap to return to front</p>
                        </div>
                      </button>
                    `
                    : `
                      <div class="empty-state">
                        <strong>No flashcards match this filter.</strong>
                      </div>
                    `
                }
                <div class="question-card__actions">
                  <button type="button" class="button button--ghost" data-action="flashcard-prev" ${state.flashcards.currentIndex === 0 ? "disabled" : ""}>Previous</button>
                  <button type="button" class="button button--primary" data-action="flip-flashcard" ${!activeCard ? "disabled" : ""}>${state.flashcards.showingBack ? "Show front" : "Flip card"}</button>
                  <button type="button" class="button button--ghost" data-action="flashcard-next" ${!activeCard || state.flashcards.currentIndex >= state.flashcards.deck.length - 1 ? "disabled" : ""}>Next</button>
                </div>
              </section>
              <section class="panel">
                <div class="panel__header">
                  <h3>Deck status</h3>
                  <p>Use flashcards for fast active recall without changing them into multiple-choice items.</p>
                </div>
                <div class="insight-stack">
                  <article class="insight-card">
                    <span class="insight-card__label">Total flashcards</span>
                    <strong>${getAllFlashcards().length}</strong>
                  </article>
                  <article class="insight-card">
                    <span class="insight-card__label">Cards in current deck</span>
                    <strong>${state.flashcards.deck.length}</strong>
                  </article>
                  <article class="insight-card">
                    <span class="insight-card__label">Current position</span>
                    <strong>${activeCard ? `${state.flashcards.currentIndex + 1} of ${state.flashcards.deck.length}` : "0 of 0"}</strong>
                  </article>
                </div>
                <div class="question-card__actions">
                  <button type="button" class="button button--ghost" data-view="import">Import more flashcards</button>
                  <button type="button" class="button button--ghost" data-action="clear-flashcards">Clear flashcards</button>
                </div>
              </section>
            </div>
          `
      }
    </section>
  `;
}

function clearImportedQuestions() {
  state.importedQuestions = [];
  saveJSON(STORAGE_KEYS.importedQuestions, state.importedQuestions);
  state.importFeedback = {
    tone: "info",
    message: "Imported questions cleared. Solo study modes will stay empty until you import more content.",
  };
  buildJeopardyBoard();
}

function findQuestionById(questionId) {
  return getAllQuestions().find((question) => question.id === questionId) || null;
}

function updateQuestionBankDraft(target) {
  if (!isInstructor()) {
    return;
  }

  const questionId = target.dataset.bankEditId;
  const field = target.dataset.bankEditField;
  if (!questionId || !field) {
    return;
  }

  const question = findQuestionById(questionId);
  if (!question) {
    return;
  }

  const edit = {
    ...(state.questionEdits[questionId] || {}),
  };

  if (field === "option") {
    const optionIndex = Number(target.dataset.bankEditIndex);
    const options = Array.isArray(question.options) ? [...question.options] : ["", "", "", "", ""];
    if (Number.isFinite(optionIndex) && optionIndex >= 0 && optionIndex < 5) {
      while (options.length < 5) {
        options.push("");
      }
      options[optionIndex] = target.value;
      edit.options = options.slice(0, 5);
    }
  } else if (["answerIndex", "difficulty", "examNumber", "questionNumber"].includes(field)) {
    const numericValue = Number(target.value);
    if (Number.isFinite(numericValue)) {
      edit[field] = field === "answerIndex" ? clamp(numericValue, 0, 4) : numericValue;
    }
  } else {
    edit[field] = target.value;
  }

  state.questionEdits[questionId] = edit;
  state.questionBank.hasUnsavedChanges = true;
  state.questionBank.feedback = {
    tone: "info",
    message: "Unsaved edits are ready. Press Save Changes to keep them after refresh.",
  };
}

function saveQuestionBankEdits() {
  if (!isInstructor()) {
    state.questionBank.feedback = {
      tone: "error",
      message: "Only the instructor login can edit and save question bank changes.",
    };
    return;
  }

  saveJSON(STORAGE_KEYS.questionEdits, state.questionEdits);
  state.questionBank.hasUnsavedChanges = false;
  state.questionBank.feedback = {
    tone: "success",
    message: "Question bank changes saved locally on this device.",
  };
}

function scrollPracticeQuestionIntoView() {
  window.requestAnimationFrame(() => {
    const card = document.querySelector(".question-card--practice");
    if (!card) {
      return;
    }
    card.scrollIntoView({ behavior: "smooth", block: "start" });
  });
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
  scrollPracticeQuestionIntoView();
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

function persistAccountAuth() {
  if (hasAccountSession()) {
    saveJSON(STORAGE_KEYS.accountAuth, state.account.auth);
    return;
  }
  localStorage.removeItem(STORAGE_KEYS.accountAuth);
}

function hasAccountSession() {
  return Boolean(state.account.auth && state.account.auth.token);
}

function setAccountMessage(tone, message) {
  state.account.tone = tone;
  state.account.message = message;
}

function performanceAttemptKey(attempt) {
  return [
    attempt && attempt.questionId ? attempt.questionId : "",
    attempt && attempt.mode ? attempt.mode : "",
    attempt && attempt.timestamp ? attempt.timestamp : "",
  ].join("|");
}

function mergePerformanceAttempts(primaryAttempts, secondaryAttempts) {
  const merged = [];
  const seen = new Set();
  [...primaryAttempts, ...secondaryAttempts].forEach((attempt) => {
    if (!attempt || !attempt.questionId) {
      return;
    }
    const key = performanceAttemptKey(attempt);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    merged.push(attempt);
  });
  return merged.sort((first, second) => Number(first.timestamp || 0) - Number(second.timestamp || 0));
}

function syncAccountAttemptsToServer(attempts) {
  if (!hasAccountSession() || !Array.isArray(attempts) || !attempts.length) {
    return;
  }

  fetch(getLiveServerHttpUrl("/api/attempts"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.account.auth.token}`,
    },
    body: JSON.stringify({
      userId: state.account.auth.username,
      attempts,
    }),
    keepalive: true,
  }).catch(() => {
    // Account syncing should never block practice if the server is temporarily unavailable.
  });
}

function applyAccountSession(data) {
  const localPerformance = Array.isArray(state.performance) ? state.performance : [];
  const serverPerformance = Array.isArray(data.performance) ? data.performance : [];
  const serverAttemptKeys = new Set(serverPerformance.map(performanceAttemptKey));
  state.account.auth = {
    token: data.token || (state.account.auth && state.account.auth.token),
    username: data.user.username,
    displayName: data.user.displayName || data.user.username,
    role: data.user.role || "student",
  };
  state.account.verifying = false;
  const localAccountAttempts = localPerformance.filter((attempt) => {
    return attempt.accountUsername === state.account.auth.username && !serverAttemptKeys.has(performanceAttemptKey(attempt));
  });
  state.performance = mergePerformanceAttempts(serverPerformance, localAccountAttempts);
  saveJSON(STORAGE_KEYS.performance, state.performance);
  syncAccountAttemptsToServer(localAccountAttempts);
  state.account.placements = Array.isArray(data.placements) ? data.placements : [];
  persistAccountAuth();
  syncLiveNameToAccount();
  setAccountMessage("success", `Signed in as ${state.account.auth.displayName}.`);
}

async function apiRequest(path, method, payload) {
  const headers = {
    "Content-Type": "application/json",
  };
  if (state.account.auth && state.account.auth.token) {
    headers.Authorization = `Bearer ${state.account.auth.token}`;
  }

  const response = await fetch(getLiveServerHttpUrl(path), {
    method,
    headers,
    body: payload ? JSON.stringify(payload) : undefined,
  });

  let body = null;
  try {
    body = await response.json();
  } catch (error) {
    body = null;
  }

  if (!response.ok) {
    const message =
      body && body.error
        ? body.error
        : response.status === 405
          ? "This page is running from a static preview server. For login and online play, start the backend with `python3 server.py` and open http://localhost:4173."
          : `Request failed with status ${response.status}.`;
    throw new Error(message);
  }

  return body;
}

async function loginAccount() {
  if (state.account.busy || state.account.verifying) {
    return;
  }

  const usernameFields = [...document.querySelectorAll("#account-username, #top-account-username")];
  const passwordFields = [...document.querySelectorAll("#account-password, #top-account-password")];
  const username = (usernameFields.find((field) => field.value.trim())?.value || state.account.username).trim();
  const password = passwordFields.find((field) => field.value)?.value || state.account.password;
  state.account.username = username;
  state.account.password = password;

  if (!username || !password) {
    setAccountMessage("error", "Enter both username and password.");
    renderApp();
    return;
  }

  state.account.busy = true;
  try {
    const data = await apiRequest("/api/auth/login", "POST", { username, password });
    state.account.password = "";
    applyAccountSession(data);
    if (isInstructor()) {
      await loadInstructorStats(false);
      state.activeView = "instructor";
    }
  } catch (error) {
    setAccountMessage("error", error.message || "Could not sign in.");
  } finally {
    state.account.busy = false;
    renderApp();
  }
}

async function logoutAccount() {
  if (state.account.auth) {
    try {
      await apiRequest("/api/auth/logout", "POST", {});
    } catch (error) {
      // Logging out locally is enough if the server token is already gone.
    }
  }

  state.account.auth = null;
  state.account.verifying = false;
  state.account.password = "";
  state.account.placements = [];
  state.instructor.data = null;
  state.instructor.selectedUser = "all";
  state.instructor.message = "Instructor metrics load after an instructor signs in.";
  state.instructor.tone = "info";
  persistAccountAuth();
  setAccountMessage("info", "Signed out. This browser will keep local history, but new attempts will not sync to an account.");
  renderApp();
}

async function restoreAccountSession() {
  if (!state.account.auth || !state.account.auth.token) {
    if (state.account.auth) {
      state.account.auth = null;
      persistAccountAuth();
    }
    state.account.verifying = false;
    renderApp();
    return;
  }

  state.account.verifying = true;
  renderApp();

  try {
    const data = await apiRequest("/api/auth/me", "GET");
    applyAccountSession(data);
    if (isInstructor()) {
      await loadInstructorStats(false);
    }
  } catch (error) {
    state.account.auth = null;
    state.account.verifying = false;
    persistAccountAuth();
    setAccountMessage("error", "Saved sign-in expired. Please sign in again.");
  }
  renderApp();
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
    state.live.lastRecordedRevealKey = null;
  }
}

async function refreshAccountSession() {
  if (!state.account.auth || !state.account.auth.token) {
    return;
  }

  try {
    const data = await apiRequest("/api/auth/me", "GET");
    applyAccountSession(data);
    renderApp();
  } catch (error) {
    setAccountMessage("error", "Could not refresh profile history from the server.");
  }
}

async function loadInstructorStats(renderWhenDone = true) {
  if (!isInstructor()) {
    state.instructor.data = null;
    state.instructor.message = "Instructor metrics require an instructor login.";
    state.instructor.tone = "error";
    if (renderWhenDone) {
      renderApp();
    }
    return;
  }

  state.instructor.loading = true;
  state.instructor.message = "Loading instructor performance metrics...";
  state.instructor.tone = "info";
  if (renderWhenDone) {
    renderApp();
  }

  try {
    const data = await apiRequest("/api/instructor/stats", "GET");
    state.instructor.data = data;
    state.instructor.message = "Instructor metrics are up to date.";
    state.instructor.tone = "success";
  } catch (error) {
    state.instructor.message = error.message || "Could not load instructor metrics.";
    state.instructor.tone = "error";
  } finally {
    state.instructor.loading = false;
    if (renderWhenDone) {
      renderApp();
    }
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
      if (
        message.session.activeQuestion &&
        message.session.status === "reveal" &&
        state.live.lastRecordedRevealKey !== nextKey
      ) {
        const activeQuestion = message.session.activeQuestion;
        const viewerResult = activeQuestion.viewerResult;
        if (viewerResult) {
          recordAttempt(
            {
              id:
                activeQuestion.questionId ||
                `live-${message.session.code}-${activeQuestion.columnIndex}-${activeQuestion.rowIndex}`,
              category: activeQuestion.category,
              topic: activeQuestion.topic,
              type: activeQuestion.type || "concept",
              difficulty: activeQuestion.difficulty || 1,
            },
            Boolean(viewerResult.correct),
            "live-jeopardy",
          );
          state.live.lastRecordedRevealKey = nextKey;
        }
      }
      state.live.lastQuestionKey = nextKey;
      if (!message.session.activeQuestion || message.session.status !== "question") {
        state.live.answerIndex = null;
      }
      if (
        message.session.status === "finished" &&
        state.account.auth &&
        state.live.lastProfileRefreshCode !== message.session.code
      ) {
        state.live.lastProfileRefreshCode = message.session.code;
        refreshAccountSession();
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

  const username = getPreferredLiveUsername();
  if (username.length < 2) {
    setLiveMessage("error", "Enter a username with at least 2 characters.");
    renderApp();
    return;
  }

  state.live.busy = true;
  state.live.username = username;
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

  const username = getPreferredLiveUsername();
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
  state.live.username = username;
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

function renderQuestionBankEmptyState(title, body, detail) {
  return `
    <section class="panel">
      <div class="panel__header">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(body)}</p>
      </div>
      <div class="empty-state">
        <strong>No seeded study bank is included in this build.</strong>
        <p>${escapeHtml(detail)}</p>
      </div>
      <div class="question-card__actions">
        <button type="button" class="button button--primary" data-view="import">Open Import Bank</button>
      </div>
    </section>
  `;
}

function renderExplanationContent(entry) {
  const summary = computePerformanceSummary();
  const difficulty =
    entry && entry.id
      ? `<p><strong>Difficulty rating:</strong> ${escapeHtml(getEffectiveDifficulty(entry, summary))} / 5</p>`
      : "";
  const explanation = entry && entry.explanation ? `<p>${formatTextWithSourceLinks(entry.explanation)}</p>` : "";
  const source = entry && entry.source ? `<p><em>${formatTextWithSourceLinks(entry.source)}</em></p>` : "";
  return `${difficulty}${explanation}${source}`;
}

function renderQuestionMedia(entry) {
  if (!entry || !entry.image) {
    return "";
  }

  return `
    <figure class="question-media">
      <img src="${escapeHtml(entry.image)}" alt="${escapeHtml(entry.imageAlt || "Question reference image")}" />
      ${entry.imageCaption ? `<figcaption>${escapeHtml(entry.imageCaption)}</figcaption>` : ""}
    </figure>
  `;
}

function getQuestionBankEditValue(question, field) {
  const value = question[field];
  return value === undefined || value === null ? "" : value;
}

function renderQuestionBankEditor(question) {
  const answerIndex = Number.isFinite(Number(question.answerIndex)) ? Number(question.answerIndex) : 0;
  const options = Array.isArray(question.options) ? question.options : [];

  if (!isInstructor()) {
    return `
      <div class="bank-readonly">
        <h3>${formatScientificText(question.question)}</h3>
        <div class="option-list option-list--bank">
          ${[0, 1, 2, 3, 4]
            .map(
              (index) => `
                <div class="option ${index === answerIndex ? "is-correct" : ""}">
                  <span>${String.fromCharCode(65 + index)}</span>
                  <strong>${formatScientificText(options[index] || "")}</strong>
                </div>
              `,
            )
            .join("")}
        </div>
        <div class="feedback feedback--correct">
          ${renderExplanationContent(question)}
        </div>
      </div>
    `;
  }

  return `
    <div class="bank-editor">
      <label class="bank-edit-field bank-edit-field--wide">
        <span>Question Stem</span>
        <textarea data-bank-edit-id="${escapeHtml(question.id)}" data-bank-edit-field="question" rows="3">${escapeHtml(
          getQuestionBankEditValue(question, "question"),
        )}</textarea>
      </label>
      <div class="bank-edit-grid">
        <label class="bank-edit-field">
          <span>Category</span>
          <input data-bank-edit-id="${escapeHtml(question.id)}" data-bank-edit-field="category" type="text" value="${escapeHtml(
            getQuestionBankEditValue(question, "category"),
          )}" />
        </label>
        <label class="bank-edit-field">
          <span>Topic</span>
          <input data-bank-edit-id="${escapeHtml(question.id)}" data-bank-edit-field="topic" type="text" value="${escapeHtml(
            getQuestionBankEditValue(question, "topic"),
          )}" />
        </label>
        <label class="bank-edit-field">
          <span>Type</span>
          <input data-bank-edit-id="${escapeHtml(question.id)}" data-bank-edit-field="type" type="text" value="${escapeHtml(
            getQuestionBankEditValue(question, "type"),
          )}" />
        </label>
      </div>
      <div class="bank-options-editor">
        ${[0, 1, 2, 3, 4]
          .map(
            (index) => `
              <label class="bank-option-edit ${index === answerIndex ? "is-correct" : ""}">
                <span>${String.fromCharCode(65 + index)}</span>
                <input
                  data-bank-edit-id="${escapeHtml(question.id)}"
                  data-bank-edit-field="option"
                  data-bank-edit-index="${index}"
                  type="text"
                  value="${escapeHtml(options[index] || "")}"
                />
              </label>
            `,
          )
          .join("")}
      </div>
      <div class="bank-edit-grid bank-edit-grid--answer">
        <label class="bank-edit-field">
          <span>Correct Answer</span>
          <select data-bank-edit-id="${escapeHtml(question.id)}" data-bank-edit-field="answerIndex">
            ${[0, 1, 2, 3, 4]
              .map(
                (index) =>
                  `<option value="${index}" ${index === answerIndex ? "selected" : ""}>${String.fromCharCode(65 + index)}: ${escapeHtml(
                    options[index] || "Blank option",
                  )}</option>`,
              )
              .join("")}
          </select>
        </label>
        <label class="bank-edit-field">
          <span>Exam #</span>
          <input data-bank-edit-id="${escapeHtml(question.id)}" data-bank-edit-field="examNumber" type="number" min="1" value="${escapeHtml(
            getQuestionBankEditValue(question, "examNumber"),
          )}" />
        </label>
        <label class="bank-edit-field">
          <span>Question #</span>
          <input data-bank-edit-id="${escapeHtml(question.id)}" data-bank-edit-field="questionNumber" type="number" min="1" value="${escapeHtml(
            getQuestionBankEditValue(question, "questionNumber"),
          )}" />
        </label>
      </div>
      <label class="bank-edit-field bank-edit-field--wide">
        <span>Explanation</span>
        <textarea data-bank-edit-id="${escapeHtml(question.id)}" data-bank-edit-field="explanation" rows="4">${escapeHtml(
          getQuestionBankEditValue(question, "explanation"),
        )}</textarea>
      </label>
      <label class="bank-edit-field bank-edit-field--wide">
        <span>Source</span>
        <textarea data-bank-edit-id="${escapeHtml(question.id)}" data-bank-edit-field="source" rows="2">${escapeHtml(
          getQuestionBankEditValue(question, "source"),
        )}</textarea>
      </label>
    </div>
  `;
}

function getFilteredQuestionBank() {
  const search = state.questionBank.search.trim().toLowerCase();

  return getAllQuestions().filter((question) => {
    const { examNumber, questionNumber } = getQuestionExamInfo(question);

    if (state.questionBank.exam !== "all" && String(examNumber) !== state.questionBank.exam) {
      return false;
    }

    if (state.questionBank.question !== "all" && String(questionNumber) !== state.questionBank.question) {
      return false;
    }

    if (state.questionBank.category !== "all" && question.category !== state.questionBank.category) {
      return false;
    }

    if (state.questionBank.source !== "all" && getQuestionOrigin(question) !== state.questionBank.source) {
      return false;
    }

    if (!search) {
      return true;
    }

    const haystack = [
      question.question,
      question.category,
      question.topic,
      question.type,
      ...(question.options || []),
      question.explanation || "",
      question.source || "",
      formatQuestionBankLabel(question),
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(search);
  });
}

function renderQuestionBankView() {
  const categories = getCategories();
  const allQuestions = getAllQuestions();
  const examOptions = [
    ...new Set(
      allQuestions
        .map((question) => getQuestionExamInfo(question).examNumber)
        .filter((examNumber) => Number.isFinite(examNumber)),
    ),
  ].sort((first, second) => first - second);
  const questionOptions = [
    ...new Set(
      allQuestions
        .filter((question) => {
          if (state.questionBank.exam === "all") {
            return true;
          }
          return String(getQuestionExamInfo(question).examNumber) === state.questionBank.exam;
        })
        .map((question) => getQuestionExamInfo(question).questionNumber)
        .filter((questionNumber) => Number.isFinite(questionNumber)),
    ),
  ].sort((first, second) => first - second);
  const questions = getFilteredQuestionBank();
  const totalQuestions = allQuestions.length;
  const sharedCount = allQuestions.filter((question) => getQuestionOrigin(question) === "shared").length;
  const importedCount = totalQuestions - sharedCount;
  const bankFeedbackClass = `import-feedback import-feedback--${state.questionBank.feedback.tone}`;

  return `
    <section class="view">
      ${renderSectionIntro(
        "Question Bank",
        "Browse every loaded question in one place",
        "Search, filter, and review the full question bank without starting a quiz. This includes the shared seeded bank plus any questions you import locally.",
      )}
      <div class="card-grid card-grid--metrics">
        ${renderMetric("Visible Questions", `${questions.length}`, "gold")}
        ${renderMetric("Shared Seeded", `${sharedCount}`, "blue")}
        ${renderMetric("Imported Local", `${importedCount}`, "default")}
      </div>
      <section class="panel bank-save-bar">
        <div>
          <h3>${isInstructor() ? "Editable Question Bank" : "Question Bank Review"}</h3>
          <p>${
            isInstructor()
              ? "Changes are staged as you type. Press Save Changes to keep them locally on this device."
              : "Only the instructor login can edit question text, answers, explanations, and source details."
          }</p>
        </div>
        ${
          isInstructor()
            ? `
              <div class="bank-save-bar__actions">
                <span class="pill">${state.questionBank.hasUnsavedChanges ? "Unsaved edits" : "No unsaved edits"}</span>
                <button type="button" class="button button--primary" data-action="save-question-bank-edits">Save Changes</button>
              </div>
              <div class="${bankFeedbackClass}">
                <strong>${escapeHtml(state.questionBank.feedback.message)}</strong>
              </div>
            `
            : `<div class="bank-save-bar__actions"><span class="pill">Read only</span></div>`
        }
      </section>
      <section class="panel panel--form">
        <div class="form-grid form-grid--bank">
          <label class="field">
            <span>Search</span>
            <input
              id="question-bank-search"
              type="text"
              placeholder="Search by stem, topic, option, or explanation"
              value="${escapeHtml(state.questionBank.search)}"
            />
          </label>
          <label class="field">
            <span>Exam #</span>
            <select id="question-bank-exam">
              <option value="all" ${state.questionBank.exam === "all" ? "selected" : ""}>All exams</option>
              ${examOptions
                .map(
                  (examNumber) =>
                    `<option value="${examNumber}" ${
                      state.questionBank.exam === String(examNumber) ? "selected" : ""
                    }>Exam ${examNumber}</option>`,
                )
                .join("")}
            </select>
          </label>
          <label class="field">
            <span>Question #</span>
            <select id="question-bank-question">
              <option value="all" ${state.questionBank.question === "all" ? "selected" : ""}>All questions</option>
              ${questionOptions
                .map(
                  (questionNumber) =>
                    `<option value="${questionNumber}" ${
                      state.questionBank.question === String(questionNumber) ? "selected" : ""
                    }>Question ${questionNumber}</option>`,
                )
                .join("")}
            </select>
          </label>
          <label class="field">
            <span>Category</span>
            <select id="question-bank-category">
              <option value="all" ${state.questionBank.category === "all" ? "selected" : ""}>All categories</option>
              ${categories
                .map(
                  (category) =>
                    `<option value="${escapeHtml(category.name)}" ${
                      state.questionBank.category === category.name ? "selected" : ""
                    }>${escapeHtml(category.name)}</option>`,
                )
                .join("")}
            </select>
          </label>
          <label class="field">
            <span>Source</span>
            <select id="question-bank-source">
              <option value="all" ${state.questionBank.source === "all" ? "selected" : ""}>All questions</option>
              <option value="shared" ${state.questionBank.source === "shared" ? "selected" : ""}>Shared seeded bank</option>
              <option value="imported" ${state.questionBank.source === "imported" ? "selected" : ""}>Imported local questions</option>
            </select>
          </label>
        </div>
      </section>
      ${
        !questions.length
          ? `
            <section class="panel">
              <div class="empty-state">
                <strong>No questions match the current filters.</strong>
                <p>Try clearing the search, switching categories, or importing more content.</p>
              </div>
            </section>
          `
          : `
            <div class="review-list review-list--bank">
              ${questions
                .map((question) => {
                  const origin = getQuestionOrigin(question);
                  return `
                    <article class="review-card review-card--bank">
                      <div class="review-card__header">
                        <span>${escapeHtml(formatQuestionBankLabel(question))}</span>
                        <strong>${origin === "shared" ? "Shared Seeded" : "Imported Local"}</strong>
                      </div>
                      <div class="question-card__meta">
                        <span class="pill">${escapeHtml(question.category)}</span>
                        <span class="pill">${escapeHtml(question.topic)}</span>
                        <span class="pill">${escapeHtml(question.type)}</span>
                      </div>
                      ${renderQuestionMedia(question)}
                      ${renderQuestionBankEditor(question)}
                    </article>
                  `;
                })
                .join("")}
            </div>
          `
      }
    </section>
  `;
}

function renderProfileView(summary) {
  const placements = getPlacementSummary();
  const recentAttempts = [...state.performance].slice(-8).reverse();
  const feedbackClass = `import-feedback import-feedback--${state.account.tone}`;
  const modeEntries = Object.entries(groupAttempts(state.performance, "mode")).sort(
    (first, second) => second[1].attempts - first[1].attempts,
  );
  const weakCategories = sortStatEntries(summary.categoryMap, 5, "weak");
  const strongCategories = sortStatEntries(summary.categoryMap, 5, "strong");
  const missed = Math.max(0, summary.total - summary.correct);
  const displayName = state.account.auth ? state.account.auth.displayName : "Local tester";

  return `
    <section class="view">
      ${renderSectionIntro(
        "Profile",
        `${displayName} stats`,
        "Review your question-answer performance, category trends, and saved live Jeopardy placements.",
      )}
      ${
        state.account.auth
          ? `
            <section class="panel profile-callout">
              <div>
                <h3>Account</h3>
                <p>Signed in as ${escapeHtml(state.account.auth.username)}. Your quiz, mock exam, solo Jeopardy, and live Jeopardy history syncs to this profile.</p>
              </div>
              <button type="button" class="button button--ghost" data-action="account-logout">Sign out</button>
            </section>
          `
          : `
            <div class="split-layout">
              <section class="panel panel--form">
                <div class="panel__header">
                  <h3>Sign in to save this profile across devices</h3>
                  <p>Question stats below are from this browser until you sign in. Online Jeopardy placements save to your profile when you play while signed in.</p>
                </div>
                <div class="form-grid form-grid--two">
                  <label class="field">
                    <span>Username</span>
                    <input id="account-username" type="text" autocomplete="username" placeholder="username" value="${escapeHtml(state.account.username)}" />
                  </label>
                  <label class="field">
                    <span>Password</span>
                    <input id="account-password" type="password" autocomplete="current-password" placeholder="Password" value="${escapeHtml(state.account.password)}" />
                  </label>
                </div>
                <div class="${feedbackClass}">
                  <strong>${escapeHtml(state.account.message)}</strong>
                </div>
                <div class="question-card__actions">
                  <button type="button" class="button button--primary" data-action="account-login" ${state.account.busy ? "disabled" : ""}>Sign in</button>
                </div>
              </section>
              <section class="panel">
                <div class="panel__header">
                  <h3>What gets saved</h3>
                  <p>Attempts are still saved locally for speed, and signed-in users also sync them to the server account file.</p>
                </div>
                <div class="insight-stack">
                  <article class="insight-card">
                    <span class="insight-card__label">Saved modes</span>
                    <strong>Quiz, mock exam, solo Jeopardy, and live Jeopardy review attempts.</strong>
                  </article>
                  <article class="insight-card">
                    <span class="insight-card__label">Adaptive study</span>
                    <strong>Solo practice uses the signed-in user's own saved history.</strong>
                  </article>
                  <article class="insight-card">
                    <span class="insight-card__label">Live placements</span>
                    <strong>Online Jeopardy placements save when the host ends the game.</strong>
                  </article>
                </div>
              </section>
            </div>
          `
      }
      <div class="card-grid card-grid--metrics">
        ${renderMetric("Questions Answered", `${summary.total}`, "gold")}
        ${renderMetric("Correct Answers", `${summary.correct}`, "blue")}
        ${renderMetric("Missed Answers", `${missed}`, "default")}
        ${renderMetric("Accuracy", formatPercent(summary.accuracy), "default")}
      </div>
      <div class="split-layout">
        <section class="panel">
          <div class="panel__header">
            <h3>Question and answer stats</h3>
            <p>Accuracy by mode, using your saved quiz, mock exam, solo Jeopardy, and live Jeopardy attempts.</p>
          </div>
          <div class="profile-stat-list">
            ${
              modeEntries.length
                ? modeEntries
                    .map(
                      ([mode, stats]) => `
                        <article class="profile-stat-row">
                          <div>
                            <strong>${escapeHtml(mode)}</strong>
                            <span>${stats.correct} correct • ${stats.attempts - stats.correct} missed</span>
                          </div>
                          <strong>${formatPercent(stats.accuracy)}</strong>
                        </article>
                      `,
                    )
                    .join("")
                : `<div class="empty-state"><strong>No question attempts yet.</strong><p>Start a quiz, mock exam, or Jeopardy board to build your stats.</p></div>`
            }
          </div>
        </section>
        <section class="panel">
          <div class="panel__header">
            <h3>Category trends</h3>
            <p>Quickly compare your strongest and weakest board-review areas.</p>
          </div>
          <div class="profile-columns">
            <div>
              <h4>Needs review</h4>
              <div class="profile-stat-list">
                ${
                  weakCategories.length
                    ? weakCategories
                        .map(
                          ([category, stats]) => `
                            <article class="profile-mini-row">
                              <span>${escapeHtml(category)}</span>
                              <strong>${formatPercent(stats.accuracy)}</strong>
                            </article>
                          `,
                        )
                        .join("")
                    : `<p class="muted-copy">No category data yet.</p>`
                }
              </div>
            </div>
            <div>
              <h4>Strongest</h4>
              <div class="profile-stat-list">
                ${
                  strongCategories.length
                    ? strongCategories
                        .map(
                          ([category, stats]) => `
                            <article class="profile-mini-row">
                              <span>${escapeHtml(category)}</span>
                              <strong>${formatPercent(stats.accuracy)}</strong>
                            </article>
                          `,
                        )
                        .join("")
                    : `<p class="muted-copy">No category data yet.</p>`
                }
              </div>
            </div>
          </div>
        </section>
      </div>
      <section class="panel">
        <div class="panel__header">
          <h3>Online Jeopardy placements</h3>
          <p>Placements are saved when the host ends a live game. Ties share the same placement.</p>
        </div>
        <div class="placement-podium">
          <article>
            <span>1st</span>
            <strong>${placements.podiumCounts.first}</strong>
          </article>
          <article>
            <span>2nd</span>
            <strong>${placements.podiumCounts.second}</strong>
          </article>
          <article>
            <span>3rd</span>
            <strong>${placements.podiumCounts.third}</strong>
          </article>
          <article>
            <span>Games</span>
            <strong>${placements.gamesPlayed}</strong>
          </article>
          <article>
            <span>Best score</span>
            <strong>${placements.bestScore}</strong>
          </article>
        </div>
        <div class="history-list">
          ${
            placements.recent.length
              ? placements.recent
                  .slice(0, 8)
                  .map(
                    (placement) => `
                      <article class="history-row">
                        <div>
                          <strong>${escapeHtml(placement.placementLabel || `${placement.placement}`)} place • ${Number(placement.score) || 0} points</strong>
                          <span>Game ${escapeHtml(placement.gameCode || "Unknown")} • ${Number(placement.playerCount) || 0} players • ${
                            placement.finishedAt ? new Date(placement.finishedAt).toLocaleDateString() : "No date"
                          }</span>
                        </div>
                        <strong>${placement.isHost ? "Host" : "Player"}</strong>
                      </article>
                    `,
                  )
                  .join("")
              : `<div class="empty-state"><strong>No live placements yet.</strong><p>Sign in, play online Jeopardy, and have the host end the game to save final placements.</p></div>`
          }
        </div>
      </section>
      <section class="panel">
        <div class="panel__header">
          <h3>Recent question history</h3>
          <p>Your latest saved answers.</p>
        </div>
        <div class="history-list">
          ${
            recentAttempts.length
              ? recentAttempts
                  .map((attempt) => {
                    const question = getAllQuestions().find((item) => item.id === attempt.questionId);
                    return `
                      <article class="history-row ${attempt.correct ? "is-correct" : "is-wrong"}">
                        <div>
                          <strong>${formatScientificText(question ? question.question : attempt.questionId)}</strong>
                          <span>${escapeHtml(attempt.mode)} • ${escapeHtml(attempt.category)} • ${new Date(attempt.timestamp).toLocaleDateString()}</span>
                        </div>
                        <strong>${attempt.correct ? "Correct" : "Missed"}</strong>
                      </article>
                    `;
                  })
                  .join("")
              : `<div class="empty-state"><strong>No recent answers yet.</strong><p>Your latest practice attempts will appear here.</p></div>`
          }
        </div>
      </section>
    </section>
  `;
}

function renderStatBars(statMap, limit = 8) {
  const entries = Object.entries(statMap || {})
    .sort((first, second) => second[1].attempts - first[1].attempts)
    .slice(0, limit);

  if (!entries.length) {
    return `<div class="empty-state"><strong>No data yet.</strong><p>Student attempts will appear here after practice sessions.</p></div>`;
  }

  return `
    <div class="stat-bars">
      ${entries
        .map(([label, stats]) => {
          const accuracy = Number(stats.accuracy) || 0;
          return `
            <article class="stat-bar">
              <div class="stat-bar__label">
                <strong>${escapeHtml(label)}</strong>
                <span>${stats.correct}/${stats.attempts} correct • ${formatPercent(accuracy)}</span>
              </div>
              <div class="stat-bar__track">
                <span style="width: ${clamp(accuracy, 0, 100)}%"></span>
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderInstructorUserDetail(user) {
  if (!user) {
    return `<div class="empty-state"><strong>Select a user.</strong><p>Choose a student from the dropdown to review individual performance.</p></div>`;
  }

  const summary = user.summary || {};
  const placements = user.placements || { gamesPlayed: 0, podiumCounts: { first: 0, second: 0, third: 0 }, bestScore: 0 };
  const recentAttempts = Array.isArray(user.recentAttempts) ? user.recentAttempts.slice(0, 12) : [];

  return `
    <div class="instructor-detail">
      <div class="card-grid card-grid--metrics">
        ${renderMetric("Attempts", `${summary.attempts || 0}`, "gold")}
        ${renderMetric("Accuracy", formatPercent(Number(summary.accuracy) || 0), "blue")}
        ${renderMetric("Live Games", `${placements.gamesPlayed || 0}`, "default")}
        ${renderMetric("Best Score", `${placements.bestScore || 0}`, "default")}
      </div>
      <div class="split-layout">
        <section class="panel">
          <div class="panel__header">
            <h3>${escapeHtml(user.displayName)} by category</h3>
            <p>Category accuracy and volume for this user.</p>
          </div>
          ${renderStatBars(summary.categoryStats || {}, 8)}
        </section>
        <section class="panel">
          <div class="panel__header">
            <h3>Mode breakdown</h3>
            <p>Quiz, mock, solo Jeopardy, and live Jeopardy activity.</p>
          </div>
          ${renderStatBars(summary.modeStats || {}, 6)}
        </section>
      </div>
      <section class="panel">
        <div class="panel__header">
          <h3>Recent answer history</h3>
          <p>Latest saved answers for the selected user.</p>
        </div>
        <div class="history-list">
          ${
            recentAttempts.length
              ? recentAttempts
                  .map(
                    (attempt) => `
                      <article class="history-row ${attempt.correct ? "is-correct" : "is-wrong"}">
                        <div>
                          <strong>${formatScientificText(attempt.question || attempt.questionId)}</strong>
                          <span>${escapeHtml(attempt.mode)} • ${escapeHtml(attempt.category)} • ${attempt.timestamp ? new Date(attempt.timestamp).toLocaleDateString() : "No date"}</span>
                        </div>
                        <strong>${attempt.correct ? "Correct" : "Missed"}</strong>
                      </article>
                    `,
                  )
                  .join("")
              : `<div class="empty-state"><strong>No attempts for this user yet.</strong><p>Once they answer questions, their history will populate here.</p></div>`
          }
        </div>
      </section>
    </div>
  `;
}

function renderInstructorView() {
  if (!isInstructor()) {
    return `
      <section class="view">
        ${renderSectionIntro(
          "Instructor",
          "Instructor login required",
          "Use the instructor account to review class performance, answer histories, and individual success rates.",
        )}
        <section class="panel profile-callout">
          <div>
            <h3>Sign in as an instructor</h3>
            <p>The instructor dashboard is protected so student histories are only visible to instructor-role accounts.</p>
          </div>
          <button type="button" class="button button--primary" data-view="profile">Open Profile Login</button>
        </section>
      </section>
    `;
  }

  const data = state.instructor.data;
  const aggregate = data ? data.aggregate : null;
  const users = data ? data.users.filter((user) => user.role !== "instructor") : [];
  const selectedUser =
    state.instructor.selectedUser === "all"
      ? null
      : users.find((user) => user.username === state.instructor.selectedUser) || null;
  const feedbackClass = `import-feedback import-feedback--${state.instructor.tone}`;

  return `
    <section class="view">
      ${renderSectionIntro(
        "Instructor",
        "Class performance dashboard",
        "Monitor roster-wide success rates, identify weak content areas, and drill into individual answer history.",
      )}
      <section class="panel instructor-toolbar">
        <label class="field">
          <span>View individual performance</span>
          <select id="instructor-user-select">
            <option value="all" ${state.instructor.selectedUser === "all" ? "selected" : ""}>Class overview</option>
            ${users
              .map(
                (user) =>
                  `<option value="${escapeHtml(user.username)}" ${state.instructor.selectedUser === user.username ? "selected" : ""}>${escapeHtml(user.displayName)} (${escapeHtml(user.username)})</option>`,
              )
              .join("")}
          </select>
        </label>
        <button type="button" class="button button--primary" data-action="refresh-instructor-stats" ${state.instructor.loading ? "disabled" : ""}>
          ${state.instructor.loading ? "Refreshing..." : "Refresh Stats"}
        </button>
        <div class="${feedbackClass}">
          <strong>${escapeHtml(state.instructor.message)}</strong>
        </div>
      </section>
      ${
        !aggregate
          ? `<section class="panel"><div class="empty-state"><strong>No instructor metrics loaded yet.</strong><p>Press Refresh Stats to pull the latest roster data from the server.</p></div></section>`
          : state.instructor.selectedUser !== "all"
            ? renderInstructorUserDetail(selectedUser)
            : `
              <div class="card-grid card-grid--metrics">
                ${renderMetric("Roster Users", `${aggregate.totalUsers || 0}`, "gold")}
                ${renderMetric("Active Users", `${aggregate.activeUsers || 0}`, "blue")}
                ${renderMetric("Total Attempts", `${aggregate.totalAttempts || 0}`, "default")}
                ${renderMetric("Class Accuracy", formatPercent(Number(aggregate.accuracy) || 0), "default")}
              </div>
              <div class="split-layout">
                <section class="panel">
                  <div class="panel__header">
                    <h3>Class accuracy by category</h3>
                    <p>Bars show success rate; labels show correct answers over total attempts.</p>
                  </div>
                  ${renderStatBars(aggregate.categoryStats, 8)}
                </section>
                <section class="panel">
                  <div class="panel__header">
                    <h3>Practice volume by mode</h3>
                    <p>See where students are spending their review time.</p>
                  </div>
                  ${renderStatBars(aggregate.modeStats, 6)}
                </section>
              </div>
              <section class="panel">
                <div class="panel__header">
                  <h3>Student success rates</h3>
                  <p>Sorted by attempt volume so active users are easy to find.</p>
                </div>
                <div class="instructor-roster">
                  ${users
                    .sort((first, second) => second.summary.attempts - first.summary.attempts)
                    .map(
                      (user) => `
                        <article class="instructor-roster-row">
                          <div>
                            <strong>${escapeHtml(user.displayName)}</strong>
                            <span>${escapeHtml(user.username)} • ${user.summary.attempts} attempts</span>
                          </div>
                          <div class="stat-bar__track">
                            <span style="width: ${clamp(Number(user.summary.accuracy) || 0, 0, 100)}%"></span>
                          </div>
                          <strong>${formatPercent(Number(user.summary.accuracy) || 0)}</strong>
                        </article>
                      `,
                    )
                    .join("")}
                </div>
              </section>
              <section class="panel">
                <div class="panel__header">
                  <h3>Recent class answer history</h3>
                  <p>Latest answers submitted by signed-in users.</p>
                </div>
                <div class="history-list">
                  ${
                    aggregate.recentAttempts.length
                      ? aggregate.recentAttempts
                          .slice(0, 20)
                          .map(
                            (attempt) => `
                              <article class="history-row ${attempt.correct ? "is-correct" : "is-wrong"}">
                                <div>
                                  <strong>${escapeHtml(attempt.displayName)} • ${formatScientificText(attempt.question || attempt.questionId)}</strong>
                                  <span>${escapeHtml(attempt.mode)} • ${escapeHtml(attempt.category)} • ${attempt.timestamp ? new Date(attempt.timestamp).toLocaleDateString() : "No date"}</span>
                                </div>
                                <strong>${attempt.correct ? "Correct" : "Missed"}</strong>
                              </article>
                            `,
                          )
                          .join("")
                      : `<div class="empty-state"><strong>No class attempts yet.</strong><p>Student answers will appear here once they practice while signed in.</p></div>`
                  }
                </div>
              </section>
            `
      }
    </section>
  `;
}

function renderAccountView() {
  const summary = computePerformanceSummary();
  const recentAttempts = [...state.performance].slice(-12).reverse();
  const modeMap = groupAttempts(state.performance, "mode");
  const modeEntries = Object.entries(modeMap).sort((first, second) => second[1].attempts - first[1].attempts);
  const feedbackClass = `import-feedback import-feedback--${state.account.tone}`;

  if (!state.account.auth) {
    return `
      <section class="view">
        ${renderSectionIntro(
          "Account",
          "Sign in to save your review history",
          "Each tester can use an assigned username and password so quiz, mock exam, and practice history follows them across devices.",
        )}
        <div class="split-layout">
          <section class="panel panel--form">
            <div class="panel__header">
              <h3>Tester sign in</h3>
              <p>Use one of the assigned roster accounts. Credentials are managed in the server roster file and are not stored in the browser.</p>
            </div>
            <div class="form-grid form-grid--two">
              <label class="field">
                <span>Username</span>
                <input id="account-username" type="text" autocomplete="username" placeholder="username" value="${escapeHtml(state.account.username)}" />
              </label>
              <label class="field">
                <span>Password</span>
                <input id="account-password" type="password" autocomplete="current-password" placeholder="Password" value="${escapeHtml(state.account.password)}" />
              </label>
            </div>
            <div class="${feedbackClass}">
              <strong>${escapeHtml(state.account.message)}</strong>
            </div>
            <div class="question-card__actions">
              <button type="button" class="button button--primary" data-action="account-login" ${state.account.busy ? "disabled" : ""}>Sign in</button>
            </div>
          </section>
          <section class="panel">
            <div class="panel__header">
              <h3>What gets saved</h3>
              <p>Attempts are still saved locally for speed, and signed-in users also sync them to the server account file.</p>
            </div>
            <div class="insight-stack">
              <article class="insight-card">
                <span class="insight-card__label">Saved modes</span>
                <strong>Quiz, mock exam, solo Jeopardy, and live Jeopardy review attempts.</strong>
              </article>
              <article class="insight-card">
                <span class="insight-card__label">Adaptive study</span>
                <strong>Solo practice uses the signed-in user's own saved history.</strong>
              </article>
              <article class="insight-card">
                <span class="insight-card__label">Roster size</span>
                <strong>The helper script creates 50 testing accounts by default.</strong>
              </article>
            </div>
          </section>
        </div>
      </section>
    `;
  }

  return `
    <section class="view">
      ${renderSectionIntro(
        "Account",
        `Signed in as ${state.account.auth.displayName}`,
        "Review your saved practice history and continue building your personal adaptive profile.",
      )}
      <div class="card-grid card-grid--metrics">
        ${renderMetric("Saved Attempts", `${state.performance.length}`, "gold")}
        ${renderMetric("Accuracy", formatPercent(summary.accuracy), "blue")}
        ${renderMetric("Coverage", formatPercent(summary.coverage), "default")}
        ${renderMetric("Weakest Topic", summary.weakestTopic || "Not enough data yet", "default")}
      </div>
      <div class="split-layout">
        <section class="panel">
          <div class="panel__header">
            <h3>Performance by mode</h3>
            <p>Use this to see where your saved review work is coming from.</p>
          </div>
          <div class="insight-stack">
            ${
              modeEntries.length
                ? modeEntries
                    .map(
                      ([mode, stats]) => `
                        <article class="insight-card">
                          <span class="insight-card__label">${escapeHtml(mode)}</span>
                          <strong>${stats.correct}/${stats.attempts} correct • ${formatPercent(stats.accuracy)}</strong>
                        </article>
                      `,
                    )
                    .join("")
                : `<article class="insight-card"><strong>No saved attempts yet.</strong></article>`
            }
          </div>
        </section>
        <section class="panel">
          <div class="panel__header">
            <h3>Recent attempts</h3>
            <p>Your latest saved answers across quiz, mock exam, and practice modes.</p>
          </div>
          <div class="history-list">
            ${
              recentAttempts.length
                ? recentAttempts
                    .map((attempt) => {
                      const question = getAllQuestions().find((item) => item.id === attempt.questionId);
                      return `
                        <article class="history-row ${attempt.correct ? "is-correct" : "is-wrong"}">
                          <div>
                            <strong>${formatScientificText(question ? question.question : attempt.questionId)}</strong>
                            <span>${escapeHtml(attempt.mode)} • ${escapeHtml(attempt.category)} • ${new Date(attempt.timestamp).toLocaleDateString()}</span>
                          </div>
                          <strong>${attempt.correct ? "Correct" : "Missed"}</strong>
                        </article>
                      `;
                    })
                    .join("")
                : `<div class="empty-state"><strong>No account attempts yet.</strong><p>Start a quiz or mock exam after signing in.</p></div>`
            }
          </div>
          <div class="question-card__actions">
            <button type="button" class="button button--ghost" data-action="account-logout">Sign out</button>
          </div>
        </section>
      </div>
    </section>
  `;
}

function renderTopbarLogin() {
  if (hasAccountSession()) {
    return `
      <section class="top-login top-login--signed-in">
        <button type="button" class="top-login__user-link" data-view="profile">
          <strong>${escapeHtml(state.account.auth.displayName || state.account.auth.username)}</strong>
        </button>
        <button type="button" class="button button--tiny button--ghost" data-action="account-logout">Sign out</button>
      </section>
    `;
  }

  return `
    <form class="top-login" data-form-action="account-login">
      <label>
        <span>Username</span>
        <input id="top-account-username" type="text" autocomplete="username" placeholder="login" value="${escapeHtml(state.account.username)}" />
      </label>
      <label>
        <span>Password</span>
        <input id="top-account-password" type="password" autocomplete="current-password" placeholder="password" value="${escapeHtml(state.account.password)}" />
      </label>
      <button type="button" class="button button--tiny button--primary" data-action="account-login" ${state.account.busy ? "disabled" : ""}>Login</button>
      ${
        state.account.tone === "error"
          ? `<strong class="top-login__message">${escapeHtml(state.account.message)}</strong>`
          : ""
      }
    </form>
  `;
}

function renderAccountCorner() {
  if (!hasAccountSession()) {
    return "";
  }

  return `
    <aside class="account-corner" aria-label="Signed-in account controls">
      <button type="button" class="account-corner__user" data-view="profile">
        ${escapeHtml(state.account.auth.displayName || state.account.auth.username)}
      </button>
      <button type="button" class="button button--tiny button--ghost" data-action="account-logout">Sign out</button>
    </aside>
  `;
}

function getPrimaryNavItems() {
  return [
    ["dashboard", "Dashboard"],
    ["profile", "Profile"],
    ...(isInstructor() ? [["instructor", "Instructor View"]] : []),
    ["bank", "Question Bank"],
    ["quiz", "Quiz"],
    ["mock", "Mock Exam"],
    ["jeopardy", "Jeopardy"],
  ];
}

function getHeroCopy(view) {
  const copyByView = {
    dashboard: {
      title: "Dashboard",
      subtitle: "Your home base for Nuclear Medicine board review.",
      body:
        "Use the dashboard to check readiness, review category progress, and decide where to study next based on your personal practice history.",
      highlights: [
        ["Progress snapshot", "See readiness, accuracy, and question-bank size at a glance"],
        ["Category overview", "Find stronger and weaker board-review domains quickly"],
        ["Next best step", "Move into quiz, mock exam, or Jeopardy practice with context"],
      ],
    },
    profile: {
      title: "Profile",
      subtitle: "Review your saved performance and live-game history.",
      body:
        "The profile page brings your quiz, mock exam, solo Jeopardy, and online Jeopardy results together so you can track patterns over time.",
      highlights: [
        ["Personal stats", "See accuracy by mode, category, and recent attempts"],
        ["Saved history", "Signed-in practice follows your account across devices"],
        ["Placements", "Track online Jeopardy finishes and top scores"],
      ],
    },
    instructor: {
      title: "Instructor View",
      subtitle: "Monitor class performance and individual student progress.",
      body:
        "Instructor View summarizes roster-wide success rates, weak content areas, and individual answer histories for signed-in users.",
      highlights: [
        ["Class trends", "Compare performance across board-style categories"],
        ["Student drilldown", "Select a learner to review individual history"],
        ["Teaching signals", "Use misses to guide review sessions and remediation"],
      ],
    },
    bank: {
      title: "Question Bank",
      subtitle: "Browse, filter, and maintain the shared review question set.",
      body:
        "The question bank lets you inspect exam questions by exam number, question number, source, and category. Instructor accounts can edit and save question text.",
      highlights: [
        ["Full review bank", "Search stems, options, explanations, topics, and sources"],
        ["Exam filters", "Jump by exam number or specific question number"],
        ["Instructor editing", "Correct question text and answer details from the bank"],
      ],
    },
    quiz: {
      title: "Quiz",
      subtitle: "Fast untimed active recall in small question sets.",
      body:
        "Quiz mode is best for focused practice. Choose a category and a short untimed set, answer one question at a time, and use explanations immediately.",
      highlights: [
        ["Untimed sets", "Choose 5, 10, 15, 20, or 25 questions"],
        ["Personal adaptive mode", "Solo question selection follows your own answer history"],
        ["Immediate feedback", "Difficulty and explanations appear after answering"],
      ],
    },
    mock: {
      title: "Mock Exam",
      subtitle: "Timed board-style exam rehearsal.",
      body:
        "Mock Exam mode creates a longer timed session for exam pacing, endurance, and post-test review across Nuclear Medicine registry categories.",
      highlights: [
        ["Timed formats", "Choose 60, 120, or 220 questions"],
        ["Exam pacing", "Practice with 1-hour, 2-hour, or 4-hour timing"],
        ["Review misses", "Study correct answers and explanations after submission"],
      ],
    },
    jeopardy: {
      title: "Jeopardy",
      subtitle: "Solo or online board-review recall game.",
      body:
        "Jeopardy turns board categories into an active recall game. Solo boards adapt to your personal history, while online boards use shared performance and live multiplayer turns.",
      highlights: [
        ["Solo practice", "Generate an adaptive board for independent review"],
        ["Online play", "Host or join with a code and compete from multiple devices"],
        ["Difficulty ladder", "Questions scale from easier lower-value clues to harder high-value clues"],
      ],
    },
  };

  return copyByView[view] || copyByView.dashboard;
}

function renderPrimaryNav() {
  return `
    <nav class="nav-tabs" aria-label="Primary">
      ${getPrimaryNavItems()
        .map(
          ([view, label]) => `
            <button type="button" class="nav-tab ${view === "instructor" ? "nav-tab--stacked" : ""} ${state.activeView === view ? "is-active" : ""}" data-view="${view}">
              ${
                view === "instructor"
                  ? label
                      .split(" ")
                      .map((word) => `<span>${escapeHtml(word)}</span>`)
                      .join("")
                  : escapeHtml(label)
              }
            </button>
          `,
        )
        .join("")}
    </nav>
  `;
}

function renderAppChrome(summary) {
  const liveCode = state.live.auth ? state.live.auth.code : "No live game";
  return `
    <header class="topbar">
      <div class="brand">
        <div class="brand__copy">
          <span class="brand__eyebrow">Registry Review Workspace</span>
          <strong>Nuclear Medicine Boards Review</strong>
          <span>Solo prep, mock exams, active recall, and live multiplayer Jeopardy</span>
        </div>
      </div>
      <div class="topbar__right">
        ${renderAccountCorner()}
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
      </div>
    </header>
  `;
}

function renderPageHero() {
  const copy = getHeroCopy(state.activeView);
  return `
    <section class="headline headline--oregon-tech">
      <div class="headline__copy">
        <h1>${escapeHtml(copy.title)}</h1>
        <p><strong>${escapeHtml(copy.subtitle)}</strong> ${escapeHtml(copy.body)}</p>
        <div class="headline__highlights">
          ${copy.highlights
            .map(
              ([label, detail]) => `
                <article class="headline-highlight">
                  <span>${escapeHtml(label)}</span>
                  <strong>${escapeHtml(detail)}</strong>
                </article>
              `,
            )
            .join("")}
        </div>
      </div>
    </section>
  `;
}

function renderLoginGate() {
  const isCheckingSession = Boolean(state.account.verifying);
  const message = isCheckingSession ? "Checking saved sign-in..." : state.account.message;
  const messageTone = state.account.tone === "error" ? "error" : "info";

  return `
    <main class="login-gate">
      <section class="login-card">
        <div class="login-card__header">
          <h1>Nuclear Medicine Boards Review</h1>
          <p>${isCheckingSession ? "Verifying your saved login before opening the review workspace." : "Sign in to access quizzes, mock exams, the question bank, profile stats, and live Jeopardy review."}</p>
        </div>
        <form class="login-card__form" data-form-action="account-login">
          <label class="field">
            <span>Username</span>
            <input id="account-username" type="text" autocomplete="username" placeholder="username" value="${escapeHtml(state.account.username)}" ${isCheckingSession ? "disabled" : "autofocus"} />
          </label>
          <label class="field">
            <span>Password</span>
            <input id="account-password" type="password" autocomplete="current-password" placeholder="password" value="${escapeHtml(state.account.password)}" ${isCheckingSession ? "disabled" : ""} />
          </label>
          <button type="submit" class="button button--primary" ${state.account.busy || isCheckingSession ? "disabled" : ""}>
            ${isCheckingSession ? "Checking..." : state.account.busy ? "Signing in..." : "Login"}
          </button>
        </form>
        ${
          message
            ? `<div class="import-feedback import-feedback--${messageTone}">
                <strong>${escapeHtml(message)}</strong>
              </div>`
            : ""
        }
      </section>
    </main>
  `;
}

function renderDashboard(summary) {
  const categories = getCategories();
  const weakAreas = [...summary.weakTopics].slice(0, 3);
  const hasQuestions = hasStudyQuestions();

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
      ${
        hasQuestions
          ? ""
          : renderQuestionBankEmptyState(
              "Import your exam bank to begin",
              "This build is now import-first, so solo study modes stay empty until you load your own questions.",
              "When your real 800-question set is ready, it can fully replace the placeholder bank. For now, imported questions are the only solo study source.",
            )
      }
      <div class="split-layout">
        <section class="panel">
          <div class="panel__header">
            <h3>ARRT / NM Board-style categories</h3>
            <p>${
              hasQuestions
                ? "Organized for quick topic selection, targeted drilling, and full-board review."
                : "Your imported bank will appear here once questions are loaded."
            }</p>
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

  if (!hasStudyQuestions()) {
    return `
      <section class="view">
        ${renderSectionIntro(
          "Quiz Builder",
          "Target a domain and get immediate feedback",
          "Quiz mode is ready, but this build no longer includes placeholder questions.",
        )}
        ${renderQuestionBankEmptyState(
          "Import questions before starting a quiz",
          "Once you import your real bank, quiz mode will adapt to your own history only.",
          "Your solo quiz attempts still sync to the shared server, but no other user's accuracy will change your personal quiz selection.",
        )}
      </section>
    `;
  }

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
                ${[5, 10, 15, 20, 25]
                  .map(
                    (count) =>
                      `<option value="${count}" ${state.quizConfig.count === count ? "selected" : ""}>${count}</option>`,
                  )
                  .join("")}
              </select>
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
        `${question.topic}`,
      )}
      <div class="progress-row">
        <span>Question ${session.index + 1} of ${session.questions.length}</span>
        <span>Adaptive weighting active</span>
      </div>
      <article class="question-card question-card--practice ${session.submitted ? "question-card--answered" : ""}">
        <div class="question-card__meta">
          <span class="pill">${escapeHtml(question.type)}</span>
          <span class="pill">${escapeHtml(question.topic)}</span>
        </div>
        <h3>${formatScientificText(question.question)}</h3>
        ${renderQuestionMedia(question)}
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
                  <strong>${formatScientificText(option)}</strong>
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
                ${renderExplanationContent(question)}
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

  if (!hasStudyQuestions()) {
    return `
      <section class="view">
        ${renderSectionIntro(
          "Mock Exam",
          "Timed full-board rehearsal",
          "Mock exams will unlock as soon as you import your exam bank.",
        )}
        ${renderQuestionBankEmptyState(
          "Import questions before running a mock exam",
          "This build is set up so the final product can use only your imported exam content instead of placeholder questions.",
          "When your real bank is loaded, mock exams will still post attempts to the shared server while adapting only to your own history.",
        )}
      </section>
    `;
  }

  if (!session) {
    const selectedFormat =
      MOCK_EXAM_OPTIONS.find((option) => option.count === state.mockConfig.count) || MOCK_EXAM_OPTIONS[0];
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
              <span>Exam format</span>
              <select id="mock-format">
                ${MOCK_EXAM_OPTIONS
                  .map(
                    (option) =>
                      `<option value="${option.count}" ${selectedFormat.count === option.count ? "selected" : ""}>${escapeHtml(option.label)}</option>`,
                  )
                  .join("")}
              </select>
            </label>
          </div>
          <div class="panel__footer">
            <p>Choose a fixed board-style exam length. The timer is automatically matched to the selected format.</p>
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
                  <h4>${formatScientificText(question.question)}</h4>
                  <p><strong>Your answer:</strong> ${
                    selectedIndex !== undefined
                      ? formatScientificText(question.options[selectedIndex] || "No answer")
                      : "No answer"
                  }</p>
                  <p><strong>Correct answer:</strong> ${formatScientificText(question.options[question.answerIndex])}</p>
                  ${renderExplanationContent(question)}
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
        `${currentQuestion.topic}`,
      )}
      <div class="progress-row">
        <span>Question ${session.currentIndex + 1} of ${session.questions.length}</span>
        <span class="timer">Time remaining ${minutes}:${seconds}</span>
      </div>
      <article class="question-card question-card--practice">
        <h3>${formatScientificText(currentQuestion.question)}</h3>
        ${renderQuestionMedia(currentQuestion)}
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
                  <strong>${formatScientificText(option)}</strong>
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
  if (!hasStudyQuestions()) {
    return `
      <section class="view">
        ${renderSectionIntro(
          "Solo Jeopardy",
          "Adaptive practice board with escalating difficulty",
          "Solo Jeopardy is waiting for your imported content.",
        )}
        ${renderQuestionBankEmptyState(
          "Import questions before generating a solo board",
          "The seeded sample clues are gone, so solo Jeopardy now depends entirely on your imported study bank.",
          "Once your exam content is loaded, the board will place easier questions near $100 and harder questions near $500 based on your own personal performance history.",
        )}
      </section>
    `;
  }

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
      <article class="modal modal--question">
        <div class="modal__header">
          <div>
            <span class="pill">$${tile.value}</span>
            <span class="pill">${escapeHtml(question.topic)}</span>
          </div>
          <button type="button" class="icon-button" data-action="close-jeopardy">&times;</button>
        </div>
        <h3>${formatScientificText(question.question)}</h3>
        ${renderQuestionMedia(question)}
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
                  <strong>${formatScientificText(option)}</strong>
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
                ${renderExplanationContent(question)}
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
  const categoryChoices = getImportCategoryChoices();
  const importedCategoryCount = new Set(state.importedQuestions.map((question) => question.category)).size;
  const preview = state.importPreview;

  return `
    <section class="view">
      ${renderSectionIntro(
        "Import Your Bank",
        "Bring in your own board-review content",
        "Import structured question banks, Quizlet-style flashcards, or plain text blocks. Preview the import before saving anything locally.",
      )}
      <div class="split-layout">
        <section class="panel">
          <div class="panel__header">
            <h3>Import setup</h3>
            <p>Choose how categories should be handled, then paste text or load a file. The parser will try to detect the format automatically.</p>
          </div>
          <div class="form-grid form-grid--two">
            <label class="field">
              <span>Import format</span>
              <select id="import-format-hint">
                <option value="auto" ${state.importConfig.formatHint === "auto" ? "selected" : ""}>Auto-detect</option>
                <option value="structured" ${state.importConfig.formatHint === "structured" ? "selected" : ""}>Structured JSON / CSV / TSV</option>
                <option value="flashcards" ${state.importConfig.formatHint === "flashcards" ? "selected" : ""}>Flashcards / Quizlet-style</option>
                <option value="plain" ${state.importConfig.formatHint === "plain" ? "selected" : ""}>Plain text Q&A blocks</option>
              </select>
            </label>
            <label class="field">
              <span>Category handling</span>
              <select id="import-category-mode">
                <option value="auto" ${state.importConfig.categoryMode === "auto" ? "selected" : ""}>Auto detect category</option>
                <option value="assign" ${state.importConfig.categoryMode === "assign" ? "selected" : ""}>Import into existing category</option>
                <option value="create" ${state.importConfig.categoryMode === "create" ? "selected" : ""}>Create new category</option>
              </select>
            </label>
          </div>
          ${
            state.importConfig.categoryMode === "assign"
              ? `
                <div class="form-grid">
                  <label class="field">
                    <span>Existing category</span>
                    <select id="import-category">
                      <option value="">Choose category</option>
                      ${categoryChoices
                        .map(
                          (category) =>
                            `<option value="${escapeHtml(category)}" ${state.importConfig.category === category ? "selected" : ""}>${escapeHtml(category)}</option>`,
                        )
                        .join("")}
                    </select>
                  </label>
                </div>
              `
              : ""
          }
          ${
            state.importConfig.categoryMode === "create"
              ? `
                <div class="form-grid">
                  <label class="field">
                    <span>New category name</span>
                    <input id="import-custom-category" type="text" maxlength="48" placeholder="Enter custom category" value="${escapeHtml(state.importConfig.customCategory)}" />
                  </label>
                </div>
              `
              : ""
          }
          <textarea id="import-text" class="import-textarea" placeholder='Paste JSON, CSV, TSV, Quizlet-style term/definition rows, or plain text question blocks here'>${escapeHtml(state.importDraft)}</textarea>
          <div class="${feedbackClass}">
            <strong>${escapeHtml(state.importFeedback.message)}</strong>
          </div>
          ${
            preview
              ? `
                <div class="import-preview">
                  <div class="panel__header">
                    <h3>Preview</h3>
                    <p>${preview.items.length} ${preview.kind === "flashcards" ? "flashcard" : "question"}${preview.items.length === 1 ? "" : "s"} ready to import.</p>
                  </div>
                  <div class="insight-stack">
                    <article class="insight-card">
                      <span class="insight-card__label">Import type</span>
                      <strong>${preview.kind === "flashcards" ? "Flashcards" : "Questions"}</strong>
                    </article>
                    <article class="insight-card">
                      <span class="insight-card__label">Categories found</span>
                      <strong>${escapeHtml(preview.categories.join(", ") || "Uncategorized")}</strong>
                    </article>
                    <article class="insight-card">
                      <span class="insight-card__label">Sample</span>
                      <strong>${
                        preview.kind === "flashcards"
                          ? escapeHtml(preview.items[0].front)
                          : escapeHtml(preview.items[0].question)
                      }</strong>
                    </article>
                  </div>
                </div>
              `
              : ""
          }
          <div class="question-card__actions">
            <label class="button button--ghost file-button">
              Load file
              <input id="import-file" type="file" accept=".json,.csv,.tsv,.txt,text/plain,text/csv,application/json" />
            </label>
            <button type="button" class="button button--ghost" data-action="load-import-template">Load sample template</button>
            <button type="button" class="button button--ghost" data-action="load-flashcard-template">Load flashcard example</button>
            <button type="button" class="button button--ghost" data-action="preview-import">Preview import</button>
            <button type="button" class="button button--primary" data-action="run-import">${preview ? "Confirm import" : "Import content"}</button>
          </div>
        </section>
        <section class="panel">
          <div class="panel__header">
            <h3>Import guide</h3>
            <p>Solo study now uses imported questions only. Online multiplayer still needs a shared server-side live bank so every player sees the same board.</p>
          </div>
          <div class="insight-stack">
            <article class="insight-card">
              <span class="insight-card__label">Imported questions</span>
              <strong>${state.importedQuestions.length}</strong>
            </article>
            <article class="insight-card">
              <span class="insight-card__label">Imported categories</span>
              <strong>${importedCategoryCount}</strong>
            </article>
            <article class="insight-card">
              <span class="insight-card__label">Imported flashcards</span>
              <strong>${state.importedFlashcards.length}</strong>
            </article>
            <article class="insight-card">
              <span class="insight-card__label">Structured files</span>
              <strong>JSON arrays, CSV, or TSV with fields like category, topic, question, options, answerIndex, explanation</strong>
            </article>
            <article class="insight-card">
              <span class="insight-card__label">Study bank status</span>
              <strong>${hasStudyQuestions() ? "Questions are loaded for solo study." : "No seeded bank is included. Import your own questions to unlock solo study modes."}</strong>
            </article>
            <article class="insight-card">
              <span class="insight-card__label">Flashcard imports</span>
              <strong>Quizlet-style term and definition rows stay as flashcards and appear in the Flashcards section</strong>
            </article>
            <article class="insight-card">
              <span class="insight-card__label">Plain text blocks</span>
              <strong>Paste Question / A / B / C / D / Answer / Explanation blocks and the importer will try to map them</strong>
            </article>
          </div>
          <div class="question-card__actions">
            <button type="button" class="button button--ghost" data-action="clear-imported">Clear imported bank</button>
            <button type="button" class="button button--ghost" data-action="clear-flashcards">Clear flashcards</button>
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
        <article class="modal live-modal modal--question">
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
            <h3>${formatScientificText(active.question)}</h3>
            ${renderQuestionMedia(active)}
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
                      <strong>${formatScientificText(option)}</strong>
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
        <article class="modal live-modal modal--question">
          <div class="modal__header">
            <div>
              <span class="pill">$${active.value}</span>
              <span class="pill">${escapeHtml(active.topic)}</span>
            </div>
            <div class="pill">Reveal</div>
          </div>
          <div class="feedback feedback--${viewerResult.correct ? "correct" : "wrong"}">
            <strong>Correct answer: ${formatScientificText(active.options[active.correctAnswerIndex])}</strong>
            ${renderExplanationContent(active)}
          </div>
          ${renderQuestionMedia(active)}
          <div class="player-results">
            <article class="player-result ${viewerResult.correct ? "is-correct" : "is-wrong"}">
              <strong>Your answer</strong>
              <span>${formatScientificText(selectedAnswer)}</span>
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

  if (!hasSharedLiveBank()) {
    return `
      <section class="view">
        ${renderSectionIntro(
          "Live Jeopardy",
          "Host or join with a code",
          "Online play is reserved for the shared server bank, so it stays off until your real exam set is loaded on the backend.",
        )}
        <div class="split-layout">
          <section class="panel">
            <div class="panel__header">
              <h3>Shared live bank not loaded yet</h3>
              <p>The placeholder questions were removed. Solo study can use imported questions in this browser, but online multiplayer needs the real shared exam bank on the server.</p>
            </div>
            <div class="empty-state">
              <strong>Live Jeopardy will come back once the shared exam bank is loaded.</strong>
              <p>When you are ready with the full set, we can wire the same real questions into the backend so every device sees the same board.</p>
            </div>
            <div class="question-card__actions">
              <button type="button" class="button button--primary" data-view="import">Open Import Bank</button>
            </div>
          </section>
          <section class="panel">
            <div class="panel__header">
              <h3>Current behavior</h3>
              <p>Solo modes are import-first now, and they keep using only your own personal performance history.</p>
            </div>
            <div class="insight-stack">
              <article class="insight-card">
                <span class="insight-card__label">Solo study</span>
                <strong>Uses imported local questions and your own answer history.</strong>
              </article>
              <article class="insight-card">
                <span class="insight-card__label">Shared stats</span>
                <strong>Solo attempts can still post to the shared server without affecting your personal solo adaptation.</strong>
              </article>
              <article class="insight-card">
                <span class="insight-card__label">Live play</span>
                <strong>Requires the final shared exam bank to be loaded on the backend.</strong>
              </article>
            </div>
          </section>
        </div>
      </section>
    `;
  }

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
            <h3>${state.account.auth ? "Signed-in player name" : "Enter your player name"}</h3>
            <p>${
              state.account.auth
                ? `Online Jeopardy will show your first name, ${escapeHtml(getSignedInLiveName())}. If another player has the same first name, the live room will add a number automatically.`
                : "Use the same name for hosting or joining. This is what everyone will see on the scoreboard."
            }</p>
          </div>
          <div class="form-grid form-grid--two">
            <label class="field">
              <span>${state.account.auth ? "Live display name" : "Username"}</span>
              <input id="live-username" type="text" maxlength="20" placeholder="Enter your name" value="${escapeHtml(getPreferredLiveUsername())}" ${state.account.auth ? "disabled" : ""} />
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
  if (!hasSharedLiveBank()) {
    return renderLiveEntry();
  }

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

  if (!hasAccountSession() || state.account.verifying) {
    app.innerHTML = `
      <div class="shell shell--login">
        ${renderLoginGate()}
      </div>
    `;
    return;
  }

  const viewMap = {
    dashboard: renderDashboard(summary),
    profile: renderProfileView(summary),
    instructor: renderInstructorView(),
    bank: renderQuestionBankView(),
    quiz: renderQuizView(summary),
    mock: renderMockView(),
    jeopardy: renderJeopardyView(summary),
    flashcards: renderFlashcardsView(),
    live: renderLiveView(),
    import: renderImportView(),
  };

  app.innerHTML = `
    <div class="shell">
      ${renderAppChrome(summary)}
      ${renderPrimaryNav()}
      ${renderPageHero()}
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
    if (view === "instructor" && isInstructor() && !state.instructor.data && !state.instructor.loading) {
      loadInstructorStats();
      return;
    }
    renderApp();
    return;
  }

  const action = button.dataset.action;

  if (action === "account-login") {
    loginAccount();
    return;
  }

  if (action === "account-logout") {
    logoutAccount();
    return;
  }

  if (action === "refresh-instructor-stats") {
    loadInstructorStats();
    return;
  }

  if (action === "set-jeopardy-mode") {
    setJeopardyMode(button.dataset.mode);
    state.activeView = "jeopardy";
  }

  if (action === "set-live-page") {
    state.live.page = button.dataset.page === "leaderboard" ? "leaderboard" : "board";
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
    scrollPracticeQuestionIntoView();
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
    scrollPracticeQuestionIntoView();
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
    clearImportPreview();
    state.importFeedback = {
      tone: "info",
      message: "Sample JSON template loaded into the editor.",
    };
  }

  if (action === "load-flashcard-template") {
    state.importDraft = FLASHCARD_IMPORT_TEMPLATE;
    state.importConfig.formatHint = "flashcards";
    clearImportPreview();
    state.importFeedback = {
      tone: "info",
      message: "Flashcard example loaded. This works well for Quizlet-style term and definition exports or copied sets.",
    };
  }

  if (action === "preview-import") {
    previewImport();
  }

  if (action === "run-import") {
    importQuestions();
  }

  if (action === "clear-imported") {
    clearImportedQuestions();
  }

  if (action === "save-question-bank-edits") {
    saveQuestionBankEdits();
  }

  if (action === "clear-flashcards") {
    clearImportedFlashcards();
  }

  if (action === "toggle-flashcard-shuffle") {
    state.flashcards.shuffled = !state.flashcards.shuffled;
    buildFlashcardDeck();
  }

  if (action === "flip-flashcard" && state.flashcards.deck.length) {
    state.flashcards.showingBack = !state.flashcards.showingBack;
  }

  if (action === "flashcard-prev" && state.flashcards.currentIndex > 0) {
    state.flashcards.currentIndex -= 1;
    state.flashcards.showingBack = false;
  }

  if (action === "flashcard-next" && state.flashcards.currentIndex < state.flashcards.deck.length - 1) {
    state.flashcards.currentIndex += 1;
    state.flashcards.showingBack = false;
  }

  renderApp();
});

app.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-form-action='account-login']");
  if (!form) {
    return;
  }

  event.preventDefault();
  loginAccount();
});

app.addEventListener("keydown", (event) => {
  if (
    event.key === "Enter" &&
    event.target.matches("#account-username, #account-password, #top-account-username, #top-account-password")
  ) {
    event.preventDefault();
    loginAccount();
  }
});

app.addEventListener("input", (event) => {
  const target = event.target;

  if (target.dataset.bankEditField) {
    updateQuestionBankDraft(target);
  }

  if (target.id === "import-text") {
    state.importDraft = target.value;
    clearImportPreview();
  }

  if (target.id === "question-bank-search") {
    state.questionBank.search = target.value;
  }

  if (target.id === "account-username" || target.id === "top-account-username") {
    state.account.username = target.value;
  }

  if (target.id === "account-password" || target.id === "top-account-password") {
    state.account.password = target.value;
  }

  if (target.id === "import-custom-category") {
    state.importConfig.customCategory = target.value;
    clearImportPreview();
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

  if (target.dataset.bankEditField) {
    updateQuestionBankDraft(target);
  }

  if (target.id === "quiz-category") {
    state.quizConfig.category = target.value;
  }

  if (target.id === "quiz-count") {
    state.quizConfig.count = Number(target.value);
  }

  if (target.id === "question-bank-category") {
    state.questionBank.category = target.value || "all";
  }

  if (target.id === "question-bank-exam") {
    state.questionBank.exam = target.value || "all";
    state.questionBank.question = "all";
  }

  if (target.id === "question-bank-question") {
    state.questionBank.question = target.value || "all";
  }

  if (target.id === "question-bank-source") {
    state.questionBank.source = ["all", "shared", "imported"].includes(target.value) ? target.value : "all";
  }

  if (target.id === "instructor-user-select") {
    state.instructor.selectedUser = target.value || "all";
  }

  if (target.id === "mock-format") {
    const selectedFormat =
      MOCK_EXAM_OPTIONS.find((option) => option.count === Number(target.value)) || MOCK_EXAM_OPTIONS[0];
    state.mockConfig.count = selectedFormat.count;
    state.mockConfig.durationMinutes = selectedFormat.durationMinutes;
  }

  if (target.id === "import-file" && target.files && target.files[0]) {
    const reader = new FileReader();
    reader.onload = () => {
      state.importDraft = String(reader.result || "");
      clearImportPreview();
      state.importFeedback = {
        tone: "info",
        message: `Loaded ${target.files[0].name}. Review the content, choose category handling if needed, then click Import questions.`,
      };
      renderApp();
    };
    reader.readAsText(target.files[0]);
    return;
  }

  if (target.id === "import-category-mode") {
    state.importConfig.categoryMode = ["auto", "assign", "create"].includes(target.value) ? target.value : "auto";
    if (state.importConfig.categoryMode !== "assign") {
      state.importConfig.category = "";
    }
    if (state.importConfig.categoryMode !== "create") {
      state.importConfig.customCategory = "";
    }
    clearImportPreview();
  }

  if (target.id === "import-category") {
    state.importConfig.category = target.value;
    clearImportPreview();
  }

  if (target.id === "import-format-hint") {
    state.importConfig.formatHint = target.value || "auto";
    clearImportPreview();
  }

  if (target.id === "flashcard-category") {
    state.flashcards.category = target.value || "all";
    state.flashcards.currentIndex = 0;
    buildFlashcardDeck();
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
restoreAccountSession();

if (state.live.auth && hasSharedLiveBank()) {
  connectLiveSocket();
}
