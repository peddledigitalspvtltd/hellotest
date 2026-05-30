import { MinioClient } from "minio";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import type { ExecutionArtifact } from "../models/execution.js";

const client = new MinioClient({
  endPoint: config.minioEndpoint,
  port: config.minioPort,
  useSSL: config.minioUseTls,
  accessKey: config.minioAccessKey,
  secretKey: config.minioSecretKey
});

const ensureBucket = async () => {
  const exists = await client.bucketExists(config.minioBucket);
  if (!exists) {
    await client.makeBucket(config.minioBucket, "us-east-1");
  }
};

export const uploadArtifact = async (input: {
  runId: string;
  caseId?: string;
  stepId?: string;
  artifactType: string;
  content: Buffer | string;
  contentType: string;
  fileName?: string;
}): Promise<ExecutionArtifact> => {
  await ensureBucket();

  const artifactId = randomUUID();
  const fileName = input.fileName || `${input.artifactType}-${artifactId}`;
  const objectKey = `${input.runId}/${input.caseId || "unknown"}/${input.stepId || "root"}/${artifactId}-${fileName}`;

  const buffer = typeof input.content === "string" ? Buffer.from(input.content, "utf8") : input.content;

  await client.putObject(config.minioBucket, objectKey, buffer, {
    "Content-Type": input.contentType
  });

  const signedUrl = await client.presignedGetObject(config.minioBucket, objectKey, 60 * 60);

  return {
    artifactId,
    runId: input.runId,
    caseId: input.caseId,
    stepId: input.stepId,
    artifactType: input.artifactType,
    objectKey,
    signedUrl,
    createdAt: new Date().toISOString()
  };
};
