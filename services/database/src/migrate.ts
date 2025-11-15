import { readFileSync } from 'fs';
import { join } from 'path';
import { db } from './index';

async function migrate(): Promise<void> {
  try {
    console.log('Running database migrations...');
    
      // Always resolve relative to the service root so schema files are found
      const serviceRoot = process.cwd().includes('services/database')
        ? process.cwd()
        : join(__dirname, '..', '..', '..');
      const baseDir = join(serviceRoot, 'src');
    
    // Read main schema
    const schemaPath = join(baseDir, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    await db.query(schema);
    
        // Read bank connections schema
        const bankConnectionsPath = join(baseDir, 'schema-bank-connections.sql');
        try {
          const bankConnectionsSchema = readFileSync(bankConnectionsPath, 'utf-8');
          await db.query(bankConnectionsSchema);
        } catch (err) {
          // File might not exist, that's okay
          console.log('Bank connections schema not found, skipping...');
        }

        // Read conversations schema
        const conversationsPath = join(baseDir, 'schema-conversations.sql');
        try {
          const conversationsSchema = readFileSync(conversationsPath, 'utf-8');
          await db.query(conversationsSchema);
        } catch (err) {
          // File might not exist, that's okay
          console.log('Conversations schema not found, skipping...');
        }

        // Read workflows schema
        const workflowsPath = join(baseDir, 'schema-workflows.sql');
        try {
          const workflowsSchema = readFileSync(workflowsPath, 'utf-8');
          await db.query(workflowsSchema);
        } catch (err) {
          // File might not exist, that's okay
          console.log('Workflows schema not found, skipping...');
        }

        // Read approvals schema
        const approvalsPath = join(baseDir, 'schema-approvals.sql');
        try {
          const approvalsSchema = readFileSync(approvalsPath, 'utf-8');
          await db.query(approvalsSchema);
        } catch (err) {
          // File might not exist, that's okay
          console.log('Approvals schema not found, skipping...');
        }

        // Read accountant schema
        const accountantPath = join(baseDir, 'schema-accountant.sql');
        try {
          const accountantSchema = readFileSync(accountantPath, 'utf-8');
          await db.query(accountantSchema);
        } catch (err) {
          // File might not exist, that's okay
          console.log('Accountant schema not found, skipping...');
        }

        // Read custom reports schema
        const customReportsPath = join(baseDir, 'schema-custom-reports.sql');
        try {
          const customReportsSchema = readFileSync(customReportsPath, 'utf-8');
          await db.query(customReportsSchema);
        } catch (err) {
          // File might not exist, that's okay
          console.log('Custom reports schema not found, skipping...');
        }

        // Read scheduled reports schema
        const scheduledReportsPath = join(baseDir, 'schema-scheduled-reports.sql');
        try {
          const scheduledReportsSchema = readFileSync(scheduledReportsPath, 'utf-8');
          await db.query(scheduledReportsSchema);
        } catch (err) {
          // File might not exist, that's okay
          console.log('Scheduled reports schema not found, skipping...');
        }

        // Read metrics schema
        const metricsPath = join(baseDir, 'schema-metrics.sql');
        try {
          const metricsSchema = readFileSync(metricsPath, 'utf-8');
          await db.query(metricsSchema);
        } catch (err) {
          console.log('Metrics schema not found, skipping...');
        }

        // Read traces schema
        const tracesPath = join(baseDir, 'schema-traces.sql');
        try {
          const tracesSchema = readFileSync(tracesPath, 'utf-8');
          await db.query(tracesSchema);
        } catch (err) {
          console.log('Traces schema not found, skipping...');
        }

        // Read compliance schema
        const compliancePath = join(baseDir, 'schema-compliance.sql');
        try {
          const complianceSchema = readFileSync(compliancePath, 'utf-8');
          await db.query(complianceSchema);
        } catch (err) {
          console.log('Compliance schema not found, skipping...');
        }

        // Read integrations schema
        const integrationsPath = join(baseDir, 'schema-integrations.sql');
        try {
          const integrationsSchema = readFileSync(integrationsPath, 'utf-8');
          await db.query(integrationsSchema);
        } catch (err) {
          console.log('Integrations schema not found, skipping...');
        }

        // Read automation schema
        const automationPath = join(baseDir, 'schema-automation.sql');
        try {
          const automationSchema = readFileSync(automationPath, 'utf-8');
          await db.query(automationSchema);
        } catch (err) {
          console.log('Automation schema not found, skipping...');
        }

        // Read GDPR schema
        const gdprPath = join(baseDir, 'schema-gdpr.sql');
        try {
          const gdprSchema = readFileSync(gdprPath, 'utf-8');
          await db.query(gdprSchema);
        } catch (err) {
          console.log('GDPR schema not found, skipping...');
        }

        // Read MFA schema
        const mfaPath = join(baseDir, 'schema-mfa.sql');
        try {
          const mfaSchema = readFileSync(mfaPath, 'utf-8');
          await db.query(mfaSchema);
        } catch (err) {
          console.log('MFA schema not found, skipping...');
        }
    
    console.log('Migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  migrate();
}
