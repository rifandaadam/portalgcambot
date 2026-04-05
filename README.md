# 🤖 Telegram Topic Restriction Bot — Netlify + GitHub Config

Bot Telegram serverless yang menyimpan konfigurasi rules **langsung di repo GitHub ini** via GitHub API.
**Tidak butuh database eksternal sama sekali — 100% gratis.**

---

## 🏗️ Arsitektur

```
Admin: /restrict no_photo
       ↓
Netlify Function (webhook.mjs)
       ↓
GitHub API → update rules.json → auto-commit ke repo ini
       ↓
Netlify deteksi push → auto redeploy (~30 detik)
       ↓
Rule aktif ✅
```

```
User kirim foto (compressed)
       ↓
Netlify Function baca rules.json dari GitHub API
       ↓
Deteksi violation → hapus pesan → kirim warning
```

---

## 📁 Struktur Project

```
├── netlify/
│   └── functions/
│       ├── webhook.mjs          ← Handler utama bot
│       └── lib/
│           └── github.mjs       ← GitHub API helper (baca/tulis rules.json)
├── public/
│   └── index.html
├── rules.json                   ← Config rules (diupdate otomatis oleh bot)
├── setup-webhook.mjs            ← Jalankan sekali untuk register webhook
├── netlify.toml
└── package.json
```

---

## 🚀 Cara Deploy

### Step 1 — Buat bot Telegram
1. Chat [@BotFather](https://t.me/BotFather) → `/newbot`
2. Simpan **Bot Token**

### Step 2 — Buat GitHub Personal Access Token (PAT)
1. Buka GitHub → **Settings → Developer settings → Personal access tokens → Tokens (classic)**
2. Klik **Generate new token (classic)**
3. Beri nama misal `telegram-bot`
4. Centang permission: **`repo`** (full control of private repositories)
5. Klik **Generate token** → simpan tokennya

### Step 3 — Push project ke GitHub
```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/USERNAME/REPO_NAME.git
git push -u origin main
```

### Step 4 — Deploy ke Netlify
1. Buka [netlify.com](https://netlify.com) → **Add new site → Import from GitHub**
2. Pilih repo ini
3. Build settings otomatis terbaca dari `netlify.toml`
4. Klik **Deploy**

### Step 5 — Set Environment Variables di Netlify
Buka **Site Settings → Environment Variables**, tambahkan:

| Variable | Value | Contoh |
|---|---|---|
| `BOT_TOKEN` | Token dari BotFather | `1234567890:ABC...` |
| `GITHUB_TOKEN` | PAT yang dibuat di Step 2 | `ghp_xxxxxxxxxxxx` |
| `GITHUB_REPO` | Username/nama-repo | `johndoe/my-bot` |
| `GITHUB_BRANCH` | Branch utama (opsional) | `main` (default) |

Setelah set env var, klik **Deploys → Trigger deploy** untuk redeploy.

### Step 6 — Register webhook ke Telegram
Jalankan **sekali** dari terminal lokal:

```bash
BOT_TOKEN=xxx NETLIFY_URL=https://your-site.netlify.app node setup-webhook.mjs
```

Output yang diharapkan:
```
✅ Webhook registered!
   URL: https://your-site.netlify.app/.netlify/functions/webhook
```

**Bot siap digunakan! 🎉**

---

## 📋 Perintah Admin

Gunakan perintah ini **di dalam topik** yang ingin dikonfigurasi:

| Perintah | Fungsi |
|---|---|
| `/restrict no_photo` | Aktifkan pembatasan di topik ini |
| `/unrestrict no_photo` | Hapus pembatasan |
| `/rules` | Tampilkan pembatasan aktif di topik ini |
| `/allrules` | Daftar semua restriction key |
| `/viewconfig` | Lihat isi lengkap rules.json (admin only) |

---

## ✨ Restriction Keys

| Key | Memblokir |
|---|---|
| `no_photo` | Foto terkompresi — harus kirim sebagai File |
| `no_sticker` | Stiker |
| `no_gif` | GIF & Animasi |
| `no_voice` | Pesan suara |
| `no_video_note` | Video note (lingkaran) |
| `no_poll` | Polling |
| `no_video` | Video terkompresi |
| `no_audio` | Pesan audio |

---

## 📄 Format rules.json

File ini diupdate otomatis oleh bot via GitHub API setiap kali admin pakai /restrict.
Kamu juga bisa edit manual langsung di GitHub jika perlu:

```json
{
  "-1001234567890": {
    "123": {
      "no_photo": true
    },
    "456": {
      "no_sticker": true,
      "no_gif": true
    }
  }
}
```

- Key level 1: `chat_id` grup (biasanya negatif untuk supergroup)
- Key level 2: `message_thread_id` — ID topik
- Key level 3: restriction key → `true`

Setiap perubahan bot akan muncul sebagai commit di GitHub dengan pesan seperti:
`bot: add no_photo for chat -1001234567890 thread 123`

---

## ⚙️ Syarat

- Grup harus berupa **supergroup** dengan **Topics diaktifkan**
  (Pengaturan Grup → Topics → Aktifkan)
- Bot harus jadi **admin** dengan izin **Hapus Pesan**

---

## 🔧 Troubleshooting

**Bot tidak merespons?**
- Cek log: Netlify → Functions → webhook → Logs
- Pastikan semua env var sudah di-set dan site sudah redeploy
- Jalankan ulang `setup-webhook.mjs`

**GitHub API error?**
- Pastikan `GITHUB_TOKEN` punya permission `repo`
- Pastikan format `GITHUB_REPO` benar: `username/repo-name`
- Pastikan `rules.json` ada di root repo (sudah di-commit)

**Rule tidak aktif setelah /restrict?**
- Tunggu ~30 detik untuk Netlify selesai redeploy
- Cek tab **Deploys** di Netlify — pastikan deploy berhasil (status hijau)
