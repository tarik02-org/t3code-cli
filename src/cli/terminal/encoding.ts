export function bytesToLatin1String(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

export function decodeHexPayload(value: string): string | undefined {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length % 2 !== 0 ||
    !/^[0-9a-fA-F]+$/.test(normalized)
  ) {
    return undefined;
  }
  return Buffer.from(normalized, "hex").toString("latin1");
}

export function decodeBase64Payload(value: string): string | undefined {
  const normalized = value.trim();
  if (normalized.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    return undefined;
  }
  return Buffer.from(normalized, "base64").toString("latin1");
}
