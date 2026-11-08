import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useLocation } from 'wouter';
import { z } from 'zod';
import { InlineAlert, SetupNotice } from '@/components/app-shell';
import { Form } from '@/components/ui/form';
import {
  createSessionSecret,
  saveLearnerSession,
  type LearnerRpcReply,
} from '@/lib/learner-session';
import { useLearnerSession } from '@/lib/learner-session-context';
import {
  callRpc,
  errorCode,
  hasSupabaseConfig,
  requireSupabase,
} from '@/lib/supabase';

const adminLoginSchema = z.object({
  email: z.string().trim().email('أدخل بريدًا إلكترونيًا صحيحًا'),
  password: z.string().min(1, 'أدخل كلمة المرور'),
});

type AdminLoginValues = z.infer<typeof adminLoginSchema>;

const learnerLoginSchema = z.object({
  email: z.string().trim().email('أدخل بريدًا إلكترونيًا صحيحًا'),
  code: z.string(),
});

type LearnerLoginValues = z.infer<typeof learnerLoginSchema>;

export function AdminSignInPage() {
  const [, setLocation] = useLocation();
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<AdminLoginValues>({
    resolver: zodResolver(adminLoginSchema),
    defaultValues: { email: '', password: '' },
  });

  async function signIn(values: AdminLoginValues) {
    setFormError('');
    if (!hasSupabaseConfig) {
      setFormError('أضف إعدادات Supabase أولًا ثم أعد تشغيل التطبيق.');
      return;
    }

    setSubmitting(true);
    const client = requireSupabase();
    const { error: signInError } = await client.auth.signInWithPassword({
      email: values.email.trim(),
      password: values.password,
    });

    if (signInError) {
      setSubmitting(false);
      setFormError('تعذّر تسجيل الدخول. تحقق من البريد وكلمة المرور.');
      return;
    }

    try {
      await callRpc('admin_list_learners');
      setLocation('/admin');
    } catch (error) {
      await client.auth.signOut();
      setFormError(
        errorCode(error) === '42501'
          ? 'هذا الحساب غير مخوّل لإدارة الدورة.'
          : 'تعذّر التحقق من صلاحية الإدارة. تأكد من تشغيل ملف SQL وإضافة بريد المشرف.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page admin-auth-page" dir="rtl">
      <section className="admin-auth-form-area" aria-label="تسجيل دخول المشرف">
        <div className="admin-auth-card">
          {!hasSupabaseConfig && <SetupNotice />}

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(signIn)}
              className="auth-form"
              noValidate
            >
              <label className="field auth-field">
                <span className="auth-sr-only">البريد الإلكتروني</span>
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  className="ltr"
                  placeholder="البريد الإلكتروني"
                  aria-label="البريد الإلكتروني"
                  {...form.register('email')}
                  data-testid="input-admin-email"
                />
                {form.formState.errors.email && (
                  <span className="form-error">
                    {form.formState.errors.email.message}
                  </span>
                )}
              </label>
              <label className="field auth-field">
                <span className="auth-sr-only">كلمة المرور</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  placeholder="كلمة المرور"
                  aria-label="كلمة المرور"
                  {...form.register('password')}
                  data-testid="input-admin-password"
                />
                {form.formState.errors.password && (
                  <span className="form-error">
                    {form.formState.errors.password.message}
                  </span>
                )}
              </label>
              {formError && <InlineAlert>{formError}</InlineAlert>}
              <button
                type="submit"
                className="button-primary auth-submit"
                disabled={submitting || !hasSupabaseConfig}
                data-testid="button-admin-signin"
              >
                {submitting ? 'جارٍ التحقق…' : 'تسجيل الدخول'}
              </button>
            </form>
          </Form>
        </div>
      </section>
      <Link
        href="/"
        className="learner-admin-link admin-learner-link"
        data-testid="link-learner-signin"
      >
        <span>دخول المتعلّمين</span>
      </Link>
    </main>
  );
}

export function LearnerAccessPage() {
  const [, setLocation] = useLocation();
  const { learner, status, refresh } = useLearnerSession();
  const [step, setStep] = useState<1 | 2>(1);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<LearnerLoginValues>({
    resolver: zodResolver(learnerLoginSchema),
    defaultValues: { email: '', code: '' },
  });

  useEffect(() => {
    if (status === 'signed-in' && learner) setLocation('/learn');
  }, [learner, setLocation, status]);

  async function continueToCode() {
    setFormError('');
    const valid = await form.trigger('email');
    if (valid) {
      form.setValue('code', '');
      setStep(2);
    }
  }

  async function redeem(values: LearnerLoginValues) {
    setFormError('');
    const code = values.code.trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{10}$/.test(code)) {
      setFormError('أدخل رمز الدخول المكوّن من ١٠ أحرف وأرقام.');
      return;
    }

    if (!hasSupabaseConfig) {
      setFormError('أضف إعدادات Supabase أولًا ثم أعد تشغيل التطبيق.');
      return;
    }

    setSubmitting(true);
    try {
      const sessionSecret = createSessionSecret();
      const reply = await callRpc<LearnerRpcReply>('redeem_learner_access', {
        p_email: values.email.trim().toLowerCase(),
        p_code: code,
        p_session_secret: sessionSecret,
      });

      if (!reply.ok || !reply.learner) {
        setFormError(
          reply.error === 'too_many_attempts'
            ? 'تجاوزت عدد المحاولات المسموح. انتظر ١٥ دقيقة ثم حاول مرة أخرى.'
            : 'تعذّر التحقق من البريد أو الرمز. راجع بياناتك أو اطلب رمزًا جديدًا من المشرف.',
        );
        return;
      }

      saveLearnerSession(sessionSecret);
      await refresh();
      setLocation('/learn');
    } catch (error) {
      setFormError(
        error instanceof Error &&
          error.message === 'secure_random_unavailable'
          ? 'تعذّر إنشاء جلسة آمنة على هذا الجهاز. افتح التطبيق عبر اتصال آمن ثم حاول مجددًا.'
          : 'تعذّر الاتصال بخدمة الدخول. تحقق من إعداد Supabase ثم حاول مرة أخرى.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page learner-auth-page" dir="rtl">
      <section className="learner-auth-content">
        <div className="learner-portrait" aria-hidden="true">
          <div className="learner-portrait-frame" />
          <img
            className="learner-portrait-image"
            src={`${import.meta.env.BASE_URL}assets/learner-signin-character.png`}
            alt=""
          />
        </div>
        <div className="learner-auth-form">
          {!hasSupabaseConfig && <SetupNotice />}

          <Form {...form}>
            <form
              onSubmit={
                step === 1
                  ? (event) => {
                      event.preventDefault();
                      void continueToCode();
                    }
                  : form.handleSubmit(redeem)
              }
              className="auth-form"
              noValidate
            >
              {step === 1 ? (
                <label className="field auth-field">
                  <span className="auth-sr-only">البريد الإلكتروني</span>
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    className="ltr"
                    placeholder="البريد الإلكتروني"
                    aria-label="البريد الإلكتروني"
                    {...form.register('email')}
                    data-testid="input-learner-email"
                  />
                  {form.formState.errors.email && (
                    <span className="form-error">
                      {form.formState.errors.email.message}
                    </span>
                  )}
                </label>
              ) : (
                <>
                  <div className="email-confirmation">
                    <span className="ltr">{form.getValues('email')}</span>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setFormError('');
                        setStep(1);
                      }}
                      data-testid="button-edit-learner-email"
                    >
                      تغيير
                    </button>
                  </div>
                  <label className="field auth-field">
                    <span className="auth-sr-only">رمز الدخول لمرة واحدة</span>
                    <input
                      type="text"
                      autoComplete="one-time-code"
                      autoCapitalize="characters"
                      spellCheck={false}
                      maxLength={10}
                      className="ltr access-code-input"
                      placeholder="XXXXXXXXXX"
                      aria-label="رمز الدخول لمرة واحدة"
                      {...form.register('code')}
                      data-testid="input-access-code"
                    />
                  </label>
                </>
              )}

              {formError && <InlineAlert>{formError}</InlineAlert>}

              <button
                type="submit"
                className="button-primary auth-submit"
                disabled={submitting || !hasSupabaseConfig}
                data-testid={
                  step === 1 ? 'button-request-code' : 'button-learner-login'
                }
              >
                {submitting
                  ? 'جارٍ التحقق…'
                  : step === 1
                    ? 'التالي'
                    : 'دخول إلى التطبيق'}
              </button>
            </form>
          </Form>

        </div>
      </section>
      <Link
        href="/admin/sign-in"
        className="learner-admin-link"
        data-testid="link-admin-signin"
      >
        <span lang="en">Admin access</span>
      </Link>
    </main>
  );
}
