import { describe, expect, it } from 'vitest';

import { parsePaper, parseQuestionDraft, parseQuestionDrafts } from '@/lib/school/question-types';

describe('parseQuestionDraft', () => {
  it('accepts an mcq with a numeric answer index', () => {
    const q = parseQuestionDraft({
      type: 'mcq',
      text: 'Which gas do plants absorb?',
      options: ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Helium'],
      answer: 1,
      marks: 1,
      difficulty: 'easy',
    });
    expect(q).toMatchObject({ type: 'mcq', answer: 1, marks: 1, difficulty: 'easy' });
    expect(q?.options).toHaveLength(4);
  });

  it('maps an mcq answer given as option text to its index', () => {
    const q = parseQuestionDraft({
      type: 'mcq',
      text: 'Q',
      options: ['a', 'b', 'c'],
      answer: 'c',
    });
    expect(q?.answer).toBe(2);
    expect(q?.marks).toBe(1);
    expect(q?.difficulty).toBe('medium');
  });

  it('rejects an mcq whose answer is out of range or with too few options', () => {
    expect(
      parseQuestionDraft({ type: 'mcq', text: 'Q', options: ['a', 'b'], answer: 5 }),
    ).toBeNull();
    expect(parseQuestionDraft({ type: 'mcq', text: 'Q', options: ['only'], answer: 0 })).toBeNull();
  });

  it('normalises true/false answers', () => {
    expect(parseQuestionDraft({ type: 'true_false', text: 'Q', answer: true })?.answer).toBe(
      'True',
    );
    expect(parseQuestionDraft({ type: 'true_false', text: 'Q', answer: 'false' })?.answer).toBe(
      'False',
    );
    expect(parseQuestionDraft({ type: 'true_false', text: 'Q', answer: 'maybe' })).toBeNull();
  });

  it('rejects unknown types and empty text', () => {
    expect(parseQuestionDraft({ type: 'essay', text: 'Q', answer: 'x' })).toBeNull();
    expect(parseQuestionDraft({ type: 'short', text: '   ', answer: 'x' })).toBeNull();
  });

  it('drops malformed entries from a list and caps the count', () => {
    const list = parseQuestionDrafts(
      [
        { type: 'short', text: 'one', answer: 'a' },
        { type: 'nope' },
        { type: 'short', text: 'two', answer: 'b' },
        { type: 'short', text: 'three', answer: 'c' },
      ],
      2,
    );
    expect(list.map((q) => q.text)).toEqual(['one', 'two']);
  });
});

describe('parsePaper', () => {
  it('computes total marks and drops empty sections', () => {
    const paper = parsePaper({
      title: 'Unit test',
      board: 'CBSE',
      classLabel: 'Class 8',
      subject: 'Science',
      chapters: ['Microorganisms', ''],
      durationMinutes: '40',
      generalInstructions: ['All questions are compulsory.'],
      sections: [
        {
          title: 'Section A',
          questions: [
            { type: 'mcq', text: 'Q1', options: ['a', 'b'], answer: 0, marks: 1 },
            { type: 'true_false', text: 'Q2', answer: 'True', marks: 1 },
          ],
        },
        { title: 'Empty', questions: [{ type: 'bad' }] },
        { questions: [{ type: 'long', text: 'Q3', answer: 'model answer', marks: 5 }] },
      ],
    });
    expect(paper).not.toBeNull();
    expect(paper?.totalMarks).toBe(7);
    expect(paper?.durationMinutes).toBe(40);
    expect(paper?.chapters).toEqual(['Microorganisms']);
    expect(paper?.sections.map((s) => s.title)).toEqual(['Section A', 'Section 2']);
  });

  it('returns null without a title or without any valid question', () => {
    expect(parsePaper({ sections: [] })).toBeNull();
    expect(parsePaper({ title: 'T', sections: [{ title: 'A', questions: [] }] })).toBeNull();
  });
});
