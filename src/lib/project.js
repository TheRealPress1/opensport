export const REPOSITORY_URL = 'https://github.com/TheRealPress1/opensport'
export const RELEASE_VERSION = '0.1.0'
export const SETUP_URL = '/#/setup'
export const START_URL = '/#/start'
export const SITE_URL = 'https://getopensport.vercel.app'
export const CLOUD_GUIDE_URL = `${REPOSITORY_URL}/blob/main/docs/CLOUD.md`
// Generated from the exact checked source by npm run release:prepare.
export const DOWNLOAD_URL = `/downloads/opensport-${RELEASE_VERSION}-source.zip`
// Vercel's Deploy button: copies this repository into the visitor's GitHub
// account, creates a free Supabase database, and asks for a setup code. After a
// successful deploy, Vercel sends the coach back to the guide with their address.
export const DEPLOY_URL = `https://vercel.com/new/clone?${new URLSearchParams({
  'repository-url': REPOSITORY_URL,
  'project-name': 'opensport-team',
  'repository-name': 'opensport-team',
  env: 'OPENSPORT_SETUP_CODE',
  envDescription: 'Choose a private setup code of at least 12 characters, like a short phrase. You\'ll enter it once to create your team, and again only to recover the owner account.',
  envLink: `${CLOUD_GUIDE_URL}#your-setup-code`,
  stores: JSON.stringify([{ type: 'integration', integrationSlug: 'supabase', productSlug: 'supabase' }]),
  'demo-title': 'OpenSport',
  'demo-description': 'The free, open-source alternative to TeamSnap.',
  'demo-url': SITE_URL,
  'redirect-url': `${SITE_URL}/`,
})}`
