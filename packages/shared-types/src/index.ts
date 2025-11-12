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

export interface TaxRulepack {
  id: string;
  country: string;
  version: string;
  rules: TaxRule[];
  effectiveFrom: Date;
  effectiveTo?: Date;
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
