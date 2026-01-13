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
     * Realiza login usando um access_token do Android (guest token)
     * O servidor responde com 302 redirect e um novo PHPSESSID no Set-Cookie
     * @param accessToken O access_token do guest Android (formato: guest_android_...)
     * @param appVersion Versão do app (padrão: 1.1.4)
     * @returns O PHPSESSID da sessão autenticada
     */
    async loginWithAndroidToken(accessToken: string, appVersion: string = '1.1.4'): Promise<string> {
        this.logger.info('🤖 Fazendo login via Android token...');

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

            // Extrair o PHPSESSID da resposta
            const sessionId = this.extractSessionId(response.headers['set-cookie']);

            if (sessionId) {
                this.logger.info(`✅ Login Android realizado com sucesso! Session ID: ${sessionId.substring(0, 8)}...`);
                return sessionId;
            }

            throw new Error('Não foi possível obter PHPSESSID do login Android. Token pode estar inválido.');

        } catch (error: unknown) {
            if (axios.isAxiosError(error)) {
                if (error.response?.status === 401 || error.response?.status === 403) {
                    throw new Error('Access token Android inválido.');
                }
                throw new Error(`Erro de conexão ao fazer login Android: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * Registra uma NOVA conta guest e faz login automaticamente.
     * Não precisa de nenhuma credencial - o servidor gera um novo usuário a cada chamada.
     * @param appVersion Versão do app (padrão: 1.1.4)
     * @returns Objeto com accessToken (para uso futuro) e phpSessionId
     */
    async registerGuestAndLogin(appVersion: string = '1.1.4'): Promise<{ accessToken: string; phpSessionId: string; userId: number }> {
        this.logger.info('🆕 Registrando nova conta guest...');

        try {
            // Passo 1: Chamar /app/auth.php para criar nova conta guest
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
                throw new Error('Falha ao registrar conta guest. Resposta inválida do servidor.');
            }

            const accessToken = authData.access_token;
            const userId = authData.user_id;

            this.logger.info(`✅ Conta guest criada! User ID: ${userId}, Token: ${accessToken.substring(0, 20)}...`);

            // Passo 2: Usar o access_token para obter PHPSESSID
            const phpSessionId = await this.loginWithAndroidToken(accessToken, appVersion);

            return {
                accessToken,
                phpSessionId,
                userId,
            };

        } catch (error: unknown) {
            if (axios.isAxiosError(error)) {
                throw new Error(`Erro ao registrar conta guest: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * Realiza login no sistema e retorna o PHPSESSID
     * @param email Email do usuário
     * @param password Senha do usuário
     * @returns O PHPSESSID da sessão autenticada
     */
    async login(email: string, password: string): Promise<string> {
        this.logger.info('🔐 Fazendo login automático...');

        try {
            // Primeiro, fazer uma requisição para obter um PHPSESSID inicial
            const initialResponse = await axios.get('https://farm-app.trophyapi.com/index-login.php', {
                headers: {
                    'User-Agent': DEFAULT_HEADERS['User-Agent'],
                    'Accept': DEFAULT_HEADERS['Accept'],
                },
                maxRedirects: 0,
                validateStatus: (status) => status < 400,
            });

            // Extrair PHPSESSID inicial do Set-Cookie
            let initialSessionId = this.extractSessionId(initialResponse.headers['set-cookie']);

            if (!initialSessionId) {
                // Se não veio no header, pode já estar em cookie
                this.logger.debugLog('Nenhum PHPSESSID inicial encontrado, continuando sem...');
                initialSessionId = '';
            }

            // Fazer o login com as credenciais
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

            // Extrair o PHPSESSID da resposta de login
            const sessionId = this.extractSessionId(loginResponse.headers['set-cookie']);

            if (sessionId) {
                this.logger.info(`✅ Login realizado com sucesso! Session ID: ${sessionId.substring(0, 8)}...`);
                return sessionId;
            }

            // Se não veio novo cookie, usar o inicial (a sessão foi autenticada)
            if (initialSessionId) {
                this.logger.info(`✅ Login realizado com sucesso! Usando sessão inicial: ${initialSessionId.substring(0, 8)}...`);
                return initialSessionId;
            }

            // Verificar se houve erro na resposta
            const responseData = typeof loginResponse.data === 'string' ? loginResponse.data : '';
            if (responseData.includes('error') || responseData.includes('Invalid')) {
                throw new Error('Credenciais inválidas. Verifique email e senha.');
            }

            throw new Error('Não foi possível obter PHPSESSID após login. Verifique as credenciais.');

        } catch (error) {
            if (axios.isAxiosError(error)) {
                if (error.response?.status === 401 || error.response?.status === 403) {
                    throw new Error('Credenciais inválidas. Verifique email e senha.');
                }
                throw new Error(`Erro de conexão ao fazer login: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * Extrai o PHPSESSID do header Set-Cookie
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
