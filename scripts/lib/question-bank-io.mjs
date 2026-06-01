import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { QUESTION_BANK } from "../../data.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const projectRoot = path.resolve(__dirname, "../..");
export const sharedQuestionBankPath = path.join(projectRoot, ".question_bank.json");

export const EDITABLE_HEADERS = [
  "id",
  "examNumber",
  "questionNumber",
  "category",
  "topic",
  "type",
  "difficulty",
  "question",
  "optionA",
  "optionB",
  "optionC",
  "optionD",
  "optionE",
  "answerIndex",
  "correctAnswer",
  "explanation",
  "source",
  "sourcePhoto",
  "answerPhoto",
  "image",
  "imageAlt",
  "imageCaption",
];

export function cloneQuestionBank(questionBank) {
  return questionBank.map((question) => JSON.parse(JSON.stringify(question)));
}

export function getSeededQuestionBank() {
  return cloneQuestionBank(QUESTION_BANK);
}

export function loadLocalSharedQuestionBank() {
  if (!fs.existsSync(sharedQuestionBankPath)) {
    return null;
  }
  const raw = JSON.parse(fs.readFileSync(sharedQuestionBankPath, "utf8"));
  if (!raw || !Array.isArray(raw.questions)) {
    return null;
  }
  return cloneQuestionBank(raw.questions);
}

function normalizeBaseUrl(value) {
  if (!value) {
    return "";
  }
  return String(value).replace(/\/+$/, "");
}

export async function fetchRemoteQuestionBank(baseUrl) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    throw new Error("Missing remote question bank base URL.");
  }

  const response = await fetch(`${normalizedBaseUrl}/api/question-bank`);
  if (!response.ok) {
    throw new Error(`Remote question bank request failed with status ${response.status}.`);
  }
  const body = await response.json();
  if (!Array.isArray(body.questionBank)) {
    throw new Error("Remote question bank response did not include questionBank.");
  }
  return cloneQuestionBank(body.questionBank);
}

export async function loadCanonicalQuestionBank(options = {}) {
  const source = options.source || "auto";
  const remoteUrl = options.remoteUrl || process.env.QUESTION_BANK_SOURCE_URL || "";
  const seeded = getSeededQuestionBank();
  const localShared = loadLocalSharedQuestionBank();

  if (source === "seeded") {
    return {
      bank: seeded,
      source: "seeded",
      seededDiffCount: 0,
      localSharedDiffCount: localShared ? countTrackedFieldDiffs(seeded, localShared) : null,
    };
  }

  if (source === "shared-local") {
    if (!localShared) {
      throw new Error(`Local shared question bank not found at ${sharedQuestionBankPath}.`);
    }
    return {
      bank: localShared,
      source: "shared-local",
      seededDiffCount: countTrackedFieldDiffs(localShared, seeded),
      localSharedDiffCount: 0,
    };
  }

  if (source === "remote") {
    const remote = await fetchRemoteQuestionBank(remoteUrl);
    return {
      bank: remote,
      source: "remote",
      seededDiffCount: countTrackedFieldDiffs(remote, seeded),
      localSharedDiffCount: localShared ? countTrackedFieldDiffs(remote, localShared) : null,
      remoteUrl: normalizeBaseUrl(remoteUrl),
    };
  }

  if (source !== "auto") {
    throw new Error(`Unsupported source: ${source}`);
  }

  if (remoteUrl) {
    const remote = await fetchRemoteQuestionBank(remoteUrl);
    return {
      bank: remote,
      source: "remote-auto",
      seededDiffCount: countTrackedFieldDiffs(remote, seeded),
      localSharedDiffCount: localShared ? countTrackedFieldDiffs(remote, localShared) : null,
      remoteUrl: normalizeBaseUrl(remoteUrl),
    };
  }

  if (localShared) {
    return {
      bank: localShared,
      source: "shared-local-auto",
      seededDiffCount: countTrackedFieldDiffs(localShared, seeded),
      localSharedDiffCount: 0,
    };
  }

  return {
    bank: seeded,
    source: "seeded-auto",
    seededDiffCount: 0,
    localSharedDiffCount: null,
  };
}

export function trackedFieldSnapshot(question) {
  const options = Array.isArray(question.options) ? [...question.options] : [];
  return {
    question: String(question.question || ""),
    options,
    explanation: String(question.explanation || ""),
    source: String(question.source || ""),
  };
}

export function countTrackedFieldDiffs(leftBank, rightBank) {
  const rightById = new Map(rightBank.map((question) => [question.id, trackedFieldSnapshot(question)]));
  let count = 0;
  for (const question of leftBank) {
    const left = trackedFieldSnapshot(question);
    const right = rightById.get(question.id);
    if (!right || JSON.stringify(left) !== JSON.stringify(right)) {
      count += 1;
    }
  }
  return count;
}

export function indexById(questionBank) {
  return new Map(questionBank.map((question) => [question.id, question]));
}

export function toEditableRecord(question) {
  const options = Array.isArray(question.options) ? question.options : [];
  const answerIndex = Number.isInteger(question.answerIndex) ? question.answerIndex : -1;
  return {
    id: question.id || "",
    examNumber: question.examNumber ?? "",
    questionNumber: question.questionNumber ?? "",
    category: question.category || "",
    topic: question.topic || "",
    type: question.type || "",
    difficulty: question.difficulty ?? "",
    question: question.question || "",
    optionA: options[0] || "",
    optionB: options[1] || "",
    optionC: options[2] || "",
    optionD: options[3] || "",
    optionE: options[4] || "",
    answerIndex,
    correctAnswer: answerIndex >= 0 && answerIndex < options.length ? options[answerIndex] : "",
    explanation: question.explanation || "",
    source: question.source || "",
    sourcePhoto: question.sourcePhoto || "",
    answerPhoto: question.answerPhoto || "",
    image: question.image || "",
    imageAlt: question.imageAlt || "",
    imageCaption: question.imageCaption || "",
  };
}

export function quoteTSV(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function writeEditableExports(questionBank, outputDir, metadata = {}) {
  fs.mkdirSync(outputDir, { recursive: true });
  const records = questionBank.map(toEditableRecord);
  const jsonPath = path.join(outputDir, "seeded-question-bank-editable.json");
  const tsvPath = path.join(outputDir, "seeded-question-bank-editable.tsv");
  const metadataPath = path.join(outputDir, "export-metadata.json");

  fs.writeFileSync(jsonPath, `${JSON.stringify(records, null, 2)}\n`);
  fs.writeFileSync(
    tsvPath,
    `${[
      EDITABLE_HEADERS.join("\t"),
      ...records.map((record) => EDITABLE_HEADERS.map((header) => quoteTSV(record[header])).join("\t")),
    ].join("\n")}\n`,
  );
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

  return { records, jsonPath, tsvPath, metadataPath };
}

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const nextValue = inlineValue !== undefined ? inlineValue : argv[index + 1];
    const value = inlineValue !== undefined || !String(argv[index + 1] || "").startsWith("--") ? nextValue : true;
    if (inlineValue === undefined && value !== true) {
      index += 1;
    }
    args[rawKey] = value;
  }
  return args;
}

export function ensureRelative(filePath) {
  return path.relative(projectRoot, filePath);
}
