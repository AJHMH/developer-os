import { macKeychainStore } from "./keychain-store.js";
export interface CredentialVault {
  read(accountId: string): string;
  write(accountId: string, encodedAccount: string, replace?: boolean): void;
}
export function hostCredentialVault(
  directory: string,
  readOnly = false,
): CredentialVault {
  const vault = macKeychainStore(directory, readOnly);
  return {
    read: (accountId) => vault.read(accountId),
    write(accountId, value, replace = false) {
      if (readOnly) throw Error("Credential vault is read-only");
      vault.write(accountId, value, replace);
    },
  };
}
