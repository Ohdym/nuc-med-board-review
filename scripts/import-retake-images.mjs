import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { CATEGORY_CONFIG, IMPORT_TEMPLATE, QUESTION_BANK } from "../data.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const sourceRoot = path.join(projectRoot, "needs retake import");
const targetRoot = path.join(projectRoot, "assets", "question-bank", "retake");
const validExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function buildImageCaption(questionId, count) {
  const label = questionId.replace(/^exam(\d+)-0*(\d+)$/i, "Exam $1, Question $2");
  return count > 1 ? `Retake source graphic ${count} for ${label}.` : `Retake source graphic for ${label}.`;
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
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`Missing source directory: ${sourceRoot}`);
  }

  fs.mkdirSync(targetRoot, { recursive: true });

  const questionIds = new Set(QUESTION_BANK.map((question) => question.id));
  const unmatchedFolders = [];
  const missingImages = [];
  const updatedQuestionIds = [];
  const retainedQuestionBank = QUESTION_BANK.map((question) => ({ ...question }));

  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }
    const questionId = entry.name;
    if (!questionIds.has(questionId)) {
      unmatchedFolders.push(questionId);
      continue;
    }

    const sourceDir = path.join(sourceRoot, questionId);
    const imageFiles = fs
      .readdirSync(sourceDir, { withFileTypes: true })
      .filter((item) => item.isFile() && validExtensions.has(path.extname(item.name).toLowerCase()))
      .map((item) => item.name)
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }));

    if (!imageFiles.length) {
      missingImages.push(questionId);
      continue;
    }

    const targetDir = path.join(targetRoot, questionId);
    fs.mkdirSync(targetDir, { recursive: true });

    const mediaItems = imageFiles.map((fileName, index) => {
      const sourcePath = path.join(sourceDir, fileName);
      const targetPath = path.join(targetDir, fileName);
      fs.copyFileSync(sourcePath, targetPath);
      const publicPath = toPosix(path.relative(projectRoot, targetPath));
      return {
        src: publicPath,
        alt: `Graphic for ${questionId.replace(/^exam(\d+)-0*(\d+)$/i, "Exam $1, Question $2")}.`,
        caption: buildImageCaption(questionId, index + 1),
      };
    });

    const question = retainedQuestionBank.find((item) => item.id === questionId);
    question.image = mediaItems[0].src;
    question.imageAlt = mediaItems[0].alt;
    question.imageCaption = mediaItems[0].caption;
    question.images = mediaItems;
    updatedQuestionIds.push(questionId);
  }

  rewriteDataFile(retainedQuestionBank);

  console.log(JSON.stringify({
    updatedQuestionCount: updatedQuestionIds.length,
    updatedQuestionIds,
    unmatchedFolders,
    missingImages,
  }, null, 2));
}

main();
