// netlify/functions/webhook.mjs
// Telegram Topic Restriction Bot — Netlify + GitHub as config store
//
// Dokumentasi Telegram Bot API: https://core.telegram.org/bots/api
//
// Flow:
//   Admin: /restrict no_photo  (di dalam topic)
//     → Bot update rules.json di GitHub via API (auto-commit)
//     → Netlify detect push → auto redeploy (~30 detik)
//     → Rule aktif ✅

import { getTopicRules, setTopicRule, fetchRules } from "./lib/github.mjs";

const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ── Restriction definitions ───────────────────────────────────────────────────
const RESTRICTION_KEYS = {
  no_photo:      "📷 Foto terkompresi (harus kirim sebagai file/dokumen)",
  no_sticker:    "🎭 Stiker",
  no_gif:        "🎞️ GIF / Animasi",
  no_voice:      "🎙️ Pesan suara",
  no_video_note: "📹 Video note (lingkaran)",
  no_poll:       "📊 Polling",
  no_video:      "🎬 Video terkompresi",
  no_audio:      "🎵 Pesan audio",
};

const VIOLATION_MESSAGES = {
  no_photo:
    "📷 <b>Foto harus dikirim sebagai file di topik ini.</b>\n" +
    "Kirim ulang menggunakan <i>Lampiran → File</i> (bukan opsi foto). " +
    "Ini menjaga kualitas penuh gambar!",
  no_sticker:    "🎭 <b>Stiker tidak diizinkan di topik ini.</b>",
  no_gif:        "🎞️ <b>GIF / Animasi tidak diizinkan di topik ini.</b>",
  no_voice:      "🎙️ <b>Pesan suara tidak diizinkan di topik ini.</b>",
  no_video_note: "📹 <b>Video note (lingkaran) tidak diizinkan di topik ini.</b>",
  no_poll:       "📊 <b>Polling tidak diizinkan di topik ini.</b>",
  no_video:      "🎬 <b>Video terkompresi tidak diizinkan di topik ini.</b>",
  no_audio:      "🎵 <b>Pesan audio tidak diizinkan di topik ini.</b>",
};

// ── Telegram API helpers ──────────────────────────────────────────────────────

/**
 * Panggil method Telegram Bot API.
 * Ref: https://core.telegram.org/bots/api#making-requests
 * Format: POST https://api.telegram.org/bot<token>/METHOD_NAME
 */
