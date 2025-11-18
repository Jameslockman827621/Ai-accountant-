// Core domain types

export type TenantId = string;
export type UserId = string;
export type DocumentId = string;
export type LedgerEntryId = string;
export type FilingId = string;
export type AuditLogId = string;

export enum UserRole {
  SUPER_ADMIN = 'super_admin',
  ACCOUNTANT = 'accountant',
  CLIENT = 'client',
  VIEWER = 'viewer',
  OWNER = 'owner',
  STAFF = 'staff',
  AUDITOR = 'auditor',
}

export enum OrganizationType {
  FIRM = 'firm',
  CLIENT = 'client',
  STANDALONE = 'standalone',
}

export enum OrganizationRole {
  OWNER = 'owner',
  ACCOUNTANT = 'accountant',
  STAFF = 'staff',
  AUDITOR = 'auditor',
  VIEWER = 'viewer',
}

export enum DocumentType {
  INVOICE = 'invoice',
  RECEIPT = 'receipt',
  STATEMENT = 'statement',
  PAYSLIP = 'payslip',
  TAX_FORM = 'tax_form',
  OTHER = 'other',
}

export enum DocumentStatus {
  UPLOADED = 'uploaded',
  PROCESSING = 'processing',
  EXTRACTED = 'extracted',
  CLASSIFIED = 'classified',
  POSTED = 'posted',
  ERROR = 'error',
}

export type DocumentUploadSource = 'dashboard' | 'onboarding' | 'mobile' | 'api' | 'legacy';

export type DocumentQualitySeverity = 'info' | 'warning' | 'critical';

export interface DocumentQualityIssue {
  id: string;
  severity: DocumentQualitySeverity;
  message: string;
  recommendation?: string;
}

export interface DocumentChecklistItem {
  id: string;
  label: string;
  completed: boolean;
  helpText?: string;
}

export type ValidationStatus = 'pass' | 'warning' | 'fail';

export interface ValidationComponentSummary {
  component: string;
  status: ValidationStatus;
  errors: string[];
  warnings: string[];
  metrics?: Record<string, unknown>;
}

export interface ValidationRunSummary {
  id: string;
  tenantId: TenantId;
  entityType: string;
  entityId: string;
  status: ValidationStatus;
  errors: string[];
  warnings: string[];
  summary: Record<string, unknown>;
  triggeredBy?: UserId;
  triggeredAt: Date;
  completedAt?: Date;
  components: ValidationComponentSummary[];
}

export enum LedgerEntryType {
  DEBIT = 'debit',
  CREDIT = 'credit',
}

export enum FilingType {
  VAT = 'vat',
  PAYE = 'paye',
  CORPORATION_TAX = 'corporation_tax',
  INCOME_TAX = 'income_tax',
}

export enum FilingStatus {
  DRAFT = 'draft',
  PENDING_APPROVAL = 'pending_approval',
  SUBMITTED = 'submitted',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  ERROR = 'error',
}

