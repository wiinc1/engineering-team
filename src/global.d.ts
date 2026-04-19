declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}

interface Window {
  __ENGINEERING_TEAM_RUNTIME_CONFIG__?: {
    oidcDiscoveryUrl?: string,
    oidcClientId?: string,
    oidcRedirectUri?: string,
    oidcScope?: string,
    oidcLogoutUrl?: string,
    oidcLogoutRedirectUri?: string,
    internalAuthBootstrapEnabled?: boolean,
  };
}
