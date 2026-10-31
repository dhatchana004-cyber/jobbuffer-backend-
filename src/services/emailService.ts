import nodemailer from 'nodemailer';
import { templateService } from './templateService';

const smtpPort = Number(process.env.SMTP_PORT) || 587;
const isSecure = smtpPort === 465;

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.zeptomail.in',
  port: smtpPort,
  secure: isSecure,
  auth: {
    user: process.env.SMTP_USER || 'emailapikey',
    pass: process.env.SMTP_PASS || 'PHtE6r0KR+G93mcm8URU4fK+EpSkZth4/79uJFRGt4YQC/ZXHk1Sr9p4xjTjrh0iUPNFQPaYmtg54rLOsLiFdzvrZmlFX2qyqK3sx/VYSPOZsbq6x00ctFgff0XeUYTmd9Rs0yPTudvSNA=='
  },
  tls: {
    rejectUnauthorized: false
  },
  connectionTimeout: 8000,
  greetingTimeout: 8000,
  socketTimeout: 8000
});

/**
 * Modern HTML wrapper that produces a clean, high-conversion email design
 */
function wrapInBrandedLayout(
  title: string,
  bodyText: string,
  companyName: string = 'Jobbuffer',
  actionButton?: { text: string; url: string }
): string {
  const paragraphs = bodyText
    .split('\n\n')
    .map(p => {
      const formatted = p.trim().replace(/\n/g, '<br/>');
      return `<p style="margin: 0 0 16px 0; color: #334155; font-size: 14px; line-height: 1.6;">${formatted}</p>`;
    })
    .join('');

  const buttonHtml = actionButton
    ? `
    <div style="margin: 28px 0; text-align: center;">
      <a href="${actionButton.url}" target="_blank" style="display: inline-block; background-color: #2563EB; color: #ffffff; text-decoration: none; font-weight: bold; font-size: 14px; padding: 12px 28px; border-radius: 8px; box-shadow: 0 2px 4px rgba(37,99,235,0.2);">
        ${actionButton.text}
      </a>
    </div>
  `
    : '';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F8FAFC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="max-width: 580px; margin: 30px auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #E2E8F0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #0F172A 0%, #1E293B 100%); padding: 24px 32px; text-align: left; border-bottom: 2px solid #3B82F6;">
      <table width="100%" border="0" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 800; letter-spacing: 0.5px;">${companyName}</h1>
            <p style="color: #94A3B8; font-size: 11px; margin: 3px 0 0 0; text-transform: uppercase; letter-spacing: 1px;">Careers & Talent Pipeline</p>
          </td>
          <td align="right">
            <span style="background-color: rgba(59, 130, 246, 0.2); color: #60A5FA; border: 1px solid rgba(96, 165, 250, 0.3); font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 20px;">
              Direct from Employer
            </span>
          </td>
        </tr>
      </table>
    </div>

    <!-- Body Container -->
    <div style="padding: 32px 32px 24px 32px;">
      ${paragraphs}
      ${buttonHtml}
    </div>

    <!-- Footer -->
    <div style="background-color: #F1F5F9; padding: 20px 32px; text-align: center; border-top: 1px solid #E2E8F0; font-size: 11px; color: #64748B;">
      <p style="margin: 0 0 6px 0; font-weight: 500;">
        This is an official candidate notification from ${companyName}.
      </p>
      <p style="margin: 0; color: #94A3B8;">
        Delivered via Jobbuffer Recruitment Platform &copy; ${new Date().getFullYear()}
      </p>
    </div>

  </div>
</body>
</html>
`;
}

/**
 * 1. Registration Email OTP Verification
 */
export const sendOtpEmail = async (
  email: string,
  name: string,
  otp: string
): Promise<{ success: boolean; error?: string }> => {
  const fromAddress = process.env.SMTP_FROM || 'career@tridinsoftware.com';
  const fromName = process.env.SMTP_FROM_NAME || 'Jobbuffer Careers';

  const { subject, body } = templateService.render('REGISTRATION_OTP', {
    candidate_name: name || 'User',
    otp_code: otp
  });

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #2563EB; margin: 0; font-size: 28px; font-weight: bold; letter-spacing: 1px;">Jobbuffer</h1>
        <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Career and Recruitment Platform</p>
      </div>
      <div style="padding: 24px; background-color: #f8fafc; border-radius: 8px; text-align: center;">
        <h2 style="color: #1e293b; margin-top: 0; font-size: 18px;">Email Verification</h2>
        <p style="color: #475569; font-size: 14px; line-height: 1.5;">
          Hello <strong>${name || 'Candidate'}</strong>,<br/>
          Thank you for joining Jobbuffer. Use the single-use verification code below to verify your account:
        </p>
        <div style="margin: 24px 0;">
          <span style="display: inline-block; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #2563EB; background: #eff6ff; padding: 12px 24px; border-radius: 8px; border: 1px dashed #3b82f6;">
            ${otp}
          </span>
        </div>
        <p style="color: #94a3b8; font-size: 12px; margin-bottom: 0;">
          This code will expire in 15 minutes. For security, never share this code with anyone.
        </p>
      </div>
      <div style="margin-top: 24px; text-align: center; color: #94a3b8; font-size: 12px;">
        &copy; ${new Date().getFullYear()} Jobbuffer Technologies. All rights reserved.
      </div>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromAddress}>`,
      to: email,
      subject,
      text: body,
      html
    });

    console.log(`[EMAIL] OTP sent to ${email} (ID: ${info.messageId})`);

    templateService.logDelivery({
      recipientEmail: email,
      recipientName: name,
      subject,
      bodySnippet: `OTP: ${otp}`,
      templateCode: 'REGISTRATION_OTP',
      status: 'DELIVERED',
      channel: 'EMAIL'
    });

    return { success: true };
  } catch (error: any) {
    console.error(`[EMAIL] Failed to send OTP to ${email}:`, error?.message || error);

    templateService.logDelivery({
      recipientEmail: email,
      recipientName: name,
      subject,
      bodySnippet: `OTP: ${otp}`,
      templateCode: 'REGISTRATION_OTP',
      status: 'FAILED',
      channel: 'EMAIL',
      error: error?.message || 'SMTP delivery failure'
    });

    return { success: false, error: error?.message || 'SMTP delivery failed' };
  }
};

