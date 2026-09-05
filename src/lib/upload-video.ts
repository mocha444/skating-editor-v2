export type UploadProgressSnapshot = {
  loaded: number;
  total: number;
  percent: number;
  speedBps: number;
};

export type UploadResponse = {
  ok?: boolean;
  jobId?: string;
  dir?: string;
  duplicate?: boolean;
  existingDir?: string;
  error?: string;
  percent?: number;
  stage?: string;
};

/** Upload a FormData via XHR so we get real `upload.onprogress` events. */
export function uploadFormData(
  fd: FormData,
  onProgress: (p: UploadProgressSnapshot) => void
): Promise<{ status: number; json: UploadResponse }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let lastLoaded = 0;
    let lastAt = Date.now();

    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const now = Date.now();
      if (lastAt > 0 && now > lastAt) {
        const speedBps = ((e.loaded - lastLoaded) * 1000) / (now - lastAt);
        onProgress({
          loaded: e.loaded,
          total: e.total,
          percent: e.total > 0 ? (e.loaded / e.total) * 100 : 0,
          speedBps,
        });
      }
      lastLoaded = e.loaded;
      lastAt = now;
    };
    xhr.upload.onerror = () => reject(new Error("Network error during upload."));
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.ontimeout = () => reject(new Error("Upload timed out."));
    xhr.onload = () => {
      let json: UploadResponse;
      try {
        json = JSON.parse(xhr.responseText) as UploadResponse;
      } catch {
        reject(new Error(`Server returned an unexpected response (${xhr.status}).`));
        return;
      }
      resolve({ status: xhr.status, json });
    };
    xhr.send(fd);
  });
}