# Supabase storage

Project `tpbugonqwaoxtcswxyki`, bucket `captures`, created and reachable.

## Which key goes where

You supplied three. Only one may ever appear in the web app.

| Key | Where it may live | Why |
|---|---|---|
| `sb_publishable_...` | **The web app.** Already wired. | Designed to be public. Constrained by row-level security |
| `sb_secret_...` | Server or local shell only | Bypasses row-level security |
| `eyJ...` (JWT, `"role":"service_role"`) | Server or local shell only | Bypasses row-level security. The most powerful key in the project |

A web page ships its source to everyone who opens it, so a secret key in one is public the
moment it is deployed. All three were pasted into a chat transcript, so **rotate the secret and
service-role keys** in Dashboard &rarr; Settings &rarr; API regardless of where they end up.

## The bucket is write-only, deliberately

`captures` is private, capped at 10 MB per object, and restricted to image and JSON types. The
policy below grants **insert only** to anonymous callers. The app can add frames; it cannot
list, read or delete anyone's — including its own. That is what makes it safe to publish a key
that anybody can extract.

## One statement you need to run

Storage policies are rows in `storage.objects`, so they need SQL. Dashboard &rarr; SQL Editor:

```sql
-- Anonymous clients may add objects to `captures`, and do nothing else with them.
create policy "anon can upload captures"
on storage.objects for insert to anon
with check (bucket_id = 'captures');
```

Verify it took:

```bash
curl -X POST "https://tpbugonqwaoxtcswxyki.supabase.co/storage/v1/object/captures/probe/t.jpeg" \
  -H "apikey: sb_publishable_kYqbDWABU2nqK3JFUAfxAw_DysNJ4m_" \
  -H "Authorization: Bearer sb_publishable_kYqbDWABU2nqK3JFUAfxAw_DysNJ4m_" \
  -H "Content-Type: image/jpeg" --data-binary @some.jpg
```

Before the policy this returns `new row violates row-level security policy`. After it, `200`.

## What lands in the bucket

One folder per nightly run, `YYYY-MM-DD-xxxxxx/`:

- `<frame-id>.webp` — the compressed frames that survived curation
- `manifest.json` — the metadata that makes them usable

The manifest is the point. Without capture position and time the pipeline has pixels and
nothing to anchor them with, so it carries per frame: position and its reported accuracy,
capture time, dimensions, byte count, measured sharpness, 35 mm-equivalent focal length, camera
model, and whether the frame was shot in the app or imported.

## Reading it back

The publishable key cannot read. Use the service-role key from a shell, or the dashboard:

```bash
curl -X POST "https://tpbugonqwaoxtcswxyki.supabase.co/storage/v1/object/list/captures" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "apikey: $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" -d '{"prefix":"","limit":100}'
```

## Worth adding later

- **A retention rule.** Raw imagery is transient by design; it should expire once fused.
- **Rate limiting.** An open insert policy is open to anyone who reads the key out of the page.
  A per-IP edge function, or a signed-upload flow once a server exists, closes that.
