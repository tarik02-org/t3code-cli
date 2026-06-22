import { createRequire } from "node:module";

type KeyringEntry = {
  getPassword(): string | null;
  setPassword(password: string): void;
};

type KeyringModule = {
  Entry: new (service: string, account: string) => KeyringEntry;
};

const require = createRequire(import.meta.url);

let cachedKeyringModule: KeyringModule | null | undefined;

function isKeyringModule(value: unknown): value is KeyringModule {
  if (typeof value !== "object" || value === null || !("Entry" in value)) {
    return false;
  }
  return typeof value.Entry === "function";
}

function loadKeyringModule(): KeyringModule | null {
  if (cachedKeyringModule !== undefined) {
    return cachedKeyringModule;
  }
  try {
    const loaded: unknown = require("@napi-rs/keyring");
    cachedKeyringModule = isKeyringModule(loaded) ? loaded : null;
  } catch {
    cachedKeyringModule = null;
  }
  return cachedKeyringModule;
}

export type KeyringStore = {
  readonly readPassword: (service: string, account: string) => string | null;
  readonly writePassword: (service: string, account: string, password: string) => void;
};

export function getKeyringStore(): KeyringStore | null {
  const keyring = loadKeyringModule();
  if (keyring === null) {
    return null;
  }
  return {
    readPassword(service, account) {
      return new keyring.Entry(service, account).getPassword();
    },
    writePassword(service, account, password) {
      new keyring.Entry(service, account).setPassword(password);
    },
  };
}
