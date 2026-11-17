// Documents on the client: types, meta, upload with progress, file icons and sizes.
import { useQuery } from '@tanstack/react-query';
import { FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileType2, FileVideo, Mail, Presentation, type LucideIcon } from 'lucide-react';
import { api, ApiError } from './api';

export type Doc = {
  id: string; folder_id: string | null; folder_name: string | null; name: string; description: string | null;
  category: string | null; category_name: string | null; category_color: string | null; tags: string[];
  mime: string; ext: string; size: number; version: number;
  customer_id: string | null; customer_name: string | null; branch_id: string | null; branch_name: string | null;
  space_id: string | null; space_name: string | null; offer_id: string | null; offer_number: string | null;
  activity_id: string | null; activity_subject: string | null; task_id: string | null;
  expires_at: string | null; shared: boolean; share_expires_at: string | null;
  created_by: string | null; created_by_name: string | null; created_at: string; updated_at: string;
};
export type DocDetail = Doc & { versions: { version: number; name: string; size: number; mime: string; note: string | null; created_at: string; created_by_name: string | null }[]; share_url: string | null };
export type Folder = { id: string; parent_id: string | null; name: string; docs: number };
export type DocsMeta = {
  categories: { key: string; name: string; color: string; active: boolean }[]; folders: Folder[];
  usage: { used: number; quota: number }; max_file: number; allowed: string[];
  can: { edit: boolean; delete: boolean; manage: boolean };
};
export type DocLinks = Partial<Record<'customer_id' | 'branch_id' | 'space_id' | 'offer_id' | 'activity_id' | 'task_id' | 'folder_id' | 'category', string | null>>;

export function useDocsMeta() {
  return useQuery({ queryKey: ['docs', 'meta'], queryFn: () => api<DocsMeta>('/documents/meta'), staleTime: 60_000 });
}

export function formatBytes(n: number, locale = 'el') {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toLocaleString(locale, { maximumFractionDigits: v < 10 ? 1 : 0 })} ${u[i]}`;
}

export const isImage = (ext: string) => ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext);
export const isPdf = (ext: string) => ext === 'pdf';
export const isAudio = (ext: string) => ['webm', 'm4a', 'ogg', 'mp3', 'wav'].includes(ext);
export function fileIcon(ext: string): LucideIcon {
  if (isImage(ext) || ext === 'heic') return FileImage;
  if (['xls', 'xlsx', 'ods', 'csv'].includes(ext)) return FileSpreadsheet;
  if (['ppt', 'pptx', 'odp'].includes(ext)) return Presentation;
  if (ext === 'zip') return FileArchive;
  if (ext === 'mp4') return FileVideo;
  if (isAudio(ext)) return FileAudio;
  if (['eml', 'msg'].includes(ext)) return Mail;
  if (ext === 'pdf') return FileType2;
  return FileText;
}
export const fileUrl = (id: string, opts: { inline?: boolean; v?: number } = {}) =>
  `/api/documents/${id}/file?${opts.inline ? 'inline=1&' : ''}${opts.v ? `v=${opts.v}` : ''}`;

/** Uploads one file as a raw body with progress; rejects with the API error code. */
export function uploadFile(file: File, params: DocLinks & { name?: string }, onProgress?: (p: number) => void, path = '/documents/upload') {
  const q = new URLSearchParams({ name: params.name ?? file.name });
  for (const [k, v] of Object.entries(params)) if (v && k !== 'name') q.set(k, v);
  return new Promise<Doc>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${path}?${q}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      let body: { error?: string } = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* empty */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as Doc);
      else reject(new ApiError(xhr.status, body.error ?? 'error', body));
    };
    xhr.onerror = () => reject(new ApiError(0, 'network'));
    xhr.send(file);
  });
}

export const docsApi = {
  patch: (id: string, body: Record<string, unknown>) => api(`/documents/${id}`, { method: 'PATCH', json: body }),
  remove: (id: string) => api(`/documents/${id}`, { method: 'DELETE' }),
};
