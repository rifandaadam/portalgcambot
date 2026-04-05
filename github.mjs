// netlify/functions/lib/github.mjs
// Membaca dan menulis rules.json langsung ke GitHub repo via GitHub API

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO; // format: "username/repo-name"
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
const RULES_FILE_PATH = "rules.json";

const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/contents/${RULES_FILE_PATH}`;

const githubHeaders = {
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  "Content-Type": "application/json",
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

/**
 * Ambil rules.json dari GitHub.
 * Return: { rules: object, sha: string }
 * sha diperlukan untuk update file (GitHub API requirement).
 */
export async function fetchRules() {
  const res = await fetch(`${GITHUB_API}?ref=${GITHUB_BRANCH}`, {
    headers: githubHeaders,
  });

  if (res.status === 404) {
    // File belum ada, return kosong
    return { rules: {}, sha: null };
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub fetch failed: ${res.status} — ${err}`);
  }

  const data = await res.json();
  const content = Buffer.from(data.content, "base64").toString("utf-8");
  const rules = JSON.parse(content);
  return { rules, sha: data.sha };
}

/**
 * Tulis rules.json ke GitHub dengan auto-commit.
 * @param {object} rules - Seluruh object rules
 * @param {string|null} sha - SHA file lama (null jika file baru)
 * @param {string} commitMessage - Pesan commit
 */
export async function pushRules(rules, sha, commitMessage) {
  const content = Buffer.from(JSON.stringify(rules, null, 2)).toString("base64");

  const body = {
    message: commitMessage,
    content,
    branch: GITHUB_BRANCH,
    ...(sha ? { sha } : {}),
  };

  const res = await fetch(GITHUB_API, {
    method: "PUT",
    headers: githubHeaders,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub push failed: ${res.status} — ${err}`);
  }

  return res.json();
}

/**
 * Ambil rules untuk topic tertentu.
 */
export async function getTopicRules(chatId, threadId) {
  const { rules } = await fetchRules();
  return rules?.[String(chatId)]?.[String(threadId)] || {};
}

/**
 * Set satu rule untuk topic tertentu, lalu push ke GitHub.
 * @param {number} chatId
 * @param {number} threadId
 * @param {string} key - Rule key, misal "no_photo"
 * @param {boolean} value - true = aktifkan, false = hapus
 * @param {string} actionLabel - Untuk pesan commit
 */
export async function setTopicRule(chatId, threadId, key, value, actionLabel = "") {
  const { rules, sha } = await fetchRules();

  const chatKey = String(chatId);
  const threadKey = String(threadId);

  if (!rules[chatKey]) rules[chatKey] = {};
  if (!rules[chatKey][threadKey]) rules[chatKey][threadKey] = {};

  if (value) {
    rules[chatKey][threadKey][key] = true;
  } else {
    delete rules[chatKey][threadKey][key];
    // Bersihkan object kosong
    if (Object.keys(rules[chatKey][threadKey]).length === 0) {
      delete rules[chatKey][threadKey];
    }
    if (Object.keys(rules[chatKey]).length === 0) {
      delete rules[chatKey];
    }
  }

  const action = value ? "add" : "remove";
  const commitMsg = `bot: ${action} ${key} for chat ${chatId} thread ${threadId}${actionLabel ? ` (${actionLabel})` : ""}`;

  await pushRules(rules, sha, commitMsg);
  return rules;
}
