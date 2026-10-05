import { makeCacheableSignalKeyStore } from 'baileys';
import { join } from 'path';
import { useSQLiteAuthState } from './sqlite-auth-state.js';

export default async function () {
	const { state, saveCreds } = await useSQLiteAuthState(join(process.cwd(), 'data/auth'));
	return {
		saveCreds,
		auth: {
			creds: state.creds,
			keys: makeCacheableSignalKeyStore(state.keys),
		},
	};
}
