// Blankety forms and their questions -> raw_blankety_forms / raw_blankety_questions.
// Small complete lists, re-read every run (snapshot: ids that vanish are flagged, changes go to history).
// Questions come from /form/{id}/questions, which returns an object keyed by question id; we store each
// question exactly as returned, with source_id "<formId>:<qid>" (a question id alone is not unique across forms).
import {
  rawBlanketyForms, rawBlanketyFormsHistory,
  rawBlanketyQuestions, rawBlanketyQuestionsHistory,
} from '../../db/hp-schema.js';
import { landRows, flagMissing } from '../landRaw.js';

const PAGE = 100;
const newStats = () => ({ fetched: 0, new: 0, changed: 0, unchanged: 0, missing: 0 });

/** Returns { stats, formIds } so the submissions sync knows which forms to read. */
export async function syncBlanketyForms({ api, db }) {
  await api.startRun('forms + questions sync');
  const stats = { forms: newStats(), questions: newStats() };
  const runStarted = new Date();
  try {
    const forms = [];
    for await (const body of api.paginate((offset) => api.getFormsPage({ offset, limit: PAGE }), PAGE)) forms.push(...(body.content ?? []));
    await landRows(db, rawBlanketyForms, rawBlanketyFormsHistory, forms, stats.forms);
    stats.forms.missing = await flagMissing(db, rawBlanketyForms, runStarted);

    const formOf = new Map(); // question object -> its form id, for the source_id
    for (const form of forms) {
      const body = await api.getQuestions(form.id);
      for (const q of Object.values(body.content ?? {})) formOf.set(q, form.id);
    }
    await landRows(db, rawBlanketyQuestions, rawBlanketyQuestionsHistory, [...formOf.keys()], stats.questions,
      (q) => `${formOf.get(q)}:${q.qid}`);
    stats.questions.missing = await flagMissing(db, rawBlanketyQuestions, runStarted);

    stats.rateLimit = api.rateLimit;
    await api.finishRun(stats);
    return { stats, formIds: forms.map((f) => f.id) };
  } catch (err) {
    await api.finishRun(stats, { error: err });
    throw err;
  }
}
