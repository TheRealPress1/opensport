import credits from './athleteCredits.json'
import creditsUrl from './athleteCredits.json?url&no-inline'

// One manifest supplies the composition, visible credits, and downloadable record.
// Photo adaptations retain their own licenses, separately from the MIT code.
export const athletes = credits.athletes
export const photoCreditsUrl = creditsUrl
