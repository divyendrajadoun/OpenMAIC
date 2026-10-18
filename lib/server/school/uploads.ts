/**
 * Chunked footage uploads over `school_uploads` / `school_upload_chunks`.
 *
 * A two-minute recording is tens of megabytes, more than one request to this
 * host may carry, and HeyGen's storage refuses browser uploads. So the browser
 * posts the file in chunks, each chunk is parked in Postgres, and the twin
 * route reassembles the file and hands it to HeyGen from the server. Chunks
 * live minutes, not days: they are deleted once the twin is created, and
 * anything a day old is purged on the next upload.
 */
import type { Queryable } from '@openmaic/storage/document/pg';

import { newId } from './accounts';

export interface Upload {
  id: string;
  schoolId: string;
  userId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

interface UploadRow extends Record<string, unknown> {
  id: string;
  school_id: string;
  user_id: string;
  filename: string;
  content_type: string;
  size_bytes: number | string;
}

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export async function createUpload(
  db: Queryable,
  input: {
    schoolId: string;
    userId: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
  },
): Promise<string> {
  await db.query(`DELETE FROM school_uploads WHERE created_at < $1`, [Date.now() - STALE_AFTER_MS]);
  const id = newId('upload');
  await db.query(
    `INSERT INTO school_uploads (id, school_id, user_id, filename, content_type, size_bytes, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      input.schoolId,
      input.userId,
      input.filename,
      input.contentType,
      input.sizeBytes,
      Date.now(),
    ],
  );
  return id;
}

export async function getUpload(db: Queryable, id: string): Promise<Upload | null> {
  const result = await db.query<UploadRow>(`SELECT * FROM school_uploads WHERE id = $1`, [id]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    schoolId: row.school_id,
    userId: row.user_id,
    filename: row.filename,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
  };
}

export async function putChunk(
  db: Queryable,
  uploadId: string,
  index: number,
  bytes: Uint8Array,
): Promise<void> {
  await db.query(
    `INSERT INTO school_upload_chunks (upload_id, idx, bytes) VALUES ($1, $2, $3)
     ON CONFLICT (upload_id, idx) DO UPDATE SET bytes = EXCLUDED.bytes`,
    [uploadId, index, Buffer.from(bytes)],
  );
}

/** The whole file, in chunk order. Throws when the chunks do not add up to the declared size. */
export async function assembleUpload(db: Queryable, upload: Upload): Promise<Uint8Array> {
  const result = await db.query<{ idx: number; bytes: Buffer }>(
    `SELECT idx, bytes FROM school_upload_chunks WHERE upload_id = $1 ORDER BY idx`,
    [upload.id],
  );
  const total = result.rows.reduce((sum, row) => sum + row.bytes.byteLength, 0);
  if (total !== upload.sizeBytes) {
    throw new Error(`upload incomplete: ${total} of ${upload.sizeBytes} bytes received`);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const row of result.rows) {
    out.set(row.bytes, offset);
    offset += row.bytes.byteLength;
  }
  return out;
}

export async function deleteUpload(db: Queryable, id: string): Promise<void> {
  await db.query(`DELETE FROM school_uploads WHERE id = $1`, [id]);
}
