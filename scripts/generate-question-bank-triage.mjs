import fs from "fs";
import path from "path";

import {
  ensureRelative,
  loadCanonicalQuestionBank,
  parseArgs,
  projectRoot,
} from "./lib/question-bank-io.mjs";

const QUESTION_LABEL_RE = /\b[A-E][\.\)]\s/g;
const ANSWER_KEY_RE = /\b(?:A|B|C|D|E)(?:\s*,\s*(?:A|B|C|D|E))*\s*(?:only|or\s+(?:A|B|C|D|E)\s+only)\b/i;
const OCR_SUSPECT_RE = /\b(?:patien's|leve!|acconting|Al of the following|lowand|13'T|20'T|999Mo|1l1In|specihc|attenualing|radionulidic|ativity)\b/i;
const GRAPH_FRAGMENT_RE = /\b(?:Log|Activity|Calculated|Time\s*\(hrs\)|mCi)\b/;
const ISOTOPE_BRACKET_RE = /\[[0-9]{1,3}[A-Za-z]{1,3}\]|\[[0-9]{1,3}m[A-Za-z]{1,3}\]/g;

function scoreQuestion(question) {
  const reasons = [];
  let score = 0;
  const options = Array.isArray(question.options) ? question.options : [];
  const joinedOptions = options.join(" || ");
  const fields = [question.question || "", joinedOptions, question.explanation || "", question.source || ""].join(" ");

  const optionLabelMatches = options.filter((option) => QUESTION_LABEL_RE.test(option)).length;
  if (optionLabelMatches >= 2) {
    score += 30;
    reasons.push("multiple options contain embedded answer-label text");
  }

  if (options.some((option) => ANSWER_KEY_RE.test(option))) {
    score += 18;
    reasons.push("answer-key style wording appears inside options");
  }

  if (GRAPH_FRAGMENT_RE.test(joinedOptions) && options.some((option) => option.length < 20)) {
    score += 24;
    reasons.push("graph or formula fragments appear mixed into answer options");
  }

  if (OCR_SUSPECT_RE.test(fields)) {
    score += 22;
    reasons.push("known OCR-suspect token detected");
  }

  if ((question.question || "").endsWith(":") || (question.question || "").endsWith("except:")) {
    score += 4;
    reasons.push("question stem ends with continuation punctuation");
  }

  if ((question.explanation || "").endsWith("-") || /x 100\s*$/.test(question.explanation || "")) {
    score += 14;
    reasons.push("explanation looks truncated or formula-fragmented");
  }

  if (options.some((option) => String(option).trim().length <= 2)) {
    score += 18;
    reasons.push("one or more answer options are implausibly short");
  }

  const isotopeTokens = fields.match(ISOTOPE_BRACKET_RE) || [];
  if (isotopeTokens.some((token) => !/^\[(?:\d{1,3}m?[A-Z][a-z]?)\]$/.test(token))) {
    score += 10;
    reasons.push("possible malformed isotope bracket formatting");
  }

  if (question.image || /graph|figure|region shown|basis of this graph/i.test(question.question || "")) {
    score += 8;
    reasons.push("image-dependent question should be photo-verified");
  }

  const severity = score >= 30 ? "high" : score >= 18 ? "medium" : score >= 8 ? "low" : "clean";
  const stage = score >= 30 ? "stage-1" : score >= 18 ? "stage-2" : "stage-3";

  return {
    id: question.id,
    examNumber: question.examNumber,
    questionNumber: question.questionNumber,
    score,
    severity,
    stage,
    reasons,
  };
}

function writeSummary(items, outputPath, metadata) {
  const lines = [
    "# Question Bank Triage Summary",
    "",
    `Source: \`${metadata.source}\``,
    `Generated: \`${metadata.generatedAt}\``,
    `Question count: \`${metadata.questionCount}\``,
    "",
    "## Highest-Risk Questions",
    "",
    "| Rank | ID | Score | Severity | Stage | Reasons |",
    "| --- | --- | ---: | --- | --- | --- |",
  ];

  items
    .filter((item) => item.score > 0)
    .slice(0, 40)
    .forEach((item, index) => {
      lines.push(`| ${index + 1} | ${item.id} | ${item.score} | ${item.severity} | ${item.stage} | ${item.reasons.join("; ")} |`);
    });

  fs.writeFileSync(outputPath, `${lines.join("\n")}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = path.resolve(args.outputDir || path.join(projectRoot, "question-bank-qc"));
  fs.mkdirSync(outputDir, { recursive: true });

  const { bank, source, seededDiffCount, localSharedDiffCount } = await loadCanonicalQuestionBank({
    source: args.source || "auto",
    remoteUrl: args.url || "",
  });

  const triageItems = bank.map(scoreQuestion).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  const keyed = Object.fromEntries(triageItems.map((item) => [item.id, item]));
  const metadata = {
    source,
    questionCount: bank.length,
    seededDiffCount,
    localSharedDiffCount,
    generatedAt: new Date().toISOString(),
  };

  const jsonPath = path.join(outputDir, "triage-report.json");
  const markdownPath = path.join(outputDir, "triage-summary.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify({ metadata, questions: keyed }, null, 2)}\n`);
  writeSummary(triageItems, markdownPath, metadata);

  console.log(
    JSON.stringify(
      {
        ...metadata,
        highRiskCount: triageItems.filter((item) => item.severity === "high").length,
        mediumRiskCount: triageItems.filter((item) => item.severity === "medium").length,
        lowRiskCount: triageItems.filter((item) => item.severity === "low").length,
        cleanCount: triageItems.filter((item) => item.severity === "clean").length,
        jsonPath: ensureRelative(jsonPath),
        markdownPath: ensureRelative(markdownPath),
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
