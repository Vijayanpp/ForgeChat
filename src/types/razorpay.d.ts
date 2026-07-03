// Minimal ambient typing for the Razorpay Checkout.js widget, loaded
// at runtime from https://checkout.razorpay.com/v1/checkout.js by
// `src/components/settings/billing-tab.tsx`. We only type the surface
// we actually use.
interface RazorpayCheckoutOptions {
  key: string;
  subscription_id: string;
  name?: string;
  description?: string;
  prefill?: { email?: string; name?: string };
  theme?: { color?: string };
  handler?: (response: {
    razorpay_payment_id: string;
    razorpay_subscription_id: string;
    razorpay_signature: string;
  }) => void;
}

interface RazorpayCheckoutInstance {
  open(): void;
}

interface Window {
  Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayCheckoutInstance;
}
