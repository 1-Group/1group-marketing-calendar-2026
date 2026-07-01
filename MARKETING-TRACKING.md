# Marketing Tracking Changes

A running log of analytics / tag-manager / UTM tracking changes made to 1-Group
marketing properties. Most of these live on **externally-hosted pages** (e.g.
SevenRooms landing pages) and are not part of this codebase — this file is the
record of what was requested, who actioned it, and its verification status.

| Date (EDT) | Property | Change | Requested by | Actioned by | Status |
|------------|----------|--------|--------------|-------------|--------|
| 2026-07-01 | Zorba (SevenRooms) — `https://www.sevenrooms.com/landing/zorbasg` and all pages on the account | Add Google Tag Manager container `GTM-TMWX3TM` (GTM snippet high in `<head>`, noscript iframe after opening `<body>`); clear out any other tags previously attached | Chris Millar (04:30) | Anthony Garcia Rodriguez, SevenRooms API Integrations Support (16:26) | Vendor confirmed container **added**. Removal of old tags **not yet confirmed** by vendor. Live-page verification pending (page is behind bot protection / 403 to automated fetch — verify via GTM Preview / Tag Assistant or Chrome View-Source). |

## Zorba — GTM-TMWX3TM (2026-07-01)

**Container:** `GTM-TMWX3TM`
**Scope requested:** all pages on the SevenRooms account, including
`https://www.sevenrooms.com/landing/zorbasg`.

**Snippets provided to SevenRooms**

High in `<head>`:

```html
<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-TMWX3TM');</script>
<!-- End Google Tag Manager -->
```

Immediately after the opening `<body>` tag:

```html
<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-TMWX3TM"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->
```

**Also requested:** clear out any other tags attached to the page(s).

**Status / open items**
- ✅ SevenRooms (Anthony Garcia Rodriguez) confirmed `GTM-TMWX3TM` was added to Zorba (2026-07-01, 16:26 EDT).
- ⏳ Vendor confirmation that the **old tags were removed** — not yet received; his reply only confirmed the add.
- ⏳ Live verification of container placement + that no other `GTM-`/`G-`/`UA-`/`AW-`/Pixel IDs remain — verify via GTM Preview / Tag Assistant on the container, or Chrome View-Source (`Ctrl+U`, search `GTM-TMWX3TM`).
