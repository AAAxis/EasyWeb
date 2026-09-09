// The tables this service reads that belong to the CRM: who a number belongs
// to, and who is on the other end of a call.
//
// Deliberately thin. A caller app needs to find a contact by phone number and
// to file a new one when an unknown number rings — it has no business listing,
// editing or importing an address book, so none of that is here.
import { sql } from "./db.ts";
import { HttpError } from "./http.ts";

type Frag = ReturnType<typeof sql>;

const one = <T>(rows: T[], what: string): T => {
  if (rows.length === 0) throw new HttpError(404, `${what} not found`, "NOT_FOUND");
  return rows[0];
};

/** Copies only the fields a caller is allowed to set. */
export function pick(input: Record<string, unknown>, fields: string[]) {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (input[field] !== undefined) out[field] = input[field];
  }
  return out;
}

/** Who a live update goes to. The only thing this service asks of a workspace. */
export const orgs = {
  async memberIds(orgId: number): Promise<string[]> {
    const rows = await sql`select user_id from app_private.org_members where org_id = ${orgId}`;
    return rows.map((r) => r.user_id as string);
  },
};

export const contacts = {
  async get(orgId: number, id: number) {
    const rows = await sql`
      select c.*, co.name as company_name
        from app_private.contacts c
        left join app_private.companies co on co.id = c.company_id
       where c.org_id = ${orgId} and c.id = ${id}
    `;
    return one(rows, "Contact");
  },


  async create(orgId: number, input: Record<string, unknown>) {
    const values = { ...pick(input, CONTACT_FIELDS), org_id: orgId };
    if (!values.first_name && !values.last_name && !values.email && !values.phone) {
      throw new HttpError(400, "A contact needs at least a name, email or phone", "CONTACT_EMPTY");
    }
    const [row] = await sql`insert into app_private.contacts ${sql(values)} returning *`;
    return row;
  },


  async findByPhone(orgId: number, phone: string) {
    const rows = await sql`
      select id, full_name, email, phone from app_private.contacts
       where org_id = ${orgId} and phone is not null
         and right(regexp_replace(phone, '[^0-9]', '', 'g'), 9)
           = right(regexp_replace(${phone}, '[^0-9]', '', 'g'), 9)
       limit 1
    `;
    return rows[0] ?? null;
  },
};


// ---------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------

export const numbers = {
  list(orgId: number) {
    return sql`
      select * from app_private.phone_numbers
       where org_id = ${orgId}
       order by is_primary desc, id desc
    `;
  },

  async add(orgId: number, input: {
    user_id: string;
    phone_number: string;
    label?: string | null;
    provider_sid?: string | null;
    is_verified: boolean;
  }) {
    // The workspace's first usable number becomes primary without a second tap.
    const existing = await sql`
      select count(*)::int as n from app_private.phone_numbers where org_id = ${orgId}
    `;
    const [row] = await sql`
      insert into app_private.phone_numbers ${sql({
        org_id: orgId,
        user_id: input.user_id,
        phone_number: input.phone_number,
        label: input.label ?? null,
        provider: "twilio",
        provider_sid: input.provider_sid ?? null,
        is_verified: input.is_verified,
        is_primary: Number(existing[0].n) === 0,
      })}
      on conflict (org_id, phone_number) do update
        set provider_sid = excluded.provider_sid,
            is_verified = excluded.is_verified,
            user_id = excluded.user_id
      returning *
    `;
    return row;
  },

  async setPrimary(orgId: number, id: number) {
    await sql`update app_private.phone_numbers set is_primary = false where org_id = ${orgId}`;
    const rows = await sql`
      update app_private.phone_numbers set is_primary = true
       where org_id = ${orgId} and id = ${id}
       returning *
    `;
    return one(rows, "Phone number");
  },

  async remove(orgId: number, id: number) {
    const rows = await sql`
      delete from app_private.phone_numbers
       where org_id = ${orgId} and id = ${id}
       returning *
    `;
    return one(rows, "Phone number");
  },

  /** The callerid webhook confirms a bind — org rides in the signed URL. */
  async markVerified(orgId: number, phoneNumber: string) {
    await sql`
      update app_private.phone_numbers set is_verified = true
       where org_id = ${orgId} and phone_number = ${phoneNumber}
    `;
  },

  /** The number outbound calls should present for this workspace. */
  async primaryFor(orgId: number): Promise<string | null> {
    const rows = await sql`
      select phone_number from app_private.phone_numbers
       where org_id = ${orgId} and is_verified = true
       order by is_primary desc, id desc
       limit 1
    `;
    return rows.length > 0 ? String(rows[0].phone_number) : null;
  },
};
