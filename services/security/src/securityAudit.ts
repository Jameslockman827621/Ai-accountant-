/**
 * Security Audit Procedures
 */

import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import crypto from 'crypto';

const logger = createLogger('security-audit');

export interface SecurityAuditResult {
  category: string;
  check: string;
  status: 'pass' | 'fail' | 'warning';
  message: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  recommendation?: string;
}

export interface SecurityAuditReport {
  timestamp: Date;
  overallStatus: 'secure' | 'at_risk' | 'vulnerable';
  results: SecurityAuditResult[];
  criticalIssues: number;
  highIssues: number;
  mediumIssues: number;
  lowIssues: number;
}

export class SecurityAuditor {
  async runFullAudit(): Promise<SecurityAuditReport> {
    const results: SecurityAuditResult[] = [];

    // Authentication & Authorization
    results.push(...await this.auditAuthentication());
    results.push(...await this.auditAuthorization());

    // Data Protection
    results.push(...await this.auditDataProtection());

    // API Security
    results.push(...await this.auditAPISecurity());

    // Infrastructure Security
    results.push(...await this.auditInfrastructure());

    // Compliance
    results.push(...await this.auditCompliance());

    const criticalIssues = results.filter(r => r.severity === 'critical' && r.status === 'fail').length;
    const highIssues = results.filter(r => r.severity === 'high' && r.status === 'fail').length;
    const mediumIssues = results.filter(r => r.severity === 'medium' && r.status === 'fail').length;
    const lowIssues = results.filter(r => r.severity === 'low' && r.status === 'fail').length;

    let overallStatus: 'secure' | 'at_risk' | 'vulnerable';
    if (criticalIssues > 0) {
      overallStatus = 'vulnerable';
    } else if (highIssues > 0 || mediumIssues > 3) {
      overallStatus = 'at_risk';
    } else {
      overallStatus = 'secure';
    }

    return {
      timestamp: new Date(),
      overallStatus,
      results,
      criticalIssues,
      highIssues,
      mediumIssues,
      lowIssues,
    };
  }

  private async auditAuthentication(): Promise<SecurityAuditResult[]> {
    const results: SecurityAuditResult[] = [];

    // Check password requirements
    const passwordPolicy = await db.query<{ min_length: number; require_uppercase: boolean }>(
      `SELECT min_length, require_uppercase FROM password_policies LIMIT 1`
    ).catch(() => ({ rows: [] }));

    if (passwordPolicy.rows.length === 0) {
      results.push({
        category: 'Authentication',
        check: 'Password Policy',
        status: 'fail',
        message: 'No password policy configured',
        severity: 'high',
        recommendation: 'Implement strong password requirements (min 12 chars, mixed case, numbers, symbols)',
      });
    } else {
      const policy = passwordPolicy.rows[0];
      if (policy.min_length < 12) {
        results.push({
          category: 'Authentication',
          check: 'Password Minimum Length',
          status: 'warning',
          message: `Password minimum length is ${policy.min_length}, should be at least 12`,
          severity: 'medium',
        });
      }
    }

    // Check MFA enforcement
    const mfaEnforcement = await db.query<{ count: string | number }>(
      `SELECT COUNT(*) as count FROM users WHERE mfa_enabled = false`
    ).catch(() => ({ rows: [{ count: 0 }] }));

    const usersWithoutMFA = typeof mfaEnforcement.rows[0]?.count === 'number'
      ? mfaEnforcement.rows[0].count
      : parseInt(String(mfaEnforcement.rows[0]?.count || '0'), 10);

    if (usersWithoutMFA > 0) {
      results.push({
        category: 'Authentication',
        check: 'MFA Enforcement',
        status: 'warning',
        message: `${usersWithoutMFA} users without MFA enabled`,
        severity: 'high',
        recommendation: 'Enforce MFA for all users, especially admin accounts',
      });
    }

    // Check for default credentials
    const defaultUsers = await db.query<{ count: string | number }>(
      `SELECT COUNT(*) as count FROM users WHERE email LIKE '%@example.com' OR password_hash IS NULL`
    ).catch(() => ({ rows: [{ count: 0 }] }));

    const defaultUserCount = typeof defaultUsers.rows[0]?.count === 'number'
      ? defaultUsers.rows[0].count
      : parseInt(String(defaultUsers.rows[0]?.count || '0'), 10);

    if (defaultUserCount > 0) {
      results.push({
        category: 'Authentication',
        check: 'Default Credentials',
        status: 'fail',
        message: 'Default or test accounts found',
        severity: 'critical',
        recommendation: 'Remove all default/test accounts or change their passwords',
      });
    }

    return results;
  }

