import fs from "fs";
import path from "path";

import {
  countTrackedFieldDiffs,
  getSeededQuestionBank,
  indexById,
  loadCanonicalQuestionBank,
  parseArgs,
  projectRoot,
  trackedFieldSnapshot,
} from "./lib/question-bank-io.mjs";

const qcDir = path.join(projectRoot, "question-bank-qc");
const triageReportPath = path.join(qcDir, "triage-report.json");
const reviewStatusPath = path.join(qcDir, "review-status.json");
const intakeChecklistPath = path.join(projectRoot, "photo-refresh", "intake-checklist.tsv");

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

  const headers = rows[0];
  return rows.slice(1).map((values) => {
    const record = {};
    headers.forEach((header, idx) => {
      record[header] = values[idx] ?? "";
    });
    return record;
  });
}

function loadChecklist() {
  if (!fs.existsSync(intakeChecklistPath)) {
    return new Map();
  }
  const records = parseDelimited(fs.readFileSync(intakeChecklistPath, "utf8"), "\t");
  return new Map(records.map((record) => [record.id, record]));
}

function loadTriage() {
  if (!fs.existsSync(triageReportPath)) {
    return {};
  }
  const report = JSON.parse(fs.readFileSync(triageReportPath, "utf8"));
  return report.questions || {};
}

function loadExistingStatus() {
  if (!fs.existsSync(reviewStatusPath)) {
    return { questions: {} };
  }
  return JSON.parse(fs.readFileSync(reviewStatusPath, "utf8"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { bank: sharedBank, source } = await loadCanonicalQuestionBank({
    source: args.source || "auto",
    remoteUrl: args.url || "",
  });

  const triage = loadTriage();
  const checklist = loadChecklist();
  const existing = loadExistingStatus();
  const seededById = indexById(getSeededQuestionBank());
  const sharedById = indexById(sharedBank);

  const questions = {};
  for (const [id, sharedQuestion] of sharedById.entries()) {
    const previous = existing.questions?.[id] || {};
    const triageEntry = triage[id] || {};
    const checklistEntry = checklist.get(id) || {};
    const seededQuestion = seededById.get(id);
    const questionPhotoPath = path.join(projectRoot, checklistEntry.questionPhotoFile || "");
    const answerPhotoPath = path.join(projectRoot, checklistEntry.answerPhotoFile || "");
    const reviewFieldsMatchSeeded =
      seededQuestion && JSON.stringify(trackedFieldSnapshot(sharedQuestion)) === JSON.stringify(trackedFieldSnapshot(seededQuestion));

    questions[id] = {
      id,
      examNumber: sharedQuestion.examNumber,
      questionNumber: sharedQuestion.questionNumber,
      triageScore: triageEntry.score ?? 0,
      triageSeverity: triageEntry.severity || "unknown",
      triageStage: triageEntry.stage || "stage-3",
      triageReasons: triageEntry.reasons || [],
      questionPhotoExists: Boolean(checklistEntry.questionPhotoFile) && fs.existsSync(questionPhotoPath),
      answerPhotoExists: Boolean(checklistEntry.answerPhotoFile) && fs.existsSync(answerPhotoPath),
      photoVerified: Boolean(previous.photoVerified),
      reviewStatus: previous.reviewStatus || (triageEntry.severity === "high" ? "needs-review" : "queued"),
      correctionAppliedToDataJs: Boolean(reviewFieldsMatchSeeded),
      correctionSyncedToSharedBank: true,
      substantiveChangeLogged: Boolean(previous.substantiveChangeLogged),
      lastReviewedAt: previous.lastReviewedAt || "",
      notes: previous.notes || checklistEntry.notes || "",
    };
  }

  const output = {
    metadata: {
      source,
      generatedAt: new Date().toISOString(),
      questionCount: Object.keys(questions).length,
      sharedVsSeededDiffCount: countTrackedFieldDiffs(sharedBank, getSeededQuestionBank()),
    },
    questions,
  };

  fs.mkdirSync(qcDir, { recursive: true });
  fs.writeFileSync(reviewStatusPath, `${JSON.stringify(output, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        ...output.metadata,
        reviewStatusPath: path.relative(projectRoot, reviewStatusPath),
        photoReadyCount: Object.values(questions).filter((item) => item.questionPhotoExists && item.answerPhotoExists).length,
        photoVerifiedCount: Object.values(questions).filter((item) => item.photoVerified).length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
