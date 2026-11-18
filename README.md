# Speech Surveys

Mobile-first feedback forms, one QR code per survey, an in-browser question editor and a results dashboard.
Participants can give a name or stay anonymous.

```bash
npm install
ADMIN_KEY=your-long-secret BASE_URL=https://survey.yoursite.com DATA_DIR=/var/lib/survey node server.js
```

The server refuses to start in production (when `BASE_URL` is set) if `ADMIN_KEY` is `changeme` or shorter than 6 characters.

## Admin (log in with your admin key at `/admin`)

- Create a survey (blank, or a copy of an existing one) and edit its title, intro, thank-you message and questions.
- Question types: typed answer, choose-one (with an optional follow-up question for chosen answers), rating 1-5.
- Colours: pick a preset (Toastmasters, Ocean, Forest, Plum, Midnight) or set the page background, cards, text, buttons and title colours individually, with a live preview and readability warnings. Each survey keeps its own colours.
- Results can be viewed **by submission** or **by question** (tallies for choice/rating questions, all typed answers grouped under each question). The switch remembers your last choice.
- Results, CSV download and printable QR code for each survey.
- Deleting a survey archives it (and its responses) in `DATA_DIR/deleted/`.
- Editing keeps existing answers. Deleted questions stay in the results and CSV marked "(removed)".
- Wrong-key attempts are limited to 10 per 15 minutes per address.

## Public URLs

| URL | What |
| --- | --- |
| `/s/<slug>` | A survey (e.g. `/s/speech`) |
| `/qr/<slug>.svg` | Printable QR code |

## Data

Everything lives in `DATA_DIR` (default `./data`): `surveys/*.json` (questions), `<slug>.jsonl` (responses), `deleted/`.
The first run seeds `surveys/` from `seed-surveys/`. Back up the whole `DATA_DIR` folder.
Updating the code (`git pull`) never touches your surveys or responses.
