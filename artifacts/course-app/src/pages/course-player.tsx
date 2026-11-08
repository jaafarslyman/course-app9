import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  LockKeyhole,
  RefreshCw,
} from 'lucide-react';
import { Link, useParams } from 'wouter';
import {
  AppShell,
  EmptyState,
  InlineAlert,
  LoadingState,
  PageHeading,
} from '@/components/app-shell';
import {
  learnerCourseQueryKey,
  useLearnerCourses,
  useSaveLearnerProgress,
} from '@/lib/course-api';
import { readLearnerSession } from '@/lib/learner-session';
import { useCreateCourseMediaSignedUrl } from '@/lib/media-api';
import type { Course, CourseContentItem, CourseContentKind } from '@/lib/course-types';
import './course-pages.css';

const kindLabels: Record<CourseContentKind, string> = {
  video: 'فيديو',
  image: 'صورة',
  text: 'نص تعليمي',
  note: 'ملاحظة',
  audio: 'صوت',
};

type FlatItem = {
  item: CourseContentItem;
  group: string;
  levelId?: string;
  sectionId?: string;
};

function flattenCourse(course: Course): FlatItem[] {
  const result: FlatItem[] = [];
  [...course.items].sort((a, b) => a.sortOrder - b.sortOrder).forEach((item) => result.push({ item, group: 'مواد الدورة' }));
  [...course.levels].sort((a, b) => a.sortOrder - b.sortOrder).forEach((level) => {
    [...level.items].sort((a, b) => a.sortOrder - b.sortOrder).forEach((item) => result.push({ item, group: level.title, levelId: level.id }));
    [...level.sections].sort((a, b) => a.sortOrder - b.sortOrder).forEach((section) => {
      [...section.items].sort((a, b) => a.sortOrder - b.sortOrder).forEach((item) => result.push({ item, group: `${level.title} · ${section.title}`, levelId: level.id, sectionId: section.id }));
    });
  });
  return result;
}

function updateItemProgress(
  courses: Course[],
  contentId: string,
  positionSeconds: number,
  durationSeconds: number | null,
  markDone: boolean,
): Course[] {
  const now = new Date().toISOString();
  const patchItems = (items: CourseContentItem[]) => items.map((item) => {
    if (item.id !== contentId) return item;
    const completed = markDone || Boolean(item.progress?.completed);
    return {
      ...item,
      progress: {
        positionSeconds,
        durationSeconds,
        progressPercent: completed ? 100 : durationSeconds ? Math.min(100, Math.round(positionSeconds / durationSeconds * 100)) : item.progress?.progressPercent ?? 0,
        completed,
        completedAt: markDone ? now : item.progress?.completedAt ?? null,
        updatedAt: now,
      },
    };
  });
  return courses.map((course) => ({
    ...course,
    items: patchItems(course.items),
    levels: course.levels.map((level) => ({
      ...level,
      items: patchItems(level.items),
      sections: level.sections.map((section) => ({ ...section, items: patchItems(section.items) })),
    })),
  }));
}

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

