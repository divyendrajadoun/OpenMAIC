'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CircleStop, LoaderCircle, RotateCcw, Upload, Video } from 'lucide-react';

import { Section } from '@/components/school/shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { useI18n } from '@/lib/hooks/use-i18n';
import { schoolFetch } from '@/lib/school/api-headers';
import { UPLOAD_MAX_BYTES, type SchoolAvatar } from '@/lib/school/avatar-types';
import { cn } from '@/lib/utils';

/** HeyGen trains from 15 s to 10 min of footage; two minutes gives the best twin. */
const MIN_SECONDS = 15;
const MAX_SECONDS = 180;
const RECOMMENDED_SECONDS = 120;

type Step = 'idle' | 'camera' | 'recording' | 'review' | 'uploading' | 'done';

function pickMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Record (or upload) two minutes of footage and train a digital twin from it. */
export function TwinRecorder({
  schoolId,
  defaultName,
  onCreated,
}: {
  schoolId: string;
  defaultName: string;
  onCreated: (avatar: SchoolAvatar) => void;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>('idle');
  const [scriptLang, setScriptLang] = useState<'hi' | 'en'>('hi');
  const [seconds, setSeconds] = useState(0);
  const [footage, setFootage] = useState<{ blob: Blob; url: string; name: string } | null>(null);
  const [name, setName] = useState(defaultName);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  const previewRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (previewRef.current) previewRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      stopStream();
    };
  }, [stopStream]);

  useEffect(() => {
    return () => {
      if (footage) URL.revokeObjectURL(footage.url);
    };
  }, [footage]);

  const startCamera = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      setStep('camera');
      // The preview element mounts with the step change; attach on the next frame.
      requestAnimationFrame(() => {
        if (previewRef.current) {
          previewRef.current.srcObject = stream;
          void previewRef.current.play().catch(() => {});
        }
      });
    } catch {
      setError(t('school.avatar.cameraDenied'));
    }
  };

  const stopRecording = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream) return;
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 2_500_000,
    });
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const type = recorder.mimeType || mimeType || 'video/webm';
      const blob = new Blob(chunksRef.current, { type });
      const extension = type.includes('mp4') ? 'mp4' : 'webm';
      setFootage({ blob, url: URL.createObjectURL(blob), name: `twin-footage.${extension}` });
      stopStream();
      setStep('review');
    };
    recorderRef.current = recorder;
    recorder.start(1000);
    setSeconds(0);
    setStep('recording');
    timerRef.current = setInterval(() => {
      setSeconds((current) => {
        if (current + 1 >= MAX_SECONDS) stopRecording();
        return current + 1;
      });
    }, 1000);
  };

  const chooseFile = (file: File | undefined) => {
    if (!file) return;
    setError('');
    if (file.size > UPLOAD_MAX_BYTES) {
      setError(t('school.avatar.fileTooLarge'));
      return;
    }
    stopStream();
    setFootage({ blob: file, url: URL.createObjectURL(file), name: file.name });
    setSeconds(0);
    setStep('review');
  };

  const retake = () => {
    setFootage(null);
    setSeconds(0);
    setError('');
    setStep('idle');
  };

  const build = async () => {
    if (!footage) return;
    setStep('uploading');
    setProgress(0);
    setError('');
    try {
      const contentType = footage.blob.type.split(';')[0] || 'video/webm';
      const opened = await schoolFetch<{ uploadId: string; chunkBytes: number }>(
        `/api/school/${schoolId}/avatars/upload`,
        { body: { filename: footage.name, contentType, sizeBytes: footage.blob.size } },
      );
      const total = Math.ceil(footage.blob.size / opened.chunkBytes);
      for (let index = 0; index < total; index++) {
        const chunk = footage.blob.slice(
          index * opened.chunkBytes,
          (index + 1) * opened.chunkBytes,
        );
        const res = await fetch(
          `/api/school/${schoolId}/avatars/upload/${opened.uploadId}?index=${index}`,
          { method: 'PUT', body: chunk, headers: { 'Content-Type': 'application/octet-stream' } },
        );
        if (!res.ok) throw new Error(`${t('school.avatar.uploadFailed')} (${res.status})`);
        setProgress(Math.round(((index + 1) / total) * 90));
      }
      const created = await schoolFetch<{ avatar: SchoolAvatar }>(
        `/api/school/${schoolId}/avatars/twin`,
        { body: { uploadId: opened.uploadId, name: name.trim() || defaultName } },
      );
      setProgress(100);
      onCreated(created.avatar);
      setStep('done');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStep('review');
    }
  };

  const tooShort = step === 'review' && footage && seconds > 0 && seconds < MIN_SECONDS;

  return (
    <Section title={t('school.avatar.createTitle')}>
      <p className="text-sm text-muted-foreground">{t('school.avatar.createHint')}</p>

      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="relative aspect-video overflow-hidden rounded-xl bg-slate-900 ring-1 ring-black/10">
          {(step === 'camera' || step === 'recording') && (
            <video
              ref={previewRef}
              muted
              playsInline
              autoPlay
              className="h-full w-full -scale-x-100 object-cover"
            />
          )}
          {(step === 'review' || step === 'uploading' || step === 'done') && footage && (
            <video
              src={footage.url}
              controls
              playsInline
              className="h-full w-full object-contain"
            />
          )}
          {step === 'idle' && (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-white/80">
              <Camera className="h-10 w-10" />
              <p className="max-w-sm text-sm">{t('school.avatar.idleHint')}</p>
            </div>
          )}
          {step === 'recording' && (
            <div className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              {t('school.avatar.recording')} {formatSeconds(seconds)}
            </div>
          )}
          {step === 'recording' && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
              <div
                className={cn(
                  'h-full transition-[width] duration-1000',
                  seconds < MIN_SECONDS ? 'bg-amber-400' : 'bg-emerald-400',
                )}
                style={{ width: `${Math.min(100, (seconds / RECOMMENDED_SECONDS) * 100)}%` }}
              />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-border/50 bg-muted/30 p-3 text-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium">{t('school.avatar.scriptLabel')}</span>
              <span className="flex gap-1 text-xs">
                {(['hi', 'en'] as const).map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => setScriptLang(lang)}
                    className={cn(
                      'rounded-full px-2 py-0.5',
                      scriptLang === lang ? 'bg-primary text-primary-foreground' : 'bg-muted',
                    )}
                  >
                    {lang === 'hi' ? 'हिन्दी' : 'English'}
                  </button>
                ))}
              </span>
            </div>
            <p className="max-h-40 overflow-y-auto leading-relaxed text-foreground/90">
              {t(scriptLang === 'hi' ? 'school.avatar.scriptHindi' : 'school.avatar.scriptEnglish')}
            </p>
          </div>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>• {t('school.avatar.tipLight')}</li>
            <li>• {t('school.avatar.tipFrame')}</li>
            <li>• {t('school.avatar.tipSpeak')}</li>
          </ul>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      {tooShort && <p className="mt-3 text-sm text-amber-700">{t('school.avatar.tooShort')}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {step === 'idle' && (
          <>
            <Button onClick={startCamera}>
              <Camera className="mr-1 h-4 w-4" />
              {t('school.avatar.startCamera')}
            </Button>
            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
              <Upload className="mr-1 h-4 w-4" />
              {t('school.avatar.uploadInstead')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/webm,video/quicktime"
              className="hidden"
              onChange={(e) => chooseFile(e.target.files?.[0])}
            />
          </>
        )}
        {step === 'camera' && (
          <Button onClick={startRecording} className="bg-red-600 text-white hover:bg-red-700">
            <Video className="mr-1 h-4 w-4" />
            {t('school.avatar.record')}
          </Button>
        )}
        {step === 'recording' && (
          <Button onClick={stopRecording} variant="outline">
            <CircleStop className="mr-1 h-4 w-4" />
            {t('school.avatar.stop')} · {formatSeconds(seconds)}
          </Button>
        )}
        {step === 'review' && (
          <>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('school.avatar.twinName')}
              className="w-56"
              maxLength={60}
            />
            <Button onClick={build} disabled={!!tooShort}>
              {t('school.avatar.build')}
            </Button>
            <Button variant="ghost" onClick={retake}>
              <RotateCcw className="mr-1 h-4 w-4" />
              {t('school.avatar.retake')}
            </Button>
          </>
        )}
        {step === 'uploading' && (
          <div className="flex w-full max-w-md items-center gap-3 text-sm">
            <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />
            <Progress value={progress} className="flex-1" />
            <span className="text-muted-foreground">
              {progress < 90
                ? t('school.avatar.uploading', { percent: progress })
                : t('school.avatar.training')}
            </span>
          </div>
        )}
        {step === 'done' && (
          <div className="text-sm">
            <p className="font-medium text-emerald-700 dark:text-emerald-300">
              {t('school.avatar.built')}
            </p>
            <p className="text-muted-foreground">{t('school.avatar.consentNext')}</p>
            <Button variant="ghost" size="sm" className="mt-1" onClick={retake}>
              {t('school.avatar.recordAnother')}
            </Button>
          </div>
        )}
      </div>
    </Section>
  );
}
