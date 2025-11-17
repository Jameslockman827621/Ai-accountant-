'use client';

import React, { useState, useCallback } from 'react';
import { CloudArrowUpIcon, XMarkIcon, CheckCircleIcon } from '@heroicons/react/24/outline';

// Note: react-dropzone should be installed: npm install react-dropzone
// For now, using a simplified dropzone implementation
const useDropzone = (options: any) => {
  return {
    getRootProps: () => ({
      onClick: () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = options.accept ? Object.keys(options.accept).join(',') : '';
        input.onchange = (e: any) => {
          if (e.target.files && options.onDrop) {
            options.onDrop(Array.from(e.target.files));
          }
        };
        input.click();
      },
    }),
    getInputProps: () => ({}),
    isDragActive: false,
  };
};

interface UploadFile {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  error?: string;
  channel: 'dashboard' | 'mobile' | 'email' | 'webhook' | 'csv';
}

interface EnhancedDocumentIntakeProps {
  tenantId: string;
  onUploadComplete?: (files: UploadFile[]) => void;
}

export default function EnhancedDocumentIntake({
  tenantId,
  onUploadComplete,
}: EnhancedDocumentIntakeProps) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<UploadFile['channel']>('dashboard');
  const [isDragging, setIsDragging] = useState(false);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const newFiles: UploadFile[] = acceptedFiles.map((file) => ({
        id: Math.random().toString(36).substring(7),
        file,
        progress: 0,
        status: 'pending',
        channel: selectedChannel,
      }));

      setFiles((prev) => [...prev, ...newFiles]);

      // Simulate upload progress
      newFiles.forEach((uploadFile) => {
        uploadFileWithProgress(uploadFile);
      });
    },
    [selectedChannel]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'text/csv': ['.csv'],
    },
    maxSize: 10 * 1024 * 1024, // 10MB
    onDragEnter: () => setIsDragging(true),
    onDragLeave: () => setIsDragging(false),
  });

  const uploadFileWithProgress = async (uploadFile: UploadFile) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === uploadFile.id ? { ...f, status: 'uploading' } : f))
    );

    try {
      const formData = new FormData();
      formData.append('file', uploadFile.file);
      formData.append('channel', uploadFile.channel);
      formData.append('tenantId', tenantId);

      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const progress = Math.round((e.loaded / e.total) * 100);
          setFiles((prev) =>
            prev.map((f) => (f.id === uploadFile.id ? { ...f, progress } : f))
          );
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          setFiles((prev) =>
            prev.map((f) => (f.id === uploadFile.id ? { ...f, status: 'completed', progress: 100 } : f))
          );
          if (onUploadComplete) {
            onUploadComplete(files.filter((f) => f.status === 'completed'));
          }
        } else {
          setFiles((prev) =>
            prev.map((f) =>
              f.id === uploadFile.id
                ? { ...f, status: 'error', error: 'Upload failed' }
                : f
            )
          );
        }
      });

      xhr.addEventListener('error', () => {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === uploadFile.id ? { ...f, status: 'error', error: 'Network error' } : f
          )
        );
      });

      xhr.open('POST', '/api/documents/upload');
      xhr.send(formData);
    } catch (error) {
      setFiles((prev) =>
        prev.map((f) =>
          f.id === uploadFile.id
            ? { ...f, status: 'error', error: error instanceof Error ? error.message : 'Unknown error' }
            : f
        )
      );
    }
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const retryUpload = (id: string) => {
    const file = files.find((f) => f.id === id);
    if (file) {
      uploadFileWithProgress(file);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Document Intake</h2>
        <p className="text-gray-600">
          Upload documents via multiple channels. Supported formats: PDF, JPG, PNG, XLS, XLSX, CSV
        </p>
      </div>

      {/* Channel Selector */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">Upload Channel</label>
        <div className="flex gap-2">
          {(['dashboard', 'mobile', 'email', 'webhook', 'csv'] as const).map((channel) => (
            <button
              key={channel}
              onClick={() => setSelectedChannel(channel)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                selectedChannel === channel
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {channel.charAt(0).toUpperCase() + channel.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Guidance Cards */}
      <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-semibold text-blue-900 mb-1">Supported Formats</h3>
          <p className="text-sm text-blue-700">
            PDF, JPG, PNG, XLS, XLSX, CSV up to 10MB per file
          </p>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h3 className="font-semibold text-green-900 mb-1">SLA Expectations</h3>
          <p className="text-sm text-green-700">
            Processing typically completes within 5 minutes
          </p>
        </div>
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
          <h3 className="font-semibold text-purple-900 mb-1">Privacy Assured</h3>
          <p className="text-sm text-purple-700">
            All documents encrypted at rest with KMS
          </p>
        </div>
      </div>

      {/* Drop Zone */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
          isDragActive || isDragging
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400'
        }`}
      >
        <input {...getInputProps()} />
        <CloudArrowUpIcon className="mx-auto h-12 w-12 text-gray-400 mb-4" />
        <p className="text-lg font-medium text-gray-700 mb-2">
          {isDragActive ? 'Drop files here' : 'Drag and drop files here'}
        </p>
        <p className="text-sm text-gray-500">or click to browse</p>
      </div>

      {/* Upload Progress */}
      {files.length > 0 && (
        <div className="mt-6 space-y-3">
          <h3 className="text-lg font-semibold text-gray-900">Upload Progress</h3>
          {files.map((file) => (
            <div
              key={file.id}
              className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="flex-shrink-0">
                    {file.status === 'completed' ? (
                      <CheckCircleIcon className="h-5 w-5 text-green-500" />
                    ) : file.status === 'error' ? (
                      <XMarkIcon className="h-5 w-5 text-red-500" />
                    ) : (
                      <div className="h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{file.file.name}</p>
                    <p className="text-xs text-gray-500">
                      {formatFileSize(file.file.size)} • {file.channel}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {file.status === 'error' && (
                    <button
                      onClick={() => retryUpload(file.id)}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      Retry
                    </button>
                  )}
                  <button
                    onClick={() => removeFile(file.id)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>
              </div>
              {file.status === 'uploading' && (
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${file.progress}%` }}
                  />
                </div>
              )}
              {file.status === 'error' && file.error && (
                <p className="text-sm text-red-600 mt-1">{file.error}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
