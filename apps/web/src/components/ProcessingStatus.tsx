import React, { useState, useEffect } from 'react';

interface ProcessingJob {
  id: string;
  type: 'document' | 'ocr' | 'classification' | 'ledger_posting';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number;
  error?: string;
  createdAt: Date;
}

export default function ProcessingStatus() {
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);

  useEffect(() => {
    // Fetch processing jobs
    // In production, this would poll an API or use websockets
    const fetchJobs = async () => {
      // Placeholder - would call API
      setJobs([
        {
          id: '1',
          type: 'document',
          status: 'processing',
          progress: 60,
          createdAt: new Date(),
        },
        {
          id: '2',
          type: 'ocr',
          status: 'completed',
          createdAt: new Date(Date.now() - 5000),
        },
      ]);
    };

    fetchJobs();
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: ProcessingJob['status']) => {
    switch (status) {
      case 'completed':
        return 'text-green-600 bg-green-100';
      case 'processing':
        return 'text-blue-600 bg-blue-100';
      case 'failed':
        return 'text-red-600 bg-red-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  const getTypeLabel = (type: ProcessingJob['type']) => {
    switch (type) {
      case 'document':
        return 'Document Upload';
      case 'ocr':
        return 'OCR Processing';
      case 'classification':
        return 'Classification';
      case 'ledger_posting':
        return 'Ledger Posting';
      default:
        return type;
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold mb-4">Processing Status</h2>
      
      {jobs.length === 0 ? (
        <p className="text-gray-500">No active processing jobs</p>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <div key={job.id} className="border rounded p-4">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="font-medium">{getTypeLabel(job.type)}</p>
                  <p className="text-sm text-gray-500">
                    Started {job.createdAt.toLocaleTimeString()}
                  </p>
                </div>
                <span className={`px-2 py-1 rounded text-xs font-semibold ${getStatusColor(job.status)}`}>
                  {job.status}
                </span>
              </div>
              
              {job.status === 'processing' && job.progress !== undefined && (
                <div className="mt-2">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all"
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{job.progress}% complete</p>
                </div>
              )}
              
              {job.status === 'failed' && job.error && (
                <div className="mt-2 bg-red-50 border-l-4 border-red-400 p-2">
                  <p className="text-sm text-red-800">{job.error}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
