import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronLeft,
  FileAudio2,
  FileImage,
  FileText,
  FolderClosed,
  Layers3,
  Play,
  Video,
} from 'lucide-react';
import { Link, useParams } from 'wouter';
import { useCreateCourseMediaSignedUrl } from '@/lib/media-api';
import { captureVideoPosterFrame } from '@/lib/video-thumbnail';
import { LearnerCourseCard } from '@/components/learner-course-card';
import {
  AppShell,
  EmptyState,
  LoadingState,
  PageHeading,
} from '@/components/app-shell';
import { useLearnerCourses } from '@/lib/course-api';
import { readLearnerSession } from '@/lib/learner-session';
import type {
  Course,
  CourseContentItem,
  CourseContentKind,
  CourseLevel,
  CourseSection,
} from '@/lib/course-types';
import './course-pages.css';

const kindLabels: Record<CourseContentKind, string> = {
  video: 'فيديو',
  image: 'صورة',
  text: 'نص تعليمي',
  note: 'ملاحظة',
  audio: 'صوت',
};

const kindIcons = {
  video: Video,
  image: FileImage,
  text: FileText,
  note: FileText,
  audio: FileAudio2,
};

type CatalogParams = {
  courseId?: string;
  levelId?: string;
  sectionId?: string;
};

function ordered<T extends { sortOrder: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder);
}

