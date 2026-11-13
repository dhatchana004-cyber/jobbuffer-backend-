import fs from 'fs';
import path from 'path';

export interface PlanTierDetail {
  key: '1_MONTH' | '3_MONTH' | '6_MONTH';
  name: string;
  durationMonths: number;
  durationDays: number;
  price: number;
  originalPrice: number;
  perMonthPrice: number;
  savingsPercentage: number;
  badge?: string;
  popular?: boolean;
}

export interface SubscriptionPlanConfig {
  // Legacy recruiter fields (mapped to 1 Month)
  proPrice: number;
  proOriginalPrice: number;
  currency: string;
  currencySymbol: string;
  billingCycle: string;
  monthlyJobLimit: number;
  candidateProfileLimit: number;
  atsFeatureEnabled: boolean;
  upiId: string;
  accountName: string;
  taxPercentage: number;
  featuresList: string[];

  // Recruiter 1, 3, 6 Month Pricing Tiers
  recruiter1MonthPrice: number;
  recruiter1MonthOriginalPrice: number;
  recruiter3MonthPrice: number;
  recruiter3MonthOriginalPrice: number;
  recruiter6MonthPrice: number;
  recruiter6MonthOriginalPrice: number;

  // Candidate Mobile App 1, 3, 6 Month Pricing Tiers
  candidate1MonthPrice: number;
  candidate1MonthOriginalPrice: number;
  candidate3MonthPrice: number;
  candidate3MonthOriginalPrice: number;
  candidate6MonthPrice: number;
  candidate6MonthOriginalPrice: number;

  // Legacy Candidate fields
  candidateMonthlyPrice: number;
  candidateAnnualPrice: number;
  candidateMonthlyOriginalPrice: number;
  candidateAnnualOriginalPrice: number;
  candidateDailyApplyLimitFree: number;
  candidateDailyApplyLimitPro: number;

  updatedAt: string;
  updatedBy?: string;
}

export interface CandidatePricingConfig {
  // 1, 3, 6 Month Tiers
  oneMonthPrice: number;
  oneMonthOriginalPrice: number;
  threeMonthPrice: number;
  threeMonthOriginalPrice: number;
  sixMonthPrice: number;
  sixMonthOriginalPrice: number;

  // Structured plans map
  plans: {
    PRO_1_MONTH: PlanTierDetail;
    PRO_3_MONTH: PlanTierDetail;
    PRO_6_MONTH: PlanTierDetail;
    // Legacy keys
    PRO_MONTHLY?: PlanTierDetail;
    PRO_ANNUAL?: PlanTierDetail;
  };

  // Backward-compatible fields
  monthlyPrice: number;
  annualPrice: number;
  monthlyOriginalPrice: number;
  annualOriginalPrice: number;
  savingsPercentage: number;

  // Daily Apply Limits
  dailyApplyLimitFree: number;
  dailyApplyLimitPro: number;
  currency: string;
  currencySymbol: string;
}

export interface RecruiterPricingConfig {
  plans: {
    '1_MONTH': PlanTierDetail;
    '3_MONTH': PlanTierDetail;
    '6_MONTH': PlanTierDetail;
  };
  monthlyJobLimit: number;
  candidateProfileLimit: number;
  atsFeatureEnabled: boolean;
  upiId: string;
  accountName: string;
  currency: string;
  currencySymbol: string;
}

export interface SubscriptionPaymentRecord {
  id: string;
  recruiterId: string;
  recruiterName: string;
  recruiterEmail: string;
  companyName: string;
  plan: 'PRO';
  duration?: '1_MONTH' | '3_MONTH' | '6_MONTH';
  durationMonths?: number;
  amount: number;
  currency: string;
  paymentMethod: string;
  transactionId: string;
  upiReference?: string;
  status: 'COMPLETED' | 'PENDING' | 'FAILED';
  paidAt: string;
  invoiceNumber: string;
}

const CONFIG_FILE = path.join(process.cwd(), '.subscription-config.json');
const PAYMENTS_FILE = path.join(process.cwd(), '.subscription-payments.json');

