/**
 * Stripe client — Render-compatible
 * Uses STRIPE_LIVE_SECRET_KEY / STRIPE_LIVE_PUBLISHABLE_KEY env vars directly.
 * Removed Replit connector dependency.
 */
import Stripe from 'stripe';

function getCredentials() {
  const secretKey = process.env.STRIPE_LIVE_SECRET_KEY?.trim();
  const publishableKey = process.env.STRIPE_LIVE_PUBLISHABLE_KEY?.trim();

  if (!secretKey || !publishableKey) {
    throw new Error('Stripe keys not configured. Set STRIPE_LIVE_SECRET_KEY and STRIPE_LIVE_PUBLISHABLE_KEY environment variables.');
  }

  return { secretKey, publishableKey };
}

export async function getUncachableStripeClient() {
  const { secretKey } = getCredentials();
  return new Stripe(secretKey, { apiVersion: '2025-08-27.basil' as any });
}

export async function getStripePublishableKey() {
  const { publishableKey } = getCredentials();
  return publishableKey;
}

export async function getStripeSecretKey() {
  const { secretKey } = getCredentials();
  return secretKey;
}

// stripe-replit-sync replaced with standard Stripe webhook handling
export async function getStripeSync() {
  return null; // Not needed outside Replit — webhooks handled via /api/stripe/webhook
}
