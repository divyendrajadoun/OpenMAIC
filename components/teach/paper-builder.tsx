'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Download, Eye, EyeOff, FileText, LoaderCircle, Plus, Save, Trash2 } from 'lucide-react';

import { Section, SelectField, Shell } from '@/components/school/shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSchoolContext } from '@/lib/hooks/use-school-context';
import { schoolFetch } from '@/lib/school/api-headers';
import { downloadPaperDocx } from '@/lib/school/paper-docx';
import {
  BOARDS,
  PAPER_LANGUAGES,
  QUESTION_TYPES,
  type Paper,
  type QuestionDraft,
  type QuestionType,
} from '@/lib/school/question-types';

interface BlueprintRow {
  title: string;
  type: QuestionType;
  count: number;
  marksEach: number;
}

const DEFAULT_BLUEPRINT: BlueprintRow[] = [
  { title: 'Section A', type: 'mcq', count: 16, marksEach: 1 },
  { title: 'Section B', type: 'short', count: 8, marksEach: 2 },
  { title: 'Section C', type: 'short', count: 8, marksEach: 3 },
  { title: 'Section D', type: 'long', count: 4, marksEach: 5 },
  { title: 'Section E', type: 'long', count: 1, marksEach: 4 },
];

const CLASS_OPTIONS = Array.from({ length: 12 }, (_, i) => `Class ${i + 1}`);
const OPTION_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'];

function answerLine(question: QuestionDraft): string {
  if (question.type === 'mcq' && typeof question.answer === 'number' && question.options) {
    return `(${OPTION_LETTERS[question.answer] ?? question.answer + 1}) ${question.options[question.answer] ?? ''}`;
  }
  return question.answer === null ? '' : String(question.answer);
}

