import * as Minio from "minio";

export const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT ?? "localhost",
  port: parseInt(process.env.MINIO_PORT ?? "9000"),
  useSSL: process.env.MINIO_USE_SSL === "true",
  accessKey: process.env.MINIO_ACCESS_KEY!,
  secretKey: process.env.MINIO_SECRET_KEY!,
});

export const MINIO_BUCKET = "zvg-images";

export function getPublicUrl(storagePath: string): string {
  const endpoint = process.env.MINIO_PUBLIC_URL ?? `http://localhost:9000`;
  return `${endpoint}/${MINIO_BUCKET}/${storagePath}`;
}
