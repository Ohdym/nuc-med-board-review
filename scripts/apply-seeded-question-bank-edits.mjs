import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { CATEGORY_CONFIG, IMPORT_TEMPLATE, QUESTION_BANK } from "../data.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const defaultInput = path.join(projectRoot, "editable-question-bank", "seeded-question-bank-editable.tsv");

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
      record[header] = values[index] ?? "";
    });
    return record;
  });
}

function loadEditableRecords(inputPath) {
  const extension = path.extname(inputPath).toLowerCase();
  const text = fs.readFileSync(inputPath, "utf8");

  if (extension === ".json") {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error("Editable JSON must be an array of question records.");
    }
    return parsed;
  }

  if (extension === ".tsv") {
    return parseDelimited(text, "\t");
  }

  if (extension === ".csv") {
    return parseDelimited(text, ",");
  }

  throw new Error(`Unsupported file extension: ${extension}`);
}

function parseNumber(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function buildOptions(record, fallbackOptions) {
  if (Array.isArray(record.options) && record.options.length) {
    return record.options.map((option) => String(option));
  }

  const keyedOptions = [record.optionA, record.optionB, record.optionC, record.optionD, record.optionE]
    .map((value) => String(value ?? ""))
    .filter((value) => value !== "");

  return keyedOptions.length ? keyedOptions : fallbackOptions;
}

function resolveAnswerIndex(record, options, fallbackAnswerIndex) {
  const rawIndex = parseNumber(record.answerIndex, NaN);
  if (Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex < options.length) {
    return rawIndex;
  }

  const correctAnswer = String(record.correctAnswer ?? "").trim();
  if (correctAnswer) {
    const matchedIndex = options.findIndex((option) => String(option).trim() === correctAnswer);
    if (matchedIndex >= 0) {
      return matchedIndex;
    }
  }

  return fallbackAnswerIndex;
}

function applyRecord(question, record) {
  const options = buildOptions(record, question.options);
  const answerIndex = resolveAnswerIndex(record, options, question.answerIndex);
  const updatedQuestion = {
    ...question,
    examNumber: parseNumber(record.examNumber, question.examNumber),
    questionNumber: parseNumber(record.questionNumber, question.questionNumber),
    category: String(record.category ?? question.category),
    topic: String(record.topic ?? question.topic),
    type: String(record.type ?? question.type),
    difficulty: parseNumber(record.difficulty, question.difficulty),
    question: String(record.question ?? question.question),
    options,
    answerIndex,
    explanation: String(record.explanation ?? question.explanation),
    source: String(record.source ?? question.source ?? ""),
  };

  const optionalFields = ["sourcePhoto", "answerPhoto", "image", "imageAlt", "imageCaption"];
  for (const field of optionalFields) {
    if (!(field in record)) {
      continue;
    }
    const value = String(record[field] ?? "");
    if (value !== "") {
      updatedQuestion[field] = value;
      continue;
    }
    if (field in question) {
      updatedQuestion[field] = "";
      continue;
    }
    if (field in updatedQuestion) {
      delete updatedQuestion[field];
    }
  }

  return updatedQuestion;
}

function rewriteDataFile(questionBank) {
  const content = [
    `export const CATEGORY_CONFIG = ${JSON.stringify(CATEGORY_CONFIG, null, 2)};`,
    "",
    `export const QUESTION_BANK = ${JSON.stringify(questionBank, null, 2)};`,
    "",
    `export const IMPORT_TEMPLATE = ${JSON.stringify(IMPORT_TEMPLATE, null, 2)};`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(projectRoot, "data.js"), content);
}

function main() {
  const inputPath = path.resolve(process.argv[2] || defaultInput);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Editable question bank file not found: ${inputPath}`);
  }

  const records = loadEditableRecords(inputPath);
  const recordsById = new Map();
  for (const record of records) {
    const id = String(record.id ?? "").trim();
    if (!id) {
      continue;
    }
    recordsById.set(id, record);
  }

  const unknownIds = [];
  const updatedQuestionBank = QUESTION_BANK.map((question) => {
    const record = recordsById.get(question.id);
    if (!record) {
      return question;
    }
    return applyRecord(question, record);
  });

  for (const id of recordsById.keys()) {
    if (!QUESTION_BANK.some((question) => question.id === id)) {
      unknownIds.push(id);
    }
  }

  rewriteDataFile(updatedQuestionBank);

  console.log(
    JSON.stringify(
      {
        inputPath: path.relative(projectRoot, inputPath),
        editedRecordCount: recordsById.size,
        updatedQuestionCount: updatedQuestionBank.filter((question) => recordsById.has(question.id)).length,
        unknownIds,
      },
      null,
      2,
    ),
  );
}

main();
