import { useId } from 'react'
import { CLOUD_GUIDE_URL, DEPLOY_URL, SETUP_URL } from '../lib/project'
import { readDeployment } from '../lib/deployment'
import './StartTeam.css'

// The three free services a cloud team runs on, in the order the coach meets them.
const stack = [
  { verb: 'Create', name: 'GitHub', role: 'Your team’s copy of OpenSport', logo: <GitHubLogo /> },
  { verb: 'Connect', name: 'Vercel', role: 'Your team’s website', logo: <VercelLogo /> },
  { verb: 'Add', name: 'Supabase', role: 'Your schedule, roster, and logins', logo: <SupabaseLogo /> },
]

export default function StartTeam() {
  const deployment = readDeployment()
  return (
    <div className="project-site os-start">
      <Header deployed={Boolean(deployment)} />
      <main className="os-container">
        {deployment ? <Ready deployment={deployment} /> : <Intro />}
        {!deployment && <section className="os-start-steps" aria-labelledby="steps-heading">
          <p className="os-eyebrow">WHAT YOU’LL SEE</p>
          <h2 id="steps-heading">Six screens, then your team is live.</h2>
          <ol>
            <Step number="01" tone="green" title="Continue with GitHub" screen={<SignInScreen />}>
              <p>Click <strong>Continue with GitHub</strong>. It also creates your free Vercel account.</p>
            </Step>
            <Step number="02" tone="peach" title="Create your GitHub account" screen={<GitHubScreen />}>
              <p>New to GitHub? Click <strong>Create an account</strong> and enter the code GitHub emails you. Already have one? Just sign in.</p>
              <p>Either way, you come straight back to Vercel.</p>
            </Step>
            <Step number="03" tone="mint" title="Name your team" screen={<RepositoryScreen />}>
              <p>Type your team’s name, like <code>riverside-fc</code>, and click <strong>Create</strong>. Asked for a plan? Pick <strong>Hobby</strong>. It’s free.</p>
            </Step>
            <Step number="04" tone="orange" title="Add the free database" screen={<DatabaseScreen />}>
              <p>Click <strong>Add</strong> next to Supabase and pick the <strong>Free</strong> plan, in the region closest to your team.</p>
            </Step>
            <Step number="05" tone="butter" title="Pick a setup code" screen={<SetupCodeScreen />}>
              <p>Type a private phrase, like <code>riverside spring 2027</code>, and click <strong>Deploy</strong>. Write it down: you’ll need it once.</p>
            </Step>
            <Step number="06" tone="green" title="Wait a few minutes" screen={<BuildScreen />}>
              <p>Vercel builds your team’s site, then brings you back here with your link.</p>
              <p>Stayed on Vercel? Click <strong>Continue to Dashboard</strong>, then <strong>Visit</strong>.</p>
            </Step>
          </ol>
          <div className="os-start-again"><a className="os-button os-button-primary" href={DEPLOY_URL} target="_blank" rel="noreferrer">Start my team <Arrow /></a><span>Opens Vercel in a new tab</span></div>
        </section>}
        <Help />
      </main>
    </div>
  )
}

// The homepage's header, with the way back and this page's own actions.
function Header({ deployed }) {
  const showHelp = () => document.getElementById('start-help')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  return (
    <header className="os-nav os-container">
      <a className="os-wordmark" href="/" aria-label="OpenSport home"><img src="/favicon.svg" width="34" height="34" alt="" />OpenSport<span className="os-wordmark-period">.</span></a>
      <nav aria-label="Main navigation">
        <a href="/">← Home</a>
        <a className="os-nav-secondary" href="/#/demo">Try the demo</a>
        <button type="button" className="os-nav-secondary os-start-nav-help" onClick={showHelp}>Help</button>
        {!deployed && <a className="os-nav-secondary os-start-nav-cta" href={DEPLOY_URL} target="_blank" rel="noreferrer">Start my team <Arrow /></a>}
      </nav>
    </header>
  )
}

function Intro() {
  return (
    <section className="os-start-hero" aria-labelledby="start-heading">
      <p className="os-eyebrow">START YOUR TEAM · FREE · ABOUT 10 MINUTES</p>
      <h1 id="start-heading">Your team, live in a few clicks.</h1>
      <p className="os-start-lead">Your team runs on three free services. Create, connect, and you’re live.</p>
      <ol className="os-start-stack" aria-label="The three free services that run your team">
        {stack.map(({ verb, name, role, logo }, index) => <li key={name}>
          <span className="os-start-verb">{String(index + 1).padStart(2, '0')} · {verb}</span>
          {logo}
          <strong>{name}</strong>
          <span className="os-start-role">{role}</span>
          <em>Free</em>
        </li>)}
      </ol>
      <div className="os-start-actions"><a className="os-button os-button-primary" href={DEPLOY_URL} target="_blank" rel="noreferrer">Start my team <Arrow /></a><span>Opens Vercel in a new tab · Best on a computer</span></div>
    </section>
  )
}

