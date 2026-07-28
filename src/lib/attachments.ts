/**
 * Single source of truth for what may be attached to a campaign.
 *
 * An allowlist, never a denylist: this file is written to disk and then mailed
 * out, so anything not explicitly understood here is refused. Executable and
 * script types are absent on purpose — Gmail rejects most of them at the door
 * and they are the payload of choice for attachment-borne malware.
 */

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB

/** Leading bytes a file of this type must start with, when it has any. */
const ZIP: readonly string[] = ["504b0304", "504b0506", "504b0708"];
const OLE: readonly string[] = ["d0cf11e0a1b11ae1"]; // legacy .doc/.xls/.ppt

interface AttachmentType {
  mime: string;
  /** Hex-encoded magic numbers; empty means the format has no reliable one. */
  magic: readonly string[];
  label: string;
}

const TYPES: Record<string, AttachmentType> = {
  pdf: { mime: "application/pdf", magic: ["255044462d"], label: "PDF" },

  doc: { mime: "application/msword", magic: OLE, label: "Word" },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    magic: ZIP,
    label: "Word",
  },
  odt: {
    mime: "application/vnd.oasis.opendocument.text",
    magic: ZIP,
    label: "OpenDocument text",
  },
  rtf: { mime: "application/rtf", magic: ["7b5c7274"], label: "Rich text" },
  txt: { mime: "text/plain", magic: [], label: "Text" },

  xls: { mime: "application/vnd.ms-excel", magic: OLE, label: "Excel" },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    magic: ZIP,
    label: "Excel",
  },
  ods: {
    mime: "application/vnd.oasis.opendocument.spreadsheet",
    magic: ZIP,
    label: "OpenDocument sheet",
  },
  csv: { mime: "text/csv", magic: [], label: "CSV" },

  ppt: { mime: "application/vnd.ms-powerpoint", magic: OLE, label: "PowerPoint" },
  pptx: {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    magic: ZIP,
    label: "PowerPoint",
  },
  odp: {
    mime: "application/vnd.oasis.opendocument.presentation",
    magic: ZIP,
    label: "OpenDocument slides",
  },

  png: { mime: "image/png", magic: ["89504e470d0a1a0a"], label: "PNG" },
  jpg: { mime: "image/jpeg", magic: ["ffd8ff"], label: "JPEG" },
  jpeg: { mime: "image/jpeg", magic: ["ffd8ff"], label: "JPEG" },
  gif: { mime: "image/gif", magic: ["474946383761", "474946383961"], label: "GIF" },
  webp: { mime: "image/webp", magic: ["52494646"], label: "WebP" },

  zip: { mime: "application/zip", magic: ZIP, label: "ZIP archive" },
};

export const ALLOWED_EXTENSIONS = Object.keys(TYPES).sort();

/** For an <input type="file"> accept attribute. */
export const ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",");

/** Stored files are "<uuid>.<ext>" and nothing else. */
export const STORED_NAME_RE = new RegExp(
  `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(${ALLOWED_EXTENSIONS.join("|")})$`,
);

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot + 1).toLowerCase();
}

export function isAllowedFileName(fileName: string): boolean {
  return extensionOf(fileName) in TYPES;
}

/**
 * MIME type to put on the outgoing message part. Falls back to the generic
 * binary type so an unrecognized name can never produce an empty Content-Type.
 */
export function mimeTypeFor(fileName: string): string {
  return TYPES[extensionOf(fileName)]?.mime ?? "application/octet-stream";
}

/**
 * Checks the file's leading bytes against its claimed extension.
 *
 * Formats without a signature (csv, txt) always pass — there is nothing to
 * check. This catches an .exe renamed to .pdf, not a malicious .csv, so it is
 * a sanity check on top of the allowlist rather than the defence itself.
 */
export function magicBytesMatch(fileName: string, buffer: Buffer): boolean {
  const type = TYPES[extensionOf(fileName)];
  if (!type || type.magic.length === 0) return true;
  const head = buffer.subarray(0, 16).toString("hex");
  return type.magic.some((signature) => head.startsWith(signature));
}

/** Human-readable list for error messages and UI hints. */
export function allowedTypesSummary(): string {
  const labels = new Set(Object.values(TYPES).map((t) => t.label));
  return [...labels].join(", ");
}
