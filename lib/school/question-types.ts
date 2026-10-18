/**
 * Question bank and question paper shapes shared by the server routes, the
 * generator prompts and the Teacher Studio pages. No Node imports: this file
 * is bundled into client components too.
 */

export const QUESTION_TYPES = ['mcq', 'true_false', 'fill_blank', 'short', 'long'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const BOARDS = ['CBSE', 'RBSE', 'ICSE', 'State board', 'Other'] as const;

export const PAPER_LANGUAGES = ['English', 'Hindi', 'Hinglish'] as const;

export interface QuestionDraft {
  type: QuestionType;
  text: string;
  /** Choices for `mcq`; `true_false` has none (answer is "True"/"False"). */
  options?: string[];
  /** For `mcq`: the 0-based index of the correct option. Others: model answer text. */
  answer: string | number | null;
  explanation?: string;
  marks: number;
  difficulty: Difficulty;
}

export interface BankQuestion extends QuestionDraft {
  id: string;
  schoolId: string;
  createdBy: string;
  classLabel: string;
  subject: string;
  chapter: string;
  createdAt: number;
}

export interface PaperSection {
  title: string;
  instructions?: string;
  questions: QuestionDraft[];
}

export interface Paper {
  title: string;
  board: string;
  classLabel: string;
  subject: string;
  chapters: string[];
  totalMarks: number;
  durationMinutes: number;
  language: string;
  generalInstructions: string[];
  sections: PaperSection[];
}

export interface SavedPaperSummary {
  id: string;
  title: string;
  classLabel: string;
  subject: string;
  totalMarks: number;
  createdBy: string;
  createdAt: number;
}

export const QUESTION_TEXT_MAX = 4000;
export const MAX_QUESTIONS_PER_REQUEST = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : undefined;
}

/** A well-formed question, or `null` when the input cannot be repaired. */
export function parseQuestionDraft(value: unknown): QuestionDraft | null {
  if (!isRecord(value)) return null;
  const type = value.type;
  if (!(QUESTION_TYPES as readonly unknown[]).includes(type)) return null;
  const text = cleanString(value.text, QUESTION_TEXT_MAX);
  if (!text) return null;

  const marksRaw = Number(value.marks);
  const marks = Number.isFinite(marksRaw) && marksRaw > 0 ? Math.min(Math.round(marksRaw), 100) : 1;
  const difficulty = (DIFFICULTIES as readonly unknown[]).includes(value.difficulty)
    ? (value.difficulty as Difficulty)
    : 'medium';
  const explanation = cleanString(value.explanation, QUESTION_TEXT_MAX);

  let options: string[] | undefined;
  let answer: string | number | null = null;
  if (type === 'mcq') {
    if (!Array.isArray(value.options)) return null;
    options = value.options
      .map((option) => cleanString(option, 1000))
      .filter((option): option is string => Boolean(option));
    if (options.length < 2) return null;
    const index =
      typeof value.answer === 'number'
        ? value.answer
        : typeof value.answer === 'string'
          ? options.findIndex((option) => option === (value.answer as string).trim())
          : -1;
    if (!Number.isInteger(index) || index < 0 || index >= options.length) return null;
    answer = index;
  } else if (type === 'true_false') {
    const raw = typeof value.answer === 'boolean' ? String(value.answer) : value.answer;
    const normalized = cleanString(raw, 10)?.toLowerCase();
    if (normalized !== 'true' && normalized !== 'false') return null;
    answer = normalized === 'true' ? 'True' : 'False';
  } else {
    answer = cleanString(value.answer, QUESTION_TEXT_MAX) ?? null;
  }

  return {
    type: type as QuestionType,
    text,
    ...(options ? { options } : {}),
    answer,
    ...(explanation ? { explanation } : {}),
    marks,
    difficulty,
  };
}

/** Every valid question in a list, dropping malformed entries. */
export function parseQuestionDrafts(
  value: unknown,
  max = MAX_QUESTIONS_PER_REQUEST,
): QuestionDraft[] {
  if (!Array.isArray(value)) return [];
  const out: QuestionDraft[] = [];
  for (const item of value) {
    const parsed = parseQuestionDraft(item);
    if (parsed) out.push(parsed);
    if (out.length >= max) break;
  }
  return out;
}

/** A well-formed paper, or `null`. Sections without valid questions are dropped. */
export function parsePaper(value: unknown): Paper | null {
  if (!isRecord(value)) return null;
  const title = cleanString(value.title, 300);
  if (!title) return null;
  const sectionsRaw = Array.isArray(value.sections) ? value.sections : [];
  const sections: PaperSection[] = [];
  for (const sectionRaw of sectionsRaw) {
    if (!isRecord(sectionRaw)) continue;
    const questions = parseQuestionDrafts(sectionRaw.questions);
    if (questions.length === 0) continue;
    const instructions = cleanString(sectionRaw.instructions, 2000);
    sections.push({
      title: cleanString(sectionRaw.title, 200) ?? `Section ${sections.length + 1}`,
      ...(instructions ? { instructions } : {}),
      questions,
    });
  }
  if (sections.length === 0) return null;
  const totalMarks = sections.reduce(
    (sum, section) => sum + section.questions.reduce((inner, q) => inner + q.marks, 0),
    0,
  );
  const duration = Number(value.durationMinutes);
  const chapters = Array.isArray(value.chapters)
    ? value.chapters.map((c) => cleanString(c, 200)).filter((c): c is string => Boolean(c))
    : [];
  const generalInstructions = Array.isArray(value.generalInstructions)
    ? value.generalInstructions
        .map((line) => cleanString(line, 500))
        .filter((line): line is string => Boolean(line))
    : [];
  return {
    title,
    board: cleanString(value.board, 60) ?? '',
    classLabel: cleanString(value.classLabel, 60) ?? '',
    subject: cleanString(value.subject, 120) ?? '',
    chapters,
    totalMarks,
    durationMinutes: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 60,
    language: cleanString(value.language, 40) ?? 'English',
    generalInstructions,
    sections,
  };
}
