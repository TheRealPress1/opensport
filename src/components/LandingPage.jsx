import { useEffect, useRef, useState } from 'react'
import { DOWNLOAD_URL, RELEASE_VERSION, REPOSITORY_URL, SETUP_URL } from '../lib/project'
import { athletes, photoCreditsUrl } from '../lib/athletes'
import licenseUrl from '../../LICENSE?url&no-inline'
import contributionUrl from '../../CONTRIBUTING.md?url&no-inline'
import './LandingPage.css'

// Personal photos for the story slideshow, cropped to 3:2. Not covered by the MIT license.
const storyPhotos = [
  { src: '/images/story/ghsa-champions.webp', width: 840, height: 560, alt: 'Me holding the Georgia High School Association boys soccer trophy, wearing a 2022 champions shirt.' },
  { src: '/images/story/buckhead-youth.webp', width: 615, height: 410, alt: 'A youth team in blue Buckhead jerseys posing with their coach.' },
  { src: '/images/story/white-kit.webp', width: 1086, height: 724, alt: 'Two players in white kits high-fiving during a game.' },
  { src: '/images/story/blue-kit.webp', width: 1078, height: 719, alt: 'Two players in blue jerseys celebrating on a floodlit field at night.' },
  { src: '/images/story/babson-team.webp', width: 1024, height: 683, alt: 'Babson soccer teammates on a turf field, one holding up a number 17 jersey.' },
]

const tickerItems = ['Free', 'Open source', 'No ads', 'No subscription', 'Your data, your host', 'Built by a player']

// TeamSnap claims are sourced in the comparison note; re-check them before each release.
const comparison = [
  ['Price', 'Free to start. Paid upgrades unlock availability tracking and bigger rosters.', 'Free, RSVPs included. Hosting costs depend on your setup.'],
  ['Ads', 'Banner and full-screen ads in the mobile app unless you pay to remove them.', 'None.'],
  ['Source code', 'Closed.', 'Open source under the MIT license.'],
  ['Your team’s data', 'Hosted by TeamSnap.', 'On a computer or server you control.'],
  ['Make it your own', 'Use the settings TeamSnap provides.', 'Change anything in the code.'],
  ['Phone apps, payments, registration', 'Yes.', 'Not yet. OpenSport runs in any browser.'],
]