async function callTelegram(method, body) {
  const res = await fetch(`${TELEGRAM_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    // Log error tapi jangan throw — biarkan bot tetap jalan
    console.warn(`Telegram API error [${method}]:`, data.description);
  }
  return data;
}

/**
 * Kirim pesan teks.
 * Ref: https://core.telegram.org/bots/api#sendmessage
 * - chat_id: integer atau string (untuk channel @username)
 * - message_thread_id: ID topik forum (integer), optional
 * - parse_mode: "HTML" atau "MarkdownV2"
 */
async function sendMessage(chatId, text, threadId = null, extra = {}) {
  return callTelegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    // message_thread_id hanya dikirim jika ada (untuk forum topics)
    ...(threadId ? { message_thread_id: threadId } : {}),
    ...extra,
  });
}

/**
 * Hapus pesan.
 * Ref: https://core.telegram.org/bots/api#deletemessage
 * Bot harus punya permission "can_delete_messages".
 */
async function deleteMessage(chatId, messageId) {
  const result = await callTelegram("deleteMessage", {
    chat_id: chatId,
    message_id: messageId,
  });
  return result;
}

/**
 * Ambil daftar administrator grup.
 * Ref: https://core.telegram.org/bots/api#getchatadministrators
 * Return: array of ChatMember objects
 */
async function getChatAdmins(chatId) {
  const res = await callTelegram("getChatAdministrators", { chat_id: chatId });
  return res.result || [];
}

/**
 * Kirim pesan warning yang otomatis terhapus setelah 8 detik.
 * Netlify function timeout default 10 detik — cukup untuk setTimeout 8 detik.
 */
async function sendAutoDeleteWarning(chatId, threadId, text) {
  const result = await sendMessage(chatId, text, threadId);
  const warningMsgId = result?.result?.message_id;
  if (warningMsgId) {
    setTimeout(async () => {
      await deleteMessage(chatId, warningMsgId);
    }, 8000);
  }
}

// ── Violation detection ───────────────────────────────────────────────────────
/**
 * Deteksi tipe pelanggaran berdasarkan field yang ada di Message object.
 * Ref: https://core.telegram.org/bots/api#message
 *
 * Field-field yang dicek:
 * - photo: array of PhotoSize — ada jika pesan adalah foto terkompresi
 * - sticker: Sticker object
 * - animation: Animation object — GIF atau video animasi
 * - voice: Voice object — pesan suara (OGG)
 * - video_note: VideoNote object — video lingkaran
 * - poll: Poll object
 * - video: Video object — video terkompresi (MP4 dll)
 * - audio: Audio object — file audio (MP3 dll)
 *
 * CATATAN: document (file) TIDAK diblokir — itu yang kita mau untuk no_photo
 */
function detectViolation(message, rules) {
  if (rules.no_photo      && message.photo)      return "no_photo";
  if (rules.no_sticker    && message.sticker)    return "no_sticker";
  if (rules.no_gif        && message.animation)  return "no_gif";
  if (rules.no_voice      && message.voice)      return "no_voice";
  if (rules.no_video_note && message.video_note) return "no_video_note";
  if (rules.no_poll       && message.poll)       return "no_poll";
  if (rules.no_video      && message.video)      return "no_video";
  if (rules.no_audio      && message.audio)      return "no_audio";
  return null;
}

// ── Command handlers ──────────────────────────────────────────────────────────
async function handleStart(message) {
  await sendMessage(
    message.chat.id,
    "👋 <b>Topic Restriction Bot</b>\n\n" +
      "Saya menegakkan aturan konten per topik di grup kamu.\n\n" +
      "<b>Perintah admin (gunakan di dalam topik):</b>\n" +
      "/restrict &lt;rule&gt; — Aktifkan pembatasan\n" +
      "/unrestrict &lt;rule&gt; — Hapus pembatasan\n" +
      "/rules — Tampilkan aturan topik ini\n" +
      "/allrules — Daftar semua jenis pembatasan\n" +
      "/viewconfig — Lihat isi rules.json lengkap\n\n" +
      "⚠️ Setelah /restrict atau /unrestrict, tunggu ~30 detik untuk Netlify redeploy.",
    message.message_thread_id
  );
}

async function handleAllRules(message) {
  const lines = ["<b>Restriction keys yang tersedia:</b>\n"];
  for (const [key, label] of Object.entries(RESTRICTION_KEYS)) {
    lines.push(`  <code>${key}</code> — ${label}`);
  }
  await sendMessage(message.chat.id, lines.join("\n"), message.message_thread_id);
}

async function handleRules(message) {
  const threadId = message.message_thread_id;
  if (!threadId) {
    await sendMessage(message.chat.id, "ℹ️ Gunakan perintah ini di dalam sebuah topik.");
    return;
  }

  let rules;
  try {
    rules = await getTopicRules(message.chat.id, threadId);
  } catch (e) {
    await sendMessage(message.chat.id, "❌ Gagal membaca rules dari GitHub: " + e.message, threadId);
    return;
  }

  const active = Object.keys(rules).filter((k) => rules[k]);
  if (!active.length) {
    await sendMessage(message.chat.id, "✅ Tidak ada pembatasan di topik ini.", threadId);
    return;
  }

  const lines = [`<b>Pembatasan aktif di topik ini (thread ${threadId}):</b>\n`];
  for (const key of active) {
    lines.push(`  🚫 ${RESTRICTION_KEYS[key] || key} (<code>${key}</code>)`);
  }
  await sendMessage(message.chat.id, lines.join("\n"), threadId);
}

async function handleRestrict(message, args, isAdmin) {
  if (!isAdmin) {
    await sendMessage(message.chat.id, "⛔ Hanya admin yang bisa mengatur pembatasan.", message.message_thread_id);
    return;
  }

  const threadId = message.message_thread_id;
  if (!threadId) {
    await sendMessage(message.chat.id, "ℹ️ Gunakan perintah ini di dalam sebuah topik.");
    return;
  }

  const key = args[0]?.toLowerCase();
  if (!key || !RESTRICTION_KEYS[key]) {
    await sendMessage(
      message.chat.id,
      `❌ Rule tidak dikenal: <code>${key || "?"}</code>\nJalankan /allrules untuk melihat pilihan.`,
      threadId
    );
    return;
  }

  let current;
  try {
    current = await getTopicRules(message.chat.id, threadId);
  } catch (e) {
    await sendMessage(message.chat.id, "❌ Gagal membaca GitHub: " + e.message, threadId);
    return;
  }

  if (current[key]) {
    await sendMessage(
      message.chat.id,
      `ℹ️ Pembatasan <code>${key}</code> sudah aktif di topik ini.`,
      threadId
    );
    return;
  }

  await sendMessage(message.chat.id, `⏳ Mengupdate rules.json di GitHub...`, threadId);

  try {
    await setTopicRule(message.chat.id, threadId, key, true);
  } catch (e) {
    await sendMessage(message.chat.id, "❌ Gagal update GitHub: " + e.message, threadId);
    return;
  }

  await sendMessage(
    message.chat.id,
    `✅ <b>${RESTRICTION_KEYS[key]}</b> diaktifkan untuk topik ini.\n\n` +
      `⏳ Netlify sedang redeploy... rule aktif dalam ~30 detik.\n\n` +
      `📄 Perubahan tersimpan di <code>rules.json</code> di repo GitHub kamu.`,
    threadId
  );
}

async function handleUnrestrict(message, args, isAdmin) {
  if (!isAdmin) {
    await sendMessage(message.chat.id, "⛔ Hanya admin yang bisa mengatur pembatasan.", message.message_thread_id);
    return;
  }

  const threadId = message.message_thread_id;
  if (!threadId) {
    await sendMessage(message.chat.id, "ℹ️ Gunakan perintah ini di dalam sebuah topik.");
    return;
  }

  const key = args[0]?.toLowerCase();
  if (!key) {
    await sendMessage(message.chat.id, "Usage: /unrestrict &lt;rule&gt;", threadId);
    return;
  }

  let current;
  try {
    current = await getTopicRules(message.chat.id, threadId);
  } catch (e) {
    await sendMessage(message.chat.id, "❌ Gagal membaca GitHub: " + e.message, threadId);
    return;
  }

  if (!current[key]) {
    await sendMessage(
      message.chat.id,
      `ℹ️ Pembatasan <code>${key}</code> memang tidak aktif di topik ini.`,
      threadId
    );
    return;
  }

  await sendMessage(message.chat.id, `⏳ Mengupdate rules.json di GitHub...`, threadId);

  try {
    await setTopicRule(message.chat.id, threadId, key, false);
  } catch (e) {
    await sendMessage(message.chat.id, "❌ Gagal update GitHub: " + e.message, threadId);
    return;
  }

  await sendMessage(
    message.chat.id,
    `✅ Pembatasan <code>${key}</code> dihapus dari topik ini.\n\n` +
      `⏳ Netlify sedang redeploy... perubahan aktif dalam ~30 detik.`,
    threadId
  );
}

async function handleViewConfig(message, isAdmin) {
  if (!isAdmin) {
    await sendMessage(message.chat.id, "⛔ Hanya admin yang bisa melihat konfigurasi.", message.message_thread_id);
    return;
  }

  let rules;
  try {
    const result = await fetchRules();
    rules = result.rules;
  } catch (e) {
    await sendMessage(message.chat.id, "❌ Gagal membaca rules.json: " + e.message, message.message_thread_id);
    return;
  }

  const json = JSON.stringify(rules, null, 2);
  // Telegram HTML: gunakan <pre> untuk monospace, max panjang pesan 4096 karakter
  const preview = json.length > 3500 ? json.slice(0, 3500) + "\n... (terpotong)" : json;
  await sendMessage(
    message.chat.id,
    `📄 <b>Isi rules.json saat ini:</b>\n\n<pre>${preview}</pre>`,
    message.message_thread_id
  );
}

// ── Main webhook handler ──────────────────────────────────────────────────────
/**
 * Handler utama Netlify Function.
 * Telegram mengirim POST request berisi JSON Update object setiap ada aktivitas.
 * Ref: https://core.telegram.org/bots/api#update
 *
 * Kita harus selalu return HTTP 200 — jika tidak, Telegram akan retry terus.
 */
export const handler = async (event) => {
  // Telegram hanya mengirim POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 200, body: "OK" };
  }

  let update;
  try {
    update = JSON.parse(event.body);
  } catch {
    return { statusCode: 200, body: "OK" }; // tetap 200 agar Telegram tidak retry
  }

  // Ambil message dari update
  // Ref: https://core.telegram.org/bots/api#update
  // "message" = pesan baru, "edited_message" = pesan yang diedit
  const message = update.message || update.edited_message;
  if (!message) return { statusCode: 200, body: "OK" };

  const chatId = message.chat.id;           // integer
  const threadId = message.message_thread_id || null; // integer, hanya ada di forum topics
  const text = message.text || "";
  const userId = message.from?.id;          // integer, ID pengirim

  // ── Parse command ─────────────────────────────────────────────────────────
  // Format command Telegram: /command atau /command@botusername
  // Ref: https://core.telegram.org/bots/features#commands
  const commandMatch = text.match(/^\/([a-zA-Z_]+)(?:@\S+)?(?:\s+(.*))?$/s);

  if (commandMatch) {
    const cmd = commandMatch[1].toLowerCase();
    const argStr = (commandMatch[2] || "").trim();
    const args = argStr ? argStr.split(/\s+/) : [];

    // Cek admin status hanya untuk command yang membutuhkan
    let isAdmin = false;
    if (["restrict", "unrestrict", "viewconfig"].includes(cmd)) {
      const admins = await getChatAdmins(chatId);
      // Cocokkan user.id (integer) — jangan pakai == karena tipe bisa berbeda
      isAdmin = admins.some((a) => a.user.id === userId);
    }

    switch (cmd) {
      case "start":
      case "help":
        await handleStart(message);
        break;
      case "allrules":
        await handleAllRules(message);
        break;
      case "rules":
        await handleRules(message);
        break;
      case "restrict":
        await handleRestrict(message, args, isAdmin);
        break;
      case "unrestrict":
        await handleUnrestrict(message, args, isAdmin);
        break;
      case "viewconfig":
        await handleViewConfig(message, isAdmin);
        break;
      // Command lain diabaikan — return 200 tetap
    }

    return { statusCode: 200, body: "OK" };
  }

  // ── Enforce restrictions pada pesan non-command ───────────────────────────
  // Hanya enforce jika pesan ada di dalam topik (threadId tidak null)
  if (threadId) {
    let rules = {};
    try {
      rules = await getTopicRules(chatId, threadId);
    } catch (e) {
      // Jika gagal baca rules, jangan blokir pesan — log saja
      console.error("Failed to fetch rules:", e.message);
    }

    const violation = detectViolation(message, rules);
    if (violation) {
      // Hapus pesan pelanggar
      await deleteMessage(chatId, message.message_id);

      // Kirim warning ramah yang auto-delete setelah 8 detik
      const name = message.from?.first_name || "User";
      const warningText =
        `Hei ${name}! ⚠️\n\n` +
        `${VIOLATION_MESSAGES[violation]}\n\n` +
        `<i>Pesan kamu otomatis dihapus.</i>`;
      await sendAutoDeleteWarning(chatId, threadId, warningText);
    }
  }

  // Selalu return 200 ke Telegram
  return { statusCode: 200, body: "OK" };
};
