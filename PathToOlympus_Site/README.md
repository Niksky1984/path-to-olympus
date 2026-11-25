# Path to Olympus — web app (v3)

*"The road is mastered by the one who walks it."*

| Page | Who | What |
|---|---|---|
| `index.html` | David | Agora (home) · Trial (squares for today's exercises, close the day) · Chronicle (calendar + charts) · Hall of Glory · Codex (guide) · avatar photo (tap the top-right corner) |
| `admin.html` | You | Overview · Plans · Targets · Scoring (points formula) · Media (all your images/GIFs/videos) · Guide (Codex text) · Settings |

## 1. Try it now: demo mode
1. Unzip and double-click **`admin.html`**. Sign in with any e-mail and password and choose a PIN.
   Go to **Plans → New weekly plan**, add exercises to Monday, tap **Copy Monday to every day**, then **Save plan**.
2. Double-click **`index.html`**. **Trial** shows one square per exercise in today's plan. Tap a square, enter
   the level, reps per set, sets and minutes, then tap **OK**. You can change it until the day is closed. **＋ Other** adds
   an exercise that isn't in the plan. **Close the day** shows a summary to confirm first.
3. The blue **DEMO** bar has three buttons:
   - **+1 day** moves to the next day. Skip a day to see the *Day Lost* screen.
   - **Real today** goes back to the real date.
   - **Wipe** clears all demo data.

To test your images in demo mode, put them into the `media` folder (see section 5).

## 2. How a day works
- The plan says what to do. David logs what he **really** did: more, less or something else. He can close
  the day at any time, as long as at least one exercise is logged.
- **Day % = points earned ÷ planned points.**
  - **≥ 100% → Completed** (gold circle and the *Day Passed* video)
  - **below 100% → Incomplete** (half circle; the streak continues)
- A planned day that isn't closed by midnight is **Skipped**: −50 points and the streak resets to 0.
  Days without a plan are never penalised.

## 3. The points formula (Admin → Scoring)
```
Exercise points = Hardness × Level × (Base + reps × sets × Unit value + minutes × Per-minute)
Day points      = sum of all exercises
```
Defaults (all editable):

| | Hardness | Unit value |
|---|---|---|
| Pull-ups | 2.6 | 1 per rep |
| Push-ups | 1.8 | 1 per rep |
| Plank | 3.1 | 0.1 per second |
| Jump rope | 1.2 | 0.05 per skip |
| Dips | 2.4 | 1 per rep |
| Koshperovsky's wheel | 2.8 | 1 per rep |
| Sit-ups / crunches | 1.5 | 1 per rep |
| Swimming | 2.2 | 4 per length |

The other defaults are Level I/II/III = ×1/×2/×3, Base = 5, Per-minute = 1, skip penalty = 50, and "Completed" at 100%.

Example: Pull-ups, Level II, 8 reps × 3 sets, 5 min → 2.6 × 2 × (5 + 24 + 5) = **177 pts**.
Points are saved when a day is closed, so changing the formula only affects new days.

## 4. Targets (Admin → Targets)
Each horizon (Monthly, Half-Year, Yearly, 5-Year, 10-Year) has these targets:

- **points** ≥, **minutes** ≥, **reps** ≥, **sets** ≥, **average level** ≥
- **skipped days** ≤ %, **missed minutes** ≤ %

Next to each one you see three numbers side by side:
- **Plan**: what your plans ask for, calculated with the formula. This is the real target.
- **David**: his actual pace (the ghost).
- **So far**: progress in the current block.

Tap **Use plan** or **Use David's pace**, edit if you like, then **Lock in as official**. Only official
targets award coats of arms and play target videos. The 5- and 10-year targets follow the plan from day 1.

## 4b. The Codex (guide page)
David's **Codex** tab explains the app: welcome, how a day works, points, circles, streaks, targets and medals. It also
shows **all 8 exercises × 3 levels**, each with your image and a description. Edit every text in **Admin → Guide**;
an empty box keeps the default text. Add pictures in **Admin → Media → Codex**: `guide_header` and `guide_<section>`.
The exercise level pictures are the same `img_…` images used on the Trial page.

## 5. Your images (Admin → Media, or the `media` folder)
Every slot shows a placeholder with its file name until you fill it. Each slot can be filled in two ways:
1. Upload the file to the `media` folder of your GitHub repo with the exact slot name, e.g. `media/img_pull_ups_l1.png`.
   Images can be `.png`, `.jpg`, `.webp` or `.gif`.
2. Paste a link in **Admin → Media**. A GitHub "blob" link is fine; it is converted automatically.

The full list of names is in **`media/README.txt`**. Empty slots are simply not shown to David.

| Group | Slots | Format |
|---|---|---|
| Exercise images | `img_<exercise>_l1…l3` (24) | 1:1 |
| Exercise GIFs | `gif_<exercise>_l1…l3` (24) | 1:1 GIF, used only when that level has no image |
| Calendar circles | `circle_done`, `circle_incomplete`, `circle_skipped`, `circle_today`, `circle_planned` | 1:1 image or GIF, ~256×256 (the day number is printed on top) |
| Month backgrounds | `month_01` … `month_12`, plus `month_bg` as the default | image or GIF, ~1080×1000 |
| Codex | `guide_header`, `guide_intro`, `guide_day`, `guide_points`, `guide_circles`, `guide_streak`, `guide_targets`, `guide_hall` | any ratio, ~1080 wide |
| Navigation buttons | `nav_home`, `nav_trial`, `nav_chronicle`, `nav_hall`, `nav_codex` | 1:1, transparent PNG, 256×256; the active one is raised and glows |
| Navigation background | `nav_bg` | wide, ~1080×240 |
| Hall background | `hall_bg` | 9:16 image or GIF |
| Medals | `medal_first_step`, `medal_first_week`, … (9) | 1:1 image or GIF (shown greyed out until earned) |
| Coats of arms | `coat_month`, `coat_half_year`, `coat_year`, `coat_five_year`, `coat_ten_year` | 1:1 image or GIF |
| Videos | `video_day_passed`, `video_day_failed`, `video_target_*` | 9:16 MP4, ~10 s |

Exercise names: `pull_ups push_ups plank jump_rope dips ab_wheel abs swimming`.

David's **avatar** is any photo from his phone. He taps the circle in the top-right corner and then **Choose a picture**.
The photo is cropped square, shrunk to ~30 KB and saved.

## 6. Real version: two phones (Firebase + GitHub Pages)
1. **Firebase** (free plan) at <https://console.firebase.google.com>:
   - Create a project.
   - Go to **Authentication → Sign-in method**, enable **Anonymous** and **Email/Password**, then under **Users**, add your Admin account.
   - Go to **Firestore Database → Create database**. On the **Rules** tab, paste `firestore.rules` (with your e-mail) and **Publish**.
   - Go to **Project settings → Your apps → Web (</>)** and copy the config.
2. **`config.js`**: paste the config values and set `adminEmail`.
3. **GitHub**: create a new repo and upload everything, including the `icons` and `media` folders.
   Then **Settings → Pages → main / root**.
4. Back in **Firebase**: go to **Authentication → Settings → Authorized domains** and add `niksky1984.github.io`.
5. **Phones**: open `…/index.html` on David's phone and `…/admin.html` on yours. On each, choose **⋮ → Add to Home screen**.

After an update, re-upload the changed files. To force every phone to refresh, change `VERSION` in `sw.js`.

## 7. Files
```
index.html, admin.html   the two apps
config.js                ← your Firebase keys + admin e-mail
engine.js                rules: formula, days, streaks, targets, medals (tests: node tests/engine.test.js)
core.js                  data (Firebase or demo), media slots, drawings, charts, calendar, celebrations
style.css, sw.js, *.webmanifest, icons/
firestore.rules          paste into Firebase → Firestore → Rules
media/                   your images, GIFs and videos (names in media/README.txt)
```
