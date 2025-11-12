import nodemailer from 'nodemailer';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('notification-service');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text?: string
): Promise<void> {
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@ai-accountant.com',
      to,
      subject,
      text: text || html.replace(/<[^>]*>/g, ''),
      html,
    });

    logger.info('Email sent', { to, subject });
  } catch (error) {
    logger.error('Failed to send email', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

export function generateFilingReminderEmail(filingType: string, dueDate: Date, tenantName: string): { subject: string; html: string } {
  const subject = `Reminder: ${filingType} filing due on ${dueDate.toLocaleDateString()}`;
  const html = `
    <html>
      <body>
        <h2>Filing Reminder</h2>
        <p>Dear ${tenantName},</p>
        <p>This is a reminder that your <strong>${filingType}</strong> filing is due on <strong>${dueDate.toLocaleDateString()}</strong>.</p>
        <p>Please ensure your filing is submitted before the deadline to avoid penalties.</p>
        <p>You can view and submit your filing in your AI Accountant dashboard.</p>
        <p>Best regards,<br>AI Accountant Team</p>
      </body>
    </html>
  `;
  return { subject, html };
}

export function generateVATEstimationEmail(estimatedVAT: number, period: string, tenantName: string): { subject: string; html: string } {
  const subject = `VAT Estimation for ${period}`;
  const html = `
    <html>
      <body>
        <h2>VAT Estimation</h2>
        <p>Dear ${tenantName},</p>
        <p>Based on your transactions for ${period}, your estimated VAT liability is:</p>
        <h3>£${estimatedVAT.toFixed(2)}</h3>
        <p>This is an estimate based on current data. Please review your actual figures before filing.</p>
        <p>You can view detailed breakdown in your dashboard.</p>
        <p>Best regards,<br>AI Accountant Team</p>
      </body>
    </html>
  `;
  return { subject, html };
}
