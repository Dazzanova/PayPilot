import Keycloak from 'keycloak-js';

const url = import.meta.env.VITE_KEYCLOAK_URL || 'http://localhost:8080';
const realm = import.meta.env.VITE_KEYCLOAK_REALM || 'paypilot';
const clientId = import.meta.env.VITE_KEYCLOAK_CLIENT_ID || 'paypilot-web';

export const keycloak = new Keycloak({ url, realm, clientId });

let initPromise: Promise<boolean> | null = null;

export function initKeycloak(): Promise<boolean> {
  if (!initPromise) {
    initPromise = keycloak.init({
      onLoad: 'check-sso',
      flow: 'standard',
      pkceMethod: 'S256',
      checkLoginIframe: false,
      silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
    });
  }

  return initPromise;
}

export function getLoginRedirectUri(): string {
  return `${window.location.origin}/`;
}

export function getLogoutRedirectUri(): string {
  return `${window.location.origin}/login`;
}
