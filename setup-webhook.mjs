// setup-webhook.mjs
// Run this ONCE after deploying to Netlify to register your webhook URL with Telegram.
//
// Usage:
//   BOT_TOKEN=xxx NETLIFY_URL=https://your-site.netlify.app node setup-webhook.mjs

const BOT_TOKEN = process.env.BOT_TOKEN;
const NETLIFY_URL = process.env.NETLIFY_URL;

if (!BOT_TOKEN || !NETLIFY_URL) {
  console.error("❌ Set BOT_TOKEN and NETLIFY_URL environment variables.");
  process.exit(1);
}

const webhookUrl = `${NETLIFY_URL}/.netlify/functions/webhook`;

const res = await fetch(
  `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ["message", "edited_message"],
    }),
  }
);

const data = await res.json();

if (data.ok) {
  console.log(`✅ Webhook registered successfully!`);
  console.log(`   URL: ${webhookUrl}`);
} else {
  console.error("❌ Failed to set webhook:", data);
}
