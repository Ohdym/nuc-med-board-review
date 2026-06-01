# Question Bank QC Workflow

This folder contains machine-generated QA artifacts for verifying and repairing the website question bank against source photos.

## Main artifacts

- `triage-report.json`
- `triage-summary.md`
- `review-status.json`

## Recommended workflow

1. Export the canonical bank:

```bash
node scripts/export-canonical-question-bank.mjs
```

Optional remote source:

```bash
QUESTION_BANK_SOURCE_URL=https://nucmedreview.com node scripts/export-canonical-question-bank.mjs --source remote
```

2. Generate the triage report:

```bash
node scripts/generate-question-bank-triage.mjs
```

3. Update review status from the triage report and photo intake checklist:

```bash
node scripts/update-question-bank-review-status.mjs
```

4. Review and edit the exported question bank in:

- `editable-question-bank/seeded-question-bank-editable.tsv`
- `editable-question-bank/seeded-question-bank-editable.json`

5. Apply approved changes back into `data.js`:

```bash
node scripts/apply-seeded-question-bank-edits.mjs editable-question-bank/seeded-question-bank-editable.json
node --check data.js
```

6. Compare/sync the same approved corrections to the shared website bank:

```bash
QUESTION_BANK_SYNC_URL=https://nucmedreview.com \
QUESTION_BANK_SYNC_TOKEN=<instructor-token> \
node scripts/sync-shared-question-bank.mjs --input editable-question-bank/seeded-question-bank-editable.json
```

Dry run:

```bash
QUESTION_BANK_SYNC_URL=https://nucmedreview.com \
node scripts/sync-shared-question-bank.mjs --input editable-question-bank/seeded-question-bank-editable.json --dry-run
```

## Review rules

- Restrict corrections to `question`, `options`, `explanation`, and `source` unless source photos prove another field needs repair.
- Treat new source photos as the default authority for substantive changes.
- Keep `data.js` and the shared website bank synchronized after each approved batch.
