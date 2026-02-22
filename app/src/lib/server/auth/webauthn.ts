/**
 * WebAuthn / Passkey helpers using @simplewebauthn/server.
 *
 * Single-user model: one credential stored in the config table.
 * Registration happens during the setup wizard; authentication on every login.
 */
import {
	generateRegistrationOptions,
	verifyRegistrationResponse,
	generateAuthenticationOptions,
	verifyAuthenticationResponse,
	type VerifiedRegistrationResponse,
	type VerifiedAuthenticationResponse
} from '@simplewebauthn/server';
import type {
	AuthenticatorTransportFuture,
	CredentialDeviceType,
	Base64URLString
} from '@simplewebauthn/types';
import { getConfig, setConfig } from '../db/index.js';

const RP_NAME = 'Claude Code';

function getRpId(): string {
	const url = process.env.PUBLIC_URL ?? 'http://localhost:5173';
	return new URL(url).hostname;
}

function getOrigin(): string {
	return process.env.PUBLIC_URL ?? 'http://localhost:5173';
}

export interface StoredCredential {
	id: Base64URLString;
	publicKey: string; // base64url
	counter: number;
	deviceType: CredentialDeviceType;
	backedUp: boolean;
	transports?: AuthenticatorTransportFuture[];
}

export function getStoredCredential(): StoredCredential | null {
	const raw = getConfig('webauthn_credential');
	if (!raw) return null;
	return JSON.parse(raw) as StoredCredential;
}

function saveCredential(cred: StoredCredential): void {
	setConfig('webauthn_credential', JSON.stringify(cred));
}

// In-memory challenge store (single-user: only one pending challenge at a time)
let pendingChallenge: string | null = null;

export async function beginRegistration() {
	const options = await generateRegistrationOptions({
		rpName: RP_NAME,
		rpID: getRpId(),
		userName: 'owner',
		userDisplayName: 'Owner',
		attestationType: 'none',
		authenticatorSelection: {
			residentKey: 'preferred',
			userVerification: 'preferred'
		}
	});
	pendingChallenge = options.challenge;
	return options;
}

export async function completeRegistration(
	response: Parameters<typeof verifyRegistrationResponse>[0]['response']
): Promise<VerifiedRegistrationResponse> {
	if (!pendingChallenge) throw new Error('No pending registration challenge.');

	const verification = await verifyRegistrationResponse({
		response,
		expectedChallenge: pendingChallenge,
		expectedOrigin: getOrigin(),
		expectedRPID: getRpId()
	});

	pendingChallenge = null;

	if (verification.verified && verification.registrationInfo) {
		const { credential, credentialDeviceType, credentialBackedUp } =
			verification.registrationInfo;
		saveCredential({
			id: credential.id,
			publicKey: Buffer.from(credential.publicKey).toString('base64url'),
			counter: credential.counter,
			deviceType: credentialDeviceType,
			backedUp: credentialBackedUp,
			transports: credential.transports
		});
	}

	return verification;
}

export async function beginAuthentication() {
	const stored = getStoredCredential();
	if (!stored) throw new Error('No registered credential found. Complete setup first.');

	const options = await generateAuthenticationOptions({
		rpID: getRpId(),
		allowCredentials: [{ id: stored.id, transports: stored.transports }],
		userVerification: 'preferred'
	});
	pendingChallenge = options.challenge;
	return options;
}

export async function completeAuthentication(
	response: Parameters<typeof verifyAuthenticationResponse>[0]['response']
): Promise<VerifiedAuthenticationResponse> {
	if (!pendingChallenge) throw new Error('No pending authentication challenge.');
	const stored = getStoredCredential();
	if (!stored) throw new Error('No registered credential found.');

	const verification = await verifyAuthenticationResponse({
		response,
		expectedChallenge: pendingChallenge,
		expectedOrigin: getOrigin(),
		expectedRPID: getRpId(),
		credential: {
			id: stored.id,
			publicKey: Buffer.from(stored.publicKey, 'base64url'),
			counter: stored.counter,
			transports: stored.transports
		}
	});

	pendingChallenge = null;

	if (verification.verified) {
		// Update counter to prevent replay attacks
		stored.counter = verification.authenticationInfo.newCounter;
		saveCredential(stored);
	}

	return verification;
}
