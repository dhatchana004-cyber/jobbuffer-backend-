import fs from 'fs';
import path from 'path';

export interface EmailTemplateData {
  code: string;
  name: string;
  subject: string;
  body: string;
  language: string;
  category: 'AUTOMATION' | 'ANNOUNCEMENT';
  replyTo?: string;
  customReplyTo: boolean;
  variables: string[];
  companyId?: string | null;
  updatedAt: string;
}

export interface EmailDeliveryLogEntry {
  id: string;
  recipientEmail: string;
  recipientName?: string;
  subject: string;
  bodySnippet?: string;
  templateCode?: string;
  companyId?: string | null;
  status: 'DELIVERED' | 'SENT' | 'FAILED';
  channel: 'EMAIL' | 'IN_APP' | 'BOTH';
  error?: string;
  sentAt: string;
}

const TEMPLATES_FILE = path.join(process.cwd(), '.email-templates.json');
const LOGS_FILE = path.join(process.cwd(), '.email-logs.json');

// Default recruitment templates (Used as initial baseline for companies)
const DEFAULT_TEMPLATES: Record<string, EmailTemplateData> = {
  INTERVIEW_REMINDER: {
    code: 'INTERVIEW_REMINDER',
    name: 'Interview Reminder',
    language: 'English (English)',
    category: 'AUTOMATION',
    customReplyTo: false,
    replyTo: '',
    variables: [
      '{candidate_name}',
      '{job_title}',
      '{company_name}',
      '{interview_url}',
      '{interview_date}',
      '{interview_time}',
      '{user_first_name}',
      '{user_last_name}'
    ],
    subject: 'Reminder: Job interview for {job_title} at {company_name}',
    body: `Hi {candidate_name}, how is everything going?

This is a friendly reminder that we've invited you to take a brief job interview for the {job_title} position here at {company_name}.

Scheduled Time: {interview_date} at {interview_time}

Follow this link to start the interview:
{interview_url}

Note: You can take the interview using the link above on the Chrome browser, on any laptop, or smartphone.

Please let me know if you have any questions.

Best regards,
{user_first_name} {user_last_name}, {company_name}`,
    updatedAt: new Date().toISOString()
  },
  APPLICATION_RECEIVED: {
    code: 'APPLICATION_RECEIVED',
    name: 'Application Received Confirmation',
    language: 'English (English)',
    category: 'AUTOMATION',
    customReplyTo: false,
    replyTo: '',
    variables: [
      '{candidate_name}',
      '{job_title}',
      '{company_name}',
      '{user_first_name}'
    ],
    subject: 'Application Received: {job_title} at {company_name}',
    body: `Hi {candidate_name},

Thank you for your interest in joining {company_name}! We have received your application for the {job_title} position.

Our recruiting team is currently reviewing your application and qualifications against the role requirements. We will reach out to you once there is an update on your candidacy.

You can also monitor your application progress anytime directly in your Jobbuffer portal.

Thank you again for considering {company_name} for the next step in your career!

Best regards,
Talent Acquisition Team
{company_name}`,
    updatedAt: new Date().toISOString()
  },
  SHORTLISTED: {
    code: 'SHORTLISTED',
    name: 'Candidate Shortlisted',
    language: 'English (English)',
    category: 'AUTOMATION',
    customReplyTo: false,
    replyTo: '',
    variables: [
      '{candidate_name}',
      '{job_title}',
      '{company_name}',
      '{action_url}'
    ],
    subject: '🎉 Congratulations! You have been Shortlisted for {job_title} at {company_name}',
    body: `Hello {candidate_name},

Great news! The hiring team at {company_name} has thoroughly reviewed your credentials and shortlisted your profile for the {job_title} role.

Next Steps:
Our hiring coordinator will be reaching out shortly to coordinate interview rounds and evaluate your schedule.

You can also check your applicant pipeline and upcoming milestones in your Jobbuffer dashboard:
{action_url}

Congratulations on making it to the shortlisted stage!

Warm regards,
Hiring Team at {company_name}`,
    updatedAt: new Date().toISOString()
  },
  REJECTED: {
    code: 'REJECTED',
    name: 'Application Status Update (Rejection)',
    language: 'English (English)',
    category: 'AUTOMATION',
    customReplyTo: false,
    replyTo: '',
    variables: [
      '{candidate_name}',
      '{job_title}',
      '{company_name}'
    ],
    subject: 'Update regarding your application for {job_title} at {company_name}',
    body: `Dear {candidate_name},

Thank you for taking the time to apply for the {job_title} position at {company_name} and for your interest in our team.

After careful consideration of all applicants, we have decided to move forward with other candidates whose qualifications more closely align with the immediate requirements of this position.

We were genuinely impressed with your profile, and we would like to keep your resume on file for future openings that match your skills.

We wish you the very best of luck in your job search and professional journey.

Sincerely,
Recruiting Team
{company_name}`,
    updatedAt: new Date().toISOString()
  },
  JOB_OFFER: {
    code: 'JOB_OFFER',
    name: 'Candidate Job Offer',
    language: 'English (English)',
    category: 'AUTOMATION',
    customReplyTo: false,
    replyTo: '',
    variables: [
      '{candidate_name}',
      '{job_title}',
      '{company_name}',
      '{action_url}',
      '{user_first_name}'
    ],
    subject: '🎉 Formal Job Offer: {job_title} at {company_name}',
    body: `Dear {candidate_name},

On behalf of {company_name}, we are delighted to offer you the position of {job_title}!

We were thoroughly impressed by your background, interviews, and experience throughout our recruitment process. We believe your leadership and technical skills will make an outstanding impact on our team.

Please review your formal offer letter and compensation package by signing into your Jobbuffer portal:
{action_url}

If you have any questions, feel free to reply directly to this email.

Congratulations once again! We look forward to welcoming you to the {company_name} team.

Warmest regards,
{user_first_name} & the Hiring Team at {company_name}`,
    updatedAt: new Date().toISOString()
  },
  INVITATION: {
    code: 'INVITATION',
    name: 'Candidate Outreach / Talent Invitation',
    language: 'English (English)',
    category: 'AUTOMATION',
    customReplyTo: false,
    replyTo: '',
    variables: [
      '{candidate_name}',
      '{job_title}',
      '{company_name}',
      '{action_url}'
    ],
    subject: 'Opportunity: We think you would be a great fit for {job_title} at {company_name}',
    body: `Hi {candidate_name},

I came across your profile on Jobbuffer and was really impressed by your experience and accomplishments.

We are currently expanding our team at {company_name} and are looking for a talented {job_title}. Given your skillset, I believe this position would be an exciting next step in your career.

You can learn more about this role and submit your interest with 1 click here:
{action_url}

Would you be open to a brief chat this week to explore this further?

Best regards,
Talent Acquisition Team
{company_name}`,
    updatedAt: new Date().toISOString()
  },
  REGISTRATION_OTP: {
    code: 'REGISTRATION_OTP',
    name: 'Registration Email OTP Verification',
    language: 'English (English)',
    category: 'AUTOMATION',
    customReplyTo: false,
    replyTo: '',
    variables: [
      '{candidate_name}',
      '{otp_code}'
    ],
    subject: 'Your Jobbuffer Verification Code: {otp_code}',
    body: `Hello {candidate_name},

Thank you for creating an account with Jobbuffer.

Your single-use email verification code is:
{otp_code}

This verification code will expire in 15 minutes. For security reasons, please do not share this code with anyone.

If you did not request this verification, please safely disregard this email.

Best regards,
The Jobbuffer Team`,
    updatedAt: new Date().toISOString()
  },
  ANNOUNCEMENT: {
    code: 'ANNOUNCEMENT',
    name: 'Admin System Announcement',
    language: 'English (English)',
    category: 'ANNOUNCEMENT',
    customReplyTo: false,
    replyTo: '',
    variables: [
      '{candidate_name}',
      '{company_name}',
      '{action_url}'
    ],
    subject: '📢 Important Update from Jobbuffer Platform Administration',
    body: `Hello {candidate_name},

We have an important announcement regarding upcoming platform enhancements and scheduled maintenance on Jobbuffer.

Please review the latest updates to make sure your recruiting and application workflows remain completely seamless.

Access your dashboard here:
{action_url}

Thank you for being a valued member of the Jobbuffer community!

Best regards,
Jobbuffer Global Administration`,
    updatedAt: new Date().toISOString()
  }
};

