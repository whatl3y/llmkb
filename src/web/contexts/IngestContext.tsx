import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { ingestFiles, type FileProgress, type FileIngestResult } from '../api';

export interface FileStatus {
  filename: string;
  status: 'pending' | 'parsing' | 'transcribing' | 'processing' | 'llm' | 'writing' | 'done' | 'duplicate' | 'error';
  message: string;
}

interface IngestContextValue {
  // State
  files: File[];
  fileStatuses: FileStatus[];
  fileResult: FileIngestResult | null;
  uploadLoading: boolean;
  uploadSuccess: string;
  uploadError: string;

  // Actions
  addFiles: (newFiles: File[]) => void;
  removeFile: (index: number) => void;
  startUpload: () => Promise<void>;
  clearResults: () => void;
}

const IngestContext = createContext<IngestContextValue | null>(null);

export function useIngest(): IngestContextValue {
  const ctx = useContext(IngestContext);
  if (!ctx) throw new Error('useIngest must be used within IngestProvider');
  return ctx;
}

export function IngestProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<File[]>([]);
  const [fileStatuses, setFileStatuses] = useState<FileStatus[]>([]);
  const [fileResult, setFileResult] = useState<FileIngestResult | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState('');
  const [uploadError, setUploadError] = useState('');

  const addFiles = useCallback((newFiles: File[]) => {
    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearResults = useCallback(() => {
    setUploadSuccess('');
    setUploadError('');
    setFileStatuses([]);
    setFileResult(null);
  }, []);

  const startUpload = useCallback(async () => {
    // Snapshot current files at call time
    const toUpload = files;
    if (toUpload.length === 0) return;

    setUploadLoading(true);
    setUploadError('');
    setUploadSuccess('');
    setFileResult(null);
    setFileStatuses(toUpload.map((f) => ({ filename: f.name, status: 'pending', message: 'Waiting...' })));
    setFiles([]);

    try {
      const data = await ingestFiles(toUpload, (progress: FileProgress) => {
        setFileStatuses((prev) => {
          const updated = [...prev];
          updated[progress.index] = {
            filename: progress.filename,
            status: progress.status,
            message: progress.message,
          };
          return updated;
        });
      });
      setFileResult(data);
      const dupCount = data.duplicates?.length ?? 0;
      if (data.errors.length === 0) {
        const parts: string[] = [];
        if (data.results.length > 0) {
          parts.push(`Successfully ingested ${data.results.length} file${data.results.length > 1 ? 's' : ''}`);
        }
        if (dupCount > 0) {
          parts.push(`${dupCount} duplicate${dupCount > 1 ? 's' : ''} skipped`);
        }
        setUploadSuccess(parts.join('. ') || 'Upload complete');
      }
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setUploadLoading(false);
    }
  }, [files]);

  return (
    <IngestContext.Provider
      value={{
        files,
        fileStatuses,
        fileResult,
        uploadLoading,
        uploadSuccess,
        uploadError,
        addFiles,
        removeFile,
        startUpload,
        clearResults,
      }}
    >
      {children}
    </IngestContext.Provider>
  );
}
