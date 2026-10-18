'use client';

import type { Paper, QuestionDraft } from '@/lib/school/question-types';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

type DocxApi = typeof import('docx');

const OPTION_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'];

function answerText(question: QuestionDraft): string {
  if (question.type === 'mcq' && typeof question.answer === 'number' && question.options) {
    const letter = OPTION_LETTERS[question.answer] ?? String(question.answer + 1);
    return `(${letter}) ${question.options[question.answer] ?? ''}`;
  }
  return question.answer === null ? '' : String(question.answer);
}

export function buildPaperDocument(
  api: DocxApi,
  paper: Paper,
  options: { schoolName?: string; setLabel?: string; answerKey: boolean },
) {
  const { Document, Paragraph, TextRun, HeadingLevel, AlignmentType } = api;
  const children: InstanceType<typeof Paragraph>[] = [];
  const centered = (text: string, bold = false, size?: number) =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text, bold, ...(size ? { size } : {}) })],
    });

  if (options.schoolName) children.push(centered(options.schoolName, true, 28));
  children.push(centered(paper.title, true, 26));
  children.push(
    centered([paper.board, paper.classLabel, paper.subject].filter(Boolean).join('  |  ')),
  );
  children.push(
    centered(
      `Time: ${paper.durationMinutes} minutes      Maximum marks: ${paper.totalMarks}${
        options.setLabel ? `      Set ${options.setLabel}` : ''
      }`,
    ),
  );
  if (!options.answerKey && paper.generalInstructions.length > 0) {
    children.push(new Paragraph({ text: 'General instructions', heading: HeadingLevel.HEADING_3 }));
    paper.generalInstructions.forEach((line, i) => {
      children.push(new Paragraph({ text: `${i + 1}. ${line}` }));
    });
  }

  let number = 0;
  for (const section of paper.sections) {
    const sectionMarks = section.questions.reduce((sum, q) => sum + q.marks, 0);
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: `${section.title}  (${sectionMarks} marks)`, bold: true })],
      }),
    );
    if (!options.answerKey && section.instructions) {
      children.push(
        new Paragraph({ children: [new TextRun({ text: section.instructions, italics: true })] }),
      );
    }
    for (const question of section.questions) {
      number += 1;
      if (options.answerKey) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: `Q${number}. `, bold: true }),
              new TextRun({ text: answerText(question) || '—' }),
              new TextRun({ text: `   [${question.marks}]`, color: '666666' }),
            ],
          }),
        );
        if (question.explanation) {
          children.push(
            new Paragraph({
              indent: { left: 720 },
              children: [
                new TextRun({ text: question.explanation, italics: true, color: '444444' }),
              ],
            }),
          );
        }
        continue;
      }
      children.push(
        new Paragraph({
          spacing: { before: 160 },
          children: [
            new TextRun({ text: `Q${number}. `, bold: true }),
            new TextRun({ text: question.text }),
            new TextRun({ text: `   [${question.marks}]`, color: '666666' }),
          ],
        }),
      );
      if (question.type === 'mcq' && question.options) {
        question.options.forEach((option, i) => {
          children.push(
            new Paragraph({
              indent: { left: 720 },
              text: `(${OPTION_LETTERS[i] ?? i + 1}) ${option}`,
            }),
          );
        });
      }
    }
  }

  return new Document({
    creator: 'School of AI',
    title: options.answerKey ? `${paper.title} — Answer key` : paper.title,
    sections: [{ children }],
  });
}

function fileName(paper: Paper, suffix: string): string {
  const base = [paper.classLabel, paper.subject, paper.title]
    .filter(Boolean)
    .join(' ')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${base || 'question-paper'}${suffix}.docx`;
}

/** Download the paper (or its answer key) as a Word file. */
export async function downloadPaperDocx(
  paper: Paper,
  options: { schoolName?: string; setLabel?: string; answerKey?: boolean } = {},
): Promise<void> {
  const [api, { saveAs }] = await Promise.all([import('docx'), import('file-saver')]);
  const document = buildPaperDocument(api, paper, {
    ...options,
    answerKey: options.answerKey ?? false,
  });
  const raw = await api.Packer.toBlob(document);
  const blob = new Blob([raw], { type: DOCX_MIME });
  saveAs(blob, fileName(paper, options.answerKey ? ' answer key' : ''));
}
