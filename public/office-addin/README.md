# Karatina EDRMS — Microsoft Office Add-ins

Four Office Add-in manifests live in this folder:

| Host         | Manifest                                                                  |
| ------------ | ------------------------------------------------------------------------- |
| Word         | `https://<host>/office-addin/manifest-word.xml`                           |
| Excel        | `https://<host>/office-addin/manifest-excel.xml`                          |
| PowerPoint   | `https://<host>/office-addin/manifest-powerpoint.xml`                     |
| Outlook      | `https://<host>/office-addin/manifest-outlook.xml`                        |

Replace every `EDRMS_HOST` token inside each XML file with your deployment's
public hostname before sideloading (e.g. `edrms.karu.ac.ke`). The admin
discovery page at `/admin/office-addins` will offer one-click "download with
your host baked in" manifests so you don't have to edit XML by hand.

## What each add-in does

- **Word / Excel / PowerPoint** — opens a "Save to EDRMS" task pane. Reads
  the open document via `Office.context.document.getFileAsync`, slices it,
  and POSTs the bytes to `/api/office/ingest`.
- **Outlook** — opens on any read email (`ItemRead`). Captures the subject,
  sender, recipients, date, and HTML body. Attachments are listed with
  checkboxes; supported hosts (Mailbox 1.8+, i.e. modern Outlook desktop and
  the Microsoft 365 web app) will upload the attachment bytes too. Older
  hosts save the body only and surface a TODO badge.

The user must already be signed in to the EDRMS in the same browser; the
task pane piggybacks on the existing next-auth session cookie.

## Sideloading for development

### Microsoft 365 web (Word/Excel/PowerPoint/Outlook on the web)

1. Open the host in the browser (e.g. `https://word.cloud.microsoft`).
2. Click **Add-ins** → **More Add-ins** → **My Add-ins** → **Upload My Add-in**.
3. Browse to your downloaded `manifest-<host>.xml` and upload it.
4. The "Save to EDRMS" button appears in the ribbon / message surface.

### Office desktop (Windows / Mac)

1. Make sure the manifest is reachable over HTTPS (`https://<host>/office-addin/manifest-word.xml`).
2. Open Word/Excel/PowerPoint, go to **Insert** → **Get Add-ins** → **My Add-ins** → **Upload My Add-in**.
3. Pick the XML file. The task pane will load via Office.js and the embedded browser.
4. For Outlook, the same flow lives under **Get Add-ins** → **My add-ins**.

## Production deployment

Use the Microsoft 365 admin centre's **Centralized Deployment** feature:

1. Sign in to `https://admin.microsoft.com` as a Global / Apps Administrator.
2. Navigate to **Settings** → **Integrated apps** → **Upload custom apps**.
3. Choose **Office Add-in** and provide the manifest URL
   (e.g. `https://edrms.karu.ac.ke/office-addin/manifest-word.xml`).
4. Assign to the relevant users / groups. The add-in will appear in their
   ribbon automatically within ~24 hours.

Repeat for all four manifests. Manifest changes propagate on the same cycle.