function formatCount(value: number) {
  return new Intl.NumberFormat('ar').format(value);
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${formatCount(Math.floor(safe / 60))}:${String(safe % 60).padStart(2, '0')}`;
}

function getLevelItems(level: CourseLevel): CourseContentItem[] {
  return [
    ...ordered(level.items),
    ...ordered(level.sections).flatMap((section) => ordered(section.items)),
  ];
}

function getCompletedCount(items: CourseContentItem[]) {
  return items.filter((item) => item.progress?.completed).length;
}

function getProgress(items: CourseContentItem[]) {
  return items.length
    ? Math.round((getCompletedCount(items) / items.length) * 100)
    : 0;
}

function encodeSegment(value: string) {
  return encodeURIComponent(value);
}

function getContentHref(
  courseId: string,
  itemId: string,
  levelId?: string,
  sectionId?: string,
) {
  const base = `/learn/course/${encodeSegment(courseId)}`;
  if (levelId && sectionId) {
    return `${base}/level/${encodeSegment(levelId)}/section/${encodeSegment(sectionId)}/content/${encodeSegment(itemId)}`;
  }
  if (levelId) {
    return `${base}/level/${encodeSegment(levelId)}/content/${encodeSegment(itemId)}`;
  }
  return `${base}/content/${encodeSegment(itemId)}`;
}

function VideoThumbnail({ item }: { item: CourseContentItem }) {
  const signedUrlMutation = useCreateCourseMediaSignedUrl();
  const thumbnailRef = useRef<HTMLDivElement | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [isVisible, setIsVisible] = useState(false);
  const [thumbnailStatus, setThumbnailStatus] = useState<
    'loading' | 'ready' | 'unavailable'
  >('loading');

  useEffect(() => {
    const element = thumbnailRef.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '180px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    const controller = new AbortController();
    setThumbnailUrl('');

    const learnerSessionSecret = readLearnerSession();
    if (!learnerSessionSecret) {
      setThumbnailStatus('unavailable');
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    setThumbnailStatus('loading');
    signedUrlMutation.mutateAsync({
      data: {
        contentId: item.id,
        learnerSessionSecret,
        mediaType:
          item.hasThumbnail && item.thumbnailStoragePath
            ? 'thumbnail'
            : 'content',
      },
    }).then(async (result) => {
      if (cancelled) return;
      const url =
        item.hasThumbnail && item.thumbnailStoragePath
          ? result.signedUrl
          : await captureVideoPosterFrame(result.signedUrl, controller.signal);
      if (cancelled) return;
      setThumbnailUrl(url);
      setThumbnailStatus('ready');
    }).catch(() => {
      if (!cancelled && !controller.signal.aborted) {
        setThumbnailStatus('unavailable');
      }
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    isVisible,
    item.id,
    item.hasThumbnail,
    item.thumbnailStoragePath,
    signedUrlMutation.mutateAsync,
  ]);

  return (
    <div ref={thumbnailRef} className="learner-video-thumbnail">
      {thumbnailStatus === 'ready' && thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt=""
          loading="lazy"
          onError={() => setThumbnailStatus('unavailable')}
        />
      ) : (
        <div className="learner-video-thumbnail-fallback">
          <Video size={25} aria-hidden="true" />
          <span>
            {thumbnailStatus === 'loading'
              ? 'جارٍ تجهيز معاينة الفيديو'
              : 'تعذّر تجهيز معاينة الفيديو'}
          </span>
        </div>
      )}
      <span className="learner-video-play" aria-hidden="true">
        <Play size={17} fill="currentColor" />
      </span>
      {item.durationSeconds ? (
        <span className="learner-video-duration">
          {formatDuration(item.durationSeconds)}
        </span>
      ) : null}
    </div>
  );
}

function ContentCard({
  courseId,
  item,
  levelId,
  sectionId,
}: {
  courseId: string;
  item: CourseContentItem;
  levelId?: string;
  sectionId?: string;
}) {
  const Icon = kindIcons[item.kind];

  return (
    <Link
      className={`panel learner-content-card learner-content-card-${item.kind}`}
      href={getContentHref(courseId, item.id, levelId, sectionId)}
      data-testid={`link-content-${item.id}`}
    >
      {item.kind === 'video' ? (
        <VideoThumbnail item={item} />
      ) : (
        <div className={`learner-content-artwork learner-content-artwork-${item.kind}`}>
          <Icon size={28} aria-hidden="true" />
        </div>
      )}
      <div className="learner-content-card-copy">
        <div className="learner-content-card-meta">
          <span>{kindLabels[item.kind]}</span>
          {item.progress?.completed ? (
            <span className="learner-content-completed"><Check size={13} /> مكتمل</span>
          ) : null}
        </div>
        <h3>{item.title}</h3>
      </div>
      <ChevronLeft className="learner-content-card-arrow" size={17} aria-hidden="true" />
    </Link>
  );
}

function LevelCard({
  courseId,
  level,
}: {
  courseId: string;
  level: CourseLevel;
}) {
  const items = getLevelItems(level);
  const percent = getProgress(items);

  return (
    <Link
      className="panel learner-hierarchy-card"
      href={`/learn/course/${encodeSegment(courseId)}/level/${encodeSegment(level.id)}`}
      data-testid={`link-level-${level.id}`}
    >
      <span className="learner-hierarchy-icon learner-level-icon"><Layers3 size={21} aria-hidden="true" /></span>
      <span className="learner-hierarchy-copy">
        <strong>{level.title}</strong>
        <small>
          {level.sections.length
            ? `${formatCount(level.sections.length)} أقسام · ${formatCount(items.length)} مواد`
            : `${formatCount(items.length)} مواد`}
        </small>
      </span>
      <span className="learner-hierarchy-progress">{formatCount(percent)}٪</span>
      <span className="course-progress-track"><span style={{ width: `${percent}%` }} /></span>
      <ChevronLeft className="learner-hierarchy-arrow" size={18} aria-hidden="true" />
    </Link>
  );
}

function SectionCard({
  courseId,
  levelId,
  section,
}: {
  courseId: string;
  levelId: string;
  section: CourseSection;
}) {
  const items = ordered(section.items);
  const percent = getProgress(items);

  return (
    <Link
      className="panel learner-hierarchy-card"
      href={`/learn/course/${encodeSegment(courseId)}/level/${encodeSegment(levelId)}/section/${encodeSegment(section.id)}`}
      data-testid={`link-section-${section.id}`}
    >
      <span className="learner-hierarchy-icon learner-section-icon"><FolderClosed size={20} aria-hidden="true" /></span>
      <span className="learner-hierarchy-copy">
        <strong>{section.title}</strong>
        <small>{formatCount(items.length)} مواد</small>
      </span>
      <span className="learner-hierarchy-progress">{formatCount(percent)}٪</span>
      <span className="course-progress-track"><span style={{ width: `${percent}%` }} /></span>
      <ChevronLeft className="learner-hierarchy-arrow" size={18} aria-hidden="true" />
    </Link>
  );
}

function CatalogBreadcrumbs({
  course,
  level,
  section,
}: {
  course: Course;
  level?: CourseLevel;
  section?: CourseSection;
}) {
  const courseHref = `/learn/course/${encodeSegment(course.id)}`;

  return (
    <nav className="course-breadcrumbs learner-catalog-breadcrumbs" aria-label="مسار الدورة">
      <Link href="/learn/course">دوراتي</Link>
      <ChevronLeft size={14} aria-hidden="true" />
      {level ? (
        <>
          <Link href={courseHref}>{course.name}</Link>
          <ChevronLeft size={14} aria-hidden="true" />
          {section ? (
            <>
              <Link href={`${courseHref}/level/${encodeSegment(level.id)}`}>{level.title}</Link>
              <ChevronLeft size={14} aria-hidden="true" />
              <span>{section.title}</span>
            </>
          ) : <span>{level.title}</span>}
        </>
      ) : <span>{course.name}</span>}
    </nav>
  );
}

function RetryCourses({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="panel">
      <EmptyState
        title="تعذّر تحميل دوراتك"
        description="تحقق من اتصالك ثم حاول تحميل المسار مرة أخرى."
        icon={BookOpen}
      />
      <div className="empty-state-action">
        <button type="button" className="button-soft" onClick={onRetry}>إعادة المحاولة</button>
      </div>
    </section>
  );
}

export function LearnerCourseCatalogPage() {
  const params = useParams<CatalogParams>();
  const courseId = params?.courseId;
  const levelId = params?.levelId;
  const sectionId = params?.sectionId;
  const coursesQuery = useLearnerCourses();
  const courses = useMemo(
    () => ordered(coursesQuery.data ?? []),
    [coursesQuery.data],
  );
  const course = courseId ? courses.find((entry) => entry.id === courseId) : undefined;
  const level = course && levelId
    ? course.levels.find((entry) => entry.id === levelId)
    : undefined;
  const section = level && sectionId
    ? level.sections.find((entry) => entry.id === sectionId)
    : undefined;
  const courseItems = course ? ordered(course.items) : [];
  const levelItems = level ? ordered(level.items) : [];
  const sectionItems = section ? ordered(section.items) : [];

  if (coursesQuery.isLoading) {
    return (
      <AppShell title="دوراتي" audience="learner">
        <div className="course-pages" dir="rtl">
          <div className="course-skeleton" />
          <div className="course-skeleton" />
          <LoadingState label="جارٍ تجهيز مسارك التعليمي…" />
        </div>
      </AppShell>
    );
  }

  if (coursesQuery.isError) {
    return (
      <AppShell title="دوراتي" audience="learner">
        <div className="course-pages" dir="rtl">
          <PageHeading eyebrow="رحلتك التعليمية" title="دوراتي" />
          <RetryCourses onRetry={() => void coursesQuery.refetch()} />
        </div>
      </AppShell>
    );
  }

  if (!courseId) {
    return (
      <AppShell title="دوراتي" audience="learner">
        <div className="course-pages" dir="rtl">
          <PageHeading
            eyebrow="رحلتك التعليمية"
            title="دوراتي"
            subtitle="اختر دورة للانتقال إلى مستوياتها ومحتواها."
          />
          {courses.length ? (
            <div className="learner-hierarchy-grid learner-course-grid">
              {courses.map((entry) => (
                <LearnerCourseCard key={entry.id} course={entry} />
              ))}
            </div>
          ) : (
            <section className="panel">
              <EmptyState
                title="لا توجد دورة متاحة بعد"
                description="ستظهر هنا الدورات المنشورة والمخصصة لحسابك."
                icon={BookOpen}
              />
            </section>
          )}
        </div>
      </AppShell>
    );
  }

  if (!course || (levelId && !level) || (sectionId && !section)) {
    return (
      <AppShell title="دوراتي" audience="learner">
        <div className="course-pages" dir="rtl">
          <PageHeading eyebrow="رحلتك التعليمية" title="المحتوى غير متاح" />
          <section className="panel">
            <EmptyState
              title="تعذّر العثور على هذا المسار"
              description="قد يكون المحتوى قد تغيّر. ارجع إلى دوراتك واختر المسار من جديد."
              icon={BookOpen}
            />
            <div className="empty-state-action">
              <Link className="button-primary" href="/learn/course">العودة إلى دوراتي</Link>
            </div>
          </section>
        </div>
      </AppShell>
    );
  }

  const heading = section?.title ?? level?.title ?? course.name;
  const levelSections = level ? ordered(level.sections) : [];
  const courseLevels = ordered(course.levels);
  const hasCourseContent = courseItems.length > 0;
  const hasLevelContent = levelItems.length > 0;

  return (
    <AppShell title={heading} audience="learner">
      <div className="course-pages" dir="rtl">
        <CatalogBreadcrumbs course={course} level={level} section={section} />
        <PageHeading
          eyebrow={section ? 'محتوى القسم' : level ? 'مستوى الدورة' : 'مسارك الدراسي'}
          title={heading}
          subtitle={
            section
              ? 'اختر مادة لفتحها ومتابعة التعلّم.'
              : level
                ? 'اختر قسمًا أو افتح إحدى مواد هذا المستوى.'
                : 'اختر مستوى أو مادة للمتابعة داخل الدورة.'
          }
        />

        {section ? (
          sectionItems.length ? (
            <div className="learner-content-grid">
              {sectionItems.map((item) => (
                <ContentCard
                  key={item.id}
                  courseId={course.id}
                  item={item}
                  levelId={levelId ?? ''}
                  sectionId={section.id}
                />
              ))}
            </div>
          ) : (
            <section className="panel">
              <EmptyState
                title="لا توجد مواد في هذا القسم بعد"
                description="ستظهر المواد هنا عند إضافتها إلى القسم."
                icon={FileText}
              />
            </section>
          )
        ) : level ? (
          <div className="learner-catalog-sections">
            {levelSections.length ? (
              <section className="learner-catalog-group">
                <h2>أقسام المستوى</h2>
                <div className="learner-hierarchy-grid">
                  {levelSections.map((entry) => (
                    <SectionCard
                      key={entry.id}
                      courseId={course.id}
                      levelId={levelId ?? ''}
                      section={entry}
                    />
                  ))}
                </div>
              </section>
            ) : null}
            {hasLevelContent ? (
              <section className="learner-catalog-group">
                <h2>{levelSections.length ? 'مواد المستوى' : 'مواد هذا المستوى'}</h2>
                <div className="learner-content-grid">
                  {levelItems.map((item) => (
                    <ContentCard
                      key={item.id}
                      courseId={course.id}
                      item={item}
                      levelId={level.id}
                    />
                  ))}
                </div>
              </section>
            ) : null}
            {!levelSections.length && !hasLevelContent ? (
              <section className="panel">
                <EmptyState
                  title="هذا المستوى قيد التجهيز"
                  description="ستظهر الأقسام والمواد هنا عند إضافتها."
                  icon={Layers3}
                />
              </section>
            ) : null}
          </div>
        ) : (
          <div className="learner-catalog-sections">
            {courseLevels.length ? (
              <section className="learner-catalog-group">
                <h2>مستويات الدورة</h2>
                <div className="learner-hierarchy-grid">
                  {courseLevels.map((entry) => (
                    <LevelCard key={entry.id} courseId={course.id} level={entry} />
                  ))}
                </div>
              </section>
            ) : null}
            {hasCourseContent ? (
              <section className="learner-catalog-group">
                <h2>{courseLevels.length ? 'مواد الدورة' : 'مواد الدورة'}</h2>
                <div className="learner-content-grid">
                  {courseItems.map((item) => (
                    <ContentCard key={item.id} courseId={course.id} item={item} />
                  ))}
                </div>
              </section>
            ) : null}
            {!courseLevels.length && !hasCourseContent ? (
              <section className="panel">
                <EmptyState
                  title="محتوى الدورة قيد التجهيز"
                  description="ستظهر المستويات والمواد هنا عند إضافتها."
                  icon={BookOpen}
                />
              </section>
            ) : null}
          </div>
        )}
      </div>
    </AppShell>
  );
}