export function LearnerContentViewerPage() {
  const { courseId, levelId, sectionId, contentId } = useParams<{
    courseId?: string;
    levelId?: string;
    sectionId?: string;
    contentId?: string;
  }>();
  const query = useLearnerCourses();
  const queryClient = useQueryClient();
  const saveProgress = useSaveLearnerProgress();
  const secret = readLearnerSession();
  const signedMedia = useCreateCourseMediaSignedUrl();
  const signedThumbnailMedia = useCreateCourseMediaSignedUrl();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSavedPosition = useRef(-1);
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaForItem, setMediaForItem] = useState('');
  const [posterUrl, setPosterUrl] = useState('');
  const [mediaError, setMediaError] = useState('');
  const [savingError, setSavingError] = useState('');

  const courses = useMemo(() => [...(query.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder), [query.data]);
  const course = courseId ? courses.find((entry) => entry.id === courseId) : courses[0];
  const flatItems = useMemo(() => course ? flattenCourse(course) : [], [course]);
  const currentFlat = contentId
    ? flatItems.find(({ item, levelId: itemLevelId, sectionId: itemSectionId }) => (
      item.id === contentId &&
      (sectionId
        ? itemLevelId === levelId && itemSectionId === sectionId
        : levelId
          ? itemLevelId === levelId && !itemSectionId
          : !itemLevelId && !itemSectionId)
    ))
    : undefined;
  const selected = currentFlat?.item;
  const level = course?.levels.find((entry) => entry.id === levelId);
  const section = level?.sections.find((entry) => entry.id === sectionId);
  const courseHref = course ? `/learn/course/${encodeURIComponent(course.id)}` : '/learn/course';
  const levelHref = level
    ? `${courseHref}/level/${encodeURIComponent(level.id)}`
    : courseHref;
  const sectionHref = section
    ? `${levelHref}/section/${encodeURIComponent(section.id)}`
    : levelHref;
  const backHref = section ? sectionHref : level ? levelHref : courseHref;

  useEffect(() => {
    setMediaUrl('');
    setMediaForItem('');
    setPosterUrl('');
    setMediaError('');
    setSavingError('');
    lastSavedPosition.current = -1;
    if (!contentId || !selected || !['video', 'audio', 'image'].includes(selected.kind)) return;
    if (!secret) {
      setMediaError('انتهت جلسة التعلّم. سجّل الدخول مجددًا لفتح هذا المحتوى.');
      return;
    }
    let cancelled = false;
    signedMedia.mutateAsync({
      data: { contentId: selected.id, learnerSessionSecret: secret, mediaType: 'content' },
    }).then((result) => {
      if (!cancelled) {
        setMediaUrl(result.signedUrl);
        setMediaForItem(selected.id);
      }
    }).catch(() => {
      if (!cancelled) setMediaError('تعذّر فتح الملف المحمي. تحقق من اتصالك ثم حاول مجددًا.');
    });
    if (selected.kind === 'video' && selected.hasThumbnail) {
      signedThumbnailMedia.mutateAsync({
        data: { contentId: selected.id, learnerSessionSecret: secret, mediaType: 'thumbnail' },
      }).then((result) => {
        if (!cancelled) setPosterUrl(result.signedUrl);
      }).catch(() => {
        if (!cancelled) setPosterUrl('');
      });
    }
    return () => { cancelled = true; };
  }, [contentId, selected?.id, selected?.kind, selected?.storagePath, selected?.hasThumbnail, secret]);

  const savePosition = useCallback((positionSeconds: number, durationSeconds: number | null, markDone = false) => {
    if (!selected) return;
    if (!markDone && Math.abs(positionSeconds - lastSavedPosition.current) < 8) return;
    lastSavedPosition.current = positionSeconds;
    saveProgress.mutate({ contentId: selected.id, positionSeconds, durationSeconds, markDone }, {
      onError: () => setSavingError('تعذّر حفظ التقدم الآن. سيُحفظ عند المحاولة التالية.'),
      onSuccess: () => {
        setSavingError('');
        queryClient.setQueryData<Course[]>(learnerCourseQueryKey, (old) => old ? updateItemProgress(old, selected.id, positionSeconds, durationSeconds, markDone) : old);
      },
    });
  }, [selected?.id, saveProgress.mutate, queryClient]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return;
      videoRef.current?.pause();
      audioRef.current?.pause();
      const media = videoRef.current ?? audioRef.current;
      if (media && selected) savePosition(media.currentTime, Number.isFinite(media.duration) ? media.duration : selected.durationSeconds, false);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [selected?.id, savePosition]);

  function markComplete(item: CourseContentItem) {
    const media = item.id === selected?.id ? videoRef.current ?? audioRef.current : null;
    const duration = media && Number.isFinite(media.duration) ? media.duration : item.durationSeconds;
    const position = duration ?? item.progress?.positionSeconds ?? 0;
    saveProgress.mutate({ contentId: item.id, positionSeconds: position, durationSeconds: duration, markDone: true }, {
      onError: () => setSavingError('لم يتم حفظ الإكمال. حاول مرة أخرى.'),
      onSuccess: () => {
        setSavingError('');
        queryClient.setQueryData<Course[]>(learnerCourseQueryKey, (old) => old ? updateItemProgress(old, item.id, position, duration, true) : old);
      },
    });
  }

  function retryMedia() {
    if (!selected || !secret) return;
    setMediaError('');
    setMediaUrl('');
    setMediaForItem('');
    setPosterUrl('');
    signedMedia.mutateAsync({ data: { contentId: selected.id, learnerSessionSecret: secret, mediaType: 'content' } })
      .then((result) => {
        setMediaUrl(result.signedUrl);
        setMediaForItem(selected.id);
      })
      .catch(() => setMediaError('تعذّر فتح الملف المحمي. حاول مرة أخرى.'));
    if (selected.kind === 'video' && selected.hasThumbnail) {
      signedThumbnailMedia.mutateAsync({ data: { contentId: selected.id, learnerSessionSecret: secret, mediaType: 'thumbnail' } })
        .then((result) => setPosterUrl(result.signedUrl))
        .catch(() => setPosterUrl(''));
    }
  }

  if (query.isLoading) {
    return <AppShell title="دورتي" audience="learner"><div className="course-pages" dir="rtl"><div className="course-skeleton" /><div className="course-skeleton" /><LoadingState label="جارٍ تجهيز مسارك التعليمي…" /></div></AppShell>;
  }

  if (query.isError) {
    return <AppShell title="دورتي" audience="learner"><div className="course-pages" dir="rtl"><PageHeading eyebrow="رحلتك التعليمية" title="دورتي" subtitle="سنحاول تحميل محتواك مرة أخرى." /><section className="panel"><EmptyState title="تعذّر تحميل الدورة" description="تحقق من اتصالك ثم أعد تحميل محتوى الدورة." icon={BookOpen} /><div className="empty-state-action"><button type="button" className="button-soft" onClick={() => void query.refetch()}><RefreshCw size={15} /> إعادة المحاولة</button></div></section></div></AppShell>;
  }

  const isValidSelection = Boolean(course && selected && contentId);
  const isVideoContent = selected?.kind === 'video';
  const mediaIsReady = Boolean(selected && mediaUrl && mediaForItem === selected.id);

  return (
    <AppShell
      title={selected?.title ?? 'المادة'}
      audience="learner"
      fullScreen={isVideoContent}
    >
      <div
        className={`course-pages${isVideoContent ? ' course-video-screen' : ''}`}
        dir="rtl"
      >
        {!isValidSelection || !course || !selected ? (
          <section className="panel">
            <EmptyState
              title="المادة غير متاحة"
              description="قد يكون المحتوى قد تغيّر. ارجع إلى المسار واختر مادة متاحة."
              icon={BookOpen}
            />
            <div className="empty-state-action">
              <Link className="button-primary" href={backHref}>العودة إلى المسار</Link>
            </div>
          </section>
        ) : (
          <>
            {!isVideoContent ? (
              <>
                <nav className="course-breadcrumbs learner-viewer-breadcrumbs" aria-label="مسار المادة">
                  <Link href="/learn/course">دوراتي</Link>
                  <ChevronLeft size={14} aria-hidden="true" />
                  <Link href={courseHref}>{course.name}</Link>
                  {level ? (
                    <>
                      <ChevronLeft size={14} aria-hidden="true" />
                      <Link href={levelHref}>{level.title}</Link>
                    </>
                  ) : null}
                  {section ? (
                    <>
                      <ChevronLeft size={14} aria-hidden="true" />
                      <Link href={sectionHref}>{section.title}</Link>
                    </>
                  ) : null}
                  <ChevronLeft size={14} aria-hidden="true" />
                  <span>{selected.title}</span>
                </nav>
                <PageHeading
                  eyebrow={`${currentFlat?.group ?? 'محتوى الدورة'} · ${kindLabels[selected.kind]}`}
                  title={selected.title}
                  subtitle="تابع المادة هنا، وسيُحفظ تقدمك أثناء التعلّم."
                />
                {savingError && <InlineAlert>{savingError}</InlineAlert>}
              </>
            ) : null}
            <div
              className={`learner-content-layout learner-viewer-layout${isVideoContent ? ' learner-video-layout' : ''}`}
              onCopy={(event) => event.preventDefault()}
              onCut={(event) => event.preventDefault()}
              onDragStart={(event) => event.preventDefault()}
            >
              <section className={`panel learner-material${isVideoContent ? ' learner-video-material' : ''}`}>
                {!isVideoContent ? (
                  <div className="learner-material-header">
                    <div>
                      <div className="eyebrow">{kindLabels[selected.kind]}</div>
                      <h2>{selected.title}</h2>
                    </div>
                    {selected.progress?.completed ? (
                      <span className="course-status"><Check size={14} /> مكتملة</span>
                    ) : null}
                  </div>
                ) : null}
                {['video', 'audio', 'image'].includes(selected.kind) ? (
                  mediaError ? (
                    <div className="learner-media-frame">
                      <div className="learner-media-placeholder">
                        <LockKeyhole size={25} />
                        <strong>{mediaError}</strong>
                        <button type="button" className="button-soft" onClick={retryMedia}>
                          <RefreshCw size={14} /> إعادة المحاولة
                        </button>
                      </div>
                    </div>
                  ) : !mediaIsReady ? (
                    <div className="learner-media-frame">
                      <div className="learner-media-placeholder">
                        <LockKeyhole size={23} />
                        <strong>جارٍ فتح المحتوى بأمان…</strong>
                      </div>
                    </div>
                  ) : (
                    <div className="learner-media-frame" onContextMenu={(event) => event.preventDefault()}>
                      {selected.kind === 'video' ? (
                        <video
                          ref={videoRef}
                          src={mediaUrl}
                          poster={posterUrl || undefined}
                          controls
                          controlsList="nodownload noremoteplayback"
                          disablePictureInPicture
                          disableRemotePlayback
                          playsInline
                          preload="metadata"
                          onLoadedMetadata={(event) => {
                            const progress = selected.progress?.positionSeconds ?? 0;
                            if (progress > 0) event.currentTarget.currentTime = progress;
                          }}
                          onTimeUpdate={(event) => savePosition(
                            event.currentTarget.currentTime,
                            Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : null,
                          )}
                          onPause={(event) => savePosition(
                            event.currentTarget.currentTime,
                            Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : null,
                          )}
                          onEnded={(event) => savePosition(
                            event.currentTarget.duration,
                            event.currentTarget.duration,
                            true,
                          )}
                        />
                      ) : null}
                      {selected.kind === 'audio' ? (
                        <audio
                          ref={audioRef}
                          src={mediaUrl}
                          controls
                          controlsList="nodownload noremoteplayback"
                          preload="metadata"
                          onLoadedMetadata={(event) => {
                            const progress = selected.progress?.positionSeconds ?? 0;
                            if (progress > 0) event.currentTarget.currentTime = progress;
                          }}
                          onTimeUpdate={(event) => savePosition(
                            event.currentTarget.currentTime,
                            Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : null,
                          )}
                          onPause={(event) => savePosition(
                            event.currentTarget.currentTime,
                            Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : null,
                          )}
                          onEnded={(event) => savePosition(
                            event.currentTarget.duration,
                            event.currentTarget.duration,
                            true,
                          )}
                        />
                      ) : null}
                      {selected.kind === 'image' ? (
                        <img src={mediaUrl} alt={selected.title} draggable={false} />
                      ) : null}
                    </div>
                  )
                ) : (
                  <div className="learner-material-body">
                    {selected.body || 'ابدأ بالقراءة بهدوء، ثم علّم المادة مكتملة عندما تنتهي.'}
                  </div>
                )}
                {isVideoContent ? (
                  <div className="learner-material-header learner-video-title">
                    <div>
                      <div className="eyebrow">
                        {currentFlat?.group ?? 'محتوى الدورة'} · {kindLabels[selected.kind]}
                      </div>
                      <h2>{selected.title}</h2>
                    </div>
                    {selected.progress?.completed ? (
                      <span className="course-status"><Check size={14} /> مكتملة</span>
                    ) : null}
                  </div>
                ) : null}
                {isVideoContent && savingError ? <InlineAlert>{savingError}</InlineAlert> : null}
                {selected.supplementalNote?.trim() ? (
                  <aside className="learner-supplemental-note">
                    <strong>ملاحظة إضافية</strong>
                    <p>{selected.supplementalNote}</p>
                  </aside>
                ) : null}
                {selected.kind === 'video' && selected.progress?.positionSeconds ? (
                  <p className="course-muted-note">
                    آخر موضع وصلت إليه: {formatTime(selected.progress.positionSeconds)}
                    {selected.progress.durationSeconds
                      ? ` من ${formatTime(selected.progress.durationSeconds)}`
                      : ''}
                  </p>
                ) : null}
                <div className="learner-material-actions">
                  <span className="course-muted-note">تعلّم بترتيبك، وتقدّمك محفوظ تلقائيًا.</span>
                  <button
                    type="button"
                    className={`button-primary learner-done-button ${selected.progress?.completed ? 'done' : ''}`}
                    disabled={saveProgress.isPending}
                    onClick={() => markComplete(selected)}
                  >
                    {selected.progress?.completed ? (
                      <><CheckCircle2 size={16} /> مكتملة</>
                    ) : (
                      <><Check size={16} /> علّمها مكتملة</>
                    )}
                  </button>
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
