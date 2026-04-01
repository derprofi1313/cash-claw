// Config Encryption – AES-256-GCM with password-derived key (PBKDF2)
// Encrypts/decrypts the config.json file at rest

import crypto from "node:crypto";
import fs from "node:fs";

const ALGORITHM = "aes-256-gcm";
const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 32; // 256 bits
const SALT_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const MAGIC = "CCENC1"; // File magic bytes to identify encrypted configs

export interface EncryptedPayload {
  magic: string;
  salt: string;   // hex
  iv: string;     // hex
  tag: string;    // hex
  data: string;   // hex (ciphertext)
}

/** Derive a 256-bit key from password + salt using PBKDF2 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha512");
}

/** Encrypt a plaintext string with a password */
export function encryptConfig(plaintext: string, password: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(password, salt);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  const payload: EncryptedPayload = {
    magic: MAGIC,
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    data: encrypted.toString("hex"),
  };

  return JSON.stringify(payload);
}

/** Decrypt an encrypted config string with a password */
export function decryptConfig(encrypted: string, password: string): string {
  const payload = JSON.parse(encrypted) as EncryptedPayload;

  if (payload.magic !== MAGIC) {
    throw new Error("Not an encrypted Cash-Claw config file");
  }

  const salt = Buffer.from(payload.salt, "hex");
  const iv = Buffer.from(payload.iv, "hex");
  const tag = Buffer.from(payload.tag, "hex");
  const data = Buffer.from(payload.data, "hex");
  const key = deriveKey(password, salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(data),
    decipher.final(),
  ]);

  return decrypted.toString("utf-8");
}

/** Check if a file contains an encrypted config */
export function isEncryptedConfig(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;
    const raw = fs.readFileSync(filePath, "utf-8").trim();
    const parsed = JSON.parse(raw);
    return parsed?.magic === MAGIC;
  } catch {
    return false;
  }
}

/** Encrypt a config file in place */
export function encryptConfigFile(filePath: string, password: string): void {
  const plaintext = fs.readFileSync(filePath, "utf-8");
  const encrypted = encryptConfig(plaintext, password);
  fs.writeFileSync(filePath, encrypted, "utf-8");
}

/** Decrypt a config file in place (returns the parsed JSON) */
export function decryptConfigFile(filePath: string, password: string): string {
  const encrypted = fs.readFileSync(filePath, "utf-8");
  return decryptConfig(encrypted, password);
}
