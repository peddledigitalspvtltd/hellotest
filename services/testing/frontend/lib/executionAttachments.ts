import { platformApi } from "@hellotest/platform/frontend/api.client";
import { testingApi } from "../api.client";

export const MAX_EXECUTION_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff", svg: "image/svg+xml", avif: "image/avif",
  heic: "image/heic", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", avi: "video/x-msvideo",
  mpeg: "video/mpeg", mpg: "video/mpeg", ogv: "video/ogg", pdf: "application/pdf", json: "application/json",
  xml: "application/xml", txt: "text/plain", log: "text/plain", csv: "text/csv", zip: "application/zip"
};
const ALLOWED_MIME_TYPES = new Set([...Object.values(MIME_BY_EXTENSION), "text/xml", "application/x-zip-compressed"]);

export function executionAttachmentMimeType(file: Pick<File, "name" | "type">) {
  const mime = file.type.split(";", 1)[0].trim().toLowerCase();
  const resolved = !mime || mime === "application/octet-stream" ? MIME_BY_EXTENSION[file.name.split(".").pop()?.toLowerCase() || ""] : mime;
  if (!ALLOWED_MIME_TYPES.has(resolved)) throw new Error("Use an image, video, PDF, text, JSON, XML, CSV, or ZIP evidence file.");
  return resolved;
}

export function isAnimatedPng(bytes: Uint8Array) {
  if (bytes.length < 8 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const size = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "acTL") return true;
    if (type === "IDAT" || type === "IEND") return false;
    if (size > bytes.length - offset - 12) return false;
    offset += size + 12;
  }
  return false;
}

const compressRaster = async (file: File, mime: string): Promise<File> => {
  // Preserve animations and already-compressed formats, including animated
  // WebP/AVIF. Small screenshots also retain their exact original bytes.
  if (file.size <= 1024 * 1024 || !["image/jpeg", "image/png", "image/bmp"].includes(mime)) return file;
  if (mime === "image/png" && isAnimatedPng(new Uint8Array(await file.arrayBuffer()))) return file;
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    const scale = Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const targetMime = mime === "image/jpeg" ? "image/jpeg" : "image/webp";
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, targetMime, .9));
    if (!blob || blob.type !== targetMime || blob.size >= file.size) return file;
    const extension = targetMime === "image/jpeg" ? "jpg" : "webp";
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.${extension}`, { type: targetMime, lastModified: file.lastModified });
  } catch {
    // Native downloads still work when this browser cannot decode an image.
    return file;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

export async function prepareExecutionAttachment(file: File, maxBytes = MAX_EXECUTION_ATTACHMENT_BYTES) {
  if (!file.size) throw new Error("Choose a non-empty evidence file.");
  if (file.size > MAX_EXECUTION_ATTACHMENT_BYTES) throw new Error("Evidence files must be 25 MB or smaller.");
  const mime = executionAttachmentMimeType(file);
  const original = file.type === mime ? file : new File([file], file.name, { type: mime, lastModified: file.lastModified });
  const prepared = await compressRaster(original, mime);
  const limit = Math.min(maxBytes > 0 ? maxBytes : MAX_EXECUTION_ATTACHMENT_BYTES, MAX_EXECUTION_ATTACHMENT_BYTES);
  if (prepared.size > limit) throw new Error(`This file exceeds the ${limit >= 1024 * 1024 ? `${Math.floor(limit / 1024 / 1024)} MB` : `${Math.ceil(limit / 1024)} KB`} attachment limit.`);
  return prepared;
}

export async function uploadExecutionAttachment(resultId: string, file: File, options: { stepId?: string; expectedRevision?: number } = {}) {
  if (!resultId) throw new Error("Save the case result before attaching evidence.");
  const meta = await platformApi.attachments.meta();
  if (!meta.enabled) throw new Error("Attachments are unavailable because file storage is disabled.");
  const prepared = await prepareExecutionAttachment(file, meta.uploadLimit);
  return testingApi.executionResultAttachments.upload(resultId, prepared, options);
}

export async function downloadExecutionAttachment(attachmentId: string, fileName: string) {
  const file = await platformApi.attachments.download(attachmentId);
  const objectUrl = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  link.rel = "noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
