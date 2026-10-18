import * as docx from 'docx';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { buildPaperDocument } from '@/lib/school/paper-docx';
import type { Paper } from '@/lib/school/question-types';

const paper: Paper = {
  title: 'Unit Test 1',
  board: 'RBSE',
  classLabel: 'Class 8',
  subject: 'Science',
  chapters: ['Microorganisms'],
  totalMarks: 4,
  durationMinutes: 40,
  language: 'English',
  generalInstructions: ['All questions are compulsory.'],
  sections: [
    {
      title: 'Section A',
      instructions: 'Choose the correct option.',
      questions: [
        {
          type: 'mcq',
          text: 'Yeast is used in the production of',
          options: ['Sugar', 'Alcohol', 'Oxygen', 'Salt'],
          answer: 1,
          explanation: 'Yeast ferments sugar into alcohol.',
          marks: 1,
          difficulty: 'easy',
        },
      ],
    },
    {
      title: 'Section B',
      questions: [
        {
          type: 'short',
          text: 'Name two diseases caused by viruses.',
          answer: 'Influenza and polio.',
          marks: 3,
          difficulty: 'medium',
        },
      ],
    },
  ],
};

async function documentText(document: docx.Document): Promise<string> {
  const buffer = await docx.Packer.toBuffer(document);
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml')!.async('string');
  return xml.replace(/<[^>]+>/g, ' ');
}

describe('buildPaperDocument', () => {
  it('prints the question paper with options and no answers', async () => {
    const text = await documentText(
      buildPaperDocument(docx, paper, { schoolName: 'Sunrise School', answerKey: false }),
    );
    expect(text).toContain('Sunrise School');
    expect(text).toContain('Unit Test 1');
    expect(text).toContain('Maximum marks: 4');
    expect(text).toContain('All questions are compulsory.');
    expect(text).toContain('Choose the correct option.');
    expect(text).toContain('Q1.');
    expect(text).toContain('(b) Alcohol');
    expect(text).toContain('Q2.');
    expect(text).toContain('Name two diseases caused by viruses.');
    expect(text).not.toContain('Influenza and polio.');
    expect(text).not.toContain('Yeast ferments');
  });

  it('prints the answer key with model answers and explanations', async () => {
    const text = await documentText(buildPaperDocument(docx, paper, { answerKey: true }));
    expect(text).toContain('(b) Alcohol');
    expect(text).toContain('Yeast ferments sugar into alcohol.');
    expect(text).toContain('Influenza and polio.');
    expect(text).not.toContain('Choose the correct option.');
  });
});
