# Changelog

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
