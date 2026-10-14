// This profile marks the first Mac preview with authenticated database startup.
// Older preview data must never silently start with development credentials.
export const NATIVE_CLI_VERSION = '2.120.0'
export const NATIVE_SECURITY_PROFILE = 'opensport-native-auth-v1'
export const NATIVE_MANIFEST_FORMAT = 2

export function validNativeSecrets(secrets) {
  return secrets && typeof secrets === 'object'
    && Object.values(secrets).every(value => typeof value === 'string')
    && /^[a-f0-9]{64}$/.test(secrets.OPENSPORT_NATIVE_DATABASE_PASSWORD)
    && /^[a-f0-9]{64}$/.test(secrets.OPENSPORT_NATIVE_POSTGRES_ROOT_KEY)
    && /^[a-f0-9]{64}$/.test(secrets.OPENSPORT_NATIVE_JWT_SECRET)
    && /^sb_secret_[A-Za-z0-9_-]{43}$/.test(secrets.OPENSPORT_NATIVE_SECRET_KEY)
    && /^sb_publishable_[A-Za-z0-9_-]{43}$/.test(secrets.OPENSPORT_NATIVE_PUBLISHABLE_KEY)
    && Object.keys(secrets).sort().join(',') === 'OPENSPORT_NATIVE_DATABASE_PASSWORD,OPENSPORT_NATIVE_JWT_SECRET,OPENSPORT_NATIVE_POSTGRES_ROOT_KEY,OPENSPORT_NATIVE_PUBLISHABLE_KEY,OPENSPORT_NATIVE_SECRET_KEY'
}
