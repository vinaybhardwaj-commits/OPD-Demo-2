/**
 * Cloudflare R2 client + presigner helpers — ported from Evenscribe (lib/r2.ts).
 *
 * R2 is S3-compatible: @aws-sdk/client-s3 with the R2 endpoint and
 * region="auto". Presigned PUT URLs let the browser upload session audio
 * directly to R2, bypassing the Vercel function payload cap (~4.5MB).
 *
 * OPD-Demo-2 key scheme (build doc §3.2):
 *   audio/{yyyy}/{mm}/{dd}/{encounterId}/{seq}.webm
 * — one object per recording SESSION (the stitch unit), distinct from
 * ETA's encounters/{id}.webm so the shared eta-audio bucket can't collide.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let _client: S3Client | null = null;

function client(): S3Client {
  if (_client) return _client;
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('r2_credentials_missing');
  }
  _client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  return _client;
}

export function bucket(): string {
  const b = process.env.R2_BUCKET;
  if (!b) throw new Error('R2_BUCKET not set');
  return b;
}

export function sessionAudioKey(
  encounterId: string,
  seq: number,
  ext: string = 'webm',
  when: Date = new Date(),
): string {
  const yyyy = when.getFullYear();
  const mm = String(when.getMonth() + 1).padStart(2, '0');
  const dd = String(when.getDate()).padStart(2, '0');
  return `audio/${yyyy}/${mm}/${dd}/${encounterId}/${seq}.${ext}`;
}

export async function signPutUrl(opts: {
  key: string;
  contentType: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: bucket(),
    Key: opts.key,
    ContentType: opts.contentType,
  });
  return getSignedUrl(client(), cmd, { expiresIn: opts.expiresInSeconds ?? 600 });
}

export async function signGetUrl(opts: {
  key: string;
  expiresInSeconds?: number;
  downloadFilename?: string;
}): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: bucket(),
    Key: opts.key,
    ...(opts.downloadFilename
      ? { ResponseContentDisposition: `attachment; filename="${opts.downloadFilename}"` }
      : {}),
  });
  return getSignedUrl(client(), cmd, { expiresIn: opts.expiresInSeconds ?? 3600 });
}

/** Server-side direct PUT (small objects — voice enrollment clips). */
export async function putObjectBytes(
  key: string,
  bytes: Buffer | Uint8Array,
  contentType: string,
): Promise<void> {
  await client().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: bytes,
      ContentType: contentType,
    }),
  );
}

export async function headObject(
  key: string,
): Promise<{ size: number | null; contentType: string | null }> {
  try {
    const res = await client().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return { size: res.ContentLength ?? null, contentType: res.ContentType ?? null };
  } catch {
    return { size: null, contentType: null };
  }
}

/** Download an object's bytes (pipeline reads session audio). Null if missing. */
export async function getObjectBytes(key: string): Promise<Uint8Array | null> {
  try {
    const res = await client().send(
      new GetObjectCommand({ Bucket: bucket(), Key: key }),
    );
    if (!res.Body) return null;
    type ByteStream = { transformToByteArray: () => Promise<Uint8Array> };
    const stream = res.Body as unknown as ByteStream;
    if (typeof stream.transformToByteArray === 'function') {
      return await stream.transformToByteArray();
    }
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as unknown as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    return new Uint8Array(Buffer.concat(chunks));
  } catch {
    return null;
  }
}

export async function deleteObject(key: string): Promise<void> {
  try {
    await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
  } catch {
    /* intentional: best-effort cleanup */
  }
}
