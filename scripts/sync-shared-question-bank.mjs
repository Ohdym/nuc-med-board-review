import fs from "fs";
import path from "path";

import {
  countTrackedFieldDiffs,
  getSeededQuestionBank,
  parseArgs,
  projectRoot,
} from "./lib/question-bank-io.mjs";

const defaultInput = path.join(projectRoot, "editable-question-bank", "seeded-question-bank-editable.json");

function loadEditedBank(inputPath) {
  const extension = path.extname(inputPath).toLowerCase();
  if (extension !== ".json") {
    throw new Error("Shared bank sync expects the editable JSON export so field names are preserved.");
  }
  const records = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  if (!Array.isArray(records)) {
    throw new Error("Editable JSON must be an array.");
  }
  return records.map((record) => {
    const options = [record.optionA, record.optionB, record.optionC, record.optionD, record.optionE].map((value) => String(value ?? ""));
    return {
      id: record.id,
      examNumber: Number(record.examNumber),
      questionNumber: Number(record.questionNumber),
      category: String(record.category ?? ""),
      topic: String(record.topic ?? ""),
      type: String(record.type ?? ""),
      difficulty: Number(record.difficulty),
      question: String(record.question ?? ""),
      options,
      answerIndex: Number(record.answerIndex),
      explanation: String(record.explanation ?? ""),
      source: String(record.source ?? ""),
      ...(record.sourcePhoto ? { sourcePhoto: String(record.sourcePhoto) } : {}),
      ...(record.answerPhoto ? { answerPhoto: String(record.answerPhoto) } : {}),
      ...(record.image ? { image: String(record.image) } : {}),
      ...(record.imageAlt ? { imageAlt: String(record.imageAlt) } : {}),
      ...(record.imageCaption ? { imageCaption: String(record.imageCaption) } : {}),
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(args.input || defaultInput);
  const baseUrl = String(args.url || process.env.QUESTION_BANK_SYNC_URL || "").replace(/\/+$/, "");
  const token = String(args.token || process.env.QUESTION_BANK_SYNC_TOKEN || "");
  const dryRun = Boolean(args["dry-run"]);

  if (!baseUrl) {
    throw new Error("Provide --url or set QUESTION_BANK_SYNC_URL.");
  }
  if (!token && !dryRun) {
    throw new Error("Provide --token or set QUESTION_BANK_SYNC_TOKEN.");
  }

  const editedBank = loadEditedBank(inputPath);
  const getResponse = await fetch(`${baseUrl}/api/question-bank`);
  if (!getResponse.ok) {
    throw new Error(`Could not load remote question bank: ${getResponse.status}`);
  }
  const currentRemote = await getResponse.json();
  const remoteBank = Array.isArray(currentRemote.questionBank) ? currentRemote.questionBank : [];
  const trackedDiffCount = countTrackedFieldDiffs(editedBank, remoteBank);

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          inputPath: path.relative(projectRoot, inputPath),
          baseUrl,
          editedQuestionCount: editedBank.length,
          remoteQuestionCount: remoteBank.length,
          trackedDiffCount,
        },
        null,
        2,
      ),
    );
    return;
  }

  const putResponse = await fetch(`${baseUrl}/api/question-bank`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ questionBank: editedBank }),
  });

  if (!putResponse.ok) {
    const body = await putResponse.text();
    throw new Error(`Remote question bank sync failed (${putResponse.status}): ${body}`);
  }

  const putBody = await putResponse.json();
  const savedBank = Array.isArray(putBody.questionBank) ? putBody.questionBank : [];

  console.log(
    JSON.stringify(
      {
        inputPath: path.relative(projectRoot, inputPath),
        baseUrl,
        editedQuestionCount: editedBank.length,
        sharedQuestionCount: savedBank.length,
        trackedDiffCountBeforeSync: trackedDiffCount,
        sharedVsSeededDiffCountAfterSync: countTrackedFieldDiffs(savedBank, getSeededQuestionBank()),
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