  private async auditAuthorization(): Promise<SecurityAuditResult[]> {
    const results: SecurityAuditResult[] = [];

    // Check for excessive permissions
    const adminUsers = await db.query<{ count: string | number }>(
      `SELECT COUNT(*) as count FROM users WHERE role = 'admin'`
    ).catch(() => ({ rows: [{ count: 0 }] }));

    const adminCount = typeof adminUsers.rows[0]?.count === 'number'
      ? adminUsers.rows[0].count
      : parseInt(String(adminUsers.rows[0]?.count || '0'), 10);

    if (adminCount > 5) {
      results.push({
        category: 'Authorization',
        check: 'Admin User Count',
        status: 'warning',
        message: `${adminCount} admin users found`,
        severity: 'medium',
        recommendation: 'Review admin access and implement principle of least privilege',
      });
    }

    // Check for missing RBAC
    const hasRBAC = await db.query<{ count: string | number }>(
      `SELECT COUNT(*) as count FROM information_schema.tables WHERE table_name = 'roles'`
    ).catch(() => ({ rows: [{ count: 0 }] }));

    const rbacExists = typeof hasRBAC.rows[0]?.count === 'number'
      ? hasRBAC.rows[0].count > 0
      : parseInt(String(hasRBAC.rows[0]?.count || '0'), 10) > 0;

    if (!rbacExists) {
      results.push({
        category: 'Authorization',
        check: 'Role-Based Access Control',
        status: 'fail',
        message: 'RBAC system not implemented',
        severity: 'high',
        recommendation: 'Implement role-based access control for fine-grained permissions',
      });
    }

    return results;
  }

  private async auditDataProtection(): Promise<SecurityAuditResult[]> {
    const results: SecurityAuditResult[] = [];

    // Check encryption at rest
    const encryptionEnabled = process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length >= 64;
    if (!encryptionEnabled) {
      results.push({
        category: 'Data Protection',
        check: 'Encryption at Rest',
        status: 'fail',
        message: 'Encryption at rest not properly configured',
        severity: 'critical',
        recommendation: 'Enable encryption at rest for sensitive data',
      });
    }

    // Check for unencrypted sensitive fields
    const sensitiveFields = await db.query<{ count: string | number }>(
      `SELECT COUNT(*) as count FROM users WHERE password_hash IS NULL OR password_hash = ''`
    ).catch(() => ({ rows: [{ count: 0 }] }));

    const unencryptedCount = typeof sensitiveFields.rows[0]?.count === 'number'
      ? sensitiveFields.rows[0].count
      : parseInt(String(sensitiveFields.rows[0]?.count || '0'), 10);

    if (unencryptedCount > 0) {
      results.push({
        category: 'Data Protection',
        check: 'Password Encryption',
        status: 'fail',
        message: `${unencryptedCount} users with unencrypted passwords`,
        severity: 'critical',
        recommendation: 'Ensure all passwords are hashed using bcrypt or similar',
      });
    }

    // Check for PII exposure
    results.push({
      category: 'Data Protection',
      check: 'PII Handling',
      status: 'warning',
      message: 'Review PII data handling procedures',
      severity: 'high',
      recommendation: 'Ensure GDPR compliance and proper PII encryption',
    });

    return results;
  }