function Ready({ deployment }) {
  return (
    <section className="os-start-ready" aria-labelledby="ready-heading">
      <p className="os-eyebrow">YOU DID IT</p>
      <h1 id="ready-heading">Your team’s site is live.</h1>
      {deployment.url ? <>
        <p className="os-start-address">{deployment.host}</p>
        <a className="os-button os-button-light" href={deployment.url} target="_blank" rel="noreferrer">Open my team <Arrow /></a>
      </> : <>
        <p className="os-start-address">Open your project on Vercel, then click Visit.</p>
        <a className="os-button os-button-light" href={deployment.dashboard || 'https://vercel.com/dashboard'} target="_blank" rel="noreferrer">Open my Vercel dashboard <Arrow /></a>
      </>}
      <ol className="os-start-next">
        <li><span>01</span><p>Enter the setup code you chose on Vercel.</p></li>
        <li><span>02</span><p>Name your team and create your own account.</p></li>
        <li><span>03</span><p>In <strong>Manage</strong>, create an invitation link for each teammate and send it by text or email.</p></li>
      </ol>
      <p className="os-start-bookmark">Bookmark your team’s address. You and your teammates will use it every week.{deployment.url && deployment.dashboard && <> You can always find it on <a href={deployment.dashboard} target="_blank" rel="noreferrer">your Vercel dashboard ↗</a>.</>}</p>
    </section>
  )
}

function Help() {
  return (
    <section className="os-start-help" id="start-help" aria-labelledby="help-heading">
      <p className="os-eyebrow">HELP</p>
      <h2 id="help-heading">If something looks different.</h2>
      <div className="os-start-faq">
        <details><summary>Supabase’s Free plan is greyed out</summary><p>Supabase allows each person two active free projects. If you already have two, pause or delete one you no longer need at <a href="https://supabase.com/dashboard/projects" target="_blank" rel="noreferrer">supabase.com/dashboard</a>, then click <strong>Add</strong> next to Supabase again.</p></details>
        <details><summary>Vercel asks to install itself on GitHub</summary><p>Click <strong>Install</strong>. That lets Vercel create your team’s copy of OpenSport in your GitHub account.</p></details>
        <details><summary>The deploy failed</summary><p>A brand-new database can take a few minutes to start. On Vercel, open your project, then <strong>Deployments</strong>, and choose <strong>Redeploy</strong> on the latest one.</p></details>
        <details><summary>I closed the tab before it finished</summary><p>Go to <a href="https://vercel.com/dashboard" target="_blank" rel="noreferrer">vercel.com/dashboard</a>, open your project, and click <strong>Visit</strong>. That’s your team’s site.</p></details>
        <details><summary>Is it really free?</summary><p>Yes for a typical team: GitHub, Vercel’s Hobby plan, and Supabase’s Free plan all cost $0. Vercel’s Hobby plan is for personal, non-commercial use, so a club that charges fees should use Vercel Pro.</p></details>
        <details><summary>I’d rather run it on my own server</summary><p>Follow the <a href={SETUP_URL}>self-hosting guide</a>, or read the full <a href={CLOUD_GUIDE_URL} target="_blank" rel="noreferrer">cloud guide</a> for more detail.</p></details>
      </div>
    </section>
  )
}

function Step({ number, tone, title, screen, children }) {
  return <li className="os-start-step"><div className="os-start-step-copy"><span className="os-start-number">{number}</span><h3>{title}</h3>{children}</div><div className={`os-start-screen-wrap os-tone-${tone}`} aria-hidden="true">{screen}</div></li>
}

