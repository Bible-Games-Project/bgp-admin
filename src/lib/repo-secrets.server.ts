import { githubHeaders } from "@/lib/github.functions";
import nacl from "tweetnacl";
import { blake2b } from "blakejs";

const GITHUB_API = "https://api.github.com";
const ORG = "Bible-Games-Project";

// Secrets that wire a repo's publish runs to the Telegram chat. Missing
// environment values simply mean the secret is skipped, never a hard failure:
// creating an app must not depend on notifications being configured.
export const telegramSecrets = (): { name: string; value: string }[] => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return [];
  return [
    { name: "TELEGRAM_BOT_TOKEN", value: token },
    { name: "TELEGRAM_CHAT_ID", value: chat },
  ];
};

// Libsodium-compatible crypto_box_seal using tweetnacl (pure JS, no WASM on
// Workers). Format: ephemeral_pk (32) || ciphertext, with the nonce derived as
// the first 24 bytes of BLAKE2b(ephemeral_pk || recipient_pk).
export const encryptSecret = (publicKeyB64: string, value: string): string => {
  const recipientKey = new Uint8Array(
    atob(publicKeyB64).split("").map((c) => c.charCodeAt(0)),
  );
  const messageBytes = new TextEncoder().encode(value);
  const ephemeral = nacl.box.keyPair();

  const combinedKeys = new Uint8Array(64);
  combinedKeys.set(ephemeral.publicKey, 0);
  combinedKeys.set(recipientKey, 32);
  const nonce = blake2b(combinedKeys, undefined, nacl.box.nonceLength);

  const ciphertext = nacl.box(messageBytes, nonce, recipientKey, ephemeral.secretKey);

  const combined = new Uint8Array(32 + ciphertext.length);
  combined.set(ephemeral.publicKey, 0);
  combined.set(ciphertext, 32);
  return btoa(String.fromCharCode(...combined));
};

// Push the given secrets to the repo. Returns the names that could not be set,
// in the caller's own language, so each flow decides how visible the failure is.
export const setRepoSecrets = async (
  repoName: string,
  secrets: { name: string; value: string }[],
): Promise<string[]> => {
  if (!secrets.length) return [];

  const pkRes = await fetch(`${GITHUB_API}/repos/${ORG}/${repoName}/actions/secrets/public-key`, {
    headers: githubHeaders(),
  });
  if (!pkRes.ok) return secrets.map((s) => s.name);
  const pkBody = await pkRes.json();

  const failed: string[] = [];
  for (const s of secrets) {
    const res = await fetch(`${GITHUB_API}/repos/${ORG}/${repoName}/actions/secrets/${s.name}`, {
      method: "PUT",
      headers: { ...githubHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        encrypted_value: encryptSecret(pkBody.key, s.value),
        key_id: pkBody.key_id,
      }),
    });
    if (!res.ok) failed.push(s.name);
  }
  return failed;
};

// Convenience wrapper: only the Telegram device, used by createApp (linked
// repos) and createAppWithRepo (new repos) so both paths notify the same chat.
export const setPublishTelegramSecrets = async (repoName: string): Promise<string[]> =>
  setRepoSecrets(repoName, telegramSecrets());
