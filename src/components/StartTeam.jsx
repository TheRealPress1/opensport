import { CLOUD_GUIDE_URL, DEPLOY_URL, SETUP_URL } from '../lib/project'
import { readDeployment } from '../lib/deployment'
import './StartTeam.css'

const accounts = [
  ['GitHub', 'Keeps your team’s copy of OpenSport. You won’t need to open it again.'],
  ['Vercel', 'Runs your team’s website, at an address like riverside-fc.vercel.app.'],
  ['Supabase', 'Stores your schedule, roster, and logins. Vercel creates it for you.'],
]

export default function StartTeam() {
  const deployment = readDeployment()
  return (
    <div className="project-site os-start">
      <header className="os-start-nav os-container"><a href="/">← OpenSport</a></header>
      <main className="os-container">
        {deployment ? <Ready deployment={deployment} /> : <Intro />}
        {!deployment && <section className="os-start-steps" aria-labelledby="steps-heading">
          <p className="os-eyebrow">WHAT YOU’LL SEE</p>
          <h2 id="steps-heading">Six screens, then your team is live.</h2>
          <ol>
            <Step number="01" title="Continue with GitHub" screen={<SignInScreen />}>
              <p>Vercel opens a page titled <strong>New Project</strong>, with OpenSport at the top. Click <strong>Continue with GitHub</strong>.</p>
              <p>That also creates your free Vercel account. There’s nothing else to sign up for.</p>
            </Step>
            <Step number="02" title="Sign in, or create your GitHub account" screen={<GitHubScreen />}>
              <p>Already on GitHub? Sign in. New to GitHub? Click <strong>Create an account</strong>, enter your email, a password, and a username, then type the code GitHub emails you.</p>
              <p>If GitHub asks a few welcome questions, you can skip them. If it asks, click <strong>Authorize Vercel</strong>. GitHub then sends you straight back to Vercel.</p>
            </Step>
            <Step number="03" title="Name your team’s copy" screen={<RepositoryScreen />}>
              <p>Under <strong>Private Repository Name</strong>, type your team’s name, like <code>riverside-fc</code>. Your site’s address will match it.</p>
              <p>If Vercel asks you to pick a plan or a team, choose <strong>Hobby</strong>, the free one. Leave everything else and click <strong>Create</strong>. If Vercel asks to install itself on GitHub, click <strong>Install</strong>.</p>
            </Step>
            <Step number="04" title="Add the free database" screen={<DatabaseScreen />}>
              <p>Next to <strong>Supabase</strong>, click <strong>Add</strong>. Choose <strong>Supabase Free Plan, $0/month</strong>, pick the region closest to your team, and accept Supabase’s terms. Leave the other settings as they are.</p>
              <p className="os-start-note">Free plan greyed out? See <a href="#start-help">Help</a> below.</p>
            </Step>
            <Step number="05" title="Choose your setup code" screen={<SetupCodeScreen />}>
              <p>In the box next to <strong>OPENSPORT_SETUP_CODE</strong>, type a private phrase of at least 12 characters, like <code>riverside spring 2027</code>.</p>
              <p><strong>Write it down.</strong> You’ll need it in a few minutes to create your team. Then click <strong>Deploy</strong>.</p>
            </Step>
            <Step number="06" title="Wait a few minutes" screen={<BuildScreen />}>
              <p>Vercel builds your site and prepares your team’s database. When it’s done, it brings you back to OpenSport with a link to your team.</p>
              <p>If you stay on Vercel instead, click <strong>Continue to Dashboard</strong>, then <strong>Visit</strong>. That’s your team’s site.</p>
            </Step>
          </ol>
          <div className="os-start-again"><a className="os-button os-button-primary" href={DEPLOY_URL} target="_blank" rel="noreferrer">Start my team <Arrow /></a><span>Opens Vercel in a new tab. Keep this page open.</span></div>
        </section>}
        <Help />
      </main>
    </div>
  )
}

