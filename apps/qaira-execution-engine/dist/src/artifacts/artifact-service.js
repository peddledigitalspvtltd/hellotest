import { MinioClient } from "minio";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";
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
const storeLocally = async (input) => {
    const artifactId = randomUUID();
    const fileName = input.fileName || `${input.artifactType}-${artifactId}`;
    const relativeKey = `${input.runId}/${input.caseId || "unknown"}/${input.stepId || "root"}/${artifactId}-${fileName}`;
    const objectKey = join(config.evidenceLocalPath, relativeKey);
    const buffer = typeof input.content === "string" ? Buffer.from(input.content, "utf8") : input.content;
    await mkdir(join(config.evidenceLocalPath, input.runId, input.caseId || "unknown", input.stepId || "root"), { recursive: true });
    await writeFile(objectKey, buffer);
    return {
        artifactId,
        runId: input.runId,
        caseId: input.caseId,
        stepId: input.stepId,
        artifactType: input.artifactType,
        objectKey,
        signedUrl: `file://${objectKey}`,
        createdAt: new Date().toISOString()
    };
};
export const uploadArtifact = async (input) => {
    if (config.storageProvider === "local") {
        return storeLocally(input);
    }
    const artifactId = randomUUID();
    const fileName = input.fileName || `${input.artifactType}-${artifactId}`;
    const objectKey = `${input.runId}/${input.caseId || "unknown"}/${input.stepId || "root"}/${artifactId}-${fileName}`;
    const buffer = typeof input.content === "string" ? Buffer.from(input.content, "utf8") : input.content;
    try {
        await ensureBucket();
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
    }
    catch (error) {
        return storeLocally(input);
    }
};
//# sourceMappingURL=artifact-service.js.map