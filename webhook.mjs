// netlify/functions/webhook.mjs
// Telegram Topic Restriction Bot — Netlify + GitHub as config store
//
// Flow:
//   Admin: /restrict no_photo  (di dalam topic)
//     → Bot update rules.json di GitHub via API (auto-commit)
//     → Netlify detect push → auto redeploy (~30 detik)
//     → Rule aktif ✅
//
// Tidak butuh database eksternal sama sekali.

import { getTopicRules, setTopicRule, fetchRules } from "./lib/github.mjs";

const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ── Restriction definitions ───────────────────────────────────────────────────
const RESTRICTION_KEYS = {
  no_photo:      "📷 Compressed photos (must send as file/document)",
  no_sticker:    "🎭 Stickers",
  no_gif:        "🎞️ GIFs / Animations",
  no_voice:      "🎙️ Voice messages",
  no_video_note: "📹 Video notes (circles)",
  no_poll:       "📊 Polls",
  no_video:      "🎬 Videos (compressed)",
  no_audio:      "🎵 Audio messages",
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
async function callTelegram(method, body) {
  const res = await fetch(`${TELEGRAM_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function sendMessage(chatId, text, threadId = null, extra = {}) {
  return callTelegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...(threadId ? { message_thread_id: threadId } : {}),
    ...extra,
  });
}

async function deleteMessage(chatId, messageId) {
  try {
    await callTelegram("deleteMessage", { chat_id: chatId, message_id: messageId });
  } catch (e) {
    console.warn("Could not delete message:", e);
  }
}

async function getChatAdmins(chatId) {
  const res = await callTelegram("getChatAdministrators", { chat_id: chatId });
  return res.result || [];
}

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

  // Cek apakah sudah aktif
  const current = await getTopicRules(message.chat.id, threadId);
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

  const current = await getTopicRules(message.chat.id, threadId);
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
  await sendMessage(
    message.chat.id,
    `📄 <b>Isi rules.json saat ini:</b>\n\n<pre>${json}</pre>`,
    message.message_thread_id
  );
}

// ── Main webhook handler ──────────────────────────────────────────────────────
export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let update;
  try {
    update = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: "Bad Request" };
  }

  const message = update.message || update.edited_message;
  if (!message) return { statusCode: 200, body: "OK" };

  const chatId = message.chat.id;
  const threadId = message.message_thread_id || null;
  const text = message.text || "";
  const userId = message.from?.id;

  // Parse command
  const commandMatch = text.match(/^\/([a-z_]+)(?:@\S+)?\s*(.*)/i);

  if (commandMatch) {
    const cmd = commandMatch[1].toLowerCase();
    const args = commandMatch[2].trim().split(/\s+/).filter(Boolean);

    let isAdmin = false;
    if (["restrict", "unrestrict", "viewconfig"].includes(cmd)) {
      const admins = await getChatAdmins(chatId);
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
    }

    return { statusCode: 200, body: "OK" };
  }

  // ── Enforce restrictions ──────────────────────────────────────────────────
  if (threadId) {
    let rules = {};
    try {
      rules = await getTopicRules(chatId, threadId);
    } catch (e) {
      console.error("Failed to fetch rules:", e);
    }

    const violation = detectViolation(message, rules);
    if (violation) {
      await deleteMessage(chatId, message.message_id);
      const name = message.from?.first_name || "User";
      const warningText =
        `Hei ${name}! ⚠️\n\n` +
        `${VIOLATION_MESSAGES[violation]}\n\n` +
        `<i>Pesan kamu otomatis dihapus.</i>`;
      await sendAutoDeleteWarning(chatId, threadId, warningText);
    }
  }

  return { statusCode: 200, body: "OK" };
};
