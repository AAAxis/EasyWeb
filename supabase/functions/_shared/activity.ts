// Calls, recordings and SMS threads — the tables this service owns, and the
// only ones it writes.
//
// It is a slice of the CRM's `activity.ts`, taken rather than shared: the two
// repos deploy into the same Postgres, so the tables are common ground, but a
// copy of the whole module would carry deals, email and WhatsApp — none of
// which a phone that dials belongs anywhere near.
import { sql } from "./db.ts";
import { HttpError } from "./http.ts";
import { pick } from "./repository.ts";

type Frag = ReturnType<typeof sql>;
const and = (frags: Frag[]): Frag => frags.reduce((acc, frag) => sql`${acc} and ${frag}`);
const one = <T>(rows: T[], what: string): T => {
  if (rows.length === 0) throw new HttpError(404, `${what} not found`, "NOT_FOUND");
  return rows[0];
};


const CALL_FIELDS = [
  "contact_id", "deal_id", "direction", "from_number", "to_number", "status",
  "duration_seconds", "recording_url", "provider", "provider_call_sid",
  "outcome", "notes", "started_at", "ended_at",
];

export const calls = {
  async list(orgId: number, opts: { contactId?: number; userId?: string; limit: number; cursor?: number }) {
    const where = [sql`c.org_id = ${orgId}`];
    if (opts.cursor) where.push(sql`c.id < ${opts.cursor}`);
    if (opts.contactId) where.push(sql`c.contact_id = ${opts.contactId}`);
    if (opts.userId) where.push(sql`c.user_id = ${opts.userId}`);

    return await sql`
      select c.id, c.direction, c.from_number, c.to_number, c.status,
             c.duration_seconds, c.outcome, c.notes, c.started_at, c.ended_at,
             c.contact_id, c.deal_id, c.user_id, c.recording_url,
             ct.full_name as contact_name
        from app_private.calls c
        left join app_private.contacts ct on ct.id = c.contact_id
       where ${and(where)}
       order by c.id desc
       limit ${opts.limit}
    `;
  },

  /**
   * Logs a call. When the client doesn't name a contact, the other party's
   * number is matched against the address book so the call still lands on
   * somebody's timeline.
   */
  async log(orgId: number, userId: string, input: Record<string, unknown>) {
    const values = pick(input, CALL_FIELDS);
    if (!values.direction) values.direction = "outbound";

    if (!values.contact_id) {
      const other = values.direction === "inbound" ? values.from_number : values.to_number;
      if (other) {
        const { contacts } = await import("./repository.ts");
        const match = await contacts.findByPhone(orgId, String(other));
        if (match) values.contact_id = match.id;
      }
    }

    const [row] = await sql`
      insert into app_private.calls ${sql({ ...values, org_id: orgId, user_id: userId })}
      returning *
    `;
    return row;
  },

  /**
   * Reconciles a call the app placed but only Twilio can finish. The sid is
   * the only handle the client has at that point.
   */
  async updateBySid(orgId: number, sid: string, patch: Record<string, unknown>) {
    const values = pick(patch, ["status", "duration_seconds", "outcome", "notes", "recording_url", "ended_at"]);
    if (Object.keys(values).length === 0) {
      const rows = await sql`
        select * from app_private.calls where org_id = ${orgId} and provider_call_sid = ${sid}`;
      return one(rows, "Call");
    }
    const rows = await sql`
      update app_private.calls set ${sql(values)}
       where org_id = ${orgId} and provider_call_sid = ${sid}
      returning *
    `;
    return one(rows, "Call");
  },

  async update(orgId: number, id: number, patch: Record<string, unknown>) {
    const values = pick(patch, ["status", "duration_seconds", "outcome", "notes", "recording_url", "ended_at", "contact_id", "deal_id"]);
    if (Object.keys(values).length === 0) {
      const rows = await sql`select * from app_private.calls where org_id = ${orgId} and id = ${id}`;
      return one(rows, "Call");
    }
    const rows = await sql`
      update app_private.calls set ${sql(values)}
       where org_id = ${orgId} and id = ${id}
      returning *
    `;
    return one(rows, "Call");
  },
};

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------


