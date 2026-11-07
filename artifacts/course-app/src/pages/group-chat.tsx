import { Fragment, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import {
  AlertCircle,
  Image as ImageIcon,
  LoaderCircle,
  LockKeyhole,
  MessageCircle,
  Mic,
  Paperclip,
  Play,
  Send,
  ShieldCheck,
  Square,
  Video,
  X,
} from 'lucide-react';
import { AppShell, InlineAlert, LoadingState } from '@/components/app-shell';
import {
  getChatMediaKind,
  useGroupChatMediaUrl,
  useGroupChatState,
  useSendGroupChatMessage,
  useSetLearnerMessagingEnabled,
  useUploadGroupChatMedia,
  type ChatAudience,
  type GroupChatMessage,
} from '@/lib/chat-api';
import { useLearnerSession } from '@/lib/learner-session-context';
import './group-chat.css';

export function GroupChatPage({ audience }: { audience: ChatAudience }) {
  if (audience === 'learner') return <LearnerGroupChat />;
  return <ChatSurface audience="admin" />;
}

function LearnerGroupChat() {
  const { learner } = useLearnerSession();
  return <ChatSurface audience="learner" learnerId={learner?.id} />;
}

function getMessageDayKey(createdAt: string) {
  const date = new Date(createdAt);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function getMessageDayLabel(createdAt: string) {
  const date = new Date(createdAt);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (getMessageDayKey(createdAt) === getMessageDayKey(today.toISOString())) {
    return 'اليوم';
  }
  if (getMessageDayKey(createdAt) === getMessageDayKey(yesterday.toISOString())) {
    return 'أمس';
  }

  return new Intl.DateTimeFormat('ar', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date);
}

function ChatSurface({
  audience,
  learnerId,
}: {
  audience: ChatAudience;
  learnerId?: string;
}) {
  const isAdmin = audience === 'admin';
  const chat = useGroupChatState(audience, learnerId);
  const sendMessage = useSendGroupChatMessage(audience, learnerId);
  const toggleMessaging = useSetLearnerMessagingEnabled();
  const uploadMedia = useUploadGroupChatMedia(audience);
  const [text, setText] = useState('');
  const [sendingMedia, setSendingMedia] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [sendError, setSendError] = useState('');
  const [toggleError, setToggleError] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordedFile, setRecordedFile] = useState<File | null>(null);
  const [recordError, setRecordError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const feedRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const messages = [...(chat.data?.messages ?? [])].sort(
    (first, second) =>
      new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime(),
  );
  const latestMessageId = messages[messages.length - 1]?.id;
  const canSend = isAdmin || Boolean(chat.data?.canSend);
  const busy = sendMessage.isPending || sendingMedia;

  useEffect(() => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [latestMessageId]);

  useEffect(() => () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  async function submitText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = text.trim();
    if (!body || !canSend || busy) return;
    setSendError('');
    try {
      await sendMessage.mutateAsync({ kind: 'text', body });
      setText('');
      if (messageInputRef.current) messageInputRef.current.style.height = 'auto';
    } catch {
      setSendError('تعذّر إرسال الرسالة. تحقق من اتصالك ثم حاول مجددًا.');
    }
  }

  async function uploadAndSendFile(file: File) {
    const kind = getChatMediaKind(file);
    if (!kind || kind === 'text') {
      setMediaError('هذا النوع من الملفات غير مدعوم. اختر صورة أو فيديو أو ملفًا صوتيًا.');
      return;
    }
    if (!canSend) return;
    setMediaError('');
    setSendError('');
    setSendingMedia(true);
    try {
      const uploaded = await uploadMedia.mutateAsync(file);
      await sendMessage.mutateAsync({
        kind: uploaded.kind,
        storagePath: uploaded.storagePath,
        mimeType: uploaded.mimeType,
        fileSizeBytes: uploaded.fileSizeBytes,
      });
      if (file === recordedFile) setRecordedFile(null);
    } catch {
      setMediaError('تعذّر رفع الملف أو إرساله. تأكد من حجمه واتصالك ثم أعد المحاولة.');
    } finally {
      setSendingMedia(false);
    }
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) void uploadAndSendFile(file);
  }

  async function startRecording() {
    setRecordError('');
    setRecordedFile(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setRecordError('تسجيل الصوت غير متاح في هذا المتصفح.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = preferred
        ? new MediaRecorder(stream, { mimeType: preferred })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        const extension = mimeType.includes('mp4') ? 'm4a' : 'webm';
        const audioFile = new File(
          chunksRef.current,
          `voice-note.${extension}`,
          { type: mimeType.split(';')[0] },
        );
        if (audioFile.size) setRecordedFile(audioFile);
        stream.getTracks().forEach((track) => track.stop());
      };
      recorder.start();
      setRecording(true);
    } catch {
      setRecordError('لم نتمكن من الوصول إلى الميكروفون. تحقق من إذن التسجيل.');
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
      setRecording(false);
    }
  }

  async function sendRecording() {
    if (!recordedFile || busy) return;
    await uploadAndSendFile(recordedFile);
  }

  async function changeMessaging() {
    if (!chat.data || toggleMessaging.isPending) return;
    setToggleError('');
    try {
      await toggleMessaging.mutateAsync(!chat.data.messagingEnabled);
    } catch {
      setToggleError('تعذّر تحديث إعدادات النشر. حاول مجددًا.');
    }
  }

  return (
    <AppShell
      title={isAdmin ? 'محادثة المجموعة' : 'مساحة المجموعة'}
      audience={audience}
      fullScreen
    >
      <div className="group-chat-page" dir="rtl">
        <div className="chat-intro-row">
          <div className="chat-intro-copy">
            <span className="chat-intro-kicker">تواصل وتعلّم</span>
            <p>شارك سؤالًا أو فكرة، وتابع ما يشاركه مجتمع الدورة.</p>
          </div>
          <div className="chat-intro-note">
            <ShieldCheck size={16} aria-hidden="true" />
            <span>مساحة خاصة بأعضاء الدورة</span>
          </div>
        </div>
        <section className="chat-frame" aria-label="محادثة المجموعة">
          <div className="chat-room-bar">
            <div className="chat-room-avatar"><MessageCircle size={19} /></div>
            <div className="chat-room-details">
              <strong>مجموعة المتعلمين</strong>
              <span className={`chat-room-saved ${chat.data ? 'is-ready' : ''}`} data-testid="chat-room-status">
                <i aria-hidden="true" />
                {chat.data ? 'تُحفَظ الرسائل تلقائيًا' : 'محادثة الدورة'}
              </span>
            </div>
            {!isAdmin && (
              <div className="chat-room-context">
                <ShieldCheck size={15} aria-hidden="true" />
                <span>إشراف الدورة</span>
              </div>
            )}
            {isAdmin && chat.data && (
              <div className="chat-admin-control">
                <div className="chat-control-copy">
                  <span>{chat.data.messagingEnabled ? 'نشر المتعلمين مفعّل' : 'النشر متوقف للمتعلمين'}</span>
                  <small>يمكنك الإرسال في الحالتين</small>
                </div>
                <button
                  type="button"
                  className={`chat-switch ${chat.data.messagingEnabled ? 'is-on' : ''}`}
                  role="switch"
                  aria-checked={chat.data.messagingEnabled}
                  aria-label="السماح للمتعلمين بإرسال الرسائل"
                  onClick={() => void changeMessaging()}
                  disabled={toggleMessaging.isPending}
                  data-testid="button-toggle-learner-messaging"
                >
                  <span />
                </button>
              </div>
            )}
          </div>

          {toggleError && <InlineAlert>{toggleError}</InlineAlert>}
          {chat.isLoading && (
            <div className="chat-loading-area">
              <div className="chat-skeleton"><i /><i /><i /></div>
              <LoadingState label="جارٍ فتح محادثة المجموعة…" />
            </div>
          )}
          {chat.isError && (
            <div className="chat-error-state" role="alert">
              <div className="chat-error-icon"><AlertCircle size={21} /></div>
              <strong>تعذّر تحميل المحادثة</strong>
              <p>تحقق من الاتصال ثم أعد المحاولة.</p>
              <button type="button" className="button-soft" onClick={() => void chat.refetch()} data-testid="button-retry-chat">
                إعادة المحاولة
              </button>
            </div>
          )}
          {!chat.isLoading && !chat.isError && (
            <>
              <div className="chat-stream" ref={feedRef} data-testid="chat-message-stream" aria-live="polite">
                {messages.length === 0 ? (
                  <div className="chat-empty">
                    <div className="chat-empty-art"><MessageCircle size={26} /></div>
                    <strong>{canSend ? 'ابدأ الحديث مع مجموعتك' : 'لا توجد رسائل بعد'}</strong>
                    <p>
                      {canSend
                        ? 'شارك سؤالًا أو جملة تتدرّب عليها، وستظهر رسالتك هنا للمجموعة.'
                        : 'سيظهر هنا ما يشاركه مشرف الدورة والمتعلمون عند بدء المحادثة.'}
                    </p>
                  </div>
                ) : messages.map((message, index) => {
                  const dayKey = getMessageDayKey(message.createdAt);
                  const startsNewDay =
                    index === 0 ||
                    dayKey !== getMessageDayKey(messages[index - 1].createdAt);
                  return (
                    <Fragment key={message.id}>
                      {startsNewDay && (
                        <div className="chat-day-divider">
                          <span>{getMessageDayLabel(message.createdAt)}</span>
                        </div>
                      )}
                      <MessageBubble
                        message={message}
                        audience={audience}
                        learnerId={learnerId}
                      />
                    </Fragment>
                  );
                })}
              </div>

              {!canSend && (
                <div className="chat-closed-note" role="status" data-testid="status-messaging-disabled">
                  <LockKeyhole size={17} />
                  <span>النشر متوقف حاليًا. يمكنك متابعة رسائل المجموعة، وسيعود الإرسال عند تفعيله.</span>
                </div>
              )}
              {sendError && <InlineAlert>{sendError}</InlineAlert>}
              {mediaError && <InlineAlert>{mediaError}</InlineAlert>}
              {recordError && <InlineAlert>{recordError}</InlineAlert>}
              <div className="chat-compose-zone">
                {recordedFile && !recording && (
                  <div className="chat-recording-preview">
                    <span><Mic size={16} /> تسجيل صوتي جاهز للإرسال</span>
                    <button type="button" className="chat-discard" onClick={() => setRecordedFile(null)} aria-label="إلغاء التسجيل" data-testid="button-discard-recording"><X size={17} /></button>
                    <button type="button" className="button-primary chat-send-recording" onClick={() => void sendRecording()} disabled={busy || !canSend} data-testid="button-send-recording">
                      {busy ? <LoaderCircle className="chat-spin" size={17} /> : <Send size={16} />}
                      إرسال الصوت
                    </button>
                  </div>
                )}
                <form className={`chat-composer ${!canSend ? 'is-disabled' : ''}`} onSubmit={(event) => void submitText(event)}>
                  <input
                    ref={fileInput}
                    className="chat-hidden-file"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif,audio/*"
                    onChange={(event) => void handleFile(event)}
                    data-testid="input-chat-media"
                    aria-label="اختيار صورة أو ملف صوتي"
                  />
                  <input
                    ref={videoInput}
                    className="chat-hidden-file"
                    type="file"
                    accept="video/mp4,video/webm,video/quicktime"
                    onChange={(event) => void handleFile(event)}
                    data-testid="input-chat-video"
                    aria-label="اختيار فيديو"
                  />
                  <div className="chat-composer-tools">
                    <button type="button" className="chat-tool-button" onClick={() => fileInput.current?.click()} disabled={!canSend || busy} aria-label="إرفاق صورة أو صوت" data-testid="button-attach-media">
                      <Paperclip size={19} />
                    </button>
                    <button type="button" className="chat-tool-button" onClick={() => videoInput.current?.click()} disabled={!canSend || busy} aria-label="إرفاق فيديو" data-testid="button-attach-video">
                      <Video size={19} />
                    </button>
                    <button
                      type="button"
                      className={`chat-tool-button chat-record-button ${recording ? 'recording' : ''}`}
                      onClick={recording ? stopRecording : () => void startRecording()}
                      disabled={!canSend || busy || Boolean(recordedFile)}
                      aria-label={recording ? 'إيقاف التسجيل' : 'تسجيل رسالة صوتية'}
                      data-testid="button-record-voice"
                    >
                      {recording ? <Square size={17} /> : <Mic size={19} />}
                    </button>
                  </div>
                  <textarea
                    ref={messageInputRef}
                    value={text}
                    onChange={(event) => {
                      setText(event.target.value);
                      event.currentTarget.style.height = 'auto';
                      event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 112)}px`;
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    placeholder={canSend ? 'اكتب رسالة للمجموعة…' : 'الإرسال متوقف حاليًا'}
                    rows={1}
                    disabled={!canSend || busy}
                    aria-label="نص الرسالة"
                    aria-describedby="chat-compose-hints"
                    data-testid="input-chat-message"
                  />
                  <button
                    className="chat-send-button"
                    type="submit"
                    disabled={!canSend || busy || !text.trim()}
                    aria-label="إرسال الرسالة"
                    data-testid="button-send-chat-message"
                  >
                    {busy ? <LoaderCircle className="chat-spin" size={19} /> : <Send size={19} />}
                  </button>
                </form>
                {busy && <div className="chat-upload-status" role="status">جارٍ رفع الوسائط وإرسالها…</div>}
                <div className="chat-compose-footer" id="chat-compose-hints">
                  <span className="chat-media-hint"><ImageIcon size={13} /> الصور والفيديوهات والرسائل الصوتية بحد أقصى 50 ميغابايت</span>
                  <span className="chat-enter-hint">Enter للإرسال · Shift + Enter لسطر جديد</span>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function MessageBubble({
  message,
  audience,
  learnerId,
}: {
  message: GroupChatMessage;
  audience: ChatAudience;
  learnerId?: string;
}) {
  const isAdmin = message.senderType === 'admin';
  const media = useGroupChatMediaUrl(
    message.kind === 'text' ? '' : message.id,
    audience,
    learnerId,
  );
  const time = new Intl.DateTimeFormat('ar', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(message.createdAt));
  const initials = message.senderName.trim().slice(0, 1) || (isAdmin ? 'م' : 'ط');

  return (
    <article className={`chat-message-row ${isAdmin ? 'from-admin' : 'from-learner'}`} data-testid={`message-${message.id}`}>
      <div className={`chat-sender-avatar ${isAdmin ? 'admin-avatar' : ''}`} aria-hidden="true">{initials}</div>
      <div className="chat-message-stack">
        <div className="chat-sender-line">
          <strong>{message.senderName}</strong>
          {isAdmin && <span className="chat-admin-badge">مشرف الدورة</span>}
        </div>
        <div className={`chat-bubble ${isAdmin ? 'admin-bubble' : 'learner-bubble'}`}>
          {message.kind === 'text' && <p className="chat-message-text" dir="auto">{message.body}</p>}
          {message.kind !== 'text' && (
            media.isLoading ? (
              <div className="chat-media-loading"><span /> جارٍ تجهيز الوسيط</div>
            ) : media.isError || !media.data ? (
              <div className="chat-media-unavailable"><AlertCircle size={16} /> تعذّر عرض الملف</div>
            ) : message.kind === 'image' ? (
              <div className="chat-image-frame" onContextMenu={(event) => event.preventDefault()}>
                <img src={media.data} alt="صورة مرسلة في المجموعة" loading="lazy" draggable={false} onDragStart={(event) => event.preventDefault()} />
              </div>
            ) : message.kind === 'video' ? (
              <video className="chat-video" src={media.data} controls controlsList="nodownload noremoteplayback" disablePictureInPicture disableRemotePlayback playsInline preload="metadata" aria-label="فيديو مرسل في المجموعة" onContextMenu={(event) => event.preventDefault()} />
            ) : (
              <div className="chat-audio-wrap">
                <div className="chat-audio-label"><span className="chat-audio-play"><Play size={14} fill="currentColor" /></span>رسالة صوتية</div>
                <audio src={media.data} controls controlsList="nodownload noremoteplayback" preload="metadata" aria-label="رسالة صوتية مرسلة في المجموعة" onContextMenu={(event) => event.preventDefault()} />
              </div>
            )
          )}
          <time dateTime={message.createdAt}>{time}</time>
        </div>
      </div>
    </article>
  );
}