/**
 * 2. Application Received Confirmation (uses company's custom template & reply-to)
 */
export const sendApplicationReceivedEmail = async (
  email: string,
  candidateName: string,
  jobTitle: string,
  companyName: string,
  companyId?: string
): Promise<{ success: boolean; error?: string }> => {
  const fromAddress = process.env.SMTP_FROM || 'career@tridinsoftware.com';
  const fromName = companyName || 'Jobbuffer Careers';

  const firstName = (candidateName || 'Candidate').split(' ')[0];
  const { subject, body, customReplyTo, replyTo } = templateService.render(
    'APPLICATION_RECEIVED',
    {
      candidate_name: candidateName || 'Candidate',
      user_first_name: firstName,
      job_title: jobTitle,
      company_name: companyName
    },
    companyId
  );

  const html = wrapInBrandedLayout(
    subject,
    body,
    companyName,
    { text: 'View Application Status', url: 'http://localhost:5173/login' }
  );

  try {
    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromAddress}>`,
      to: email,
      replyTo: (customReplyTo && replyTo) ? replyTo : undefined,
      subject,
      text: body,
      html
    });

    console.log(`[EMAIL] Application confirmation sent to ${email} (ID: ${info.messageId})`);

    templateService.logDelivery({
      recipientEmail: email,
      recipientName: candidateName,
      subject,
      bodySnippet: `Job: ${jobTitle} at ${companyName}`,
      templateCode: 'APPLICATION_RECEIVED',
      companyId: companyId || null,
      status: 'DELIVERED',
      channel: 'EMAIL'
    });

    return { success: true };
  } catch (error: any) {
    console.warn(`[EMAIL] Application confirmation delivery error for ${email}:`, error?.message || error);

    templateService.logDelivery({
      recipientEmail: email,
      recipientName: candidateName,
      subject,
      bodySnippet: `Job: ${jobTitle} at ${companyName}`,
      templateCode: 'APPLICATION_RECEIVED',
      companyId: companyId || null,
      status: 'FAILED',
      channel: 'EMAIL',
      error: error?.message
    });

    return { success: false, error: error?.message };
  }
};

/**
 * 3. Shortlisted Status Email (uses company's custom template & reply-to)
 */
export const sendShortlistEmail = async (
  email: string,
  candidateName: string,
  jobTitle: string,
  companyName: string,
  companyId?: string
): Promise<{ success: boolean; error?: string }> => {
  const fromAddress = process.env.SMTP_FROM || 'career@tridinsoftware.com';
  const fromName = companyName || 'Jobbuffer Careers';

  const { subject, body, customReplyTo, replyTo } = templateService.render(
    'SHORTLISTED',
    {
      candidate_name: candidateName || 'Candidate',
      job_title: jobTitle,
      company_name: companyName,
      action_url: 'http://localhost:5173/login'
    },
    companyId
  );

  const html = wrapInBrandedLayout(
    subject,
    body,
    companyName,
    { text: 'Open Candidate Portal', url: 'http://localhost:5173/login' }
  );

  try {
    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromAddress}>`,
      to: email,
      replyTo: (customReplyTo && replyTo) ? replyTo : undefined,
      subject,
      text: body,
      html
    });

    console.log(`[EMAIL] Shortlist notification email sent to ${email} (ID: ${info.messageId})`);

    templateService.logDelivery({
      recipientEmail: email,
      recipientName: candidateName,
      subject,
      bodySnippet: `Shortlisted for: ${jobTitle}`,
      templateCode: 'SHORTLISTED',
      companyId: companyId || null,
      status: 'DELIVERED',
      channel: 'EMAIL'
    });

    return { success: true };
  } catch (error: any) {
    console.warn(`[EMAIL] Could not send shortlist email to ${email}:`, error?.message || error);

    templateService.logDelivery({
      recipientEmail: email,
      recipientName: candidateName,
      subject,
      bodySnippet: `Shortlisted for: ${jobTitle}`,
      templateCode: 'SHORTLISTED',
      companyId: companyId || null,
      status: 'FAILED',
      channel: 'EMAIL',
      error: error?.message
    });

    return { success: false, error: error?.message || 'SMTP delivery failed' };
  }
};

