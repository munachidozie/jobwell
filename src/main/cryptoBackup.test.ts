import { describe, expect, it } from "vitest";
import {
  decryptBackup,
  encryptBackup,
  isEncryptedEnvelope,
} from "./cryptoBackup";

const sample = {
  app: "jobwell",
  data: { profile: { jobFunction: "Engineer" }, jobs: [{ id: "a" }] },
};

describe("cryptoBackup", () => {
  it("round-trips data with the correct passphrase", () => {
    const env = encryptBackup(sample, "correct horse battery");
    expect(isEncryptedEnvelope(env)).toBe(true);
    const back = decryptBackup(env, "correct horse battery");
    expect(back).toEqual(sample);
  });

  it("produces different ciphertext each time (random salt/iv)", () => {
    const a = encryptBackup(sample, "pass123");
    const b = encryptBackup(sample, "pass123");
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.salt).not.toBe(b.salt);
    // ...but both still decrypt to the same thing.
    expect(decryptBackup(a, "pass123")).toEqual(decryptBackup(b, "pass123"));
  });

  it("rejects a wrong passphrase", () => {
    const env = encryptBackup(sample, "right-pass");
    expect(() => decryptBackup(env, "wrong-pass")).toThrow(/wrong passphrase/i);
  });

  it("detects tampering (GCM auth)", () => {
    const env = encryptBackup(sample, "pass123");
    // Flip a byte in the ciphertext.
    const buf = Buffer.from(env.ciphertext, "base64");
    buf[0] = buf[0] ^ 0xff;
    const tampered = { ...env, ciphertext: buf.toString("base64") };
    expect(() => decryptBackup(tampered, "pass123")).toThrow();
  });

  it("rejects files that aren't JobWell encrypted backups", () => {
    expect(isEncryptedEnvelope({ hello: "world" })).toBe(false);
    expect(() =>
      // @ts-expect-error wrong shape on purpose
      decryptBackup({ hello: "world" }, "x"),
    ).toThrow(/not a jobwell/i);
  });

  it("requires a minimum passphrase length", () => {
    expect(() => encryptBackup(sample, "abc")).toThrow(/at least 6/i);
  });
});
