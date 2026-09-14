# ChadPDChee AdSense / Content Upgrade — September 14, 2026

This build preserves the existing Chad application and adds a crawlable public publishing layer.

## Added
- `/guides/` public DIY guide hub
- 9 original static DIY guides
- `/about.html`
- `/safety.html`
- `/site.css`
- `/robots.txt`
- `/sitemap.xml`

## Updated
- Homepage title, description, canonical and Open Graph metadata
- Homepage public navigation and guide links
- Privacy Policy with advertising / Google AdSense cookie disclosures
- Service worker build/version and duplicate-code cleanup
- Private/admin/support pages marked noindex where appropriate

## Ad placement decision
The AdSense verification script remains installed in the homepage and public content pages.
The existing explicit Google ad unit on the interactive Chad conversation screen is disabled in this build.
This deliberately keeps Google-served advertising off the private conversational experience while the public DIY content pages are the intended publisher content.

## Before AdSense resubmission
1. Deploy this build.
2. Confirm `/guides/`, `/about.html`, `/safety.html`, `/privacy.html`, `/robots.txt`, and `/sitemap.xml` all load publicly.
3. Open the homepage on desktop and mobile and confirm Chad chat, login, photos, sharing, sponsor cards, and PWA install still work.
4. In Google Search Console, submit `https://chadpdchee.com/sitemap.xml` if Search Console is configured.
5. In AdSense Privacy & messaging, configure the required consent message/CMP for regions Google requires before serving personalized ads.
6. Give Google time to crawl the new pages, then resubmit the site for review.

## 2026-09-14 shopping/embed preservation merge
This package uses the latest supplied `server.js` and `public/index.html` as the functional source of truth before layering the AdSense/content changes on top.

Preserved specifically:
- HammeredHandyman.com cross-site embed mode (`?embed=1`).
- Explicit embed conversation IDs used when third-party cookies are blocked/partitioned.
- `conversation_id` sent with shopping-list requests.
- Automatic shopping-list generation after qualifying Chad answers.
- Amazon.ca product/search affiliate-link rendering and shopping analytics.
- Existing Chad chat, login, photo, share, sponsor and account functionality.

AdSense/content additions are limited to metadata/navigation/content pages and keeping Google-served ads off the private conversation screen during approval.