  private async auditAPISecurity(): Promise<SecurityAuditResult[]> {
    const results: SecurityAuditResult[] = [];

    // Check rate limiting
    const rateLimitingEnabled = process.env.RATE_LIMIT_ENABLED === 'true';
    if (!rateLimitingEnabled) {
      results.push({
        category: 'API Security',
        check: 'Rate Limiting',
        status: 'fail',
        message: 'Rate limiting not enabled',
        severity: 'high',
        recommendation: 'Enable rate limiting to prevent abuse',
      });
    }

    // Check CORS configuration
    const corsOrigin = process.env.CORS_ORIGIN;
    if (!corsOrigin || corsOrigin === '*') {
      results.push({
        category: 'API Security',
        check: 'CORS Configuration',
        status: 'warning',
        message: 'CORS allows all origins',
        severity: 'medium',
        recommendation: 'Restrict CORS to specific trusted domains',
      });
    }

    // Check API key security
    results.push({
      category: 'API Security',
      check: 'API Key Management',
      status: 'warning',
      message: 'Review API key storage and rotation policies',
      severity: 'medium',
      recommendation: 'Use secrets management system for API keys',
    });

    return results;
  }

  private async auditInfrastructure(): Promise<SecurityAuditResult[]> {
    const results: SecurityAuditResult[] = [];

    // Check HTTPS enforcement
    const httpsEnabled = process.env.FORCE_HTTPS === 'true';
    if (!httpsEnabled) {
      results.push({
        category: 'Infrastructure',
        check: 'HTTPS Enforcement',
        status: 'warning',
        message: 'HTTPS not enforced',
        severity: 'high',
        recommendation: 'Enforce HTTPS for all connections',
      });
    }

    // Check security headers
    results.push({
      category: 'Infrastructure',
      check: 'Security Headers',
      status: 'warning',
      message: 'Review security headers (CSP, HSTS, X-Frame-Options)',
      severity: 'medium',
      recommendation: 'Implement comprehensive security headers',
    });

    // Check dependency vulnerabilities
    results.push({
      category: 'Infrastructure',
      check: 'Dependency Vulnerabilities',
      status: 'warning',
      message: 'Run npm audit regularly',
      severity: 'medium',
      recommendation: 'Set up automated dependency scanning',
    });

    return results;
  }

  private async auditCompliance(): Promise<SecurityAuditResult[]> {
    const results: SecurityAuditResult[] = [];

    // GDPR compliance
    const gdprCompliance = await db.query<{ count: string | number }>(
      `SELECT COUNT(*) as count FROM information_schema.tables WHERE table_name = 'data_export_requests'`
    ).catch(() => ({ rows: [{ count: 0 }] }));

    const hasGDPR = typeof gdprCompliance.rows[0]?.count === 'number'
      ? gdprCompliance.rows[0].count > 0
      : parseInt(String(gdprCompliance.rows[0]?.count || '0'), 10) > 0;

    if (!hasGDPR) {
      results.push({
        category: 'Compliance',
        check: 'GDPR Compliance',
        status: 'warning',
        message: 'GDPR data export functionality not found',
        severity: 'medium',
        recommendation: 'Implement GDPR data export and deletion capabilities',
      });
    }

    // Audit logging
    const auditLogging = await db.query<{ count: string | number }>(
      `SELECT COUNT(*) as count FROM information_schema.tables WHERE table_name = 'audit_logs'`
    ).catch(() => ({ rows: [{ count: 0 }] }));

    const hasAuditLogs = typeof auditLogging.rows[0]?.count === 'number'
      ? auditLogging.rows[0].count > 0
      : parseInt(String(auditLogging.rows[0]?.count || '0'), 10) > 0;

    if (!hasAuditLogs) {
      results.push({
        category: 'Compliance',
        check: 'Audit Logging',
        status: 'fail',
        message: 'Audit logging not implemented',
        severity: 'high',
        recommendation: 'Implement comprehensive audit logging for compliance',
      });
    }

    return results;
  }
}

export const securityAuditor = new SecurityAuditor();
