export const CATEGORY_CONFIG = [
  {
    id: "radiation-safety",
    name: "Radiation Safety",
    shortName: "Radiation Safety",
    description: "ALARA, exposure limits, contamination control, and regulatory fundamentals.",
  },
  {
    id: "image-production",
    name: "Image Production",
    shortName: "Image Production",
    description: "Acquisition, processing, fusion, artifacts, and image interpretation fundamentals.",
  },
  {
    id: "instrumentation-qc",
    name: "Instrumentation & QC",
    shortName: "Instrumentation & QC",
    description: "Gamma camera physics, PET detector concepts, and routine quality control checks.",
  },
  {
    id: "clinical-procedures",
    name: "Clinical Procedures",
    shortName: "Clinical Procedures",
    description: "Patient prep, study protocols, acquisitions, and board-style procedural decisions.",
  },
  {
    id: "radiopharmaceuticals",
    name: "Radiopharmaceuticals",
    shortName: "Radiopharmaceuticals",
    description: "Generators, dose preparation, biodistribution, labeling, and assay fundamentals.",
  },
  {
    id: "patient-care",
    name: "Patient Care",
    shortName: "Patient Care",
    description: "Communication, safety screening, interventions, and pharmacologic stress knowledge.",
  },
];

export const QUESTION_BANK = [];

export const IMPORT_TEMPLATE = [
  {
    id: "custom-001",
    category: "Radiation Safety",
    topic: "ALARA",
    type: "concept",
    difficulty: 2,
    question: "Sample imported question text goes here.",
    options: ["Option A", "Option B", "Option C", "Option D"],
    answerIndex: 1,
    explanation: "Brief explanation for why the correct answer is right.",
  },
];
