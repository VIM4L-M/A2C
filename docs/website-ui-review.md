# Website UI implementation

Design authority: the A2C UI screen specification. The website uses the Hello world hero reference, continuous charcoal grid, restrained borders, pixel display headings and sans-serif controls. The extension shares the theme but remains the compact scan/review/fill tool.

## Website pages

- `demo/landing.html`: product, workflow, privacy, demo forms and developer installation.
- `demo/workspace/workspace.html#dashboard`: actual website-local profile and activity counts; extension usage explicitly disconnected.
- `#walkthrough`: installation, optional context, privacy and a practice form.
- `#profile`: validated fact creation, editing, confirmation and deletion using the existing memory components.
- `#imports`: reviewed text/PDF and ChatGPT paste imports; saved-answer state.
- `#privacy`: website-local category preferences, vault and data controls.
- `#settings`: explicit storage and connection status.

The workspace is a React website built with `vite.website.config.ts`. It uses its own prefixed local storage, not Chrome extension storage. Facts and permissions do not synchronize with the extension yet. No account, fabricated activity, time-saved estimate or silent extension-memory bridge has been added. A website backend connection remains unavailable; live inference and cloud configuration belong in extension Settings for now. The website explains these boundaries persistently.

The source ZIP links to published main; it does not contain uncommitted work. A final playable video is still pending, so the website links to working demo forms rather than an unavailable video.
