import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  GetObjectCommandOutput,
  PutObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import config from '../config.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface IGetFileOptions {
  filename: string;
  bucket?: string;
}

interface IWriteFileOptions {
  filename: string;
  data: Buffer | Readable | string;
  bucket?: string;
  contentType?: string;
}

export default function Aws(region: string = config.aws.region) {
  const accessKeyId = config.aws.accessKey;
  const secretAccessKey = config.aws.secretAccessKey;

  const s3Client = new S3Client({
    region,
    credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    ...(config.aws.endpoint ? { endpoint: config.aws.endpoint, forcePathStyle: true } : {}),
  });

  return {
    s3: s3Client,
    defaultBucket: config.aws.bucket,

    async doesFileExist(options: IGetFileOptions): Promise<boolean> {
      const bucket = options.bucket || this.defaultBucket;
      try {
        await this.s3.send(new HeadObjectCommand({ Bucket: bucket, Key: options.filename }));
        return true;
      } catch (err: any) {
        if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
          return false;
        }
        throw err;
      }
    },

    async getFile(options: IGetFileOptions): Promise<GetObjectCommandOutput> {
      const bucket = options.bucket || this.defaultBucket;
      return await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: options.filename }));
    },

    async getFileStreamWithBackoff(
      streamToPipeTo: NodeJS.WritableStream,
      options: IGetFileOptions,
      onResponse?: (response: GetObjectCommandOutput) => void,
      backoffAttempt: number = 1,
    ): Promise<void> {
      const maxRetries = 5;
      const waitSec = 2 + Math.pow(backoffAttempt, 2);
      const bucket = options.bucket || this.defaultBucket;

      try {
        const response = await this.s3.send(
          new GetObjectCommand({ Bucket: bucket, Key: options.filename }),
        );
        const body = response.Body as Readable;
        if (!body) throw new Error('No body in S3 response');

        if (onResponse && backoffAttempt === 1) {
          onResponse(response);
        }

        await new Promise<void>((resolve, reject) => {
          body.on('error', async (err) => {
            if (backoffAttempt > maxRetries) return reject(err);
            try {
              await sleep(waitSec * 1000);
              await this.getFileStreamWithBackoff(
                streamToPipeTo,
                options,
                undefined,
                backoffAttempt + 1,
              );
              resolve();
            } catch (e) {
              reject(e);
            }
          });
          streamToPipeTo.on('error', reject);
          streamToPipeTo.on('finish', () => resolve());
          body.pipe(streamToPipeTo);
        });
      } catch (err) {
        if (backoffAttempt > maxRetries) throw err;
        await sleep(waitSec * 1000);
        await this.getFileStreamWithBackoff(streamToPipeTo, options, undefined, backoffAttempt + 1);
      }
    },

    /**
     * Upload a file to S3. Uses multipart upload for streams and large files
     * to handle files >5GB (S3 single PutObject limit).
     */
    async writeFile(
      options: IWriteFileOptions,
    ): Promise<{ filename: string; data: PutObjectCommandOutput }> {
      const bucket = options.bucket || this.defaultBucket;
      const params: any = {
        Bucket: bucket,
        Key: options.filename,
        Body: options.data,
      };
      if (options.contentType) {
        params.ContentType = options.contentType;
      }

      // Use multipart upload for streams (which may be large/unknown size)
      if (options.data instanceof Readable) {
        const upload = new Upload({
          client: s3Client,
          params,
          // 10MB parts, 2 concurrent uploads — keeps memory under ~50MB
          partSize: 10 * 1024 * 1024,
          queueSize: 2,
        });
        const result = await upload.done();
        return { filename: options.filename, data: result as PutObjectCommandOutput };
      }

      const returnedData = await this.s3.send(new PutObjectCommand(params));
      return { filename: options.filename, data: returnedData };
    },

    async deleteFile(options: IGetFileOptions): Promise<void> {
      const bucket = options.bucket || this.defaultBucket;
      await this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: options.filename }));
    },

    async deleteByPrefix(prefix: string, bucket?: string): Promise<number> {
      const b = bucket || this.defaultBucket;
      let deleted = 0;
      let continuationToken: string | undefined;

      do {
        const list = await this.s3.send(
          new ListObjectsV2Command({
            Bucket: b,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        );

        if (list.Contents) {
          for (const obj of list.Contents) {
            if (obj.Key) {
              await this.s3.send(new DeleteObjectCommand({ Bucket: b, Key: obj.Key }));
              deleted++;
            }
          }
        }

        continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
      } while (continuationToken);

      return deleted;
    },
  };
}
