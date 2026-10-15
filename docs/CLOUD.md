# Deploy your team to the cloud

The quickest way to run OpenSport. The Deploy button copies OpenSport into your
own GitHub account and runs it on your own free Vercel and Supabase accounts.
There's no Terminal, no server to rent, and nobody else holds your team's data.
One deployment runs one private team. For a guided walkthrough with pictures of
every screen, open [Start your team](https://getopensport.vercel.app/#/start).

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FTheRealPress1%2Fopensport&project-name=opensport-team&repository-name=opensport-team&env=OPENSPORT_SETUP_CODE&envDescription=Choose%20a%20private%20setup%20code%20of%20at%20least%2012%20characters%2C%20like%20a%20short%20phrase.%20You%27ll%20enter%20it%20once%20to%20create%20your%20team%2C%20and%20again%20only%20to%20recover%20the%20owner%20account.&envLink=https%3A%2F%2Fgithub.com%2FTheRealPress1%2Fopensport%2Fblob%2Fmain%2Fdocs%2FCLOUD.md%23your-setup-code&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22supabase%22%2C%22productSlug%22%3A%22supabase%22%7D%5D&demo-title=OpenSport&demo-description=The%20free%2C%20open-source%20alternative%20to%20TeamSnap.&demo-url=https%3A%2F%2Fgetopensport.vercel.app&redirect-url=https%3A%2F%2Fgetopensport.vercel.app%2F)

## What it costs

Nothing for a typical team. Both services have free plans with room to spare:

- **Vercel Hobby** hosts the app. It's meant for personal, non-commercial use; a
  club that charges fees should use Vercel Pro.
- **Supabase Free** stores your team's accounts, schedule, and photos. The free
  plan includes two active projects, so one account can run two teams.

Check [Vercel's pricing](https://vercel.com/pricing) and
[Supabase's pricing](https://supabase.com/pricing) for current limits.

## Set it up

All you need is an email address. It takes about ten minutes.

1. **Click Deploy, then Continue with GitHub.** That also creates your free
   Vercel account. No GitHub account? On GitHub's sign-in page, choose **Create
   an account**, verify your email, and GitHub sends you back to Vercel.
2. **Create the repository.** Vercel copies OpenSport into your GitHub account.
   Name it after your team, for example `riverside-fc`. Your team's address
   becomes something like `riverside-fc.vercel.app`. If Vercel asks for a plan
   or a team, choose **Hobby**, the free one.
3. **Add Supabase.** Create a new database on the **Free** plan, in the region
   closest to your team. Vercel connects it to your project for you.
4. **Choose your setup code.** See [Your setup code](#your-setup-code).
5. **Deploy.** The first build also prepares your team's database. When it
   finishes, Vercel brings you back to OpenSport with a link to your new site.
6. **Create your team.** Enter your setup code, your team's name, sport, and
   timezone, and your own name, email, and password. You become the team's
   administrator and are signed in.
7. **Invite your teammates** from **Manage**. Each invitation is a private
   link you send yourself, by text or email. It works for one hour.

## Optional: turn off public sign-ups

New Supabase projects let anyone create an account. Those accounts can't see
anything in your team, and if one uses an address you later invite, OpenSport
replaces it with a fresh account for your teammate. You don't need to change
anything, but if you'd like to switch sign-ups off:

In Vercel, open your project's **Storage** tab, select your Supabase database,
and choose **Open in Supabase**. Go to **Authentication**, then **Sign In /
Providers**, and turn off **Allow new users to sign up**. Invitations keep
working.

## Your setup code

The setup code protects your team before it has an administrator, and it's how
the owner gets back in. Pick at least 12 characters; a short phrase is easiest
to remember. Keep it private, like a password.

- **Creating the team:** the first screen asks for it, so nobody who finds your
  address can claim the team before you do. Once the team exists, this screen
  is gone.
- **Recovering the owner account:** recovery is off until you prove you control
  the Vercel project. Under your project's **Settings → Environment Variables**,
  set `OPENSPORT_ALLOW_OWNER_RECOVERY` to `1` and redeploy. On the sign-in
  screen, choose **Forgot password?**, then enter the owner's email and the
  setup code. OpenSport restores administrator access and opens a page to choose
  a new password. Remove the variable and redeploy once you're back in.

Each visitor can try ten codes an hour, and all visitors together fifty. To
change the code, edit `OPENSPORT_SETUP_CODE` under your Vercel project's
**Settings → Environment Variables**, then redeploy.

## Everyday use

- **Teammates who forget their password:** an administrator creates a recovery
  link from **Manage → Members**. A second administrator or coach can do the
  same for the owner, which is simpler than owner recovery.
- **Your own address:** add a domain under your Vercel project's **Settings →
  Domains**. Invitation links switch to it automatically.
- **Off-season:** Supabase pauses free projects after about a week without
  activity and emails you first. Resume it from the Supabase dashboard; your
  data stays intact for 90 days.
- **Backups:** free Supabase projects don't include automatic backups.
  Supabase's [backup guide](https://supabase.com/docs/guides/platform/backups)
  shows how to export your own copy.

## Updates

Your copy of OpenSport doesn't change unless you change it. Vercel creates it
as a fresh repository, so the first update has to join the two histories. If you
haven't edited the code yourself, these commands bring your copy up to date:

```sh
git clone https://github.com/<you>/<your-team-repo>.git
cd <your-team-repo>
git pull --no-rebase --allow-unrelated-histories -X theirs https://github.com/TheRealPress1/opensport.git main
git push
```

`-X theirs` keeps OpenSport's version wherever the two copies differ. Vercel
deploys the update and applies any database changes during the build.

## Troubleshooting

- **Supabase's Free plan is greyed out.** Supabase allows each person two active
  free projects. Pause or delete one you don't need in the Supabase dashboard,
  or sign up with a different email. You don't need a paid plan.
- **The build failed with "Database migration failed".** A brand-new database
  can take a few minutes to start. Wait a minute, then open **Deployments** in
  Vercel and choose **Redeploy** on the latest one.
- **"Almost ready"** means your database hasn't been prepared yet. Redeploy the
  project, then choose **Check again**.
- **"Add your setup code"** means `OPENSPORT_SETUP_CODE` is missing or shorter
  than 12 characters. Fix it in your Vercel project's environment variables and
  redeploy.
- **"Connect your team's database"** means the project has no Supabase database.
  Connect one from your Vercel project's **Storage** tab, then redeploy.

Preview deployments, built from branches other than your production branch,
skip database changes. They still use your team's real database, so treat them
as live.