/**
 * 3b. Rejected Status Email (uses company's custom template & reply-to)
 */
export const sendRejectionEmail = async (
  email: string,
  candidateName: string,
  jobTitle: string,
  companyName: string,
  companyId?: string
): Promise<{ success: boolean; error?: string }> => {
  const fromAddress = process.env.SMTP_FROM || 'career@tridinsoftware.com';
  const fromName = companyName || 'Jobbuffer Careers';

  const { subject, body, customReplyTo, replyTo } = templateService.render(
    'REJECTED',
    {
      candidate_name: candidateName || 'Candidate',
      job_title: jobTitle,
      company_name: companyName
    },
    companyId
  );

  const html = wrapInBrandedLayout(
    subject,
    body,
    companyName,
    { text: 'Browse Other Opportunities', url: 'http://localhost:5173/login' }
  );

  try {
    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromAddress}>`,
      to: email,
      replyTo: (customReplyTo && replyTo) ? replyTo : undefined,
      subject,
      text: body,
      html
    });

    console.log(`[EMAIL] Rejection update email sent to ${email} (ID: ${info.messageId})`);

    templateService.logDelivery({
      recipientEmail: email,
      recipientName: candidateName,
      subject,
      bodySnippet: `Application update for: ${jobTitle}`,
      templateCode: 'REJECTED',
      companyId: companyId || null,
      status: 'DELIVERED',
      channel: 'EMAIL'
    });

    return { success: true };
  } catch (error: any) {
    console.warn(`[EMAIL] Could not send rejection email to ${email}:`, error?.message || error);

    templateService.logDelivery({
      recipientEmail: email,
      recipientName: candidateName,
      subject,
      bodySnippet: `Application update for: ${jobTitle}`,
      templateCode: 'REJECTED',
      companyId: companyId || null,
      status: 'FAILED',
      channel: 'EMAIL',
      error: error?.message
    });

    return { success: false, error: error?.message || 'SMTP delivery failed' };
  }
};

/**
 * 4. Interview Reminder & Invitation Email (uses company's custom template & reply-to)
 */
export const sendInterviewReminderEmail = async (
  email: string,
  candidateName: string,
  jobTitle: string,
  companyName: string,
  interview: {
    scheduledAt: string | Date;
    meetingLink?: string | null;
    recruiterName?: string;
  },
  companyId?: string
): Promise<{ success: boolean; error?: string }> => {
  const fromAddress = process.env.SMTP_FROM || 'career@tridinsoftware.com';
  const fromName = companyName || 'Jobbuffer Careers';

  const scheduledDate = new Date(interview.scheduledAt);
  const dateFormatted = scheduledDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
  const timeFormatted = scheduledDate.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  });

  const recruiterNames = (interview.recruiterName || 'Hiring Manager').split(' ');
  const user_first_name = recruiterNames[0] || 'Hiring';
  const user_last_name = recruiterNames.slice(1).join(' ') || 'Team';

  const interview_url = interview.meetingLink || 'https://meet.google.com/jobbuffer-interview';

  const { subject, body, customReplyTo, replyTo } = templateService.render(
    'INTERVIEW_REMINDER',
    {
      candidate_name: candidateName || 'Candidate',
      job_title: jobTitle,
      company_name: companyName,
      interview_url,
      interview_date: dateFormatted,
      interview_time: timeFormatted,
      user_first_name,
      user_last_name
    },
    companyId
  );

  const html = wrapInBrandedLayout(
    subject,
    body,
    companyName,
    { text: 'Join Interview Room', url: interview_url }
  );

  try {
    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromAddress}>`,
      to: email,
      replyTo: (customReplyTo && replyTo) ? replyTo : undefined,
      subject,
      text: body,
      html
    });

    console.log(`[EMAIL] Interview reminder sent to ${email} (ID: ${info.messageId})`);

    templateService.logDelivery({
      recipientEmail: email,
      recipientName: candidateName,
      subject,
      bodySnippet: `Interview for ${jobTitle} at ${timeFormatted}, ${dateFormatted}`,
      templateCode: 'INTERVIEW_REMINDER',
      companyId: companyId || null,
      status: 'DELIVERED',
      channel: 'EMAIL'
    });

    return { success: true };
  } catch (error: any) {
    console.warn(`[EMAIL] Could not send interview reminder to ${email}:`, error?.message || error);

    templateService.logDelivery({
      recipientEmail: email,
      recipientName: candidateName,
      subject,
      bodySnippet: `Interview for ${jobTitle}`,
      templateCode: 'INTERVIEW_REMINDER',
      companyId: companyId || null,
      status: 'FAILED',
      channel: 'EMAIL',
      error: error?.message
    });

    return { success: false, error: error?.message || 'SMTP delivery failed' };
  }
};

