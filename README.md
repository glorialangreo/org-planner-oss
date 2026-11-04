# Org planner

Plan teams, reporting lines and areas of responsibility in your browser. Keep a reference organization, explore changes in editable scenarios, and share frozen snapshots as standalone HTML or PDF.

The app runs on your computer. A fresh installation starts empty, with no imported organizations, accounts or integrations to configure. The optional example and all templates use fictional data.

[Get started](#get-started) · [Templates and examples](#templates-and-examples) · [How planning works](#how-planning-works) · [Backups and exports](#backups-and-exports) · [Privacy](#privacy-and-local-storage)

## What you can do

- View an organization by teams, reporting lines, timezones or areas of responsibility.
- Move people between teams, edit managers and designate team leaders independently.
- Add responsibilities shared by several teams, with owners and collaborators.
- Compare planning options in separate scenarios, with autosave, undo and redo.
- Keep independent workspaces and retain earlier references when importing a new roster.
- Save read-only snapshots and export them for people who do not run the app.

## Get started

You need [Node.js](https://nodejs.org/) 22.13 or newer, npm and Git.

```sh
git clone https://github.com/glorialangreo/org-planner-oss.git
cd org-planner-oss
npm ci
npm run build
npm start
```

Open **[http://127.0.0.1:4186](http://127.0.0.1:4186)**. Keep the terminal running while you use the planner. Press `Ctrl+C` to stop it; saved work remains on your computer.

The **New Workspace** page gives you three ways to begin:

| Option | Use it to |
|---|---|
| **Try an example** | Explore a fictional cooperative with several departments, shared responsibilities and distributed teams. |
| **Import your organization** | Upload a roster, areas or a planner workspace, then review before confirming. |
| **Start empty** | Name your organization and add people and teams in the app. |

Use **New Workspace** in the header to return to this page. **Backup and restore** is below the cards. **My Workspaces** appears when you have more than one workspace.

For PDF export, install Chromium once:

```sh
npx playwright install chromium
```

Chromium is also needed for browser tests. Normal planning and HTML exports do not need it.

## Templates and examples

Download a file below using GitHub's **Download raw file** button, or use the download links on the app's **Import** page. These are fictional examples, not anonymized personnel records.

| File | Contents | Import option |
|---|---|---|
| [Roster template](templates/roster.csv) | People, teams, managers, roles and timezones | **Import Roster** |
| [Areas template](templates/areas.csv) | Responsibilities, owners and team assignments | **Import Areas** |
| [Example workspace](templates/workspace.json) | A small complete workspace with an editable scenario | **Import Workspace** |

For a larger example, choose **Try an example** in the app. It has several reporting levels, shared areas, collaborators and unassigned people. Example workspaces stay separate from your own organization.

### Import a roster

Open **Import → Import Roster**, name the organization, and upload a CSV or TSV file. You can also paste cells copied from a spreadsheet, including the header row. Map your columns, click **Preview import**, review the result, then confirm.

| Column | Meaning |
|---|---|
| `person_id` | A stable, unique ID. Letters, numbers, underscores and hyphens are supported. |
| `name` | Required display name. |
| `team` | Team membership. Non-empty values create teams. |
| `manager` | Manager's person ID or exact unique name. Leave blank for no manager in scope. |
| `role` | Optional job title. |
| `timezone` | Optional IANA timezone, such as `Asia/Tokyo` or `Africa/Nairobi`. |

Stable IDs make later comparisons reliable. Missing IDs are generated from row numbers and flagged in the preview. Duplicate IDs, ambiguous or missing managers, reporting cycles and invalid timezones must be corrected before import.

Each roster import creates a new reference and editable scenario. Later imports show added, changed and absent people. They never overwrite an earlier workspace or delete people missing from the new file.

### Import areas or a workspace

**Import Areas** uses `name,description,owner,teams`. Import the roster template first if you want to try the matching areas template. Teams must already exist; separate several team names or IDs with semicolons. Blank team cells leave an area unassigned. Areas are added to the selected saved scenario, or to a new scenario when viewing the baseline.

**Import Workspace** accepts this edition's JSON format, including the example above, a `planner.json` workspace export or a full backup. Upload the file, preview it and confirm. Restoring adds independent copies with new IDs without overwriting existing work. You do not need to edit JSON.

Spreadsheet imports are limited to 2 MB; roster imports support up to 2,000 people and 500 teams. JSON imports are limited to 10 MB. Legacy planner formats and other tools' JSON are not converted.

## How planning works

| Concept | Purpose |
|---|---|
| **Workspace** | One organization or independent planning context. |
| **Current baseline** | The unchanged reference you imported or created. |
| **Scenario** | An editable plan based on that reference. Changes leave the baseline intact. |
| **Snapshot** | A frozen copy of a scenario, including its profiles, relationships, photos and view. |

Team membership, reporting managers and team leadership are separate. Moving a person to another team keeps their manager. Moving a team leader clears their old leadership assignment.

Areas describe responsibilities and can belong to several teams or none. Collaborators have editable roles and do not automatically become roster members. Timezone groups can be customized without changing people's exact timezones.

Edits save automatically. If a save fails or another window has changed the scenario, the app keeps your draft and offers retry or **Save separate scenario**. Resolve the error before reloading. Undo and redo apply to scenario changes.

**Delete workspace** asks for confirmation, then removes that workspace, its scenarios, associated snapshots, their generated HTML and photos no longer used elsewhere. Deletion cannot be undone. Other workspaces stay unchanged.

## Backups and exports

| Where | What you get |
|---|---|
| **People → Export roster** | CSV of the selected baseline or saved scenario's people and relationships. |
| **Areas → Export areas** | CSV of the selected baseline or saved scenario's responsibilities and team assignments. |
| **Current baseline → Overview → Export → All Workspace** | `planner.json` containing only that workspace, its scenarios, associated snapshots and required photos. |
| **New Workspace → Backup and restore → Download JSON backup** | All workspaces, scenarios, snapshots and photos in one backup. |
| **Save snapshot**, then its export controls | Standalone HTML or PDF of the frozen plan. |

CSV is useful for spreadsheets but omits photos, collaborators, layout, team leadership and other planning details. Use JSON for a complete backup. Spreadsheet formula-like values receive a leading apostrophe for safety; that apostrophe remains when reimported.

Offline HTML supports teams, timezones, reporting and areas. PDF captures the saved view, including nodes outside the viewport. Local snapshot links work only on the computer running the planner.

To restore, use **Import → Import Workspace** or **New Workspace → Restore a backup**. Restored snapshot links receive new IDs. Snapshots from a multi-workspace backup with no clear workspace association remain visibly unassigned and are not deleted with a workspace.

**Exports and backups can contain personal or confidential information. Anyone with a copy can read them.** Deleting a workspace or snapshot cannot revoke downloaded or shared files. Remove those copies separately.

## Privacy and local storage

There is no sign-in, telemetry, organization integration or hosted data collection. The server accepts local requests only. **Do not expose it through a proxy, tunnel or hosting service:** it has no authentication, and anyone who can reach the process can read its records.

Data is stored outside the repository by default:

```text
~/.org-planner/planner.json
~/.org-planner/planner.json.lock
~/.org-planner/exports/
```

Set `DATA_DIR` to an absolute directory to use another location. Set `APP_ORIGIN` to a different `http://127.0.0.1:PORT` if needed. Keep data and exports outside source control. Storage is not encrypted; use device encryption and appropriate file access controls.

Photos are optional. Initials are used by default. Local uploads and direct public HTTPS image URLs accept PNG, JPEG or WebP up to 3 MB and 20 megapixels. Images are resized to at most 160 by 160 pixels and stored as WebP without metadata. URL imports contact the image host once from your computer; redirects and private network addresses are rejected. Only the normalized image is stored, not the URL.

For a file-level restore of a store larger than the in-app limit, stop the app, preserve the current `planner.json` separately, then replace it with a trusted backup. Only remove a stale lock after confirming that its recorded process has stopped.

Runtime data, photos, generated exports and test output are ignored and excluded from source archives. Never force-add them. The downloadable templates are checked against the exact fictional source.

## Development

The app uses React, TypeScript and React Flow, with an Express server and atomic JSON storage. It is designed for one local process, not collaborative hosting.

```sh
npm run build
npm test
npx playwright install chromium
npm run test:ui
npm run check:release
npm audit
```

Browser tests use fictional data on loopback port 4184, separate from the normal app. Release checks reject unexpected files, runtime records, modified templates and configured credential or internal-reference patterns. They are safeguards, not proof that arbitrary text contains no personal information.

## Fork and contribute

Use [Fork](https://github.com/glorialangreo/org-planner-oss/fork) to create a copy on your GitHub profile, then clone your fork and follow [Get started](#get-started). Create a branch for your changes and open a pull request when ready.

Keep examples and test fixtures fictional. Do not include personnel records, photos, backups or generated exports in issues, pull requests or commits. Run the development checks above before submitting changes.

The package has `"private": true` to prevent accidental npm publication. This does not restrict GitHub forks or use under the license.

## License

[MIT](LICENSE). Copyright (c) 2026 Gloria Langreo.

You can fork, modify and redistribute this tool under the MIT license. Keep the copyright and license notice with copies of the software.

See [Release requirements](RELEASE.md) for source archive instructions and the release checklist, and [Dependency review](THIRD_PARTY_NOTICES.md) for dependency licenses and distribution considerations.
