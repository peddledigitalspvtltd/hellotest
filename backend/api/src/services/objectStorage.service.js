const Minio = require("minio");
const { config } = require("../config");

let client;
let bucketPromise;

const createError = (message, statusCode = 503) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const parseEndpoint = () => {
  const raw = String(config.objectStorage.endpoint || "").trim();
  if (!raw) {
    throw createError("Object storage endpoint is not configured.");
  }

  if (!raw.includes("://")) {
    return {
      endPoint: raw,
      port: config.objectStorage.port,
      useSSL: config.objectStorage.useSsl
    };
  }

  const url = new URL(raw);
  return {
    endPoint: url.hostname,
    port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
    useSSL: url.protocol === "https:"
  };
};

const isEnabled = () => config.storageProvider === "minio" || config.storageProvider === "s3";

const getClient = () => {
  if (!isEnabled()) {
    throw createError("Attachments are unavailable because object storage is disabled.");
  }

  if (!client) {
    client = new Minio.Client({
      ...parseEndpoint(),
      accessKey: config.objectStorage.accessKey,
      secretKey: config.objectStorage.secretKey,
      region: config.objectStorage.region,
      pathStyle: true
    });
  }

  return client;
};

const ensureBucket = async () => {
  if (!bucketPromise) {
    bucketPromise = (async () => {
      const storage = getClient();
      const exists = await storage.bucketExists(config.objectStorage.bucket);
      if (!exists) {
        try {
          await storage.makeBucket(config.objectStorage.bucket, config.objectStorage.region);
        } catch (error) {
          if (!["BucketAlreadyOwnedByYou", "BucketAlreadyExists"].includes(error?.code)) {
            throw error;
          }
        }
      }
      return config.objectStorage.bucket;
    })().catch((error) => {
      bucketPromise = null;
      throw createError(`Object storage is unavailable: ${error.message || "connection failed"}`);
    });
  }

  return bucketPromise;
};

/**
 * Perform a read-only connectivity check for operational health endpoints.
 *
 * Health probes must never provision infrastructure. Bucket creation remains an
 * explicit side effect of the write path through ensureBucket().
 */
const probeBucket = async () => {
  if (!isEnabled()) {
    return {
      enabled: false,
      exists: false,
      bucket: config.objectStorage.bucket
    };
  }

  try {
    const exists = await getClient().bucketExists(config.objectStorage.bucket);
    return {
      enabled: true,
      exists,
      bucket: config.objectStorage.bucket
    };
  } catch (error) {
    throw createError(`Object storage is unavailable: ${error.message || "connection failed"}`);
  }
};

const putObject = async ({ objectName, stream, mimeType }) => {
  const bucket = await ensureBucket();
  const result = await getClient().putObject(bucket, objectName, stream, undefined, {
    "Content-Type": mimeType || "application/octet-stream"
  });
  const stat = await getClient().statObject(bucket, objectName);
  return {
    bucket,
    etag: String(result?.etag || stat?.etag || "").replace(/^\"|\"$/g, "") || null,
    size: Number(stat?.size || 0)
  };
};

const getObject = async ({ bucket, objectName }) => getClient().getObject(bucket, objectName);

const removeObject = async ({ bucket, objectName }) => getClient().removeObject(bucket, objectName);

module.exports = {
  ensureBucket,
  getObject,
  isEnabled,
  probeBucket,
  putObject,
  removeObject
};
