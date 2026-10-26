// JSON client for /app/api (see wa-gateway/WEB_API.md). Every call throws ApiError with a `code`;
// a 401 on anything but login fires onUnauthorized so the app can show the login screen.
import { t } from './i18n.js';

const BASE = '/app/api';
let transport = null; // set by mock.js when ?mock=1
let onUnauthorized = () => {};

export const setTransport = (fn) => { transport = fn; };
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export class ApiError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}

/** ID/TR text for an error (ApiError code, else generic). */
export function errText(err) {
  const e = t().errors;
  return (err && e[err.code]) || e.generic;
}

function check(path, status, data) {
  if (status === 401 && path !== '/login') { onUnauthorized(); throw new ApiError(401, 'LOGIN_REQUIRED'); }
  if (status === 413) throw new ApiError(413, data?.code || 'FILE_TOO_LARGE');
  if (status >= 400) throw new ApiError(status, data?.code || 'HTTP_' + status, data?.error);
  return data;
}

/** api('/contacts'), api('/contacts', { method: 'POST', body }), raw text bodies via { body, type }. */
export async function api(path, { method = 'GET', body, type } = {}) {
  let status, data;
  try {
    if (transport) {
      ({ status, data } = await transport(method, path, body, type));
    } else {
      const headers = {};
      let payload;
      if (body !== undefined) {
        headers['Content-Type'] = type || 'application/json';
        payload = type ? body : JSON.stringify(body);
      }
      const r = await fetch(BASE + path, { method, headers, body: payload, credentials: 'same-origin' });
      status = r.status;
      const ct = r.headers.get('content-type') || '';
      data = ct.includes('json') ? await r.json().catch(() => null) : await r.text();
    }
  } catch {
    throw new ApiError(0, 'NETWORK');
  }
  return check(path, status, data);
}

/** Upload one file with progress (0–100). Resolves { id, name, mime, size }. */
export function upload(file, onProgress) {
  const path = '/uploads?name=' + encodeURIComponent(file.name);
  if (transport) return transport('POST', path, file, file.type, onProgress).then(({ status, data }) => check(path, status, data));
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', BASE + path);
    x.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100)); };
    x.onerror = () => reject(new ApiError(0, 'NETWORK'));
    x.onload = () => {
      let data = null;
      try { data = JSON.parse(x.responseText); } catch { /* non-JSON error page */ }
      try { resolve(check(path, x.status, data)); } catch (e) { reject(e); }
    };
    x.send(file);
  });
}

export let uploadUrl = (id) => `${BASE}/uploads/${encodeURIComponent(id)}`;
export const setUploadUrl = (fn) => { uploadUrl = fn; };
