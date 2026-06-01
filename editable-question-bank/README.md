# Seeded Question Bank Editing

Use either of these editable files:

- `seeded-question-bank-editable.tsv`
- `seeded-question-bank-editable.json`

The TSV is best for Excel, Numbers, or Google Sheets.
The JSON is best if you want to preserve exact formatting with fewer spreadsheet quirks.

Recommended workflow:

1. Refresh the editable export from the current canonical bank:

```bash
node scripts/export-canonical-question-bank.mjs
```

2. Edit the TSV or JSON.
3. Apply your edits back into the seeded bank:

```bash
node scripts/apply-seeded-question-bank-edits.mjs editable-question-bank/seeded-question-bank-editable.tsv
```

Or for JSON:

```bash
node scripts/apply-seeded-question-bank-edits.mjs editable-question-bank/seeded-question-bank-editable.json
```

4. Verify the updated data file:

```bash
node --check data.js
```

5. If you want to refresh the editable exports again after applying changes:

```bash
node scripts/export-seeded-question-bank.mjs
```

Useful columns:

- `question`: question stem
- `optionA` to `optionE`: answer choices
- `answerIndex`: zero-based correct answer index
- `correctAnswer`: matching answer text for easier spreadsheet editing
- `explanation`: answer explanation
- `source`: source citation

Line breaks:

- If you edit `data.js` directly, use `\\n` inside the quoted string where you want a new line.
- If you edit the TSV/JSON, you can either use a real in-cell line break or type `\\n`; the apply script now converts `\\n` into a real line break in `data.js`.
- For a blank line, use `\\n\\n`.

If you take better source photos later, the strongest cleanup workflow is:

1. Run `node scripts/generate-question-bank-triage.mjs`.
2. Run `node scripts/update-question-bank-review-status.mjs`.
3. Use `photo-refresh/` plus `question-bank-qc/` to work highest-risk items first.
4. Apply verified corrections back into `data.js`.
5. Sync the same approved corrections to the shared website bank.
