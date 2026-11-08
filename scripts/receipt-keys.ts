/**
 * pnpm receipt:keys: print a fresh Ed25519 key pair for proxy-mode receipts.
 * The private JWK goes into the runtime's secret store (RECEIPT_KEY), the
 * public JWK is what callers pin. Nothing is written to disk.
 */
import { exportReceiptKeys, generateReceiptKeys, receiptKeyId } from '../src/index.js';

const keys = await generateReceiptKeys();
const { privateJwk, publicJwk } = await exportReceiptKeys(keys);
console.log(`key id:      ${await receiptKeyId(keys.publicKey)}`);
console.log(`public JWK:  ${JSON.stringify(publicJwk)}`);
console.log(`private JWK: ${JSON.stringify(privateJwk)}`);
console.log('\nStore the private JWK as a secret (for example `wrangler secret put RECEIPT_KEY`). Never commit it.');
