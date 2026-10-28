// Parent reviews for the Flip Lab website.
//
//   POST /api/reviews          — a parent submits a review (saved as "pending")
//   GET  /api/reviews          — the website loads APPROVED reviews only
//   GET  /api/reviews-admin    — Coach Steve's private list (needs the admin key)
//   POST /api/reviews-admin    — approve / hide / un-publish / delete (needs the admin key)
//
// Reviews are stored in Netlify Blobs (store "reviews"). The admin key lives in the
// REVIEWS_ADMIN_KEY environment variable — never in this file.
import { getStore } from "@netlify/blobs";

const STORE = "reviews";
const SPORTS = ["Cheer", "Dance", "Gymnastics", "Other"];
const STATUSES = ["pending", "approved", "hidden"];

const store = () => getStore({ name: STORE, consistency: "strong" });
const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
const clean = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

async function loadAll() {
  const s = store();
  const { blobs } = await s.list({ prefix: "r/" });
  const items = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })));
  return items.filter(Boolean).sort((a, b) => (b.created || 0) - (a.created || 0));
}

function isAdmin(req) {
  const key = Netlify.env.get("REVIEWS_ADMIN_KEY");
  return !!key && req.headers.get("x-admin-key") === key;
}

export default async (req) => {
  const url = new URL(req.url);
  const admin = url.pathname.endsWith("/reviews-admin");

  try {
    // ── Admin ───────────────────────────────────────────────
    if (admin) {
      if (!isAdmin(req)) return json({ ok: false, error: "Wrong password" }, 401);

      if (req.method === "GET") return json({ ok: true, reviews: await loadAll() });

      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const id = clean(body.id, 80);
        if (!/^[a-z0-9-]+$/i.test(id)) return json({ ok: false, error: "Bad id" }, 400);
        const s = store();
        const key = "r/" + id;
        if (body.action === "delete") {
          await s.delete(key);
          return json({ ok: true });
        }
        if (!STATUSES.includes(body.status)) return json({ ok: false, error: "Bad status" }, 400);
        const item = await s.get(key, { type: "json" });
        if (!item) return json({ ok: false, error: "Not found" }, 404);
        item.status = body.status;
        item.updated = Date.now();
        await s.setJSON(key, item);
        return json({ ok: true, review: item });
      }
      return json({ ok: false, error: "Method not allowed" }, 405);
    }

    // ── Public: list approved reviews ───────────────────────
    if (req.method === "GET") {
      const reviews = (await loadAll())
        .filter((r) => r.status === "approved")
        .map(({ rating, text, name, sport, created }) => ({ rating, text, name, sport, created }));
      return json({ ok: true, reviews }, 200, { "cache-control": "public, max-age=60" });
    }

    // ── Public: submit a review ─────────────────────────────
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body.website) return json({ ok: true }); // spam-bot trap field — pretend it worked
      const rating = Math.max(1, Math.min(5, parseInt(body.rating, 10) || 5));
      const text = clean(body.text, 1000);
      const name = clean(body.name, 40);
      const sport = SPORTS.includes(body.sport) ? body.sport : "Other";
      if (text.length < 5) return json({ ok: false, error: "Please write a little more in your review." }, 400);
      if (!name) return json({ ok: false, error: "Please add your first name." }, 400);
      if (!body.consent) return json({ ok: false, error: "Please check the box to let us show your review." }, 400);

      const id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
      await store().setJSON("r/" + id, {
        id, rating, text, name, sport, status: "pending", created: Date.now(),
      });
      return json({ ok: true });
    }

    return json({ ok: false, error: "Method not allowed" }, 405);
  } catch (err) {
    console.error("reviews function error:", err);
    return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
};

export const config = {
  path: ["/api/reviews", "/api/reviews-admin"],
};
