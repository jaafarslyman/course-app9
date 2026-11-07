import { BookOpen, ChevronLeft } from 'lucide-react';
import { Link } from 'wouter';
import type {
  Course,
  CourseContentItem,
  CourseLevel,
} from '@/lib/course-types';

function ordered<T extends { sortOrder: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder);
}

function getLevelItems(level: CourseLevel): CourseContentItem[] {
  return [
    ...ordered(level.items),
    ...ordered(level.sections).flatMap((section) => ordered(section.items)),
  ];
}

function getCourseItems(course: Course): CourseContentItem[] {
  return [
    ...ordered(course.items),
    ...ordered(course.levels).flatMap(getLevelItems),
  ];
}

function formatCount(value: number) {
  return new Intl.NumberFormat('ar').format(value);
}

export function LearnerCourseCard({ course }: { course: Course }) {
  const items = getCourseItems(course);
  const complete = items.filter((item) => item.progress?.completed).length;
  const percent = items.length ? Math.round((complete / items.length) * 100) : 0;

  return (
    <Link
      className="panel learner-hierarchy-card learner-course-tile"
      href={`/learn/course/${encodeURIComponent(course.id)}`}
      data-testid={`link-course-${course.id}`}
    >
      <span className="learner-hierarchy-icon">
        <BookOpen size={21} aria-hidden="true" />
      </span>
      <span className="learner-hierarchy-copy">
        <strong>{course.name}</strong>
        <small>
          {formatCount(course.levels.length)} مستويات
          {items.length ? ` · ${formatCount(items.length)} مواد` : ''}
        </small>
      </span>
      <span className="learner-hierarchy-progress">
        {formatCount(percent)}٪
      </span>
      <span className="course-progress-track">
        <span style={{ width: `${percent}%` }} />
      </span>
      <ChevronLeft
        className="learner-hierarchy-arrow"
        size={18}
        aria-hidden="true"
      />
      <span className="sr-only">
        {formatCount(complete)} من {formatCount(items.length)} مواد مكتملة
      </span>
    </Link>
  );
}