const DEFAULT_CONFIG: SubscriptionPlanConfig = {
  proPrice: 2499,
  proOriginalPrice: 5999,
  currency: 'INR',
  currencySymbol: '₹',
  billingCycle: 'Monthly',
  monthlyJobLimit: 50,
  candidateProfileLimit: 100,
  atsFeatureEnabled: true,
  upiId: 'jobbuffer@hdfcbank',
  accountName: 'JoBuffer Talent Private Limited',
  taxPercentage: 0,
  featuresList: [
    'Monthly 50 jobs posting capacity (5x Free limit)',
    'View up to 100 candidate profiles with unmasked contacts',
    'Full Applicant Management with ATS (AI Match Scoring, Filter by High/Med/Low, Bulk ATS Scan)',
    'Priority candidate direct call & email outreach'
  ],

  // Recruiter 1, 3, 6 Month Pricing Defaults
  recruiter1MonthPrice: 2499,
  recruiter1MonthOriginalPrice: 5999,
  recruiter3MonthPrice: 5999,
  recruiter3MonthOriginalPrice: 14999,
  recruiter6MonthPrice: 9999,
  recruiter6MonthOriginalPrice: 27999,

  // Candidate Mobile App 1, 3, 6 Month Pricing Defaults
  candidate1MonthPrice: 299,
  candidate1MonthOriginalPrice: 499,
  candidate3MonthPrice: 699,
  candidate3MonthOriginalPrice: 1299,
  candidate6MonthPrice: 1199,
  candidate6MonthOriginalPrice: 2499,

  // Legacy Candidate mappings
  candidateMonthlyPrice: 299,
  candidateAnnualPrice: 1999,
  candidateMonthlyOriginalPrice: 499,
  candidateAnnualOriginalPrice: 3499,
  candidateDailyApplyLimitFree: 50,
  candidateDailyApplyLimitPro: 100,

  updatedAt: new Date().toISOString(),
  updatedBy: 'System Admin'
};

export function getSubscriptionConfig(): SubscriptionPlanConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      const merged = { ...DEFAULT_CONFIG, ...data };

      // Ensure 1, 3, 6 month values default cleanly
      merged.recruiter1MonthPrice = Number(merged.recruiter1MonthPrice ?? merged.proPrice ?? 2499);
      merged.recruiter1MonthOriginalPrice = Number(merged.recruiter1MonthOriginalPrice ?? merged.proOriginalPrice ?? 5999);
      merged.recruiter3MonthPrice = Number(merged.recruiter3MonthPrice ?? 5999);
      merged.recruiter3MonthOriginalPrice = Number(merged.recruiter3MonthOriginalPrice ?? 14999);
      merged.recruiter6MonthPrice = Number(merged.recruiter6MonthPrice ?? 9999);
      merged.recruiter6MonthOriginalPrice = Number(merged.recruiter6MonthOriginalPrice ?? 27999);

      merged.candidate1MonthPrice = Number(merged.candidate1MonthPrice ?? merged.candidateMonthlyPrice ?? 299);
      merged.candidate1MonthOriginalPrice = Number(merged.candidate1MonthOriginalPrice ?? merged.candidateMonthlyOriginalPrice ?? 499);
      merged.candidate3MonthPrice = Number(merged.candidate3MonthPrice ?? 699);
      merged.candidate3MonthOriginalPrice = Number(merged.candidate3MonthOriginalPrice ?? 1299);
      merged.candidate6MonthPrice = Number(merged.candidate6MonthPrice ?? 1199);
      merged.candidate6MonthOriginalPrice = Number(merged.candidate6MonthOriginalPrice ?? 2499);

      // Keep legacy fields in sync
      merged.proPrice = merged.recruiter1MonthPrice;
      merged.proOriginalPrice = merged.recruiter1MonthOriginalPrice;
      merged.candidateMonthlyPrice = merged.candidate1MonthPrice;
      merged.candidateMonthlyOriginalPrice = merged.candidate1MonthOriginalPrice;

      return merged;
    }
  } catch (err) {
    console.error('Error reading subscription config file:', err);
  }
  return DEFAULT_CONFIG;
}