function Intro() {
  return (
    <section className="os-start-hero" aria-labelledby="start-heading">
      <p className="os-eyebrow">START YOUR TEAM · FREE · ABOUT 10 MINUTES</p>
      <h1 id="start-heading">Your team’s own OpenSport, set up in a few clicks.</h1>
      <p className="os-start-lead">No Terminal and nothing to install. You’ll create two free accounts along the way, and Vercel builds the rest. Keep this page open: it shows every screen you’ll see.</p>
      <ul className="os-start-accounts" aria-label="The three free services your team uses">
        {accounts.map(([name, role]) => <li key={name}><strong>{name}</strong><span>{role}</span><em>Free</em></li>)}
      </ul>
      <div className="os-start-actions"><a className="os-button os-button-primary" href={DEPLOY_URL} target="_blank" rel="noreferrer">Start my team <Arrow /></a><span>Opens Vercel in a new tab. Best on a computer; your teammates can use their phones afterward.</span></div>
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
      <details><summary>Supabase’s Free plan is greyed out</summary><p>Supabase allows each person two active free projects. If you already have two, pause or delete one you no longer need at <a href="https://supabase.com/dashboard/projects" target="_blank" rel="noreferrer">supabase.com/dashboard</a>, then click <strong>Add</strong> next to Supabase again.</p></details>
      <details><summary>The deploy failed</summary><p>A brand-new database can take a few minutes to start. On Vercel, open your project, then <strong>Deployments</strong>, and choose <strong>Redeploy</strong> on the latest one.</p></details>
      <details><summary>I closed the tab before it finished</summary><p>Go to <a href="https://vercel.com/dashboard" target="_blank" rel="noreferrer">vercel.com/dashboard</a>, open your project, and click <strong>Visit</strong>. That’s your team’s site.</p></details>
      <details><summary>Is it really free?</summary><p>Yes for a typical team: GitHub, Vercel’s Hobby plan, and Supabase’s Free plan all cost $0. Vercel’s Hobby plan is for personal, non-commercial use, so a club that charges fees should use Vercel Pro.</p></details>
      <details><summary>I’d rather run it on my own server</summary><p>Follow the <a href={SETUP_URL}>self-hosting guide</a>, or read the full <a href={CLOUD_GUIDE_URL} target="_blank" rel="noreferrer">cloud guide</a> for more detail.</p></details>
    </section>
  )
}

function Step({ number, title, screen, children }) {
  return <li className="os-start-step"><div className="os-start-step-copy"><span className="os-start-number">{number}</span><h3>{title}</h3>{children}</div><div className="os-start-screen-wrap" aria-hidden="true">{screen}</div></li>
}

// Simplified drawings of the screens on Vercel, labelled exactly as they appear.
function Screen({ site, title, children }) {
  return <div className="os-screen"><div className="os-screen-bar"><i /><i /><i /><span>{site}</span></div><div className="os-screen-body"><p className="os-screen-title">{title}</p>{children}</div></div>
}
function Pick({ label, children }) {
  return <div className="os-screen-pick"><b>{label}</b>{children}</div>
}
function SignInScreen() {
  return <Screen site="vercel.com/new/clone" title="New Project"><span className="os-screen-card"><strong>OpenSport</strong>The free, open-source alternative to TeamSnap.</span><p className="os-screen-caption">Sign in to clone and deploy.</p><Pick label="Click"><span className="os-screen-button">Continue with GitHub</span></Pick><span className="os-screen-button os-screen-faded">Continue with GitLab</span><span className="os-screen-button os-screen-faded">Continue with Bitbucket</span></Screen>
}
function GitHubScreen() {
  return <Screen site="github.com/login" title="Sign in to GitHub"><p className="os-screen-caption">to continue to Vercel</p><span className="os-screen-field os-screen-faded"><small>Username or email address</small>&nbsp;</span><span className="os-screen-field os-screen-faded"><small>Password</small>&nbsp;</span><span className="os-screen-button os-screen-github os-screen-faded">Sign in</span><Pick label="New? Click"><span className="os-screen-link">New to GitHub? <u>Create an account</u></span></Pick></Screen>
}
function RepositoryScreen() {
  return <Screen site="vercel.com/new/clone" title="New Project"><div className="os-screen-fields"><span className="os-screen-field"><small>Git Scope</small>your-github ▾</span><Pick label="Type"><span className="os-screen-field os-screen-typing"><small>Private Repository Name</small>riverside-fc</span></Pick></div><span className="os-screen-field"><small>Vercel Team</small>Your projects · Hobby ▾</span><span className="os-screen-button os-screen-dark os-screen-wide">Create</span></Screen>
}
function DatabaseScreen() {
  return <Screen site="vercel.com/new/clone" title="Add Products"><div className="os-screen-row"><span><strong>Supabase</strong>Postgres backend</span><span className="os-screen-button os-screen-dark">Add</span></div><Pick label="Choose"><span className="os-screen-option os-screen-selected"><strong>Supabase Free Plan</strong>$0/month</span></Pick><span className="os-screen-option os-screen-faded"><strong>Supabase Pro Plan</strong>Starting at $25/month</span></Screen>
}
function SetupCodeScreen() {
  return <Screen site="vercel.com/new/clone" title="Add Environment Variables"><div className="os-screen-fields"><span className="os-screen-field"><small>Name</small>OPENSPORT_SETUP_CODE</span><Pick label="Type"><span className="os-screen-field os-screen-typing"><small>Value</small>riverside spring 2027</span></Pick></div><span className="os-screen-button os-screen-dark os-screen-wide">Deploy</span></Screen>
}
function BuildScreen() {
  return <Screen site="vercel.com/new/clone" title="Deploying"><div className="os-screen-progress"><span /></div><p className="os-screen-caption">Building your team’s site and database…</p><p className="os-screen-done">Then you’re back on OpenSport ↩</p></Screen>
}
function Arrow() {
  return <svg className="os-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M5 19 19 5M5 5h14v14" /></svg>
}
