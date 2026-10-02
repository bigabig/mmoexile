-- Store only a SHA-256 hash of the client's refresh secret (the former
-- plaintext "token"). Existing tokens are hashed in place, so clients that
-- still hold their token keep working.
ALTER TABLE "Account" RENAME COLUMN "token" TO "refreshSecretHash";
UPDATE "Account" SET "refreshSecretHash" = encode(sha256(convert_to("refreshSecretHash", 'UTF8')), 'hex');
ALTER INDEX "Account_token_key" RENAME TO "Account_refreshSecretHash_key";
