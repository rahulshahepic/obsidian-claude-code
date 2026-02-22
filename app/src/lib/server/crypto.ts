/**
 * AES-256-GCM encryption for sensitive config values (tokens, credentials).
 * ENCRYPTION_KEY must be a 64-char hex string (32 bytes).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

function getKey(): Buffer {
	const hex = process.env.ENCRYPTION_KEY;
	if (!hex || hex.length !== 64) {
		throw new Error('ENCRYPTION_KEY env var must be a 64-character hex string (32 bytes).');
	}
	return Buffer.from(hex, 'hex');
}

const ALG = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

export function encrypt(plaintext: string): string {
	const iv = randomBytes(IV_LEN);
	const cipher = createCipheriv(ALG, getKey(), iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	// Format: iv(hex) + ":" + tag(hex) + ":" + ciphertext(hex)
	return `${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decrypt(encoded: string): string {
	const parts = encoded.split(':');
	const [ivHex, tagHex, ciphertextHex] = parts;
	// ciphertextHex may be '' for empty-string plaintexts — only reject if segment is missing entirely
	if (parts.length !== 3 || !ivHex || !tagHex) throw new Error('Invalid encrypted value format.');
	const iv = Buffer.from(ivHex, 'hex');
	const tag = Buffer.from(tagHex, 'hex');
	const ciphertext = Buffer.from(ciphertextHex, 'hex');
	const decipher = createDecipheriv(ALG, getKey(), iv);
	decipher.setAuthTag(tag);
	return decipher.update(ciphertext).toString('utf8') + decipher.final('utf8');
}
