// netlify/functions/delete-later-background.mjs
// Background function: terima request hapus pesan setelah delay tertentu.
//
// PENTING: suffix "-background" pada nama file adalah WAJIB agar Netlify
// memperlakukan ini sebagai background function (timeout 15 menit, bukan 10 detik).
// Tanpa suffix ini, await delay() > 10 detik akan timeout dan pesan tidak terhapus.
// Ref: https://docs.netlify.com/functions/background-functions/
//
// Dipanggil oleh webhook.mjs via fetch (fire-and-forget) — berjalan di
// container/invocation terpisah sehingga tidak memblokir response webhook ke Telegram.
//
// Endpoint: POST /.netlify/functions/delete-later-background
// Body JSON: { chatId, messageId, delayMs }
//
// Di dalam background function, await delay() dengan setTimeout AMAN digunakan —
// proses tidak di-freeze sebelum selesai, berbeda dengan sync function.

const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

/** Utility: tunda eksekusi selama ms milidetik. */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 200, body: "OK" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: "Bad Request" };
  }

  const { chatId, messageId, delayMs } = payload;
  if (!chatId || !messageId || !delayMs) {
    return { statusCode: 400, body: "Missing fields" };
  }

  // Tunggu sesuai delay yang diminta
  await delay(Number(delayMs));

  // Hapus pesan
  try {
    const res = await fetch(`${TELEGRAM_API}/deleteMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    });
    const data = await res.json();
    if (!data.ok) {
      // Pesan mungkin sudah terhapus manual — bukan error kritis
      console.warn(`delete-later: deleteMessage failed: ${data.description}`);
    }
  } catch (e) {
    console.error("delete-later: fetch error:", e.message);
  }

  return { statusCode: 200, body: "OK" };
};
