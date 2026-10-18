'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Library, LoaderCircle, Plus, Sparkles, Trash2 } from 'lucide-react';

import { Section, SelectField, Shell } from '@/components/school/shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSchoolContext } from '@/lib/hooks/use-school-context';
import { schoolFetch } from '@/lib/school/api-headers';
import {
  BOARDS,
  DIFFICULTIES,
  PAPER_LANGUAGES,
  QUESTION_TYPES,
  parseQuestionDraft,
  type BankQuestion,
  type QuestionDraft,
  type QuestionType,
} from '@/lib/school/question-types';

interface Facet {
  classLabel: string;
  subject: string;
  chapter: string;
  count: number;
}

const CLASS_OPTIONS = Array.from({ length: 12 }, (_, i) => `Class ${i + 1}`);
const OPTION_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'];

function QuestionCard({
  question,
  typeLabel,
  action,
}: {
  question: QuestionDraft;
  typeLabel: string;
  action?: React.ReactNode;
}) {
  const answer =
    question.type === 'mcq' && typeof question.answer === 'number' && question.options
      ? `(${OPTION_LETTERS[question.answer] ?? question.answer + 1}) ${question.options[question.answer] ?? ''}`
      : question.answer === null
        ? ''
        : String(question.answer);
  return (
    <div className="rounded-lg border border-border/40 p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <p>{question.text}</p>
        {action}
      </div>
      {question.type === 'mcq' && question.options && (
        <ul className="mt-1 grid gap-0.5 pl-4 text-muted-foreground sm:grid-cols-2">
          {question.options.map((option, i) => (
            <li key={i}>
              ({OPTION_LETTERS[i] ?? i + 1}) {option}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        <span className="rounded bg-muted px-1.5 py-0.5">{typeLabel}</span>{' '}
        <span className="rounded bg-muted px-1.5 py-0.5">{question.difficulty}</span>{' '}
        <span className="rounded bg-muted px-1.5 py-0.5">{question.marks} m</span>
        {answer && (
          <span className="ml-2 text-emerald-700 dark:text-emerald-300">Ans: {answer}</span>
        )}
      </p>
    </div>
  );
}

export function QuestionBank() {
  const { t } = useI18n();
  const router = useRouter();
  const { loading, enabled, user, school } = useSchoolContext({ staff: true });
  const schoolId = school?.schoolId;

  const [facets, setFacets] = useState<Facet[]>([]);
  const [filter, setFilter] = useState<{ classLabel: string; subject: string; chapter: string }>({
    classLabel: '',
    subject: '',
    chapter: '',
  });
  const [questions, setQuestions] = useState<BankQuestion[] | null>(null);

  const [gen, setGen] = useState({
    board: 'CBSE',
    classLabel: 'Class 8',
    subject: '',
    chapter: '',
    language: 'English',
    count: 10,
    difficulty: 'mixed',
    types: ['mcq', 'true_false', 'fill_blank', 'short'] as QuestionType[],
  });
  const [drafts, setDrafts] = useState<QuestionDraft[]>([]);
  const [busy, setBusy] = useState<'generate' | 'save' | 'add' | null>(null);
  const [error, setError] = useState('');

  const [manual, setManual] = useState({
    type: 'mcq' as QuestionType,
    text: '',
    options: '',
    answer: '1',
    explanation: '',
    marks: 1,
    difficulty: 'medium' as (typeof DIFFICULTIES)[number],
  });

  const typeLabel = useCallback((type: QuestionType) => t(`school.teach.types.${type}`), [t]);

  const refresh = useCallback(async () => {
    if (!schoolId) return;
    const query = new URLSearchParams();
    if (filter.classLabel) query.set('classLabel', filter.classLabel);
    if (filter.subject) query.set('subject', filter.subject);
    if (filter.chapter) query.set('chapter', filter.chapter);
    try {
      const [list, facetData] = await Promise.all([
        schoolFetch<{ questions: BankQuestion[] }>(
          `/api/school/${schoolId}/questions?${query.toString()}`,
        ),
        schoolFetch<{ facets: Facet[] }>(`/api/school/${schoolId}/questions/facets`),
      ]);
      setQuestions(list.questions);
      setFacets(facetData.facets);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('school.error'));
      setQuestions([]);
    }
  }, [schoolId, filter, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!enabled) return <Shell title={t('school.teach.bank')}>{t('school.needsServer')}</Shell>;
  if (!user) {
    router.replace('/login?next=/teach/bank');
    return null;
  }
  if (!school) {
    router.replace('/teach');
    return null;
  }

  const distinct = (key: keyof Facet) =>
    Array.from(new Set(facets.map((f) => String(f[key]))))
      .sort()
      .map((value) => ({ value, label: value }));

  async function generate() {
    if (busy) return;
    setError('');
    setBusy('generate');
    try {
      const data = await schoolFetch<{ questions: QuestionDraft[] }>(
        `/api/school/${schoolId}/questions/generate`,
        { llm: true, body: gen },
      );
      setDrafts(data.questions);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('school.error'));
    } finally {
      setBusy(null);
    }
  }

  async function saveDrafts() {
    if (busy || drafts.length === 0) return;
    setBusy('save');
    setError('');
    try {
      await schoolFetch(`/api/school/${schoolId}/questions`, {
        body: {
          classLabel: gen.classLabel,
          subject: gen.subject,
          chapter: gen.chapter,
          questions: drafts,
        },
      });
      setDrafts([]);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('school.error'));
    } finally {
      setBusy(null);
    }
  }

  async function addManual() {
    if (busy) return;
    const options = manual.options
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const draft = parseQuestionDraft({
      type: manual.type,
      text: manual.text,
      options,
      answer: manual.type === 'mcq' ? Number(manual.answer) - 1 : manual.answer,
      explanation: manual.explanation,
      marks: manual.marks,
      difficulty: manual.difficulty,
    });
    if (!draft) {
      setError(t('school.teach.invalidQuestion'));
      return;
    }
    setBusy('add');
    setError('');
    try {
      await schoolFetch(`/api/school/${schoolId}/questions`, {
        body: {
          classLabel: gen.classLabel,
          subject: gen.subject,
          chapter: gen.chapter,
          questions: [draft],
        },
      });
      setManual((m) => ({ ...m, text: '', options: '', explanation: '' }));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('school.error'));
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    try {
      await schoolFetch(`/api/school/${schoolId}/questions/${id}`, { method: 'DELETE' });
      setQuestions((list) => list?.filter((q) => q.id !== id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('school.error'));
    }
  }

  const tagsReady = gen.subject.trim().length > 0 && gen.chapter.trim().length > 0;

  return (
    <Shell
      title={t('school.teach.bank')}
      back={() => router.push('/teach')}
      icon={<Library className="h-5 w-5 text-primary" />}
    >
      <Section title={t('school.teach.generateTitle')}>
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="text-xs text-muted-foreground">
            {t('school.teach.board')}
            <SelectField
              className="mt-1 w-full"
              value={gen.board}
              onChange={(board) => setGen((g) => ({ ...g, board }))}
              options={BOARDS}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            {t('school.teach.classLabel')}
            <SelectField
              className="mt-1 w-full"
              value={gen.classLabel}
              onChange={(classLabel) => setGen((g) => ({ ...g, classLabel }))}
              options={CLASS_OPTIONS}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            {t('school.teach.subject')}
            <Input
              className="mt-1"
              value={gen.subject}
              onChange={(e) => setGen((g) => ({ ...g, subject: e.target.value }))}
              placeholder="Mathematics"
            />
          </label>
          <label className="text-xs text-muted-foreground">
            {t('school.teach.chapter')}
            <Input
              className="mt-1"
              value={gen.chapter}
              onChange={(e) => setGen((g) => ({ ...g, chapter: e.target.value }))}
              placeholder="Linear Equations in One Variable"
            />
          </label>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <label className="text-xs text-muted-foreground">
            {t('school.teach.language')}
            <SelectField
              className="mt-1 w-full"
              value={gen.language}
              onChange={(language) => setGen((g) => ({ ...g, language }))}
              options={PAPER_LANGUAGES}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            {t('school.teach.count')}
            <Input
              className="mt-1"
              type="number"
              min={1}
              max={30}
              value={gen.count}
              onChange={(e) => setGen((g) => ({ ...g, count: Number(e.target.value) || 5 }))}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            {t('school.teach.difficulty')}
            <SelectField
              className="mt-1 w-full"
              value={gen.difficulty}
              onChange={(difficulty) => setGen((g) => ({ ...g, difficulty }))}
              options={[
                { value: 'mixed', label: t('school.teach.mixed') },
                { value: 'easy', label: t('school.teach.easier') },
                { value: 'medium', label: t('school.teach.balanced') },
                { value: 'hard', label: t('school.teach.harder') },
              ]}
            />
          </label>
          <div className="text-xs text-muted-foreground">
            {t('school.teach.typesLabel')}
            <div className="mt-1 flex flex-wrap gap-1">
              {QUESTION_TYPES.map((type) => {
                const on = gen.types.includes(type);
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() =>
                      setGen((g) => ({
                        ...g,
                        types: on ? g.types.filter((x) => x !== type) : [...g.types, type],
                      }))
                    }
                    className={`rounded-full border px-2 py-0.5 text-xs ${
                      on
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground'
                    }`}
                  >
                    {typeLabel(type)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <Button
          className="mt-4"
          disabled={!tagsReady || busy !== null || gen.types.length === 0}
          onClick={generate}
        >
          {busy === 'generate' ? (
            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          {t('school.teach.generateQuestions')}
        </Button>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

        {drafts.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{t('school.teach.preview')}</p>
              <Button size="sm" onClick={saveDrafts} disabled={busy !== null}>
                {busy === 'save' && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
                {t('school.teach.saveSelected', { count: drafts.length })}
              </Button>
            </div>
            {drafts.map((draft, index) => (
              <QuestionCard
                key={index}
                question={draft}
                typeLabel={typeLabel(draft.type)}
                action={
                  <button
                    type="button"
                    className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setDrafts((list) => list.filter((_, i) => i !== index))}
                    aria-label={t('school.teach.discard')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                }
              />
            ))}
          </div>
        )}
      </Section>

      <Section title={t('school.teach.manualTitle')}>
        <p className="mb-2 text-xs text-muted-foreground">{t('school.teach.manualHint')}</p>
        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
          <SelectField
            ariaLabel={t('school.teach.type')}
            value={manual.type}
            onChange={(type) => setManual((m) => ({ ...m, type: type as QuestionType }))}
            options={QUESTION_TYPES.map((type) => ({ value: type, label: typeLabel(type) }))}
          />
          <Input
            value={manual.text}
            onChange={(e) => setManual((m) => ({ ...m, text: e.target.value }))}
            placeholder={t('school.teach.questionText')}
          />
        </div>
        {manual.type === 'mcq' && (
          <Textarea
            className="mt-2 min-h-[80px]"
            value={manual.options}
            onChange={(e) => setManual((m) => ({ ...m, options: e.target.value }))}
            placeholder={t('school.teach.optionsPlaceholder')}
          />
        )}
        <div className="mt-2 grid gap-2 sm:grid-cols-4">
          {manual.type === 'true_false' ? (
            <SelectField
              ariaLabel={t('school.teach.answer')}
              value={manual.answer === 'False' ? 'False' : 'True'}
              onChange={(answer) => setManual((m) => ({ ...m, answer }))}
              options={['True', 'False']}
            />
          ) : (
            <Input
              value={manual.answer}
              onChange={(e) => setManual((m) => ({ ...m, answer: e.target.value }))}
              placeholder={
                manual.type === 'mcq' ? t('school.teach.correctOption') : t('school.teach.answer')
              }
            />
          )}
          <Input
            value={manual.explanation}
            onChange={(e) => setManual((m) => ({ ...m, explanation: e.target.value }))}
            placeholder={t('school.teach.explanation')}
          />
          <Input
            type="number"
            min={1}
            max={20}
            value={manual.marks}
            onChange={(e) => setManual((m) => ({ ...m, marks: Number(e.target.value) || 1 }))}
            aria-label={t('school.teach.marksEach')}
          />
          <SelectField
            ariaLabel={t('school.teach.difficulty')}
            value={manual.difficulty}
            onChange={(difficulty) =>
              setManual((m) => ({ ...m, difficulty: difficulty as (typeof DIFFICULTIES)[number] }))
            }
            options={DIFFICULTIES}
          />
        </div>
        <Button
          className="mt-3"
          variant="outline"
          disabled={!tagsReady || busy !== null || !manual.text.trim()}
          onClick={addManual}
        >
          {busy === 'add' ? (
            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          {t('school.teach.add')}
        </Button>
      </Section>

      <Section
        title={t('school.teach.bank')}
        action={
          <div className="flex flex-wrap gap-2">
            <SelectField
              ariaLabel={t('school.teach.classLabel')}
              value={filter.classLabel}
              onChange={(classLabel) => setFilter((f) => ({ ...f, classLabel }))}
              options={[{ value: '', label: t('school.teach.all') }, ...distinct('classLabel')]}
            />
            <SelectField
              ariaLabel={t('school.teach.subject')}
              value={filter.subject}
              onChange={(subject) => setFilter((f) => ({ ...f, subject }))}
              options={[{ value: '', label: t('school.teach.all') }, ...distinct('subject')]}
            />
            <SelectField
              ariaLabel={t('school.teach.chapter')}
              value={filter.chapter}
              onChange={(chapter) => setFilter((f) => ({ ...f, chapter }))}
              options={[{ value: '', label: t('school.teach.all') }, ...distinct('chapter')]}
            />
          </div>
        }
      >
        {questions === null ? (
          <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : questions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('school.teach.noQuestions')}</p>
        ) : (
          <div className="space-y-2">
            {questions.map((question) => (
              <div key={question.id}>
                <p className="mb-1 text-xs text-muted-foreground">
                  {question.classLabel} · {question.subject} · {question.chapter}
                </p>
                <QuestionCard
                  question={question}
                  typeLabel={typeLabel(question.type)}
                  action={
                    <button
                      type="button"
                      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => remove(question.id)}
                      aria-label={t('school.teach.delete')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  }
                />
              </div>
            ))}
          </div>
        )}
      </Section>
    </Shell>
  );
}
