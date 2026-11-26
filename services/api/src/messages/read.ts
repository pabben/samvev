import type { DbClient } from '../db.ts';

export interface MessageReadActor {
  householdId: string;
  membershipId: string;
  personId: string;
  manageHousehold: boolean;
  /** When present, person-audience visibility is limited to this OAuth grant's live resources. */
  mcpGrantId?: string;
}

export interface MessageReadWindow {
  /** Household-local inclusive date window. Filtering happens before LIMIT. */
  fromLocalDate: string;
  toLocalDate: string;
  limit: number;
}

/**
 * Read household messages through one recipient policy shared by the member
 * route and MCP. The MCP path uses the same member identity and visibility
 * rules, while selected-person messages require a current, exact grant row.
 */
export async function listMessages(client: Pick<DbClient, 'query'>, actor: MessageReadActor, window?: MessageReadWindow) {
  const result = await client.query(`SELECT m.id,m.body,m.importance,m.audience_household,m.publish_at,m.expires_at,m.state,m.revision,m.created_at,m.updated_at,
      CASE WHEN $6::uuid IS NOT NULL AND p.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM mcp_oauth_grant_people author_grant WHERE author_grant.grant_id=$5 AND author_grant.household_id=m.household_id AND author_grant.person_id=p.id) THEN 'Household member' ELSE COALESCE(p.display_name,m.author_display_name,m.author_integration_name) END AS author_name,
      CASE WHEN m.author_integration_id IS NOT NULL THEN 'integration' WHEN m.author_display_id IS NULL THEN 'member' ELSE 'display' END AS author_type,
      CASE WHEN $6::uuid IS NOT NULL THEN NULL ELSE m.author_display_id END AS author_display_id,
      CASE WHEN $6::uuid IS NULL OR p.id IS NULL OR EXISTS(SELECT 1 FROM mcp_oauth_grant_people author_grant WHERE author_grant.grant_id=$5 AND author_grant.household_id=m.household_id AND author_grant.person_id=p.id) THEN p.id ELSE NULL END AS author_person_id,
      CASE WHEN $6::uuid IS NOT NULL THEN false ELSE COALESCE((m.author_membership_id=$3 OR $2),false) END AS can_edit,
      COALESCE((SELECT json_agg(person_id) FROM message_person_audiences WHERE message_id=m.id AND ($6::uuid IS NULL OR EXISTS(
        SELECT 1 FROM mcp_oauth_grant_people allowed WHERE allowed.grant_id=$5 AND allowed.household_id=m.household_id AND allowed.person_id=message_person_audiences.person_id
      ))),'[]') AS person_ids,
      CASE WHEN $6::uuid IS NOT NULL THEN '[]'::json ELSE COALESCE((SELECT json_agg(display_id) FROM message_display_targets WHERE message_id=m.id AND delivery_state<>'cancelled'),'[]') END AS display_ids,
      CASE WHEN $6::uuid IS NOT NULL THEN '[]'::json ELSE COALESCE((SELECT json_agg(json_build_object('displayId',display_id,'state',delivery_state,'deliveredAt',delivered_at,'displayedAt',displayed_at,'revision',delivered_revision)) FROM message_display_targets WHERE message_id=m.id),'[]') END AS deliveries,
      COALESCE((SELECT json_agg(json_build_object('action',CASE WHEN e.from_state=e.to_state THEN 'edited' ELSE 'withdrawn' END,'actorName',CASE WHEN $6::uuid IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM mcp_oauth_grant_people actor_grant WHERE actor_grant.grant_id=$5 AND actor_grant.household_id=m.household_id AND actor_grant.person_id=ep.id
      ) THEN 'Household member' ELSE ep.display_name END,'occurredAt',e.occurred_at) ORDER BY e.occurred_at,e.id)
        FROM message_lifecycle_events e JOIN memberships em ON em.account_id=e.actor_id AND em.household_id=m.household_id JOIN persons ep ON ep.id=em.person_id AND ep.household_id=em.household_id
        WHERE e.message_id=m.id AND e.actor_type='account' AND (e.from_state=e.to_state OR e.to_state IN ('cancelled','withdrawn'))),'[]') AS activity
      FROM messages m JOIN households household ON household.id=m.household_id
      LEFT JOIN memberships am ON am.id=m.author_membership_id LEFT JOIN persons p ON p.id=am.person_id AND p.household_id=m.household_id
      WHERE m.household_id=$1 AND ($2 OR m.author_membership_id=$3 OR m.audience_household OR EXISTS(
        SELECT 1 FROM message_person_audiences pa
        WHERE pa.message_id=m.id AND pa.household_id=m.household_id AND (
          ($5::uuid IS NULL AND pa.person_id=$4)
          OR ($5::uuid IS NOT NULL AND EXISTS(SELECT 1 FROM mcp_oauth_grant_people allowed
            WHERE allowed.grant_id=$5 AND allowed.household_id=m.household_id AND allowed.person_id=pa.person_id))
        )
      )) AND ($5::uuid IS NULL OR m.audience_household OR EXISTS(
        SELECT 1 FROM message_person_audiences granted_audience JOIN mcp_oauth_grant_people allowed
          ON allowed.grant_id=$5 AND allowed.household_id=m.household_id AND allowed.person_id=granted_audience.person_id
        WHERE granted_audience.message_id=m.id AND granted_audience.household_id=m.household_id
      )) AND ($7::date IS NULL OR (
        m.state IN ('scheduled','published')
        AND m.expires_at > ($7::date::timestamp AT TIME ZONE household.timezone)
        AND m.publish_at < (($8::date+1)::timestamp AT TIME ZONE household.timezone)
      ))
      ORDER BY m.created_at DESC LIMIT $9`, [actor.householdId, actor.manageHousehold, actor.membershipId, actor.personId, actor.mcpGrantId ?? null, actor.mcpGrantId ?? null,
        window?.fromLocalDate ?? null, window?.toLocalDate ?? null, window?.limit ?? 200]);
  return result.rows;
}
