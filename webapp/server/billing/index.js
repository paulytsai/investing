// Billing (placeholder; Stripe Checkout, the customer portal and the webhook replace this).
import { Hono } from "hono";
export function billingRoutes(db) { return new Hono(); }
export function stripeWebhook(db) { return (c) => c.json({ code: "not_configured", message: "Billing isn't set up." }, 503); }
