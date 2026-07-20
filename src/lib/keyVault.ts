const vaultStorageKey = 'sourceful-openai-key-vault-v1';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type VaultRecord = { version: 1; salt: string; iv: string; ciphertext: string };

function toBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveVaultKey(passphrase: string, salt: Uint8Array) {
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function assertVaultSupport() {
  if (!window.isSecureContext || !crypto?.subtle) throw new Error('Secure browser encryption is unavailable. Use HTTPS or localhost before saving a key.');
}

export function hasRememberedApiKey() {
  try { return Boolean(localStorage.getItem(vaultStorageKey)); } catch { return false; }
}

export function forgetRememberedApiKey() {
  try { localStorage.removeItem(vaultStorageKey); } catch { /* storage may be unavailable */ }
}

export async function rememberApiKey(apiKey: string, passphrase: string) {
  assertVaultSupport();
  if (passphrase.length < 12) throw new Error('Use a vault passphrase with at least 12 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveVaultKey(passphrase, salt);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(apiKey));
  const record: VaultRecord = { version: 1, salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(encrypted)) };
  localStorage.setItem(vaultStorageKey, JSON.stringify(record));
}

export async function unlockRememberedApiKey(passphrase: string) {
  assertVaultSupport();
  const raw = localStorage.getItem(vaultStorageKey);
  if (!raw) throw new Error('No encrypted API key is saved on this device.');
  try {
    const record = JSON.parse(raw) as VaultRecord;
    if (record.version !== 1 || !record.salt || !record.iv || !record.ciphertext) throw new Error('Invalid vault record.');
    const key = await deriveVaultKey(passphrase, fromBase64(record.salt));
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(record.iv) }, key, fromBase64(record.ciphertext));
    return decoder.decode(decrypted);
  } catch {
    throw new Error('Unable to unlock this key. Check the passphrase or remove the saved vault entry.');
  }
}
