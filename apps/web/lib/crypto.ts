import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ivLength = 12;

function deriveKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}

export function encryptString(value: string, secret: string) {
  const iv = randomBytes(ivLength);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);

  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return [iv, authTag, encrypted].map((buffer) => buffer.toString("base64")).join(".");
}

export function decryptString(payload: string, secret: string) {
  const [ivValue, authTagValue, encryptedValue] = payload.split(".");
  if (!ivValue || !authTagValue || !encryptedValue) {
    throw new Error("Invalid encrypted payload format.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(secret),
    Buffer.from(ivValue, "base64")
  );
  decipher.setAuthTag(Buffer.from(authTagValue, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64")),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}
