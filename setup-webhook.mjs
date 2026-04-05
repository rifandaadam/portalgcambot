// setup-webhook.mjs
// Jalankan SEKALI setelah deploy ke Netlify untuk register webhook ke Telegram.
//
// Di Termux / terminal:
//   BOT_TOKEN=xxx NETLIFY_URL=https://your-site.netlify.app node setup-webhook.mjs
//
// Atau buka langsung di browser (tidak perlu Node.js sama sekali):
//   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-site.netlify.app/.netlify/functions/webhook

const BOT_TOKEN = process.env.BOT_TOKEN;
const NETLIFY_URL = process.env.NETLIFY_URL;

if (!BOT_TOKEN || !NETLIFY_URL) {
  console.error("❌ Set BOT_TOKEN dan NETLIFY_URL sebagai environment variable.");
  console.error("   Contoh: BOT_TOKEN=123456:ABC... NETLIFY_URL=https://your-site.netlify.app node setup-webhook.mjs");
  process.exit(1);
}

// Validasi format token — harus mengandung titik dua (:)
if (!BOT_TOKEN.includes(":")) {
  console.error("❌ Format BOT_TOKEN salah. Harus seperti: 123456789:ABCdef...");
  process.exit(1);
}

const webhookUrl = `${NETLIFY_URL}/.netlify/functions/webhook`;

console.log(`🔗 Mendaftarkan webhook: ${webhookUrl}`);

// Step 1: Verifikasi token dulu via getMe
console.log("\n📡 Memverifikasi token bot...");
const getMeRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
const getMeData = await getMeRes.json();

if (!getMeData.ok) {
  console.error("❌ Token bot tidak valid!", getMeData.description);
  console.error("   Ambil token yang benar dari @BotFather di Telegram.");
  process.exit(1);
}

console.log(`✅ Bot terverifikasi: @${getMeData.result.username} (${getMeData.result.first_name})`);

// Step 2: Register webhook
console.log("\n📡 Mendaftarkan webhook ke Telegram...");
const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: webhookUrl,
    // Hanya terima update yang relevan untuk efisiensi
    allowed_updates: ["message", "edited_message"],
    // Abaikan update yang menumpuk sebelum bot aktif
    drop_pending_updates: true,
  }),
});

const data = await res.json();

if (data.ok) {
  console.log(`\n✅ Webhook berhasil didaftarkan!`);
  console.log(`   URL: ${webhookUrl}`);
  console.log(`\n📋 Cek status webhook:`);
  console.log(`   https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
} else {
  console.error("\n❌ Gagal mendaftarkan webhook:", data);
  console.error("\n💡 Kemungkinan penyebab:");
  console.error("   - NETLIFY_URL salah atau site belum ter-deploy");
  console.error("   - URL harus HTTPS (Netlify otomatis HTTPS ✓)");
}
