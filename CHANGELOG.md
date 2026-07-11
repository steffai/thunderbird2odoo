# Changelog

## 0.5.2

### Features

- **Email status bar**: a colored status bar now appears in the message reader when viewing an email that has been checked against Odoo (via the right-click menu). Shows whether the email (or its predecessor) was found in Odoo, with buttons to open, verify, or add the email. Status is cached per email and persists across restarts.
- **Clear Odoo Cache**: a "Clear Odoo Cache" button in the options page lets users invalidate all cached statuses (useful after switching Odoo servers).

### Changes

- **Internal**: refactored `handleOdooImporter` into reusable `importMessageById` and `verifyMessageById` functions

## 0.5.1

### Fixes

- **AMO review warnings**: replaced `innerHTML` assignments with safe DOM APIs (`createTextNode`/`createElement`) in `dialog.js` and `options.js`, resolving two "Unsafe assignment to innerHTML" warnings from the Thunderbird add-on validator

## 0.5.0

### Fixes

- **UTF-8 decoding**: raw emails from `getRaw()` are now properly decoded as UTF-8 before uploading to Odoo, fixing scrambled non-ASCII characters (e.g. `Ã¼` instead of `ü`) (#2)

### Changes

- The plugin is now able for query Odoo about emails, show information and propose matching actions.
- **Optional host permissions**: replaced the broad `<all_urls>` install-time permission with `optional_permissions` (`*://*/*`); the user is now explicitly prompted for consent when clicking *Test connection* in the options page (per AMO review)

### Features

- **Connection test info**: a successful *Test connection* now shows the authenticated user's login (in monospace) with display name in braces, e.g. `Connection successful as admin (Mitchell Admin)`

## 0.3.0

- Initial release
