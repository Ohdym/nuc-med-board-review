# Photo Refresh Intake

This folder is for new source photos that will be used to repair and quality-control the transcribed seeded question bank.

## Folder layout

- `exam-01/questions/`
- `exam-01/answers/`
- `...`
- `exam-08/questions/`
- `exam-08/answers/`

## Recommended file names

Use one question-page photo and one answer/explanation-page photo per question when possible:

- `exam1-001-question.jpg`
- `exam1-001-answer.jpg`
- `exam3-086-question.jpg`
- `exam3-086-answer.jpg`

If a page needs more than one image, add a numeric suffix:

- `exam2-054-question-1.jpg`
- `exam2-054-question-2.jpg`
- `exam2-054-answer-1.jpg`

## What to photograph

- The full question stem
- All answer choices
- The correct answer page
- The explanation/source text if it appears on the answer page
- Any graphics or tables that affect the wording or answer

## Capture tips

- Keep the page square to the camera
- Use bright, even lighting
- Avoid shadows across text
- Fill the frame with the page
- Make sure small text and answer letters are readable when zoomed in
- Retake any blurry graph, table, or formula image immediately

## Tracking progress

Use [intake-checklist.tsv](/Users/codymueller/Project/photo-refresh/intake-checklist.tsv) to track what has been added.

Important columns:

- `questionPhotoFile`
- `answerPhotoFile`
- `questionPhotoAdded`
- `answerPhotoAdded`
- `needsReview`
- `notes`

## How we will use this later

Once you add the new photos, I can:

1. Match each photo set to its existing `exam#-###` question.
2. Compare the current transcription in `data.js` against the new source photos.
3. Correct typos, merged answers, formulas, and broken explanations.
4. Flag any questions that still need manual review.
