import { macKeychainStore } from "./keychain-store.js";
import { windowsAuthStore } from "./windows-auth-store.js";
export interface CredentialVault {
  read(accountId: string): string;
  write(accountId: string, encodedAccount: string, replace?: boolean): void;
}
export function hostCredentialVault(
  directory: string,
  readOnly = false,
): CredentialVault {
  const vault =
    process.platform === "win32"
      ? windowsAuthStore(directory)
      : macKeychainStore(directory, readOnly);
  return {
    read: (accountId) => vault.read(accountId),
    write(accountId, value, replace = false) {
      if (readOnly) throw Error("Credential vault is read-only");
      vault.write(accountId, value, replace);
    },
  };
}