export const recordings = {
  async list(orgId: number, opts: { limit: number; cursor?: number; callId?: number }) {
    const where = [sql`r.org_id = ${orgId}`];
    if (opts.cursor) where.push(sql`r.id < ${opts.cursor}`);
    if (opts.callId) where.push(sql`r.call_id = ${opts.callId}`);

    return await sql`
      select r.id, r.call_id, r.recording_sid, r.status, r.duration_seconds,
             r.size_bytes, r.created_at, r.stored_at, r.error,
             c.direction, c.from_number, c.to_number, c.started_at,
             c.contact_id, ct.full_name as contact_name
        from app_private.call_recordings r
        left join app_private.calls c    on c.id = r.call_id
        left join app_private.contacts ct on ct.id = c.contact_id
       where ${and(where)}
       order by r.id desc
       limit ${opts.limit}
    `;
  },

  async get(orgId: number, id: number) {
    const rows = await sql`
      select id, org_id, storage_path, status, recording_sid
        from app_private.call_recordings
       where org_id = ${orgId} and id = ${id}
    `;
    return one(rows, "Recording");
  },

  async remove(orgId: number, id: number) {
    await sql`delete from app_private.call_recordings where org_id = ${orgId} and id = ${id}`;
  },

  /** How much audio this workspace is holding, for the settings screen. */
  async usage(orgId: number) {
    const [row] = await sql`
      select count(*)::int as count,
             coalesce(sum(size_bytes), 0)::bigint as bytes,
             coalesce(sum(duration_seconds), 0)::int as seconds
        from app_private.call_recordings
       where org_id = ${orgId} and status = 'stored'
    `;
    return { count: Number(row.count), bytes: Number(row.bytes), seconds: Number(row.seconds) };
  },
};

// ---------------------------------------------------------------------------
// SMS threads
//
// WhatsApp lives on the CRM's own bridge and stays there, so `sendWhatsApp`,
// `receiveWhatsApp` and `whatsappInstance` are deliberately not here — this
// service never touches that half of the table.
// ---------------------------------------------------------------------------