export function getRecruiterPricingPlans(cfg?: SubscriptionPlanConfig): RecruiterPricingConfig {
  const config = cfg || getSubscriptionConfig();
  const p1 = Number(config.recruiter1MonthPrice || 2499);
  const p1Orig = Number(config.recruiter1MonthOriginalPrice || 5999);

  const p3 = Number(config.recruiter3MonthPrice || 5999);
  const p3Orig = Number(config.recruiter3MonthOriginalPrice || 14999);

  const p6 = Number(config.recruiter6MonthPrice || 9999);
  const p6Orig = Number(config.recruiter6MonthOriginalPrice || 27999);

  const savings3 = p1 * 3 > p3 ? Math.round(((p1 * 3 - p3) / (p1 * 3)) * 100) : 20;
  const savings6 = p1 * 6 > p6 ? Math.round(((p1 * 6 - p6) / (p1 * 6)) * 100) : 33;

  return {
    plans: {
      '1_MONTH': {
        key: '1_MONTH',
        name: '1 Month',
        durationMonths: 1,
        durationDays: 30,
        price: p1,
        originalPrice: p1Orig,
        perMonthPrice: p1,
        savingsPercentage: 0,
        badge: 'Flexible'
      },
      '3_MONTH': {
        key: '3_MONTH',
        name: '3 Months',
        durationMonths: 3,
        durationDays: 90,
        price: p3,
        originalPrice: p3Orig,
        perMonthPrice: Math.round(p3 / 3),
        savingsPercentage: savings3,
        badge: `Save ${savings3}%`,
        popular: true
      },
      '6_MONTH': {
        key: '6_MONTH',
        name: '6 Months',
        durationMonths: 6,
        durationDays: 180,
        price: p6,
        originalPrice: p6Orig,
        perMonthPrice: Math.round(p6 / 6),
        savingsPercentage: savings6,
        badge: `Save ${savings6}% • Best Value`
      }
    },
    monthlyJobLimit: Number(config.monthlyJobLimit || 50),
    candidateProfileLimit: Number(config.candidateProfileLimit || 100),
    atsFeatureEnabled: Boolean(config.atsFeatureEnabled),
    upiId: config.upiId || 'jobbuffer@hdfcbank',
    accountName: config.accountName || 'JoBuffer Talent Private Limited',
    currency: config.currency || 'INR',
    currencySymbol: config.currencySymbol || '₹'
  };
}

export function getCandidatePricingConfig(): CandidatePricingConfig {
  const cfg = getSubscriptionConfig();

  const c1 = Number(cfg.candidate1MonthPrice ?? 299);
  const c1Orig = Number(cfg.candidate1MonthOriginalPrice ?? 499);

  const c3 = Number(cfg.candidate3MonthPrice ?? 699);
  const c3Orig = Number(cfg.candidate3MonthOriginalPrice ?? 1299);

  const c6 = Number(cfg.candidate6MonthPrice ?? 1199);
  const c6Orig = Number(cfg.candidate6MonthOriginalPrice ?? 2499);

  const savings3 = c1 * 3 > c3 ? Math.round(((c1 * 3 - c3) / (c1 * 3)) * 100) : 22;
  const savings6 = c1 * 6 > c6 ? Math.round(((c1 * 6 - c6) / (c1 * 6)) * 100) : 33;

  const plan1Month: PlanTierDetail = {
    key: '1_MONTH',
    name: '1 Month',
    durationMonths: 1,
    durationDays: 30,
    price: c1,
    originalPrice: c1Orig,
    perMonthPrice: c1,
    savingsPercentage: 0,
    badge: 'Standard'
  };

  const plan3Month: PlanTierDetail = {
    key: '3_MONTH',
    name: '3 Months',
    durationMonths: 3,
    durationDays: 90,
    price: c3,
    originalPrice: c3Orig,
    perMonthPrice: Math.round(c3 / 3),
    savingsPercentage: savings3,
    badge: `Save ${savings3}%`
  };

  const plan6Month: PlanTierDetail = {
    key: '6_MONTH',
    name: '6 Months',
    durationMonths: 6,
    durationDays: 180,
    price: c6,
    originalPrice: c6Orig,
    perMonthPrice: Math.round(c6 / 6),
    savingsPercentage: savings6,
    badge: `Save ${savings6}% • Best Value`,
    popular: true
  };

  return {
    oneMonthPrice: c1,
    oneMonthOriginalPrice: c1Orig,
    threeMonthPrice: c3,
    threeMonthOriginalPrice: c3Orig,
    sixMonthPrice: c6,
    sixMonthOriginalPrice: c6Orig,

    plans: {
      PRO_1_MONTH: plan1Month,
      PRO_3_MONTH: plan3Month,
      PRO_6_MONTH: plan6Month,
      // Legacy backward compatibility
      PRO_MONTHLY: plan1Month,
      PRO_ANNUAL: plan6Month
    },

    monthlyPrice: c1,
    annualPrice: c6,
    monthlyOriginalPrice: c1Orig,
    annualOriginalPrice: c6Orig,
    savingsPercentage: savings6,

    dailyApplyLimitFree: Number(cfg.candidateDailyApplyLimitFree ?? 50),
    dailyApplyLimitPro: Number(cfg.candidateDailyApplyLimitPro ?? 100),
    currency: cfg.currency || 'INR',
    currencySymbol: cfg.currencySymbol || '₹'
  };
}

