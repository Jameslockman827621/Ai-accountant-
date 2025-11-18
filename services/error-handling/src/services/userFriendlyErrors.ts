export interface UserFriendlyError {
  originalError: string;
  userMessage: string;
  actionableGuidance: string[];
  severity: 'info' | 'warning' | 'error' | 'critical';
  category: 'validation' | 'processing' | 'network' | 'authentication' | 'authorization' | 'system' | 'unknown';
  canRetry: boolean;
  supportContact?: string;
}

/**
 * Translate technical errors into user-friendly messages with actionable guidance
 */
export function translateError(error: unknown): UserFriendlyError {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorString = errorMessage.toLowerCase();

  // Database errors
  if (errorString.includes('duplicate key') || errorString.includes('unique constraint')) {
    return {
      originalError: errorMessage,
      userMessage: 'This record already exists',
      actionableGuidance: [
        'Check if you\'ve already created this item',
        'Try searching for the existing record',
        'If this is a duplicate, you can delete the old one first',
      ],
      severity: 'warning',
      category: 'validation',
      canRetry: false,
    };
  }

  if (errorString.includes('foreign key constraint') || errorString.includes('violates foreign key')) {
    return {
      originalError: errorMessage,
      userMessage: 'Cannot complete this action - related record is missing',
      actionableGuidance: [
        'Make sure all required related records exist',
        'Check if you need to create the parent record first',
        'Contact support if this persists',
      ],
      severity: 'error',
      category: 'validation',
      canRetry: false,
    };
  }

  // Network errors
  if (errorString.includes('network') || errorString.includes('timeout') || errorString.includes('econnrefused')) {
    return {
      originalError: errorMessage,
      userMessage: 'Connection problem - please try again',
      actionableGuidance: [
        'Check your internet connection',
        'Wait a moment and try again',
        'If the problem persists, the service may be temporarily unavailable',
      ],
      severity: 'warning',
      category: 'network',
      canRetry: true,
      supportContact: 'Check our status page for service updates',
    };
  }

  // Authentication errors
  if (errorString.includes('unauthorized') || errorString.includes('authentication') || errorString.includes('token')) {
    return {
      originalError: errorMessage,
      userMessage: 'Your session has expired',
      actionableGuidance: [
        'Please log in again',
        'Your session may have timed out for security',
      ],
      severity: 'warning',
      category: 'authentication',
      canRetry: false,
    };
  }

  // Authorization errors
  if (errorString.includes('forbidden') || errorString.includes('permission') || errorString.includes('access denied')) {
    return {
      originalError: errorMessage,
      userMessage: 'You don\'t have permission to perform this action',
      actionableGuidance: [
        'Contact your administrator if you need access',
        'Check your account permissions',
      ],
      severity: 'error',
      category: 'authorization',
      canRetry: false,
    };
  }

  // Validation errors
  if (errorString.includes('validation') || errorString.includes('invalid') || errorString.includes('required')) {
    return {
      originalError: errorMessage,
      userMessage: 'Please check your input',
      actionableGuidance: [
        'Review the form fields highlighted in red',
        'Make sure all required fields are filled',
        'Check that dates and numbers are in the correct format',
      ],
      severity: 'warning',
      category: 'validation',
      canRetry: true,
    };
  }

  // OCR/Processing errors
  if (errorString.includes('ocr') || errorString.includes('extraction') || errorString.includes('processing')) {
    return {
      originalError: errorMessage,
      userMessage: 'Document processing failed',
      actionableGuidance: [
        'Make sure the document image is clear and readable',
        'Try uploading a higher quality image',
        'You can manually enter the information if needed',
      ],
      severity: 'warning',
      category: 'processing',
      canRetry: true,
    };
  }

  // File upload errors
  if (errorString.includes('file') || errorString.includes('upload') || errorString.includes('size')) {
    return {
      originalError: errorMessage,
      userMessage: 'File upload problem',
      actionableGuidance: [
        'Check that the file is not too large (max 10MB)',
        'Make sure the file format is supported (PDF, JPG, PNG)',
        'Try compressing the image if it\'s very large',
      ],
      severity: 'warning',
      category: 'validation',
      canRetry: true,
    };
  }

  // Tax calculation errors
  if (errorString.includes('tax') || errorString.includes('calculation') || errorString.includes('hmrc')) {
    return {
      originalError: errorMessage,
      userMessage: 'Tax calculation issue',
      actionableGuidance: [
        'Verify your financial data is complete',
        'Check that all transactions are properly categorized',
        'Contact support if calculations seem incorrect',
      ],
      severity: 'error',
      category: 'processing',
      canRetry: false,
      supportContact: 'Our support team can help verify your tax calculations',
    };
  }

  // Bank feed errors
  if (errorString.includes('bank') || errorString.includes('plaid') || errorString.includes('connection')) {
    return {
      originalError: errorMessage,
      userMessage: 'Bank connection problem',
      actionableGuidance: [
        'Try reconnecting your bank account',
        'Check that your bank credentials are correct',
        'Some banks may require additional verification',
      ],
      severity: 'warning',
      category: 'network',
      canRetry: true,
    };
  }

  // Rate limiting
  if (errorString.includes('rate limit') || errorString.includes('too many requests')) {
    return {
      originalError: errorMessage,
      userMessage: 'Too many requests - please slow down',
      actionableGuidance: [
        'Wait a moment before trying again',
        'We limit requests to ensure system stability',
      ],
      severity: 'info',
      category: 'system',
      canRetry: true,
    };
  }

  // Generic system errors
  if (errorString.includes('internal server error') || errorString.includes('500')) {
    return {
      originalError: errorMessage,
      userMessage: 'Something went wrong on our end',
      actionableGuidance: [
        'We\'ve been notified and are looking into it',
        'Try again in a few moments',
        'If the problem persists, contact support',
      ],
      severity: 'error',
      category: 'system',
      canRetry: true,
      supportContact: 'Contact support with the error details',
    };
  }

  // Default/unknown errors
  return {
    originalError: errorMessage,
    userMessage: 'An unexpected error occurred',
    actionableGuidance: [
      'Try refreshing the page',
      'If the problem persists, contact support',
    ],
    severity: 'error',
    category: 'unknown',
    canRetry: true,
    supportContact: 'Please contact support with details about what you were trying to do',
  };
}

/**
 * Get error category icon/color for UI
 */
export function getErrorCategoryInfo(category: UserFriendlyError['category']): {
  icon: string;
  color: string;
} {
  const categoryInfo: Record<UserFriendlyError['category'], { icon: string; color: string }> = {
    validation: { icon: '⚠️', color: 'yellow' },
    processing: { icon: '⚙️', color: 'blue' },
    network: { icon: '🌐', color: 'orange' },
    authentication: { icon: '🔐', color: 'red' },
    authorization: { icon: '🚫', color: 'red' },
    system: { icon: '🔧', color: 'gray' },
    unknown: { icon: '❓', color: 'gray' },
  };

  return categoryInfo[category] || categoryInfo.unknown;
}
