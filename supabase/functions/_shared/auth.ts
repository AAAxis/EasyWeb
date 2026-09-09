// Turns an incoming request into "which user, acting in which org, with what
// role". Every handler starts here.
import { sql } from "./db.ts";
import { HttpError } from "./http.ts";
import { ensureAuthenticatedClaim, FirebaseClaims, verifyIdToken } from "./firebase.ts";

export type Actor = {
  uid: string;
  claims: FirebaseClaims;
};

export type OrgContext = Actor & {
  orgId: number;
  role: "owner" | "admin" | "member";
};

export async function requireUser(req: Request): Promise<Actor> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new HttpError(401, "Authentication required", "AUTH_REQUIRED");

  let claims: FirebaseClaims;
  try {
    claims = await verifyIdToken(token);
  } catch (error) {
    throw new HttpError(401, `Invalid token: ${(error as Error).message}`, "INVALID_TOKEN");
  }

  return { uid: claims.sub, claims };
}

/**
 * Upserts the profile mirror. Called on every authenticated request so a first
 * sign-in never has to be a special case, and so the claim stamp happens
 * without the client asking for it.
 */
export async function syncUser(actor: Actor) {
  const { uid, claims } = actor;
  await sql`
    insert into app_private.users (id, email, full_name, avatar_url, last_seen_at)
    values (${uid}, ${claims.email ?? null}, ${claims.name ?? null}, ${claims.picture ?? null}, now())
    on conflict (id) do update
      set email        = coalesce(excluded.email, app_private.users.email),
          full_name    = coalesce(excluded.full_name, app_private.users.full_name),
          avatar_url   = coalesce(excluded.avatar_url, app_private.users.avatar_url),
          last_seen_at = now()
  `;
  await ensureAuthenticatedClaim(uid, claims);
}

/**
 * Resolves the org the request is acting in. The client sends `x-org-id` (or
 * ?org_id=); when it sends neither — a fresh install that has not picked one —
 * the user's oldest membership is used.
 *
 * This is the only place membership is checked, which is what keeps org_id
 * scoping honest: handlers receive an orgId that has already been proven.
 */
export async function requireOrg(
  actor: Actor,
  req: Request,
  query?: URLSearchParams,
): Promise<OrgContext> {
  const requested = req.headers.get("x-org-id") ?? query?.get("org_id") ?? null;

  const rows = requested
    ? await sql`
        select org_id, role from app_private.org_members
         where user_id = ${actor.uid} and org_id = ${Number(requested)}
      `
    : await sql`
        select org_id, role from app_private.org_members
         where user_id = ${actor.uid}
         order by joined_at asc
         limit 1
      `;

  if (rows.length === 0) {
    throw new HttpError(
      requested ? 403 : 404,
      requested ? "You are not a member of this workspace" : "No workspace yet",
      requested ? "NOT_A_MEMBER" : "NO_ORGANIZATION",
    );
  }

  return {
    ...actor,
    orgId: Number(rows[0].org_id),
    role: rows[0].role as OrgContext["role"],
  };
}

/** Approving expenses, inviting members and deleting records are admin work. */
export function requireAdmin(ctx: OrgContext) {
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    throw new HttpError(403, "This action needs an admin", "FORBIDDEN");
  }
}
