import { sendEmail } from './email';

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Send filing reminder email
 */
export async function sendFilingReminder(
  to: string,
  filingType: string,
  dueDate: Date,
  tenantName: string
): Promise<void> {
  const subject = `Reminder: ${filingType} filing due on ${dueDate.toLocaleDateString('en-GB')}`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background-color: #f9f9f9; }
        .button { display: inline-block; padding: 10px 20px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 5px; }
        .footer { padding: 20px; text-align: center; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Filing Reminder</h1>
        </div>
        <div class="content">
          <p>Dear ${tenantName},</p>
          <p>This is a reminder that your <strong>${filingType}</strong> filing is due on <strong>${dueDate.toLocaleDateString('en-GB')}</strong>.</p>
          <p>Please ensure your filing is submitted before the deadline to avoid penalties.</p>
          <p style="text-align: center;">
            <a href="${process.env.APP_URL || 'https://app.ai-accountant.com'}/filings" class="button">View Filing</a>
          </p>
        </div>
        <div class="footer">
          <p>Best regards,<br>AI Accountant Team</p>
          <p>This is an automated message. Please do not reply to this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail(to, subject, html);
}

/**
 * Send document review required email
 */
export async function sendDocumentReviewRequired(
  to: string,
  documentName: string,
  confidenceScore: number,
  tenantName: string
): Promise<void> {
  const subject = `Document Review Required: ${documentName}`;
  const html = `
    <!DOCTYPE html>
    <html>
    <body>
      <h2>Document Review Required</h2>
      <p>Dear ${tenantName},</p>
      <p>The document <strong>${documentName}</strong> has been processed with a confidence score of <strong>${(confidenceScore * 100).toFixed(0)}%</strong>.</p>
      <p>Please review the extracted data to ensure accuracy.</p>
      <p><a href="${process.env.APP_URL || 'https://app.ai-accountant.com'}/documents">Review Document</a></p>
      <p>Best regards,<br>AI Accountant Team</p>
    </body>
    </html>
  `;

  await sendEmail(to, subject, html);
}

/**
 * Send tax optimization recommendation email
 */
export async function sendTaxOptimizationRecommendation(
  to: string,
  recommendations: Array<{ strategy: string; potentialSaving: number }>,
  tenantName: string
): Promise<void> {
  const totalSavings = recommendations.reduce((sum, r) => sum + r.potentialSaving, 0);
  const subject = `Tax Optimization Opportunities: Potential Savings of £${totalSavings.toLocaleString()}`;
  
  const recommendationsList = recommendations
    .map(r => `<li><strong>${r.strategy}</strong>: Potential saving of £${r.potentialSaving.toLocaleString()}</li>`)
    .join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <body>
      <h2>Tax Optimization Recommendations</h2>
      <p>Dear ${tenantName},</p>
      <p>We've identified several tax optimization opportunities for your business:</p>
      <ul>${recommendationsList}</ul>
      <p><strong>Total Potential Savings: £${totalSavings.toLocaleString()}</strong></p>
      <p><a href="${process.env.APP_URL || 'https://app.ai-accountant.com'}/tax-optimization">View Full Report</a></p>
      <p>Best regards,<br>AI Accountant Team</p>
    </body>
    </html>
  `;

  await sendEmail(to, subject, html);
}

/**
 * Send compliance alert email
 */
export async function sendComplianceAlert(
  to: string,
  issue: string,
  severity: 'critical' | 'warning' | 'info',
  tenantName: string
): Promise<void> {
  const subject = `Compliance Alert: ${issue}`;
  const html = `
    <!DOCTYPE html>
    <html>
    <body>
      <h2>Compliance Alert</h2>
      <p>Dear ${tenantName},</p>
      <p style="color: ${severity === 'critical' ? 'red' : severity === 'warning' ? 'orange' : 'blue'};">
        <strong>${severity.toUpperCase()}:</strong> ${issue}
      </p>
      <p>Please review and take appropriate action.</p>
      <p><a href="${process.env.APP_URL || 'https://app.ai-accountant.com'}/compliance">View Compliance Dashboard</a></p>
      <p>Best regards,<br>AI Accountant Team</p>
    </body>
    </html>
  `;

  await sendEmail(to, subject, html);
}
