# Speech Surveys

Mobile-first feedback forms, one QR code per survey, and a results dashboard. Participants can give a name or stay anonymous.

```bash
npm install
ADMIN_KEY=your-secret BASE_URL=https://survey.yoursite.com node server.js
```

| URL | What |
| --- | --- |
| `/s/<slug>` | A survey (e.g. `/s/speech`) |
| `/admin?key=…` | All surveys: QR codes, counts, links |
| `/admin/s/<slug>?key=…` | Results for one survey |
| `/admin/s/<slug>/export.csv?key=…` | CSV download |
| `/qr/<slug>.svg` | Printable QR code |

## Add a new survey

```bash
node new-survey.js march-speech "March Speech"   # copies surveys/speech.json
# edit surveys/march-speech.json, then restart the server
```

Question types: `text`, `choice` (optional `followUp` shown for chosen options), `rating` (1-5).
Each survey keeps its own responses in `data/<slug>.jsonl` (set `DATA_DIR` to a persistent folder when deploying).
Anonymous submissions never store a name. Avoid changing a survey's question ids after responses exist.