/**
 * 5. Job Offer Email (uses company's custom template & reply-to)
 */
export const sendJobOfferEmail = async (
  email: string,
  candidateName: string,
  jobTitle: string,
  companyName: string,
  recruiterName?: string,
  companyId?: string
): Promise<{ success: boolean; error?: string }> => {
  const fromAddress = process.env.SMTP_FROM || 'career@tridinsoftware.com';
  const fromName = companyName || 'Jobbuffer Careers';

  const user_first_name = (recruiterName || 'Hiring').split(' ')[0];

  const { subject, body, customReplyTo, replyTo } = templateService.render(
    'JOB_OFFER',
    {
      candidate_name: candidateName || 'Candidate',
      job_title: jobTitle,
      company_name: companyName,
      user_first_name,
      action_url: 'http://localhost:5173/login'
    },
    companyId
  );

  const html = wrapInBrandedLayout(
    subject,
    body,
    companyName,
    { text: 'Review Job Offer Letter', url: 'http://localhost:5173/login' }
  );

  try {
    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromAddress}>`,
      to: email,
      replyTo: (customReplyTo && replyTo) ? replyTo : undefined,
      subject,
      text: body,
      html
    });

    templateService.logDelivery({
      recipientEmail: email,
      recipientName: candidateName,
      subject,
      bodySnippet: `Job offer for: ${jobTitle}`,
      templateCode: 'JOB_OFFER',
      companyId: companyId || null,
      status: 'DELIVERED',
      channel: 'EMAIL'
    });

    return { success: true };
  } catch (error: any) {
    templateService.logDelivery({
      recipientEmail: email,
      recipientName: candidateName,
      subject,
      bodySnippet: `Job offer for: ${jobTitle}`,
      templateCode: 'JOB_OFFER',
      companyId: companyId || null,
      status: 'FAILED',
      channel: 'EMAIL',
      error: error?.message
    });
    return { success: false, error: error?.message };
  }
};

/**
 * 6. Admin Custom Announcement & Test Email Dispatcher
 */
export const sendAnnouncementEmail = async (
  email: string,
  name: string,
  subject: string,
  bodyText: string,
  customReplyTo?: string
): Promise<{ success: boolean; error?: string }> => {
  const fromAddress = process.env.SMTP_FROM || 'career@tridinsoftware.com';
  const fromName = process.env.SMTP_FROM_NAME || 'Jobbuffer Platform Admin';

  const html = wrapInBrandedLayout(
    subject,
    bodyText,
    'Jobbuffer Platform',
    { text: 'Open Platform', url: 'http://localhost:5173/login' }
  );

  try {
    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromAddress}>`,
      to: email,
      replyTo: customReplyTo || undefined,
      subject,
      text: bodyText,
      html
    });

    console.log(`[EMAIL] Announcement dispatched to ${email} (ID: ${info.messageId})`);

    templateService.logDelivery({
      recipientEmail: email,
      recipientName: name,
      subject,
      bodySnippet: bodyText.substring(0, 80),
      templateCode: 'ANNOUNCEMENT',
      status: 'DELIVERED',
      channel: 'EMAIL'
    });

    return { success: true };
  } catch (error: any) {
    console.error(`[EMAIL] Failed announcement delivery to ${email}:`, error?.message || error);

    templateService.logDelivery({
      recipientEmail: email,
      recipientName: name,
      subject,
      bodySnippet: bodyText.substring(0, 80),
      templateCode: 'ANNOUNCEMENT',
      status: 'FAILED',
      channel: 'EMAIL',
      error: error?.message
    });

    return { success: false, error: error?.message };
  }
};