export interface Tenant {
  id: TenantId;
  name: string;
  country: string;
  taxId?: string;
  vatNumber?: string;
  subscriptionTier: 'freelancer' | 'sme' | 'accountant' | 'enterprise';
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  id: UserId;
  tenantId: TenantId;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Document {
  id: DocumentId;
  tenantId: TenantId;
  uploadedBy: UserId;
  fileName: string;
  fileType: string;
  fileSize: number;
  storageKey: string;
  documentType?: DocumentType;
  status: DocumentStatus;
  extractedData?: ExtractedData;
  confidenceScore?: number;
  errorMessage?: string;
  qualityScore?: number;
  qualityIssues?: DocumentQualityIssue[];
  uploadChecklist?: DocumentChecklistItem[];
  pageCount?: number;
  uploadSource?: DocumentUploadSource;
  uploadNotes?: string;
  suggestedDocumentType?: DocumentType;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExtractedData {
  vendor?: string;
  date?: Date;
  total?: number;
  tax?: number;
  taxRate?: number;
  currency?: string;
  category?: string;
  description?: string;
  invoiceNumber?: string;
  lineItems?: LineItem[];
  metadata?: Record<string, unknown>;
}

export interface LineItem {
  description: string;
  quantity?: number;
  unitPrice?: number;
  total: number;
  tax?: number;
  category?: string;
}

export interface LedgerEntry {
  id: LedgerEntryId;
  tenantId: TenantId;
  documentId?: DocumentId;
  entryType: LedgerEntryType;
  accountCode: string;
  accountName: string;
  amount: number;
  currency: string;
  description: string;
  transactionDate: Date;
  taxAmount?: number;
  taxRate?: number;
  reconciled: boolean;
  reconciledWith?: LedgerEntryId;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  createdBy: UserId | 'system';
  modelVersion?: string;
  reasoningTrace?: string;
}

export interface ChartOfAccounts {
  tenantId: TenantId;
  accounts: Account[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Account {
  code: string;
  name: string;
  type: AccountType;
  parentCode?: string;
  isActive: boolean;
}

export enum AccountType {
  ASSET = 'asset',
  LIABILITY = 'liability',
  EQUITY = 'equity',
  REVENUE = 'revenue',
  EXPENSE = 'expense',
}

export interface Filing {
  id: FilingId;
  tenantId: TenantId;
  filingType: FilingType;
  status: FilingStatus;
  periodStart: Date;
  periodEnd: Date;
  submittedAt?: Date;
  acceptedAt?: Date;
  rejectedAt?: Date;
  rejectionReason?: string;
  filingData: Record<string, unknown>;
  calculatedBy: UserId | 'system';
  approvedBy?: UserId;
  modelVersion?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditLog {
  id: AuditLogId;
  tenantId: TenantId;
  userId?: UserId;
  action: string;
  resourceType: string;
  resourceId: string;
  changes?: Record<string, { old?: unknown; new?: unknown }>;
  modelVersion?: string;
  reasoningTrace?: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
}

export type TaxRulepackStatus = 'draft' | 'pending' | 'active' | 'deprecated';

export interface TaxNexusThreshold {
  type: 'sales' | 'transactions' | 'revenue' | 'customers';
  amount?: number;
  transactions?: number;
  currency?: string;
  period?: 'monthly' | 'quarterly' | 'annual' | 'rolling12';
  description?: string;
}

export interface TaxFilingSchemaBox {
  id: string;
  label: string;
  description?: string;
  source?: string;
  calculation?: string;
}

export interface TaxFilingSchema {
  form: string;
  jurisdictionCode: string;
  description?: string;
  frequency: 'monthly' | 'quarterly' | 'annual';
  method: 'api' | 'efile' | 'paper';
  boxes: TaxFilingSchemaBox[];
  attachments?: string[];
  dueDaysAfterPeriod?: number;
}

export interface RulepackTransactionInput {
  amount: number;
  type: 'sale' | 'purchase' | 'income' | 'corporate_income';
  category?: string;
  filingStatus?: 'single' | 'married' | 'head';
  industry?: string;
  stateCode?: string;
  nexusState?: string;
  deductions?: number;
  credits?: number;
  metadata?: Record<string, unknown>;
}

export interface TaxRegressionCase {
  id: string;
  description: string;
  transaction: RulepackTransactionInput;
  expected: {
    taxAmount: number;
    taxRate?: number;
    filingBoxes?: Record<string, number>;
    notes?: string;
  };
}

export interface TaxRegressionSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  lastRunAt?: Date;
}

export interface TaxRulepack {
  id: string;
  country: string;
  jurisdictionCode: string;
  region: string;
  year: number;
  version: string;
  rules: TaxRule[];
  filingTypes: string[];
  status: TaxRulepackStatus;
  metadata?: Record<string, unknown>;
  nexusThresholds?: TaxNexusThreshold[];
  filingSchemas?: TaxFilingSchema[];
  checksum?: string;
  regressionSummary?: TaxRegressionSummary;
  effectiveFrom: Date;
  effectiveTo?: Date;
  activatedAt?: Date;
  deprecatedAt?: Date;
  isActive: boolean;
}

export interface TaxRule {
  id: string;
  name: string;
  description: string;
  condition: string;
  action: string;
  priority: number;
  isDeterministic: boolean;
}

export interface AssistantResponse {
  answer: string;
  confidenceScore: number;
  citations: Citation[];
  suggestedAction?: string;
  modelVersion: string;
  promptTemplate: string;
}

export interface Citation {
  type: 'rule' | 'document' | 'ledger';
  id: string;
  reference: string;
}

export interface BankTransaction {
  id: string;
  tenantId: TenantId;
  accountId: string;
  transactionId: string;
  date: Date;
  amount: number;
  currency: string;
  description: string;
  category?: string;
  reconciled: boolean;
  reconciledWith?: DocumentId | LedgerEntryId;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt?: Date;
  isSplit?: boolean;
  splitStatus?: BankTransactionSplitStatus;
  splitRemainingAmount?: number | null;
}

export type BankTransactionSplitStatus = 'not_split' | 'draft' | 'balanced' | 'pending_review' | 'applied';
export type TransactionSplitStatus = 'draft' | 'pending_review' | 'applied' | 'void';

export interface TransactionSplit {
  id: string;
  tenantId: TenantId;
  bankTransactionId: string;
  status: TransactionSplitStatus;
  amount: number;
  currency: string;
  documentId?: DocumentId | null;
  ledgerEntryId?: LedgerEntryId | null;
  memo?: string | null;
  tags?: string[];
  confidenceScore?: number | null;
  createdBy?: UserId | null;
  updatedBy?: UserId | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Subscription {
  tenantId: TenantId;
  tier: 'freelancer' | 'sme' | 'accountant' | 'enterprise';
  status: 'active' | 'cancelled' | 'expired';
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UsageMetrics {
  tenantId: TenantId;
  period: string;
  documentsProcessed: number;
  ocrRequests: number;
  llmQueries: number;
  filingsSubmitted: number;
  storageUsed: number;
  createdAt: Date;
}

export interface ProcessingQueueConfig {
  primary: string;
  retry: string;
  dlq: string;
}

export const ProcessingQueues = {
  OCR: {
    primary: 'ocr_processing',
    retry: 'ocr_processing_retry',
    dlq: 'ocr_processing_dlq',
  },
  CLASSIFICATION: {
    primary: 'document_classification',
    retry: 'document_classification_retry',
    dlq: 'document_classification_dlq',
  },
  LEDGER: {
    primary: 'ledger_posting',
    retry: 'ledger_posting_retry',
    dlq: 'ledger_posting_dlq',
  },
} as const;

export type ProcessingQueueName = keyof typeof ProcessingQueues;
