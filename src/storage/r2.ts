import { randomUUID } from 'node:crypto';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

type UploadToR2Input = {
  buffer: Buffer;
  contentType: string;
  fileName: string;
  userId: string;
};

let cachedClient: S3Client | null | undefined;

function getR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    return null;
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL,
  };
}

function getR2Client() {
  if (cachedClient !== undefined) {
    return cachedClient;
  }

  const config = getR2Config();

  if (!config) {
    cachedClient = null;
    return cachedClient;
  }

  cachedClient = new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return cachedClient;
}

function sanitizeObjectName(fileName: string) {
  return fileName.replace(/[^\w.\-]+/g, '_');
}

function buildObjectKey(userId: string, fileName: string) {
  const safeName = sanitizeObjectName(fileName);
  return `${userId}/${Date.now()}-${randomUUID()}-${safeName}`;
}

export function isR2Configured() {
  return getR2Config() !== null;
}

export async function uploadOriginalFileToR2(input: UploadToR2Input) {
  const config = getR2Config();
  const client = getR2Client();

  if (!config || !client) {
    return null;
  }

  const key = buildObjectKey(input.userId, input.fileName);

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucketName,
      Key: key,
      Body: input.buffer,
      ContentType: input.contentType,
    })
  );

  const publicUrl = config.publicBaseUrl
    ? `${config.publicBaseUrl.replace(/\/$/, '')}/${key}`
    : undefined;

  return {
    key,
    url: publicUrl,
  };
}
