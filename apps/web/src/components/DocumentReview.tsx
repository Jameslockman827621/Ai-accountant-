import React, { useState, useEffect } from 'react';

interface Document {
  id: string;
  fileName: string;
  documentType?: string;
  confidenceScore?: number;
  extractedData?: {
    vendor?: string;
    date?: string;
    total?: number;
    tax?: number;
    invoiceNumber?: string;
  };
  status: string;
}

interface DocumentReviewProps {
  documentId: string;
  onApprove: (documentId: string) => void;
  onReject: (documentId: string, reason: string) => void;
  onEdit: (documentId: string, data: Document['extractedData']) => void;
}

export default function DocumentReview({ documentId, onApprove, onReject, onEdit }: DocumentReviewProps) {
  const [document, setDocument] = useState<Document | null>(null);
  const [editedData, setEditedData] = useState<Document['extractedData']>({});
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    // Fetch document data
    // In production, this would call the API
    // For now, using placeholder
    setDocument({
      id: documentId,
      fileName: 'invoice.pdf',
      documentType: 'invoice',
      confidenceScore: 0.75,
      extractedData: {
        vendor: 'Example Vendor',
        date: '2024-01-15',
        total: 1000.00,
        tax: 200.00,
        invoiceNumber: 'INV-001',
      },
      status: 'classified',
    });
    setEditedData({
      vendor: 'Example Vendor',
      date: '2024-01-15',
      total: 1000.00,
      tax: 200.00,
      invoiceNumber: 'INV-001',
    });
  }, [documentId]);

  if (!document) {
    return <div>Loading...</div>;
  }

  const confidenceColor = (document.confidenceScore || 0) >= 0.85 ? 'green' : 
                          (document.confidenceScore || 0) >= 0.70 ? 'yellow' : 'red';

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-xl font-semibold">{document.fileName}</h3>
          <p className="text-sm text-gray-500">Type: {document.documentType || 'Unknown'}</p>
        </div>
        <div className={`px-3 py-1 rounded text-sm font-semibold bg-${confidenceColor}-100 text-${confidenceColor}-800`}>
          Confidence: {((document.confidenceScore || 0) * 100).toFixed(0)}%
        </div>
      </div>

      {(document.confidenceScore || 0) < 0.85 && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
          <p className="text-yellow-800">
            This document has a confidence score below 85%. Please review the extracted data carefully.
          </p>
        </div>
      )}

      {isEditing ? (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Vendor</label>
            <input
              type="text"
              value={editedData?.vendor || ''}
              onChange={(e) => setEditedData({ ...editedData, vendor: e.target.value })}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Date</label>
            <input
              type="date"
              value={editedData?.date || ''}
              onChange={(e) => setEditedData({ ...editedData, date: e.target.value })}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Total</label>
            <input
              type="number"
              step="0.01"
              value={editedData?.total || 0}
              onChange={(e) => setEditedData({ ...editedData, total: parseFloat(e.target.value) })}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Tax</label>
            <input
              type="number"
              step="0.01"
              value={editedData?.tax || 0}
              onChange={(e) => setEditedData({ ...editedData, tax: parseFloat(e.target.value) })}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Invoice Number</label>
            <input
              type="text"
              value={editedData?.invoiceNumber || ''}
              onChange={(e) => setEditedData({ ...editedData, invoiceNumber: e.target.value })}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div className="flex space-x-2">
            <button
              onClick={() => {
                onEdit(documentId, editedData);
                setIsEditing(false);
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Save Changes
            </button>
            <button
              onClick={() => setIsEditing(false)}
              className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 mb-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">Vendor</p>
              <p className="font-medium">{document.extractedData?.vendor || 'N/A'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Date</p>
              <p className="font-medium">{document.extractedData?.date || 'N/A'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Total</p>
              <p className="font-medium">£{document.extractedData?.total?.toFixed(2) || '0.00'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Tax</p>
              <p className="font-medium">£{document.extractedData?.tax?.toFixed(2) || '0.00'}</p>
            </div>
            {document.extractedData?.invoiceNumber && (
              <div>
                <p className="text-sm text-gray-500">Invoice Number</p>
                <p className="font-medium">{document.extractedData.invoiceNumber}</p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex space-x-2">
        {!isEditing && (
          <>
            <button
              onClick={() => setIsEditing(true)}
              className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
            >
              Edit
            </button>
            <button
              onClick={() => onApprove(documentId)}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            >
              Approve
            </button>
            <button
              onClick={() => {
                const reason = prompt('Reason for rejection:');
                if (reason) onReject(documentId, reason);
              }}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
            >
              Reject
            </button>
          </>
        )}
      </div>
    </div>
  );
}
