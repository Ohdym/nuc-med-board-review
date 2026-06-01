import path from "path";

import {
  ensureRelative,
  loadCanonicalQuestionBank,
  parseArgs,
  projectRoot,
  writeEditableExports,
} from "./lib/question-bank-io.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = path.resolve(args.outputDir || path.join(projectRoot, "editable-question-bank"));
  const { bank, source, seededDiffCount, localSharedDiffCount, remoteUrl } = await loadCanonicalQuestionBank({
    source: args.source || "auto",
    remoteUrl: args.url || "",
  });

  const metadata = {
    source,
    remoteUrl: remoteUrl || null,
    questionCount: bank.length,
    seededDiffCount,
    localSharedDiffCount,
    generatedAt: new Date().toISOString(),
    legacyCommand: "export-seeded-question-bank.mjs",
  };

  const outputs = writeEditableExports(bank, outputDir, metadata);

  console.log(
    JSON.stringify(
      {
        ...metadata,
        jsonPath: ensureRelative(outputs.jsonPath),
        tsvPath: ensureRelative(outputs.tsvPath),
        metadataPath: ensureRelative(outputs.metadataPath),
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
