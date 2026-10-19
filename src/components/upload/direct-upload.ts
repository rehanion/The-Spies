// Browser-side upload helper. Files go straight to the private storage bucket
// through a server-issued signed URL, so large files never pass through the
// web server. Content type is always octet-stream: the server sniffs content.

export interface ReserveResponse {
  id: string;
  kind: "file" | "screenshot";
  uploadUrl: string;
}

export async function reserveUpload(body: {
  templateId: string;
  kind: "file" | "screenshot";
  filename: string;
  size: number;
  replacesFileId?: string | null;
}): Promise<ReserveResponse> {
  const res = await fetch("/api/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? "The upload could not be started.");
  return data as ReserveResponse;
}

export function putWithProgress(url: string, file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else if (xhr.status === 413) reject(new Error("Storage rejected the file because it is too large."));
      else reject(new Error("The upload was rejected by storage. Please try again."));
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.send(file);
  });
}

export async function completeUpload(id: string, kind: "file" | "screenshot") {
  const res = await fetch(`/api/uploads/${id}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind }),
  });
  const data = (await res.json().catch(() => ({}))) as { status?: string; message?: string | null };
  return { ok: res.ok, ...data };
}

export async function deleteUpload(id: string, kind: "file" | "screenshot") {
  const res = await fetch(`/api/uploads/${id}?kind=${kind}`, { method: "DELETE" });
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) throw new Error(data.message ?? "Could not delete.");
}