// Simplified drawings of the screens on Vercel and GitHub, labelled exactly as they appear.
function Screen({ site, icon, title, children }) {
  return <div className="os-screen"><div className="os-screen-bar"><i /><i /><i /><span>{icon}{site}</span></div><div className="os-screen-body"><p className="os-screen-title">{title}</p>{children}</div></div>
}
function Pick({ label, children }) {
  return <div className="os-screen-pick"><b>{label}</b>{children}</div>
}
function SignInScreen() {
  return <Screen site="vercel.com/new/clone" icon={<VercelLogo />} title="New Project"><span className="os-screen-card"><strong>OpenSport</strong>The free, open-source alternative to TeamSnap.</span><p className="os-screen-caption">Sign in to clone and deploy.</p><Pick label="Click"><span className="os-screen-button"><GitHubLogo />Continue with GitHub</span></Pick><span className="os-screen-button os-screen-faded">Continue with GitLab</span><span className="os-screen-button os-screen-faded">Continue with Bitbucket</span></Screen>
}
function GitHubScreen() {
  return <Screen site="github.com/login" icon={<GitHubLogo />} title="Sign in to GitHub"><p className="os-screen-caption">to continue to Vercel</p><span className="os-screen-field os-screen-faded"><small>Username or email address</small>&nbsp;</span><span className="os-screen-field os-screen-faded"><small>Password</small>&nbsp;</span><span className="os-screen-button os-screen-github os-screen-faded">Sign in</span><Pick label="New? Click"><span className="os-screen-link">New to GitHub? <u>Create an account</u></span></Pick></Screen>
}
function RepositoryScreen() {
  return <Screen site="vercel.com/new/clone" icon={<VercelLogo />} title="New Project"><div className="os-screen-fields"><span className="os-screen-field"><small>Git Scope</small>your-github ▾</span><Pick label="Type"><span className="os-screen-field os-screen-typing"><small>Private Repository Name</small>riverside-fc</span></Pick></div><span className="os-screen-field"><small>Vercel Team</small>Your projects · Hobby ▾</span><span className="os-screen-button os-screen-dark os-screen-wide">Create</span></Screen>
}
function DatabaseScreen() {
  return <Screen site="vercel.com/new/clone" icon={<VercelLogo />} title="Add Products"><div className="os-screen-row"><span className="os-screen-product"><SupabaseLogo /><span><strong>Supabase</strong>Postgres backend</span></span><span className="os-screen-button os-screen-dark">Add</span></div><Pick label="Choose"><span className="os-screen-option os-screen-selected"><strong>Supabase Free Plan</strong>$0/month</span></Pick><span className="os-screen-option os-screen-faded"><strong>Supabase Pro Plan</strong>Starting at $25/month</span></Screen>
}
function SetupCodeScreen() {
  return <Screen site="vercel.com/new/clone" icon={<VercelLogo />} title="Add Environment Variables"><div className="os-screen-fields"><span className="os-screen-field"><small>Name</small>OPENSPORT_SETUP_CODE</span><Pick label="Type"><span className="os-screen-field os-screen-typing"><small>Value</small>riverside spring 2027</span></Pick></div><span className="os-screen-button os-screen-dark os-screen-wide">Deploy</span></Screen>
}
function BuildScreen() {
  return <Screen site="vercel.com/new/clone" icon={<VercelLogo />} title="Deploying"><div className="os-screen-progress"><span /></div><p className="os-screen-caption">Building your team’s site and database…</p><p className="os-screen-done">Then you’re back on OpenSport ↩</p></Screen>
}

// Brand marks of the three services, shown only to identify them.
function GitHubLogo() {
  return <svg className="os-logo os-logo-github" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .7a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.55v-2.14c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.78 1.19 1.78 1.19 1.03 1.77 2.71 1.26 3.37.97.1-.75.4-1.26.74-1.55-2.57-.29-5.28-1.29-5.28-5.72 0-1.26.45-2.29 1.19-3.09-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.44-2.71 5.42-5.29 5.71.42.36.79 1.06.79 2.14v3.18c0 .31.21.67.8.55A11.5 11.5 0 0 0 12 .7Z" /></svg>
}
function VercelLogo() {
  return <svg className="os-logo os-logo-vercel" viewBox="0 0 76 65" fill="currentColor" aria-hidden="true"><path d="M37.5274 0L75.0548 65H0L37.5274 0Z" /></svg>
}
function SupabaseLogo() {
  const id = useId().replace(/:/g, '')
  return <svg className="os-logo os-logo-supabase" viewBox="0 0 109 113" fill="none" aria-hidden="true">
    <path d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627L99.1935 40.0627C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z" fill={`url(#${id}-dark)`} />
    <path d="M45.317 2.07103C48.1765 -1.53037 53.9745 0.442937 54.0434 5.041L54.4849 72.2922H9.83113C1.64038 72.2922 -2.92775 62.8321 2.1655 56.4175L45.317 2.07103Z" fill="#3ECF8E" />
    <defs><linearGradient id={`${id}-dark`} x1="53.9738" y1="54.974" x2="94.1635" y2="71.8295" gradientUnits="userSpaceOnUse"><stop stopColor="#249361" /><stop offset="1" stopColor="#3ECF8E" /></linearGradient></defs>
  </svg>
}
function Arrow() {
  return <svg className="os-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M5 19 19 5M5 5h14v14" /></svg>
}
