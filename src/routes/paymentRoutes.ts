import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { setCandidatePro, isCandidatePro } from '../utils/candidateProfileStore';
import { getCandidatePricingConfig } from '../services/subscriptionConfigService';

const router = Router();

// Storage paths for orders and payment transactions
const ORDERS_STORE_PATH = path.join(__dirname, '../../.payment-orders.json');
const TRANSACTIONS_STORE_PATH = path.join(__dirname, '../../.payment-history.json');

// Helper to read/write JSON stores
const readStore = (filePath: string): any[] => {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (e) {
    console.warn(`Error reading ${filePath}:`, e);
  }
  return [];
};

const writeStore = (filePath: string, data: any) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error(`Error writing ${filePath}:`, e);
  }
};

// Plan Pricing Configuration (Dynamically synced with Admin Settings: 1 Month, 3 Months, 6 Months)
export const getProPlans = (): Record<string, { name: string; amount: number; amountInPaise: number; durationDays: number }> => {
  const pricing = getCandidatePricingConfig();
  return {
    PRO_1_MONTH: {
      name: 'JoBuffer Pro (1 Month)',
      amount: pricing.oneMonthPrice,
      amountInPaise: pricing.oneMonthPrice * 100,
      durationDays: 30
    },
    PRO_3_MONTH: {
      name: 'JoBuffer Pro (3 Months)',
      amount: pricing.threeMonthPrice,
      amountInPaise: pricing.threeMonthPrice * 100,
      durationDays: 90
    },
    PRO_6_MONTH: {
      name: 'JoBuffer Pro (6 Months)',
      amount: pricing.sixMonthPrice,
      amountInPaise: pricing.sixMonthPrice * 100,
      durationDays: 180
    },
    // Backward compatibility aliases
    PRO_MONTHLY: {
      name: 'JoBuffer Pro (1 Month)',
      amount: pricing.oneMonthPrice,
      amountInPaise: pricing.oneMonthPrice * 100,
      durationDays: 30
    },
    PRO_ANNUAL: {
      name: 'JoBuffer Pro (6 Months)',
      amount: pricing.sixMonthPrice,
      amountInPaise: pricing.sixMonthPrice * 100,
      durationDays: 180
    }
  };
};

export const PRO_PLANS = getProPlans();

// Helper: Check if real Razorpay keys are configured
const getRazorpayConfig = () => {
  const keyId = (process.env.RAZORPAY_KEY_ID || '').trim();
  const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
  const isRealKey = Boolean(
    keyId && 
    keySecret && 
    !keyId.toLowerCase().includes('your') && 
    !keyId.toLowerCase().includes('placeholder') &&
    !keySecret.toLowerCase().includes('your') &&
    keyId.startsWith('rzp_')
  );
  return { keyId, keySecret, isRealKey };
};

/**
 * 1. GET /api/payments/config
 * Exposes Razorpay Public Key ID & Available Subscription Plans
 */
router.get('/config', (req: Request, res: Response) => {
  const { keyId, isRealKey } = getRazorpayConfig();
  const currentPlans = getProPlans();
  return res.json({
    status: 'success',
    keyId: isRealKey ? keyId : (keyId || 'rzp_test_jobbuffer_sandbox'),
    currency: 'INR',
    isSandbox: !isRealKey,
    plans: currentPlans,
    business: {
      name: 'JoBuffer Careers',
      description: 'JoBuffer Pro Career Membership',
      logo: 'https://ui-avatars.com/api/?name=JoBuffer&background=16a34a&color=ffffff&size=128&bold=true'
    }
  });
});

/**
 * 2. POST /api/payments/create-order
 * Creates an official order via Razorpay API (or Sandbox Order if test keys are used)
 */
