import { Router } from 'express';
import crypto from 'crypto';
import { getBackendConfig } from '../../config/env';
import { LicenseService } from '../services/LicenseService';

const router = Router();
const service = new LicenseService();

router.post('/dodo', async (req, res) => {
  if (!verifyProviderWebhook('dodo', req)) {
    return res.status(401).json({ success: false, error: 'invalid_webhook_signature' });
  }

  await handleProviderWebhook('dodo', req.body).catch(error => {
    console.error('[LicenseWebhook] Dodo webhook failed:', error);
  });
  res.json({ success: true });
});

router.post('/gumroad', async (req, res) => {
  if (!verifyProviderWebhook('gumroad', req)) {
    return res.status(401).json({ success: false, error: 'invalid_webhook_signature' });
  }

  await handleProviderWebhook('gumroad', req.body).catch(error => {
    console.error('[LicenseWebhook] Gumroad webhook failed:', error);
  });
  res.json({ success: true });
});

router.post('/stripe', async (req, res) => {
  if (!verifyProviderWebhook('stripe', req)) {
    return res.status(401).json({ success: false, error: 'invalid_webhook_signature' });
  }

  await handleProviderWebhook('stripe', req.body).catch(error => {
    console.error('[LicenseWebhook] Stripe webhook failed:', error);
  });
  res.json({ success: true });
});

async function handleProviderWebhook(provider: 'dodo' | 'gumroad' | 'stripe', body: any): Promise<void> {
  const eventType = String(body?.type || body?.event || body?.event_type || '').toLowerCase();
  const data = body?.data?.object || body?.data || body || {};
  const providerSubscriptionId = stringValue(
    data.subscription_id ||
    data.subscriptionId ||
    data.id ||
    data.license_key_id
  );
  const licenseId = stringValue(data.licenseId || data.license_id || data.metadata?.licenseId);
  const status = stringValue(data.status || data.subscription_status || eventType) || 'failed';
  const revoked = /revok|refund|chargeback|cancel|expire|delete|disable|fail/.test(`${eventType} ${status}`);

  await service.markProviderStatus({
    provider,
    providerSubscriptionId,
    licenseId,
    status,
    revoked,
  });
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function verifyProviderWebhook(provider: 'dodo' | 'gumroad' | 'stripe', req: any): boolean {
  const config = getBackendConfig();
  const secret =
    provider === 'dodo' ? config.dodoWebhookSecret || config.licenseWebhookSecret :
    provider === 'gumroad' ? config.gumroadWebhookSecret || config.licenseWebhookSecret :
    config.stripeWebhookSecret || config.licenseWebhookSecret;

  if (!secret) {
    return config.nodeEnv !== 'production';
  }

  const rawBody = Buffer.isBuffer(req.rawBody)
    ? req.rawBody.toString('utf8')
    : JSON.stringify(req.body ?? {});

  if (provider === 'stripe') {
    return verifyStripeSignature(secret, rawBody, req.headers?.['stripe-signature']);
  }

  const signature = headerValue(
    req.headers?.[`x-${provider}-signature`] ||
    req.headers?.['x-webhook-signature'] ||
    req.headers?.['x-signature'] ||
    req.headers?.['x-teamsync-signature']
  );

  return verifyHmac(secret, rawBody, signature);
}

function verifyStripeSignature(secret: string, rawBody: string, header: unknown): boolean {
  const signatureHeader = headerValue(header);
  if (!signatureHeader) return false;

  const timestamp = signatureHeader.split(',').find(part => part.startsWith('t='))?.slice(2);
  const signatures = signatureHeader
    .split(',')
    .filter(part => part.startsWith('v1='))
    .map(part => part.slice(3));

  if (!timestamp || signatures.length === 0) return false;
  const signedPayload = `${timestamp}.${rawBody}`;
  return signatures.some(signature => verifyHmac(secret, signedPayload, signature));
}

function verifyHmac(secret: string, payload: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const normalizedSignature = signature.replace(/^sha256=/i, '').trim();
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex');

  return timingSafeEqualHex(expected, normalizedSignature);
}

function timingSafeEqualHex(expected: string, actual: string): boolean {
  if (!/^[a-f0-9]+$/i.test(actual) || actual.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(actual, 'hex')
  );
}

function headerValue(value: unknown): string | undefined {
  if (Array.isArray(value)) return headerValue(value[0]);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export default router;