export function saveSubscriptionConfig(newConfig: Partial<SubscriptionPlanConfig>, updatedBy = 'Admin'): SubscriptionPlanConfig {
  try {
    const current = getSubscriptionConfig();

    // Reconcile 1-month recruiter price
    const rec1 = Number(newConfig.recruiter1MonthPrice ?? newConfig.proPrice ?? current.recruiter1MonthPrice ?? 2499);
    const rec1Orig = Number(newConfig.recruiter1MonthOriginalPrice ?? newConfig.proOriginalPrice ?? current.recruiter1MonthOriginalPrice ?? 5999);

    const rec3 = Number(newConfig.recruiter3MonthPrice ?? current.recruiter3MonthPrice ?? 5999);
    const rec3Orig = Number(newConfig.recruiter3MonthOriginalPrice ?? current.recruiter3MonthOriginalPrice ?? 14999);

    const rec6 = Number(newConfig.recruiter6MonthPrice ?? current.recruiter6MonthPrice ?? 9999);
    const rec6Orig = Number(newConfig.recruiter6MonthOriginalPrice ?? current.recruiter6MonthOriginalPrice ?? 27999);

    // Reconcile 1-month candidate price
    const cand1 = Number(newConfig.candidate1MonthPrice ?? newConfig.candidateMonthlyPrice ?? current.candidate1MonthPrice ?? 299);
    const cand1Orig = Number(newConfig.candidate1MonthOriginalPrice ?? newConfig.candidateMonthlyOriginalPrice ?? current.candidate1MonthOriginalPrice ?? 499);

    const cand3 = Number(newConfig.candidate3MonthPrice ?? current.candidate3MonthPrice ?? 699);
    const cand3Orig = Number(newConfig.candidate3MonthOriginalPrice ?? current.candidate3MonthOriginalPrice ?? 1299);

    const cand6 = Number(newConfig.candidate6MonthPrice ?? current.candidate6MonthPrice ?? 1199);
    const cand6Orig = Number(newConfig.candidate6MonthOriginalPrice ?? current.candidate6MonthOriginalPrice ?? 2499);

    const merged: SubscriptionPlanConfig = {
      ...current,
      ...newConfig,

      // Recruiter Tiers
      recruiter1MonthPrice: rec1,
      recruiter1MonthOriginalPrice: rec1Orig,
      recruiter3MonthPrice: rec3,
      recruiter3MonthOriginalPrice: rec3Orig,
      recruiter6MonthPrice: rec6,
      recruiter6MonthOriginalPrice: rec6Orig,
      proPrice: rec1,
      proOriginalPrice: rec1Orig,

      // Candidate Tiers
      candidate1MonthPrice: cand1,
      candidate1MonthOriginalPrice: cand1Orig,
      candidate3MonthPrice: cand3,
      candidate3MonthOriginalPrice: cand3Orig,
      candidate6MonthPrice: cand6,
      candidate6MonthOriginalPrice: cand6Orig,
      candidateMonthlyPrice: cand1,
      candidateMonthlyOriginalPrice: cand1Orig,
      candidateAnnualPrice: cand6,
      candidateAnnualOriginalPrice: cand6Orig,

      monthlyJobLimit: Number(newConfig.monthlyJobLimit ?? current.monthlyJobLimit),
      candidateProfileLimit: Number(newConfig.candidateProfileLimit ?? current.candidateProfileLimit),
      candidateDailyApplyLimitFree: Number(newConfig.candidateDailyApplyLimitFree ?? current.candidateDailyApplyLimitFree ?? 50),
      candidateDailyApplyLimitPro: Number(newConfig.candidateDailyApplyLimitPro ?? current.candidateDailyApplyLimitPro ?? 100),
      updatedAt: new Date().toISOString(),
      updatedBy
    };

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf-8');
    return merged;
  } catch (err) {
    console.error('Error saving subscription config file:', err);
    throw err;
  }
}

export function getSubscriptionPayments(): SubscriptionPaymentRecord[] {
  try {
    if (fs.existsSync(PAYMENTS_FILE)) {
      return JSON.parse(fs.readFileSync(PAYMENTS_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error('Error reading subscription payments file:', err);
  }
  return [];
}

export function recordSubscriptionPayment(payment: Omit<SubscriptionPaymentRecord, 'id' | 'paidAt' | 'invoiceNumber'>): SubscriptionPaymentRecord {
  try {
    const payments = getSubscriptionPayments();
    const now = new Date();
    const invoiceNumber = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;
    const newRecord: SubscriptionPaymentRecord = {
      ...payment,
      id: `TXN_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
      paidAt: now.toISOString(),
      invoiceNumber
    };
    payments.unshift(newRecord);
    fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(payments.slice(0, 500), null, 2), 'utf-8');
    return newRecord;
  } catch (err) {
    console.error('Error recording subscription payment:', err);
    throw err;
  }
}
