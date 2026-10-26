import {
  randomBytes,
  scryptSync,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from "node:crypto";

// Passphrase-based encryption for portable backups. A backup file can land in
// a synced cloud folder (Dropbox/OneDrive) and stay private, because only the
// passphrase YOU hold can decrypt it — the cloud provider sees ciphertext.
//
// Design (all values base64 in a self-describing JSON envelope):
//   - key derivation: scrypt(passphrase, salt) -> 32-byte key
//   - encryption:     AES-256-GCM (authenticated; tamper-evident)
//   - per-file random salt + iv so the same data/passphrase never repeats
// Node's built-in crypto only — no dependency, works in Electron's Node.

const MAGIC = "jobwell-encrypted-backup";
const VERSION = 1;
const SCRYPT_N = 1 << 15; // 32768 — CPU/memory cost
const KEY_LEN = 32; // AES-256
const SALT_LEN = 16;
const IV_LEN = 12; // GCM standard

export interface EncryptedEnvelope {
  magic: string;
  version: number;
  kdf: "scrypt";
  cipher: "aes-256-gcm";
  salt: string; // base64
  iv: string; // base64
  authTag: string; // base64
  ciphertext: string; // base64
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase.normalize("NFKC"), salt, KEY_LEN, {
    N: SCRYPT_N,
    r: 8,
    p: 1,
    maxmem: 128 * SCRYPT_N * 8 * 2,
  });
}

// Encrypt an arbitrary JSON-serializable value into a self-describing envelope.
export function encryptBackup(data: unknown, passphrase: string): EncryptedEnvelope {
  if (!passphrase || passphrase.length < 6) {
    throw new Error("Passphrase must be at least 6 characters.");
  }
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(data), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    magic: MAGIC,
    version: VERSION,
    kdf: "scrypt",
    cipher: "aes-256-gcm",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function isEncryptedEnvelope(obj: unknown): obj is EncryptedEnvelope {
  return (
    !!obj &&
    typeof obj === "object" &&
    (obj as EncryptedEnvelope).magic === MAGIC &&
    (obj as EncryptedEnvelope).cipher === "aes-256-gcm"
  );
}

// Decrypt an envelope back to its original value. Throws a clear error on a
// wrong passphrase or tampered file (GCM auth failure).
export function decryptBackup(
  envelope: EncryptedEnvelope,
  passphrase: string,
): unknown {
  if (!isEncryptedEnvelope(envelope)) {
    throw new Error("Not a JobWell encrypted backup file.");
  }
  const salt = Buffer.from(envelope.salt, "base64");
  const iv = Buffer.from(envelope.iv, "base64");
  const authTag = Buffer.from(envelope.authTag, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  const key = deriveKey(passphrase, salt);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  try {
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8"));
  } catch {
    // GCM final() throws if the key is wrong or the data was tampered with.
    throw new Error(
      "Could not decrypt — wrong passphrase, or the file is corrupted/altered.",
    );
  }
}

// Constant-time compare helper (exported for any pairing/confirm checks).
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
