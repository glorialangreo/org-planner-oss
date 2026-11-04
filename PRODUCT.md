# Organization planner

A local planning tool for people who need to compare organization structures without changing their source roster. Users may arrive with a spreadsheet or start with an empty organization.

## Product requirements

- First value: add or import people, then move them between teams in an editable scenario.
- A team is a membership group. An area is a responsibility shared by any number of teams. Reporting managers and team leaders are separate relationships.
- First launch offers a fictional example, spreadsheet or backup import, and an empty workspace.
- Roster imports create an independent reference and scenario. Area imports add to a saved editable scenario or create a scenario from the immutable baseline, after preview and confirmation. Previous references and frozen snapshots stay intact.
- New Workspace and first launch share the same page titled New Workspace, with Try an example, Import your organization, Start empty and Backup and restore below. Import in the header and the onboarding import card open /import, titled Import, with Roster, Areas and Workspace import cards and a downloadable fictional template for each.
- Current baseline's Overview panel exports the selected workspace as planner.json. People and Areas have their own CSV export buttons for the selected baseline or saved scenario. Selected-workspace exports exclude other workspaces and unassigned snapshots. Full backup and additive restoration remain under New Workspace.
- New Workspace reopens onboarding. My Workspaces appears only with multiple workspaces. Confirmed workspace deletion removes its scenarios and associated snapshots without affecting other workspaces.
- People, teams, areas, collaborator roles and regional groupings are editable in the app.
- Runtime records and exports stay outside the source tree by default.
- No accounts, telemetry or organization integrations. The server binds to loopback and rejects foreign hosts and origins.
- Photos can be uploaded or downloaded once from a user-supplied public HTTPS image URL. Private network URLs and redirects are blocked. Only normalized local image bytes are stored and exported.

## Interface

Preserve the compact planning interface: neutral surfaces, blue actions, system fonts, a canvas with pan and zoom, planning navigation and a details inspector. Onboarding is optional and task-focused. Avoid a marketing landing page or a forced tour. Forms have explicit labels, visible errors and keyboard-accessible controls.

## Release boundary

This repository remains private pending source/privacy review, dependency notice review, company release approval and a license decision. No license approval or publication is implied.
