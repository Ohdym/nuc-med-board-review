# Nuclear Medicine Boards Review

Static study app plus a lightweight multiplayer server for live Jeopardy-style games.

## Features

- Dashboard and category overview
- Adaptive quiz mode
- Timed mock exam mode
- Solo Jeopardy practice board
- Live multiplayer Jeopardy with join code and usernames
- Local question-bank import via JSON or CSV

## Run locally

Install the small Python dependencies:

```bash
python3 -m pip install -r requirements.txt
```

Start the app and multiplayer server:

```bash
python3 server.py
```

Then open:

`http://127.0.0.1:4173`

To test with other devices on the same network, open the same server from your computer's local IP address instead of `127.0.0.1`.

## Testing accounts

Create a safe local roster of 50 testing accounts:

```bash
python3 scripts/create_user_roster.py --count 50 --prefix student --overwrite
```

This creates two private local files:

- `.users.json` stores hashed passwords and saved testing history for the app.
- `.user_passwords.csv` stores the generated usernames and plaintext passwords so you can hand them out.

Keep `.user_passwords.csv` private. It is ignored by Git and should not be published.

For a simpler editable roster, use `user_credentials.json` in the project folder. It accepts plain username/password entries like:

```json
{
  "users": {
    "student01": {
      "password": "password01",
      "displayName": "Student 01"
    }
  }
}
```

Save changes to that file and the server will use the new password on the next login attempt. User quiz/mock history still saves in `.users.json` under the same username. `user_credentials.json` is ignored by Git so the password list is not accidentally published.

## Temporary public tunnel

A bundled `cloudflared` client is available in `.bin/` for quick public testing:

```bash
./.bin/cloudflared tunnel --url http://127.0.0.1:4173 --no-autoupdate
```

That creates a temporary public `trycloudflare.com` URL that multiple devices can use for the live Jeopardy mode.

## Permanent Render deployment

This repo is set up for Render with `render.yaml`.

### 1. Push this project to GitHub

From the project folder:

```bash
git init
git add .
git commit -m "Prepare Nuclear Medicine Boards Review for deployment"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

If the repo already exists, just commit and push your current branch.

### 2. Deploy on Render

1. Sign in at `https://render.com`
2. Click `New +`
3. Choose `Blueprint`
4. Select your GitHub repo
5. Render will detect `render.yaml`
6. Click `Apply`

Render will build the app with:

```bash
pip install -r requirements.txt
```

and start it with:

```bash
python server.py
```

After deploy, you will get a permanent public URL like:

`https://nuclear-medicine-boards-review.onrender.com`

### 3. Optional custom domain

In Render, open your web service and add a custom domain if you want your own branded URL.

### 4. Important note about shared stats

Live game state works fine on Render, but the shared question-difficulty history file is local storage on the server.

- On Render free instances, that file may reset on restart or redeploy.
- If you want shared difficulty stats to persist long term, create a persistent disk and set an environment variable:

```bash
ATTEMPTS_PATH=/var/data/.shared_attempts.json
USER_STORE_PATH=/var/data/.users.json
USER_CREDENTIALS_PATH=/var/data/user_credentials.json
```

If you want, I can also set up the Git repo and make the first deployment commit for you.