/** Read-only rendering of a paper, with answers toggled by the caller. */
export function PaperPreview({ paper, showAnswers }: { paper: Paper; showAnswers: boolean }) {
  const firstNumber = paper.sections.map(
    (_, i) => paper.sections.slice(0, i).reduce((sum, s) => sum + s.questions.length, 0) + 1,
  );
  return (
    <div className="space-y-5 text-sm">
      <div className="text-center">
        <p className="text-base font-semibold">{paper.title}</p>
        <p className="text-muted-foreground">
          {[paper.board, paper.classLabel, paper.subject].filter(Boolean).join(' · ')} ·{' '}
          {paper.durationMinutes} min · {paper.totalMarks} marks
        </p>
      </div>
      {paper.generalInstructions.length > 0 && (
        <ol className="list-decimal space-y-0.5 pl-5 text-xs text-muted-foreground">
          {paper.generalInstructions.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
      )}
      {paper.sections.map((section, sIndex) => (
        <div key={sIndex} className="space-y-2">
          <p className="text-center font-semibold">
            {section.title}{' '}
            <span className="font-normal text-muted-foreground">
              ({section.questions.reduce((sum, q) => sum + q.marks, 0)} marks)
            </span>
          </p>
          {section.instructions && (
            <p className="text-xs italic text-muted-foreground">{section.instructions}</p>
          )}
          {section.questions.map((question, qIndex) => {
            const number = firstNumber[sIndex] + qIndex;
            return (
              <div key={qIndex} className="rounded-lg border border-border/40 p-3">
                <p>
                  <span className="font-semibold">Q{number}. </span>
                  {question.text}
                  <span className="ml-2 text-xs text-muted-foreground">[{question.marks}]</span>
                </p>
                {question.type === 'mcq' && question.options && (
                  <ul className="mt-1 grid gap-0.5 pl-5 sm:grid-cols-2">
                    {question.options.map((option, i) => (
                      <li key={i}>
                        ({OPTION_LETTERS[i] ?? i + 1}) {option}
                      </li>
                    ))}
                  </ul>
                )}
                {showAnswers && (
                  <p className="mt-2 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                    <span className="font-semibold">Ans: </span>
                    {answerLine(question) || '—'}
                    {question.explanation && (
                      <span className="block text-emerald-700/80 dark:text-emerald-300/80">
                        {question.explanation}
                      </span>
                    )}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function PaperBuilder() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const { loading, enabled, user, school } = useSchoolContext({ staff: true });

  const [board, setBoard] = useState<string>('CBSE');
  const [classLabel, setClassLabel] = useState('Class 8');
  const [subject, setSubject] = useState('');
  const [chapters, setChapters] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(180);
  const [language, setLanguage] = useState<string>('English');
  const [difficulty, setDifficulty] = useState('balanced');
  const [notes, setNotes] = useState('');
  const [blueprint, setBlueprint] = useState<BlueprintRow[]>(DEFAULT_BLUEPRINT);

  const [paper, setPaper] = useState<Paper | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [showAnswers, setShowAnswers] = useState(false);
  const [busy, setBusy] = useState<'generate' | 'save' | 'bank' | 'docx' | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const totalMarks = blueprint.reduce((sum, row) => sum + row.count * row.marksEach, 0);
  const schoolId = school?.schoolId;
  const paperParam = params.get('paper');

  useEffect(() => {
    if (!schoolId || !paperParam) return;
    let cancelled = false;
    schoolFetch<{ paper: { id: string; paper: Paper } }>(
      `/api/school/${schoolId}/papers/${paperParam}`,
    )
      .then((data) => {
        if (cancelled) return;
        setPaper(data.paper.paper);
        setSavedId(data.paper.id);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [schoolId, paperParam]);

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!enabled) return <Shell title={t('school.teach.paper')}>{t('school.needsServer')}</Shell>;
  if (!user) {
    router.replace('/login?next=/teach/paper');
    return null;
  }
  if (!school) {
    router.replace('/teach');
    return null;
  }

  const chapterList = chapters
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  async function generate() {
    if (busy) return;
    setError('');
    setNotice('');
    setBusy('generate');
    try {
      const data = await schoolFetch<{ paper: Paper }>(
        `/api/school/${school!.schoolId}/papers/generate`,
        {
          llm: true,
          body: {
            board,
            classLabel,
            subject,
            chapters: chapterList,
            totalMarks,
            durationMinutes,
            language,
            difficulty,
            notes,
            blueprint,
          },
        },
      );
      setPaper(data.paper);
      setSavedId(null);
      setShowAnswers(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('school.error'));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!paper || busy) return;
    setBusy('save');
    setError('');
    try {
      const data = await schoolFetch<{ paper: { id: string } }>(
        `/api/school/${school!.schoolId}/papers`,
        { body: { paper } },
      );
      setSavedId(data.paper.id);
      setNotice(t('school.teach.saved'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('school.error'));
    } finally {
      setBusy(null);
    }
  }

  async function addToBank() {
    if (!paper || busy) return;
    setBusy('bank');
    setError('');
    try {
      const questions = paper.sections.flatMap((section) => section.questions);
      await schoolFetch(`/api/school/${school!.schoolId}/questions`, {
        body: {
          classLabel: paper.classLabel || classLabel,
          subject: paper.subject || subject,
          chapter: paper.chapters.join(', ') || chapterList.join(', ') || paper.title,
          questions,
        },
      });
      setNotice(t('school.teach.addedToBank'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('school.error'));
    } finally {
      setBusy(null);
    }
  }

  async function download(answerKey: boolean) {
    if (!paper || busy) return;
    setBusy('docx');
    try {
      await downloadPaperDocx(paper, { schoolName: school!.schoolName, answerKey });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('school.error'));
    } finally {
      setBusy(null);
    }
  }

  function updateRow(index: number, patch: Partial<BlueprintRow>) {
    setBlueprint((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  const canGenerate = subject.trim().length > 0 && chapterList.length > 0 && blueprint.length > 0;

  return (
    <Shell
      title={t('school.teach.paper')}
      back={() => router.push('/teach')}
      icon={<FileText className="h-5 w-5 text-primary" />}
    >
      <Section title={t('school.teach.paperSetup')}>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-muted-foreground">
            {t('school.teach.board')}
            <SelectField
              className="mt-1 w-full"
              value={board}
              onChange={setBoard}
              options={BOARDS}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            {t('school.teach.classLabel')}
            <SelectField
              className="mt-1 w-full"
              value={classLabel}
              onChange={setClassLabel}
              options={CLASS_OPTIONS}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            {t('school.teach.subject')}
            <Input
              className="mt-1"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Science"
            />
          </label>
        </div>
        <label className="mt-3 block text-xs text-muted-foreground">
          {t('school.teach.chapters')}
          <Textarea
            className="mt-1 min-h-[88px]"
            value={chapters}
            onChange={(e) => setChapters(e.target.value)}
            placeholder={'Chapter 1: Crop Production and Management\nChapter 2: Microorganisms'}
          />
        </label>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-muted-foreground">
            {t('school.teach.duration')}
            <Input
              className="mt-1"
              type="number"
              min={10}
              max={300}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value) || 60)}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            {t('school.teach.language')}
            <SelectField
              className="mt-1 w-full"
              value={language}
              onChange={setLanguage}
              options={PAPER_LANGUAGES}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            {t('school.teach.difficulty')}
            <SelectField
              className="mt-1 w-full"
              value={difficulty}
              onChange={setDifficulty}
              options={[
                { value: 'easy', label: t('school.teach.easier') },
                { value: 'balanced', label: t('school.teach.balanced') },
                { value: 'hard', label: t('school.teach.harder') },
              ]}
            />
          </label>
        </div>
        <label className="mt-3 block text-xs text-muted-foreground">
          {t('school.teach.notes')}
          <Input className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </Section>

      <Section
        title={`${t('school.teach.blueprint')} · ${totalMarks} ${t('school.teach.marks')}`}
        action={
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setBlueprint((rows) => [
                ...rows,
                {
                  title: `Section ${String.fromCharCode(65 + rows.length)}`,
                  type: 'short',
                  count: 4,
                  marksEach: 2,
                },
              ])
            }
          >
            <Plus className="mr-1 h-4 w-4" />
            {t('school.teach.addSection')}
          </Button>
        }
      >
        <div className="space-y-2">
          {blueprint.map((row, index) => (
            <div key={index} className="grid grid-cols-[1fr_1fr_80px_80px_36px] items-center gap-2">
              <Input
                value={row.title}
                onChange={(e) => updateRow(index, { title: e.target.value })}
                aria-label={t('school.teach.sectionTitle')}
              />
              <SelectField
                ariaLabel={t('school.teach.type')}
                value={row.type}
                onChange={(value) => updateRow(index, { type: value as QuestionType })}
                options={QUESTION_TYPES.map((type) => ({
                  value: type,
                  label: t(`school.teach.types.${type}`),
                }))}
              />
              <Input
                type="number"
                min={1}
                max={40}
                value={row.count}
                onChange={(e) => updateRow(index, { count: Number(e.target.value) || 1 })}
                aria-label={t('school.teach.count')}
              />
              <Input
                type="number"
                min={1}
                max={20}
                value={row.marksEach}
                onChange={(e) => updateRow(index, { marksEach: Number(e.target.value) || 1 })}
                aria-label={t('school.teach.marksEach')}
              />
              <button
                type="button"
                className="rounded p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setBlueprint((rows) => rows.filter((_, i) => i !== index))}
                aria-label={t('school.teach.delete')}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            {t('school.teach.sectionTitle')} · {t('school.teach.type')} · {t('school.teach.count')}{' '}
            · {t('school.teach.marksEach')}
          </p>
        </div>
        <Button className="mt-4 w-full" disabled={!canGenerate || busy !== null} onClick={generate}>
          {busy === 'generate' ? (
            <>
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              {t('school.teach.generating')}
            </>
          ) : paper ? (
            t('school.teach.regenerate')
          ) : (
            t('school.teach.generate')
          )}
        </Button>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </Section>

      {paper && (
        <Section
          title={paper.title}
          action={
            <Button size="sm" variant="ghost" onClick={() => setShowAnswers((v) => !v)}>
              {showAnswers ? <EyeOff className="mr-1 h-4 w-4" /> : <Eye className="mr-1 h-4 w-4" />}
              {showAnswers ? t('school.teach.hideAnswers') : t('school.teach.showAnswers')}
            </Button>
          }
        >
          <div className="mb-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => download(false)} disabled={busy !== null}>
              <Download className="mr-1 h-4 w-4" />
              {t('school.teach.downloadPaper')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => download(true)}
              disabled={busy !== null}
            >
              <Download className="mr-1 h-4 w-4" />
              {t('school.teach.downloadKey')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={save}
              disabled={busy !== null || !!savedId}
            >
              <Save className="mr-1 h-4 w-4" />
              {savedId ? t('school.teach.saved') : t('school.teach.save')}
            </Button>
            <Button size="sm" variant="outline" onClick={addToBank} disabled={busy !== null}>
              <Plus className="mr-1 h-4 w-4" />
              {t('school.teach.addToBank')}
            </Button>
            {notice && <span className="self-center text-xs text-emerald-600">{notice}</span>}
          </div>
          <PaperPreview paper={paper} showAnswers={showAnswers} />
        </Section>
      )}
    </Shell>
  );
}
