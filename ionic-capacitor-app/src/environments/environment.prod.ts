export const environment = {
  production: true,
  sync: {
    // Supply the production HTTPS API origin in the release build pipeline.
    apiBaseUrl: '',
    requestTimeoutMs: 15_000,
  },
};