export const conversations = {
  async list(orgId: number, opts: { status?: string; limit: number; cursor?: number }) {
    const where = [sql`cv.org_id = ${orgId}`];
    if (opts.cursor) where.push(sql`cv.id < ${opts.cursor}`);
    if (opts.status) where.push(sql`cv.status = ${opts.status}`);

    return await sql`
      select cv.id, cv.subject, cv.channel, cv.status, cv.assignee_id,
             cv.last_message_at, cv.last_message_preview, cv.unread_count,
             cv.contact_id, cv.deal_id,
             c.full_name as contact_name, c.email as contact_email
        from app_private.conversations cv
        left join app_private.contacts c on c.id = cv.contact_id
       where ${and(where)}
       order by cv.last_message_at desc
       limit ${opts.limit}
    `;
  },

  async get(orgId: number, id: number) {
    const rows = await sql`
      select cv.*, c.full_name as contact_name, c.email as contact_email, c.phone as contact_phone
        from app_private.conversations cv
        left join app_private.contacts c on c.id = cv.contact_id
       where cv.org_id = ${orgId} and cv.id = ${id}
    `;
    return one(rows, "Conversation");
  },

  async create(orgId: number, input: Record<string, unknown>) {
    const values = pick(input, ["contact_id", "deal_id", "subject", "channel", "assignee_id"]);
    const [row] = await sql`
      insert into app_private.conversations ${sql({ ...values, org_id: orgId })} returning *
    `;
    return row;
  },

  /**
   * The thread for a bare phone number, from the dialler.
   *
   * Matches an existing contact by number first — texting someone you already
   * know should land in their thread, not start a parallel one keyed on digits.
   * Deliberately does not create a contact: typing a number is not the same as
   * deciding to keep it.
   */
  async forPhone(orgId: number, phone: string) {
    const { contacts } = await import("./repository.ts");
    const match = await contacts.findByPhone(orgId, phone);
    if (match) return await conversations.forContact(orgId, match.id);

    const rows = await sql`
      select * from app_private.conversations
       where org_id = ${orgId} and channel = 'sms' and subject = ${phone} and status <> 'closed'
       order by last_message_at desc limit 1
    `;
    if (rows.length > 0) return rows[0];
    return await conversations.create(orgId, { channel: "sms", subject: phone });
  },

  /** Reuses the contact's open conversation instead of piling up threads. */
  async forContact(orgId: number, contactId: number) {
    const rows = await sql`
      select * from app_private.conversations
       where org_id = ${orgId} and contact_id = ${contactId} and status <> 'closed'
       order by last_message_at desc limit 1
    `;
    if (rows.length > 0) return rows[0];
    return await conversations.create(orgId, { contact_id: contactId, channel: "in_app" });
  },

  async messages(orgId: number, conversationId: number, opts: { limit: number; cursor?: number }) {
    const where = [sql`m.org_id = ${orgId}`, sql`m.conversation_id = ${conversationId}`];
    if (opts.cursor) where.push(sql`m.id < ${opts.cursor}`);
    return await sql`
      select m.id, m.sender_type, m.sender_user_id, m.body, m.attachments,
             m.delivered_at, m.read_at, m.created_at,
             u.full_name as sender_name, u.avatar_url as sender_avatar
        from app_private.messages m
        left join app_private.users u on u.id = m.sender_user_id
       where ${and(where)}
       order by m.id desc
       limit ${opts.limit}
    `;
  },

  async postMessage(
    orgId: number,
    conversationId: number,
    input: { body: string; sender_type?: string; sender_user_id?: string | null; attachments?: unknown },
  ) {
    if (!input.body?.trim()) throw new HttpError(400, "A message needs a body", "EMPTY_MESSAGE");
    await conversations.get(orgId, conversationId); // proves the conversation is ours

    const [row] = await sql`
      insert into app_private.messages ${sql({
        org_id: orgId,
        conversation_id: conversationId,
        sender_type: input.sender_type ?? "user",
        sender_user_id: input.sender_user_id ?? null,
        body: input.body,
        attachments: JSON.stringify(input.attachments ?? []),
        delivered_at: new Date(),
      })}
      returning *
    `;
    return row;
  },

  /**
   * Sends a text and records it on the contact's conversation.
   *
   * The message row is written whatever the provider says, so a failed send is
   * still visible on the timeline rather than vanishing — the same rule email
   * follows.
   */
  async sendSms(
    orgId: number,
    userId: string,
    input: { contact_id?: number; to?: string; body: string; conversation_id?: number },
  ) {
    if (!input.body?.trim()) throw new HttpError(400, "A text needs a body", "EMPTY_MESSAGE");

    const { contacts } = await import("./repository.ts");
    let contact = null;
    if (input.contact_id) contact = await contacts.get(orgId, input.contact_id);

    // Replying inside an existing thread: an inbound text from an unknown
    // number creates a conversation with no contact — the number lives in the
    // subject, so a reply can still find its way back.
    let existing = null;
    if (input.conversation_id) {
      existing = await conversations.get(orgId, input.conversation_id);
      if (!contact && existing.contact_id) contact = await contacts.get(orgId, Number(existing.contact_id));
    }

    const subjectNumber = typeof existing?.subject === "string" && /^\+?[\d\s()-]{6,}$/.test(existing.subject)
      ? existing.subject
      : null;
    const to = input.to ?? contact?.phone ?? subjectNumber;
    if (!to) throw new HttpError(400, "No number to text", "NO_RECIPIENT");

    // Reuse the thread being replied to, else the contact's open thread, so
    // texts and in-app messages sit together rather than splitting histories.
    const conversation = existing ??
      (contact
        ? await conversations.forContact(orgId, contact.id)
        : await conversations.create(orgId, { channel: "sms", subject: to }));

    if (conversation.channel !== "sms") {
      await sql`update app_private.conversations set channel = 'sms' where id = ${conversation.id}`;
    }

    const { sendSms: send } = await import("./providers/sms.ts");
    const { credsFor } = await import("./providers/twilioAccount.ts");
    const { numbers } = await import("./repository.ts");
    const creds = await credsFor(orgId);
    const from = (await numbers.primaryFor(orgId)) ?? undefined;
    // Texting runs on the workspace's own Twilio account, never the
    // platform's — the message is still recorded either way.
    const result = creds?.own
      ? await send({ to, from, body: input.body }, creds)
      : {
          provider: "twilio",
          providerMessageId: null,
          status: "failed" as const,
          error: "Connect your Twilio account in Settings → Phone number to send texts.",
        };

    const message = await conversations.postMessage(orgId, conversation.id, {
      body: input.body,
      sender_type: "user",
      sender_user_id: userId,
      attachments: [{ kind: "sms", to, status: result.status, provider_id: result.providerMessageId }],
    });

    return { conversation, message, delivery: result };
  },

  /** Records an inbound text, creating the conversation if this is the first. */
  async receiveSms(orgId: number, from: string, body: string, providerId?: string | null) {
    const { contacts } = await import("./repository.ts");
    const match = await contacts.findByPhone(orgId, from);

    const conversation = match
      ? await conversations.forContact(orgId, match.id)
      : await conversations.create(orgId, { channel: "sms", subject: from });

    if (conversation.channel !== "sms") {
      await sql`update app_private.conversations set channel = 'sms' where id = ${conversation.id}`;
    }

    return await conversations.postMessage(orgId, conversation.id, {
      body,
      sender_type: "contact",
      sender_user_id: null,
      attachments: [{ kind: "sms", from, provider_id: providerId ?? null }],
    });
  },

  async markRead(orgId: number, conversationId: number) {
    await sql`
      update app_private.messages set read_at = now()
       where org_id = ${orgId} and conversation_id = ${conversationId} and read_at is null
    `;
    const [row] = await sql`
      update app_private.conversations set unread_count = 0
       where org_id = ${orgId} and id = ${conversationId}
      returning id, unread_count
    `;
    return row;
  },
};
