// ============================================
// Farm Manager Bot - Auth Service
// ============================================

import axios from 'axios';
import { Logger } from '../utils/logger';

const LOGIN_URL = 'https://farm-app.trophyapi.com/login-check.php';
const ANDROID_DISPATCH_URL = 'https://farm-app.trophyapi.com/app/app-dispatch.php';
const AUTH_URL = 'https://farm-app.trophyapi.com/app/auth.php';

const ANDROID_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 12; SM-G973F Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/143.0.7499.146 Mobile Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'sec-ch-ua': '"Android WebView";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    'upgrade-insecure-requests': '1',
    'x-requested-with': 'com.trophygames.farmmanager',
    'sec-fetch-site': 'none',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-user': '?1',
    'sec-fetch-dest': 'document',
    'priority': 'u=0, i',
};

const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Origin': 'https://farm-app.trophyapi.com',
    'Referer': 'https://farm-app.trophyapi.com/index-login.php',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1',
};

export class AuthService {
    private logger: Logger;

    constructor() {
        this.logger = new Logger('Auth');
    }

    /**
     * Performs login using an Android access_token (guest token)
     * The server responds with 302 redirect and a new PHPSESSID in Set-Cookie
     * @param accessToken The Android guest access_token (format: guest_android_...)
     * @param appVersion App version (default: 1.1.4)
     * @returns The PHPSESSID of the authenticated session
     */
    async loginWithAndroidToken(accessToken: string, appVersion: string = '1.1.4'): Promise<string> {
        this.logger.info('🤖 Logging in via Android token...');

        try {
            const params = new URLSearchParams({
                access_token: accessToken,
                platform: 'android',
                appVersion: appVersion,
            });
            const url = `${ANDROID_DISPATCH_URL}?${params.toString()}`;

            const response = await axios.get(url, {
                headers: {
                    ...ANDROID_HEADERS,
                    Cookie: 'device=android',
                },
                maxRedirects: 0,
                validateStatus: (status: number) => status < 400 || status === 302,
            });

            // Extract PHPSESSID from response
            const sessionId = this.extractSessionId(response.headers['set-cookie']);

            if (sessionId) {
                this.logger.info(`✅ Android login successful! Session ID: ${sessionId.substring(0, 8)}...`);
                return sessionId;
            }

            throw new Error('Could not obtain PHPSESSID from Android login. Token may be invalid.');

        } catch (error: unknown) {
            if (axios.isAxiosError(error)) {
                if (error.response?.status === 401 || error.response?.status === 403) {
                    throw new Error('Invalid Android access token.');
                }
                throw new Error(`Connection error during Android login: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * Registers a NEW guest account and logs in automatically.
     * No credentials needed - the server generates a new user on each call.
     * @param appVersion App version (default: 1.1.4)
     * @returns Object with accessToken (for future use) and phpSessionId
     */
    async registerGuestAndLogin(appVersion: string = '1.1.4'): Promise<{ accessToken: string; phpSessionId: string; userId: number }> {
        this.logger.info('🆕 Registering new guest account...');

        try {
            // Step 1: Call /app/auth.php to create new guest account
            const authResponse = await axios.post(AUTH_URL, {
                platform: 'android',
                appVersion: appVersion,
            }, {
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    'platform': 'android',
                    'appVersion': appVersion,
                },
            });

            const authData = authResponse.data;

            if (!authData.success || !authData.access_token) {
                throw new Error('Failed to register guest account. Invalid server response.');
            }

            const accessToken = authData.access_token;
            const userId = authData.user_id;

            this.logger.info(`✅ Guest account created! User ID: ${userId}, Token: ${accessToken.substring(0, 20)}...`);

            // Step 2: Use access_token to obtain PHPSESSID
            const phpSessionId = await this.loginWithAndroidToken(accessToken, appVersion);

            return {
                accessToken,
                phpSessionId,
                userId,
            };

        } catch (error: unknown) {
            if (axios.isAxiosError(error)) {
                throw new Error(`Error registering guest account: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * Performs login to the system and returns PHPSESSID
     * @param email User email
     * @param password User password
     * @returns The PHPSESSID of the authenticated session
     */
    async login(email: string, password: string): Promise<string> {
        this.logger.info('🔐 Performing automatic login...');

        try {
            // First, make a request to get an initial PHPSESSID
            const initialResponse = await axios.get('https://farm-app.trophyapi.com/index-login.php', {
                headers: {
                    'User-Agent': DEFAULT_HEADERS['User-Agent'],
                    'Accept': DEFAULT_HEADERS['Accept'],
                },
                maxRedirects: 0,
                validateStatus: (status) => status < 400,
            });

            // Extract initial PHPSESSID from Set-Cookie
            let initialSessionId = this.extractSessionId(initialResponse.headers['set-cookie']);

            if (!initialSessionId) {
                // If not in header, may already be in cookie
                this.logger.debugLog('No initial PHPSESSID found, continuing without...');
                initialSessionId = '';
            }

            // Perform login with credentials
            const formData = new URLSearchParams();
            formData.append('email', email);
            formData.append('password', password);

            const loginResponse = await axios.post(LOGIN_URL, formData, {
                headers: {
                    ...DEFAULT_HEADERS,
                    Cookie: initialSessionId ? `PHPSESSID=${initialSessionId}; device=web` : 'device=web',
                },
                maxRedirects: 0,
                validateStatus: (status) => status < 400 || status === 302,
            });

            // Extract PHPSESSID from login response
            const sessionId = this.extractSessionId(loginResponse.headers['set-cookie']);

            if (sessionId) {
                this.logger.info(`✅ Login successful! Session ID: ${sessionId.substring(0, 8)}...`);
                return sessionId;
            }

            // If no new cookie, use initial one (session was authenticated)
            if (initialSessionId) {
                this.logger.info(`✅ Login successful! Using initial session: ${initialSessionId.substring(0, 8)}...`);
                return initialSessionId;
            }

            // Check if there was an error in the response
            const responseData = typeof loginResponse.data === 'string' ? loginResponse.data : '';
            if (responseData.includes('error') || responseData.includes('Invalid')) {
                throw new Error('Invalid credentials. Check email and password.');
            }

            throw new Error('Could not obtain PHPSESSID after login. Check credentials.');

        } catch (error) {
            if (axios.isAxiosError(error)) {
                if (error.response?.status === 401 || error.response?.status === 403) {
                    throw new Error('Invalid credentials. Check email and password.');
                }
                throw new Error(`Connection error during login: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * Extracts PHPSESSID from Set-Cookie header
     */
    private extractSessionId(setCookieHeader: string[] | undefined): string | null {
        if (!setCookieHeader) {
            return null;
        }

        for (const cookie of setCookieHeader) {
            const match = cookie.match(/PHPSESSID=([^;]+)/);
            if (match) {
                return match[1];
            }
        }

        return null;
    }
}
