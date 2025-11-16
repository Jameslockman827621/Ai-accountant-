import { sendEmail } from './email';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('notification-service');

const APP_URL = process.env.APP_URL || process.env.FRONTEND_URL || 'https://app.ai-accountant.com';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@ai-accountant.com';

/**
 * Send onboarding welcome email
 */
export async function sendOnboardingWelcome(
  to: string,
  userName: string,
  businessName: string
): Promise<void> {
  const subject = `Welcome to AI Accountant - Let's get you set up`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 0; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px 20px; text-align: center; }
        .header h1 { margin: 0; font-size: 28px; font-weight: 600; }
        .content { padding: 40px 20px; background-color: #ffffff; }
        .content h2 { color: #333; margin-top: 0; }
        .button { display: inline-block; padding: 14px 28px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 20px 0; }
        .steps { background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .step { margin: 15px 0; padding-left: 30px; position: relative; }
        .step::before { content: "✓"; position: absolute; left: 0; color: #667eea; font-weight: bold; font-size: 18px; }
        .footer { padding: 30px 20px; text-align: center; color: #666; font-size: 14px; background-color: #f8f9fa; }
        .footer a { color: #667eea; text-decoration: none; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Welcome to AI Accountant! 👋</h1>
        </div>
        <div class="content">
          <h2>Hi ${userName},</h2>
          <p>We're excited to have <strong>${businessName}</strong> on board. Your AI accountant is ready to automate your bookkeeping, tax compliance, and financial management.</p>
          
          <div class="steps">
            <h3 style="margin-top: 0;">What happens next:</h3>
            <div class="step">Complete your business profile and tax obligations</div>
            <div class="step">Connect your bank accounts for automatic reconciliation</div>
            <div class="step">Set up your chart of accounts</div>
            <div class="step">Configure filing preferences and reminders</div>
          </div>

          <p style="text-align: center;">
            <a href="${APP_URL}/onboarding" class="button">Complete Setup</a>
          </p>

          <p><strong>Need help?</strong> Our onboarding process takes about 10 minutes, and you can pause anytime. If you have questions, reply to this email or visit our <a href="${APP_URL}/help">help center</a>.</p>
        </div>
        <div class="footer">
          <p><strong>AI Accountant Team</strong></p>
          <p>This is an automated message. For support, contact <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail(to, subject, html);
  logger.info('Onboarding welcome email sent', { to, userName });
}

/**
 * Send onboarding completion confirmation
 */
export async function sendOnboardingComplete(
  to: string,
  userName: string,
  businessName: string,
  summary: {
    connectorsConnected: number;
    filingCalendarsCreated: number;
    nextSteps: string[];
  }
): Promise<void> {
  const subject = `🎉 ${businessName} is all set up!`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 0; }
        .header { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); color: white; padding: 40px 20px; text-align: center; }
        .header h1 { margin: 0; font-size: 32px; font-weight: 600; }
        .content { padding: 40px 20px; background-color: #ffffff; }
        .summary-box { background-color: #f0f9ff; border-left: 4px solid #667eea; padding: 20px; margin: 20px 0; border-radius: 4px; }
        .summary-box h3 { margin-top: 0; color: #667eea; }
        .next-steps { background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .next-steps ul { margin: 10px 0; padding-left: 25px; }
        .next-steps li { margin: 8px 0; }
        .button { display: inline-block; padding: 14px 28px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 20px 0; }
        .footer { padding: 30px 20px; text-align: center; color: #666; font-size: 14px; background-color: #f8f9fa; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>You're All Set! 🎉</h1>
        </div>
        <div class="content">
          <h2>Hi ${userName},</h2>
          <p>Congratulations! <strong>${businessName}</strong> is now fully configured and ready to use AI Accountant.</p>

          <div class="summary-box">
            <h3>What's been set up:</h3>
            <ul>
              <li><strong>${summary.connectorsConnected}</strong> bank connector${summary.connectorsConnected !== 1 ? 's' : ''} connected</li>
              <li><strong>${summary.filingCalendarsCreated}</strong> filing calendar${summary.filingCalendarsCreated !== 1 ? 's' : ''} configured</li>
              <li>Chart of accounts provisioned</li>
              <li>AI assistant primed with your business context</li>
            </ul>
          </div>

          ${summary.nextSteps.length > 0 ? `
          <div class="next-steps">
            <h3>Recommended next steps:</h3>
            <ul>
              ${summary.nextSteps.map(step => `<li>${step}</li>`).join('')}
            </ul>
          </div>
          ` : ''}

          <p style="text-align: center;">
            <a href="${APP_URL}/dashboard" class="button">Go to Dashboard</a>
          </p>

          <p>Your AI accountant will now automatically:</p>
          <ul>
            <li>Reconcile bank transactions</li>
            <li>Classify and post documents</li>
            <li>Calculate tax obligations</li>
            <li>Send filing reminders</li>
            <li>Answer your financial questions</li>
          </ul>
        </div>
        <div class="footer">
          <p><strong>AI Accountant Team</strong></p>
          <p>Questions? Contact <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail(to, subject, html);
  logger.info('Onboarding complete email sent', { to, userName });
}

/**
 * Send connector authorization reminder
 */
export async function sendConnectorReminder(
  to: string,
  userName: string,
  connectorName: string,
  connectorType: string,
  authorizationUrl: string
): Promise<void> {
  const subject = `Action Required: Connect ${connectorName}`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 0; }
        .header { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 40px 20px; text-align: center; }
        .content { padding: 40px 20px; background-color: #ffffff; }
        .alert-box { background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 20px; margin: 20px 0; border-radius: 4px; }
        .button { display: inline-block; padding: 14px 28px; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 20px 0; }
        .footer { padding: 30px 20px; text-align: center; color: #666; font-size: 14px; background-color: #f8f9fa; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Connect ${connectorName}</h1>
        </div>
        <div class="content">
          <h2>Hi ${userName},</h2>
          <p>To fully automate your accounting, we need to connect your <strong>${connectorType}</strong> account.</p>

          <div class="alert-box">
            <p><strong>Why this matters:</strong> Connecting ${connectorName} enables automatic transaction import, reconciliation, and real-time financial insights.</p>
          </div>

          <p style="text-align: center;">
            <a href="${authorizationUrl}" class="button">Connect ${connectorName}</a>
          </p>

          <p>This connection is secure and read-only. You can disconnect anytime from your settings.</p>
        </div>
        <div class="footer">
          <p><strong>AI Accountant Team</strong></p>
          <p>Questions? Contact <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail(to, subject, html);
  logger.info('Connector reminder email sent', { to, connectorName });
}

/**
 * Send KYC verification status update
 */
export async function sendKYCStatusUpdate(
  to: string,
  userName: string,
  status: 'approved' | 'rejected' | 'requires_review',
  verificationType: string,
  message?: string
): Promise<void> {
  const statusConfig = {
    approved: {
      subject: '✅ Identity Verification Approved',
      headerColor: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
      title: 'Verification Approved',
      message: message || 'Your identity verification has been approved. You can now access all features.',
    },
    rejected: {
      subject: '❌ Identity Verification Requires Attention',
      headerColor: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      title: 'Verification Issue',
      message: message || 'We need additional information to complete your verification. Please review the requirements and resubmit.',
    },
    requires_review: {
      subject: '⏳ Identity Verification Under Review',
      headerColor: 'linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 100%)',
      title: 'Verification Under Review',
      message: message || 'Your verification is being reviewed by our team. We\'ll notify you once it\'s complete.',
    },
  };

  const config = statusConfig[status];
  const subject = config.subject;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 0; }
        .header { background: ${config.headerColor}; color: white; padding: 40px 20px; text-align: center; }
        .content { padding: 40px 20px; background-color: #ffffff; }
        .button { display: inline-block; padding: 14px 28px; background: ${config.headerColor}; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 20px 0; }
        .footer { padding: 30px 20px; text-align: center; color: #666; font-size: 14px; background-color: #f8f9fa; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>${config.title}</h1>
        </div>
        <div class="content">
          <h2>Hi ${userName},</h2>
          <p>${config.message}</p>
          <p><strong>Verification Type:</strong> ${verificationType}</p>
          ${status === 'rejected' ? `
          <p style="text-align: center;">
            <a href="${APP_URL}/onboarding/kyc" class="button">Review Requirements</a>
          </p>
          ` : ''}
        </div>
        <div class="footer">
          <p><strong>AI Accountant Team</strong></p>
          <p>Questions? Contact <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail(to, subject, html);
  logger.info('KYC status email sent', { to, status, verificationType });
}

/**
 * Send onboarding task reminder
 */
export async function sendOnboardingTaskReminder(
  to: string,
  userName: string,
  incompleteTasks: Array<{ name: string; description: string; url: string }>
): Promise<void> {
  const subject = `Reminder: Complete your onboarding setup`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 0; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px 20px; text-align: center; }
        .content { padding: 40px 20px; background-color: #ffffff; }
        .task { background-color: #f8f9fa; padding: 15px; margin: 10px 0; border-radius: 8px; border-left: 4px solid #667eea; }
        .task h3 { margin: 0 0 5px 0; color: #333; }
        .task p { margin: 5px 0; color: #666; }
        .button { display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; }
        .footer { padding: 30px 20px; text-align: center; color: #666; font-size: 14px; background-color: #f8f9fa; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Complete Your Setup</h1>
        </div>
        <div class="content">
          <h2>Hi ${userName},</h2>
          <p>You're almost done! Here are the remaining tasks to complete your onboarding:</p>

          ${incompleteTasks.map(task => `
          <div class="task">
            <h3>${task.name}</h3>
            <p>${task.description}</p>
            <a href="${task.url}" class="button">Complete Task</a>
          </div>
          `).join('')}

          <p style="text-align: center; margin-top: 30px;">
            <a href="${APP_URL}/onboarding" class="button" style="padding: 14px 28px; font-size: 16px;">Continue Onboarding</a>
          </p>
        </div>
        <div class="footer">
          <p><strong>AI Accountant Team</strong></p>
          <p>Questions? Contact <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail(to, subject, html);
  logger.info('Onboarding task reminder sent', { to, taskCount: incompleteTasks.length });
}

/**
 * Send onboarding summary PDF (placeholder - would generate PDF)
 */
export async function sendOnboardingSummary(
  to: string,
  userName: string,
  businessName: string,
  summaryData: Record<string, unknown>
): Promise<void> {
  const subject = `Your ${businessName} Onboarding Summary`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { padding: 30px; background-color: #ffffff; border: 1px solid #e0e0e0; border-top: none; }
        .summary-section { margin: 20px 0; padding: 15px; background-color: #f8f9fa; border-radius: 8px; }
        .footer { padding: 20px; text-align: center; color: #666; font-size: 14px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Onboarding Summary</h1>
        </div>
        <div class="content">
          <h2>Hi ${userName},</h2>
          <p>Here's a summary of your onboarding configuration for <strong>${businessName}</strong>:</p>

          <div class="summary-section">
            <h3>Business Profile</h3>
            <p><strong>Entity Type:</strong> ${summaryData.entityType || 'N/A'}</p>
            <p><strong>Industry:</strong> ${summaryData.industry || 'N/A'}</p>
            <p><strong>Jurisdiction:</strong> ${summaryData.primaryJurisdiction || 'N/A'}</p>
          </div>

          <div class="summary-section">
            <h3>Tax Obligations</h3>
            <p>${Array.isArray(summaryData.taxObligations) ? summaryData.taxObligations.join(', ') : 'None configured'}</p>
          </div>

          <div class="summary-section">
            <h3>Connected Systems</h3>
            <p>${Array.isArray(summaryData.connectedSystems) && summaryData.connectedSystems.length > 0 
              ? summaryData.connectedSystems.map((s: any) => s.provider).join(', ')
              : 'No systems connected yet'}</p>
          </div>

          <p style="text-align: center; margin-top: 30px;">
            <a href="${APP_URL}/dashboard" style="display: inline-block; padding: 14px 28px; background: #667eea; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">View Dashboard</a>
          </p>
        </div>
        <div class="footer">
          <p><strong>AI Accountant Team</strong></p>
          <p>This summary is also available in your dashboard.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail(to, subject, html);
  logger.info('Onboarding summary email sent', { to, businessName });
}