export default function LandingPage() {
  return (
    <div className="project-site">
      <a className="os-skip" href="#main">Skip to content</a>
      <header className="os-nav os-container">
        <a className="os-wordmark" href="#" aria-label="OpenSport home"><SportMark />OpenSport<span className="os-wordmark-period">.</span></a>
        <nav aria-label="Main navigation">
          <a className="os-nav-secondary" href="#compare">vs. TeamSnap</a>
          <a className="os-nav-secondary" href="#story">My story</a>
          <a href={SETUP_URL}>Setup guide</a>
          <a className="os-github" href={REPOSITORY_URL} target="_blank" rel="noreferrer" aria-label="View OpenSport on GitHub"><GitHubIcon /><span>GitHub</span><Arrow /></a>
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        <section className="os-hero os-container" aria-labelledby="hero-heading">
          <h1 id="hero-heading">Behind every great athlete{' '}<br /><span>is a team.</span></h1>
          <p className="os-hero-alternative">The free, open-source alternative to <strong>TeamSnap</strong>.</p>
          <p className="os-hero-description">Schedules, rosters, and RSVPs in one place. No ads, no subscription,<br className="os-desktop-break" /> and your team’s data stays on a host you control.</p>
          <div className="os-hero-actions">
            <a className="os-button os-button-primary" href="/#/demo">Try the demo <Arrow /></a>
            <a className="os-button os-button-secondary" href={DOWNLOAD_URL} download>Download <DownloadIcon /></a>
          </div>
          <figure className="os-athlete-poster" aria-label="Athletes from soccer, basketball, baseball, and American football, arranged from shortest to tallest">
            <div className="os-height-lines" aria-hidden="true">{[0, 1, 2, 3, 4].map(line => <span key={line} />)}</div>
            <div className="os-poster-word" aria-hidden="true">ALL TOGETHER.</div>
            <div className="os-athlete-lineup">
              {athletes.map(athlete => <AthletePortrait key={athlete.id} athlete={athlete} />)}
            </div>
            <figcaption className="os-poster-caption"><span>DIFFERENT GAMES. SAME TEAM SPIRIT.</span><span>YOUR TEAM BELONGS HERE. <Arrow /></span></figcaption>
          </figure>
        </section>
        <div className="os-principles" aria-label="Project principles"><span>ANY SPORT.</span><i aria-hidden="true">✳</i><span>YOUR TEAM.</span><i aria-hidden="true">✳</i><span>YOUR DATA.</span><i aria-hidden="true">✳</i><span>OPEN TO EVERYONE.</span></div>
        <section className="os-product os-container" id="features" aria-labelledby="product-heading">
          <div className="os-section-heading"><div><p className="os-eyebrow">01 / THE EVERYDAY ESSENTIALS</p><h2 id="product-heading">Less chasing.<br />More playing.</h2></div><div className="os-section-aside"><p>The group chat can only do so much. Give your team one place to find the plan, say they’re in, and get ready for game day.</p><a className="os-text-link" href="/#/demo">Meet your demo team <Arrow /></a></div></div>
          <figure className="os-product-preview">
            <div className="os-browser-bar" aria-hidden="true"><span className="os-browser-dots"><i /><i /><i /></span><span>YOUR TEAM’S HOME</span><span>OPENSPORT ↗</span></div>
            <ProductVideo />
            <figcaption><span><span className="os-demo-dot" /> FICTIONAL TEAM. REAL OPENSPORT.</span><span>No account needed. Changes reset on refresh.</span></figcaption>
          </figure>
          <div className="os-features">
            <Feature number="01" title="A plan everyone can find." description="Matches, practices, locations, and calendar exports. Your whole week, in one place." detail="SCHEDULE + CALENDAR" />
            <Feature number="02" title="Know who’s showing up." description="A shared roster and simple going, maybe, or can’t-make-it RSVPs. Fewer loose ends before game day." detail="ROSTER + RSVPs" />
            <Feature number="03" title="Keep the season’s story." description="Record final scores for any sport. Soccer teams can also publish lineups and track goals and assists." detail="RESULTS + SOCCER TOOLS" />
          </div>
        </section>
        <Ticker />
        <section className="os-compare" id="compare" aria-labelledby="compare-heading"><div className="os-container">
          <div className="os-section-heading"><div><p className="os-eyebrow">02 / OPENSPORT VS. TEAMSNAP</p><h2 id="compare-heading">TeamSnap is huge.<br /><span>OpenSport is yours.</span></h2></div><p className="os-section-aside">TeamSnap is a big business, with 30 million users by its own count. OpenSport keeps the everyday essentials and makes them free, open source, and yours to run.</p></div>
          {/* Explicit roles keep table semantics when small screens restyle the rows as grids. */}
          <table className="os-compare-table" role="table">
            <caption className="sr-only">How OpenSport compares with TeamSnap</caption>
            <thead role="rowgroup"><tr role="row"><td role="cell" /><th scope="col" role="columnheader">TeamSnap<span>30 million users. 19,000 organizations.</span></th><th scope="col" role="columnheader" className="os-compare-us">OpenSport<span>Started by one college captain. Open to every team.</span></th></tr></thead>
            <tbody role="rowgroup">{comparison.map(([topic, teamSnap, openSport]) => <tr key={topic} role="row"><th scope="row" role="rowheader">{topic}</th><td role="cell">{teamSnap}</td><td role="cell" className="os-compare-us">{openSport}</td></tr>)}</tbody>
          </table>
          <p className="os-compare-note">TeamSnap details come from its <a href="https://www.teamsnap.com/pricing" target="_blank" rel="noreferrer">pricing page</a> and <a href="https://helpme.teamsnap.com/article/227-managing-your-teamsnap-plus-subscription" target="_blank" rel="noreferrer">help center</a>, checked October 2026. TeamSnap is a trademark of its owner. OpenSport is independent and not affiliated with or endorsed by TeamSnap.</p>
          </div>
        </section>
        <section className="os-story" id="story" aria-labelledby="story-heading">
          <div className="os-container os-story-layout">
            <div className="os-story-heading"><p className="os-eyebrow">03 / FROM PLAYER TO BUILDER</p><h2 id="story-heading">A lifelong game.<br />A simple idea.</h2><StorySlideshow /></div>
            <div className="os-story-copy"><p className="os-story-lead">I’ve played soccer since I was three. Every team I was on used TeamSnap to organize and let family and friends follow along.</p><p>When I became captain of my college soccer team, I realized how critical team organization was—and how expensive it could be to use TeamSnap for a whole team.</p><p>So I built OpenSport, an independent, open-source alternative to TeamSnap. A way for sports teams to organize themselves, keep things simple, and make more room for the joy of playing.</p><img className="os-story-signature" src="/images/story/signature.png" width="475" height="93" alt="Gaspard Seuge" loading="lazy" decoding="async" /></div>
          </div>
        </section>
        <section className="os-hosting os-container" id="hosting" aria-labelledby="hosting-heading">
          <div className="os-section-heading"><div><p className="os-eyebrow">04 / MAKE IT YOUR OWN</p><h2 id="hosting-heading">Your team.<br />Your home court.</h2></div><p className="os-section-aside">One installation. One private team.<br />OpenSport is free to adapt and run on a host you control. Here’s where the project stands today.</p></div>
          <div className="os-hosting-options">
            <article className="os-hosting-mac"><div className="os-hosting-top"><ComputerIcon /><span className="os-status-label">LOCAL ALPHA</span></div><h3>A team home on your Mac.</h3><p>We’re building a Mac app that guides you through hosting your team, without Docker or Terminal.</p><div className="os-preview-note"><strong>The Mac preview works on the host Mac only.</strong><p>Internet sharing is still in development, so teammates can’t connect remotely yet. Public Mac downloads are not available.</p></div><span className="os-platform-note">Apple silicon · macOS 14 or later</span></article>
            <article className="os-hosting-server"><div className="os-hosting-top"><CodeIcon /><span className="os-status-label">ADVANCED SETUP</span></div><h3>Bring your own server.</h3><p>Developers can download the source and use the Docker setup guide. Remote access needs an always-on host, a domain, and HTTPS.</p><a className="os-text-link" href={SETUP_URL}>Read the server setup guide <Arrow /></a><p className="os-server-note">No OpenSport subscription or Supabase cloud account required. Hosting and domain costs depend on your setup.</p></article>
          </div>
        </section>
        <section className="os-contribute os-container" aria-labelledby="contribute-heading"><div><p className="os-eyebrow">GOOD THINGS ARE BUILT TOGETHER.</p><h2 id="contribute-heading">The next move is ours.</h2><p>Try it. Break it. Make it better.<br />There’s room for you on this team.</p></div><a className="os-button os-button-primary" href={REPOSITORY_URL} target="_blank" rel="noreferrer"><GitHubIcon /> Explore on GitHub <Arrow /></a><span className="os-contribute-star" aria-hidden="true">✳</span></section>
      </main>
      <footer className="os-footer os-container">
        <div className="os-footer-main"><a className="os-wordmark" href="#" aria-label="OpenSport home"><SportMark />OpenSport<span className="os-wordmark-period">.</span></a><p>For the love of the game.<br /><span>Independent project. Not affiliated with or endorsed by TeamSnap.</span></p><div className="os-footer-links"><a href={contributionUrl}>Contribution guide</a><a href={licenseUrl}>MIT code license</a><a href={SETUP_URL}>Setup guide</a><a href={DOWNLOAD_URL} download>Source · v{RELEASE_VERSION}</a></div></div>
        <details className="os-photo-credits"><summary>Photo credits <span aria-hidden="true">+</span></summary><p>Athletes are shown as sporting inspirations. No affiliation or endorsement is implied. Photography retains its own licenses, separate from the MIT-licensed code.</p><ul>{athletes.map(athlete => <li key={athlete.id}><strong>{athlete.name}</strong><span>Photo by {athlete.photographer}. <a href={athlete.sourceUrl} target="_blank" rel="noreferrer">Original photograph</a> · <a href={athlete.licenseUrl} target="_blank" rel="noreferrer">{athlete.license}</a>. Background removed for this collage; see <a href={photoCreditsUrl}>asset credits</a> for modifications and height references.</span></li>)}</ul></details>
      </footer>
    </div>
  )
}
function AthletePortrait({ athlete }) {
  const [failed, setFailed] = useState(false)
  const scale = athlete.heightCm / 206 * (athlete.poseScale || 1)
  const widthScale = scale * athlete.width / athlete.height
  // Match the poster's responsive height so small screens fetch smaller cutouts.
  const sizes = `(max-width: 650px) ${37 * widthScale}vw, (max-width: 1050px) ${31 * widthScale}vw, (max-width: 1403px) ${29 * widthScale}vw, ${407 * widthScale}px`
  return <img data-athlete={athlete.id} className={`os-athlete os-athlete-${athlete.id}`} src={athlete.image} srcSet={`${athlete.smallImage} ${athlete.smallWidth}w, ${athlete.image} ${athlete.width}w`} sizes={sizes} width={athlete.width} height={athlete.height} alt={athlete.name} style={{ '--athlete-scale': scale, visibility: failed ? 'hidden' : undefined }} decoding="async" fetchPriority={athlete.id === 'lebron' ? 'high' : 'auto'} onError={() => setFailed(true)} />
}
// Two identical halves scroll by exactly half the track, so the loop has no seam.
function Ticker() {
  return <div className="os-ticker" aria-hidden="true"><div className="os-ticker-track">{[...tickerItems, ...tickerItems].map((item, index) => <span key={index}>{item}<i>✳</i></span>)}</div></div>
}
function ProductVideo() {
  const video = useRef(null)
  const pausedByVisitor = useRef(false)
  const [playing, setPlaying] = useState(false)
  // Play only while visible, and never automatically for visitors who prefer reduced motion.
  useEffect(() => {
    const element = video.current
    if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) element.pause()
      else if (!pausedByVisitor.current) element.play().catch(() => {})
    }, { threshold: 0.4 })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const toggle = () => {
    const element = video.current
    pausedByVisitor.current = !element.paused
    if (element.paused) element.play().catch(() => {}); else element.pause()
  }
  return (
    <div className="os-product-video">
      <video ref={video} poster="/images/demo-walkthrough-poster.jpg" muted loop playsInline preload="none" aria-label="A 25-second walkthrough of the OpenSport demo: one-tap RSVPs, who’s coming, lineups, the roster, results, and the calendar." onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}>
        <source src="/videos/opensport-demo.webm" type="video/webm" />
        <source src="/videos/opensport-demo.mp4" type="video/mp4" />
        <img src="/images/demo-workspace.png" width="1280" height="940" alt="The OpenSport demo showing Union Sports Club’s schedule, upcoming matches, and RSVP buttons." />
      </video>
      <button type="button" className="os-video-toggle" aria-label={playing ? 'Pause the walkthrough video' : 'Play the walkthrough video'} onClick={toggle}>{playing ? <PauseIcon /> : <PlayIcon />}</button>
    </div>
  )
}
function PlayIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5Z" /></svg>
}
function PauseIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 4h4.5v16H6zm7.5 0H18v16h-4.5z" /></svg>
}
function StorySlideshow() {
  const [index, setIndex] = useState(0)
  const swipeStart = useRef(null)
  const count = storyPhotos.length
  const show = next => setIndex((next + count) % count)
  const label = number => String(number).padStart(2, '0')
  return (
    <section className="os-slideshow" aria-roledescription="carousel" aria-label="Photos from my years playing soccer" onKeyDown={event => { if (event.key === 'ArrowLeft') show(index - 1); if (event.key === 'ArrowRight') show(index + 1) }}>
      <div className="os-slideshow-viewport" aria-live="polite" onPointerDown={event => { swipeStart.current = event.clientX }} onPointerUp={event => { const distance = event.clientX - (swipeStart.current ?? event.clientX); swipeStart.current = null; if (Math.abs(distance) > 40) show(index + (distance < 0 ? 1 : -1)) }}>
        {storyPhotos.map((photo, slide) => <div key={photo.src} className="os-slide" role="group" aria-roledescription="slide" aria-label={`${slide + 1} of ${count}`} aria-hidden={slide !== index} data-active={slide === index || undefined}><img src={photo.src} width={photo.width} height={photo.height} alt={photo.alt} loading="lazy" decoding="async" draggable="false" /></div>)}
      </div>
      <div className="os-slideshow-controls">
        <span className="os-slideshow-count">{label(index + 1)} / {label(count)}</span>
        <div><button type="button" aria-label="Previous photo" onClick={() => show(index - 1)}><Chevron direction="left" /></button><button type="button" aria-label="Next photo" onClick={() => show(index + 1)}><Chevron direction="right" /></button></div>
      </div>
    </section>
  )
}
function Chevron({ direction }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d={direction === 'left' ? 'm15 5-7 7 7 7' : 'm9 5 7 7-7 7'} /></svg>
}
function Feature({ number, title, description, detail }) {
  return <article className="os-feature"><span className="os-feature-number">{number}</span><p className="os-eyebrow">{detail}</p><h3>{title}</h3><p>{description}</p></article>
}
// OpenSport ball: a soccer half (pentagon and hexagon seams) and a basketball half joined by a stitched baseball seam.
function SportMark() {
  return <svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29" fill="#1f7a45" /><path d="M18 21.2L18 12.03M25.42 26.59L34.14 23.76M22.58 35.31L27.97 42.73M13.42 35.31L8.03 42.73M10.58 26.59L4.38 24.57M34.14 23.76L18.96 12.08M18.96 12.08L27.34 8.35M27.34 8.35L18 12.03M27.97 42.73L34.39 24.68M34.39 24.68L40.52 31.5M40.52 31.5L34.14 23.76M8.03 42.73L27.17 43.25M27.17 43.25L22.58 51.19M22.58 51.19L27.97 42.73M3.52 29.38L7.28 42.12M7.28 42.12L5.08 41.66M5.21 42L8.03 42.73M18 12.03L5.89 20.34" fill="none" stroke="#f7f5ed" strokeWidth="2" strokeLinecap="round" /><path d="M43.8,5.51C20,18 46,44 22.08,59.25A29 29 0 0 0 43.8,5.51Z" fill="#c9562f" /><path d="M38.5 35C46 31 53 30 60.6 30.6M57.11,17.5C48.5 27 47 42 50.64,54.22" fill="none" stroke="#19392e" strokeWidth="2.6" strokeLinecap="round" /><path d="M18 21.2L25.42 26.59L22.58 35.31L13.42 35.31L10.58 26.59Z" fill="#f7f5ed" /><path d="M43.8,5.51C20,18 46,44 22.08,59.25" fill="none" stroke="#f7f5ed" strokeWidth="2.8" /><path d="M35.66 9.87L31.34 9.68M38.24 11.76L39.73 15.82M31.89 17.68L27.9 19.36M35.03 18.28L38.11 21.31M31.16 26.15L27.63 28.65M34.36 26.06L38.03 28.35M31.55 34.67L28.02 37.17M34.75 34.59L38.41 36.88M31.29 42.84L27.32 44.56M34.44 43.41L37.55 46.42M28.78 50.41L24.45 50.45M31.45 52.17L33.15 56.15" fill="none" stroke="#f7f5ed" strokeWidth="1.6" strokeLinecap="round" /><circle cx="32" cy="32" r="29" fill="none" stroke="#19392e" strokeWidth="3" /></svg>
}
function Arrow() {
  return <svg className="os-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M5 19 19 5M5 5h14v14" /></svg>
}
function DownloadIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path className="os-download-arrow" d="M12 3v12m-5-5 5 5 5-5" /><path d="M5 16v5h14v-5" /></svg>
}
function ComputerIcon() {
  return <svg width="31" height="31" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="4" y="5" width="24" height="18" rx="2" /><path d="M4 19h24M16 23v5m-6 0h12" /></svg>
}
function CodeIcon() {
  return <svg width="31" height="31" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m10 9-7 7 7 7m12-14 7 7-7 7M19 5l-6 22" /></svg>
}
function GitHubIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .7a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.55v-2.14c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.78 1.19 1.78 1.19 1.03 1.77 2.71 1.26 3.37.97.1-.75.4-1.26.74-1.55-2.57-.29-5.28-1.29-5.28-5.72 0-1.26.45-2.29 1.19-3.09-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.44-2.71 5.42-5.29 5.71.42.36.79 1.06.79 2.14v3.18c0 .31.21.67.8.55A11.5 11.5 0 0 0 12 .7Z" /></svg>
}
