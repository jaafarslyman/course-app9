import { useMutation } from '@tanstack/react-query';

type MediaRequest = {
  contentId?: string;
  messageId?: string;
  learnerSessionSecret?: string | null;
  mediaType?: 'content' | 'thumbnail';
  contentType?: string;
  fileSizeBytes?: number;
};

type MediaResponse = {
  signedUrl: string;
  expiresIn?: number;
  storagePath?: string;
};

type UploadUrlResponse = MediaResponse & {
  storagePath: string;
};

type MediaHookOptions = {
  request?: {
    headers?: HeadersInit;
  };
};

async function requestMedia<T extends MediaResponse>(
  endpoint: string,
  data: MediaRequest,
  headers?: HeadersInit,
): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...Object.fromEntries(new Headers(headers).entries()),
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null) as
      | { error?: string }
      | null;
    throw new Error(body?.error || `media_request_failed_${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function useCreateCourseMediaSignedUrl(options?: MediaHookOptions) {
  return useMutation({
    mutationFn: ({ data }: { data: MediaRequest }) =>
      requestMedia('/api/course-media/signed-url', data, options?.request?.headers),
  });
}

export function useCreateChatMediaSignedUrl(options?: MediaHookOptions) {
  return useMutation({
    mutationFn: ({ data }: { data: MediaRequest }) =>
      requestMedia('/api/chat-media/signed-url', data, options?.request?.headers),
  });
}

export function useCreateChatMediaUploadUrl(options?: MediaHookOptions) {
  return useMutation({
    mutationFn: ({ data }: { data: MediaRequest }) =>
      requestMedia<UploadUrlResponse>(
        '/api/chat-media/upload-url',
        data,
        options?.request?.headers,
      ),
  });
}