router.post('/create-order', async (req: Request, res: Response) => {
  try {
    const { plan = 'PRO_MONTHLY', userId, email, phone, name } = req.body;
    const currentPlans = getProPlans();
    const planConfig = currentPlans[plan] || currentPlans.PRO_MONTHLY;
    const { keyId, keySecret, isRealKey } = getRazorpayConfig();

    const receipt = `rcpt_${Date.now()}_${(userId || 'guest').substring(0, 6)}`;

    let orderData: any = null;

    if (isRealKey) {
      // Create Order via official Razorpay Orders REST API
      const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
      const rzpResponse = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader
        },
        body: JSON.stringify({
          amount: planConfig.amountInPaise,
          currency: 'INR',
          receipt,
          notes: {
            plan,
            userId: userId || 'anonymous',
            email: email || '',
            appName: 'JoBuffer'
          }
        })
      });

      if (!rzpResponse.ok) {
        const errorText = await rzpResponse.text();
        console.error('[Razorpay Order Error]:', errorText);
        return res.status(rzpResponse.status).json({
          message: 'Razorpay order creation failed',
          error: errorText
        });
      }

      orderData = await rzpResponse.json();
    } else {
      // Sandbox / Test Mode Order Generation
      orderData = {
        id: `order_test_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        entity: 'order',
        amount: planConfig.amountInPaise,
        amount_paid: 0,
        amount_due: planConfig.amountInPaise,
        currency: 'INR',
        receipt,
        status: 'created',
        created_at: Math.floor(Date.now() / 1000)
      };
    }

    // Persist order in local audit store
    const orders = readStore(ORDERS_STORE_PATH);
    orders.push({
      ...orderData,
      plan,
      userId,
      email,
      phone,
      name,
      createdAt: new Date().toISOString()
    });
    writeStore(ORDERS_STORE_PATH, orders);

    return res.status(200).json({
      success: true,
      order: orderData,
      keyId: isRealKey ? keyId : 'rzp_test_jobbuffer_sandbox',
      isSandbox: !isRealKey,
      plan: planConfig
    });
  } catch (err: any) {
    console.error('[Payment Order Error]:', err);
    return res.status(500).json({
      message: 'Failed to initialize payment order',
      error: err.message
    });
  }
});

/**
 * 3. POST /api/payments/verify
 * Verifies Razorpay Signature (HMAC SHA-256) and Activates JoBuffer Pro Membership
 */
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      plan = 'PRO_MONTHLY',
      userId,
      email,
      paymentMethod = 'UPI'
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id) {
      return res.status(400).json({ message: 'Order ID and Payment ID are required' });
    }

    const currentPlans = getProPlans();
    const planConfig = currentPlans[plan] || currentPlans.PRO_1_MONTH || currentPlans.PRO_MONTHLY;
    const { keySecret, isRealKey } = getRazorpayConfig();

    let isValid = false;

    if (isRealKey && razorpay_signature) {
      // Official Razorpay HMAC-SHA256 signature verification
      const body = razorpay_order_id + '|' + razorpay_payment_id;
      const expectedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(body.toString())
        .digest('hex');

      isValid = (expectedSignature === razorpay_signature);
    } else {
      // Sandbox / Test Mode: Automatically verify validly formatted test payment IDs
      isValid = Boolean(
        razorpay_payment_id.startsWith('pay_') || 
        razorpay_payment_id.length >= 8
      );
    }

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment signature. Verification failed.'
      });
    }

    // 1. Activate Pro in Candidate Store for email and userId
    const targetEmail = email || 'candidate@jobbuffer.com';
    setCandidatePro(targetEmail, true, plan, planConfig.durationDays);
    if (userId) {
      setCandidatePro(userId, true, plan, planConfig.durationDays);
    }

    // 2. Record successful transaction in audit history
    const transactions = readStore(TRANSACTIONS_STORE_PATH);
    const newTx = {
      id: `tx_${Date.now()}`,
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature || 'sandbox_verified',
      plan,
      planName: planConfig.name,
      amount: planConfig.amount,
      currency: 'INR',
      userId: userId || null,
      email: targetEmail,
      paymentMethod,
      status: 'SUCCESS',
      activatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + planConfig.durationDays * 24 * 60 * 60 * 1000).toISOString()
    };
    transactions.push(newTx);
    writeStore(TRANSACTIONS_STORE_PATH, transactions);

    console.log(`[Payment Success] Activated JoBuffer Pro for ${targetEmail} (${plan}) via ${paymentMethod}`);

    return res.status(200).json({
      success: true,
      message: 'Payment verified successfully! JoBuffer Pro membership is now ACTIVE.',
      transaction: newTx,
      proStatus: {
        isPro: true,
        plan,
        planName: planConfig.name,
        expiresAt: newTx.expiresAt,
        dailyApplyQuota: 100,
        unlockedFeatures: [
          '1-Click Instant Apply',
          'All 7 AI Career Tools',
          'Full ATS Resume Score & Skill Gaps',
          'AI Mock Interview Coach',
          'Scam & Duplicate Shield'
        ]
      }
    });
  } catch (err: any) {
    console.error('[Payment Verification Error]:', err);
    return res.status(500).json({
      message: 'Error verifying payment',
      error: err.message
    });
  }
});

/**
 * 4. GET /api/payments/history/:emailOrId
 * Returns candidate billing and subscription transaction history
 */
router.get('/history/:emailOrId', (req: Request, res: Response) => {
  const rawParam = req.params.emailOrId;
  const paramVal = Array.isArray(rawParam) ? rawParam[0] : (rawParam || '');
  const key = String(paramVal).toLowerCase().trim();
  const transactions = readStore(TRANSACTIONS_STORE_PATH);

  const userTxs = transactions.filter((t: any) => 
    (t.email && t.email.toLowerCase() === key) || 
    (t.userId && t.userId.toLowerCase() === key)
  );

  return res.json({
    status: 'success',
    isPro: isCandidatePro(paramVal),
    transactions: userTxs
  });
});

/**
 * 5. POST /api/payments/webhook
 * Razorpay Webhook listener for payment.captured and order.paid events
 */
router.post('/webhook', (req: Request, res: Response) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'] as string;

    if (webhookSecret && signature) {
      const shasum = crypto.createHmac('sha256', webhookSecret);
      shasum.update(JSON.stringify(req.body));
      const digest = shasum.digest('hex');
      if (digest !== signature) {
        return res.status(400).json({ message: 'Invalid webhook signature' });
      }
    }

    const event = req.body.event;
    console.log(`[Razorpay Webhook] Received event: ${event}`);

    if (event === 'payment.captured' || event === 'order.paid') {
      const payment = req.body.payload?.payment?.entity;
      const email = payment?.email || payment?.notes?.email;
      const plan = payment?.notes?.plan || 'PRO_MONTHLY';
      if (email) {
        const currentPlans = getProPlans();
    const planConfig = currentPlans[plan] || currentPlans.PRO_1_MONTH || currentPlans.PRO_MONTHLY;
        setCandidatePro(email, true, plan, planConfig.durationDays);
        console.log(`[Razorpay Webhook] Pro activated via webhook for ${email}`);
      }
    }

    return res.status(200).json({ status: 'ok' });
  } catch (err: any) {
    console.error('[Razorpay Webhook Error]:', err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
