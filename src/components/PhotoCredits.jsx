import { athletes, photoCreditsUrl } from '../lib/athletes'

// The landing-page athlete photos are Creative Commons licensed and must stay credited.
export default function PhotoCredits() {
  return <main className="min-h-screen bg-[#f7f6ef] px-5 py-10 text-[#163d31]">
    <div className="mx-auto max-w-3xl">
      <a href="/" className="text-sm font-semibold underline underline-offset-4">← OpenSport</a>
      <h1 className="mt-12 text-4xl font-bold tracking-tight sm:text-5xl">Photo credits</h1>
      <p className="mt-5 max-w-2xl leading-7 text-slate-600">Athletes are shown as sporting inspirations. No affiliation or endorsement is implied. Each photograph keeps its own Creative Commons license, separate from OpenSport’s MIT-licensed code. Backgrounds were removed for the landing page; the <a className="underline underline-offset-2" href={photoCreditsUrl}>full asset record</a> lists every modification and height reference.</p>
      <ul className="mt-10 divide-y divide-emerald-900/15 border-y border-emerald-900/15">{athletes.map(athlete => <li key={athlete.id} className="py-5"><p className="font-bold">{athlete.name}</p><p className="mt-1 text-sm leading-6 text-slate-600">Photo by {athlete.photographer}. <a className="underline underline-offset-2" href={athlete.sourceUrl} target="_blank" rel="noreferrer">Original photograph</a> · <a className="underline underline-offset-2" href={athlete.licenseUrl} target="_blank" rel="noreferrer">{athlete.license}</a></p></li>)}</ul>
    </div>
  </main>
}