class TemplateService {
  private templates: Map<string, EmailTemplateData> = new Map();
  private logs: EmailDeliveryLogEntry[] = [];

  constructor() {
    this.loadTemplates();
    this.loadLogs();
  }

  private cleanCorruptedText(text: string): string {
    if (!text) return '';
    return text
      .replace(/dYZ%/g, '🎉')
      .replace(/dY"/g, '📢')
      .replace(/dY"/g, '📢');
  }

  private loadTemplates() {
    try {
      if (fs.existsSync(TEMPLATES_FILE)) {
        const data = JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf-8'));
        for (const [k, v] of Object.entries(data)) {
          const tpl = v as EmailTemplateData;
          if (tpl) {
            tpl.subject = this.cleanCorruptedText(tpl.subject);
            tpl.body = this.cleanCorruptedText(tpl.body);
            this.templates.set(k, tpl);
          }
        }
      }
    } catch (e) {
      console.warn('[TEMPLATE SERVICE] Error loading templates from file, using defaults');
    }

    // Populate baseline default templates if not present
    for (const [key, val] of Object.entries(DEFAULT_TEMPLATES)) {
      if (!this.templates.has(key)) {
        this.templates.set(key, { ...val });
      }
    }
  }

  private saveTemplates() {
    try {
      const obj: Record<string, EmailTemplateData> = {};
      for (const [k, v] of this.templates.entries()) {
        obj[k] = v;
      }
      fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (e) {
      console.error('[TEMPLATE SERVICE] Error saving templates:', e);
    }
  }

  private loadLogs() {
    try {
      if (fs.existsSync(LOGS_FILE)) {
        this.logs = JSON.parse(fs.readFileSync(LOGS_FILE, 'utf-8'));
      }
    } catch (e) {
      this.logs = [];
    }

    if (this.logs.length === 0) {
      this.logs = [
        {
          id: 'log-seed-1',
          recipientEmail: 'candidate@example.com',
          recipientName: 'Candidate User',
          subject: 'Welcome & Notification Service Active',
          bodySnippet: 'Automated email service configured and initialized.',
          templateCode: 'APPLICATION_RECEIVED',
          status: 'DELIVERED',
          channel: 'EMAIL',
          sentAt: new Date(Date.now() - 3600000).toISOString()
        }
      ];
      this.saveLogs();
    }
  }

  private saveLogs() {
    try {
      if (this.logs.length > 500) {
        this.logs = this.logs.slice(0, 500);
      }
      fs.writeFileSync(LOGS_FILE, JSON.stringify(this.logs, null, 2), 'utf-8');
    } catch (e) {
      console.error('[TEMPLATE SERVICE] Error saving delivery logs:', e);
    }
  }

  /**
   * Get template by code, checking company-specific customization first
   */
  public getTemplate(code: string, companyId?: string | null): EmailTemplateData {
    if (companyId) {
      const companyKey = `${companyId}:${code}`;
      const companyTpl = this.templates.get(companyKey);
      if (companyTpl) {
        return companyTpl;
      }
    }
    return (
      this.templates.get(code) ||
      DEFAULT_TEMPLATES[code] || {
        code,
        name: code,
        subject: '',
        body: '',
        language: 'English (English)',
        category: 'AUTOMATION',
        customReplyTo: false,
        variables: [],
        updatedAt: new Date().toISOString()
      }
    );
  }

  /**
   * Get all recruitment templates customized for a specific company
   */
  public getCompanyTemplates(companyId?: string | null, companyName?: string | null): EmailTemplateData[] {
    const hiringCodes = [
      'INTERVIEW_REMINDER',
      'APPLICATION_RECEIVED',
      'SHORTLISTED',
      'REJECTED',
      'JOB_OFFER',
      'INVITATION'
    ];

    return hiringCodes.map((code) => {
      if (companyId) {
        const companyKey = `${companyId}:${code}`;
        const existing = this.templates.get(companyKey);
        if (existing) return existing;
      }

      // Check if global template exists
      const globalTpl = this.templates.get(code);
      if (globalTpl) return globalTpl;

      // Clone from default
      const def = DEFAULT_TEMPLATES[code];
      return {
        ...def,
        companyId: companyId || null,
        body: companyName ? def.body.split('{company_name}').join(companyName) : def.body
      };
    });
  }

  /**
   * Update or customize a template specifically for a company
   */
  public updateCompanyTemplate(
    companyId: string,
    code: string,
    data: Partial<EmailTemplateData>,
    additionalKeys: string[] = []
  ): EmailTemplateData {
    const companyKey = `${companyId}:${code}`;
    const existing = this.getTemplate(code, companyId);

    const updated: EmailTemplateData = {
      ...existing,
      ...data,
      code,
      companyId,
      updatedAt: new Date().toISOString()
    };

    this.templates.set(companyKey, updated);
    // Also save under base code so any fallback render uses this customized template!
    this.templates.set(code, updated);
    for (const key of additionalKeys) {
      if (key) {
        this.templates.set(`${key}:${code}`, updated);
      }
    }
    this.saveTemplates();
    return updated;
  }

  /**
   * Update a global template
   */
  public updateTemplate(code: string, data: Partial<EmailTemplateData>): EmailTemplateData {
    const existing = this.getTemplate(code);
    const updated: EmailTemplateData = {
      ...existing,
      ...data,
      code,
      updatedAt: new Date().toISOString()
    };
    this.templates.set(code, updated);
    this.saveTemplates();
    return updated;
  }

  /**
   * Global template getter (all templates)
   */
  public getAllTemplates(): EmailTemplateData[] {
    return Array.from(this.templates.values());
  }

  /**
   * Render template with variable interpolation and custom reply-to resolution
   */
  public render(
    code: string,
    variables: Record<string, string | undefined>,
    companyId?: string | null
  ): { subject: string; body: string; customReplyTo?: boolean; replyTo?: string } {
    const template = this.getTemplate(code, companyId);
    let subject = template?.subject || '';
    let body = template?.body || '';

    for (const [key, val] of Object.entries(variables)) {
      const placeholder = `{${key}}`;
      const replacement = val || '';
      subject = subject.split(placeholder).join(replacement);
      body = body.split(placeholder).join(replacement);
    }

    return {
      subject,
      body,
      customReplyTo: template.customReplyTo,
      replyTo: template.replyTo
    };
  }

  public logDelivery(entry: Omit<EmailDeliveryLogEntry, 'id' | 'sentAt'>): EmailDeliveryLogEntry {
    const record: EmailDeliveryLogEntry = {
      id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      ...entry,
      sentAt: new Date().toISOString()
    };

    this.logs.unshift(record);
    this.saveLogs();
    return record;
  }

  public getDeliveryLogs(filter?: { status?: string; search?: string; companyId?: string }): EmailDeliveryLogEntry[] {
    let result = [...this.logs];
    if (filter?.status && filter.status !== 'ALL') {
      result = result.filter((l) => l.status === filter.status);
    }
    if (filter?.companyId) {
      result = result.filter((l) => !l.companyId || l.companyId === filter.companyId);
    }
    if (filter?.search) {
      const s = filter.search.toLowerCase();
      result = result.filter(
        (l) =>
          l.recipientEmail.toLowerCase().includes(s) ||
          (l.recipientName && l.recipientName.toLowerCase().includes(s)) ||
          l.subject.toLowerCase().includes(s) ||
          (l.templateCode && l.templateCode.toLowerCase().includes(s))
      );
    }
    return result;
  }

  public deleteDeliveryLog(id: string): boolean {
    const prevLen = this.logs.length;
    this.logs = this.logs.filter((l) => l.id !== id);
    if (this.logs.length !== prevLen) {
      this.saveLogs();
      return true;
    }
    return false;
  }
}

export const templateService = new TemplateService();
