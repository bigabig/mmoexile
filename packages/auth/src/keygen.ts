/**
 * Prints a fresh Ed25519 key pair for transfer tickets:
 *   pnpm --filter @mmoexile/auth keygen
 * TICKET_PRIVATE_KEY goes to the orchestrator only; TICKET_PUBLIC_KEY to
 * every instance server.
 */
import { generateTicketKeyPair } from "./tokens.js";

const { privateKey, publicKey } = await generateTicketKeyPair();
console.log(`TICKET_PRIVATE_KEY=${privateKey}`);
console.log(`TICKET_PUBLIC_KEY=${publicKey}`);
